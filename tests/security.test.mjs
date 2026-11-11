// Security regression tests for the host-side route fence.
//
// The panel routes are registered with `webServer.register`, which has no
// admission control of its own: these tests pin down that every handler
// refuses cross-site / DNS-rebinding callers, rejects non-JSON mutation
// bodies, and never lets an ambient GITHUB_TOKEN authorize a star.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'

const BASE = '/dsh-github-trending-masonry'

function boot(connection) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-sec-'))
  const registered = []
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register: (definition) => registered.push(definition) }
      if (name === 'connection') return connection
      return undefined
    },
    effect(fn) {
      fn()
    },
    logger: { info() {} },
  }
  apply(ctx, { dataDir })
  const byPath = new Map(registered.map((definition) => [definition.path, definition]))
  return {
    byPath,
    dataDir,
    dispose() {
      fs.rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

function call(definition, request) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
      end(body) {
        resolve({ status: this.statusCode, headers: this.headers, body })
      },
    }
    definition.handler(request, res)
  })
}

function req(overrides = {}) {
  const handlers = {}
  const request = {
    method: 'GET',
    headers: { host: '127.0.0.1:51976', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, listener) {
      ;(handlers[event] ??= []).push(listener)
      return request
    },
    ...overrides,
  }
  return request
}

function jsonReq(payload, overrides = {}) {
  const handlers = {}
  const request = {
    method: 'POST',
    headers: { host: '127.0.0.1:51976', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, listener) {
      ;(handlers[event] ??= []).push(listener)
      if (event === 'data') queueMicrotask(() => listener(Buffer.from(JSON.stringify(payload))))
      if (event === 'end') queueMicrotask(() => listener())
      if (event === 'error') queueMicrotask(() => {})
      return request
    },
    ...overrides,
  }
  return request
}

test('all five panel routes are registered', () => {
  const { byPath, dispose } = boot(undefined)
  try {
    assert.deepEqual(
      [...byPath.keys()].sort(),
      [`${BASE}/account`, `${BASE}/feed`, `${BASE}/health`, `${BASE}/star`, `${BASE}/state`].sort(),
    )
  } finally {
    dispose()
  }
})

test('connection.requestRejection is authoritative when the service exists', async () => {
  const { byPath, dispose } = boot({ requestRejection: () => 403 })
  try {
    const result = await call(byPath.get(`${BASE}/state`), req())
    assert.equal(result.status, 403)
    assert.equal(JSON.parse(result.body).code, 'forbidden')
  } finally {
    dispose()
  }
})

test('cross-site Origin is refused without the connection service', async () => {
  const { byPath, dispose } = boot(undefined)
  try {
    const result = await call(
      byPath.get(`${BASE}/state`),
      req({ headers: { host: '127.0.0.1:51976', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }),
    )
    assert.equal(result.status, 403)
  } finally {
    dispose()
  }
})

test('a DNS-rebinding Host header is refused', async () => {
  const { byPath, dispose } = boot(undefined)
  try {
    const result = await call(byPath.get(`${BASE}/health`), req({ headers: { host: 'evil.example:51976' } }))
    assert.equal(result.status, 403)
  } finally {
    dispose()
  }
})

test('a non-loopback peer is refused', async () => {
  const { byPath, dispose } = boot(undefined)
  try {
    const result = await call(byPath.get(`${BASE}/health`), req({ socket: { remoteAddress: '203.0.113.9' } }))
    assert.equal(result.status, 403)
  } finally {
    dispose()
  }
})

test('same-origin GET still succeeds', async () => {
  const { byPath, dispose } = boot(undefined)
  try {
    const result = await call(byPath.get(`${BASE}/health`), req())
    assert.equal(result.status, 200)
    assert.equal(JSON.parse(result.body).ok, true)
  } finally {
    dispose()
  }
})

test('wrong method gets 405 with an Allow header', async () => {
  const { byPath, dispose } = boot(undefined)
  try {
    const result = await call(byPath.get(`${BASE}/star`), req({ method: 'GET' }))
    assert.equal(result.status, 405)
    assert.equal(result.headers.allow, 'POST')
  } finally {
    dispose()
  }
})

test('a simple cross-site POST is refused before the body is read', async () => {
  const { byPath, dispose } = boot(undefined)
  try {
    const result = await call(
      byPath.get(`${BASE}/star`),
      req({ method: 'POST', headers: { host: '127.0.0.1:51976', origin: 'https://evil.example', 'content-type': 'text/plain' } }),
    )
    assert.equal(result.status, 403)
  } finally {
    dispose()
  }
})

test('a same-origin POST with a non-JSON content type gets 415', async () => {
  const { byPath, dispose } = boot(undefined)
  try {
    const result = await call(byPath.get(`${BASE}/star`), req({ method: 'POST', headers: { host: '127.0.0.1:51976', 'content-type': 'text/plain' } }))
    assert.equal(result.status, 415)
  } finally {
    dispose()
  }
})

test('an ambient GITHUB_TOKEN never authorizes /star', async () => {
  const { byPath, dispose } = boot(undefined)
  const previous = process.env.GITHUB_TOKEN
  process.env.GITHUB_TOKEN = 'ghp_test_token_must_not_be_used'
  try {
    const payload = {
      fullName: 'owner/repo',
      repo: { fullName: 'owner/repo', owner: 'owner', name: 'repo', url: 'https://github.com/owner/repo' },
    }
    const result = await call(byPath.get(`${BASE}/star`), jsonReq(payload))
    assert.equal(result.status, 200)
    const body = JSON.parse(result.body)
    assert.equal(body.starred, true)
    // Local-only collection: no network call happened on behalf of the env token.
    assert.equal(body.account?.login ?? null, null)
    assert.equal(body.account?.configured ?? false, false)
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = previous
    dispose()
  }
})