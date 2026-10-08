//  Browsing history into orrery, which the owner turns on in Options: a
//  digest of an hour's browsing, read by orrery as it reads a message.
//  What goes is the sites, how many pages of each, and the pages' titles.
//  Never a page's text, never the ship's own pages, never a site the owner
//  listed, and never a private window's, which the browser keeps out of
//  its history. Pure, so the tests pin what leaves.

//  How often, and the most a digest covers after the browser was closed
//  or the ship did not answer.
export const EVERY_MIN = 60
export const MAX_WINDOW_MS = 6 * 3600000
const SITES = 25
const TITLES = 6
const TITLE_CHARS = 140
const TEXT_BYTES = 16000

//  The site of an address, without www., for http(s) pages only.
export function hostOf(url) {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '') : ''
  } catch { return '' }
}

//  The owner's list of sites never to send: one per line (or comma), an
//  address or a bare name; a site also covers its subdomains.
export const parseExclude = (text) => [...new Set(String(text || '').split(/[\n,]/)
  .map((l) => l.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, ''))
  .filter((l) => /^[a-z0-9.-]+$/.test(l)))]

export const excluded = (host, rules) => rules.some((r) => host === r || host.endsWith(`.${r}`))

const hm = (ms, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)
const day = (ms, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)

//  chrome.history.search's items ({url, title, lastVisitTime}) between
//  `from` and `to` as text for orrery, with how many sites it names; ''
//  when nothing is left to send.
export function digestOf(items, { from, to, exclude = [], skip = [], zone = '' }) {
  const sites = new Map()
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !(it.lastVisitTime >= from && it.lastVisitTime <= to)) continue
    const host = hostOf(it.url)
    if (!host || skip.includes(host) || excluded(host, exclude)) continue
    const s = sites.get(host) || { host, pages: 0, titles: [], last: 0 }
    s.pages++
    s.last = Math.max(s.last, it.lastVisitTime)
    const t = String(it.title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_CHARS)
    if (t && !s.titles.includes(t)) s.titles.push(t)
    sites.set(host, s)
  }
  const ranked = [...sites.values()].sort((a, b) => b.pages - a.pages || b.last - a.last).slice(0, SITES)
  if (!ranked.length) return { text: '', sites: 0 }
  const head = `What the owner looked at in their web browser between ${hm(from, zone)} and ${hm(to, zone)} on ${day(to, zone)}${zone ? ` (${zone})` : ''}: each site, how many of its pages, and the pages' titles. Titles only, never the pages' text. A digest the owner's own browser sent, not a message from anyone.`
  const lines = ranked.map((s) => `- ${s.host}, ${s.pages} page${s.pages === 1 ? '' : 's'}${s.titles.length ? `: ${s.titles.slice(0, TITLES).map((t) => `"${t}"`).join('; ')}` : ''}`)
  let text = `${head}\n\n${lines.join('\n')}`
  while (new TextEncoder().encode(text).length > TEXT_BYTES && lines.length > 1) { lines.pop(); text = `${head}\n\n${lines.join('\n')}` }
  return { text, sites: lines.length }
}

//  The window a digest covers: from where the last one ended, at most
//  MAX_WINDOW_MS back, and an hour back the first time.
export const windowFrom = (lastTo, now) => Math.max(lastTo > 0 && lastTo <= now ? lastTo : now - EVERY_MIN * 60000, now - MAX_WINDOW_MS)
