/**
 * README acquisition + plain-text extraction.
 *
 * The Trending board only carries a one-line description, which is too thin for
 * the card intro. This module fetches the repository README (raw first, GitHub
 * API fallback for the rare repository whose README lives elsewhere) and turns
 * it into two clean values the panel can render directly:
 *
 *   intro    — 1-2 plain-text paragraphs (about 2-4 sentences)
 *   features — up to 4 short bullets describing what the project implements
 *
 * The extraction is heuristic and tolerant: a badge-only or unusual README
 * degrades to `intro: null, features: []` instead of throwing.
 */

import { decodeEntities } from './trending.js'

const RAW_BASE = 'https://raw.githubusercontent.com'
const API_BASE = 'https://api.github.com'
const MAX_INTRO_CHARS = 700
const MAX_FEATURE_CHARS = 120
const MAX_FEATURES = 4

const FEATURE_SECTION_RE = /feature|功能|特性|亮点|what (it|this) does|capabilit|highlight|核心|主要/i

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

async function request(url, options = {}) {
  const linked = linkedSignal(options.timeoutMs ?? 10000, options.signal)
  try {
    const response = await fetch(url, {
      signal: linked.signal,
      headers: {
        accept: options.accept ?? 'text/plain',
        'user-agent': 'dsh-github-trending-masonry/1.0',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
    })
    const text = await response.text()
    return { status: response.status, text }
  } finally {
    linked.dispose()
  }
}

/**
 * Fetch one repository README as text, or null when none can be found.
 * `fallbackFetch` is the optional Host web-service transport.
 */
export async function fetchReadme(fullName, options = {}) {
  if (!fullName || !fullName.includes('/')) return null
  const direct = async (url, requestOptions) => {
    try {
      return await request(url, { ...requestOptions, signal: options.signal, token: options.token })
    } catch {
      return null
    }
  }

  // 1. raw.githubusercontent with the default-branch alias — the common case.
  const rawUrl = `${RAW_BASE}/${fullName}/HEAD/README.md`
  const raw = await direct(rawUrl, {})
  if (raw && raw.status === 200 && looksLikeText(raw.text)) return raw.text

  // 2. Optional web-service transport (some networks block raw.githubusercontent).
  if (typeof options.fallbackFetch === 'function') {
    try {
      const text = await options.fallbackFetch(rawUrl, options.signal)
      if (looksLikeText(text)) return text
    } catch {
      /* try the API route below */
    }
  }

  // 3. GitHub API /readme — resolves READMEs outside the repository root.
  try {
    const api = await request(`${API_BASE}/repos/${fullName}/readme`, {
      accept: 'application/vnd.github.raw',
      signal: options.signal,
      token: options.token,
    })
    if (api.status === 200 && api.text && !looksLikeJson(api.text) && looksLikeText(api.text)) return api.text
    if (api.status === 200 && looksLikeJson(api.text)) {
      const parsed = JSON.parse(api.text)
      if (parsed && typeof parsed.content === 'string') {
        const decoded = Buffer.from(parsed.content, parsed.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
        if (looksLikeText(decoded)) return decoded
      }
    }
  } catch {
    /* ignore */
  }

  // 4. Lower-case / reStructuredText variants.
  for (const name of ['readme.md', 'README.rst', 'readme.rst']) {
    const candidate = await direct(`${RAW_BASE}/${fullName}/HEAD/${name}`, {})
    if (candidate && candidate.status === 200 && looksLikeText(candidate.text)) return candidate.text
  }

  return null
}

function looksLikeJson(text) {
  return typeof text === 'string' && text.trimStart().startsWith('{')
}

function looksLikeText(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed.length < 40) return false
  if (trimmed.startsWith('404:')) return false
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return false
  return true
}

/** Strip markdown/HTML noise from one inline run of text. */
function cleanInline(input) {
  let text = String(input ?? '')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  text = text.replace(/<[^>]*>/g, ' ')
  text = decodeEntities(text)
  text = text.replace(/[`*_~]/g, '')
  text = text.replace(/\s+/g, ' ')
  return text.trim()
}

function shorten(text, maxLength) {
  if (text.length <= maxLength) return text
  const cut = text.slice(0, maxLength)
  const sentenceEnd = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf('。'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('\n'),
  )
  if (sentenceEnd >= maxLength * 0.55) return cut.slice(0, sentenceEnd + 1).trim()
  return cut.trimEnd() + '…'
}

function looksLikeCommand(text) {
  return /^\s*(?:\$|npm |pnpm |yarn |pip3? |uv |brew |git clone|curl |wget |docker |npx |cargo |go install|apt |sudo )/i.test(text)
}

/** Sponsorship blurbs, nav/TOC lines, CTAs and "Settings → …" steps are not the pitch. */
function looksLikeNoise(text) {
  if (/(sponsor|赞助|推广|广告|affiliate|优惠|邀请码|注册链接|promo code|discount)/i.test(text)) return true
  if (/(点个\s*star|star\s*⭐|顺便点个|支持一下|点个赞|右上角|fork 按钮|fork 项目|给个 star|star us|star this repo)/i.test(text)) return true
  if (/^(?:settings|配置|设置|打开|进入)\s*[→>]/.test(text)) return true
  if ((text.match(/ · /g) || []).length >= 2) return true
  return false
}

/** Install/run steps, setup notes and file-path bullets are not what the project implements. */
function looksLikeStepOrPath(text) {
  if (/^(?:navigate|install|set up|setup|paste|copy|run |open |download|click|choose|select|browse|pick|launch|configure|update|enable|disable|add |create a|go to|configuration|配置|安装|打开|复制|运行|进入|下载|点击|选择|启动|创建)\b/i.test(text)) return true
  if (/(api key|apikey|环境变量|environment variable|配置指南|安装步骤|config guide)/i.test(text)) return true
  if (/^\.{0,2}\//.test(text)) return true
  if (/^[\w./-]+\/[\w./-]+:\s/.test(text)) return true
  if (/^[\w-]+\s+-\s+[A-Z]/.test(text)) return true
  if (text.includes(' → ')) return true
  if (/(discord|newsletter|follow us|join our|community|support documentation|twitter|telegram)/i.test(text)) return true
  return false
}

function isGoodIntro(text) {
  const hasCjk = /[\u4e00-\u9fff]/.test(text)
  return text.length >= 80 || (hasCjk && text.length >= 40)
}

/**
 * Turn one raw README into `{ intro, features }`.
 * Exported for tests; never throws.
 */
export function extractReadme(raw) {
  const result = { intro: null, features: [] }
  if (typeof raw !== 'string' || !raw.trim()) return result

  let source = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  source = source.replace(/<!--[\s\S]*?-->/g, ' ')
  source = source.replace(/```[\s\S]*?```/g, '\n')
  source = source.replace(/~~~[\s\S]*?~~~/g, '\n')
  source = source.replace(/<img\b[^>]*>/gi, ' ')
  source = source.replace(/<(?:p|div|li|br|h[1-6])\b[^>]*>/gi, '\n')
  source = source.replace(/<[^>]*>/g, ' ')
  source = decodeEntities(source)

  const paragraphs = []
  const bullets = []
  let section = ''
  let buffer = []

  const flush = () => {
    if (!buffer.length) return
    const text = cleanInline(buffer.join(' '))
    buffer = []
    if (text.length < 20) return
    if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return
    if (looksLikeNoise(text)) return
    paragraphs.push({ text, section })
  }

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line)
    if (heading) {
      flush()
      section = cleanInline(heading[1])
      continue
    }
    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
      flush()
      continue
    }
    if (/^\s*\|/.test(line)) {
      flush()
      continue
    }
    // Markdown reference definitions (`[label]: https://…`) are metadata, not prose.
    if (/^\s*\[[^\]]+\]:\s*\S+/.test(line)) {
      flush()
      continue
    }
    const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line)
    if (listItem) {
      flush()
      const body = listItem[1].trim()
      // Table-of-contents links, install commands and step lists are not feature bullets.
      if (body.includes('](#') || looksLikeCommand(body)) continue
      const text = cleanInline(body)
      if (looksLikeStepOrPath(text)) continue
      if (text.length >= 8 && text.length <= 240) {
        bullets.push({ text: shorten(text, MAX_FEATURE_CHARS), section })
      }
      continue
    }
    // Blockquote blocks are usually GitHub alerts / notes, not the pitch.
    if (/^\s*>/.test(line)) {
      flush()
      continue
    }
    buffer.push(line)
  }
  flush()

  // Intro: prefer the first real paragraph, add the second when it still fits.
  const candidates = paragraphs.filter((entry) => isGoodIntro(entry.text) && !looksLikeStepOrPath(entry.text))
  const chosen = candidates.length ? candidates : paragraphs.filter((entry) => !looksLikeStepOrPath(entry.text))
  if (chosen.length) {
    let intro = chosen[0].text
    if (chosen[1] && chosen[1].text.length >= 80 && intro.length + chosen[1].text.length + 2 <= MAX_INTRO_CHARS) {
      intro = `${intro}\n\n${chosen[1].text}`
    }
    result.intro = shorten(intro, MAX_INTRO_CHARS)
  }

  // Features: bullets under a feature-ish heading first, otherwise the first
  // meaningful sentence-like bullets in document order.
  const preferred = bullets.filter((entry) => FEATURE_SECTION_RE.test(entry.section))
  const fallback = bullets.filter((entry) => entry.text.length >= 30)
  const pool = preferred.length ? preferred : fallback
  const seen = new Set()
  for (const bullet of pool) {
    const key = bullet.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.features.push(bullet.text)
    if (result.features.length >= MAX_FEATURES) break
  }

  return result
}
