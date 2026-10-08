//  The options page: two fields, one button, and the only place the code
//  is ever typed. The host permission for exactly the origin typed is
//  requested here, inside the click, because permissions.request needs a
//  user gesture and gets one nowhere else.

import { normaliseOrigin, patternFor } from './lib/ship.js'
import { lookSaid, CACHE, BG_KEY } from './lib/theme.js'
import { coordsOf } from './lib/sky.js'
import { parseExclude } from './lib/history.js'

const $ = (id) => document.getElementById(id)
const say = (text, bad = false) => {
  $('status').textContent = text
  $('status').classList.toggle('bad', bad)
}

//  The link script, registered here rather than in the manifest so that
//  nobody is asked for every site at install: only whoever turns it on,
//  under that click. It needs the page's text, so every http(s) page.
const ALL = ['http://*/*', 'https://*/*']
const LINKS = { id: 'links', js: ['lib/links.js', 'content.js'], matches: ALL, runAt: 'document_idle' }

const describe = (s) => {
  if (s.status === 'connected') return `Connected to ${s.ship} at ${s.origin}.`
  if (s.status === 'signed-out') return `Signed out of ${s.origin}. Connect again.`
  if (s.status === 'unreachable') return `${s.origin} did not answer: ${s.lastError}`
  return 'No ship configured yet.'
}

async function refresh() {
  const s = await chrome.runtime.sendMessage({ kind: 'state' })
  if (s.origin) $('origin').value = s.origin
  $('model').value = s.model || ''
  const k = await chrome.runtime.sendMessage({ kind: 'hasOrreryKey' })
  $('okey').placeholder = k.has ? 'a key is set; paste another to replace it, or clear to forget it' : 'paste a key minted in Orrery, with write'
  say(describe(s), s.status === 'signed-out' || s.status === 'unreachable')
  $('links').checked = (await chrome.scripting.getRegisteredContentScripts({ ids: [LINKS.id] })).length > 0
}

$('connect').addEventListener('click', async () => {
  const raw = $('origin').value.trim()
  const code = $('code').value.trim()
  if (!raw || !code) { say('A ship URL and an access code, please.', true); return }
  let origin
  try { origin = normaliseOrigin(raw) } catch { say('That is not an http or https URL.', true); return }

  let granted = false
  try {
    granted = await chrome.permissions.request({ origins: [patternFor(origin)] })
  } catch (e) { say(`Permission request failed: ${e.message}`, true); return }
  if (!granted) { say('Without permission for that origin nothing can be fetched.', true); return }

  say('Logging in…')
  const r = await chrome.runtime.sendMessage({ kind: 'connect', origin, code })
  //  The code leaves the page the moment it is used.
  $('code').value = ''
  if (!r.ok) { say(`Could not connect: ${r.error}`, true); return }
  say(`Connected to ${r.ship}. Right-click any page, or press Alt+Shift+U.`)
})

$('disconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ kind: 'disconnect' })
  say('Forgotten. The session cookie is still in the browser; clear it from the ship\'s site data if you want it gone.')
})

$('model').addEventListener('change', () => {
  chrome.runtime.sendMessage({ kind: 'model', model: $('model').value.trim() })
})

//  The key leaves the field the moment it is stored, like the code.
$('okey').addEventListener('change', async () => {
  const key = $('okey').value.trim()
  await chrome.runtime.sendMessage({ kind: 'orreryKey', key })
  $('okey').value = ''
  $('okey').placeholder = key ? 'a key is set; paste another to replace it, or clear to forget it' : 'paste a key minted in Orrery, with write'
  say(key ? 'Orrery key stored. Pages you send are written as that key.' : 'Orrery key forgotten. Pages you send are written as you.')
})

$('links').addEventListener('change', async () => {
  if (!$('links').checked) {
    await chrome.scripting.unregisterContentScripts({ ids: [LINKS.id] }).catch(() => {})
    say('Urbit links are off. Pages already open keep theirs until reloaded.')
    return
  }
  let granted = false
  try { granted = await chrome.permissions.request({ origins: ALL }) } catch (e) { say(`Permission request failed: ${e.message}`, true) }
  if (!granted) { $('links').checked = false; say('Without access to the pages, no links can be added to them.', true); return }
  if (!(await chrome.scripting.getRegisteredContentScripts({ ids: [LINKS.id] })).length) {
    await chrome.scripting.registerContentScripts([LINKS])
  }
  say('Urbit links are on, from the next page you load.')
})

//  The day page's address, for Brave's homepage setting. Extension pages
//  may open chrome:// pages with tabs.create; a link to one goes nowhere.
const DAY = chrome.runtime.getURL('today.html')
$('dayurl').value = DAY
$('daycopy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(DAY)
  say('Copied. Paste it as the home button\'s custom address.')
})
$('dayntp').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/getStarted' }))
$('dayopen').addEventListener('click', () => chrome.tabs.create({ url: DAY }))

//  ── the day page's look ──────────────────────────────────────────────

const DAYKEYS = ['ship', 'origin', 'talonLook', 'useTalonTheme', 'dayMode', 'place']
let day = {}

function dayShow() {
  const look = day.talonLook && day.talonLook.origin === day.origin ? day.talonLook : null
  $('lookread').textContent = day.origin ? lookSaid(look, day.ship) : 'Connect a ship above, and its Talon theme is read from it.'
  $('talontheme').checked = day.useTalonTheme !== false
  $('mode').value = day.dayMode || 'system'
  $('placenow').textContent = day.place ? `The clock is set to ${day.place.label}.` : 'No location set: the clock shows an even day and no weather.'
  $('placeclear').hidden = !day.place
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !DAYKEYS.some((k) => k in changes)) return
  for (const k of DAYKEYS) if (k in changes) day[k] = changes[k].newValue
  dayShow()
})

$('talontheme').addEventListener('change', () => chrome.storage.local.set({ useTalonTheme: $('talontheme').checked }))
$('mode').addEventListener('change', () => chrome.storage.local.set({ dayMode: $('mode').value }))

//  Typed coordinates are taken as they are; anything else is looked up,
//  by the worker, only when asked.
const line = (text) => Object.assign(document.createElement('p'), { textContent: text, className: 'note' })
$('placeform').addEventListener('submit', async (e) => {
  e.preventDefault()
  const q = $('placeq').value
  const typed = coordsOf(q)
  if (typed) { await chrome.storage.local.set({ place: typed }); $('places').replaceChildren(); return }
  if (!q.trim()) return
  $('places').replaceChildren(line('…'))
  const r = await chrome.runtime.sendMessage({ kind: 'places', q })
  if (!r.ok) { $('places').replaceChildren(line(`Open-Meteo did not answer: ${r.error}`)); return }
  $('places').replaceChildren(...(r.places.length ? r.places.map((place) => Object.assign(document.createElement('button'), {
    textContent: place.label,
    onclick: async () => { await chrome.storage.local.set({ place }); $('places').replaceChildren() },
  })) : [line('No place by that name.')]))
})
$('placeclear').addEventListener('click', () => chrome.storage.local.remove(['place', 'weather']))

//  The background, in this browser's Cache Storage; every open day tab
//  redraws when backgroundAt changes.
async function bgShow() {
  const has = await caches.open(CACHE).then((c) => c.match(BG_KEY)).catch(() => null)
  $('bgremove').hidden = !has
}
$('bgfile').addEventListener('change', async () => {
  const f = $('bgfile').files[0]
  $('bgfile').value = ''
  if (!f) return
  if (!f.type.startsWith('image/')) { $('bgsay').textContent = `${f.name} is not an image.`; return }
  try {
    await (await caches.open(CACHE)).put(BG_KEY, new Response(f, { headers: { 'content-type': f.type } }))
  } catch (e) {
    $('bgsay').textContent = `Could not keep it: ${e.message || e}`
    return
  }
  $('bgsay').textContent = `${f.name} is the background. Kept in this browser only.`
  await chrome.storage.local.set({ backgroundAt: Date.now() })
  bgShow()
})
$('bgremove').addEventListener('click', async () => {
  await (await caches.open(CACHE)).delete(BG_KEY)
  $('bgsay').textContent = 'No background. Kept in this browser only.'
  await chrome.storage.local.set({ backgroundAt: Date.now() })
  bgShow()
})

//  ── browsing history into orrery ──────────────────────────────────────

async function histShow() {
  const { historyDigest: h = {}, historySent: sent = {} } = await chrome.storage.local.get(['historyDigest', 'historySent'])
  const granted = await chrome.permissions.contains({ permissions: ['history'] })
  const on = Boolean(h.on && granted)
  $('histon').checked = on
  if (document.activeElement !== $('histexclude')) $('histexclude').value = (h.exclude || []).join('\n')
  $('histnow').hidden = !on
  const when = (ms) => new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(ms)
  $('histsaid').textContent = !on ? 'Off.'
    : sent.error ? `The last digest did not go: ${sent.error}. The next one carries that hour too.`
      : sent.dropped ? `Orrery dropped the last digest: ${sent.dropped}. Turn its read channel on in Orrery.`
        : sent.at ? `Last sent ${when(sent.at)}, ${sent.sites ? `${sent.sites} site${sent.sites === 1 ? '' : 's'}` : 'nothing new to send'}. The next goes within the hour.`
          : 'On. The first digest goes within the hour.'
}

$('histon').addEventListener('change', async () => {
  const { historyDigest: h = {} } = await chrome.storage.local.get('historyDigest')
  if ($('histon').checked) {
    //  inside the click: the browser asks only under one
    const granted = await chrome.permissions.request({ permissions: ['history'] }).catch(() => false)
    if (!granted) { $('histon').checked = false; $('histsaid').textContent = 'Without the browser\'s history there is nothing to send.'; return }
    await chrome.storage.local.set({ historyDigest: { ...h, on: true } })
  } else {
    await chrome.storage.local.set({ historyDigest: { ...h, on: false } })
    await chrome.permissions.remove({ permissions: ['history'] }).catch(() => {})
  }
  histShow()
})
$('histexclude').addEventListener('change', async () => {
  const { historyDigest: h = {} } = await chrome.storage.local.get('historyDigest')
  const exclude = parseExclude($('histexclude').value)
  await chrome.storage.local.set({ historyDigest: { ...h, exclude } })
  $('histexclude').value = exclude.join('\n')
})
$('histnow').addEventListener('click', async () => {
  $('histsaid').textContent = 'Sending…'
  const r = await chrome.runtime.sendMessage({ kind: 'historyNow' })
  if (!r.ok) $('histsaid').textContent = `It did not go: ${r.error}`
  else histShow()
})
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && ('historySent' in changes || 'historyDigest' in changes)) histShow() })
histShow()

day = await chrome.storage.local.get(DAYKEYS)
dayShow()
bgShow()
if (location.hash === '#clock') { $('placeq').scrollIntoView({ block: 'center' }); $('placeq').focus() }
//  what Options shows of Talon's look is read now: one scry
chrome.runtime.sendMessage({ kind: 'look' }).catch(() => {})

refresh()
