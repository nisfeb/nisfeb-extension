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
//    Talon's theme   the active custom theme read off %settings and set on
//                    the page, off when turned off, built-in on a 404
//    the sky clock   drawn with no ship at all, asking for a location and
//                    fetching no weather without one; a stored forecast
//                    drawn on it, not fetched again while fresh
//    a background    an image chosen is behind the page, in a new tab too,
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
import { patternFor, localDate } from '../lib/ship.js'

//  ── the stand-in ship ────────────────────────────────────────────────

const now = Date.now()
const [y, m, d] = localDate(new Date(now)).split('-').map(Number)
const todayUtc = Date.UTC(y, m - 1, d)
const asked = []
let mode = 'ok'
let slow = 0

const fixtures = {
  '/apps/calendar/config.json': { title: 'Calendar', zone: null, ball: 'x', ship: '~zod', lead_min: 30 },
  '/apps/orrery/api/actions?status=open': [{ id: 'a1', kind: 'call', title: 'Call Dana about the lease', status: 'proposed', by: 'orrery', about: [], history: [] }],
  '/apps/auspex/api/inbox?view=inbox&limit=20': { total: 3, offset: 0, limit: 20, view: 'inbox', unread: 2, labels: [], threads: [
    { id: '0v1', subject: 'Dinner on Friday', from: '~sampel-palnet', last: now, unread: true },
    { id: '0v2', subject: 'Read already', from: '~bus', last: now - 1, unread: false },
  ] },
  '/~/scry/settings/bucket/talon/ui-prefs.json': { bucket: {
    themes: JSON.stringify({ activeId: 't1', themes: [{ id: 't1', name: 'Night', dark: true, primary: '#7C3AED', secondary: '#0EA5E9', tertiary: '#10B981', background: '#0B0B10', surface: '#14141C' }] }),
    accent: JSON.stringify({ enabled: false, mode: 'Brand' }),
  } },
  '/apps/armillary/api/account': { ship: '~zod', balance: 12345678, keys_pending: [{ secret: 'sk-or-SECRET' }], vendor: '~wex', self: '~zod', stale: 3 },
}

const server = createServer((req, res) => {
  const path = req.url
  asked.push(`${req.method} ${path.replace(/^\/~\/channel\/[^?]+/, '/~/channel/<id>')}`)
  if (path.startsWith('/apps/calendar/window.json')) {
    if (mode === 'fail') return res.writeHead(404).end('<html>not found</html>')
    return json(res, { caps: [], rows: [
      { id: 'e1', cal: 'default', idx: 0, meta: { name: 'Trip to Lisbon' }, cat: 'allday', kind: 'once', all: true, done: false, l: todayUtc, r: todayUtc + 864e5 },
      { id: 'e2', cal: 'default', idx: 0, meta: { name: 'Standup' }, cat: 'timed', kind: 'once', all: false, done: false, l: now - 60000, r: now + 60000 },
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
    e[k] = { ...(e[k] || {}), api: (e[k] && e[k].api) || [], explicit_host: [patternFor(SHIP)], manifest_permissions: [], scriptable_host: [] }
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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
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
const store = (obj) => evaluate(`chrome.storage.session.clear().then(() => chrome.storage.local.clear()).then(() => chrome.storage.local.set(${JSON.stringify(obj)}))`, ws1)
const PAGE = `chrome-extension://${new URL(worker.url).host}/today.html`

//  Open the page, wait until its text has everything in `want` (or time
//  runs out), and hand back the text and a session for driving it.
async function page(want, ms = 15000) {
  const { targetId } = await cdp('Target.createTarget', { url: PAGE })
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
    '~zod: signed out, connect again in Options',
  ]
  check('cached failures: each card\'s words, the old data kept', has(t.text, said).length === 0, `missing: ${has(t.text, said).join(' | ')}\n${t.text}`)
  await close(t)

  //  4. a refresh against the stand-in: every source once, then the cards
  await store({ origin: SHIP, ship: '~zod', status: 'connected' })
  const live = ['Trip to Lisbon', 'Standup', 'Pay the rent', 'Call Dana about the lease', '2 unread', 'Dinner on Friday', '$12.35']
  t = await page(live, 30000)
  check('refresh: every card drawn from the ship', has(t.text, live).length === 0, `missing: ${has(t.text, live).join(' | ')}\n${t.text}`)
  check('refresh: the mail page shows only unread subjects', !t.text.includes('Read already'), t.text)
  const once = [
    'GET /apps/calendar/config.json',
    `GET /apps/calendar/window.json?from=${'*'}`,
    'GET /apps/orrery/api/actions?status=open',
    'GET /~/scry/settings/bucket/talon/ui-prefs.json',
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
  const prop = (k) => evaluate(`document.documentElement.style.getPropertyValue('${k}')`, t.sessionId)
  const lookOn = async () => { for (let i = 0; i < 25 && await prop('--bg') !== '#14141c'; i++) await new Promise((r) => setTimeout(r, 200)); return prop('--bg') }
  check('theme: Talon\'s active custom theme is on the page', await lookOn() === '#14141c' && await prop('color-scheme') === 'dark', await prop('--bg'))
  check('theme: kept for the next tab\'s first paint', (await evaluate('localStorage.dayLook', t.sessionId) || '').includes('#14141c'))
  await evaluate("document.getElementById('talontheme').click()", t.sessionId)
  await new Promise((r) => setTimeout(r, 500))
  check('theme: turned off, the built-in colours', await prop('--bg') === '' && JSON.parse(await evaluate('localStorage.dayLook', t.sessionId)).constructor === Object, await prop('--bg'))
  await evaluate("document.getElementById('talontheme').click()", t.sessionId)
  check('theme: and back on', await lookOn() === '#14141c')
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
  })()`, t.sessionId)
  const pictured = (s) => evaluate("document.body.classList.contains('pictured') && document.body.style.backgroundImage.startsWith('url(\"blob:')", s)
  const settle = async (s, want) => { for (let i = 0; i < 25 && await pictured(s) !== want; i++) await new Promise((r) => setTimeout(r, 200)); return pictured(s) }
  await choose('text/plain')
  await evaluate("document.getElementById('look').open = true", t.sessionId)
  const said1 = await textOf(t.sessionId, ['is not an image'], 3000)
  check('background: a file that is not an image is refused', said1.includes('x is not an image.') && !await pictured(t.sessionId), said1.slice(-300))
  await choose('image/png')
  check('background: the image chosen is behind the page', await settle(t.sessionId, true) === true, await evaluate("document.getElementById('bgsay').textContent", t.sessionId))
  const t2 = await page(['Trip to Lisbon'])
  check('background: a new tab has it too', await settle(t2.sessionId, true) === true)
  await evaluate("document.getElementById('bgremove').click()", t.sessionId)
  check('background: removed, from every open tab', await settle(t.sessionId, false) === false && await settle(t2.sessionId, false) === false)
  await close(t2)

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
  rmSync(stage, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
