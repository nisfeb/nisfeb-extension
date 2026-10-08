import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leoSetup } from '../lib/leo.js'

const lease = { mode: 'lease', base_url: 'https://openrouter.ai/api/v1/', key: ' sk-or-test-key-abcd ', models: ['anthropic/claude-haiku-4.5', 'openai/gpt-5'] }

test('a lease is Leo\'s form, filled, the key only as its last four', () => {
  assert.deepEqual(leoSetup(lease, false, null), { ready: {
    label: 'anthropic/claude-haiku-4.5 (Armillary)', model: 'anthropic/claude-haiku-4.5', models: lease.models,
    endpoint: 'https://openrouter.ai/api/v1/chat/completions', keyTail: 'abcd',
  } })
  assert.equal(leoSetup(lease, false, 'openai/gpt-5').ready.model, 'openai/gpt-5', 'the model picked')
  assert.equal(leoSetup(lease, false, 'not/listed').ready.model, 'anthropic/claude-haiku-4.5', 'one not listed: the first')
  assert.equal(leoSetup({ ...lease, base_url: 'https://x.example/v1/chat/completions' }, false, null).ready.endpoint, 'https://x.example/v1/chat/completions')
  assert.ok(!JSON.stringify(leoSetup(lease, false, null)).includes('sk-or'), 'never the key')
})

test('why Leo cannot run, in Talon\'s words', () => {
  assert.match(leoSetup({ ...lease, mode: 'proxy' }, false, null).cannot, /does not pass a stream on/)
  assert.match(leoSetup({ ...lease, mode: 'proxy' }, true, null).cannot, /balance is empty/)
  assert.match(leoSetup({ ...lease, base_url: 'http://127.0.0.1:9/v1' }, false, null).cannot, /only an https address/)
  assert.equal(leoSetup({ ...lease, key: ' ' }, false, null).cannot, 'Your ship holds no key yet.')
  assert.equal(leoSetup({ ...lease, models: [] }, false, null).cannot, 'Your ship lists no models yet.')
  assert.match(leoSetup(null, false, null).cannot, /stream/)
})
