#!/usr/bin/env node
/**
 * AUMLOK pool math. One court.
 *
 *   node tests/aukora-aumlok-pool-bits.test.mjs
 *
 * GREEN: the shipped themes, the sealed anchors, the header line, the ceiling, and the
 * green/blue/purple bands agree with measure().
 * RED: a blocked word, a 256-bit stamp, and a short anchor are refused.
 * Not verified in Peter's installed app.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANCHOR_LENGTH,
  THEME_BY_POSITION,
  THEMES,
  entropyCeiling,
  loadThemes,
  measure,
  offlineGuessLine,
  phraseEntropyClaim,
} from '../plugins/aukora-aumlok/lib/themed-entropy.mjs'
import { CEILING_TEXTS } from '../plugins/aukora-aumlok/lib/ceilings.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'plugins', 'aukora-aumlok', 'data')
const SAFETY = join(DATA, 'safety')

function categoryWords(doc, skip) {
  const out = []
  for (const [name, list] of Object.entries(doc.categories ?? {})) {
    if (skip.has(name)) continue
    for (const word of list) out.push(String(word).toLowerCase())
  }
  return out
}

function forbidden() {
  const block = JSON.parse(readFileSync(join(SAFETY, 'profanity-block.json'), 'utf8'))
  const drop = JSON.parse(readFileSync(join(SAFETY, 'category-drop.json'), 'utf8'))
  const pleasant = JSON.parse(readFileSync(join(SAFETY, 'pleasant-drop.json'), 'utf8'))
  const names = JSON.parse(readFileSync(join(SAFETY, 'proper-names.json'), 'utf8'))
  const set = new Set([
    ...block.words.map(word => String(word).toLowerCase()),
    ...categoryWords(drop, new Set(['slang', 'dreary'])),
    ...Object.values(pleasant.categories).flat().map(word => String(word).toLowerCase()),
    ...names.words.map(word => String(word).toLowerCase()),
    ...names.places.map(word => String(word).toLowerCase()),
    ...names.ambiguousNames.map(word => String(word).toLowerCase()),
  ])
  return set
}

function audit(themes, blocked) {
  const hits = []
  const seen = new Map()
  for (const theme of THEMES) {
    const table = themes.themes?.[theme] ?? {}
    for (const [letter, words] of Object.entries(table)) {
      if (!Array.isArray(words)) {
        hits.push({ word: letter, reason: 'bucket' })
        continue
      }
      for (const word of words) {
        if (typeof word !== 'string' || !/^[a-z]{4,9}$/.test(word) || word[0] !== letter) {
          hits.push({ word, reason: 'shape' })
        } else if (blocked.has(word)) {
          hits.push({ word, reason: 'blocked' })
        } else if (seen.has(word)) {
          hits.push({ word, reason: 'two-themes' })
        }
        seen.set(word, theme)
      }
    }
  }
  return hits
}

function acceptClaim(claim) {
  return claim.not256 === true
    && claim.kind === 'pool-math'
    && claim.role === 'local-story-memorability'
    && claim.bits > 0
    && claim.bits < 256
}

function acrosticOk(tokens, themes) {
  if (!Array.isArray(tokens) || tokens.length !== 7) return false
  const anchor = tokens[0]
  if (!/^[a-z]{6}$/.test(anchor)) return false
  for (let i = 0; i < ANCHOR_LENGTH; i += 1) {
    const word = tokens[i + 1]
    const bucket = themes.themes[THEME_BY_POSITION[i]]?.[anchor[i]] ?? []
    if (typeof word !== 'string' || word[0] !== anchor[i] || !bucket.includes(word)) return false
  }
  return true
}

const themes = loadThemes()
const measured = measure()
const ceiling = entropyCeiling()
const claim = phraseEntropyClaim(measured)
const blocked = forbidden()
const header = readFileSync(join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'themed-entropy.mjs'), 'utf8')
const figures = header.match(/MEASURED FIGURES \(asserted by tests\/aukora-aumlok-pool-bits\.test\.mjs\): bits=([0-9.]+) ceiling=([0-9.]+) floor=none anchors=(\d+) gate=(\d+)/)
const anchors = JSON.parse(readFileSync(join(DATA, 'aumlok-anchors.json'), 'utf8'))
const surface = readFileSync(join(ROOT, 'plugins', 'aukora-face', 'aumlok', 'src', 'client', 'surface-state.ts'), 'utf8')
const css = readFileSync(join(ROOT, 'plugins', 'aukora-face', 'aumlok', 'src', 'client', 'Aumlok.module.css'), 'utf8')
const line = offlineGuessLine(measured)
const ceilingText = CEILING_TEXTS.ROOT_KEY_OFFLINE_GUESSABLE
const greenHits = audit(themes, blocked)
const poisoned = JSON.parse(JSON.stringify(themes))
const sampleBlock = [...blocked].find(word => /^[a-z]{4,9}$/.test(word) && Array.isArray(poisoned.themes.NATURE[word[0]]))
poisoned.themes.NATURE[sampleBlock[0]].push(sampleBlock)
const redQuality = audit(poisoned, blocked)
const redClaim = acceptClaim({ ...claim, bits: 256, not256: false, kind: '256-bit' })
const anchor = anchors.anchors[0]
const spelled = [anchor, ...THEME_BY_POSITION.map((theme, i) => themes.themes[theme][anchor[i]][0])]
const redShape = acrosticOk(['short', ...spelled.slice(1)], themes)

assert.ok(figures, 'header line missing')
assert.equal(figures[1], measured.bits.toFixed(2))
assert.equal(figures[2], ceiling.best.bits.toFixed(2))
assert.equal(Number(figures[3]), measured.anchorCount)
assert.equal(Number(figures[4]), measured.minWordsPerBucket)
assert.equal(measured.floorBits, null)
assert.equal(measured.meetsFloor, null)
assert.equal(measured.anchorsDroppedForLetters, 0)
assert.equal(measured.anchorCount, anchors.anchors.length)
assert.equal(themes.provenance.entropy.kind, 'pool-math')
assert.equal(themes.provenance.entropy.not256, true)
assert.equal(themes.provenance.entropy.role, 'local-story-memorability')
assert.equal(greenHits.length, 0)
assert.ok(redQuality.some(hit => hit.reason === 'blocked'))
assert.equal(acceptClaim(claim), true)
assert.equal(redClaim, false)
assert.deepEqual([...THEME_BY_POSITION], ['NATURE', 'NATURE', 'PEOPLE', 'PEOPLE', 'SPIRIT', 'SPIRIT'])
assert.equal(ANCHOR_LENGTH, 6)
assert.equal(acrosticOk(spelled, themes), true)
assert.equal(redShape, false)
assert.match(line, /not 256 bits/)
assert.match(line, /pool math/)
assert.match(line, /local story memorability only/)
assert.match(line, new RegExp(measured.bits.toFixed(2)))
assert.match(ceilingText, /not 256 bits/)
assert.match(ceilingText, /pool math/)
assert.match(ceilingText, /local story memorability only/)
assert.match(ceilingText, new RegExp(measured.bits.toFixed(2)))
assert.equal(themes.themes.NATURE.a.includes('apple'), true)
assert.equal(themes.themes.PEOPLE.p.includes('party'), true)
assert.equal(themes.themes.SPIRIT.m.includes('moon'), true)
assert.match(surface, /tone: 'green'[\s\S]*tone: 'blue'[\s\S]*tone: 'purple'/)
assert.match(css, /data-aumlok-tone='green'/)
assert.match(css, /data-aumlok-tone='blue'/)
assert.match(css, /data-aumlok-tone='purple'/)

console.log(`GREEN pool math ${measured.bits.toFixed(2)} bits, ceiling ${ceiling.best.bits.toFixed(2)}, anchors ${measured.anchorCount}, letters ${measured.anchorLetters.join('')}, weakest ${measured.limitingAnchor}`)
console.log(`GREEN quality ${greenHits.length} hits; acrostic ${spelled.join('-')}`)
console.log('GREEN bands green, blue, purple')
console.log(`RED blocked word refused (${redQuality.length} hits); 256-bit stamp refused; short anchor refused`)
console.log('not verified in Peter\'s installed app')
