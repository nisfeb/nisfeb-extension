//  Two fixes proposed for lib/markdown.js and lib/gemtext.js, found by
//  urb-fetch's Rust core (docs/rust-core.md, "M5b's findings"), and held
//  here to what they replace until they move into lib/:
//
//  - ITEM backtracks: "- " + n spaces + "a\r" takes time quadratic in n.
//    itemText reads the item by hand, as headingText does, with ITEM's
//    result.
//  - linkTarget checks an urb:// ship with isShip, which checks shape
//    only, so urb://~abc and urb://~dozzod are reader links where
//    urb-fetch's gateway (mesa.ParseShip, libmesa's u3_ship_of_string)
//    shows text. isPatp is the gateway's rule: real syllables, written
//    as the ship they name is written.
//
//  The tests marked todo check lib/ itself, and pass once it has the
//  fixes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdown } from '../lib/markdown.js'
import { linkTarget } from '../lib/gemtext.js'

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/

//  ITEM.exec(line)?.[1], in one pass: null where ITEM fails
function itemText(line) {
  const s = line.trimStart()
  const m = /^(?:[-*+]|\d+[.)])/.exec(s)
  if (!m) return null
  const after = s.slice(m[0].length)
  const text = after.trimStart()
  if (text.length === after.length || /[\n\r\u2028\u2029]/.test(text)) return null
  return text
}

const PRE = 'dozmarbinwansamlitsighidfidlissogdirwacsabwissibrigsoldopmodfoglidhopdardorlorhodfolrintogsilmirholpaslacrovlivdalsatlibtabhanticpidtorbolfosdotlosdilforpilramtirwintadbicdifrocwidbisdasmidloprilnardapmolsanlocnovsitnidtipsicropwitnatpanminritpodmottamtolsavposnapnopsomfinfonbanmorworsipronnorbotwicsocwatdolmagpicdavbidbaltimtasmalligsivtagpadsaldivdactansidfabtarmonranniswolmispallasdismaprabtobrollatlonnodnavfignomnibpagsopralbilhaddocridmocpacravripfaltodtiltinhapmicfanpattaclabmogsimsonpinlomrictapfirhasbosbatpochactidhavsaplindibhosdabbitbarracparloddosbortochilmactomdigfilfasmithobharmighinradmashalraglagfadtopmophabnilnosmilfopfamdatnoldinhatnacrisfotribhocnimlarfitwalrapsarnalmoslandondanladdovrivbacpollaptalpitnambonrostonfodponsovnocsorlavmatmipfip'
const SUF = 'zodnecbudwessevpersutletfulpensytdurwepserwylsunrypsyxdyrnuphebpeglupdepdysputlughecryttyvsydnexlunmeplutseppesdelsulpedtemledtulmetwenbynhexfebpyldulhetmevruttylwydtepbesdexsefwycburderneppurrysrebdennutsubpetrulsynregtydsupsemwynrecmegnetsecmulnymtevwebsummutnyxrextebfushepbenmuswyxsymselrucdecwexsyrwetdylmynmesdetbetbeltuxtugmyrpelsyptermebsetdutdegtexsurfeltudnuxruxrenwytnubmedlytdusnebrumtynseglyxpunresredfunrevrefmectedrusbexlebduxrynnumpyxrygryxfeptyrtustyclegnemfermertenlusnussyltecmexpubrymtucfyllepdebbermughuttunbylsudpemdevlurdefbusbeprunmelpexdytbyttyplevmylwedducfurfexnulluclennerlexrupnedlecrydlydfenwelnydhusrelrudneshesfetdesretdunlernyrsebhulrylludremlysfynwerrycsugnysnyllyndyndemluxfedsedbecmunlyrtesmudnytbyrsenwegfyrmurtelreptegpecnelnevfes'

const syl = (table, s) => {
  for (let i = 0; i < table.length; i += 3) if (table.slice(i, i + 3) === s) return i / 3
  return -1
}

//  A ship name as the gateway reads one: a galaxy's syllable, or 16-bit
//  chunks of a prefix and a suffix, at most eight, most significant first,
//  joined by - (-- between a comet's halves), with no leading ~dozzod and
//  no leading doz on a star. That is, written exactly as the ship it names
//  is written, so ~dozzod (~zod) and ~doznec (~nec) are not names.
function isPatp(name) {
  if (!name.startsWith('~')) return false
  const s = name.slice(1)
  if (s.length === 3) return syl(SUF, s) >= 0
  let v = 0n
  let n = 0
  let i = 0
  while (i < s.length) {
    if (n >= 8 || s.length - i < 6) return false
    const p = syl(PRE, s.slice(i, i + 3))
    const q = syl(SUF, s.slice(i + 3, i + 6))
    if (p < 0 || q < 0) return false
    v = (v << 16n) | BigInt((p << 8) | q)
    n++
    i += 6
    while (s[i] === '-') i++
  }
  return n > 0 && render(v) === name
}

function render(v) {
  if (v < 0x100n) return `~${SUF.slice(Number(v) * 3, Number(v) * 3 + 3)}`
  let chunks = 0
  for (let x = v; x > 0n; x >>= 16n) chunks++
  let out = '~'
  for (let k = chunks - 1; k >= 0; k--) {
    const c = Number((v >> BigInt(16 * k)) & 0xffffn)
    out += PRE.slice((c >> 8) * 3, (c >> 8) * 3 + 3) + SUF.slice((c & 0xff) * 3, (c & 0xff) * 3 + 3)
    if (k > 0) out += k % 4 === 0 ? '--' : '-'
  }
  return out
}

//  xorshift32 from a fixed seed
function rng(seed) {
  let s = seed
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0 }
}

test('itemText gives what ITEM gives, on random lines', () => {
  const parts = ['-', '*', '+', '1', '23', '.', ')', ' ', ' ', '\t', '\u00a0', '\u3000', '\ufeff', '\u2028', '\r', '\n', '\v', 'a', '#', '- ', '1. ']
  const next = rng(0x2545f491)
  for (let i = 0; i < 100_000; i++) {
    let line = ''
    for (let n = next() % 12; n > 0; n--) line += parts[next() % parts.length]
    const m = ITEM.exec(line)
    assert.equal(itemText(line), m ? m[1] : null, JSON.stringify(line))
  }
})

test('itemText reads a 256 KB hostile line in linear time', () => {
  const line = '- ' + ' '.repeat(256 * 1024) + 'a\r'
  const t = performance.now()
  assert.equal(itemText(line), null)
  assert.ok(performance.now() - t < 100, 'itemText took over 100 ms')
})

test('lib/markdown.js reads the hostile item line in linear time', { todo: 'ITEM to itemText in lib/markdown.js' }, () => {
  const t = performance.now()
  markdown('- ' + ' '.repeat(20_000) + 'a\r')
  assert.ok(performance.now() - t < 100, 'markdown took over 100 ms')
})

//  The gateway's verdicts, each checked against urb-fetch's
//  mesa.ParseShip (as were 20,000 random names, with no difference)
const NAMES = [
  ['~zod', true], ['~nec', true], ['~marzod', true], ['~sampel-palnet', true], ['~mister-botter-dozzod-nisfeb', true],
  ['~doznec-dozzod-dozzod-marzod', true], ['~dasres-ragnep-lislyt-ribpyl--mosnyx-bisdem-nidful-marzod', true],
  ['~abc', false], ['~dozzod', false], ['~doznec', false], ['~dozzod-marzod', false], ['~dozzod-dozzod-marzod-marzod', false],
  ['~sampel--palnet', false], ['~sampel-palnet-', false], ['~zod-zod', false], ['~sampel-pal', false], ['~a-b-c', false],
  ['~', false], ['~Zod', false], ['~zodnec', false], ['~marzod-marzod-marzod', true],
]

test('isPatp: the gateway\'s ship names', () => {
  for (const [name, ok] of NAMES) assert.equal(isPatp(name), ok, name)
})

test('isPatp: every star, and random planets, are written as they render', () => {
  for (let v = 0x100; v < 0x10000; v++) assert.ok(isPatp(render(BigInt(v))))
  const next = rng(0x1b873593)
  for (let i = 0; i < 20_000; i++) {
    const v = BigInt(0x10000 + (next() % (0xffffffff - 0x10000)))
    assert.ok(isPatp(render(v)), render(v))
  }
})

test('linkTarget links only to a ship the gateway would', { todo: 'isShip to isPatp in linkTarget (lib/gemtext.js)' }, () => {
  for (const [name, ok] of NAMES) {
    if (!/^~[a-z-]+$/.test(name)) continue
    assert.equal(linkTarget('urb://~zod/a', `urb://${name}/x`), ok ? `urb://${name}/x` : '', name)
  }
})
