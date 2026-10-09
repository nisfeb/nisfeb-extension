import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hostOf, parseExclude, excluded, windowFrom, MAX_WINDOW_MS, EVERY_MIN, skipRules, skipped, visitsOf, pageOf, queued,
  batchesOf, QUEUE_PAGES, BATCH_PAGES, TEXT_CHARS, SKIP_HOSTS, paused, pausedTill, pauseUntil, tomorrow,
} from '../lib/history.js'
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

test('what never leaves: banking, medical, Claude artifacts, the ship, the owner\'s list', () => {
  const rules = skipRules(null, { ship: 'urbit.example.com', exclude: ['news.example'] })
  for (const u of ['https://www.chase.com/acct', 'https://secure.examplebank.com/', 'https://mychart.example.org/', 'https://claude.ai/artifact/x',
    'https://claude.ai/code/artifact/x', 'https://urbit.example.com/apps/orrery/', 'https://news.example/today', 'https://a.news.example/x',
    'http://localhost:8080/', 'chrome://history']) assert.ok(skipped(u, rules), u)
  for (const u of ['https://github.com/nisfeb/talon', 'https://claude.ai/chat/x', 'https://mail.example/inbox']) assert.ok(!skipped(u, rules), u)
  //  the ship's lists, when it gives them, are the ones that hold
  const shipped = skipRules({ skip_hosts: ['onlythis'], skip_paths: ['x.example/private'], exclude: ['shipside.example'] }, { exclude: [] })
  assert.ok(skipped('https://onlythis.example/', shipped) && skipped('https://x.example/private/1', shipped) && skipped('https://shipside.example/', shipped))
  assert.ok(!skipped('https://www.chase.com/', shipped))
  assert.ok(SKIP_HOSTS.includes('bank') && SKIP_HOSTS.includes('health'))
})

test('visits: each with how it came about, in the window, oldest first, the skipped left out', () => {
  const from = Date.UTC(2026, 9, 8, 14)
  const to = from + 15 * 60000
  const at = (m) => from + m * 60000
  const items = [
    { url: 'https://shop.example/thanks', title: 'Thank you for your order' },
    { url: 'https://github.com/nisfeb/talon/pull/2', title: 'Release 1.8.8' },
    { url: 'https://www.chase.com/acct', title: 'Accounts' },
  ]
  const byUrl = new Map([
    ['https://shop.example/thanks', [{ visitTime: at(9), transition: 'form_submit' }, { visitTime: from - 60000, transition: 'link' }]],
    ['https://github.com/nisfeb/talon/pull/2', [{ visitTime: at(2), transition: 'typed' }, { visitTime: at(5) }]],
    ['https://www.chase.com/acct', [{ visitTime: at(3), transition: 'typed' }]],
  ])
  const v = visitsOf(items, byUrl, { from, to, rules: skipRules(null) })
  assert.deepEqual(v.map((x) => [x.url.split('/')[2], x.how, x.at]), [
    ['github.com', 'typed', at(2)], ['github.com', 'link', at(5)], ['shop.example', 'form_submit', at(9)]])
})

test('pages: text folded and capped, one per address in the queue, the oldest dropped', () => {
  const p = pageOf({ url: 'https://a.example/', title: 't', text: 'a  \t b\n\n\n\nc', at: 1 })
  assert.equal(p.text, 'a b\n\nc')
  assert.equal(pageOf({ url: 'u', text: 'x'.repeat(TEXT_CHARS + 10), at: 1 }).text.length, TEXT_CHARS)
  let q = queued([], p)
  q = queued(q, { ...p, text: 'newer', at: 2 })
  assert.deepEqual(q.map((x) => x.text), ['newer'])
  for (let i = 0; i < QUEUE_PAGES + 5; i++) q = queued(q, { url: `https://p${i}.example/`, text: '', at: i })
  assert.equal(q.length, QUEUE_PAGES)
  assert.equal(q[0].url, 'https://p5.example/')
})

test('a send goes in pieces the ship takes', () => {
  const pages = Array.from({ length: BATCH_PAGES * 2 + 1 }, (_, i) => ({ url: `u${i}` }))
  const b = batchesOf([{ url: 'v' }], pages)
  assert.deepEqual(b.map((x) => [x.visits.length, x.pages.length]), [[1, BATCH_PAGES], [0, BATCH_PAGES], [0, 1]])
  assert.deepEqual(batchesOf([], []), [])
})

test('the window: from the last send, one interval the first time, six hours at most', () => {
  const now = Date.UTC(2026, 9, 8, 15)
  assert.equal(EVERY_MIN, 15)
  assert.equal(windowFrom(0, now), now - EVERY_MIN * 60000)
  assert.equal(windowFrom(now - 600000, now), now - 600000)
  assert.equal(windowFrom(now - 2 * MAX_WINDOW_MS, now), now - MAX_WINDOW_MS)
  assert.equal(windowFrom(now + 5000, now), now - EVERY_MIN * 60000, 'a clock that went back')
})

test('the bar searches Brave Search', () => {
  assert.equal(searchUrl(' lisbon flights & hotels '), 'https://search.brave.com/search?q=lisbon%20flights%20%26%20hotels')
})

test('a pause: nothing visited in it is sent, even after it ends', () => {
  const now = 10 * MAX_WINDOW_MS
  const hour = 3600000
  let spans = pauseUntil([], now, now + hour)
  assert.deepEqual(spans, [{ from: now, to: now + hour }])
  assert.ok(paused(spans, now + 1) && !paused(spans, now - 1) && !paused(spans, now + hour))
  assert.equal(pausedTill(spans, now + 5), now + hour)
  assert.equal(pausedTill(spans, now + hour), 0, 'over')
  //  a resume ends the running one and keeps it, so a later send still leaves it out
  spans = pauseUntil(spans, now + 60000, 0)
  assert.deepEqual(spans, [{ from: now, to: now + 60000 }])
  //  a span no send can reach back into any more is dropped
  assert.deepEqual(pauseUntil(spans, now + 60000 + MAX_WINDOW_MS + 1, 0), [])
  const rules = skipRules(null, {})
  const items = [{ url: 'https://a.example/', title: 'A' }]
  const visits = new Map([['https://a.example/', [{ visitTime: now - 5, transition: 'link' }, { visitTime: now + 5, transition: 'typed' }]]])
  assert.deepEqual(visitsOf(items, visits, { from: 0, to: now + hour, rules, pauses: spans }).map((v) => v.at), [now - 5])
  assert.equal(visitsOf(items, visits, { from: 0, to: now + hour, rules }).length, 2, 'no pause, both')
})

test('until tomorrow: the next local midnight', () => {
  const t = new Date(2026, 9, 9, 23, 30).getTime()
  assert.equal(tomorrow(t), new Date(2026, 9, 10, 0, 0).getTime())
  assert.equal(tomorrow(new Date(2026, 9, 10, 0, 0).getTime()), new Date(2026, 9, 11, 0, 0).getTime())
})
