//  Reading a Markdown page (lattice 74 and later publish a page under its
//  format's mark, %md among them) here in the browser: a small, safe
//  subset, the same as urb-fetch's renderMarkdown (github.com/nisfeb/
//  urb-fetch, urb.go): headings, paragraphs, lists, quotes, rules and
//  fenced code, and inline code, links, bold and italics. Everything else
//  shows as written. It gives blocks of plain strings, and mdNodes builds
//  them as nodes with text set, never HTML, so raw HTML in a page shows as
//  text. Nothing nests: a quote in a quote, or a list in a list, is one
//  block with the rest as text, so no page can nest deep.

const HEADING = /^(#{1,6})\s/
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s/
const RULE = /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/
//  A link's text and target are bounded, so a line of [[[[ or ](](]( costs
//  the regex a bounded scan from each, not one to the end of the line.
const INLINE = /`([^`]+)`|\[([^\]]{1,256})\]\(([^)\s]{1,512})\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
const SAFE_HREF = /^(?:(?:https?|urb|gemini|mailto):|[^:]*$)/i
const HOST_LINK = /^\s*[/\\]{2}/
//  C0 controls, space and DEL: a browser strips them from an href's ends
//  and tabs and newlines from within, so \x01//evil.com would leave too.
const CONTROL = /[\x00-\x20\x7f]/

//  A Markdown page longer than this shows as text in a <pre>: the inline
//  regex costs a bounded scan per [ on a line, which on a large hostile
//  page would hold the reader's tab for seconds.
export const MD_MAX = 256 * 1024

//  A heading's text, less the #s that close it, as urb-fetch's
//  ^(#{1,6})\s+(.*?)\s*#*\s*$ takes it, by hand: that regex backtracks
//  for ever on a long line of spaces in JavaScript.
function headingText(rest) {
  let end = rest.trimEnd().length
  while (end > 0 && rest[end - 1] === '#') end--
  return rest.slice(0, end).trim()
}

//  Whether a link target may be a link, as urb-fetch's safeLink: the web,
//  urb://, gemini, mail, or a path on the page's ship. Any other scheme
//  (javascript:, data:, vbscript:) is text, and so is a protocol-relative
//  // (or \\, which browsers read as //), which would leave for any host.
//  Schemes match in any case. A target with a control character in it is
//  text, since a browser would read it otherwise than this does.
export const safeLink = (t) => !CONTROL.test(t) && SAFE_HREF.test(t) && !HOST_LINK.test(t)

//  A line's spans: {text}, {code}, {strong}, {em}, or {link, text}, link
//  the target as written, there only when safeLink allows it.
export function spans(line) {
  const out = []
  let at = 0
  for (const m of line.matchAll(INLINE)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index) })
    at = m.index + m[0].length
    if (m[1] !== undefined) out.push({ code: m[1] })
    else if (m[2] !== undefined) out.push(safeLink(m[3]) ? { link: m[3], text: m[2] } : { text: m[2] })
    else if (m[4] !== undefined) out.push({ strong: m[4] })
    else out.push({ em: m[5] })
  }
  if (at < line.length) out.push({ text: line.slice(at) })
  return out
}

//  The blocks of a page, in order: {kind: 'h1'..'h6' | 'p' | 'quote',
//  spans}, {kind: 'ul' | 'ol', items: [spans]}, {kind: 'hr'}, {kind:
//  'pre', text}.
export function markdown(body) {
  const out = []
  let para = []
  let list = null
  const flush = () => {
    if (para.length) out.push({ kind: 'p', spans: spans(para.join(' ')) })
    para = []
    list = null
  }
  let pre = null
  for (const line of String(body).replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim().startsWith('```')) {
      if (pre) {
        out.push({ kind: 'pre', text: pre.join('\n') })
        pre = null
      } else {
        flush()
        pre = []
      }
      continue
    }
    if (pre) {
      pre.push(line)
      continue
    }
    const item = ITEM.exec(line)
    if (item && !RULE.test(line)) {
      const kind = ORDERED.test(line) ? 'ol' : 'ul'
      if (para.length || !list || list.kind !== kind) {
        flush()
        list = { kind, items: [] }
        out.push(list)
      }
      list.items.push(spans(item[1]))
      continue
    }
    const h = HEADING.exec(line)
    if (!line.trim()) flush()
    else if (h) {
      flush()
      out.push({ kind: `h${h[1].length}`, spans: spans(headingText(line.slice(h[1].length))) })
    } else if (RULE.test(line)) {
      flush()
      out.push({ kind: 'hr' })
    } else if (line.trim().startsWith('>')) {
      flush()
      out.push({ kind: 'quote', spans: spans(line.trim().slice(1).trim()) })
    } else {
      if (list) flush()
      para.push(line.trim())
    }
  }
  if (pre) out.push({ kind: 'pre', text: pre.join('\n') })
  flush()
  return out
}

//  The page's nodes, made with doc (the reader page's document): elements
//  of fixed names, with text set as textContent. hrefFor(target) says
//  where a safe link goes from the page, or null to leave it as text. A
//  body over MD_MAX is one <pre> of it as written.
export function mdNodes(doc, body, hrefFor) {
  const el = (name, text) => {
    const e = doc.createElement(name)
    if (text !== undefined) e.textContent = text
    return e
  }
  const line = (name, ss) => {
    const e = el(name)
    for (const s of ss) {
      if ('code' in s) e.append(el('code', s.code))
      else if ('strong' in s) e.append(el('strong', s.strong))
      else if ('em' in s) e.append(el('em', s.em))
      else if ('link' in s) {
        const href = hrefFor(s.link)
        if (!href) {
          e.append(s.text)
          continue
        }
        const a = el('a', s.text)
        a.href = href
        if (!href.startsWith('reader.html')) a.rel = 'noopener noreferrer'
        e.append(a)
      } else e.append(s.text)
    }
    return e
  }
  if (String(body).length > MD_MAX) return [el('pre', String(body))]
  return markdown(body).map((b) => {
    if (b.kind === 'pre') return el('pre', b.text)
    if (b.kind === 'hr') return el('hr')
    if (b.kind === 'ul' || b.kind === 'ol') {
      const e = el(b.kind)
      for (const item of b.items) e.append(line('li', item))
      return e
    }
    return line(b.kind === 'quote' ? 'blockquote' : b.kind, b.spans)
  })
}
