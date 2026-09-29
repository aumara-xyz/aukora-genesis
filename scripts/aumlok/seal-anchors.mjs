/**
 * Keep the shipped anchor list equal to the set the pool math actually draws.
 *
 * build-maximal-themes.py writes every six-letter candidate. This seals that list to the
 * letters chooseAnchorLetters keeps, then writes the measured figure onto the theme file.
 * The figure is pool math. It is not 256 bits. The phrase is local story memorability.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANCHORS_PATH,
  THEMES_PATH,
  admissibleLetters,
  bucketCounts,
  chooseAnchorLetters,
  entropyCeiling,
  measure,
} from '../../plugins/aukora-aumlok/lib/themed-entropy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, doc) {
  writeFileSync(path, `${JSON.stringify(doc, null, 1)}\n`, 'utf8')
}

const themes = readJson(THEMES_PATH)
const anchorDoc = readJson(ANCHORS_PATH)
let words = anchorDoc.anchors.filter(word => typeof word === 'string')
const counts = bucketCounts(themes)
let chosen = chooseAnchorLetters(admissibleLetters(counts), counts, words)
let letters = new Set(chosen.evaluation.letters)
let sealed = words.filter(word => [...word].every(letter => letters.has(letter)))
// One more pass: a smaller anchor list can make a different letter worth dropping.
for (let pass = 0; pass < 6; pass += 1) {
  const next = chooseAnchorLetters(admissibleLetters(counts), counts, sealed)
  const nextLetters = new Set(next.evaluation.letters)
  const nextSealed = sealed.filter(word => [...word].every(letter => nextLetters.has(letter)))
  chosen = next
  letters = nextLetters
  if (nextSealed.length === sealed.length && nextSealed.every((word, i) => word === sealed[i])) break
  sealed = nextSealed
}

anchorDoc.anchors = sealed
anchorDoc._provenance = {
  source: 'six-letter candidates sealed to the letters the pool math draws',
  letters: [...letters].sort().join(''),
  count: sealed.length,
  role: 'local story memorability; entropy is pool math, not 256 bits',
}
writeJson(ANCHORS_PATH, anchorDoc)

const measured = measure()
const ceiling = entropyCeiling()
if (measured.anchorsDroppedForLetters !== 0) {
  throw new Error(`sealed anchors still drop ${measured.anchorsDroppedForLetters} for letters`)
}
if (measured.anchorCount !== sealed.length) {
  throw new Error(`measure counts ${measured.anchorCount} anchors; the file has ${sealed.length}`)
}

themes.provenance.measurement = {
  kind: 'pool-math',
  not256: true,
  role: 'local-story-memorability',
  bits: measured.bits,
  bitsRounded: Number(measured.bits.toFixed(2)),
  ceiling: ceiling.best ? ceiling.best.bits : 0,
  ceilingRounded: ceiling.best ? Number(ceiling.best.bits.toFixed(2)) : 0,
  anchors: measured.anchorCount,
  letters: measured.anchorLetters.join(''),
  gate: measured.minWordsPerBucket,
  limitingAnchor: measured.limitingAnchor,
  minAnchorBits: measured.minAnchorBits,
  floorBits: null,
}
themes.provenance.entropy = {
  kind: 'pool-math',
  not256: true,
  role: 'local-story-memorability',
  formula: 'log2(anchors) + min over anchors of sum log2(bucket size at each of the six positions)',
}
writeJson(THEMES_PATH, themes)

process.stdout.write(
  `bits=${measured.bits.toFixed(2)} ceiling=${(ceiling.best ? ceiling.best.bits : 0).toFixed(2)} `
  + `anchors=${measured.anchorCount} letters=${measured.anchorLetters.join('')} `
  + `gate=${measured.minWordsPerBucket} weakest=${measured.limitingAnchor} `
  + `minAnchorBits=${measured.minAnchorBits.toFixed(4)}\n`,
)
