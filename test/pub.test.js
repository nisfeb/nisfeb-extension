//  Page names as lattice takes them (nisfeb/lattice nex/lattice/app.hoon,
//  +apply-pub: each part a knot, no one-letter first part), and ids as
//  (scot %uv id) writes them, which lattice parses back with slaw.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageKey } from '../lib/pub.mjs'
import { uv } from '../lib/mesa.mjs'

test('pageKey: lattice names', () => {
  assert.equal(pageKey('notes/intro'), '/notes/intro')
  assert.equal(pageKey(' /notes/intro/ '), '/notes/intro')
  assert.equal(pageKey('index'), '/index')
  assert.equal(pageKey('a.b~c_d-e/9'), '/a.b~c_d-e/9')
  assert.equal(pageKey('n/x'), null)          //  a one-letter first part is an urb:// mount
  assert.equal(pageKey('Notes'), null)
  assert.equal(pageKey('notes//intro'), null)
  assert.equal(pageKey('notes/in tro'), null)
  assert.equal(pageKey(''), null)
})

test('uv: as scot %uv writes it', () => {
  assert.equal(uv(0n), '0v0')
  assert.equal(uv(0xdeadbeefn), '0v3f.arfnf')   //  from vere's eval
  assert.equal(uv(31n), '0vv')
  assert.equal(uv(32n ** 5n), '0v1.00000')
})
