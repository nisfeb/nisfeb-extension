//  The day page: the last snapshot from storage at once, then a refresh
//  asked of the worker, which reads the ship at most once in REFRESH_MS
//  however many tabs ask. The page itself never fetches anything; it
//  asks again only when it comes back into view, or every 15 minutes
//  while it stays in view. Everything shown is built as nodes with text,
//  never HTML: it is the ship's words, and other people's. Drawn as
//  Talon's home page is (HomeScreen.kt); its settings live in Options.

import { explain, patternFor } from './lib/ship.js'
import { agenda, money, due, ordered, moved } from './lib/today.js'
import { lookVars, fontOf, VARS, CACHE, BG_KEY, fontKey } from './lib/theme.js'
import { skyFor, placeKey } from './lib/sky.js'
import { drawDial } from './sky-dial.js'

const $ = (id) => document.getElementById(id)
const ask = (msg) => chrome.runtime.sendMessage(msg)
const APP = { cal: 'Calendar', actions: 'Orrery', mail: 'Auspex', money: 'Armillary' }
const KEYS = ['origin', 'ship', 'status', 'today', 'talonLook', 'useTalonTheme', 'dayMode', 'backgroundAt', 'place', 'weather', 'dayOrder', 'assistant']
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

//  Talon's QuickRow: a 12px title, bold when it wants attention, a muted
//  note beside it and a muted line under it.
const row = ({ title, side, line, strong, href, className = '' }) => el('li', { className },
  el('div', { className: 'row' },
    el('span', { className: strong ? 'title strong' : 'title' }, href ? el('a', { href, textContent: title }) : title),
    side && el('span', { className: 'side', textContent: side })),
  line && el('div', { className: 'line', textContent: line }))

//  What each card draws from its data.
const draw = {
  cal: (d, now) => {
    const a = agenda(d.rows || [], now, d.zone)
    const t = new Intl.DateTimeFormat(undefined, { timeZone: a.zone || undefined, hour: 'numeric', minute: '2-digit' })
    //  the start alone, as the calendar's own month view writes it
    const when = (r) => (r.cat === 'todo' ? 'task' : r.all ? 'all day' : t.format(r.l))
    const list = (rows) => el('ul', {}, rows.map((r) => row({ title: r.name || '(untitled)', side: when(r), className: r.past ? 'past' : '' })))
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone
    return [
      a.today.length ? list(a.today) : p('Nothing on today.', 'muted'),
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
      list.length ? el('ul', {}, list.slice(0, SHOWN).map((a) => row({ title: a.title || a.kind, side: a.status, href: inbox, strong: a.status === 'proposed' })))
        : p('Nothing waiting.', 'muted'),
      more(list),
      spend !== null && spend !== undefined && p(`${money(spend)} on its model this month`, 'muted'),
    ]
  },

  mail: (d) => [
    p(d.unread ? `${d.unread} unread` : 'No unread mail.', 'muted'),
    d.threads.length > 0 && el('ul', {}, d.threads.map((t) => row({
      title: t.from, line: t.subject || '(no subject)', side: t.last ? clock(t.last) : '', strong: true,
    }))),
  ],

  money: (d) => (d.vendor
    ? [p(money(d.balance), 'big'), p(`with ${d.vendor}`, 'muted')]
    : [p('No vendor set yet, so there is no balance to show.', 'muted')]),
}

function card(k, c, now) {
  const kids = []
  if (c && c.error) kids.push(p(explain(APP[k], c.error, ship()) + (c.data ? ` This is from ${clock(c.at)}.` : ''), 'bad'))
  if (c && c.data) kids.push(draw[k](c.data, now))
  else if (!c || !c.error) kids.push(p(reading ? 'Reading…' : 'Not read yet.', 'muted'))
  $(k).querySelector('.body').replaceChildren(...kids.flat(Infinity).filter(Boolean))
}

//  Talon's greeting, by the hour (HomeScreen.timeOfDayGreeting).
function hello(now) {
  const h = new Date(now).getHours()
  const said = h >= 5 && h <= 11 ? 'Good morning' : h >= 12 && h <= 16 ? 'Good afternoon' : h >= 17 && h <= 21 ? 'Good evening' : 'Good night'
  return st.ship ? `${said}, ${st.ship}` : said
}

function header(now) {
  $('hello').textContent = hello(now)
  const dot = $('dot')
  dot.className = 'dot'
  const snap = snapshot()
  const at = snap ? Math.max(0, ...Object.values(snap.cards || {}).map((c) => c.at || 0)) : 0
  let who = ''
  if (st.status === 'connected') dot.classList.add('ok')
  else if (st.status === 'signed-out') { dot.classList.add('bad'); who = 'signed out, connect again in Options' }
  else if (st.status === 'unreachable') { dot.classList.add('warn'); who = `${ship()} did not answer` }
  const when = reading ? 'reading' : at ? `read at ${clock(at)}` : ''
  $('whotext').textContent = [who, when].filter(Boolean).join(' · ')
  $('who').hidden = !st.origin
}

//  ── the look: Talon's, kept for the next tab's first paint ──────────

const faced = new Set()

//  The faces of Talon's font that the worker has kept, made page fonts.
//  Until they load, and wherever one is missing, the sans stands in.
async function faces(look) {
  const f = fontOf(look)
  if (!f) return
  const cache = await caches.open(CACHE).catch(() => null)
  for (const face of f.faces) {
    if (!cache || faced.has(face.id)) continue
    const hit = await cache.match(fontKey(face.id))
    if (!hit) continue
    faced.add(face.id)
    try {
      const ff = new FontFace(f.family, await hit.arrayBuffer(), { weight: String(face.weight), style: face.italic ? 'italic' : 'normal' })
      document.fonts.add(await ff.load())
    } catch { /* a file the browser cannot read: the sans stands in */ }
  }
}

function look() {
  const l = st.talonLook && st.talonLook.origin === st.origin ? st.talonLook : null
  const use = st.useTalonTheme !== false
  const v = lookVars(l, use, st.dayMode || 'system')
  const s = document.documentElement.style
  for (const k of VARS) s.removeProperty(k)
  for (const [k, x] of Object.entries(v)) s.setProperty(k, x)
  try { localStorage.dayLook = JSON.stringify(v) } catch { /* no storage: the next tab paints late */ }
  if (use) faces(l)
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
}

//  The place is set in Options.
$('where').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html#clock') }))

//  No place, nothing to ask. The worker decides whether the forecast is due.
const askWeather = () => { if (st.place) ask({ kind: 'weather' }).catch(() => { /* the worker is reloading: the next view asks again */ }) }

//  ── arranging, as on Talon's home page ───────────────────────────────
//
//  No Arrange button: a long press or a right-click on any card starts
//  it, as on Talon. Cards are dragged onto the place they should take,
//  or moved a step with the arrows each shows; Done or Escape ends it.
//  The order is kept per browser, as Talon keeps its own per device.

const cards = () => [...document.querySelectorAll('[data-card]')]
const order = () => ordered(st.dayOrder)
const setOrder = (o) => chrome.storage.local.set({ dayOrder: o })

function place() {
  order().forEach((k, i) => { $(k).style.order = String(i) })
}

function arranging(on) {
  document.body.classList.toggle('arranging', on)
  $('done').hidden = !on
  for (const c of cards()) c.draggable = on
}

for (const c of cards()) {
  const k = c.dataset.card
  c.append(el('div', { className: 'move' },
    el('button', { textContent: '←', title: 'Move earlier', ariaLabel: 'Move earlier', onclick: () => setOrder(moved(order(), k, order().indexOf(k) - 1)) }),
    el('button', { textContent: '→', title: 'Move later', ariaLabel: 'Move later', onclick: () => setOrder(moved(order(), k, order().indexOf(k) + 1)) })))
  //  a right-click starts arranging, but not on a link or a control, whose
  //  own menu the browser keeps
  c.addEventListener('contextmenu', (e) => {
    if (document.body.classList.contains('arranging') || e.target.closest('a, button, input')) return
    e.preventDefault()
    arranging(true)
  })
  let hold = null
  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('a, button, input')) return
    const [x, y] = [e.clientX, e.clientY]
    hold = setTimeout(() => arranging(true), 600)
    const off = (m) => { if (!m || Math.hypot(m.clientX - x, m.clientY - y) > 8) { clearTimeout(hold); removeEventListener('pointermove', off); removeEventListener('pointerup', end) } }
    const end = () => off(null)
    addEventListener('pointermove', off)
    addEventListener('pointerup', end)
  })
  c.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', k)
    e.dataTransfer.effectAllowed = 'move'
    c.classList.add('held')
  })
  c.addEventListener('dragend', () => { for (const x of cards()) x.classList.remove('held', 'over') })
  c.addEventListener('dragover', (e) => { if (document.body.classList.contains('arranging')) { e.preventDefault(); c.classList.add('over') } })
  c.addEventListener('dragleave', () => c.classList.remove('over'))
  c.addEventListener('drop', (e) => {
    e.preventDefault()
    c.classList.remove('over')
    const from = e.dataTransfer.getData('text/plain')
    if (from && from !== k) setOrder(moved(order(), from, order().indexOf(k)))
  })
}

$('done').addEventListener('click', () => arranging(false))
addEventListener('keydown', (e) => { if (e.key === 'Escape') arranging(false) })

//  ── the background: one image, in this browser's Cache Storage ─────
//
//  Chosen in Options. The time it changed is in storage.local, so every
//  open day tab redraws. ponytail: kept as chosen, not scaled down;
//  scale it if big photos make the new tab slow to paint.

let bgUrl = ''

async function background() {
  let url = ''
  try {
    const hit = await (await caches.open(CACHE)).match(BG_KEY)
    if (hit) url = URL.createObjectURL(await hit.blob())
  } catch { /* no cache: no picture */ }
  if (bgUrl) URL.revokeObjectURL(bgUrl)
  bgUrl = url
  document.body.style.backgroundImage = url ? `url("${url}")` : ''
  document.body.classList.toggle('pictured', Boolean(url))
}

//  ── the assistant ────────────────────────────────────────────────────
//
//  Talon's Assistant, run by the worker: this draws its history, the
//  write waiting for a yes, and a box. The words are text, never HTML.

function talk() {
  const a = st.assistant || {}
  const lines = (a.history || []).slice(-12).map((h) => el('div', { className: h.role === 'user' ? 'me' : 'it', textContent: h.text }))
  if ((a.busy || a.pending) && a.asking) lines.push(el('div', { className: 'me', textContent: a.asking }))
  if (a.busy) lines.push(el('div', { className: 'note', textContent: 'Thinking…' }))
  if (a.error) lines.push(el('div', { className: 'note bad', textContent: `That did not go through: ${a.error}` }))
  if (!lines.length) lines.push(el('div', { className: 'note', textContent: 'Ask about your day, your calendar or what orrery knows, or tell it what to add. Anything it would write waits for your yes.' }))
  $('talk').replaceChildren(...lines)
  $('talk').scrollTop = $('talk').scrollHeight
  $('confirm').hidden = !a.pending
  $('ctext').textContent = a.pending ? a.pending.text : ''
  $('asksend').disabled = Boolean(a.busy || a.pending)
  $('anew').hidden = !(a.history && a.history.length) || Boolean(a.busy)
}

//  The model's answers come from Armillary's endpoint, a third origin:
//  the first question asks the browser for it under this click, as Ask
//  does. Refused, the request still goes out where the endpoint allows.
async function mayAsk() {
  const inf = await ask({ kind: 'inference' })
  if (!inf.ok) return inf
  const origins = [patternFor(inf.base)]
  try { if (!(await chrome.permissions.contains({ origins }))) await chrome.permissions.request({ origins }) } catch { /* CORS may still allow it */ }
  return { ok: true }
}

$('askform').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('askq').value.trim()
  if (!text || (st.assistant && (st.assistant.busy || st.assistant.pending))) return
  const ok = await mayAsk()
  if (!ok.ok) { st.assistant = { ...(st.assistant || {}), error: explain('Armillary', ok.error, ship()) }; talk(); return }
  $('askq').value = ''
  ask({ kind: 'assist', text }).catch(() => { /* the worker is reloading: its state says where it got to */ })
})
$('cyes').addEventListener('click', () => ask({ kind: 'assistAnswer', yes: true }).catch(() => {}))
$('cno').addEventListener('click', () => ask({ kind: 'assistAnswer', yes: false }).catch(() => {}))
$('anew').addEventListener('click', () => ask({ kind: 'assistReset' }).catch(() => {}))

//  ── wiring ───────────────────────────────────────────────────────────

function render() {
  const now = Date.now()
  look()
  place()
  header(now)
  paintClock()
  $('none').hidden = Boolean(st.origin)
  for (const k of [...Object.keys(APP), 'assistant']) $(k).hidden = !st.origin
  if (!st.origin) return
  talk()
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

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage())

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
