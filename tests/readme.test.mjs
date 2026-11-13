import assert from 'node:assert/strict'
import test from 'node:test'

import { extractHeaderImage, extractReadme } from '../lib/readme.js'

test('markdown banner resolves relative to the repository raw tree', () => {
  const raw = '# Project\n\n![banner](assets/banner.png)\n\nSome intro text here.\n'
  assert.equal(
    extractHeaderImage(raw, 'foo/bar'),
    'https://raw.githubusercontent.com/foo/bar/HEAD/assets/banner.png',
  )
})

test('badge rows are skipped and the first real image wins', () => {
  const raw = '# P\n[![CI](https://img.shields.io/badge/build-passing-green.svg)](https://actions)\n![hero](docs/hero.webp)\n'
  assert.equal(extractHeaderImage(raw, 'a/b'), 'https://raw.githubusercontent.com/a/b/HEAD/docs/hero.webp')
})

test('absolute urls pass through; odd schemes and unresolved relatives are dropped', () => {
  assert.equal(
    extractHeaderImage('![x](https://github.com/user-attachments/assets/abc)', 'a/b'),
    'https://github.com/user-attachments/assets/abc',
  )
  assert.equal(extractHeaderImage('![x](data:image/png;base64,AAAA)', 'a/b'), null)
  assert.equal(extractHeaderImage('![x](relative.png)', undefined), null)
  assert.equal(extractHeaderImage('![x](//cdn.test/banner.png)', 'a/b'), 'https://cdn.test/banner.png')
})

test('small html images, favicons and text-first READMEs give no header image', () => {
  assert.equal(extractHeaderImage('<img src="https://x.test/logo.png" width="32">', 'a/b'), null)
  assert.equal(extractHeaderImage('![icon](favicon.ico)\n', 'a/b'), null)
  assert.equal(extractHeaderImage('# Title\n\nJust a plain intro paragraph and nothing else.\n', 'a/b'), null)
})

test('images inside code fences near the top are not header art', () => {
  const raw = '# Demo\n\n```md\n![fake](docs/example.png)\n```\n\nDemo does one thing well and keeps doing it for a long while indeed.\n'
  assert.equal(extractHeaderImage(raw, 'a/b'), null)
})

test('extractReadme carries the image without touching intro/features', () => {
  const readme =
    '# Demo\n\n![logo](https://example.com/logo.png)\n\nDemo does one thing well and keeps on doing it for a long while indeed, reliably.\n'
  const out = extractReadme(readme, 'a/b')
  assert.equal(out.image, 'https://example.com/logo.png')
  assert.ok(out.intro && out.intro.includes('Demo does one thing'))
  assert.ok(Array.isArray(out.features))
})
