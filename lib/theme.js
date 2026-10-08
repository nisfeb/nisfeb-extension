//  Talon's look, for the day page. With no custom theme the page draws in
//  Talon's built-in palette (today.html's own colours, light or dark as
//  the system is, since Talon keeps that choice per device). With one,
//  the active custom theme and the accent Talon keeps on the ship win:
//  %settings, desk talon, bucket ui-prefs, entries themes and accent,
//  each value a JSON-stringified string (SettingsSyncImpl.pokePutEntry).
//
//  The derivation is Talon's customScheme (ui/theme/CustomTheme.kt), as
//  lattice ported it (ui-app/theme.js), cut to the roles this page draws.
//  Pure, so the tests pin it.

const FIVE = ['primary', 'secondary', 'tertiary', 'background', 'surface']
export const hex6 = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim()); return m && m[1] }
export const rgb = (s) => { const h = hex6(s); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
export const css = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const toByte = (v) => Math.min(255, Math.max(0, 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))

//  Compose's lerp(Color, Color, Float) mixes in Oklab (Björn Ottosson's
//  matrices), so a derived shade comes out as Talon's does.
const oklab = (c) => {
  const [r, g, b] = c.map(toLin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}
const fromOklab = ([L, A, B]) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(toByte)
}
export const lerp = (a, b, t) => { const x = oklab(a), y = oklab(b); return fromOklab(x.map((v, i) => v + (y[i] - v) * t)) }
//  Compose's Color.luminance(): linear sRGB, Rec. 709 weights.
export const lum = (c) => { const [r, g, b] = c.map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const INK = [0x1c, 0x19, 0x17]
const PAPER = [0xfa, 0xfa, 0xf9]
const on = (c) => (lum(c) > 0.4 ? INK : PAPER)

//  The page's colour properties. today.html sets each to Talon's built-in
//  palette; a look sets them inline over it, and an empty look is the
//  built-in one.
export const VARS = ['color-scheme', '--bg', '--text', '--muted', '--raised', '--outline', '--line', '--accent', '--on-accent', '--error']

//  customScheme's roles, as properties: the page is drawn in the SURFACE
//  colour, as Talon draws its screens (its background only shows in its
//  own theme editor), with onSurface, onSurfaceVariant, surfaceVariant
//  and the two outlines on it.
export function themeVars(t) {
  const sf = rgb(t.surface)
  const p = rgb(t.primary)
  const text = hex6(t.text) ? rgb(t.text) : on(sf)
  const toward = t.dark ? [255, 255, 255] : [0, 0, 0]
  return {
    'color-scheme': t.dark ? 'dark' : 'light',
    '--bg': css(sf),
    '--text': css(text),
    '--muted': css(hex6(t.muted) ? rgb(t.muted) : lerp(text, sf, 0.35)),
    '--raised': css(hex6(t.raised) ? rgb(t.raised) : lerp(sf, toward, 0.06)),
    '--outline': css(lerp(sf, text, 0.4)),
    '--line': css(lerp(sf, text, 0.15)),
    '--accent': css(p),
    '--on-accent': css(on(p)),
    //  unset, talonColors(dark).error
    '--error': hex6(t.error) ? css(rgb(t.error)) : t.dark ? '#f87171' : '#dc2626',
  }
}

const valid = (t) => !!t && String(t.name || '').trim() !== '' && FIVE.every((k) => hex6(t[k]))
//  ThemeSettings.active: no activeId is the built-in theme.
export const activeOf = (ts) => (ts && Array.isArray(ts.themes) && ts.themes.find((t) => t.id === ts.activeId && valid(t))) || null

//  AccentSettings { enabled, mode, customHex }. Unset reads as off (Talon
//  turns it on by itself only for a multi-ship login, which this cannot
//  see), and an unknown mode as Profile, as Talon reads it.
export const wantsProfile = (a) => !!a && a.enabled === true && a.mode !== 'Custom' && a.mode !== 'Brand'
export function accentOf(a, profile) {
  if (!a || a.enabled !== true || a.mode === 'Brand') return null
  const h = a.mode === 'Custom' ? a.customHex : profile
  return hex6(h) ? rgb(h) : null
}

//  The %contacts profile colour, /v1/self: { color: { type: 'tint',
//  value: '0xff.5050' } }, as '#rrggbb', or null.
export function profileHex(self) {
  const c = self && self.color
  const h = String((c && typeof c === 'object' ? c.value : c) || '').replace(/^(0x|#)/i, '').replace(/\./g, '')
  return /^[0-9a-f]{1,6}$/i.test(h) ? '#' + h.padStart(6, '0') : null
}

const unwrap = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null } }

//  The ui-prefs bucket's answer, as the worker keeps it.
export function lookOf(bucket) {
  const b = (bucket && bucket.bucket) || {}
  return { themes: unwrap(b.themes) || null, accent: unwrap(b.accent) || null }
}

//  What the page sets: nothing when the owner turned Talon's theme off
//  or Talon has none, the theme's roles when one is active, and the
//  accent (Talon's accentOverride: the primary and the ink or white on
//  it) over either.
export function lookVars(look, use = true) {
  if (!use || !look) return {}
  const t = activeOf(look.themes)
  const v = t ? themeVars(t) : {}
  const a = accentOf(look.accent, look.profile)
  if (a) Object.assign(v, { '--accent': css(a), '--on-accent': lum(a) > 0.5 ? '#1c1917' : '#ffffff' })
  return v
}
