# GitHub Trending（DSH 插件）

[English](README.md) | 中文

用瀑布流浏览 GitHub Trending 的 日/周/月 榜单，支持一键Star并同步到GitHub。

## 功能

- **日榜 / 周榜 / 月榜**：GitHub Trending 三个时间维度的热门仓库，切换标签即可对照趋势。
- **每个项目一段读得懂的中文简介**：由 Harness 的模型（当前默认模型，无需额外 API Key）为仓库撰写 2–4 句通顺介绍，外加 3–4 条亮点，讲清楚它是什么、解决什么问题，读起来像人写的，不像机翻的 README 片段。
- **跟随 DSH 界面语言**：中文面板得到中文简介，英文面板得到英文简介，与界面一致。
- **瀑布流卡片**：自适应列宽，简介长的卡片自然更高，整页连续滚动，一屏能看到更多项目。
- **切换零等待**：当前榜单出现后，另外两个榜单已在后台准备好；再次打开面板会立刻呈现上次的内容，刷新按钮才会重新获取实时数据。
- **一键加星**：连接 GitHub 账号（Personal Access Token）后，星标直接打到你真实的 GitHub 账号；未连接时也能收藏，保存在「我的收藏」标签里，重启后仍在。
- **卡片只看该看的**：项目简介、技术栈、时间标签与分类标签。

## 安装

```sh
dsh plugin --profile desktop add dsh-github-trending-masonry
```

装完重启 DSH，点击侧栏图标列表里的趋势图标就能打开面板。

## 怎么用

- 侧栏点击趋势图标 → 面板在主栏打开。
- 顶部切换 **日榜 / 周榜 / 月榜**，用分类标签筛掉不感兴趣的方向，点卡片右上角的星标加星。
- **我的收藏** 按时间倒序列出加过星的仓库：标 `GitHub` 的表示已经同步到你的真实账号，标 `本地` 的表示只存在这台机器上。
- 右上角的账号按钮可以 **连接 GitHub**：填一个 Personal Access Token（classic token，勾上 `public_repo` 就够给公开仓库加星），之后加星会直接打到你自己的 GitHub 账号。不连接也能正常用，收藏只保存在本机；断开连接不会删掉本地收藏。

## 版本记录

### 0.1.0 — 首个公开版本

- 日榜 / 周榜 / 月榜，瀑布流卡片布局，分类标签筛选。
- 模型撰写项目简介：2–4 句介绍 + 3–4 条亮点，跟随 DSH 界面语言，结果缓存。
- 一键加星：连接 GitHub 账号同步到真实账号，未连接则保存在「我的收藏」。
- 后台预取与本地缓存，重开面板秒开，刷新按钮取实时数据。

后续版本的详细变更见 [CHANGELOG.md](CHANGELOG.md)。

## 可选设置

一般不需要改。需要时在 profile 的 `cordis.patch.yml` 里给这个插件加一段 config：

```yaml
- id: github-trending-masonry
  name: dsh-github-trending-masonry
  config:
    ttlMinutes: 30        # 榜单缓存多久刷新一次，5..1440，默认 30 分钟
    summaries: true       # 是否让模型写简介；关掉后显示 README 摘录的翻译
    summaryProvider: ''   # 换用别的模型服务
    summaryModel: ''      # 换用别的模型
    summaryConcurrency: 6 # 同时进行的模型调用数，1..8
    summaryTimeoutMs: 60000
    dataDir: ''           # 缓存与收藏的存放目录
    token: ''             # 不想在界面里填 token 时可在这里写死
```

没有在界面里连接账号时，环境变量 `GITHUB_TOKEN` / `GH_TOKEN` 也会被使用。

## 数据与隐私

- 榜单缓存、简介缓存、「我的收藏」和账号信息都只存在本机 profile 的
  `plugin-data/github-trending-masonry/` 目录里。
- GitHub token 保存在 DSH 的凭据服务中；凭据服务不可用时，退回本机上一个只有当前用户能读的 JSON 文件。除了 GitHub 本身，插件不会把 token 发往任何地方。
- 项目简介由 DSH 自身的模型服务生成，不需要你另外准备 API Key。

## 几点说明

- 每个榜单首次加载时会让模型写简介，会产生少量 token 消耗（一个榜单 11–25 次，只在遇到新项目时发生）；结果会被缓存。可以在设置里用 `summaries: false` 完全关掉。
- 插件只记录它自己发出的加星操作。你以前在 GitHub 上加过星的仓库，卡片上会显示为未加星，点一下即恢复；重复加星不会出错。
- 如果 GitHub 改动了 Trending 页面的结构，面板会继续显示上一次缓存的榜单，待适配后自动恢复。

---

Trending 数据的抓取思路参考了 MIT 协议的 `@royalsan/dsh-github-trending` 插件；本插件为独立实现，界面、数据模型与缓存方式均为自己的方案。