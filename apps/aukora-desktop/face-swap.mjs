// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * GOVERNED FACE SWAPS — the store half.
 *
 * A live face swap has to answer four questions before it is worth doing at all, and this module is where
 * each one is answered by construction rather than by intention:
 *
 *   1. WHERE DO THE BYTES LIVE? Beside the release, addressed by their own digest:
 *      `<facesRoot>/<face>/<sha256>/client.js`. Never inside the release: the release records its own file
 *      count and byte total in `strip-manifest.json` and `launch-dsh.py` re-measures and refuses a tree that
 *      disagrees, so a bundle written inside it spends the release for relaunch.
 *   2. WHAT MAKES THE ADDRESS TRUE? The digest is recomputed on every read. A file whose bytes do not hash
 *      to the directory that names it is refused as `face.digest-mismatch` and never served — a
 *      content-addressed store that does not check is a directory with a long name.
 *   3. WHO DID IT, AND WHEN? Every accepted swap appends one ledger line — face, digest, time, who — and
 *      nothing else: the bytes are already addressed, and a ledger that copied them would be a second place
 *      the thing lives.
 *   4. WHO MAY DO IT? A face that RENDERS APPROVAL STATE may not be swapped without a person's approval,
 *      because a bundle that can be swapped without one is a bundle that can redraw the surface that asks
 *      for consent. `APPROVAL_RENDERING_FACES` is the list, and it is deliberately short and explicit.
 *
 * WHAT THIS MODULE IS NOT: the serving path. Storing and addressing a bundle is necessary and not
 * sufficient — something has to serve the approved digest to the running app — and `planOverlayEntry`
 * produces the entry a `--patch` overlay would carry (a file URL for the addressed directory), which is the
 * half of that path this module can honestly own. `tests/aukora-face-live-swap.test.mjs` keeps the serving
 * arm red until it is real.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The ledger's name inside the faces root. */
export const LEDGER_NAME = 'ledger.jsonl'

/** Faces whose swap needs a person: they render approval state, so they can redraw the consent surface. */
export const APPROVAL_RENDERING_FACES = Object.freeze(['aumlok'])

/** A face name is a name, not a path: one segment, lower-case, no dots and no separators. */
const FACE_NAME = /^[a-z][a-z0-9-]{0,31}$/u

/**
 * A face package: every file the swapped directory has to carry, by relative path.
 *
 * WHY IT IS A DIRECTORY AND NOT ONE FILE. A face's client half is DECLARED, not discovered: `package.json`
 * exports `./client` → `./lib/client.js` and declares `"dsh": { "client": … }`
 * (`plugins/aukora-face/messages/package.json:24-38`), and the host half is the module the overlay names. A
 * digest over `client.js` alone would name a directory whose OTHER files nobody checked — so a swapped
 * package could carry a host module or a manifest that was never part of what was approved, and the address
 * would still look true. The address has to cover everything the directory contains.
 */
export const REQUIRED_PACKAGE_FILES = Object.freeze(['package.json', 'client.js'])

/**
 * The digest that names a face directory: every file's path, length and content, in sorted order.
 *
 * LENGTH-PREFIXED AND PATH-LABELLED, so that moving a byte between two adjacent files, renaming a file, or
 * adding one changes the digest rather than colliding with it.
 * @param files - relative path → bytes.
 * @returns the sha256, as hex.
 */
export function digestOfPackage(files) {
  const hash = createHash('sha256')
  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const body = Buffer.from(bytes)
    hash.update(`${path}\0${String(body.byteLength)}\0`).update(body)
  }
  return hash.digest('hex')
}

/**
 * The digest of one file, for a caller that wants to name a single bundle within a package.
 * @param bytes - the bytes.
 * @returns the sha256, as hex.
 */
export function digestOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A relative path inside a package: no absolute, no `..`, no empties. */
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u

/**
 * Store one face bundle under its own digest, ledger the swap, and name the entry an overlay would carry.
 *
 * REFUSALS HAPPEN BEFORE ANY WRITE: a swap that needs a person and has none writes no directory, no bundle
 * and no ledger line, so a refused swap leaves the store exactly as it was and the absence is checkable.
 * @param options - the faces root, the face, the bytes, who asked, and whether a person approved it.
 * @returns `{ok: true, digest, path, overlay}` or `{ok: false, code, reason}`.
 */
export async function putFaceBundle(options) {
  const { facesRoot, face, files, who, approved = false, now = () => new Date() } = options ?? {}
  if (typeof facesRoot !== 'string' || facesRoot.length === 0) {
    return { ok: false, code: 'face.no-store', reason: 'no faces root was given, and a swap is not written into the release' }
  }
  if (typeof face !== 'string' || !FACE_NAME.test(face)) {
    return { ok: false, code: 'face.invalid-name', reason: `${String(face)} is not a face name (one lower-case segment, no separators)` }
  }
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    return { ok: false, code: 'face.no-bytes', reason: 'a swap carries the package files, not a path to them' }
  }
  const names = Object.keys(files)
  for (const name of names) {
    if (!RELATIVE_PATH.test(name)) {
      return { ok: false, code: 'face.invalid-path', reason: `${name} is not a relative path inside the package` }
    }
  }
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!names.includes(required)) {
      return { ok: false, code: 'face.incomplete-package', reason: `the package has no ${required}, so the directory would not be a face` }
    }
  }
  if (APPROVAL_RENDERING_FACES.includes(face) && approved !== true) {
    // THE GATE IS FIRST, BEFORE THE DIGEST IS EVEN COMPUTED: nothing about an unapproved swap of this face
    // should reach the disk, including its address.
    return { ok: false, code: 'face.approval-required', reason: `${face} renders approval state and may not be swapped without a person's approval` }
  }
  const body = {}
  for (const [name, bytes] of Object.entries(files)) body[name] = Buffer.from(bytes)
  const digest = digestOfPackage(body)
  const directory = join(facesRoot, face, digest)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  // WRITTEN BESIDE AND RENAMED, so a reader never sees a half-written package at an address that claims to
  // describe it. Every file is complete before the directory is pointed at.
  for (const [name, bytes] of Object.entries(body)) {
    const path = join(directory, name)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const scratch = `${path}.${String(process.pid)}.tmp`
    writeFileSync(scratch, bytes, { mode: 0o600 })
    renameSync(scratch, path)
  }
  // THE LEDGER LINE IS WRITTEN AFTER THE BYTES ARE IN PLACE and before anything points at them: an
  // interrupted swap leaves a line about a bundle that exists, never a pointer to one that does not.
  const line = { face, digest, time: now().toISOString(), who: typeof who === 'string' && who.length > 0 ? who : 'unknown' }
  appendFileSync(join(facesRoot, LEDGER_NAME), `${JSON.stringify(line)}\n`, { mode: 0o600 })
  return { ok: true, digest, directory, overlay: planOverlayEntry({ facesRoot, face, digest }) }
}

/**
 * Read a stored bundle, checking that its bytes still hash to the address they were served from.
 * @param options - the faces root, the face and the digest.
 * @returns `{ok: true, bytes, digest}` or `{ok: false, code, reason}`.
 */
export async function readFaceBundle(options) {
  const { facesRoot, face, digest, entry = 'client.js' } = options ?? {}
  if (typeof face !== 'string' || !FACE_NAME.test(face)) {
    return { ok: false, code: 'face.invalid-name', reason: `${String(face)} is not a face name` }
  }
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    return { ok: false, code: 'face.invalid-digest', reason: `${String(digest)} is not a sha256 address` }
  }
  const directory = join(facesRoot, face, digest)
  if (!existsSync(directory)) return { ok: false, code: 'face.bundle-absent', reason: `no package at ${directory}` }
  // EVERY FILE IS READ AND THE WHOLE DIRECTORY IS RE-HASHED, not one named file: a tampered host module, a
  // rewritten manifest or an ADDED file all change the aggregate, and any of them would otherwise be served
  // under an address that was approved for something else.
  const body = {}
  for (const name of listPackageFiles(directory)) body[name] = readFileSync(join(directory, name))
  const actual = digestOfPackage(body)
  if (actual !== digest) {
    // REFUSED BY NAME AND NOT SERVED. The whole value of addressing by digest is that this case is
    // detectable; a store that served these bytes would be serving something nobody approved.
    return { ok: false, code: 'face.digest-mismatch', reason: `the package at ${directory} hashes to ${actual}, not ${digest}` }
  }
  if (!Object.hasOwn(body, entry)) return { ok: false, code: 'face.entry-absent', reason: `the package has no ${entry}` }
  return { ok: true, files: body, bytes: body[entry], digest }
}

/**
 * Every file below one package directory, as relative paths.
 * @param directory - the absolute directory.
 * @param prefix - the relative prefix being walked.
 * @returns the relative paths, sorted.
 */
function listPackageFiles(directory, prefix = '') {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) found.push(...listPackageFiles(join(directory, entry.name), relative))
    else found.push(relative)
  }
  return found.sort()
}

/**
 * The overlay entry that points a plugin at an addressed bundle's directory.
 *
 * THE SHAPE IS THE HARNESS'S, NOT AN INVENTION: a patch may insert a plugin whose `name` is an absolute
 * path or a `./relative` one, and `anchorInsertedPluginNames` converts it to a file URL
 * (`boot/app-boot/src/index.ts:340`). The composition gate in this deployment already mounts plugins that
 * way. What this function does NOT do is apply the overlay or prove that a changed module path re-mounts a
 * running plugin — that is the serving half, and it stays unwired until it is measured.
 * @param options - the faces root, the face, the digest and the entry file's name.
 * @returns `{name, directory}` with `name` as a file URL.
 */
export function planOverlayEntry(options) {
  const { facesRoot, face, digest, entry = 'client.js' } = options ?? {}
  const directory = join(facesRoot, face, digest)
  return { name: pathToFileURL(join(directory, entry)).href, directory }
}

/**
 * Every swap the store has recorded, in the order it recorded them.
 * @param options - the faces root.
 * @returns the ledger lines, parsed.
 */
export function readLedger(options) {
  const path = join(String(options?.facesRoot ?? ''), LEDGER_NAME)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
}
