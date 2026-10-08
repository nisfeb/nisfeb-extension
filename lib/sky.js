//  Talon's sky clock, the dial on its home page: the day as a ring with
//  noon at the top and midnight at the bottom, the sun and the moon where
//  they are, and the ring coloured by the hour and the weather. Ported as
//  it is from Talon (ui/SkyClock.kt, Solar.kt, Moon.kt, OpenMeteoWeather.kt,
//  OpenMeteoPlaces.kt, the rules in screens/SkyClockPanel.kt and
//  HomeScreen.skyFor), so the day page's dial is Talon's. Pure: the
//  drawing is sky-dial.js, and test/sky.test.js carries Talon's own cases.

import { lerp, rgb } from './theme.js'

export const MINUTES_IN_DAY = 1440
//  How far from the sun the moon must be before the dial draws it, in
//  degrees of elongation.
export const MOON_MIN_ELONGATION_DEG = 15

const wrap = (m) => ((m % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY
//  Minutes going forward from `from` to `to`, over midnight if need be.
const forward = (from, to) => { const d = wrap(to) - wrap(from); return d < 0 ? d + MINUTES_IN_DAY : d }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

//  Degrees clockwise from the top of the dial: noon is 0, midnight 180.
export const angleOf = (minuteOfDay) => ((wrap(minuteOfDay) - 12 * 60) / MINUTES_IN_DAY) * 360

//  How lit the sky is: -1 deep night, 0 the sun on the horizon (the most
//  coloured), +1 full day. Night settles more slowly than day breaks.
export function skyMix(minuteOfDay, sunriseMinute, sunsetMinute, twilightMinutes = 60, polar = false, polarDay = false) {
  if (polar) return polarDay ? 1 : -1
  const half = Math.max(Math.trunc(twilightMinutes / 2), 1)
  const sinceRise = forward(sunriseMinute, minuteOfDay)
  const dayLength = forward(sunriseMinute, sunsetMinute)
  if (dayLength === 0) return -1
  if (sinceRise <= dayLength) return clamp(Math.min(sinceRise, dayLength - sinceRise) / half, 0, 1)
  const nightLength = MINUTES_IN_DAY - dayLength
  const sinceSet = forward(sunsetMinute, minuteOfDay)
  return -clamp(Math.min(sinceSet, nightLength - sinceSet) / (half * 2), 0, 1)
}

//  -1 cold (freezing) through 0 to +1 hot (blood heat), from Celsius.
export function warmth(celsius) {
  if (celsius === null || celsius === undefined) return 0
  return clamp((celsius - 17.5) / 17.5, -1, 1)
}

//  What the sky is doing, as far as the dial cares, and how much light
//  each takes out of the day.
export const GLOOM = { CLEAR: 0, CLOUD: 0, FOG: 0.26, DRIZZLE: 0.20, RAIN: 0.38, SLEET: 0.36, SNOW: 0.20, THUNDER: 0.55 }

//  A WMO present-weather code as something the dial can draw; anything
//  unknown is clear, because a wrong icon is worse than none.
export function weatherOf(code) {
  switch (code) {
    case 2: case 3: return 'CLOUD'
    case 45: case 48: return 'FOG'
    case 51: case 53: case 55: return 'DRIZZLE'
    case 56: case 57: case 66: case 67: return 'SLEET'
    case 61: case 63: case 65: case 80: case 81: case 82: return 'RAIN'
    case 71: case 73: case 75: case 77: case 85: case 86: return 'SNOW'
    case 95: case 96: case 99: return 'THUNDER'
    default: return 'CLEAR'
  }
}

export const overcast = (cloudCover) => clamp(cloudCover ?? 0, 0, 1)

//  Whether a body at `minuteOfDay` is above the horizon, wrap-safe.
export function isUpAt(minuteOfDay, sunriseMinute, sunsetMinute, polar = false, polarDay = false) {
  if (polar) return polarDay
  const dayLength = forward(sunriseMinute, sunsetMinute)
  if (dayLength === 0) return false
  return forward(sunriseMinute, minuteOfDay) < dayLength
}

//  A time of day as a label, without seconds.
export function clockLabel(minuteOfDay, twentyFourHour) {
  const m = wrap(minuteOfDay)
  const h = Math.trunc(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  if (twentyFourHour) return `${String(h).padStart(2, '0')}:${mm}`
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

export function tempLabel(celsius, fahrenheit) {
  if (celsius === null || celsius === undefined) return '—'
  return `${Math.round(fahrenheit ? celsius * 9 / 5 + 32 : celsius)}°`
}

//  Everything the dial needs (SkyClock.Sky), with its defaults: no place
//  is an even twelve hours, no weather says nothing about the weather.
export const SKY = {
  minuteOfDay: 0, sunriseMinute: 6 * 60, sunsetMinute: 18 * 60,
  currentC: null, highC: null, highAtMinute: null, lowC: null, lowAtMinute: null,
  cloudCover: null, condition: 'CLEAR', hourlyCloud: [], hourlyCondition: [],
  zoneId: null, moonElongationDeg: null, dateLabel: '', twilight: 60, polar: false, polarDay: false,
}
export const sky = (fields) => ({ ...SKY, ...fields })

export function daylightMinutes(s) {
  if (s.polar) return s.polarDay ? MINUTES_IN_DAY : 0
  return forward(s.sunriseMinute, s.sunsetMinute)
}
export const sunUp = (s) => isUpAt(s.minuteOfDay, s.sunriseMinute, s.sunsetMinute, s.polar, s.polarDay)

//  Taken against the sun's own rising and setting: the moon's path is a
//  little off the sun's, so this is out by up to an hour, which is near
//  enough for deciding whether to draw it at all.
export function moonUp(s) {
  if (s.moonElongationDeg === null || s.moonElongationDeg === undefined) return false
  return isUpAt(dialMinute(s.minuteOfDay, s.moonElongationDeg), s.sunriseMinute, s.sunsetMinute, s.polar, s.polarDay)
}

//  Up, and far enough from the sun to see: near a new moon it keeps the
//  sun's hours but is lost in the glare, and the two markers collide.
export function moonVisible(s) {
  const e = s.moonElongationDeg
  if (e === null || e === undefined) return false
  return moonUp(s) && Math.min(e, 360 - e) >= MOON_MIN_ELONGATION_DEG
}

//  The high and low far enough apart in time to mark separately.
export function marksDistinct(s) {
  if (s.highAtMinute === null || s.lowAtMinute === null) return false
  const gap = Math.abs(s.highAtMinute - s.lowAtMinute)
  return Math.min(gap, MINUTES_IN_DAY - gap) >= 45
}

//  ── the sun: NOAA's sunrise equation (Solar.kt) ───────────────────────

const DEG = Math.PI / 180

//  The horizon dips for somebody above sea level: about a degree a
//  kilometre at first. Below sea level is clamped, as a broken fix.
export function horizonDip(metres) {
  const h = clamp(metres, 0, 9000)
  if (h === 0) return 0
  const r = 6371000
  return Math.acos(r / (r + h)) / DEG
}

const wrapSolar = (minutes) => { const m = Math.trunc(minutes) % MINUTES_IN_DAY; return m < 0 ? m + MINUTES_IN_DAY : m }

//  Local minutes past midnight of sunrise and sunset, or a polar day or
//  night. The horizon is taken at 90.833 degrees for the sun's width and
//  the air's bending.
export function sunTimes(latitude, longitude, dayOfYear, zoneOffsetMinutes, elevationMetres = 0) {
  const g = 2 * Math.PI / 365 * (dayOfYear - 1)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const lat = latitude * DEG
  const zenith = 90.833 + horizonDip(elevationMetres)
  const cosHa = Math.cos(zenith * DEG) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)
  if (cosHa > 1) return { sunriseMinute: 0, sunsetMinute: 0, polar: true, polarDay: false }
  if (cosHa < -1) return { sunriseMinute: 0, sunsetMinute: MINUTES_IN_DAY, polar: true, polarDay: true }
  const ha = Math.acos(cosHa) / DEG
  return {
    sunriseMinute: wrapSolar(720 - 4 * (longitude + ha) - eqTime + zoneOffsetMinutes),
    sunsetMinute: wrapSolar(720 - 4 * (longitude - ha) - eqTime + zoneOffsetMinutes),
    polar: false,
    polarDay: false,
  }
}

//  Dawn and dusk last longer away from the equator. Bounded.
export const twilightMinutes = (latitude) => clamp(Math.trunc(22 / Math.cos(clamp(Math.abs(latitude), 0, 89) * DEG)), 20, 180)

//  ── the moon: a mean synodic month from a known new moon (Moon.kt) ────

export const SYNODIC_DAYS = 29.530588853
const KNOWN_NEW_MOON_MS = 947182440000 // 2000-01-06 18:14 UTC

export function phaseAt(ms) {
  let age = ((ms - KNOWN_NEW_MOON_MS) / 864e5) % SYNODIC_DAYS
  if (age < 0) age += SYNODIC_DAYS
  const e = age / SYNODIC_DAYS * 360
  return { elongationDeg: e, illuminated: (1 - Math.cos(e * DEG)) / 2, waxing: e < 180 }
}

//  The moon lags the sun by its elongation, fifteen degrees an hour.
export function dialMinute(minuteOfDay, elongationDeg) {
  const m = (minuteOfDay - Math.trunc(elongationDeg / 360 * MINUTES_IN_DAY)) % MINUTES_IN_DAY
  return m < 0 ? m + MINUTES_IN_DAY : m
}

//  ── the weather: Open-Meteo (OpenMeteoWeather.kt) ─────────────────────
//
//  THIS SENDS COORDINATES TO A THIRD PARTY, on its own once a place is
//  set, because that is what a weather dial is. Two decimal places, about
//  a kilometre, which is finer than the forecast's own grid.

const round2 = (v) => Math.trunc(v * 100) / 100

export const requestUrl = (place) => 'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${round2(place.lat)}&longitude=${round2(place.lon)}` +
  '&current=temperature_2m,cloud_cover,weather_code' +
  '&hourly=temperature_2m,cloud_cover,weather_code' +
  '&forecast_days=1&timezone=auto'

//  `2026-09-11T14:00`, the place's own wall clock.
function stampMinute(stamp) {
  const t = String(stamp).includes('T') ? String(stamp).split('T')[1] : ''
  const [hs, ms = ''] = t.split(':')
  if (!t.includes(':') || !/^\d+$/.test(hs) || !/^\d+$/.test(ms.slice(0, 2))) return null
  const h = Number(hs)
  const m = Number(ms.slice(0, 2))
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? h * 60 + m : null
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

//  The weather half of a sky: now, the day's high and low with the hour
//  of each, cloud and conditions by the hour, and the place's zone. No
//  current temperature is no weather at all.
export function parseForecast(body) {
  let f
  try { f = typeof body === 'string' ? JSON.parse(body) : body } catch { return null }
  const current = f && f.current && num(f.current.temperature_2m)
  if (current === null || current === undefined) return null
  const hourly = f.hourly || {}
  const times = Array.isArray(hourly.time) ? hourly.time : []
  const temps = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : []
  const pairs = []
  for (let i = 0; i < Math.min(times.length, temps.length); i++) {
    const m = stampMinute(times[i])
    if (m !== null && num(temps[i]) !== null) pairs.push([m, temps[i]])
  }
  //  the first of equals, as maxByOrNull and minByOrNull take it
  const high = pairs.reduce((a, p) => (!a || p[1] > a[1] ? p : a), null)
  const low = pairs.reduce((a, p) => (!a || p[1] < a[1] ? p : a), null)
  //  laid out by the hour of the day, a gap filled from the hour before
  const byHour = Array(24).fill(-1)
  const condByHour = Array(24).fill('CLEAR')
  let sawCloud = false
  let sawCode = false
  times.forEach((t, i) => {
    const m = stampMinute(t)
    if (m === null) return
    const h = Math.trunc(m / 60)
    const cc = num((hourly.cloud_cover || [])[i])
    if (cc !== null) { byHour[h] = clamp(cc / 100, 0, 1); sawCloud = true }
    const code = num((hourly.weather_code || [])[i])
    if (code !== null) { condByHour[h] = weatherOf(code); sawCode = true }
  })
  let carry = 0
  for (let h = 0; h < 24; h++) { if (byHour[h] < 0) byHour[h] = carry; else carry = byHour[h] }
  const cover = num(f.current.cloud_cover)
  return sky({
    currentC: current,
    highC: high ? high[1] : null,
    highAtMinute: high ? high[0] : null,
    lowC: low ? low[1] : null,
    lowAtMinute: low ? low[0] : null,
    cloudCover: cover === null ? null : clamp(cover / 100, 0, 1),
    hourlyCloud: sawCloud ? byHour : [],
    hourlyCondition: sawCode ? condByHour : [],
    condition: weatherOf(num(f.current.weather_code)),
    zoneId: typeof f.timezone === 'string' && f.timezone.trim() ? f.timezone : null,
  })
}

//  A forecast is good for half an hour. Never fetched is stale, and so
//  is a clock that went back.
export const WEATHER_MAX_AGE_MS = 30 * 60000
export const weatherIsStale = (fetchedAtMs, nowMs, maxAge = WEATHER_MAX_AGE_MS) =>
  !(fetchedAtMs > 0) || nowMs < fetchedAtMs || nowMs - fetchedAtMs >= maxAge

//  ── places: typed, then looked up (OpenMeteoPlaces.kt) ────────────────
//
//  THIS SENDS WHAT SOMEBODY TYPES TO A THIRD PARTY, only when they type a
//  place and ask. Coordinates typed as "lat, lon" never go there.

export const placesUrl = (q) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(String(q).trim())}&count=8&format=json`

export function placesOf(answer) {
  const rows = (answer && Array.isArray(answer.results)) ? answer.results : []
  return rows.filter((r) => num(r.latitude) !== null && num(r.longitude) !== null).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : null, r.country || null].filter((x) => x && String(x).trim()).join(', '),
    elevationMetres: num(r.elevation),
    timeZoneId: typeof r.timezone === 'string' && r.timezone.trim() ? r.timezone : null,
  }))
}

//  "51.5, -0.13" as a place, or null. Off the globe is no place.
export function coordsOf(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(text || ''))
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon, label: `${lat}, ${lon}`, elevationMetres: null, timeZoneId: null }
}

export const placeKey = (p) => (p ? `${p.lat},${p.lon}` : '')

//  ── a moment, on a place's own clock (HomeScreen.skyFor) ──────────────

//  The wall clock in `zone` at `ms`, and that zone's offset then. An
//  unknown zone falls back to the browser's own: a dial on the wrong
//  clock is a bad dial, and one that throws is none.
export function zoneParts(ms, zone) {
  const opts = { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }
  let f
  try { f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: zone || undefined }) } catch { f = new Intl.DateTimeFormat('en-US', opts) }
  const p = {}
  for (const x of f.formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return {
    month: p.month,
    day: p.day,
    minuteOfDay: p.hour * 60 + p.minute,
    offsetMinutes: Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000),
    dayOfYear: (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / 864e5 + 1,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dayLabel(month, day) {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'
  return `${MONTHS[month - 1]} ${day}${suffix}`
}

//  The dial's state for a moment: on the place's own clock where known
//  (a remote place on this machine's clock rotates its whole lit arc),
//  the sun's times where there is a place, and the moon for everybody.
export function skyFor(atMs, place, weather) {
  const z = zoneParts(atMs, (place && place.timeZoneId) || (weather && weather.zoneId))
  const sun = place ? sunTimes(place.lat, place.lon, z.dayOfYear, z.offsetMinutes, place.elevationMetres || 0) : null
  const base = sky(weather || {})
  return {
    ...base,
    minuteOfDay: z.minuteOfDay,
    dateLabel: dayLabel(z.month, z.day),
    sunriseMinute: sun ? sun.sunriseMinute : base.sunriseMinute,
    sunsetMinute: sun ? sun.sunsetMinute : base.sunsetMinute,
    twilight: place ? twilightMinutes(place.lat) : base.twilight,
    polar: sun ? sun.polar : false,
    polarDay: sun ? sun.polarDay : false,
    moonElongationDeg: phaseAt(atMs).elongationDeg,
  }
}

//  ── the palette (SkyClockPanel.kt) ────────────────────────────────────
//
//  The hour moves the bands and the weather moves their colour: warmth
//  shifts the lit bands red or blue, cloud drains them, rain takes the
//  light out. Colours are [r, g, b], mixed in Oklab as Compose mixes.

export const SUN = rgb('#f5b740')
export const SUN_DOWN = rgb('#a85f35')
export const MOON = rgb('#e8e4da')
export const MOON_DARK = rgb('#3a3f4d')
export const MOON_TRACK_INSET = 0.30
const MARK_COLD = rgb('#7fc4ff')
const MARK_MILD = rgb('#e6e9ee')
const MARK_HOT = rgb('#ff7a5c')
const DAY_TEMPERATE = rgb('#6e9bea')
const DAY_COLD = rgb('#86beec')
const DAY_WARM = rgb('#5c86d8')
const DAY_OVERCAST = rgb('#9aa4b0')
const NIGHT_BASE = rgb('#0c1533')
const NIGHT_OVERCAST = rgb('#232b3d')
const GLOOM_TO = rgb('#1e2530')
const TWILIGHT_BASE = rgb('#f0a33c')
const TWILIGHT_COLD = rgb('#e8956b')

export function dayBand(s) {
  const w = warmth(s.currentC)
  const nudged = w >= 0 ? lerp(DAY_TEMPERATE, DAY_WARM, w) : lerp(DAY_TEMPERATE, DAY_COLD, -w)
  return lerp(nudged, DAY_OVERCAST, overcast(s.cloudCover) * 0.8)
}
export const nightBand = (s) => lerp(NIGHT_BASE, NIGHT_OVERCAST, overcast(s.cloudCover) * 0.7)
export function twilightBand(s) {
  const w = warmth(s.currentC)
  const base = w >= 0 ? TWILIGHT_BASE : lerp(TWILIGHT_BASE, TWILIGHT_COLD, -w * 0.6)
  return lerp(base, DAY_OVERCAST, overcast(s.cloudCover) * 0.5)
}

//  The horizon colour is the hinge: day runs down to it, night on past it.
export function skyColor(mix, day, horizon, night, gloom) {
  const base = mix >= 0 ? lerp(horizon, day, mix) : lerp(horizon, night, -mix)
  return lerp(base, GLOOM_TO, clamp(gloom, 0, 1))
}

export function markColor(celsius) {
  const w = warmth(celsius)
  return w >= 0 ? lerp(MARK_MILD, MARK_HOT, w) : lerp(MARK_MILD, MARK_COLD, -w)
}

//  How dark the sky is at a minute, between neighbouring hours.
export function gloomAt(minute, hourly, fallback) {
  if (!Array.isArray(hourly) || hourly.length !== 24) return GLOOM[fallback] ?? 0
  const m = wrap(minute)
  const h = Math.trunc(m / 60)
  const t = (m % 60) / 60
  return GLOOM[hourly[h]] + (GLOOM[hourly[(h + 1) % 24]] - GLOOM[hourly[h]]) * t
}

//  ── clouds and stars ──────────────────────────────────────────────────

export const CLOUD_MAX = 4
export const CLOUD_OFFSETS = [-0.22, 0.18, -0.08, 0.26]
export const CLOUD_THRESHOLD = 0.25
export const CLOUD_MIN_GAP_MINUTES = 150

//  Which minutes get a cloud and how much each stands for: the cloudiest
//  daylight hours, kept off the ends of the day, thinned so two never
//  sit on each other. No hourly cover lays the current one over every hour.
export function cloudMinutes(hourlyCloud, currentCover, sunriseMinute, dayMinutes) {
  if (dayMinutes < CLOUD_MIN_GAP_MINUTES) return []
  const byHour = Array.isArray(hourlyCloud) && hourlyCloud.length === 24 ? hourlyCloud : Array(24).fill(currentCover)
  const lit = []
  for (let h = 0; h < 24; h++) {
    const minute = h * 60
    const since = wrap(minute - sunriseMinute)
    if (since < 45 || since > dayMinutes - 45) continue
    if (byHour[h] >= CLOUD_THRESHOLD) lit.push([minute, byHour[h]])
  }
  const ranked = lit.slice().sort((a, b) => (b[1] + starNoise(b[0], 7) * 0.001) - (a[1] + starNoise(a[0], 7) * 0.001))
  const taken = []
  for (const c of ranked) {
    if (taken.length >= CLOUD_MAX) break
    const clash = taken.some(([m]) => { const d = Math.abs(m - c[0]); return Math.min(d, MINUTES_IN_DAY - d) < CLOUD_MIN_GAP_MINUTES })
    if (!clash) taken.push(c)
  }
  return taken.sort((a, b) => a[0] - b[0])
}

export const cloudScale = (cover) => 0.82 + 0.52 * clamp(cover, 0, 1)

export const STAR_COUNT = 34
export const STAR_SPREAD = 0.68
export const STAR_ALPHA = 0.62

//  A stable scatter out of the index, with Kotlin's 32-bit arithmetic,
//  so the stars sit still from one paint to the next.
export function starNoise(i, salt) {
  let h = (Math.imul(i, 374761393) + Math.imul(salt, 668265263)) | 0
  h = Math.imul(h ^ (h >> 13), 1274126177)
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff
}
export const starBrightness = (depth, cover, noise) => STAR_ALPHA * clamp(depth, 0, 1) * clamp(1 - cover * 0.85, 0, 1) * (0.4 + 0.6 * noise)
export const starOffset = (noise, ring) => (noise - 0.5) * STAR_SPREAD * ring
//  A fraction of the band, floored at a device pixel so it survives.
export const starRadius = (noise, ring, pixel = 1) => Math.max(ring * (0.011 + 0.013 * noise), pixel)

//  ── words ─────────────────────────────────────────────────────────────

//  The icon and word for what the sky is doing, or null when it is clear.
export const CONDITION = {
  CLOUD: ['cloud', 'Cloudy'], FOG: ['air', 'Fog'], DRIZZLE: ['grain', 'Drizzle'], RAIN: ['drop', 'Rain'],
  SLEET: ['grain', 'Sleet'], SNOW: ['snow', 'Snow'], THUNDER: ['storm', 'Storm'],
}
export const conditionIcon = (w) => CONDITION[w] || null

//  What only the drawing says, for a screen reader: whether the sun is
//  up, when it rises or sets, the daylight, the sky, the high and low.
export function dialDescription(s, fahrenheit, twentyFourHour) {
  const at = (m) => clockLabel(m, twentyFourHour)
  const parts = [
    s.polar && s.polarDay ? 'The sun does not set today'
      : s.polar ? 'The sun does not rise today'
        : sunUp(s) ? `The sun is up. It sets at ${at(s.sunsetMinute)}`
          : `The sun is down. It rises at ${at(s.sunriseMinute)}`,
  ]
  if (!s.polar) { const d = daylightMinutes(s); parts.push(`${Math.trunc(d / 60)} hours and ${d % 60} minutes of daylight`) }
  const c = conditionIcon(s.condition)
  if (c) parts.push(c[1])
  if (s.highC !== null) parts.push(`High ${tempLabel(s.highC, fahrenheit)}${s.highAtMinute !== null ? ` at ${at(s.highAtMinute)}` : ''}`)
  if (s.lowC !== null) parts.push(`Low ${tempLabel(s.lowC, fahrenheit)}${s.lowAtMinute !== null ? ` at ${at(s.lowAtMinute)}` : ''}`)
  return parts.join('. ') + '.'
}
