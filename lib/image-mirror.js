/**
 * Local mirror for the small remote images the panel renders: README header
 * art and owner avatars.
 *
 * Feed refreshes used to re-download every picture: card <img> elements are
 * rebuilt when a new board arrives, and hosts like raw.githubusercontent.com
 * keep their HTTP cache entries alive for only minutes. The mirror fetches
 * each image once, stores the bytes under a hash of the source URL and lets
 * the panel serve them with immutable cache headers. An unchanged project
 * therefore keeps the exact same image forever; only a README whose header
 * art actually changed costs one new download.
 *
 * Every URL fetched here comes out of a public README, so it is treated as
 * untrusted input: http(s) only, no credentials, no private or loopback
 * addresses, bounded redirects, image content types only (SVG excluded) and
 * a hard size cap. Failures are thrown to the caller, which falls back to
 * letting the browser load the original URL.
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const INDEX_VERSION = 1
const MAX_ENTRIES = 300
const MAX_TOTAL_BYTES = 60 * 1024 * 1024
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15000
const MAX_REDIRECTS = 4

const EXTENSION_BY_TYPE = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
])

function hashUrl(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 32)
}

const IP_V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function isPrivateV4(match) {
  const first = Number(match[1])
  const second = Number(match[2])
  if (first === 0 || first === 10 || first === 127) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 198 && second >= 16 && second <= 19) return true
  if (first === 169 && second === 254) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  if (first >= 224) return true
  return false
}

function isPrivateHost(hostname) {
  const plain = String(hostname).replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (!plain) return true
  if (plain === '::' || plain === '::1') return true
  if (plain.startsWith('::ffff:')) {
    const embedded = IP_V4_RE.exec(plain.slice('::ffff:'.length))
    return embedded ? isPrivateV4(embedded) : true
  }
  if (plain.includes(':')) {
    if (/^f[cd][0-9a-f]{2}:/i.test(plain)) return true
    if (plain.startsWith('fe80:')) return true
    return false
  }
  const v4 = IP_V4_RE.exec(plain)
  if (v4) return isPrivateV4(v4)
  if (plain === 'localhost' || plain.endsWith('.localhost') || plain.endsWith('.local')) return true
  if (plain === 'metadata.google.internal') return true
  return false
}

/** Parse one candidate image URL and refuse anything internal or malformed. */
export function assertPublicImageUrl(value) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    throw new Error('invalid image url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('image url must use http(s)')
  if (url.username || url.password) throw new Error('image url must not carry credentials')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('image url must not use a custom port')
  if (!url.hostname) throw new Error('image url must name a host')
  if (isPrivateHost(url.hostname)) throw new Error('image url must not point at a private address')
  return url
}

async function fetchImageBytes(startUrl) {
  let url = assertPublicImageUrl(startUrl).href
  let response = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.1',
          'user-agent': 'dsh-github-trending-masonry/0.3 image-mirror',
        },
      })
    } finally {
      clearTimeout(timer)
    }
    const status = Number(response.status)
    if (status >= 300 && status < 400) {
      const location = typeof response.headers?.get === 'function' ? response.headers.get('location') : null
      if (!location) break
      url = assertPublicImageUrl(new URL(location, url).href).href
      continue
    }
    break
  }
  if (!response) throw new Error('image host did not answer')
  const finalStatus = Number(response.status)
  if (finalStatus !== 200) throw new Error(`image host responded ${finalStatus}`)
  const rawType = String((typeof response.headers?.get === 'function' && response.headers.get('content-type')) || '')
  const contentType = rawType.split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) throw new Error(`not an image (${contentType || 'no content type'})`)
  if (contentType === 'image/svg+xml') throw new Error('svg art is left to the remote host')
  const declared = Number((typeof response.headers?.get === 'function' && response.headers.get('content-length')) || '0')
  if (declared > MAX_IMAGE_BYTES) throw new Error('image too large')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('empty image body')
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('image too large')
  return { buffer, contentType }
}

export class ImageMirror {
  constructor(directory) {
    this.directory = path.join(directory, 'images')
    this.file = path.join(this.directory, 'index.json')
    this.entries = null
    this.loading = null
    this.pending = new Map()
    this.chain = Promise.resolve()
  }

  async load() {
    if (this.entries) return this.entries
    // Single-flight: concurrent cold gets must share ONE entries object,
    // or the later persist overwrites the earlier one's new entry.
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const raw = await fs.readFile(this.file, 'utf8')
          const parsed = JSON.parse(raw)
          this.entries = parsed && parsed.version === INDEX_VERSION && parsed.entries && typeof parsed.entries === 'object'
            ? parsed.entries
            : {}
        } catch {
          this.entries = {}
        }
        this.loading = null
        return this.entries
      })()
    }
    return this.loading
  }

  async persist() {
    const snapshot = JSON.stringify({ version: INDEX_VERSION, updatedAt: new Date().toISOString(), entries: this.entries ?? {} })
    this.chain = this.chain.then(async () => {
      try {
        await fs.mkdir(this.directory, { recursive: true })
        const temporary = `${this.file}.tmp-${process.pid}-${Date.now()}`
        await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temporary, this.file)
      } catch {
        /* the in-memory index still serves this process */
      }
    })
    return this.chain
  }

  entryFile(entry) {
    return path.join(this.directory, entry.file)
  }

  /**
   * Mirror one image URL: the stored bytes when present, otherwise exactly one
   * guarded download. Concurrent requests for the same URL share the fetch.
   */
  async get(sourceUrl) {
    const entries = await this.load()
    const hash = hashUrl(sourceUrl)
    const hit = entries[hash]
    if (hit && typeof hit.file === 'string' && typeof hit.contentType === 'string') {
      try {
        await fs.stat(this.entryFile(hit))
        return hit
      } catch {
        delete entries[hash]
      }
    }
    const running = this.pending.get(hash)
    if (running) return running
    const task = (async () => {
      assertPublicImageUrl(sourceUrl)
      const { buffer, contentType } = await fetchImageBytes(sourceUrl)
      const extension = EXTENSION_BY_TYPE.get(contentType) || '.img'
      const entry = {
        hash,
        url: String(sourceUrl).slice(0, 800),
        file: hash + extension,
        contentType,
        bytes: buffer.length,
        at: Date.now(),
      }
      await fs.mkdir(this.directory, { recursive: true })
      const temporary = path.join(this.directory, `${hash}.tmp-${process.pid}-${Date.now()}`)
      await fs.writeFile(temporary, buffer)
      await fs.chmod(temporary, 0o600).catch(() => {})
      await fs.rename(temporary, this.entryFile(entry))
      entries[hash] = entry
      this.prune()
      await this.persist()
      return entry
    })().finally(() => this.pending.delete(hash))
    this.pending.set(hash, task)
    return task
  }

  /** Drop the oldest mirrors past the entry or byte budget. */
  prune() {
    const entries = this.entries ?? {}
    const keys = Object.keys(entries)
    let total = keys.reduce((sum, key) => sum + (Number(entries[key] && entries[key].bytes) || 0), 0)
    const byAge = keys.sort((a, b) => Number(entries[a] && entries[a].at) - Number(entries[b] && entries[b].at))
    while ((byAge.length > MAX_ENTRIES || total > MAX_TOTAL_BYTES) && byAge.length > 0) {
      const key = byAge.shift()
      const entry = entries[key]
      total -= Number(entry && entry.bytes) || 0
      delete entries[key]
      if (entry && typeof entry.file === 'string') fs.rm(this.entryFile(entry), { force: true }).catch(() => {})
    }
  }

  async read(entry) {
    return fs.readFile(this.entryFile(entry))
  }
}
