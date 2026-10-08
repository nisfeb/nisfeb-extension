//  The service worker: the context menu, the omnibox keyword, and the one
//  door every popup request goes through, so status and "signed out" are
//  decided in one place.

import {
  Ship, ApiError, UnreachableError, slug, stamp, quoted, clipMarkdown,
  localDate, escapeXml, complete, completion, readKey, chatPoke, chatStory, isWhom, capBytes,
} from './lib/ship.js'
import {
  due, mergeCards, statusOf, calRows, calWindow, mailOf, actionsOf, spendOf, balanceOf,
} from './lib/today.js'
import { lookOf, profileHex, nicknameOf, fontOf, CACHE, fontKey } from './lib/theme.js'
import { requestUrl, parseForecast, weatherIsStale, placesUrl, placesOf, placeKey } from './lib/sky.js'
import { digestOf, windowFrom, EVERY_MIN } from './lib/history.js'
import {
  MAX_STEPS, STATE_CHARS, TOOLS, WRITES, argsOf, proposal, createOf, createDraft, updateDraft, eventLines, windowOf, addDays,
  foundLines, bodyLines, instructedText, instructRefusal, clip, messagesFor,
} from './lib/agent.js'
import { eventBody, draftFromEvent, onlyBody, doneBody, deleteBody, skipBody, tasksOf, taskMatches, repeats } from './lib/calendar.js'
import { ymd } from './lib/today.js'

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
  historySchedule()
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

//  Talon's theme, accent, font and naming, from %settings, and the
//  owner's own contact: two scries, no event on the ship. A 404 is a
//  ship with no Talon settings, the built-in look; any other failure
//  keeps the look last read. A failed profile read keeps the last colour.
async function dayLook(s, prev) {
  let bucket
  try {
    bucket = await s.scry('settings', '/bucket/talon/ui-prefs')
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
  }
  const look = lookOf(bucket)
  //  the owner's own contact: the nickname the greeting uses, and the
  //  colour a profile accent takes. A failed read keeps the last.
  const self = await s.scry('contacts', '/v1/self').catch(() => null)
  look.profile = profileHex(self) ?? (self ? null : prev && prev.profile) ?? null
  look.nickname = self ? nicknameOf(self) : (prev && prev.nickname) || null
  return look
}

//  The files of the font chosen in Talon, each fetched once and kept in
//  this browser's Cache Storage, and only if its sha256 is its name, as
//  Talon checks it. One request to grubbery per file, ever.
async function keepFonts(s, look) {
  const f = fontOf(look)
  if (!f || !f.faces.length) return
  const cache = await caches.open(CACHE)
  for (const face of f.faces) {
    if (await cache.match(fontKey(face.id))) continue
    const r = await s.reach(`/grubbery/api/file/talon/fonts/${face.id}.font`)
    if (!r.ok) continue
    const bytes = await r.arrayBuffer()
    const sum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (sum === face.id) await cache.put(fontKey(face.id), new Response(bytes))
  }
}

//  Read Talon's look and keep it, or keep the last one with the failure
//  beside it, for Options to show. One read at a time.
let lookRun = null
function readLook(origin) {
  if (!lookRun) {
    lookRun = (async () => {
      const { talonLook: prev } = await chrome.storage.local.get('talonLook')
      const mine = prev && prev.origin === origin ? prev : null
      try {
        const s = new Ship(origin)
        const look = await dayLook(s, mine)
        await keepFonts(s, look).catch(() => { /* the system's font until the next read */ })
        await chrome.storage.local.set({ talonLook: { origin, at: Date.now(), ...look } })
      } catch (e) {
        await chrome.storage.local.set({ talonLook: { ...mine, origin, error: e.message || String(e) } })
      }
    })().finally(() => { lookRun = null })
  }
  return lookRun
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
    //  the spend is a line on the card: its failure never fails the card
    actions: async () => {
      const [list, last] = await Promise.all([s.actions('open'), s.generatorLast().catch(() => null)])
      return { list: actionsOf(list), spend: spendOf(last, Date.now()) }
    },
    mail: async () => mailOf(await s.inbox(20)),
    money: async () => balanceOf(await s.account()),
  }
  const keys = Object.keys(jobs)
  const looked = readLook(origin)
  const got = await Promise.all(keys.map((k) => jobs[k]().then(
    (data) => ({ data }),
    (e) => ({ error: e.message || String(e), out: outOf(e) }),
  )))
  await looked
  const status = statusOf(got)
  const lastError = (got.find((r) => r.out) || {}).error || ''
  await chrome.storage.local.set({
    today: { origin, tried, cards: mergeCards(old, Object.fromEntries(keys.map((k, i) => [k, got[i]])), Date.now()) },
    ...(status ? { status, lastError: status === 'connected' ? '' : lastError } : {}),
  })
}

//  The page reads the snapshot itself and asks this for a refresh. The
//  answer waits for the read, which keeps the worker awake through it.
//  A page with no look for this ship yet (a new install, a ship changed)
//  has it read at once rather than at the next refresh.
async function today() {
  const { origin, today: snap, talonLook } = await chrome.storage.local.get(['origin', 'today', 'talonLook'])
  if (!origin) return { ok: false, error: 'no ship yet: set one up in Options' }
  if (!dayRun && due(snap, origin, Date.now())) dayRun = refreshDay(origin, snap).finally(() => { dayRun = null })
  else if (!dayRun && !(talonLook && talonLook.origin === origin && talonLook.at)) await readLook(origin)
  if (dayRun) await dayRun
  return { ok: true }
}

//  The clock's weather, from Open-Meteo for the place set on the day page,
//  at most every half hour however many tabs ask (Talon's weatherIsStale);
//  after a failure, five minutes. A try counts whether it worked or not,
//  and one already running is shared. No place, no request.
let weatherRun = null
async function weather() {
  const { place, weather: w } = await chrome.storage.local.get(['place', 'weather'])
  if (!place) return { ok: true }
  const key = placeKey(place)
  const mine = w && w.key === key ? w : null
  if (!weatherRun && weatherIsStale(mine ? mine.tried : 0, Date.now(), mine && mine.error ? 5 * 60000 : undefined)) {
    weatherRun = (async () => {
      const tried = Date.now()
      await chrome.storage.local.set({ weather: { ...mine, key, tried } })
      try {
        const r = await fetch(requestUrl(place), { signal: AbortSignal.timeout(30000) })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const sky = parseForecast(await r.text())
        if (!sky) throw new Error('no weather in the answer')
        await chrome.storage.local.set({ weather: { key, tried, at: Date.now(), sky, error: '' } })
      } catch (e) {
        await chrome.storage.local.set({ weather: { ...mine, key, tried, error: e.message || String(e) } })
      }
    })().finally(() => { weatherRun = null })
  }
  if (weatherRun) await weatherRun
  return { ok: true }
}

//  A typed place, looked up only when the owner asks.
async function places(q) {
  try {
    const r = await fetch(placesUrl(q), { signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return { ok: true, places: placesOf(await r.json()) }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

//  ── browsing history into orrery ──────────────────────────────────────
//
//  Off until the owner turns it on in Options, which asks the browser for
//  its history under that click. Then, every hour, the sites visited since
//  the last digest, how many pages of each and their titles go to orrery's
//  read channel, under the Orrery key when one is set (as Read in Orrery
//  sends a page). Never a page's text, never the ship's own pages, never a
//  site the owner listed. The end of the last digest sent is kept, so an
//  hour missed is in the next one (six hours at most).

const HISTORY_ALARM = 'history'

async function historySchedule() {
  const { historyDigest: h } = await chrome.storage.local.get('historyDigest')
  if (h && h.on) chrome.alarms.create(HISTORY_ALARM, { periodInMinutes: EVERY_MIN, delayInMinutes: EVERY_MIN })
  else await chrome.alarms.clear(HISTORY_ALARM)
}

let historyRun = null
async function sendHistory() {
  const { historyDigest: h = {}, historySent: last = {}, origin, orreryKey = '' } = await chrome.storage.local.get(['historyDigest', 'historySent', 'origin', 'orreryKey'])
  if (!h.on) return { ok: false, error: 'the digest is off' }
  if (!origin) return { ok: false, error: 'no ship yet: set one up in Options' }
  if (!(await chrome.permissions.contains({ permissions: ['history'] }))) return { ok: false, error: 'the browser has not given the extension its history' }
  const to = Date.now()
  const from = windowFrom(last.to, to)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const items = await chrome.history.search({ text: '', startTime: from, endTime: to, maxResults: 5000 })
  const d = digestOf(items, { from, to, exclude: h.exclude || [], skip: [new URL(origin).hostname.replace(/^www\./, '')], zone })
  try {
    if (d.text) {
      const hm = (ms) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ms)
      const r = await new Ship(origin).read({ text: d.text, title: `Browsing, ${hm(from)} to ${hm(to)}`, url: `history/${from}-${to}`, key: orreryKey, kind: 'browser' })
      await chrome.storage.local.set({ historySent: { to, at: Date.now(), sites: d.sites, dropped: r.dropped || '', error: '' } })
      return { ok: true, sites: d.sites, dropped: r.dropped || '' }
    }
    await chrome.storage.local.set({ historySent: { to, at: Date.now(), sites: 0, dropped: '', error: '' } })
    return { ok: true, sites: 0 }
  } catch (e) {
    //  the window stays open, so the next digest carries this hour too
    await chrome.storage.local.set({ historySent: { ...last, error: e.message || String(e), tried: Date.now() } })
    return { ok: false, error: e.message || String(e) }
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === HISTORY_ALARM && !historyRun) historyRun = sendHistory().catch(() => {}).finally(() => { historyRun = null })
})
chrome.runtime.onStartup.addListener(() => { historySchedule() })
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && 'historyDigest' in changes) historySchedule() })

//  ── the day page's assistant ─────────────────────────────────────────
//
//  Talon's AgentLoop, run here: the model (Armillary's, as Ask uses it)
//  answers or asks for tools; reads run at once, and a write waits for
//  the owner's yes on the page, the turn kept in storage.local meanwhile
//  so the worker may sleep. What the owner sees is `assistant`: the
//  history (words only, the last 50), the write waiting, whether a turn
//  is running, and what went wrong.

const HISTORY = 50
const getAssistant = async () => ({ history: [], pending: null, busy: false, error: '', ...((await chrome.storage.local.get('assistant')).assistant || {}) })
const putAssistant = (a) => chrome.storage.local.set({ assistant: a })

//  The calendar's zone, from the day page's last read where it has one.
async function calendarZone() {
  const { today: snap } = await chrome.storage.local.get('today')
  const z = snap && snap.cards && snap.cards.cal && snap.cards.cal.data && snap.cards.cal.data.zone
  return z || Intl.DateTimeFormat().resolvedOptions().timeZone
}

//  One tool, read or (once said yes to) write, answered in words for the
//  model. A tool's failure is words too: the model decides what next.
async function runTool(s, name, a, zone) {
  const said = (e) => (e instanceof ApiError && e.signedOut ? 'The ship says the owner is signed out.' : e.message || String(e))
  try {
    if (name === 'list_events') {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now())
      const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
      if ((a.from && !ok(a.from)) || (a.to && !ok(a.to))) return 'Error: dates are YYYY-MM-DD.'
      const from = a.from || today
      const to = a.to || addDays(from, 7)
      if (to < from) return 'Error: to is before from.'
      const w = windowOf(from, to)
      return eventLines((await s.calendarWindow(w.from, w.to)).rows, zone, from, to)
    }
    if (name === 'create_event' || name === 'create_task') {
      const d = createOf(name, a)
      if (!d) return 'Error: the arguments are not usable; see the tool\'s description.'
      await s.addEvent(eventBody(d))
      return name === 'create_task' ? `Added task "${d.name}"${d.due ? ` due ${d.due}` : ''}.` : `Added "${d.name}" on ${a.date}${a.time ? ` at ${a.time}` : ''}.`
    }
    if (name === 'update_event' || name === 'delete_event') {
      const ev = await calendarEvent(s, a.event, zone)
      if (typeof ev === 'string') return ev
      const one = a.occurrence && repeats(ev.draft)
      const occ = one ? await occurrence(s, a.event, a.occurrence, zone, ev.draft) : null
      if (typeof occ === 'string') return occ
      if (name === 'delete_event') {
        await s.addEvent(one ? skipBody(a.event, occ.idx) : deleteBody(a.event))
        return one ? `Skipped "${ev.draft.name}" on ${a.occurrence}.` : `Deleted "${ev.draft.name}"${repeats(ev.draft) ? ' and every occurrence' : ''}.`
      }
      const u = updateDraft(ev.draft, a)
      if (!u.draft) return u.error
      if (!one) {
        await s.addEvent(eventBody(u.draft, a.event))
        return `Updated "${u.draft.name}".`
      }
      //  the calendar page's two steps, in the safe order: the one-off first,
      //  then skip the original, so a failure leaves a duplicate to see
      //  rather than a lost occurrence
      await s.addEvent(onlyBody(u.draft, a.date || occ.date, u.minute ?? occ.minute))
      try {
        await s.addEvent(skipBody(a.event, occ.idx))
      } catch (e) {
        return `Half done: the changed "${u.draft.name}" was added, but the original on ${a.occurrence} is still there too; the calendar refused the skip (${said(e)}).`
      }
      return `Updated "${u.draft.name}" for that occurrence.`
    }
    if (name === 'list_tasks' || name === 'complete_task') {
      const tasks = tasksOf(await s.json('/apps/calendar/events.json?cat=todo'))
      if (name === 'list_tasks') {
        const shown = tasks.filter((t) => a.include_done === true || !t.done)
        return shown.length ? shown.map((t) => `task=${t.id} ${t.due ? `due ${t.due} ` : ''}${t.name}${t.done ? ' (done)' : ''}`).join('\n') : a.include_done === true ? 'No tasks.' : 'No open tasks.'
      }
      const hits = taskMatches(tasks, String(a.task || ''), a.reopen === true)
      if (!hits.length) return `No ${a.reopen === true ? 'done' : 'open'} task matches "${a.task}".`
      if (hits.length > 1) return 'Several match; which one?\n' + hits.map((t) => `task=${t.id} ${t.name}`).join('\n')
      await s.addEvent(doneBody(hits[0].id, a.reopen !== true))
      return `${a.reopen === true ? 'Reopened' : 'Done'}: ${hits[0].name}.`
    }
    if (name === 'orrery_brief') {
      const b = await s.json('/apps/orrery/api/brief/last').catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e })
      return b && b.text ? `The brief for ${b.day || 'today'}:\n${clip(String(b.text), STATE_CHARS)}` : 'Orrery has written no brief yet.'
    }
    if (name === 'orrery_find') {
      if (!a.name) return 'Error: name is required.'
      return foundLines(a.name, await s.json(`/apps/orrery/api/resolve?q=${encodeURIComponent(a.name)}`))
    }
    if (name === 'orrery_read') {
      if (!a.body) return clip(JSON.stringify(await s.json('/apps/orrery/api/state?brief=1')), STATE_CHARS)
      if (!/^[a-z0-9-]+\/[^/\s?#]+$/i.test(a.body)) return 'Error: body is an id like person/alice.'
      return bodyLines(a.body, await s.json(`/apps/orrery/api/body/${a.body}`))
    }
    if (name === 'orrery_instruct') {
      try {
        return instructedText(await s.post('/apps/orrery/api/instruct', { text: capBytes(String(a.text || ''), 2000), apply: false }))
      } catch (e) {
        return e instanceof ApiError ? instructRefusal(e.status, e.message) : said(e)
      }
    }
    return `Error: there is no tool called ${name}.`
  } catch (e) {
    return `That failed: ${said(e)}`
  }
}

//  One event as the calendar holds it (event.json), as a draft, or the
//  words the model is told.
async function calendarEvent(s, id, zone) {
  if (!String(id || '').trim()) return 'Error: event is required.'
  try {
    const e = await s.json(`/apps/calendar/event.json?id=${encodeURIComponent(id)}`)
    const draft = draftFromEvent(e, ymd(Date.now(), zone))
    return draft ? { draft } : 'Error: that event could not be read.'
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return `Error: no event ${id}; see list_events.`
    throw e
  }
}

//  A repeating event's occurrence on a day: its index for skip-event, and
//  its own day and minute (an all-day one in UTC date-space, a timed one
//  in the event's zone, else the calendar's).
async function occurrence(s, id, day, zone, draft) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return 'Error: occurrence must be YYYY-MM-DD.'
  const w = windowOf(day, day)
  const rows = ((await s.calendarWindow(w.from, w.to)).rows || []).filter((r) => r && r.id === id && Number.isFinite(r.l))
  const z = draft.zone || zone
  const row = rows.find((r) => (r.all ? ymd(r.l, 'UTC') : ymd(r.l, z)) === day)
  if (!row) return `Error: "${draft.name}" has no occurrence on ${day}.`
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: row.all ? 'UTC' : z, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(row.l).split(':').map(Number)
  return { idx: row.idx, date: day, minute: hm[0] * 60 + hm[1] }
}

//  What the owner is shown for a write needs the event or task named: read
//  it first. A string is the model's answer instead (no such event, several
//  tasks match), and nothing is shown.
async function writeContext(s, name, a, zone) {
  if (name === 'update_event' || name === 'delete_event') {
    const ev = await calendarEvent(s, a.event, zone)
    return typeof ev === 'string' ? ev : { event: ev.draft }
  }
  if (name === 'complete_task') {
    const hits = taskMatches(tasksOf(await s.json('/apps/calendar/events.json?cat=todo')), String(a.task || ''), a.reopen === true)
    if (!hits.length) return `No ${a.reopen === true ? 'done' : 'open'} task matches "${a.task}".`
    if (hits.length > 1) return 'Several match; which one?\n' + hits.map((t) => `task=${t.id} ${t.name}`).join('\n')
    return { task: hits[0] }
  }
  return {}
}

//  Run the turn on from where it stands: the calls still to make from
//  the model's last step, then more steps, until it answers in words, a
//  write needs the owner, or the steps run out.
async function carry(turn, rest, steps) {
  const { origin, model } = await state()
  const s = new Ship(origin)
  const zone = await calendarZone()
  let inf = null
  for (;;) {
    while (rest.length) {
      const call = rest.shift()
      const name = call.function && call.function.name
      const a = argsOf(call)
      let content
      if (WRITES.has(name) && a) {
        const ctx = await writeContext(s, name, a, zone).catch((e) => `That failed: ${e.message || e}`)
        const text = typeof ctx === 'string' ? null : proposal(name, a, ctx)
        if (typeof ctx === 'string') {
          turn.push({ role: 'tool', tool_call_id: call.id, content: ctx })
          continue
        }
        if (text) {
          const st = await getAssistant()
          await putAssistant({ ...st, busy: false, pending: { call, text, turn, rest, steps } })
          return
        }
        //  why, in Talon's words, where the check says
        content = (name === 'create_event' && createDraft(a).error) || (name === 'update_event' && ctx.event && updateDraft(ctx.event, a).error) ||
          `Error: the arguments for ${name} are not usable; see its description.`
      } else {
        content = a ? await runTool(s, name, a, zone) : 'Error: the arguments were not JSON.'
      }
      turn.push({ role: 'tool', tool_call_id: call.id, content })
    }
    if (steps >= MAX_STEPS) return finish(turn, 'I stopped there: that took more steps than one question may.')
    if (!inf) inf = await s.inference()
    const m = model || (inf.models && inf.models[0])
    if (!m) throw new Error('no model: pick one for Ask in Options')
    const st = await getAssistant()
    const msg = await completion(inf, m, messagesFor(st.history, turn, Date.now(), zone), TOOLS)
    steps++
    turn.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) })
    if (!msg.tool_calls || !msg.tool_calls.length) return finish(turn, typeof msg.content === 'string' ? msg.content : '')
    rest = [...msg.tool_calls]
  }
}

//  The turn done: the owner's words and the answer go into the history.
async function finish(turn, answer) {
  const st = await getAssistant()
  const asked = turn[0] && turn[0].content
  const history = [...st.history, { role: 'user', text: asked, at: Date.now() }, { role: 'assistant', text: answer || '(no answer)', at: Date.now() }].slice(-HISTORY)
  await putAssistant({ ...st, history, pending: null, busy: false, error: '', asking: '' })
}

//  A failure mid-turn: said on the page, the owner's words kept for
//  another try, nothing half written into the history.
async function failed(e) {
  const st = await getAssistant()
  await putAssistant({ ...st, pending: null, busy: false, error: e.message || String(e) })
}

let assistRun = null
async function assist(text) {
  const st = await getAssistant()
  if (assistRun || st.busy || st.pending) return { ok: false, error: 'busy' }
  if (!String(text || '').trim()) return { ok: false, error: 'nothing asked' }
  await putAssistant({ ...st, busy: true, error: '', asking: text })
  assistRun = carry([{ role: 'user', content: text }], [], 0).catch(failed).finally(() => { assistRun = null })
  await assistRun
  return { ok: true }
}

//  The owner's yes or no to the write waiting. No is said to the model,
//  which goes on without it.
async function assistAnswer(yes) {
  const st = await getAssistant()
  const p = st.pending
  if (!p || assistRun) return { ok: false, error: 'nothing waiting' }
  await putAssistant({ ...st, pending: null, busy: true })
  assistRun = (async () => {
    const { origin } = await state()
    const name = p.call.function.name
    const content = yes ? await runTool(new Ship(origin), name, argsOf(p.call), await calendarZone()) : 'The owner declined; it was not done.'
    p.turn.push({ role: 'tool', tool_call_id: p.call.id, content })
    await carry(p.turn, p.rest, p.steps)
  })().catch(failed).finally(() => { assistRun = null })
  await assistRun
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
  historyNow: async () => {
    if (historyRun) return { ok: false, error: 'a digest is being sent' }
    historyRun = sendHistory().finally(() => { historyRun = null })
    return historyRun
  },
  assist: (m) => assist(String(m.text || '')),
  assistAnswer: (m) => assistAnswer(m.yes === true),
  assistReset: async () => {
    if (assistRun) return { ok: false, error: 'busy' }
    await chrome.storage.local.remove('assistant')
    return { ok: true }
  },
  //  Options, when it opens: one scry, so what it shows is current
  look: async () => {
    const { origin } = await chrome.storage.local.get('origin')
    if (origin) await readLook(origin)
    return { ok: Boolean(origin) }
  },
  weather: () => weather(),
  places: (m) => places(String(m.q || '')),

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
