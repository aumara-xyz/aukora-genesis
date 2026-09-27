/**
 * WHAT A SNAPSHOT PUBLISHES, AND WHAT MAY NOT BE IN IT. advance.mjs --snapshot / --replace-root runs this before any
 * popup: the file summary the popup shows (the tree being published against the remote's main now) and the scan that
 * refuses a private-shaped file BY NAME (path + rule id, never the matched bytes).
 *
 * The scan reads the BLOBS of the tree being published, not the working copy, so what is judged is what is pushed.
 * --snapshot scans the files it adds or changes; --replace-root scans every file of the tree, because the new root
 * republishes all of it.
 *
 *   path rules     a `legal` directory, PATENT / PROVISIONAL / PRIVATE / counsel in a path, secret-file names (.env,
 *                  .npmrc, .netrc, id_rsa, *.p12, *.key, …) and audio files (no voice in the repository)
 *   content rules  private / patent / counsel markers, an email address outside the reserved example domains, a
 *                  /Users/<name> home path, and every key/token shape of the evidence secret gate's catalogue
 *                  (scripts/aukora/evidence-secret-gate.mjs secretShapesInFile) except `env-secret-assign`. A file that
 *                  is not UTF-8 (a PDF, an image) gets the path rules and the key/token shapes over its ASCII bytes only:
 *                  its compressed streams produce address-shaped noise, not text
 *
 * ALLOWED HITS. A test fixture that is obviously fake (a synthetic token, a vendored author email, a pinned evidence
 * file that records a home path) is allowed only by an entry in scripts/aukora/snapshot-allow.json AS IT IS IN THE
 * PUBLISHED TREE: the path, the sha256 of its exact bytes and the rule ids allowed. A changed byte, or a new rule
 * hitting, refuses again. A snapshot that changes the allowlist says so in the popup.
 *
 * NOT ENFORCED HERE: the rules are shapes, best-effort. A secret with no known shape, an assignment-shaped secret
 * (`env-secret-assign` is left out: it fires on ordinary source code), private prose with no marker (a draft
 * agreement, a conversation), and anything inside a binary file's compressed text all pass. The allowlist is a file in the repository any same-UID agent can edit; the popup shows
 * that it changed, not who changed it.
 *
 *   node scripts/aukora/snapshot-scan.mjs <commit> [--against <commit>]   list the hits (path, rules, sha256)
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secretShapesInFile } from './evidence-secret-gate.mjs'

export const ALLOWLIST_PATH = 'scripts/aukora/snapshot-allow.json'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const PATH_RULES = [
  ['legal-dir', (p) => p.split('/').slice(0, -1).some((s) => s.toLowerCase() === 'legal')],
  ['patent-path', (p) => /PATENT/u.test(p) || /(^|\/)patents?(\.[A-Za-z0-9]+)?$/iu.test(p)],
  ['provisional-path', (p) => /PROVISIONAL/u.test(p)],
  ['counsel-path', (p) => /counsel/iu.test(p)],
  ['private-path', (p) => /PRIVATE/u.test(p)],
  ['secret-file', (p) => /(^|\/)(\.env(\.[^/]*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|credentials(\.json)?|id_(rsa|dsa|ecdsa|ed25519))$/iu.test(p)
    || /\.(p12|pfx|jks|keystore|kdbx|key|sk)$/iu.test(p)],
  ['voice-file', (p) => /\.(wav|mp3|m4a|ogg|oga|opus|flac|aac|caf|aiff?|amr)$/iu.test(p)],
]

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/gu
/** Reserved or placeholder addresses (RFC 2606 / 6761 names, SSH remotes, no-reply senders) are not a person's email. */
export function emailIsPlaceholder(address) {
  const [local, domain = ''] = address.toLowerCase().split('@')
  if (local === 'git' || local === 'noreply' || local === 'no-reply') return true
  if (/(^|\.)(example|invalid|test|local|localhost)$/u.test(domain)) return true
  if (/(^|\.)example\.(com|net|org)$/u.test(domain)) return true
  return domain === 'users.noreply.github.com'
}
const HOME_PATH = /\/Users\/([A-Za-z][A-Za-z0-9._-]*)/gu
const HOME_PLACEHOLDERS = new Set(['you', 'me', 'user', 'username', 'name', 'runner', 'example', 'shared', 'someone', 'owner'])

const CONTENT_RULES = [
  ['private-marker', (t) => /[—–(\[]\s*PRIVATE\b|\bPRIVATE\s*(?:[)\]—–]|$)|\bPRIVATE (?:repository|material|briefing|draft|notes?)\b|\bCONFIDENTIAL\b|[Pp]roprietary and confidential|PROPRIETARY LICENSE|DO NOT (?:SHARE|PUBLISH|DISTRIBUTE)/mu.test(t)],
  ['patent-marker', (t) => /(?<![A-Za-z0-9_-])PATENTS?(?![A-Za-z0-9_])|\b[Pp]atent[- ][Pp]ending\b|\b[Pp]rovisional (?:patent|application|filing)\b|\b[Pp]atent application\b/u.test(t)],
  ['counsel-marker', (t) => /\bfor counsel\b|\bcounsel(?:'s)? (?:working )?draft\b|\battorney[- ]client\b|\bprivileged (?:and|&) confidential\b/iu.test(t)],
  ['email', (t) => [...t.matchAll(EMAIL)].some((m) => !emailIsPlaceholder(m[0]))],
  ['home-path', (t) => [...t.matchAll(HOME_PATH)].some((m) => !HOME_PLACEHOLDERS.has(m[1].toLowerCase()))],
]

/** The rule ids one published file trips: path rules, then content rules, then `token:<shape>` for each key/token shape. */
export function rulesFor(path, bytes) {
  const hits = PATH_RULES.filter(([, test]) => test(path)).map(([id]) => id)
  if (bytes === null) return hits
  let text = null
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { /* binary: only the key/token shapes below */ }
  if (text !== null) for (const [id, test] of CONTENT_RULES) if (test(text)) hits.push(id)
  for (const shape of secretShapesInFile(path, bytes)) if (shape !== 'env-secret-assign') hits.push(`token:${shape}`)
  return hits
}

/** A git runner bound to one repository: (args, options) => spawnSync result. */
const gitIn = (repo, env) => (args, options = {}) => {
  const run = spawnSync('git', args, { cwd: repo, env, maxBuffer: 1024 * 1024 * 1024, ...options })
  if (run.status !== 0 && options.check !== false) throw new Error(`git ${args.join(' ')} failed: ${String(run.stderr ?? '').trim()}`)
  return run
}

export function emptyTree(git) {
  return String(git(['hash-object', '-t', 'tree', '--stdin'], { input: '' }).stdout).trim()
}

/**
 * The files `toTree` adds, modifies and deletes against `fromTree` (null = nothing yet). No rename detection: a rename
 * is shown as the delete and the add it is.
 * @returns {{status: string, path: string, blob: string|null, mode: string}[]} sorted by path.
 */
export function fileChanges(git, fromTree, toTree) {
  const base = fromTree ?? emptyTree(git)
  const out = String(git(['diff-tree', '-r', '-z', '--no-renames', '--no-commit-id', base, toTree], { encoding: 'utf8' }).stdout)
  const parts = out.split('\0')
  const changes = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    // ":<old mode> <new mode> <old blob> <new blob> <letter>" then the path
    const [, mode, , blob, letter] = parts[i].split(' ')
    const status = letter === 'T' ? 'M' : letter
    changes.push({ status, path: parts[i + 1], mode, blob: status === 'D' ? null : blob })
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Every file of `tree`, as fileChanges entries with status 'A'. */
export function treeFiles(git, tree) {
  const out = String(git(['ls-tree', '-r', '-z', '--full-tree', tree], { encoding: 'utf8' }).stdout)
  return out.split('\0').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t')
    const [mode, , blob] = meta.split(' ')
    return { status: 'A', path, mode, blob }
  })
}

/** The bytes of each blob, read in one `git cat-file --batch`. */
function readBlobs(git, blobs) {
  const unique = [...new Set(blobs)]
  const out = git(['cat-file', '--batch'], { input: `${unique.join('\n')}\n` }).stdout
  const bytes = new Map()
  let at = 0
  for (const id of unique) {
    const eol = out.indexOf(0x0a, at)
    const [got, type, size] = out.subarray(at, eol).toString('utf8').split(' ')
    if (got !== id || type !== 'blob') throw new Error(`cat-file returned ${got} ${type} for ${id}`)
    bytes.set(id, out.subarray(eol + 1, eol + 1 + Number(size)))
    at = eol + 1 + Number(size) + 1
  }
  return bytes
}

/** The allowlist as it is in `tree`, or an empty one. */
function allowlistIn(git, tree) {
  const run = git(['cat-file', 'blob', `${tree}:${ALLOWLIST_PATH}`], { check: false })
  if (run.status !== 0) return new Map()
  const document = JSON.parse(String(run.stdout))
  if (document.schemaVersion !== 1 || !Array.isArray(document.files)) throw new Error(`${ALLOWLIST_PATH} is not schemaVersion 1 with a files list`)
  return new Map(document.files.map((entry) => [entry.path, entry]))
}

/**
 * Scan what one snapshot publishes.
 * @param {(args: string[], options?: object) => any} git - a runner for the repository that holds `tree`.
 * @param {{path: string, status: string, mode: string, blob: string|null}[]} files - the files to judge (deleted ones
 *   are skipped). A gitlink (a submodule commit) is judged by its path only.
 * @param {string} tree - the published tree, where the allowlist is read.
 * @returns {{scanned: number, refused: {path: string, rules: string[]}[], allowed: {path: string, rules: string[]}[]}}
 */
export function scanPublished(git, files, tree) {
  const judged = files.filter((f) => f.status !== 'D')
  const contents = readBlobs(git, judged.filter((f) => f.mode !== '160000').map((f) => f.blob))
  const allow = allowlistIn(git, tree)
  const refused = []
  const allowed = []
  for (const file of judged) {
    const bytes = file.mode === '160000' ? null : contents.get(file.blob)
    const rules = rulesFor(file.path, bytes)
    if (rules.length === 0) continue
    const entry = allow.get(file.path)
    const cleared = entry !== undefined && bytes !== null && entry.sha256 === sha256(bytes) && Array.isArray(entry.rules)
      && rules.every((rule) => entry.rules.includes(rule))
    ;(cleared ? allowed : refused).push({ path: file.path, rules, sha256: bytes === null ? null : sha256(bytes) })
  }
  return { scanned: judged.length, refused, allowed }
}

// CLI: list what a snapshot of <commit> would be refused for (every file, or the changes against --against <commit>).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  const git = gitIn(REPO, { ...env, GIT_NO_REPLACE_OBJECTS: '1' })
  const args = process.argv.slice(2)
  const against = args.includes('--against') ? args[args.indexOf('--against') + 1] : null
  const commit = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--against') ?? 'HEAD'
  const tree = String(git(['rev-parse', `${commit}^{tree}`], { encoding: 'utf8' }).stdout).trim()
  const files = against === null ? treeFiles(git, tree)
    : fileChanges(git, String(git(['rev-parse', `${against}^{tree}`], { encoding: 'utf8' }).stdout).trim(), tree)
  const { scanned, refused, allowed } = scanPublished(git, files, tree)
  for (const hit of refused) process.stdout.write(`REFUSED ${hit.path} [${hit.rules.join(', ')}] sha256 ${hit.sha256}\n`)
  for (const hit of allowed) process.stdout.write(`allowed ${hit.path} [${hit.rules.join(', ')}]\n`)
  process.stdout.write(`scanned ${String(scanned)} files of ${tree.slice(0, 9)}: ${String(refused.length)} refused, ${String(allowed.length)} allowed by ${ALLOWLIST_PATH}\n`)
  process.exit(refused.length === 0 ? 0 : 1)
}

export { gitIn }
