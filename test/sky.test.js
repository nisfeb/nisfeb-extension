//  Talon's own sky clock tests (commonTest ui/SolarTest, MoonTest,
//  MoonVisibilityTest, SkyMixTest, WeatherCodeTest, OpenMeteoWeatherTest),
//  case for case, and the parts the port adds: the place's own clock,
//  the request, the place search and the cloud and star rules.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MINUTES_IN_DAY, MOON_MIN_ELONGATION_DEG, angleOf, skyMix, weatherOf, isUpAt, clockLabel, tempLabel, sky,
  daylightMinutes, sunUp, moonUp, moonVisible, marksDistinct, horizonDip, sunTimes, twilightMinutes,
  SYNODIC_DAYS, phaseAt, dialMinute, requestUrl, parseForecast, weatherIsStale, placesUrl, placesOf, coordsOf,
  zoneParts, dayLabel, skyFor, cloudMinutes, starNoise, gloomAt, dialDescription, markColor,
} from '../lib/sky.js'

const daylight = (t) => (t.polar ? (t.polarDay ? MINUTES_IN_DAY : 0) : daylightMinutes(sky(t)))
const june = 172
const december = 355

test('Solar: the equator keeps its halves near even all year', () => {
  for (const day of [june, december, 1, 90]) {
    const t = sunTimes(0, 0, day, 0)
    assert.ok(!t.polar)
    assert.ok(Math.abs(daylight(t) - 12 * 60) < 20, `day ${day}: ${daylight(t) / 60}h`)
  }
})

test('Solar: long northern summers, short winters, the other way south', () => {
  assert.ok(daylight(sunTimes(51.5, 0, june, 0)) > 15 * 60)
  assert.ok(daylight(sunTimes(51.5, 0, december, 0)) < 9 * 60)
  assert.ok(daylight(sunTimes(-33.9, 0, december, 0)) > daylight(sunTimes(-33.9, 0, june, 0)))
})

test('Solar: past the arctic circle the sun does not set in summer, nor rise in winter', () => {
  const summer = sunTimes(78, 15, june, 60)
  assert.ok(summer.polar && summer.polarDay)
  assert.equal(daylight(summer), MINUTES_IN_DAY)
  const winter = sunTimes(78, 15, december, 60)
  assert.ok(winter.polar && !winter.polarDay)
  assert.equal(daylight(winter), 0)
})

test('Solar: London\'s June sunrise and sunset land at believable hours', () => {
  const t = sunTimes(51.5, -0.13, june, 60)
  assert.ok(t.sunriseMinute >= 4 * 60 && t.sunriseMinute <= 5 * 60, clockLabel(t.sunriseMinute, true))
  assert.ok(t.sunsetMinute >= 20 * 60 + 45 && t.sunsetMinute <= 21 * 60 + 45, clockLabel(t.sunsetMinute, true))
})

test('Solar: standing higher lengthens the day; the horizon dips a degree a kilometre', () => {
  const sea = sunTimes(40, 0, 100, 0, 0)
  const peak = sunTimes(40, 0, 100, 0, 3000)
  assert.ok(peak.sunriseMinute < sea.sunriseMinute && peak.sunsetMinute > sea.sunsetMinute)
  assert.ok(daylight(peak) > daylight(sea) + 10)
  assert.equal(horizonDip(0), 0)
  assert.ok(Math.abs(horizonDip(1000) - 1) < 0.1)
  assert.ok(horizonDip(8848) > 2.5)
  assert.equal(horizonDip(-500), 0)
  assert.equal(horizonDip(40000), horizonDip(9000))
  assert.equal(twilightMinutes(0), 22)
  assert.equal(twilightMinutes(89.9), 180)
})

test('Moon: known new moons land on new, a full moon opposite the sun', () => {
  const ageOf = (ms) => phaseAt(ms).elongationDeg / 360 * SYNODIC_DAYS
  for (const ms of [1704974220000, 1743245880000]) {
    const age = ageOf(ms)
    assert.ok(Math.min(age, SYNODIC_DAYS - age) < 0.6, `${ms}: ${age}`)
  }
  const full = phaseAt(1704974220000 + Math.trunc(SYNODIC_DAYS / 2 * 864e5))
  assert.ok(Math.abs(full.elongationDeg - 180) < 8 && full.illuminated > 0.99)
  assert.ok(Math.abs(dialMinute(0, full.elongationDeg) - 12 * 60) < 32)
  const q = Math.trunc(SYNODIC_DAYS / 4 * 864e5)
  const first = phaseAt(1704974220000 + q)
  const last = phaseAt(1704974220000 + 3 * q)
  assert.ok(Math.abs(first.illuminated - 0.5) < 0.02 && first.waxing)
  assert.ok(Math.abs(last.illuminated - 0.5) < 0.02 && !last.waxing)
  for (const ms of [0, -5e12, 4e12, 1757000000000]) {
    const p = phaseAt(ms)
    assert.ok(p.elongationDeg >= 0 && p.elongationDeg <= 360 && p.illuminated >= 0 && p.illuminated <= 1)
    assert.ok(dialMinute(0, p.elongationDeg) >= 0 && dialMinute(1439, p.elongationDeg) < 1440)
  }
})

test('Moon: up when it is up, drawn only when it can be seen', () => {
  const s = (minuteOfDay, e, rise = 360, set = 1080) => sky({ minuteOfDay, sunriseMinute: rise, sunsetMinute: set, moonElongationDeg: e })
  assert.ok(moonUp(s(0, 180)) && moonUp(s(23 * 60, 180)) && !moonUp(s(12 * 60, 180)), 'a full moon is up all night')
  assert.ok(moonUp(s(20 * 60, 90)) && !moonUp(s(4 * 60, 90)), 'a first quarter is up in the evening')
  assert.ok(!moonUp({ ...s(0, 180), polar: true, polarDay: false }) && moonUp({ ...s(0, 180), polar: true, polarDay: true }))
  const late = s(23 * 60, 0, 3 * 60, 60)
  assert.ok(sunUp(late) && moonUp(late), 'a sunset after midnight does not put everything below the horizon')
  assert.ok(!moonVisible(s(720, 354)), 'an old moon closing on the sun is not drawn')
  assert.ok(!moonVisible(s(720, MOON_MIN_ELONGATION_DEG - 0.1)) && moonVisible(s(720, MOON_MIN_ELONGATION_DEG + 0.1)))
  assert.ok(!moonVisible(s(720, 180)), 'below the horizon, however full')
  assert.ok(!moonUp(sky({})), 'no moon worked out yet')
})

test('the sky mix: the horizon is the hinge, it slides, night settles slower', () => {
  const mix = (m) => skyMix(m, 360, 1080, 60)
  assert.equal(mix(360), 0)
  assert.equal(mix(1080), 0)
  let prev = mix(270)
  for (let m = 271; m <= 450; m++) {
    const now = mix(m)
    assert.ok(now - prev >= -0.0001 && now - prev < 0.06, `at ${m}`)
    prev = now
  }
  const toDay = [...Array(301).keys()].find((i) => mix(360 + i) >= 1)
  const toNight = [...Array(301).keys()].find((i) => mix(1080 + i) <= -1)
  assert.ok(toNight > toDay)
  assert.equal(mix(360 + 45), 1)
  assert.ok(mix(1080 + 45) > -1)
  assert.equal(skyMix(23 * 60, 3 * 60, 60), 1, 'a sunset after midnight still reads as day')
  for (let m = 0; m < MINUTES_IN_DAY; m += 137) {
    assert.equal(skyMix(m, 0, 0, 60, true, true), 1)
    assert.equal(skyMix(m, 0, 0, 60, true, false), -1)
  }
  assert.equal(skyMix(540, 360, 360), -1, 'a day with no length is night')
  for (let m = 0; m < MINUTES_IN_DAY; m++) assert.ok(mix(m) >= -1 && mix(m) <= 1)
})

test('the WMO bands land where they should; unknown is clear', () => {
  assert.equal(weatherOf(0), 'CLEAR')
  assert.equal(weatherOf(1), 'CLEAR')
  assert.equal(weatherOf(3), 'CLOUD')
  assert.equal(weatherOf(45), 'FOG')
  assert.equal(weatherOf(53), 'DRIZZLE')
  assert.equal(weatherOf(65), 'RAIN')
  assert.equal(weatherOf(81), 'RAIN')
  assert.equal(weatherOf(75), 'SNOW')
  assert.equal(weatherOf(86), 'SNOW')
  assert.equal(weatherOf(66), 'SLEET')
  assert.equal(weatherOf(95), 'THUNDER')
  for (const c of [null, 7, -1, 1000]) assert.equal(weatherOf(c), 'CLEAR')
})

test('the forecast: high and low with their hours, gaps, clamps, nothing without a current reading', () => {
  const s = parseForecast(`{"latitude":42.36,"longitude":-71.06,
    "current":{"time":"2026-09-11T14:00","temperature_2m":21.4,"cloud_cover":40},
    "hourly":{"time":["2026-09-11T00:00","2026-09-11T05:00","2026-09-11T15:00","2026-09-11T23:00"],
              "temperature_2m":[13.0,9.5,24.2,15.1]}}`)
  assert.equal(s.highC, 24.2)
  assert.equal(s.highAtMinute, 15 * 60)
  assert.equal(s.lowC, 9.5)
  assert.equal(s.lowAtMinute, 5 * 60)
  assert.equal(s.cloudCover, 0.4)
  const flat = parseForecast('{"current":{"temperature_2m":10.0},"hourly":{"time":["2026-09-11T09:00","2026-09-11T09:00"],"temperature_2m":[10.0,10.0]}}')
  assert.equal(flat.highAtMinute, flat.lowAtMinute)
  assert.ok(!marksDistinct(flat))
  const ragged = parseForecast('{"current":{"temperature_2m":12.0},"hourly":{"time":["2026-09-11T06:00","2026-09-11T07:00","2026-09-11T18:00"],"temperature_2m":[5.0,null,20.0]}}')
  assert.equal(ragged.highC, 20)
  assert.equal(ragged.lowC, 5)
  const bare = parseForecast('{"current":{"temperature_2m":7.0}}')
  assert.equal(bare.currentC, 7)
  assert.equal(bare.highC, null)
  assert.equal(bare.highAtMinute, null)
  assert.equal(bare.condition, 'CLEAR')
  assert.equal(parseForecast('{"hourly":{"time":[],"temperature_2m":[]}}'), null)
  assert.equal(parseForecast('not json'), null)
  assert.equal(parseForecast(''), null)
  assert.equal(parseForecast('{"current":{"temperature_2m":1.0,"cloud_cover":140}}').cloudCover, 1)
  const snow = parseForecast('{"current":{"temperature_2m":3.0,"cloud_cover":90,"weather_code":73}}')
  assert.equal(snow.condition, 'SNOW')
  assert.equal(snow.cloudCover, 0.9)
  //  hour by hour, a gap filled from the hour before, and the zone
  const hours = parseForecast(JSON.stringify({
    timezone: 'Europe/Lisbon',
    current: { temperature_2m: 18 },
    hourly: { time: ['2026-09-11T02:00', '2026-09-11T05:00'], temperature_2m: [15, 14], cloud_cover: [80, 20], weather_code: [61, 0] },
  }))
  assert.deepEqual(hours.hourlyCloud.slice(0, 7), [0, 0, 0.8, 0.8, 0.8, 0.2, 0.2])
  assert.equal(hours.hourlyCondition[2], 'RAIN')
  assert.equal(hours.zoneId, 'Europe/Lisbon')
})

test('the weather request sends a rounded position, and half an hour is fresh', () => {
  assert.equal(requestUrl({ lat: 42.36789, lon: -71.06912 }),
    'https://api.open-meteo.com/v1/forecast?latitude=42.36&longitude=-71.06&current=temperature_2m,cloud_cover,weather_code&hourly=temperature_2m,cloud_cover,weather_code&forecast_days=1&timezone=auto')
  assert.ok(weatherIsStale(0, 1000))
  assert.ok(!weatherIsStale(1000, 1000 + 29 * 60000))
  assert.ok(weatherIsStale(1000, 1000 + 30 * 60000))
  assert.ok(weatherIsStale(5000, 1000), 'a clock that went back')
})

test('places: the search, its answer, and coordinates that never leave', () => {
  assert.equal(placesUrl(' St. John\'s '), 'https://geocoding-api.open-meteo.com/v1/search?name=St.%20John\'s&count=8&format=json')
  assert.deepEqual(placesOf({ results: [
    { name: 'Lisbon', latitude: 38.72, longitude: -9.13, elevation: 45, timezone: 'Europe/Lisbon', admin1: 'Lisbon', country: 'Portugal' },
    { name: 'Nowhere' },
  ] }), [{ lat: 38.72, lon: -9.13, label: 'Lisbon, Portugal', elevationMetres: 45, timeZoneId: 'Europe/Lisbon' }])
  assert.deepEqual(placesOf({}), [])
  assert.deepEqual(coordsOf(' 51.5, -0.13 '), { lat: 51.5, lon: -0.13, label: '51.5, -0.13', elevationMetres: null, timeZoneId: null })
  assert.equal(coordsOf('91, 0'), null)
  assert.equal(coordsOf('London'), null)
})

test('a place across the world runs on its own clock', () => {
  const at = Date.UTC(2026, 9, 8, 22, 30) // 22:30 UTC, 8 October
  const z = zoneParts(at, 'Pacific/Auckland')
  assert.equal(z.offsetMinutes, 13 * 60, 'NZDT')
  assert.equal(z.minuteOfDay, 11 * 60 + 30)
  assert.equal(z.day, 9)
  assert.equal(z.dayOfYear, 282)
  assert.equal(zoneParts(at, 'Not/AZone').minuteOfDay, zoneParts(at).minuteOfDay, 'an unknown zone is the browser\'s')
  const s = skyFor(at, { lat: -36.85, lon: 174.76, label: 'Auckland', timeZoneId: 'Pacific/Auckland' }, null)
  assert.equal(s.minuteOfDay, 11 * 60 + 30)
  assert.equal(s.dateLabel, 'Oct 9th')
  assert.ok(s.sunriseMinute > 5 * 60 + 30 && s.sunriseMinute < 7 * 60 + 30, clockLabel(s.sunriseMinute, true))
  assert.ok(sunUp(s), 'late morning in Auckland')
  const none = skyFor(at, null, null)
  assert.equal(none.sunriseMinute, 360, 'no place: an even day')
  assert.equal(none.currentC, null)
  assert.ok(none.moonElongationDeg >= 0)
})

test('labels: the clock, the temperature, the date', () => {
  assert.equal(clockLabel(0, false), '12:00 AM')
  assert.equal(clockLabel(12 * 60 + 5, false), '12:05 PM')
  assert.equal(clockLabel(13 * 60 + 9, true), '13:09')
  assert.equal(clockLabel(-1, true), '23:59')
  assert.equal(tempLabel(21.4, true), '71°')
  assert.equal(tempLabel(21.4, false), '21°')
  assert.equal(dayLabel(10, 1), 'Oct 1st')
  assert.equal(dayLabel(10, 2), 'Oct 2nd')
  assert.equal(dayLabel(10, 3), 'Oct 3rd')
  assert.equal(dayLabel(10, 11), 'Oct 11th')
  assert.equal(dayLabel(10, 22), 'Oct 22nd')
  assert.equal(angleOf(12 * 60), 0)
  assert.equal(angleOf(0), -180)
  assert.equal(angleOf(18 * 60), 90)
  assert.ok(isUpAt(12 * 60, 360, 1080) && !isUpAt(0, 360, 1080))
  assert.equal(dialDescription(sky({ minuteOfDay: 720, highC: 20, highAtMinute: 900, condition: 'RAIN' }), false, true),
    'The sun is up. It sets at 18:00. 12 hours and 0 minutes of daylight. Rain. High 20° at 15:00.')
})

test('clouds: the cloudiest daylight hours, at most four, never within two and a half hours', () => {
  const hourly = Array(24).fill(0)
  for (const h of [9, 10, 11, 14, 15, 16, 17, 22]) hourly[h] = 0.9
  hourly[10] = 1
  const at = cloudMinutes(hourly, 0, 360, 720)
  assert.ok(at.length <= 4 && at.length > 0)
  for (let i = 1; i < at.length; i++) assert.ok(at[i][0] - at[i - 1][0] >= 150)
  assert.ok(at.every(([m]) => m >= 360 + 45 && m <= 1080 - 45), 'daylight only, off the ends')
  assert.ok(at.some(([m]) => m === 600), 'the cloudiest hour is taken')
  assert.deepEqual(cloudMinutes([], 0.1, 360, 720), [], 'thin cloud is no cloud')
  assert.equal(cloudMinutes([], 1, 360, 720).length, 4, 'no hourly cover: the current one everywhere')
  assert.deepEqual(cloudMinutes([], 1, 360, 100), [], 'a day too short for one')
})

test('stars sit still, in range; gloom slides between hours; marks warm and cool', () => {
  for (let i = 0; i < 50; i++) {
    const n = starNoise(i, 3)
    assert.ok(n >= 0 && n <= 1)
    assert.equal(starNoise(i, 3), n)
  }
  assert.notEqual(starNoise(5, 1), starNoise(5, 2))
  const hourly = Array(24).fill('CLEAR')
  hourly[4] = 'RAIN'
  assert.equal(gloomAt(4 * 60, hourly, 'CLEAR'), 0.38)
  assert.equal(gloomAt(3 * 60 + 30, hourly, 'CLEAR'), 0.19)
  assert.equal(gloomAt(600, [], 'THUNDER'), 0.55)
  const [r1, , b1] = markColor(35)
  const [r2, , b2] = markColor(-5)
  assert.ok(r1 > b1 && b2 > r2)
})
