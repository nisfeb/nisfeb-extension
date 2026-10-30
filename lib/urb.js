//  Reading urb:// pages here in the browser, with no ship: libmesa's
//  engine, compiled to wasm (lib/mesa.mjs, lib/mesa.wasm), runs in the
//  worker as this browser's own comet, or as a moon added in Options. A
//  browser can't send UDP, so the engine's datagrams go over a WebSocket to
//  a relay (`urb-fetch -relay`, github.com/nisfeb/urb-fetch), which sends
//  them on. The engine's state lives in IndexedDB, a database per identity.
//
//  The comet's key is kept as is. A moon's key is sealed under a passphrase
//  (lib/seal.js) in storage.local, and once unlocked it is held in
//  storage.session: memory only, gone when the browser closes, and out of
//  content scripts' reach.
//
//  One engine per worker: an identity must never run in two places.
//
//  Pages published here (lib/pub.mjs) are served by that engine to Lattice
//  on other ships, at urb://<who reads here>/<name>, while it runs. They
//  and the keeps of readers following them live in the identity's database
//  (meta 'pub'). While there are pages, the engine opens when the worker
//  starts. Its own traffic over the relay (a ping to its galaxy every 25 s)
//  keeps the worker awake: a worker with no engine was stopped within 90 s
//  in headless Brave, and one serving answered after 150 s left alone.
//
//  storage.local `urbFake` (tests only, no Options control) runs the engine
//  on a fake network (urbit -F), through `urb-fetch -relay -relay-fake`.

import { open, relayTransport, readRows, writeRows, renderAs, keyfileInfo } from './mesa.mjs'
import { furum } from './furum.mjs'
import { publish } from './pub.mjs'
import { seal, unseal } from './seal.js'

export const DEFAULT_RELAY = 'ws://localhost:8476'

//  The sites the engine asks besides the relay: the roller for ships'
//  keys, and bootstrap for the stars a comet is mined under (once).
//  Options asks for them when this reader is chosen.
export const URB_ORIGINS = ['https://roller.urbit.org/*', 'https://bootstrap.urbit.org/*']

//  A relay address: ws:// or wss://, '' for anything else.
export function relayUrl(text) {
  try {
    const u = new URL(String(text).trim())
    return u.protocol === 'ws:' || u.protocol === 'wss:' ? u.href : ''
  } catch {
    return ''
  }
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = tx.onabort = () => reject(tx.error)
})

const wasmBytes = () => fetch(chrome.runtime.getURL('lib/mesa.wasm')).then((r) => r.arrayBuffer())
const moonDb = (ship) => `urb-${ship}`

function database(name) {
  const r = indexedDB.open(name, 1)
  r.onupgradeneeded = () => {
    r.result.createObjectStore('rows')   //  the engine's rows, by their binary key
    r.result.createObjectStore('meta')   //  'keyfile': the comet; 'fresh': a moon that never ran
  }
  return req(r)
}

//  mesa.mjs's store over IndexedDB. A commit resolves once its rows are
//  written, and mesa.mjs holds the commit's datagrams until then. A moon's
//  keyfile comes from the session; 'fresh' says it may start from empty
//  state, and goes with its first commit.
function idbStore(db, moonKey) {
  return {
    async load() {
      const tx = db.transaction(['rows', 'meta'])
      const rows = tx.objectStore('rows')
      const meta = tx.objectStore('meta')
      const [keys, vals, keyfile, fresh] = await Promise.all([
        req(rows.getAllKeys()), req(rows.getAll()), req(meta.get('keyfile')), req(meta.get('fresh')),
      ])
      return {
        keyfile: moonKey || keyfile || null,
        rows: writeRows(keys.map((k, i) => ({ key: new Uint8Array(k), val: vals[i] }))),
        fresh: Boolean(fresh),
      }
    },
    async saveKey(keyfile) {
      const tx = db.transaction(['rows', 'meta'], 'readwrite')
      tx.objectStore('rows').clear()
      tx.objectStore('meta').put(keyfile, 'keyfile')
      await done(tx)
    },
    async commit(batch) {
      const tx = db.transaction(['rows', 'meta'], 'readwrite')
      const rows = tx.objectStore('rows')
      for (const { key, val } of readRows(batch)) {
        if (val) rows.put(val, key)
        else rows.delete(key)
      }
      tx.objectStore('meta').delete('fresh')
      await done(tx)
    },
  }
}

//  Who reads: the moon added in Options once it is unlocked, else this
//  browser's comet. {name, db, key, fake}, or {locked: ship}.
async function identity() {
  const { urbMoon, urbFake } = await chrome.storage.local.get(['urbMoon', 'urbFake'])
  const fake = Boolean(urbFake)
  if (!urbMoon) return { name: 'comet', db: 'urb', key: null, fake }
  const { urbMoonKey } = await chrome.storage.session.get('urbMoonKey')
  if (!urbMoonKey) return { locked: urbMoon.ship }
  return { name: urbMoon.ship, db: moonDb(urbMoon.ship), key: urbMoonKey, fake }
}

let engine = null   //  {relay, name, fake, ready}

const serving = (pages) => Object.values(pages || {}).some((p) => p.body !== null)

async function readPub(db) {
  return (await req(db.transaction('meta').objectStore('meta').get('pub'))) || {}
}

//  What furum told us lately (a refusal, say), newest first: {from, title,
//  body, at}. In memory only, so notes that come while the worker sleeps
//  are lost.
const notes = []

//  The engine, opened on first use and again after the relay or the
//  identity changes, or an open fails.
function engineFor(relay, who) {
  if (engine && engine.relay === relay && engine.name === who.name && engine.fake === who.fake) return engine.ready
  const old = engine
  const ready = (async () => {
    if (old) await old.ready.then((u) => u.close(), () => {})
    const [wasm, db] = await Promise.all([wasmBytes(), database(who.db)])
    try {
      const urb = await open({ wasm, transport: relayTransport(relay), store: idbStore(db, who.key), fake: who.fake })
      furum(urb, null).onNote((n) => {
        notes.unshift({ ...n, at: Date.now() })
        notes.length = Math.min(notes.length, 10)
      })
      const pub = publish(urb, {
        ...(await readPub(db)),
        save(all) {
          try {
            const tx = db.transaction('meta', 'readwrite')
            tx.objectStore('meta').put(all, 'pub')
            done(tx).catch(() => {})
          } catch {}   //  the database closed under it: the engine is going
        },
      })
      return { ...urb, pub, close: () => urb.close().finally(() => db.close()) }
    } catch (e) {
      db.close()
      throw e
    }
  })()
  engine = { relay, name: who.name, fake: who.fake, ready }
  ready.catch(() => { if (engine && engine.ready === ready) engine = null })
  return ready
}

async function closeEngine() {
  const e = engine
  engine = null
  if (e) await e.ready.then((u) => u.close(), () => {})
}

//  fn(engine)'s answer, with {ok: true, as}; or {ok: false, error, later,
//  locked}: later means the ship may still answer and the caller should
//  try again, locked that the moon waits for its passphrase.
async function withEngine(relay, fn) {
  try {
    const who = await identity()
    if (who.locked) return { ok: false, locked: true, ship: who.locked, error: `${who.locked} is locked` }
    const urb = await engineFor(relay, who)
    return { ok: true, as: urb.our, ...(await fn(urb)) }
  } catch (e) {
    return { ok: false, error: e.message || String(e), later: Boolean(e.later) }
  }
}

//  One try at the page at an urb:// address: {ok, key, body, mark, render,
//  html, how, as}. mark is the one the page was published under (lattice
//  74 and later publish each format under its own), and render how the
//  reader shows it: 'html', 'md', 'gmi' or 'text' (mesa.mjs's renderAs).
//  A /k/ or /t/ read has no mark, and reads as %gmi. html is render ===
//  'html', as before.
export function readUrb(url, relay) {
  return withEngine(relay, async (urb) => {
    const got = await urb.read(url)
    const render = renderAs(got.mark ?? 'gmi', got.body)
    return { ...got, render, html: render === 'html' }
  })
}

//  A furum board on another ship (lib/furum.mjs), as whoever reads here.
//  op: 'posts', 'thread' (a post's comments and votes), 'post',
//  'comment' or 'upvote'. Every answer carries furum's recent notes.
export function furumCall(relay, { op, host, board, id, title, url, body }) {
  return withEngine(relay, async (urb) => {
    if (!/^~[a-z]+(-[a-z]+)*$/.test(String(host)) || !/^[a-z][a-z0-9-]*$/.test(String(board))) throw new Error('a board is ~host/name')
    const f = furum(urb, host)
    const n = Number(id)
    const out = op === 'posts' ? { posts: await f.posts(board) }
      : op === 'thread' ? { comments: await f.comments(board, n), votes: await f.votes(board, n) }
      : op === 'post' ? await f.newPost(board, { title: String(title || ''), url: url || null, body: body || null })
      : op === 'comment' ? await f.newComment(board, n, String(body || ''))
      : op === 'upvote' ? await f.upvote(board, n)
      : null
    if (!out) throw new Error(`no furum ${op}`)
    return { ...out, notes: notes.slice() }
  })
}

//  The pages published here, as whoever reads here: op 'list', 'put'
//  (name, body) or 'remove' (name). Every answer lists the pages:
//  [{name, body, rev, at}], newest first.
export function pubCall(relay, { op, name, body }) {
  return withEngine(relay, async (urb) => {
    if (!['list', 'put', 'remove'].includes(op)) throw new Error(`no publishing ${op}`)
    if (op === 'put' && !urb.pub.put(String(name || ''), String(body || ''))) {
      throw new Error('A name is one or more parts of a to z, 0 to 9 and ~ . _ -, split by /, and the first part has two characters or more.')
    }
    if (op === 'remove') urb.pub.remove(String(name || ''))
    const pages = Object.entries(urb.pub.pages()).filter(([, p]) => p.body !== null)
      .map(([key, p]) => ({ name: key.slice(1), body: p.body, rev: p.rev, at: p.at }))
      .sort((a, b) => b.at - a.at)
    return { pages }
  })
}

//  Serve what this identity published, if anything, from now on: when the
//  worker starts, and once a moon is unlocked.
export async function serveIfPublished(relay) {
  const who = await identity()
  if (who.locked) return
  const db = await database(who.db)
  let pub
  try { pub = await readPub(db) } finally { db.close() }
  if (serving(pub.pages)) await engineFor(relay, who).catch(() => {})
}

//  The moon in this browser: {ship, locked}, or {} when there is none.
export async function moonState() {
  const { urbMoon } = await chrome.storage.local.get('urbMoon')
  if (!urbMoon) return {}
  const { urbMoonKey } = await chrome.storage.session.get('urbMoonKey')
  return { ship: urbMoon.ship, locked: !urbMoonKey }
}

//  Add a moon from the key `|moon` printed, sealed under a passphrase. It
//  must never have run anywhere: here it starts from empty state, once.
export async function addMoon(keyfile, passphrase) {
  const text = String(keyfile || '').trim()
  if (String(passphrase || '').length < 8) return { ok: false, error: 'A passphrase of at least eight characters, please.' }
  const { urbMoon } = await chrome.storage.local.get('urbMoon')
  if (urbMoon) return { ok: false, error: `${urbMoon.ship} is already here. Remove it first.` }
  const info = await keyfileInfo(await wasmBytes(), text)
  if (!info) return { ok: false, error: 'That is not a key from |moon.' }
  if (info.rank !== 3) return { ok: false, error: `${info.ship} is not a moon, and only a moon may live in a browser.` }
  const db = await database(moonDb(info.ship))
  try {
    const tx = db.transaction(['rows', 'meta'], 'readwrite')
    const had = await req(tx.objectStore('rows').count())
    if (!had) tx.objectStore('meta').put(true, 'fresh')
    await done(tx)
    if (had) return { ok: false, error: `${info.ship} has state here already. Remove it, breach it on its parent, and add its new key.` }
  } finally {
    db.close()
  }
  await chrome.storage.local.set({ urbMoon: { ship: info.ship, sealed: await seal(text, String(passphrase)) } })
  await chrome.storage.session.set({ urbMoonKey: text })
  await closeEngine()
  return { ok: true, ship: info.ship }
}

export async function unlockMoon(passphrase) {
  const { urbMoon } = await chrome.storage.local.get('urbMoon')
  if (!urbMoon) return { ok: false, error: 'There is no moon here.' }
  const text = await unseal(urbMoon.sealed, String(passphrase || ''))
  if (text === null) return { ok: false, error: 'That passphrase does not open it.' }
  await chrome.storage.session.set({ urbMoonKey: text })
  return { ok: true, ship: urbMoon.ship }
}

//  Forget the unlocked key until the passphrase is typed again.
export async function lockMoon() {
  await chrome.storage.session.remove('urbMoonKey')
  if (engine && engine.name !== 'comet') await closeEngine()
  return { ok: true }
}

//  Remove the moon and its state. It may run elsewhere only after a breach.
export async function removeMoon() {
  const { urbMoon } = await chrome.storage.local.get('urbMoon')
  if (!urbMoon) return { ok: true }
  await closeEngine()
  await chrome.storage.session.remove('urbMoonKey')
  await chrome.storage.local.remove('urbMoon')
  await req(indexedDB.deleteDatabase(moonDb(urbMoon.ship)))
  return { ok: true, ship: urbMoon.ship }
}
