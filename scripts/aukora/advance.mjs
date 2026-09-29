#!/usr/bin/env node
/**
 * MAIN MOVES ONLY ON THE OWNER'S CLICK: the same approval organs as self-change.mjs, over "move main from X to Y".
 *
 *   node scripts/aukora/advance.mjs "why, in one line" <remote> <commit> [--snapshot | --replace-root]
 *
 *   --snapshot      publish the TREE of <commit> as one new commit on top of the remote's main (none of its history)
 *   --replace-root  publish the tree of <commit> as a NEW ROOT commit that REPLACES the remote main's history. For the
 *                   clean public repository only: every commit it drops is listed in the popup, so it refuses a main of
 *                   more than MAX_LISTED_COMMITS commits.
 *
 *   0. refuse   — a remote whose push does not go where the popup says: a pushurl, more than one url, a
 *                url.*.insteadOf / pushInsteadOf rule that rewrites its URL; and refs/replace or grafts, which change
 *                which objects the shown tree and commits are. A snapshot is also refused, by path and rule id, when a
 *                file it publishes is private-shaped (scripts/aukora/snapshot-scan.mjs: legal/, patent, private,
 *                counsel, emails, /Users/ paths, key/token shapes; fixtures only by snapshot-allow.json), and when its
 *                commit would carry an author email that is not a placeholder. All before any popup.
 *   1. propose — reads <remote>'s main now (none = this creates main), requires <commit> to fast-forward it (except
 *                --replace-root), and writes one operation: the repository, main now, main after, the tree, the
 *                commits it adds (and drops), the files it adds, modifies and deletes against main now, and why. Its
 *                digest is sha256("aukora:operation-content:v1" ‖ 0x00 ‖ content), as in self-change.mjs.
 *   2. approve — the app's Aumlok signer shows that exact text; Approve signs it, Refuse signs nothing.
 *   3. verify  — BOTH scripts/aumlok/verify-approval and verify-approval-cold.py must accept the PINNED approver key
 *                (the live Kira overlay's approverDid), operation bytes and digest, subject, control digest and time;
 *                both results are retained, then the
 *                verifier-only kernel (scripts/aukora/decide.mjs) consumes the approval once.
 *   4. apply   — one Aura entry in state/home/aura-code/aura.jsonl, then the push, leased on the main it showed: if main
 *                moved after the popup, the push fails instead of overwriting.
 *
 * WHAT THIS IS NOT: the same limits as self-change.mjs. Agents run as the owner's OS user with his git credentials, so a
 * direct push is not stopped; the key is a software key on this Mac; attendance is reported, not proven; nothing on
 * GitHub checks the approval. The receipt is evidence for a reader, not a lock. The private-shape scan runs only for
 * --snapshot and --replace-root: a plain advance publishes history, and no file scan covers history. The scan is
 * shape-based (snapshot-scan.mjs lists what passes it), and its allowlist is a file any same-UID agent can edit; the
 * popup says when a snapshot changes it. remote.<name>.receivepack, core.sshCommand and credential helpers are not
 * checked.
 */
import { spawnSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dualVerifyApproval } from '../aumlok/dual-verify.mjs'
import { approvalIdFrom, codeChain } from './aura-code.mjs'
import { ALLOWLIST_PATH, emailIsPlaceholder, fileChanges, gitIn, scanPublished, treeFiles } from './snapshot-scan.mjs'
import { shownLimit } from './shown-limit.mjs'
import { precardCheck } from './precard-check.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SUPPORT = process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
const STATE = join(SUPPORT, 'state')
const CLIENT = join(REPO, 'scripts', 'aumlok', 'approve-operation')
const WINDOW_SECONDS = 300
// The approval window shows 1,800 characters (aumlok-signer.mjs WITNESS_DISPLAY_LIMIT); stay under it.
const MAX_SHOWN_CHARS = shownLimit(STATE)
const MAX_LISTED_COMMITS = 12
const MAX_LISTED_FILES = 25
const MIN_PATH_WIDTH = 24

const fail = (message) => { process.stderr.write(`ADVANCE REFUSED: ${message}\n`); process.exit(1) }
const argv = process.argv.slice(2)
// --snapshot: publish the TREE of <commit> as one new commit on top of the remote's main, so a repository kept clean of
// history (the public aukora-genesis) receives this checkout's state and none of its history.
// --replace-root: the same tree as a new ROOT commit that replaces main's history (a force push leased on main).
const FLAGS = new Set(['--snapshot', '--replace-root'])
const unknown = argv.find((a) => a.startsWith('--') && !FLAGS.has(a))
if (unknown !== undefined) fail(`unknown option ${unknown}`)
const replaceRoot = argv.includes('--replace-root')
const snapshot = replaceRoot || argv.includes('--snapshot')
const [why, remote, target] = argv.filter((a) => !FLAGS.has(a))
if (!why || !remote || !target) fail('usage: node scripts/aukora/advance.mjs "why, in one line" <remote name or URL> <commit> [--snapshot | --replace-root]')
if (why.includes('\n')) fail('the reason is one line')

// No GIT_* from the caller (GIT_DIR, GIT_CONFIG_*, GIT_AUTHOR_* …), and replacement objects are never read.
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), GIT_NO_REPLACE_OBJECTS: '1' }
const git = (args, options = {}) => {
  const run = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: GIT_ENV, ...options })
  if (run.status !== 0 && options.check !== false) fail(`git ${args.join(' ')} failed: ${(run.stderr ?? '').trim()}`)
  return run
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

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

const lines = (text) => String(text ?? '').split('\n').filter(Boolean)
const withoutUserinfo = (address) => address.replace(/\/\/[^@/]*@/u, '//')

// 0. THE PUSH GOES WHERE THE POPUP SAYS, WITH THE OBJECTS IT SHOWS. Every check here runs before ls-remote, so the main
// the popup names is read from the same place the push writes.
const named = !/^(https?:|ssh:|git@|file:|\/)/u.test(remote)
const configured = named ? lines(git(['config', '--get-all', `remote.${remote}.url`], { check: false }).stdout) : [remote]
if (configured.length === 0) fail(`no remote named ${remote}`)
if (configured.length > 1) fail(`remote ${remote} has ${String(configured.length)} urls; a push goes to every one and the popup shows one`)
const pushurls = named ? lines(git(['config', '--get-all', `remote.${remote}.pushurl`], { check: false }).stdout) : []
if (pushurls.length > 0) {
  fail(`remote ${remote} has a pushurl (${withoutUserinfo(pushurls[0])}): the push would not go to ${withoutUserinfo(configured[0])}, the URL the popup shows. Remove it or pass the URL itself`)
}
const rewrites = lines(git(['config', '--get-regexp', '^url\\..*\\.(insteadof|pushinsteadof)$'], { check: false }).stdout)
  .map((line) => ({ key: line.slice(0, line.indexOf(' ')), prefix: line.slice(line.indexOf(' ') + 1) }))
  .filter((rule) => rule.key !== '' && rule.prefix !== '' && configured[0].startsWith(rule.prefix))
if (rewrites.length > 0) fail(`${rewrites.map((rule) => rule.key).join(', ')} rewrites ${withoutUserinfo(configured[0])}: the push would not go to the URL the popup shows`)
if (named && git(['remote', 'get-url', '--push', remote]).stdout.trim() !== configured[0]) fail(`git resolves the push URL of ${remote} to something other than ${withoutUserinfo(configured[0])}`)
const replaced = lines(git(['for-each-ref', '--format=%(refname)', 'refs/replace/']).stdout)
if (replaced.length > 0) fail(`refs/replace is in play (${String(replaced.length)}: ${replaced[0]}${replaced.length > 1 ? ' …' : ''}): the tree and commits shown might not be the objects pushed`)
if (existsSync(resolve(REPO, git(['rev-parse', '--git-path', 'info/grafts']).stdout.trim()))) fail('info/grafts is in play: the history shown might not be the history pushed')

// 1. PROPOSE
const source = git(['rev-parse', '--verify', `${target}^{commit}`]).stdout.trim()
let to = source
const tree = git(['rev-parse', `${to}^{tree}`]).stdout.trim()
const url = withoutUserinfo(configured[0])
const remoteLine = git(['ls-remote', remote, 'refs/heads/main']).stdout.trim()
const from = remoteLine === '' ? null : remoteLine.split(/\s+/u)[0]

// RECONCILE FIRST (scripts/aukora/aura-code.mjs). Approved and completed are distinct: an approval is closed only by a
// definite result read from the remote. One whose result was never recorded (killed, timed out, refused) is closed here
// against the remote's main NOW; the process that pushed is gone, so `to` is either in main or it did not happen. A spent
// approval is never reused. Preview leaves the chain untouched.
const chain = codeChain(STATE)
const preview = process.env.AUKORA_ADVANCE_PREVIEW === '1'
const inMain = (commit, main) => main !== null && main !== undefined && git(['merge-base', '--is-ancestor', commit, main], { check: false }).status === 0
if (from !== null && git(['cat-file', '-e', `${from}^{commit}`], { check: false }).status !== 0) git(['fetch', '-q', remote, 'main'])
if (!preview) {
  chain.locked(() => {
    for (const recovered of chain.closeUnused()) {
      process.stdout.write(recovered.operation === 'code.change'
        ? `RECONCILED COMMITTED_NO_AURA (${recovered.approvalId}): local commit ${recovered.commit}; Aura ${String(recovered.sequence)}\n`
        : `RECONCILED a spent approval with no commit record (${recovered.approvalId}): application uncertain; Aura ${String(recovered.sequence)}\n`)
    }
    const entries = chain.read()
    const closed = chain.closedKeys('main.advance.result', entries)
    for (const open of entries.filter((e) => e.operation === 'main.advance' && e.remote === url && !closed.has(e.approvalId ?? e.approvalDigest))) {
      const outcome = inMain(open.to, from) ? 'completed' : 'not-completed'
      const done = chain.append({ verdict: 'reconciled', operation: 'main.advance.result', approvalId: open.approvalId ?? null,
        approvalDigest: open.approvalDigest, operationDigest: open.operationDigest, remote: url, outcome, observedMain: from, reconciledAt: new Date().toISOString() })
      process.stdout.write(`RECONCILED an earlier approval (Aura ${String(open.sequence)}): main ${open.to.slice(0, 9)} was ${outcome}; Aura ${String(done.sequence)}\n`)
    }
  })
}
const clip = (line, width) => (line.length > width ? `${line.slice(0, width - 1)}…` : line)
const fromTree = from === null ? null : git(['rev-parse', `${from}^{tree}`]).stdout.trim()

// --replace-root: every commit it drops is named in the popup, so main may hold no more than the window lists.
let dropped = []
if (replaceRoot) {
  if (from === null) fail(`${remote} has no main to replace; --snapshot creates it`)
  const fromParents = git(['rev-list', '--parents', '-n', '1', from]).stdout.trim().split(' ').slice(1)
  if (fromTree === tree && fromParents.length === 0) {
    process.stdout.write(`${remote} main is already one root commit holding the tree of ${source.slice(0, 9)}; nothing to approve\n`)
    process.exit(0)
  }
  dropped = lines(git(['log', '--no-color', '--format=%H %s', from]).stdout)
  if (dropped.length > MAX_LISTED_COMMITS) {
    fail(`--replace-root names every commit it drops, and ${remote} main has ${String(dropped.length)} (the window lists ${String(MAX_LISTED_COMMITS)}). It is for the clean public repository, whose main is a few snapshots`)
  }
} else if (snapshot && fromTree === tree) {
  process.stdout.write(`${remote} main already holds the tree of ${source.slice(0, 9)}; nothing to approve\n`)
  process.exit(0)
}

// WHAT IS PUBLISHED: the files against main now, and, for a snapshot, the scan of what it publishes. Refused by name
// before any popup, and before the snapshot commit exists.
const scanGit = gitIn(REPO, GIT_ENV)
let changes
let scan = null
try {
  changes = fileChanges(scanGit, fromTree, tree)
  if (snapshot) scan = scanPublished(scanGit, replaceRoot ? treeFiles(scanGit, tree) : changes, tree)
} catch (error) {
  fail(`the file summary or scan could not run: ${error.message}`)
}
if (scan !== null && scan.refused.length > 0) {
  const refusedList = scan.refused.slice(0, 40).map((hit) => `  ${hit.path} [${hit.rules.join(', ')}]`)
  if (scan.refused.length > 40) refusedList.push(`  … and ${String(scan.refused.length - 40)} more`)
  fail(`the snapshot would publish ${String(scan.refused.length)} private-shaped file(s); nothing was proposed:\n${refusedList.join('\n')}\n`
    + `Remove them. An obviously fake fixture may be listed (path, sha256, rules) in ${ALLOWLIST_PATH}.`)
}

// THE SNAPSHOT COMMIT CARRIES AN IDENTITY AND A DATE TOO: the author email must be a placeholder, and the date is UTC.
let author = null
if (snapshot) {
  const idents = ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'].map((name) => /^(.*) <([^>]*)> \d+ [+-]\d{4}$/u.exec(git(['var', name]).stdout.trim()))
  if (idents.some((m) => m === null)) fail('git var cannot name the author and committer of the snapshot commit')
  const personal = idents.find((m) => !emailIsPlaceholder(m[2]))
  if (personal !== undefined) fail(`the snapshot commit would publish the email <${personal[2]}>; set user.email in this repository to a no-reply or .invalid address`)
  author = `${idents[0][1]} <${idents[0][2]}>`
  const stamp = `${String(Math.floor(Date.now() / 1000))} +0000`
  const message = `AUKORA Genesis\n\nSnapshot of the tree at ${source}. The full history is kept in the private archive\n(ARCHIVE.md).\n`
  const parents = replaceRoot || from === null ? [] : ['-p', from]
  to = git(['commit-tree', tree, ...parents, '-m', message], { env: { ...GIT_ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } }).stdout.trim()
  git(['update-ref', `refs/snapshots/${to}`, to])
}
if (from === to) {
  process.stdout.write(`${remote} main is already ${to.slice(0, 9)}; nothing to approve\n`)
  process.exit(0)
}
if (from !== null && !replaceRoot) {
  if (git(['merge-base', '--is-ancestor', from, to], { check: false }).status !== 0) {
    fail(`${to.slice(0, 9)} does not descend from ${remote} main ${from.slice(0, 9)}; main only fast-forwards`)
  }
}
const added = lines(git(['log', '--no-color', '--format=%h %s', from === null || replaceRoot ? to : `${from}..${to}`]).stdout)
const listed = added.slice(0, MAX_LISTED_COMMITS).map((line) => `  ${clip(line, 90)}`)
if (added.length > MAX_LISTED_COMMITS) listed.push(`  … and ${String(added.length - MAX_LISTED_COMMITS)} more`)
const count = (status) => changes.filter((c) => c.status === status).length
const evidenceRoot = join(homedir(), 'aukora-live-proof')
mkdirSync(evidenceRoot, { recursive: true })
const evidence = mkdtempSync(join(evidenceRoot, `${new Date().toISOString().slice(0, 19).replace(/:/g, '')}-advance-`))
// PRECARD CHECK: no signer contact or approval consumption before this refusal.
const checked = await precardCheck({ repo: REPO, tree: to, base: from, evidence })
if (checked.proofRefused) { process.stderr.write(`${checked.failure}\n`); process.exit(1) }
if (!checked.passed) fail(`${checked.failure}. Evidence: ${evidence}`)
// PRECARD CHECK END
const head = [
  replaceRoot ? 'AUKORA: REPLACE MAIN WITH A NEW ROOT' : 'AUKORA: MOVE MAIN',
  `repository  ${url}`,
  `main now    ${from ?? 'none (this creates main)'}`,
  `main after  ${to}${replaceRoot ? ' (a new root: no parent)' : ''}`,
  ...(replaceRoot ? [`REPLACES main's history: drops ${String(dropped.length)} commit${dropped.length === 1 ? '' : 's'}:`,
    ...dropped.map((line) => `  ${clip(`${line.slice(0, 9)}${line.slice(40)}`, 90)}`)] : []),
  ...(snapshot ? [`snapshot of ${source} (its tree, none of its history)`, `author      ${author}, dated in UTC`] : []),
  `tree        ${tree}`,
  `why         ${why}`,
  checked.summary,
  checked.composition,
  `commits     ${String(added.length)} added:`,
  ...listed,
  `files       against main now: ${String(count('A'))} added, ${String(count('M'))} modified, ${String(count('D'))} deleted`,
]
const tail = []
if (changes.some((c) => c.path === ALLOWLIST_PATH)) tail.push(`ALLOWLIST   ${ALLOWLIST_PATH} changes in this snapshot`)
if (scan !== null) {
  tail.push(`scan        ${replaceRoot ? `all ${String(scan.scanned)} files of the tree` : `the ${String(scan.scanned)} added or modified files`}: none private-shaped`
    + `${scan.allowed.length > 0 ? `; ${String(scan.allowed.length)} fixture file(s) allowed by ${ALLOWLIST_PATH}` : ''}`)
}
// The first MAX_LISTED_FILES paths, each clipped in the middle only as far as the window needs.
const shown = changes.slice(0, MAX_LISTED_FILES)
const more = changes.length > shown.length ? [`  … and ${String(changes.length - shown.length)} more`] : []
const fixed = [...head, ...more, ...tail, ''].join('\n').length + shown.length
const room = MAX_SHOWN_CHARS - fixed
const need = shown.reduce((sum, c) => sum + 4 + c.path.length, 0)
const width = need <= room ? Infinity : Math.floor(room / Math.max(shown.length, 1)) - 4
if (width < MIN_PATH_WIDTH) fail(`the operation with its file list does not fit the ${String(MAX_SHOWN_CHARS)}-character window; shorten the reason`)
const middle = (path) => {
  if (path.length <= width) return path
  const first = path.slice(0, path.indexOf('/') + 1)
  const lead = first !== '' && first.length <= Math.floor((width - 1) * 0.4) ? first : path.slice(0, Math.floor((width - 1) * 0.4))
  const end = path.slice(path.length - (width - 1 - lead.length))
  const cut = end.indexOf('/')
  return `${lead}…${cut > 0 && cut < end.length - 1 ? end.slice(cut) : end}`
}
const content = [...head, ...shown.map((c) => `  ${c.status} ${middle(c.path)}`), ...more, ...tail, ''].join('\n')
if (content.length > MAX_SHOWN_CHARS) fail(`the operation is ${String(content.length)} characters and the window shows ${String(MAX_SHOWN_CHARS)} in full; shorten the reason`)
if (preview) { process.stdout.write(`PREVIEW, no popup, nothing moved:\n${content}`); process.exit(0) }
const bytes = Buffer.from(content, 'utf8')
const operationDigest = sha256(Buffer.concat([Buffer.from('aukora:operation-content:v1', 'utf8'), Buffer.from([0]), bytes]))

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
const replacedHistory = replaceRoot ? { replacesHistory: true, dropped: dropped.map((line) => line.slice(0, 40)) } : {}
journal('PROPOSED', { remote: url, from, to, tree, operationDigest, ...replacedHistory })

// 2. APPROVE IN THE APP
process.stdout.write(`\n>>> LOOK AT THE AUKORA APP: it shows this exact move of main. Approve signs it; Refuse signs nothing. <<<\n${content}`)
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
  fail(`not approved (exit ${String(asked.status)}). main was NOT moved. Evidence: ${evidence}`)
}

// 3. VERIFY, THEN ONE USE
const { accepted, nodeVerdict, coldVerdict } = dualVerifyApproval({
  artifact, evidence, operationFile, operationDigest, subject, approverDid, controlDigest, pinnedPem,
  maxWindow: WINDOW_SECONDS,
})
if (!accepted) {
  journal('APPROVAL_REFUSED', { node: nodeVerdict, cold: coldVerdict })
  fail(`approval verifiers: Node=${nodeVerdict}; Python=${coldVerdict}. main was NOT moved. Evidence: ${evidence}`)
}
// ONE USE, and the approved entry, under the chain's lock: an id the kernel spends is recorded in the same locked region,
// so a later run can tell a spent-and-applied approval from a spent-and-unused one.
const { decided, approvalId, entry } = chain.locked(() => {
  const decided = spawnSync(process.execPath, [join(REPO, 'scripts', 'aukora', 'decide.mjs'),
    '--approval', artifact, '--approver-did', approverDid, '--operation-digest', operationDigest,
    '--subject', subject, '--control-digest', controlDigest,
    '--consumed-ids', chain.consumedIds, '--state-root', STATE, ...(chain.mayCreateSpentSet() ? ['--create-consumed-ids'] : []),
  ], { cwd: evidence, encoding: 'utf8' })
  if (decided.stderr) process.stderr.write(decided.stderr) // Includes the one-time retained-witness migration notice.
  writeFileSync(join(evidence, 'kernel-decision.txt'), `${decided.stdout ?? ''}${decided.stderr ?? ''}`)
  if (decided.status !== 0) return { decided }
  const approvalId = approvalIdFrom(decided.stdout)
  const entry = chain.append({
    verdict: 'approved', operation: 'main.advance', consumedBy: 'aukora-kernel', approvalId, operationDigest,
    approvalDigest: sha256(readFileSync(artifact)), approverDid, remote: url, from, to, tree, ...replacedHistory,
  })
  return { decided, approvalId, entry }
})
if (decided.status !== 0) {
  journal('KERNEL_DENIED', { exit: decided.status })
  fail(`the kernel refused this approval: ${(decided.stdout ?? '').split('\n')[0]}. main was NOT moved`)
}
const approvalDigest = entry.approvalDigest
journal('APPROVED', { approvalId, approvalDigest, approverDid, kernel: (decided.stdout ?? '').split('\n')[0] })
journal('AURA_RECORDED', { sequence: entry.sequence, hash: entry.hash })

// 4. APPLY: the push leased on the main that was shown, then the RESULT as the remote reports it. `to` inside main is
// completed (even if the client saw an error); a refused push is not-completed; anything else is uncertain and stays open.
const pushed = git(['push', '--no-verify', `--force-with-lease=refs/heads/main:${from ?? ''}`, remote, `${to}:refs/heads/main`], { check: false })
journal(pushed.status === 0 ? 'PUSHED' : 'PUSH_FAILED', pushed.status === 0 ? {} : { error: (pushed.stderr ?? '').trim().split('\n').pop() })
const seen = git(['ls-remote', remote, 'refs/heads/main'], { check: false })
const observed = seen.status !== 0 ? undefined : (seen.stdout.trim() === '' ? null : seen.stdout.trim().split(/\s+/u)[0])
if (observed && git(['cat-file', '-e', `${observed}^{commit}`], { check: false }).status !== 0) git(['fetch', '-q', remote, 'main'], { check: false })
const outcome = observed === undefined ? 'uncertain' : inMain(to, observed) ? 'completed' : pushed.status !== 0 ? 'not-completed' : 'uncertain'
const result = chain.append({ verdict: 'observed', operation: 'main.advance.result', approvalId, approvalDigest, operationDigest, remote: url, outcome, observedMain: observed ?? 'unreadable' })
journal('RESULT', { outcome, observedMain: observed ?? 'unreadable', sequence: result.sequence })
const moved = outcome === 'completed'

const summary = [
  '',
  '════════ MAIN ADVANCE APPROVED ════════',
  `  repository    ${url}`,
  `  main          ${from === null ? 'created' : from.slice(0, 9)} → ${to.slice(0, 9)} (tree ${tree.slice(0, 9)}, ${String(added.length)} commit(s)${replaceRoot ? `; history replaced, ${String(dropped.length)} dropped` : ''})`,
  `  operation     ${operationDigest}`,
  `  approval      signed in the AUKORA popup by ${approverDid}, verified before the push; kernel: one use, consumed`,
  '                (a software key on this Mac; the click is recorded, attendance is reported, not proven)',
  `  Aura          approval at code chain sequence ${String(entry.sequence)}; result ${outcome} at ${String(result.sequence)}`,
  `  GitHub main   ${moved ? 'moved' : outcome === 'uncertain' ? `UNCERTAIN, not verified (will be re-checked on the next run): ` : `NOT moved: ${(pushed.stderr ?? '').trim().split('\n').pop()}`}`,
  `  evidence      ${evidence}`,
  '',
].join('\n')
writeFileSync(join(evidence, 'summary.txt'), `${summary}\n`)
process.stdout.write(`${summary}\n`)
process.exit(moved ? 0 : 1)
