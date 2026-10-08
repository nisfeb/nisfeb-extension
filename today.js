//  The day page: the last snapshot from storage at once, then a refresh
//  asked of the worker, which reads the ship at most once in REFRESH_MS
//  however many tabs ask. The page itself never fetches anything; it
//  asks again only when it comes back into view, or every 15 minutes
//  while it stays in view. Everything shown is built as nodes with text,
//  never HTML: it is the ship's words, and other people's.

import { explain, isWhom, chatChoices, sendToChat } from './lib/ship.js'
import { agenda, money, due } from './lib/today.js'

const $ = (id) => document.getElementById(id)
const ask = (msg) => chrome.runtime.sendMessage(msg)
const APP = { cal: 'Calendar', chats: 'Tlon', actions: 'Orrery', mail: 'Auspex', money: 'Armillary' }
const KEYS = ['origin', 'ship', 'status', 'today', 'lastChats']
const SHOWN = 12

let st = {}
let reading = false
let unread = []
let listed = null

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

  //  Mentions first, then the most recent. A chat a message can go to is
  //  a button that puts it in the reply box.
  chats: (list) => {
    unread = list
    if (!list.length) return [p('Nothing unread.')]
    return [el('ul', {}, list.slice(0, SHOWN).map((u) => el('li', {},
      isWhom(u.whom) ? el('button', { className: 'link', textContent: u.title, onclick: () => pick(u) }) : u.title,
      el('span', {
        className: u.mentions ? 'count mention' : 'count',
        textContent: u.mentions ? `@${u.mentions} · ${u.count}` : String(u.count),
        title: `${u.count} unread${u.mentions ? `, ${u.mentions} mentioning you` : ''}`,
      })))), more(list)]
  },

  //  No anchor for one action in orrery's page: each goes to its inbox.
  actions: (list) => {
    if (!list.length) return [p('Nothing waiting.')]
    const inbox = `${st.origin}/apps/orrery/#inbox`
    return [el('ul', {}, list.slice(0, SHOWN).map((a) => el('li', {},
      el('a', { href: inbox, textContent: a.title || a.kind }), ' ', el('span', { className: 'muted', textContent: a.status })))), more(list)]
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

function render() {
  const now = Date.now()
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

//  ── the reply box: Send to a chat's picker and send ──────────────────

const say = (text, bad = false) => { $('rout').textContent = text; $('rout').className = bad ? 'out bad' : 'out muted' }

function pick(u) {
  $('rwhom').value = u.title
  $('rtext').focus()
}

//  The picker's names, read when the box is first used: the unread chats,
//  then the ones picked here last, then every chat the ship has.
$('rwhom').addEventListener('focus', async () => {
  if (listed) return
  listed = []
  const r = await ask({ kind: 'chats' })
  listed = r.items || []
  $('rlist').replaceChildren(...[...chatChoices(unread, r.recent || [], listed).keys()].map((t) => el('option', { value: t })))
  if (!r.ok) say(explain('Tlon', r.error, ship()), true)
})

$('reply').addEventListener('submit', async (e) => {
  e.preventDefault()
  $('rsend').disabled = true
  say('…')
  try {
    const chats = chatChoices(unread, st.lastChats || [], listed || [])
    const r = await sendToChat(ask, chats, $('rwhom').value, $('rtext').value, st.ship)
    say(r.ok ? r.text : explain('Tlon', r.text, ship()), !r.ok)
    if (r.ok) $('rtext').value = ''
  } catch (err) {
    say(err.message || String(err), true)
  }
  $('rsend').disabled = false
})

//  ── wiring ───────────────────────────────────────────────────────────

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage())
$('ntp').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/newTab' }))
$('brave').hidden = !navigator.brave

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !KEYS.some((k) => k in changes)) return
  for (const k of KEYS) if (k in changes) st[k] = changes[k].newValue
  render()
})

const again = () => { if (document.visibilityState === 'visible') { render(); refresh() } }
document.addEventListener('visibilitychange', again)
setInterval(again, 15 * 60000)

st = await chrome.storage.local.get(KEYS)
render()
refresh()
