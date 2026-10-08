import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostOf, parseExclude, excluded, digestOf, windowFrom, MAX_WINDOW_MS } from '../lib/history.js'
import { searchUrl } from '../lib/today.js'

test('sites: http(s) only, without www', () => {
  assert.equal(hostOf('https://www.GitHub.com/nisfeb/talon?x=1'), 'github.com')
  assert.equal(hostOf('http://127.0.0.2:9000/a'), '127.0.0.2')
  assert.equal(hostOf('chrome://settings'), '')
  assert.equal(hostOf('chrome-extension://abc/today.html'), '')
  assert.equal(hostOf('not a url'), '')
})

test('the owner\'s list of sites never to send', () => {
  assert.deepEqual(parseExclude('bank.example.com\nhttps://www.health.example/x?y\n, nope!, \nmail.example'), ['bank.example.com', 'health.example', 'mail.example'])
  assert.ok(excluded('bank.example.com', ['example.com']), 'a site covers its subdomains')
  assert.ok(!excluded('notexample.com', ['example.com']))
})

test('the digest: sites by pages, their titles, nothing excluded, nothing outside the hour', () => {
  const from = Date.UTC(2026, 9, 8, 14)
  const to = from + 3600000
  const at = (m) => from + m * 60000
  const items = [
    { url: 'https://github.com/nisfeb/talon/pull/1', title: 'Fix DM thread reads', lastVisitTime: at(5) },
    { url: 'https://github.com/nisfeb/talon/pull/2', title: 'Release 1.8.8', lastVisitTime: at(10) },
    { url: 'https://www.github.com/nisfeb/talon/pull/2', title: 'Release 1.8.8', lastVisitTime: at(11) },
    { url: 'https://search.brave.com/search?q=lisbon+flights', title: 'lisbon flights - Brave Search', lastVisitTime: at(20) },
    { url: 'https://bank.example.com/accounts', title: 'Your accounts', lastVisitTime: at(30) },
    { url: 'https://urbit.example.com/apps/orrery/', title: 'Orrery', lastVisitTime: at(40) },
    { url: 'chrome://history', title: 'History', lastVisitTime: at(41) },
    { url: 'https://old.example/', title: 'Yesterday', lastVisitTime: from - 1000 },
  ]
  const d = digestOf(items, { from, to, exclude: ['example.com'], skip: ['urbit.example.com'], zone: 'UTC' })
  assert.equal(d.sites, 2)
  assert.match(d.text, /^What the owner looked at in their web browser between 14:00 and 15:00 on 2026-10-08 \(UTC\)/)
  assert.match(d.text, /\n- github\.com, 3 pages: "Fix DM thread reads"; "Release 1\.8\.8"\n- search\.brave\.com, 1 page: "lisbon flights - Brave Search"$/)
  for (const gone of ['Your accounts', 'Orrery', 'History', 'Yesterday']) assert.ok(!d.text.includes(gone), gone)
  assert.deepEqual(digestOf([], { from, to }), { text: '', sites: 0 })
  //  a long hour is cut to fit, never past 16 KB
  const many = Array.from({ length: 3000 }, (_, i) => ({ url: `https://s${i}.example.org/${i}`, title: 'x'.repeat(200) + i, lastVisitTime: at(1) }))
  const big = digestOf(many, { from, to })
  assert.ok(new TextEncoder().encode(big.text).length <= 16000 && big.sites <= 25 && big.sites > 1)
})

test('the window: from the last digest, an hour the first time, six hours at most', () => {
  const now = Date.UTC(2026, 9, 8, 15)
  assert.equal(windowFrom(0, now), now - 3600000)
  assert.equal(windowFrom(now - 1800000, now), now - 1800000)
  assert.equal(windowFrom(now - 2 * MAX_WINDOW_MS, now), now - MAX_WINDOW_MS)
  assert.equal(windowFrom(now + 5000, now), now - 3600000, 'a clock that went back')
})

test('the bar searches Brave Search', () => {
  assert.equal(searchUrl(' lisbon flights & hotels '), 'https://search.brave.com/search?q=lisbon%20flights%20%26%20hotels')
})
