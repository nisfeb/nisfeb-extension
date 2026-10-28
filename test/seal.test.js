//  The moon's key under a passphrase (lib/seal.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seal, unseal } from '../lib/seal.js'

const KEY = '0w1.abcde.fghij'   //  stands in for a keyfile's text

test('seal: the right passphrase opens it', async () => {
  const s = await seal(KEY, 'correct horse')
  assert.equal(await unseal(s, 'correct horse'), KEY)
})

test('seal: a wrong passphrase, or a changed byte, gives null', async () => {
  const s = await seal(KEY, 'correct horse')
  assert.equal(await unseal(s, 'correct hose'), null)
  const data = atob(s.data)
  const flipped = btoa(String.fromCharCode(data.charCodeAt(0) ^ 1) + data.slice(1))
  assert.equal(await unseal({ ...s, data: flipped }, 'correct horse'), null)
})

test('seal: the key never appears in the sealed form, and each seal differs', async () => {
  const a = await seal(KEY, 'pass')
  const b = await seal(KEY, 'pass')
  assert.ok(!JSON.stringify(a).includes(KEY))
  assert.notEqual(a.data, b.data)
  assert.notEqual(a.salt, b.salt)
  assert.equal(a.rounds, 600000)
})
