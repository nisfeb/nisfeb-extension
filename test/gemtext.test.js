//  The in-browser reader's gemtext and link rules, case for case with
//  urb-fetch's renderGemtext (github.com/nisfeb/urb-fetch, urb.go).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gemtext, linkTarget, linkHref, readerPath } from '../lib/gemtext.js'

test('gemtext: each kind of line', () => {
  const page = [
    '# Title',
    '### Small',
    '#### Smaller still',
    'A paragraph.',
    '',
    '* one',
    '* two',
    'after the list',
    '> quoted',
    '=> urb://~zod/x  The x page',
    '=> /y',
    '=>',
    '```',
    '# not a heading',
    '  kept as is',
    '```',
  ].join('\r\n')
  assert.deepEqual(gemtext(page), [
    { kind: 'h1', text: 'Title' },
    { kind: 'h3', text: 'Small' },
    { kind: 'h3', text: 'Smaller still' },
    { kind: 'p', text: 'A paragraph.' },
    { kind: 'list', items: ['one', 'two'] },
    { kind: 'p', text: 'after the list' },
    { kind: 'quote', text: 'quoted' },
    { kind: 'link', href: 'urb://~zod/x', label: 'The x page' },
    { kind: 'link', href: '/y', label: '/y' },
    { kind: 'pre', text: '# not a heading\n  kept as is' },
  ])
})

test('gemtext: a fence never closed keeps its lines', () => {
  assert.deepEqual(gemtext('```\nraw'), [{ kind: 'pre', text: 'raw' }])
})

test('gemtext: a list ends at a fence', () => {
  assert.deepEqual(gemtext('* a\n```\nb\n```\n* c'), [
    { kind: 'list', items: ['a'] },
    { kind: 'pre', text: 'b' },
    { kind: 'list', items: ['c'] },
  ])
})

test('linkTarget: urb and http addresses as written', () => {
  assert.equal(linkTarget('urb://~zod/a', 'urb://~nec/b'), 'urb://~nec/b')
  assert.equal(linkTarget('urb://~zod/a', 'urb://~nec'), 'urb://~nec')
  assert.equal(linkTarget('urb://~zod/a', 'https://example.com/x'), 'https://example.com/x')
})

test('linkTarget: relative links resolve against the page', () => {
  assert.equal(linkTarget('urb://~zod/site/page', 'other'), 'urb://~zod/site/other')
  assert.equal(linkTarget('urb://~zod/site/page', '/top'), 'urb://~zod/top')
  assert.equal(linkTarget('urb://~zod/site/', 'inner'), 'urb://~zod/site/inner')
  assert.equal(linkTarget('urb://~zod/site/a/b', '../c'), 'urb://~zod/site/c')
  assert.equal(linkTarget('urb://~zod', 'notes'), 'urb://~zod/notes')
  assert.equal(linkTarget('urb://~zod/a', '/'), 'urb://~zod')
})

test('linkTarget: other schemes stay text', () => {
  for (const h of ['javascript:alert(1)', 'mailto:a@b.c', 'gemini://x', '//host/x', '', 'urb://not-a-ship']) {
    assert.equal(linkTarget('urb://~zod/a', h), '', h)
  }
})

test('readerPath: the address travels encoded', () => {
  assert.equal(readerPath('urb://~zod/a b'), 'reader.html?u=urb%3A%2F%2F~zod%2Fa%20b')
})

test('linkTarget: a control character cannot turn into another ship', () => {
  const base = 'urb://~sampel-palnet/a'
  for (const h of ['\x01x:-nec/page', '\x01javascript:alert(1)', '\x01//evil', '\\\\evil.example/x', '/\\evil']) {
    assert.equal(linkTarget(base, h), '', JSON.stringify(h))
  }
})

test('linkTarget: schemes are lower-cased, ship names checked', () => {
  assert.equal(linkTarget('urb://~zod/a', 'URB://~nec/x'), 'urb://~nec/x')
  assert.equal(linkTarget('urb://~zod/a', 'HTTPS://example.com/x'), 'https://example.com/x')
  assert.equal(linkTarget('urb://~zod/a', 'urb://~zodi/x'), '')
})

test('linkHref: mail and gemini links as written, as in Markdown', () => {
  const base = 'urb://~zod/a'
  assert.equal(linkHref(base, 'MAILTO:a@b.c'), 'mailto:a@b.c')
  assert.equal(linkHref(base, 'gemini://x/y'), 'gemini://x/y')
  assert.equal(linkHref(base, 'urb://~nec/b'), readerPath('urb://~nec/b'))
  assert.equal(linkHref(base, '\x01x:-nec/page'), null)
  assert.equal(linkHref(base, 'javascript:alert(1)'), null)
})
