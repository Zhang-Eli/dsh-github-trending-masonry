/**
 * Deterministic repository analysis.
 *
 * The panel needs a category (for the chips) and a short tech-stack row. Both
 * are derived from the Trending row itself — name, description, language — so
 * the feed works without a GitHub API token, instantly and identically on every
 * run.
 */

export const CATEGORY_OTHER = { key: 'other', zh: '其他', en: 'Other' }

export const CATEGORY_RULES = [
  {
    key: 'ai',
    zh: 'AI / 大模型',
    en: 'AI / LLM',
    keywords: [
      'ai', 'llm', 'agent', 'agents', 'gpt', 'openai', 'claude', 'gemini', 'llama', 'ollama', 'rag',
      'embedding', 'transformer', 'diffusion', 'inference', 'fine-tun', 'prompt', 'mcp', 'copilot',
      'chatbot', 'nlp', 'vision', 'multimodal', 'speech', 'whisper', 'reasoning', 'neural',
      'deep learning', 'pytorch', 'tensorflow', 'vector database', 'model',
    ],
  },
  {
    key: 'devtool',
    zh: '开发者工具',
    en: 'Developer tools',
    keywords: [
      'cli', 'terminal', 'shell prompt', 'compiler', 'linter', 'formatter', 'debugger', 'sdk',
      'build system', 'bundler', 'toolchain', 'vscode', 'neovim', 'vim', 'tmux', 'git', 'monorepo',
      'test runner', 'testing', 'documentation', 'static site', 'generator', 'scaffold', 'devtools',
      'developer tools', 'ide', 'editor', 'package manager', 'runtime', 'interpreter', 'parser',
      'codegen', 'skills', 'methodology', 'workflow',
    ],
  },
  {
    key: 'web',
    zh: 'Web / 前端',
    en: 'Web / frontend',
    keywords: [
      'react', 'vue', 'svelte', 'angular', 'next.js', 'nextjs', 'nuxt', 'remix', 'astro', 'solid',
      'tailwind', 'css', 'html', 'dom', 'frontend', 'ui component', 'component library',
      'design system', 'three.js', 'webgl', 'webgpu', 'animation', 'browser', 'pwa', 'electron',
      'tauri', 'web app',
    ],
  },
  {
    key: 'infra',
    zh: '基础设施 / 云原生',
    en: 'Infra / cloud native',
    keywords: [
      'kubernetes', 'k8s', 'docker', 'container', 'serverless', 'terraform', 'operator', 'proxy',
      'gateway', 'nginx', 'service mesh', 'observability', 'monitoring', 'prometheus', 'grafana',
      'wasm', 'webassembly', 'distributed', 'orchestration', 'cloud', 'devops', 'ci/cd',
      'deployment', 'load balancer', 'networking', 'storage engine', 'filesystem', 'virtual machine',
    ],
  },
  {
    key: 'data',
    zh: '数据 / 数据库',
    en: 'Data / database',
    keywords: [
      'database', 'sql', 'postgres', 'postgresql', 'mysql', 'sqlite', 'clickhouse', 'duckdb',
      'kafka', 'stream processing', 'etl', 'analytics', 'query engine', 'dataframe', 'pandas',
      'spark', 'parquet', 'olap', 'oltp', 'data pipeline', 'data warehouse', 'time series',
      'search engine', 'index',
    ],
  },
  {
    key: 'security',
    zh: '安全',
    en: 'Security',
    keywords: [
      'security', 'vulnerability', 'pentest', 'penetration', 'exploit', 'cryptography', 'encryption',
      'auth', 'oauth', 'sandbox', 'malware', 'fuzzing', 'cve', 'zero trust', 'secrets', 'tls',
      'firewall', 'scanner',
    ],
  },
  {
    key: 'mobile',
    zh: '移动端',
    en: 'Mobile',
    keywords: ['android', 'ios', 'flutter', 'react native', 'swiftui', 'jetpack compose', 'kotlin multiplatform', 'mobile app'],
  },
  {
    key: 'blockchain',
    zh: '区块链 / Web3',
    en: 'Blockchain / Web3',
    keywords: ['blockchain', 'ethereum', 'solana', 'smart contract', 'defi', 'nft', 'web3', 'solidity', 'onchain', 'evm'],
  },
  {
    key: 'learning',
    zh: '学习资源',
    en: 'Learning resources',
    keywords: [
      'tutorial', 'course', 'book', 'awesome', 'interview', 'roadmap', 'handbook', 'guide',
      'cheatsheet', 'learning', 'notes', 'examples', 'curriculum', 'paper', 'papers', 'study',
    ],
  },
  {
    key: 'productivity',
    zh: '效率 / 自动化',
    en: 'Productivity',
    keywords: ['automation', 'productivity', 'note', 'notes app', 'task', 'todo', 'calendar', 'sync', 'scraper', 'crawler'],
  },
]

const CATEGORY_BY_KEY = new Map(CATEGORY_RULES.map((rule) => [rule.key, rule]))

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function occurrences(haystack, keyword) {
  if (!keyword) return 0
  if (keyword.length <= 3) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}($|[^a-z0-9])`, 'g')
    return (haystack.match(pattern) || []).length
  }
  let count = 0
  let index = haystack.indexOf(keyword)
  while (index >= 0) {
    count += 1
    index = haystack.indexOf(keyword, index + keyword.length)
  }
  return count
}

export function classify(repo) {
  const haystack = `${repo.name ?? ''} ${repo.description ?? ''}`.toLowerCase()
  let best = null
  let bestScore = 0
  for (const rule of CATEGORY_RULES) {
    let score = 0
    for (const keyword of rule.keywords) score += occurrences(haystack, keyword)
    if (score > bestScore) {
      best = rule
      bestScore = score
    }
  }
  if (!best) return { ...CATEGORY_OTHER }
  return { key: best.key, zh: best.zh, en: best.en }
}

export function categoryLabel(key) {
  const rule = CATEGORY_BY_KEY.get(key)
  return rule ? { key: rule.key, zh: rule.zh, en: rule.en } : { ...CATEGORY_OTHER }
}

const TECH_RULES = [
  [/\breact\b/i, 'React'],
  [/\bnext\.?js\b/i, 'Next.js'],
  [/\bvue\b/i, 'Vue'],
  [/\bsvelte\b/i, 'Svelte'],
  [/\bangular\b/i, 'Angular'],
  [/\bastro\b/i, 'Astro'],
  [/\bnode(\.?js)?\b/i, 'Node.js'],
  [/\bdeno\b/i, 'Deno'],
  [/\bbun\b/i, 'Bun'],
  [/\btypescript\b/i, 'TypeScript'],
  [/\brust\b/i, 'Rust'],
  [/\bgolang\b/i, 'Go'],
  [/\bpython\b/i, 'Python'],
  [/\bdjango\b/i, 'Django'],
  [/\bflask\b/i, 'Flask'],
  [/\bfastapi\b/i, 'FastAPI'],
  [/\bllm\b/i, 'LLM'],
  [/\bmcp\b/i, 'MCP'],
  [/\brag\b/i, 'RAG'],
  [/\bagent\b/i, 'Agent'],
  [/\bopenai\b/i, 'OpenAI'],
  [/\bclaude\b/i, 'Claude'],
  [/\bchatgpt\b/i, 'ChatGPT'],
  [/\bcopilot\b/i, 'Copilot'],
  [/\bdeepseek\b/i, 'DeepSeek'],
  [/\bgemini\b/i, 'Gemini'],
  [/\bollama\b/i, 'Ollama'],
  [/\bllama\b/i, 'Llama'],
  [/\bhuggingface\b/i, 'Hugging Face'],
  [/\blangchain\b/i, 'LangChain'],
  [/\bvllm\b/i, 'vLLM'],
  [/\bpytorch\b/i, 'PyTorch'],
  [/\btensorflow\b/i, 'TensorFlow'],
  [/\bdocker\b/i, 'Docker'],
  [/\bkubernetes\b|\bk8s\b/i, 'Kubernetes'],
  [/\bwasm\b|\bwebassembly\b/i, 'WASM'],
  [/\btauri\b/i, 'Tauri'],
  [/\belectron\b/i, 'Electron'],
  [/\bflutter\b/i, 'Flutter'],
  [/\bswiftui\b/i, 'SwiftUI'],
  [/\bpostgres(?:ql)?\b/i, 'PostgreSQL'],
  [/\bsqlite\b/i, 'SQLite'],
  [/\bredis\b/i, 'Redis'],
  [/\bsolidity\b/i, 'Solidity'],
  [/\bcli\b/i, 'CLI'],
  [/\btui\b/i, 'TUI'],
  [/\bgpu\b/i, 'GPU'],
  [/\bgraphql\b/i, 'GraphQL'],
  [/\bgrpc\b/i, 'gRPC'],
  [/\bweb3\b/i, 'Web3'],
  [/\bhome assistant\b/i, 'Home Assistant'],
  [/\bcomfyui\b/i, 'ComfyUI'],
  [/\bstable diffusion\b/i, 'Stable Diffusion'],
]

/**
 * Build a short technology-stack list: the parsed language first, then up to
 * four technologies mentioned in the name/description.
 */
export function inferStack(repo) {
  const language = typeof repo.language === 'string' ? repo.language.trim() : ''
  const haystack = `${repo.name ?? ''} ${repo.description ?? ''}`
  const stack = []
  const seen = new Set()
  const push = (value) => {
    const key = value.toLowerCase()
    if (!value || seen.has(key) || stack.length >= 5) return
    seen.add(key)
    stack.push(value)
  }
  push(language)
  for (const [pattern, label] of TECH_RULES) {
    if (stack.length >= 5) break
    if (pattern.test(haystack)) push(label)
  }
  return stack
}

/** Attach the derived category and stack to one scraped row. */
export function analyzeRepo(repo) {
  const category = classify(repo)
  return {
    ...repo,
    category: category.key,
    categoryZh: category.zh,
    categoryEn: category.en,
    stack: inferStack(repo),
  }
}

export function analyzeRepos(repos) {
  return (Array.isArray(repos) ? repos : []).map(analyzeRepo)
}
