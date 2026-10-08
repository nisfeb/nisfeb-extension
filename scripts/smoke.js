//  The extension against a dev ship, headless.
//
//  Stages a copy of the extension, launches Brave with it once so the profile
//  holds the extension's record, and writes the ship's host permission into
//  that record as permissions.request would (a harness has no click to give
//  it, and Brave withholds a command-line extension's manifest host
//  permissions: without this the fetches are cross-site, preflighted, and
//  carry no cookie). Then it launches again, puts the session cookie in the
//  profile, and drives the worker's own handlers over the devtools protocol:
//  a bookmark, a clip, a page for orrery to read, a calendar task, an auspex
//  draft, the omnibox suggester, the chat list (read, never sent to) and the
//  day page's five reads. Each is then checked against the app's
//  own HTTP API from here, and the residue is removed.
//
//    SHIP=http://localhost:8081 COOKIE_FILE=/path/to/cookie node scripts/smoke.js
//
//  SKIP=read,task leaves named steps out, when another run owns that app.
//
//  The cookie file holds one line, `urbauth-~ship=0v...`, from
//  `curl -si --data-urlencode password=<+code> $SHIP/~/login | grep -i set-cookie`.
//  Keep it out of the repo. BROWSER names the binary (default: brave).

import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { patternFor, calendarPoke, localDate } from '../lib/ship.js'

const SHIP = process.env.SHIP
const COOKIE = process.env.COOKIE_FILE ? readFileSync(process.env.COOKIE_FILE, 'utf8').trim() : ''
if (!SHIP || !COOKIE.includes('=')) throw new Error('SHIP and COOKIE_FILE are required')
const eq = COOKIE.indexOf('=')
const cookie = { name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1).split(';')[0] }

//  ── stage the extension, launch the browser ──────────────────────────

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const stage = mkdtempSync(join(tmpdir(), 'nisfeb-ext-'))
const profile = mkdtempSync(join(tmpdir(), 'nisfeb-profile-'))
for (const f of ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'today.html', 'today.js', 'lib', 'icons']) {
  cpSync(join(root, f), join(stage, f), { recursive: true })
}
function launch() {
  const browser = spawn(process.env.BROWSER || 'brave', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    `--load-extension=${stage}`, `--disable-extensions-except=${stage}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = new Promise((resolve, reject) => {
    let buf = ''
    browser.stderr.on('data', (d) => {
      buf += d
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
      if (m) resolve(m[1])
    })
    browser.on('exit', (c) => reject(new Error(`browser exited ${c}\n${buf}`)))
    setTimeout(() => reject(new Error(`no devtools endpoint in 15 s\n${buf}`)), 15000)
  })
  return { browser, wsUrl }
}

//  First launch: only so the profile writes the extension's record, found
//  by its path (the id is a hash of the path, so a staged copy has its own).
{
  const first = launch()
  await first.wsUrl
  await new Promise((r) => setTimeout(r, 2500))
  first.browser.kill()
  await new Promise((r) => first.browser.once('exit', r))
  const pf = join(profile, 'Default', 'Preferences')
  const prefs = JSON.parse(readFileSync(pf, 'utf8'))
  const settings = prefs.extensions.settings
  const id = Object.keys(settings).find((k) => settings[k].path === stage)
  if (!id) throw new Error('the profile never recorded the extension')
  const e = settings[id]
  for (const k of ['active_permissions', 'granted_permissions', 'runtime_granted_permissions']) {
    e[k] = { ...(e[k] || {}), api: (e[k] && e[k].api) || [], explicit_host: [patternFor(SHIP)], manifest_permissions: [], scriptable_host: [] }
  }
  delete e.withholding_permissions
  writeFileSync(pf, JSON.stringify(prefs))
}

const { browser, wsUrl: wsUrlP } = launch()
const wsUrl = await wsUrlP

//  ── a devtools client, just enough ───────────────────────────────────

const ws = new WebSocket(wsUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const waiting = new Map()
const listeners = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (!m.id) { for (const l of listeners) l(m); return }
  if (!waiting.has(m.id)) return
  const { r, j } = waiting.get(m.id)
  waiting.delete(m.id)
  m.error ? j(new Error(m.error.message)) : r(m.result)
}
const cdp = (method, params = {}, sessionId) => new Promise((r, j) => {
  const id = ++seq
  waiting.set(id, { r, j })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
  //  a worker that died between two calls never answers; do not wait for ever
  setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); j(new Error(`${method} timed out`)) } }, 90000)
})

await cdp('Storage.setCookies', { cookies: [{ ...cookie, url: SHIP }] })

let worker
for (let i = 0; i < 50 && !worker; i++) {
  const { targetInfos } = await cdp('Target.getTargets')
  worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'))
  if (!worker) await new Promise((r) => setTimeout(r, 200))
}
if (!worker) throw new Error('the extension worker never appeared')
const { sessionId } = await cdp('Target.attachToTarget', { targetId: worker.targetId, flatten: true })

async function inWorker(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (r.exceptionDetails) {
    const e = r.exceptionDetails.exception
    throw new Error((e && e.description) || r.exceptionDetails.text)
  }
  return r.result.value
}
const handle = (msg) => inWorker(`nisfeb.handle(${JSON.stringify(msg)})`)

//  The target exists before its script has run. Wait for the worker's own
//  global, or `chrome` itself is not defined yet.
for (let i = 0; i < 50; i++) {
  if (await inWorker("typeof nisfeb").catch(() => '') === 'object') break
  await new Promise((r) => setTimeout(r, 100))
}

//  ── the ship, from here, for the checks and the cleanup ──────────────

const api = async (path, init = {}) => {
  const res = await fetch(SHIP + path, { ...init, headers: { cookie: COOKIE, ...(init.headers || {}) } })
  return { status: res.status, body: await res.text() }
}
const post = (path, body) => api(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})

//  ── the run ──────────────────────────────────────────────────────────

const url = `https://example.com/nisfeb-smoke-${Date.now()}`
const name = 'nisfeb smoke'
const got = {}
const failures = []
//  SKIP=read,task holds named steps back, for a ship another run is using.
const skip = new Set((process.env.SKIP || '').split(',').filter(Boolean))
const step = async (what, fn) => {
  if (skip.has(what)) { console.log(`skip ${what}`); return null }
  process.stdout.write(`.... ${what}\r`)
  try {
    const r = await fn()
    if (r === true || (r && r.ok)) console.log(`ok   ${what}`)
    else { failures.push(what); console.log(`FAIL ${what}: ${r && r.error ? r.error : JSON.stringify(r)}`) }
    return r
  } catch (e) { failures.push(what); console.log(`FAIL ${what}: ${e.message}`); return null }
}

await inWorker(`chrome.storage.local.set(${JSON.stringify({ origin: SHIP, ship: '', status: 'connected' })})`)

//  The popup, as a page: it must render its status line with no exception.
await step('popup renders', async () => {
  const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${new URL(worker.url).host}/popup.html` })
  const { sessionId: ps } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  const errors = []
  listeners.push((m) => {
    if (m.sessionId !== ps || m.method !== 'Runtime.exceptionThrown') return
    const d = m.params.exceptionDetails
    errors.push((d.exception && d.exception.description) || d.text)
  })
  await cdp('Runtime.enable', {}, ps)
  await new Promise((r) => setTimeout(r, 1500))
  const who = await cdp('Runtime.evaluate', { expression: "document.getElementById('who').textContent", returnByValue: true }, ps)
  await cdp('Target.closeTarget', { targetId })
  if (errors.length) return { ok: false, error: errors.join('; ') }
  return who.result.value !== '…' ? true : { ok: false, error: 'the status line never rendered' }
})

got.bookmark = await step('bookmark', () => handle({ kind: 'bookmark', url, title: name }))
got.clip = await step('clip', () => handle({ kind: 'clip', url, title: name, sel: 'a line\nanother line' }))
got.read = await step('read', () => handle({ kind: 'read', title: name, url, text: 'This is a smoke test of the nisfeb browser extension. Nothing in it is a fact about anyone.' }))
got.task = await step('task', () => handle({ kind: 'event', body: calendarPoke({ kind: 'task', name, date: localDate(), note: url }) }))
got.draft = await step('draft', () => handle({ kind: 'draft', to: [], subject: name, body: url }))
got.suggest = await step('suggest', () => handle({ kind: 'suggest', q: 'nisfeb-smoke' }))
//  The chat list only: a send would post into somebody's chat.
await step('chats', async () => {
  const r = await handle({ kind: 'chats' })
  return r.ok && Array.isArray(r.items) ? true : r
})
//  The day page's refresh: five reads, each card with data or its reason.
await step('today', async () => {
  const r = await handle({ kind: 'today' })
  const t = await inWorker("chrome.storage.local.get('today').then((s) => s.today)")
  const cards = (t && t.cards) || {}
  const said = Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, c.error || 'ok']))
  return r.ok && Object.keys(cards).length === 5 && Object.values(said).every((v) => v === 'ok') ? true : { ok: false, error: JSON.stringify(said) }
})

await step('bookmark is listed', async () => JSON.parse((await api('/apps/lattice/bookmarks')).body).items.some((i) => i.url === url))
await step('clip is a page', async () => got.clip && (await api(`/apps/lattice/page-source?name=${encodeURIComponent(got.clip.name)}`)).body.includes('another line'))
await step('read was taken', async () => got.read && (got.read.id || got.read.dropped) ? true : { ok: false, error: JSON.stringify(got.read) })
let task = null
await step('task is on the calendar', async () => {
  const rows = JSON.parse((await api('/apps/calendar/events.json?cat=todo')).body)
  task = (Array.isArray(rows) ? rows : rows.events || rows.items || []).find((r) => r.meta && r.meta.name === name)
  return !!task
})
await step('draft is held', async () => got.draft && (await api('/apps/auspex/api/drafts')).body.includes(got.draft.id))
await step('suggest finds the bookmark', async () => got.suggest && got.suggest.items.some((i) => i.url === url))

//  ── cleanup ──────────────────────────────────────────────────────────

await step('unbookmark', async () => (await post(`/apps/lattice/unbookmark?url=${encodeURIComponent(url)}`)).status === 200)
if (got.clip) await step('page-del', async () => (await post(`/apps/lattice/page-del?name=${encodeURIComponent(got.clip.name)}`)).status === 200)
if (task) {
  await step('del-event', async () => {
    const { ball } = JSON.parse((await api('/apps/calendar/config.json')).body)
    return (await post(`/grubbery/api/poke/${ball}/calendar.calendar?blot=/json`, { action: 'del-event', id: task.id, home: task.cal })).status === 200
  })
}
if (got.draft) await step('draft-delete', async () => (await post('/apps/auspex/api/draft-delete', { id: got.draft.id })).status === 200)

browser.kill()
await new Promise((r) => browser.once('exit', r))
rmSync(stage, { recursive: true, force: true })
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
console.log(failures.length ? `\n${failures.length} failed: ${failures.join(', ')}` : '\nall good')
process.exit(failures.length ? 1 : 0)
