//  The popup: status, the page in hand, and one card per app. Every ship
//  call goes through the worker (chrome.runtime.sendMessage), which is the
//  one place status is decided.

import { parseShips, quoted, calendarPoke, localDate, patternFor, chatText, isWhom } from './lib/ship.js'

const $ = (id) => document.getElementById(id)
const ask = (msg) => chrome.runtime.sendMessage(msg)
const out = (card, text, bad = false) => {
  const p = $(card).querySelector('.out')
  p.textContent = text
  p.classList.toggle('bad', bad)
}
const money = (micro) => `$${(micro / 1e6).toFixed(2)}`

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

//  The ship's one-word refusals, said for a person. Each card names its app
//  so "HTTP 404" can read as "not installed" and "forbidden" as "signed out".
const APP = { mail: 'Auspex', chat: 'Tlon', read: 'Orrery', lattice: 'Lattice', event: 'Calendar', ask: 'Armillary' }
function explain(card, error) {
  const ship = s.ship || 'this ship'
  //  An agent's own no: its words, whatever they say.
  if (/ refused it: /.test(error)) return error
  if (/^HTTP 404$|not found/i.test(error)) return `${APP[card]} is not installed on ${ship}.`
  if (/signed out|forbidden/i.test(error)) return `Signed out of ${ship}: connect again in Options.`
  if (/no ship yet/.test(error)) return 'No ship yet: set one up in Options.'
  if (/^Failed to fetch|timed out/i.test(error)) return `${ship} did not answer: it may be down or busy.`
  return error
}

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
  const byWhom = new Map()
  for (const c of [...(r.recent || []), ...(r.items || [])]) if (!byWhom.has(c.whom)) byWhom.set(c.whom, c.title)
  for (const [whom, title] of byWhom) if (!chats.has(title)) chats.set(title, whom)
  $('chatlist').replaceChildren(...[...chats.keys()].map((t) => Object.assign(document.createElement('option'), { value: t })))
  if (!r.ok) out('chat', explain('chat', r.error), true)
})

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
  chat: async () => {
    const typed = $('cwhom').value.trim()
    const whom = (chats && chats.get(typed)) || (isWhom(`~${typed}`) ? `~${typed}` : typed)
    if (!whom) return { ok: false, text: 'which chat?' }
    if (!isWhom(whom)) return { ok: false, text: `not a chat: ${typed}. Pick one from the list, or type a ship.` }
    const text = $('ctext').value.trim()
    if (!text) return { ok: false, text: 'nothing to send' }
    const r = await ask({ kind: 'chat', whom, title: chats && chats.has(typed) ? typed : whom, text })
    if (!r.ok) return { ok: false, text: r.error }
    return r.heard
      ? { ok: true, text: `Sent to ${typed}` }
      : { ok: false, text: `${s.ship || 'The ship'} took it but did not confirm it within 15 s. It may still land: look in the chat before sending again.` }
  },
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
    const r = await run[what]()
    out(card, r.ok ? r.text : explain(card, r.text), !r.ok)
  } catch (err) {
    out(card, err.message || String(err), true)
  }
  b.disabled = false
  await status()
})

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage())
$('model').addEventListener('change', () => ask({ kind: 'model', model: $('model').value }))

load()
