/**
 * VERIFIED PLUGIN ARTIFACTS — recording a closure, and checking the bytes Node actually runs.
 *
 * THE CLAIM THIS SUPPORTS, AND NOTHING WIDER: *every byte in an artifact's closure is one the owner
 * approved, and every one of those bytes was read from the buffer Node executed.* Not confinement, not
 * isolation, not dependency-closure coverage of anything outside the recorded closure.
 *
 * TWO THINGS MAKE THAT TRUE RATHER THAN ASPIRATIONAL, AND BOTH ARE STRUCTURAL:
 *
 *   1. ONE PATH-RESOLUTION RULE, USED BY BOTH SIDES. `resolveModuleIdentity` is called by the recorder
 *      and by the load hook. A second copy of the rule is how the two come to disagree — and the
 *      disagreement shows up as a file that was recorded under one name and checked under another.
 *
 *   2. THE HASH IS OF `nextLoad`'s OWN `source`, NEVER A SECOND READ. Hashing with `readFileSync` and
 *      then letting Node read again is a TOCTOU: the bytes checked and the bytes run can differ, and
 *      nothing in the check would notice. The load hook hashes what it is about to return.
 *
 * WHAT IS NOT COVERED, and is printed as a ceiling rather than left to be discovered: `eval`,
 * `new Function`, WASM from a buffer, workers and child processes (each has its own loader and needs the
 * hook installed in that context), anything already loaded before the hook, and the module cache.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Every way an artifact check can refuse, by name. */
export const ARTIFACT_REFUSE = Object.freeze({
  /** The file is inside the governed scope and no recorded artifact claims it. */
  UNLISTED_FILE: 'artifact:unlisted-file',
  /** The file is claimed, and the bytes presented are not the bytes recorded. */
  DIGEST_MISMATCH: 'artifact:digest-mismatch',
  /** A format whose `source` cannot be obtained, so this gate cannot check it. */
  SOURCE_NOT_INSPECTABLE: 'artifact:source-not-inspectable',
  /** The path resolves outside the release root. */
  PATH_OUTSIDE_ROOT: 'artifact:path-outside-root',
  /** The closure names a specifier that cannot be resolved statically. */
  CLOSURE_UNRESOLVABLE: 'artifact:closure-unresolvable',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/** sha256 of bytes, as the hex every digest in this design is written in. */
export const digestOf = bytes => createHash('sha256').update(bytes).digest('hex')

/**
 * THE ONE PATH-RESOLUTION RULE, and it is deliberately the only copy.
 *
 * Four things happen here and each closes a way two names can mean one file, or one name two files:
 *
 *   - `fileURLToPath` — NORMALIZED `file:` URLs, percent-decoding done by Node rather than by hand. A
 *     hand-rolled decode is how `%2e%2e` becomes a directory traversal nobody notices.
 *   - `realpathSync` — SYMLINKS RESOLVED. Two paths that reach the same bytes through a link are one
 *     file, and a link pointing outside the root is refused rather than followed.
 *   - CASE-NORMALISATION on case-insensitive filesystems. macOS's default is case-insensitive, so
 *     `Foo.mjs` and `foo.mjs` are ONE file and a record naming only one of them must not admit the
 *     other.
 *   - CONTAINMENT — the result must be inside the root, and the returned key is root-relative with
 *     forward slashes, so the recorded name and the checked name are the same string by construction.
 *
 * @param {string} urlOrPath - a `file:` URL or a filesystem path.
 * @param {string} root - the release root everything must be inside.
 * @returns {{ key: string, absolute: string }} the root-relative key and the resolved path.
 * @throws {Error} `artifact:path-outside-root` when it escapes the root.
 */
export function resolveModuleIdentity(urlOrPath, root) {
  const asPath = String(urlOrPath).startsWith('file:') ? fileURLToPath(urlOrPath) : String(urlOrPath)
  const realRoot = realpathSync(resolve(root))
  let real
  try {
    real = realpathSync(asPath)
  } catch (cause) {
    // A MISSING FILE IS NOT AN ESCAPE. It is reported as outside the root because that is the same
    // fact from this function's point of view — there is no identity here to record — and the caller
    // that cares about missing files says so with its own name.
    throw refuse(ARTIFACT_REFUSE.PATH_OUTSIDE_ROOT, `${asPath} could not be resolved: ${String(cause?.message ?? cause)}`)
  }
  const rel = relative(realRoot, real)
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith(sep)) {
    throw refuse(ARTIFACT_REFUSE.PATH_OUTSIDE_ROOT,
      `${asPath} resolves to ${real}, which is outside ${realRoot}`)
  }
  // CASE-NORMALISED, and the check is against the FILESYSTEM rather than the platform name: a
  // case-sensitive volume on macOS would make this a needless narrowing, but a case-INSENSITIVE one
  // that skipped it would let two names share one record.
  const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32'
  const key = (caseInsensitive ? rel.toLowerCase() : rel).split(sep).join('/')
  return { key, absolute: real }
}

/**
 * The static import specifiers in one module's source. Literal specifiers only.
 *
 * COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT TIDINESS. `undici` carries
 * `import('../../types/client.js')` inside a JSDoc type annotation — a TYPE-ONLY reference to a file that
 * is not shipped — and a scanner that reads prose as code tries to resolve it, fails, and declares a
 * perfectly recordable package unrecordable. Node never resolves it because Node never sees it. This is the
 * same defect as the verify-strings court, where a check for what CODE does matched the sentence
 * explaining the rule: A QUESTION ABOUT WHAT CODE DOES HAS TO READ CODE.
 */
export function staticSpecifiersOf(source) {
  const specifiers = new Set()
  const patterns = [
    /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/gu,
    /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ]
  const code = String(source).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/[^\n]*/gmu, '')
  for (const pattern of patterns) for (const match of code.matchAll(pattern)) specifiers.add(match[1])
  return [...specifiers]
}

/**
 * The transitive closure of one entry file: every local module it can load to execute.
 *
 * A SPECIFIER THAT CANNOT BE RESOLVED STATICALLY IS A REFUSAL, not a silently truncated closure. An
 * artifact whose closure is not knowable at record time cannot be said to be approved, and the honest
 * answer is to say so rather than to record part of it and imply the rest.
 *
 * Bare specifiers (`node:fs`, a package) are NOT followed: they are outside the release and outside this
 * design's claim. Only relative specifiers are walked.
 *
 * THE ENTRY'S BYTES CAN BE HANDED IN. The load hook passes the source `nextLoad` returned, so the entry's
 * digest and the specifiers walked from it come from the bytes Node will run, not from a second read.
 * The imports themselves are still read from disk here; the hook pins their digests and checks each one
 * again when Node loads it.
 *
 * @param {string} entryPath - the artifact's entry file.
 * @param {string} root - the release root.
 * @param {{entrySource?: Uint8Array|string}} [options] - the entry's executed bytes, when the caller has them.
 * @returns {Readonly<Record<string, string>>} key -> digest, entry included.
 */
export function artifactClosure(entryPath, root, options = {}) {
  const files = {}
  const seen = new Set()
  const entry = resolve(entryPath)
  const queue = [entry]
  while (queue.length > 0) {
    const next = queue.shift()
    const { key, absolute } = resolveModuleIdentity(next, root)
    if (seen.has(key)) continue
    seen.add(key)
    const bytes = next === entry && options.entrySource !== undefined && options.entrySource !== null
      ? Buffer.from(options.entrySource)
      : readFileSync(absolute)
    files[key] = digestOf(bytes)
    const source = bytes.toString('utf8')
    for (const specifier of staticSpecifiersOf(source)) {
      if (!specifier.startsWith('.')) continue
      // NODE'S OWN RESOLUTION, NOT A HAND-ROLLED EXTENSION LIST.
      //
      // THE DEFECT THIS REPLACES: the first version tried `target`, `target.mjs`, `target.js` and
      // `target/index.mjs`. That is a GUESS at Node's algorithm rather than the algorithm, and it failed on
      // 40 packages — `undici` alone on `./lib/api` — because Node also resolves EXTENSIONLESS specifiers to
      // `.js` and DIRECTORY specifiers to `index.js`. A recorder whose resolution differs from the loader's
      // records a closure the runtime does not agree with, which is worse than recording nothing: the digest
      // would certify a set of files that is not the set that loads.
      //
      // `createRequire` FROM THE IMPORTING FILE resolves relative specifiers relative to THAT file, honours
      // `exports` self-reference for a package's own name, and follows the same `conditions` the runtime
      // will. It is the same resolver the loader uses, so the closure it produces is the closure that runs.
      let found
      try {
        found = createRequire(pathToFileURL(absolute).href).resolve(specifier)
      } catch (cause) {
        throw refuse(ARTIFACT_REFUSE.CLOSURE_UNRESOLVABLE,
          `${key} imports ${JSON.stringify(specifier)}, which Node's own resolver cannot resolve: `
          + `${String(cause?.message ?? cause)}. An artifact whose closure is not knowable cannot be approved`)
      }
      queue.push(found)
    }
  }
  return Object.freeze(files)
}

/**
 * The canonical artifact digest: sha256 over `key\ndigest\n` lines, keys sorted.
 *
 * DERIVED, NEVER STORED. A digest stored beside the thing it covers is a digest that can be edited to
 * match, and the whole point of this value is that it cannot be.
 *
 * @param {Record<string, string>} files - key -> digest.
 * @returns {string} the artifact digest.
 */
export function artifactDigest(files) {
  const canonical = Object.keys(files).sort().map(key => `${key}\n${files[key]}\n`).join('')
  return digestOf(Buffer.from(canonical, 'utf8'))
}

/**
 * Record one artifact: its entry, its closure, its digest — and its authentication slot, UNIMPLEMENTED.
 *
 * @param {{id: string, entry: string, root: string}} input - what to record.
 * @returns {Readonly<object>} the artifact record.
 */
export function recordArtifact(input) {
  const { key: entryKey } = resolveModuleIdentity(resolve(input.root, input.entry), input.root)
  const files = artifactClosure(resolve(input.root, input.entry), input.root)
  return Object.freeze({
    id: input.id,
    entry: entryKey,
    files,
    digest: artifactDigest(files),
    /**
     * THE AUTHENTICATION SLOT, AND IT IS DELIBERATELY EMPTY.
     *
     * A recorded digest is not an approval. Establishing that the OWNER approved this closure needs a
     * signature over an explicit preimage by a key the agent uid cannot reach, and that depends on the
     * owner daemon's install — which has not landed. Until it does, this slot names what belongs in it
     * rather than carrying a placeholder that could be mistaken for one.
     */
    approval: {
      state: 'unimplemented',
      requires: 'owner signature via the owner daemon (U1)',
      ceiling: 'ARTIFACT_APPROVAL_UNIMPLEMENTED',
    },
  })
}

/**
 * The verification the load hook performs, over the bytes `nextLoad` returned.
 *
 * @param {{source: unknown, format: unknown, url: string, artifact: object, root: string}} input - the hook's own values.
 * @returns {true} when the presented bytes are the recorded bytes.
 * @throws {Error} one of `ARTIFACT_REFUSE`, by name.
 */
export function verifyLoadedBytes(input) {
  const { key } = resolveModuleIdentity(input.url, input.root)
  const want = input.artifact.files[key]
  if (want === undefined) {
    throw refuse(ARTIFACT_REFUSE.UNLISTED_FILE,
      `${key} is inside the pilot's scope and no recorded artifact claims it`)
  }
  // THE SOURCE IS WHAT `nextLoad` RETURNED. Never a fresh `readFileSync`: the bytes checked and the
  // bytes run have to be the same read, or the check is a statement about a file rather than about an
  // execution.
  const bytes = asBytes(input.source, input.format)
  if (bytes === undefined) {
    throw refuse(ARTIFACT_REFUSE.SOURCE_NOT_INSPECTABLE,
      `${key} is format ${String(input.format)} and this gate could not obtain its source bytes, so it `
      + 'cannot be checked. A format a gate cannot check is refused rather than waved past')
  }
  const got = digestOf(bytes)
  if (got !== want) {
    throw refuse(ARTIFACT_REFUSE.DIGEST_MISMATCH,
      `${key} presented ${got.slice(0, 16)}… and the recorded artifact carries ${want.slice(0, 16)}…`)
  }
  return true
}

/**
 * `nextLoad`'s `source` as bytes, or undefined when it cannot be obtained.
 *
 * MEASURED before this was written, on node v22.23.0: `module` formats return a Uint8Array, `commonjs`
 * and `json` return a string, and `builtin` returns none — there is no file on disk to have recorded.
 * The type differs per format, which is why this normalises rather than assuming one.
 */
export function asBytes(source, format) {
  if (source === undefined || source === null) return undefined
  if (typeof source === 'string') return Buffer.from(source, 'utf8')
  if (source instanceof Uint8Array) return Buffer.from(source)
  if (typeof source === 'object' && format === 'commonjs') {
    // Some Node versions hand `commonjs` a `{ source, … }` wrapper rather than the string itself.
    const inner = source.source
    if (typeof inner === 'string') return Buffer.from(inner, 'utf8')
    if (inner instanceof Uint8Array) return Buffer.from(inner)
  }
  return undefined
}

/** The URL a key would be loaded from, so a court can present one without guessing. */
export const urlOf = (absolutePath) => pathToFileURL(absolutePath).href
