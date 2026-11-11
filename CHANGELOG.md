# Changelog

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