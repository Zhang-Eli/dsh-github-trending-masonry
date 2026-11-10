/**
 * LLM-backed card summaries.
 *
 * README text + the GitHub one-liner are given to the Harness LLM service
 * (the user's current default model, no separate API key) and the model returns
 * a complete, fluent introduction plus a few short feature bullets directly in
 * the panel language. This replaces literal machine translation: it fixes both
 * truncated README excerpts and unnatural wording.
 *
 * Every failure degrades to the deterministic README-extraction + translation
 * path, so the panel never depends on the model being available.
 */

const MAX_INPUT_CHARS = 8000
const DEFAULT_TIMEOUT_MS = 60000
const DEFAULT_MAX_TOKENS = 1600
const DEFAULT_CONCURRENCY = 6

const LANGUAGE_NAMES = {
  zh: 'Simplified Chinese (简体中文)',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  pt: 'Portuguese',
  it: 'Italian',
  ar: 'Arabic',
}

function safeGet(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

function normalizeLang(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  const base = raw.split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(base) ? base : 'zh'
}

function languageName(lang) {
  return LANGUAGE_NAMES[normalizeLang(lang)] ?? normalizeLang(lang)
}

function systemPrompt(lang) {
  const language = languageName(lang)
  return [
    'You write the card introduction for a GitHub Trending repository panel.',
    'Return ONLY one JSON object with exactly two keys: "intro" (string) and "features" (array of strings).',
    `Write both fields in ${language}.`,
    'intro: 2-4 complete, natural sentences (about 60-320 Chinese characters, or 30-90 English words) that explain what the project is, the main things it implements, and who it is for. Never start with "This repository"; no marketing language; no mention of stars, README, or the fact that you are summarizing.',
    'features: 3-4 short concrete capability bullets, each at most 40 Chinese characters or 12 English words. Describe implemented capabilities only - no installation steps, badges, licenses, community links, or roadmap.',
    'Base every statement on the supplied README excerpt and description. If the README is sparse, write a shorter accurate introduction instead of inventing details.',
    'No Markdown, no code fences, no commentary outside the JSON object.',
  ].join('\n')
}

function userPrompt(input) {
  const payload = [
    `Repository: ${input.fullName}`,
    `GitHub description: ${input.description || '(none)'}`,
    `Primary language: ${input.language || '(unknown)'}`,
    'README excerpt:',
    '"""',
    String(input.readme || '').slice(0, MAX_INPUT_CHARS),
    '"""',
  ].join('\n')
  return payload
}

/** Extract the JSON object from a model reply (tolerates fences / stray prose). */
export function parseSummary(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  let raw = text.trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let data = null
  try {
    data = JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(raw.slice(start, end + 1))
      } catch {
        data = null
      }
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const intro = typeof data.intro === 'string' ? data.intro.replace(/\s+/g, ' ').trim() : ''
  const features = Array.isArray(data.features)
    ? data.features
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => entry.trim().replace(/\s+/g, ' ').slice(0, 220))
        .slice(0, 4)
    : []
  if (intro.length < 20 || intro.length > 1400) return null
  return { intro: intro.slice(0, 1400), features }
}

export function createSummarizer(ctx, config = {}) {
  const llm = safeGet(ctx, 'llm')
  const modelSelection = safeGet(ctx, 'agentDefaultModel')
  const enabled = config.enabled !== false
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS
  const maxTokens = Number(config.maxTokens) > 0 ? Number(config.maxTokens) : DEFAULT_MAX_TOKENS
  const concurrency = Math.max(1, Math.min(8, Number(config.concurrency) || DEFAULT_CONCURRENCY))
  const fixedProvider = typeof config.provider === 'string' && config.provider ? config.provider : null
  const fixedModel = typeof config.model === 'string' && config.model ? config.model : null
  const stats = { attempts: 0, successes: 0, failures: 0, skipped: 0, lastError: null }

  let active = 0
  const waiters = []

  async function acquire() {
    while (active >= concurrency) {
      await new Promise((resolve) => waiters.push(resolve))
    }
    active += 1
  }

  function release() {
    active = Math.max(0, active - 1)
    const next = waiters.shift()
    if (next) next()
  }

  function resolveRoute() {
    if (fixedProvider && fixedModel) {
      return { provider: fixedProvider, model: fixedModel }
    }
    if (modelSelection && typeof modelSelection.currentSelection === 'function') {
      try {
        const selection = modelSelection.currentSelection()
        if (selection && selection.provider && selection.model) {
          return { provider: selection.provider, model: selection.model }
        }
      } catch {
        /* no default selection available */
      }
    }
    return null
  }

  async function streamCall(input, lang) {
    const route = resolveRoute()
    if (!route) return { skipped: 'no model route' }
    if (!llm || typeof llm.prepareCall !== 'function' || typeof llm.stream !== 'function') {
      return { skipped: 'llm service unavailable' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const call = await llm.prepareCall(
        { ...route, maxTokens },
        controller.signal,
        (controls, model) => {
          const effort = model && model.reasoning && Array.isArray(model.reasoning.efforts)
            ? model.reasoning.efforts[0]?.id
            : undefined
          return {
            ...controls,
            temperature: 0.2,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
          }
        },
      )
      const options = {
        ...call.config,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(input) }] }],
        system: systemPrompt(lang),
        signal: controller.signal,
      }
      let text = ''
      let finish = null
      for await (const chunk of call.stream(options)) {
        if (controller.signal.aborted) break
        if (chunk && chunk.type === 'text-delta') text += chunk.text
        else if (chunk && chunk.type === 'finish') finish = chunk.reason
        else if (chunk && chunk.type === 'tool-call-delta') return { skipped: 'tool call' }
      }
      if (finish && finish.kind !== 'stop') return { skipped: `finish ${finish.kind}` }
      return { text }
    } finally {
      clearTimeout(timer)
    }
  }

  async function summarize(input) {
    if (!enabled) return null
    stats.attempts += 1
    await acquire()
    try {
      const result = await streamCall(input, input.lang)
      if (result.skipped) {
        stats.skipped += 1
        stats.lastError = result.skipped
        return null
      }
      const parsed = parseSummary(result.text)
      if (!parsed) {
        stats.failures += 1
        stats.lastError = 'could not parse the model reply as JSON'
        return null
      }
      stats.successes += 1
      return parsed
    } catch (error) {
      stats.failures += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      release()
    }
  }

  function health() {
    return {
      enabled,
      available: Boolean(enabled && llm),
      route: resolveRoute(),
      concurrency,
      timeoutMs,
      ...stats,
    }
  }

  return { enabled, summarize, health }
}
