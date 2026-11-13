# GitHub Trending（dsh-github-trending-masonry）开发交接

> 给下一个开发 session 的「项目记忆」。发版或收工时更新；新 session 开场先读这份文档，
> 再读 CHANGELOG.md 与 `git log --oneline -10`。最后更新：2026-11-13（0.2.0 发布：扁平/悬浮两种 UI 风格 + 卡片头图 + 市场双截图；市场描述精简文案已提 PR #14897）。

## 1. 当前状态

| 项 | 值 |
| --- | --- |
| 仓库 | `C:\Users\Administrator\Documents\dsh-github-trending\dsh-github-trending-masonry`（分支 master；外层目录 `dsh-github-trending` 只是本机存放处，真正的插件仓库是内层这个） |
| 远端 | https://github.com/Zhang-Eli/dsh-github-trending-masonry |
| HEAD | `3b1c972 Release 0.2.0: flat/elevated UI styles, README header art, refreshed marketplace screenshots`（已同步 origin/master；本机已把全库 CRLF 噪音清理回 LF，提交只含真实改动） |
| tag | `v0.1.0`…`v0.2.0`（没有 GitHub Release） |
| npm | `dsh-github-trending-masonry@0.2.0` 为 latest；`dist.shasum ebf7d075c5c5d3e9dbfee7793095fdbb23dcdfbc`，unpacked ~198.8 kB / 20 files |
| 本地安装 | profile `desktop` 用 link: 指向本仓库：`C:\Users\Administrator\.dsh\profiles\desktop\package.json` 里 `"dsh-github-trending-masonry": "link:C:/Users/Administrator/Documents/dsh-github-trending/dsh-github-trending-masonry"`，且已进 `dsh.profile.bundles`；改文件即生效（client 半边刷新页面，host 半边重启宿主） |
| 测试 | `npm test` → 16/16 通过（security 10 + readme 头图 6；沙箱里 spawn EPERM 时用 `node --test --test-isolation=none`） |
| 门禁 | 在已发布版本上重跑：1 error（`version-taken`，预期）+ 3 warn + 4 info；发版前 bump 版本后应为 0 error |
| 市场 | awesome-dsh-plugin PR #14179 已合并（2026-11-11T06:21Z）；市场目录 `plugins.json` 已收录（added 2026-11-11），format-1 索引 `index.json` 仍缺 |

## 2. 架构地图

| 文件 | 职责 |
| --- | --- |
| `index.js` | Host 入口，`inject: ['webServer']`。5 条 `/dsh-github-trending-masonry/*` 路由 + 安全 fence + 缓存编排 + star/account + config 解析 |
| `client.js` | Web 面板 bundle：`window.__ModuleLoader__.load`；注册 `sidebar.panellist`（order 35）与 `main` key；卡片瀑布流、周期 tab、分类 chips、收藏/账号、页脚；内嵌 ZH/EN 字典；localStorage 偏好与快照 |
| `lib/trending.js` | 解析 https://github.com/trending（GitHub 没有官方 Trending API），字段缺失一律降级 |
| `lib/analyze.js` | 确定性分类（chips）+ 技术栈行，不依赖 token |
| `lib/readme.js` | 取 README（raw 优先，GitHub API 兜底）→ `intro` / `features` 纯文本 |
| `lib/summarize.js` | 用 DSH 模型服务把 README 写成界面语言的简介 + 要点 |
| `lib/translate.js` | 优先 DSH `translator` 服务，Google 公共端点兜底；失败保留原文 |
| `lib/enrich.js` | 每个板块的 README + 简介 + 头图 image enrich，磁盘缓存 `readme-cache.json` |
| `lib/cache.js` | `FeedCache`：内存 + 磁盘（`feed-<since>-<lang>.json`），TTL 默认 30 分钟 |
| `lib/store.js` | `state.json`：本地收藏、账号元数据、token 兜底；原子写、0600 |
| `lib/github.js` | `verifyToken` / `setStar` |
| `tests/security.test.mjs` | 10 个路由安全用例（fence、405/415、env token 不可用于加星） |
| `locale/*.json` | **只**是市场元数据（meta / nav），不驱动面板文案 |
| `cordis.patch.yml` | bundle insert：id `github-trending-masonry` |
| `assets/`、`screenshots.json` | 市场用截图与图标 |

数据落点：

- `~/.dsh/plugin-data/github-trending-masonry/`（本机；路径由 `config.dataDir` → `DSH_PROFILE_DIR` → `DSH_PROFILE` → `~/.dsh/plugin-data` 依次决定）：`state.json`、`feed-<daily|weekly|monthly>-<lang>.json`、`readme-cache.json`。
- GitHub token：DSH credentials 记录 `dsh-github-trending-masonry/github-token`；credentials 服务不可用时才落到 `state.json`。
- 浏览器 localStorage：`dsh-github-trending-masonry:prefs`、`dsh-github-trending-masonry:snapshot:<since>:<lang>`。

## 3. 常用命令

```bash
cd /c/Users/Administrator/Documents/dsh-github-trending/dsh-github-trending-masonry
node --check index.js && node --check client.js   # 语法
npm test                                          # node:test，10 例
npm view dsh-github-trending-masonry version       # 线上版本
git log --oneline -10 && git tag --list | tail -5  # 基线
```

```bash
# 发布门禁（在 workspace 根执行；先 bump 版本，否则 version-taken 报错）
cd /d/Documents/deepseek-harness/default-workspace
node _gate_run.mjs github-trending-masonry _gate.json
```

本地生效方式：改 `client.js` → 刷新桌面端页面（Ctrl+R；必要时到插件页禁用/启用一次）；改 `index.js`（Host 半）→ 重启宿主进程。

## 4. 发布流程（简版）

1. `package.json` bump 版本 + `CHANGELOG.md` 加小节。
2. `npm test`；门禁跑到 0 error。
3. `npm pack --dry-run` 记录 shasum。
4. `git commit` → `git tag vX.Y.Z` → push master 与 tag。
5. `npm publish --access public`；等 2–4 分钟，用 `npm view …@X dist.shasum` 与本地 shasum 对照。
6. 更新本文件第 1、6 节，随代码一起提交。
   完整流程（含市场 PR）见 skill `dsh-plugin-publish`。

## 5. 关键设计与坑

- **不要**给 `window.__ModuleLoader__.load` 加永久 guard。loader 在禁用/HMR 时会 invalidate factory 并重新执行 bundle；guard 会吞掉第二次注册，插件的侧边栏入口直接消失（0.1.0 上线后实际发生过，已修）。loader 的 `executedBundleUrls` 已防同一 URL 重放。
- `webServer.register` **没有**准入控制：所有 handler 必须经过 `refusalOf` / `guard`（优先 `connection.requestRejection`，回退 loopback peer/Host + `sec-fetch-site`/`Origin`）；POST 必须 `application/json`（先 415 再读 body）；`/star`、`accountView` 用 `resolveToken({ env: false })`，环境变量 token 只做只读 enrichment。新增路由必须进 `tests/security.test.mjs` 的路由清单（当前 5 条）。
- 面板文案在 `client.js` 的 ZH/EN 字典里；只改 `locale/*.json` 不会改变 UI。改标题/导航名要同时改 client.js 两个字典 + `locale/zh.json` + `locale/en.json`。
- token 优先级：credentials 记录 → `state.json` 兜底 → `config.token` → 环境变量（仅 `env:true` 的只读路径）。别把 env token 接进写路径。
- 缓存：TTL 默认 30 分钟 + localStorage 快照即时开屏；`refresh=1` 强制拉新。磁盘缓存带 `version` 常量，改结构要升 `CACHE_VERSION` 或兼容旧记录。
- 卡片头图（2026-11-13 新增，未发版）：`extractReadme(raw, fullName)` 返回 `image`；`lib/readme.js` 的 `extractHeaderImage` 只扫 README 前 120 行，跳过 shields.io/badge 等徽章与 ≤100px 小图，相对路径解析到 `raw.githubusercontent.com/<full>/HEAD/`。`readme-cache.json` 的 `image` 字段为兼容式新增（未升 CACHE_VERSION）：旧条目缺 key 时 `ReadmeEnricher.upgradeImage` 首用补抓一次只回填 image，不动 intro/features/summaries/translations。卡片渲染在 meta 与 intro 之间，`client.js` `imageOf` 再校验一次 https。
- README 的 Options 是公开契约：改 config key 或取值范围要同步 README 与 `index.js` 的 clamp。
- 门禁的 `client-double-load` 警告是已知误报（探针会把 bundle 执行两次），不要为此加回 guard。
- 开发机是 Windows + MSYS bash：`.git/index.lock` 偶发权限拒绝是暂时性的，重试即可；持续出现用 `diagnose-windows-sandbox-acl`。
- **推 PR 前必须先向用户确认**（2026-11-13 用户指示）：包括 awesome 市场条目 PR、npm 发布配套 GitHub 操作等；本地 commit 不受限但提交前先 `git diff --stat` 确认行尾噪音未被带入。
- `locale/*.json`（市场元数据）已同步为精简描述，与 `docs/market-entry.pending.yml` 保持一致。
- 市场目录由 awesome 仓库 CI 重建，插件仓库改不到；PR 合并后要等站点构建/部署完成。

## 6. 已知限制与下一步候选

- [ ] 市场 format-1 索引 `index.json`（jsdelivr 上的 `dsh-plugin-catalog`）尚未收录；它由 nightly 探针/发布产生，等下一轮即可（市场搜索用的是 `plugins.json`，已收录）。
- [ ] 市场描述精简 PR **#14897** 已提（2026-11-13，正文即 `docs/market-entry.pending.yml`）；等合并后 awesome CI 重建 plugins.json 生效。
- [ ] 本机 gh 令牌缺 `workflow` scope：fork 无法 sync/推含 workflow 改动的分支；市场条目 PR 走「从 fork 旧 main 开分支只改 data/plugins」即可绕过（#14897 即如此）。
- [ ] 没有 GitHub Release（只有 tag）；需要 tgz 附件时再补。
- [ ] README「Options」里 env token 的说法与 0.1.2 只读规则容易误读，建议补一句「仅用于读取/限流」。
- [ ] 测试只有 security；建议补 `normalizeSince` / `parseTrendingHtml` / `classify` / 缓存版本兼容的单测。
- [ ] 当前 profile 是 symlink 开发安装；正式安装走 npm/市场，注意 `files` 白名单不含 `tests/`、`docs/`。

## 7. 新 session 开场清单

1. 读本文件 + `CHANGELOG.md` 最近两条 + `git log --oneline -10`。
2. `npm test` 确认 10/10；`npm view` 对版本；确认 profile symlink 存在。
3. 桌面端确认面板能打开（侧栏 GitHub Trending）。
4. 查市场目录是否收录：`curl -s https://awesome-dsh-plugin.com/plugins.json | grep -c dsh-github-trending-masonry`。
5. 向用户复述当前版本 / 测试数 / 未完成项，再动手；收工更新第 1、6 节并提交。