import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

//  lib/links.js is a classic script (content scripts cannot be modules):
//  run it in a context of its own and take the function it defines.
const ctx = vm.createContext({})
vm.runInContext(readFileSync(new URL('../lib/links.js', import.meta.url), 'utf8'), ctx)
//  Plain objects, so deepEqual does not trip on the context's prototypes.
const links = (text, origin, gateway) => JSON.parse(JSON.stringify(ctx.urbitLinks(text, origin, gateway)))
const texts = (text, origin = 'https://ship.test') => links(text, origin).map((l) => l.text)
const S = 'https://ship.test'

//  UrbLink.kt: urb:// and no whitespace, quotes, angle brackets or
//  backticks; trailing .,;:!? off; a ) off only when the run has no (.
test('urb:// runs, as Talon finds them', () => {
  assert.deepEqual(links('see urb://~zod/notes/a, then', S), [{
    start: 4, end: 22, text: 'urb://~zod/notes/a', href: 'urb://~zod/notes/a',
    web: 'https://ship.test/apps/lattice?url=urb%3A%2F%2F~zod%2Fnotes%2Fa',
  }])
  assert.deepEqual(texts('(urb://~zod/x) and urb://~zod/a(b). "urb://~zod/q"'), ['urb://~zod/x', 'urb://~zod/a(b)', 'urb://~zod/q'])
  assert.deepEqual(texts('urb:// alone, and urb://.'), [])
  //  without a ship the address still links; there is no ship copy
  assert.deepEqual(links('urb://~zod', ''), [{ start: 0, end: 10, text: 'urb://~zod', href: 'urb://~zod', web: '' }])
})

//  FurumLink.kt's SHORT, opening at FurumRef.pageUrl on the reader's ship.
test('furum shorthand, opened on the reader\'s ship', () => {
  assert.deepEqual(links('read f/~sampel-palnet/cats/42 now', S), [{
    start: 5, end: 29, text: 'f/~sampel-palnet/cats/42', href: 'https://ship.test/apps/furum/b/~sampel-palnet/cats/42', web: '',
  }])
  assert.deepEqual(texts('f/~zod/cats-'), ['f/~zod/cats'])
  assert.deepEqual(texts('f/~zod/cats.'), ['f/~zod/cats'])
  for (const no of ['~zod/cats', 'elf/~zod/cats', 'x/f/~zod/cats', 'f/~zod/cats/more', 'https://a.io/apps/furum/b/~zod/cats', 'f/~zod/Cats', 'f/~zod/9lives']) {
    assert.deepEqual(texts(no), [], no)
  }
  //  no ship, nowhere to open it: it stays text
  assert.deepEqual(links('f/~zod/cats', ''), [])
})

test('where two overlap, the first to start wins', () => {
  assert.deepEqual(texts('(urb://x)f/~zod/b f/~nec/c'), ['urb://x)f/~zod/b', 'f/~nec/c'])
})

//  urb-fetch (github.com/nisfeb/urb-fetch, urb.go gatewayURL): urb://~ship/path
//  at http://ship.urb.localhost:<port>/path. Comets' names have a double dash.
test('urb-fetch as the reader', () => {
  const G = 8475
  assert.deepEqual(links('see urb://~zod/notes/a, then', S, G)[0].web, 'http://zod.urb.localhost:8475/notes/a')
  assert.equal(links('urb://~zod', '', G)[0].web, 'http://zod.urb.localhost:8475/')
  assert.equal(links('urb://~sampel-palnet/site/?raw#top', '', 9000)[0].web, 'http://sampel-palnet.urb.localhost:9000/site/?raw#top')
  assert.equal(links('urb://~doznec-dozzod-dozzod-dozzod--dozzod-dozzod-dozzod-dozzod/x', '', G)[0].web,
    'http://doznec-dozzod-dozzod-dozzod--dozzod-dozzod-dozzod-dozzod.urb.localhost:8475/x')
  //  no ship in the address, no reader copy; furum still needs the ship
  assert.equal(links('urb://zod/x', S, G)[0].web, '')
  assert.deepEqual(links('f/~zod/cats', '', G), [])
})

//  The worker's omnibox uses lib/ship.js's copy of the rule.
test('the worker and the link script agree on urb-fetch addresses', async () => {
  const { urbGatewayUrl } = await import('../lib/ship.js')
  for (const addr of ['urb://~zod', 'urb://~zod/', 'urb://~sampel-palnet/a/b?c#d', 'urb://zod/x', 'urb://~Zod/x', 'https://~zod/x', 'urb://~', '']) {
    for (const port of [8475, 0]) assert.equal(urbGatewayUrl(addr, port), ctx.urbGatewayUrl(addr, port), `${addr} ${port}`)
  }
  assert.equal(urbGatewayUrl('urb://~zod/x', 0), '')
})
