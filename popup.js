//  The popup: status, the page in hand, and one card per app. Every ship
//  call goes through the worker (chrome.runtime.sendMessage), which is the
//  one place status is decided.

import { parseShips, quoted, calendarPoke, localDate, patternFor, chatText, chatChoices, sendToChat, explain as said } from './lib/ship.js'
import { money } from './lib/today.js'
import { hostOf, excluded, pausedTill, pauseUntil, tomorrow } from './lib/history.js'

const $ = (id) => document.getElementById(id)
const ask = (msg) => chrome.runtime.sendMessage(msg)
const out = (card, text, bad = false) => {
  const p = $(card).querySelector('.out')
  p.textContent = text
  p.classList.toggle('bad', bad)
}

let s = { status: 'none' }
let ctx = { sel: '', url: '', title: '', tabId: undefined }
let inf = null
let answer = ''
let chats = null

async function status() {
  s = await ask({ kind: 'state' })
  const dot = $('dot')
  dot.className = 'dot'
  if (s.status === 'connected') { dot.classList.add('ok'); $('who').textContent = s.ship || s.origin }
  else if (s.status === 'signed-out') { dot.classList.add('bad'); $('who').textContent = 'Signed out: connect again in Options' }
  else if (s.status === 'unreachable') { dot.classList.add('warn'); $('who').textContent = `${s.ship || s.origin} did not answer` }
  else $('who').textContent = 'No ship yet: set one up in Options'
}

async function load() {
  await status()
  //  A menu click on a page stashed what it saw and which card it wanted.
  const { pending } = await chrome.storage.session.get('pending')
  await chrome.storage.session.remove('pending')
  ctx = await ask({ kind: 'context', tabId: pending ? pending.tabId : -1 })
  if (pending) {
    for (const [k, v] of Object.entries(pending)) if (v && k !== 'card') ctx[k] = v
  }
  $('page').textContent = ctx.title || ctx.url
  $('page').title = ctx.url
  const q = quoted(ctx)
  $('subject').value = ctx.title
  $('body').value = q
  $('ctext').value = chatText(ctx)
  $('rtitle').value = ctx.title
  $('rtext').value = ctx.sel
  $('ename').value = ctx.title
  $('enote').value = q
  $('edate').value = localDate()
  document.querySelector('[data-do=clip]').disabled = !ctx.sel
  if (pending && pending.card && $(pending.card)) {
    const d = $(pending.card)
    d.open = true
    const f = d.querySelector('input, textarea, select')
    if (f) f.focus()
  }
}

//  The ship's one-word refusals, said for a person, by the card's app.
const APP = { mail: 'Auspex', chat: 'Tlon', read: 'Orrery', here: 'Orrery', lattice: 'Lattice', event: 'Calendar', ask: 'Armillary' }
const explain = (card, error) => said(APP[card], error, s.ship || 'this ship')

//  Where answers come from, which models, and what is left. Read when the
//  card opens, not before: it is two requests to the ship. Armillary with
//  no key answers "no key yet", and that is a state, not an error: the
//  card says what it needs and where to get it.
$('ask').addEventListener('toggle', async () => {
  if (!$('ask').open || inf) return
  out('ask', 'Asking Armillary what it can answer with…')
  const r = await ask({ kind: 'inference' })
  if (!r.ok) {
    const noKey = /no key yet/.test(r.error)
    $('balance').textContent = noKey ? 'no key yet' : ''
    out('ask', noKey
      ? `Armillary on ${s.ship || 'this ship'} has no inference key. Set a vendor and mint a key there (or take a lease), and this card will offer its models.`
      : explain('ask', r.error), true)
    $('armillary').classList.toggle('hidden', !noKey)
    return
  }
  inf = r
  out('ask', '')
  $('balance').textContent = typeof r.balance === 'number' ? money(r.balance) : ''
  $('askform').classList.remove('hidden')
  if (r.models.length) {
    $('model').replaceChildren(...r.models.map((m) => new Option(m, m)))
    if (s.model && r.models.includes(s.model)) $('model').value = s.model
  } else {
    $('model').replaceChildren(new Option(s.model || 'no model listed: name one in Options', s.model || ''))
  }
})

//  The chats to offer, read when the card opens: the ones picked here
//  last, then every DM, group DM and chat channel the ship has. A name
//  maps to its address; an address or a ship can also be typed.
$('chat').addEventListener('toggle', async () => {
  if (!$('chat').open || chats) return
  chats = new Map()
  const r = await ask({ kind: 'chats' })
  chats = chatChoices(r.recent || [], r.items || [])
  $('chatlist').replaceChildren(...[...chats.keys()].map((t) => Object.assign(document.createElement('option'), { value: t })))
  if (!r.ok) out('chat', explain('chat', r.error), true)
})

//  "This page in Orrery" (orrery 101): what orrery made of the page in
//  hand, asked when the card opens. The owner files it under a plan, says
//  it is not about something orrery tied it to, makes it the place for a
//  plan, or keeps its site out for good; and pauses reading. Orrery's
//  answer is built as nodes with text: it holds page titles and names.
let here = null
const plans = () => (here && Array.isArray(here.plans) ? here.plans : [])
const nameOf = (id) => (plans().find((p) => p.id === id) || {}).name || id
async function hereLoad(quiet = false) {
  const { historyDigest: h = {}, browsingPause = [] } = await chrome.storage.local.get(['historyDigest', 'browsingPause'])
  const till = pausedTill(browsingPause, Date.now())
  $('pausing').classList.toggle('hidden', !h.on)
  $('pausenote').textContent = till ? `Reading is paused until ${new Date(till).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''
  $('resume').classList.toggle('hidden', !till)
  const host = hostOf(ctx.url)
  const said = (text) => Object.assign(document.createElement('p'), { textContent: text })
  if (!host) {
    $('herebody').replaceChildren(said('Orrery reads web pages only.'))
    $('hereplans').classList.add('hidden')
    document.querySelector('[data-do=never]').classList.add('hidden')
    return
  }
  if (!quiet) out('here', 'Asking Orrery about this page…')
  const r = await ask({ kind: 'browsePage', url: ctx.url, title: ctx.title })
  if (!r.ok) { out('here', explain('here', r.error), true); return }
  if (!quiet) out('here', '')
  here = r.page || {}
  const kids = []
  const never = here.skipped || excluded(host, h.exclude || [])
  if (never) kids.push(said('Orrery never reads this site.'))
  else if (!h.on) kids.push(said('Browsing into Orrery is off, so it reads no pages. You can still file this one.'))
  const tied = Array.isArray(here.tied) ? here.tied : []
  if (tied.length) {
    kids.push(said('Orrery ties it to:'), Object.assign(document.createElement('ul'), {}))
    kids[kids.length - 1].append(...tied.map((t) => {
      const li = document.createElement('li')
      const b = Object.assign(document.createElement('button'), { textContent: 'Not related', title: `This page is not about ${t.name}` })
      b.dataset.do = 'unrelate'
      b.dataset.body = t.id
      li.append(t.name || t.id, b)
      return li
    }))
  } else if (!never) kids.push(said('Orrery ties it to nothing yet.'))
  const filed = Array.isArray(here.filed) ? here.filed : []
  if (filed.length) kids.push(said(`Filed under ${filed.map((f) => f.name || f.id).join(', ')}.`))
  $('herebody').replaceChildren(...kids)
  const day = (iso) => (iso ? ` (${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})` : '')
  $('plan').replaceChildren(...plans().map((p) => new Option(`${p.name}${day(p.starts)}${p.placed ? '' : ', no place yet'}`, p.id)))
  $('hereplans').classList.toggle('hidden', !plans().length)
  document.querySelector('[data-do=never]').classList.toggle('hidden', never)
}
$('here').addEventListener('toggle', () => { if ($('here').open && !here) hereLoad() })

//  The owner's list of sites never sent, as Options keeps it; a pause, as
//  the worker reads it before every send and page read.
async function neverRead(host) {
  const { historyDigest: h = {} } = await chrome.storage.local.get('historyDigest')
  await chrome.storage.local.set({ historyDigest: { ...h, exclude: [...new Set([...(h.exclude || []), host])] } })
}
async function pause(until) {
  const { browsingPause = [] } = await chrome.storage.local.get('browsingPause')
  await chrome.storage.local.set({ browsingPause: pauseUntil(browsingPause, Date.now(), until) })
}

$('armillary').addEventListener('click', () => chrome.tabs.create({ url: `${s.origin}/apps/armillary/` }))

const run = {
  mail: async () => {
    const { ships, bad } = parseShips($('to').value)
    if (bad.length) return { ok: false, text: `not a ship: ${bad.join(', ')}` }
    if (!ships.length) return { ok: false, text: 'who is it for?' }
    const r = await ask({ kind: 'mail', to: ships, subject: $('subject').value, body: $('body').value })
    if (!r.ok) return { ok: false, text: r.error }
    const skipped = r.refused.map((x) => `${x.ship} (${x.why})`).join(', ')
    return { ok: true, text: skipped ? `Sent, but not carried to ${skipped}` : 'Sent' }
  },
  //  A draft with everything in it, then the web client, whose composer
  //  has the contacts, the attachments and the rest of what this box has not.
  draft: async () => {
    const { ships, bad } = parseShips($('to').value)
    if (bad.length) return { ok: false, text: `not a ship: ${bad.join(', ')}` }
    const r = await ask({ kind: 'draft', to: ships, subject: $('subject').value, body: $('body').value })
    if (!r.ok) return { ok: false, text: r.error }
    chrome.tabs.create({ url: `${s.origin}/apps/auspex/` })
    return { ok: true, text: 'Saved as a draft. It is under Drafts in Auspex.' }
  },
  chat: () => sendToChat(ask, chats || new Map(), $('cwhom').value, $('ctext').value, s.ship),
  //  A page goes once. Asked to send it again, the button says so and the
  //  next click does.
  read: async () => {
    const b = document.querySelector('[data-do=read]')
    const force = b.dataset.again === '1'
    const r = await ask({ kind: 'read', title: $('rtitle').value || ctx.url, url: ctx.url, text: $('rtext').value, tabId: ctx.tabId, force })
    if (!r.ok) return { ok: false, text: r.error }
    if (r.already) {
      b.dataset.again = '1'
      b.textContent = 'Send again'
      return { ok: true, text: `Orrery already read this page on ${new Date(r.already).toLocaleDateString()}.` }
    }
    b.dataset.again = ''
    b.textContent = 'Send to Orrery'
    if (r.dropped) return { ok: false, text: `Not read: ${r.dropped}.` }
    return { ok: true, text: `Sent (${r.id}). Orrery reads it in the background; its facts show on the bodies the page names.` }
  },
  clip: async () => {
    const r = await ask({ kind: 'clip', ...ctx })
    return r.ok ? { ok: true, text: `Saved as ${r.name}` } : { ok: false, text: r.error }
  },
  bookmark: async () => {
    const r = await ask({ kind: 'bookmark', url: ctx.url, title: ctx.title })
    return r.ok ? { ok: true, text: 'Bookmarked' } : { ok: false, text: r.error }
  },
  archive: async () => {
    const r = await ask({ kind: 'archive', url: ctx.url, tabId: ctx.tabId })
    return r.ok ? { ok: true, text: `Archived as ${r.name}` } : { ok: false, text: r.error }
  },
  event: async () => {
    const name = $('ename').value.trim()
    const date = $('edate').value
    if (!name) return { ok: false, text: 'a name, please' }
    if (!date) return { ok: false, text: 'a date, please' }
    const body = calendarPoke({
      kind: $('ekind').value, name, date, time: $('etime').value,
      minutes: Number($('emin').value) || 60, note: $('enote').value,
    })
    const r = await ask({ kind: 'event', body })
    return r.ok ? { ok: true, text: $('ekind').value === 'task' ? 'Task added' : 'Event added' } : { ok: false, text: r.error }
  },
  ask: async () => {
    const text = ctx.sel || (await ask({ kind: 'pagetext', tabId: ctx.tabId })).text
    if (!text) return { ok: false, text: 'nothing to ask about on this page' }
    const r = await ask({ kind: 'ask', model: $('model').value, prompt: $('prompt').value, text })
    if (!r.ok) return { ok: false, text: r.error }
    answer = r.answer
    $('answer').textContent = answer
    $('keep').classList.remove('hidden')
    return { ok: true, text: `${r.model}` }
  },
  file: async () => {
    const body = $('plan').value
    const r = await ask({ kind: 'browseFile', url: ctx.url, body })
    if (!r.ok) return { ok: false, text: r.error }
    const name = nameOf(body)
    await hereLoad(true)
    return { ok: true, text: `Filed under ${name}.` }
  },
  place: async () => {
    const plan = $('plan').value
    const r = await ask({ kind: 'browsePlace', url: ctx.url, title: ctx.title, plan })
    if (!r.ok) return { ok: false, text: r.error }
    const name = nameOf(plan)
    await hereLoad(true)
    return { ok: true, text: `This is now the place for ${name}. Orrery looks up its address.` }
  },
  unrelate: async (b) => {
    const r = await ask({ kind: 'browseUnrelate', url: ctx.url, body: b.dataset.body })
    if (!r.ok) return { ok: false, text: r.error }
    await hereLoad(true)
    return { ok: true, text: r.retracted ? 'Taken back, and Orrery will not tie them again.' : 'Orrery will not tie them again.' }
  },
  never: async () => {
    const host = hostOf(ctx.url)
    await neverRead(host)
    await hereLoad(true)
    return { ok: true, text: `Nothing from ${host} goes to Orrery from now on. Options has the list.` }
  },
  pausehour: async () => { await pause(Date.now() + 3600000); await hereLoad(true); return { ok: true, text: 'Paused: nothing you visit goes to Orrery for an hour.' } },
  pauseday: async () => { await pause(tomorrow(Date.now())); await hereLoad(true); return { ok: true, text: 'Paused: nothing you visit goes to Orrery until tomorrow.' } },
  resume: async () => { await pause(0); await hereLoad(true); return { ok: true, text: 'Reading again.' } },
  keep: async () => {
    const r = await ask({ kind: 'clip', title: `${ctx.title || ctx.url}: ${$('prompt').value}`, url: ctx.url, sel: answer })
    return r.ok ? { ok: true, text: `Saved as ${r.name}` } : { ok: false, text: r.error }
  },
}

document.body.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-do]')
  if (!b) return
  const what = b.dataset.do
  const card = b.closest('details').id
  //  The answers come from a third origin (openrouter, or the vendor
  //  ship). Ask for it FIRST, under the click, before any other await.
  if (what === 'ask' && inf && inf.base) {
    try { await chrome.permissions.request({ origins: [patternFor(inf.base)] }) } catch { /* CORS may still allow it */ }
  }
  b.disabled = true
  out(card, '…')
  try {
    const r = await run[what](b)
    out(card, r.ok ? r.text : explain(card, r.text), !r.ok)
  } catch (err) {
    out(card, err.message || String(err), true)
  }
  b.disabled = false
  await status()
})

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage())
$('today').addEventListener('click', () => chrome.tabs.create({ url: 'today.html' }))
$('model').addEventListener('change', () => ask({ kind: 'model', model: $('model').value }))

load()
