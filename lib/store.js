/**
 * Plugin-owned durable state: the local starred-repo collection, the connected
 * account metadata, and (only as a fallback when the Harness credentials service
 * is unavailable) the GitHub token.
 *
 * One JSON file, written atomically with owner-only permissions.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const VERSION = 1

function emptyState() {
  return { version: VERSION, account: null, stars: {}, token: null }
}

function cleanString(value, maxLength = 500) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function cleanStar(raw, fallbackName) {
  const fullName = cleanString(raw?.fullName, 200) || fallbackName
  if (!fullName || !fullName.includes('/')) return null
  const [owner, name] = fullName.split('/')
  const stack = Array.isArray(raw?.stack)
    ? raw.stack.map((entry) => cleanString(entry, 60)).filter(Boolean).slice(0, 8)
    : []
  const features = Array.isArray(raw?.features)
    ? raw.features.map((entry) => cleanString(entry, 220)).filter(Boolean).slice(0, 4)
    : []
  return {
    fullName,
    owner: cleanString(raw?.owner, 100) || owner,
    name: cleanString(raw?.name, 100) || name,
    url: cleanString(raw?.url, 400) || `https://github.com/${fullName}`,
    description: cleanString(raw?.description, 600),
    intro: cleanString(raw?.intro, 1400) || null,
    features,
    language: cleanString(raw?.language, 60) || null,
    languageColor: cleanString(raw?.languageColor, 20) || null,
    stack,
    category: cleanString(raw?.category, 40) || 'other',
    categoryZh: cleanString(raw?.categoryZh, 60) || '其他',
    categoryEn: cleanString(raw?.categoryEn, 60) || 'Other',
    mode: raw?.mode === 'github' ? 'github' : 'local',
    starredAt: cleanString(raw?.starredAt, 40) || new Date().toISOString(),
  }
}

function normalizeState(parsed) {
  const state = emptyState()
  if (!parsed || typeof parsed !== 'object') return state
  if (parsed.account && typeof parsed.account === 'object' && cleanString(parsed.account.login, 100)) {
    state.account = {
      login: cleanString(parsed.account.login, 100),
      avatarUrl: cleanString(parsed.account.avatarUrl, 400) || null,
      verifiedAt: cleanString(parsed.account.verifiedAt, 40) || null,
    }
  }
  if (parsed.token) state.token = cleanString(parsed.token, 400) || null
  if (parsed.stars && typeof parsed.stars === 'object') {
    for (const [key, value] of Object.entries(parsed.stars)) {
      const entry = cleanStar(value, key)
      if (entry) state.stars[entry.fullName] = entry
    }
  }
  return state
}

export class PluginStore {
  constructor(directory) {
    this.directory = directory
    this.file = path.join(directory, 'state.json')
    this.state = null
    this.chain = Promise.resolve()
  }

  async load() {
    if (this.state) return this.state
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      this.state = normalizeState(JSON.parse(raw))
    } catch {
      this.state = emptyState()
    }
    return this.state
  }

  async persist() {
    const state = await this.load()
    const snapshot = JSON.stringify(state, null, 2)
    this.chain = this.chain.then(async () => {
      try {
        await fs.mkdir(this.directory, { recursive: true })
        const temporary = `${this.file}.tmp-${process.pid}-${Date.now()}`
        await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temporary, this.file)
      } catch {
        /* keep serving from memory if the disk write fails */
      }
    })
    return this.chain
  }

  async account() {
    const state = await this.load()
    return state.account ? { ...state.account } : null
  }

  async setAccount(account) {
    const state = await this.load()
    state.account = account
      ? {
          login: cleanString(account.login, 100),
          avatarUrl: cleanString(account.avatarUrl, 400) || null,
          verifiedAt: new Date().toISOString(),
        }
      : null
    await this.persist()
    return state.account ? { ...state.account } : null
  }

  async token() {
    const state = await this.load()
    return state.token || null
  }

  async setToken(token) {
    const state = await this.load()
    state.token = token ? cleanString(token, 400) : null
    await this.persist()
  }

  async star(rawEntry) {
    const state = await this.load()
    const entry = cleanStar(rawEntry, cleanString(rawEntry?.fullName, 200))
    if (!entry) return null
    state.stars[entry.fullName] = entry
    await this.persist()
    return { ...entry }
  }

  async unstar(fullName) {
    const state = await this.load()
    const key = cleanString(fullName, 200)
    if (!key || !state.stars[key]) return null
    const entry = { ...state.stars[key] }
    delete state.stars[key]
    await this.persist()
    return entry
  }

  async starEntry(fullName) {
    const state = await this.load()
    const entry = state.stars[cleanString(fullName, 200)]
    return entry ? { ...entry } : null
  }

  async listStars() {
    const state = await this.load()
    return Object.values(state.stars)
      .map((entry) => ({ ...entry }))
      .sort((a, b) => String(b.starredAt).localeCompare(String(a.starredAt)))
  }
}
