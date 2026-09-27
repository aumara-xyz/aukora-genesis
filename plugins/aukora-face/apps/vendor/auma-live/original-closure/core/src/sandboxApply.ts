/**
 * 24Z.18 — Temp-only Sandbox Apply + Receipt V0 (the first proven "the console changed something" — in a temp copy).
 *
 * Given a verified sandbox permit + a tiny safe patch, this applies the patch to a THROWAWAY TEMP WORKSPACE
 * ONLY and returns a receipt that proves the live repo was never touched. Hard invariants:
 *   - the sandbox base MUST resolve under the system temp dir — a repo-rooted `tmpBase` is refused (red-team:
 *     `tmpBase` is the one path parameter; without this guard a caller could aim the sandbox into the live repo)
 *   - paths are validated: no absolute paths, no `..`, no symlink/realpath escape; everything stays in the temp dir
 *   - Ring-0 / sacred file paths are refused (classified via the kernel registry)
 *   - `appliedLive` is hard-false; `liveRepoUnchanged` is true (the write root is provably under the temp dir)
 * grants no authority. Reuses the existing AUMLOK/permit + hash primitives; no kernel code is executed.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { verifySandboxApplyPermit, type SandboxApplyPermit } from './sandboxApplyPermit';
import { buildKernelActionTable, classifyDraftAction, type KernelActionTable } from './kernelActionClassifier';
import { verifySignedSandboxPermit, canonicalPermitPayload, type SignedSandboxPermit, type SignerMode } from './mldsaSandboxSigner';

export interface SandboxPatchFile { relPath: string; content: string }

export interface SandboxFileChange { relPath: string; beforeHash: string; afterHash: string }

// 24Z.23 — telemetry emit is an INJECTED void callback (sandbox apply imports NO telemetry module, so it can
// never read the store / make a telemetry-driven decision). The orchestrator wires `emitSandboxEvent` as onEvent.
export interface SandboxApplyEvent { phase: 'attempt' | 'verified' | 'refused' | 'applied'; receiptMode?: 'write' | 'witness' | 'release' | 'unknown'; refusalCause?: string; latencyMs?: number }
export type SandboxEventSink = (e: SandboxApplyEvent) => void;

// Map a (developer-written) refusal reason to a SAFE coarse category — never the freeform tail (which may
// include an attacker-influenced relPath). Telemetry only ever sees the category.
function refusalCategory(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('permit invalid') || r.includes('signed permit invalid')) return 'permit_invalid';
  if (r.includes('signature')) return 'signature_invalid';
  if (r.includes('not in the signed')) return 'not_permitted';
  if (r.includes('sacred')) return 'sacred_refused';
  if (r.includes('symlink')) return 'symlink_refused';
  if (r.includes('escapes sandbox')) return 'path_escape';
  if (r.includes('unsafe path')) return 'unsafe_path';
  if (r.includes('system temp dir')) return 'base_not_temp';
  if (r.includes('too many')) return 'too_many_files';
  if (r.includes('no patch files')) return 'no_files';
  if (r.includes('bad content')) return 'bad_content';
  return 'refused';
}

export interface SandboxApplyReceipt {
  schema: 'sandbox-apply-receipt-v0';
  draftHash: string;
  engineSource: string;        // 24Z.19: which engine produced the patch (local_planner | opencode | mock | ...)
  actionClassification: 'write_gated';
  permitId: string;
  permitHash: string;
  sandboxPath: string;
  filesChanged: SandboxFileChange[];
  testsRun: string[];
  generatedAt: string;
  appliedSandbox: boolean;
  appliedLive: false;          // hard
  liveRepoUnchanged: true;     // hard — the live path was never in scope
  mode: SignerMode;            // simulated_local | lab_mldsa_sandbox | real_mldsa_sandbox
  signatureVerified: boolean;  // 24Z.21: true only when a real ML-DSA signature verified
  signerFingerprint?: string;  // public-key fingerprint (signed modes); never the secret key
  signatureHash?: string;      // sha256 of the signature (proof, not the signature itself)
  permitPayloadHash?: string;  // sha256 of the canonical signed payload
  advisoryOnly: true;
  grantsAuthority: false;
}

export type SandboxApplyResult =
  | { ok: true; receipt: SandboxApplyReceipt; filesChanged: SandboxFileChange[] }
  | { ok: false; refused: true; reason: string; appliedSandbox: false; appliedLive: false; liveRepoUnchanged: true };

function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }
const EMPTY_HASH = sha256('');

/** A patch file path is safe iff it is relative, has no `..` segment, and normalizes to stay inside the root. */
export function isSafeRelPath(relPath: string): boolean {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  if (path.isAbsolute(relPath)) return false;
  if (relPath.includes('\0')) return false;
  const norm = path.normalize(relPath);
  if (norm.startsWith('..') || norm.split(/[/\\]/).includes('..')) return false;
  if (norm.startsWith('/') || norm.startsWith('\\')) return false;
  return true;
}

export interface ApplySandboxInput {
  permit: SandboxApplyPermit;
  draftHash: string;
  files: SandboxPatchFile[];
  now?: string;
  tmpBase?: string;
  table?: KernelActionTable;     // for sacred-path refusal (defaults to a fresh parse)
  keepSandbox?: boolean;         // default false — temp is removed after hashing (proof captured first)
  engineSource?: string;         // 24Z.19: which engine produced this patch (recorded in the receipt)
  onEvent?: SandboxEventSink;    // 24Z.23: optional one-way telemetry sink (void); no read path
}

/**
 * Shared temp-write core (used by BOTH the simulated and the signed apply paths). Validates files, resolves a
 * temp sandbox under the system temp dir, writes there with full path/realpath/symlink/sacred guards, and runs
 * `build` with the captured {sandboxPath, filesChanged} to produce the receipt. The live repo is never in scope.
 */
function writeSandboxFilesCore(
  files: SandboxPatchFile[],
  opts: { now?: string; tmpBase?: string; table?: KernelActionTable; keepSandbox?: boolean },
  build: (ctx: { sandboxPath: string; filesChanged: SandboxFileChange[] }) => SandboxApplyReceipt,
): SandboxApplyResult {
  const refuse = (reason: string): SandboxApplyResult =>
    ({ ok: false, refused: true, reason, appliedSandbox: false, appliedLive: false, liveRepoUnchanged: true });

  if (!Array.isArray(files) || files.length === 0) return refuse('no patch files');
  if (files.length > 20) return refuse('too many files (sandbox V0 cap = 20)');

  const table = opts.table ?? buildKernelActionTable();
  for (const f of files) {
    if (!isSafeRelPath(f.relPath)) return refuse(`unsafe path: ${f.relPath}`);
    if (classifyDraftAction(f.relPath, table).class === 'sacred') return refuse(`sacred/Ring-0 path refused: ${f.relPath}`);
    if (typeof f.content !== 'string' || f.content.length > 100_000) return refuse(`bad content for ${f.relPath}`);
  }

  // apply to a throwaway temp workspace ONLY. The base MUST resolve under the system temp dir — validated
  // BEFORE anything is created, so a repo-rooted `tmpBase` (red-team escape) is refused with nothing written.
  const base = opts.tmpBase ?? os.tmpdir();
  const tmpReal = fs.realpathSync(os.tmpdir());
  let baseReal: string;
  try { baseReal = fs.realpathSync(base); } catch { return refuse(`sandbox base does not exist: ${base}`); }
  if (baseReal !== tmpReal && !baseReal.startsWith(tmpReal + path.sep)) {
    return refuse('sandbox base must resolve under the system temp dir (repo-rooted base refused)');
  }
  const sandboxPath = fs.mkdtempSync(path.join(base, 'aukora-apply-'));
  const rootReal = fs.realpathSync(sandboxPath);
  const filesChanged: SandboxFileChange[] = [];
  try {
    for (const f of files) {
      const abs = path.join(sandboxPath, f.relPath);
      const rel = path.relative(sandboxPath, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) { return refuse(`path escapes sandbox: ${f.relPath}`); }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const parentReal = fs.realpathSync(path.dirname(abs));
      if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
        return refuse(`path escapes sandbox via symlink/realpath: ${f.relPath}`);
      }
      if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) {
        return refuse(`symlink write target refused: ${f.relPath}`);
      }
      const beforeHash = fs.existsSync(abs) ? sha256(fs.readFileSync(abs, 'utf-8')) : EMPTY_HASH;
      fs.writeFileSync(abs, f.content, 'utf-8');
      filesChanged.push({ relPath: f.relPath, beforeHash, afterHash: sha256(f.content) });
    }
    return { ok: true, receipt: build({ sandboxPath, filesChanged }), filesChanged };
  } finally {
    if (!opts.keepSandbox) fs.rmSync(sandboxPath, { recursive: true, force: true });
  }
}

// 24Z.32 — emit is HARDENED: a throwing telemetry sink can never break apply. The sink is wrapped in a try/catch
// and its result is discarded (telemetry is evidence-only — outcome NEVER reads the sink). The standing emit()
// YELLOW is closed by construction here; tests assert apply-result identity across no-sink/normal/throwing-sink.
function safeEmit(sink: SandboxEventSink | undefined): SandboxEventSink {
  const cb = sink ?? (() => {});
  return (e: SandboxApplyEvent) => { try { cb(e); } catch { /* ignored — telemetry is evidence-only */ } };
}

/** 24Z.18 path — a simulated_local permit authorizes a temp-only apply. (No real signature.) */
export function applySandboxPatch(input: ApplySandboxInput): SandboxApplyResult {
  const emit = safeEmit(input.onEvent); emit({ phase: 'attempt' });
  const pv = verifySandboxApplyPermit(input.permit, { draftHash: input.draftHash, now: input.now });
  if (!pv.valid) { emit({ phase: 'refused', refusalCause: 'permit_invalid' }); return { ok: false, refused: true, reason: `permit invalid: ${pv.violations.join('; ')}`, appliedSandbox: false, appliedLive: false, liveRepoUnchanged: true }; }
  const res = writeSandboxFilesCore(input.files, input, ({ sandboxPath, filesChanged }) => ({
    schema: 'sandbox-apply-receipt-v0', draftHash: input.draftHash, engineSource: input.engineSource ?? 'unspecified',
    actionClassification: 'write_gated', permitId: input.permit.permitId, permitHash: input.permit.permitHash,
    sandboxPath, filesChanged, testsRun: [], generatedAt: input.now ?? new Date().toISOString(),
    appliedSandbox: true, appliedLive: false, liveRepoUnchanged: true,
    mode: 'simulated_local', signatureVerified: false, advisoryOnly: true, grantsAuthority: false,
  }));
  if (res.ok) emit({ phase: 'applied', receiptMode: 'write' }); else emit({ phase: 'refused', refusalCause: refusalCategory(res.reason) });
  return res;
}

export interface ApplySignedSandboxInput {
  signedPermit: SignedSandboxPermit;
  draftHash: string;
  files: SandboxPatchFile[];
  now?: string;
  tmpBase?: string;
  table?: KernelActionTable;
  keepSandbox?: boolean;
  engineSource?: string;
  expectedFingerprint?: string;  // optional pin to a specific lab signer key
  onEvent?: SandboxEventSink;    // 24Z.23: optional one-way telemetry sink (void)
}

/**
 * 24Z.21 path — a REAL ML-DSA signature must verify before any temp write. Fail-closed: an unsigned/forged/
 * tampered/expired/wrong-key/wrong-draft permit writes nothing. Still temp-only; live repo never in scope.
 */
export function applySignedSandboxPatch(input: ApplySignedSandboxInput): SandboxApplyResult {
  const emit = safeEmit(input.onEvent); emit({ phase: 'attempt' });
  const refuse = (reason: string, category: string): SandboxApplyResult => {
    emit({ phase: 'refused', refusalCause: category });
    return { ok: false, refused: true, reason, appliedSandbox: false, appliedLive: false, liveRepoUnchanged: true };
  };

  const vr = verifySignedSandboxPermit(input.signedPermit, { draftHash: input.draftHash, now: input.now, expectedFingerprint: input.expectedFingerprint });
  if (!vr.valid || !vr.signatureVerified) return refuse(`signed permit invalid: ${vr.violations.join('; ')}`, 'signature_invalid');
  emit({ phase: 'verified' });

  // a bound permittedRelPaths allowlist (if present) must cover every file being applied
  const allow = input.signedPermit.payload.permittedRelPaths;
  if (allow.length) {
    const set = new Set(allow);
    for (const f of input.files) if (!set.has(f.relPath)) return refuse(`file not in the signed permittedRelPaths: ${f.relPath}`, 'not_permitted');
  }

  const sigHash = sha256(input.signedPermit.signatureHex);
  const payloadHash = sha256(canonicalPermitPayload(input.signedPermit.payload));
  const res = writeSandboxFilesCore(input.files, input, ({ sandboxPath, filesChanged }) => ({
    schema: 'sandbox-apply-receipt-v0', draftHash: input.draftHash, engineSource: input.engineSource ?? 'unspecified',
    actionClassification: 'write_gated', permitId: input.signedPermit.payload.permitId, permitHash: payloadHash,
    sandboxPath, filesChanged, testsRun: [], generatedAt: input.now ?? new Date().toISOString(),
    appliedSandbox: true, appliedLive: false, liveRepoUnchanged: true,
    mode: input.signedPermit.mode, signatureVerified: true, signerFingerprint: input.signedPermit.signerFingerprint,
    signatureHash: sigHash, permitPayloadHash: payloadHash, advisoryOnly: true, grantsAuthority: false,
  }));
  if (res.ok) emit({ phase: 'applied', receiptMode: 'write' }); else emit({ phase: 'refused', refusalCause: refusalCategory(res.reason) });
  return res;
}

/** Validate a receipt cannot lie about a live mutation. Re-checks the dangerous invariants standalone:
 *  sandboxPath must be a temp dir, and no recorded file may be an unsafe or Ring-0/sacred path. */
export function validateSandboxApplyReceipt(r: SandboxApplyReceipt, table?: KernelActionTable): { valid: boolean; violations: string[] } {
  const v: string[] = [];
  if (r.schema !== 'sandbox-apply-receipt-v0') v.push('bad schema');
  if (r.appliedLive !== false) v.push('appliedLive must be false');
  if (r.liveRepoUnchanged !== true) v.push('liveRepoUnchanged must be true');
  if (r.grantsAuthority !== false) v.push('grantsAuthority must be false');
  if (r.actionClassification !== 'write_gated') v.push('actionClassification must be write_gated');
  const MODES = ['simulated_local', 'lab_mldsa_sandbox', 'real_mldsa_sandbox'];
  if (!MODES.includes(r.mode)) v.push(`mode must be one of ${MODES.join('|')}`);
  // 24Z.21: a signed (lab/real) mode MUST carry a verified signature + a signer fingerprint; the simulated
  // mode must NOT claim a verified signature.
  if ((r.mode === 'lab_mldsa_sandbox' || r.mode === 'real_mldsa_sandbox')) {
    if (r.signatureVerified !== true) v.push(`${r.mode} requires signatureVerified=true`);
    if (!r.signerFingerprint) v.push(`${r.mode} requires a signerFingerprint`);
  }
  if (r.mode === 'simulated_local' && r.signatureVerified === true) v.push('simulated_local must not claim signatureVerified');
  if (!r.engineSource || typeof r.engineSource !== 'string') v.push('engineSource must be recorded');
  // red-team: a receipt must not claim a sandboxPath that is NOT a temp dir (e.g. the live repo root)
  const tmpRaw = os.tmpdir();
  let tmpReal = tmpRaw; try { tmpReal = fs.realpathSync(tmpRaw); } catch { /* ignore */ }
  if (!r.sandboxPath || !(r.sandboxPath.startsWith(tmpRaw) || r.sandboxPath.startsWith(tmpReal))) {
    v.push('sandboxPath must be under the system temp dir');
  }
  const t = table ?? buildKernelActionTable();
  for (const c of r.filesChanged) {
    if (!c.relPath || !c.afterHash) v.push(`incomplete file change: ${c.relPath}`);
    if (c.beforeHash === c.afterHash) v.push(`no-op change recorded for ${c.relPath} (before==after)`);
    if (c.relPath && !isSafeRelPath(c.relPath)) v.push(`unsafe path in receipt: ${c.relPath}`);
    if (c.relPath && classifyDraftAction(c.relPath, t).class === 'sacred') v.push(`sacred/Ring-0 path in receipt: ${c.relPath}`);
  }
  return { valid: v.length === 0, violations: v };
}

/** Compact status for the manifest / the console. */
export function summarizeSandboxApply(): string {
  return [
    'Sandbox apply: a verified sandbox permit can apply a tiny patch to a THROWAWAY TEMP copy. 24Z.21 adds a REAL',
    'ML-DSA-65 signed permit (mode=lab_mldsa_sandbox — real signature, LOCAL/LAB key, NOT production AUMLOK); the',
    'signature is verified before any temp write. appliedLive=false (hard); liveRepoUnchanged proven; receipt records',
    'before/after hashes + signature proof. LIVE apply lane: NOT built. Production signer: NOT built. OpenCode: parked.',
  ].join('\n');
}
