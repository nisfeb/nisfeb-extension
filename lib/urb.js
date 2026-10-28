//  Reading urb:// pages here in the browser, with no ship: libmesa's
//  engine, compiled to wasm (lib/mesa.mjs, lib/mesa.wasm), runs in the
//  worker as this browser's own comet. A browser can't send UDP, so the
//  engine's datagrams go over a WebSocket to a relay (`urb-fetch -relay`,
//  github.com/nisfeb/urb-fetch), which sends them on. The comet's key and
//  the engine's state live in IndexedDB, in this browser profile.
//
//  One engine per worker: an identity must never run in two places.

import { open, relayTransport, readRows, writeRows, looksHtml } from './mesa.mjs'

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

function database() {
  const r = indexedDB.open('urb', 1)
  r.onupgradeneeded = () => {
    r.result.createObjectStore('rows')   //  the engine's rows, by their binary key
    r.result.createObjectStore('meta')   //  'keyfile': the comet
  }
  return req(r)
}

//  mesa.mjs's store over IndexedDB. A commit resolves once its rows are
//  written, and mesa.mjs holds the commit's datagrams until then.
function idbStore(db) {
  return {
    async load() {
      const tx = db.transaction(['rows', 'meta'])
      const rows = tx.objectStore('rows')
      const [keys, vals, keyfile] = await Promise.all([
        req(rows.getAllKeys()), req(rows.getAll()), req(tx.objectStore('meta').get('keyfile')),
      ])
      return { keyfile: keyfile || null, rows: writeRows(keys.map((k, i) => ({ key: new Uint8Array(k), val: vals[i] }))) }
    },
    async saveKey(keyfile) {
      const tx = db.transaction(['rows', 'meta'], 'readwrite')
      tx.objectStore('rows').clear()
      tx.objectStore('meta').put(keyfile, 'keyfile')
      await done(tx)
    },
    async commit(batch) {
      const tx = db.transaction('rows', 'readwrite')
      const rows = tx.objectStore('rows')
      for (const { key, val } of readRows(batch)) {
        if (val) rows.put(val, key)
        else rows.delete(key)
      }
      await done(tx)
    },
  }
}

let engine = null   //  {relay, ready}

//  The engine, opened on first use and again after the relay changes or
//  an open fails.
function engineFor(relay) {
  if (engine && engine.relay === relay) return engine.ready
  const old = engine
  const ready = (async () => {
    if (old) await old.ready.then((u) => u.close(), () => {})
    const [wasm, db] = await Promise.all([
      fetch(chrome.runtime.getURL('lib/mesa.wasm')).then((r) => r.arrayBuffer()),
      database(),
    ])
    return open({ wasm, transport: relayTransport(relay), store: idbStore(db) })
  })()
  engine = { relay, ready }
  ready.catch(() => { if (engine && engine.ready === ready) engine = null })
  return ready
}

//  One try at the page at an urb:// address: {ok, key, body, html, how,
//  as}, or {ok: false, error, later}, where later means the ship may still
//  answer and the reader should try again.
export async function readUrb(url, relay) {
  try {
    const urb = await engineFor(relay)
    const got = await urb.read(url)
    return { ok: true, ...got, html: looksHtml(got.body), as: urb.our }
  } catch (e) {
    return { ok: false, error: e.message || String(e), later: Boolean(e.later) }
  }
}
