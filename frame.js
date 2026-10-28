//  frame.html shows a published page's HTML for the reader page. It is a
//  sandboxed page (the manifest's "sandbox"), so its origin is opaque: the
//  publisher's scripts run, but cannot reach the extension, its storage or
//  its worker. A link clicked here goes up to the reader page, which opens
//  an urb:// address in itself and a web address in the tab.

addEventListener('message', (e) => {
  if (e.source !== parent || typeof (e.data && e.data.html) !== 'string') return
  document.open()
  document.write(e.data.html)
  document.close()
  parent.postMessage({ shown: true }, '*')
  document.addEventListener('click', (ev) => {
    const a = ev.target instanceof Element && ev.target.closest('a[href]')
    if (!a || ev.defaultPrevented) return
    const href = a.getAttribute('href')
    if (href.startsWith('#')) return
    ev.preventDefault()
    parent.postMessage({ open: href }, '*')
  })
})
