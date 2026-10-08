//  The day page in a throwaway headless Brave, against a stand-in ship.
//
//  No real ship and no cookie: a local server answers each app's route
//  with the shapes its source writes, and logs every request. The run
//  stages a copy of the extension, grants it the stand-in's origin as
//  scripts/smoke.js does, and checks, from the page's own text:
//
//    no ship         the page says so and asks nothing of anyone
//    cached          a stored snapshot is drawn at once, nothing is asked
//    cached failures each card's words for 404, 403, no answer and 502,
//                    with the data it last had
//    a refresh       each source read once, at its own route; a second
//                    tab inside five minutes asks nothing
//    failures, live  a missing app, a 403, a 502 and a dropped connection,
//                    one card each, the others drawn
//    leaving midway  a refresh finishes after the tab closes
//    Talon's look    read at once when the page has none; the active
//                    custom theme and Talon's font set on the page, the
//                    font's file kept once; turned off and light or dark
//                    chosen in Options; built-in on a 404; Options says
//                    what was read
//    arranging       a right-click starts it, a card moved a step and one
//                    dropped on another, the order kept for a new tab
//    no settings     the page carries none: they are in Options
//    the search box  Search and Research go to Brave Search's own
//                    addresses (caught before they leave the machine)
//    Brave Leo       Options shows Leo's form filled from a lease, the key
//                    masked and copied only on its button, and says why
//                    not on a proxy
//    history         pages really visited go to orrery's read channel as
//                    a digest of sites and titles, a listed site and the
//                    ship's own pages left out, once the owner turns it on
//    the assistant   a question answered from orrery's brief by a model
//                    that asked for it; a write shown and run only on
//                    yes, with the calendar's poke; a no said to the model;
//                    a model that fails; the history kept, and cleared
//    the sky clock   drawn with no ship at all, asking for a location and
//                    fetching no weather without one; a stored forecast
//                    drawn on it, not fetched again while fresh
//    a background    an image chosen in Options is behind the page, in a new tab too,
//                    and gone when removed; a file that is not one is refused
//
//    node scripts/today-check.js        (BROWSER names the binary;
//                                        SHOT=file.png keeps a picture)

import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { patternFor, localDate } from '../lib/ship.js'

//  ── the stand-in ship ────────────────────────────────────────────────

const now = Date.now()
const [y, m, d] = localDate(new Date(now)).split('-').map(Number)
const todayUtc = Date.UTC(y, m - 1, d)
const asked = []
let mode = 'ok'
let slow = 0
//  the stand-in model: each completion takes the next scripted message
const script = []
const completions = []
const pokes = []
//  the stand-in Armillary's inference answer; the Leo checks change it
let inference = null

//  a font file Talon installed, named by its sha256 as grubbery keeps it
const FONT = Buffer.from('not really a font, but its own hash')
const FONT_ID = createHash('sha256').update(FONT).digest('hex')

//  pages to visit for the history digest, on two other hosts
const sites = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' })
  .end(`<!doctype html><title>${req.url === '/a' ? 'Flights to Lisbon' : req.url === '/b' ? 'Lisbon hotels' : 'Secret page'}</title><p>body text never sent`))
await new Promise((r) => sites.listen(0, '0.0.0.0', r))
const SITE = `http://127.0.0.2:${sites.address().port}`
const SECRET = `http://localhost:${sites.address().port}`
const reads = []

const fixtures = {
  '/apps/calendar/config.json': { title: 'Calendar', zone: null, ball: 'x', ship: '~zod', lead_min: 30 },
  '/apps/orrery/api/actions?status=open': [{ id: 'a1', kind: 'call', title: 'Call Dana about the lease', status: 'proposed', by: 'orrery', about: [], history: [] }],
  '/apps/orrery/api/generator/last': { at: '2026-10-08T00:00:00Z', month: new Date(now).toISOString().slice(0, 7), spend_month_micro: 420000, calls_today: 3 },
  '/apps/auspex/api/inbox?view=inbox&limit=20': { total: 3, offset: 0, limit: 20, view: 'inbox', unread: 2, labels: [], threads: [
    { id: '0v1', subject: 'Dinner on Friday', from: '~sampel-palnet', last: now, unread: true },
    { id: '0v2', subject: 'Read already', from: '~bus', last: now - 1, unread: false },
  ] },
  '/~/scry/settings/bucket/talon/ui-prefs.json': { bucket: {
    themes: JSON.stringify({ activeId: 't1', themes: [{ id: 't1', name: 'Night', dark: true, primary: '#7C3AED', secondary: '#0EA5E9', tertiary: '#10B981', background: '#0B0B10', surface: '#14141C' }] }),
    accent: JSON.stringify({ enabled: false, mode: 'Brand' }),
    fonts: JSON.stringify({ family: 'Test', fonts: [{ id: FONT_ID, family: 'Test', weight: 400, italic: false }], removed: [] }),
  } },
  '/~/scry/contacts/v1/self.json': { nickname: { type: 'text', value: 'Zed' }, color: { type: 'tint', value: '0x0' } },
  '/apps/armillary/api/account': { ship: '~zod', balance: 12345678, keys_pending: [{ secret: 'sk-or-SECRET' }], vendor: '~wex', self: '~zod', stale: 3 },
}

const server = createServer((req, res) => {
  const path = req.url
  asked.push(`${req.method} ${path.replace(/^\/~\/channel\/[^?]+/, '/~/channel/<id>')}`)
  if (path.startsWith('/apps/calendar/window.json')) {
    if (mode === 'fail') return res.writeHead(404).end('<html>not found</html>')
    return json(res, { caps: [], rows: [
      { id: 'e1', cal: 'default', idx: 0, meta: { name: 'Trip to Lisbon' }, cat: 'allday', kind: 'once', all: true, done: false, l: todayUtc, r: todayUtc + 864e5 },
      { id: 'e2', cal: 'default', idx: 3, meta: { name: 'Standup' }, cat: 'timed', kind: 'weekly', all: false, done: false, l: now - 60000, r: now + 60000 },
      { id: 't1', cal: 'default', idx: 0, meta: { name: 'Pay the rent' }, cat: 'todo', kind: 'todo', all: true, done: false, l: todayUtc, r: todayUtc + 864e5, priority: 0 },
    ] })
  }
  if (mode === 'fail') {
    if (path === '/apps/calendar/config.json') return res.writeHead(404).end('<html>not found</html>')
    if (path.startsWith('/apps/orrery/')) return res.writeHead(403).end('Forbidden')
    if (path.startsWith('/~/scry/settings/')) return res.writeHead(404).end('<html>no</html>')
    if (path.startsWith('/apps/auspex/')) return res.writeHead(502).end('<html><h1>502 Bad Gateway</h1></html>')
    if (path.startsWith('/apps/armillary/')) return req.socket.destroy()
  }
  if (req.method === 'POST' && path === '/apps/orrery/api/read') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { reads.push(JSON.parse(body)); json(res, { ok: true, id: `r${reads.length}` }) })
    return
  }
  //  the calendar as the assistant reads it: one event's rule, the tasks
  if (path === '/apps/calendar/event.json?id=e2') return json(res, { id: 'e2', cal: 'default', cat: 'timed', meta: { name: 'Standup', orrery: 'act-1' }, kind: 'weekly', start_ms: Date.UTC(2026, 8, 7), args: { at: 540, days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, zone: 'none', fin: 'dur', dur_min: 15 })
  if (path === '/apps/calendar/events.json?cat=todo') return json(res, [
    { id: 't1', cal: 'default', cat: 'todo', meta: { name: 'Pay the rent' }, due_ms: todayUtc, done: false },
    { id: 't2', cal: 'default', cat: 'todo', meta: { name: 'Call mum' }, done: false },
  ])
  if (path === '/apps/armillary/api/inference') return json(res, inference || { base_url: `http://${req.headers.host}/v1`, key: 'test-key', mode: 'lease', models: ['test-model'] })
  if (path === '/apps/orrery/api/brief/last') return json(res, { day: '2026-10-08', at: now, text: 'Dana needs an answer about the lease by Friday.' })
  if (req.method === 'POST' && (path === '/v1/chat/completions' || path.startsWith('/grubbery/api/poke/'))) {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (path.startsWith('/grubbery/api/poke/')) { pokes.push({ path, body: JSON.parse(body) }); return res.writeHead(200).end('') }
      completions.push({ auth: req.headers.authorization, body: JSON.parse(body) })
      const next = script.shift()
      if (next === 500) return res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'the model fell over' } }))
      json(res, { choices: [{ message: next || { role: 'assistant', content: 'ok' } }] })
    })
    return
  }
  if (path === `/grubbery/api/file/talon/fonts/${FONT_ID}.font`) return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(FONT)
  if (path in fixtures) return setTimeout(() => json(res, fixtures[path]), path.startsWith('/apps/armillary/') ? slow : 0)
  res.writeHead(404).end('not here')
})
const json = (res, body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const SHIP = `http://127.0.0.1:${server.address().port}`

//  ── stage, grant, launch (as scripts/smoke.js) ───────────────────────

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const stage = mkdtempSync(join(tmpdir(), 'nisfeb-ext-'))
const profile = mkdtempSync(join(tmpdir(), 'nisfeb-profile-'))
//  the extension as the browser loads it: everything but the repo's own
cpSync(root, stage, { recursive: true, filter: (src) => !/^\/(\.git|node_modules|test|scripts|docs)(\/|$)/.test(src.slice(root.length)) })
function launch() {
  const browser = spawn(process.env.BROWSER || '/usr/lib/brave-browser/brave', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    `--load-extension=${stage}`, `--disable-extensions-except=${stage}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = new Promise((resolve, reject) => {
    let buf = ''
    browser.stderr.on('data', (c) => { buf += c; const x = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (x) resolve(x[1]) })
    browser.on('exit', (c) => reject(new Error(`browser exited ${c}\n${buf}`)))
    setTimeout(() => reject(new Error(`no devtools endpoint in 15 s\n${buf}`)), 15000)
  })
  return { browser, wsUrl }
}
{
  const first = launch()
  await first.wsUrl
  await new Promise((r) => setTimeout(r, 2500))
  first.browser.kill()
  await new Promise((r) => first.browser.once('exit', r))
  const pf = join(profile, 'Default', 'Preferences')
  const prefs = JSON.parse(readFileSync(pf, 'utf8'))
  const settings = prefs.extensions.settings
  const e = settings[Object.keys(settings).find((k) => settings[k].path === stage)]
  for (const k of ['active_permissions', 'granted_permissions', 'runtime_granted_permissions']) {
    e[k] = { ...(e[k] || {}), api: [...new Set([...((e[k] && e[k].api) || []), 'history'])], explicit_host: [patternFor(SHIP)], manifest_permissions: [], scriptable_host: [] }
  }
  delete e.withholding_permissions
  writeFileSync(pf, JSON.stringify(prefs))
}
const { browser, wsUrl } = launch()
const ws = new WebSocket(await wsUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const waiting = new Map()
const errors = []
const caught = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  //  a navigation to Brave Search, caught and stopped here
  if (msg.method === 'Fetch.requestPaused') {
    caught.push(msg.params.request.url)
    ws.send(JSON.stringify({ id: ++seq, method: 'Fetch.failRequest', params: { requestId: msg.params.requestId, errorReason: 'Aborted' }, sessionId: msg.sessionId }))
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
  if (!msg.id || !waiting.has(msg.id)) return
  const { r, j } = waiting.get(msg.id)
  waiting.delete(msg.id)
  msg.error ? j(new Error(msg.error.message)) : r(msg.result)
}
const cdp = (method, params = {}, sessionId) => new Promise((r, j) => {
  const id = ++seq
  waiting.set(id, { r, j })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
  setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); j(new Error(`${method} timed out`)) } }, 90000)
})
async function evaluate(expression, sessionId) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}

let worker
for (let i = 0; i < 50 && !worker; i++) {
  const { targetInfos } = await cdp('Target.getTargets')
  worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'))
  if (!worker) await new Promise((r) => setTimeout(r, 200))
}
if (!worker) throw new Error('the extension worker never appeared')
const { sessionId: ws1 } = await cdp('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
for (let i = 0; i < 50; i++) {
  if (await evaluate('typeof nisfeb', ws1).catch(() => '') === 'object') break
  await new Promise((r) => setTimeout(r, 100))
}
const handle = (msg) => evaluate(`nisfeb.handle(${JSON.stringify(msg)})`, ws1)
const store = (obj) => evaluate(`chrome.storage.session.clear().then(() => chrome.storage.local.clear()).then(() => chrome.storage.local.set(${JSON.stringify(obj)}))`, ws1)
const PAGE = `chrome-extension://${new URL(worker.url).host}/today.html`

//  Open the page, wait until its text has everything in `want` (or time
//  runs out), and hand back the text and a session for driving it.
const OPTIONS = PAGE.replace('today.html', 'options.html')
async function page(want, ms = 15000, url = PAGE) {
  const { targetId } = await cdp('Target.createTarget', { url })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  await cdp('Runtime.enable', {}, sessionId)
  return { targetId, sessionId, text: await textOf(sessionId, want, ms) }
}
async function textOf(sessionId, want, ms = 15000) {
  let text = ''
  for (const end = Date.now() + ms; Date.now() < end;) {
    text = await evaluate('document.body.innerText', sessionId).catch(() => '')
    if (want.every((w) => text.includes(w))) break
    await new Promise((r) => setTimeout(r, 200))
  }
  return text
}
const close = (t) => cdp('Target.closeTarget', { targetId: t.targetId })

const failures = []
function check(what, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`)
  if (!cond) { failures.push(what); if (detail) console.log(String(detail).split('\n').map((l) => `     ${l}`).join('\n')) }
}
const has = (text, list) => list.filter((w) => !text.includes(w))

//  ── the runs ─────────────────────────────────────────────────────────

try {
  //  1. no ship
  await store({})
  let t = await page(['No ship yet'])
  check('no ship: says so', t.text.includes('No ship yet. Set one up in Options'), t.text)
  check('no ship: asks nothing', asked.length === 0, asked.join('\n'))
  check('clock: drawn with no ship, asking for a location', /\d:\d\d/.test(t.text) && t.text.includes('Set a location') && t.text.includes('Without one the dial shows an even day and no weather.'), t.text)
  const inked = await evaluate(`(() => { const c = document.getElementById('dial'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()`, t.sessionId)
  check('clock: the ring is painted', inked > 5000, inked)
  check('clock: no place, no weather asked for', await evaluate("chrome.storage.local.get('weather').then((s) => s.weather === undefined)", ws1) === true)
  await close(t)

  //  2. a stored snapshot, fresh: drawn at once, nothing asked
  const cards = {
    cal: { at: now, error: '', data: { zone: '', zoneAt: now, rows: [{ name: 'Cached standup', cat: 'timed', all: false, done: false, l: now - 60000, r: now + 60000 }] } },
    actions: { at: now, error: '', data: [{ id: 'a1', title: 'Cached action', status: 'approved', kind: 'call' }] },
    mail: { at: now, error: '', data: { unread: 4, threads: [{ subject: 'Cached subject', from: '~bus', last: now }] } },
    money: { at: now, error: '', data: { vendor: '~wex', balance: 2500000 } },
  }
  const forecast = { key: '38.72,-9.13', tried: now, at: now, error: '', sky: {
    minuteOfDay: 0, sunriseMinute: 360, sunsetMinute: 1080, currentC: 21.4, highC: 24, highAtMinute: 900, lowC: 12, lowAtMinute: 300,
    cloudCover: 0.7, condition: 'RAIN', hourlyCloud: [], hourlyCondition: [], zoneId: 'Europe/Lisbon', moonElongationDeg: null, dateLabel: '', twilight: 60, polar: false, polarDay: false,
  } }
  await store({ origin: SHIP, ship: '~zod', status: 'connected', today: { origin: SHIP, tried: now, cards },
    talonLook: { origin: SHIP, at: now, themes: null, accent: null, fonts: null },
    place: { lat: 38.72, lon: -9.13, label: 'Lisbon, Portugal', elevationMetres: 45, timeZoneId: 'Europe/Lisbon' }, weather: forecast })
  t = await page(['Cached standup', 'Cached action', 'Cached subject', '$2.50', 'Rain'])
  check('clock: the stored forecast is on the dial', has(t.text, ['Lisbon, Portugal', 'Rain']).length === 0 && (t.text.includes('71°') || t.text.includes('21°')) && /H (75|24)°/.test(t.text), t.text)
  check('clock: with a place, no caption asking for one', !t.text.includes('Without one the dial'))
  check('clock: nothing but words in the readout', !/null|false|undefined/.test(await evaluate("document.getElementById('readout').innerText", t.sessionId)))
  if (process.env.SHOT2) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false }, t.sessionId)
    writeFileSync(process.env.SHOT2, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' }, t.sessionId)).data, 'base64'))
  }
  await new Promise((r) => setTimeout(r, 1000))
  check('clock: a fresh forecast is not fetched again', await evaluate("chrome.storage.local.get('weather').then((s) => s.weather.tried)", ws1) === now)
  check('cached: every card drawn', has(t.text, ['Cached standup', 'Cached action', '4 unread', 'Cached subject', '$2.50', 'with ~wex']).length === 0, t.text)
  check('cached: nothing asked of the ship', asked.length === 0, asked.join('\n'))
  check('cached: no exception in the page', errors.length === 0, errors.join('\n'))
  check('no settings on the page: they are in Options', !/Customize|In Brave this page|Background image/.test(t.text) && t.text.includes('Good ') && t.text.includes(', ~zod'), t.text)
  await close(t)

  //  2b. the same, with no look kept: it is read at once, the snapshot
  //  still fresh, and the font's file is fetched and kept
  await store({ origin: SHIP, ship: '~zod', status: 'connected', today: { origin: SHIP, tried: now, cards } })
  t = await page(['Cached standup'])
  const prop = (k, s = t.sessionId) => evaluate(`document.documentElement.style.getPropertyValue('${k}')`, s)
  const until = async (k, want, s = t.sessionId) => { for (let i = 0; i < 25 && await prop(k, s) !== want; i++) await new Promise((r) => setTimeout(r, 200)); return prop(k, s) }
  check('look: read at once when the page has none', await until('--bg', '#14141c') === '#14141c' && await prop('color-scheme') === 'dark', await prop('--bg'))
  check('look: only the look is read, the fresh cards are not', JSON.stringify(asked.sort()) === JSON.stringify(['GET /~/scry/settings/bucket/talon/ui-prefs.json', 'GET /~/scry/contacts/v1/self.json', `GET /grubbery/api/file/talon/fonts/${FONT_ID}.font`].sort()), asked.join('\n'))
  check('look: the greeting names the owner as Talon does, by nickname', (await textOf(t.sessionId, [', Zed'])).includes(', Zed'))
  check('look: Talon\'s font is the page\'s', await prop('--font') === '"Test", sans-serif', await prop('--font'))
  check('look: the font\'s file is kept, checked against its name', await evaluate(`caches.open('nisfeb-day').then((c) => c.match('https://day.nisfeb.invalid/fonts/${FONT_ID}')).then(Boolean)`, t.sessionId) === true)
  check('look: kept for the next tab\'s first paint', (await evaluate('localStorage.dayLook', t.sessionId) || '').includes('#14141c'))
  await close(t)

  //  3. a snapshot whose cards failed: each says why, the data stays
  const failed = {
    cal: { error: 'HTTP 404' },
    actions: { error: 'signed out' },
    mail: { ...cards.mail, error: 'HTTP 502' },
    money: cards.money,
  }
  await store({ origin: SHIP, ship: '~zod', status: 'signed-out', today: { origin: SHIP, tried: now, cards: failed } })
  t = await page(['Calendar is not installed'])
  const said = [
    'Calendar is not installed on ~zod.',
    'Signed out of ~zod: connect again in Options.',
    'Cached subject',
    '$2.50',
    'signed out, connect again in Options',
  ]
  check('cached failures: each card\'s words, the old data kept', has(t.text, said).length === 0, `missing: ${has(t.text, said).join(' | ')}\n${t.text}`)
  await close(t)

  //  4. a refresh against the stand-in: every source once, then the cards
  await store({ origin: SHIP, ship: '~zod', status: 'connected' })
  asked.length = 0
  const live = ['Trip to Lisbon', 'Standup', 'Pay the rent', '$0.42 on its model this month', 'Call Dana about the lease', '2 unread', 'Dinner on Friday', '$12.35']
  t = await page(live, 30000)
  check('refresh: every card drawn from the ship', has(t.text, live).length === 0, `missing: ${has(t.text, live).join(' | ')}\n${t.text}`)
  check('refresh: the mail page shows only unread subjects', !t.text.includes('Read already'), t.text)
  const once = [
    'GET /apps/calendar/config.json',
    `GET /apps/calendar/window.json?from=${'*'}`,
    'GET /apps/orrery/api/actions?status=open',
    'GET /apps/orrery/api/generator/last',
    'GET /~/scry/settings/bucket/talon/ui-prefs.json',
    'GET /~/scry/contacts/v1/self.json',
    'GET /apps/auspex/api/inbox?view=inbox&limit=20',
    'GET /apps/armillary/api/account',
  ]
  const norm = asked.map((a) => a.replace(/window\.json\?from=.*/, 'window.json?from=*'))
  check('refresh: each source asked once, at its own route', JSON.stringify([...norm].sort()) === JSON.stringify([...once].sort()), norm.join('\n'))
  const win = asked.find((a) => a.includes('window.json'))
  const [, from, to] = /from=(\d+)&to=(\d+)/.exec(win)
  //  today and tomorrow here, and as UTC dates for the whole-day rows
  const midnight = new Date(y, m - 1, d).getTime()
  check('refresh: the window covers today and tomorrow', Number(from) <= Math.min(todayUtc, midnight) && Number(to) >= Math.max(todayUtc, midnight) + 2 * 864e5, win)
  const secret = await evaluate('chrome.storage.local.get(null).then((s) => JSON.stringify(s))', ws1)
  check('refresh: no armillary key or secret is stored', !secret.includes('sk-or') && !secret.includes('keys_pending'), secret)
  await close(t)
  const before = asked.length
  t = await page(live)
  await new Promise((r) => setTimeout(r, 1500))
  check('a second tab within five minutes asks nothing', asked.length === before, asked.slice(before).join('\n'))
  check('refresh: no exception in the page', errors.length === 0, errors.join('\n'))
  //  Talon's look, set in Options and seen on the page
  check('look: on the page after a refresh', await until('--bg', '#14141c') === '#14141c')
  const o = await page(['Light or dark'], 15000, OPTIONS)
  check('look: Options says what was read', (await textOf(o.sessionId, ['Read from'])).includes('Talon\'s theme here is "Night", dark. Its font is Test. Read from ~zod at'), o.text)
  await evaluate("document.getElementById('talontheme').click()", o.sessionId)
  check('look: turned off in Options, the built-in colours', await until('--bg', '') === '' && await prop('--font') === '')
  await evaluate("(() => { const m = document.getElementById('mode'); m.value = 'dark'; m.dispatchEvent(new Event('change')) })()", o.sessionId)
  check('look: dark chosen in Options, Talon\'s built-in dark', await until('--bg', '#1a1625') === '#1a1625')
  await evaluate("(() => { const m = document.getElementById('mode'); m.value = 'system'; m.dispatchEvent(new Event('change')) })()", o.sessionId)
  check('look: as the system is, nothing set', await until('--bg', '') === '')
  await evaluate("document.getElementById('talontheme').click()", o.sessionId)
  check('look: and back on', await until('--bg', '#14141c') === '#14141c')

  //  arranging: a right-click, a step, a drop, kept for a new tab
  const orderOf = (k, s = t.sessionId) => evaluate(`Number(document.getElementById('${k}').style.order)`, s)
  await evaluate("document.querySelector('#mail .body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))", t.sessionId)
  check('arranging: a right-click on a card starts it', await evaluate("document.body.classList.contains('arranging') && !document.getElementById('done').hidden", t.sessionId) === true)
  await evaluate("document.querySelector('#mail .move button').click()", t.sessionId)
  for (let i = 0; i < 20 && await orderOf('mail') !== 2; i++) await new Promise((r) => setTimeout(r, 100))
  check('arranging: a card moved a step earlier', await orderOf('mail') === 2 && await orderOf('actions') === 3, `${await orderOf('mail')} ${await orderOf('actions')}`)
  const t3 = await page(['Trip to Lisbon'])
  check('arranging: the order is kept for a new tab', await orderOf('mail', t3.sessionId) === await orderOf('mail') && await orderOf('mail', t3.sessionId) === 2)
  await close(t3)
  //  taken off the page, and put back, as on Talon's
  await evaluate("document.querySelector('#mail .move .remove').click()", t.sessionId)
  const gone = (k, s = t.sessionId) => evaluate(`document.getElementById('${k}').classList.contains('gone') && getComputedStyle(document.getElementById('${k}')).display === 'none'`, s)
  for (let i = 0; i < 20 && !await gone('mail'); i++) await new Promise((r) => setTimeout(r, 100))
  check('arranging: a card taken off the page goes, and is offered back', await gone('mail') && (await evaluate("document.getElementById('addcards').innerText", t.sessionId)).includes('+ Mail'))
  const t5 = await page(['Trip to Lisbon'])
  check('arranging: off the page in a new tab too', await gone('mail', t5.sessionId) === true)
  await close(t5)
  await evaluate("document.querySelector('#addcards button').click()", t.sessionId)
  for (let i = 0; i < 20 && await gone('mail'); i++) await new Promise((r) => setTimeout(r, 100))
  check('arranging: put back from the header', await gone('mail') === false && await evaluate("document.getElementById('addcards').hidden", t.sessionId) === true)
  await evaluate("document.getElementById('done').click()", t.sessionId)
  check('arranging: Done ends it', await evaluate("document.body.classList.contains('arranging')", t.sessionId) === false)
  if (process.env.SHOT) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false }, t.sessionId)
    writeFileSync(process.env.SHOT, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' }, t.sessionId)).data, 'base64'))
  }

  //  a background: chosen, kept for the next tab, removed
  const choose = (type) => evaluate(`(async () => {
    const c = new OffscreenCanvas(4, 4); c.getContext('2d').fillRect(0, 0, 4, 4)
    const blob = '${type}' === 'image/png' ? await c.convertToBlob() : new Blob(['not a picture'], { type: '${type}' })
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'x', { type: '${type}' }))
    const input = document.getElementById('bgfile'); input.files = dt.files; input.dispatchEvent(new Event('change'))
  })()`, o.sessionId)
  const pictured = (s) => evaluate("document.body.classList.contains('pictured') && document.body.style.backgroundImage.startsWith('url(\"blob:')", s)
  const settle = async (s, want) => { for (let i = 0; i < 25 && await pictured(s) !== want; i++) await new Promise((r) => setTimeout(r, 200)); return pictured(s) }
  await choose('text/plain')
  const said1 = await textOf(o.sessionId, ['is not an image'], 3000)
  check('background: a file that is not an image is refused', said1.includes('x is not an image.') && !await pictured(t.sessionId), said1.slice(-300))
  await choose('image/png')
  check('background: the image chosen in Options is behind the page', await settle(t.sessionId, true) === true, await evaluate("document.getElementById('bgsay').textContent", o.sessionId))
  const t2 = await page(['Trip to Lisbon'])
  check('background: a new tab has it too', await settle(t2.sessionId, true) === true)
  await evaluate("document.getElementById('bgremove').click()", o.sessionId)
  check('background: removed, from every open tab', await settle(t.sessionId, false) === false && await settle(t2.sessionId, false) === false)
  await close(t2)
  await close(o)
  //  the clock's place is set in Options
  await evaluate("document.getElementById('where').click()", t.sessionId)
  await new Promise((r) => setTimeout(r, 800))
  check('clock: "Set a location" opens Options at the place', (await cdp('Target.getTargets')).targetInfos.some((x) => x.url.endsWith('/options.html#clock')))

  //  the assistant: a read, a write on yes, a no, a failure, the history
  const call = (id, name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const askIt = (q) => evaluate(`(() => { document.getElementById('askq').value = ${JSON.stringify(q)}; document.getElementById('askform').requestSubmit() })()`, t.sessionId)
  const talkText = () => evaluate("document.getElementById('assistant').innerText", t.sessionId)
  const waitTalk = async (want) => { for (let i = 0; i < 50 && !(await talkText()).includes(want); i++) await new Promise((r) => setTimeout(r, 200)); return talkText() }
  script.push(call('c1', 'orrery_brief', {}), { role: 'assistant', content: 'Answer Dana about the lease; it is due Friday.' })
  await askIt('what should I do today?')
  let said2 = await waitTalk('Answer Dana')
  check('assistant: a question answered from orrery\'s brief', said2.includes('what should I do today?') && said2.includes('Answer Dana about the lease'), said2)
  const [first, second] = completions
  check('assistant: the model is asked with Talon\'s tools, the key, and NOW', first && first.auth === 'Bearer test-key' && first.body.model === 'test-model' &&
    first.body.tools.length === 11 && /NOW: \d{4}-\d{2}-\d{2} /.test(first.body.messages[0].content), JSON.stringify(first && first.body).slice(0, 400))
  check('assistant: the brief goes back to the model as the tool\'s answer', second && second.body.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'c1' && m.content.includes('Dana needs an answer')), JSON.stringify(second && second.body.messages).slice(-400))

  script.push(call('c2', 'create_event', { name: 'Lunch with Tom', date: '2026-10-10', time: '12:30' }), { role: 'assistant', content: 'Lunch with Tom is on Saturday at 12:30.' })
  await askIt('lunch with tom saturday')
  said2 = await waitTalk('Do it')
  check('assistant: a write is shown and waits for a yes', said2.includes('Add "Lunch with Tom" on 2026-10-10 at 12:30, 60 minutes to your calendar.') && pokes.length === 0 && !said2.includes('Thinking'), said2)
  if (process.env.SHOT3) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, t.sessionId)
    await evaluate("document.getElementById('assistant').scrollIntoView()", t.sessionId)
    writeFileSync(process.env.SHOT3, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' }, t.sessionId)).data, 'base64'))
  }
  await evaluate("document.getElementById('cyes').click()", t.sessionId)
  said2 = await waitTalk('is on Saturday')
  const poke = pokes[0]
  check('assistant: on yes, the calendar\'s add-event poke, then the answer', poke && poke.path === '/grubbery/api/poke/x/calendar.calendar?blot=/json' &&
    poke.body.action === 'add-event' && poke.body.cat === 'timed' && poke.body.start_ms === Date.UTC(2026, 9, 10, 12, 30) && said2.includes('Lunch with Tom is on Saturday'), JSON.stringify(pokes))

  //  one occurrence of a repeating event moved: the one-off, then the skip
  pokes.length = 0
  const today0 = localDate(new Date(now))
  script.push(call('c5', 'update_event', { event: 'e2', occurrence: today0, time: '14:00' }), { role: 'assistant', content: 'Standup is at 14:00 today.' })
  await askIt('move today\'s standup to 2pm')
  said2 = await waitTalk('Do it')
  check('assistant: a change names the event and the one occurrence', said2.includes(`Change "Standup" on ${today0} only:`) && pokes.length === 0, said2)
  await evaluate("document.getElementById('cyes').click()", t.sessionId)
  said2 = await waitTalk('at 14:00 today')
  const [q1, q2] = pokes.map((x) => x.body)
  check('assistant: one occurrence moved is a one-off added, then the original skipped', q1 && q1.action === 'add-event' && q1.kind === 'once' && q1.start_ms === Date.UTC(...today0.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)), 14, 0) &&
    q1.meta.orrery === 'act-1' && q2 && q2.action === 'skip-event' && q2.id === 'e2' && q2.idx === 3, JSON.stringify(pokes.map((x) => x.body)))

  //  a task ticked off, found by its words
  pokes.length = 0
  script.push(call('c6', 'complete_task', { task: 'rent' }), { role: 'assistant', content: 'Ticked off.' })
  await askIt('i paid the rent')
  said2 = await waitTalk('Do it')
  check('assistant: ticking off names the task', said2.includes('Tick off the task "Pay the rent".'), said2)
  await evaluate("document.getElementById('cyes').click()", t.sessionId)
  await waitTalk('Ticked off.')
  check('assistant: on yes, the calendar\'s done-event for that task', JSON.stringify(pokes.map((x) => x.body)) === JSON.stringify([{ action: 'done-event', id: 't1', done: true }]), JSON.stringify(pokes))

  pokes.length = 0
  script.push(call('c3', 'create_task', { name: 'Pay the rent' }), { role: 'assistant', content: 'Fine, I left it off.' })
  await askIt('remind me to pay the rent')
  await waitTalk('Do it')
  await evaluate("document.getElementById('cno').click()", t.sessionId)
  said2 = await waitTalk('I left it off')
  const last = completions.at(-1)
  check('assistant: a no is said to the model and nothing is written', pokes.length === 0 && last.body.messages.some((m) => m.role === 'tool' && m.content.includes('declined')) && said2.includes('I left it off'), JSON.stringify(pokes))

  script.push(500)
  await askIt('and tomorrow?')
  said2 = await waitTalk('did not go through')
  check('assistant: a model that fails is said, and the box is free again', said2.includes('That did not go through: the model fell over') && await evaluate("!document.getElementById('asksend').disabled", t.sessionId), said2)

  const t4 = await page(['Answer Dana'])
  check('assistant: the history is there in a new tab', (await evaluate("document.getElementById('assistant').innerText", t4.sessionId)).includes('Lunch with Tom is on Saturday'))
  await close(t4)
  await evaluate("document.getElementById('anew').click()", t.sessionId)
  said2 = await waitTalk('Anything it would write waits for your yes')
  check('assistant: New clears it', !said2.includes('Answer Dana'), said2)

  //  arranging by hand: real mouse input, as a person does it, not events
  //  handed to the page (those passed while a real drag did nothing)
  await evaluate("chrome.storage.local.remove('dayOrder')", ws1)
  //  in front: a tab behind others gets each mouse event five seconds late
  await cdp('Page.bringToFront', {}, t.sessionId)
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, t.sessionId)
  await evaluate("document.getElementById('done').click(); window.scrollTo(0, 0)", t.sessionId)
  await new Promise((r) => setTimeout(r, 400))
  const centre = async (k) => JSON.parse(await evaluate(`(() => { const r = document.getElementById('${k}').getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(r.height / 2, 60))]) })()`, t.sessionId))
  const mouse = (type, [x, y], button = 'left', extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, ...extra }, t.sessionId)
  const arrangingNow = () => evaluate("document.body.classList.contains('arranging')", t.sessionId)
  const orderNow = () => evaluate("JSON.stringify([...document.querySelectorAll('[data-card]')].sort((a, b) => a.style.order - b.style.order).map((c) => c.id))", t.sessionId)
  const before0 = await orderNow()
  await mouse('mousePressed', await centre('mail'), 'right')
  await mouse('mouseReleased', await centre('mail'), 'right')
  await new Promise((r) => setTimeout(r, 300))
  check('arranging by hand: a real right-click on a card starts it', await arrangingNow() === true)
  await evaluate("document.getElementById('done').click()", t.sessionId)
  const drag = async (a, b) => {
    await mouse('mousePressed', a)
    for (let i = 1; i <= 12; i++) await mouse('mouseMoved', [Math.round(a[0] + (b[0] - a[0]) * i / 12), Math.round(a[1] + (b[1] - a[1]) * i / 12)], 'left', { buttons: 1 })
    await mouse('mouseReleased', b)
    await new Promise((r) => setTimeout(r, 400))
  }
  //  a click, no move: nothing moves and nothing starts
  await mouse('mousePressed', await centre('cal'))
  await mouse('mouseReleased', await centre('cal'))
  await new Promise((r) => setTimeout(r, 300))
  check('arranging by hand: a click moves nothing', await orderNow() === before0 && await arrangingNow() === false)
  //  a press and drag, straight away
  await drag(await centre('actions'), await centre('clock'))
  const after0 = JSON.parse(await orderNow())
  check('arranging by hand: a card pressed and dragged moves, without arranging first', after0.indexOf('actions') < after0.indexOf('clock') && await arrangingNow() === false, JSON.stringify(after0))
  //  a long press, then on into a drag without letting go, as in Talon
  const p1 = await centre('money')
  const p2 = await centre('clock')
  await mouse('mousePressed', p1)
  await new Promise((r) => setTimeout(r, 900))
  const held = await arrangingNow()
  for (let i = 1; i <= 12; i++) await mouse('mouseMoved', [Math.round(p1[0] + (p2[0] - p1[0]) * i / 12), Math.round(p1[1] + (p2[1] - p1[1]) * i / 12)], 'left', { buttons: 1 })
  await mouse('mouseReleased', p2)
  await new Promise((r) => setTimeout(r, 600))
  const after1 = await orderNow()
  check('arranging by hand: a long press starts it', held === true)
  check('arranging by hand: held on, the card drags to its place', after1 !== JSON.stringify(after0) && JSON.parse(after1).indexOf('money') < JSON.parse(after1).indexOf('clock'), `${before0} -> ${after1}`)
  //  arranging already: a plain press and drag
  await drag(await centre('mail'), await centre('cal'))
  const after2 = await orderNow()
  check('arranging by hand: arranging, a press and drag moves a card', after2 !== after1 && JSON.parse(after2).indexOf('mail') < JSON.parse(after2).indexOf('cal'), `${after1} -> ${after2}`)
  await evaluate("document.getElementById('done').click()", t.sessionId)

  //  the search box: Brave Search's own addresses, caught before they go
  const s1 = await page(['Search'])
  await cdp('Fetch.enable', { patterns: [{ urlPattern: 'https://search.brave.com/*' }] }, s1.sessionId)
  await evaluate("document.getElementById('sq').value = 'lisbon flights'; document.getElementById('searchform').requestSubmit()", s1.sessionId)
  for (let i = 0; i < 25 && !caught.length; i++) await new Promise((r) => setTimeout(r, 200))
  check('search: Enter goes to Brave Search', caught[0] === 'https://search.brave.com/search?q=lisbon%20flights', caught.join(' '))
  await close(s1)
  const s2 = await page(['Search'])
  await cdp('Fetch.enable', { patterns: [{ urlPattern: 'https://search.brave.com/*' }] }, s2.sessionId)
  await evaluate("document.getElementById('sq').value = 'history of urbit'; document.getElementById('research').click()", s2.sessionId)
  for (let i = 0; i < 25 && caught.length < 2; i++) await new Promise((r) => setTimeout(r, 200))
  check('search: Research starts Ask Brave\'s Deep Research', caught[1] === 'https://search.brave.com/ask?q=history%20of%20urbit&enable_research=true', caught.join(' '))
  await close(s2)

  //  Brave Leo: its form from a lease, the key copied only on its button
  inference = { base_url: 'https://openrouter.example/api/v1', key: 'test-key-wxyz', mode: 'lease', models: ['m-one', 'm-two'] }
  const lo = await page(['Use Armillary in Brave Leo'], 15000, OPTIONS)
  await evaluate("navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve() }; document.getElementById('leoshow').click()", lo.sessionId)
  const leoText = await textOf(lo.sessionId, ['Server endpoint'])
  check('leo: Options fills Leo\'s form from the lease', leoText.includes('m-one (Armillary)') && leoText.includes('https://openrouter.example/api/v1/chat/completions') && leoText.includes('\u2022'.repeat(8) + 'wxyz'), leoText.slice(-600))
  check('leo: the key is not on the page', !(await evaluate('document.body.innerHTML', lo.sessionId)).includes('test-key'))
  await evaluate("[...document.querySelectorAll('.leofield')].find((f) => f.textContent.includes('API Key')).querySelector('button').click()", lo.sessionId)
  for (let i = 0; i < 20 && !await evaluate('window.__copied || ""', lo.sessionId); i++) await new Promise((r) => setTimeout(r, 100))
  check('leo: the key is copied only on its button', await evaluate('window.__copied', lo.sessionId) === 'test-key-wxyz')
  inference = { ...inference, mode: 'proxy' }
  await evaluate("document.getElementById('leoshow').click()", lo.sessionId)
  check('leo: on a proxy, why Leo cannot run', (await textOf(lo.sessionId, ['does not pass a stream on'])).includes('Leo needs a lease'))
  await close(lo)
  inference = null

  //  history into orrery: real visits, a digest, a listed site left out
  for (const u of [`${SITE}/a`, `${SITE}/b`, `${SECRET}/c`]) {
    const v = await cdp('Target.createTarget', { url: u })
    await new Promise((r) => setTimeout(r, 700))
    await cdp('Target.closeTarget', { targetId: v.targetId })
  }
  const off = await handle({ kind: 'historyNow' })
  check('history: nothing is sent while it is off', off.ok === false && reads.length === 0, JSON.stringify(off))
  await evaluate("chrome.storage.local.set({ historyDigest: { on: true, exclude: ['localhost'] } })", ws1)
  const sentNow = await handle({ kind: 'historyNow' })
  const r0 = reads[0]
  check('history: turned on, a digest goes to orrery\'s read channel', sentNow.ok && sentNow.sites === 1 && r0 && r0.source.kind === 'browser' && /^Browsing, /.test(r0.title), JSON.stringify(sentNow) + JSON.stringify(r0))
  check('history: sites, page counts and titles, and nothing else', r0 && r0.text.includes('- 127.0.0.2, 2 pages: ') && r0.text.includes('"Flights to Lisbon"') && r0.text.includes('"Lisbon hotels"') &&
    !r0.text.includes('Secret page') && !r0.text.includes('body text') && !r0.text.includes('127.0.0.1'), r0 && r0.text)
  const o2 = await page(['Browsing history into Orrery'], 15000, OPTIONS)
  check('history: Options says what was sent', (await textOf(o2.sessionId, ['Last sent'])).includes('1 site'), o2.text.slice(-400))
  await close(o2)
  const again2 = await handle({ kind: 'historyNow' })
  check('history: the next digest starts where the last ended', again2.ok && again2.sites === 0 && reads.length === 1, JSON.stringify(again2))

  //  leaving midway: a refresh with a slow source, the tab closed early
  await store({ origin: SHIP, ship: '~zod', status: 'connected' })
  t = await page(['Reading'], 3000)
  await close(t)
  await new Promise((r) => setTimeout(r, 2500))
  const kept = JSON.parse(await evaluate("chrome.storage.local.get('today').then((s) => JSON.stringify(s.today))", ws1))
  check('leaving midway: the refresh finishes and is kept', kept && kept.cards && kept.cards.money && kept.cards.money.data && kept.cards.money.data.balance === 12345678, JSON.stringify(kept))
  slow = 0

  //  5. failures, live: one card each, the rest drawn
  mode = 'fail'
  asked.length = 0
  await store({ origin: SHIP, ship: '~zod', status: 'connected' })
  const fail = [
    'Calendar is not installed on ~zod.',
    'Signed out of ~zod: connect again in Options.',
    '~zod did not answer: it may be down or busy.',
  ]
  t = await page(fail, 30000)
  check('failures, live: each card says why, the rest drawn', has(t.text, fail).length === 0, `missing: ${has(t.text, fail).join(' | ')}\n${t.text}`)
  check('failures, live: two cards did not answer (502 and a dropped connection)', t.text.split('~zod did not answer').length - 1 === 2, t.text)
  check('failures, live: no HTML from the ship is shown', !/Bad Gateway|<html>/.test(t.text), t.text)
  await new Promise((r) => setTimeout(r, 500))
  check('theme: no Talon settings on the ship (404) is the built-in look', await evaluate("document.documentElement.style.getPropertyValue('--bg')", t.sessionId) === '')
  await close(t)
} finally {
  //  the profile is still being written until the browser has gone
  await new Promise((r) => { browser.once('exit', r); browser.kill(); setTimeout(r, 5000) })
  server.close()
  sites.close()
  rmSync(stage, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
