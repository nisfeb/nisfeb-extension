//  The day page's last look, painted before anything else loads, so a new
//  tab does not flash Talon's built-in colours first. An extension page
//  may run no inline script, so this is its own file. today.js writes it.
try {
  const v = JSON.parse(localStorage.dayLook || '{}')
  for (const k in v) document.documentElement.style.setProperty(k, v[k])
} catch { /* nothing kept: the built-in colours until today.js runs */ }
