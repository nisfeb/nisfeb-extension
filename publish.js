//  Pages published from this browser, as the moon (or the comet) the
//  in-browser reader runs as: lib/urb.js serves them from the worker's
//  engine to Lattice on other ships. Nodes are built and text set. A
//  page's address is shown as text, to copy into Lattice on a ship.

const $ = (id) => document.getElementById(id)

function say(text, bad = false) {
  $('status').textContent = text
  $('status').classList.toggle('bad', bad)
}

function show(r) {
  if (r.locked) {
    $('unlock').hidden = false
    $('pass').focus()
    return say(`This browser publishes as ${r.ship}. Type its passphrase to unlock it.`)
  }
  if (!r.ok) return say(r.error, true)
  say(`Publishing as ${r.as}.`)
  $('none').hidden = r.pages.length > 0
  $('pages').replaceChildren(...r.pages.map((p) => {
    const addr = `urb://${r.as}/${p.name === 'index' ? '' : p.name}`
    const li = document.createElement('li')
    const a = Object.assign(document.createElement('code'), { textContent: addr })
    const meta = Object.assign(document.createElement('div'), {
      className: 'meta',
      textContent: `${p.mark === 'html' ? 'HTML' : 'gemtext'}, revision ${p.rev}, ${new Date(p.at).toLocaleString()}, ${p.body.length} characters`,
    })
    const edit = Object.assign(document.createElement('button'), { textContent: 'Edit' })
    edit.addEventListener('click', () => {
      $('name').value = p.name
      $('body').value = p.body
      $('format').value = p.mark
      $('body').focus()
    })
    const down = Object.assign(document.createElement('button'), { textContent: 'Take down' })
    down.addEventListener('click', () => call({ op: 'remove', name: p.name }, `Taking down ${p.name}`))
    li.append(a, meta, edit, ' ', down)
    return li
  }))
}

async function call(m, doing) {
  say(doing)
  let r
  try { r = await chrome.runtime.sendMessage({ kind: 'urbPub', ...m }) } catch (e) { r = { ok: false, error: e.message } }
  show(r)
  return r
}

$('put').addEventListener('submit', async (e) => {
  e.preventDefault()
  const r = await call({ op: 'put', name: $('name').value, body: $('body').value, mark: $('format').value }, 'Publishing')
  if (r.ok) {
    $('name').value = ''
    $('body').value = ''
  }
})

$('unlock').addEventListener('submit', async (e) => {
  e.preventDefault()
  const r = await chrome.runtime.sendMessage({ kind: 'urbMoonUnlock', passphrase: $('pass').value })
  $('pass').value = ''
  if (!r.ok) return say(r.error, true)
  $('unlock').hidden = true
  call({ op: 'list' }, 'Opening')
})

call({ op: 'list' }, 'Opening: the first time can take a minute')
