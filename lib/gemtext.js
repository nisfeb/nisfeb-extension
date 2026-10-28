//  Reading an urb:// page here in the browser: gemtext (gemini's
//  text/gemini, the format lattice publishes most pages in) as blocks the
//  reader page builds nodes from, and where a page's links go. The same
//  reading as urb-fetch's renderGemtext (github.com/nisfeb/urb-fetch,
//  urb.go).

//  The blocks of a page, in order: {kind: 'h1' | 'h2' | 'h3' | 'p' |
//  'quote' | 'pre', text}, {kind: 'list', items}, {kind: 'link', href,
//  label}. A link's href is as written; linkTarget says where it goes.
export function gemtext(body) {
  const out = []
  let pre = null
  let list = null
  for (const line of String(body).replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('```')) {
      list = null
      if (pre) {
        out.push({ kind: 'pre', text: pre.join('\n') })
        pre = null
      } else {
        pre = []
      }
      continue
    }
    if (pre) {
      pre.push(line)
      continue
    }
    const item = line.startsWith('* ')
    if (!item) list = null
    if (line.startsWith('=>')) {
      const rest = line.slice(2).trim()
      if (!rest) continue
      const href = rest.split(/\s+/)[0]
      out.push({ kind: 'link', href, label: rest.slice(href.length).trim() || href })
    } else if (line.startsWith('#')) {
      const marks = /^#+/.exec(line)[0].length
      out.push({ kind: `h${Math.min(marks, 3)}`, text: line.slice(marks).trim() })
    } else if (item) {
      if (!list) {
        list = { kind: 'list', items: [] }
        out.push(list)
      }
      list.items.push(line.slice(2))
    } else if (line.startsWith('>')) {
      out.push({ kind: 'quote', text: line.slice(1).trim() })
    } else if (line.trim()) {
      out.push({ kind: 'p', text: line })
    }
  }
  if (pre) out.push({ kind: 'pre', text: pre.join('\n') })
  return out
}

//  Where a link on the page at the urb:// address `base` goes: an urb://
//  address, with a relative link resolved against the page, or an http(s)
//  URL. '' for anything else (javascript:, mailto:, gemini:), which the
//  reader shows as text.
export function linkTarget(base, href) {
  const h = String(href).trim()
  if (/^urb:\/\/~[a-z-]+(\/|$)/.test(h)) return h
  if (/^https?:\/\/[^/]/i.test(h)) return h
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return ''
  const m = /^urb:\/\/(~[a-z-]+)(\/[^?#]*)?/.exec(String(base))
  if (!m) return ''
  const path = new URL(h, `http://x${m[2] || '/'}`).pathname
  return `urb://${m[1]}${path === '/' ? '' : path}`
}

//  The reader page for an urb:// address, relative to the extension's root.
export const readerPath = (addr) => `reader.html?u=${encodeURIComponent(addr)}`
