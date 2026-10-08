import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REFRESH_MS, due, mergeCards, statusOf, spendOf, ordered, moved, CARDS, calRows, okZone, ymd, agenda, calWindow,
  mailOf, actionsOf, balanceOf, money,
} from '../lib/today.js'
import { Ship, explain, chatChoices, sendToChat } from '../lib/ship.js'

//  ── the refresh throttle ────────────────────────────────────────────

test('the ship is read at most once in REFRESH_MS, whoever asks', () => {
  const now = 1_800_000_000_000
  const o = 'http://ship.test'
  assert.equal(due(null, o, now), true)
  assert.equal(due({ origin: 'http://other.test', tried: now }, o, now), true)
  assert.equal(due({ origin: o, tried: now - 1000 }, o, now), false)
  assert.equal(due({ origin: o, tried: now - REFRESH_MS + 1 }, o, now), false)
  assert.equal(due({ origin: o, tried: now - REFRESH_MS }, o, now), true)
  //  a clock that went back is no reason to wait for ever
  assert.equal(due({ origin: o, tried: now + 60000 }, o, now), true)
  assert.equal(REFRESH_MS, 300000)
})

test('a failed card keeps what it showed; one card never touches another', () => {
  const old = { cal: { at: 1, data: { rows: [1] }, error: '' }, mail: { at: 1, data: { unread: 2 }, error: '' } }
  const got = { cal: { error: 'HTTP 404', out: '' }, mail: { data: { unread: 3 } }, money: { error: 'Failed to fetch', out: 'unreachable' } }
  assert.deepEqual(mergeCards(old, got, 9), {
    cal: { at: 1, data: { rows: [1] }, error: 'HTTP 404' },
    mail: { at: 9, data: { unread: 3 }, error: '' },
    money: { error: 'Failed to fetch' },
  })
  assert.deepEqual(mergeCards(undefined, { cal: { error: 'x' } }, 9), { cal: { error: 'x' } })
})

test('the status is decided once for the five answers', () => {
  const ok = { data: 1 }
  const gone = { error: 'Failed to fetch', out: 'unreachable' }
  const out = { error: 'signed out', out: 'signed-out' }
  const missing = { error: 'HTTP 404', out: '' }
  assert.equal(statusOf([ok, gone, out]), 'signed-out')
  assert.equal(statusOf([ok, gone, missing]), 'connected')
  assert.equal(statusOf([gone, gone]), 'unreachable')
  assert.equal(statusOf([gone, missing]), null)
  assert.equal(statusOf([]), null)
})

//  ── the calendar, as window.json and calendar.js have it ────────────

const H = 3600000
const D = 24 * H
const NY = 'America/New_York'
//  a row as app.hoon's /window.json writes one
const row = (o) => ({ id: 'u', cal: 'default', idx: 0, meta: { name: o.name }, cat: 'timed', kind: 'once', all: false, done: false, alarms: [], ...o })

test('window rows keep what the card shows', () => {
  assert.deepEqual(calRows([row({ name: 'x', l: 1, r: 2 }), { meta: {}, l: 'no' }, null]), [{ name: 'x', cat: 'timed', all: false, done: false, l: 1, r: 2 }])
  assert.deepEqual(calRows([{ cat: 'todo', all: true, l: 5 }]), [{ name: '', cat: 'todo', all: true, done: false, l: 5, r: 5 }])
  assert.deepEqual(calRows({ rows: [] }), [])
})

test('zones: the calendar\'s when the browser knows it, else the browser\'s', () => {
  assert.equal(okZone(NY), NY)
  assert.equal(okZone(null), '')
  assert.equal(okZone('none'), '')
  assert.equal(okZone('Not/AZone'), '')
  assert.equal(ymd(Date.UTC(2026, 9, 8, 3), NY), '2026-10-07')
  assert.equal(ymd(Date.UTC(2026, 9, 8, 3), 'UTC'), '2026-10-08')
  const now = Date.UTC(2026, 9, 7, 18)
  assert.deepEqual(calWindow(now), { from: now - 2 * D, to: now + 3 * D })
})

test('what is on today: zone days for timed rows, UTC dates for whole days and tasks', () => {
  const rows = calRows([
    row({ name: 'standup', l: Date.UTC(2026, 9, 7, 13), r: Date.UTC(2026, 9, 7, 14) }), // 09:00 EDT, over by 14:00
    row({ name: 'call', l: Date.UTC(2026, 9, 7, 19), r: Date.UTC(2026, 9, 7, 20) }), // 15:00 EDT
    row({ name: 'late', l: Date.UTC(2026, 9, 8, 3), r: Date.UTC(2026, 9, 8, 3) }), // 23:00 EDT, tomorrow in UTC
    row({ name: 'trip', cat: 'allday', all: true, l: Date.UTC(2026, 9, 6), r: Date.UTC(2026, 9, 9) }),
    row({ name: 'yesterday', cat: 'allday', all: true, l: Date.UTC(2026, 9, 6), r: Date.UTC(2026, 9, 7) }),
    //  the 8th as a date, though its UTC midnight is the 7th's evening in New York
    row({ name: 'birthday', cat: 'date', all: true, l: Date.UTC(2026, 9, 8), r: Date.UTC(2026, 9, 9) }),
    //  starts today, ends tomorrow: today's, not tomorrow's first
    row({ name: 'overnight', l: Date.UTC(2026, 9, 8, 3, 30), r: Date.UTC(2026, 9, 8, 5) }),
    row({ name: 'pay rent', cat: 'todo', all: true, l: Date.UTC(2026, 9, 7), r: Date.UTC(2026, 9, 8) }),
    row({ name: 'done task', cat: 'todo', all: true, done: true, l: Date.UTC(2026, 9, 7), r: Date.UTC(2026, 9, 8) }),
    row({ name: 'breakfast', l: Date.UTC(2026, 9, 8, 12), r: Date.UTC(2026, 9, 8, 13) }), // 08:00 EDT tomorrow
    row({ name: 'lunch', l: Date.UTC(2026, 9, 8, 16), r: Date.UTC(2026, 9, 8, 17) }),
    row({ name: 'dinner', l: Date.UTC(2026, 9, 8, 22), r: Date.UTC(2026, 9, 8, 23) }),
  ])
  const at2pm = agenda(rows, Date.UTC(2026, 9, 7, 18), NY)
  assert.equal(at2pm.zone, NY)
  assert.deepEqual(at2pm.today.map((r) => [r.name, r.past]), [
    ['trip', false], ['pay rent', false], ['standup', true], ['call', false], ['late', false], ['overnight', false],
  ])
  assert.deepEqual(at2pm.tomorrow, [])
  //  from six in the evening, tomorrow's first three; the trip goes on
  assert.deepEqual(agenda(rows, Date.UTC(2026, 9, 7, 21, 59), NY).tomorrow, [])
  const at6pm = agenda(rows, Date.UTC(2026, 9, 7, 22), NY)
  assert.deepEqual(at6pm.tomorrow.map((r) => r.name), ['trip', 'birthday', 'breakfast'])
  //  at nine, the day's UTC midnight has passed: a whole day is never "over"
  const at9pm = agenda(rows, Date.UTC(2026, 9, 8, 1), NY)
  assert.deepEqual(at9pm.today.filter((r) => r.past).map((r) => r.name), ['standup', 'call'])
  //  the same rows in UTC: 23:00 EDT is the 8th there
  assert.deepEqual(agenda(rows, Date.UTC(2026, 9, 7, 18), 'UTC').today.map((r) => r.name), ['trip', 'pay rent', 'standup', 'call'])
  assert.deepEqual(agenda([], Date.UTC(2026, 9, 7, 18), NY), { zone: NY, today: [], tomorrow: [] })
  //  east of UTC a morning starts before the day's UTC midnight: whole days still come first
  const tokyo = calRows([
    row({ name: 'breakfast', l: Date.UTC(2026, 9, 6, 23), r: Date.UTC(2026, 9, 7, 0) }), // 08:00 JST on the 7th
    row({ name: 'holiday', cat: 'allday', all: true, l: Date.UTC(2026, 9, 7), r: Date.UTC(2026, 9, 8) }),
  ])
  assert.deepEqual(agenda(tokyo, Date.UTC(2026, 9, 7, 3), 'Asia/Tokyo').today.map((r) => r.name), ['holiday', 'breakfast'])
})

//  ── mail, orrery, armillary ─────────────────────────────────────────

test('mail waiting: the Inbox\'s unread count and the unread subjects on its newest page', () => {
  //  +serve-inbox's page, rows as +entry-json writes them
  const page = {
    total: 40, offset: 0, limit: 20, view: 'inbox', unread: 7, labels: ['work'],
    threads: [
      { id: '0v1', subject: 'Lunch?', from: '~sampel-palnet', snippet: 's', verdict: 'verified', forged: false, count: 1, last: 1700000000000, unread: true, participants: [], unreadable: 0, archived: false, labels: [] },
      { id: '0v2', subject: 'Old news', from: '~zod', last: 1600000000000, unread: false },
      { id: '0v3', subject: '', from: '~bus', last: 1500000000000, unread: true },
    ],
  }
  assert.deepEqual(mailOf(page), {
    unread: 7,
    threads: [{ subject: 'Lunch?', from: '~sampel-palnet', last: 1700000000000 }, { subject: '', from: '~bus', last: 1500000000000 }],
  })
  assert.deepEqual(mailOf({}), { unread: 0, threads: [] })
  assert.equal(mailOf({ unread: 9, threads: Array(9).fill({ subject: 'a', from: '~zod', unread: true }) }).threads.length, 5)
})

test('open actions: titles, as orrery\'s +en-action writes them', () => {
  const a = { id: 'a1', kind: 'call', title: 'Call Dana', payload: {}, about: [], due: null, by: 'orrery', proposed: '2026-10-07T10:00:00Z', status: 'proposed', note: '', history: [] }
  assert.deepEqual(actionsOf([a, { kind: 'x' }, null, { id: 'a2', kind: 'merge', status: 'approved' }]), [
    { id: 'a1', title: 'Call Dana', status: 'proposed', kind: 'call' },
    { id: 'a2', title: 'merge', status: 'approved', kind: 'merge' },
  ])
  assert.deepEqual(actionsOf({ actions: [] }), [])
})

test('the balance leaves the account answer alone: no key, no secret', () => {
  //  +serve-my-account: the stored view, plus vendor, self and stale
  const account = {
    ship: '~zod', balance: -1500000, plan: 'basic', subscription: null, keys: [{ id: 'k', name: 'n' }],
    keys_pending: [{ nonce: 'n', id: 'k2', name: 'p', secret: 'sk-or-SECRET' }], lease: { key: 'sk-or-LEASE' }, lease_error: '',
    vendor: '~wex', self: '~zod', stale: 12,
  }
  const b = balanceOf(account)
  assert.deepEqual(b, { vendor: '~wex', balance: -1500000 })
  assert.equal(JSON.stringify(b).includes('sk-or'), false)
  assert.deepEqual(balanceOf({ vendor: '' }), { vendor: '', balance: 0 })
  //  armillary.js: '$' + (micro / 1e6).toFixed(2)
  assert.equal(money(12345678), '$12.35')
  assert.equal(money(-1500000), '$-1.50')
})

//  ── the wire: each read, at the address its app serves ──────────────

function ship(answers) {
  const asked = []
  globalThis.fetch = async (url, init) => {
    const u = new URL(url)
    asked.push({ path: u.pathname + u.search, credentials: init.credentials, method: init.method || 'GET' })
    const a = answers[u.pathname + u.search]
    return typeof a === 'number' ? new Response('<html>nginx</html>', { status: a }) : Response.json(a === undefined ? {} : a)
  }
  return asked
}

test('each read asks its app\'s own route, once, with the cookie', async () => {
  const s = new Ship('http://ship.test')
  const asked = ship({})
  await s.calendarWindow(1000.7, 2000.2)
  await s.inbox(20)
  await s.actions('open')
  await s.account()
  await s.calendarConfig()
  await s.activity()
  assert.deepEqual(asked.map((a) => a.path), [
    '/apps/calendar/window.json?from=1000&to=2000',
    '/apps/auspex/api/inbox?view=inbox&limit=20',
    '/apps/orrery/api/actions?status=open',
    '/apps/armillary/api/account',
    '/apps/calendar/config.json',
    '/~/scry/activity/v6/activity/full.json',
  ])
  assert.ok(asked.every((a) => a.credentials === 'include' && a.method === 'GET'))
})

//  scryNewest: /v6 first, /v4 only where the ship says it does not serve
//  /v6 (404 or 500). A 502 is the ship, and asking older doubles it.
test('the activity scry falls back only on a path the ship does not serve', async () => {
  const s = new Ship('http://ship.test')
  let asked = ship({ '/~/scry/activity/v6/activity/full.json': 404, '/~/scry/activity/v4/activity/full.json': { 'ship/~zod': {} } })
  assert.deepEqual(await s.activity(), { 'ship/~zod': {} })
  assert.deepEqual(asked.map((a) => a.path), ['/~/scry/activity/v6/activity/full.json', '/~/scry/activity/v4/activity/full.json'])
  asked = ship({ '/~/scry/activity/v6/activity/full.json': 502 })
  await assert.rejects(s.activity(), (e) => e.status === 502 && e.message === 'HTTP 502')
  assert.equal(asked.length, 1)
  asked = ship({ '/~/scry/activity/v6/activity/full.json': 500, '/~/scry/activity/v4/activity/full.json': 404 })
  await assert.rejects(s.activity(), (e) => e.status === 404)
  assert.equal(asked.length, 2)
})

//  ── what a card says when its app cannot answer ─────────────────────

test('failures said for a person, by app', () => {
  assert.equal(explain('Auspex', 'HTTP 404', '~zod'), 'Auspex is not installed on ~zod.')
  assert.equal(explain('Auspex', 'not found', '~zod'), 'Auspex is not installed on ~zod.')
  assert.equal(explain('Calendar', 'HTTP 403', '~zod'), 'Signed out of ~zod: connect again in Options.')
  assert.equal(explain('Orrery', 'signed out', '~zod'), 'Signed out of ~zod: connect again in Options.')
  assert.equal(explain('Orrery', 'forbidden', '~zod'), 'Signed out of ~zod: connect again in Options.')
  for (const e of ['Failed to fetch', 'signal timed out', 'HTTP 502', 'HTTP 503', 'HTTP 504']) {
    assert.equal(explain('Tlon', e, '~zod'), '~zod did not answer: it may be down or busy.', e)
  }
  assert.equal(explain('Tlon', '%chat refused it: bad-key', '~zod'), '%chat refused it: bad-key')
  assert.equal(explain('Tlon', 'HTTP 500', '~zod'), 'HTTP 500')
  assert.equal(explain('Tlon', 'HTTP 404'), 'Tlon is not installed on this ship.')
})

//  ── the reply box: Send to a chat's picker and send ─────────────────

test('the picker: first list wins a chat, only chats a message can go to', () => {
  const m = chatChoices(
    [{ whom: 'chat/~bus/general', title: 'Bus Club / General' }, { whom: 'heap/~bus/pics', title: 'Bus Club / Pics' }],
    [{ whom: 'chat/~bus/general', title: 'old name' }, { whom: '~zod', title: '~zod' }],
    [{ whom: '~nec', title: '~zod' }, { whom: '0v4.aaaaa', title: 'Pals' }],
  )
  assert.deepEqual([...m], [['Bus Club / General', 'chat/~bus/general'], ['~zod', '~zod'], ['Pals', '0v4.aaaaa']])
})

test('a send: picked or typed, then sent, refused, or not heard', async () => {
  const sent = []
  const ask = (answer) => async (msg) => { sent.push(msg); return answer }
  const chats = new Map([['Bus Club / General', 'chat/~bus/general']])
  assert.deepEqual(await sendToChat(ask({ ok: true, heard: true }), chats, ' Bus Club / General ', ' hi ', '~zod'), { ok: true, text: 'Sent to Bus Club / General' })
  assert.deepEqual(sent.pop(), { kind: 'chat', whom: 'chat/~bus/general', title: 'Bus Club / General', text: 'hi' })
  //  a ship typed bare
  await sendToChat(ask({ ok: true, heard: true }), chats, 'sampel-palnet', 'hi', '~zod')
  assert.deepEqual(sent.pop(), { kind: 'chat', whom: '~sampel-palnet', title: '~sampel-palnet', text: 'hi' })
  assert.match((await sendToChat(ask({ ok: true, heard: false }), chats, '~bus', 'hi', '~zod')).text, /^~zod took it but did not confirm it within 15 s/)
  assert.deepEqual(await sendToChat(ask({ ok: false, error: '%chat refused it: no' }), chats, '~bus', 'hi', '~zod'), { ok: false, text: '%chat refused it: no' })
  //  nothing asked of the worker for these
  sent.length = 0
  assert.deepEqual(await sendToChat(ask({}), chats, '', 'hi'), { ok: false, text: 'which chat?' })
  assert.match((await sendToChat(ask({}), chats, 'heap/~bus/pics', 'hi')).text, /^not a chat: heap\/~bus\/pics/)
  assert.deepEqual(await sendToChat(ask({}), chats, '~bus', '  '), { ok: false, text: 'nothing to send' })
  assert.equal(sent.length, 0)
})

//  ── Orrery's spend, from its generator-last.json (+gen-record-doc) ───

test('spendOf: this month\'s spend, nothing yet in a new month, null with no record', () => {
  const now = Date.UTC(2026, 9, 8, 12)
  assert.equal(spendOf({ month: '2026-10', spend_month_micro: 420000 }, now), 420000)
  assert.equal(spendOf({ month: '2026-09', spend_month_micro: 9000000 }, now), 0)
  assert.equal(spendOf({ month: '2026-10' }, now), null)
  assert.equal(spendOf({}, now), null)
  assert.equal(spendOf(null, now), null)
})

//  ── the cards' order ────────────────────────────────────────────────

test('ordered: the saved order first, new cards after, gone ones dropped', () => {
  assert.deepEqual(ordered(null), CARDS)
  assert.deepEqual(ordered(['mail', 'clock']), ['mail', 'clock', 'cal', 'actions', 'money'])
  assert.deepEqual(ordered(['chats', 'money', 'money']), ['money', 'clock', 'cal', 'actions', 'mail'])
})

test('moved: dropped on a card, it takes that card\'s place', () => {
  const o = ['clock', 'cal', 'actions', 'mail', 'money']
  assert.deepEqual(moved(o, 'clock', o.indexOf('mail')), ['cal', 'actions', 'mail', 'clock', 'money'], 'forward: after it')
  assert.deepEqual(moved(o, 'money', o.indexOf('cal')), ['clock', 'money', 'cal', 'actions', 'mail'], 'back: before it')
  assert.deepEqual(moved(o, 'cal', -3), ['cal', 'clock', 'actions', 'mail', 'money'])
  assert.deepEqual(moved(o, 'cal', 99), ['clock', 'actions', 'mail', 'money', 'cal'])
})
