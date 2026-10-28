//  The options page: two fields, one button, and the only place the code
//  is ever typed. The host permission for exactly the origin typed is
//  requested here, inside the click, because permissions.request needs a
//  user gesture and gets one nowhere else.

import { normaliseOrigin, patternFor } from './lib/ship.js'
import { lookSaid, CACHE, BG_KEY } from './lib/theme.js'
import { coordsOf } from './lib/sky.js'
import { parseExclude } from './lib/history.js'
import { LEO_STEPS, LEO_KEY_NOTE } from './lib/leo.js'
import { URB_ORIGINS, relayUrl } from './lib/urb.js'

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
  $('urbreader').value = s.urbReader || 'ship'
  $('urbport').value = s.urbPort || ''
  $('urbrelay').value = s.urbRelay || ''
  await showMoon()
}

//  The moon reading in this browser (lib/urb.js does the key work, in the
//  worker; this page only ever holds what was typed).
async function showMoon() {
  const m = await chrome.runtime.sendMessage({ kind: 'urbMoon' })
  $('moonadd').hidden = Boolean(m.ship)
  $('moonhave').hidden = !m.ship
  $('moonunlock').hidden = !m.locked
  $('moonlock').hidden = !m.ship || m.locked
  $('moonstate').textContent = !m.ship ? 'No moon here: this browser reads as its own comet.'
    : m.locked ? `${m.ship} is here, locked until its passphrase is typed. Until then the reader asks for it.`
    : `${m.ship} is here and unlocked: this browser reads as it.`
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

//  Where urb:// addresses open: the ship's Lattice, urb-fetch on this
//  computer at a port (blank is its default, 8475), or this browser's own
//  comet through a relay. That one needs the roller and bootstrap, asked
//  for here, inside the choice.
$('urbreader').addEventListener('change', async () => {
  const reader = $('urbreader').value
  if (reader === 'browser') {
    let granted = false
    try { granted = await chrome.permissions.request({ origins: URB_ORIGINS }) } catch (e) { say(`Permission request failed: ${e.message}`, true) }
    if (!granted) {
      $('urbreader').value = (await chrome.storage.local.get('urbReader')).urbReader || 'ship'
      say('Reading here needs the extension to ask roller.urbit.org and bootstrap.urbit.org.', true)
      return
    }
  }
  chrome.storage.local.set({ urbReader: reader })
})
$('moonaddbtn').addEventListener('click', async () => {
  if ($('moonpass').value !== $('moonpass2').value) { say('The two passphrases differ.', true); return }
  say('Checking the key and sealing it…')
  const r = await chrome.runtime.sendMessage({ kind: 'urbMoonAdd', keyfile: $('moonkey').value, passphrase: $('moonpass').value })
  $('moonkey').value = ''
  $('moonpass').value = ''
  $('moonpass2').value = ''
  say(r.ok ? `${r.ship} added. This browser now reads as it.` : r.error, !r.ok)
  await showMoon()
})
$('moonunlock').addEventListener('submit', async (e) => {
  e.preventDefault()
  const r = await chrome.runtime.sendMessage({ kind: 'urbMoonUnlock', passphrase: $('moonunlockpass').value })
  $('moonunlockpass').value = ''
  say(r.ok ? `${r.ship} unlocked.` : r.error, !r.ok)
  await showMoon()
})
$('moonlock').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ kind: 'urbMoonLock' })
  say('Locked. The passphrase opens it again.')
  await showMoon()
})
//  Removing deletes the moon's state for good, so it takes a second click.
let removing = 0
$('moonremove').addEventListener('click', async () => {
  if (Date.now() - removing > 5000) {
    removing = Date.now()
    $('moonremove').textContent = 'Remove it for good: it then needs |moon-breach before it runs anywhere'
    return
  }
  removing = 0
  $('moonremove').textContent = 'Remove the moon'
  const r = await chrome.runtime.sendMessage({ kind: 'urbMoonRemove' })
  say(r.ok ? `${r.ship || 'The moon'} removed. Breach it on your ship before using it anywhere else.` : r.error, !r.ok)
  await showMoon()
})

$('urbrelay').addEventListener('change', () => {
  const typed = $('urbrelay').value.trim()
  const relay = relayUrl(typed)
  if (typed && !relay) { say('A relay address starts with ws:// or wss://.', true); return }
  chrome.storage.local.set({ urbRelay: relay })
})
$('urbport').addEventListener('change', () => {
  const port = Number($('urbport').value)
  chrome.storage.local.set({ urbPort: Number.isInteger(port) && port > 0 && port < 65536 ? port : 0 })
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

//  ── browsing into orrery ──────────────────────────────────────────────

const ALL_SITES = ['http://*/*', 'https://*/*']

async function histShow() {
  const { historyDigest: h = {}, historySent: sent = {} } = await chrome.storage.local.get(['historyDigest', 'historySent'])
  const granted = await chrome.permissions.contains({ permissions: ['history'] })
  const sites = await chrome.permissions.contains({ origins: ALL_SITES })
  const on = Boolean(h.on && granted)
  $('histon').checked = on
  $('histpages').checked = Boolean(on && h.pages && sites)
  $('histpages').disabled = !on
  if (document.activeElement !== $('histexclude')) $('histexclude').value = (h.exclude || []).join('\n')
  $('histnow').hidden = !on
  const when = (ms) => new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(ms)
  const n = (k, one) => `${k} ${one}${k === 1 ? '' : 's'}`
  $('histsaid').textContent = !on ? 'Off.'
    : sent.error ? `The last send did not go: ${sent.error}. The next one carries it too.`
      : sent.at ? `Last sent ${when(sent.at)}: ${n(sent.visits || 0, 'visit')} and ${n(sent.pages || 0, 'page')}. The next goes within 15 minutes.`
        : 'On. The first send goes within 15 minutes.'
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
$('histpages').addEventListener('change', async () => {
  const { historyDigest: h = {} } = await chrome.storage.local.get('historyDigest')
  if ($('histpages').checked) {
    //  inside the click: the browser asks only under one
    const granted = await chrome.permissions.request({ origins: ALL_SITES }).catch(() => false)
    if (!granted) { $('histpages').checked = false; $('histsaid').textContent = 'Without leave to read every site, only the visits go.'; return }
    await chrome.storage.local.set({ historyDigest: { ...h, pages: true } })
  } else {
    await chrome.storage.local.set({ historyDigest: { ...h, pages: false } })
    await chrome.permissions.remove({ origins: ALL_SITES }).catch(() => {})
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

//  ── Brave Leo: its Bring your own model form, to paste ───────────────
//
//  Brave only: Chrome has no Leo. Talon's "Use in Brave Leo", as it is.
//  The key comes from the worker only when its copy button is pressed,
//  straight to the clipboard; it is never shown or kept here.

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter(Boolean)); return n }
const note = (text) => el('p', { className: 'note', textContent: text })
let leoModel = null

function leoField(name, shown, copy, extra = null) {
  const said = el('span', { className: 'note' })
  return el('div', { className: 'leofield' },
    el('div', {}, el('strong', { textContent: name }), el('code', { textContent: shown })),
    extra,
    el('button', {
      textContent: 'Copy',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(await copy())
          said.textContent = 'Copied.'
        } catch (e) { said.textContent = `Not copied: ${e.message || e}` }
      },
    }), said)
}

async function leoShow() {
  $('leobox').replaceChildren(note('Asking your ship for its Armillary settings…'))
  const r = await chrome.runtime.sendMessage({ kind: 'leoSetup', model: leoModel })
  if (!r.ok) { $('leobox').replaceChildren(note(`Your ship did not answer for Leo: ${r.error}`)); return }
  if (r.cannot) { $('leobox').replaceChildren(note(r.cannot)); return }
  const s = r.ready
  const pick = s.models.length > 1 && el('select', {
    ariaLabel: 'Another model',
    onchange: (e) => { leoModel = e.target.value; leoShow() },
  }, ...s.models.map((m) => el('option', { value: m, textContent: m, selected: m === s.model })))
  $('leobox').replaceChildren(
    note(LEO_STEPS),
    leoField('Label', s.label, async () => s.label),
    leoField('Model request name', s.model, async () => s.model, pick),
    leoField('Server endpoint', s.endpoint, async () => s.endpoint),
    leoField('API Key', '\u2022'.repeat(8) + s.keyTail, async () => {
      const k = await chrome.runtime.sendMessage({ kind: 'leoKey' })
      if (!k.ok) throw new Error(k.error)
      return k.key
    }),
    note(LEO_KEY_NOTE),
    el('button', { textContent: 'Open Leo\'s settings', onclick: () => chrome.tabs.create({ url: 'chrome://settings/leo-ai' }) }),
  )
}

$('leo').hidden = !navigator.brave
$('leoshow').addEventListener('click', leoShow)

day = await chrome.storage.local.get(DAYKEYS)
dayShow()
bgShow()
if (location.hash === '#clock') { $('placeq').scrollIntoView({ block: 'center' }); $('placeq').focus() }
//  what Options shows of Talon's look is read now: one scry
chrome.runtime.sendMessage({ kind: 'look' }).catch(() => {})

refresh()
