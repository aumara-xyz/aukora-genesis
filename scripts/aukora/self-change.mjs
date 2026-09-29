#!/usr/bin/env node
/**
 * AUMA'S CODE CHANGE, SHOWN IN FULL AND SIGNED BEFORE IT LANDS.
 *
 *   node scripts/aukora/self-change.mjs [--preview] "why, in one line" <path> [<path> …]
 *
 *   0. build   — a named face SOURCE file (plugins/aukora-face/<face>/ src, assets, vendor or config, as build-face.py
 *                carries it) makes this run `python3 scripts/build-face.py --only <face>` first, because the app loads
 *                the committed lib bundle, not src. Every changed face source must be named, because the build reads
 *                the whole working tree. Every lib file left changed joins the change. A failed build
 *                proposes nothing. --preview stops after step 1 and prints the operation text: no popup, check evidence only,
 *                no code chain (not even reconcile).
 *   1. propose — make an UNAUTHORIZED disposable preview of exactly these paths. The popup binds its original
 *                candidate digest, crossing bindings, base, Git tree, paths and the full SOURCE diff; each lib file the
 *                build wrote is one `generated:` line with its blob id (the tree still binds its bytes). The adapter
 *                re-reads the drafts; the ORIGINAL crossing binds the source drafts and the qualifier halts before
 *                signature, granting no authority. Its operation digest is sha256("aukora:operation-content:v1" ‖ 0x00 ‖
 *                content). The complete rendered witness must fit within 11,800 characters; a binary change is refused.
 *   2. approve — the app's Aumlok signer shows that exact text; Approve signs it, Refuse signs nothing.
 *   3. verify  — before any authorized candidate is materialized, BOTH scripts/aumlok/verify-approval and the independent
 *                verify-approval-cold.py must accept the PINNED approver key (the live Kira overlay's approverDid),
 *                operation bytes and digest, subject, control digest and current time. Both results are retained.
 *                The NAMED Aumlok candidate authority adapter consumes it through the verifier-only kernel, rechecks
 *                the preview, then invokes the ORIGINAL localCandidateStage. Original materialization stays AFTER
 *                approval. The untouched hybrid CLI continues to fail closed without hybrid authorization.
 *   4. apply   — commit EXACTLY the approved candidate tree with a compare-and-swap, then Aura, then fast-forward main.
 *                Every step is written to <evidence>/journal.jsonl, so an interruption leaves a record of where it stopped.
 *   5. become  — once main has it (and AUKORA_NO_BECOME is not 1), start the main worktree's scripts/aukora/become.mjs
 *                detached, logging to <evidence>/become.log. This script does not wait for it or check what it does.
 *
 * WHAT THIS IS NOT, said here because a reviewer will check: this is the SUPPORTED path, not an enforced one. The agent
 * runs as the owner's OS user with the owner's git credentials, so a direct `git push` is not stopped by anything on
 * this machine or on GitHub yet, and the approving key is a software key on this Mac (key class B; attendance is
 * reported, not proven). Server-side enforcement of main is the next piece of work.
 * NO_PQ_SIGNATURE (Ed25519 only; the original requires Ed25519+ML-DSA-65).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dualVerifyApproval } from '../aumlok/dual-verify.mjs'
import { codeChain } from './aura-code.mjs'
import { shownLimit } from './shown-limit.mjs'
import { precardCheck } from './precard-check.mjs'
import { WITNESS_DISPLAY_LIMIT, deriveApprovalWitness } from '../../apps/aukora-desktop/aumlok-signer.mjs'
import {
  CANDIDATE_CEILINGS, PATH_FENCE_DESCRIPTION, assertSourceIdentity, stageCandidatePreview,
  qualifyCandidateCrossing, candidateOperation, checkCandidatePreview, authorizeAndMaterializeCandidate, commitCandidateTree,
} from './aumlok-candidate-authority.mjs'
import { PENDING_INTENT_SCHEMA } from '../../vendor/aukora-seed-app/lib/apps/seed/src/governedCrossing.js'

// THIS script's checkout supplies every program it runs (approve-operation, verify-approval, the face tuples, the imports).
// AUKORA_SELF_CHANGE_SOURCE names another checkout to propose FROM: the trusted aukora_self_change tool
// (plugins/aukora-action-gate/lib/self-change-tool.mjs) runs the owner's copy against a contained agent's worktree, so the
// code that raises the popup is never the code being proposed.
const HOME_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REPO = process.env.AUKORA_SELF_CHANGE_SOURCE ? realpathSync(process.env.AUKORA_SELF_CHANGE_SOURCE) : HOME_REPO
const SUPPORT = process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
const STATE = join(SUPPORT, 'state')
const CLIENT = join(HOME_REPO, 'scripts', 'aumlok', 'approve-operation')
const WINDOW_SECONDS = 300
// The approval window shows at most WITNESS_DISPLAY_LIMIT characters (apps/aukora-desktop/aumlok-signer.mjs; being raised
// from 1,800 to 12,000 on 2026-09-27) and truncates the rest, saying so. 11,800 leaves 200 for the window's own heading.
// Check the actual rendered witness, including its heading and escaped characters. A face bundle is one `generated:` line,
// not its diff, so a face change fits. The ceiling follows the signer in THIS tree: GitHub main's signer (c398ccd63) still
// says 1,800, and a text longer than the window would be approved with lines unseen, so until 12,000 lands this is 1,650.
const MAX_SHOWN_CHARS = shownLimit(STATE, WITNESS_DISPLAY_LIMIT)

const fail = (message) => { process.stderr.write(`SELF-CHANGE REFUSED: ${message}\n`); process.exit(1) }
const candidateStep = (action) => {
  try { return action() } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
}
const PREVIEW = process.argv.slice(2).includes('--preview')
const [why, ...named] = process.argv.slice(2).filter((arg) => arg !== '--preview')
if (!why || named.length === 0) fail('usage: node scripts/aukora/self-change.mjs [--preview] "why, in one line" <path> [<path> …]')
if (why.includes('\n')) fail('the reason is one line')
// The named paths, then (step 0d) the face lib files a rebuild leaves changed.
const paths = [...named]

// THE CALLER'S GIT ENVIRONMENT IS NOT TRUSTED (2026-09-27, red team): GIT_CONFIG_* variables could install a textconv driver or an
// attributes file that makes the shown diff differ from the committed bytes, so every git call runs without them.
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ALLOW_PROTOCOL: process.env.AUKORA_CANDIDATE_SCRATCH === '1' ? 'file' : 'https:ssh',
}
const git = (args, options = {}) => {
  // The system config is ignored above, and it is where the macOS keychain credential helper is named; fetch and push
  // need it, so it alone is named again here. It supplies credentials and cannot change what a diff shows.
  const run = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-c', 'core.attributesFile=/dev/null', '-c', 'credential.helper=osxkeychain', ...args], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: GIT_ENV, ...options,
  })
  if (run.status !== 0 && options.check !== false) fail(`git ${args.join(' ')} failed: ${(run.stderr ?? '').trim()}`)
  return run
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** An Ed25519 did:key as the SPKI PEM the verifier takes. */
function didKeyToPem(did) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = 0n
  for (const c of did.replace(/^did:key:z/, '')) n = n * 58n + BigInt(ALPHABET.indexOf(c))
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const raw = Buffer.from(hex, 'hex')
  if (raw[0] !== 0xed || raw[1] !== 0x01) fail(`${did} is not an Ed25519 did:key`)
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw.subarray(2)])
  return createPublicKey({ key: der, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' })
}

// 0. THE PATHS ARE PLAIN FILES IN THIS REPOSITORY: no pathspec magic, no directories that could sweep in untracked files.
const plainFile = (path) => {
  if (path.startsWith(':') || /[*?[\]]/u.test(path)) fail(`${path} is a pattern, not a file; name each file`)
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) fail(`${path} is not a plain repository path (empty, . or .. segment); name the file as Git does`)
  const full = resolve(REPO, path)
  if (!full.startsWith(`${REPO}/`)) fail(`${path} is outside the repository`)
  if (existsSync(full) && !statSync(full).isFile()) fail(`${path} is not a file; name each file`)
}
for (const path of paths) plainFile(path)
// 0b. THE CHANGE SITS DIRECTLY ON GITHUB MAIN, so one approval cannot carry unapproved commits onto it.
// Source identity is checked before any fetch; the named adapter separately identifies disposable staging.
candidateStep(() => assertSourceIdentity({ repo: REPO, support: SUPPORT }))
git(['fetch', '-q', 'origin', 'main'])
const remoteMain = git(['rev-parse', 'origin/main']).stdout.trim()

// 0c. RECONCILE FIRST (scripts/aukora/aura-code.mjs). Approved and completed are distinct: an approved change is closed
// only by a definite result read from GitHub's main. One whose result was never recorded (killed, timed out, refused)
// is closed here against remote main. A local commit may still exist even if it never reached main. A spent
// approval is never reused. A preview appends nothing, so it skips this and never opens the chain.
const chain = PREVIEW ? null : codeChain(STATE)
const landed = (commit, main) => main !== undefined && git(['cat-file', '-e', `${commit}^{commit}`], { check: false }).status === 0
  && git(['merge-base', '--is-ancestor', commit, main], { check: false }).status === 0
if (!PREVIEW) chain.locked(() => {
  for (const recovered of chain.closeUnused()) {
    process.stdout.write(recovered.operation === 'code.change'
      ? `RECONCILED COMMITTED_NO_AURA (${recovered.approvalId}): local commit ${recovered.commit}; Aura ${String(recovered.sequence)}\n`
      : `RECONCILED a spent approval with no commit record (${recovered.approvalId}): application uncertain; Aura ${String(recovered.sequence)}\n`)
  }
  const entries = chain.read()
  const closed = chain.closedKeys('code.change.result', entries)
  for (const open of entries.filter((e) => e.operation === 'code.change' && !closed.has(e.approvalId ?? e.approvalDigest))) {
    const outcome = landed(open.commit, remoteMain) ? 'completed' : 'not-completed'
    const observedHead = git(['rev-parse', 'HEAD']).stdout.trim()
    const localCommitPresent = landed(open.commit, observedHead)
    const done = chain.append({ verdict: 'reconciled', operation: 'code.change.result', approvalId: open.approvalId ?? null, approvalDigest: open.approvalDigest,
      operationDigest: open.operationDigest, commit: open.commit, outcome, observedMain: remoteMain, observedHead, localCommitPresent,
      reconciledAt: new Date().toISOString() })
    process.stdout.write(`RECONCILED an earlier approved change (Aura ${String(open.sequence)}): ${open.commit.slice(0, 9)} remote main ${outcome}; present in local HEAD: ${localCommitPresent}; Aura ${String(done.sequence)}\n`)
  }
})
if (git(['rev-parse', 'HEAD']).stdout.trim() !== remoteMain) {
  fail(`this checkout is not at GitHub main (${remoteMain.slice(0, 9)}); commits GitHub does not have would ride along unapproved. Bring the checkout to main first`)
}

// 0d. A FACE SOURCE CHANGE CARRIES ITS REBUILT BUNDLE. The app loads plugins/aukora-face/<face>/lib/*, not src, so an
// approved source change alone (c398ccd63) changed nothing live. Each named path must differ from HEAD (checked first,
// so an unchanged file never costs a build); each face with named source is rebuilt; every lib file the build leaves
// changed joins this change. Only files the build itself reported writing are shown as `generated:` lines.
for (const path of named) {
  if (!existsSync(join(REPO, path))) continue
  const before = git(['rev-parse', '-q', '--verify', `HEAD:${path}`], { check: false })
  if (before.status === 0 && git(['hash-object', '--no-filters', '--', path]).stdout.trim() === before.stdout.trim()) {
    fail(`there is no uncommitted change to ${path}`)
  }
}
const buildFaceText = readFileSync(join(HOME_REPO, 'scripts', 'build-face.py'), 'utf8')
const pyTuple = (name) => {
  const found = buildFaceText.match(new RegExp(`^${name} = \\(([^)]*)\\)`, 'mu'))
  if (!found) fail(`scripts/build-face.py names no ${name} tuple, so face source cannot be told apart`)
  return [...found[1].matchAll(/'([^']+)'/gu)].map((match) => match[1])
}
const FACES = pyTuple('FACES')
const CARRY = pyTuple('CARRY')
const sourceFace = (path) => {
  const [top, dir, face, ...rest] = path.split('/')
  const inner = rest.join('/')
  return top === 'plugins' && dir === 'aukora-face' && FACES.includes(face)
    && CARRY.some((item) => inner === item || inner.startsWith(`${item}/`)) ? face : null
}
const faces = [...new Set(named.map(sourceFace).filter(Boolean))].sort()
// The face build runs the source checkout's build-face.py and toolchain (its own vendor/dsh first) on this machine, outside
// any sandbox; in another source that is the proposer's code, so a face change is proposed from the owner's checkout only.
if (faces.length > 0 && REPO !== HOME_REPO) fail(`${faces.join(', ')} face source needs a build, which is not run from ${REPO}; propose face changes from ${HOME_REPO}`)
// 0e. EVERY CHANGED FACE SOURCE IS NAMED. build-face.py builds from the working tree and places EVERY face's carried
// source, so a changed source file that is not named would ride into a bundle the window shows only as a blob
// (measured 2026-09-27: an unnamed spatial-tokens.css edit landed in layout's client.js under a named AppFrame diff).
if (faces.length > 0) {
  // 0f. The build runs before approval, so every script it runs must be HEAD's bytes.
  const moved = git(['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--', 'scripts', 'vendor/aukora-seed-app']).stdout.split('\0').filter(Boolean).map((entry) => entry.slice(3))
  if (moved.length > 0) fail(`the face build runs before approval, so ${moved.join(', ')} must match HEAD. ${moved.some((path) => named.includes(path)) ? 'Propose it alone first, then the face change' : 'Restore it or propose it alone first'}`)
  const dirty = git(['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--', 'plugins/aukora-face']).stdout
  const unnamed = dirty.split('\0').filter(Boolean).map((entry) => entry.slice(3)).filter((path) => sourceFace(path) && !named.includes(path))
  if (unnamed.length > 0) fail(`face source changed but not named, and the rebuilt bundle would carry it unseen: ${unnamed.join(', ')}. Name each one or restore it`)
}
// Only build-face.py's fixed outputs can be `generated:`, and only when their inode changed after this build started;
// any other changed lib file, or one the build did not touch, is shown in full.
const FACE_OUTPUTS = ['index.js', 'client.js', 'invariant.js', '.build-inputs.json']
const generated = {}
for (const face of faces) {
  process.stdout.write(`FACE BUILD    ${face}: python3 scripts/build-face.py --only ${face}\n`)
  const outputs = new Set(FACE_OUTPUTS.map((name) => `plugins/aukora-face/${face}/lib/${name}`))
  const startedNs = BigInt(Date.now()) * 1_000_000n
  const build = spawnSync('python3', [join(REPO, 'scripts', 'build-face.py'), '--only', face], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  })
  const output = `${build.stdout ?? ''}${build.stderr ?? ''}`
  if (build.status !== 0) {
    fail(`the ${face} face did not build (${build.error ? build.error.message : `exit ${String(build.status ?? build.signal)}`}), so nothing was proposed:\n${output.trimEnd().split('\n').slice(-25).join('\n')}`)
  }
  for (const line of output.split('\n').filter((line) => line.startsWith('FACE BUILT '))) process.stdout.write(`${line}\n`)
  const wrote = new Set(output.split('\n').filter((line) => line.startsWith('FACE WROTE ')).map((line) => line.slice(11).trim())
    .filter((path) => {
      const st = outputs.has(path) ? lstatSync(join(REPO, path), { bigint: true, throwIfNoEntry: false }) : undefined
      return st !== undefined && st.isFile() && st.ctimeNs >= startedNs
    }))
  const changed = git(['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--', `plugins/aukora-face/${face}/lib`]).stdout
  for (const entry of changed.split('\0').filter(Boolean)) {
    const path = entry.slice(3)
    if (!existsSync(join(REPO, path))) fail(`${path} is deleted in the working tree; a deletion cannot be carried here`)
    plainFile(path)
    if (!paths.includes(path)) paths.push(path)
    if (wrote.has(path)) generated[path] = git(['hash-object', '--no-filters', '--', path]).stdout.trim()
    process.stdout.write(`FACE LIB      ${path}: ${wrote.has(path) ? `generated, blob ${generated[path]}` : 'changed but NOT written by this build, so shown in full'}\n`)
  }
}

// 1. PROPOSE: freeze bytes, paths, original digest and tree in an unauthorized disposable preview.
// The source checkout/index stays untouched. Original materialization requires the approval below.
let candidate = candidateStep(() => stageCandidatePreview({ repo: REPO, support: SUPPORT, paths, explicitlyNamedPaths: paths, why, generated }))
const previews = new Set([candidate])
// The disposable candidate (a full local fetch, ~160 MB) is removed when this process exits normally, preview or not: an
// approved run has committed and pushed from this checkout by then, and its evidence directory keeps the record.
{
  process.on('exit', () => {
    for (const preview of previews) {
      try {
        const home = realpathSync(join(SUPPORT, 'state', 'home', 'code-candidates'))
        const directory = realpathSync(preview.directory)
        if (dirname(directory) === home && /^candidate-[A-Za-z0-9]{6}$/u.test(basename(directory))) rmSync(directory, { recursive: true, force: true })
        else process.stdout.write(`CANDIDATE LEFT ${preview.directory} (not a candidate directory under ${home}, so not removed)\n`)
      } catch (error) { process.stdout.write(`CANDIDATE LEFT ${preview.directory} (${error instanceof Error ? error.message : String(error)})\n`) }
    }
  })
}
// These checks read the SHOWN source diff; generated files are UTF-8 text by the adapter's own byte check.
const { base, diff } = candidate
if (diff.trim() === '') fail(`there is no uncommitted change to ${paths.join(', ')}`)
if (diff.includes('\u0000')) fail('this change contains NUL bytes, which the approval window cannot show; it cannot be approved here')
if (/^Binary files |^GIT binary patch$/mu.test(diff)) fail('a binary change cannot be shown as text in the approval window, so it cannot be approved here')
const evidenceRoot = join(STATE, 'home', 'code-evidence')
mkdirSync(evidenceRoot, { recursive: true })
const evidence = mkdtempSync(join(evidenceRoot, `${new Date().toISOString().slice(0, 19).replace(/:/g, '')}-change-`))
// PRECARD CHECK: no signer contact or approval consumption before this refusal.
const checked = await precardCheck({ repo: candidate.worktree, tree: candidate.tree, base: candidate.base, evidence })
if (checked.proofRefused) { process.stderr.write(`${checked.failure}\n`); process.exit(1) }
if (!checked.passed) fail(`${checked.failure}. Evidence: ${evidence}`)
// PRECARD CHECK END

// The adapter binds its saved reason to the entire operation. Restage with the check
// line in that reason, then require identical bytes before qualifying this preview.
const checkedCandidate = candidate
const checkedWhy = `${why}\n${checked.summary}\n${checked.composition}`
candidate = candidateStep(() => stageCandidatePreview({ repo: REPO, support: SUPPORT, paths, explicitlyNamedPaths: paths, why: checkedWhy, generated }))
previews.add(candidate)
if (candidate.base !== checkedCandidate.base || candidate.tree !== checkedCandidate.tree || candidate.digest !== checkedCandidate.digest) {
  fail(`the candidate changed after its checks. Evidence: ${evidence}`)
}
// Agent-authored words/paths are advisory hints; only re-read disk bytes feed
// the original crossing's draft hash. The suite does not grant crossing authority.
const crossings = candidateStep(() => qualifyCandidateCrossing(candidate, {
  intent: { schema: PENDING_INTENT_SCHEMA, intentId: candidate.digest, goal: why, rationale: why,
    affectedPaths: paths.map(path => ({ path, epistemicStatus: 'inferred' })), riskNotes: '',
    authoredBy: 'workbench', advisoryOnly: true, grantsAuthority: false }, tests: [],
}))
const content = candidateStep(() => candidateOperation(candidate, checkedWhy))
const bytes = Buffer.from(content, 'utf8')
const witness = candidateStep(() => deriveApprovalWitness(bytes))
if (content.length > MAX_SHOWN_CHARS || witness.words.length > MAX_SHOWN_CHARS) {
  fail(`this change renders as ${String(witness.words.length)} characters and the approval window allows ${String(MAX_SHOWN_CHARS)} here; split it into smaller changes so every line is seen`)
}
const operationDigest = sha256(Buffer.concat([Buffer.from('aukora:operation-content:v1', 'utf8'), Buffer.from([0]), bytes]))
if (PREVIEW) {
  process.stdout.write(`\n──────── PREVIEW: the exact operation text the approval window would show ────────\n${content}`)
  process.stdout.write(`──────── ${String(content.length)} characters (rendered witness ${String(witness.words.length)}; limit ${String(MAX_SHOWN_CHARS)})\n`)
  process.stdout.write(`OPERATION     ${operationDigest}\nTREE          ${candidate.tree}\n`)
  process.stdout.write(`PREVIEW ONLY  no popup raised, check evidence: ${evidence}, code chain untouched. Run again without --preview to ask for approval.\n`)
  process.exit(0)
}

const overlay = readFileSync(join(SUPPORT, 'kira-deployment-overlay.patch.yml'), 'utf8')
const setting = (name) => overlay.match(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm'))?.[1] ?? fail(`the live overlay names no ${name}`)
const subject = setting('subject')
const controlDigest = setting('activeControlDigest')
const approverDid = setting('approverDid')

const journal = (state, detail = {}) => appendFileSync(join(evidence, 'journal.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), state, ...detail })}\n`)
const operationFile = join(evidence, 'operation.txt')
writeFileSync(operationFile, bytes)
const artifact = join(evidence, 'approval.json')
const pinnedPem = join(evidence, 'approver.pem')
writeFileSync(pinnedPem, didKeyToPem(approverDid))
journal('PROPOSED', { base, paths: candidate.paths, candidateDigest: candidate.digest, tree: candidate.tree, operationDigest,
  crossingBindings: crossings.map(crossing => crossing.binding), grantsAuthority: false,
  preview: candidate.directory, ceilings: CANDIDATE_CEILINGS, fence: PATH_FENCE_DESCRIPTION })

// 2. APPROVE IN THE APP
candidateStep(() => checkCandidatePreview(candidate))
process.stdout.write(`${CANDIDATE_CEILINGS.join('\n')}\nCANDIDATE ${candidate.digest}\nTREE ${candidate.tree}\nFENCE ${PATH_FENCE_DESCRIPTION}\n`)
for (const crossing of crossings) process.stdout.write(`CROSSING ${crossing.binding.bindingHash} ${crossing.envelope.proposal.targetPath}; haltedBeforeSignature=true; grantsAuthority=false\n`)
process.stdout.write(`\n>>> LOOK AT THE AUKORA APP: it shows this exact change (${paths.length} path(s)). Approve signs it; Refuse signs nothing. <<<\n`)
const asked = spawnSync(process.execPath, [CLIENT,
  '--controller', join(STATE, 'aumlok'),
  '--expect-subject', subject, '--expect-control-digest', controlDigest,
  '--operation', operationFile, '--operation-digest', operationDigest,
  '--signer-socket', join(STATE, 'aumlok-signer.sock'),
  '--artifact-out', artifact,
  '--expires-at', String(Math.floor(Date.now() / 1000) + WINDOW_SECONDS),
], { cwd: REPO, encoding: 'utf8' })
process.stdout.write(`${asked.stdout ?? ''}${asked.stderr ?? ''}`)
if (asked.status !== 0 || !existsSync(artifact)) {
  journal('NOT_APPROVED', { exit: asked.status })
  fail(`not approved (exit ${String(asked.status)}). NOTHING was committed; the change is still in the working tree. Evidence: ${evidence}`)
}

// 3. VERIFY THE APPROVAL BEFORE ANYTHING IS COMMITTED
const { accepted, nodeVerdict, coldVerdict } = dualVerifyApproval({
  artifact, evidence, operationFile, operationDigest, subject, approverDid, controlDigest, pinnedPem,
  maxWindow: WINDOW_SECONDS,
})
if (!accepted) {
  journal('APPROVAL_REFUSED', { node: nodeVerdict, cold: coldVerdict })
  fail(`approval verifiers: Node=${nodeVerdict}; Python=${coldVerdict}. NOTHING was committed. Evidence: ${evidence}`)
}
try { checkCandidatePreview(candidate) } catch (error) {
  journal('MOVED', {})
  fail(`the candidate changed after it was shown. NOTHING was committed: ${error instanceof Error ? error.message : String(error)}`)
}
// ONE APPROVAL, ONE USE — decided by the verifier-only kernel (vendor/authority, aumara-xyz/aukora@def297f, 37/37
// conformance). The approval id is the SIGNED challenge, never a hash of the file, so editing an unsigned field cannot mint
// a second id. The consumed-ids set lives beside the code Aura chain and only grows on ALLOW.
// ONE USE (the kernel, inside the candidate adapter), THE EXACT-TREE COMMIT AND THE APPROVED ENTRY in one locked region
// of the code chain (scripts/aukora/aura-code.mjs), so an id the kernel spends is recorded with what it paid for. A
// failure after the commit is journaled separately so the next run cannot call a committed approval unused.
let approvalId, approvalDigest, commit, entry, change
try {
  chain.locked(() => {
    const { decision, materialized } = authorizeAndMaterializeCandidate(candidate, {
      approvalPath: artifact, approverDid, subject, controlDigest, operationBytes: bytes,
      consumedIdsPath: chain.consumedIds, stateRoot: STATE, createConsumedIds: chain.mayCreateSpentSet(),
    })
    writeFileSync(join(evidence, 'kernel-decision.txt'), `${JSON.stringify(decision, null, 2)}\n`)
    if (decision?.decision !== 'ALLOW' || materialized?.ok !== true) throw new Error('the adapter returned no allowed, materialized candidate')
    approvalId = decision.approvalId ?? null
    approvalDigest = sha256(readFileSync(artifact))
    journal('APPROVED', { approvalId, approvalDigest, approverDid, candidateDigest: candidate.digest, tree: candidate.tree })
    change = {
      verdict: 'approved', operation: 'code.change', consumedBy: 'aukora-kernel', approvalId,
      operationDigest, approvalDigest, approverDid, base, paths: candidate.paths, candidateDigest: candidate.digest,
      tree: candidate.tree, ceilings: CANDIDATE_CEILINGS,
    }
    // commit-tree never rereads mutable source files; update-ref compares against the approved base.
    // The candidate was restaged with the checks line in its reason; the commit must present that same reason.
    commit = commitCandidateTree(candidate, { why: checkedWhy, approverDid, approvalDigest, operationDigest })
    change.commit = commit
    journal('COMMITTED', { commit, tree: candidate.tree, candidateDigest: candidate.digest, change })
    entry = chain.append(change)
  })
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  const head = git(['rev-parse', 'HEAD'], { check: false })
  const observedHead = head.status === 0 ? head.stdout.trim() : null
  if (commit) {
    const state = entry ? 'COMMITTED_AURA_RECORDED' : 'COMMITTED_NO_AURA'
    try { journal(state, { approvalId, approvalDigest, base, commit, observedHead, change, error: detail }) }
    catch (journalError) { process.stderr.write(`JOURNAL WRITE FAILED: ${journalError.message}\n`) }
    fail(`${state}: the source branch was committed at ${commit}; HEAD ${observedHead ?? 'unreadable'}; ${entry ? 'Aura recorded' : 'Aura append was not confirmed'}. No push was attempted. Evidence: ${evidence}; ${detail}`)
  }
  const state = observedHead === base ? 'CANDIDATE_AUTHORIZATION_REFUSED' : 'HEAD_STATE_UNCERTAIN'
  journal(state, { base, observedHead, error: detail })
  fail(`candidate authorization, materialization or commit refused; ${observedHead === base ? 'HEAD remains at the approved base' : `HEAD ${observedHead ?? 'unreadable'} differs from the approved base; commit state is uncertain`}: ${detail}`)
}
journal('AURA_RECORDED', { sequence: entry.sequence, hash: entry.hash })

// The approval verified above is the authority for this change; nothing on GitHub enforces it. Then the RESULT as GitHub
// reports it: the commit inside main is completed (even if the client saw an error); a refused push is not-completed, and
// the local commit is undone so no commit carrying approval trailers is left for a later push; anything else is uncertain
// and stays open for the next run.
const pushed = git(['push', '--no-verify', 'origin', `${commit}:refs/heads/main`], { check: false })
journal(pushed.status === 0 ? 'PUSHED' : 'PUSH_FAILED', pushed.status === 0 ? {} : { error: (pushed.stderr ?? '').trim().split('\n').pop() })
const seen = git(['ls-remote', 'origin', 'refs/heads/main'], { check: false })
const observed = seen.status !== 0 || seen.stdout.trim() === '' ? undefined : seen.stdout.trim().split(/\s+/u)[0]
if (observed !== undefined) git(['fetch', '-q', 'origin', 'main'], { check: false })
const outcome = observed === undefined ? 'uncertain' : landed(commit, observed) ? 'completed' : pushed.status !== 0 ? 'not-completed' : 'uncertain'
const result = chain.append({ verdict: 'observed', operation: 'code.change.result', approvalId, approvalDigest, operationDigest, commit, outcome, observedMain: observed ?? 'unreadable' })
journal('RESULT', { outcome, observedMain: observed ?? 'unreadable', sequence: result.sequence })
if (outcome === 'not-completed') {
  git(['reset', '-q', '--mixed', base], { check: false })
  journal('UNCOMMITTED', { base })
}
const onMain = outcome === 'completed'

// 5. BECOME: the main worktree's become.mjs turns the landed commit into a release and restarts into it after its own
// approval. It is started detached and not waited for; its log is the only record of what it did.
let becoming = null
if (onMain && process.env.AUKORA_NO_BECOME !== '1') {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { check: false })
  const mainWorktree = common.status === 0 && common.stdout.trim() ? dirname(common.stdout.trim()) : null
  const becomeScript = mainWorktree ? join(mainWorktree, 'scripts', 'aukora', 'become.mjs') : null
  if (becomeScript && existsSync(becomeScript)) {
    const log = join(evidence, 'become.log')
    const fd = openSync(log, 'a', 0o600)
    try {
      const child = spawn(process.execPath, [becomeScript, '--commit', commit, '--why', why],
        { cwd: mainWorktree, detached: true, stdio: ['ignore', fd, fd] })
      // Started only if become.mjs exits 0 (it detaches its worker and returns at once).
      const failure = await new Promise((done) => {
        setTimeout(() => done('no exit within 30 s'), 30_000)
        child.once('exit', (code) => done(code === 0 ? null : `become.mjs exited ${code}`))
        child.on('error', (error) => done(error.message))
      })
      child.unref()
      becoming = `BECOMING      ${failure ? `NOT started: ${failure}` : 'started'}; log ${log}`
    } catch (error) {
      becoming = `BECOMING      NOT started: ${error instanceof Error ? error.message : String(error)}`
    } finally { closeSync(fd) }
  } else {
    becoming = `BECOMING      NOT started: ${becomeScript ?? 'the main worktree (git --git-common-dir unreadable)'} is missing`
  }
  process.stdout.write(`${becoming}\n`)
}

const summary = [
  '',
  '════════ SELF-CHANGE APPROVED ════════',
  ...CANDIDATE_CEILINGS.map((ceiling) => `  ceiling       ${ceiling}`),
  `  why           ${why}`,
  `  paths         ${candidate.paths.join(', ')}`,
  `  candidate     ${candidate.digest}`,
  `  tree          ${candidate.tree}`,
  `  identity      ${candidate.identity}`,
  `  operation     ${operationDigest}`,
  `  approval      approved in the AUKORA popup; key ${approverDid}, verified before commit; kernel: one use, consumed`,
  '                (a software key on this Mac; the click is recorded, attendance is reported, not proven)',
  `  commit        ${commit}  (base ${base.slice(0, 9)})`,
  `  Aura          approval at code chain sequence ${String(entry.sequence)}; result ${outcome} at ${String(result.sequence)}`,
  `  GitHub main   ${onMain ? 'fast-forwarded' : outcome === 'uncertain' ? `UNCERTAIN, not verified (will be re-checked on the next run): ` : `NOT moved (the change is back in the working tree): ${(pushed.stderr ?? '').trim().split('\n').pop()}`}`,
  `  evidence      ${evidence}`,
  `  fence         ${PATH_FENCE_DESCRIPTION}`,
  ...(becoming ? [`  ${becoming}`] : []),
  ...(onMain ? ['  LANDED on GitHub main; live only when state/home/become/last.json says outcome live for this commit'] : []),
  '',
].join('\n')
writeFileSync(join(evidence, 'summary.txt'), `${summary}\n`)
process.stdout.write(`${summary}\n`)
process.exit(onMain && !becoming?.includes('NOT started') ? 0 : 1)
