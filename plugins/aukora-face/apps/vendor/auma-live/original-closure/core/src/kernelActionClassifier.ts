/**
 * 24Z.17 — Kernel-backed draft action classifier (Great Merge: bridge organs → a real coding PATH, no write).
 *
 * Reads the real kernel action registry (node-template/convex/aukoraActionRegistry.ts — PARSED, never
 * imported/executed) to recover its Ring-0 sacred-class regexes + executable targets, then classifies a
 * draft's INTENDED action against them:
 *   - sacred (Ring-0: secrets/auth/founder/kill-switch/doctrine/identity/cross-user) → NEVER applyable, even
 *     with a signed permit. gate = never_ring0.
 *   - executable (matches a known kernel executable target) → would need a signed apply lane. gate = signed_apply_lane.
 *   - write_gated (an ordinary write/change not in the registry) → deny-unknown default: signed_apply_lane.
 *   - read_only (pure inspect/draft, no write) → gate = none (it only answers/drafts).
 * Every verdict is `canApplyNow: false` (no apply lane / no signer exists this round). Advisory; grants no
 * authority; classifying never executes anything. Errs toward sacred/blocked (safe direction for drafts).
 */
import * as fs from 'fs';
import * as path from 'path';

export type DraftActionClass = 'sacred' | 'executable' | 'write_gated' | 'read_only' | 'unknown';
export type ActionGate = 'never_ring0' | 'signed_apply_lane' | 'deny_unknown' | 'none';

export interface SacredClassRule { namespace: string; kind: string; legacy: string; summary: string }
export interface ExecutableTargetRule { action: string; resource: string; ring: string; label: string; path: string }

export interface KernelActionTable {
  schema: 'kernel-action-table-v0';
  sourcePath: string;
  parsed: boolean;
  sacredClasses: SacredClassRule[];
  executableTargets: ExecutableTargetRule[];
}

export interface DraftActionVerdict {
  class: DraftActionClass;
  isWrite: boolean;
  requiresSignedApply: boolean;
  canApplyNow: false;        // hard — no apply lane / signer exists this round
  gate: ActionGate;
  matched: string;           // what matched: kernel:<kind> / sacred_keyword / target:<action> / verb / none
  rationale: string;
  ring?: string;
  label?: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

// Fail-closed Ring-0 net: the kernel's 8 sacred patterns copied VERBATIM from node-template/convex/aukoraCore.ts
// SACRED_PATTERNS (incl. plural suffixes + the (^|_)/(_|$) anchors), ALWAYS applied independent of the parsed
// table/manifest (red-team: an empty/stale sacredPatterns must NOT downgrade sacred; the net must NOT be weaker
// than the kernel — plural forms "founders"/"credentials"/"aumloks" are sacred too).
const DEFAULT_SACRED_PATTERNS = [
  '(^|_)aukora_?(config|secret|token|grant|kill|runtime|intent|salama)',
  '(^|_)token_?secret',
  '(^|_)(aumlok|auth|credential)(?:es|s)?(_|$)',
  '(^|_)founder(?:s)?(_|$)',
  '(^|_)kill_?switch(?:es)?(_|$)',
  '(^|_)(?:self_?)?doctrine(?:s)?(_|$)',
  '(^|_)identity_?core',
  '(^|_)(other|cross)_?user(?:s)?(_|$)',
] as const;

// Defensive natural-language sacred net (drafts may phrase Ring-0 targets in prose the structured kernel
// regex misses). Over-blocking toward sacred is the SAFE direction — nothing applies regardless.
const SACRED_KEYWORDS = /\b(secret|credential|private key|signing seed|api ?key|kill ?switch|founder|doctrine|password|mnemonic|token secret|identity core|cross user|other user)\b/i;

// Issue: one-signature gate self-unlock (Opus audit 2026-07-04). The keyword net above fences
// secrets/auth/founder/kill-switch but is BLIND to the live-apply gate machinery's OWN filenames — so a draft
// to edit them classified as an ordinary write, and an owner could sign a gate self-edit believing it routine.
// Surface those targets as SACRED/Ring-0 so the workbench evidence flags them. This classifier is an ADVISORY
// owner-facing SIGNAL (best-effort, over prose/paths); the AUTHORITATIVE refusal is the hardcoded exact-path
// fence in nativeLiveApply.ts (which does NOT trust this file — this file is itself fence-protected). Match the
// gate files by EXACT basename + `.ts` boundary (not a bare token): an adversarial pass showed `\b(name)\b`
// over-blocked innocent siblings like `policyKernel-helper.ts`, which would wrongly refuse a legit signed write.
const GATE_MACHINERY_TARGET = /(^|[\s/\\])(nativeliveapply|kernelactionclassifier|appliedproposalledger|policykernel|proposalhash|aumlokauthorityroot|sandboxapply)\.ts(?![\w])|(^|[\s/\\])(authority|identity)[/\\]|\bdocs[/\\]policy-rings\b/i;
// State/brain + env protection brick — owner-facing advisory signal mirroring GATE_MACHINERY_TARGET, so a draft
// that touches organism state, secrets, or the ratified-Ring-0 authority paths is surfaced as never-applyable
// BEFORE the owner signs. The AUTHORITATIVE refusal is isRing0ApplyTarget in nativeLiveApply.ts (path-exact,
// classifier-independent); this regex is best-effort over prose/paths. Over-blocking is the safe direction.
const STATE_ENV_TARGET = /(^|[\s/\\])state[/\\]|\bbrain\.json\b|(^|[\s/\\])\.github[/\\]|(^|[\s/\\])\.envrc(?![\w])|(^|[\s/\\])\.env(?![\w.-])|(^|[\s/\\])\.env\.(?!(?:example|sample|template|dist|defaults)\b)[\w.-]+|(^|[\s/\\])(pinnedpublickey|nodeidentity)\.ts(?![\w])|(^|[\s/\\])(aumlok-authority|scan-secrets|verify-public-readiness)\.sh\b|\bauth\.json\b|\baumlok-dev\.json\b|\.(key|pem)(?![\w])/i;
const WRITE_VERBS = /\b(add|create|build|make|implement|fix|repair|refactor|rename|move|change|update|write|wire|remove|delete|patch|edit|apply|commit|deploy|mutate|insert|overwrite)\b/i;
const READ_VERBS = /\b(read|show|explain|what|where|which|list|summari[sz]e|inspect|describe|how|status)\b/i;

function parseObjects(block: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const objRe = /\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(block)) !== null) {
    const fields: Record<string, string> = {};
    const fieldRe = /(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(m[1])) !== null) fields[f[1]] = f[2];
    if (Object.keys(fields).length) out.push(fields);
  }
  return out;
}

function sliceArray(src: string, marker: string): string {
  // find `marker ... = [ ... ]` — start the bracket search AFTER the `=` so a type annotation like
  // `: readonly SacredClass[] =` does not capture its own empty `[]`.
  const decl = src.indexOf(`const ${marker}`);
  const start = decl === -1 ? src.indexOf(marker) : decl;
  if (start === -1) return '';
  const eq = src.indexOf('=', start);
  if (eq === -1) return '';
  const open = src.indexOf('[', eq);
  if (open === -1) return '';
  // find the matching closing bracket
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return '';
}

export interface ActionTableOptions { repoRoot?: string }

export function buildKernelActionTable(opts: ActionTableOptions = {}): KernelActionTable {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..', '..');
  const sourcePath = path.join(repoRoot, 'node-template', 'convex', 'aukoraActionRegistry.ts');
  if (!fs.existsSync(sourcePath)) {
    return { schema: 'kernel-action-table-v0', sourcePath, parsed: false, sacredClasses: [], executableTargets: [] };
  }
  const src = fs.readFileSync(sourcePath, 'utf-8');
  const sacredClasses = parseObjects(sliceArray(src, 'SACRED_CLASSES')).map((o) => ({
    namespace: o.namespace ?? '', kind: o.kind ?? '', legacy: o.legacy ?? '', summary: o.summary ?? '',
  })).filter((s) => s.legacy);
  const executableTargets = parseObjects(sliceArray(src, 'EXECUTABLE_TARGETS')).map((o) => ({
    action: o.action ?? '', resource: o.resource ?? '', ring: o.ring ?? '', label: o.label ?? '', path: o.path ?? '',
  })).filter((e) => e.action);
  return { schema: 'kernel-action-table-v0', sourcePath, parsed: true, sacredClasses, executableTargets };
}

function safeRegex(legacy: string): RegExp | null {
  try { return new RegExp(`\\b(?:${legacy})\\b`, 'i'); } catch { return null; }
}

// Mirror node-template/convex/aukoraCore.ts normalizeForSacred: fold separators/digits/camelCase → "_", so a
// Ring-0 target phrased in PROSE ("identity core", "aukora grant table") normalizes to the kernel's underscore
// form ("identity_core", "aukora_grant_table") and matches the glue-required sacred regexes.
function normalizeForSacred(s: string): string {
  let t = (s ?? '').slice(0, 512);
  try { t = t.normalize('NFKD'); } catch { /* malformed surrogate */ }
  return t
    .replace(/[\u0300-\u036F]/g, '')                            // combining diacritics (from NFKD)
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '') // control + zero-width chars
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .slice(0, 256);
}

/** A sacred pattern matches if it hits the RAW text OR the normalized "_"-joined form — catching glued AND
 *  space-separated prose. Handles BOTH already-anchored canonical patterns (containing (^|_)/(_|$)) and bare
 *  legacy strings (from the registry/manifest, which get word/token-boundary wrapping). Returns match or null. */
function matchesSacred(text: string, patterns: readonly string[]): string | null {
  const norm = normalizeForSacred(text);
  for (const p of patterns) {
    const anchored = p.includes('(^|_)') || p.includes('(_|$)');
    if (anchored) {
      // (a) already-anchored canonical patterns — test as-is against raw + normalized (anchors prevent
      // substring over-match like "auth" in "authorization").
      let asis: RegExp | null;
      try { asis = new RegExp(p, 'i'); } catch { asis = null; }
      if (asis && (asis.test(text) || asis.test(norm))) return p;
    } else {
      // (b) bare legacy strings (registry/manifest) — MUST be boundary-wrapped (never raw substring).
      const raw = safeRegex(p);
      if (raw && raw.test(text)) return p;
      let tok: RegExp | null;
      try { tok = new RegExp(`(^|_)(?:${p})(_|$)`, 'i'); } catch { tok = null; }
      if (tok && tok.test(norm)) return p;
    }
  }
  return null;
}

/** Classify a draft's intended action against the kernel action table. Pure; never executes anything. */
export function classifyDraftAction(intentText: string, table: KernelActionTable): DraftActionVerdict {
  const text = typeof intentText === 'string' ? intentText : '';
  const base = { canApplyNow: false as const, advisoryOnly: true as const, grantsAuthority: false as const };

  // (1) Sacred (Ring-0) wins — never applyable, even with a signed permit. Test the fail-closed DEFAULT net
  // UNION the parsed table patterns, against raw + normalized prose (catches glued AND space-separated forms).
  const sacredPatterns = [...DEFAULT_SACRED_PATTERNS, ...table.sacredClasses.map((s) => s.legacy)];
  const hit = matchesSacred(text, sacredPatterns);
  if (hit) {
    return { ...base, class: 'sacred', isWrite: true, requiresSignedApply: true, gate: 'never_ring0',
      matched: `kernel:${hit}`, rationale: 'Ring-0 sacred target — never applyable, even with a signed permit.' };
  }
  if (SACRED_KEYWORDS.test(text)) {
    return { ...base, class: 'sacred', isWrite: true, requiresSignedApply: true, gate: 'never_ring0',
      matched: 'sacred_keyword', rationale: 'Touches Ring-0 sacred material (secret/credential/auth) — never applyable.' };
  }
  if (GATE_MACHINERY_TARGET.test(text)) {
    return { ...base, class: 'sacred', isWrite: true, requiresSignedApply: true, gate: 'never_ring0',
      matched: 'gate_machinery', rationale: 'Targets the live-apply gate machinery itself (Ring-0, self-protected) — never applyable, even with a signed permit; editing it is not an ordinary change.' };
  }
  if (STATE_ENV_TARGET.test(text)) {
    return { ...base, class: 'sacred', isWrite: true, requiresSignedApply: true, gate: 'never_ring0',
      matched: 'state_env', rationale: 'Targets organism state/brain, an env/secret file, or a ratified Ring-0 authority path (self-protected) — never applyable, even with a signed permit; the live-apply gate refuses it before any write.' };
  }

  const isWriteIntent = WRITE_VERBS.test(text);
  const lower = text.toLowerCase();

  // (2) A WRITE intent that references a known kernel executable target → would need a signed apply lane.
  if (isWriteIntent) {
    for (const e of table.executableTargets) {
      const tokens = [
        e.action, e.action.replace(/_/g, ' '),
        e.resource, e.resource.split(':')[0], e.resource.split(':')[0].replace(/_/g, ' '),
      ].filter((t) => t && t.length > 3).map((t) => t.toLowerCase());
      if (tokens.some((t) => lower.includes(t))) {
        return { ...base, class: 'executable', isWrite: true, requiresSignedApply: true, gate: 'signed_apply_lane',
          matched: `target:${e.action}`, ring: e.ring, label: e.label,
          rationale: `Maps to kernel executable target "${e.label}" (${e.path}) — requires a signed apply lane (not built).` };
      }
    }
    // (3) An ordinary write/change not in the registry → deny-unknown default: signed apply lane.
    return { ...base, class: 'write_gated', isWrite: true, requiresSignedApply: true, gate: 'signed_apply_lane',
      matched: 'verb', rationale: 'A write/change not in the kernel registry — under deny-unknown it requires a signed apply lane (not built).' };
  }

  // (4) Pure read/inspect/draft — no write, no gate; it only answers or drafts.
  if (READ_VERBS.test(text)) {
    return { ...base, class: 'read_only', isWrite: false, requiresSignedApply: false, gate: 'none',
      matched: 'verb', rationale: 'Read/inspect/draft intent — answers or drafts only; nothing to apply.' };
  }

  // (5) Unknown → deny-unknown (treated as needing a gate; nothing applies).
  return { ...base, class: 'unknown', isWrite: false, requiresSignedApply: true, gate: 'deny_unknown',
    matched: 'none', rationale: 'Intent did not match any read/write/kernel pattern — deny-unknown (no apply).' };
}

export function actionVerdictGrantsAuthority(_v: DraftActionVerdict): false { return false; }

/**
 * 24Z.17 (Fusion Opus/GLM): a stable fingerprint of the parsed kernel action table, so the rules embedded in
 * the manifest carry an integrity stamp and staleness/drift is detectable (the registry could change without
 * a manifest regeneration). Deterministic — sorted, no timestamps.
 */
export function kernelActionTableFingerprint(t: KernelActionTable): string {
  const sacred = t.sacredClasses.map((s) => `${s.namespace}.${s.kind}:${s.legacy}`).sort().join('|');
  const exec = t.executableTargets.map((e) => `${e.action}@${e.resource}`).sort().join('|');
  return `sacred[${t.sacredClasses.length}]=${sacred}::exec[${t.executableTargets.length}]=${exec}`;
}

export interface FreshnessResult { fresh: boolean; embeddedFingerprint: string; freshFingerprint: string; drift: string[] }

/**
 * Re-parse the real registry and assert the embedded fingerprint still matches (GLM's freshness check).
 * Used to prove a generated manifest's draftPipeline reflects the CURRENT kernel registry, not a stale copy.
 */
export function checkKernelActionTableFreshness(embeddedFingerprint: string, opts: ActionTableOptions = {}): FreshnessResult {
  const freshFingerprint = kernelActionTableFingerprint(buildKernelActionTable(opts));
  const fresh = embeddedFingerprint === freshFingerprint;
  return {
    fresh,
    embeddedFingerprint,
    freshFingerprint,
    drift: fresh ? [] : ['kernel action table fingerprint mismatch — manifest is stale vs the live registry'],
  };
}

/** Compact context for the console + manifest: "what happens when I ask you to change something?" */
export function summarizeKernelActionTable(t: KernelActionTable): string {
  return [
    `Kernel action registry parsed (read-only): ${t.sacredClasses.length} Ring-0 sacred classes, ${t.executableTargets.length} executable targets.`,
    'A draft is classified before any apply: sacred(Ring-0)=NEVER applyable; executable/write=needs a signed apply lane (NOT built); read=answers only.',
    'canApplyNow=false for every class — no apply lane, no signer wired. Classifying never executes anything.',
  ].join('\n');
}
