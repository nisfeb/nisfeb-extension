//  The day page: the last snapshot from storage at once, then a refresh
//  asked of the worker, which reads the ship at most once in REFRESH_MS
//  however many tabs ask. The page itself never fetches anything; it
//  asks again only when it comes back into view, or every 15 minutes
//  while it stays in view. Everything shown is built as nodes with text,
//  never HTML: it is the ship's words, and other people's. Drawn as
//  Talon's home page is (HomeScreen.kt); its settings live in Options.

import { explain, patternFor } from './lib/ship.js'
import { agenda, money, due, searchUrl } from './lib/today.js'
import { CARDS, COLUMNS, complete, sane, pitches, droppedAt, resizedSpan, resizedRows, readingOrder, clashes } from './lib/layout.js'
import { lookVars, fontOf, displayName, VARS, CACHE, BG_KEY, fontKey } from './lib/theme.js'
import { skyFor, placeKey } from './lib/sky.js'
import { drawDial } from './sky-dial.js'

const $ = (id) => document.getElementById(id)
const ask = (msg) => chrome.runtime.sendMessage(msg)
const APP = { cal: 'Calendar', actions: 'Orrery', mail: 'Auspex', money: 'Armillary' }
const KEYS = ['origin', 'ship', 'status', 'today', 'talonLook', 'useTalonTheme', 'dayMode', 'backgroundAt', 'place', 'weather', 'dayOrder', 'dayLayout', 'dayHidden', 'assistant']
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
  const look = st.talonLook && st.talonLook.origin === st.origin ? st.talonLook : null
  return st.ship ? `${said}, ${displayName(st.ship, look)}` : said
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
//  The page is Talon's grid (lib/layout.js): each card at a column and a
//  row, so many columns wide and rows tall. A card pressed and dragged
//  goes to whichever square it is let go on, at any time, and nothing
//  else moves; its corner grip, shown on hover and while arranging,
//  makes it wider or taller. A long press or a right-click starts
//  arranging, as on Talon: arrows to step a card, x to take it off the
//  page, overlaps outlined, and Done. Pointer events, not the browser's
//  drag and drop, which started late and dropped nothing (measured with
//  real input). Links, controls and the assistant's words keep their own
//  press. A narrow window stacks the cards full width in reading order
//  and is not arranged. Kept per browser, as Talon keeps it per device.

const cards = () => [...document.querySelectorAll('[data-card]')]
const layout = () => complete(st.dayLayout, st.dayOrder)
const setLayout = (l) => chrome.storage.local.set({ dayLayout: l })
const OWN_PRESS = 'a, button, input, textarea, select, .talk, .grip'
const narrow = matchMedia('(max-width: 760px)')

//  Cards taken off the page, as on Talon's: kept per browser, and put
//  back from the header while arranging.
const NAMES = { clock: 'Clock', cal: 'Today', actions: 'Orrery', mail: 'Mail', money: 'Armillary', assistant: 'Assistant' }
const hidden = () => new Set(Array.isArray(st.dayHidden) ? st.dayHidden : [])
const setHidden = (h) => chrome.storage.local.set({ dayHidden: [...h] })

//  One card on its squares, from a layout (or a drag's live copy).
function put(k, p) {
  const s = $(k).style
  s.setProperty('--gc', `${p.col + 1} / span ${p.span}`)
  s.setProperty('--gr', `${p.row + 1} / span ${p.rows}`)
  s.setProperty('--h', String(p.rows))
}

function place(l = layout()) {
  const h = hidden()
  const shown = CARDS.filter((k) => !h.has(k) && !$(k).hidden)
  readingOrder(l).forEach((k, i) => {
    put(k, l[k])
    $(k).style.setProperty('--o', String(i))
    $(k).classList.toggle('gone', h.has(k))
    $(k).classList.toggle('clash', shown.includes(k) && clashes(l, k, shown).length > 0)
  })
  const off = CARDS.filter((k) => h.has(k))
  $('addcards').replaceChildren(...off.map((k) => el('button', {
    textContent: `+ ${NAMES[k]}`, title: `Put ${NAMES[k]} back on the page`,
    onclick: () => { const n = hidden(); n.delete(k); setHidden(n) },
  })))
  $('addcards').hidden = !off.length || !document.body.classList.contains('arranging')
}

function arranging(on) {
  document.body.classList.toggle('arranging', on)
  $('done').hidden = !on
  place()
}

//  A card stepped one square, from its arrows.
function step(k, dc, dr) {
  const l = layout()
  l[k] = sane({ ...l[k], col: l[k].col + dc, row: l[k].row + dr })
  setLayout(l)
}

for (const c of cards()) {
  const k = c.dataset.card
  c.append(
    el('div', { className: 'move' },
      el('button', { textContent: '←', title: 'Move left', ariaLabel: `Move ${NAMES[k]} left`, onclick: () => step(k, -1, 0) }),
      el('button', { textContent: '↑', title: 'Move up', ariaLabel: `Move ${NAMES[k]} up`, onclick: () => step(k, 0, -1) }),
      el('button', { textContent: '↓', title: 'Move down', ariaLabel: `Move ${NAMES[k]} down`, onclick: () => step(k, 0, 1) }),
      el('button', { textContent: '→', title: 'Move right', ariaLabel: `Move ${NAMES[k]} right`, onclick: () => step(k, 1, 0) }),
      el('button', { textContent: '×', title: 'Take it off the page', ariaLabel: `Take ${NAMES[k]} off the page`, className: 'remove', onclick: () => setHidden(hidden().add(k)) })),
    el('div', { className: 'grip', title: 'Drag to resize', ariaHidden: 'true' }))
  c.addEventListener('contextmenu', (e) => {
    if (document.body.classList.contains('arranging') || e.target.closest(OWN_PRESS)) return
    e.preventDefault()
    arranging(true)
  })
}

//  The drag in hand: a move or a resize, the layout it started from, and
//  the square it is on now (drawn at once, saved when let go).
let drag = null
let hold = null

function lift() {
  drag.live = true
  drag.card.classList.add('held')
  document.body.classList.add('dragging')
  getSelection().removeAllRanges()
}

function settle() {
  clearTimeout(hold)
  if (drag) { drag.card.classList.remove('held'); drag.card.style.transform = '' }
  document.body.classList.remove('dragging')
  drag = null
}

addEventListener('pointerdown', (e) => {
  const card = e.target.closest('[data-card]')
  if (!card || e.button !== 0 || narrow.matches) return
  const resize = Boolean(e.target.closest('.grip'))
  if (!resize && e.target.closest(OWN_PRESS)) return
  const l = layout()
  drag = { card, key: card.dataset.card, resize, l, start: l[card.dataset.card], x0: e.clientX, y0: e.clientY, id: e.pointerId, live: false }
  drag.at = drag.start
  if (resize) { e.preventDefault(); lift() } else hold = setTimeout(() => { if (drag && !drag.live) { arranging(true); lift() } }, 600)
})

addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return
  const dx = e.clientX - drag.x0
  const dy = e.clientY - drag.y0
  if (!drag.live) {
    if (Math.hypot(dx, dy) < 6) return
    clearTimeout(hold)
    lift()
  }
  const pitch = pitches($('grid').clientWidth)
  const s = drag.start
  drag.at = drag.resize
    ? { ...s, span: resizedSpan(s.span, dx, pitch.col, COLUMNS - s.col), rows: resizedRows(s.rows, dy, pitch.row) }
    : { ...s, ...droppedAt(s, dx, dy, pitch) }
  place({ ...drag.l, [drag.key]: drag.at })
  //  a card in hand follows the pointer; its squares snap beneath it
  if (!drag.resize) drag.card.style.transform = `translate(${dx - (drag.at.col - s.col) * pitch.col}px, ${dy - (drag.at.row - s.row) * pitch.row}px)`
})

addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return settle()
  const { key, live, l, at } = drag
  settle()
  if (live) setLayout({ ...l, [key]: at })
  else place()
})
addEventListener('pointercancel', () => { settle(); place() })
narrow.addEventListener('change', () => place())

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

//  ── the search box ───────────────────────────────────────────────────
//
//  One box for both: Enter (or Search) searches with Brave, in this tab
//  as a new tab's search does, or with Ctrl or Cmd in another; Shift+Enter
//  (or Assistant) hands the words to the assistant card.

function go(url, elsewhere) {
  if (elsewhere) chrome.tabs.create({ url })
  else location.assign(url)
}
let mod = false
addEventListener('keydown', (e) => { mod = e.ctrlKey || e.metaKey })
addEventListener('keyup', (e) => { mod = e.ctrlKey || e.metaKey })
$('sq').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.shiftKey || e.isComposing) return
  e.preventDefault()
  $('toassist').click()
})
$('searchform').addEventListener('submit', (e) => {
  e.preventDefault()
  const q = $('sq').value.trim()
  if (q) go(searchUrl(q), mod)
})

//  ── the assistant ────────────────────────────────────────────────────
//
//  Talon's Assistant, run by the worker: this draws its history and the
//  write waiting for a yes; its words come from the bar at the top. The
//  words are text, never HTML.

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
  $('toassist').disabled = Boolean(a.busy || a.pending)
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

//  The bar's words to the assistant. Its card comes back onto the page if
//  it was taken off, since that is where the answer shows.
$('toassist').addEventListener('click', async () => {
  const text = $('sq').value.trim()
  if (!text) { $('sq').focus(); return }
  if (st.assistant && (st.assistant.busy || st.assistant.pending)) return
  if (hidden().has('assistant')) { const h = hidden(); h.delete('assistant'); await setHidden(h) }
  const ok = await mayAsk()
  if (!ok.ok) { st.assistant = { ...(st.assistant || {}), error: explain('Armillary', ok.error, ship()) }; talk(); return }
  $('sq').value = ''
  $('assistant').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
//  the clock's minute, and its card's size (a window, or a resize)
setInterval(() => { if (document.visibilityState === 'visible') paintClock() }, 10000)
new ResizeObserver(() => paintClock()).observe($('dial'))

st = await chrome.storage.local.get(KEYS)
render()
//  the keyboard to the bar, once the page has it (boot.js)
$('sq').focus()
background()
askWeather()
refresh()
