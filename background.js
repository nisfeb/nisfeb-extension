//  The service worker: the context menu, the omnibox keyword, and the one
//  door every popup request goes through, so status and "signed out" are
//  decided in one place.

import {
  Ship, ApiError, UnreachableError, slug, stamp, quoted, clipMarkdown,
  localDate, escapeXml, complete, readKey, chatPoke, chatStory, isWhom,
} from './lib/ship.js'
import {
  due, mergeCards, statusOf, calRows, calWindow, mailOf, actionsOf, balanceOf,
} from './lib/today.js'

//  Chrome groups several items of one extension under its name, so these
//  read as Nisfeb > Send to Auspex and so on.
const MENUS = [
  ['mail', 'Send to Auspex', ['selection', 'page', 'link']],
  ['chat', 'Send to a chat', ['selection', 'page', 'link']],
  ['read', 'Read in Orrery', ['selection', 'page']],
  ['clip', 'Save selection to Lattice', ['selection']],
  ['bookmark', 'Bookmark in Lattice', ['page', 'link']],
  ['archive', 'Archive page in Lattice', ['page']],
  ['event', 'Add to Calendar', ['selection', 'page', 'link']],
  ['ask', 'Ask Armillary about this', ['selection', 'page']],
]

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title, contexts] of MENUS) chrome.contextMenus.create({ id, title, contexts })
  })
})

//  storage.local holds the Orrery key. The link script runs in web pages'
//  processes, so content scripts get no view of this store at all.
Promise.resolve().then(() => chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })).catch(() => {})

const state = async () => ({
  status: 'none',
  ...(await chrome.storage.local.get(['origin', 'ship', 'status', 'lastError', 'model'])),
})

async function ship() {
  const s = await state()
  if (!s.origin) throw new Error('no ship yet: set one up in Options')
  return new Ship(s.origin)
}

//  Every ship call comes through here, so a 403 flips the status once and
//  every card in the popup reads the same answer. A 404 flips nothing: that
//  is an app the ship does not have, and the error names it.
async function call(fn) {
  try {
    const out = await fn(await ship())
    await chrome.storage.local.set({ status: 'connected', lastError: '' })
    return { ok: true, ...out }
  } catch (e) {
    if (e instanceof ApiError && e.signedOut) {
      await chrome.storage.local.set({ status: 'signed-out', lastError: e.message })
    } else if (e instanceof UnreachableError) {
      await chrome.storage.local.set({ status: 'unreachable', lastError: e.message })
    }
    return { ok: false, error: e.message || String(e) }
  }
}

//  Run `func` in the page. activeTab is granted by the click that got us
//  here; a page scripting cannot reach (chrome://, the web store, a PDF)
//  answers undefined and the caller falls back to what the tab said.
async function inPage(tabId, func) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func })
    return result
  } catch { return undefined }
}

const pageInfo = () => ({ sel: String(getSelection()), title: document.title, url: location.href })
const pageHtml = () => document.documentElement.outerHTML
//  The article, not the chrome around it, when the page marks one.
const pageText = () => (document.querySelector('main, article, [role=main]') || document.body).innerText

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab
}

//  What the page can say for itself, from the tab or a menu click.
async function context(tab, info = {}) {
  const page = tab && tab.id >= 0 ? (await inPage(tab.id, pageInfo)) || {} : {}
  return {
    sel: page.sel || info.selectionText || '',
    url: info.linkUrl || page.url || (tab && tab.url) || '',
    title: info.linkUrl ? (info.selectionText || info.linkUrl) : (page.title || (tab && tab.title) || ''),
    tabId: tab && tab.id,
  }
}

//  ── orrery's read channel ────────────────────────────────────────────
//
//  A page is sent once, and a selection once: a chat or a feed is one URL
//  with many things worth reading on it. The ship dedups facts by content,
//  so a second send is harmless, but the client guide's first rule is to
//  keep the set, and the popup asks before sending the same thing again.
async function read(s, { title, url, text, tabId, force }) {
  const { read: sent = {} } = await chrome.storage.local.get('read')
  const key = readKey(url, text)
  if (sent[key] && !force) return { already: sent[key] }
  const body = (text || '').trim() || (await inPage(tabId, pageText)) || ''
  if (!body.trim()) throw new Error('nothing to read on this page')
  const { orreryKey = '' } = await chrome.storage.local.get('orreryKey')
  let r
  try {
    r = await s.read({ text: body, title, url, key: orreryKey })
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
    //  the route is missing: an orrery before 59, or none at all
    const v = await s.version().catch(() => null)
    throw new Error(v ? `Orrery ${v.version} cannot read pages yet; 59 or later can.` : 'HTTP 404')
  }
  if (r.dropped) return { dropped: r.dropped }
  sent[key] = new Date().toISOString()
  await chrome.storage.local.set({ read: sent })
  return { id: r.id }
}

//  The chat list, kept ten minutes per browser session: the groups scry
//  carries every member of every group, and the card opens once per send.
//  The day page takes one up to an hour old for its names.
async function chatList(s, maxAge = 600000) {
  const { chatList: c } = await chrome.storage.session.get('chatList')
  if (c && c.origin === s.origin && Date.now() - c.at < maxAge) return c.items
  const items = await s.chats()
  await chrome.storage.session.set({ chatList: { origin: s.origin, at: Date.now(), items } })
  return items
}

//  ── the day page ─────────────────────────────────────────────────────
//
//  Five cards from five sources, each read once per refresh, and at most
//  one refresh per REFRESH_MS however many tabs ask: the attempt's time
//  is stored before the reads start, and a refresh in flight is shared.
//  Every card keeps what it last showed when a read fails.

const HOUR = 3600000
let dayRun = null

//  Today and tomorrow in the calendar's zone; the zone is read once a day.
async function dayCalendar(s, prev) {
  const now = Date.now()
  const known = prev && now - (prev.zoneAt || 0) < 24 * HOUR && now >= prev.zoneAt
  const zone = known ? prev.zone : String((await s.calendarConfig()).zone || '')
  const { from, to } = calWindow(now)
  return { zone, zoneAt: known ? prev.zoneAt : now, rows: calRows((await s.calendarWindow(from, to)).rows) }
}

//  A failure as the status needs it: signed out, no answer, or neither.
const outOf = (e) => (e instanceof ApiError && e.signedOut ? 'signed-out'
  : e instanceof UnreachableError || (e instanceof ApiError && [502, 503, 504].includes(e.status)) ? 'unreachable' : '')

async function refreshDay(origin, snap) {
  const tried = Date.now()
  const old = snap && snap.origin === origin ? snap.cards : {}
  await chrome.storage.local.set({ today: { origin, tried, cards: old } })
  const s = new Ship(origin)
  const jobs = {
    cal: () => dayCalendar(s, old.cal && old.cal.data),
    actions: async () => actionsOf(await s.actions('open')),
    mail: async () => mailOf(await s.inbox(20)),
    money: async () => balanceOf(await s.account()),
  }
  const keys = Object.keys(jobs)
  const got = await Promise.all(keys.map((k) => jobs[k]().then(
    (data) => ({ data }),
    (e) => ({ error: e.message || String(e), out: outOf(e) }),
  )))
  const status = statusOf(got)
  const lastError = (got.find((r) => r.out) || {}).error || ''
  await chrome.storage.local.set({
    today: { origin, tried, cards: mergeCards(old, Object.fromEntries(keys.map((k, i) => [k, got[i]])), Date.now()) },
    ...(status ? { status, lastError: status === 'connected' ? '' : lastError } : {}),
  })
}

//  The page reads the snapshot itself and asks this for a refresh. The
//  answer waits for the read, which keeps the worker awake through it.
async function today() {
  const { origin, today: snap } = await chrome.storage.local.get(['origin', 'today'])
  if (!origin) return { ok: false, error: 'no ship yet: set one up in Options' }
  if (!dayRun && due(snap, origin, Date.now())) dayRun = refreshDay(origin, snap).finally(() => { dayRun = null })
  if (dayRun) await dayRun
  return { ok: true }
}

//  An earlier build filed each page as a note action, which the ship only
//  listed. Dismiss the ones still open, once, so they leave the inbox.
async function migrateNotes() {
  const { notesDismissed, origin } = await chrome.storage.local.get(['notesDismissed', 'origin'])
  if (notesDismissed || !origin) return
  const r = await call(async (s) => {
    const mine = (await s.actions('open')).filter((a) => a && a.by === 'browser' && a.kind === 'note')
    for (const a of mine) await s.dismiss(a.id, 'replaced by the read channel')
    return { n: mine.length }
  })
  if (r.ok) await chrome.storage.local.set({ notesDismissed: true })
}

const actions = {
  state: () => state(),

  //  The only request that ever sees the code, and it is used once.
  connect: async ({ origin, code }) => {
    try {
      const s = new Ship(origin)
      await s.login(code)
      const name = await s.host()
      await chrome.storage.local.set({ origin: s.origin, ship: name, status: 'connected', lastError: '' })
      return { ok: true, ship: name }
    } catch (e) { return { ok: false, error: e.message || String(e) } }
  },

  disconnect: async () => {
    await chrome.storage.local.clear()
    await chrome.storage.session.clear()
    return { ok: true }
  },

  model: async ({ model }) => { await chrome.storage.local.set({ model }); return { ok: true } },

  //  A client key orrery minted for this extension. Kept here, read only by
  //  the read call, and never handed back to a page.
  orreryKey: async ({ key }) => { await chrome.storage.local.set({ orreryKey: String(key || '').trim() }); return { ok: true } },

  hasOrreryKey: async () => ({ ok: true, has: Boolean((await chrome.storage.local.get('orreryKey')).orreryKey) }),

  context: async ({ tabId }) => {
    const tab = tabId >= 0 ? await chrome.tabs.get(tabId).catch(() => null) : await activeTab()
    return context(tab)
  },

  pagetext: async ({ tabId }) => ({ text: (await inPage(tabId, pageText)) || '' }),

  mail: ({ to, subject, body }) => call(async (s) => ({ refused: await s.send(to, subject, body) })),

  draft: ({ to, subject, body }) => call(async (s) => ({ id: await s.draft(to, subject, body) })),

  read: (msg) => call((s) => read(s, msg)),

  clip: ({ title, url, sel }) => call(async (s) => {
    const name = `clips/${slug(url)}-${stamp()}`
    await s.savePage(name, clipMarkdown({ title: title || url, url, sel, day: localDate() }))
    return { name }
  }),

  bookmark: ({ url, title }) => call(async (s) => { await s.bookmark(url, title || url); return {} }),

  archive: ({ url, tabId }) => call(async (s) => {
    const html = await inPage(tabId, pageHtml)
    if (!html) throw new Error('this page cannot be read from here')
    return { name: await s.archive(url, html) }
  }),

  event: ({ body }) => call(async (s) => { await s.addEvent(body); return {} }),

  //  The chats to offer, and the ones picked here last, newest first.
  chats: async () => {
    const { lastChats = [] } = await chrome.storage.local.get('lastChats')
    return { ...(await call(async (s) => ({ items: await chatList(s) }))), recent: lastChats }
  },

  //  A message into a DM, a group DM or a chat channel, as us. `heard` is
  //  false when the ship took the poke but its agent never answered.
  chat: ({ whom, title, text }) => call(async (s) => {
    if (!isWhom(whom)) throw new Error(`not a chat: ${whom}`)
    const { ship: me } = await state()
    if (!me) throw new Error('no ship name yet: connect again in Options')
    const heard = await s.poke({ ship: me, ...chatPoke({ whom, me, content: chatStory(text), sent: Date.now() }) })
    const { lastChats = [] } = await chrome.storage.local.get('lastChats')
    const last = [{ whom, title: title || whom }, ...lastChats.filter((c) => c.whom !== whom)].slice(0, 8)
    await chrome.storage.local.set({ lastChats: last })
    return { heard }
  }),

  today: () => today(),

  //  The one request a content script may make: where the ship is.
  linkOrigin: async () => ({ origin: (await state()).origin || '' }),

  suggest: ({ q }) => call(async (s) => ({ items: await s.suggest(q) })),

  //  What the Ask card needs before a question: where the answers come
  //  from (so the popup can ask permission for that origin under a click),
  //  which models, and what is left to spend. The key stays in here.
  inference: () => call(async (s) => {
    const [inf, acct] = await Promise.all([s.inference(), s.account().catch(() => null)])
    return { base: inf.base_url, mode: inf.mode, models: inf.models || [], balance: acct ? acct.balance : null }
  }),

  ask: ({ model, prompt, text }) => call(async (s) => {
    const inf = await s.inference()
    const m = model || (await state()).model || (inf.models && inf.models[0])
    if (!m) throw new Error('no model: pick one in Options')
    const messages = [
      { role: 'system', content: 'You answer questions about a web page the user is reading. Be brief and concrete.' },
      { role: 'user', content: `${prompt}\n\n---\n\n${text}` },
    ]
    return { answer: await complete(inf, m, messages), model: m }
  }),
}

//  Our own pages may ask anything. A content script runs in a web page's
//  process, so it may ask where the ship is and nothing else.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const ours = String(sender.url || '').startsWith(chrome.runtime.getURL(''))
  const fn = (ours || (msg && msg.kind === 'linkOrigin')) && actions[msg && msg.kind]
  if (!fn) { reply({ ok: false, error: `unknown request ${msg && msg.kind}` }); return false }
  fn(msg).then(reply, (e) => reply({ ok: false, error: e.message || String(e) }))
  return true
})

//  For a harness driving the worker over the devtools protocol.
globalThis.nisfeb = { handle: (msg) => actions[msg.kind](msg) }

migrateNotes()

//  ── the context menu ─────────────────────────────────────────────────

const notify = (title, message) => chrome.notifications.create({
  type: 'basic', iconUrl: 'icons/nisfeb-128.png', title, message,
})

//  What a read came to, in one line, for the notification and the card.
function readLine(r) {
  if (!r.ok) return r.error
  if (r.already) return `Orrery already read this page on ${new Date(r.already).toLocaleDateString()}.`
  if (r.dropped) return `Not read: ${r.dropped}.`
  return `Orrery is reading it (${r.id}). Its facts land on the bodies the page names.`
}

//  The four that need nothing more than the click. The other four want a
//  recipient, a chat, a date or a question, so they open the popup on that card.
const direct = {
  read: async (c) => readLine(await actions.read({ title: c.title || c.url, url: c.url, text: c.sel, tabId: c.tabId })),
  clip: async (c) => {
    const r = await actions.clip(c)
    return r.ok ? `Saved to Lattice as ${r.name}` : r.error
  },
  bookmark: async (c) => {
    const r = await actions.bookmark(c)
    return r.ok ? `Bookmarked ${c.title || c.url}` : r.error
  },
  archive: async (c) => {
    const r = await actions.archive(c)
    return r.ok ? `Archived in Lattice as ${r.name}` : r.error
  },
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const c = await context(tab, info)
  if (direct[info.menuItemId]) {
    notify('Nisfeb', await direct[info.menuItemId](c))
    return
  }
  await chrome.storage.session.set({ pending: { card: info.menuItemId, ...c } })
  try {
    await chrome.action.openPopup()
  } catch {
    await chrome.windows.create({ url: 'popup.html', type: 'popup', width: 420, height: 640 })
  }
})

//  ── the omnibox: `urb <address or words>` ────────────────────────────
//
//  Lattice's own address bar takes a urb:// address or a search, and its
//  dropdown is fed by /omni-suggest over bookmarks and history. This is
//  that bar, in the browser's.

chrome.omnibox.setDefaultSuggestion({
  description: 'Open <match>%s</match> in Lattice, as a urb:// address or a search',
})

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const r = await actions.suggest({ q: text })
  if (!r.ok) return suggest([])
  suggest(r.items.slice(0, 6).map((i) => ({
    content: i.url,
    description: `${escapeXml(i.title || i.url)} <dim>${escapeXml(i.url)}</dim>`,
  })))
})

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const s = await state()
  if (!s.origin) { chrome.runtime.openOptionsPage(); return }
  const url = /^https?:\/\//.test(text) ? text : `${s.origin}/apps/lattice?url=${encodeURIComponent(text)}`
  if (disposition === 'currentTab') chrome.tabs.update({ url })
  else chrome.tabs.create({ url, active: disposition === 'newForegroundTab' })
})
