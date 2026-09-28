/**
 * NAMED AUTHORITY ADAPTER: Genesis Aumlok candidate authority.
 * NO_PQ_SIGNATURE (Ed25519 only; the original requires Ed25519+ML-DSA-65)
 * SAME_UID; SOFTWARE_APPROVAL_KEY; NO_SERVER_SIDE_MAIN_CHECK.
 *
 * The pre-popup tree is an UNAUTHORIZED preview. The ORIGINAL materializer runs
 * only after decideApproval verifies the pinned signature and consumes its nonce.
 * Its original hybrid monitor still denies: this adapter explicitly substitutes
 * Genesis's consumed Ed25519 operation, never a forged hybrid authorization.
 * Preview receipts describe byte validation, NOT original governed rehearsal.
 * Source identity is checked separately: Genesis is a named namespace mapping;
 * only the disposable stage carries the original canonical origin metadata.
 * No originals are patched, and candidate.mjs remains hybrid-only/fail-closed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { decideApproval } from './decide.mjs'
import { writeCandidateCommit } from './commit-ssh-candidate.mjs'
import { ReactiveMemoryStore } from '../../vendor/aukora-seed-app/lib/apps/brain/src/reactiveStore.js'
import { buildMemoryRecord } from '../../vendor/aukora-seed-app/lib/packages/memory/index.js'
import { classifyPath, candidateAllowed } from '../../vendor/aukora-seed-app/lib/apps/seed/src/pathFence.js'
import { ACCEPTED_ORIGIN_FORMS, evaluateRemoteConfig, parseZConfig } from '../../vendor/aukora-seed-app/lib/apps/seed/src/repoIdentity.js'
import { deriveIntentId, deriveDraftHash, LIMITS } from '../../vendor/aukora-seed-app/lib/apps/seed/src/proposal.js'
import { CandidateReferenceMonitor, candidateIdForFiles, candidatePayloadHash, buildCandidateKernelRequest } from '../../vendor/aukora-seed-app/lib/apps/seed/src/candidateReferenceMonitor.js'
import { materializeCandidate } from '../../vendor/aukora-seed-app/lib/apps/seed/src/localCandidateStage.js'
import { translateToEnvelope } from '../../vendor/aukora-seed-app/lib/apps/seed/src/governedCrossing.js'
import { assessEnvelope } from '../../vendor/aukora-seed-app/lib/apps/seed/src/proposerQualification.js'
import { RecursionLedger } from '../../vendor/aukora-seed-app/lib/apps/seed/src/ledger.js'

export const CANDIDATE_CEILINGS = Object.freeze([
  'NO_PQ_SIGNATURE (Ed25519 only; the original requires Ed25519+ML-DSA-65)',
  'SAME_UID; SOFTWARE_APPROVAL_KEY; NO_SERVER_SIDE_MAIN_CHECK',
  'REPOSITORY_IDENTITY_ADAPTER (Genesis origin mapped only in disposable stage; source checked separately)',
  'NO_ORIGINAL_GOVERNED_REHEARSAL (receipts attest preview byte validation only)',
  'CROSSING_ADVISORY_ONLY (original qualifier halts before signature; offline council; no authority granted)',
  'TEXT_PRESERVE_MODE (existing 100644/100755 only; new files 100644; no deletion, binary, symlink or mode changes)',
  'EXACT_TREE_COMMIT (commit-tree bypasses commit hooks; compare-and-swap updates HEAD)',
  'GENERATED_NOT_REPRODUCED (face lib files are the bytes build-face.py wrote in this run, hashed right after it and bound by the tree; shown as blob ids, not crossed, not rebuilt independently)',
])
export const PATH_FENCE_DESCRIPTION = 'Original secret/sacred/authority/self-protecting refusals; literal file paths, no symlinks or case collisions; Genesis guard and action-gate files require exact explicit names (no directory/pattern grant). Not OS confinement.'
const CANONICAL = ACCEPTED_ORIGIN_FORMS[1]
// This working checkout's origin is the archive (full history) since 2026-09-27; the clean aukora-genesis gets snapshots
// through scripts/aukora/advance.mjs --snapshot. Both are this project's repository.
const GENESIS = ACCEPTED_ORIGIN_FORMS.flatMap(url => ['aukora-genesis', 'aukora-genesis-archive'].map(name => url.replace(/aukora(?=\.git$|$)/, name)))
const snapshots = new WeakMap()
const deny = code => { throw new Error(code) }
const digestOf = bytes => createHash('sha256').update(Buffer.from('aukora:operation-content:v1\0')).update(bytes).digest('hex')
const inside = (path, root) => path.startsWith(root + sep)
// GENERATED FACE OUTPUTS (2026-09-27). The app loads plugins/aukora-face/<face>/lib/*, so a face source change ships only
// if its rebuilt bundle rides in the same approved tree. self-change.mjs runs scripts/build-face.py and names here only
// the files that build reported writing, each with the blob it hashed right after the build. Those files stay in the
// candidate (digest, original materializer, tree) but skip the per-file crossing, which refuses them: its 64 KiB draft
// budget is smaller than layout's client.js (84,579 bytes) and its secret scan refuses every .build-inputs.json (a
// 64-hex digest). The path fence still applies to them, here and again inside the original materializer.
const GENERATED_PATH = /^plugins\/aukora-face\/[^/]+\/lib\/(index\.js|client\.js|invariant\.js|\.build-inputs\.json)$/
const GENERATED_MAX_BYTES = 1024 * 1024
const byteLimit = (path, generated) => generated?.has(path) ? GENERATED_MAX_BYTES : LIMITS.MAX_PATCH_BYTES

// A fixed binary and closed environment; preview Git never loads caller config/hooks
// or runs a clean filter. Blob bytes are written directly, not through `git add`.
function git(repo, args, { input, env = {}, optional = false, encoding = 'utf8' } = {}) {
  try {
    return execFileSync('/usr/bin/git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'core.attributesFile=/dev/null', ...args], {
      input, encoding, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: '/dev/null', XDG_CONFIG_HOME: '/dev/null',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file', GIT_LITERAL_PATHSPECS: '1', LANG: 'C', LC_ALL: 'C', ...env },
    })
  } catch { if (optional) return null; deny(`candidate:git-${args[0]}-failed`) }
}

export function assertSourceIdentity({ repo, support }) {
  repo = realpathSync(repo)
  if (realpathSync(git(repo, ['rev-parse', '--show-toplevel']).trim()) !== repo) deny('candidate:repository-toplevel-required')
  const raw = git(repo, ['config', '-z', '--get-regexp', '^(remote|url)\\.'], { optional: true }) ?? ''
  const original = evaluateRemoteConfig(raw)
  if (original.ok && process.env.AUKORA_CANDIDATE_SCRATCH !== '1') return { profile: 'original-canonical', raw }
  const entries = parseZConfig(raw)
  const urls = entries.filter(e => e.key === 'remote.origin.url')
  let profile = 'genesis-explicit-namespace'
  let sourceUrl = urls.length === 1 ? urls[0].value : ''
  if (process.env.AUKORA_CANDIDATE_SCRATCH === '1') {
    const root = realpathSync(support)
    const tempRoots = [realpathSync(tmpdir()), realpathSync('/tmp')]
    if (!tempRoots.some(temp => inside(root, temp)) || !inside(repo, root) || !sourceUrl.startsWith('/')) deny('candidate:scratch-scope-refused')
    const remote = realpathSync(sourceUrl)
    if (!inside(remote, root) || git(remote, ['rev-parse', '--is-bare-repository']).trim() !== 'true') deny('candidate:scratch-remote-refused')
    profile = 'SCRATCH_LOCAL_REPOSITORY (all transport stays inside scratch support root)'
  } else if (!GENESIS.includes(sourceUrl)) deny(`candidate:wrong-repository:${original.code}`)
  // Keep the original verdict for every other field, including rewrites, extra
  // remotes and ambiguous push URLs. Only the explicitly recognized URL maps.
  const mapped = entries.map(e => `${e.key}\n${['remote.origin.url', 'remote.origin.pushurl'].includes(e.key) && e.value === sourceUrl ? CANONICAL : e.value}\0`).join('')
  if (!evaluateRemoteConfig(mapped).ok) deny('candidate:wrong-repository:config')
  return { profile, raw }
}

function fence(paths, explicit) {
  if (!paths.length || paths.length > LIMITS.MAX_ATTEMPTS) deny('candidate:path-count')
  const seen = new Set()
  for (const path of paths) {
    const verdict = classifyPath(path)
    if (!candidateAllowed(verdict)) deny(verdict.reasonClass)
    if (path.split('/').some(part => !part || part === '.' || part === '..') || seen.has(path.toLowerCase())) deny('candidate:unsafe-write-path')
    seen.add(path.toLowerCase())
    if (/^(vendor\/seed|plugins\/aukora-action-gate)(\/|$)/i.test(path) && !explicit.includes(path)) deny('candidate:gate-judge-not-explicit')
    if (!explicit.includes(path)) deny('candidate:path-not-explicit')
  }
}

function sourceBytes(repo, path, expectedMode, maxBytes = LIMITS.MAX_PATCH_BYTES) {
  let full = repo
  for (const part of path.split('/')) {
    full = join(full, part)
    if (lstatSync(full).isSymbolicLink()) deny('candidate:source-symlink')
  }
  const st = lstatSync(full)
  if (!st.isFile() || st.size > maxBytes) deny('candidate:requires-regular-text')
  // Git's executable bit is the owner's execute bit. Also refuse any execute
  // permissions on a 100644 file, even when core.filemode would ignore them.
  const mode = st.mode & 0o100 ? '100755' : '100644'
  if (mode !== expectedMode || (expectedMode === '100644' && (st.mode & 0o111))) deny('candidate:mode-change-refused')
  const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW)
  let bytes
  try { bytes = readFileSync(fd) } finally { closeSync(fd) }
  const text = bytes.toString('utf8')
  if (bytes.includes(0) || !Buffer.from(text).equals(bytes)) deny('candidate:requires-utf8-text')
  return text
}

function treeFor(repo, base, candidate, index) {
  const env = { GIT_INDEX_FILE: index }
  git(repo, ['read-tree', base], { env })
  for (const file of candidate.files) {
    const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: candidate.workspace.get(file.path) }).trim()
    git(repo, ['update-index', '--add', '--cacheinfo', `${file.mode},${blob},${file.path}`], { env })
  }
  return git(repo, ['write-tree'], { env }).trim()
}

export function stageCandidatePreview({ repo, support, paths, explicitlyNamedPaths = [], why, generated = {} }) {
  fence(paths, explicitlyNamedPaths)
  const built = new Map(Object.entries(generated))
  for (const [path, blob] of built) {
    if (!paths.includes(path) || !GENERATED_PATH.test(path) || !/^[0-9a-f]{40}$/.test(blob)) deny('candidate:generated-path-refused')
  }
  if (paths.every(path => built.has(path))) deny('candidate:generated-without-source')
  const generatedPaths = new Set(built.keys())
  repo = realpathSync(repo)
  const identity = assertSourceIdentity({ repo, support })
  const base = git(repo, ['rev-parse', 'HEAD']).trim()
  const files = [], workspace = new Map()
  for (const path of paths) {
    const entry = git(repo, ['ls-tree', base, '--', path])
    if (entry && !/^(100644|100755) blob /.test(entry)) deny('candidate:base-requires-regular-text')
    const mode = entry ? entry.split(' ')[0] : '100644'
    const newContent = sourceBytes(repo, path, mode, byteLimit(path, generatedPaths))
    if (entry) {
      const previous = git(repo, ['show', `${base}:${path}`], { encoding: null })
      if (previous.includes(0) || !Buffer.from(previous.toString('utf8')).equals(previous)) deny('candidate:base-requires-utf8-text')
      if (previous.toString('utf8') === newContent) deny('candidate:unchanged-path')
    }
    const proposal = { targetPath: path, newContent, supersedes: null }
    files.push({ path, mode, intentId: deriveIntentId(proposal), draftHash: deriveDraftHash(proposal), receiptHash: null })
    workspace.set(path, newContent)
  }
  const candidate = { schema: 'aukora-branch-candidate-v1', candidateId: candidateIdForFiles(files), files, workspace,
    explanation: 'Genesis Aumlok adapter; preview byte validation only, no original governed rehearsal', lineage: [],
    staged: true, pushed: false, signed: false, merged: false, deployed: false, grantsAuthority: false }
  const home = join(support, 'state', 'home', 'code-candidates')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(join(home, 'candidate-'))
  const stageRepo = join(directory, 'repository')
  mkdirSync(stageRepo)
  git(stageRepo, ['init', '-q'])
  // Local transport only. The clean detached repository is disposable and never
  // pushes. Canonical origin metadata below is a declared namespace adaptation.
  git(stageRepo, ['fetch', '-q', '--no-tags', repo, base])
  git(stageRepo, ['checkout', '-q', '--detach', base])
  git(stageRepo, ['remote', 'add', 'origin', CANONICAL])
  const tree = treeFor(stageRepo, base, candidate, join(directory, 'preview.index'))
  // The window shows the SOURCE diff in full. Each generated file is shown as one line naming its blob in this tree; the
  // blob must be the one self-change hashed right after the build, so bytes that moved after the build are refused.
  const shownPaths = paths.filter(path => !generatedPaths.has(path))
  const diff = git(stageRepo, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--full-index', '--no-renames', base, tree, '--', ...shownPaths])
  if (!diff.trim() || diff.includes('\0')) deny('candidate:diff-not-displayable')
  const shownGenerated = [...generatedPaths].sort().map(path => {
    const blob = git(stageRepo, ['ls-tree', tree, '--', path]).split(/\s+/)[2]
    if (blob !== built.get(path)) deny('candidate:generated-changed-after-build')
    return Object.freeze({ path, blob })
  })
  const record = Object.freeze({ directory, worktree: stageRepo, digest: candidatePayloadHash(candidate, base), base, tree,
    paths: Object.freeze([...paths]), diff, generated: Object.freeze(shownGenerated), identity: identity.profile })
  snapshots.set(record, { repo, support, identity, stageRepo, candidate, explicit: [...explicitlyNamedPaths], why, generated: generatedPaths, authorized: false, committed: false })
  writeFileSync(join(directory, 'preview.json'), JSON.stringify({ ...record, authority: 'UNAUTHORIZED_PREVIEW' }) + '\n', { mode: 0o600 })
  checkCandidatePreview(record)
  return record
}

// Re-read the source, never the agent's prose or a supplied content/hash field.
// This guard precedes the qualifier and also runs at every later preview check.
function crossingDrafts(record) {
  const snapshot = snapshots.get(record)
  if (!snapshot) deny('candidate:unknown-preview')
  if (git(snapshot.repo, ['rev-parse', 'HEAD']).trim() !== record.base) deny('crossing:stale-head')
  return snapshot.candidate.files.filter(file => !snapshot.generated.has(file.path)).map(file => {
    const draft = { targetPath: file.path, newContent: sourceBytes(snapshot.repo, file.path, file.mode), supersedes: null }
    if (deriveDraftHash(draft) !== file.draftHash) deny('crossing:draft-mismatch')
    return draft
  })
}

export function qualifyCandidateCrossing(record, { intent, tests = [] }) {
  const drafts = crossingDrafts(record)
  const snapshot = snapshots.get(record)
  if (snapshot.crossings) deny('crossing:already-qualified')
  checkCandidatePreview(record)
  const store = new ReactiveMemoryStore()
  const ledger = new RecursionLedger()
  const deadlineMs = Date.now() + LIMITS.DEFAULT_WALL_TIME_BUDGET_MS
  const knownFiles = new Set(drafts.map(draft => draft.targetPath))
  // The original is single-target: EVERY real target crosses with the full
  // declared intent path set. No synthetic aggregate draft/hash replaces it.
  const crossings = drafts.map(draft => {
    const translated = translateToEnvelope(intent, draft, { headBefore: record.base, tests })
    if (!translated.ok) deny(translated.reasonClass)
    const { crossing } = translated
    const nowMs = Date.now()
    // No owner root or authorization is supplied. The original recursion must
    // halt at the missing-owner gate; its offline council confers no authority.
    const verdict = assessEnvelope({ store, ledger, knownFiles, nowMs, nowIso: new Date(nowMs).toISOString(),
      deadlineMs, ownerRoot: undefined }, crossing.envelope)
    if (!verdict.admitted) deny(verdict.reasonClass)
    if (verdict.haltedBeforeSignature !== true || verdict.grantsAuthority !== false ||
        crossing.advisoryOnly !== true || crossing.grantsAuthority !== false) deny('crossing:authority-refused')
    if (verdict.draftHash !== crossing.binding.draftHash || deriveDraftHash(draft) !== crossing.binding.draftHash) deny('crossing:draft-mismatch')
    return crossing
  })
  // Catch movement during assessment before accepting any bindings.
  crossingDrafts(record)
  checkCandidatePreview(record)
  snapshot.crossings = Object.freeze(crossings)
  return snapshot.crossings
}

export function candidateOperation(record, why) {
  const snapshot = snapshots.get(record)
  if (!snapshot) deny('candidate:unknown-preview')
  if (!snapshot.crossings) deny('crossing:not-qualified')
  checkCandidatePreview(record)
  // `tree:` binds every byte, generated files included; with none generated the text is what it was before.
  const shown = record.diff.endsWith('\n') ? record.diff : `${record.diff}\n`
  const generated = record.generated.map(({ path, blob }) =>
    `generated: ${path} blob ${blob} (rebuilt by scripts/build-face.py from the source above)\n`).join('')
  return ['code.change — Auma asks to change her own code', `why: ${why}`, `candidate: ${record.digest}`,
    `base: ${record.base}`, `tree: ${record.tree}`, `paths: ${record.paths.join(', ')}`,
    ...snapshot.crossings.map(crossing => `binding: ${crossing.binding.bindingHash} (${crossing.envelope.proposal.targetPath})`), '',
    `${shown}${generated}`].join('\n')
}

export function checkCandidatePreview(record) {
  const snapshot = snapshots.get(record)
  if (!snapshot) deny('candidate:unknown-preview')
  if (snapshot.crossings) crossingDrafts(record)
  const { repo, support, identity, stageRepo, candidate, explicit } = snapshot
  fence(candidate.files.map(f => f.path), explicit)
  if (assertSourceIdentity({ repo, support }).raw !== identity.raw) deny('candidate:source-identity-changed')
  if (git(repo, ['rev-parse', 'HEAD']).trim() !== record.base) deny('candidate:stale-head')
  const request = buildCandidateKernelRequest(candidate, null, false, record.base)
  if (request.payloadHash !== record.digest || candidateIdForFiles(candidate.files) !== candidate.candidateId) deny('candidate:digest-changed')
  if (git(stageRepo, ['rev-parse', 'HEAD']).trim() !== record.base || git(stageRepo, ['status', '--porcelain', '--untracked-files=all']).trim()) deny('candidate:tree-changed')
  if (!evaluateRemoteConfig(git(stageRepo, ['config', '-z', '--get-regexp', '^(remote|url)\\.'])).ok) deny('candidate:stage-identity-changed')
  const changed = git(stageRepo, ['diff', '--name-only', '--no-renames', '-z', record.base, record.tree, '--']).split('\0').filter(Boolean).sort()
  if (JSON.stringify(changed) !== JSON.stringify([...record.paths].sort())) deny('candidate:path-set-changed')
  for (const file of candidate.files) {
    if (sourceBytes(repo, file.path, file.mode, byteLimit(file.path, snapshot.generated)) !== candidate.workspace.get(file.path)) deny('candidate:source-changed')
    if (git(stageRepo, ['ls-tree', record.tree, '--', file.path]).split(/\s+/)[0] !== file.mode ||
        git(stageRepo, ['show', `${record.tree}:${file.path}`]) !== candidate.workspace.get(file.path)) deny('candidate:tree-changed')
  }
  if (git(stageRepo, ['write-tree'], { env: { GIT_INDEX_FILE: join(record.directory, 'preview.index') } }).trim() !== record.tree) deny('candidate:tree-changed')
  return request.payloadHash
}

export function authorizeAndMaterializeCandidate(record, { approvalPath, approverDid, subject, controlDigest, operationBytes, consumedIdsPath, stateRoot, createConsumedIds = false }) {
  checkCandidatePreview(record)
  const snapshot = snapshots.get(record)
  if (!Buffer.from(candidateOperation(record, snapshot.why)).equals(Buffer.from(operationBytes))) deny('candidate:operation-binding-mismatch')
  const operationDigest = digestOf(operationBytes)
  mkdirSync(dirname(consumedIdsPath), { recursive: true, mode: 0o700 })
  const approvalBytes = readFileSync(approvalPath)
  const decision = decideApproval({ approvalPath, approverDid, subject, controlDigest, operationDigest, consumedIdsPath, stateRoot, createConsumedIds })
  if (decision.decision !== 'ALLOW') deny(`candidate:approval-denied:${decision.reason}`)
  if (!readFileSync(approvalPath).equals(approvalBytes)) deny('candidate:approval-file-changed')
  // A real content-free receipt chain, with deliberately limited semantics.
  const store = new ReactiveMemoryStore()
  const ingest = store.ingest.bind(store)
  store.ingest = value => {
    const result = ingest(value)
    if (result.ok) {
      const fd = openSync(join(record.directory, `${result.chainHash}.receipt.json`), 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify(store.chain()) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    }
    return result
  }
  const nowIso = new Date().toISOString()
  for (const file of snapshot.candidate.files) {
    const receipt = store.ingest(buildMemoryRecord({ content: `Genesis preview bytes checked; draft=${file.draftHash}; no original governed rehearsal`,
      createdAt: nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'genesis-candidate-preview' }))
    if (!receipt.ok) deny('candidate:preview-receipt-refused')
    file.receiptHash = receipt.chainHash
  }
  // This subclass is local to this consumed approval. There is no public
  // verified:true switch, no hybrid fixture/root, and no changed original module.
  let used = false
  class GenesisAumlokCandidateAuthority extends CandidateReferenceMonitor {
    decide(candidate, auth, nowMs, opts) {
      const original = super.decide(candidate, auth, nowMs, opts)
      const bound = buildCandidateKernelRequest(candidate, null, opts.ownerArmed, opts.headBefore)
      if (used || opts.headBefore !== record.base || !opts.ownerArmed || bound.payloadHash !== record.digest) return { ...original, allowed: false, code: 'genesis:binding-refused' }
      checkCandidatePreview(record)
      used = true
      return { ...original, allowed: true, code: 'genesis:verified-ed25519-operation', authorizedRootId: approverDid,
        payloadHash: bound.payloadHash, receiptDraftHash: decision.receiptDraft?.draftHash ?? null }
    }
  }
  checkCandidatePreview(record)
  // The original materializer recreates leaf files as 0644. In this disposable
  // repository only, retain each checked-out index mode while it stages bytes.
  // Source checks above still inspect filesystem modes directly. Restore the
  // executable permissions before restoring Git's mode checks and accepting it.
  git(snapshot.stageRepo, ['config', 'core.filemode', 'false'])
  let materialized
  try {
    materialized = materializeCandidate({ repoRoot: snapshot.stageRepo, worktreeBase: join(record.directory, 'worktrees'), candidate: snapshot.candidate,
      candidateAuth: null, monitor: new GenesisAumlokCandidateAuthority(undefined), ownerArmed: true,
      expectedHeadBefore: record.base, authBindsHead: true, store, nowMs: Date.now(), nowIso })
    if (materialized.ok) {
      for (const file of snapshot.candidate.files) {
        const fd = openSync(join(materialized.worktreePath, file.path), constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          if (!fstatSync(fd).isFile()) deny('candidate:materialized-tree-changed')
          fchmodSync(fd, file.mode === '100755' ? 0o755 : 0o644)
        } finally { closeSync(fd) }
      }
    }
  } finally { git(snapshot.stageRepo, ['config', 'core.filemode', 'true']) }
  if (!materialized.ok) deny(`candidate:materialization-refused:${materialized.reasonClass}`)
  if (git(snapshot.stageRepo, ['rev-parse', `${materialized.commitSha}^{tree}`]).trim() !== record.tree ||
      git(snapshot.stageRepo, ['rev-parse', `${materialized.commitSha}^`]).trim() !== record.base ||
      git(materialized.worktreePath, ['status', '--porcelain', '--untracked-files=all']).trim()) deny('candidate:materialized-tree-changed')
  for (const file of snapshot.candidate.files) {
    if (sourceBytes(materialized.worktreePath, file.path, file.mode, byteLimit(file.path, snapshot.generated)) !== snapshot.candidate.workspace.get(file.path)) deny('candidate:materialized-tree-changed')
  }
  checkCandidatePreview(record)
  snapshot.authorized = { operationDigest, approverDid, approvalDigest: createHash('sha256').update(approvalBytes).digest('hex') }
  snapshot.materialized = materialized
  return { decision, materialized }
}

export function commitCandidateTree(record, { why, approverDid, approvalDigest, operationDigest }) {
  checkCandidatePreview(record)
  const snapshot = snapshots.get(record)
  if (!snapshot.authorized || snapshot.committed || why !== snapshot.why ||
      ['approverDid', 'approvalDigest', 'operationDigest'].some(key => snapshot.authorized[key] !== ({ approverDid, approvalDigest, operationDigest })[key])) deny('candidate:commit-not-authorized')
  const { repo, candidate, materialized } = snapshot
  if (git(materialized.worktreePath, ['rev-parse', 'HEAD']).trim() !== materialized.commitSha ||
      git(materialized.worktreePath, ['status', '--porcelain', '--untracked-files=all']).trim()) deny('candidate:materialized-tree-changed')
  const tree = treeFor(repo, record.base, candidate, join(record.directory, 'commit.index'))
  if (tree !== record.tree) deny('candidate:commit-tree-mismatch')
  const message = `${why}\n\nApproved-by: ${approverDid}\nApproval-digest: ${approvalDigest}\nOperation-digest: ${operationDigest}\nCandidate-digest: ${record.digest}\n`
  const commit = writeCandidateCommit(repo, { tree, base: record.base, message })
  if (git(repo, ['rev-parse', `${commit}^{tree}`]).trim() !== record.tree) deny('candidate:commit-tree-mismatch')
  git(repo, ['update-ref', 'HEAD', commit, record.base])
  snapshot.committed = true
  // Refresh ONLY the selected entries after CAS, preserving unrelated staging.
  // Failure here cannot hide the already-created commit or suppress its Aura log.
  try {
    const indexInfo = record.paths.map(path => git(repo, ['ls-tree', '-z', record.tree, '--', path])).join('')
    git(repo, ['update-index', '-z', '--index-info'], { input: indexInfo })
  } catch {
    process.stderr.write(`CANDIDATE INDEX NOT REFRESHED: commit ${commit} exists; refresh the selected paths manually\n`)
  }
  return commit
}
