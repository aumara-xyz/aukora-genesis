#!/usr/bin/env node
/**
 * Themed acrostic with maximal pools: the measured bits, the size floors, and a story that adds none.
 *
 *   node tests/aukora-aumlok-drop-theme.test.mjs
 *   node tests/aukora-aumlok-drop-theme.test.mjs --mutate
 *
 * WHAT A PASS MEANS. The ceremony draw picks each acrostic word from that position's theme
 * (NATURE, NATURE, PEOPLE, PEOPLE, SPIRIT, SPIRIT). `measure()` reports that draw. The figure
 * is under 128 bits and under 256 bits. The screen copy states the same figure. A story hook
 * cannot call a cloud. Shrinking the anchor list under 1024, or any admitted theme bucket under
 * 40, fails. Those floors sit under the expanded pools and above the old 150-anchor, 12-word buckets.
 *
 * WHAT A PASS DOES NOT MEAN. It was not run inside Peter's installed app. It does not say a
 * person approved anything. It does not say the phrase is a 256-bit secret. scrypt's output
 * length is not this figure.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  THEME_BY_POSITION,
  honestEntropyClause,
  loadThemes,
  measure,
} from '../plugins/aukora-aumlok/lib/themed-entropy.mjs'
import { mnemonicStory } from '../plugins/aukora-aumlok/lib/mnemonic-story.mjs'
import {
  admittedLetters,
  composePhrase,
  createAumlokDraw,
  drawableAnchors,
  indexLetterPools,
} from '../apps/aukora-desktop/aumlok-draw.mjs'
import { generateAcrosticPhrase } from '../plugins/aukora-aumlok/lib/ceremony-phrase.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DRAW_PATH = join(ROOT, 'apps/aukora-desktop/aumlok-draw.mjs')
const ENTROPY_PATH = join(ROOT, 'plugins/aukora-aumlok/lib/themed-entropy.mjs')
const STORY_PATH = join(ROOT, 'plugins/aukora-aumlok/lib/mnemonic-story.mjs')
const LOCALES = join(ROOT, 'plugins/aukora-face/aumlok/src/client/locales.ts')
const BUNDLE = join(ROOT, 'plugins/aukora-face/aumlok/lib/client.js')
const SURFACE = join(ROOT, 'plugins/aukora-face/aumlok/src/client/surface-state.ts')
const CSS = join(ROOT, 'plugins/aukora-face/aumlok/src/client/Aumlok.module.css')
const DERIVE = join(ROOT, 'plugins/aukora-aumlok/lib/derive-v3.mjs')

/** Chosen after the maximal theme pools measured 1364 anchors and a thinnest admitted bucket of 49. */
const FLOOR_ANCHORS = 1024
const FLOOR_BUCKET = 40

const FRUIT = ['apple', 'banana', 'grape', 'lemon', 'mango', 'orange', 'peach', 'pear', 'plum', 'tomato']

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

/** The live draw indexes a position's theme. A flat letter pool does not. */
export function themeIndexPresent(source) {
  return /THEME_BY_POSITION\s*\[/u.test(source)
}

if (process.argv.includes('--mutate')) {
  const source = readFileSync(DRAW_PATH, 'utf8')
  const needle = 'THEME_BY_POSITION[row]'
  const hits = source.split(needle).length - 1
  if (hits < 1) {
    console.error(`MUTATION NOT-APPLICABLE: theme index matched ${hits} times`)
    process.exit(1)
  }
  const mutant = source.split(needle).join('anchor[row]')
  if (themeIndexPresent(mutant) || !themeIndexPresent(source)) {
    console.error('MUTATION MISSED: dropping the theme index was not detected, or the shipped file has none')
    process.exit(1)
  }
  console.log('MUTATION ARMS: 1 run, 1 detected, 0 missed')
  process.exit(0)
}

check('measure is the themed pool and is not 128 or 256 bits', () => {
  const m = measure()
  assert.equal(m.selection, 'themed-maximal-pool')
  assert.equal(m.themeRestriction, true)
  assert.equal(m.floorBits, null)
  assert.ok(m.bits > 55, `weakest ${m.bits} fell back toward the old 34.14 or 44.87`)
  assert.ok(m.bits < 128)
  assert.ok(m.strongestBits > m.bits)
  assert.ok(m.strongestBits < 128)
  assert.ok(m.strongestBits < 256)
  assert.equal(m.anchorCount >= FLOOR_ANCHORS, true, `anchors ${m.anchorCount}`)
  const clause = honestEntropyClause(m)
  assert.match(clause, /not 128 bits/)
  assert.match(clause, /not 256 bits/)
  assert.ok(clause.includes(m.bits.toFixed(2)))
  assert.ok(clause.includes(m.strongestBits.toFixed(2)))
  console.log(`    MEASURED weakest ${m.bits} strongest ${m.strongestBits} anchors ${m.anchorCount} letters ${m.anchorLetters.join('')} limiting ${m.limitingAnchor}`)
})

check('anchor count and per-theme buckets stay above the floors', () => {
  const m = measure()
  const data = loadThemes()
  const themes = JSON.parse(readFileSync(join(ROOT, 'plugins/aukora-aumlok/data/aumlok-themes.json'), 'utf8'))
  const anchorDoc = JSON.parse(readFileSync(join(ROOT, 'plugins/aukora-aumlok/data/aumlok-anchors.json'), 'utf8'))
  const pools = indexLetterPools(themes)
  const letters = admittedLetters(themes, anchorDoc.anchors)
  const usable = drawableAnchors(anchorDoc, pools, letters)
  assert.equal(usable.length, m.anchorCount)
  assert.ok(usable.length >= FLOOR_ANCHORS)
  for (const letter of m.anchorLetters) {
    for (const theme of ['NATURE', 'PEOPLE', 'SPIRIT']) {
      const size = m.counts[theme]?.[letter] ?? 0
      assert.ok(size >= FLOOR_BUCKET, `${theme} ${letter} has ${size}, floor is ${FLOOR_BUCKET}`)
      assert.equal(pools[theme][letter].length, size)
    }
  }
  let weakest = Infinity
  for (const anchor of usable) {
    const used = {}
    let sum = 0
    for (let i = 0; i < anchor.length; i++) {
      const theme = THEME_BY_POSITION[i]
      const key = `${theme}:${anchor[i]}`
      const already = used[key] ?? 0
      const size = m.counts[theme][anchor[i]] - already
      assert.ok(size > 0)
      used[key] = already + 1
      sum += Math.log2(size)
    }
    if (sum < weakest) weakest = sum
  }
  const recomputed = Math.log2(usable.length) + weakest
  assert.ok(Math.abs(recomputed - m.bits) < 1e-9)
  assert.equal(data.selection, 'themed-maximal-pool')
})

check('a position draws its own theme, not another theme\'s word', () => {
  const pools = {
    NATURE: { h: ['hazel'], a: ['amber'], r: ['river'], b: ['brook'], o: ['oak'] },
    PEOPLE: { h: ['hearth'], a: ['ally'], r: ['rally'], b: ['bond'], o: ['oath'] },
    SPIRIT: { h: ['halo'], a: ['altar'], r: ['rise'], b: ['beacon'], o: ['omen'] },
  }
  const composed = composePhrase('harbor', pools, (list) => list[0])
  assert.equal(composed.ok, true)
  assert.deepEqual(composed.words, ['hazel', 'amber', 'rally', 'bond', 'omen', 'rise'])
  assert.equal(composed.words.includes('halo'), false)
  composed.words.forEach((word, index) => {
    assert.equal(word[0], 'harbor'[index])
  })
})

check('the shipped draw indexes a theme, and dropping that index is visible', () => {
  const source = readFileSync(DRAW_PATH, 'utf8')
  const entropy = readFileSync(ENTROPY_PATH, 'utf8')
  assert.equal(themeIndexPresent(source), true)
  assert.equal(themeIndexPresent(entropy), true)
  assert.match(source, /pools\[theme\]/)
  const mutant = source.split('THEME_BY_POSITION[row]').join('anchor[row]')
  assert.equal(themeIndexPresent(mutant), false)
})

check('the ceremony draw keeps the acrostic and attaches a local story with zero entropy', () => {
  const told = createAumlokDraw({
    story: (words) => `Once ${words[0]} kept ${words[1]}.`,
  })
  const drawn = told.draw('owner', 'bind', ROOT)
  assert.equal(drawn.ok, true)
  assert.equal(drawn.words.length, 7)
  const anchor = drawn.words[0]
  assert.equal(anchor.length, 6)
  for (let i = 0; i < 6; i++) assert.equal(drawn.words[i + 1][0], anchor[i])
  assert.equal(drawn.storyEntropyBits, 0)
  assert.equal(drawn.storyAuthoritative, false)
  assert.match(drawn.story, /^Once /)
  const plain = createAumlokDraw()
  const bare = plain.draw('owner', 'bind', ROOT)
  assert.equal(bare.ok, true)
  assert.equal(bare.story, undefined)
  const cloud = createAumlokDraw({ story: 'https://api.openai.com/v1/chat' })
  const refused = cloud.draw('owner', 'bind', ROOT)
  assert.equal(refused.ok, true)
  assert.equal(refused.story, undefined)
  assert.equal(refused.words.length, 7)
})

check('the story hook fail-closes and never contributes entropy', () => {
  const words = ['harbor', 'hazel', 'amber', 'river', 'brook', 'oak', 'reed']
  const absent = mnemonicStory(words)
  assert.equal(absent.story, null)
  assert.equal(absent.entropyBits, 0)
  assert.equal(absent.authoritative, false)
  const remote = mnemonicStory(words, 'https://example.com/model')
  assert.equal(remote.reason, 'aumlok:story-cloud-refused')
  assert.equal(remote.local, false)
  assert.equal(remote.story, null)
  const path = mnemonicStory(words, '/usr/local/bin/ollama')
  assert.equal(path.reason, 'aumlok:story-path-not-invoked')
  assert.equal(path.story, null)
  const local = mnemonicStory(words, (seven) => `A ${seven[3]} and a ${seven[4]}.`)
  assert.equal(local.entropyBits, 0)
  assert.equal(local.authoritative, false)
  assert.equal(local.local, true)
  assert.match(local.story, /river/)
  const pending = mnemonicStory(words, () => Promise.resolve('nope'))
  assert.equal(pending.reason, 'aumlok:story-async-refused')
  assert.equal(pending.story, null)
  const storySrc = readFileSync(STORY_PATH, 'utf8')
  const drawSrc = readFileSync(DRAW_PATH, 'utf8')
  for (const src of [storySrc, drawSrc]) {
    assert.doesNotMatch(src, /\bfetch\s*\(/u)
    assert.doesNotMatch(src, /from 'node:http'/u)
    assert.doesNotMatch(src, /from 'node:net'/u)
  }
})

check('screen copy states the measured bits and does not claim 128 or 256 bits', () => {
  const m = measure()
  const weak = m.bits.toFixed(2)
  const strong = m.strongestBits.toFixed(2)
  for (const path of [LOCALES, BUNDLE]) {
    const text = readFileSync(path, 'utf8')
    assert.ok(text.includes(weak), path)
    assert.ok(text.includes(strong), path)
    assert.match(text, /Not 128 bits/)
    assert.match(text, /Not 256 bits/)
    assert.match(text, /不是 128 比特/)
    assert.match(text, /不是 256 比特/)
    assert.doesNotMatch(text, /128-bit (key|security|strength|entropy)/u)
    assert.doesNotMatch(text, /256-bit (key|security|strength|entropy|phrase)/u)
    assert.doesNotMatch(text, /worth 128 bits/u)
    assert.doesNotMatch(text, /worth 256 bits/u)
  }
  const bands = readFileSync(SURFACE, 'utf8')
  assert.match(bands, /tone: 'green'/)
  assert.match(bands, /tone: 'blue'/)
  assert.match(bands, /tone: 'purple'/)
  const css = readFileSync(CSS, 'utf8')
  assert.match(css, /data-aumlok-tone='green'/)
  assert.match(css, /data-aumlok-tone='blue'/)
  assert.match(css, /data-aumlok-tone='purple'/)
})

check('fruit stays in Nature, the block list is absent, and the KDF does not read a theme', () => {
  const themes = JSON.parse(readFileSync(join(ROOT, 'plugins/aukora-aumlok/data/aumlok-themes.json'), 'utf8'))
  const block = JSON.parse(readFileSync(join(ROOT, 'plugins/aukora-aumlok/data/safety/profanity-block.json'), 'utf8'))
  const blocked = new Set(block.words)
  for (const word of FRUIT) {
    const letter = word[0]
    assert.ok(themes.themes.NATURE[letter].includes(word), `NATURE missing ${word}`)
    assert.equal(themes.themes.PEOPLE[letter].includes(word), false, `PEOPLE still has ${word}`)
  }
  for (const theme of ['NATURE', 'PEOPLE', 'SPIRIT']) {
    for (const words of Object.values(themes.themes[theme])) {
      for (const word of words) {
        assert.equal(blocked.has(word), false, `${theme} ships blocked ${word}`)
      }
    }
  }
  const derive = readFileSync(DERIVE, 'utf8')
  assert.doesNotMatch(derive, /\bNATURE\b/u)
  assert.doesNotMatch(derive, /\bPEOPLE\b/u)
  assert.doesNotMatch(derive, /\bSPIRIT\b/u)
  assert.match(derive, /scrypt/)
})

check('the small in-file generator is an acrostic and is not the ceremony pools', () => {
  const phrase = generateAcrosticPhrase()
  assert.equal(phrase.tokens.length, 7)
  assert.equal(phrase.anchor.length, 6)
  phrase.words.forEach((word, index) => {
    assert.equal(word[0], phrase.anchor[index])
  })
  const src = readFileSync(join(ROOT, 'plugins/aukora-aumlok/lib/ceremony-phrase.mjs'), 'utf8')
  assert.match(src, /NOT THE CEREMONY DRAW/)
})

console.log(`THEMED-POOLS: ${passed} checks passed`)
