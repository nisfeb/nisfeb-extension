//  Where each card sits on the day page, and how big it is: Talon's home
//  page grid (ui/HomeLayout.kt), as it is. Twelve columns; rows of 40px
//  counting the 14px gap left under each card; a card at a column and a
//  row, so many columns wide and rows tall. Nothing moves out of the way
//  of a card put down on top of it: overlaps are the arranger's to see
//  and sort out. Kept per browser, as Talon keeps its own per device.
//  Pure, and test/layout.test.js carries Talon's own cases.

export const COLUMNS = 12
export const SPAN = [3, 12]
export const ROWS = [3, 18]
export const GAP = 14
export const ROW_PX = 26 // a row unit of 40, less the gap below it

export const CARDS = ['clock', 'cal', 'actions', 'mail', 'money', 'assistant', 'browsing']

//  What somebody sees before they have touched any of it: Talon's dial
//  down the left, live traffic beside it, the assistant beside Orrery.
export const DEFAULT = {
  clock: { col: 0, row: 0, span: 5, rows: 9 },
  cal: { col: 5, row: 0, span: 7, rows: 5 },
  mail: { col: 5, row: 5, span: 7, rows: 4 },
  actions: { col: 0, row: 9, span: 5, rows: 5 },
  assistant: { col: 5, row: 9, span: 7, rows: 9 },
  money: { col: 0, row: 14, span: 5, rows: 4 },
  browsing: { col: 5, row: 18, span: 7, rows: 6 },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const int = (v, d) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.round(Number(v)) : d)

//  Clamped into what the grid can draw, whatever a stored copy said.
export function sane(p, d = { col: 0, row: 0, span: 6, rows: 4 }) {
  const span = clamp(int(p && p.span, d.span), SPAN[0], SPAN[1])
  return {
    span,
    rows: clamp(int(p && p.rows, d.rows), ROWS[0], ROWS[1]),
    //  never hanging off the right-hand edge
    col: clamp(int(p && p.col, d.col), 0, COLUMNS - span),
    row: Math.max(0, int(p && p.row, d.row)),
  }
}

//  Whether two cards are trying to occupy the same squares.
export const overlaps = (a, b) => a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.rows && b.row < a.row + a.rows

//  An ordered list of cards packed into rows greedily (Talon's
//  coordinatesFor, for layouts written before coordinates): the page
//  somebody had opens looking the same, from where they can move it.
export function packed(order) {
  let col = 0
  let row = 0
  let tallest = 0
  const out = {}
  for (const k of order) {
    const { span, rows } = DEFAULT[k]
    if (col + span > COLUMNS) { col = 0; row += tallest; tallest = 0 }
    out[k] = { col, row, span, rows }
    col += span
    tallest = Math.max(tallest, rows)
  }
  return out
}

//  Every card once, clamped. A saved layout wins; with none, an older
//  saved order is packed; with neither, the default. A card the saved
//  copy never heard of arrives under everything already there.
export function complete(saved, order) {
  const base = saved && typeof saved === 'object' && Object.keys(saved).some((k) => CARDS.includes(k)) ? saved
    : Array.isArray(order) && order.some((k) => CARDS.includes(k)) ? packed([...new Set([...order.filter((k) => CARDS.includes(k)), ...CARDS])])
      : DEFAULT
  const out = {}
  for (const k of CARDS) if (base[k]) out[k] = sane(base[k], DEFAULT[k])
  let bottom = Math.max(0, ...Object.values(out).map((p) => p.row + p.rows))
  for (const k of CARDS) {
    if (out[k]) continue
    out[k] = sane({ ...DEFAULT[k], col: 0, row: bottom }, DEFAULT[k])
    bottom += out[k].rows
  }
  return out
}

//  One column's pitch, and one row's: how far a drag goes to move a card
//  one square. A grid `width` pixels wide.
export const pitches = (width) => ({ col: (width - GAP * (COLUMNS - 1)) / COLUMNS + GAP, row: ROW_PX + GAP })

//  Where a card's top left corner lands after a drag of dx, dy from where
//  it started: rounded, so it settles on the nearest square rather than
//  the one it has fully entered, and kept on the grid.
export function droppedAt(start, dx, dy, pitch) {
  const col = pitch.col > 0 ? start.col + Math.round(dx / pitch.col) : start.col
  const row = pitch.row > 0 ? start.row + Math.round(dy / pitch.row) : start.row
  return { col: clamp(col, 0, COLUMNS - start.span), row: Math.max(0, row) }
}

//  A corner dragged: snapped to whole columns and rows at the half-way
//  mark, no wider than the columns left to its right.
export function resizedSpan(startSpan, dx, unit, columns) {
  const widest = Math.max(1, columns)
  const narrowest = Math.min(SPAN[0], widest)
  if (!(unit > 0)) return clamp(startSpan, narrowest, widest)
  return clamp(startSpan + Math.round(dx / unit), narrowest, widest)
}
export function resizedRows(startRows, dy, unit) {
  if (!(unit > 0)) return clamp(startRows, ROWS[0], ROWS[1])
  return clamp(startRows + Math.round(dy / unit), ROWS[0], ROWS[1])
}

//  Reading order: top to bottom, then left to right. A narrow window
//  lays the cards out full width in this order.
export const readingOrder = (layout) => Object.keys(layout).sort((a, b) => layout[a].row - layout[b].row || layout[a].col - layout[b].col)

//  The cards in `layout` that `key` overlaps, among those shown.
export const clashes = (layout, key, shown) => shown.filter((k) => k !== key && layout[k] && overlaps(layout[key], layout[k]))
