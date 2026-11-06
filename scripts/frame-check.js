//  The reader page's frame against a hostile published page, headless. No
//  ship, no relay: the reader page is opened with no address, and its
//  harness hook (globalThis.reader.showHtml) is given the page. A local
//  HTTP server stands for every outside host and records what reaches it.
//
//    npm run frame        (BROWSER names the binary, default: brave)
//
//  It checks that the page's script runs but loads nothing from outside,
//  that its script cannot move the frame or the tab to another host, that
//  a real click on a link still opens it, and that "Load outside content"
//  loads the page again with what it asked for.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let hits = []
const server = http.createServer((q, r) => { hits.push(q.url.split('?')[0]); r.setHeader('access-control-allow-origin', '*'); r.end('x') })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const OUT = `http://127.0.0.1:${server.address().port}`

const profile = mkdtempSync(join(tmpdir(), 'nisfeb-frame-'))
const browser = spawn(process.env.BROWSER || 'brave', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  `--load-extension=${root}`, `--disable-extensions-except=${root}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''
  browser.stderr.on('data', (d) => {
    buf += d
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
    if (m) resolve(m[1])
  })
  browser.on('exit', (c) => reject(new Error(`browser exited ${c}\n${buf}`)))
  setTimeout(() => reject(new Error(`no devtools endpoint in 15 s\n${buf}`)), 15000)
})

const ws = new WebSocket(wsUrl)
await new Promise((r) => { ws.onopen = r })
let next = 0
const waiting = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id) }
}
async function cdp(method, params = {}, sessionId) {
  const id = ++next
  const d = await new Promise((r) => { waiting.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })) })
  if (d.error) throw new Error(`${method}: ${d.error.message}`)
  return d.result
}

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${detail}`}`)
  if (!ok) failed++
}

try {
  let sw
  for (let i = 0; i < 40 && !sw; i++) {
    sw = (await cdp('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker')
    if (!sw) await sleep(250)
  }
  const base = `chrome-extension://${new URL(sw.url).host}/`

  //  A fresh reader tab with page as its frame's HTML; resolves to the tab's
  //  session once the frame says it is shown, or after 5 s.
  async function reader(page) {
    const { targetId } = await cdp('Target.createTarget', { url: `${base}reader.html` })
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
    for (let i = 0; i < 40; i++) {
      const r = await cdp('Runtime.evaluate', { expression: 'typeof reader', returnByValue: true }, sessionId)
      if (r.result.value === 'object') break
      await sleep(100)
    }
    const html = page.replaceAll('OUT', OUT)
    const r = await cdp('Runtime.evaluate', {
      expression: `globalThis.said = []; addEventListener('message', (e) => said.push(e.data));
        Promise.race([reader.showHtml(${JSON.stringify(html)}).then(() => 'shown'), new Promise((r) => setTimeout(() => r('no answer'), 5000))])`,
      awaitPromise: true, returnByValue: true,
    }, sessionId)
    return { sessionId, shown: r.result.value }
  }
  const evaluate = async (s, expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s)).result.value

  //  1. Outside loads of every kind, and a script that says it ran.
  hits = []
  const loads = `<!doctype html><p>hostile</p><img src="OUT/img"><link rel=stylesheet href="OUT/css">
    <style>@import "OUT/import"; body { background: url(OUT/bg) }</style>
    <script>fetch("OUT/fetch").catch(() => {}); try { new WebSocket("OUT/ws".replace("http", "ws")) } catch {}
    parent.postMessage({ ran: document.compatMode }, "*")</script>`
  const a = await reader(loads)
  await sleep(1500)
  check('the frame shows the page', a.shown === 'shown', a.shown)
  const said = await evaluate(a.sessionId, 'said')
  check('its script runs, in standards mode', said.some((d) => d && d.ran === 'CSS1Compat'), JSON.stringify(said))
  check('it loads nothing from outside', hits.length === 0, hits.join(' '))
  check('the reader offers to load outside content', await evaluate(a.sessionId, '!document.getElementById("outside").hidden'))

  //  2. The owner asks for outside content: the page loads again, with it.
  hits = []
  await evaluate(a.sessionId, 'document.getElementById("outside").click()')
  await sleep(2500)
  check('"Load outside content" loads what the page asked for', ['/img', '/css', '/fetch'].every((h) => hits.includes(h)), hits.join(' '))
  check('and hides itself', await evaluate(a.sessionId, 'document.getElementById("outside").hidden'))

  //  3. The page's script, with no click, asks the reader to open a web
  //  address, then moves its own frame.
  hits = []
  const b = await reader(`<!doctype html><script>
    setTimeout(() => parent.postMessage({ open: "OUT/open" }, "*"), 200)
    setTimeout(() => { location.href = "OUT/nav" }, 600)</script>`)
  await sleep(2000)
  check('a script cannot open a web address in the tab', !hits.includes('/open'), hits.join(' '))
  check('a script cannot move the frame to another host', !hits.includes('/nav'), hits.join(' '))
  check('the tab is still the reader', String(await evaluate(b.sessionId, 'location.href')).startsWith(`${base}reader.html`))

  //  4. A real click on a link in the page still opens it.
  hits = []
  const c = await reader(`<!doctype html><style>body { margin: 0 }</style>
    <a href="OUT/clicked" style="display: block; width: 200px; height: 100px">a link</a>`)
  const at = await evaluate(c.sessionId, 'JSON.stringify(document.getElementById("frame").getBoundingClientRect())')
  const { x, y } = JSON.parse(at)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp('Input.dispatchMouseEvent', { type, x: x + 20, y: y + 20, button: 'left', clickCount: 1 }, c.sessionId)
  }
  await sleep(2000)
  check('a click on a link opens it', hits.includes('/clicked'), hits.join(' '))
} finally {
  browser.kill()
  server.close()
  await new Promise((r) => browser.once('exit', r))
  rmSync(profile, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
