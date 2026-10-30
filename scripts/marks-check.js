//  The reader page showing each kind of page Lattice 74 and later publish,
//  by its mark, in a throwaway headless Brave, as a fake moon on a fake
//  network.
//
//  Starts `urb-fetch -relay -relay-fake`, stages the extension, adds a fake
//  moon named from the clock (the host remembers every moon it met, and
//  this profile is thrown away) with the engine's test-only urbFake. Then
//  it reads each page of PAGES in reader.html and checks it is shown as
//  its mark says: html in the sandboxed frame, md and gmi as nodes, text
//  in one <pre>. Last it hands the reader a hostile Markdown page and
//  checks nothing of it runs.
//
//    URB_FETCH=/path/to/urb-fetch node scripts/marks-check.js
//
//  HOST (default ~hus) is a fake ship running Lattice 74 or later, with
//  pages published at marks/<mark>: on hoon-development's fleet, the set
//  furum with lattice on ~hus. PAGES (default md,html,text,gmi,css) names
//  them. BROWSER names the binary.

import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fakeKeyfile, shipName } from '../lib/mesa.mjs'
import { readerPath } from '../lib/gemtext.js'

const { URB_FETCH } = process.env
const HOST = process.env.HOST || '~hus'
const PAGES = (process.env.PAGES || 'md,html,text,gmi,css').split(',')
if (!URB_FETCH) throw new Error('URB_FETCH (the urb-fetch binary, for its -relay) is required')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const wasm = readFileSync(join(root, 'lib', 'mesa.wasm'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

//  ── the relay, the stage, the browser (as scripts/pub-check.js) ─────────

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
const errors = []
const dialogs = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
  if (msg.method === 'Page.javascriptDialogOpening') dialogs.push(msg.params.message)
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
async function page(url) {
  const { targetId } = await cdp('Target.createTarget', { url })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  await cdp('Runtime.enable', {}, sessionId)
  await cdp('Page.enable', {}, sessionId)
  return { targetId, sessionId }
}

//  What the reader page shows: the status, whether the frame or the page
//  is shown, and the page's elements by name, with its text.
const PROBE = `JSON.stringify({
  status: document.getElementById('status').textContent,
  frame: !document.getElementById('frame').hidden,
  page: !document.getElementById('page').hidden,
  kids: [...document.getElementById('page').children].map((e) => e.localName),
  names: [...new Set([...document.getElementById('page').querySelectorAll('*')].map((e) => e.localName))],
  hrefs: [...document.getElementById('page').querySelectorAll('a')].map((a) => a.getAttribute('href')),
  pre: [...document.getElementById('page').querySelectorAll('pre')].map((e) => e.textContent),
  text: document.getElementById('page').textContent,
  scripts: document.scripts.length,
})`
const MD_NAMES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'code', 'strong', 'em', 'a'])
const WANT = { md: 'md', html: 'html', text: 'text', css: 'text', js: 'text', gmi: null }   //  gmi: gmi, or html sniffed

//  ── the run ──────────────────────────────────────────────────────────

try {
  const { sessionId: w, url } = await workerSession()
  const BASE = `chrome-extension://${new URL(url).host}/`
  const handle = (msg) => evaluate(`nisfeb.handle(${JSON.stringify(msg)})`, w)
  const names = await Promise.all(Array.from({ length: 256 }, (_, g) => shipName(wasm, BigInt(g))))
  const parent = BigInt(names.indexOf(HOST))
  const moon = await shipName(wasm, ((BigInt(Math.floor(Date.now() / 1000) % 0xffffffff) + 1n) << 32n) | parent)
  await evaluate(`chrome.storage.local.set(${JSON.stringify({ urbReader: 'browser', urbFake: true, urbRelay: `ws://127.0.0.1:${port}/` })})`, w)
  const added = await handle({ kind: 'urbMoonAdd', keyfile: await fakeKeyfile(wasm, moon), passphrase: 'a long passphrase' })
  check(`a fake moon, ${moon}`, added.ok, JSON.stringify(added))

  for (const mark of PAGES) {
    const addr = `urb://${HOST}/marks/${mark}`
    const t0 = Date.now()
    const { sessionId: p, targetId } = await page(BASE + readerPath(addr))
    let shown = null
    for (const end = Date.now() + 180000; Date.now() < end;) {
      shown = JSON.parse(await evaluate(PROBE, p).catch(() => 'null'))
      if (shown && /Read as|did not answer|not published/.test(shown.status)) break
      await sleep(500)
    }
    const r = await handle({ kind: 'urbRead', url: addr })
    check(`${addr}: read, %${r.mark}, renders as ${r.render}`, r.ok && r.mark === mark && (WANT[mark] ? r.render === WANT[mark] : ['gmi', 'html'].includes(r.render)), JSON.stringify({ ...r, body: r.body?.slice(0, 80) }))
    if (!r.ok || !shown) continue
    check(`${addr}: the status names %${mark}`, shown.status.includes(`%${mark}`), shown.status)
    const how = r.render
    if (how === 'html') {
      check(`${addr}: in the sandboxed frame, not the page`, shown.frame && !shown.page && shown.kids.length === 0, JSON.stringify(shown))
    } else {
      check(`${addr}: on the page, the frame hidden`, !shown.frame && shown.page, JSON.stringify(shown))
    }
    if (how === 'text') {
      check(`${addr}: one <pre> holding the body as is`, shown.kids.join() === 'pre' && shown.pre[0] === r.body, JSON.stringify(shown).slice(0, 400))
    }
    if (how === 'md') {
      const stray = shown.names.filter((n) => !MD_NAMES.has(n))
      check(`${addr}: Markdown's elements only (${shown.names.join(' ')})`, stray.length === 0 && shown.kids.length > 0, JSON.stringify(shown).slice(0, 400))
      const raw = (/<[a-z][^>]*>[^<]*<\/[a-z]+>/.exec(r.body) || [])[0]
      if (raw) check(`${addr}: raw HTML in it is text: ${raw}`, shown.text.includes(raw), shown.text)
    }
    if (how === 'gmi') {
      check(`${addr}: gemtext as nodes`, shown.kids.length > 0 && shown.names.every((n) => ['h1', 'h2', 'h3', 'p', 'ul', 'li', 'blockquote', 'pre', 'a'].includes(n)), JSON.stringify(shown).slice(0, 400))
    }
    check(`${addr}: the reader page's own script only`, shown.scripts === 1, String(shown.scripts))
    console.log(`     ${((Date.now() - t0) / 1000).toFixed(1)} s, by ${r.how}`)
    await cdp('Target.closeTarget', { targetId })
  }

  //  a hostile Markdown page, handed to the reader as a read would
  const hostile = [
    '# <img src=x onerror="alert(\'img\')">',
    '<script>alert("script")</script>',
    '',
    '[js](javascript:alert("js")) [JS](JaVaScRiPt:alert(1)) [data](data:text/html,<script>alert(1)</script>) [off](//evil.example) [ok](https://example.com) [mail](mailto:a@b.c)',
    '',
    '>'.repeat(3000) + ' deep',
    '['.repeat(3000) + 'x' + ']'.repeat(3000) + '(javascript:alert(1))',
    '```',
    '</pre><svg onload=alert("svg")>',
    '```',
  ].join('\n')
  const { sessionId: h } = await page(BASE + 'reader.html')
  for (let i = 0; i < 40 && await evaluate('typeof reader', h).catch(() => '') !== 'object'; i++) await sleep(250)
  await evaluate(`reader.show('md', ${JSON.stringify(hostile)})`, h)
  await sleep(1000)
  const got = JSON.parse(await evaluate(PROBE, h))
  check('hostile md: Markdown\'s elements only', got.names.every((n) => MD_NAMES.has(n)), got.names.join(' '))
  check('hostile md: no script, svg, img or iframe made', got.scripts === 1 && !got.names.some((n) => ['script', 'svg', 'img', 'iframe'].includes(n)), JSON.stringify(got.names))
  check('hostile md: links only to safe places', got.hrefs.join(' ') === 'https://example.com mailto:a@b.c', JSON.stringify(got.hrefs))
  check('hostile md: the raw HTML shows as text', got.text.includes('<script>alert("script")</script>') && got.pre[0] === '</pre><svg onload=alert("svg")>', got.text.slice(0, 300))
  check('hostile md: no dialog opened', dialogs.length === 0, dialogs.join('\n'))
  check('no uncaught errors', errors.length === 0, errors.join('\n'))
} finally {
  ws.close()
  browser.kill()
  relay.kill()
  await sleep(500)
  rmSync(stage, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
  rmSync(relayState, { recursive: true, force: true })
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
