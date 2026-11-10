/**
 * GitHub Trending scraper.
 *
 * GitHub has no public API for the Trending board, so this module parses
 * https://github.com/trending. Every field is optional and degrades to a null /
 * empty value instead of throwing, so a markup tweak on GitHub's side cannot
 * take the whole panel down.
 */

const PERIODS = ['daily', 'weekly', 'monthly']

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
}

export function normalizeSince(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'weekly' || raw === 'week' || raw === 'w') return 'weekly'
  if (raw === 'monthly' || raw === 'month' || raw === 'm') return 'monthly'
  return 'daily'
}

export function isPeriod(value) {
  return PERIODS.includes(value)
}

export function trendingUrl(since) {
  return `https://github.com/trending?since=${normalizeSince(since)}`
}

export function decodeEntities(input) {
  return String(input ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    const named = ENTITIES[body.toLowerCase()]
    return named === undefined ? match : named
  })
}

export function stripTags(input) {
  return String(input ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
}

export function cleanText(input) {
  return decodeEntities(stripTags(input)).replace(/\s+/g, ' ').trim()
}

/** Parses "1,930", "12.4k", "1.2M" and plain numbers. */
export function parseCount(input) {
  if (!input) return 0
  const raw = String(input).replace(/[, _]/g, '').trim()
  const match = /^([0-9]*\.?[0-9]+)([kKmM]?)$/.exec(raw)
  if (!match) return 0
  const base = Number.parseFloat(match[1])
  if (!Number.isFinite(base)) return 0
  const suffix = match[2].toLowerCase()
  if (suffix === 'k') return Math.round(base * 1000)
  if (suffix === 'm') return Math.round(base * 1000000)
  return Math.round(base)
}

const ARTICLE_RE = /<article\b[^>]*class="[^"]*\bBox-row\b[^"]*"[^>]*>/g
const REPO_LINK_RE = /href="\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)"/g
const BAD_OWNERS = new Set(['login', 'signup', 'topics', 'orgs', 'sponsors', 'settings', 'explore', 'collections', 'trending', 'marketplace', 'features', 'pricing'])

function repoLinkOf(chunk) {
  const heading = chunk.search(/<h2\b/i)
  const scope = heading >= 0 ? chunk.slice(heading) : chunk
  REPO_LINK_RE.lastIndex = 0
  let match = REPO_LINK_RE.exec(scope)
  while (match) {
    const owner = match[1]
    const name = match[2]
    if (!BAD_OWNERS.has(owner.toLowerCase()) && name !== 'stargazers' && name !== 'forks' && name !== 'issues') {
      return { owner, name }
    }
    match = REPO_LINK_RE.exec(scope)
  }
  return null
}

function descriptionOf(chunk) {
  const headingEnd = chunk.search(/<\/h2>/i)
  const scope = headingEnd >= 0 ? chunk.slice(headingEnd + 5) : chunk
  const start = scope.search(/<p\b/i)
  if (start < 0) return ''
  const end = scope.indexOf('</p>', start)
  if (end < 0) return ''
  const text = cleanText(scope.slice(start, end))
  return text.length > 600 ? `${text.slice(0, 597)}…` : text
}

function languageOf(chunk) {
  const span = /<span[^>]*itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i.exec(chunk)
  const language = span ? cleanText(span[1]) : ''
  let languageColor = ''
  const color = /class="repo-language-color"[^>]*style="[^"]*background-color:\s*(#[0-9a-fA-F]{3,8})/i.exec(chunk)
  if (color) languageColor = color[1]
  return { language: language || null, languageColor: languageColor || null }
}

function countOf(chunk, suffix) {
  const re = new RegExp(`href="\\/[^"]*\\/${suffix}"[^>]*>([\\s\\S]*?)<\\/a>`, 'i')
  const match = re.exec(chunk)
  return match ? parseCount(cleanText(match[1])) : 0
}

function deltaOf(chunk) {
  const match = /([0-9][0-9,.]*)\s+stars?\s+(today|this week|this month)/i.exec(chunk)
  if (!match) return 0
  return parseCount(match[1])
}

/** Parse a Trending HTML document into normalized repository rows. */
export function parseTrendingHtml(html, since) {
  const period = normalizeSince(since)
  const source = String(html ?? '')
  const starts = []
  ARTICLE_RE.lastIndex = 0
  let match = ARTICLE_RE.exec(source)
  while (match) {
    starts.push(match.index + match[0].length)
    match = ARTICLE_RE.exec(source)
  }
  if (!starts.length) return []
  const items = []
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const end = index + 1 < starts.length ? starts[index + 1] : source.length
    const chunk = source.slice(start, end)
    const link = repoLinkOf(chunk)
    if (!link) continue
    const { owner, name } = link
    const { language, languageColor } = languageOf(chunk)
    items.push({
      rank: items.length + 1,
      owner,
      name,
      fullName: `${owner}/${name}`,
      url: `https://github.com/${owner}/${name}`,
      description: descriptionOf(chunk) || '—',
      language,
      languageColor,
      stars: countOf(chunk, 'stargazers'),
      forks: countOf(chunk, 'forks'),
      delta: deltaOf(chunk),
      since: period,
    })
  }
  return items
}

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

/**
 * Fetch + parse one Trending board. `fallbackFetch` is an optional
 * (url) => Promise<string> transport supplied by the Host (the Harness web
 * service), tried when the direct fetch fails.
 */
export async function fetchTrending(since, options = {}) {
  const period = normalizeSince(since)
  const url = trendingUrl(period)
  const errors = []
  const { signal, dispose } = linkedSignal(options.timeoutMs ?? 20000, options.signal)
  try {
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 (compatible; dsh-github-trending-masonry)',
          'accept-language': 'en-US,en;q=0.8',
        },
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const items = parseTrendingHtml(text, period)
      if (!items.length) throw new Error('no repository rows in the HTML')
      return { items, via: 'direct' }
    } catch (error) {
      errors.push(`direct: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (typeof options.fallbackFetch === 'function') {
      try {
        const text = await options.fallbackFetch(url, signal)
        const items = parseTrendingHtml(text, period)
        if (!items.length) throw new Error('no repository rows in the HTML')
        return { items, via: 'harness-web' }
      } catch (error) {
        errors.push(`harness-web: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`could not load ${url} (${errors.join('; ')})`)
  } finally {
    dispose()
  }
}
