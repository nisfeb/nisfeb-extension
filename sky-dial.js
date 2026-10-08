//  Talon's sky clock dial (screens/SkyClockPanel.kt), drawn on a canvas,
//  with the readout in the middle as text so it is read out. Every number
//  and rule is lib/sky.js; this only draws them.
//
//  ponytail: the sun and colours jump to each new minute and forecast,
//  where Talon tweens them; a quarter degree a minute does not show.

import {
  MINUTES_IN_DAY, angleOf, skyMix, daylightMinutes, sunUp, moonVisible, marksDistinct, dialMinute,
  clockLabel, tempLabel, dayBand, nightBand, twilightBand, skyColor, markColor, gloomAt, cloudMinutes,
  cloudScale, CLOUD_OFFSETS, STAR_COUNT, starNoise, starBrightness, starOffset, starRadius, conditionIcon,
  dialDescription, SUN, SUN_DOWN, MOON, MOON_DARK, MOON_TRACK_INSET,
} from './lib/sky.js'
import { css } from './lib/theme.js'

const SEGMENTS = 180
const SEGMENT_MINUTES = MINUTES_IN_DAY / SEGMENTS
//  where each part of the readout starts fitting (dp in Talon, px here)
const DATE_AT = 130
const WEATHER_AT = 190
const RANGE_AT = 250

//  Material's filled icons, on their 24-unit square (ui/icons/TalonIcons.kt).
export const ICONS = {
  cloud: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  air: 'M14.5 17c0 1.65-1.35 3-3 3s-3-1.35-3-3h2c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1H2v-2h9.5C13.15 14 14.5 15.35 14.5 17zM19 6.5C19 4.57 17.43 3 15.5 3S12 4.57 12 6.5h2C14 5.67 14.67 5 15.5 5S17 5.67 17 6.5 16.33 8 15.5 8H2v2h13.5C17.43 10 19 8.43 19 6.5zM18.5 11H2v2h16.5c.83 0 1.5.67 1.5 1.5S19.33 16 18.5 16v2c1.93 0 3.5-1.57 3.5-3.5S20.43 11 18.5 11z',
  grain: [[10, 14], [6, 10], [6, 18], [18, 6], [14, 18], [18, 14], [14, 10], [10, 6]].map(([x, y]) => `M${x - 2} ${y}a2 2 0 1 0 4 0a2 2 0 1 0-4 0z`).join(''),
  drop: 'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2C20 10.48 17.33 6.55 12 2zM7.83 14c.37 0 .67.26.74.62.41 2.22 2.28 2.98 3.64 2.87.43-.02.79.32.79.75 0 .4-.32.73-.72.75-2.13.13-4.62-1.09-5.19-4.12C7.01 14.42 7.37 14 7.83 14z',
  snow: 'M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L17.83 13H22z',
  storm: 'M17.92 7.02C17.45 4.18 14.97 2 12 2 9.82 2 7.83 3.18 6.78 5.06 4.09 5.41 2 7.74 2 10.5 2 13.53 4.47 16 7.5 16h10c2.48 0 4.5-2.02 4.5-4.5C22 9.16 20.21 7.23 17.92 7.02zM14.8 17l-2.9 3.32 2 1-2.35 2.68 2.65 0 2.9-3.32-2-1 2.35-2.68zM8.8 17l-2.9 3.32 2 1-2.35 2.68 2.65 0 2.9-3.32-2-1 2.35-2.68z',
}
//  The same glyph, for the clouds on the ring.
const CLOUD_PATH = new Path2D(ICONS.cloud)

const point = (deg, c, r) => {
  const a = (deg - 90) * Math.PI / 180
  return [c + r * Math.cos(a), c + r * Math.sin(a)]
}
const rgba = (c, a) => `rgba(${c.map(Math.round).join(',')},${a})`

//  The lit part of the moon: the limb facing the sun, a half circle, and
//  the terminator, the same half circle squashed by the phase.
function moonLit(ctx, x, y, r, e) {
  const side = e < 180 ? 1 : -1
  const term = side * Math.cos(e * Math.PI / 180)
  ctx.beginPath()
  for (let i = 0; i <= 32; i++) {
    const t = Math.PI * i / 32
    ctx[i ? 'lineTo' : 'moveTo'](x + side * r * Math.sin(t), y - r * Math.cos(t))
  }
  for (let i = 32; i >= 0; i--) {
    const t = Math.PI * i / 32
    ctx.lineTo(x + term * r * Math.sin(t), y - r * Math.cos(t))
  }
  ctx.closePath()
}

//  The ring and everything on it. `colors` are the page's face, ink and
//  mark (surface, onSurface, onSurfaceVariant).
function paint(canvas, s, colors, labelFont) {
  const side = canvas.clientWidth
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(side * dpr)
  canvas.height = Math.round(side * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, side, side)
  const ring = side * 0.16
  const radius = (side - ring) / 2
  const c = side / 2
  const day = dayBand(s)
  const night = nightBand(s)
  const twilight = twilightBand(s)

  //  short segments, so the colour slides; a hair of overlap hides seams
  ctx.lineWidth = ring
  ctx.lineCap = 'butt'
  const sweep = (360 / SEGMENTS + 0.7) * Math.PI / 180
  for (let i = 0; i < SEGMENTS; i++) {
    const mid = i * SEGMENT_MINUTES + SEGMENT_MINUTES / 2
    const mix = skyMix(mid, s.sunriseMinute, s.sunsetMinute, s.twilight, s.polar, s.polarDay)
    const start = (angleOf(i * SEGMENT_MINUTES) - 90) * Math.PI / 180
    ctx.beginPath()
    ctx.arc(c, c, radius, start, start + sweep)
    ctx.strokeStyle = css(skyColor(mix, day, twilight, night, gloomAt(mid, s.hourlyCondition, s.condition)))
    ctx.stroke()
  }

  //  stars and clouds, cut off at the band's edges
  ctx.save()
  ctx.beginPath()
  ctx.arc(c, c, radius + ring / 2, 0, 2 * Math.PI)
  ctx.arc(c, c, radius - ring / 2, 0, 2 * Math.PI)
  ctx.clip('evenodd')
  const cover = s.cloudCover ?? 0
  const nightMinutes = MINUTES_IN_DAY - daylightMinutes(s)
  if (nightMinutes >= 60 && starBrightness(1, cover, 1) >= 0.03) {
    for (let i = 0; i < STAR_COUNT; i++) {
      const minute = s.sunsetMinute + Math.round(starNoise(i, 1) * nightMinutes)
      const mix = skyMix(minute, s.sunriseMinute, s.sunsetMinute, s.twilight, s.polar, s.polarDay)
      if (mix >= 0) continue
      const a = starBrightness(-mix, cover, starNoise(i, 3))
      if (a < 0.02) continue
      const [x, y] = point(angleOf(minute), c, radius + starOffset(starNoise(i, 2), ring))
      ctx.beginPath()
      ctx.arc(x, y, starRadius(starNoise(i, 4), ring, 1 / dpr), 0, 2 * Math.PI)
      ctx.fillStyle = `rgba(255,255,255,${a})`
      ctx.fill()
    }
  }
  cloudMinutes(s.hourlyCloud, cover, s.sunriseMinute, daylightMinutes(s)).forEach(([minute, cc], i) => {
    const w = ring * 1.9 * cloudScale(cc)
    const [x, y] = point(angleOf(minute), c, radius + ring * CLOUD_OFFSETS[i % CLOUD_OFFSETS.length])
    ctx.save()
    ctx.translate(x - w / 2, y - w / 2)
    ctx.scale(w / 24, w / 24)
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, 0.15 + 0.22 * cc)})`
    ctx.fill(CLOUD_PATH)
    ctx.restore()
  })
  ctx.restore()

  //  the face, before anything that sits inside the ring
  ctx.beginPath()
  ctx.arc(c, c, radius - ring / 2, 0, 2 * Math.PI)
  ctx.fillStyle = colors.face
  ctx.fill()

  //  the high and the low, as graduations with a letter each
  const graduation = (minute, label, color) => {
    const a = angleOf(minute)
    const [x0, y0] = point(a, c, radius - ring * 0.5)
    const [x1, y1] = point(a, c, radius + ring * 0.5)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.lineWidth = ring * 0.09
    ctx.strokeStyle = css(color)
    ctx.stroke()
    const [lx, ly] = point(a, c, radius - ring * 0.5 - 16 * 0.6)
    ctx.font = labelFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = css(color)
    ctx.fillText(label, lx, ly)
  }
  if (s.highAtMinute !== null) graduation(s.highAtMinute, 'H', markColor(s.highC))
  if (marksDistinct(s) && s.lowAtMinute !== null) graduation(s.lowAtMinute, 'L', markColor(s.lowC))

  //  the moon on its own track inside the sun's, only when it can be seen
  if (moonVisible(s)) {
    const e = s.moonElongationDeg
    const r = ring * 0.30
    const [x, y] = point(angleOf(dialMinute(s.minuteOfDay, e)), c, radius - ring * MOON_TRACK_INSET)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = css(MOON_DARK)
    ctx.fill()
    moonLit(ctx, x, y, r, e)
    ctx.fillStyle = css(MOON)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.lineWidth = r * 0.10
    ctx.strokeStyle = rgba(MOON, 0.45)
    ctx.stroke()
  }

  //  the sun, which is also now; under the earth it is an ember
  const [sx, sy] = point(angleOf(s.minuteOfDay), c, radius)
  ctx.beginPath()
  ctx.arc(sx, sy, ring * 0.36, 0, 2 * Math.PI)
  ctx.fillStyle = css(sunUp(s) ? SUN : SUN_DOWN)
  ctx.fill()
}

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props)
  n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false))
  return n
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICONS[name])
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

//  The readout thins out with the dial, as Talon's does.
function readout(box, s, side, fahrenheit, twentyFourHour) {
  const size = side >= RANGE_AT ? 28 : side >= WEATHER_AT ? 22 : side >= DATE_AT ? 16 : 14
  const cond = side >= WEATHER_AT && conditionIcon(s.condition)
  const hilo = (label, celsius, at) => celsius !== null && el('div', {},
    el('div', { textContent: `${label} ${tempLabel(celsius, fahrenheit)}` }),
    at !== null && el('div', { className: 'at', textContent: clockLabel(at, twentyFourHour) }))
  const weather = s.currentC !== null && side >= WEATHER_AT
  box.style.padding = `0 ${side * 0.12}px`
  box.replaceChildren(...[
    el('div', { className: 'time', textContent: clockLabel(s.minuteOfDay, twentyFourHour), style: `font-size:${size}px` }),
    side >= DATE_AT && el('div', { className: 'date', textContent: s.dateLabel }),
    cond && el('div', { className: 'cond' }, icon(cond[0]), cond[1]),
    weather && el('div', { className: 'temp', textContent: tempLabel(s.currentC, fahrenheit) }),
    weather && side >= RANGE_AT && el('div', { className: 'hilo' }, hilo('H', s.highC, s.highAtMinute), hilo('L', s.lowC, s.lowAtMinute)),
  ].filter(Boolean))
}

//  The whole dial: `canvas` and `box` (the readout) sit in one square.
export function drawDial(canvas, box, s, { fahrenheit, twentyFourHour }) {
  const style = getComputedStyle(document.documentElement)
  const colors = { face: style.getPropertyValue('--bg').trim() || '#ffffff' }
  const side = canvas.clientWidth
  if (!side) return
  paint(canvas, s, colors, `600 11px ${getComputedStyle(document.body).fontFamily}`)
  canvas.setAttribute('aria-label', dialDescription(s, fahrenheit, twentyFourHour))
  readout(box, s, side, fahrenheit, twentyFourHour)
}
