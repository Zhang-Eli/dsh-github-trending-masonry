/**
 * Persistent two-level cache for Trending boards.
 *
 * Level 1 is an in-process Map; level 2 is one JSON file per period under the
 * plugin's data directory. The disk copy is what makes reopening the panel after
 * a Harness restart fast: the first fresh read never touches the network.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/** Bump when the cached board shape changes; old files are ignored. */
const CACHE_VERSION = 4

export class FeedCache {
  constructor(directory, ttlMs) {
    this.directory = directory
    this.ttlMs = Math.max(60_000, Number(ttlMs) || 0)
    this.memory = new Map()
    this.inflight = new Map()
  }

  fileFor(since) {
    return path.join(this.directory, `feed-${since}.json`)
  }

  /** Cached record for one period, or null. Never throws. */
  async peek(since) {
    if (this.memory.has(since)) return this.memory.get(since)
    try {
      const raw = await fs.readFile(this.fileFor(since), 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.items) || !Number.isFinite(Number(parsed.storedAt))) return null
      const record = { items: parsed.items, storedAt: Number(parsed.storedAt) }
      this.memory.set(since, record)
      return record
    } catch {
      return null
    }
  }

  ageMs(record) {
    return record ? Math.max(0, Date.now() - record.storedAt) : Number.POSITIVE_INFINITY
  }

  async write(since, items) {
    const record = { version: CACHE_VERSION, storedAt: Date.now(), since, items }
    this.memory.set(since, record)
    try {
      await fs.mkdir(this.directory, { recursive: true })
      const target = this.fileFor(since)
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
      await fs.writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temporary, target)
    } catch {
      /* the in-memory copy still serves this process */
    }
    return record
  }

  /**
   * Single-flight refresh: concurrent callers for the same period share one
   * network fetch instead of launching a scrape each.
   */
  refresh(since, loader) {
    const running = this.inflight.get(since)
    if (running) return running
    if (typeof loader !== 'function') return Promise.reject(new Error('missing loader'))
    const task = (async () => {
      try {
        const items = await loader()
        const record = await this.write(since, items)
        return { items: record.items, storedAt: record.storedAt }
      } finally {
        this.inflight.delete(since)
      }
    })()
    this.inflight.set(since, task)
    return task
  }
}
