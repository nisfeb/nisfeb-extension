import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isShip, parseShips, slug, wallMs, calendarPoke, clipMarkdown, quoted,
  escapeXml, draftId, patternFor, normaliseOrigin, capBytes, readKey,
  isWhom, daOf, dotted, chatText, chatStory, chatPoke, chatList, pokeAck, Ship, ApiError,
} from '../lib/ship.js'

test('ships', () => {
  for (const s of ['~zod', '~marzod', '~sampel-palnet', '~mister-botter-dozzod-nisfeb']) assert.ok(isShip(s), s)
  for (const s of ['zod', '~zod-zod', '~sampel-pal', '~Sampel-palnet', '~a-b-c']) assert.equal(isShip(s), false, s)
  assert.deepEqual(parseShips('zod, ~marzod  ~sampel-palnet bogus-name ~zod'),
    { ships: ['~zod', '~marzod', '~sampel-palnet'], bad: ['~bogus-name'] })
})

test('origins', () => {
  assert.equal(normaliseOrigin(' http://127.0.0.1:8081/apps/auspex/?x=1 '), 'http://127.0.0.1:8081')
  assert.equal(patternFor('http://127.0.0.1:8081'), 'http://127.0.0.1/*')
  assert.throws(() => normaliseOrigin('file:///etc/passwd'))
})

test('slug', () => {
  assert.equal(slug('https://Example.com/a/b?x=1#f'), 'example-com-a-b')
  assert.equal(slug('nope'), 'clip')
})

test('calendar bodies pack the wall clock as UTC, as the calendar page does', () => {
  assert.equal(wallMs('2026-09-24', '15:30'), Date.UTC(2026, 8, 24, 15, 30))
  assert.deepEqual(
    calendarPoke({ kind: 'event', name: 'x', date: '2026-09-24', time: '15:30', minutes: 45, note: 'n' }),
    { action: 'add-event', meta: { name: 'x', note: 'n' }, kind: 'once', args: {}, cat: 'timed',
      start_ms: Date.UTC(2026, 8, 24, 15, 30), fin: 'dur', dur_min: 45 })
  const all = calendarPoke({ kind: 'event', name: 'x', date: '2026-09-24' })
  assert.equal(all.cat, 'allday')
  assert.equal(all.span_days, 1)
  assert.deepEqual(calendarPoke({ kind: 'task', name: 'x', date: '2026-09-24' }),
    { action: 'add-event', meta: { name: 'x' }, cat: 'todo', due_ms: Date.UTC(2026, 8, 24) })
})

test('what travels', () => {
  assert.equal(quoted({ sel: ' a\nb ', url: 'u' }), 'a\nb\n\nu')
  assert.equal(quoted({ sel: '', url: 'u' }), 'u')
  assert.equal(clipMarkdown({ title: 'T', url: 'u', sel: 'a\nb', day: 'd' }),
    '# T\n\n*clipped from <u> on d*\n\n---\n\n> a\n> b\n')
  assert.equal(escapeXml('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;')
  assert.match(draftId(), /^0v[0-9a-v]{5}\.[0-9a-v]{5}\.[0-9a-v]{5}$/)
  assert.equal(capBytes('abc', 10), 'abc')
  const capped = capBytes('é'.repeat(100), 51)
  assert.ok(new TextEncoder().encode(capped).length <= 51)
  assert.ok(capped.length >= 20)
})

test('a selection is its own read', () => {
  assert.equal(readKey('u', ''), 'u')
  assert.equal(readKey('u', ' a '), readKey('u', 'a'))
  assert.notEqual(readKey('u', 'a'), readKey('u', 'b'))
  assert.notEqual(readKey('u', 'a'), 'u')
})

//  ── Tlon chat, pinned to Talon's shapes ─────────────────────────────

//  UrbitTimeTest: unixMsToDa(0) is the epoch. The second vector was
//  worked in python from the same formula, (epoch + ms * 2^64 // 1000).
test('a post id is ~author/<dotted @da of the send>', () => {
  assert.equal(daOf(0), 170141184475152167957503069145530368000n)
  assert.equal(dotted(daOf(1777055041699)), '170.141.184.507.933.047.516.619.777.522.115.840.835')
  assert.equal(dotted('1234567'), '1.234.567')
  assert.equal(dotted('123'), '123')
})

test('what a message can go to', () => {
  for (const w of ['~zod', '~sampel-palnet', '~dasres-ragnep--lislyt-ribpyl', '0v4.abcde.12345', 'chat/~zod/general-1a2']) assert.ok(isWhom(w), w)
  for (const w of ['zod', 'heap/~zod/pics', 'diary/~zod/notes', 'chat/zod/x', '~zod/flag', '0vz', '']) assert.equal(isWhom(w), false, w)
})

test('a page becomes the selection quoted, then the title and the address', () => {
  assert.equal(chatText({ sel: '', title: 'T', url: 'https://x.io/a' }), 'T\nhttps://x.io/a')
  assert.equal(chatText({ sel: '', title: 'https://x.io/a', url: 'https://x.io/a' }), 'https://x.io/a')
  assert.equal(chatText({ sel: ' one\ntwo ', title: 'T', url: 'u' }), '> one\n> two\n\nT\nu')
})

//  ChatStory.kt chatTextToStory and Markdown.kt's bare-URL link
//  {link: {href, content}}: lines joined by {break: null}, a blank line a
//  new verse, `> ` lines one blockquote.
test('the story is ChatStory.kt\'s', () => {
  assert.deepEqual(chatStory('Title\nhttps://x.io/a?b=1.'), [
    { inline: ['Title', { break: null }, { link: { href: 'https://x.io/a?b=1', content: 'https://x.io/a?b=1' } }, '.'] },
  ])
  assert.deepEqual(chatStory('> one\n> two\n\nsee (urb://~zod/x) and ~sampel-palnet'), [
    { inline: [{ blockquote: ['one', { break: null }, 'two'] }] },
    { inline: ['see (', { link: { href: 'urb://~zod/x', content: 'urb://~zod/x' } }, ') and ~sampel-palnet'] },
  ])
  //  a paren the address opened stays in it; a word before it is no boundary
  assert.deepEqual(chatStory('https://en.wikipedia.org/wiki/X_(y) xhttps://no'), [
    { inline: [{ link: { href: 'https://en.wikipedia.org/wiki/X_(y)', content: 'https://en.wikipedia.org/wiki/X_(y)' } }, ' xhttps://no'] },
  ])
  assert.deepEqual(chatStory(''), [{ inline: [] }])
})

const SENT = 1777055041699
const ID = '~zod/170.141.184.507.933.047.516.619.777.522.115.840.835'
const CONTENT = [{ inline: ['hi'] }]
//  WireShapes.kt buildEssay
const ESSAY = { content: CONTENT, author: '~zod', sent: SENT, kind: '/chat', meta: null, blob: null }

test('a DM is chat-dm-action-2: {ship, diff: {id, delta: {add: {essay, time: null}}}}', () => {
  //  the author keeps its ~ whichever form the ship's name came in
  for (const me of ['~zod', 'zod']) {
    assert.deepEqual(chatPoke({ whom: '~sampel-palnet', me, content: CONTENT, sent: SENT }), {
      app: 'chat', mark: 'chat-dm-action-2',
      json: { ship: '~sampel-palnet', diff: { id: ID, delta: { add: { essay: ESSAY, time: null } } } },
    })
  }
})

test('a group DM is chat-club-action-2 with the uid 0v4 sentinel', () => {
  assert.deepEqual(chatPoke({ whom: '0v4.abcde', me: '~zod', content: CONTENT, sent: SENT }), {
    app: 'chat', mark: 'chat-club-action-2',
    json: { id: '0v4.abcde', diff: { uid: '0v4', delta: { writ: { id: ID, delta: { add: { essay: ESSAY, time: null } } } } } },
  })
})

test('a channel post is channel-action-2 to %channels, with no id', () => {
  assert.deepEqual(chatPoke({ whom: 'chat/~bus/general', me: '~zod', content: CONTENT, sent: SENT }), {
    app: 'channels', mark: 'channel-action-2',
    json: { channel: { nest: 'chat/~bus/general', action: { post: { add: ESSAY } } } },
  })
  assert.throws(() => chatPoke({ whom: 'heap/~bus/pics', me: '~zod', content: CONTENT, sent: SENT }))
})

//  /dm: a list of ships. /clubs: id -> {team, meta}. /v3/groups: flag ->
//  {meta, channels: nest -> {meta}}, as GroupsScryParser reads it.
test('the chat list, from the three scries', () => {
  const list = chatList({
    dms: ['~sampel-palnet', 42],
    clubs: { '0v4.aaaaa': { team: ['~zod', '~bus'], meta: { title: '' } }, '0v4.bbbbb': { meta: { title: 'Pals' } } },
    groups: {
      '~bus/club': {
        meta: { title: 'Bus Club' },
        seats: { '~zod': {} },
        channels: {
          'chat/~bus/general': { meta: { title: 'General' } },
          'chat/~bus/untitled-1': { meta: { title: ' ' } },
          'heap/~bus/pics': { meta: { title: 'Pics' } },
          'buckets/~bus/files': { meta: { title: 'Files' } },
        },
      },
      '~nec/club': { meta: { title: 'Bus Club' }, channels: { 'chat/~nec/general': { meta: { title: 'General' } } } },
      '~fed/bare': { channels: { 'chat/~fed/x': {} } },
    },
  })
  assert.deepEqual(list, [
    { whom: '~sampel-palnet', title: '~sampel-palnet' },
    { whom: '0v4.aaaaa', title: '~zod, ~bus' },
    { whom: '0v4.bbbbb', title: 'Pals' },
    { whom: 'chat/~bus/general', title: 'Bus Club / General (chat/~bus/general)' },
    { whom: 'chat/~bus/untitled-1', title: 'Bus Club / untitled-1' },
    { whom: 'chat/~nec/general', title: 'Bus Club / General (chat/~nec/general)' },
    { whom: 'chat/~fed/x', title: '~fed/bare / x' },
  ])
  assert.deepEqual(chatList({}), [])
})

//  UrbitChannel.settlePokeAck: {"id":n,"response":"poke","ok"|"err"}.
test('the poke answer, read off the event stream', () => {
  assert.deepEqual(pokeAck('id: 0\ndata: {"id":1,"response":"poke","ok":"ok"}', 1), { ok: true })
  assert.deepEqual(pokeAck('id: 3\ndata: {"id":1,"response":"poke","err":"bad-key\\n/app/chat"}', 1), { err: 'bad-key\n/app/chat' })
  assert.equal(pokeAck('data: {"id":2,"response":"poke","ok":"ok"}', 1), null)
  assert.equal(pokeAck('data: {"id":1,"response":"diff","json":{}}', 1), null)
  assert.equal(pokeAck(': heartbeat', 1), null)
})

//  The channel flow against a stand-in eyre: the PUT, the stream (split
//  mid-frame, after a heartbeat), the delete. A stream that is cut off
//  errors on abort, as a real fetch's body does.
function eyre(chunks) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method || 'GET', body: init.body && JSON.parse(init.body), accept: init.headers && init.headers.accept, credentials: init.credentials })
    if (init.method === 'PUT') return new Response(null, { status: 204 })
    return new Response(new ReadableStream({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x))
        init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
      },
    }), { status: 200 })
  }
  return calls
}

test('a poke goes on a channel of its own, is answered off its stream, and the channel is deleted', async () => {
  const poke = { ship: '~zod', app: 'chat', mark: 'chat-dm-action-2', json: { x: 1 } }
  let calls = eyre([': hi\n\n', 'id: 0\ndata: {"id":1,"respo', 'nse":"poke","ok":"ok"}\n\n'])
  assert.equal(await new Ship('http://ship.test:8080').poke(poke), true)
  assert.equal(calls.length, 3)
  const [put, get, del] = calls
  assert.match(put.url, /^http:\/\/ship\.test:8080\/~\/channel\/nisfeb-\d+-[0-9a-f]+$/)
  //  the envelope's ship is bare
  assert.deepEqual(put.body, [{ id: 1, action: 'poke', ship: 'zod', app: 'chat', mark: 'chat-dm-action-2', json: { x: 1 } }])
  assert.equal(put.credentials, 'include')
  assert.deepEqual([get.url, get.method, get.accept], [put.url, 'GET', 'text/event-stream'])
  assert.deepEqual([del.url, del.method, del.body], [put.url, 'PUT', [{ id: 2, action: 'delete' }]])

  calls = eyre(['data: {"id":1,"response":"poke","err":"\\nbad-key\\n/app/chat/hoon"}\n\n'])
  await assert.rejects(new Ship('http://ship.test').poke(poke), (e) => e instanceof ApiError && e.message === '%chat refused it: bad-key' && !e.signedOut)
  assert.deepEqual(calls.at(-1).body, [{ id: 2, action: 'delete' }])

  calls = eyre([': hi\n\n'])
  assert.equal(await new Ship('http://ship.test').poke(poke, 50), false)
  assert.deepEqual(calls.at(-1).body, [{ id: 2, action: 'delete' }])
})

test('a signed-out poke is refused at the PUT, and nothing else is asked', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push(init.method); return new Response('', { status: 403 }) }
  await assert.rejects(new Ship('http://ship.test').poke({ ship: 'zod', app: 'chat', mark: 'm', json: {} }), (e) => e.signedOut)
  assert.deepEqual(calls, ['PUT'])
})

//  scryNewest: /v3/groups, then /v2/groups only where the ship says it
//  does not serve it (404 or 500). A timeout or a 502 is the ship.
test('the groups scry falls back only on a path the ship does not serve', async () => {
  const asked = []
  const answers = { '/chat/dm': [], '/chat/clubs': {}, '/groups/v3/groups': 500, '/groups/v2/groups': { '~bus/g': { channels: { 'chat/~bus/x': {} } } } }
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname.replace(/^\/~\/scry/, '').replace(/\.json$/, '')
    asked.push(p)
    const a = answers[p]
    return typeof a === 'number' ? new Response('', { status: a }) : Response.json(a)
  }
  assert.deepEqual(await new Ship('http://ship.test').chats(), [{ whom: 'chat/~bus/x', title: '~bus/g / x' }])
  assert.ok(asked.includes('/groups/v2/groups'))
  asked.length = 0
  answers['/groups/v3/groups'] = 502
  await assert.rejects(new Ship('http://ship.test').chats(), (e) => e.status === 502)
  assert.equal(asked.includes('/groups/v2/groups'), false)
})
