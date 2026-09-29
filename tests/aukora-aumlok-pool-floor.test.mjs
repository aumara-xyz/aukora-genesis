// The pool floor under the Nature / People / Spirit acrostic.
//
//   node tests/aukora-aumlok-pool-floor.test.mjs
//
// Word 0 is a six-letter anchor. Words 1-6 spell it: positions 0-1 NATURE,
// 2-3 PEOPLE, 4-5 SPIRIT. This court recomputes the min-entropy from the
// shipped lists and refuses a shrink of the anchor list or of a letter bucket
// the anchors actually draw. It also refuses a sentence that calls the phrase
// a 256-bit or 128-bit secret. The number is the measured one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAumlokDraw } from '../apps/aukora-desktop/aumlok-draw.mjs'
import {
  MIN_ANCHOR_POOL,
  MIN_WORDS_PER_BUCKET,
  THEME_BY_POSITION,
  WORD_PATTERN,
  formatEntropyLine,
  measure,
  phraseEntropySentence,
} from '../plugins/aukora-aumlok/lib/themed-entropy.mjs'

const themes = JSON.parse(readFileSync(new URL('../plugins/aukora-aumlok/data/aumlok-themes.json', import.meta.url), 'utf8'))
const anchorDoc = JSON.parse(readFileSync(new URL('../plugins/aukora-aumlok/data/aumlok-anchors.json', import.meta.url), 'utf8'))
const block = new Set(JSON.parse(readFileSync(new URL('../plugins/aukora-aumlok/data/safety/profanity-block.json', import.meta.url), 'utf8')).words)

const measured = measure()
assert.deepEqual([...THEME_BY_POSITION], ['NATURE', 'NATURE', 'PEOPLE', 'PEOPLE', 'SPIRIT', 'SPIRIT'])
assert.ok(measured.anchorCount >= MIN_ANCHOR_POOL, `anchors ${measured.anchorCount} below ${MIN_ANCHOR_POOL}`)
assert.ok(measured.bits < 128, 'phrase entropy is not 128 bits')
assert.ok(measured.bits >= 39.7, `bits ${measured.bits} fell below the shipped floor`)
assert.equal(measured.minBucket >= MIN_WORDS_PER_BUCKET, true)

const sentence = phraseEntropySentence(measured)
assert.match(sentence, /not a 256-bit secret/)
assert.match(sentence, /not a 128-bit secret/)
assert.match(sentence, new RegExp(measured.bits.toFixed(2)))
assert.match(formatEntropyLine(measured), /not 256-bit/)
assert.doesNotMatch(sentence, /phrase is a 256-bit/)

for (const anchor of anchorDoc.anchors) {
  assert.match(anchor, /^[a-z]{6}$/)
  assert.equal(block.has(anchor), false, anchor)
  for (let i = 0; i < 6; i += 1) {
    const theme = THEME_BY_POSITION[i]
    const bucket = themes.themes[theme][anchor[i]]
    assert.ok(bucket && bucket.length >= MIN_WORDS_PER_BUCKET, `${theme}/${anchor[i]} under ${anchor}`)
  }
}

for (const theme of ['NATURE', 'PEOPLE', 'SPIRIT']) {
  for (const [letter, words] of Object.entries(themes.themes[theme])) {
    assert.ok(words.length >= MIN_WORDS_PER_BUCKET, `${theme}/${letter}`)
    for (const word of words) {
      assert.match(word, WORD_PATTERN)
      assert.equal(word[0], letter)
      assert.equal(block.has(word), false, word)
    }
  }
}

const draw = createAumlokDraw({
  readData(_releaseDir, name) {
    const file = String(name).endsWith('.json') ? String(name) : `${name}.json`
    return JSON.parse(readFileSync(new URL(`../plugins/aukora-aumlok/data/${file}`, import.meta.url), 'utf8'))
  },
  randomInt() { return 0 },
})
const phrase = draw.draw('court', 'bind', '/court')
assert.equal(phrase.ok, true, phrase.reason)
assert.equal(phrase.words.length, 7)
for (let i = 0; i < 6; i += 1) {
  const word = phrase.words[i + 1]
  assert.equal(word[0], phrase.words[0][i])
  assert.ok(themes.themes[THEME_BY_POSITION[i]][word[0]].includes(word))
}

console.log(`pool floor ok ${measured.bits.toFixed(2)} bits anchors ${measured.anchorCount} draw ${phrase.words.join(' ')}`)
