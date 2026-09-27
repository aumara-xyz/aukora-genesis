#!/usr/bin/env node
/**
 * AUMA'S CODE CHANGE, SHOWN IN FULL AND SIGNED BEFORE IT LANDS.
 *
 *   node scripts/aukora/self-change.mjs "why, in one line" <path> [<path> …]
 *
 *   1. propose — make an UNAUTHORIZED disposable preview of exactly these paths. The popup binds its original
 *                candidate digest, crossing bindings, base, Git tree, paths and full diff. The adapter re-reads the
 *                drafts; the ORIGINAL crossing binds them and the qualifier halts before signature, granting no authority.
 *                Its operation digest is sha256("aukora:operation-content:v1" ‖ 0x00 ‖ content). The complete rendered
 *                witness must fit within 1,650 characters; a binary change is refused.
 *   2. approve — the app's Aumlok signer shows that exact text; Approve signs it, Refuse signs nothing.
 *   3. verify  — before any authorized candidate is materialized, the approval is checked with scripts/aumlok/verify-approval
 *                against the PINNED approver key (the live Kira overlay's approverDid), and its signed fields must name
 *                this operation digest, this subject, this control digest, and an expiry that has not passed.
 *                The NAMED Aumlok candidate authority adapter consumes it through the verifier-only kernel, rechecks
 *                the preview, then invokes the ORIGINAL localCandidateStage. Original materialization stays AFTER
 *                approval. The untouched hybrid CLI continues to fail closed without hybrid authorization.
 *   4. apply   — commit EXACTLY the approved candidate tree with a compare-and-swap, then Aura, then fast-forward main.
 *                Every step is written to <evidence>/journal.jsonl, so an interruption leaves a record of where it stopped.
 *
 * WHAT THIS IS NOT, said here because a reviewer will check: this is the SUPPORTED path, not an enforced one. The agent
 * runs as the owner's OS user with the owner's git credentials, so a direct `git push` is not stopped by anything on
 * this machine or on GitHub yet, and the approving key is a software key on this Mac (key class B; attendance is
 * reported, not proven). Server-side enforcement of main is the next piece of work.
 * NO_PQ_SIGNATURE (Ed25519 only; the original requires Ed25519+ML-DSA-65).
 */
import { spawnSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeChain } from './aura-code.mjs'
import { deriveApprovalWitness } from '../../apps/aukora-desktop/aumlok-signer.mjs'
import {
  CANDIDATE_CEILINGS, PATH_FENCE_DESCRIPTION, assertSourceIdentity, stageCandidatePreview,
  qualifyCandidateCrossing, candidateOperation, checkCandidatePreview, authorizeAndMaterializeCandidate, commitCandidateTree,
} from './aumlok-candidate-authority.mjs'
import { PENDING_INTENT_SCHEMA } from '../../vendor/aukora-seed-app/lib/apps/seed/src/governedCrossing.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SUPPORT = process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
const STATE = join(SUPPORT, 'state')
const CLIENT = join(REPO, 'scripts', 'aumlok', 'approve-operation')
const VERIFY = join(REPO, 'scripts', 'aumlok', 'verify-approval')
const WINDOW_SECONDS = 300
// The approval window shows at most 1,800 characters (apps/aukora-desktop/aumlok-signer.mjs WITNESS_DISPLAY_LIMIT) and
// truncates the rest. Check the actual rendered witness, including its heading and escaped characters.
const MAX_SHOWN_CHARS = 1650

const fail = (message) => { process.stderr.write(`SELF-CHANGE REFUSED: ${message}\n`); process.exit(1) }
const candidateStep = (action) => {
  try { return action() } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
}
const [why, ...paths] = process.argv.slice(2)
if (!why || paths.length === 0) fail('usage: node scripts/aukora/self-change.mjs "why, in one line" <path> [<path> …]')
if (why.includes('\n')) fail('the reason is one line')

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
for (const path of paths) {
  if (path.startsWith(':') || /[*?[\]]/u.test(path)) fail(`${path} is a pattern, not a file; name each file`)
  const full = resolve(REPO, path)
  if (!full.startsWith(`${REPO}/`)) fail(`${path} is outside the repository`)
  if (existsSync(full) && !statSync(full).isFile()) fail(`${path} is not a file; name each file`)
}
// 0b. THE CHANGE SITS DIRECTLY ON GITHUB MAIN, so one approval cannot carry unapproved commits onto it.
// Source identity is checked before any fetch; the named adapter separately identifies disposable staging.
candidateStep(() => assertSourceIdentity({ repo: REPO, support: SUPPORT }))
git(['fetch', '-q', 'origin', 'main'])
const remoteMain = git(['rev-parse', 'origin/main']).stdout.trim()

// 0c. RECONCILE FIRST (scripts/aukora/aura-code.mjs). Approved and completed are distinct: an approved change is closed
// only by a definite result read from GitHub's main. One whose result was never recorded (killed, timed out, refused)
// is closed here against remote main. A local commit may still exist even if it never reached main. A spent
// approval is never reused.
const chain = codeChain(STATE)
const landed = (commit, main) => main !== undefined && git(['cat-file', '-e', `${commit}^{commit}`], { check: false }).status === 0
  && git(['merge-base', '--is-ancestor', commit, main], { check: false }).status === 0
chain.locked(() => {
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

// 1. PROPOSE: freeze bytes, paths, original digest and tree in an unauthorized disposable preview.
// The source checkout/index stays untouched. Original materialization requires the approval below.
const candidate = candidateStep(() => stageCandidatePreview({ repo: REPO, support: SUPPORT, paths, explicitlyNamedPaths: paths, why }))
// Agent-authored words/paths are advisory hints; only re-read disk bytes feed
// the original crossing's draft hash. No tests/rehearsal are claimed here.
const crossings = candidateStep(() => qualifyCandidateCrossing(candidate, {
  intent: { schema: PENDING_INTENT_SCHEMA, intentId: candidate.digest, goal: why, rationale: why,
    affectedPaths: paths.map(path => ({ path, epistemicStatus: 'inferred' })), riskNotes: '',
    authoredBy: 'workbench', advisoryOnly: true, grantsAuthority: false }, tests: [],
}))
const { base, diff } = candidate
if (diff.trim() === '') fail(`there is no uncommitted change to ${paths.join(', ')}`)
if (diff.includes('\u0000')) fail('this change contains NUL bytes, which the approval window cannot show; it cannot be approved here')
if (/^Binary files |^GIT binary patch$/mu.test(diff)) fail('a binary change cannot be shown as text in the approval window, so it cannot be approved here')
const content = candidateStep(() => candidateOperation(candidate, why))
const bytes = Buffer.from(content, 'utf8')
const witness = candidateStep(() => deriveApprovalWitness(bytes))
if (content.length > MAX_SHOWN_CHARS || witness.words.length > MAX_SHOWN_CHARS) {
  fail(`this change renders as ${String(witness.words.length)} characters and the approval window allows ${String(MAX_SHOWN_CHARS)} here; split it into smaller changes so every line is seen`)
}
const operationDigest = sha256(Buffer.concat([Buffer.from('aukora:operation-content:v1', 'utf8'), Buffer.from([0]), bytes]))

const overlay = readFileSync(join(SUPPORT, 'kira-deployment-overlay.patch.yml'), 'utf8')
const setting = (name) => overlay.match(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm'))?.[1] ?? fail(`the live overlay names no ${name}`)
const subject = setting('subject')
const controlDigest = setting('activeControlDigest')
const approverDid = setting('approverDid')

const evidence = join(STATE, 'home', 'code-evidence', `${new Date().toISOString().slice(0, 16).replace(/:/g, '')}-change-${operationDigest.slice(0, 8)}`)
mkdirSync(evidence, { recursive: true })
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
const checked = spawnSync(process.execPath, [VERIFY, artifact, '--pub', pinnedPem], { cwd: evidence, encoding: 'utf8' })
writeFileSync(join(evidence, 'verify-approval.txt'), `${checked.stdout ?? ''}${checked.stderr ?? ''}`)
if (checked.status !== 0) {
  journal('APPROVAL_REFUSED', { exit: checked.status })
  fail(`the returned approval does not verify against the pinned key ${approverDid}. NOTHING was committed. See ${join(evidence, 'verify-approval.txt')}`)
}
const approval = JSON.parse(readFileSync(artifact, 'utf8'))
const mismatch = [
  approval.operationDigest !== operationDigest && 'operation digest',
  approval.subject !== subject && 'subject',
  approval.activeControlDigest !== controlDigest && 'control digest',
  !(Number(approval.expiresAt) > Math.floor(Date.now() / 1000)) && 'expiry',
].filter(Boolean)
if (mismatch.length > 0) {
  journal('APPROVAL_REFUSED', { mismatch })
  fail(`the approval is signed but does not cover this change (${mismatch.join(', ')}). NOTHING was committed`)
}
try { checkCandidatePreview(candidate) } catch (error) {
  journal('MOVED', {})
  fail(`the candidate changed after it was shown. NOTHING was committed: ${error instanceof Error ? error.message : String(error)}`)
}
// ONE APPROVAL, ONE USE — decided by the verifier-only kernel (vendor/aukora-kernel, aumara-xyz/aukora@def297f, 37/37
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
      consumedIdsPath: chain.consumedIds, createConsumedIds: chain.mayCreateSpentSet(),
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
    commit = commitCandidateTree(candidate, { why, approverDid, approvalDigest, operationDigest })
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
  '',
].join('\n')
writeFileSync(join(evidence, 'summary.txt'), `${summary}\n`)
process.stdout.write(`${summary}\n`)
process.exit(onMain ? 0 : 1)
