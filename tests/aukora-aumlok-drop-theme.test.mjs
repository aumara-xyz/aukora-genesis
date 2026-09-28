#!/usr/bin/env node
/**
 * Drop-theme acrostic: the full approved pool, the measured bits, and a story that adds none.
 *
 *   node tests/aukora-aumlok-drop-theme.test.mjs
 *   node tests/aukora-aumlok-drop-theme.test.mjs --mutate
 *
 * WHAT A PASS MEANS. The ceremony draw picks each acrostic word from the union of the shipped
 * tables for that letter. `measure()` reports that draw. The figure is under 128 bits. The English
 * screen copy states the same figure and does not claim 128 bits. A story hook cannot call a
 * cloud, and a mutation that indexes a row by NATURE/PEOPLE/SPIRIT is detected.
 *
 * WHAT A PASS DOES NOT MEAN. It was not run inside Peter's installed app. It does not say a
 * person approved anything. It does not say the phrase is a 128-bit secret.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  THEME_BY_POSITION,
  approvedPoolCounts,
  bucketCounts,
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

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

/** A position-indexed theme array is the restriction this change removes. */
export function themeRestrictionPresent(source) {
  return /ROW_THEMES\s*\[/u.test(source) || /THEME_BY_POSITION\s*\[/u.test(source)
}

function themedSum(counts, anchor) {
  let sum = 0
  for (let i = 0; i < anchor.length; i++) {
    const n = counts[THEME_BY_POSITION[i]]?.[anchor[i]] ?? 0
    if (n <= 0) return null
    sum += Math.log2(n)
  }
  return sum
}

if (process.argv.includes('--mutate')) {
  const source = readFileSync(DRAW_PATH, 'utf8')
  const needle = 'const pool = pools[anchor[row]] ?? []'
  const hits = source.split(needle).length - 1
  if (hits !== 1) {
    console.error(`MUTATION NOT-APPLICABLE: draw needle matched ${hits} times`)
    process.exit(1)
  }
  const mutant = source.replace(
    needle,
    'const ROW_THEMES = ["NATURE","NATURE","PEOPLE","PEOPLE","SPIRIT","SPIRIT"]\n    const pool = pools[ROW_THEMES[row]]?.[anchor[row]] ?? []',
  )
  if (!themeRestrictionPresent(mutant) || themeRestrictionPresent(source)) {
    console.error('MUTATION MISSED: the theme-index injection was not detected, or the shipped file already has it')
    process.exit(1)
  }
  console.log('MUTATION ARMS: 1 run, 1 detected, 0 missed')
  process.exit(0)
}

check('measure is the drop-theme full pool and is not 128 bits', () => {
  const m = measure()
  assert.equal(m.selection, 'drop-theme-full-pool')
  assert.equal(m.themeRestriction, false)
  assert.equal(m.floorBits, null)
  assert.ok(m.bits > 40, `weakest ${m.bits} fell back toward the themed 34.14`)
  assert.ok(m.bits < 128)
  assert.ok(m.strongestBits > m.bits)
  assert.ok(m.strongestBits < 128)
  assert.equal(m.anchorCount >= 128, true)
  const clause = honestEntropyClause(m)
  assert.match(clause, /not 128 bits/)
  assert.ok(clause.includes(m.bits.toFixed(2)))
  assert.ok(clause.includes(m.strongestBits.toFixed(2)))
})

check('the measured weakest beats the retired theme split on the same anchors', () => {
  const m = measure()
  const data = loadThemes()
  const counts = bucketCounts(data)
  const themes = JSON.parse(readFileSync(join(ROOT, 'plugins/aukora-aumlok/data/aumlok-themes.json'), 'utf8'))
  const anchorDoc = JSON.parse(readFileSync(join(ROOT, 'plugins/aukora-aumlok/data/aumlok-anchors.json'), 'utf8'))
  const pools = indexLetterPools(themes)
  const letters = admittedLetters(themes, anchorDoc.anchors)
  const usable = drawableAnchors(anchorDoc, pools, letters)
  assert.equal(usable.length, m.anchorCount)
  let themedMin = Infinity
  for (const anchor of usable) {
    const sum = themedSum(counts, anchor)
    assert.notEqual(sum, null)
    if (sum < themedMin) themedMin = sum
  }
  const themedBits = Math.log2(usable.length) + themedMin
  assert.ok(m.bits > themedBits + 1, `drop-theme ${m.bits} is not above themed ${themedBits}`)
  const poolsCounts = approvedPoolCounts(data)
  let mergedMin = Infinity
  for (const anchor of usable) {
    const used = {}
    let sum = 0
    for (const letter of anchor) {
      const already = used[letter] ?? 0
      const size = poolsCounts[letter] - already
      assert.ok(size > 0)
      used[letter] = already + 1
      sum += Math.log2(size)
    }
    if (sum < mergedMin) mergedMin = sum
  }
  const mergedBits = Math.log2(usable.length) + mergedMin
  assert.ok(Math.abs(mergedBits - m.bits) < 1e-9)
})

check('a position can draw a word the old row theme did not hold', () => {
  const themes = {
    themes: {
      NATURE: { h: ['hazel'], a: ['amber'], r: ['river', 'reed'], b: ['brook'], o: ['oak'] },
      PEOPLE: { h: ['hearth'], a: ['ally'], r: ['rally'], b: ['bond'], o: ['oath'] },
      SPIRIT: { h: ['halo'], a: ['altar'], r: ['rise'], b: ['beacon'], o: ['omen'] },
    },
  }
  const pools = indexLetterPools(themes)
  assert.deepEqual(pools.h, ['hazel', 'hearth', 'halo'])
  const composed = composePhrase('harbor', pools, (list) => list[list.length - 1])
  assert.equal(composed.ok, true)
  assert.equal(composed.words[0], 'halo')
  assert.equal(composed.words.join('').length > 0, true)
  const anchor = 'harbor'
  composed.words.forEach((word, index) => {
    assert.equal(word[0], anchor[index])
  })
})

check('the shipped draw file does not index a theme, and the mutation does', () => {
  const source = readFileSync(DRAW_PATH, 'utf8')
  const entropy = readFileSync(ENTROPY_PATH, 'utf8')
  assert.equal(themeRestrictionPresent(source), false)
  assert.equal(themeRestrictionPresent(entropy), false)
  assert.match(source, /pools\[anchor\[row\]\]/)
  const mutant = source.replace(
    'const pool = pools[anchor[row]] ?? []',
    'const pool = pools[ROW_THEMES[row]] ?? []',
  )
  assert.equal(themeRestrictionPresent(mutant), true)
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

check('screen copy states the measured bits, keeps the three colours, and does not claim 128 bits', () => {
  const m = measure()
  const weak = m.bits.toFixed(2)
  const strong = m.strongestBits.toFixed(2)
  for (const path of [LOCALES, BUNDLE]) {
    const text = readFileSync(path, 'utf8')
    assert.ok(text.includes(weak), path)
    assert.ok(text.includes(strong), path)
    assert.match(text, /Not 128 bits/)
    assert.match(text, /不是 128 比特/)
    assert.doesNotMatch(text, /of the earth/)
    assert.doesNotMatch(text, /128-bit (key|security|strength|entropy)/u)
    assert.doesNotMatch(text, /worth 128 bits/u)
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

check('an old themed word is still in the approved pool, and the KDF does not read a theme', () => {
  const themes = JSON.parse(readFileSync(join(ROOT, 'plugins/aukora-aumlok/data/aumlok-themes.json'), 'utf8'))
  const pools = indexLetterPools(themes)
  const ceremonyWord = /^[a-z]{4,9}$/u
  for (const theme of ['NATURE', 'PEOPLE', 'SPIRIT']) {
    for (const [letter, words] of Object.entries(themes.themes[theme])) {
      if (!Array.isArray(words)) continue
      for (const word of words) {
        if (typeof word !== 'string' || !ceremonyWord.test(word)) continue
        assert.equal(word[0], letter, `${theme} ${word} is filed under ${letter}`)
        assert.ok(pools[letter].includes(word), `${theme} ${word}`)
      }
    }
  }
  const derive = readFileSync(DERIVE, 'utf8')
  assert.doesNotMatch(derive, /\bNATURE\b/u)
  assert.doesNotMatch(derive, /\bPEOPLE\b/u)
  assert.doesNotMatch(derive, /\bSPIRIT\b/u)
})

check('the small in-file generator is an acrostic and does not index a row theme', () => {
  const phrase = generateAcrosticPhrase()
  assert.equal(phrase.tokens.length, 7)
  assert.equal(phrase.anchor.length, 6)
  phrase.words.forEach((word, index) => {
    assert.equal(word[0], phrase.anchor[index])
  })
  const src = readFileSync(join(ROOT, 'plugins/aukora-aumlok/lib/ceremony-phrase.mjs'), 'utf8')
  assert.equal(themeRestrictionPresent(src), false)
})

console.log(`DROP-THEME: ${passed} checks passed`)
