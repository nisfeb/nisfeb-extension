//  The reader's Markdown subset, case for case with urb-fetch's
//  renderMarkdown (github.com/nisfeb/urb-fetch, urb.go), the nodes it is
//  built as, and how each mark a page is published under renders.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdown, mdNodes, safeLink, spans } from '../lib/markdown.js'
import { renderAs } from '../lib/mesa.mjs'

//  Just enough of a document for mdNodes: elements with a name, children
//  and textContent, and attributes set as properties. innerHTML throws, so
//  a test fails if anything ever reaches for it.
function fakeDoc() {
  const made = []
  const doc = {
    made,
    createElement(name) {
      const e = {
        name,
        children: [],
        append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? { text: x } : x) },
        set textContent(t) { this.children = [{ text: String(t) }] },
        get textContent() { return this.children.map((c) => c.text ?? c.textContent).join('') },
        set innerHTML(_) { throw new Error('innerHTML') },
      }
      made.push(e)
      return e
    },
  }
  return doc
}

const ALLOWED = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'code', 'strong', 'em', 'a'])
const hrefAsIs = (t) => t

test('renderAs: each mark, and no mark as %gmi', () => {
  assert.equal(renderAs('md', '# hi'), 'md')
  assert.equal(renderAs('html', 'no tags'), 'html')
  assert.equal(renderAs('text', '<b>x</b>'), 'text')
  assert.equal(renderAs('css', 'a{}'), 'text')
  assert.equal(renderAs('js', 'alert(1)'), 'text')
  assert.equal(renderAs('noun', '0'), 'text')
  assert.equal(renderAs('gmi', '# gem'), 'gmi')
  assert.equal(renderAs('gmi', '  <!doctype html><p>old'), 'html')   //  a pre-74 page in HTML
  assert.equal(renderAs(undefined, '# gem'), 'gmi')                  //  a /k/ or /t/ read
  assert.equal(renderAs(undefined, '<p>x'), 'html')
})

test('markdown: each kind of block', () => {
  const page = [
    '# Title #',
    '###### Six',
    '####### not a heading',
    'A paragraph',
    'that goes on.',
    '',
    '- one',
    '* two',
    '1. first',
    '2) second',
    '---',
    '> quoted *gently*',
    '```js',
    '# not a heading',
    '  kept as is',
    '```',
  ].join('\r\n')
  assert.deepEqual(markdown(page), [
    { kind: 'h1', spans: [{ text: 'Title' }] },
    { kind: 'h6', spans: [{ text: 'Six' }] },
    { kind: 'p', spans: [{ text: '####### not a heading A paragraph that goes on.' }] },
    { kind: 'ul', items: [[{ text: 'one' }], [{ text: 'two' }]] },
    { kind: 'ol', items: [[{ text: 'first' }], [{ text: 'second' }]] },
    { kind: 'hr' },
    { kind: 'quote', spans: [{ text: 'quoted ' }, { em: 'gently' }] },
    { kind: 'pre', text: '# not a heading\n  kept as is' },
  ])
})

test('markdown: inline code, bold, italics and links', () => {
  assert.deepEqual(spans('a `b*c*` **d** *e* [f](urb://~zod/g) h'), [
    { text: 'a ' }, { code: 'b*c*' }, { text: ' ' }, { strong: 'd' }, { text: ' ' },
    { em: 'e' }, { text: ' ' }, { link: 'urb://~zod/g', text: 'f' }, { text: ' h' },
  ])
})

test('markdown: a fence never closed keeps its lines', () => {
  assert.deepEqual(markdown('text\n```\nraw\n<b>'), [
    { kind: 'p', spans: [{ text: 'text' }] },
    { kind: 'pre', text: 'raw\n<b>' },
  ])
})

test('safeLink: the web, urb://, gemini, mail and paths only', () => {
  for (const t of ['http://a.b', 'https://a.b/c', 'urb://~zod/x', 'gemini://a.b', 'mailto:a@b.c', '/path', 'rel/path', '#frag', 'javascript&#58;alert(1)']) {
    assert.equal(safeLink(t), true, t)
  }
  for (const t of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', '\x01javascript:alert(1)',
    'java\0script:alert(1)', '//evil.example', '\\\\evil.example', '/\\evil.example', 'HTTP://a.b', 'file:///etc/passwd', 'chrome-extension://x/y']) {
    assert.equal(safeLink(t), false, JSON.stringify(t))
  }
})

test('markdown: hostile links are text', () => {
  const body = [
    '[click](javascript:alert(1))',
    '[data](data:text/html;base64,PHNjcmlwdD4=)',
    '[off](//evil.example/x)',
    '[ok](https://example.com)',
  ].join('\n\n')
  const blocks = markdown(body)
  assert.deepEqual(blocks.map((b) => b.spans), [
    [{ text: 'click' }, { text: ')' }],     //  the target stops at the first ), as urb-fetch's does
    [{ text: 'data' }],
    [{ text: 'off' }],
    [{ link: 'https://example.com', text: 'ok' }],
  ])
})

test('mdNodes: raw HTML is text, and only fixed elements are made', () => {
  const doc = fakeDoc()
  const body = [
    '<script>alert(1)</script>',
    '# <img src=x onerror=alert(1)>',
    '- <iframe src="javascript:alert(1)">',
    '> <style>body{display:none}</style>',
    '**<b>bold</b>** *<svg onload=alert(1)>* `<a href=x>`',
    '',
    '[<script>x</script>](urb://~zod/p) [js](javascript:alert(1))',
    '```',
    '</pre><script>alert(1)</script>',
    '```',
  ].join('\n')
  const nodes = mdNodes(doc, body, hrefAsIs)
  for (const e of doc.made) assert.ok(ALLOWED.has(e.name), e.name)
  assert.equal(nodes[0].name, 'p')
  assert.equal(nodes[0].textContent, '<script>alert(1)</script>')
  assert.equal(nodes[1].name, 'h1')
  assert.equal(nodes[1].textContent, '<img src=x onerror=alert(1)>')
  assert.equal(nodes[2].children[0].textContent, '<iframe src="javascript:alert(1)">')
  assert.equal(nodes[3].name, 'blockquote')
  const inline = nodes[4].children
  assert.deepEqual(inline.map((c) => c.name || 'text'), ['strong', 'text', 'em', 'text', 'code'])
  assert.equal(inline[0].textContent, '<b>bold</b>')
  const links = nodes[5].children
  assert.equal(links[0].name, 'a')
  assert.equal(links[0].href, 'urb://~zod/p')
  assert.equal(links[0].rel, 'noopener noreferrer')
  assert.equal(links[0].textContent, '<script>x</script>')
  assert.ok(!links.some((c) => c.name === 'a' && /javascript/i.test(c.href)))
  assert.equal(nodes[6].name, 'pre')
  assert.equal(nodes[6].textContent, '</pre><script>alert(1)</script>')
  assert.equal(doc.made.filter((e) => e.name === 'a').length, 1)
})

test('mdNodes: a link hrefFor refuses is text, and a reader link keeps its referrer', () => {
  const doc = fakeDoc()
  const [p] = mdNodes(doc, '[a](/x) [b](https://y.z)', (t) => (t === '/x' ? 'reader.html?u=x' : null))
  assert.equal(p.children[0].name, 'a')
  assert.equal(p.children[0].href, 'reader.html?u=x')
  assert.equal(p.children[0].rel, undefined)
  assert.deepEqual(p.children.slice(1), [{ text: ' ' }, { text: 'b' }])
})

test('markdown: deep nesting stays flat', () => {
  const n = 5000
  const body = [
    '>'.repeat(n) + ' deep',
    Array.from({ length: n }, (_, i) => ' '.repeat(i) + '- level').join('\n'),
    '',
    '*'.repeat(n) + 'x' + '*'.repeat(n),
    '['.repeat(n) + 'a' + ']'.repeat(n) + '(urb://~zod/x)',
    '**'.repeat(n) + '`'.repeat(n),
  ].join('\n')
  const doc = fakeDoc()
  const nodes = mdNodes(doc, body, hrefAsIs)
  const depth = (e) => 1 + Math.max(0, ...(e.children || []).filter((c) => c.name).map(depth))
  for (const e of nodes) assert.ok(depth(e) <= 3, `${e.name} nests ${depth(e)} deep`)
  assert.equal(nodes[0].name, 'blockquote')
  assert.equal(nodes[0].textContent, '>'.repeat(n - 1) + ' deep')
  assert.equal(nodes[1].name, 'ul')
  assert.equal(nodes[1].children.length, n)
})

test('markdown: hostile long lines take linear time', () => {
  const n = 100000
  for (const line of ['# a' + ' '.repeat(n) + 'x', '['.repeat(n), '[a]('.repeat(n / 4), '](a'.repeat(n / 3), '*a'.repeat(n / 2), '-'.repeat(n) + 'x']) {
    const t = performance.now()
    markdown(line)
    assert.ok(performance.now() - t < 2000, `${JSON.stringify(line.slice(0, 12))}... took ${performance.now() - t} ms`)
  }
})
