/**
 * README enrichment for one Trending board.
 *
 * For every repository this fetches its README, extracts a longer intro and a
 * short feature list, and caches the result on disk. The cache is independent of
 * the board cache: a 30-minute board refresh almost never re-downloads a README,
 * and a Harness restart reuses everything immediately.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { extractReadme, fetchReadme } from './readme.js'
import { needsTranslation } from './translate.js'

const CACHE_VERSION = 3
const README_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MISSING_TTL_MS = 6 * 60 * 60 * 1000
const MAX_ENTRIES = 400
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_README_CACHE_CHARS = 8000
const CONCURRENCY = 6

function cleanList(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => entry.trim().slice(0, 240))
    .slice(0, 4)
}

function wordsOf(value) {
  return String(value ?? '')
    .toLowerCase()
    .match(/[a-z0-9\u4e00-\u9fff]{3,}/gi) || []
}

function fingerprint(text) {
  let hash = 5381
  const source = String(text ?? '')
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

/** Does the README intro already say what the one-line Trending description says? */
function descriptionCovered(description, intro) {
  const descriptionWords = [...new Set(wordsOf(description))]
  if (!descriptionWords.length) return true
  const introWords = new Set(wordsOf(intro))
  const hits = descriptionWords.filter((word) => introWords.has(word)).length
  return hits / descriptionWords.length >= 0.6
}

/**
 * Keep the Trending one-liner as the opening sentence when the README intro
 * talks about something else entirely (setup, usage, badges); it is the most
 * accurate short description of the project.
 */
function composeIntro(description, intro) {
  const pitch = typeof description === 'string' ? description.trim() : ''
  const body = typeof intro === 'string' ? intro.trim() : ''
  if (!pitch || pitch.length < 20) return body || null
  if (!body) return null
  if (descriptionCovered(pitch, body)) return body
  return `${pitch}\n\n${body}`.slice(0, 700)
}

export class ReadmeEnricher {
  constructor(directory) {
    this.directory = directory
    this.file = path.join(directory, 'readme-cache.json')
    this.entries = null
    this.chain = Promise.resolve()
    this.inflight = new Map()
    this.needsPersist = false
  }

  async load() {
    if (this.entries) return this.entries
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === CACHE_VERSION && parsed.entries && typeof parsed.entries === 'object') {
        this.entries = parsed.entries
      } else {
        this.entries = {}
      }
    } catch {
      this.entries = {}
    }
    return this.entries
  }

  prune() {
    const entries = this.entries ?? {}
    const now = Date.now()
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry || !Number.isFinite(Number(entry.fetchedAt)) || now - Number(entry.fetchedAt) > MAX_AGE_MS) {
        delete entries[key]
      }
    }
    const keys = Object.keys(entries)
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => Number(entries[a].fetchedAt) - Number(entries[b].fetchedAt))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((key) => delete entries[key])
    }
  }

  async persist() {
    const entries = this.entries ?? {}
    const snapshot = JSON.stringify({ version: CACHE_VERSION, updatedAt: new Date().toISOString(), entries })
    this.chain = this.chain.then(async () => {
      try {
        await fs.mkdir(this.directory, { recursive: true })
        const temporary = `${this.file}.tmp-${process.pid}-${Date.now()}`
        await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temporary, this.file)
      } catch {
        /* the in-memory cache still serves this process */
      }
    })
    return this.chain
  }

  applyCached(item, entry) {
    const rawIntro = typeof entry.intro === 'string' && entry.intro.trim() ? entry.intro : null
    item.intro = composeIntro(item.description, rawIntro)
    item.features = cleanList(entry.features)
    item.image = typeof entry.image === 'string' && entry.image ? entry.image : null
  }

  /**
   * Translate the composed intro and the feature bullets into `options.lang`,
   * caching the result on the README cache entry. Returns true when something
   * new was translated (so the caller persists the cache).
   */
  async localize(item, entry, options) {
    const translate = options && options.translate
    const lang = options && options.lang
    if (typeof translate !== 'function' || !lang) return false
    const baseIntro = typeof item.intro === 'string' ? item.intro : ''
    const baseFeatures = Array.isArray(item.features) ? item.features : []
    if (!baseIntro && baseFeatures.length === 0) return false

    const key = fingerprint(`${baseIntro}\u0000${baseFeatures.join('\u0001')}`)
    if (!entry.translations || typeof entry.translations !== 'object') entry.translations = {}
    const cached = entry.translations[lang]
    if (cached && cached.key === key) {
      if (typeof cached.intro === 'string' && cached.intro.trim()) item.intro = cached.intro
      if (Array.isArray(cached.features) && cached.features.length) item.features = cached.features
      return false
    }

    // A translation that comes back identical is a no-op (mixed-language or
    // unsupported input); keep the paragraph and try the others independently.
    const callTranslate = async (text) => {
      if (!text || !needsTranslation(text, lang)) return null
      try {
        const out = await translate(text, lang)
        if (out && out.trim() && out.trim() !== text.trim()) return out.trim()
      } catch {
        /* keep the original text */
      }
      return null
    }

    // Bilingual paragraphs (a Chinese description that also carries an English
    // sentence, for example) are translated sentence by sentence.
    const translateOne = async (text) => {
      const direct = await callTranslate(text)
      if (direct) return direct
      const sentences = String(text)
        .split(/(?<=[。！？.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
      if (sentences.length <= 1) return null
      const translated = []
      let any = false
      for (const sentence of sentences) {
        const part = await callTranslate(sentence)
        if (part) {
          translated.push(part)
          any = true
        } else {
          translated.push(sentence)
        }
      }
      return any ? translated.join('') : null
    }

    let intro = null
    let features = null
    let changed = false

    if (baseIntro && needsTranslation(baseIntro, lang)) {
      const paragraphs = baseIntro
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean)
      const translated = []
      let any = false
      for (const paragraph of paragraphs) {
        const part = await translateOne(paragraph)
        if (part) {
          translated.push(part)
          any = true
        } else {
          translated.push(paragraph)
        }
      }
      if (any) {
        intro = translated.join('\n\n')
        changed = true
      }
    }

    if (baseFeatures.length && needsTranslation(baseFeatures.join(' '), lang)) {
      const batch = await translateOne(baseFeatures.join('\n'))
      if (batch) {
        const parts = batch
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        if (parts.length === baseFeatures.length) {
          features = parts
          changed = true
        }
      }
      if (!features) {
        const translated = []
        let any = false
        for (const feature of baseFeatures) {
          const part = await translateOne(feature)
          if (part) {
            translated.push(part)
            any = true
          } else {
            translated.push(feature)
          }
        }
        if (any) {
          features = translated
          changed = true
        }
      }
    }

    if (!changed) return false
    const record = { key, at: Date.now() }
    if (intro !== null) record.intro = intro
    if (features !== null) record.features = features
    entry.translations[lang] = record
    if (intro !== null) item.intro = intro
    if (features !== null) item.features = features
    return true
  }

  summaryKey(entry, lang, description) {
    return fingerprint(`${(entry && entry.rawExcerpt) || ''}\u0000${description ?? ''}\u0000${lang ?? ''}`)
  }

  freshSummary(entry, lang, description) {
    if (!entry || !entry.summaries || typeof entry.summaries !== 'object') return null
    const record = entry.summaries[lang]
    if (!record || record.key !== this.summaryKey(entry, lang, description)) return null
    return record
  }

  applySummary(item, record) {
    if (record && typeof record.intro === 'string' && record.intro.trim()) item.intro = record.intro
    if (record && Array.isArray(record.features) && record.features.length) item.features = record.features
  }

  /**
   * Ask the configured model for a fluent, complete intro in the panel language.
   * Returns true when a new summary was generated and stored; a cached summary is
   * applied without a model call. Failure simply leaves the deterministic path.
   */
  async summarize(item, entry, options) {
    const summarizer = options && options.summarizer
    const lang = options && options.lang
    if (!summarizer || typeof summarizer.summarize !== 'function' || !lang) return false
    const readme = typeof entry.rawExcerpt === 'string' ? entry.rawExcerpt : ''
    if (!readme.trim()) return false

    const cached = this.freshSummary(entry, lang, item.description)
    if (cached) {
      this.applySummary(item, cached)
      return false
    }

    const key = this.summaryKey(entry, lang, item.description)
    const running = this.inflight.get(key)
    if (running) {
      await running.catch(() => {})
      const again = this.freshSummary(entry, lang, item.description)
      if (again) this.applySummary(item, again)
      return false
    }

    const task = (async () => {
      let result = null
      try {
        result = await summarizer.summarize({
          fullName: item.fullName,
          description: typeof item.description === 'string' ? item.description : '',
          language: typeof item.language === 'string' ? item.language : '',
          readme,
          lang,
        })
      } catch {
        result = null
      }
      if (!result) return false
      if (!entry.summaries || typeof entry.summaries !== 'object') entry.summaries = {}
      entry.summaries[lang] = { key, at: Date.now(), intro: result.intro, features: result.features }
      this.applySummary(item, entry.summaries[lang])
      return true
    })().finally(() => this.inflight.delete(key))
    this.inflight.set(key, task)
    return task
  }

  /**
   * One-time cache upgrade: README entries created before the header-image
   * feature carry no `image` key at all. Fetch the README once more and take
   * only the image — intro/features/summaries/translations stay untouched.
   */
  async upgradeImage(entry, fullName, options) {
    if ('image' in entry) return
    let image = null
    try {
      const raw = await fetchReadme(fullName, options)
      if (raw) image = extractReadme(raw, fullName).image || null
    } catch {
      image = null
    }
    entry.image = image
    this.needsPersist = true
  }

  async enrichOne(item, options) {
    const entries = await this.load()
    const key = item.fullName
    const lang = options && options.lang
    const description = item.description
    const cached = entries[key]
    if (cached) {
      const hasContent = Boolean(cached.intro) || (Array.isArray(cached.features) && cached.features.length > 0)
      const ttl = hasContent ? README_TTL_MS : MISSING_TTL_MS
      if (Date.now() - Number(cached.fetchedAt || 0) < ttl) {
        await this.upgradeImage(cached, key, options)
        this.applyCached(item, cached)
        if (!item.intro && typeof description === 'string' && description.trim()) item.intro = description.trim()
        const summarized = await this.summarize(item, cached, options)
        if (summarized || this.freshSummary(cached, lang, description)) return summarized
        return this.localize(item, cached, options)
      }
    }
    let raw = null
    try {
      raw = await fetchReadme(key, options)
    } catch {
      raw = null
    }
    if (raw) {
      const extracted = extractReadme(raw, key)
      entries[key] = {
        fetchedAt: Date.now(),
        intro: extracted.intro,
        features: extracted.features,
        rawExcerpt: String(raw).slice(0, MAX_README_CACHE_CHARS),
        image: extracted.image ?? null,
      }
      this.applyCached(item, entries[key])
    } else {
      entries[key] = { fetchedAt: Date.now(), intro: null, features: [], image: null, missing: true }
      item.intro = null
      item.image = null
      item.features = []
    }
    if (!item.intro && typeof description === 'string' && description.trim()) item.intro = description.trim()
    const summarized = await this.summarize(item, entries[key], options)
    if (!summarized && !this.freshSummary(entries[key], lang, description)) {
      await this.localize(item, entries[key], options)
    }
    return true
  }

  /** Enrich items in place (bounded concurrency) and return the same array. */
  async enrich(items, options = {}) {
    const list = Array.isArray(items) ? items : []
    await this.load()
    const queue = list.slice()
    let changed = false
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift()
        if (!item || !item.fullName) continue
        try {
          if (await this.enrichOne(item, options)) changed = true
        } catch {
          item.intro = null
          item.image = null
          item.features = []
        }
      }
    }
    const workers = []
    for (let index = 0; index < Math.min(CONCURRENCY, Math.max(1, queue.length)); index += 1) workers.push(worker())
    await Promise.all(workers)
    if (changed || this.needsPersist) {
      this.needsPersist = false
      this.prune()
      await this.persist()
    }
    return list
  }
}
