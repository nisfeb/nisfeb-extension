//  Browsing into orrery (orrery 98's browsing reader), which the owner
//  turns on in Options: every 15 minutes the visits since the last send,
//  each with how the browser says it came about (a link, typed, a form
//  sent), and, when the owner lets the extension read every site, each
//  page's main text as it loaded. Orrery keeps them on the owner's ship,
//  ties pages to what it knows, and asks a zero-data-retention model only
//  about those. Never a private window's, never the ship's own pages,
//  never a banking or medical site or a Claude artifact (the ship's
//  lists), never a site the owner listed. Pure, so the tests pin what
//  leaves.

//  How often; the most a send covers after the browser was closed or the
//  ship did not answer; how much of a page, how many pages wait at most,
//  and how a send is cut for the ship (it takes 200 pages and 5000 visits
//  a request; pieces of 40 pages keep each request small).
export const EVERY_MIN = 15
export const MAX_WINDOW_MS = 6 * 3600000
export const TEXT_CHARS = 50000
export const QUEUE_PAGES = 120
export const BATCH_PAGES = 40
export const BATCH_VISITS = 5000
const TITLE_CHARS = 300

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

//  What the ship never reads, as GET /apps/orrery/api/browsing says, kept
//  here for before the first answer: a word in a host (banking, medical,
//  a dev ship), and where a page that only shows ship data starts.
export const SKIP_HOSTS = ['localhost', '127.0.0.1',
  'bank', 'chase.com', 'wellsfargo', 'citi.com', 'capitalone', 'americanexpress', 'discover.com',
  'paypal.com', 'venmo.com', 'schwab', 'fidelity', 'vanguard', 'etrade', 'robinhood', 'creditkarma',
  'usaa.com', 'navyfederal', 'ally.com', 'sofi.com', 'synchrony', 'coinbase', 'mint.intuit',
  'mychart', 'patient', 'health', 'clinic', 'hospital', 'medical', 'pharmacy', 'cvs.com', 'walgreens',
  'labcorp', 'questdiagnostics', 'zocdoc', 'teladoc', 'kaiser', 'aetna', 'cigna', 'uhc.com',
  'unitedhealthcare', 'humana', 'bcbs', 'goodrx']
export const SKIP_PATHS = ['claude.ai/artifact', 'claude.ai/code/artifact', 'claude.ai/public/artifacts']

//  The rules a send and a page read go by: the ship's lists (or the ones
//  above), the ship's own site, the owner's list here and on the ship.
export function skipRules(status, { ship = '', exclude = [] } = {}) {
  const s = status || {}
  return {
    hosts: Array.isArray(s.skip_hosts) && s.skip_hosts.length ? s.skip_hosts : SKIP_HOSTS,
    paths: Array.isArray(s.skip_paths) && s.skip_paths.length ? s.skip_paths : SKIP_PATHS,
    exclude: [...new Set([...exclude, ...(Array.isArray(s.exclude) ? s.exclude : []), ...(ship ? [ship] : [])])],
  }
}

export function skipped(url, rules) {
  const host = hostOf(url)
  if (!host) return true
  const bare = String(url).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
  return rules.hosts.some((w) => host.includes(w)) || rules.paths.some((p) => bare.startsWith(p)) || excluded(host, rules.exclude)
}

//  Pausing from the popup: the spans the owner paused reading, `from` to
//  `to` in ms. Nothing visited or read in one is sent, even by a send
//  after it ends. A span is kept while a send could still reach back
//  into it (MAX_WINDOW_MS); a new pause or a resume ends the one running.
export const paused = (spans, t) => (Array.isArray(spans) ? spans : []).some((s) => t >= s.from && t < s.to)
export const pausedTill = (spans, now) => Math.max(0, ...(Array.isArray(spans) ? spans : []).filter((s) => now >= s.from && now < s.to).map((s) => s.to))
export function pauseUntil(spans, now, until) {
  const kept = (Array.isArray(spans) ? spans : []).filter((s) => s.to > now - MAX_WINDOW_MS).map((s) => (s.to > now ? { ...s, to: now } : s))
  return until > now ? [...kept, { from: now, to: until }] : kept
}
//  "Until tomorrow": the next local midnight.
export const tomorrow = (now) => new Date(now).setHours(24, 0, 0, 0)

//  The visits between `from` and `to`: history.search's items ({url,
//  title}) with each address's getVisits ({visitTime, transition}),
//  oldest first, how each came about as the browser names it.
export function visitsOf(items, visitsByUrl, { from, to, rules, pauses = [] }) {
  const out = []
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || skipped(it.url, rules)) continue
    for (const v of visitsByUrl.get(it.url) || []) {
      if (!(v.visitTime >= from && v.visitTime <= to) || paused(pauses, v.visitTime)) continue
      out.push({ url: it.url, title: String(it.title || '').slice(0, TITLE_CHARS), at: Math.round(v.visitTime), how: String(v.transition || 'link') })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

//  A page as it is kept: its title and its text, whitespace folded, cut
//  to TEXT_CHARS.
export const pageOf = ({ url, title, text, at }) => ({
  url,
  title: String(title || '').slice(0, TITLE_CHARS),
  text: String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, TEXT_CHARS),
  at,
})

//  A page laid into the queue: one per address with its newest text, the
//  oldest dropped past QUEUE_PAGES.
export function queued(queue, page) {
  const q = (Array.isArray(queue) ? queue : []).filter((p) => p.url !== page.url)
  q.push(page)
  return q.slice(-QUEUE_PAGES)
}

//  A send cut into the pieces it goes in.
export function batchesOf(visits, pages) {
  const out = []
  const v = [...visits]
  const p = [...pages]
  while (v.length || p.length) out.push({ visits: v.splice(0, BATCH_VISITS), pages: p.splice(0, BATCH_PAGES) })
  return out
}

//  The window a send covers: from where the last one ended, at most
//  MAX_WINDOW_MS back, and one interval back the first time.
export const windowFrom = (lastTo, now) => Math.max(lastTo > 0 && lastTo <= now ? lastTo : now - EVERY_MIN * 60000, now - MAX_WINDOW_MS)
