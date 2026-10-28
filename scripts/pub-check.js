//  Publishing from this browser, in a throwaway headless Brave, read by
//  Lattice on a fake ship.
//
//  Starts `urb-fetch -relay -relay-fake`, stages the extension, adds a fake
//  moon named from the clock (the reader remembers every moon it met, and
//  this profile is thrown away) with the engine's test-only urbFake, and
//  publishes a page from publish.html's form. Then it closes the page and
//  lets go of the worker, as a browser left alone would: a devtools
//  session keeps a worker awake, so the harness holds none while it waits.
//  After IDLE seconds (default 150) it asks Lattice on the reader ship for
//  the page, and looks at whether the worker is the one it left.
//
//    URB_FETCH=/path/to/urb-fetch READER=http://localhost:8134 READER_JAR=<curl jar> node scripts/pub-check.js
//
//  READER is a fake ship running Lattice (on hoon-development's fleet,
//  the set furum with lattice on ~hus) and READER_JAR a login cookie for
//  it from scripts/hoon-test-kit/ship-cookie.sh. PARENT (default ~rup)
//  names the fake moon's parent.

import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fakeKeyfile, shipName } from '../lib/mesa.mjs'

const { URB_FETCH, READER, READER_JAR } = process.env
const IDLE = Number(process.env.IDLE || 150)
if (!URB_FETCH || !READER || !READER_JAR) throw new Error('URB_FETCH, READER and READER_JAR are required')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const wasm = readFileSync(join(root, 'lib', 'mesa.wasm'))
const cookie = readFileSync(READER_JAR, 'utf8').split('\n')
  .map((l) => l.replace(/^#HttpOnly_/, '').split('\t')).find((f) => f.length === 7 && f[5].startsWith('urbauth-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

//  ── the relay, the stage, the browser (as scripts/urb-check.js) ─────────

const relayState = mkdtempSync(join(tmpdir(), 'urb-relay-'))
const port = 30000 + Math.floor(Math.random() * 20000)
const relay = spawn(URB_FETCH, ['-relay', `127.0.0.1:${port}`, '-state', relayState, '-relay-fake'], { stdio: ['ignore', 'ignore', 'pipe'] })
{
  let log = ''
  relay.stderr.on('data', (c) => { log += c })
  await new Promise((resolve, reject) => {
    const t = setInterval(() => { if (log.includes('relaying at')) { clearInterval(t); resolve() } }, 100)
    relay.on('exit', (c) => reject(new Error(`the relay exited ${c}\n${log}`)))
    setTimeout(() => reject(new Error(`the relay did not start\n${log}`)), 10000)
  })
}
const stage = mkdtempSync(join(tmpdir(), 'nisfeb-ext-'))
const profile = mkdtempSync(join(tmpdir(), 'nisfeb-profile-'))
cpSync(root, stage, { recursive: true, filter: (src) => !/^\/(\.git|node_modules|test|scripts|docs)(\/|$)/.test(src.slice(root.length)) })
const browser = spawn(process.env.BROWSER || '/usr/lib/brave-browser/brave', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  `--load-extension=${stage}`, `--disable-extensions-except=${stage}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''
  browser.stderr.on('data', (c) => { buf += c; const x = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (x) resolve(x[1]) })
  browser.on('exit', (c) => reject(new Error(`browser exited ${c}\n${buf}`)))
  setTimeout(() => reject(new Error(`no devtools endpoint in 15 s\n${buf}`)), 15000)
})
const ws = new WebSocket(wsUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const waiting = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
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
async function evaluate(expression, sessionId) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
async function workerSession() {
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await cdp('Target.getTargets')
    const t = targetInfos.find((x) => x.type === 'service_worker' && x.url.endsWith('/background.js'))
    if (t) {
      const { sessionId } = await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true })
      for (let j = 0; j < 50; j++) {
        if (await evaluate('typeof nisfeb', sessionId).catch(() => '') === 'object') return { sessionId, url: t.url }
        await sleep(100)
      }
    }
    await sleep(200)
  }
  throw new Error('the extension worker never appeared')
}

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

//  Lattice on the reader ship reads a published page: {status, body}
async function readerFetch(url) {
  const r = await fetch(`${READER}/apps/lattice/fetch?url=${encodeURIComponent(url)}`, {
    headers: { cookie: `${cookie[5]}=${cookie[6]}` }, signal: AbortSignal.timeout(90000),
  }).catch((e) => ({ status: 0, text: async () => e.message }))
  const text = await r.text()
  try { return { status: r.status, body: JSON.parse(text).body } } catch { return { status: r.status, body: text } }
}

//  ── the run ──────────────────────────────────────────────────────────

try {
  const { sessionId: w, url } = await workerSession()
  const BASE = `chrome-extension://${new URL(url).host}/`
  const handle = (msg) => evaluate(`nisfeb.handle(${JSON.stringify(msg)})`, w)
  const names = await Promise.all(Array.from({ length: 256 }, (_, g) => shipName(wasm, BigInt(g))))
  const parent = BigInt(names.indexOf(process.env.PARENT || '~rup'))
  const moon = await shipName(wasm, ((BigInt(Math.floor(Date.now() / 1000) % 0xffffffff) + 1n) << 32n) | parent)
  await evaluate(`chrome.storage.local.set(${JSON.stringify({ urbFake: true, urbRelay: `ws://127.0.0.1:${port}/` })})`, w)
  const added = await handle({ kind: 'urbMoonAdd', keyfile: await fakeKeyfile(wasm, moon), passphrase: 'a long passphrase' })
  check(`a fake moon, ${moon}`, added.ok, JSON.stringify(added))

  //  publish from the page's form
  const t0 = Date.now()
  const { targetId } = await cdp('Target.createTarget', { url: BASE + 'publish.html' })
  const { sessionId: p } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  const opened = await textOf(p, [`Publishing as ${moon}`], 120000)
  check('publish.html opens as the moon', opened.includes(`Publishing as ${moon}`) && opened.includes('Nothing yet'), opened.slice(0, 300))
  const body = `# From headless Brave\n\nPublished at ${new Date().toISOString()} from publish.html.\n`
  await evaluate(`document.getElementById('name').value = 'notes/hello'; document.getElementById('body').value = ${JSON.stringify(body)}; document.getElementById('put').requestSubmit()`, p)
  const listed = await textOf(p, [`urb://${moon}/notes/hello`, 'revision 1'], 60000)
  check('the page is listed with its address', listed.includes(`urb://${moon}/notes/hello`) && listed.includes('revision 1'), listed.slice(0, 400))
  console.log(`     ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const bad = await handle({ kind: 'urbPub', op: 'put', name: 'n/x', body: 'no' })
  check('a one-letter first part is refused', !bad.ok && /two characters/.test(bad.error), JSON.stringify(bad))

  //  leave the browser alone: no page, no devtools session on the worker
  const mark = String(Math.random())
  await evaluate(`self.__pubCheck = ${JSON.stringify(mark)}`, w)
  await cdp('Target.closeTarget', { targetId })
  await cdp('Target.detachFromTarget', { sessionId: w })
  console.log(`     idle for ${IDLE} s`)
  await sleep(IDLE * 1000)

  const t1 = Date.now()
  const got = await readerFetch(`urb://${moon}/notes/hello`)
  check(`after ${IDLE} s idle, Lattice on ${READER} reads the page`, got.status === 200 && got.body === body, JSON.stringify(got).slice(0, 300))
  console.log(`     ${((Date.now() - t1) / 1000).toFixed(1)} s`)
  const { sessionId: w2 } = await workerSession()
  const same = await evaluate('self.__pubCheck', w2).catch(() => undefined)
  check('the worker stayed awake: the same one', same === mark, `found ${same}`)

  //  take it down from the worker; a reader with no list cached sees it gone
  const down = await evaluate(`nisfeb.handle(${JSON.stringify({ kind: 'urbPub', op: 'remove', name: 'notes/hello' })})`, w2)
  check('take down', down.ok && down.pages.length === 0, JSON.stringify(down).slice(0, 300))
} catch (e) {
  check('the run finished', false, e.stack || e.message)
} finally {
  await sleep(1000)   //  the last acks go out before the engine's relay goes
  browser.kill()
  relay.kill()
  await new Promise((r) => browser.once('exit', r))
  for (const d of [stage, profile, relayState]) rmSync(d, { recursive: true, force: true })
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
