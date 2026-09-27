#!/usr/bin/env node
// Adapter over byte-preserved, generated originals; no signing or live-tree apply.
// Same-UID callers and software keys remain the trust ceiling. No server-side main enforcement.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyAumlokPromotionV2 } from '../../vendor/authority/lib/authority.js';
import { assertAuthorityRoot, assertSignedPromotion } from '../../vendor/authority/lib/schema.js';
import { ReactiveMemoryStore } from '../../vendor/aukora-seed-app/lib/apps/brain/src/reactiveStore.js';
import { AumaIdeEnvelope } from '../../vendor/aukora-seed-app/lib/apps/seed/src/ideEnvelope.js';
import { RecursionLedger } from '../../vendor/aukora-seed-app/lib/apps/seed/src/ledger.js';
import { deriveIntentId, deriveDraftHash, LIMITS } from '../../vendor/aukora-seed-app/lib/apps/seed/src/proposal.js';
import { materializeCandidate, candidateBranchName } from '../../vendor/aukora-seed-app/lib/apps/seed/src/localCandidateStage.js';
import { classifyPath, candidateAllowed } from '../../vendor/aukora-seed-app/lib/apps/seed/src/pathFence.js';
import { evaluateRemoteConfig } from '../../vendor/aukora-seed-app/lib/apps/seed/src/repoIdentity.js';
import { CandidateReferenceMonitor, candidateIdForFiles, candidatePayloadHash } from '../../vendor/aukora-seed-app/lib/apps/seed/src/candidateReferenceMonitor.js';
import { DurableCandidateReferenceMonitor, trustedStateDirInsideFence } from '../../vendor/aukora-seed-app/lib/apps/seed/src/durableCandidateMonitor.js';

const HELP = `Usage:
  node scripts/aukora/candidate.mjs stage --base <40-hex SHA> [options] --paths <files...>
  node scripts/aukora/candidate.mjs check <digest> [options]

Run from the repository toplevel. Stage requires its clean HEAD to equal --base.
  --source-root <dir>       Proposed UTF-8 regular files (default: current directory)
  --owner-root <file>       Independently pinned PUBLIC AumlokAuthorityRootV2 JSON
  --authorization <file>    JSON {createdAt, drafts: {"path": SignedPromotionV2}, candidateAuth: SignedPromotionV2}
  --owner-armed            Explicit clearance for the original self-modify request
  --state-dir <dir>         Required persistent state, outside repo, source and worktree base
  --worktree-base <dir>     Disposable worktrees (default: OS temp/aukora-candidates-<uid>)

Authorization must be obtained out of band; this CLI never signs. Draft signatures bind
deriveIntentId/deriveDraftHash; candidateAuth binds BOTH hashes to the original
candidatePayloadHash(candidate, base), domain AUKORA-CANDIDATE-PAYLOAD/2.
Without a pinned hybrid public root and signatures the original verifier fails closed.
Original canonical origin: aumara-xyz/aukora. No origin rewriting or dirty-tree bypass.
Only textual create/replace with mode 0644; no deletion, binary or executable-mode changes.
Success: one JSON line {digest,base,tree,paths}, then the exact unified Git diff.
check is read-only, re-verifies signatures at the current time and confirms prior nonce
consumption; it grants no new permission. Expired authorizations fail closed.
The original offline advisory council is used during rehearsal. Not live-app integration.
`;

function refuse(code, details = {}) {
  const error = new Error(code);
  error.details = details;
  throw error;
}
function options(argv) {
  const result = { command: argv.shift(), paths: [] };
  if (result.command === 'check') result.digest = argv.shift();
  const values = new Set(['base', 'source-root', 'owner-root', 'authorization', 'state-dir', 'worktree-base']);
  while (argv.length) {
    const token = argv.shift();
    if (token === '--paths') { result.paths = argv.splice(0); break; }
    if (token === '--owner-armed') { result.armed = true; continue; }
    const key = token.slice(2);
    if (!token.startsWith('--') || !values.has(key) || result[key] !== undefined || !argv[0] || argv[0].startsWith('--')) refuse('usage');
    result[key] = argv.shift();
  }
  return result;
}

// Read-only Git adapter. All actual candidate mutations belong to localCandidateStage.
let emptyHome;
function git(repo, args, optional = false, encoding = 'utf8') {
  emptyHome ??= mkdtempSync(join(tmpdir(), 'aukora-candidate-read-'));
  try {
    return execFileSync('/usr/bin/git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'core.attributesFile=/dev/null', ...args], {
      encoding, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: emptyHome, XDG_CONFIG_HOME: emptyHome,
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file', GIT_LITERAL_PATHSPECS: '1', LANG: 'C', LC_ALL: 'C' },
    });
  } catch { if (optional) return null; refuse('git-read-failed', { command: args[0] }); }
}
function identity(repo) {
  if (realpathSync(git(repo, ['rev-parse', '--show-toplevel']).trim()) !== repo) refuse('repository-toplevel-required');
  return evaluateRemoteConfig(git(repo, ['config', '-z', '--get-regexp', '^(remote|url)\\.'], true) ?? '');
}
function safePaths(paths) {
  if (!paths.length || paths.length > LIMITS.MAX_ATTEMPTS) refuse('candidate-path-count');
  const seen = new Set();
  for (const path of paths) {
    const verdict = classifyPath(path);
    if (!candidateAllowed(verdict)) refuse(verdict.reasonClass);
    if (path.split('/').some(p => !p || p === '.' || p === '..') || seen.has(path.toLowerCase())) refuse('candidate:unsafe-write-path');
    seen.add(path.toLowerCase());
  }
}
function sourceText(root, path) {
  let full = root;
  for (const part of path.split('/')) {
    full = join(full, part);
    if (lstatSync(full).isSymbolicLink()) refuse('source-symlink');
  }
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.size > LIMITS.MAX_PATCH_BYTES || (stat.mode & 0o111)) refuse('source-requires-bounded-regular-text-0644');
  const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try { bytes = readFileSync(fd); } finally { closeSync(fd); }
  return utf8Text(bytes);
}
function utf8Text(bytes) {
  const text = bytes.toString('utf8');
  if (bytes.includes(0) || !Buffer.from(text).equals(bytes)) refuse('source-requires-utf8-text');
  return text;
}
function jsonFile(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { refuse('json-input-unavailable-or-invalid'); }
}
function persist(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}
function diff(repo, base, commit) {
  return git(repo, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--full-index', '--no-renames', '--unified=3', base, commit, '--']);
}
function emit(record, exactDiff) {
  process.stdout.write(`${JSON.stringify({ digest: record.digest, base: record.base, tree: record.tree, paths: record.paths })}\n${exactDiff}`);
}
function locations(opts, repo, source) {
  if (!opts['state-dir']) refuse('persistent-state-dir-required');
  const state = resolve(opts['state-dir']);
  const worktrees = resolve(opts['worktree-base'] ?? join(tmpdir(), `aukora-candidates-${process.getuid()}`));
  if (trustedStateDirInsideFence(state, [repo, source, worktrees]) || trustedStateDirInsideFence(worktrees, [repo, source, state])) refuse('state-or-worktree-inside-fence');
  return { state, worktrees, monitor: join(state, 'monitor'), records: join(state, 'records') };
}
function assertCommit(record, candidate, repo) {
  if (!/^[0-9a-f]{40}$/.test(record.commit) || !/^[0-9a-f]{40}$/.test(record.base)) refuse('record-commit-shape');
  if (git(repo, ['rev-parse', `${record.commit}^`]).trim() !== record.base ||
      git(repo, ['rev-list', '--parents', '-n', '1', record.commit]).trim().split(' ').length !== 2 ||
      git(repo, ['rev-parse', `${record.commit}^{tree}`]).trim() !== record.tree ||
      git(repo, ['rev-parse', `refs/heads/${candidateBranchName(candidate)}`]).trim() !== record.commit) refuse('candidate-commit-mismatch');
  const changed = git(repo, ['diff', '--no-renames', '--name-only', '-z', record.base, record.commit, '--']).split('\0').filter(Boolean).sort();
  if (JSON.stringify(changed) !== JSON.stringify([...record.paths].sort())) refuse('candidate-path-set-mismatch');
  for (const file of candidate.files) {
    const entry = git(repo, ['ls-tree', record.commit, '--', file.path]);
    if (!entry.startsWith('100644 blob ')) refuse('candidate-file-mode-mismatch');
    const content = git(repo, ['show', `${record.commit}:${file.path}`]);
    if (content !== candidate.workspace.get(file.path)) refuse('candidate-blob-mismatch');
  }
}

function stage(opts) {
  const repo = realpathSync(process.cwd());
  const source = realpathSync(resolve(opts['source-root'] ?? repo));
  if (!/^[0-9a-f]{40}$/.test(opts.base ?? '') || git(repo, ['rev-parse', 'HEAD']).trim() !== opts.base) refuse('candidate:stale-head');
  safePaths(opts.paths);
  const repository = identity(repo);
  const nowMs = Date.now();
  const bundle = opts.authorization ? jsonFile(opts.authorization) : {};
  const ownerRoot = opts['owner-root'] ? jsonFile(opts['owner-root']) : undefined;
  const baseFiles = new Map();
  const envelope = new AumaIdeEnvelope({ list: () => opts.paths, exists: path => baseFiles.has(path), read: path => baseFiles.get(path) });
  const proposals = opts.paths.map(path => {
    const entry = git(repo, ['ls-tree', opts.base, '--', path]);
    if (entry && !entry.startsWith('100644 blob ')) refuse('base-requires-regular-text-0644');
    if (entry) baseFiles.set(path, utf8Text(git(repo, ['show', `${opts.base}:${path}`], false, null)));
    const drafted = envelope.draft({ targetPath: path, newContent: sourceText(source, path), createdAt: bundle.createdAt ?? new Date(nowMs).toISOString() });
    if (!drafted.ok) refuse(drafted.refusal.reasonClass);
    if (baseFiles.get(path) === drafted.proposal.newContent) refuse('candidate-unchanged-path');
    return drafted.proposal;
  });
  // This descriptor is only a verification request; it asserts no rehearsal or staged effect.
  const files = proposals.map(p => ({ path: p.targetPath, intentId: deriveIntentId(p), draftHash: deriveDraftHash(p), receiptHash: null }));
  const request = { candidateId: candidateIdForFiles(files), files };
  const hybrid = verifyAumlokPromotionV2(bundle.candidateAuth, ownerRoot, nowMs);
  const decision = new CandidateReferenceMonitor(ownerRoot).decide(request, bundle.candidateAuth, nowMs, { ownerArmed: opts.armed === true, headBefore: opts.base });
  if (!hybrid.valid || !decision.allowed) refuse('candidate:reference-monitor-refused', {
    hybrid, monitor: decision.code, digest: decision.payloadHash, base: opts.base,
    repository: repository.ok ? 'canonical' : repository.code,
    note: 'Fails closed without a pinned hybrid Ed25519 + ML-DSA-65 public root, valid signatures and explicit clearance. No candidate was materialized.',
  });
  assertAuthorityRoot(ownerRoot);
  assertSignedPromotion(bundle.candidateAuth);
  if (!repository.ok) refuse('candidate:wrong-repository', { reason: repository.code });
  if (git(repo, ['status', '--porcelain']).trim()) refuse('candidate:dirty-tree');
  const loc = locations(opts, repo, source);
  const store = new ReactiveMemoryStore();
  const staged = envelope.stageBranchCandidate({ store, ownerRoot, ledger: new RecursionLedger(), knownFiles: new Set(opts.paths),
    nowMs, nowIso: new Date(nowMs).toISOString(), deadlineMs: nowMs + LIMITS.DEFAULT_WALL_TIME_BUDGET_MS },
    proposals.map(proposal => ({ proposal, auth: bundle.drafts?.[proposal.targetPath] })), 'Genesis CLI: generated original candidate stage');
  if (!staged.ok) refuse(staged.refusal.reasonClass);
  for (const proposal of proposals) assertSignedPromotion(bundle.drafts[proposal.targetPath]);
  const candidate = staged.candidate;
  const digest = candidatePayloadHash(candidate, opts.base);
  mkdirSync(loc.records, { recursive: true, mode: 0o700 });
  const attempt = mkdtempSync(join(loc.records, `${digest}.attempt-`));
  // Persist the originals' content-free receipt chain before each effect, not a fabricated receipt.
  persist(join(attempt, 'rehearsal.json'), store.chain());
  const ingest = store.ingest.bind(store);
  store.ingest = record => {
    const result = ingest(record);
    if (result.ok) persist(join(attempt, `${result.chainHash}.receipt.json`), store.chain());
    return result;
  };
  const materialized = materializeCandidate({ repoRoot: repo, worktreeBase: loc.worktrees, candidate, candidateAuth: bundle.candidateAuth,
    monitor: new DurableCandidateReferenceMonitor(ownerRoot, loc.monitor), ownerArmed: opts.armed === true,
    expectedHeadBefore: opts.base, authBindsHead: true, store, nowMs: Date.now(), nowIso: new Date().toISOString() });
  if (!materialized.ok) refuse(materialized.reasonClass, { text: materialized.text });
  const record = { schema: 'aukora-generated-candidate-cli-v1', digest, repo, base: opts.base,
    commit: materialized.commitSha, tree: git(repo, ['rev-parse', `${materialized.commitSha}^{tree}`]).trim(), paths: opts.paths,
    candidate: { ...candidate, workspace: [...candidate.workspace] }, candidateAuth: bundle.candidateAuth, rootId: ownerRoot.rootId,
    worktree: materialized.worktreePath, worktreeBase: loc.worktrees, materialized };
  assertCommit(record, candidate, repo);
  persist(join(loc.records, `${digest}.json`), record);
  emit(record, diff(repo, record.base, record.commit));
}

function check(opts) {
  if (!/^[0-9a-f]{64}$/.test(opts.digest ?? '') || !opts['state-dir'] || !opts['owner-root']) refuse('check-requires-digest-state-and-pinned-public-root');
  const repo = realpathSync(process.cwd());
  const repository = identity(repo);
  if (!repository.ok) refuse('candidate:wrong-repository', { reason: repository.code });
  const state = resolve(opts['state-dir']);
  if (trustedStateDirInsideFence(state, [repo])) refuse('state-inside-repo');
  const record = jsonFile(join(state, 'records', `${opts.digest}.json`));
  if (record.schema !== 'aukora-generated-candidate-cli-v1' || record.repo !== repo || record.digest !== opts.digest ||
      trustedStateDirInsideFence(state, [record.worktreeBase])) refuse('candidate-record-mismatch');
  safePaths(record.paths);
  const candidate = { ...record.candidate, workspace: new Map(record.candidate.workspace) };
  if (JSON.stringify(candidate.files.map(f => f.path)) !== JSON.stringify(record.paths) ||
      candidateIdForFiles(candidate.files) !== candidate.candidateId || candidatePayloadHash(candidate, record.base) !== opts.digest) refuse('candidate-digest-mismatch');
  for (const file of candidate.files) {
    const proposal = { targetPath: file.path, newContent: candidate.workspace.get(file.path), supersedes: null };
    if (typeof proposal.newContent !== 'string' || deriveDraftHash(proposal) !== file.draftHash || deriveIntentId(proposal) !== file.intentId || !/^[0-9a-f]{64}$/.test(file.receiptHash)) refuse('candidate-draft-mismatch');
  }
  const root = jsonFile(opts['owner-root']);
  assertAuthorityRoot(root);
  if (root.rootId !== record.rootId) refuse('candidate-pinned-root-mismatch');
  const decision = new CandidateReferenceMonitor(root).decide(candidate, record.candidateAuth, Date.now(), { ownerArmed: true, headBefore: record.base });
  if (!decision.allowed) refuse('candidate:reference-monitor-refused', { monitor: decision.code });
  const monitor = new DurableCandidateReferenceMonitor(root, join(state, 'monitor'));
  if (!monitor.consumed().includes(record.candidateAuth.authorization.nonce)) refuse('candidate-consumption-not-recorded');
  if (git(repo, ['rev-parse', 'HEAD']).trim() !== record.base) refuse('candidate:stale-head');
  assertCommit(record, candidate, repo);
  if (!existsSync(record.worktree) || realpathSync(record.worktree) === repo ||
      git(record.worktree, ['rev-parse', 'HEAD']).trim() !== record.commit || git(record.worktree, ['status', '--porcelain']).trim()) refuse('candidate-worktree-changed');
  emit(record, diff(repo, record.base, record.commit));
}

try {
  if (process.argv.includes('--help')) process.stdout.write(HELP);
  else {
    const opts = options(process.argv.slice(2));
    if (opts.command === 'stage') stage(opts);
    else if (opts.command === 'check') check(opts);
    else refuse('usage');
  }
} catch (error) {
  // Do not echo input JSON, proposed content, Git stderr or key material on failure.
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.details ? error.message : 'candidate-input-or-io-error', ...(error.details ?? {}) })}\n`);
  process.exitCode = 1;
} finally {
  if (emptyHome) rmSync(emptyHome, { recursive: true, force: true });
}
