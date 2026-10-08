//  The options page: two fields, one button, and the only place the code
//  is ever typed. The host permission for exactly the origin typed is
//  requested here, inside the click, because permissions.request needs a
//  user gesture and gets one nowhere else.

import { normaliseOrigin, patternFor } from './lib/ship.js'

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
$('dayntp').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/newTab' }))
$('dayopen').addEventListener('click', () => chrome.tabs.create({ url: DAY }))

refresh()
