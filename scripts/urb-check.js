//  Reading urb:// pages here in the browser, in a throwaway headless Brave
//  against a live ship, through a relay of its own.
//
//  Starts `urb-fetch -relay` on a free local port, stages the extension,
//  grants it the roller and bootstrap as the Options choice would (Brave
//  withholds a command-line extension's host permissions, and a harness
//  has no click to give), and chooses this browser as the urb:// reader.
//  Then it reads a page in reader.html, reads it again from the worker,
//  checks the link script's answer, and shows an HTML page in the
//  sandboxed frame and follows an urb:// link from it. A fake moon, offline,
//  takes the moon's way through: added, sealed, locked, unlocked on the
//  reader page, removed.
//
//    URB_FETCH=/path/to/urb-fetch node scripts/urb-check.js
//
//  PAGE (default urb://~ricsul-bilwyt/lattice-agent-wiki) and WANT (text
//  the page holds) name the page. BROWSER names the binary. Each run mines
//  a comet in its scratch profile, and the ship read keeps a record of it.
//
//  FLEET=1 reads from hoon-development's fleet instead, so routine runs
//  leave no comet on a live ship: the relay is `-relay-fake`, the engine
//  runs on the fake network (urbFake), and PAGE defaults to
//  urb://~hus/fleet-check, which lattice serves on ~hus in the fleet set
//  `furum` (its snapshot `hus-lattice`: `fleet reset furum hus-lattice`).
//
//  FURUM=~host/board adds furum on a fake network: a second relay with
//  -relay-fake, the engine's test-only urbFake, and a fake moon named from
//  the clock (the host remembers every moon it met, and this profile is
//  thrown away). On furum.html it reads the board, posts, comments and
//  upvotes from the page's forms, then posts again at once and sees furum's
//  refusal. On hoon-development's fleet: `fleet reset furum urb-board`,
//  then FURUM=~rup/urbtest.

import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { URB_ORIGINS } from '../lib/urb.js'
import { readerPath } from '../lib/gemtext.js'
import { fakeKeyfile, shipName } from '../lib/mesa.mjs'

const URB_FETCH = process.env.URB_FETCH
const FURUM = process.env.FURUM
const FLEET = Boolean(process.env.FLEET)
const PAGE = process.env.PAGE || (FLEET ? 'urb://~hus/fleet-check' : 'urb://~ricsul-bilwyt/lattice-agent-wiki')
const WANT = process.env.WANT || (FLEET ? 'lattice 81 on the furum fleet set' : 'Bootstrap lattice')
if (!URB_FETCH) throw new Error('URB_FETCH (the urb-fetch binary, for its -relay) is required')

//  ── the relay ────────────────────────────────────────────────────────

async function startRelay(...flags) {
  const state = mkdtempSync(join(tmpdir(), 'urb-relay-'))
  const port = 30000 + Math.floor(Math.random() * 20000)
  const proc = spawn(URB_FETCH, ['-relay', `127.0.0.1:${port}`, '-state', state, ...flags], { stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  proc.stderr.on('data', (c) => { log += c })
  await new Promise((resolve, reject) => {
    const t = setInterval(() => { if (log.includes('relaying at')) { clearInterval(t); resolve() } }, 100)
    proc.on('exit', (c) => reject(new Error(`the relay exited ${c}\n${log}`)))
    setTimeout(() => reject(new Error(`the relay did not start\n${log}`)), 10000)
  })
  return { proc, state, url: `ws://127.0.0.1:${port}/` }
}
const relays = [await startRelay(...(FLEET ? ['-relay-fake'] : []))]
const RELAY = relays[0].url
if (FURUM) relays.push(await startRelay('-relay-fake'))

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
  await evaluate(`chrome.storage.local.set(${JSON.stringify({ urbReader: 'browser', urbRelay: RELAY, ...(FLEET ? { urbFake: true } : {}) })})`, w)

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

  //  A moon in this browser, offline: a fake moon's keyfile (keys from its
  //  name, so no real identity is spent) and a relay that is not there, so
  //  nothing it opens reaches the network.
  const wasm = readFileSync(join(root, 'lib', 'mesa.wasm'))
  const MOON = '~sampel-sampel-dozzod-nisfeb'
  const moonKey = await fakeKeyfile(wasm, MOON)
  const planetKey = await fakeKeyfile(wasm, '~sampel-palnet')
  await evaluate(`chrome.storage.local.set({ urbRelay: 'ws://127.0.0.1:9/' })`, w)
  const notMoon = await handle({ kind: 'urbMoonAdd', keyfile: planetKey, passphrase: 'a long passphrase' })
  check('a moon only: a planet\'s key is refused', !notMoon.ok && /not a moon/.test(notMoon.error), JSON.stringify(notMoon))
  const short = await handle({ kind: 'urbMoonAdd', keyfile: moonKey, passphrase: 'short' })
  check('a short passphrase is refused', !short.ok, JSON.stringify(short))
  const added = await handle({ kind: 'urbMoonAdd', keyfile: moonKey, passphrase: 'a long passphrase' })
  check('the moon is added', added.ok && added.ship === MOON, JSON.stringify(added))
  const kept = await evaluate(`chrome.storage.local.get('urbMoon').then((s) => JSON.stringify(s))`, w)
  check('storage.local holds the key sealed, never as is', kept.includes('"sealed"') && !kept.includes(moonKey.slice(4, 40)), kept.slice(0, 200))
  const fresh = await evaluate(`new Promise((r) => { const o = indexedDB.open('urb-${MOON}'); o.onsuccess = () => { const g = o.result.transaction('meta').objectStore('meta').get('fresh'); g.onsuccess = () => { r(g.result); o.result.close() } } })`, w)
  check('a new moon may start from empty state, once', fresh === true, String(fresh))
  await handle({ kind: 'urbMoonLock' })
  const locked = await handle({ kind: 'urbRead', url: PAGE })
  check('locked, a read asks for the passphrase', !locked.ok && locked.locked && locked.ship === MOON, JSON.stringify(locked))
  const wrong = await handle({ kind: 'urbMoonUnlock', passphrase: 'not the passphrase' })
  check('a wrong passphrase does not open it', !wrong.ok, JSON.stringify(wrong))
  //  the reader page asks, and the passphrase typed there opens it
  const { targetId: rt } = await cdp('Target.createTarget', { url: BASE + readerPath(PAGE) })
  const { sessionId: r1 } = await cdp('Target.attachToTarget', { targetId: rt, flatten: true })
  const asking = await textOf(r1, ['Type its passphrase'], 15000)
  check('the reader page asks for the moon\'s passphrase', asking.includes(MOON), asking.slice(0, 200))
  await evaluate(`document.getElementById('pass').value = 'a long passphrase'; document.getElementById('unlock').requestSubmit()`, r1)
  const after = await textOf(r1, ["can't reach the relay"], 15000)
  check('its passphrase unlocks it, and the read goes on', after.includes("can't reach the relay") && (await handle({ kind: 'urbMoon' })).locked === false, after.slice(0, 200))
  await cdp('Target.closeTarget', { targetId: rt })
  const twice = await handle({ kind: 'urbMoonAdd', keyfile: moonKey, passphrase: 'a long passphrase' })
  check('a second moon waits for the first to go', !twice.ok && /already here/.test(twice.error), JSON.stringify(twice))
  const removed = await handle({ kind: 'urbMoonRemove' })
  const left = await evaluate(`indexedDB.databases().then((d) => d.map((x) => x.name).join(' '))`, w)
  check('removing it deletes its state', removed.ok && !left.includes(`urb-${MOON}`) && !(await handle({ kind: 'urbMoon' })).ship, left)
  await evaluate(`chrome.storage.local.set({ urbRelay: ${JSON.stringify(RELAY)} })`, w)
  const comet = await handle({ kind: 'urbRead', url: PAGE })
  check('with the moon gone, the comet reads again', comet.ok && comet.as === again.as, JSON.stringify(comet).slice(0, 200))

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

  //  furum on a fake network, as a fake moon, from furum.html's forms
  if (FURUM) {
    const [host, name] = FURUM.split('/')
    const k = BigInt(Math.floor(Date.now() / 1000) % 0xffffffff) + 1n
    const fakeMoon = await shipName(wasm, (k << 32n) | 209n)   //  a moon of ~hus
    const { targetInfos } = await cdp('Target.getTargets')
    const wk = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'))
    const { sessionId: w3 } = await cdp('Target.attachToTarget', { targetId: wk.targetId, flatten: true })
    const h3 = (msg) => evaluate(`nisfeb.handle(${JSON.stringify(msg)})`, w3)
    await evaluate(`chrome.storage.local.set(${JSON.stringify({ urbFake: true, urbRelay: relays[1].url })})`, w3)
    const joined = await h3({ kind: 'urbMoonAdd', keyfile: await fakeKeyfile(wasm, fakeMoon), passphrase: 'a long passphrase' })
    check(`a fake moon for furum, ${fakeMoon}`, joined.ok, JSON.stringify(joined))
    const t3 = Date.now()
    const { targetId: ft } = await cdp('Target.createTarget', { url: `${BASE}furum.html?b=${host}/${name}` })
    const { sessionId: fp } = await cdp('Target.attachToTarget', { targetId: ft, flatten: true })
    const listed = await textOf(fp, [`read as ${fakeMoon}`], 120000)
    const count = Number((/(\d+) posts, read as/.exec(listed) || [])[1])
    check(`furum.html lists ${host}/${name}`, Number.isInteger(count), listed.slice(0, 300))
    console.log(`     ${count} posts, ${((Date.now() - t3) / 1000).toFixed(1)} s`)
    const title = `From the browser, ${new Date().toISOString().slice(11, 19)}`
    await evaluate(`document.getElementById('new').open = true; document.getElementById('ptitle').value = ${JSON.stringify(title)}; document.getElementById('pbody').value = 'Typed into furum.html in headless Brave.'; document.getElementById('postform').requestSubmit()`, fp)
    const posted = await textOf(fp, [`${count + 1} posts, read as`, title], 90000)
    check('a post from the page shows on the board', posted.includes(title) && posted.includes(`${count + 1} posts`), posted.slice(0, 300))
    const mine = (await h3({ kind: 'furum', op: 'posts', host, board: name })).posts.find((p) => p.title === title)
    await cdp('Page.navigate', { url: `${BASE}furum.html?b=${host}/${name}&p=${mine.id}` }, fp)
    await textOf(fp, ['Read as'], 60000)
    await sleep(12000)   //  furum's cooldown: 10 s between a member's posts and comments
    await evaluate(`document.getElementById('cbody').value = 'A comment from furum.html.'; document.getElementById('commentform').requestSubmit()`, fp)
    const commented = await textOf(fp, ['A comment from furum.html.', 'Read as'], 90000)
    check('a comment from the page shows under the post', commented.includes('A comment from furum.html.') && !/Refused/.test(commented), commented.slice(0, 300))
    await evaluate(`document.getElementById('upvote').click()`, fp)
    const voted = await textOf(fp, ['1 up'], 90000)
    check('an upvote from the page counts', voted.includes('1 up'), voted.slice(0, 300))
    //  votes aren't rate-limited, but a post this soon after the comment is
    await cdp('Page.navigate', { url: `${BASE}furum.html?b=${host}/${name}` }, fp)
    await textOf(fp, ['read as'], 60000)
    await evaluate(`document.getElementById('new').open = true; document.getElementById('ptitle').value = 'Too soon'; document.getElementById('postform').requestSubmit()`, fp)
    const refused = await textOf(fp, ['Refused'], 90000)
    check('posting again at once shows furum\'s refusal', /Refused: .*too fast/.test(refused), refused.slice(0, 300))
    console.log(`     furum, all of it: ${((Date.now() - t3) / 1000).toFixed(1)} s`)
  }
} catch (e) {
  check('the run finished', false, e.stack || e.message)
} finally {
  browser.kill()
  for (const r of relays) r.proc.kill()
  await new Promise((r) => browser.once('exit', r))
  for (const d of [stage, profile, ...relays.map((r) => r.state)]) rmSync(d, { recursive: true, force: true })
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
