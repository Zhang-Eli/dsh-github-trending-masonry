# Changelog

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