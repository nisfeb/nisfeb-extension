//  Before anything else on the day page loads. An extension page may run
//  no inline script, so this is its own file.

//  The last look, painted first, so a new tab does not flash Talon's
//  built-in colours. today.js writes it.
try {
  const v = JSON.parse(localStorage.dayLook || '{}')
  for (const k in v) document.documentElement.style.setProperty(k, v[k])
} catch { /* nothing kept: the built-in colours until today.js runs */ }

//  The keyboard, taken from the address bar. A new tab gives it to the
//  address bar, and a page cannot take it back (focus() does nothing while
//  the browser's own bar has it); the extension navigating its own tab
//  can, so a fresh tab loads the page once more, hidden until then, and
//  today.js focuses the bar. Only a fresh tab (one history entry): Back,
//  reloads and the page opened in a tab already in use are left alone.
if (history.length === 1 && !location.search.includes('focus') && globalThis.chrome && chrome.tabs) {
  document.documentElement.style.visibility = 'hidden'
  const show = () => { document.documentElement.style.visibility = '' }
  chrome.tabs.getCurrent((tab) => {
    if (!tab) return show()
    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('today.html?focus') }, () => { if (chrome.runtime.lastError) show() })
  })
}
