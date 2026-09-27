/**
 * Kira Brain — seed-native persistent memory organ.
 *
 * This is the missing living surface between "a pile of memory modules" and an actual usable brain:
 * append-only receipts, persistent atoms, multi-perceiver recall, interference scoring, self-map ingestion,
 * and a verifier. It is still advisory-only: memory suggests, never authorizes.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
import { resolveRepoReadPath } from './repoReadPathResolver';

// 'erasure' (Brick 0a): the receipt KIND for a typed owner forget — the chain proves an erasure
// happened after the content itself is gone.
export type MemoryKind = 'experience' | 'code_map' | 'receipt' | 'note' | 'erasure';
export type PerceiverName = 'lexical' | 'glyph' | 'topology';

export interface KiraReceipt {
  id: string;
  sequence: number;
  previousHash: string;
  atomId: string;
  inputHash: string;
  createdAt: string;
  kind: MemoryKind;
  source: string;
  scope: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface MemoryAtom {
  id: string;
  kind: MemoryKind;
  source: string;
  scope: string;
  text: string;
  supportQuote: string;
  tags: string[];
  tokens: string[];
  trigrams: string[];
  links: string[];
  receiptId: string;
  createdAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
  // Brick 0a — erasure state. An erased atom keeps its id/receipt linkage (the ledger stays true)
  // while EVERY content-carrying field (text, supportQuote, tokens, trigrams, tags, links) is
  // scrubbed. A matching kind:'erasure' receipt must exist on the chain.
  erased?: true;
  erasedAt?: string;
  eraseReason?: string;
  // Brick 0d — quarantine state. A bad atom (forbidden-shaped content, content-hash mismatch,
  // broken flags) is CONTAINED — excluded from recall, exempt from content re-checks so the rest
  // of the brain still loads — never load-and-throw. Owner decides its fate (erase or repair).
  quarantined?: true;
  quarantinedAt?: string;
  quarantineReason?: string;
}

export interface KiraBrainState {
  schema: 'AUKORA_KIRA_BRAIN_V1';
  createdAt: string;
  updatedAt: string;
  receipts: KiraReceipt[];
  atoms: MemoryAtom[];
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface IngestInput {
  kind?: MemoryKind;
  text: string;
  source?: string;
  scope?: string;
  tags?: string[];
  links?: string[];
  now?: string;
}

export interface PerceiverScore {
  name: PerceiverName;
  score: number;
  evidence: string;
}

export interface RecallHit {
  atomId: string;
  receiptId: string;
  source: string;
  scope: string;
  kind: MemoryKind;
  supportQuote: string;
  tags: string[];
  perceivers: PerceiverScore[];
  interferenceScore: number;
  consensus: number;
  citation: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface RecallResult {
  query: string;
  hits: RecallHit[];
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  receiptCount: number;
  atomCount: number;
  // Brick 0: contained issues are VISIBLE, not hidden — a green verify with quarantined atoms
  // reads "ledger sound; N atoms jailed", never "everything fine".
  quarantinedCount: number;
  erasedCount: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

// Fixed previousHash anchor for the first receipt in the append-only chain.
// Every chain verification walks back to this literal; it must never change.
const GENESIS = 'genesis';
const SAFE_ID = /^[A-Za-z0-9_.:/@#-]{1,160}$/;
const WORD_RE = /[a-z0-9][a-z0-9_.:-]*/gi;
const MAX_TEXT = 40_000;
const MAX_QUOTE = 280;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function safeLabel(value: string | undefined, fallback: string): string {
  const v = (value ?? fallback).trim();
  return SAFE_ID.test(v) ? v : fallback;
}

export function tokenize(text: string): string[] {
  return uniq((text.toLowerCase().match(WORD_RE) ?? [])
    .map((t) => t.replace(/^[_:.-]+|[_:.-]+$/g, ''))
    .filter((t) => t.length >= 2 && t.length <= 80));
}

export function trigrams(text: string): string[] {
  const clean = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= 3) return clean ? [clean] : [];
  const grams: string[] = [];
  for (let i = 0; i <= clean.length - 3; i++) grams.push(clean.slice(i, i + 3));
  return uniq(grams);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const aa = new Set(a);
  const bb = new Set(b);
  let inter = 0;
  for (const x of aa) if (bb.has(x)) inter++;
  return inter / (aa.size + bb.size - inter);
}

function sanitizeText(text: string): string {
  const trimmed = text.slice(0, MAX_TEXT);
  const forbiddenKeys = scanForbiddenKeys({ text: trimmed });
  const forbiddenValues = scanForbiddenValues({ text: trimmed });
  if (forbiddenKeys.length || forbiddenValues.length) {
    throw new Error(`kira_forbidden_content:${[...forbiddenKeys, ...forbiddenValues].join(',')}`);
  }
  return trimmed;
}

function sanitizeTags(tags: string[] | undefined): string[] {
  return uniq((tags ?? [])
    .map((t) => safeLabel(t, 'tag'))
    .filter((t) => t !== 'tag')
    .slice(0, 32));
}

function makeReceiptId(receipt: Omit<KiraReceipt, 'id'>): string {
  return sha256(JSON.stringify([
    receipt.sequence,
    receipt.previousHash,
    receipt.atomId,
    receipt.inputHash,
    receipt.createdAt,
    receipt.kind,
    receipt.source,
    receipt.scope,
  ]));
}

function makeAtomId(inputHash: string, sequence: number): string {
  return `atom_${sequence}_${inputHash.slice(0, 16)}`;
}

// Round 3 (issue #23): the one shared, exported path resolver — kiraCli.ts and
// selfEditReviewCouncil.ts each already carry their OWN private near-duplicate of this exact
// logic; this is deliberately NOT a third private copy, so new callers (e.g. workbenchCommandLoop.ts,
// which structurally cannot import fs/path itself) have one real place to get it from.
export function defaultKiraStatePath(): string {
  return process.env.AUKORA_KIRA_STATE ?? path.join(path.resolve(__dirname, '..', '..'), 'state', 'kira', 'brain.json');
}

export function createEmptyBrain(now = new Date().toISOString()): KiraBrainState {
  return {
    schema: 'AUKORA_KIRA_BRAIN_V1',
    createdAt: now,
    updatedAt: now,
    receipts: [],
    atoms: [],
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function loadBrainState(filePath: string): KiraBrainState {
  if (!fs.existsSync(filePath)) return createEmptyBrain();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as KiraBrainState;
  // Brick 0d — quarantine, never brick. The LEDGER is the trust spine: a broken receipt chain
  // (sequence/prevHash/id mismatch, bad schema) still fails LOUD — that is not business as usual.
  // ATOM-level failures (forbidden-shaped content, content-hash mismatch, broken flags) are
  // CONTAINED instead: the offending atom is marked quarantined (excluded from recall, content
  // checks suspended) and the rest of the brain loads. One bad string must never cost her the
  // whole memory. The marks persist on the next save; verify reports them via quarantinedCount.
  const structural = structuralErrors(parsed);
  if (structural.length) throw new Error(`kira_state_invalid:${structural.join(';')}`);
  const now = new Date().toISOString();
  for (const issue of auditAtomIntegrity(parsed)) {
    const atom = parsed.atoms.find((a) => a.id === issue.atomId);
    if (!atom || atom.quarantined) continue;
    atom.quarantined = true;
    atom.quarantinedAt = now;
    atom.quarantineReason = issue.reason.slice(0, 200);
  }
  const verification = verifyBrainState(parsed);
  if (!verification.ok) throw new Error(`kira_state_invalid:${verification.errors.join(';')}`);
  return parsed;
}

let saveTempCounter = 0;

export function saveBrainState(filePath: string, state: KiraBrainState): void {
  const verification = verifyBrainState(state);
  if (!verification.ok) throw new Error(`kira_state_invalid:${verification.errors.join(';')}`);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Issue #79: write atomically — a temp file in the SAME directory (so rename is atomic on one
  // filesystem), fsync'd, then renamed over the target. An interrupted or failing write leaves the
  // PREVIOUS brain intact instead of a half-written, unloadable file. The temp is cleaned up on failure.
  const tmp = path.join(dir, `.kira-brain.${process.pid}.${saveTempCounter++}.tmp`);
  const data = JSON.stringify(state, null, 2) + '\n';
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort temp cleanup */ }
    throw e;
  }
}

export function ingestMemory(state: KiraBrainState, input: IngestInput): { state: KiraBrainState; atom: MemoryAtom; receipt: KiraReceipt } {
  const now = input.now ?? new Date().toISOString();
  const text = sanitizeText(input.text);
  const sequence = state.receipts.length;
  const kind = input.kind ?? 'experience';
  // Brick 0 hardening (adversarial review): 'erasure' is RESERVED for eraseMemory. Minting an
  // 'erasure'-kind receipt through the ordinary ingest path would forge an erasure proof the
  // integrity audit trusts — reject it here so the only source of erasure receipts is the real
  // typed forget.
  if (kind === 'erasure') throw new Error('kira_ingest_reserved_kind:erasure');
  const source = safeLabel(input.source, 'manual');
  const scope = safeLabel(input.scope, 'default');
  const tags = sanitizeTags(input.tags);
  const links = uniq((input.links ?? []).map((l) => safeLabel(l, 'link')).filter((l) => l !== 'link').slice(0, 64));
  const inputHash = sha256(JSON.stringify({ kind, text, source, scope, tags, links }));
  const atomId = makeAtomId(inputHash, sequence);
  const previousHash = sequence === 0 ? GENESIS : state.receipts[sequence - 1].id;
  const receiptBase: Omit<KiraReceipt, 'id'> = {
    sequence,
    previousHash,
    atomId,
    inputHash,
    createdAt: now,
    kind,
    source,
    scope,
    advisoryOnly: true,
    grantsAuthority: false,
  };
  const receipt: KiraReceipt = { ...receiptBase, id: makeReceiptId(receiptBase) };
  const atom: MemoryAtom = {
    id: atomId,
    kind,
    source,
    scope,
    text,
    supportQuote: text.replace(/\s+/g, ' ').slice(0, MAX_QUOTE),
    tags,
    tokens: tokenize(`${scope} ${source} ${tags.join(' ')} ${text}`),
    trigrams: trigrams(text),
    links,
    receiptId: receipt.id,
    createdAt: now,
    advisoryOnly: true,
    grantsAuthority: false,
  };
  const next: KiraBrainState = {
    ...state,
    updatedAt: now,
    receipts: [...state.receipts, receipt],
    atoms: [...state.atoms, atom],
    advisoryOnly: true,
    grantsAuthority: false,
  };
  const verification = verifyBrainState(next);
  if (!verification.ok) throw new Error(`kira_ingest_invalid:${verification.errors.join(';')}`);
  return { state: next, atom, receipt };
}

function lexicalScore(queryTokens: string[], atom: MemoryAtom): PerceiverScore {
  const score = jaccard(queryTokens, atom.tokens);
  const overlap = queryTokens.filter((t) => atom.tokens.includes(t)).slice(0, 6).join(',');
  return { name: 'lexical', score, evidence: overlap || 'no lexical overlap' };
}

function glyphScore(queryTrigrams: string[], atom: MemoryAtom): PerceiverScore {
  const score = jaccard(queryTrigrams, atom.trigrams);
  return { name: 'glyph', score, evidence: score > 0 ? 'trigram field overlap' : 'no glyph overlap' };
}

function topologyScore(queryTokens: string[], atom: MemoryAtom): PerceiverScore {
  const scopeHits = queryTokens.includes(atom.scope.toLowerCase()) ? 0.35 : 0;
  const tagHits = atom.tags.filter((t) => queryTokens.includes(t.toLowerCase())).length;
  const sourceHit = queryTokens.includes(atom.source.toLowerCase()) ? 0.2 : 0;
  const linkBonus = atom.links.some((l) => queryTokens.includes(l.toLowerCase())) ? 0.1 : 0;
  const score = clamp01(scopeHits + sourceHit + linkBonus + Math.min(0.45, tagHits * 0.15));
  return { name: 'topology', score, evidence: `scope=${atom.scope};tags=${atom.tags.join(',') || 'none'};source=${atom.source}` };
}

function interference(perceivers: PerceiverScore[]): { score: number; consensus: number } {
  const scores = perceivers.map((p) => clamp01(p.score));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
  const active = scores.filter((s) => s > 0.08).length;
  const consensus = active / scores.length;
  const score = clamp01(mean + consensus * 0.18 - variance * 0.35);
  return { score, consensus };
}

export function recall(state: KiraBrainState, query: string, limit = 8): RecallResult {
  const safeQuery = sanitizeText(query);
  const qTokens = tokenize(safeQuery);
  const qTrigrams = trigrams(safeQuery);
  const hits = state.atoms
    // Brick 0: erased and quarantined atoms never reach recall — as LAW, not as a side effect
    // of their tokens happening to be empty.
    .filter((atom) => !atom.erased && !atom.quarantined)
    .map((atom): RecallHit => {
      const perceivers = [
        lexicalScore(qTokens, atom),
        glyphScore(qTrigrams, atom),
        topologyScore(qTokens, atom),
      ];
      const mixed = interference(perceivers);
      return {
        atomId: atom.id,
        receiptId: atom.receiptId,
        source: atom.source,
        scope: atom.scope,
        kind: atom.kind,
        supportQuote: atom.supportQuote,
        tags: atom.tags,
        perceivers,
        interferenceScore: mixed.score,
        consensus: mixed.consensus,
        citation: `${atom.receiptId.slice(0, 16)}:${atom.id}`,
        advisoryOnly: true,
        grantsAuthority: false,
      };
    })
    .filter((h) => h.interferenceScore > 0)
    .sort((a, b) => b.interferenceScore - a.interferenceScore || b.consensus - a.consensus)
    .slice(0, Math.max(1, limit));
  return { query: safeQuery, hits, advisoryOnly: true, grantsAuthority: false };
}

export function ingestSelfMap(
  state: KiraBrainState,
  repoRoot: string,
  opts: { maxFiles?: number; maxTestFiles?: number; now?: string } = {},
): { state: KiraBrainState; ingested: number; skipped: string[] } {
  const maxFiles = opts.maxFiles ?? 80;
  // Issue #62 part 2: cap how many TEST files the walk collects. The repo has ~70 test files that
  // otherwise flood the maxFiles budget alphabetically/structurally before the walk ever reaches
  // docs/ — leaving the brain 92% test files with zero doc/identity coverage. Capping test files
  // frees budget for the rest so a future re-map can't re-flood. Does NOT fix the current brain
  // (that needs a curated ingest, tracked in #62) — it prevents the flood recurring.
  const maxTestFiles = opts.maxTestFiles ?? 10;
  const allowed = new Set(['.ts', '.tsx', '.js', '.json', '.md', '.sh']);
  const skip = new Set(['node_modules', '.git', 'state', 'lab_only', 'dist', 'build', '.cache']);
  const isTestFile = (abs: string): boolean => {
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    return /(^|\/)tests?\//.test(rel) || /\.(test|spec)\.[tj]sx?$/.test(path.basename(abs));
  };
  // #75: carry the resolver's CONFINED real path + its confined-root-relative rel, so the read below uses the
  // guarantee-carrying value (resolved.real), never the pre-resolver lexical join. Storing rel too is required,
  // not cosmetic: recomputing path.relative(repoRoot, real) would break under a symlinked root spelling (the
  // mkdtemp test roots on macOS), since repoRoot and real then differ; resolved.rel is already relative to the
  // realpath'd root.
  const files: Array<{ real: string; rel: string }> = [];
  let testCount = 0;
  const walk = (dir: string) => {
    if (files.length >= maxFiles) return;
    // #75: withFileTypes so directory symlinks are never recursed, and lstat-free symlink detection per entry.
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= maxFiles || skip.has(e.name)) continue;
      if (e.isSymbolicLink()) continue; // #75: never follow a symlink (dir or file) — the escape defense
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile() || !allowed.has(path.extname(e.name))) continue;
      // #75: confine to the caller-supplied root — symlink denial + realpath confinement + the SAME
      // sensitive-path refusal read_file enforces. The self-map must NOT ingest secret-shaped files
      // (auth.json / .aukora/ / credentials / a key in a .ts) into the persistent brain; a blanket opt-out
      // here would have leaked exactly those (caught in adversarial review). Consequence: sensitive-pattern-
      // named files, including in-repo apply-gate source, are not mapped — consistent with read_file.
      const resolved = resolveRepoReadPath(path.relative(repoRoot, abs), { root: repoRoot });
      if (!resolved.ok) continue;
      let size = 0;
      try { size = fs.statSync(resolved.real).size; } catch { continue; }
      if (size > 80_000) continue;
      if (isTestFile(abs)) {
        if (testCount >= maxTestFiles) continue; // test-file cap hit — skip, leave budget for the rest
        testCount++;
      }
      files.push({ real: resolved.real, rel: resolved.rel });
    }
  };
  walk(repoRoot);
  let next = state;
  let ingested = 0;
  const skipped: string[] = [];
  for (const f of files) {
    const rel = f.rel; // resolver's confined-root-relative path — never recomputed from an un-realpath'd root
    const body = fs.readFileSync(f.real, 'utf8').slice(0, 4000); // #75: read the CONFINED real path, not the pre-resolver join
    const summary = [
      `file ${rel}`,
      `ext ${path.extname(rel) || 'none'}`,
      body.split(/\r?\n/).slice(0, 40).join('\n'),
    ].join('\n');
    try {
      const result = ingestMemory(next, {
        kind: 'code_map',
        text: summary,
        source: 'self-map',
        scope: rel.split(path.sep)[0] || 'root',
        tags: ['self-map', path.extname(rel).replace('.', '') || 'file'],
        links: [rel],
        now: opts.now,
      });
      next = result.state;
      ingested++;
    } catch (err) {
      skipped.push(`${rel}:${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { state: next, ingested, skipped };
}

// Brick 0b — content-binding. The EXACT ingest formula (ingestMemory:inputHash) recomputed from
// the atom's own fields. Key order is load-bearing: it must match the ingest literal byte-for-byte
// so an untampered brain never false-flags, and a silently-edited text ALWAYS mismatches.
function atomContentHash(atom: MemoryAtom): string {
  return sha256(JSON.stringify({ kind: atom.kind, text: atom.text, source: atom.source, scope: atom.scope, tags: atom.tags, links: atom.links }));
}

// The erasure receipt binds the erasure RECORD (which atom, why, when) — deterministic key order,
// no formatting whitespace, so a later edit of erasedAt/eraseReason breaks the receipt.
function erasureInputHash(erasedAtomId: string, eraseReason: string, erasedAt: string): string {
  return sha256(JSON.stringify({ erasedAtomId, eraseReason, erasedAt }));
}

// A free-text erasure reason kept HONEST (adversarial review): the owner's actual words are
// preserved on the hash-bound receipt, not silently coerced to a generic fallback. Unlike a
// SAFE_ID label, natural language (spaces, apostrophes, commas) is allowed; only control
// characters are stripped and the length is capped. Empty/blank → the honest generic default.
function sanitizeEraseReason(reason: string | undefined): string {
  // strip ASCII control chars (U+0000-U+001F, U+007F), collapse whitespace, cap length.
  // eslint-disable-next-line no-control-regex
  const cleaned = (reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return cleaned || 'owner-forget';
}

/** LEDGER-level checks — schema, state flags, the receipt chain itself. A failure here is never
 *  quarantinable: a broken trust spine fails loud (load throws), exactly as before Brick 0. */
function structuralErrors(state: KiraBrainState): string[] {
  // a brain.json holding `null` (or any non-object) must fail TYPED, not TypeError mid-check
  if (!state || typeof state !== 'object') return ['state missing or not an object'];
  const errors: string[] = [];
  if (state.schema !== 'AUKORA_KIRA_BRAIN_V1') errors.push('schema invalid');
  if (state.advisoryOnly !== true) errors.push('state.advisoryOnly must be true');
  if (state.grantsAuthority !== false) errors.push('state.grantsAuthority must be false');
  // missing arrays would pass every check below as "empty" and then crash the first caller that
  // touches state.atoms — refuse them here so load fails loud instead of recall failing later.
  if (!Array.isArray(state.receipts) || !Array.isArray(state.atoms)) {
    errors.push('receipts/atoms must be arrays');
    return errors;
  }
  const atomIds = new Set((state.atoms ?? []).map((a) => a.id));
  const receiptIds = new Set<string>();
  for (let i = 0; i < (state.receipts ?? []).length; i++) {
    const r = state.receipts[i];
    if (r.sequence !== i) errors.push(`receipt ${i} sequence mismatch`);
    if (r.previousHash !== (i === 0 ? GENESIS : state.receipts[i - 1].id)) errors.push(`receipt ${i} previousHash mismatch`);
    const id = makeReceiptId({ ...r, id: undefined } as unknown as Omit<KiraReceipt, 'id'>);
    if (r.id !== id) errors.push(`receipt ${i} id mismatch`);
    if (r.advisoryOnly !== true || r.grantsAuthority !== false) errors.push(`receipt ${i} authority flags invalid`);
    if (!atomIds.has(r.atomId)) errors.push(`receipt ${i} missing atom ${r.atomId}`);
    if (receiptIds.has(r.id)) errors.push(`duplicate receipt ${r.id}`);
    receiptIds.add(r.id);
  }
  return errors;
}

/** ATOM-level integrity issues — the quarantinable class (Brick 0d). Shared by loadBrainState
 *  (which contains offenders) and verifyBrainState (which reports them as errors when present
 *  on atoms NOT yet quarantined — an un-jailed bad atom is red; a jailed one is counted). */
function auditAtomIntegrity(state: KiraBrainState): Array<{ atomId: string; reason: string }> {
  const issues: Array<{ atomId: string; reason: string }> = [];
  const receiptById = new Map((state.receipts ?? []).map((r) => [r.id, r]));
  const erasureReceiptsByAtom = new Map<string, KiraReceipt[]>();
  for (const r of state.receipts ?? []) {
    if (r.kind === 'erasure') {
      const list = erasureReceiptsByAtom.get(r.atomId) ?? [];
      list.push(r);
      erasureReceiptsByAtom.set(r.atomId, list);
    }
  }
  for (const atom of state.atoms ?? []) {
    if (atom.quarantined) continue; // already contained — content checks suspended, counted in verify
    if (atom.advisoryOnly !== true || atom.grantsAuthority !== false) {
      issues.push({ atomId: atom.id, reason: 'authority flags invalid' });
      continue;
    }
    const ingest = receiptById.get(atom.receiptId);
    if (!ingest) {
      issues.push({ atomId: atom.id, reason: 'missing receipt' });
      continue;
    }
    if (atom.erased) {
      // erasure completeness: EVERY content-carrying field must be gone…
      if (atom.text !== '' || atom.supportQuote !== '' || atom.tokens.length || atom.trigrams.length || atom.tags.length || atom.links.length) {
        issues.push({ atomId: atom.id, reason: 'erased atom still carries content' });
        continue;
      }
      // …and the chain must PROVE the erasure (a scrub without a receipt is tampering, not forgetting).
      const proofs = erasureReceiptsByAtom.get(atom.id) ?? [];
      if (proofs.length === 0) {
        issues.push({ atomId: atom.id, reason: 'erased atom has no erasure receipt' });
        continue;
      }
      if (proofs.length > 1) {
        issues.push({ atomId: atom.id, reason: 'duplicate erasure receipts' });
        continue;
      }
      const expected = erasureInputHash(atom.id, atom.eraseReason ?? '', atom.erasedAt ?? '');
      if (proofs[0].inputHash !== expected) {
        issues.push({ atomId: atom.id, reason: 'erasure receipt does not bind this erasure record' });
      }
      continue;
    }
    // live atom: forbidden-content scan (as before) + Brick 0b content-binding — the receipt must
    // bind THESE bytes. The silent-edit probe that used to pass green dies on this line.
    const forbidden = [
      ...scanForbiddenKeys(atom),
      ...scanForbiddenValues({ text: atom.text, supportQuote: atom.supportQuote, tags: atom.tags }),
    ];
    if (forbidden.length) {
      issues.push({ atomId: atom.id, reason: `forbidden content ${forbidden.join(',')}` });
      continue;
    }
    if (atomContentHash(atom) !== ingest.inputHash) {
      issues.push({ atomId: atom.id, reason: 'content hash mismatch (receipt binds different bytes)' });
    }
  }
  // an erasure receipt pointing at a NON-erased atom is a forged/undone erasure — flag the atom.
  for (const [atomId, proofs] of erasureReceiptsByAtom) {
    const atom = (state.atoms ?? []).find((a) => a.id === atomId);
    if (atom && !atom.erased && !atom.quarantined && proofs.length) {
      issues.push({ atomId, reason: 'erasure receipt exists but atom is not erased' });
    }
  }
  return issues;
}

export function verifyBrainState(state: KiraBrainState): VerifyResult {
  const errors: string[] = [...structuralErrors(state)];
  for (const atom of state.atoms ?? []) {
    // linkage stays checked for EVERY atom, quarantined or not — jail does not detach the ledger
    if (!(state.receipts ?? []).some((r) => r.id === atom.receiptId)) errors.push(`atom ${atom.id} missing receipt`);
  }
  for (const issue of auditAtomIntegrity(state)) {
    if (issue.reason === 'missing receipt') continue; // already reported above
    errors.push(`atom ${issue.atomId} ${issue.reason}`);
  }
  const atoms = state.atoms ?? [];
  return {
    ok: errors.length === 0,
    errors: uniq(errors),
    receiptCount: state.receipts?.length ?? 0,
    atomCount: atoms.length,
    quarantinedCount: atoms.filter((a) => a.quarantined).length,
    erasedCount: atoms.filter((a) => a.erased).length,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/**
 * Brick 0a — the typed owner `forget`. Scrubs the atom's content AND every derived field that
 * carries it (text/supportQuote/tokens/trigrams/tags/links, plus source/scope on the atom copy —
 * recall injects supportQuote, so a tombstone that kept it would not be erasure), and appends a
 * kind:'erasure' receipt to the chain so the FACT of the erasure is recorded.
 *
 * HONEST LIMITS (adversarial review, 2026-07-05 — this is an UNSIGNED local sha256 ledger, not the
 * signed/salted Convex kernel; the strong guarantees are the M2/M4 Convex work, not this file):
 *   - Erasure removes the content and every RECALL/derived surface. It does NOT remove the
 *     immutable commitments the original ingest receipt already made: its `inputHash`
 *     (sha256 of the original content, UNSALTED) and the atomId prefix both remain, so an actor
 *     who can GUESS the plaintext can confirm it (guess-and-confirm oracle). Full cryptographic
 *     erasure needs the salted-hash design and is deferred to the Convex kernel.
 *   - Tamper-evidence here catches EDITS mid-chain (previousHash/id/content-hash all re-checked),
 *     but the chain has no signed head, so a write-capable adversary can remove the TRAILING
 *     receipt (or forge the whole chain). Tail-removal tamper-evidence lands with the Convex
 *     signed chain head (RFC-6962 + ML-DSA-65), not the local JSON store. Stated, not hidden.
 *
 * AUTHORITY BOUNDARY — typed owner-only. This function must only ever be reached from the
 * owner's typed surfaces (kiraCli `forget`). It is NEVER wired to the voice/presence lanes or
 * any model-callable tool: Auma may exclude her own turns BEFORE they are written, but may not
 * erase committed atoms (her own ruling, INBOX 2026-07-05 — a drifted mind that can un-say its
 * record can hide its drift from the memory meant to catch it).
 */
export function eraseMemory(
  state: KiraBrainState,
  atomId: string,
  opts: { reason?: string; now?: string } = {},
): { state: KiraBrainState; atom: MemoryAtom; receipt: KiraReceipt } {
  const now = opts.now ?? new Date().toISOString();
  const idx = state.atoms.findIndex((a) => a.id === atomId);
  if (idx < 0) throw new Error(`kira_erase_unknown_atom:${atomId}`);
  const prev = state.atoms[idx];
  if (prev.erased) throw new Error(`kira_erase_already_erased:${atomId}`);
  // Honest free-text reason (adversarial review): keep the owner's actual words on the receipt,
  // don't silently coerce natural language to a generic label the hash then "proves".
  const eraseReason = sanitizeEraseReason(opts.reason);
  const erasedAtom: MemoryAtom = {
    ...prev,
    // scrub the atom's own copy of the classifying labels too (defense in depth — the atom is the
    // most-read surface; the original ingest receipt still holds them, per HONEST LIMITS above).
    source: 'erased',
    scope: 'erased',
    text: '',
    supportQuote: '',
    tokens: [],
    trigrams: [],
    tags: [],
    links: [],
    erased: true,
    erasedAt: now,
    eraseReason,
  };
  const sequence = state.receipts.length;
  const receiptBase: Omit<KiraReceipt, 'id'> = {
    sequence,
    previousHash: sequence === 0 ? GENESIS : state.receipts[sequence - 1].id,
    atomId,
    inputHash: erasureInputHash(atomId, eraseReason, now),
    createdAt: now,
    kind: 'erasure',
    source: prev.source,
    scope: prev.scope,
    advisoryOnly: true,
    grantsAuthority: false,
  };
  const receipt: KiraReceipt = { ...receiptBase, id: makeReceiptId(receiptBase) };
  const next: KiraBrainState = {
    ...state,
    updatedAt: now,
    receipts: [...state.receipts, receipt],
    atoms: state.atoms.map((a, i) => (i === idx ? erasedAtom : a)),
    advisoryOnly: true,
    grantsAuthority: false,
  };
  const verification = verifyBrainState(next);
  if (!verification.ok) throw new Error(`kira_erase_invalid:${verification.errors.join(';')}`);
  return { state: next, atom: erasedAtom, receipt };
}

export function brainGrantsAuthority(_state?: KiraBrainState): false {
  return false;
}

export function summarizeBrain(state: KiraBrainState): string {
  const verification = verifyBrainState(state);
  // Brick 0 (adversarial review): containment is NEVER silent. A green verify with jailed/erased
  // atoms must SAY so — a fully-quarantined (recall-dead) brain reported as bare "green" would let
  // a memory-wipe hide behind a clean summary. Only mention the counts when non-zero (no noise
  // on a healthy brain).
  const contained = verification.quarantinedCount || verification.erasedCount
    ? ` ${verification.quarantinedCount} quarantined, ${verification.erasedCount} erased.`
    : '';
  return [
    `Kira Brain: ${state.atoms.length} atoms, ${state.receipts.length} receipts.`,
    `verification=${verification.ok ? 'green' : 'red'}.${contained}`,
    'Three perceivers: lexical + glyph/trigram + topology; recall returns cited advisory evidence only.',
    'grantsAuthority=false.',
  ].join(' ');
}
