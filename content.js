//  On ordinary web pages: urb:// addresses and furum's f/~host/board
//  shorthand in the text become links (lib/links.js finds them), and an
//  urb:// link, found or already on the page, gets a second one beside it
//  to the same address in Lattice on your ship.
//
//  Registered from Options, only when you turn it on. Safe by
//  construction: nodes are built and text set, never HTML from the page;
//  links, form controls, editable regions and code are left alone; the
//  ship's own pages are skipped, since its apps link these themselves.

(async () => {
  let origin = ''
  try { origin = (await chrome.runtime.sendMessage({ kind: 'linkOrigin' })).origin || '' } catch { /* no ship: urb:// only */ }
  if ((origin && location.origin === origin) || !document.body) return

  const SKIP = 'a, code, pre, kbd, samp, script, style, noscript, textarea, input, select, option, button, svg, math, [contenteditable]'
  const HINT = /urb:\/\/|f\/~/

  //  A link to the ship opens a tab; an urb:// one goes to its handler.
  const link = (href, text) => {
    const a = document.createElement('a')
    a.href = href
    a.textContent = text
    a.dataset.nisfeb = ''
    if (!href.startsWith('urb:')) { a.target = '_blank'; a.rel = 'noopener noreferrer' }
    return a
  }
  //  The same urb:// address in Lattice's reader on your ship.
  const onShip = (web) => {
    const a = link(web, '↗')
    a.title = 'Open in Lattice on your ship'
    a.setAttribute('aria-label', a.title)
    a.style.marginLeft = '.2em'
    return a
  }

  function text(node) {
    const p = node.parentElement
    if (!p || p.closest(SKIP) || p.isContentEditable) return
    const found = urbitLinks(node.data, origin)
    if (!found.length) return
    const frag = document.createDocumentFragment()
    let at = 0
    for (const f of found) {
      frag.append(node.data.slice(at, f.start), link(f.href, f.text))
      if (f.web) frag.append(onShip(f.web))
      at = f.end
    }
    frag.append(node.data.slice(at))
    node.replaceWith(frag)
  }

  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) { if (HINT.test(root.data)) text(root); return }
    if (root.nodeType !== Node.ELEMENT_NODE) return
    if (origin) {
      const urbs = [...root.querySelectorAll('a[href^="urb:" i]')]
      if (root.matches('a[href^="urb:" i]')) urbs.push(root)
      for (const a of urbs) {
        if ('nisfeb' in a.dataset) continue
        a.dataset.nisfeb = ''
        const [f] = urbitLinks(a.getAttribute('href'), origin)
        if (f && f.web) a.after(onShip(f.web))
      }
    }
    //  Collected first: replacing a node under the walker loses its place.
    const hits = []
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (HINT.test(n.data)) hits.push(n)
    hits.forEach(text)
  }

  scan(document.body)

  //  Pages that grow: what was added or changed is scanned at most twice a
  //  second, and the records our own edits make are dropped.
  //  ponytail: no cap on one batch; a page adding nodes faster than this
  //  scans them would want a budget per flush.
  const queue = new Set()
  let timer = 0
  const watch = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') queue.add(r.target)
      else for (const n of r.addedNodes) queue.add(n)
    }
    if (!timer) timer = setTimeout(flush, 500)
  })
  function flush() {
    timer = 0
    const nodes = [...queue]
    queue.clear()
    for (const n of nodes) if (n.isConnected) scan(n)
    watch.takeRecords()
  }
  watch.observe(document.body, { childList: true, subtree: true, characterData: true })
})()
