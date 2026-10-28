//  Reading urb:// pages here in the browser, in a throwaway headless Brave
//  against a live ship, through a relay of its own.
//
//  Starts `urb-fetch -relay` on a free local port, stages the extension,
//  grants it the roller and bootstrap as the Options choice would (Brave
//  withholds a command-line extension's host permissions, and a harness
//  has no click to give), and chooses this browser as the urb:// reader.
//  Then it reads a page in reader.html, reads it again from the worker,
//  checks the link script's answer, and shows an HTML page in the
//  sandboxed frame and follows an urb:// link from it.
//
//    URB_FETCH=/path/to/urb-fetch node scripts/urb-check.js
//
//  PAGE (default urb://~ricsul-bilwyt/lattice-agent-wiki) and WANT (text
//  the page holds) name the page. BROWSER names the binary. Each run mines
//  a comet in its scratch profile, and the ship read keeps a record of it.

import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { URB_ORIGINS } from '../lib/urb.js'
import { readerPath } from '../lib/gemtext.js'

const URB_FETCH = process.env.URB_FETCH
const PAGE = process.env.PAGE || 'urb://~ricsul-bilwyt/lattice-agent-wiki'
const WANT = process.env.WANT || 'Bootstrap lattice'
if (!URB_FETCH) throw new Error('URB_FETCH (the urb-fetch binary, for its -relay) is required')

//  ── the relay ────────────────────────────────────────────────────────

const relayState = mkdtempSync(join(tmpdir(), 'urb-relay-'))
const port = 30000 + Math.floor(Math.random() * 20000)
const RELAY = `ws://127.0.0.1:${port}/`
const relay = spawn(URB_FETCH, ['-relay', `127.0.0.1:${port}`, '-state', relayState], { stdio: ['ignore', 'ignore', 'pipe'] })
let relayLog = ''
relay.stderr.on('data', (c) => { relayLog += c })
await new Promise((resolve, reject) => {
  const t = setInterval(() => { if (relayLog.includes('relaying at')) { clearInterval(t); resolve() } }, 100)
  relay.on('exit', (c) => reject(new Error(`the relay exited ${c}\n${relayLog}`)))
  setTimeout(() => reject(new Error(`the relay did not start\n${relayLog}`)), 10000)
})

//  ── stage, grant, launch (as scripts/today-check.js) ─────────────────

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const stage = mkdtempSync(join(tmpdir(), 'nisfeb-ext-'))
const profile = mkdtempSync(join(tmpdir(), 'nisfeb-profile-'))
cpSync(root, stage, { recursive: true, filter: (src) => !/^\/(\.git|node_modules|test|scripts|docs)(\/|$)/.test(src.slice(root.length)) })
function launch() {
  const browser = spawn(process.env.BROWSER || '/usr/lib/brave-browser/brave', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    `--load-extension=${stage}`, `--disable-extensions-except=${stage}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = new Promise((resolve, reject) => {
    let buf = ''
    browser.stderr.on('data', (c) => { buf += c; const x = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (x) resolve(x[1]) })
    browser.on('exit', (c) => reject(new Error(`browser exited ${c}\n${buf}`)))
    setTimeout(() => reject(new Error(`no devtools endpoint in 15 s\n${buf}`)), 15000)
  })
  return { browser, wsUrl }
}
{
  const first = launch()
  await first.wsUrl
  await new Promise((r) => setTimeout(r, 2500))
  first.browser.kill()
  await new Promise((r) => first.browser.once('exit', r))
  const pf = join(profile, 'Default', 'Preferences')
  const prefs = JSON.parse(readFileSync(pf, 'utf8'))
  const settings = prefs.extensions.settings
  const e = settings[Object.keys(settings).find((k) => settings[k].path === stage)]
  for (const k of ['active_permissions', 'granted_permissions', 'runtime_granted_permissions']) {
    e[k] = { ...(e[k] || {}), api: (e[k] && e[k].api) || [], explicit_host: URB_ORIGINS, manifest_permissions: [], scriptable_host: [] }
  }
  delete e.withholding_permissions
  writeFileSync(pf, JSON.stringify(prefs))
}
const { browser, wsUrl } = launch()
const ws = new WebSocket(await wsUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const waiting = new Map()
const errors = []
const contexts = []   //  execution contexts, with their frames, for the sandboxed frame
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
  if (msg.method === 'Runtime.executionContextCreated') contexts.push({ ...msg.params.context, sessionId: msg.sessionId })
  if (!msg.id || !waiting.has(msg.id)) return
  const { r, j } = waiting.get(msg.id)
  waiting.delete(msg.id)
  msg.error ? j(new Error(msg.error.message)) : r(msg.result)
}
const cdp = (method, params = {}, sessionId) => new Promise((r, j) => {
  const id = ++seq
  waiting.set(id, { r, j })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
  setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); j(new Error(`${method} timed out`)) } }, 330000)
})
async function evaluate(expression, sessionId, contextId) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, contextId }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let worker
for (let i = 0; i < 50 && !worker; i++) {
  const { targetInfos } = await cdp('Target.getTargets')
  worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'))
  if (!worker) await sleep(200)
}
if (!worker) throw new Error('the extension worker never appeared')
const { sessionId: w } = await cdp('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
for (let i = 0; i < 50; i++) {
  if (await evaluate('typeof nisfeb', w).catch(() => '') === 'object') break
  await sleep(100)
}
const handle = (msg) => evaluate(`nisfeb.handle(${JSON.stringify(msg)})`, w)
const BASE = `chrome-extension://${new URL(worker.url).host}/`

const failures = []
function check(what, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`)
  if (!cond) { failures.push(what); if (detail) console.log(String(detail).split('\n').map((l) => `     ${l}`).join('\n')) }
}

async function textOf(sessionId, want, ms) {
  let text = ''
  for (const end = Date.now() + ms; Date.now() < end;) {
    text = await evaluate('document.body.innerText', sessionId).catch(() => '')
    if (want.every((x) => text.includes(x))) break
    await sleep(500)
  }
  return text
}

//  ── the runs ─────────────────────────────────────────────────────────

try {
  await evaluate(`chrome.storage.local.set(${JSON.stringify({ urbReader: 'browser', urbRelay: RELAY })})`, w)

  //  the reader page: a fresh comet, mined here, meets the ship
  const t0 = Date.now()
  const { targetId } = await cdp('Target.createTarget', { url: BASE + readerPath(PAGE) })
  const { sessionId: p } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  await cdp('Runtime.enable', {}, p)
  const text = await textOf(p, [WANT, 'Read as ~'], 300000)
  check(`reader.html shows ${PAGE}`, text.includes(WANT) && text.includes('Read as ~'), text.slice(0, 600))
  console.log(`     ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(/Read as (~\S+?),/.exec(text) || [])[1] || 'no comet'}`)

  //  the engine stays up in the worker: a second read is quick
  const t1 = Date.now()
  const again = await handle({ kind: 'urbRead', url: PAGE })
  check('a second read, from the worker', again.ok && again.body.includes(WANT) && Date.now() - t1 < 15000, JSON.stringify(again).slice(0, 300))
  console.log(`     ${((Date.now() - t1) / 1000).toFixed(1)} s, by ${again.how}`)

  //  what the link script is told, and what it may not ask
  const lo = await handle({ kind: 'linkOrigin' })
  check('linkOrigin gives the link script the reader page', lo.reader === BASE + readerPath(''), JSON.stringify(lo))
  const bad = await handle({ kind: 'openUrb', url: 'javascript:alert(1)' })
  check('openUrb takes only urb:// addresses', bad.ok === false, JSON.stringify(bad))

  //  the sandboxed frame: HTML shown there, its scripts run, a link in it
  //  goes up to the reader page, which opens it in itself
  const html = '<!doctype html><title>t</title><p id="said">plain</p><script>document.getElementById("said").textContent = "scripts run"</script><a id="go" href="urb://~zod/elsewhere">elsewhere</a>'
  const acked = await evaluate(`Promise.race([reader.showHtml(${JSON.stringify(html)}).then(() => 'shown'), new Promise((r) => setTimeout(() => r('no answer from the frame'), 5000))])`, p)
  check('the reader hands the frame its HTML, and the frame says it is shown', acked === 'shown', acked)
  //  An opaque-origin frame runs in a process of its own, so it is a
  //  devtools target of its own; else its context is in the page's.
  let inside = null
  for (let i = 0; i < 20 && !inside; i++) {
    const { targetInfos } = await cdp('Target.getTargets')
    const t = targetInfos.find((x) => x.type === 'iframe' && x.url.endsWith('/frame.html'))
    if (t) {
      const { sessionId } = await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true })
      inside = { sessionId }
    } else {
      const { frameTree } = await cdp('Page.getFrameTree', {}, p)
      const child = frameTree.childFrames && frameTree.childFrames[0] && frameTree.childFrames[0].frame
      const c = child && contexts.filter((x) => x.sessionId === p && x.auxData && x.auxData.frameId === child.id).at(-1)
      if (c) inside = { sessionId: p, contextId: c.id }
      else await sleep(250)
    }
  }
  const inFrame = (expr) => (inside ? evaluate(expr, inside.sessionId, inside.contextId).catch((e) => e.message) : Promise.resolve('no frame found'))
  const shown = await inFrame('document.body.innerText + " | " + self.origin')
  check('frame.html: the page shows and its script ran', shown.includes('scripts run'), shown)
  check('frame.html: an opaque origin, not the extension\'s', shown.endsWith('| null'), shown)
  const reach = await inFrame('typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id ? "extension reachable" : "sealed"')
  check('frame.html: the page cannot reach the extension', reach === 'sealed', reach)
  await inFrame('document.getElementById("go").click()')
  let at = ''
  for (let i = 0; i < 20 && !at.includes('elsewhere'); i++) {
    await sleep(250)
    at = await evaluate('location.href', p).catch(() => '')
  }
  check('a link in the frame opens in the reader page', at === BASE + readerPath('urb://~zod/elsewhere'), at)
  check('no uncaught errors', errors.length === 0, errors.join('\n'))

  //  The browser stops an idle worker, as here. A new reader page wakes
  //  the next one, which opens the same comet from IndexedDB and carries
  //  on where its flows left off.
  await cdp('ServiceWorker.enable', {}, p)
  await cdp('ServiceWorker.stopAllWorkers', {}, p)
  let gone = false
  for (let i = 0; i < 50 && !gone; i++) {
    await sleep(200)
    const { targetInfos } = await cdp('Target.getTargets')
    gone = !targetInfos.some((t) => t.targetId === worker.targetId)
  }
  check('the worker stops', gone)
  const t2 = Date.now()
  const { targetId: t2id } = await cdp('Target.createTarget', { url: BASE + readerPath(PAGE) })
  const { sessionId: p2 } = await cdp('Target.attachToTarget', { targetId: t2id, flatten: true })
  const text2 = await textOf(p2, [WANT, 'Read as ~'], 300000)
  const as2 = (/Read as (~\S+?),/.exec(text2) || [])[1]
  check('after the worker restarts, the same comet reads again', text2.includes(WANT) && as2 === again.as, `${again.as} then ${as2}: ${text2.slice(0, 300)}`)
  console.log(`     ${((Date.now() - t2) / 1000).toFixed(1)} s, as ${as2}`)
} catch (e) {
  check('the run finished', false, e.stack || e.message)
} finally {
  browser.kill()
  relay.kill()
  await new Promise((r) => browser.once('exit', r))
  for (const d of [stage, profile, relayState]) rmSync(d, { recursive: true, force: true })
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
