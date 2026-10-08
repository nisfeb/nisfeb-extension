//  Talon's CalendarEditTest (commonTest calendar/), case for case, against
//  the port in lib/calendar.js, and the task list's order and matching.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draft, eventBody, draftFromEvent, onlyBody, doneBody, deleteBody, skipBody, parseTags, repeats, weekdayOf, tasksOf, taskMatches } from '../lib/calendar.js'

const day = '2026-09-14'

test('a one-off timed event anchors on its wall clock, sent as utc', () => {
  const b = eventBody(draft({ name: 'Dentist', date: day, minuteOfDay: 14 * 60 + 30, durMin: 45, cal: 'work' }))
  assert.equal(b.action, 'add-event')
  assert.equal(b.cat, 'timed')
  assert.equal(b.kind, 'once')
  assert.equal(b.start_ms, 1789396200000)
  assert.equal(b.dur_min, 45)
  assert.equal(b.cal, 'work')
  assert.equal(b.count, undefined)
})

test('a weekly event anchors on the day and carries its time and days in args', () => {
  const b = eventBody(draft({ name: 'Standup', date: day, minuteOfDay: 9 * 60, repeat: 'weekly', weekdays: ['wed', 'mon'], count: 10 }), 'e1')
  assert.equal(b.action, 'edit-event')
  assert.equal(b.start_ms, 1789344000000, 'midnight utc of the day')
  assert.equal(b.args.at, 540)
  assert.deepEqual(b.args.days, ['mon', 'wed'])
  assert.equal(b.count, 10)
})

test('a date event is a month and a day, nothing else', () => {
  const b = eventBody(draft({ name: 'Birthday', date: '2026-03-09', cat: 'date' }))
  assert.equal(b.month, 3)
  assert.equal(b.day, 9)
  assert.equal(b.kind, undefined)
})

test('an event round-trips through its json', () => {
  const d = draft({ name: 'Standup', note: 'daily', date: day, minuteOfDay: 9 * 60 + 15, repeat: 'weekly', weekdays: ['fri'], count: 4, cal: 'default' })
  const back = draftFromEvent(eventBody(d, 'e1'), day)
  assert.equal(back.name, d.name)
  assert.equal(back.minuteOfDay, d.minuteOfDay)
  assert.deepEqual(back.weekdays, d.weekdays)
  assert.equal(back.count, d.count)
  assert.equal(back.date, d.date)
})

test('tags ride in meta as an array and come back', () => {
  assert.deepEqual(parseTags(' work, #lunch,, work '), ['work', 'lunch'])
  const d = draft({ name: 'Lunch', date: day, tags: ['work', 'lunch'] })
  assert.deepEqual(eventBody(d).meta.tags, ['work', 'lunch'])
  assert.deepEqual(draftFromEvent(eventBody(d, 'e1'), day).tags, ['work', 'lunch'])
  assert.equal(eventBody(draft({ name: 'Plain', date: day })).meta.tags, undefined, 'no tags, no key')
})

test('monthly-nth and every carry their own arguments', () => {
  const nth = eventBody(draft({ name: 'Board', date: day, minuteOfDay: 10 * 60, repeat: 'monthly-nth', ordinal: 'second', nthDay: 'tue' }))
  assert.equal(nth.args.ord, 'second')
  assert.equal(nth.args.day, 'tue')
  assert.equal(nth.args.at, 600)
  const every = eventBody(draft({ name: 'Pills', date: day, minuteOfDay: 8 * 60, repeat: 'every', periodMin: 720 }))
  assert.equal(every.args.period, 720)
  assert.equal(every.start_ms, 1789372800000, 'every anchors on the moment, like once')
  assert.equal(every.args.at, undefined)
})

test('an imported rule is kept whole through an edit', () => {
  const imported = { id: 'x', cat: 'timed', meta: { name: 'Standup' }, kind: 'rrule', start_ms: 1789372800000, args: { rrule: 'FREQ=WEEKLY;BYDAY=MO' }, zone: 'none', count: 0, fin: 'dur', dur_min: 15 }
  const d = draftFromEvent(imported, day)
  assert.equal(d.rawKind, 'rrule')
  assert.deepEqual([d.minuteOfDay, d.durMin], [8 * 60, 15], 'its own hour and length')
  const b = eventBody({ ...d, name: 'Standup, renamed' }, 'x')
  assert.equal(b.kind, 'rrule')
  assert.equal(b.args.rrule, 'FREQ=WEEKLY;BYDAY=MO')
  assert.equal(b.start_ms, 1789372800000)
  assert.equal(b.meta.name, 'Standup, renamed')
})

test('this one only becomes a one-off at the occurrence', () => {
  const d = draft({ name: 'Gym', date: '2026-09-01', minuteOfDay: 7 * 60, repeat: 'daily' })
  const only = onlyBody(d, '2026-09-20', 7 * 60)
  assert.equal(only.kind, 'once')
  assert.equal(only.action, 'add-event')
  assert.equal(only.start_ms, Date.UTC(2026, 8, 20, 7, 0))
  assert.equal(only.count, undefined)
})

test('a task carries its due day at utc midnight and keeps its done moment', () => {
  const open = eventBody(draft({ name: 'Bins', cat: 'todo', date: day, due: day, cal: 'home' }))
  assert.equal(open.cat, 'todo')
  assert.equal(open.due_ms, 1789344000000)
  assert.equal(open.done_ms, undefined)
  assert.equal(open.kind, undefined)
  assert.equal(open.start_ms, undefined)
  assert.equal(eventBody(draft({ name: 'Call mum', cat: 'todo', date: day })).due_ms, undefined)
  const done = eventBody(draft({ name: 'Bins', cat: 'todo', date: day, done: true, doneMs: 1789300000000 }), 't1')
  assert.equal(done.done_ms, 1789300000000, 'an edit does not move the done moment')
  assert.equal(done.action, 'edit-event')
  assert.deepEqual(doneBody('t1', false), { action: 'done-event', id: 't1', done: false })
  assert.deepEqual(deleteBody('e1'), { action: 'del-event', id: 'e1' })
  assert.deepEqual(skipBody('e1', 3), { action: 'skip-event', id: 'e1', idx: 3 })
})

test('a task read back keeps due, done and its moment', () => {
  const d = draftFromEvent({ id: 't1', cal: 'home', cat: 'todo', meta: { name: 'Bins', tags: ['chores'] }, due_ms: 1789344000000, done_ms: 1789300000000, done: true }, '2026-01-01')
  assert.equal(d.cat, 'todo')
  assert.equal(d.due, day)
  assert.equal(d.date, day)
  assert.equal(d.done, true)
  assert.equal(d.doneMs, 1789300000000)
  assert.deepEqual(d.tags, ['chores'])
  assert.equal(repeats(d), false)
  const none = draftFromEvent({ id: 't2', cat: 'todo', meta: { name: 'x' }, done: false }, day)
  assert.equal(none.due, null)
  assert.equal(none.date, day)
})

test('an until is written as the midnight after and read back as the last day', () => {
  const d = draft({ name: 'Term', date: day, repeat: 'daily', until: '2026-09-20' })
  const b = eventBody(d)
  assert.equal(b.until_ms, Date.UTC(2026, 8, 21))
  assert.equal(b.count, undefined)
  assert.equal(draftFromEvent(eventBody(d, 'e1'), day).until, '2026-09-20')
  assert.equal(eventBody(draft({ name: 'x', date: day, repeat: 'daily' })).until_ms, undefined)
  const both = eventBody(draft({ name: 'x', date: day, repeat: 'daily', count: 3, until: '2026-09-20' }))
  assert.equal(both.count, 3)
  assert.equal(both.until_ms, undefined, 'a count wins over an until')
})

test('an out-of-range at from a peer is coerced into the day', () => {
  const at = (v) => ({ id: 'x', cat: 'timed', meta: { name: 'Standup' }, kind: 'daily', start_ms: 1789344000000, args: { at: v }, fin: 'dur', dur_min: 15 })
  assert.equal(draftFromEvent(at(99999), day).minuteOfDay, 1439)
  assert.equal(draftFromEvent(at(-5), day).minuteOfDay, 0)
})

test('an edit keeps the colour and everything it does not show', () => {
  const onShip = { cat: 'todo', cal: 'default', done: false, due_ms: null, meta: { name: 'Book the ferry', note: 'the description', color: '#c0392b', orrery: 'act-123', priority: '5' } }
  const d = draftFromEvent(onShip, day)
  assert.equal(d.note, 'the description')
  assert.equal(d.color, '#c0392b')
  const back = eventBody({ ...d, name: 'Book the ferry, Friday' }, 't1').meta
  assert.equal(back.name, 'Book the ferry, Friday')
  assert.equal(back.color, '#c0392b')
  assert.equal(back.orrery, 'act-123', 'the link orrery finds it by')
  assert.equal(back.priority, '5', 'a field another client wrote')
  assert.equal(back.note, 'the description')
})

test('weekdays, and the task list: soonest due first, undated last, matched by id or words', () => {
  assert.equal(weekdayOf('2026-10-08'), 'thu')
  const tasks = tasksOf([
    { id: 't3', cat: 'todo', meta: { name: 'Call mum' }, done: false },
    { id: 't1', cat: 'todo', meta: { name: 'Pay the rent' }, due_ms: Date.UTC(2026, 9, 9), done: false },
    { id: 't2', cat: 'todo', meta: { name: 'Book ferry' }, due_ms: Date.UTC(2026, 9, 1), done: true },
    { id: 'e1', cat: 'timed', meta: { name: 'not a task' } },
  ])
  assert.deepEqual(tasks.map((t) => t.id), ['t2', 't1', 't3'])
  assert.equal(tasks[1].due, '2026-10-09')
  assert.deepEqual(taskMatches(tasks, 'rent').map((t) => t.id), ['t1'])
  assert.deepEqual(taskMatches(tasks, 't3').map((t) => t.id), ['t3'])
  assert.deepEqual(taskMatches(tasks, 'ferry').map((t) => t.id), [], 'done tasks are not ticked again')
  assert.deepEqual(taskMatches(tasks, 'ferry', true).map((t) => t.id), ['t2'], 'but may be reopened')
})
