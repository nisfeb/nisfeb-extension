import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerp, css, lum, themeVars, activeOf, accentOf, wantsProfile, profileHex, lookOf, lookVars, VARS } from '../lib/theme.js'

//  Talon's ThemeSettings, as SettingsSyncImpl writes it: the value of
//  each entry is the JSON as a string.
const NIGHT = { id: 't1', name: 'Night', dark: true, primary: '#7C3AED', secondary: '#0EA5E9', tertiary: '#10B981', background: '#0B0B10', surface: '#14141C', text: '', muted: '', raised: '', error: '', selection: '', link: '' }
const bucket = (themes, accent) => ({ bucket: { themes: JSON.stringify(themes), ...(accent ? { accent: JSON.stringify(accent) } : {}) } })

test('colour: Oklab mixing, as Compose lerps', () => {
  //  the Oklab midpoint of black and white is L 0.5, sRGB 99
  assert.equal(css(lerp([0, 0, 0], [255, 255, 255], 0.5)), '#636363')
  assert.equal(css(lerp([20, 40, 60], [200, 100, 0], 0)), '#14283c')
  assert.equal(css(lerp([20, 40, 60], [200, 100, 0], 1)), '#c86400')
  assert.ok(lum([255, 255, 255]) > 0.99 && lum([0, 0, 0]) === 0)
})

test('a custom theme: customScheme\'s roles on its surface', () => {
  const v = themeVars(NIGHT)
  assert.equal(v['color-scheme'], 'dark')
  assert.equal(v['--bg'], '#14141c')
  assert.equal(v['--text'], '#fafaf9', 'paper on a dark surface')
  assert.equal(v['--accent'], '#7c3aed')
  assert.equal(v['--on-accent'], '#fafaf9')
  assert.equal(v['--error'], '#f87171', 'unset: the built-in dark error')
  //  derived as customScheme derives them
  assert.equal(v['--muted'], css(lerp([0xfa, 0xfa, 0xf9], [0x14, 0x14, 0x1c], 0.35)))
  assert.equal(v['--raised'], css(lerp([0x14, 0x14, 0x1c], [255, 255, 255], 0.06)))
  assert.equal(v['--outline'], css(lerp([0x14, 0x14, 0x1c], [0xfa, 0xfa, 0xf9], 0.4)))
  assert.equal(v['--line'], css(lerp([0x14, 0x14, 0x1c], [0xfa, 0xfa, 0xf9], 0.15)))
  assert.deepEqual(Object.keys(v).sort(), [...VARS].sort())
  //  a light one: ink on it, and its own extras where set
  const light = themeVars({ ...NIGHT, dark: false, surface: '#FFF8F0', primary: '#FDE68A', text: '#333333', muted: '#777777', error: '#B00020' })
  assert.equal(light['color-scheme'], 'light')
  assert.equal(light['--text'], '#333333')
  assert.equal(light['--muted'], '#777777')
  assert.equal(light['--on-accent'], '#1c1917', 'ink on a pale primary')
  assert.equal(light['--error'], '#b00020')
})

test('which theme is on: the active one, if it is whole', () => {
  assert.equal(activeOf({ themes: [NIGHT], activeId: 't1' }), NIGHT)
  assert.equal(activeOf({ themes: [NIGHT] }), null, 'no activeId: the built-in theme')
  assert.equal(activeOf({ themes: [{ ...NIGHT, name: ' ' }], activeId: 't1' }), null)
  assert.equal(activeOf({ themes: [{ ...NIGHT, surface: 'blue' }], activeId: 't1' }), null)
  assert.equal(activeOf(null), null)
})

test('the accent: off, brand, custom or the profile colour', () => {
  assert.equal(accentOf(null), null)
  assert.equal(accentOf({ mode: 'Custom', customHex: '#ff0000' }), null, 'unset is off')
  assert.equal(accentOf({ enabled: true, mode: 'Brand' }), null)
  assert.deepEqual(accentOf({ enabled: true, mode: 'Custom', customHex: '#ff0000' }), [255, 0, 0])
  assert.deepEqual(accentOf({ enabled: true, mode: 'Profile' }, '#00ff00'), [0, 255, 0])
  assert.equal(accentOf({ enabled: true, mode: 'Profile' }, null), null)
  assert.ok(wantsProfile({ enabled: true, mode: 'Whatever' }), 'an unknown mode reads as Profile')
  assert.ok(!wantsProfile({ enabled: true, mode: 'Custom' }))
  assert.equal(profileHex({ color: { type: 'tint', value: '0xff.5050' } }), '#ff5050')
  assert.equal(profileHex({ color: '0x0.ffff' }), '#00ffff')
  assert.equal(profileHex({ color: null }), null)
  assert.equal(profileHex(null), null)
})

test('what the page sets, from the bucket the ship answers', () => {
  assert.deepEqual(lookVars(null), {})
  assert.deepEqual(lookVars(lookOf({})), {}, 'no Talon settings: the built-in look')
  assert.deepEqual(lookVars(lookOf(bucket({ themes: [NIGHT] }))), {}, 'themes but none on')
  const look = lookOf(bucket({ themes: [NIGHT], activeId: 't1' }))
  assert.equal(lookVars(look)['--bg'], '#14141c')
  assert.deepEqual(lookVars(look, false), {}, 'turned off here')
  //  an accent over the built-in look sets only the accent
  const accent = lookVars(lookOf(bucket({ themes: [] }, { enabled: true, mode: 'Custom', customHex: '#FFEE00' })))
  assert.deepEqual(accent, { '--accent': '#ffee00', '--on-accent': '#1c1917' })
  //  and over a custom theme it wins over the primary
  const both = lookVars(lookOf(bucket({ themes: [NIGHT], activeId: 't1' }, { enabled: true, mode: 'Custom', customHex: '#003366' })))
  assert.equal(both['--accent'], '#003366')
  assert.equal(both['--on-accent'], '#ffffff')
  assert.equal(both['--bg'], '#14141c')
  //  an entry that is not JSON is no entry
  assert.deepEqual(lookOf({ bucket: { themes: '{nope', accent: 'x' } }), { themes: null, accent: null })
})
