// dsh-github-trending-masonry — Web (client) half.
/**
 * GitHub Trending in a flat masonry panel.
 *
 * Registers a sidebar entry plus its main keyed panel. The panel fetches the
 * host half's /feed endpoint (daily/weekly/monthly), renders every repository
 * as a minimal card in a multi-column waterfall, keeps a localStorage snapshot
 * per period for instant reopen, and lets the user star repositories either on
 * the connected GitHub account or in a local-only collection.
 */

// Register unconditionally. The client module loader invalidates this factory
// when the plugin is disabled, and re-executes the bundle when it is enabled
// again or rebuilt by HMR; a permanent window guard would suppress that second
// registration and leave the plugin (and its sidebar entry) missing. Replaying
// the same bundle URL is already prevented by the loader's executedBundleUrls
// bookkeeping, so no guard is needed here.
window.__ModuleLoader__.load({
  id: 'dsh-github-trending-masonry',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useRef = React.useRef
    const useCallback = React.useCallback

    const NS = 'dsh-github-trending-masonry'
    const BASE = '/dsh-github-trending-masonry'
    const PREFS_KEY = NS + ':prefs'
    const SNAPSHOT_PREFIX = NS + ':snapshot:'
    const PERIODS = ['daily', 'weekly', 'monthly']
    const TABS = ['trending', 'collection']
    const MAX_STACK = 5
    const MAX_FEATURES = 4
    const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=public_repo&description=DSH%20Trending%20Masonry'
    // Author / feedback links shown at the foot of the panel.
    const REPO_URL = 'https://github.com/Zhang-Eli/dsh-github-trending-masonry'
    const ISSUES_URL = REPO_URL + '/issues'
    const AUTHOR_NAME = 'Zhang-Eli'
    const AUTHOR_URL = 'https://github.com/' + AUTHOR_NAME

    /** Filled in apply(); the slot components are rendered by the shell, not by us. */
    let LOCALE = null

    const ZH = {
      'nav.title': 'GitHub Trending',
      'title': 'GitHub Trending',
      'subtitle': '日榜 / 周榜 / 月榜 · 扁平卡片瀑布流，点击星标即可收藏',
      'refresh': '刷新',
      'refreshing': '刷新中',
      'tab.label': '视图',
      'tab.trending': '趋势',
      'tab.collection': '我的收藏',
      'period.label': '榜单周期',
      'period.daily': '日榜',
      'period.weekly': '周榜',
      'period.monthly': '月榜',
      'meta.daily': '今日',
      'meta.weekly': '本周',
      'meta.monthly': '本月',
      'filter.all': '全部',
      'filter.category': '分类',
      'updated': '更新于',
      'cache.cached': '缓存',
      'cache.live': '实时',
      'loading': '正在加载 GitHub 趋势…',
      'error.title': '加载失败',
      'error.retry': '重试',
      'empty.feed': '这个榜单暂时没有可展示的仓库',
      'empty.collection.title': '还没有收藏',
      'empty.collection.hint': '在趋势卡片上点击星标即可收藏。未连接 GitHub 账户时，收藏只保存在本机清单中。',
      'card.star.add': '收藏',
      'card.star.remove': '取消收藏',
      'card.stack': '技术栈',
      'card.features': '主要功能',
      'star.failed': '收藏操作失败',
      'mode.github': 'GitHub',
      'mode.local': '本地',
      'account.connect': '连接 GitHub',
      'account.connected': '已连接 GitHub 账户',
      'account.dialogTitle': 'GitHub 账户',
      'account.dialogHint': '连接 GitHub 账户是可选的。不连接时，星标只写入本机清单；连接后，星标会同时写入你的 GitHub 账户。',
      'account.current': '当前账户',
      'account.tokenLabel': 'Personal Access Token',
      'account.tokenPlaceholder': 'ghp_…',
      'account.tokenHint': '需要一个具有 public_repo 权限的 Token。',
      'account.createToken': '创建 Token',
      'account.save': '保存并验证',
      'account.saving': '验证中…',
      'account.cancel': '取消',
      'account.close': '关闭',
      'account.disconnect': '断开连接 GitHub 账户',
      'account.disconnectHint': '断开不会取消 GitHub 上已有的星标，本地清单中的收藏仍会保留。',
      'account.disconnecting': '断开中…',
      'account.saveFailed': 'GitHub 账户保存失败',
      'account.disconnectFailed': '断开连接失败',
      'state.failed': '账户状态加载失败',
      'notice.dismiss': '关闭提示',
      'feedback': '反馈问题',
      'developedBy': 'Developed by',
    }

    const EN = {
      'nav.title': 'GitHub Trending',
      'title': 'GitHub Trending',
      'subtitle': 'Daily / weekly / monthly boards as flat masonry cards with one-click starring',
      'refresh': 'Refresh',
      'refreshing': 'Refreshing',
      'tab.label': 'Views',
      'tab.trending': 'Trending',
      'tab.collection': 'Saved',
      'period.label': 'Period',
      'period.daily': 'Today',
      'period.weekly': 'This week',
      'period.monthly': 'This month',
      'meta.daily': 'today',
      'meta.weekly': 'this week',
      'meta.monthly': 'this month',
      'filter.all': 'All',
      'filter.category': 'Categories',
      'updated': 'Updated',
      'cache.cached': 'cached',
      'cache.live': 'live',
      'loading': 'Loading GitHub Trending…',
      'error.title': 'Failed to load',
      'error.retry': 'Retry',
      'empty.feed': 'No repositories on this board right now',
      'empty.collection.title': 'Nothing saved yet',
      'empty.collection.hint': 'Click the star on any trending card to save it here. Without a connected GitHub account, saved stars stay in a local list on this machine.',
      'card.star.add': 'Save',
      'card.star.remove': 'Remove from saved',
      'card.stack': 'Tech stack',
      'card.features': 'Key features',
      'star.failed': 'The star action failed',
      'mode.github': 'GitHub',
      'mode.local': 'Local',
      'account.connect': 'Connect GitHub',
      'account.connected': 'GitHub account connected',
      'account.dialogTitle': 'GitHub account',
      'account.dialogHint': 'Connecting a GitHub account is optional. Without it, stars go to a local list on this machine; with it, stars are also applied to your GitHub account.',
      'account.current': 'Signed in as',
      'account.tokenLabel': 'Personal access token',
      'account.tokenPlaceholder': 'ghp_…',
      'account.tokenHint': 'Needs a token with the public_repo scope.',
      'account.createToken': 'Create a token',
      'account.save': 'Save & verify',
      'account.saving': 'Verifying…',
      'account.cancel': 'Cancel',
      'account.close': 'Close',
      'account.disconnect': 'Disconnect GitHub account',
      'account.disconnectHint': 'Disconnecting does not unstar anything on GitHub; locally saved stars are kept.',
      'account.disconnecting': 'Disconnecting…',
      'account.saveFailed': 'Failed to save the GitHub account',
      'account.disconnectFailed': 'Failed to disconnect',
      'state.failed': 'Failed to load the account state',
      'notice.dismiss': 'Dismiss',
      'feedback': 'Feedback',
      'developedBy': 'Developed by',
    }

    /* ------------------------------------------------------------------ */
    /* Tiny helpers                                                        */
    /* ------------------------------------------------------------------ */

    function text(value) {
      if (value === null || value === undefined) return ''
      return typeof value === 'string' ? value : String(value)
    }

    function isObject(value) {
      return !!value && typeof value === 'object'
    }

    function fullNameOf(repo) {
      if (!isObject(repo)) return ''
      const full = text(repo.fullName).trim()
      if (full) return full
      const owner = text(repo.owner).trim()
      const name = text(repo.name).trim()
      return owner && name ? owner + '/' + name : ''
    }

    function repoUrl(repo) {
      if (!isObject(repo)) return ''
      const url = text(repo.url).trim()
      if (url) return url
      const full = fullNameOf(repo)
      return full ? 'https://github.com/' + full : ''
    }

    /** Owner avatar straight from GitHub so every card carries a recognisable image. */
    function avatarUrl(owner) {
      const login = text(owner).trim()
      if (!login) return ''
      return 'https://github.com/' + encodeURIComponent(login) + '.png?size=96'
    }

    /** Compact star gain: plain under 10k, k/M with one decimal above. */
    function compact(value) {
      const number = Number(value) || 0
      const absolute = Math.abs(number)
      if (absolute >= 1000000) return (number / 1000000).toFixed(1) + 'M'
      if (absolute >= 10000) return (number / 1000).toFixed(1) + 'k'
      return new Intl.NumberFormat('en-US').format(Math.round(number))
    }

    function toDate(value) {
      if (value === null || value === undefined || value === '') return null
      const date = typeof value === 'number' ? new Date(value) : new Date(Date.parse(String(value)))
      return Number.isFinite(date.getTime()) ? date : null
    }

    /** HH:MM in the browser's wall-clock time zone. */
    function localTime(value) {
      const date = toDate(value)
      if (!date) return ''
      const pad = function (part) {
        return String(part).padStart(2, '0')
      }
      return pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    /** Stack chips: language first when present, de-duplicated, at most MAX_STACK. */
    function stackOf(item) {
      const out = []
      const seen = {}
      function push(value) {
        const label = text(value).trim()
        if (!label) return
        const key = label.toLowerCase()
        if (seen[key]) return
        seen[key] = true
        out.push(label)
      }
      if (!isObject(item)) return out
      push(item.language)
      const stack = Array.isArray(item.stack) ? item.stack : []
      for (let index = 0; index < stack.length; index += 1) push(stack[index])
      return out.slice(0, MAX_STACK)
    }

    /** README-derived intro blocks: the Host sends plain text paragraphs split by "\n\n". */
    function introOf(item) {
      if (!isObject(item) || typeof item.intro !== 'string') return []
      const raw = item.intro.trim()
      if (!raw) return []
      return raw
        .split(/\n\s*\n/)
        .map(function (block) {
          return block.trim()
        })
        .filter(function (block) {
          return block !== ''
        })
    }

    /** Up to MAX_FEATURES short "what it implements" bullets from the Host. */
    function featuresOf(item) {
      if (!isObject(item)) return []
      const source = Array.isArray(item.features) ? item.features : []
      const out = []
      for (let index = 0; index < source.length && out.length < MAX_FEATURES; index += 1) {
        if (typeof source[index] !== 'string') continue
        const label = source[index].trim()
        if (label) out.push(label)
      }
      return out
    }

    function normalizeAccount(value) {
      if (!isObject(value)) return { configured: false, login: null, avatarUrl: null }
      return {
        configured: !!value.configured,
        login: value.login ? text(value.login) : null,
        avatarUrl: value.avatarUrl ? text(value.avatarUrl) : null,
      }
    }

    function toStarList(value) {
      if (!Array.isArray(value)) return []
      return value.filter(function (entry) {
        return isObject(entry)
      })
    }

    function localStarEntry(repo, mode) {
      const source = isObject(repo) ? repo : {}
      return {
        fullName: fullNameOf(source),
        owner: text(source.owner),
        name: text(source.name),
        url: repoUrl(source),
        description: text(source.description),
        intro: typeof source.intro === 'string' ? source.intro : null,
        features: Array.isArray(source.features)
          ? source.features.filter(function (entry) {
              return typeof entry === 'string'
            }).slice(0, MAX_FEATURES)
          : [],
        language: text(source.language),
        stack: Array.isArray(source.stack) ? source.stack.slice(0, MAX_STACK) : [],
        category: text(source.category),
        categoryZh: text(source.categoryZh),
        categoryEn: text(source.categoryEn),
        mode: mode === 'github' ? 'github' : 'local',
        starredAt: new Date().toISOString(),
      }
    }

    /* ------------------------------------------------------------------ */
    /* localStorage: prefs + per-period feed snapshots                     */
    /* ------------------------------------------------------------------ */

    function storageGet(key) {
      try {
        if (typeof localStorage === 'undefined') return null
        return localStorage.getItem(key)
      } catch (error) {
        return null
      }
    }

    function storageSet(key, value) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(key, value)
      } catch (error) {
        /* storage may be unavailable or full — caching is optional */
      }
    }

    function readPrefs() {
      const fallback = { since: 'daily', tab: 'trending' }
      const raw = storageGet(PREFS_KEY)
      if (!raw) return fallback
      try {
        const parsed = JSON.parse(raw)
        if (!isObject(parsed)) return fallback
        return {
          since: PERIODS.indexOf(parsed.since) >= 0 ? parsed.since : fallback.since,
          tab: TABS.indexOf(parsed.tab) >= 0 ? parsed.tab : fallback.tab,
        }
      } catch (error) {
        return fallback
      }
    }

    function writePrefs(prefs) {
      storageSet(PREFS_KEY, JSON.stringify({ since: prefs.since, tab: prefs.tab }))
    }

    /** Snapshots are keyed per period and per UI language (the Host translates intros). */
    function snapshotKey(since, lang) {
      return SNAPSHOT_PREFIX + since + ':' + lang
    }

    function readSnapshot(since, lang) {
      const raw = storageGet(snapshotKey(since, lang))
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw)
        if (!isObject(parsed) || !isObject(parsed.data) || !Array.isArray(parsed.data.items)) return null
        return {
          savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : null,
          data: parsed.data,
        }
      } catch (error) {
        return null
      }
    }

    function writeSnapshot(since, lang, data) {
      try {
        storageSet(snapshotKey(since, lang), JSON.stringify({ savedAt: Date.now(), data: data }))
      } catch (error) {
        /* ignore: a snapshot is a nicety, not a requirement */
      }
    }

    /* ------------------------------------------------------------------ */
    /* HTTP                                                                */
    /* ------------------------------------------------------------------ */

    function api(path, options) {
      const init = options || {}
      const headers = { accept: 'application/json' }
      const request = { credentials: 'same-origin', headers: headers }
      if (init.method) request.method = init.method
      if (init.signal) request.signal = init.signal
      if (init.body !== undefined) {
        headers['content-type'] = 'application/json'
        request.body = JSON.stringify(init.body)
      }
      return fetch(BASE + path, request).then(function (response) {
        return response.text().then(function (raw) {
          let body = null
          if (raw) {
            try {
              body = JSON.parse(raw)
            } catch (parseError) {
              body = null
            }
          }
          if (!response.ok) {
            const message = isObject(body) && typeof body.error === 'string' && body.error ? body.error : 'HTTP ' + response.status
            const failure = new Error(message)
            failure.status = response.status
            throw failure
          }
          return isObject(body) ? body : {}
        })
      })
    }

    /* ------------------------------------------------------------------ */
    /* i18n                                                                */
    /* ------------------------------------------------------------------ */

    function activeLocale(locale) {
      try {
        if (locale && typeof locale.getLocale === 'function') {
          const current = locale.getLocale()
          if (current && current.active) return String(current.active)
        }
      } catch (error) {
        /* ignore */
      }
      try {
        if (typeof navigator !== 'undefined' && navigator.language) return String(navigator.language)
      } catch (error) {
        /* ignore */
      }
      return 'zh'
    }

    function isEnglish(locale) {
      return activeLocale(locale).toLowerCase().indexOf('en') === 0
    }

    /** Base UI language code sent to the Host, e.g. zh-CN → zh, en-US → en (zh fallback). */
    function feedLanguage(locale) {
      const base = String(activeLocale(locale)).toLowerCase().split(/[-_]/)[0]
      return base || 'zh'
    }

    function makeT(locale) {
      const table = isEnglish(locale) ? EN : ZH
      return function t(key, params) {
        let value = table[key]
        if (value === undefined) value = ZH[key]
        if (value === undefined) value = key
        if (params) {
          Object.keys(params).forEach(function (name) {
            value = value.split('{' + name + '}').join(String(params[name]))
          })
        }
        return value
      }
    }

    /* ------------------------------------------------------------------ */
    /* Data hooks                                                          */
    /* ------------------------------------------------------------------ */

    /** Initial feed state for a period, seeded from the localStorage snapshot so
     * the very first paint already shows cached cards while the request runs. */
    function feedStateFromSnapshot(since, lang) {
      const snapshot = readSnapshot(since, lang)
      const items = snapshot && isObject(snapshot.data) && Array.isArray(snapshot.data.items) ? snapshot.data.items : []
      return {
        since: since,
        items: items,
        updatedAt: snapshot ? snapshot.savedAt : null,
        cacheState: items.length > 0 ? 'hit' : null,
        loading: true,
        error: null,
        warning: null,
      }
    }

    /**
     * Feeds one period. A saved snapshot renders immediately while the request
     * runs in the background; the previous list is kept while refreshing, so a
     * reload never blanks the panel.
     */
    function useFeed(since, refreshKey, lang) {
      const [state, setState] = useState(function () {
        return feedStateFromSnapshot(since, lang)
      })

      useEffect(
        function () {
          const controller = new AbortController()
          let alive = true

          setState(function (previous) {
            const snapshot = readSnapshot(since, lang)
            const snapshotItems = snapshot && isObject(snapshot.data) && Array.isArray(snapshot.data.items) ? snapshot.data.items : []
            const keepItems = previous.since === since && previous.items.length > 0
            return {
              since: since,
              items: keepItems ? previous.items : snapshotItems,
              updatedAt: keepItems ? previous.updatedAt : snapshot ? snapshot.savedAt : null,
              cacheState: keepItems ? previous.cacheState : snapshotItems.length > 0 ? 'hit' : null,
              loading: true,
              error: null,
              warning: null,
            }
          })

          const query = new URLSearchParams()
          query.set('since', since)
          if (lang) query.set('lang', lang)
          if (refreshKey > 0) query.set('refresh', '1')

          api('/feed?' + query.toString(), { signal: controller.signal }).then(
            function (data) {
              if (!alive) return
              const items = Array.isArray(data.items)
                ? data.items.filter(function (item) {
                    return isObject(item)
                  })
                : []
              writeSnapshot(since, lang, { since: data.since || since, generatedAt: data.generatedAt || null, cache: data.cache || null, items: items })
              setState({
                since: since,
                items: items,
                updatedAt: data.generatedAt || Date.now(),
                cacheState: isObject(data.cache) && data.cache.state === 'hit' ? 'hit' : 'miss',
                loading: false,
                error: null,
                warning: typeof data.warning === 'string' && data.warning ? data.warning : null,
              })
            },
            function (error) {
              if (!alive) return
              if (error && error.name === 'AbortError') return
              setState(function (previous) {
                if (previous.since !== since) return previous
                return {
                  since: previous.since,
                  items: previous.items,
                  updatedAt: previous.updatedAt,
                  cacheState: previous.cacheState,
                  loading: false,
                  error: (error && error.message) || String(error),
                  warning: previous.warning,
                }
              })
            },
          )

          return function () {
            alive = false
            controller.abort()
          }
        },
        [since, refreshKey, lang],
      )

      return state
    }

    /** Column count from the masonry container width. */
    function useColumns() {
      const ref = useRef(null)
      const [columns, setColumns] = useState(1)

      useEffect(function () {
        const node = ref.current
        if (!node) return undefined
        function measure() {
          const width = node.clientWidth || 0
          const next = width >= 1280 ? 4 : width >= 980 ? 3 : width >= 660 ? 2 : 1
          setColumns(function (previous) {
            return previous === next ? previous : next
          })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(node)
          return function () {
            observer.disconnect()
          }
        }
        window.addEventListener('resize', measure)
        return function () {
          window.removeEventListener('resize', measure)
        }
      }, [])

      return [ref, columns]
    }

    /* ------------------------------------------------------------------ */
    /* Icons                                                               */
    /* ------------------------------------------------------------------ */

    /** Monochrome 18×18 rail icon: a trending arrow. */
    function NavIcon() {
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } },
        h(
          'svg',
          { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M3 17.5 8.5 12l4 3.5L21 6.5',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M15.5 6.5H21V12',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      )
    }

    function StarIcon(props) {
      const filled = !!(props && props.filled)
      const size = (props && props.size) || 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: filled ? 'currentColor' : 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M12 3.6l2.6 5.3 5.9.85-4.25 4.15 1 5.9L12 17.05 6.75 19.8l1-5.9L3.5 9.75l5.9-.85z',
          stroke: 'currentColor',
          strokeWidth: filled ? 1 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Small speech-bubble icon matching the footer's "feedback" link. */
    function FeedbackIcon(props) {
      const size = (props && props.size) || 13
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M13.2 8c0 2.5-2.3 4.5-5.2 4.5-.7 0-1.3-.1-1.9-.3l-2.9 1 .9-2.4c-.7-.7-1.2-1.7-1.2-2.8 0-2.5 2.3-4.5 5.1-4.5s5.2 2 5.2 4.5Z',
        }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Small presentational pieces                                        */
    /* ------------------------------------------------------------------ */

    function Avatar(props) {
      const owner = text(props.owner).trim()
      const source = text(props.src).trim()
      const url = source || avatarUrl(owner)
      const className = props.size === 'lg' ? 'gtm-avatar-lg' : props.size === 'sm' ? 'gtm-avatar-sm' : 'gtm-avatar'
      return h(
        'span',
        { className: className, title: owner || undefined },
        owner ? owner.charAt(0).toUpperCase() : '?',
        url
          ? h('img', {
              src: url,
              alt: owner,
              loading: 'lazy',
              onError: function (event) {
                event.currentTarget.style.display = 'none'
              },
            })
          : null,
      )
    }

    function StarButton(props) {
      const t = props.t
      const starred = !!props.starred
      const busy = !!props.busy
      const label = t(starred ? 'card.star.remove' : 'card.star.add')
      return h(
        'button',
        {
          type: 'button',
          className: 'gtm-star',
          'data-starred': starred ? '1' : '0',
          disabled: busy,
          'aria-pressed': starred ? 'true' : 'false',
          'aria-label': label,
          title: label,
          onClick: function (event) {
            event.preventDefault()
            event.stopPropagation()
            if (props.onClick) props.onClick()
          },
        },
        h(StarIcon, { filled: starred, size: 14 }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Cards                                                               */
    /* ------------------------------------------------------------------ */

    function RepoCard(props) {
      const item = isObject(props.item) ? props.item : {}
      const t = props.t
      const collection = props.mode === 'collection'
      const fullName = fullNameOf(item)
      const platform = text(item.owner).trim() || (fullName.indexOf('/') >= 0 ? fullName.split('/')[0] : '')
      const repoName = text(item.name).trim() || (fullName.indexOf('/') >= 0 ? fullName.split('/').slice(1).join('/') : '')
      const url = repoUrl(item)
      const description = text(item.description).trim()
      const intro = introOf(item)
      const features = featuresOf(item)
      const stack = stackOf(item)
      const rank = Number(item.rank) || Number(props.index) + 1
      const gain = Number(item.delta) || 0
      const starred = !!props.starred
      const children = []

      children.push(
        h(
          'div',
          { className: 'gtm-card-head', key: 'head' },
          collection
            ? null
            : h('span', { className: 'gtm-rank', 'data-top': rank <= 3 ? '1' : '0' }, '#' + String(rank)),
          h(Avatar, { owner: platform }),
          h(
            'div',
            { className: 'gtm-title' },
            platform ? h('span', { className: 'gtm-owner', title: platform }, platform) : null,
            platform ? h('span', { className: 'gtm-slash' }, '/') : null,
            url
              ? h('a', { className: 'gtm-name', href: url, target: '_blank', rel: 'noreferrer', title: fullName || repoName || url }, repoName || fullName)
              : h('span', { className: 'gtm-name' }, repoName || fullName || '—'),
          ),
          h(StarButton, {
            t: t,
            starred: starred,
            busy: props.busy,
            onClick: function () {
              if (props.onToggle) props.onToggle(item)
            },
          }),
        ),
      )

      if (collection) {
        children.push(
          h('div', { className: 'gtm-meta', key: 'meta' }, h('span', { className: 'gtm-badge' }, t(item.mode === 'github' ? 'mode.github' : 'mode.local'))),
        )
      } else {
        children.push(
          h(
            'div',
            { className: 'gtm-meta', key: 'meta' },
            h('span', { className: 'gtm-gain' }, '+' + compact(gain)),
            h('span', null, '·'),
            h('span', null, t('meta.' + (PERIODS.indexOf(props.since) >= 0 ? props.since : 'daily'))),
          ),
        )
      }

      if (intro.length > 0) {
        // Long intro: one paragraph per block, never clamped (the masonry absorbs height).
        children.push(
          h(
            'div',
            { className: 'gtm-intro', key: 'intro' },
            intro.map(function (paragraph, index) {
              return h('p', { className: 'gtm-intro-p', key: 'intro-' + index }, paragraph)
            }),
          ),
        )
      } else {
        children.push(h('p', { className: 'gtm-desc', key: 'desc', title: description || undefined }, description || '—'))
      }

      if (features.length > 0) {
        // Hairline separator: the intro reads as one block, the feature list as another.
        children.push(h('div', { className: 'gtm-divider', key: 'divider', 'aria-hidden': 'true' }))
        children.push(
          h(
            'div',
            { className: 'gtm-features', key: 'features' },
            h('span', { className: 'gtm-features-label' }, t('card.features')),
            h(
              'ul',
              { className: 'gtm-features-list' },
              features.map(function (feature, index) {
                return h('li', { className: 'gtm-feature', key: 'feature-' + index, title: feature }, feature)
              }),
            ),
          ),
        )
      }

      if (stack.length > 0) {
        children.push(
          h(
            'div',
            { className: 'gtm-stack', key: 'stack', 'aria-label': t('card.stack') },
            stack.map(function (label) {
              return h('span', { className: 'gtm-tag', key: label, title: label }, label)
            }),
          ),
        )
      }

      return h('article', { className: 'gtm-card' }, children)
    }

    const SKELETON_ITEMS = [118, 152, 104, 136, 164, 112, 144, 124].map(function (height) {
      return { height: height }
    })

    function renderSkeleton(item, index) {
      const height = item && item.height ? item.height : 128
      return h(
        'div',
        { className: 'gtm-skel', key: 'skeleton-' + index, style: { minHeight: height } },
        h('div', { className: 'gtm-skel-bar', style: { width: '56%' } }),
        h('div', { className: 'gtm-skel-bar' }),
        h('div', { className: 'gtm-skel-bar', style: { width: '84%' } }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Waterfall                                                           */
    /* ------------------------------------------------------------------ */

    /** Round-robin distribution (items[i % columns]) so rank order reads left-to-right. */
    function Masonry(props) {
      const measured = useColumns()
      const ref = measured[0]
      const columns = measured[1]
      const items = Array.isArray(props.items) ? props.items : []

      const buckets = useMemo(
        function () {
          const out = []
          for (let index = 0; index < columns; index += 1) out.push([])
          for (let index = 0; index < items.length; index += 1) {
            out[index % columns].push({ item: items[index], index: index })
          }
          return out
        },
        [items, columns],
      )

      return h(
        'div',
        { className: 'gtm-masonry', ref: ref },
        buckets.map(function (bucket, columnIndex) {
          return h(
            'div',
            { className: 'gtm-col', key: 'column-' + columnIndex },
            bucket.map(function (cell) {
              return props.renderItem(cell.item, cell.index)
            }),
          )
        }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Toolbar pieces                                                      */
    /* ------------------------------------------------------------------ */

    function PeriodTabs(props) {
      const t = props.t
      return h(
        'div',
        { className: 'gtm-seg', role: 'tablist', 'aria-label': t('period.label') },
        PERIODS.map(function (value) {
          const active = props.value === value
          return h(
            'button',
            {
              key: value,
              type: 'button',
              role: 'tab',
              'data-active': active ? '1' : '0',
              'aria-selected': active ? 'true' : 'false',
              onClick: function () {
                props.onChange(value)
              },
            },
            t('period.' + value),
          )
        }),
      )
    }

    function Chips(props) {
      const t = props.t
      const items = [{ key: 'all', label: t('filter.all') }].concat(Array.isArray(props.items) ? props.items : [])
      return h(
        'div',
        { className: 'gtm-chips', role: 'group', 'aria-label': t('filter.category') },
        items.map(function (item) {
          const active = props.active === item.key
          return h(
            'button',
            {
              key: item.key,
              type: 'button',
              className: 'gtm-chip',
              'data-active': active ? '1' : '0',
              'aria-pressed': active ? 'true' : 'false',
              onClick: function () {
                props.onChange(item.key)
              },
            },
            item.label,
          )
        }),
      )
    }

    function AccountChip(props) {
      const t = props.t
      const account = isObject(props.account) ? props.account : {}
      if (account.configured) {
        // The host may know a token but not its login (verification failed); degrade to a label.
        const login = text(account.login).trim()
        return h(
          'button',
          { type: 'button', className: 'gtm-account', onClick: props.onOpen, title: t('account.connected') },
          h(Avatar, { owner: login, src: account.avatarUrl || '', size: 'sm' }),
          h('span', { className: 'gtm-login' }, login ? '@' + login : t('account.connected')),
        )
      }
      return h('button', { type: 'button', className: 'gtm-btn', onClick: props.onOpen }, t('account.connect'))
    }

    /* ------------------------------------------------------------------ */
    /* Account dialog                                                      */
    /* ------------------------------------------------------------------ */

    function AccountDialog(props) {
      const t = props.t
      const open = !!props.open
      const account = isObject(props.account) ? props.account : {}
      const configured = !!account.configured
      const accountLogin = text(account.login).trim()
      const [token, setToken] = useState('')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const inputRef = useRef(null)
      const closeRef = useRef(null)

      // Reset the form every time the dialog opens.
      useEffect(
        function () {
          if (!open) return
          setToken('')
          setError('')
          setBusy('')
        },
        [open],
      )

      // Focus the token input (or the close button when the account is set).
      useEffect(
        function () {
          if (!open) return
          if (!configured) {
            if (inputRef.current) inputRef.current.focus()
          } else if (closeRef.current) {
            closeRef.current.focus()
          }
        },
        [open, configured],
      )

      // Escape closes the dialog.
      useEffect(
        function () {
          if (!open) return undefined
          function onKeyDown(event) {
            if (event.key === 'Escape') {
              event.stopPropagation()
              props.onClose()
            }
          }
          document.addEventListener('keydown', onKeyDown)
          return function () {
            document.removeEventListener('keydown', onKeyDown)
          }
        },
        [open, props.onClose],
      )

      function save() {
        const value = token.trim()
        if (!value || busy) return
        setBusy('save')
        setError('')
        api('/account', { method: 'POST', body: { token: value } }).then(
          function (data) {
            setBusy('')
            if (props.onAccount) props.onAccount(data.account, data.stars)
            props.onClose()
          },
          function (failure) {
            setBusy('')
            setError((failure && failure.message) || t('account.saveFailed'))
          },
        )
      }

      function disconnect() {
        if (busy) return
        setBusy('disconnect')
        setError('')
        api('/account', { method: 'DELETE' }).then(
          function (data) {
            setBusy('')
            if (props.onAccount) props.onAccount(data.account, data.stars)
            props.onClose()
          },
          function (failure) {
            setBusy('')
            setError((failure && failure.message) || t('account.disconnectFailed'))
          },
        )
      }

      if (!open) return null

      const body = []
      body.push(
        h(
          'div',
          { className: 'gtm-dialog-head', key: 'head' },
          h('h2', { className: 'gtm-dialog-title', id: 'gtm-account-title' }, t('account.dialogTitle')),
          h(
            'button',
            {
              key: 'close',
              type: 'button',
              className: 'gtm-close',
              ref: closeRef,
              onClick: props.onClose,
              'aria-label': t('account.close'),
              title: t('account.close'),
            },
            '×',
          ),
        ),
      )

      if (configured) {
        body.push(
          h(
            'div',
            { className: 'gtm-account-box', key: 'box' },
            h(Avatar, { owner: accountLogin, src: account.avatarUrl || '', size: 'lg' }),
            h(
              'div',
              { className: 'gtm-account-name' },
              h('b', { title: accountLogin ? '@' + accountLogin : t('account.connected') }, accountLogin ? '@' + accountLogin : t('account.connected')),
              accountLogin ? h('span', null, t('account.current')) : null,
            ),
          ),
        )
        body.push(h('p', { className: 'gtm-dialog-text', key: 'hint' }, t('account.disconnectHint')))
      } else {
        body.push(h('p', { className: 'gtm-dialog-text', key: 'hint' }, t('account.dialogHint')))
        body.push(
          h(
            'div',
            { className: 'gtm-field', key: 'token' },
            h('label', { className: 'gtm-label', htmlFor: 'gtm-token' }, t('account.tokenLabel')),
            h('input', {
              id: 'gtm-token',
              className: 'gtm-input',
              type: 'password',
              value: token,
              placeholder: t('account.tokenPlaceholder'),
              autoComplete: 'off',
              spellCheck: false,
              onChange: function (event) {
                setToken(event.target.value)
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') save()
              },
              ref: inputRef,
            }),
            h(
              'p',
              { className: 'gtm-hint' },
              t('account.tokenHint') + ' ',
              h('a', { className: 'gtm-link', href: TOKEN_URL, target: '_blank', rel: 'noreferrer' }, t('account.createToken')),
            ),
          ),
        )
      }

      if (error) {
        body.push(h('p', { className: 'gtm-dialog-error', key: 'error', role: 'alert' }, error))
      }

      body.push(
        h(
          'div',
          { className: 'gtm-actions', key: 'actions' },
          h('button', { type: 'button', className: 'gtm-btn', onClick: props.onClose }, t('account.cancel')),
          configured
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'gtm-btn',
                  'data-primary': '1',
                  disabled: !!busy,
                  onClick: disconnect,
                },
                busy === 'disconnect' ? t('account.disconnecting') : t('account.disconnect'),
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'gtm-btn',
                  'data-primary': '1',
                  disabled: !!busy || !token.trim(),
                  onClick: save,
                },
                busy === 'save' ? t('account.saving') : t('account.save'),
              ),
        ),
      )

      return h(
        'div',
        {
          className: 'gtm-backdrop',
          onMouseDown: function (event) {
            if (event.target === event.currentTarget) props.onClose()
          },
        },
        h(
          'div',
          {
            className: 'gtm-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'gtm-account-title',
          },
          body,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Styles: flat only — 1px borders, ≤10px radius, theme tokens          */
    /* ------------------------------------------------------------------ */

    const CSS = [
      '.gtm-root{box-sizing:border-box;height:100%;overflow:auto;padding:20px 22px 48px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}',
      '.gtm-root *{box-sizing:border-box}',
      '.gtm-shell{max-width:1480px;margin:0 auto;display:flex;flex-direction:column;gap:14px}',
      '.gtm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}',
      '.gtm-brand{display:flex;align-items:center;gap:10px;min-width:220px}',
      '.gtm-mark{flex:none;width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}',
      '.gtm-h1{margin:0;font-size:17px;font-weight:650;letter-spacing:.2px}',
      '.gtm-sub{margin:1px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.gtm-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}',
      '.gtm-note{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.gtm-note[data-busy="1"]{color:var(--dsw-alias-brand-primary)}',
      '.gtm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;text-decoration:none}',
      '.gtm-btn:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.gtm-btn:disabled{color:var(--dsw-alias-label-secondary);cursor:not-allowed}',
      '.gtm-btn:disabled:hover{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
      '.gtm-btn[data-primary="1"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.gtm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.gtm-tabs,.gtm-seg{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.gtm-tabs button,.gtm-seg button{border:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;padding:3px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}',
      '.gtm-tabs button:hover,.gtm-seg button:hover{color:var(--dsw-alias-label-primary)}',
      '.gtm-tabs button[data-active="1"],.gtm-seg button[data-active="1"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.gtm-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1;font-variant-numeric:tabular-nums}',
      '.gtm-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.gtm-chip{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;font:inherit;font-size:12px;line-height:1.5;cursor:pointer;white-space:nowrap}',
      '.gtm-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.gtm-chip[data-active="1"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.gtm-masonry{display:flex;gap:12px;align-items:flex-start}',
      '.gtm-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:12px}',
      '.gtm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.gtm-card:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.gtm-card-head{display:flex;align-items:center;gap:8px;min-width:0}',
      '.gtm-avatar{position:relative;flex:none;width:26px;height:26px;border-radius:7px;overflow:hidden;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:700;line-height:1;text-transform:uppercase;user-select:none}',
      '.gtm-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}',
      '.gtm-avatar-sm{position:relative;flex:none;width:18px;height:18px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:9.5px;font-weight:700;line-height:1;text-transform:uppercase}',
      '.gtm-avatar-sm img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}',
      '.gtm-avatar-lg{position:relative;flex:none;width:32px;height:32px;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:700;line-height:1;text-transform:uppercase}',
      '.gtm-avatar-lg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}',
      '.gtm-rank{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 5px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10.5px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}',
      '.gtm-rank[data-top="1"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.gtm-title{flex:1 1 auto;min-width:0;display:flex;align-items:baseline;gap:5px;font-size:12.5px;line-height:1.4;overflow:hidden}',
      '.gtm-owner{flex:0 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.gtm-slash{flex:none;color:var(--dsw-alias-label-secondary)}',
      '.gtm-name{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);font-weight:600;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.gtm-name:hover{color:var(--dsw-alias-brand-primary)}',
      '.gtm-star{flex:none;width:26px;height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.gtm-star:hover{color:var(--dsw-alias-brand-primary)}',
      '.gtm-star[data-starred="1"]{color:var(--dsw-alias-brand-primary)}',
      '.gtm-star:disabled{color:var(--dsw-alias-label-secondary);cursor:not-allowed}',
      '.gtm-star:disabled[data-starred="1"]{color:var(--dsw-alias-brand-primary)}',
      '.gtm-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.gtm-gain{color:var(--dsw-alias-state-success-primary);font-weight:600}',
      '.gtm-badge{display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1}',
      '.gtm-desc{margin:0;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.gtm-intro{display:flex;flex-direction:column;min-width:0}',
      '.gtm-intro-p{margin:0 0 6px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-line;word-break:break-word}',
      '.gtm-intro-p:last-child{margin-bottom:0}',
      '.gtm-divider{flex:none;height:1px;background:var(--dsw-alias-border-l1);opacity:.9}',
      '.gtm-features{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.gtm-features-label{font-size:10.5px;letter-spacing:.3px;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.gtm-features-list{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:2px}',
      '.gtm-feature{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.gtm-stack{display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
      '.gtm-tag{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.5}',
      '.gtm-skel{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:8px;animation:gtm-pulse 1.8s ease-in-out infinite}',
      '.gtm-skel-bar{height:10px;border-radius:4px;background:var(--dsw-alias-bg-layer-2)}',
      '@keyframes gtm-pulse{0%,100%{background:var(--dsw-alias-bg-layer-1)}50%{background:var(--dsw-alias-bg-layer-2)}}',
      '.gtm-empty{border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;padding:34px 20px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}',
      '.gtm-empty b{font-size:13.5px;color:var(--dsw-alias-label-primary);font-weight:600}',
      '.gtm-error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;align-items:flex-start;gap:8px;font-size:13px}',
      '.gtm-error b{color:var(--dsw-alias-label-primary)}',
      '.gtm-error-msg{color:var(--dsw-alias-label-secondary);font-size:12.5px;word-break:break-word}',
      '.gtm-inline-error{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12px}',
      '.gtm-inline-warn{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-warn-primary);font-size:12px}',
      '.gtm-inline-warn > span{flex:1 1 auto;min-width:0;word-break:break-word}',
      '.gtm-inline-warn > button{flex:none;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-warn-primary);font:inherit;font-size:11.5px;cursor:pointer}',
      '.gtm-inline-error > span{flex:1 1 auto;min-width:0;word-break:break-word}',
      '.gtm-inline-error > button{flex:none;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font:inherit;font-size:11.5px;cursor:pointer}',
      '.gtm-account{display:inline-flex;align-items:center;gap:6px;height:30px;max-width:220px;padding:0 9px 0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}',
      '.gtm-account:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.gtm-login{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.gtm-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-base)}',
      '.gtm-dialog{width:min(460px,100%);max-height:calc(100vh - 48px);overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:18px;display:flex;flex-direction:column;gap:12px}',
      '.gtm-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}',
      '.gtm-dialog-title{margin:0;font-size:15px;font-weight:650}',
      '.gtm-close{flex:none;width:24px;height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:1;cursor:pointer}',
      '.gtm-close:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.gtm-dialog-text{margin:0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.gtm-dialog-error{margin:0;padding:7px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-word}',
      '.gtm-account-box{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);padding:10px}',
      '.gtm-account-name{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:12.5px}',
      '.gtm-account-name b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.gtm-account-name span{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.gtm-field{display:flex;flex-direction:column;gap:6px}',
      '.gtm-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.gtm-input{width:100%;height:32px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:0 10px;outline:none}',
      '.gtm-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.gtm-hint{margin:0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.gtm-link{font-size:11.5px;color:var(--dsw-alias-brand-primary);text-decoration:none}',
      '.gtm-link:hover{text-decoration:underline}',
      '.gtm-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
      '.gtm-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;padding:10px 2px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.gtm-foot-link{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);text-decoration:none;padding:1px 0;border-radius:4px}',
      '.gtm-foot-link:hover,.gtm-foot-link:focus-visible{color:var(--dsw-alias-brand-primary);text-decoration:underline;text-underline-offset:3px;outline:none}',
      '.gtm-foot-dev{display:inline-flex;align-items:center;gap:5px;margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.gtm-foot-dev-label{font-style:italic}',
      '.gtm-foot-avatar{width:16px;height:16px;border-radius:50%;object-fit:cover;background:var(--dsw-alias-bg-layer-2);flex:none}',
      '.gtm-foot-name{color:var(--dsw-alias-label-secondary);text-decoration:none}',
      '.gtm-foot-name:hover,.gtm-foot-name:focus-visible{color:var(--dsw-alias-brand-primary);text-decoration:underline;text-underline-offset:3px;outline:none}',
      '@media (max-width:760px){.gtm-root{padding:14px 12px 40px}.gtm-head-actions{justify-content:flex-start}}',
    ].join('\n')

    /* ------------------------------------------------------------------ */
    /* Footer                                                              */
    /* ------------------------------------------------------------------ */

    /** Feedback link + author credit, mirrored from the One Pack panel footer. */
    function PanelFooter(props) {
      const t = props.t
      return h(
        'footer',
        { className: 'gtm-foot' },
        h(
          'a',
          {
            className: 'gtm-foot-link',
            href: ISSUES_URL,
            target: '_blank',
            rel: 'noreferrer noopener',
            title: t('feedback') + ' · ' + ISSUES_URL,
            'aria-label': t('feedback') + ' · ' + ISSUES_URL,
          },
          h(FeedbackIcon, { size: 13 }),
          t('feedback'),
        ),
        h(
          'span',
          { className: 'gtm-foot-dev' },
          h('span', { className: 'gtm-foot-dev-label' }, t('developedBy')),
          h('img', {
            className: 'gtm-foot-avatar',
            src: 'https://github.com/' + AUTHOR_NAME + '.png?size=32',
            alt: '',
            width: 16,
            height: 16,
            loading: 'lazy',
            draggable: false,
            onError: function (event) {
              event.currentTarget.style.display = 'none'
            },
          }),
          h(
            'a',
            {
              className: 'gtm-foot-name',
              href: AUTHOR_URL,
              target: '_blank',
              rel: 'noreferrer noopener',
              title: AUTHOR_NAME + ' · ' + AUTHOR_URL,
              'aria-label': AUTHOR_NAME + ' · ' + AUTHOR_URL,
            },
            AUTHOR_NAME,
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Panel                                                               */
    /* ------------------------------------------------------------------ */

    function Panel() {
      const t = useMemo(function () {
        return makeT(LOCALE)
      }, [])
      const english = useMemo(function () {
        return isEnglish(LOCALE)
      }, [])
      // The Host translates intros/features into this base language code.
      const lang = useMemo(function () {
        return feedLanguage(LOCALE)
      }, [])
      const initial = useMemo(readPrefs, [])
      const [since, setSince] = useState(initial.since)
      const [tab, setTab] = useState(initial.tab)
      const [category, setCategory] = useState('all')
      const [refreshKey, setRefreshKey] = useState(0)
      const [account, setAccount] = useState({ configured: false, login: null, avatarUrl: null })
      const [stars, setStars] = useState([])
      const [accountOpen, setAccountOpen] = useState(false)
      const [starBusy, setStarBusy] = useState({})
      const [notice, setNotice] = useState('')
      const feed = useFeed(since, refreshKey, lang)

      // Background prefetch: once the visible board has data, warm the other
      // two boards of the same language. The first tab switch then paints the
      // stored snapshot immediately and its /feed request hits the Host cache.
      // Failures stay silent and never touch any visible feed state.
      const prefetched = useRef(new Set())
      useEffect(
        function () {
          if (feed.loading || feed.error || feed.items.length === 0) return
          const done = prefetched.current
          // The selected period is loaded already; remember it so switching
          // back later never triggers a redundant prefetch.
          done.add(lang + ':' + since)
          PERIODS.forEach(function (period) {
            if (period === since) return
            const key = lang + ':' + period
            if (done.has(key)) return
            done.add(key)
            api('/feed?since=' + period + '&lang=' + lang).then(
              function (data) {
                const items = Array.isArray(data.items)
                  ? data.items.filter(function (item) {
                      return isObject(item)
                    })
                  : []
                if (items.length === 0) return
                writeSnapshot(period, lang, {
                  since: data.since || period,
                  generatedAt: data.generatedAt || null,
                  cache: data.cache || null,
                  items: items,
                })
              },
              function () {
                /* ignore: a prefetch is a nicety, never a requirement */
              },
            )
          })
        },
        [since, lang, feed.loading, feed.error, feed.items.length],
      )

      // Restore/remember the last period and top-level tab.
      useEffect(
        function () {
          writePrefs({ since: since, tab: tab })
        },
        [since, tab],
      )

      // Account + collected list.
      useEffect(
        function () {
          const controller = new AbortController()
          let alive = true
          api('/state', { signal: controller.signal }).then(
            function (data) {
              if (!alive) return
              setAccount(normalizeAccount(data.account))
              setStars(toStarList(data.stars))
            },
            function (error) {
              if (!alive) return
              if (error && error.name === 'AbortError') return
              setNotice((error && error.message) || t('state.failed'))
            },
          )
          return function () {
            alive = false
            controller.abort()
          }
        },
        [t],
      )

      const categories = useMemo(
        function () {
          const seen = {}
          const out = []
          for (let index = 0; index < feed.items.length; index += 1) {
            const item = feed.items[index]
            const key = text(item.category).trim()
            if (!key || seen[key]) continue
            seen[key] = true
            const label = english
              ? text(item.categoryEn) || text(item.categoryZh) || key
              : text(item.categoryZh) || text(item.categoryEn) || key
            out.push({ key: key, label: label })
          }
          return out
        },
        [feed.items, english],
      )

      // Drop a category selection that the new period no longer offers.
      useEffect(
        function () {
          if (category === 'all') return
          const exists = categories.some(function (item) {
            return item.key === category
          })
          if (!exists) setCategory('all')
        },
        [categories, category],
      )

      const filtered = useMemo(
        function () {
          if (category === 'all') return feed.items
          return feed.items.filter(function (item) {
            return text(item.category) === category
          })
        },
        [feed.items, category],
      )

      const starredMap = useMemo(
        function () {
          const map = {}
          for (let index = 0; index < stars.length; index += 1) {
            const key = fullNameOf(stars[index])
            if (key) map[key] = true
          }
          return map
        },
        [stars],
      )

      const collectionItems = useMemo(
        function () {
          return stars.filter(function (entry) {
            return fullNameOf(entry) !== ''
          })
        },
        [stars],
      )

      const toggleStar = useCallback(
        function (repo) {
          const fullName = fullNameOf(repo)
          if (!fullName || starBusy[fullName]) return
          const alreadyStarred = stars.some(function (entry) {
            return fullNameOf(entry) === fullName
          })
          const action = alreadyStarred ? 'unstar' : 'star'
          const mode = account && account.configured ? 'github' : 'local'
          const optimistic = localStarEntry(repo, mode)

          setNotice('')
          setStarBusy(function (previous) {
            const next = Object.assign({}, previous)
            next[fullName] = true
            return next
          })
          // Optimistic UI: fill/empty the star right away.
          setStars(function (previous) {
            if (action === 'unstar') {
              return previous.filter(function (entry) {
                return fullNameOf(entry) !== fullName
              })
            }
            return [optimistic].concat(
              previous.filter(function (entry) {
                return fullNameOf(entry) !== fullName
              }),
            )
          })

          function clearBusy() {
            setStarBusy(function (previous) {
              const next = Object.assign({}, previous)
              delete next[fullName]
              return next
            })
          }

          api('/star', { method: 'POST', body: { fullName: fullName, action: action, repo: repo } }).then(
            function (data) {
              clearBusy()
              if (data && data.account) setAccount(normalizeAccount(data.account))
              if (data && Array.isArray(data.stars)) setStars(toStarList(data.stars))
            },
            function (error) {
              clearBusy()
              // Revert only this repository, then surface the server message.
              setStars(function (previous) {
                if (action === 'star') {
                  return previous.filter(function (entry) {
                    return fullNameOf(entry) !== fullName
                  })
                }
                const stillThere = previous.some(function (entry) {
                  return fullNameOf(entry) === fullName
                })
                return stillThere ? previous : [optimistic].concat(previous)
              })
              setNotice((error && error.message) || t('star.failed'))
            },
          )
        },
        [stars, account, starBusy, t],
      )

      const refresh = useCallback(function () {
        setRefreshKey(function (value) {
          return value + 1
        })
      }, [])

      const changePeriod = useCallback(function (next) {
        setSince(next)
        setCategory('all')
        setRefreshKey(0)
      }, [])

      const openAccount = useCallback(function () {
        setAccountOpen(true)
      }, [])

      const closeAccount = useCallback(function () {
        setAccountOpen(false)
      }, [])

      const applyAccount = useCallback(function (nextAccount, nextStars) {
        if (nextAccount) setAccount(normalizeAccount(nextAccount))
        if (Array.isArray(nextStars)) setStars(toStarList(nextStars))
      }, [])

      const renderFeedCard = useCallback(
        function (item, index) {
          const fullName = fullNameOf(item)
          const key = (fullName || 'repo') + '-' + index
          return h(RepoCard, {
            key: key,
            item: item,
            index: index,
            since: since,
            t: t,
            mode: 'feed',
            starred: !!starredMap[fullName],
            busy: !!starBusy[fullName],
            onToggle: toggleStar,
          })
        },
        [since, t, starredMap, starBusy, toggleStar],
      )

      const renderCollectionCard = useCallback(
        function (item, index) {
          const fullName = fullNameOf(item)
          const key = (fullName || 'saved') + '-' + index
          return h(RepoCard, {
            key: key,
            item: item,
            index: index,
            t: t,
            mode: 'collection',
            starred: true,
            busy: !!starBusy[fullName],
            onToggle: toggleStar,
          })
        },
        [t, starBusy, toggleStar],
      )

      const noteChildren = []
      if (feed.loading) noteChildren.push(h('span', { key: 'busy' }, t('refreshing')))
      if (feed.updatedAt) {
        if (noteChildren.length > 0) noteChildren.push(h('span', { key: 'sep' }, '·'))
        noteChildren.push(
          h('span', { key: 'time' }, t('updated') + ' ' + localTime(feed.updatedAt) + ' · ' + t(feed.cacheState === 'hit' ? 'cache.cached' : 'cache.live')),
        )
      }

      const children = []

      children.push(
        h(
          'header',
          { className: 'gtm-head', key: 'head' },
          h(
            'div',
            { className: 'gtm-brand' },
            h('span', { className: 'gtm-mark' }, h(NavIcon, null)),
            h('div', null, h('h1', { className: 'gtm-h1' }, t('title')), h('p', { className: 'gtm-sub' }, t('subtitle'))),
          ),
          h(
            'div',
            { className: 'gtm-head-actions' },
            noteChildren.length > 0 ? h('span', { className: 'gtm-note', 'data-busy': feed.loading ? '1' : '0' }, noteChildren) : null,
            h('button', { type: 'button', className: 'gtm-btn', onClick: refresh, disabled: !!feed.loading }, t('refresh')),
            h(AccountChip, { t: t, account: account, onOpen: openAccount }),
          ),
        ),
      )

      children.push(
        h(
          'div',
          { className: 'gtm-toolbar', key: 'toolbar' },
          h(
            'div',
            { className: 'gtm-tabs', role: 'tablist', 'aria-label': t('tab.label') },
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'data-active': tab === 'trending' ? '1' : '0',
                'aria-selected': tab === 'trending' ? 'true' : 'false',
                onClick: function () {
                  setTab('trending')
                },
              },
              t('tab.trending'),
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'data-active': tab === 'collection' ? '1' : '0',
                'aria-selected': tab === 'collection' ? 'true' : 'false',
                onClick: function () {
                  setTab('collection')
                },
              },
              t('tab.collection'),
              h('span', { className: 'gtm-count' }, String(stars.length)),
            ),
          ),
          tab === 'trending' ? h(PeriodTabs, { t: t, value: since, onChange: changePeriod }) : null,
        ),
      )

      if (tab === 'trending' && categories.length > 0) {
        children.push(h(Chips, { key: 'chips', t: t, items: categories, active: category, onChange: setCategory }))
      }

      if (notice) {
        children.push(
          h(
            'div',
            { className: 'gtm-inline-error', key: 'notice', role: 'alert' },
            h('span', null, notice),
            h(
              'button',
              {
                type: 'button',
                onClick: function () {
                  setNotice('')
                },
              },
              t('notice.dismiss'),
            ),
          ),
        )
      }

      if (tab === 'trending' && feed.error && feed.items.length > 0) {
        children.push(
          h(
            'div',
            { className: 'gtm-inline-error', key: 'feed-error', role: 'alert' },
            h('span', null, feed.error),
            h('button', { type: 'button', onClick: refresh }, t('error.retry')),
          ),
        )
      }

      if (tab === 'trending' && !feed.loading && feed.warning && feed.items.length > 0) {
        children.push(
          h(
            'div',
            { className: 'gtm-inline-warn', key: 'feed-warning', role: 'status' },
            h('span', null, feed.warning),
            h('button', { type: 'button', onClick: refresh }, t('error.retry')),
          ),
        )
      }

      if (tab === 'collection') {
        if (collectionItems.length === 0) {
          children.push(
            h(
              'div',
              { className: 'gtm-empty', key: 'collection-empty' },
              h('b', null, t('empty.collection.title')),
              h('span', null, t('empty.collection.hint')),
            ),
          )
        } else {
          children.push(h(Masonry, { key: 'collection', items: collectionItems, renderItem: renderCollectionCard }))
        }
      } else if (feed.loading && feed.items.length === 0) {
        children.push(h('p', { className: 'gtm-note', key: 'loading', 'data-busy': '1' }, t('loading')))
        children.push(h(Masonry, { key: 'skeleton', items: SKELETON_ITEMS, renderItem: renderSkeleton }))
      } else if (feed.error && feed.items.length === 0) {
        children.push(
          h(
            'div',
            { className: 'gtm-error', key: 'error', role: 'alert' },
            h('b', null, t('error.title')),
            h('div', { className: 'gtm-error-msg' }, feed.error),
            h('button', { type: 'button', className: 'gtm-btn', onClick: refresh }, t('error.retry')),
          ),
        )
      } else if (filtered.length === 0) {
        children.push(h('div', { className: 'gtm-empty', key: 'feed-empty' }, h('b', null, t('empty.feed'))))
      } else {
        children.push(h(Masonry, { key: 'feed', items: filtered, renderItem: renderFeedCard }))
      }

      children.push(h(PanelFooter, { key: 'footer', t: t }))

      return h(
        'div',
        { className: 'gtm-root' },
        h('style', null, CSS),
        h('div', { className: 'gtm-shell' }, children),
        h(AccountDialog, {
          open: accountOpen,
          t: t,
          account: account,
          onClose: closeAccount,
          onAccount: applyAccount,
        }),
      )
    }

    return {
      inject: ['slots'],
      /** Exposed for the bundle smoke test: lets it assert every label exists in both languages. */
      dictionaries: { zh: ZH, en: EN },
      apply(ctx) {
        let locale = null
        try {
          locale = typeof ctx.get === 'function' ? ctx.get('locale') : null
        } catch (error) {
          locale = null
        }
        if (locale && typeof locale.register === 'function') {
          try {
            locale.register(NS, 'zh', ZH)
            locale.register(NS, 'en', EN)
          } catch (error) {
            /* translations are optional; the built-in dictionary is the fallback */
          }
        }
        LOCALE = locale

        const t = makeT(locale)

        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            { name: 'sidebar.panellist', id: 'github-trending-masonry', order: 35, label: t('nav.title') },
            NavIcon,
          )
        })

        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: 'github-trending-masonry' }, Panel)
        })
      },
    }
  },
})
