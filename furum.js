//  A furum board on another ship, read and written here in the browser, as
//  the moon (or the comet) the in-browser reader runs as: lib/urb.js in the
//  worker, lib/furum.mjs for furum's shapes. furum.html?b=~host/board lists
//  the board; &p=ID shows one post with its comments and votes. Nodes are
//  built and text set: a post's text is shown as text.

const $ = (id) => document.getElementById(id)
const q = new URLSearchParams(location.search)
const [host, board] = String(q.get('b') || '').split('/')
const postId = q.has('p') ? Number(q.get('p')) : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const here = (p) => `furum.html?b=${host}/${board}${p === undefined ? '' : `&p=${p}`}`
const when = (d) => new Date(d).toLocaleString()

function say(text, bad = false) {
  $('status').textContent = text
  $('status').classList.toggle('bad', bad)
}

const call = (m) => chrome.runtime.sendMessage({ kind: 'furum', host, board, ...m })

//  furum's notes since `since`, such as a refusal; shown above the board
function notesSince(r, since) {
  const fresh = ((r && r.notes) || []).filter((n) => n.at >= since)
  if (fresh.length) {
    $('notes').hidden = false
    $('notes').textContent = fresh.map((n) => `${n.from}: ${n.body}`).join('\n')
  }
  return fresh
}

//  Ask until the ship answers: one meeting this browser's identity can take
//  a minute or two. null when the moon is locked and the form is showing.
async function ask(m) {
  for (let i = 1; i <= 5; i++) {
    if (i > 1) say(`Still waiting for ${host} (try ${i} of 5).`)
    let r
    try { r = await call(m) } catch (e) { r = { ok: false, error: e.message } }
    if (r.locked) {
      $('unlock').hidden = false
      $('pass').focus()
      say(`This browser reads as ${r.ship}. Type its passphrase to unlock it.`)
      return null
    }
    if (r.ok || !r.later) return r
  }
  return { ok: false, error: `${host} did not answer. It may be offline, or not run furum.` }
}

//  After a write: poll `check` until it sees the change, or furum refuses.
async function settle(since, check) {
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const r = await call(check.m)
    const refused = notesSince(r, since)
    if (refused.length) return say(`Refused: ${refused[0].body}`, true)
    if (r.ok && check.done(r)) return check.then()
  }
  say('It did not show up on the board in a minute.', true)
}

async function showList() {
  $('list').hidden = false
  $('title').textContent = `${host}/${board}`
  say(`Reading ${host}/${board}`)
  const r = await ask({ op: 'posts' })
  if (!r) return
  if (!r.ok) return say(r.error, true)
  $('posts').replaceChildren(...r.posts.map((p) => {
    const li = document.createElement('li')
    li.value = p.id
    const a = Object.assign(document.createElement('a'), { href: here(p.id), textContent: p.title })
    const meta = Object.assign(document.createElement('div'), { className: 'meta', textContent: `by ${p.author}, ${when(p.created)}` })
    li.append(a, meta)
    if (p.url) li.append(Object.assign(document.createElement('div'), { className: 'meta', textContent: p.url }))
    return li
  }))
  say(`${r.posts.length} posts, read as ${r.as}.`)
}

async function showThread() {
  $('thread').hidden = false
  $('back').href = here()
  say(`Reading post ${postId} on ${host}/${board}`)
  const [r, t] = [await ask({ op: 'posts' }), await ask({ op: 'thread', id: postId })]
  if (!r || !t) return
  if (!r.ok || !t.ok) return say((r.ok ? t : r).error, true)
  const p = r.posts.find((x) => x.id === postId)
  if (!p) return say(`There is no post ${postId} on ${host}/${board}.`, true)
  document.title = p.title
  $('ttitle').textContent = p.title
  $('tmeta').textContent = `by ${p.author}, ${when(p.created)}`
  $('turl').replaceChildren()
  if (p.url && /^https?:\/\//.test(p.url)) {
    $('turl').append(Object.assign(document.createElement('a'), { href: p.url, textContent: p.url, rel: 'noopener noreferrer' }))
  } else if (p.url) {
    $('turl').textContent = p.url
  }
  $('tbody').textContent = p.body || ''
  $('tvotes').textContent = `${t.votes.up.length} up, ${t.votes.down.length} down`
  $('comments').replaceChildren(...t.comments.map((c) => {
    const li = document.createElement('li')
    li.append(
      Object.assign(document.createElement('div'), { className: 'text', textContent: c.body }),
      Object.assign(document.createElement('div'), { className: 'meta', textContent: `${c.author}, ${when(c.created)}${c.parent !== null ? `, on comment ${c.parent + 1}` : ''}` }),
    )
    return li
  }))
  say(`Read as ${t.as}.`)
}

$('postform').addEventListener('submit', async (e) => {
  e.preventDefault()
  const since = Date.now()
  const title = $('ptitle').value.trim()
  say('Posting')
  const r = await call({ op: 'post', title, url: $('purl').value.trim() || null, body: $('pbody').value.trim() || null })
  if (!r.ok) return say(r.error, true)
  say(`${host} took it in; waiting for it on the board.`)
  await settle(since, {
    m: { op: 'posts' },
    //  dates cross the message channel as strings
    done: (x) => x.posts.some((p) => p.title === title && p.author === r.as && new Date(p.created).getTime() >= since - 120000),
    then: () => { $('postform').reset(); $('new').open = false; return showList() },
  })
})

$('commentform').addEventListener('submit', async (e) => {
  e.preventDefault()
  const since = Date.now()
  const body = $('cbody').value.trim()
  say('Commenting')
  const r = await call({ op: 'comment', id: postId, body })
  if (!r.ok) return say(r.error, true)
  say(`${host} took it in; waiting for it on the board.`)
  await settle(since, {
    m: { op: 'thread', id: postId },
    done: (x) => x.comments.some((c) => c.body === body && c.author === r.as),
    then: () => { $('commentform').reset(); return showThread() },
  })
})

$('upvote').addEventListener('click', async () => {
  const since = Date.now()
  say('Voting')
  const r = await call({ op: 'upvote', id: postId })
  if (!r.ok) return say(r.error, true)
  await settle(since, { m: { op: 'thread', id: postId }, done: (x) => x.votes.up.includes(r.as), then: showThread })
})

$('unlock').addEventListener('submit', async (e) => {
  e.preventDefault()
  const r = await chrome.runtime.sendMessage({ kind: 'urbMoonUnlock', passphrase: $('pass').value })
  $('pass').value = ''
  if (!r.ok) return say(r.error, true)
  $('unlock').hidden = true
  load()
})

$('go').addEventListener('submit', (e) => {
  e.preventDefault()
  const m = /^(?:f\/)?(~[a-z]+(?:-[a-z]+)*)\/([a-z][a-z0-9-]*)$/.exec($('addr').value.trim())
  if (m) location.href = `furum.html?b=${m[1]}/${m[2]}`
  else say('A board, please, as ~host/name.', true)
})

function load() {
  $('addr').value = host && board ? `${host}/${board}` : ''
  if (!host || !board) return say('Type a board, as ~host/name.')
  return postId === null ? showList() : showThread()
}

load()
