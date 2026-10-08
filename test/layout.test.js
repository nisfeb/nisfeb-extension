//  Talon's HomeLayoutTest (commonTest ui/), case for case where it
//  carries over, against lib/layout.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLUMNS, SPAN, ROWS, CARDS, DEFAULT, sane, overlaps, packed, complete, pitches, droppedAt, resizedSpan, resizedRows, readingOrder, clashes } from '../lib/layout.js'

test('a stored card is clamped into what the grid can draw', () => {
  assert.deepEqual(sane({ col: 11, row: -3, span: 7, rows: 99 }), { span: 7, rows: ROWS[1], col: COLUMNS - 7, row: 0 }, 'never off the right edge, never above the top')
  assert.deepEqual(sane({ col: 0, row: 0, span: 1, rows: 1 }), { span: SPAN[0], rows: ROWS[0], col: 0, row: 0 })
  assert.deepEqual(sane({ col: 0, row: 0, span: 40, rows: 4 }), { span: COLUMNS, rows: 4, col: 0, row: 0 })
  assert.deepEqual(sane(null, { col: 2, row: 3, span: 4, rows: 5 }), { span: 4, rows: 5, col: 2, row: 3 }, 'nothing stored: the default')
})

test('the corner snaps at the half-way mark, within the ranges', () => {
  const col = 80
  const row = 40
  assert.equal(resizedSpan(6, col * 0.49, col, COLUMNS), 6)
  assert.equal(resizedSpan(6, col * 0.51, col, COLUMNS), 7)
  assert.equal(resizedRows(3, row * 0.6, row), 4)
  assert.equal(resizedSpan(6, col * 50, col, COLUMNS), COLUMNS)
  assert.equal(resizedSpan(6, -col * 50, col, COLUMNS), SPAN[0])
  assert.equal(resizedRows(3, row * 50, row), ROWS[1])
  assert.equal(resizedRows(3, -row * 50, row), ROWS[0])
  assert.equal(resizedSpan(6, col * 10, col, 8), 8, 'no wider than the columns to its right')
  assert.equal(resizedSpan(6, 500, 0, COLUMNS), 6, 'no measure yet: no change')
  assert.equal(resizedRows(4, 500, 0), 4)
})

test('a dropped card lands on the nearest square and stays on the grid', () => {
  const p = { col: 80, row: 40 }
  const start = { col: 0, row: 0, span: 5, rows: 4 }
  assert.deepEqual(droppedAt(start, 80 * 3.4, 40 * 7.6, p), { col: 3, row: 8 })
  assert.deepEqual(droppedAt(start, 80 * 40, 0, p), { col: COLUMNS - 5, row: 0 })
  assert.deepEqual(droppedAt({ ...start, col: 4, row: 2 }, -80 * 40, -40 * 40, p), { col: 0, row: 0 })
  const w = 1152
  assert.equal(pitches(w).row, 40)
  assert.ok(Math.abs(pitches(w).col * COLUMNS - (w + 14)) < 1e-9, 'twelve pitches span the grid and its last gap')
})

test('overlaps and clashes, among the cards shown', () => {
  const a = { col: 0, row: 0, span: 5, rows: 4 }
  assert.ok(overlaps(a, { col: 4, row: 3, span: 3, rows: 3 }))
  assert.ok(!overlaps(a, { col: 5, row: 0, span: 3, rows: 3 }), 'side by side')
  assert.ok(!overlaps(a, { col: 0, row: 4, span: 3, rows: 3 }), 'one under the other')
  const l = { x: a, y: { col: 4, row: 3, span: 3, rows: 3 }, z: { col: 9, row: 0, span: 3, rows: 3 } }
  assert.deepEqual(clashes(l, 'x', ['x', 'y', 'z']), ['y'])
  assert.deepEqual(clashes(l, 'x', ['x', 'z']), [], 'a card taken off the page clashes with nothing')
})

test('every card once: a saved layout, else the old order packed, else the default', () => {
  assert.deepEqual(complete(null, null), DEFAULT)
  const saved = { clock: { col: 7, row: 2, span: 5, rows: 9 }, nonsense: { col: 0 } }
  const c = complete(saved, null)
  assert.deepEqual(Object.keys(c).sort(), [...CARDS].sort())
  assert.deepEqual(c.clock, { col: 7, row: 2, span: 5, rows: 9 })
  assert.equal(c.cal.row, 11, 'a card it never heard of arrives under everything')
  assert.equal(c.actions.row, c.cal.row + c.cal.rows, 'and the next under that')
  //  an order saved before coordinates: packed into rows as it read
  const p = complete(null, ['mail', 'money', 'clock'])
  assert.deepEqual(p.mail, { col: 0, row: 0, span: 7, rows: 4 })
  assert.deepEqual(p.money, { col: 7, row: 0, span: 5, rows: 4 })
  assert.deepEqual(p.clock, { col: 0, row: 4, span: 5, rows: 9 }, 'a full row wraps')
  assert.deepEqual(packed(['clock']).clock, { col: 0, row: 0, span: 5, rows: 9 })
  assert.deepEqual(readingOrder({ a: { row: 2, col: 0 }, b: { row: 0, col: 6 }, c: { row: 0, col: 1 } }), ['c', 'b', 'a'])
})
