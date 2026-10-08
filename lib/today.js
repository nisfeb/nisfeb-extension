//  The day page's pure parts: what each app's answer becomes on a card,
//  what is on today, and when the worker may read the ship again. The
//  worker and the page share these, and the tests pin them to the shapes
//  each app's own source writes.

//  However many tabs open, the ship is read at most once in this long.
export const REFRESH_MS = 5 * 60000
//  From this hour (the calendar's zone) the card adds tomorrow's first.
export const LATE_HOUR = 18
const DAY_MS = 864e5

//  Whether the worker should read the ship now: never read for this
//  ship, or the last try is older than REFRESH_MS. A try counts whether
//  it worked or not, so a ship that is down is not asked once per tab.
//  A clock that went back is a reason to read, not to wait for ever.
export function due(snap, origin, now) {
  if (!snap || snap.origin !== origin) return true
  const t = Number(snap.tried) || 0
  return now - t >= REFRESH_MS || t > now
}

//  One read's results into the cards. A card that failed keeps what it
//  last showed and says why beside it; one source failing never blanks
//  its card, and never touches another.
export function mergeCards(old, got, now) {
  const out = {}
  for (const [k, r] of Object.entries(got)) {
    out[k] = 'data' in r ? { at: now, data: r.data, error: '' } : { ...((old && old[k]) || {}), error: r.error }
  }
  return out
}

//  The connection status after a read, decided once for all five rather
//  than by whichever answer landed last: any "signed out" wins, any
//  answer means connected, and only silence everywhere is unreachable.
//  null leaves the status as it was.
export function statusOf(results) {
  if (results.some((r) => r.out === 'signed-out')) return 'signed-out'
  if (results.some((r) => 'data' in r)) return 'connected'
  if (results.length && results.every((r) => r.out === 'unreachable')) return 'unreachable'
  return null
}

//  ── calendar: window.json's rows ─────────────────────────────────────
//
//  calendar's app.hoon /window.json: one row per occurrence, {id, cal,
//  idx, meta, cat, kind, all, done, l, r, ...}, l and r in unix ms. An
//  `all` row (allday, date, todo) lives in date-space, UTC midnights, as
//  calendar.js's evParts reads it; a timed row is a moment, shown in the
//  calendar's zone. Only what the card shows is kept.

export const calRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(r.l)).map((r) => ({
  name: String((r.meta && r.meta.name) || ''),
  cat: String(r.cat || ''),
  all: Boolean(r.all),
  done: Boolean(r.done),
  l: r.l,
  r: Number.isFinite(r.r) ? r.r : r.l,
}))

//  A zone the browser knows, or '' for the browser's own.
export function okZone(zone) {
  if (!zone) return ''
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone } catch { return '' }
}

//  YYYY-MM-DD of a moment in a zone.
export const ymd = (ms, zone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(ms)

const hourIn = (ms, zone) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone || undefined, hour: 'numeric', hourCycle: 'h23' }).format(ms))

const nextDay = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

//  What is on today in the calendar's zone, whole days and tasks first,
//  then by start; a done task is off the list. Late in the day, the
//  first three of tomorrow as well (a timed one only if it starts then).
export function agenda(rows, now, zone = '') {
  const z = okZone(zone)
  const today = ymd(now, z)
  const tomorrow = nextDay(today)
  const span = (r) => {
    const at = r.all ? 'UTC' : z
    return [ymd(r.l, at), ymd(Math.max(r.l, r.r - 1), at)]
  }
  const live = rows.filter((r) => !(r.cat === 'todo' && r.done))
  const on = (day) => live.filter((r) => {
    const [a, b] = span(r)
    return a <= day && day <= b
  }).sort((a, b) => (b.all - a.all) || a.l - b.l)
  return {
    zone: z,
    today: on(today).map((r) => ({ ...r, past: !r.all && Math.max(r.l, r.r) <= now })),
    tomorrow: hourIn(now, z) >= LATE_HOUR ? on(tomorrow).filter((r) => r.all || span(r)[0] === tomorrow).slice(0, 3) : [],
  }
}

//  The window to ask for: wide enough that today and tomorrow are in it
//  in any zone, and in UTC date-space for the whole-day rows.
export const calWindow = (now) => ({ from: now - 2 * DAY_MS, to: now + 3 * DAY_MS })

//  ── mail: auspex's /api/inbox?view=inbox ─────────────────────────────
//
//  auspex's +serve-inbox: {total, offset, limit, view, unread, labels,
//  threads}; `unread` is the whole Inbox's count, and each thread row
//  (+entry-json) has subject, from, last (unix ms) and its own `unread`.
//  The subjects are the unread ones among the newest page.

export function mailOf(page) {
  const threads = Array.isArray(page && page.threads) ? page.threads : []
  return {
    unread: Number(page && page.unread) || 0,
    threads: threads.filter((t) => t && t.unread).slice(0, 5)
      .map((t) => ({ subject: String(t.subject || ''), from: String(t.from || ''), last: Number(t.last) || 0 })),
  }
}

//  ── orrery: /api/actions?status=open, newest first ───────────────────
//
//  orrery's +en-action: {id, kind, title, payload, about, due, by,
//  proposed, status, note, history}. Open is proposed, approved or claimed.

export const actionsOf = (list) => (Array.isArray(list) ? list : []).filter((a) => a && a.id)
  .map((a) => ({ id: String(a.id), title: String(a.title || a.kind || ''), status: String(a.status || ''), kind: String(a.kind || '') }))

//  ── armillary: /api/account ──────────────────────────────────────────
//
//  armillary's +serve-my-account: the stored view (+en-view: balance in
//  signed micro-dollars, plan, keys, keys_pending WITH SECRETS, lease)
//  plus vendor, self and stale. Two fields leave the worker: nothing
//  else of that answer is stored or shown.

export const balanceOf = (a) => ({ vendor: String((a && a.vendor) || ''), balance: Number(a && a.balance) || 0 })

//  Micro-dollars as armillary's own page writes them: "$" and dollars().
export const money = (micro) => `$${(Number(micro || 0) / 1e6).toFixed(2)}`
