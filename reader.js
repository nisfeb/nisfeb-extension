//  The reader page: one urb:// page, read here in the browser by the
//  worker's engine (lib/urb.js), and shown as its mark says. Gemtext and
//  Markdown are built as nodes with text set (lib/gemtext.js,
//  lib/markdown.js), and text (and js, css) goes in a <pre>. HTML goes to
//  frame.html, a sandboxed page with an opaque origin, where the
//  publisher's scripts run but reach nothing of the extension's.

import { gemtext, linkTarget, readerPath } from './lib/gemtext.js'
import { mdNodes, safeLink } from './lib/markdown.js'

//  A read gives up after a minute at most. A ship catching up on this
//  browser's comet can take a minute or two, so the page asks again.
const TRIES = 5

const $ = (id) => document.getElementById(id)
const url = new URLSearchParams(location.search).get('u') || ''

function say(text, bad = false) {
  $('status').textContent = text
  $('status').classList.toggle('bad', bad)
}

//  Where a link goes from this page: another urb:// page in this reader,
//  or a web page. null leaves it as text.
function hrefFor(target) {
  const t = linkTarget(url, target)
  return t.startsWith('urb://') ? readerPath(t) : t || null
}

//  Where a Markdown link goes: as hrefFor, and mail and gemini links as
//  written. lib/markdown.js has already dropped any other scheme.
function mdHref(target) {
  if (!safeLink(target)) return null
  return /^(mailto|gemini):/.test(target) ? target : hrefFor(target)
}

function titled(main) {
  const h = main.querySelector('h1')
  if (h) document.title = h.textContent
}

function showMarkdown(body) {
  const main = $('page')
  main.append(...mdNodes(document, body, mdHref))
  titled(main)
}

function showText(body) {
  $('page').append(Object.assign(document.createElement('pre'), { textContent: body }))
}

function showGemtext(body) {
  const main = $('page')
  for (const b of gemtext(body)) {
    let el
    if (b.kind === 'list') {
      el = document.createElement('ul')
      for (const item of b.items) el.append(Object.assign(document.createElement('li'), { textContent: item }))
    } else if (b.kind === 'link') {
      el = document.createElement('p')
      const href = hrefFor(b.href)
      if (href) {
        const a = Object.assign(document.createElement('a'), { href, textContent: b.label })
        if (!href.startsWith('reader.html')) a.rel = 'noopener noreferrer'
        el.append(a)
      } else {
        el.textContent = b.label === b.href ? b.href : `${b.label} (${b.href})`
      }
    } else {
      el = document.createElement(b.kind === 'quote' ? 'blockquote' : b.kind)
      el.textContent = b.text
    }
    main.append(el)
  }
  titled(main)
}

//  frame.html may load before this script runs, or after, so the HTML is
//  sent until the frame says it is shown. A later copy finds the frame's
//  listener gone (document.open erases it). Resolves once shown.
function showHtml(body) {
  const f = $('frame')
  $('page').hidden = true
  f.hidden = false
  return new Promise((resolve) => {
    const send = () => f.contentWindow.postMessage({ html: body }, '*')
    const again = setInterval(send, 300)
    addEventListener('message', function shown(e) {
      if (e.source !== f.contentWindow || !(e.data && e.data.shown)) return
      clearInterval(again)
      removeEventListener('message', shown)
      resolve()
    })
    send()
  })
}

//  A link clicked in the frame, handed up by frame.js.
addEventListener('message', (e) => {
  if (e.source !== $('frame').contentWindow || typeof (e.data && e.data.open) !== 'string') return
  const href = hrefFor(e.data.open)
  if (href) location.href = href
})

$('go').addEventListener('submit', (e) => {
  e.preventDefault()
  const addr = $('addr').value.trim()
  if (/^urb:\/\/~/.test(addr)) location.href = readerPath(addr)
  else say('An urb:// address, please, such as urb://~sampel-palnet/page.', true)
})

//  The moon reading here is locked: its passphrase opens it, then the
//  page is read.
$('unlock').addEventListener('submit', async (e) => {
  e.preventDefault()
  const r = await chrome.runtime.sendMessage({ kind: 'urbMoonUnlock', passphrase: $('pass').value })
  $('pass').value = ''
  if (!r.ok) return say(r.error, true)
  $('unlock').hidden = true
  load()
})

//  A page's body, shown as render says (lib/urb.js's readUrb).
function show(render, body) {
  if (render === 'html') return showHtml(body)
  if (render === 'md') return showMarkdown(body)
  if (render === 'text') return showText(body)
  return showGemtext(body)
}

async function load() {
  $('addr').value = url
  if (!url) return say('Type an urb:// address.')
  document.title = url
  const ship = (/^urb:\/\/(~[a-z-]+)/.exec(url) || [])[1] || url
  for (let i = 1; i <= TRIES; i++) {
    say(i === 1 ? `Reading ${url}` : `Still waiting for ${ship} (try ${i} of ${TRIES}). A ship can take a minute or two to answer after this browser's comet first meets it or moves.`)
    let r
    try {
      r = await chrome.runtime.sendMessage({ kind: 'urbRead', url })
    } catch (e) {
      r = { ok: false, error: e.message || String(e) }
    }
    if (r.ok) {
      say(`Read as ${r.as}, by ${r.how === 'keen' ? 'remote scry' : 'grubbery peek'}${r.mark ? `, %${r.mark}` : ''}.`)
      return show(r.render || (r.html ? 'html' : 'gmi'), r.body)
    }
    if (r.locked) {
      $('unlock').hidden = false
      $('pass').focus()
      return say(`This browser reads as ${r.ship}. Type its passphrase to unlock it.`)
    }
    if (!r.later) return say(r.error, true)
  }
  say(`${ship} did not answer. It may be offline, or not run Lattice.`, true)
}

load()

//  For a harness driving the page over the devtools protocol.
globalThis.reader = { showHtml, show }
