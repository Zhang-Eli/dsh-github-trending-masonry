// Startup warmup tests.
//
// Opening DSH — not opening the panel — should pay for a stale board: an
// unref'd timer refreshes the board the panel last requested and pre-mirrors
// its images. These tests boot the plugin with warmup enabled and a stubbed
// fetch, and assert the caches land on disk with no panel request at all.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'

const BASE = '/dsh-github-trending-masonry'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const BANNER = 'https://raw.githubusercontent.com/owner/repo/HEAD/docs/banner.png'
const AVATAR = 'https://github.com/octo.png?size=96'

const TRENDING_HTML = `<!DOCTYPE html><html><body>
<article class="Box-row">
  <h2><a href="/octo/demo">demo</a></h2>
  <p>A demo project used by the warmup test.</p>
  <span itemprop="programmingLanguage">TypeScript</span>
  <a href="/octo/demo/stargazers">1,234</a>
  <a href="/octo/demo/forks">56</a>
  <span>7 stars today</span>
</article>
</body></html>`

function httpResponse(status, contentType, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return contentType
        return null
      },
    },
    text: async () => String(body),
    arrayBuffer: async () => new Uint8Array(body),
  }
}

function standardHandler(url) {
  if (url.startsWith('https://github.com/trending')) return httpResponse(200, 'text/html', TRENDING_HTML)
  if (url === BANNER || url === AVATAR) return httpResponse(200, 'image/png', PNG)
  return httpResponse(404, 'text/plain', '')
}

/** A fresh enricher entry for octo/demo so warmup never touches GitHub's README routes. */
function freshCache() {
  return {
    version: 3,
    updatedAt: new Date().toISOString(),
    entries: {
      'octo/demo': { fetchedAt: Date.now(), intro: '一个演示项目。', features: ['演示'], image: BANNER },
    },
  }
}

function boot(options = {}) {
  const dataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-warm-'))
  if (options.cache) {
    fs.writeFileSync(path.join(dataDir, 'readme-cache.json'), JSON.stringify(options.cache), 'utf8')
  }
  if (options.state) {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(options.state), 'utf8')
  }
  const registered = []
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register: (definition) => registered.push(definition) }
      return undefined
    },
    effect(fn) {
      fn()
    },
    logger: { info() {} },
  }
  apply(ctx, { dataDir, summaries: false, warmup: true, warmupDelayMs: 5 })
  return { dataDir }
}

function dispose(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    calls.push(target)
    return handler(target, init)
  }
  return { calls, restore() { globalThis.fetch = original } }
}

async function until(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return predicate()
}

const trendingScrapes = (calls) => calls.filter((url) => url.startsWith('https://github.com/trending')).length

test('startup warmup rebuilds the board and mirrors its images without any panel request', async () => {
  const app = boot({ cache: freshCache() })
  const stub = stubFetch(standardHandler)
  try {
    const feedFile = path.join(app.dataDir, 'feed-daily-zh.json')
    assert.ok(await until(() => fs.existsSync(feedFile)), 'warmup never wrote the feed cache')
    const feed = JSON.parse(fs.readFileSync(feedFile, 'utf8'))
    assert.equal(feed.items[0].fullName, 'octo/demo')

    const indexFile = path.join(app.dataDir, 'images', 'index.json')
    assert.ok(
      await until(() => {
        try {
          const entries = Object.values(JSON.parse(fs.readFileSync(indexFile, 'utf8')).entries)
          return entries.some((entry) => entry.url === BANNER) && entries.some((entry) => entry.url === AVATAR)
        } catch {
          return false
        }
      }),
      'warmup never mirrored the banner/avatar',
    )
    assert.ok(!stub.calls.some((url) => url.startsWith('https://raw.githubusercontent.com/octo/')), 'enricher cache was ignored')
    assert.ok(!stub.calls.some((url) => url.includes(BASE)), 'warmup must not go through the panel routes')
  } finally {
    stub.restore()
    dispose(app.dataDir)
  }
})

test('warmup follows the board the panel last requested', async () => {
  const app = boot({
    cache: freshCache(),
    state: { version: 1, account: null, stars: {}, token: null, lastFeed: { since: 'weekly', lang: 'en' } },
  })
  const stub = stubFetch(standardHandler)
  try {
    const feedFile = path.join(app.dataDir, 'feed-weekly-en.json')
    assert.ok(await until(() => fs.existsSync(feedFile)), 'warmup did not honour the remembered board')
    assert.ok(stub.calls.some((url) => url === 'https://github.com/trending?since=weekly'))
    assert.ok(!fs.existsSync(path.join(app.dataDir, 'feed-daily-zh.json')), 'warmup also scraped the default board')
  } finally {
    stub.restore()
    dispose(app.dataDir)
  }
})

test('a restart inside the TTL warmup window does not re-scrape or re-mirror', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-warm-'))
  const stub = stubFetch(standardHandler)
  const first = boot({ dataDir, cache: freshCache() })
  try {
    const feedFile = path.join(dataDir, 'feed-daily-zh.json')
    const indexFile = path.join(dataDir, 'images', 'index.json')
    assert.ok(await until(() => fs.existsSync(feedFile)))
    assert.ok(
      await until(() => {
        try {
          const entries = Object.values(JSON.parse(fs.readFileSync(indexFile, 'utf8')).entries)
          return entries.some((entry) => entry.url === BANNER) && entries.some((entry) => entry.url === AVATAR)
        } catch {
          return false
        }
      }),
      'first warmup never mirrored both images',
    )
    const callsAfterFirst = stub.calls.length
    assert.equal(trendingScrapes(stub.calls), 1)
    // Second boot = a quick DSH restart on the same data directory.
    boot({ dataDir, cache: freshCache() })
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(trendingScrapes(stub.calls), 1, 'fresh disk cache was re-scraped')
    assert.equal(stub.calls.length, callsAfterFirst, 'warm re-boot hit the network at all')
  } finally {
    stub.restore()
    dispose(dataDir)
  }
})
