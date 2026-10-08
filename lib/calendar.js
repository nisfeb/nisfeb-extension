//  The calendar's write bodies, as Talon builds them (calendar/
//  CalendarEdit.kt: eventBody, draftFromEvent, doneBody, deleteBody), so
//  the assistant writes exactly what Talon and the calendar's own page
//  write. A draft is the editor's view of an event: dates are
//  'YYYY-MM-DD', times minutes past midnight. Wall-clock fields go as if
//  UTC and the calendar reads them in the event's zone; a repeating timed
//  event anchors on the day and carries its time in the rule's arguments.
//  Pure, and test/calendar.test.js carries Talon's own cases.

export const WIRE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const REPEATS = ['once', 'daily', 'weekly', 'monthly', 'monthly-nth', 'yearly', 'every']
export const ORDINALS = ['first', 'second', 'third', 'fourth', 'last']
const CATS = ['timed', 'allday', 'date', 'todo']
//  the meta fields the editor shows and writes itself; the rest rides through
const EDITED_META = new Set(['name', 'note', 'location', 'tags', 'color'])

const parts = (date) => date.split('-').map(Number)
export const utcMs = (date, minute = 0) => { const [y, m, d] = parts(date); return Date.UTC(y, m - 1, d, Math.trunc(minute / 60), minute % 60) }
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)
export const weekdayOf = (date) => WIRE_DAYS[(new Date(utcMs(date)).getUTCDay() + 6) % 7]
export const addDays = (date, n) => dayOf(utcMs(date) + n * 864e5)

export const draft = (fields) => ({
  name: '', note: '', location: '', cal: null, cat: 'timed', date: '1970-01-01', minuteOfDay: 9 * 60, durMin: 60, spanDays: 1,
  repeat: 'once', weekdays: [], count: 0, until: null, zone: null, tags: [], ordinal: 'first', nthDay: null, periodMin: 60,
  rawKind: null, rawArgs: null, rawStartMs: null, due: null, done: false, doneMs: null, color: '', otherMeta: {}, ...fields,
})

export const repeats = (d) => d.cat !== 'todo' && d.cat !== 'date' && (d.rawKind !== null || d.repeat !== 'once')

//  "work, #lunch,, work" -> ["work", "lunch"]
export const parseTags = (text) => [...new Set(String(text || '').split(',').map((t) => t.trim().replace(/^#+/, '')).filter(Boolean))]

//  add-event, or edit-event of `id`.
export function eventBody(d, id = null) {
  const b = { action: id ? 'edit-event' : 'add-event' }
  if (id) b.id = id
  b.cat = d.cat
  const meta = { ...(d.otherMeta || {}), name: String(d.name).trim() }
  if (d.color && d.color.trim()) meta.color = d.color.trim()
  if (d.note && d.note.trim()) meta.note = d.note.trim()
  if (d.location && d.location.trim()) meta.location = d.location.trim()
  if (d.tags && d.tags.length) meta.tags = [...d.tags]
  b.meta = meta
  if (d.cal) b.cal = d.cal
  if (d.cat === 'todo') {
    if (d.due) b.due_ms = utcMs(d.due)
    if (d.done) b.done_ms = d.doneMs ?? Date.now()
    return b
  }
  if (d.cat === 'date') {
    const [, m, day] = parts(d.date)
    b.month = m
    b.day = day
    return b
  }
  if (d.rawKind !== null) {
    //  an imported rule, sent back as it came
    b.kind = d.rawKind
    b.start_ms = d.rawStartMs ?? utcMs(d.date)
    b.args = d.rawArgs || {}
  } else {
    b.kind = d.repeat
    const onTime = d.cat === 'timed' && (d.repeat === 'once' || d.repeat === 'every')
    b.start_ms = onTime ? utcMs(d.date, d.minuteOfDay) : utcMs(d.date)
    const args = {}
    if (d.cat === 'timed' && !onTime) args.at = d.minuteOfDay
    if (d.repeat === 'weekly') args.days = [...d.weekdays].sort((a, c) => WIRE_DAYS.indexOf(a) - WIRE_DAYS.indexOf(c))
    if (d.repeat === 'monthly') args.day = parts(d.date)[2]
    if (d.repeat === 'monthly-nth') { args.ord = ORDINALS.includes(d.ordinal) ? d.ordinal : 'first'; args.day = d.nthDay || weekdayOf(d.date) }
    if (d.repeat === 'yearly') { args.month = parts(d.date)[1]; args.day = parts(d.date)[2] }
    if (d.repeat === 'every') args.period = Math.max(1, d.periodMin)
    b.args = args
  }
  if (d.cat === 'timed') {
    if (d.zone) b.zone = d.zone
    b.fin = 'dur'
    b.dur_min = Math.max(0, d.durMin)
  } else {
    b.span_days = Math.max(1, d.spanDays)
  }
  if (d.rawKind === null && d.repeat !== 'once') {
    if (d.count > 0) b.count = d.count
    else if (d.until) b.until_ms = utcMs(d.until) + 864e5
  }
  return b
}

//  The draft for an event.json answer, or null for a shape it cannot edit.
export function draftFromEvent(e, today) {
  if (!e || typeof e !== 'object') return null
  const meta = e.meta && typeof e.meta === 'object' ? e.meta : {}
  const cat = CATS.includes(e.cat) ? e.cat : null
  if (!cat) return null
  const str = (v) => (typeof v === 'string' ? v : '')
  const otherMeta = Object.fromEntries(Object.entries(meta).filter(([k]) => !EDITED_META.has(k)))
  const base = draft({
    name: str(meta.name), note: str(meta.note), location: str(meta.location), cal: typeof e.cal === 'string' ? e.cal : null, cat, date: today,
    tags: Array.isArray(meta.tags) ? meta.tags.filter((t) => typeof t === 'string') : [], color: str(meta.color), otherMeta,
  })
  if (cat === 'todo') {
    const due = Number.isFinite(e.due_ms) ? dayOf(e.due_ms) : null
    return { ...base, date: due || today, due, done: e.done === true, doneMs: Number.isFinite(e.done_ms) ? e.done_ms : null }
  }
  if (cat === 'date') {
    if (!Number.isInteger(e.month) || !Number.isInteger(e.day)) return null
    return { ...base, date: `${today.slice(0, 4)}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}` }
  }
  if (typeof e.kind !== 'string' || !Number.isFinite(e.start_ms)) return null
  const wall = new Date(e.start_ms)
  const wallMin = wall.getUTCHours() * 60 + wall.getUTCMinutes()
  const args = e.args && typeof e.args === 'object' ? e.args : {}
  const common = {
    ...base,
    date: dayOf(e.start_ms),
    durMin: Number.isInteger(e.dur_min) ? e.dur_min : 60,
    spanDays: Number.isInteger(e.span_days) ? e.span_days : 1,
    count: Number.isInteger(e.count) ? e.count : 0,
    //  written as midnight of the day after the last occurrence
    until: Number.isFinite(e.until_ms) ? dayOf(e.until_ms - 864e5) : null,
    zone: typeof e.zone === 'string' && e.zone !== 'none' ? e.zone : null,
  }
  if (!REPEATS.includes(e.kind)) return { ...common, rawKind: e.kind, rawArgs: args, rawStartMs: e.start_ms, minuteOfDay: wallMin }
  const onTime = cat === 'timed' && (e.kind === 'once' || e.kind === 'every')
  return {
    ...common,
    //  a shared calendar's args come from a peer: an at out of the day is coerced into it
    minuteOfDay: onTime ? wallMin : Math.min(1439, Math.max(0, Number.isInteger(args.at) ? args.at : 0)),
    repeat: e.kind,
    weekdays: Array.isArray(args.days) ? args.days.filter((x) => WIRE_DAYS.includes(x)) : [],
    ordinal: ORDINALS.includes(args.ord) ? args.ord : 'first',
    nthDay: WIRE_DAYS.includes(args.day) ? args.day : null,
    periodMin: Number.isInteger(args.period) ? args.period : 60,
  }
}

//  The one occurrence on its own: a one-off at its day and time, the rest
//  as edited. Sent before the skip-event of the original (add first, so a
//  failure leaves a duplicate to see rather than a lost occurrence).
export const onlyBody = (d, occDate, occMinute) => eventBody({
  ...d, repeat: 'once', rawKind: null, rawArgs: null, rawStartMs: null, count: 0, until: null,
  date: occDate, minuteOfDay: d.cat === 'timed' ? occMinute : d.minuteOfDay,
})

export const doneBody = (id, done) => ({ action: 'done-event', id, done })
export const deleteBody = (id) => ({ action: 'del-event', id })
export const skipBody = (id, idx) => ({ action: 'skip-event', id, idx })

//  The tasks (events.json?cat=todo), soonest due first, undated last.
export function tasksOf(list) {
  return (Array.isArray(list) ? list : []).filter((t) => t && t.cat === 'todo' && t.id)
    .map((t) => ({ id: t.id, name: String((t.meta && t.meta.name) || ''), due: Number.isFinite(t.due_ms) ? dayOf(t.due_ms) : null, done: t.done === true, cal: t.cal || 'default' }))
    .sort((a, b) => (a.due === null) - (b.due === null) || String(a.due).localeCompare(String(b.due)) || a.name.localeCompare(b.name))
}

//  A task named by id or by words from its name, among the open ones (or
//  the done ones, to reopen): one, several, or none.
export function taskMatches(tasks, q, reopen = false) {
  const pool = tasks.filter((t) => t.done === reopen)
  const byId = pool.filter((t) => t.id === q)
  return byId.length ? byId : pool.filter((t) => t.name.toLowerCase().includes(String(q).toLowerCase()))
}
