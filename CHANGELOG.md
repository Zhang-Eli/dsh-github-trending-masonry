# Changelog

## 0.3.2 - 2026-11-19

- README screenshots refreshed from the current UI: the light-theme
  panel in the elevated Material style, the dark-theme panel in flat style.
  Captions in both READMEs now describe the pair. No code changes.

## 0.3.1 - 2026-11-18

- The owner renamed their GitHub account to `wzvx`. The panel footer
  (author name, avatar, repo and feedback links) and the npm metadata
  (`repository`, `homepage`, `bugs`) now all point at
  `github.com/wzvx/dsh-github-trending-masonry`, so the marketplace keeps
  the fast registry install path after the rename.
- `.local/` (runtime image mirror and state written by the plugin host) is
  now gitignored.

## 0.3.0 - 2026-11-17

- Card header art and owner avatars are now mirrored into the plugin's data
  directory (`images/` + `index.json`) and served from a new `/image` route
  with an ETag and a year-long immutable cache. Refreshing the feed reuses the
  files already on disk instead of re-downloading every README banner.
- The mirror is SSRF-guarded: public http(s) hosts only — no private or
  loopback addresses, no credentials, capped redirects and size. SVG is left
  remote (it renders fine directly).
- If the mirror ever fails to fetch, cards fall back to the original remote
  URL and then hide, so a blocked host can never blank a card silently.
- Masonry cards keep stable keys (`owner/repo`), so a rank change no longer
  remounts the card and force-reloads its image.
- DSH startup now warms the panel before it is ever opened: an unref'd timer
  refreshes the board you last viewed (honoring the cache TTL) and pre-mirrors
  its header art and avatars, so the first open paints immediately. Opt out
  with `warmup: false`; tune the delay with `warmupDelayMs`.
- Fixed a mirror index race: concurrent first-time fetches each started from a
  fresh empty index and the slower write silently dropped the faster one's
  entry. Index and state loads are single-flight now.

## 0.2.1 - 2026-11-17

- Waterfall packing: each card now joins the currently **shortest column**
  instead of strict round-robin, so the columns finish level. A tall card no
  longer drags its whole side below the other — e.g. rank 15 fills the free
  space beside rank 13 rather than stacking underneath it. Card heights are
  measured from the rendered DOM, cached per repository and column count and
  re-packed synchronously before paint; late-loading README header art
  re-measures and rebalances only when the packing actually changes, so the
  layout settles instead of oscillating. Rank order still reads left-to-right
  top-to-bottom as closely as balanced columns allow.

## 0.2.0

- Two UI styles, switchable in the panel toolbar and remembered across
  sessions: **flat** (hairline-bordered cards, the previous look) and
  **elevated** (Material Design elevation — cards, buttons, tabs, chips,
  dialogs and inputs float on layered shadows while borders recede; hovering
  a card raises it one step). Shadows and surfaces adapt to light and dark.
- Card header art: when a project README opens with a banner, hero screenshot
  or logo, the card shows it between the title row and the introduction.
  Badge rows are skipped and text-first READMEs render no image, so a card
  grows a picture only when the project actually has one. Starred collection
  entries snapshot the image too; existing README-cache entries upgrade
  themselves silently on first reuse; header art is shown in full (contain, capped at 360px tall).

## 0.1.2

Security hardening for the local panel routes, after a review by the
awesome-dsh-plugin maintainers.

- Every `/dsh-github-trending-masonry/*` handler now refuses requests that did
  not come from the panel itself: it delegates to the connection service's
  `requestRejection` when available and otherwise enforces a loopback peer,
  a loopback `Host`, a same-origin `Sec-Fetch-Site`/`Origin` check. This closes
  the cross-site and DNS-rebinding window opened by `webServer.register`.
- Mutating routes (`star`, `account`) require `Content-Type: application/json`
  and the documented HTTP method; everything else is answered with 405/415
  before any state or credential is touched.
- `/star` no longer falls back to an ambient `GITHUB_TOKEN`/`GH_TOKEN`; only a
  token the user explicitly connected (or configured) can star on their
  behalf. Ambient tokens remain read-only enrichment for the feed.
- Added `tests/security.test.mjs` covering the fence, method/content-type
  checks and the env-token rule.

## 0.1.1

- Panel footer: a "Feedback" link to the issue tracker on the left and a
  "Developed by" author avatar/credit on the right, separated from the content
  by a hairline. Labels are localized in both English and Chinese.

## 0.1.0

First public release.

- GitHub Trending panel rendered as a flat masonry of cards, with daily /
  weekly / monthly boards and category chips.
- Model-written introductions and feature bullets in the DSH UI language,
  cached per repository and language, with deterministic README extraction as
  the fallback when the model is unavailable.
- One-click star: connected GitHub account (Personal Access Token) or a
  local-only collection.
- Persistent feed cache (memory + disk, 30 minutes) plus a `localStorage`
  snapshot, so reopening the panel paints instantly.
- Background prefetch of the other two boards.