//  The day page: the last snapshot from storage at once, then a refresh
//  asked of the worker, which reads the ship at most once in REFRESH_MS
//  however many tabs ask. The page itself never fetches anything; it
//  asks again only when it comes back into view, or every 15 minutes
//  while it stays in view. Everything shown is built as nodes with text,
//  never HTML: it is the ship's words, and other people's.

import { explain } from './lib/ship.js'
import { agenda, money, due } from './lib/today.js'
import { lookVars, VARS } from './lib/theme.js'
import { skyFor, placeKey, coordsOf } from './lib/sky.js'
import { drawDial } from './sky-dial.js'

const $ = (id) => document.getElementById(id)
const ask = (msg) => chrome.runtime.sendMessage(msg)
const APP = { cal: 'Calendar', actions: 'Orrery', mail: 'Auspex', money: 'Armillary' }
const KEYS = ['origin', 'ship', 'status', 'today', 'talonLook', 'useTalonTheme', 'backgroundAt', 'place', 'weather']
const SHOWN = 12

let st = {}
let reading = false

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props)
  n.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== ''))
  return n
}
const p = (text, className = '') => el('p', { textContent: text, className })
const ship = () => st.ship || 'this ship'
const clock = (ms) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ms)
const more = (list) => list.length > SHOWN && p(`and ${list.length - SHOWN} more`, 'muted')
const snapshot = () => (st.today && st.today.origin === st.origin ? st.today : null)

//  What each card draws from its data.
const draw = {
  cal: (d, now) => {
    const a = agenda(d.rows || [], now, d.zone)
    const t = new Intl.DateTimeFormat(undefined, { timeZone: a.zone || undefined, hour: 'numeric', minute: '2-digit' })
    //  the start alone, as the calendar's own month view writes it
    const when = (r) => (r.cat === 'todo' ? 'task' : r.all ? 'all day' : t.format(r.l))
    const list = (rows) => el('ul', {}, rows.map((r) => el('li', { className: r.past ? 'past' : '' },
      el('span', { className: 'when', textContent: when(r) }), ' ', r.name || '(untitled)')))
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone
    return [
      a.today.length ? list(a.today) : p('Nothing on today.'),
      a.tomorrow.length && [el('h3', { textContent: 'Tomorrow' }), list(a.tomorrow)],
      a.zone && a.zone !== here && p(`Times in ${a.zone}, the calendar's zone.`, 'muted'),
    ]
  },

  //  No anchor for one action in orrery's page: each goes to its inbox.
  //  A snapshot from before the spend line is the list alone.
  actions: (d) => {
    const list = Array.isArray(d) ? d : d.list
    const spend = Array.isArray(d) ? null : d.spend
    const inbox = `${st.origin}/apps/orrery/#inbox`
    return [
      list.length ? el('ul', {}, list.slice(0, SHOWN).map((a) => el('li', {},
        el('a', { href: inbox, textContent: a.title || a.kind }), ' ', el('span', { className: 'muted', textContent: a.status })))) : p('Nothing waiting.'),
      more(list),
      spend !== null && spend !== undefined && p(`${money(spend)} on its model this month`, 'muted'),
    ]
  },

  mail: (d) => [
    p(d.unread ? `${d.unread} unread` : 'No unread mail.'),
    d.threads.length > 0 && el('ul', {}, d.threads.map((t) => el('li', {},
      el('span', { className: 'muted', textContent: t.from }), ' ', t.subject || '(no subject)'))),
  ],

  money: (d) => (d.vendor
    ? [p(money(d.balance), 'big'), p(`with ${d.vendor}`, 'muted')]
    : [p('No vendor set yet, so there is no balance to show.')]),
}

function card(k, c, now) {
  const kids = []
  if (c && c.error) kids.push(p(explain(APP[k], c.error, ship()) + (c.data ? ` This is from ${clock(c.at)}.` : ''), 'bad'))
  if (c && c.data) kids.push(draw[k](c.data, now))
  else if (!c || !c.error) kids.push(p(reading ? 'Reading…' : 'Not read yet.', 'muted'))
  $(k).querySelector('.body').replaceChildren(...kids.flat(Infinity).filter(Boolean))
}

function header() {
  const dot = $('dot')
  dot.className = 'dot'
  const snap = snapshot()
  const at = snap ? Math.max(0, ...Object.values(snap.cards || {}).map((c) => c.at || 0)) : 0
  let who = st.ship || st.origin || ''
  if (st.status === 'connected') dot.classList.add('ok')
  else if (st.status === 'signed-out') { dot.classList.add('bad'); who += ': signed out, connect again in Options' }
  else if (st.status === 'unreachable') { dot.classList.add('warn'); who += ' did not answer' }
  $('who').textContent = `${who}${reading ? ' · reading' : at ? ` · read at ${clock(at)}` : ''}`
}

//  Talon's look for this ship, unless turned off here. Kept in this
//  page's localStorage too, for theme-boot.js to paint the next tab with
//  before this module has loaded.
function look() {
  const l = st.talonLook && st.talonLook.origin === st.origin ? st.talonLook : null
  const v = lookVars(l, st.useTalonTheme !== false)
  const s = document.documentElement.style
  for (const k of VARS) s.removeProperty(k)
  for (const [k, x] of Object.entries(v)) s.setProperty(k, x)
  try { localStorage.dayLook = JSON.stringify(v) } catch { /* no storage: the next tab paints late */ }
  $('talontheme').checked = st.useTalonTheme !== false
}

//  ── the sky clock ────────────────────────────────────────────────────
//
//  Talon keeps its clock's units per device; here they follow the
//  browser's language: 24-hour where its clock is, Fahrenheit where its
//  region uses it.
const region = (() => { try { return new Intl.Locale(navigator.language).maximize().region } catch { return '' } })()
const UNITS = {
  fahrenheit: ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'].includes(region),
  twentyFourHour: !/h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle || 'h12'),
}

function paintClock() {
  const w = st.weather && st.place && st.weather.key === placeKey(st.place) ? st.weather.sky : null
  drawDial($('dial'), $('readout'), skyFor(Date.now(), st.place || null, w), UNITS)
  $('where').textContent = st.place ? st.place.label : 'Set a location'
  $('nowhere').hidden = Boolean(st.place)
  $('placeclear').hidden = !st.place
}

$('where').addEventListener('click', () => { $('look').open = true; $('placeq').focus() })

//  Typed coordinates are taken as they are; anything else is looked up.
$('placeform').addEventListener('submit', async (e) => {
  e.preventDefault()
  const q = $('placeq').value
  const typed = coordsOf(q)
  if (typed) { await chrome.storage.local.set({ place: typed }); $('places').replaceChildren(); return }
  if (!q.trim()) return
  $('places').replaceChildren(p('…', 'muted'))
  const r = await ask({ kind: 'places', q })
  if (!r.ok) { $('places').replaceChildren(p(`Open-Meteo did not answer: ${r.error}`, 'bad')); return }
  $('places').replaceChildren(...(r.places.length ? r.places.map((place) => el('button', {
    textContent: place.label,
    onclick: async () => { await chrome.storage.local.set({ place }); $('places').replaceChildren() },
  })) : [p('No place by that name.', 'muted')]))
})

$('placeclear').addEventListener('click', () => chrome.storage.local.remove(['place', 'weather']))

//  No place, nothing to ask. The worker decides whether the forecast is due.
const askWeather = () => { if (st.place) ask({ kind: 'weather' }).catch(() => { /* the worker is reloading: the next view asks again */ }) }

function render() {
  const now = Date.now()
  look()
  paintClock()
  $('date').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now)
  header()
  $('none').hidden = Boolean(st.origin)
  $('cards').hidden = !st.origin
  if (!st.origin) return
  for (const a of document.querySelectorAll('h2 a')) a.href = `${st.origin}${a.dataset.app}`
  const snap = snapshot()
  for (const k of Object.keys(APP)) card(k, snap && snap.cards && snap.cards[k], now)
}

//  Ask the worker to read the ship. It answers at once when the last read
//  is recent, so "reading" shows only when a read is due.
async function refresh() {
  if (!st.origin || reading) return
  reading = due(snapshot(), st.origin, Date.now())
  if (reading) render()
  try { await ask({ kind: 'today' }) } catch { /* the worker is reloading: the next view asks again */ }
  reading = false
  render()
}

//  ── the background: one image, in this browser's Cache Storage ─────
//
//  Not storage.local, whose quota (10 MB) a photo can take whole. The
//  time it changed goes in storage.local, so every open day tab redraws.
//  ponytail: kept as chosen, not scaled down; scale it if big photos
//  make the new tab slow to paint.

//  The Cache API keys only http(s) URLs, and a page here is
//  chrome-extension://, so the key is a name that is never fetched.
const BG = 'https://day.nisfeb.invalid/background'
let bgUrl = ''

async function background() {
  let url = ''
  try {
    const hit = await (await caches.open('nisfeb-day')).match(BG)
    if (hit) url = URL.createObjectURL(await hit.blob())
  } catch { /* no cache: no picture */ }
  if (bgUrl) URL.revokeObjectURL(bgUrl)
  bgUrl = url
  document.body.style.backgroundImage = url ? `url("${url}")` : ''
  document.body.classList.toggle('pictured', Boolean(url))
  $('bgremove').hidden = !url
}

$('bgfile').addEventListener('change', async () => {
  const f = $('bgfile').files[0]
  $('bgfile').value = ''
  if (!f) return
  if (!f.type.startsWith('image/')) { $('bgsay').textContent = `${f.name} is not an image.`; return }
  try {
    await (await caches.open('nisfeb-day')).put(BG, new Response(f, { headers: { 'content-type': f.type } }))
  } catch (e) {
    $('bgsay').textContent = `Could not keep it: ${e.message || e}`
    return
  }
  $('bgsay').textContent = 'Kept in this browser only.'
  await chrome.storage.local.set({ backgroundAt: Date.now() })
})

$('bgremove').addEventListener('click', async () => {
  await (await caches.open('nisfeb-day')).delete(BG)
  await chrome.storage.local.set({ backgroundAt: Date.now() })
})

//  ── wiring ───────────────────────────────────────────────────────────

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage())
$('ntp').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/getStarted' }))
$('brave').hidden = !navigator.brave
$('talontheme').addEventListener('change', () => chrome.storage.local.set({ useTalonTheme: $('talontheme').checked }))

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !KEYS.some((k) => k in changes)) return
  for (const k of KEYS) if (k in changes) st[k] = changes[k].newValue
  if ('backgroundAt' in changes) background()
  if ('place' in changes) askWeather()
  render()
})

const again = () => {
  if (document.visibilityState !== 'visible') return
  render()
  refresh()
  askWeather()
}
document.addEventListener('visibilitychange', again)
setInterval(again, 15 * 60000)
//  the clock's minute, and the window's width
setInterval(() => { if (document.visibilityState === 'visible') paintClock() }, 10000)
addEventListener('resize', paintClock)

st = await chrome.storage.local.get(KEYS)
render()
background()
askWeather()
refresh()
