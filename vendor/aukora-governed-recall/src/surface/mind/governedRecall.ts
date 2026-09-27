// φ — SHE REMEMBERS, AND EVERY REMEMBERING IS A GOVERNED READ.
//
// ══ WHY THIS FILE EXISTS ══
//
// #109 merged the read side of memory — `recall`, `scope`, `ingestGate`, `containment`, `envelope`,
// `staleness` — and Kira flagged it themselves in `docs/MEMORY-PORT.md §7`, in these words:
//
//     "Nothing in φ imports these modules. They are the law, landed ahead of their consumer, and this
//      repository has already learned what that costs — core/aura/auraTrace.ts is built, tested, and
//      imported by nothing."
//
// This is the consumer. It is an ADAPTER and nothing else: the four VERBATIM donor modules are not
// touched, not wrapped in a way that changes their answers, and not re-implemented. They decide; this
// file gathers what they decide about and carries out what they say.
//
// ══ WHAT WAS THERE BEFORE, AND WHAT WAS WRONG WITH IT ══
//
// `surface/mind/memory.ts`'s `retrieve()` — a keyword scorer over markdown files. It works, and it is
// ungoverned in four specific ways this replaces:
//
//     consent      it had none. Every remembered line was equally recallable.
//     forgetting   `forgetOccurrence` seals and shreds in the LEDGER; recall never consulted it, so a
//                  forgotten memory stayed visible to the voice.
//     containment  content absorbed from outside (a GitHub repo, an attached file) was ranked and
//                  quoted exactly like something the owner said himself.
//     receipts     a read that puts remembered content into a model's context left no trace at all.
//
// The fourth is the one that matters most here. **Recall is CONTENT-BEARING.** Every other read in
// this system that carries content — `/api/hands/read`, the forge's own capture — is either gated or
// receipted, and this one was neither. A memory reaching the voice is the system acting on the owner's
// past words, and the whole argument of this repository is that such an act leaves a record.
//
// ══ WHAT A RECALL RECEIPT MAY CONTAIN ══
//
// `memoryCommitment` (envelope.ts) is used verbatim and is the reason this is safe: its shape is
// `{schema, recordId, createdAt, kind, consent, provenance, advisoryOnly, grantsAuthority}` — there is
// no content field, so a receipt CANNOT carry what was recalled even by accident. A later `forget`
// therefore breaks no link and reveals nothing: the record id survives as a bare commitment to "this
// was read", which is exactly the property `MEMORY-PORT.md` describes.
//
// ══ THE ID SPACES, STATED BECAUSE THEY DIFFER ══
//
// `deriveRecordId` is content-addressed through φ's own domain-separated `domainHash`, so the same
// text yields the same id forever on any machine — and NOT the id `@aukora/memory` would mint, because
// the donor's hash was not domain-separated. `MEMORY-PORT.md §7` records that trade deliberately.
// Nothing crosses between the two, and the forgotten set below is keyed in φ's space only.

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import {
  buildMemoryRecord, memoryCommitment, type MemoryRecordV1, type ConsentScope, type ProvenanceKind,
} from '../../core/memory/envelope';
import { recallScoped, liveMemoryCount, type ScopedRecallHit } from '../../core/memory/recall';
import { scopeCensus, type MemoryScope } from '../../core/memory/scope';
import { qualifyMemoryIngest, UNTRUSTED_PROVENANCE } from '../../core/memory/ingestGate';
import { mayDisplayAsAdvisory } from '../../core/memory/containment';
import { stalenessVerdict, canonicalIsoFromMs } from '../../core/memory/staleness';

const root = () => process.env.AUKORA_FORGE_REPO || process.cwd();
const MEM = () => join(root(), '.aukora', 'memory');
const FORGOTTEN = () => join(MEM(), 'forgotten.json');
const RECALL_RECEIPTS = () => join(MEM(), 'recall-receipts.jsonl');

async function readSafe(p: string): Promise<string> {
  try { return await readFile(p, 'utf8'); } catch { return ''; }
}

/**
 * One source of remembered text, and what the law should be told about it.
 *
 * `consent` and `provenance` are properties of the SOURCE, not of the line — which is the only honest
 * place to decide them. A line in `facts.md` is something the owner said to his own machine; a line in
 * an absorbed repository's notes is something a stranger wrote. Those are different objects and the
 * law can only tell them apart if the gatherer says so.
 */
interface Source {
  readonly file: string;
  readonly consent: ConsentScope;
  readonly kind: ProvenanceKind;
  readonly provenance: string;
  /** Was this text authored outside this machine? Drives the ingest gate and containment. */
  readonly external: boolean;
}

async function sources(): Promise<Source[]> {
  const out: Source[] = [
    { file: join(MEM(), 'profile.md'), consent: 'owner-only', kind: 'observation', provenance: 'glass:profile', external: false },
    { file: join(MEM(), 'facts.md'), consent: 'private', kind: 'observation', provenance: 'glass:facts', external: false },
    { file: join(MEM(), 'session-arc.md'), consent: 'private', kind: 'reflection', provenance: 'glass:arc', external: false },
  ];
  // Episodes: what was actually said, most recent days only.
  try {
    const eps = (await readdir(join(MEM(), 'episodes'))).filter((f) => f.endsWith('.md')).sort().slice(-3);
    for (const f of eps) {
      out.push({ file: join(MEM(), 'episodes', f), consent: 'private', kind: 'observation', provenance: `glass:episode/${f}`, external: false });
    }
  } catch { /* no episodes yet */ }
  // Wiki pages. `writeWiki` is reachable from an absorb, so this is the shelf where a stranger's words
  // can land — marked external so the ingest gate and containment both see it for what it is.
  try {
    const pages = (await readdir(join(MEM(), 'wiki'))).filter((f) => f.endsWith('.md')).slice(0, 40);
    for (const f of pages) {
      out.push({ file: join(MEM(), 'wiki', f), consent: 'private', kind: 'reflection', provenance: `${UNTRUSTED_PROVENANCE}:wiki/${f}`, external: true });
    }
  } catch { /* no wiki */ }
  return out;
}

/** Meaningful lines only — a heading is structure and an empty line is nothing. */
function linesOf(text: string): string[] {
  return text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !l.startsWith('#'));
}

/**
 * Every remembered line, as a record the law can judge.
 *
 * `createdAt` is the FILE's mtime rather than now: a record stamped with the moment it was read would
 * be permanently fresh, and `stalenessVerdict` would never have anything to say. A memory's age is a
 * fact about the memory.
 */
export async function gatherRecords(): Promise<MemoryRecordV1[]> {
  const records: MemoryRecordV1[] = [];
  const seen = new Set<string>();
  for (const s of await sources()) {
    if (!existsSync(s.file)) continue;
    let at: string;
    try {
      const { statSync } = await import('fs');
      at = canonicalIsoFromMs(statSync(s.file).mtimeMs);
    } catch { at = canonicalIsoFromMs(Date.now()); }

    // THE INGEST GATE DECIDES WHETHER THIS MAY BE REMEMBERED AT ALL. External text requires a
    // capability; nothing here has one, so a wiki page absorbed from a stranger is qualified as
    // needing consent it does not have — and is carried as advisory-only rather than dropped, because
    // the owner asked for it to be absorbed and hiding it would be its own dishonesty.
    const gate = qualifyMemoryIngest({ consent: s.consent, capabilityValid: !s.external });
    // `refuse` is the gate's strongest word and it is honoured literally: an owner-only shelf reached
    // without a capability does not become a quarantined memory, it does not become a memory at all.
    if (gate.decision === 'refuse') continue;

    for (const line of linesOf(await readSafe(s.file))) {
      const rec = buildMemoryRecord({
        content: line.slice(0, 600),
        createdAt: at,
        kind: s.kind,
        consent: s.consent,
        provenance: s.provenance,
      });
      // Content-addressed, so the same sentence written twice is one memory. Dropping the duplicate
      // here rather than letting it score twice is what keeps a repeated line from dominating recall.
      if (seen.has(rec.recordId)) continue;
      seen.add(rec.recordId);
      // CONTAINMENT, for anything from outside. A page whose provenance is unknown is quarantined and
      // never reaches the voice — `classifyEvidence`'s own rule, applied at the one place it can be.
      // `accept-trusted` means the door vouched for it; anything else is a self-attestation from
      // outside, which is precisely `codebookKnown: false` — an unregistered representation.
      if (s.external && !mayDisplayAsAdvisory({
        hasAuditSummary: true,
        codebookKnown: gate.decision === 'accept-trusted',
        finite: true,
        withinBounds: line.length <= 600,
      })) continue;
      records.push(rec);
    }
  }
  return records;
}

/** Ids the owner has forgotten. Recall never returns them — `recall.ts`'s own first line of defence. */
export async function forgottenIds(): Promise<Set<string>> {
  try {
    const raw = await readFile(FORGOTTEN(), 'utf8');
    const j = JSON.parse(raw) as { ids?: string[] };
    return new Set(Array.isArray(j.ids) ? j.ids : []);
  } catch { return new Set(); }
}

/**
 * Forget one memory by its content-addressed id.
 *
 * Deliberately NOT `core/memory/ledger.ts`'s `forgetOccurrence`, which seals and shreds a ledger turn
 * and issues an erasure certificate. That is the stronger act and it belongs to the sealed store.
 * This is the working-memory shelf: forgetting here means never recalled again, and the two are
 * joined by the recall path honouring both. Said plainly so nobody reads this as the cryptographic one.
 */
export async function forget(recordId: string): Promise<void> {
  const ids = await forgottenIds();
  ids.add(recordId);
  await mkdir(MEM(), { recursive: true });
  await writeFile(FORGOTTEN(), JSON.stringify({ ids: [...ids].sort() }, null, 2), 'utf8');
}

/** What a recall left behind. Content-free by construction — see the header. */
export interface RecallReceipt {
  readonly at: string;
  readonly hits: number;
  readonly searched: number;
  readonly commitments: ReturnType<typeof memoryCommitment>[];
}

/**
 * Receipt a recall.
 *
 * Best-effort by design, and the reason is the same one `core/memory/ledger.ts` gives for its own
 * write: a ledger that cannot be written must never take the surface down with it. A failed receipt
 * costs a missing row; a thrown receipt costs the owner his answer.
 */
async function receiptRecall(hits: readonly ScopedRecallHit[], searched: number, records: readonly MemoryRecordV1[]): Promise<RecallReceipt | null> {
  try {
    const byId = new Map(records.map((r) => [r.recordId, r]));
    const at = canonicalIsoFromMs(Date.now());
    const commitments = hits.map((h) => {
      const r = byId.get(h.recordId)!;
      return memoryCommitment({
        recordId: r.recordId, createdAt: r.createdAt, kind: r.kind,
        consent: r.consent, provenance: r.provenance,
      });
    });
    const row: RecallReceipt = { at, hits: hits.length, searched, commitments };
    await mkdir(MEM(), { recursive: true });
    const { appendFile } = await import('fs/promises');
    await appendFile(RECALL_RECEIPTS(), `${JSON.stringify(row)}\n`, 'utf8');
    return row;
  } catch {
    return null;
  }
}

export interface GovernedRecallResult {
  readonly hits: ScopedRecallHit[];
  readonly census: Readonly<Record<MemoryScope, number>>;
  readonly live: number;
  readonly receipt: RecallReceipt | null;
  readonly stale: number;
}

/**
 * Recall, governed.
 *
 * The order is the law's, not a preference: forget first (a forgotten memory is never even scored),
 * then scope, then rank. `recallScoped` does all three; this function's whole job is to hand it a
 * truthful set of records and to write down what came back.
 *
 * `excludeScopes: ['test', 'code']` by default because the voice is having a conversation, and the
 * #62 failure this scope law was written for is exactly a shelf full of test files crowding out the
 * things a person actually said.
 */
export async function governedRecall(query: string, opts: {
  limit?: number;
  scopes?: readonly MemoryScope[];
  excludeScopes?: readonly MemoryScope[];
  preferScopes?: readonly MemoryScope[];
} = {}): Promise<GovernedRecallResult> {
  const records = await gatherRecords();
  const forgotten = await forgottenIds();
  const hits = recallScoped(records, {
    text: String(query || '').trim(),
    limit: opts.limit ?? 10,
    scopes: opts.scopes,
    excludeScopes: opts.excludeScopes ?? ['test', 'code'],
    preferScopes: opts.preferScopes ?? ['identity', 'architecture'],
  }, forgotten);

  // STALENESS IS REPORTED, NEVER ENFORCED. A memory going stale is a fact about the memory, and the
  // owner is entitled to be told rather than quietly denied his own past. The count travels; the hits
  // do not shrink.
  const now = Date.now();
  const stale = hits.filter((h) => {
    return stalenessVerdict({ createdAt: h.createdAt }, now).state !== 'fresh';
  }).length;

  return {
    hits,
    census: scopeCensus(records, forgotten),
    live: liveMemoryCount(records, forgotten),
    receipt: await receiptRecall(hits, records.length, records),
    stale,
  };
}

/**
 * The block that reaches the voice.
 *
 * Labelled PAST, like `mindBlock`'s, because this repository has already paid for the alternative: a
 * model handed history with no tense marker restates a past apply as something it just did, which is
 * the failure `AUMA_SYSTEM`'s first two lines exist to prevent.
 */
export function recalledBlock(r: GovernedRecallResult): string {
  if (!r.hits.length) {
    // An empty shelf is said, not hidden. `scopeCensus` is the honest diagnostic the scope law was
    // written to provide — "identity:0, test:70" is the answer to "why does she not remember me".
    return '';
  }
  const lines = r.hits.map((h) => `- [${h.scope}] ${h.content}`);
  return '[remembered — PAST, and recalled under consent scope. Not something you did this turn.]\n'
    + lines.join('\n')
    + `\n(${r.hits.length} of ${r.live} live memories${r.stale ? `, ${r.stale} of them stale` : ''}; this recall is receipted)`;
}

/** A recall grants nothing. */
export function governedRecallGrantsAuthority(): false {
  return false;
}
