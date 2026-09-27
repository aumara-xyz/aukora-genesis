/**
 * THE SECRET-SHAPE GATE ON PUBLISHED MEMORY EVIDENCE.
 *
 * remember.mjs has the exporter write into a PRIVATE staging directory; this module scans every file there with
 * the ORIGINAL AUKORA secret-shape catalogue (vendor/aukora-evidence, aumara-xyz/aukora packages/evidence at
 * def297f) and only then renames the directory to the export path. A secret-shaped match refuses the export BY
 * NAME (file + catalogue shape id, never the matched bytes), the staged files are removed, and nothing is published.
 * A clean export is renamed unchanged: this gate reads bytes and never rewrites one.
 *
 * What is scanned, per file, is what upstream's own validator scans for inline bytes (validate.ts
 * decodedBytesHaveSecret): the ASCII-byte projection, and the strict UTF-8 text when the bytes decode. For a JSON
 * document, or each line of a JSONL log, every key and string value is also scanned on its own after JSON
 * decoding, as validate.ts does for map keys and values, so a `\u`-escaped secret cannot pass as escapes. Each
 * text goes through `textHasSecret` (the catalogue over its nine NFC/NFKC/NFD, zero-width and confusable
 * projections, plus the linear url-userinfo and JWT scanners) and through the R56 provider-token shapes over the
 * same projections.
 *
 * NOT ENFORCED HERE: a same-UID process can still write into the export directory after the rename, or into the
 * staging directory between the scan and the rename. The catalogue is shape-based and best-effort (its own §13
 * ceilings): a secret with no known shape passes.
 */
import { lstatSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  catalogueId, scanForSecrets, scanJwt, scanUrlUserinfo, secretProjections, textHasSecret,
} from '../../vendor/aukora-evidence/lib/index.js'
import { scanForProviderTokens, textHasProviderToken } from '../../vendor/aukora-evidence/lib/providerTokenShapes.js'

/** The catalogue this gate runs, by its own content-derived id. */
export const CATALOGUE_ID = catalogueId()

/** upstream validate.ts asciiByteProjection: printable ASCII + TAB/LF/CR kept, every other byte -> LF. */
function asciiByteProjection(bytes) {
  let s = ''
  for (const b of bytes) s += (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d ? String.fromCharCode(b) : '\n'
  return s
}

/** The catalogue shape ids one text trips, or an empty list. The decision is upstream's own functions. */
export function secretShapesIn(text) {
  const projections = secretProjections(text)
  if (!textHasSecret(text) && !projections.some(textHasProviderToken)) return []
  const found = new Set()
  for (const projection of projections) {
    for (const match of scanForSecrets(projection)) found.add(match.patternId)
    if (scanUrlUserinfo(projection)) found.add('url-userinfo-v1')
    if (scanJwt(projection)) found.add('jwt-v1')
    for (const match of scanForProviderTokens(projection)) found.add(match.patternId)
  }
  return found.size > 0 ? [...found].sort() : ['secret-catalogue']
}

/** Every key and string value in one parsed JSON value. */
function jsonStrings(value, out) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, out)
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) { out.push(key); jsonStrings(item, out) }
  }
  return out
}

/** The texts one exported file is judged by. */
function textsOf(relative, bytes) {
  const texts = [asciiByteProjection(bytes)]
  let decoded = null
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { /* the ASCII projection covers it */ }
  if (decoded === null) return texts
  texts.push(decoded)
  const documents = relative.endsWith('.jsonl') ? decoded.split('\n') : relative.endsWith('.json') ? [decoded] : []
  for (const document of documents) {
    try { texts.push(...jsonStrings(JSON.parse(document), [])) } catch { /* not JSON: the raw text was scanned */ }
  }
  return texts
}

/**
 * The catalogue shape ids one file's bytes trip, or an empty list: the same texts and decision as the export scan.
 * advance.mjs calls this on the blobs a snapshot publishes, so both gates judge a file the same way.
 * @param {string} relative - the file's path (a .json/.jsonl name also scans its decoded keys and strings).
 * @param {Uint8Array} bytes - the file's bytes.
 * @returns {string[]} sorted shape ids.
 */
export function secretShapesInFile(relative, bytes) {
  const shapes = new Set()
  for (const text of textsOf(relative, bytes)) for (const shape of secretShapesIn(text)) shapes.add(shape)
  return [...shapes].sort()
}

/** Every regular file under `root`, relative paths sorted; a link or a special file is refused by name. */
function listFiles(root, prefix = '') {
  const out = []
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const relative = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(join(root, relative))
    if (stat.isSymbolicLink()) throw new Error(`EVIDENCE_SECRET_GATE: ${relative} is a symbolic link; an export carries files`)
    if (stat.isDirectory()) out.push(...listFiles(root, relative))
    else if (stat.isFile()) out.push(relative)
    else throw new Error(`EVIDENCE_SECRET_GATE: ${relative} is not a regular file; an export carries files`)
  }
  return out
}

/**
 * Scan every file of one export directory.
 * @param {string} dir - the staged export.
 * @returns {{files: string[], hits: {path: string, shapes: string[]}[]}} every file scanned, and each secret-shaped one.
 */
export function scanExportForSecrets(dir) {
  const files = listFiles(dir)
  const hits = []
  for (const relative of files) {
    const shapes = secretShapesInFile(relative, readFileSync(join(dir, relative)))
    if (shapes.length > 0) hits.push({ path: relative, shapes })
  }
  return { files, hits }
}

/** Remove exactly the files the scan listed, then the directories they emptied. No recursive delete. */
function withdraw(dir, files) {
  for (const relative of files) unlinkSync(join(dir, relative))
  const dirs = new Set([''])
  for (const relative of files) {
    const parts = relative.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'))
  }
  for (const relative of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || b.length - a.length)) {
    try { rmdirSync(relative === '' ? dir : join(dir, relative)) } catch { /* only ever removes an empty directory */ }
  }
  return !existsSync(dir)
}

/**
 * Publish a staged export only if no file in it is secret-shaped.
 * @param {string} stagingDir - where the exporter wrote (private, never the export path).
 * @param {string} exportDir - the public export path; must not exist yet.
 * @param {(dir: string) => {files: string[], hits: {path: string, shapes: string[]}[]}} [scan] - the scan; the
 *   focused check passes a no-op here as its red arm. remember.mjs never passes one.
 * @returns {{published: boolean, files: string[], hits: {path: string, shapes: string[]}[], withdrawn?: boolean}}
 */
export function publishScannedExport(stagingDir, exportDir, scan = scanExportForSecrets) {
  if (existsSync(exportDir)) throw new Error(`EVIDENCE_SECRET_GATE: ${exportDir} already exists; the gate never publishes into a directory it did not create`)
  const { files, hits } = scan(stagingDir)
  if (hits.length > 0) return { published: false, files, hits, withdrawn: withdraw(stagingDir, files) }
  renameSync(stagingDir, exportDir)
  return { published: true, files, hits }
}
