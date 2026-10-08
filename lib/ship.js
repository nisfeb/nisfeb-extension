//  The authenticated client, shared by the service worker and the popup,
//  plus the pure helpers the popup and the tests share.
//
//  Lifted from auspex/thunderbird/lib/api.js and kept to its rules. Every
//  URL is built from the one stored origin and nothing a page said. Every
//  fetch to the ship carries `credentials: 'include'`, because eyre's
//  session cookie is the whole of the auth: there is no token and no
//  header. A 403 means "signed out", and only the options page fixes that.

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
    this.signedOut = status === 403
  }
}

//  fetch rejected: the request never reached the ship.
export class UnreachableError extends Error {}

//  Trim whatever was pasted to exactly an origin.
export function normaliseOrigin(raw) {
  const u = new URL(String(raw).trim())
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('the ship URL must be http or https')
  }
  return u.origin
}

//  A match pattern has no port. `http://host:8080/*` is accepted by
//  permissions.request and matches nothing; scheme plus bare host matches
//  every port on that host.
export function patternFor(origin) {
  const u = new URL(origin)
  return `${u.protocol}//${u.hostname}/*`
}

//  ── pure helpers ─────────────────────────────────────────────────────

//  A ship name. A galaxy (~zod) or a star (~marzod) is one group, a planet
//  two, a moon four, a comet eight, and every group past a galaxy has six
//  letters.
export function isShip(s) {
  if (!/^~[a-z]+(?:-[a-z]+)*$/.test(s)) return false
  const g = s.slice(1).split('-')
  if (g.length === 1) return g[0].length === 3 || g[0].length === 6
  return [2, 4, 8].includes(g.length) && g.every((p) => p.length === 6)
}

//  "zod, ~marzod ~sampel-palnet" -> the ships, and the words that are not.
export function parseShips(text) {
  const ships = []
  const bad = []
  for (const w of String(text).toLowerCase().split(/[\s,;]+/)) {
    if (!w) continue
    const s = w.startsWith('~') ? w : `~${w}`
    ;(isShip(s) ? ships : bad).push(s)
  }
  return { ships: [...new Set(ships)], bad }
}

//  host + path as a page name: lowercase, runs of anything but [a-z0-9]
//  become one hyphen. The same idea as lattice's own +clip-slug.
export function slug(url) {
  let u
  try { u = new URL(url) } catch { return 'clip' }
  const s = `${u.hostname}${u.pathname}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, 80) || 'clip'
}

const pad = (n) => String(n).padStart(2, '0')

//  YYYY-MM-DD of a local moment, for the date field's default.
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

//  YYYYMMDD-HHMMSS, local: what keeps two clips of one page apart.
export function stamp(d = new Date()) {
  return `${localDate(d).replace(/-/g, '')}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

//  A wall-clock date and time packed as if they were UTC. The calendar's
//  own page does exactly this, and the ship reads the fields back in the
//  calendar's zone.
export function wallMs(date, time = '') {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = (time || '00:00').split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, mi)
}

//  The add-event poke the calendar page sends, for the three shapes the
//  popup offers: a task due on a day, an all-day event, a timed one.
export function calendarPoke({ kind, name, date, time, minutes, note, cal }) {
  const meta = { name }
  if (note) meta.note = note
  const body = { action: 'add-event', meta }
  if (cal) body.cal = cal
  if (kind === 'task') {
    body.cat = 'todo'
    if (date) body.due_ms = wallMs(date)
    return body
  }
  body.kind = 'once'
  body.args = {}
  if (time) {
    body.cat = 'timed'
    body.start_ms = wallMs(date, time)
    body.fin = 'dur'
    body.dur_min = minutes || 60
  } else {
    body.cat = 'allday'
    body.start_ms = wallMs(date)
    body.span_days = 1
  }
  return body
}

//  What a selection becomes when it travels: the words, then the address.
export function quoted({ sel, url }) {
  const s = (sel || '').trim()
  return s ? `${s}\n\n${url}` : url
}

//  The page a saved selection is filed as. The header is the one lattice's
//  own archive writes, so a clip and an archive read alike.
export function clipMarkdown({ title, url, sel, day }) {
  const q = sel.trim().split('\n').map((l) => `> ${l}`).join('\n')
  return `# ${title}\n\n*clipped from <${url}> on ${day}*\n\n---\n\n${q}\n`
}

//  At most `max` UTF-8 bytes, cut on a character boundary. The ship caps
//  the text it reads at 64 KB and answers 413 past it.
export function capBytes(text, max) {
  const enc = new TextEncoder()
  let t = String(text)
  if (enc.encode(t).length <= max) return t
  t = t.slice(0, max)
  while (enc.encode(t).length > max) t = t.slice(0, Math.floor(t.length * 0.95))
  return t
}

//  What a read is filed under in the sent set: the page alone when the
//  whole page went, the page plus a hash of the selection when a selection
//  did, so a second selection from one chat or feed URL is not "already
//  read". FNV-1a, a dedupe key and nothing more.
export function readKey(url, text = '') {
  const t = String(text || '').trim()
  if (!t) return url
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return `${url}#sel=${h.toString(16)}`
}

//  Omnibox descriptions are XML.
export function escapeXml(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
  return String(s).replace(/[&<>"']/g, (c) => map[c])
}

//  An auspex draft id, minted here as the web client mints its own: @uv
//  over 0-9a-v, unique enough within one ship's drafts.
export function draftId() {
  const b = new Uint8Array(15)
  crypto.getRandomValues(b)
  const d = '0123456789abcdefghijklmnopqrstuv'
  const g = (n) => [...b.slice(n, n + 5)].map((x) => d[x % 32]).join('')
  return `0v${g(0)}.${g(5)}.${g(10)}`
}

//  ── Tlon chat: the shapes Talon sends ───────────────────────────────
//
//  Every shape here is Talon's (io.nisfeb.talon.urbit): WireShapes.kt for
//  the pokes and the essay, ChatStory.kt and Markdown.kt for the story,
//  UrbitTime.kt for the post id, TalonLink.kt for what names a chat.

//  A ship as TalonLink writes one: moons and comets carry `--`.
const SHIP_BODY = '(?:[a-z]{6}|[a-z]{3})(?:--?(?:[a-z]{6}|[a-z]{3}))*'
const WHOM = new RegExp(`^(?:~${SHIP_BODY}|0v[0-9a-v]+(?:\\.[0-9a-v]+)*|chat/~${SHIP_BODY}/[a-z0-9][a-z0-9-]*)$`)

//  What a message can go to: a ship (a DM), a club id (a group DM), or a
//  chat channel's nest. Notebooks and galleries take other kinds of post.
export const isWhom = (s) => WHOM.test(String(s))

const sig = (ship) => `~${String(ship).replace(/^~/, '')}`

//  A unix ms as an @da, as UrbitTime.unixMsToDa: 2^64 ticks a second from
//  Urbit's own zero.
const DA_UNIX_EPOCH = 170141184475152167957503069145530368000n
export const daOf = (ms) => DA_UNIX_EPOCH + (BigInt(ms) << 64n) / 1000n

//  An @ud as the ship parses it, dot-grouped in threes from the right.
export const dotted = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

//  What a page becomes as a message: the selection quoted, then the title
//  and the address on lines of their own. The popup shows it to edit.
export function chatText({ sel, title, url }) {
  const q = String(sel || '').trim()
  const quote = q ? `${q.split('\n').map((l) => `> ${l}`).join('\n')}\n\n` : ''
  return `${quote}${title && title !== url ? `${title}\n` : ''}${url}`
}

//  One line's inlines: bare http(s) and urb:// addresses as links, as
//  Talon's Markdown makes them (at a word boundary, stopped by whitespace,
//  < > " and backtick, less trailing punctuation and a closing paren it
//  never opened), and the rest as plain text. No other markup: a `~ship`
//  in page text must not become a mention that notifies that ship.
function inlines(line) {
  const out = []
  let at = 0
  for (const m of line.matchAll(/(?<![\p{L}\p{N}_])(?:https?|urb):\/\/[^\s<>"`]+/giu)) {
    let end = m.index + m[0].length
    while (end > m.index) {
      const c = line[end - 1]
      const run = line.slice(m.index, end)
      const open = run.split('(').length
      if ('.,;:!?]'.includes(c) || (c === ')' && open < run.split(')').length)) end--
      else break
    }
    if (end === m.index) continue
    if (m.index > at) out.push(line.slice(at, m.index))
    const href = line.slice(m.index, end)
    out.push({ link: { href, content: href } })
    at = end
  }
  if (at < line.length) out.push(line.slice(at))
  return out
}

//  The message as a story, by ChatStory.kt's chatTextToStory rules: lines
//  run together with {break: null}, a blank line starts a new verse, and
//  a run of `> ` lines is one blockquote. Fenced code is not handled.
export function chatStory(text) {
  const verses = []
  let para = []
  const flush = () => { if (para.length) verses.push({ inline: para }); para = [] }
  const lines = String(text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) { flush(); continue }
    if (line.startsWith('> ')) {
      flush()
      const q = []
      for (; i < lines.length && lines[i].startsWith('> '); i++) {
        if (q.length) q.push({ break: null })
        q.push(...inlines(lines[i].slice(2)))
      }
      i--
      verses.push({ inline: [{ blockquote: q }] })
      continue
    }
    if (para.length) para.push({ break: null })
    para.push(...inlines(line))
  }
  flush()
  return verses.length ? verses : [{ inline: [] }]
}

//  The poke that posts `content` to `whom` as `me`, as TlonChatRepo's
//  postPoke builds it: {app, mark, json}. A DM or a club carries the post
//  id, `~author/<dotted @da>`; a channel mints its own.
export function chatPoke({ whom, me, content, sent }) {
  const author = sig(me)
  const essay = { content, author, sent, kind: '/chat', meta: null, blob: null }
  const add = { add: { essay, time: null } }
  const id = `${author}/${dotted(daOf(sent))}`
  if (whom.startsWith('~')) {
    return { app: 'chat', mark: 'chat-dm-action-2', json: { ship: whom, diff: { id, delta: add } } }
  }
  if (whom.startsWith('0v')) {
    return { app: 'chat', mark: 'chat-club-action-2', json: { id: whom, diff: { uid: '0v4', delta: { writ: { id, delta: add } } } } }
  }
  if (whom.startsWith('chat/')) {
    return { app: 'channels', mark: 'channel-action-2', json: { channel: { nest: whom, action: { post: { add: essay } } } } }
  }
  throw new Error(`not a chat: ${whom}`)
}

//  The conversations by name, [{whom, title}], from three scries: %chat
//  /dm (the ships, a list), %chat /clubs (id -> {team, meta}), and
//  %groups /v3/groups (flag -> {meta, channels: nest -> {meta}}), read as
//  Talon's GroupsScryParser reads them. The channels are Talon's three
//  kinds (chat, diary, heap), so an unread notebook has its name too; a
//  message goes only where isWhom says, which is chat channels. Two of
//  one name are told apart by their address.
export function chatList({ dms, clubs, groups }) {
  const title = (o) => (o && o.meta && typeof o.meta.title === 'string' ? o.meta.title.trim() : '')
  const out = []
  for (const ship of Array.isArray(dms) ? dms : []) {
    if (typeof ship === 'string') out.push({ whom: ship, title: ship })
  }
  for (const [id, c] of Object.entries(clubs || {})) {
    const team = c && Array.isArray(c.team) ? c.team.join(', ') : ''
    out.push({ whom: id, title: title(c) || team || id })
  }
  for (const [flag, g] of Object.entries(groups || {})) {
    for (const nest of Object.keys((g && g.channels) || {})) {
      if (!/^(?:chat|diary|heap)\//.test(nest)) continue
      out.push({ whom: nest, title: `${title(g) || flag} / ${title(g.channels[nest]) || nest.split('/')[2]}` })
    }
  }
  const seen = {}
  for (const c of out) seen[c.title] = (seen[c.title] || 0) + 1
  return out.map((c) => (seen[c.title] > 1 ? { ...c, title: `${c.title} (${c.whom})` } : c))
}

//  The chat picker: each name to its address, from lists in order (the
//  first to name a chat wins), only where a message can go, one address
//  per name.
export function chatChoices(...lists) {
  const byWhom = new Map()
  for (const c of lists.flat()) if (c && isWhom(c.whom) && !byWhom.has(c.whom)) byWhom.set(c.whom, c.title)
  const out = new Map()
  for (const [whom, title] of byWhom) if (!out.has(title)) out.set(title, whom)
  return out
}

//  Send to a chat, for the popup and the day page alike: the name picked
//  from `chats` (or a ship typed), the message through the worker's
//  `chat`, and what came of it in words. Not heard is not refused: the
//  ship took it and its agent said nothing in 15 s.
export async function sendToChat(ask, chats, typed, text, ship) {
  const name = String(typed).trim()
  const whom = chats.get(name) || (isWhom(`~${name}`) ? `~${name}` : name)
  if (!whom) return { ok: false, text: 'which chat?' }
  if (!isWhom(whom)) return { ok: false, text: `not a chat: ${name}. Pick one from the list, or type a ship.` }
  const line = String(text).trim()
  if (!line) return { ok: false, text: 'nothing to send' }
  const r = await ask({ kind: 'chat', whom, title: chats.has(name) ? name : whom, text: line })
  if (!r.ok) return { ok: false, text: r.error }
  return r.heard
    ? { ok: true, text: `Sent to ${name}` }
    : { ok: false, text: `${ship || 'The ship'} took it but did not confirm it within 15 s. It may still land: look in the chat before sending again.` }
}

//  One frame of a channel's event stream, read for eyre's answer to poke
//  `id`: {ok: true}, {err}, or null when the frame is something else.
export function pokeAck(frame, id) {
  const data = String(frame).split('\n').filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, '')).join('\n')
  let j
  try { j = JSON.parse(data) } catch { return null }
  if (!j || j.response !== 'poke' || Number(j.id) !== id) return null
  return typeof j.err === 'string' ? { err: j.err } : { ok: true }
}

//  A failure said for a person, naming the app, so "HTTP 404" reads as
//  "not installed" and a 403 as "signed out". A proxy's 502 to 504 is the
//  ship being down, never the app refusing.
export function explain(app, error, ship = 'this ship') {
  const e = String(error)
  //  An agent's own no: its words, whatever they say.
  if (/ refused it: /.test(e)) return e
  if (/^HTTP 404$|not found/i.test(e)) return `${app} is not installed on ${ship}.`
  if (/signed out|forbidden|^HTTP 403$/i.test(e)) return `Signed out of ${ship}: connect again in Options.`
  if (/no ship yet/.test(e)) return 'No ship yet: set one up in Options.'
  if (/^Failed to fetch|timed out|^HTTP 50[234]$/i.test(e)) return `${ship} did not answer: it may be down or busy.`
  return e
}

//  The ship's reason for a refusal, when it gave one.
async function why(res) {
  try {
    const j = await res.json()
    if (j && typeof j.error === 'string') return j.error
  } catch { /* not JSON: keep the status line */ }
  return `HTTP ${res.status}`
}

//  ── the ship ─────────────────────────────────────────────────────────

export class Ship {
  constructor(origin) { this.origin = normaliseOrigin(origin) }

  //  Every fetch to the ship goes through here. `credentials` last, so no
  //  caller can drop it by accident. A minute is the ceiling on any one
  //  answer: an archive of a long page is the slowest thing asked here,
  //  and a ship that is up but wedged must not hold the popup for ever.
  //
  //  REDIRECTS ARE NEVER FOLLOWED. Some apps answer a stale session with
  //  a 403 of their own; for the rest eyre answers a redirect to its login
  //  page, and following that on a URL with a query string loops for ever
  //  (`redirect=/~/login?redirect=...`, measured: "redirect count
  //  exceeded"). Nothing asked here redirects on success, so a redirect
  //  from any route but the login itself means one thing: signed out.
  //
  //  `keyed` is the one exception to the cookie: a request that carries a
  //  client key of its own goes without it, so the key is the identity.
  async reach(path, init = {}, keyed = false) {
    let res
    try {
      res = await fetch(`${this.origin}${path}`, {
        signal: AbortSignal.timeout(60000), redirect: 'manual', ...init,
        credentials: keyed ? 'omit' : 'include',
      })
    } catch (e) {
      throw new UnreachableError(e && e.message ? e.message : 'no answer')
    }
    const redirected = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)
    if (redirected && path !== '/~/login') throw new ApiError(403, 'signed out')
    return res
  }

  async json(path, init, keyed = false) {
    const res = await this.reach(path, init, keyed)
    if (!res.ok) throw new ApiError(res.status, await why(res))
    return res.json()
  }

  post(path, body) {
    return this.json(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  //  eyre's own login form. The answer is a redirect that sets urbauth-~ship
  //  for this origin, and the browser's cookie jar keeps it. `manual` so the
  //  redirect's target is never fetched: the cookie lands either way, and
  //  the target is just somebody's landing page. The code is a parameter
  //  here and nowhere else.
  async login(code) {
    const res = await this.reach('/~/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(code)}`,
      redirect: 'manual',
    })
    if (!(res.ok || res.type === 'opaqueredirect')) {
      throw new ApiError(res.status, `login refused (HTTP ${res.status})`)
    }
  }

  //  The ship's name for itself, from eyre. Unauthenticated, so it proves
  //  the origin is a ship and nothing more.
  async host() {
    const res = await this.reach('/~/host')
    if (!res.ok) throw new ApiError(res.status, `not a ship (HTTP ${res.status})`)
    return (await res.text()).trim()
  }

  //  ── auspex ──
  whoami() { return this.json('/apps/auspex/api/whoami') }

  //  The Inbox's newest page and its unread count, as Talon's AuspexApi asks.
  inbox(limit) { return this.json(`/apps/auspex/api/inbox?view=inbox&limit=${limit}`) }

  //  Answers the recipients the ship would NOT carry, [{ship, why}].
  async send(to, subject, body) {
    const r = await this.post('/apps/auspex/api/send', { to, subject, body, prev: null })
    return Array.isArray(r && r.refused) ? r.refused : []
  }

  async draft(to, subject, body) {
    const id = draftId()
    await this.post('/apps/auspex/api/draft', { id, to, subject, body, prev: null })
    return id
  }

  //  ── orrery: hand the ship text to read, as it reads a message ──
  //  The page is every fact's source. Answers {ok, id} at once and reads
  //  afterwards, or {ok, dropped} when the owner switched the channel off.
  //  With a client key the request is the key's, `Authorization: Bearer`
  //  and no cookie, so every fact carries the extension's own `by` and the
  //  key's scope bounds what it may file. Without one it is the owner's.
  read({ text, title, url, key = '', kind = 'web' }) {
    const body = { text: capBytes(text, 65536), title, source: { kind, id: url } }
    return this.json('/apps/orrery/api/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    }, Boolean(key))
  }

  version() { return this.json('/apps/orrery/api/version') }

  //  Orrery's model record (+gen-record-doc): this month's spend among it.
  generatorLast() { return this.json('/apps/orrery/api/generator/last') }

  //  The open actions and a transition, for the one-time migration off the
  //  note actions an earlier build filed.
  async actions(status = 'open') {
    const j = await this.json(`/apps/orrery/api/actions?status=${status}`)
    return Array.isArray(j) ? j : (j.actions || j.items || [])
  }

  dismiss(id, note) {
    return this.post(`/apps/orrery/api/actions/${encodeURIComponent(id)}`, { status: 'dismissed', note })
  }

  //  ── lattice: query params, as the routes take them ──
  bookmark(url, title, folder = '') {
    const p = new URLSearchParams({ url, title, folder })
    return this.json(`/apps/lattice/bookmark?${p}`, { method: 'POST' })
  }

  //  The browser's own copy of the page, archived under clips/ by the ship.
  //  The route answers a confirmation page, so the name is read off it.
  //  The ship reads at most two million characters; send no more.
  async archive(url, html) {
    const p = new URLSearchParams({ url })
    const res = await this.reach(`/apps/lattice/clip-html?${p}`, {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body: String(html).slice(0, 2000000),
    })
    if (!res.ok) throw new ApiError(res.status, await why(res))
    const m = /saved privately as <code>([^<]+)<\/code>/.exec(await res.text())
    return m ? m[1] : 'clips/'
  }

  savePage(name, body, type = 'md') {
    const p = new URLSearchParams({ name, type, new: '1' })
    return this.json(`/apps/lattice/page-save?${p}`, { method: 'POST', body })
  }

  async suggest(q) {
    const p = new URLSearchParams({ q })
    const r = await this.json(`/apps/lattice/omni-suggest?${p}`)
    return Array.isArray(r.items) ? r.items : []
  }

  //  ── calendar: one poke, at the address config.json names ──
  calendarConfig() { return this.json('/apps/calendar/config.json') }

  //  Every occurrence between two unix ms, as Talon's CalendarApi reads it.
  calendarWindow(from, to) { return this.json(`/apps/calendar/window.json?from=${Math.floor(from)}&to=${Math.floor(to)}`) }

  async addEvent(body) {
    const { ball } = await this.calendarConfig()
    const res = await this.reach(`/grubbery/api/poke/${ball}/calendar.calendar?blot=/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new ApiError(res.status, `calendar refused (HTTP ${res.status})`)
  }

  //  ── armillary ──
  inference() { return this.json('/apps/armillary/api/inference') }
  account() { return this.json('/apps/armillary/api/account') }

  //  ── Tlon chat, over eyre ──

  //  A scry: a read, with no event on the ship.
  scry(app, path) { return this.json(`/~/scry/${app}${path}.json`) }

  //  The first of `paths` the ship serves, newest first (Talon's
  //  scryNewest): only a 404 or a 500 means "not served"; a timeout is the
  //  ship, and asking again older doubles it.
  //  ponytail: an older ship pays one failed scry per call; remember the
  //  path that served, as Talon does, if that read ever costs.
  async newest(app, ...paths) {
    for (let i = 0; ; i++) {
      try {
        return await this.scry(app, paths[i])
      } catch (e) {
        if (i === paths.length - 1 || !(e instanceof ApiError && (e.status === 404 || e.status === 500))) throw e
      }
    }
  }

  //  The conversations by name, with the scries Talon reads them by.
  async chats() {
    const [dms, clubs, groups] = await Promise.all([
      this.scry('chat', '/dm'), this.scry('chat', '/clubs'), this.newest('groups', '/v3/groups', '/v2/groups'),
    ])
    return chatList({ dms, clubs, groups })
  }

  //  Every conversation's unread summary, the scry TlonChatRepo's
  //  bootstrapActivity reads: /v6 (Tlon 12.1) or /v4 before it.
  activity() { return this.newest('activity', '/v6/activity/full', '/v4/activity/full') }

  //  One poke and the agent's answer to it. Over eyre a poke is a PUT to a
  //  channel: eyre takes it at once, and the agent's yes or no comes back
  //  on the channel's event stream. So the poke gets a channel of its own,
  //  the stream is read until that answer (15 s at most, Talon's wait),
  //  and the channel is deleted whatever happened: one left behind lives
  //  on for hours, queuing facts for nobody ("eyre: clogged").
  //  True when the agent said yes, false when it said nothing; a no throws.
  async poke({ ship, app, mark, json }, waitMs = 15000) {
    const path = `/~/channel/nisfeb-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
    const put = (body) => this.reach(path, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    //  The envelope's ship is bare; eyre's channel parser takes no `~`.
    const res = await put([{ id: 1, action: 'poke', ship: String(ship).replace(/^~/, ''), app, mark, json }])
    if (!res.ok) throw new ApiError(res.status, await why(res))
    try {
      const ack = await this.ackOf(path, 1, waitMs)
      if (ack && ack.err !== undefined) {
        const line = ack.err.split('\n').map((l) => l.trim()).find(Boolean) || 'no reason given'
        throw new ApiError(400, `%${app} refused it: ${line.slice(0, 200)}`)
      }
      return Boolean(ack)
    } finally {
      await put([{ id: 2, action: 'delete' }]).catch(() => {})
    }
  }

  //  The answer to poke `id` on the channel at `path`, from its event
  //  stream: {ok} or {err}, or null when none came within `ms`.
  async ackOf(path, id, ms) {
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), ms)
    try {
      const res = await this.reach(path, { headers: { accept: 'text/event-stream' }, signal: stop.signal })
      if (!res.ok) throw new ApiError(res.status, `the channel answered HTTP ${res.status}`)
      const stream = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await stream.read()
        if (done) return null
        buf += value.replace(/\r/g, '')
        let cut
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const ack = pokeAck(buf.slice(0, cut), id)
          buf = buf.slice(cut + 2)
          if (ack) return ack
        }
      }
    } catch (e) {
      if (stop.signal.aborted) return null
      throw e
    } finally {
      clearTimeout(timer)
      stop.abort()
    }
  }
}

//  One completion over an OpenAI-shaped endpoint: openrouter on a lease,
//  the vendor ship's proxy otherwise. NOT `credentials: 'include'`. This is
//  a third party, and the session cookie belongs to our ship alone.
export async function complete(inf, model, messages) {
  const c = await completion(inf, model, messages)
  return typeof c.content === 'string' ? c.content : ''
}

//  The same, with tools, answering the model's whole message: its words,
//  or the tool calls it wants made (the day page's assistant).
export async function completion(inf, model, messages, tools) {
  let res
  try {
    res = await fetch(`${String(inf.base_url).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${inf.key}` },
      body: JSON.stringify(tools ? { model, messages, tools } : { model, messages }),
    })
  } catch (e) {
    throw new UnreachableError(e && e.message ? e.message : 'no answer')
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = j && j.error
    throw new ApiError(res.status, (e && (e.message || (typeof e === 'string' && e))) || `HTTP ${res.status}`)
  }
  const c = j && j.choices && j.choices[0] && j.choices[0].message
  return c && typeof c === 'object' ? c : { role: 'assistant', content: '' }
}
