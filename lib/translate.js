/**
 * Small translation layer for card intros.
 *
 * Prefers the Harness `translator` service (anonymous google/bing routes, no
 * session or API key needed); falls back to the public Google translate endpoint
 * when the service has no provider mounted. Failure is non-fatal: an untranslated
 * intro is still perfectly readable, so callers keep the original text.
 */

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
const CLIENTS5_ENDPOINT = 'https://clients5.google.com/translate_a/t'
const MAX_SEGMENT_CHARS = 1500
let gtxLastRequestAt = 0
const TARGET_LANGUAGES = {
  zh: 'zh-CN',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  pt: 'pt',
  it: 'it',
  ar: 'ar',
}

// Proper nouns and acronyms that machine translation mangles ("LLM" became
// "法学硕士" in one pass). They are swapped for markers, translated, then restored.
const GLOSSARY = [
  'LLM', 'LLMs', 'MCP', 'RAG', 'AI', 'AGI', 'API', 'APIs', 'SDK', 'CLI', 'TUI', 'GPU', 'CPU', 'WASM',
  'TTS', 'STT', 'OCR', 'UI', 'UX', 'MLOps', 'DevOps', 'Docker', 'Kubernetes', 'PostgreSQL', 'SQLite',
  'Redis', 'Kafka', 'Rust', 'Python', 'TypeScript', 'JavaScript', 'React', 'Vue', 'Next.js', 'Node.js',
  'WebAssembly', 'GitHub', 'Git', 'GPT', 'Claude', 'Gemini', 'Llama', 'OpenAI', 'Anthropic', 'DeepSeek',
  'Linux', 'macOS', 'Windows', 'VS Code', 'GraphQL', 'gRPC', 'Web3', 'Solidity',
]
const TERM_RE = new RegExp(
  `(?<![A-Za-z0-9])(${GLOSSARY.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9])`,
  'g',
)
const MARKER_RE = /⟦(\d+)_[^⟧]*⟧/g

function protectTerms(text) {
  const terms = []
  const protectedText = String(text ?? '').replace(TERM_RE, (match) => {
    const index = terms.push(match) - 1
    return `⟦${index}_${match}⟧`
  })
  return { text: protectedText, terms }
}

function restoreTerms(text, terms) {
  if (!terms.length) return text
  return String(text ?? '').replace(MARKER_RE, (marker, index) => terms[Number(index)] ?? marker)
}

function safeGet(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
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

/** Base language code such as `zh`, `en`, `ja`. */
export function normalizeLang(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  const base = raw.split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(base) ? base : 'zh'
}

export function targetLanguageOf(lang) {
  return TARGET_LANGUAGES[normalizeLang(lang)] ?? normalizeLang(lang)
}

function scriptCounts(text) {
  let cjk = 0
  let latin = 0
  let kana = 0
  let hangul = 0
  for (const char of String(text ?? '')) {
    const code = char.codePointAt(0)
    if (code >= 0x3040 && code <= 0x30ff) kana += 1
    else if (code >= 0x3400 && code <= 0x9fff) cjk += 1
    else if (code >= 0xac00 && code <= 0xd7af) hangul += 1
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) latin += 1
  }
  return { cjk, latin, kana, hangul }
}

/** True when the text is probably not already in the target language. */
export function needsTranslation(text, lang) {
  const value = String(text ?? '').trim()
  if (value.length < 4) return false
  const { cjk, latin, kana, hangul } = scriptCounts(value)
  const total = cjk + latin + kana + hangul
  if (!total) return false
  const cjkRatio = (cjk + kana) / total
  const target = normalizeLang(lang)
  if (target === 'zh') {
    // Chinese target: translate anything without Chinese script, and also mixed
    // CJK+Latin intros so the Latin part is not left behind.
    if (kana > 0 || hangul > 0) return true
    return cjkRatio < 0.75
  }
  if (target === 'ja') return kana === 0
  if (target === 'ko') return hangul === 0
  return cjkRatio > 0.15
}

function chunkText(text, maxLength) {
  const source = String(text ?? '')
  if (source.length <= maxLength) return [source]
  const chunks = []
  let rest = source
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf('\n', maxLength)
    if (cut < maxLength * 0.5) cut = rest.lastIndexOf('. ', maxLength)
    if (cut < maxLength * 0.5) cut = rest.lastIndexOf('。', maxLength)
    if (cut < maxLength * 0.5) cut = maxLength
    chunks.push(rest.slice(0, cut + 1))
    rest = rest.slice(cut + 1)
  }
  if (rest) chunks.push(rest)
  return chunks
}

async function clients5TranslateChunk(text, targetLanguage, fallbackFetch) {
  const url =
    `${CLIENTS5_ENDPOINT}?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(targetLanguage)}&q=` +
    encodeURIComponent(text)
  let raw = null
  const linked = linkedSignal(12000)
  try {
    const response = await fetch(url, {
      signal: linked.signal,
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; dsh-github-trending-masonry)' },
    })
    if (response.ok) raw = await response.text()
  } catch {
    raw = null
  } finally {
    linked.dispose()
  }
  if (!raw && typeof fallbackFetch === 'function') {
    try {
      raw = await fallbackFetch(url)
    } catch {
      raw = null
    }
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return null
    const first = parsed[0]
    if (Array.isArray(first) && typeof first[0] === 'string') {
      // `[["translated text", "en"]]` — one translated block, newlines preserved.
      return first[0].trim() ? first[0] : null
    }
    const segments = parsed
      .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
      .filter(Boolean)
    const joined = segments.join('')
    return joined.trim() ? joined : null
  } catch {
    return null
  }
}

async function googleTranslateChunk(text, targetLanguage, fallbackFetch) {
  // Throttle the fallback endpoint: it answers 429 for back-to-back requests.
  const wait = 1200 - (Date.now() - gtxLastRequestAt)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  gtxLastRequestAt = Date.now()
  const url =
    `${GOOGLE_ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}&dt=t&q=` +
    encodeURIComponent(text)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw = null
    const linked = linkedSignal(12000)
    try {
      const response = await fetch(url, {
        signal: linked.signal,
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; dsh-github-trending-masonry)' },
      })
      if (response.ok) raw = await response.text()
    } catch {
      raw = null
    } finally {
      linked.dispose()
    }
    if (!raw && typeof fallbackFetch === 'function') {
      try {
        raw = await fallbackFetch(url)
      } catch {
        raw = null
      }
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
          const translated = parsed[0]
            .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
            .join('')
          if (translated.trim()) return translated
        }
      } catch {
        /* 429 HTML or malformed JSON: back off once */
      }
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1300))
      gtxLastRequestAt = Date.now()
    }
  }
  return null
}

async function googleTranslate(text, lang, fallbackFetch) {
  const targetLanguage = targetLanguageOf(lang)
  const chunks = chunkText(text, MAX_SEGMENT_CHARS)
  const out = []
  for (const chunk of chunks) {
    const translated =
      (await clients5TranslateChunk(chunk, targetLanguage, fallbackFetch)) ??
      (await googleTranslateChunk(chunk, targetLanguage, fallbackFetch))
    if (!translated) return null
    out.push(translated)
  }
  return out.join('')
}

/**
 * Build `translate(text, lang)` for the current plugin context.
 * Resolves to `null` for a text that needs no translation or when every route
 * failed, so callers can keep their original value.
 */
export function createTranslator(ctx, fallbackFetch) {
  const service = safeGet(ctx, 'translator')
  let serviceInit = null
  let serviceProvider = null

  async function initService() {
    if (serviceInit) return serviceInit
    serviceInit = (async () => {
      if (!service || typeof service.resolve !== 'function' || typeof service.translate !== 'function') return
      try {
        const providers = await service.availableProviders()
        if (!Array.isArray(providers) || !providers.length) return
        serviceProvider = providers.includes('google') ? 'google' : providers.includes('bing') ? 'bing' : null
      } catch {
        serviceProvider = null
      }
    })()
    return serviceInit
  }

  async function viaService(text, lang) {
    if (!service) return null
    await initService()
    if (!serviceProvider) return null
    try {
      const spec = service.resolve({ text, targetLanguage: targetLanguageOf(lang), provider: serviceProvider })
      const translated = await service.translate(spec)
      return typeof translated === 'string' && translated.trim() ? translated : null
    } catch {
      return null
    }
  }

  return async function translate(text, lang) {
    const value = String(text ?? '').trim()
    if (!value || !needsTranslation(value, lang)) return null
    const guarded = protectTerms(value)
    const viaHarness = await viaService(guarded.text, lang)
    if (viaHarness && viaHarness.trim()) return restoreTerms(viaHarness, guarded.terms)
    const fallback = await googleTranslate(guarded.text, lang, typeof fallbackFetch === 'function' ? fallbackFetch() : undefined)
    return fallback ? restoreTerms(fallback, guarded.terms) : null
  }
}
