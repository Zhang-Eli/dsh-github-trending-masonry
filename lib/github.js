/**
 * Minimal GitHub REST client for the two operations the panel needs: verifying
 * a Personal Access Token and starring / unstarring one repository.
 */

const API = 'https://api.github.com'
const DEFAULT_TIMEOUT_MS = 12000

function linkedSignal(timeoutMs, outer) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
  const relay = () => controller.abort()
  if (outer) {
    if (outer.aborted) controller.abort()
    else outer.addEventListener('abort', relay, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      if (outer) outer.removeEventListener('abort', relay)
    },
  }
}

function githubError(message, code, status) {
  const error = new Error(message)
  error.code = code
  if (status) error.status = status
  return error
}

function rateLimitMessage(status, headers) {
  const remaining = headers?.get?.('x-ratelimit-remaining')
  const reset = headers?.get?.('x-ratelimit-reset')
  const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : ''
  const suffix = [remaining === '0' ? 'rate limit exhausted' : '', when ? `resets at ${when}` : ''].filter(Boolean).join(', ')
  return `GitHub API rejected the request (HTTP ${status})${suffix ? ` — ${suffix}` : ''}`
}

async function request(url, options = {}) {
  const { token, method = 'GET', signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const linked = linkedSignal(timeoutMs, signal)
  try {
    let response
    try {
      response = await fetch(url, {
        method,
        signal: linked.signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'dsh-github-trending-masonry/1.0',
          'x-github-api-version': '2022-11-28',
        },
      })
    } catch (error) {
      if (linked.signal.aborted) throw githubError('GitHub request timed out or was cancelled', 'timeout')
      throw githubError(`could not reach api.github.com: ${error instanceof Error ? error.message : String(error)}`, 'network')
    }
    let json = null
    const text = await response.text()
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    return { status: response.status, json, text, headers: response.headers }
  } finally {
    linked.dispose()
  }
}

/** Validate a token and return the account identity. Throws with `code`. */
export async function verifyToken(token, signal) {
  const { status, json, headers } = await request(`${API}/user`, { token, signal })
  if (status === 200 && json && typeof json.login === 'string') {
    return {
      login: json.login,
      avatarUrl: typeof json.avatar_url === 'string' ? json.avatar_url : null,
      name: typeof json.name === 'string' ? json.name : null,
    }
  }
  if (status === 401) throw githubError('GitHub token is invalid, expired or revoked (HTTP 401)', 'invalid_token', status)
  if (status === 403) throw githubError(rateLimitMessage(status, headers), 'forbidden', status)
  throw githubError(`GitHub API answered with HTTP ${status}`, 'http_error', status)
}

/** Star (`star = true`) or unstar one repository on the connected account. */
export async function setStar(token, fullName, star, signal) {
  const [owner, repository] = String(fullName).split('/')
  const url = `${API}/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  const { status, headers } = await request(url, { token, method: star ? 'PUT' : 'DELETE', signal })
  if (status === 204 || status === 200) return true
  if (status === 401) throw githubError('GitHub token is invalid, expired or revoked (HTTP 401)', 'invalid_token', status)
  if (status === 403) throw githubError(rateLimitMessage(status, headers), 'forbidden', status)
  if (status === 404) throw githubError(`repository ${fullName} was not found for this token (HTTP 404)`, 'not_found', status)
  throw githubError(`GitHub API answered with HTTP ${status}`, 'http_error', status)
}
