// Regression tests for the host-side image mirror (/image route).
//
// The mirror is what keeps card art from re-downloading on every feed
// refresh: fetch once, store under images/<hash>, serve with immutable
// cache headers. These tests pin the happy path, the ETag revalidation and
// the SSRF refusals with a stubbed fetch, so no network is needed.
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

function httpResponse(status, contentType, body, headers = {}) {
  return {
    status,
    headers: {
      get(name) {
        const key = String(name).toLowerCase()
        if (key === 'content-type') return contentType
        return Object.prototype.hasOwnProperty.call(headers, key) ? headers[key] : null
      },
    },
    arrayBuffer: async () => new Uint8Array(body).buffer,
  }
}

function boot(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-img-'))
  if (options.cache) {
    fs.writeFileSync(path.join(dataDir, 'readme-cache.json'), JSON.stringify(options.cache), 'utf8')
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
  apply(ctx, { dataDir, warmup: false })
  const definition = registered.find((route) => route.path === `${BASE}/image`)
  const call = (overrides = {}) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) {
          this.headers[String(name).toLowerCase()] = value
        },
        end(body) {
          resolve({ status: this.statusCode, headers: this.headers, body })
        },
      }
      const { headers, ...rest } = overrides
      definition.handler(
        {
          method: 'GET',
          url: `${BASE}/image`,
          path: `${BASE}/image`,
          socket: { remoteAddress: '127.0.0.1' },
          ...rest,
          headers: { host: '127.0.0.1:51976', 'sec-fetch-site': 'same-origin', ...(headers || {}) },
        },
        res,
      )
    })
  return { dataDir, call, dispose() { fs.rmSync(dataDir, { recursive: true, force: true }) } }
}

function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    return handler(String(url), init)
  }
  return { calls, restore() { globalThis.fetch = original } }
}

const cacheWith = (image, repo = 'owner/repo') => ({
  version: 3,
  updatedAt: new Date().toISOString(),
  entries: { [repo]: { fetchedAt: Date.now(), intro: null, features: [], image } },
})

test('banner images are mirrored once and reused across cache refreshes', async () => {
  const app = boot({ cache: cacheWith(BANNER) })
  const stub = stubFetch(() => httpResponse(200, 'image/png', PNG))
  try {
    const first = await app.call({ url: `${BASE}/image?repo=owner%2Frepo` })
    assert.equal(first.status, 200)
    assert.equal(first.headers['content-type'], 'image/png')
    assert.match(String(first.headers['cache-control']), /public, max-age=31536000, immutable/)
    assert.equal(Buffer.compare(Buffer.from(first.body), PNG), 0)
    assert.ok(first.headers.etag.startsWith('"') && first.headers.etag.endsWith('"'))

    const again = await app.call({ url: `${BASE}/image?repo=owner%2Frepo` })
    assert.equal(again.status, 200)
    assert.equal(stub.calls.length, 1, 'an unchanged project must reuse the mirrored file')

    const revalidated = await app.call({
      url: `${BASE}/image?repo=owner%2Frepo`,
      headers: { 'if-none-match': first.headers.etag },
    })
    assert.equal(revalidated.status, 304)
    assert.equal(stub.calls.length, 1)

    const onDisk = fs.readdirSync(path.join(app.dataDir, 'images')).filter((name) => name.endsWith('.png'))
    assert.equal(onDisk.length, 1)
  } finally {
    stub.restore()
    app.dispose()
  }
})

test('avatars mirror through the github redirect chain', async () => {
  const app = boot()
  const stub = stubFetch((url) =>
    url.startsWith('https://github.com/')
      ? httpResponse(302, null, Buffer.alloc(0), { location: 'https://avatars.githubusercontent.com/u/123?v=4' })
      : httpResponse(200, 'image/png', PNG),
  )
  try {
    const got = await app.call({ url: `${BASE}/image?avatar=octocat` })
    assert.equal(got.status, 200)
    assert.equal(Buffer.compare(Buffer.from(got.body), PNG), 0)
    assert.equal(stub.calls.length, 2, 'the redirect is followed once and then served')
  } finally {
    stub.restore()
    app.dispose()
  }
})

test('the image route rejects malformed parameters without fetching', async () => {
  const app = boot()
  const stub = stubFetch(() => httpResponse(200, 'image/png', PNG))
  try {
    const bare = await app.call({ url: `${BASE}/image` })
    assert.equal(bare.status, 400)
    assert.equal(JSON.parse(bare.body).code, 'bad_request')

    const badRepo = await app.call({ url: `${BASE}/image?repo=not%20a%20repo` })
    assert.equal(badRepo.status, 400)
    assert.equal(JSON.parse(badRepo.body).code, 'invalid_repo')

    const unknown = await app.call({ url: `${BASE}/image?repo=owner%2Frepo` })
    assert.equal(unknown.status, 404)
    assert.equal(JSON.parse(unknown.body).code, 'no_image')

    const badLogin = await app.call({ url: `${BASE}/image?avatar=bad%20name` })
    assert.equal(badLogin.status, 400)
    assert.equal(JSON.parse(badLogin.body).code, 'invalid_login')

    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
    app.dispose()
  }
})

test('the mirror refuses private hosts, vector files and oversize answers', async () => {
  const blocked = [
    ['loopback', 'http://127.0.0.1:51976/private.png'],
    ['ipv6 loopback', 'https://[::1]/x.png'],
    ['cloud metadata', 'https://metadata.google.internal/x.png'],
    ['custom port', 'https://example.com:8080/x.png'],
    ['credentials', 'https://user@evil.example/x.png'],
  ]
  for (const [label, image] of blocked) {
    const app = boot({ cache: cacheWith(image) })
    const stub = stubFetch(() => httpResponse(200, 'image/png', PNG))
    try {
      const got = await app.call({ url: `${BASE}/image?repo=owner%2Frepo` })
      assert.equal(got.status, 502, label)
      assert.equal(JSON.parse(got.body).code, 'image_fetch', label)
      assert.equal(stub.calls.length, 0, 'blocked hosts are never contacted: ' + label)
    } finally {
      stub.restore()
      app.dispose()
    }
  }

  const svg = boot({ cache: cacheWith('https://example.com/logo.svg') })
  const svgStub = stubFetch(() => httpResponse(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'))
  try {
    assert.equal((await svg.call({ url: `${BASE}/image?repo=owner%2Frepo` })).status, 502)
  } finally {
    svgStub.restore()
    svg.dispose()
  }

  const big = boot({ cache: cacheWith(BANNER) })
  const bigStub = stubFetch(() => httpResponse(200, 'image/png', PNG, { 'content-length': String(7 * 1024 * 1024) }))
  try {
    assert.equal((await big.call({ url: `${BASE}/image?repo=owner%2Frepo` })).status, 502)
  } finally {
    bigStub.restore()
    big.dispose()
  }
})

test('redirect chains stop at the cap', async () => {
  const app = boot({ cache: cacheWith('https://example.com/a.png') })
  let n = 0
  const stub = stubFetch(() => httpResponse(302, null, Buffer.alloc(0), { location: `https://example.com/hop${(n += 1)}.png` }))
  try {
    const got = await app.call({ url: `${BASE}/image?repo=owner%2Frepo` })
    assert.equal(got.status, 502)
    assert.equal(stub.calls.length, 5, 'initial request plus four redirects')
  } finally {
    stub.restore()
    app.dispose()
  }
})
