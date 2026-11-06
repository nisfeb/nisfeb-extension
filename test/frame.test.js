//  The policies that keep a published page from reaching outside hosts.
//  npm run frame drives them in a browser; these keep the text from
//  drifting between runs of it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const policy = (html) => (/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html) || [])[1] || ''

test('frame.html loads nothing from outside', () => {
  const p = policy(read('frame.html'))
  assert.match(p, /(^|; )default-src 'none'(;|$)/)
  for (const d of p.split(/;\s*/)) {
    const [name, ...src] = d.split(/\s+/)
    for (const s of src) assert.match(s, /^('self'|'unsafe-inline'|'unsafe-eval'|'none'|data:|blob:)$/, `${name} ${s}`)
  }
})

test('frame-open.html is frame.html without the policy', () => {
  const strict = read('frame.html').replace(/<!--[\s\S]*?-->\n/, '').replace(/<meta http-equiv[^>]*>\n/, '')
  assert.equal(read('frame-open.html'), strict)
})

test('the reader page keeps its frame on the extension', () => {
  assert.equal(policy(read('reader.html')), "frame-src 'self'")
})

test('both frame pages are sandboxed', () => {
  const { sandbox } = JSON.parse(read('manifest.json'))
  assert.deepEqual(sandbox.pages.sort(), ['frame-open.html', 'frame.html'])
})
