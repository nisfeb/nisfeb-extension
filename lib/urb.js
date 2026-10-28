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

import { open, relayTransport, readRows, writeRows, looksHtml, keyfileInfo } from './mesa.mjs'
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
//  browser's comet. {name, db, key}, or {locked: ship}.
async function identity() {
  const { urbMoon } = await chrome.storage.local.get('urbMoon')
  if (!urbMoon) return { name: 'comet', db: 'urb', key: null }
  const { urbMoonKey } = await chrome.storage.session.get('urbMoonKey')
  if (!urbMoonKey) return { locked: urbMoon.ship }
  return { name: urbMoon.ship, db: moonDb(urbMoon.ship), key: urbMoonKey }
}

let engine = null   //  {relay, name, ready}

//  The engine, opened on first use and again after the relay or the
//  identity changes, or an open fails.
function engineFor(relay, who) {
  if (engine && engine.relay === relay && engine.name === who.name) return engine.ready
  const old = engine
  const ready = (async () => {
    if (old) await old.ready.then((u) => u.close(), () => {})
    const [wasm, db] = await Promise.all([wasmBytes(), database(who.db)])
    try {
      const urb = await open({ wasm, transport: relayTransport(relay), store: idbStore(db, who.key) })
      return { ...urb, close: () => urb.close().finally(() => db.close()) }
    } catch (e) {
      db.close()
      throw e
    }
  })()
  engine = { relay, name: who.name, ready }
  ready.catch(() => { if (engine && engine.ready === ready) engine = null })
  return ready
}

async function closeEngine() {
  const e = engine
  engine = null
  if (e) await e.ready.then((u) => u.close(), () => {})
}

//  One try at the page at an urb:// address: {ok, key, body, html, how,
//  as}, or {ok: false, error, later, locked}: later means the ship may
//  still answer and the reader should try again, locked that the moon
//  waits for its passphrase.
export async function readUrb(url, relay) {
  try {
    const who = await identity()
    if (who.locked) return { ok: false, locked: true, ship: who.locked, error: `${who.locked} is locked` }
    const urb = await engineFor(relay, who)
    const got = await urb.read(url)
    return { ok: true, ...got, html: looksHtml(got.body), as: urb.our }
  } catch (e) {
    return { ok: false, error: e.message || String(e), later: Boolean(e.later) }
  }
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
