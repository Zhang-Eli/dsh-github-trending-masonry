/**
 * dsh-github-trending-masonry — Host half.
 *
 * Serves the Web panel:
 *   GET    /dsh-github-trending-masonry/feed?since=daily|weekly|monthly[&refresh=1]
 *   GET    /dsh-github-trending-masonry/state
 *   POST   /dsh-github-trending-masonry/star
 *   POST   /dsh-github-trending-masonry/account
 *   DELETE /dsh-github-trending-masonry/account
 *
 * It also owns the durable trend cache (memory + disk), the local starred list,
 * and the optional GitHub account used for one-click starring.
 */

import os from 'node:os'
import path from 'node:path'

import { analyzeRepos } from './lib/analyze.js'
import { FeedCache } from './lib/cache.js'
import { ReadmeEnricher } from './lib/enrich.js'
import { setStar, verifyToken } from './lib/github.js'
import { PluginStore } from './lib/store.js'
import { createSummarizer } from './lib/summarize.js'
import { fetchTrending, normalizeSince } from './lib/trending.js'
import { createTranslator, normalizeLang } from './lib/translate.js'

const BASE = '/dsh-github-trending-masonry'
const CREDENTIAL_KEY = 'dsh-github-trending-masonry/github-token'
const DEFAULT_TTL_MINUTES = 30
const MAX_BODY_BYTES = 256 * 1024
const FULL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

export const inject = ['webServer']

function log(ctx, message) {
  try {
    ctx.logger?.info?.(`[github-trending-masonry] ${message}`)
  } catch {
    /* logging must never break the feature */
  }
}

function safeGet(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function resolveDataDir(config) {
  const configured = typeof config?.dataDir === 'string' ? config.dataDir.trim() : ''
  if (configured) return path.resolve(configured)
  const profileDir = String(process.env.DSH_PROFILE_DIR ?? '').trim()
  if (profileDir) return path.join(profileDir, 'plugin-data', 'github-trending-masonry')
  const profile = String(process.env.DSH_PROFILE ?? '').trim()
  if (profile) return path.join(os.homedir(), '.dsh', 'profiles', profile, 'plugin-data', 'github-trending-masonry')
  return path.join(os.homedir(), '.dsh', 'plugin-data', 'github-trending-masonry')
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function sendError(res, status, message, code) {
  sendJson(res, status, { error: message, code: code ?? 'error' })
}

/**
 * Same-origin / loopback fence for every HTTP route. The connection service is
 * authoritative when present (`connection.requestRejection`); otherwise fall
 * back to the checks the harness itself applies to local routes, so a page on
 * another origin can never reach these handlers. Returns undefined when the
 * request may proceed, or the HTTP status of the refusal.
 */
function refusalOf(ctx, req) {
  const connection = safeGet(ctx, 'connection')
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejected = connection.requestRejection(req)
      if (rejected !== undefined) return rejected
    } catch {
      /* fall through to the local checks below */
    }
  }
  if (!isLoopbackPeer(req.socket?.remoteAddress)) return 403
  const host = req.headers.host
  if (host !== undefined) {
    if (!URL.canParse(`http://${host}`)) return 403
    const name = new URL(`http://${host}`).hostname
    if (name !== 'localhost' && name !== '[::1]' && !/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)) return 403
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 403
  const origin = req.headers.origin
  if (origin === undefined) return undefined
  if (!URL.canParse(origin)) return 403
  return new URL(origin).host === host ? undefined : 403
}

function isLoopbackPeer(address) {
  if (address === undefined) return false
  const plain = String(address).startsWith('::ffff:') ? String(address).slice('::ffff:'.length) : String(address)
  return plain === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(plain)
}

function isJsonRequest(req) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  return type === 'application/json'
}

function methodNotAllowed(res, allow) {
  res.setHeader('allow', allow)
  sendError(res, 405, `method not allowed; expected ${allow}`, 'method')
}

function queryOf(req) {
  try {
    const url = new URL(String(req.url ?? '/'), 'http://localhost')
    const out = {}
    url.searchParams.forEach((value, key) => {
      out[key] = value
    })
    return out
  } catch {
    return {}
  }
}

function readJsonBody(req) {
  // Local handlers embed a user PAT, so only well-formed JSON requests are
  // accepted: a cross-site HTML form or text/plain fetch cannot be mistaken
  // for an authenticated action.
  if (!isJsonRequest(req)) {
    const error = new Error('content-type must be application/json')
    error.status = 415
    return Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        const error = new Error('request body too large')
        error.status = 413
        fail(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const error = new Error('invalid JSON body')
          error.status = 400
          reject(error)
          return
        }
        resolve(parsed)
      } catch {
        const error = new Error('invalid JSON body')
        error.status = 400
        reject(error)
      }
    })
    req.on('error', (error) => fail(error))
  })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export function apply(ctx, config = {}) {
  const ttlMinutes = clampInt(config.ttlMinutes, DEFAULT_TTL_MINUTES, 5, 1440)
  const dataDir = resolveDataDir(config)
  const cache = new FeedCache(dataDir, ttlMinutes * 60 * 1000)
  const enricher = new ReadmeEnricher(dataDir)
  const translate = createTranslator(ctx, fallbackFetcher)
  const summarizer = createSummarizer(ctx, {
    enabled: config.summaries !== false,
    provider: config.summaryProvider,
    model: config.summaryModel,
    timeoutMs: clampInt(config.summaryTimeoutMs, 60000, 15000, 180000),
    concurrency: clampInt(config.summaryConcurrency, 6, 1, 8),
  })
  const store = new PluginStore(dataDir)
  const fixedToken = typeof config.token === 'string' && config.token.trim() ? config.token.trim() : null

  const effect = (setup) => {
    if (typeof ctx.effect === 'function') {
      ctx.effect(setup)
      return
    }
    try {
      setup()
    } catch (error) {
      log(ctx, `registration failed: ${errorMessage(error)}`)
    }
  }

  function credentials() {
    return safeGet(ctx, 'credentials')
  }

  async function resolveToken(options = {}) {
    const allowEnv = options.env !== false
    const creds = credentials()
    if (creds && typeof creds.readRecord === 'function') {
      try {
        const record = await creds.readRecord(CREDENTIAL_KEY)
        if (record && record.kind === 'api-key' && typeof record.key === 'string' && record.key.trim()) return record.key.trim()
      } catch {
        /* fall through to the other token sources */
      }
    }
    const stored = await store.token()
    if (stored) return stored
    if (fixedToken) return fixedToken
    // Ambient environment tokens are for read-only enrichment (README fetch and
    // rate-limit relief). They must never authorize a mutating call: a local
    // page could otherwise star repos on behalf of a CI token.
    if (!allowEnv) return null
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null
  }

  async function saveToken(token) {
    const creds = credentials()
    if (creds && typeof creds.modifyRecord === 'function') {
      try {
        await creds.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: token }))
        await store.setToken(null)
        return
      } catch (error) {
        log(ctx, `credentials record write failed (${errorMessage(error)}); falling back to the plugin state file`)
      }
    }
    await store.setToken(token)
  }

  async function clearToken() {
    const creds = credentials()
    if (creds && typeof creds.deleteRecord === 'function') {
      try {
        await creds.deleteRecord(CREDENTIAL_KEY)
      } catch {
        /* ignore: the fallback file is cleared below */
      }
    }
    await store.setToken(null)
  }

  async function accountView() {
    const token = await resolveToken({ env: false })
    if (!token) return { configured: false, login: null, avatarUrl: null }
    let meta = await store.account()
    if (!meta) {
      try {
        const verified = await verifyToken(token)
        meta = await store.setAccount(verified)
      } catch (error) {
        return { configured: true, login: null, avatarUrl: null, error: errorMessage(error), code: error?.code ?? 'error' }
      }
    }
    if (!meta) return { configured: true, login: null, avatarUrl: null }
    return { configured: true, login: meta.login, avatarUrl: meta.avatarUrl, verifiedAt: meta.verifiedAt }
  }

  async function statePayload() {
    return { account: await accountView(), stars: await store.listStars() }
  }

  function fallbackFetcher() {
    const webService = safeGet(ctx, 'web')
    if (!webService || typeof webService.fetch !== 'function') return undefined
    return async (url, signal) => {
      const result = await webService.fetch({ url }, signal)
      const body = result && result.body
      return typeof body === 'string' ? body : String((body && body.content) ?? '')
    }
  }

  async function loadFeed(since, lang, forceRefresh) {
    const cacheKey = `${since}-${lang}`
    const cached = await cache.peek(cacheKey)
    const age = cache.ageMs(cached)
    if (!forceRefresh && cached && age <= cache.ttlMs) {
      return { items: cached.items, cacheState: 'hit', ageMs: age, generatedAt: new Date(cached.storedAt).toISOString() }
    }
    try {
      const fetched = await cache.refresh(cacheKey, async () => {
        const { items } = await fetchTrending(since, { fallbackFetch: fallbackFetcher() })
        const analyzed = analyzeRepos(items)
        try {
          await enricher.enrich(analyzed, {
            token: await resolveToken(),
            fallbackFetch: fallbackFetcher(),
            lang,
            translate,
            summarizer,
          })
        } catch (error) {
          log(ctx, `README enrichment skipped: ${errorMessage(error)}`)
        }
        return analyzed
      })
      return { items: fetched.items, cacheState: 'miss', ageMs: 0, generatedAt: new Date(fetched.storedAt).toISOString() }
    } catch (error) {
      if (cached) {
        return {
          items: cached.items,
          cacheState: 'hit',
          stale: true,
          ageMs: age,
          generatedAt: new Date(cached.storedAt).toISOString(),
          warning: `refresh failed, serving the cached board: ${errorMessage(error)}`,
        }
      }
      throw error
    }
  }

  async function handleFeed(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
    const query = queryOf(req)
    const since = normalizeSince(query.since)
    const lang = normalizeLang(query.lang)
    const forceRefresh = query.refresh === '1' || query.refresh === 'true'
    const result = await loadFeed(since, lang, forceRefresh)
    const payload = {
      since,
      lang,
      generatedAt: result.generatedAt,
      cache: { state: result.cacheState, ageMs: result.ageMs, ttlMs: cache.ttlMs },
      items: result.items,
    }
    if (result.warning) payload.warning = result.warning
    if (result.stale) payload.stale = true
    sendJson(res, 200, payload)
  }

  async function handleState(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
    sendJson(res, 200, await statePayload())
  }

  async function handleHealth(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
    sendJson(res, 200, {
      ok: true,
      version: '1.3.0',
      dataDir,
      ttlMinutes,
      summaries: summarizer.health(),
    })
  }

  function sanitizeRepoInput(repo) {
    if (!repo || typeof repo !== 'object') return null
    return {
      fullName: typeof repo.fullName === 'string' ? repo.fullName : undefined,
      owner: typeof repo.owner === 'string' ? repo.owner : undefined,
      name: typeof repo.name === 'string' ? repo.name : undefined,
      url: typeof repo.url === 'string' ? repo.url : undefined,
      description: typeof repo.description === 'string' ? repo.description : undefined,
      language: typeof repo.language === 'string' ? repo.language : undefined,
      languageColor: typeof repo.languageColor === 'string' ? repo.languageColor : undefined,
      stack: Array.isArray(repo.stack) ? repo.stack.filter((entry) => typeof entry === 'string').slice(0, 8) : undefined,
      intro: typeof repo.intro === 'string' ? repo.intro.slice(0, 1400) : undefined,
      features: Array.isArray(repo.features) ? repo.features.filter((entry) => typeof entry === 'string').slice(0, 4) : undefined,
      image: typeof repo.image === 'string' && /^https?:\/\//i.test(repo.image.trim()) ? repo.image.trim().slice(0, 600) : undefined,
      category: typeof repo.category === 'string' ? repo.category : undefined,
      categoryZh: typeof repo.categoryZh === 'string' ? repo.categoryZh : undefined,
      categoryEn: typeof repo.categoryEn === 'string' ? repo.categoryEn : undefined,
    }
  }

  async function handleStar(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendError(res, error?.status ?? 400, errorMessage(error), 'bad_request')
      return
    }
    const fullName = String(body.fullName ?? '').trim()
    if (!FULL_NAME_RE.test(fullName)) {
      sendError(res, 400, 'invalid repository full name', 'invalid_repo')
      return
    }
    const action = body.action === 'unstar' ? 'unstar' : 'star'
    const repoInput = sanitizeRepoInput(body.repo)
    const existing = await store.starEntry(fullName)
    // Mutations never fall back to an ambient token: only a token the user
    // explicitly connected (or configured) may star on their behalf.
    const token = await resolveToken({ env: false })

    if (action === 'unstar' && existing && existing.mode === 'local') {
      await store.unstar(fullName)
      sendJson(res, 200, { ok: true, starred: false, ...(await statePayload()) })
      return
    }

    if (token) {
      try {
        await setStar(token, fullName, action === 'star')
      } catch (error) {
        sendError(res, 502, errorMessage(error), error?.code ?? 'github_error')
        return
      }
      if (action === 'star') {
        const source = repoInput || existing || {}
        await store.star({ ...source, fullName, mode: 'github' })
      } else {
        await store.unstar(fullName)
      }
    } else if (action === 'star') {
      if (!repoInput) {
        sendError(res, 400, 'repo metadata is required while no GitHub account is connected', 'missing_repo')
        return
      }
      await store.star({ ...repoInput, fullName, mode: 'local' })
    } else {
      await store.unstar(fullName)
    }

    sendJson(res, 200, { ok: true, starred: action === 'star', ...(await statePayload()) })
  }

  async function handleConnect(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendError(res, error?.status ?? 400, errorMessage(error), 'bad_request')
      return
    }
    const token = String(body.token ?? '').trim()
    if (!token) {
      sendError(res, 400, 'a GitHub personal access token is required', 'missing_token')
      return
    }
    let verified
    try {
      verified = await verifyToken(token)
    } catch (error) {
      sendError(res, error?.code === 'invalid_token' ? 400 : 502, errorMessage(error), error?.code ?? 'github_error')
      return
    }
    await saveToken(token)
    await store.setAccount(verified)
    log(ctx, `GitHub account connected: ${verified.login}`)
    sendJson(res, 200, { ok: true, ...(await statePayload()) })
  }

  async function handleDisconnect(req, res) {
    if (req.method !== 'DELETE') return methodNotAllowed(res, 'DELETE')
    await clearToken()
    await store.setAccount(null)
    log(ctx, 'GitHub account disconnected; the local collection is kept')
    sendJson(res, 200, { ok: true, ...(await statePayload()) })
  }

  function route(pathname, handler) {
    return { kind: 'exact', path: pathname, handler }
  }

  // Every route is unauthenticated at the transport level (webServer has no
  // admission control of its own), so each handler independently refuses
  // cross-site and non-loopback requests before touching state or credentials.
  function guard(req, res) {
    const rejected = refusalOf(ctx, req)
    if (rejected === undefined) return true
    sendError(res, rejected, 'request origin is not allowed', 'forbidden')
    return false
  }

  const web = safeGet(ctx, 'webServer')
  if (!web || typeof web.register !== 'function') {
    log(ctx, 'webServer service unavailable — the panel routes were not registered')
    return
  }

  const routes = [
    route(`${BASE}/feed`, handleFeed),
    route(`${BASE}/state`, handleState),
    route(`${BASE}/health`, handleHealth),
    route(`${BASE}/star`, handleStar),
    route(`${BASE}/account`, (req, res) => (req.method === 'DELETE' ? handleDisconnect(req, res) : handleConnect(req, res))),
  ]

  // Keep a single guarded wrapper in front of every registered route, so a new
  // route cannot accidentally ship without the fence.
  for (const definition of routes) {
    const handler = definition.handler
    effect(() =>
      web.register({
        ...definition,
        handler: (req, res) => {
          if (guard(req, res)) handler(req, res)
        },
      }),
    )
  }

  log(ctx, `ready (data=${dataDir}, ttl=${ttlMinutes}m, token=${fixedToken ? 'config' : 'auto'})`)
}
