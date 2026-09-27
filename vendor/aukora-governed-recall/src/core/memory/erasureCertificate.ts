// φ — the erasure certificate. Ported and reduced from `@aukora/kira`'s `src/erasureCertificate.ts`
// and `src/logProof.ts` (aukora-one, `organs/kira`). See `docs/MEMORY-PORT.md` and `PROVENANCE.md`.
//
// ══ WHAT THIS IS ══
//
// A checkable receipt that a memory, and everything derived from it, was actually forgotten — not a
// claim, an artifact a stranger can check arithmetic on. It implements a REDUCED form of a five-part
// structure: a pre-erasure commitment, a target-identification proof, a removal proof, a post-erasure
// commitment, and quantified residual bounds. [Genesis edit 2026-09-27: one reference to a private
// document was removed from this comment; see ../../../PROVENANCE.json.]
//
// ══ WHAT "REDUCED" MEANS HERE, EXACTLY ══
//
// The donor's certificate also carries an RFC 6962 CONSISTENCY proof binding the pre- and post-erasure
// roots as the same history, extended — "without this the two commitments are unrelated numbers" (the
// donor's own finding, KIMI round 8). This port does not implement a Merkle consistency proof (see
// `merkle.ts`'s header for why the split rule still makes that possible to add later without migrating
// anything). `verifyErasureCertificate` below checks BOTH inclusion proofs against their own roots and
// binds `targetId`/closure to their preimages, but it does NOT independently prove that the post-state
// log extends the pre-state log — a certificate holder who wants that property must additionally hold
// the log and call `verifyChain`. That gap is named here, not hidden, and it is the one place this
// reduction is honestly weaker than its donor.
//
// A second inherited limit, stated because a reviewer of the donor found it and it is equally true
// here: a certificate checked against NO PRIOR OBSERVATION is documentation, not proof — it is
// internally consistent and cannot distinguish a real erasure from one an issuer fabricated from
// nothing. `test/memory-certificate.test.ts` keeps that case as a passing test rather than pretending
// it is impossible.

import { domainHash } from './hash';
import { computeMemoryLogRoot, nextHead, DOMAIN, type CommittedEvent } from './eventLog';
import { leafHash, rootFromLeafHashes, inclusionProof, verifyInclusion } from './merkle';
import { isReadable, keyMaterialSurvives, type ShredReport, type VaultState } from './vault';

export const ERASURE_CERTIFICATE_SCHEMA = 'aukora-phi-memory-erasure-certificate-v1' as const;
const CERTIFICATE_DOMAIN = 'aukora.phi.memory.erasure-certificate.v1';

export interface InclusionEvidence {
  readonly index: number;
  readonly size: number;
  readonly leaf: string;
  readonly proof: readonly string[];
  readonly root: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

const hexLeaf = (head: string): Buffer => leafHash(Buffer.from(head, 'hex'));

/** Prove an event sits at a given position in a log of a given size. Self-contained: leaf, proof, root. */
export function proveInclusion(events: readonly CommittedEvent[], index: number): InclusionEvidence {
  const target = events[index];
  if (target === undefined) throw new RangeError('memory-certificate:index-out-of-range');
  const leaves = events.map((c) => hexLeaf(c.head));
  return Object.freeze({
    index,
    size: events.length,
    leaf: target.head,
    proof: Object.freeze(inclusionProof(leaves, index).map((b) => b.toString('hex'))),
    root: rootFromLeafHashes(leaves).toString('hex'),
    advisoryOnly: true as const,
    grantsAuthority: false as const,
  });
}

export function checkInclusion(evidence: InclusionEvidence): boolean {
  try {
    // `evidence.leaf` is the RAW chain head (readable, and what the preimage-binding check below
    // compares against directly) — the tree itself is built from `leafHash(head)`, RFC 6962's
    // leaf/node domain separation, so that hashing happens here rather than being baked into the
    // evidence shape.
    return verifyInclusion(
      evidence.index,
      evidence.size,
      hexLeaf(evidence.leaf),
      evidence.proof.map((h) => Buffer.from(h, 'hex')),
      Buffer.from(evidence.root, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Enough to recompute a chain head, and nothing more. */
export interface EventPreimage {
  readonly previousHead: string | null;
  readonly event: unknown;
}

export interface ErasureCertificate {
  readonly schema: typeof ERASURE_CERTIFICATE_SCHEMA;

  /** 1 · pre-erasure state commitment. */
  readonly preErasureRoot: string;
  readonly preErasureCount: number;

  /** 2 · target identification proof, and the preimage that binds `targetId` to the leaf it names. */
  readonly targetId: string;
  readonly targetInclusion: InclusionEvidence;
  readonly targetPreimage: EventPreimage;

  /** 3 · removal proof: exactly what was destroyed, and what was not. */
  readonly closure: readonly string[];
  readonly shredded: readonly string[];
  readonly alreadyGone: readonly string[];
  readonly destroyFailed: readonly string[];
  readonly ciphertextRetained: readonly string[];

  /** 4 · post-erasure state commitment. */
  readonly postErasureRoot: string;
  readonly postErasureCount: number;
  readonly tombstoneInclusion: InclusionEvidence;
  readonly tombstonePreimage: EventPreimage;

  /** 5 · completeness, quantified — two different questions, answered by two different authorities. */
  readonly residualReadable: number;
  readonly residualKeys: number;
  readonly complete: boolean;

  readonly certificateDigest: string;
  readonly at: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

function digestOf(body: Omit<ErasureCertificate, 'certificateDigest' | 'advisoryOnly' | 'grantsAuthority'>): string {
  return domainHash(CERTIFICATE_DOMAIN, body);
}

/**
 * Issue a certificate for an erasure that has already happened. `before` is the log immediately prior
 * to the tombstone; `after` includes it. Requiring both is the point — a certificate cannot be produced
 * from the end state alone, because then there would be nothing to compare it against.
 */
export function issueErasureCertificate(input: {
  before: readonly CommittedEvent[];
  after: readonly CommittedEvent[];
  targetIndex: number;
  tombstoneIndex: number;
  report: ShredReport;
  vault: VaultState;
  at: string;
}): ErasureCertificate {
  const { before, after, targetIndex, tombstoneIndex, report, vault, at } = input;

  if (after.length <= before.length) throw new RangeError('memory-certificate:log-did-not-grow');
  const beforeTarget = before[targetIndex];
  const afterTombstone = after[tombstoneIndex];
  if (beforeTarget === undefined) throw new RangeError('memory-certificate:target-index-out-of-range');
  if (afterTombstone === undefined || afterTombstone.event.kind !== 'tombstone') {
    throw new RangeError('memory-certificate:tombstone-index-invalid');
  }

  const tombstone = afterTombstone.event;
  const closure = [tombstone.target, ...tombstone.erased].sort();

  // Computed, not taken from the report — the report is the deleting process's own account of itself.
  const residualReadable = closure.filter((id) => isReadable(vault, after, id)).length;
  const residualKeys = closure.filter((id) => keyMaterialSurvives(vault, after, id)).length;

  const body = {
    schema: ERASURE_CERTIFICATE_SCHEMA,
    preErasureRoot: computeMemoryLogRoot(before),
    preErasureCount: before.length,
    targetId: tombstone.target,
    targetInclusion: proveInclusion(before, targetIndex),
    targetPreimage: {
      previousHead: targetIndex === 0 ? null : (before[targetIndex - 1] as CommittedEvent).head,
      event: beforeTarget.event as unknown,
    },
    closure: Object.freeze(closure),
    shredded: report.shredded,
    alreadyGone: report.alreadyGone,
    destroyFailed: report.destroyFailed,
    ciphertextRetained: report.ciphertextRetained,
    postErasureRoot: computeMemoryLogRoot(after),
    postErasureCount: after.length,
    tombstoneInclusion: proveInclusion(after, tombstoneIndex),
    tombstonePreimage: {
      previousHead: tombstoneIndex === 0 ? null : (after[tombstoneIndex - 1] as CommittedEvent).head,
      event: afterTombstone.event as unknown,
    },
    residualReadable,
    residualKeys,
    complete: residualReadable === 0 && residualKeys === 0 && report.destroyFailed.length === 0,
    at,
  } as const;

  return Object.freeze({
    ...body,
    certificateDigest: digestOf(body),
    advisoryOnly: true as const,
    grantsAuthority: false as const,
  });
}

export type CertificateFinding =
  | 'certificate:schema-unknown'
  | 'certificate:digest-mismatch'
  | 'certificate:target-preimage-mismatch'
  | 'certificate:target-id-not-in-preimage'
  | 'certificate:tombstone-preimage-mismatch'
  | 'certificate:tombstone-names-another-target'
  | 'certificate:closure-not-as-recorded'
  | 'certificate:target-inclusion-invalid'
  | 'certificate:tombstone-inclusion-invalid'
  | 'certificate:pre-root-mismatch'
  | 'certificate:post-root-mismatch'
  | 'certificate:log-did-not-grow'
  | 'certificate:closure-not-covered'
  | 'certificate:residual-readable'
  | 'certificate:residual-key-material'
  | 'certificate:erasure-incomplete'
  | 'certificate:completeness-contradicted'
  // KIMI's sweep, issue #187: the containment literals were STRIPPED before the digest and then never
  // checked, while `core/aura/auraTrace.ts:206-207` refuses on exactly the same two literals and
  // `core/memory/envelope.ts` carries them under the same claim. Enforced in two modules and decorative
  // in the third is not a policy; it is a coincidence that reads like one.
  | 'certificate:advisory-literal-missing'
  | 'certificate:authority-literal-present'
  // The identical bug, one nesting level down: `InclusionEvidence` (targetInclusion, tombstoneInclusion)
  // carries its own copy of the same two literals, written by `proveInclusion`, folded into the digest —
  // and `checkInclusion` verifies only index/size/leaf/proof/root, never these. The sweep that closed the
  // outer pair above left its own nested copy open.
  | 'certificate:target-inclusion-advisory-literal-missing'
  | 'certificate:target-inclusion-authority-literal-present'
  | 'certificate:tombstone-inclusion-advisory-literal-missing'
  | 'certificate:tombstone-inclusion-authority-literal-present'
  // And the retained ciphertext: recorded, digested, and left out of every completeness question below.
  | 'certificate:ciphertext-retained-unaccounted';

export interface CertificateVerdict {
  readonly valid: boolean;
  readonly complete: boolean;
  readonly findings: readonly CertificateFinding[];
  /** Named so a reader cannot infer more than this certificate proves — see the module header. */
  readonly extensionProved: false;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

/**
 * Verify a certificate with the certificate ALONE — no log, no vault, no keys, no ciphertext. `valid`
 * and `complete` are deliberately separate: a certificate can be perfectly valid while honestly
 * certifying that the erasure did not complete.
 */
export function verifyErasureCertificate(cert: ErasureCertificate): CertificateVerdict {
  const findings: CertificateFinding[] = [];

  if (cert.schema !== ERASURE_CERTIFICATE_SCHEMA) findings.push('certificate:schema-unknown');

  const { certificateDigest, advisoryOnly: _a, grantsAuthority: _g, ...body } =
    cert as ErasureCertificate & Record<string, unknown>;
  if (digestOf(body as never) !== certificateDigest) findings.push('certificate:digest-mismatch');

  // ── THE CONTAINMENT LITERALS ARE CHECKED, NOT MERELY DECLARED ────────────────────────────────
  //
  // They are outside the digest ON PURPOSE — they are this module's claim about itself rather than
  // evidence about the erasure, so a certificate must not be able to "prove" them by having been
  // hashed with them. That is exactly why they need checking HERE: outside the digest and outside the
  // verifier, they were a claim nothing could falsify. `auraTrace.ts` refuses on the same two.
  if (cert.advisoryOnly !== true) findings.push('certificate:advisory-literal-missing');
  if (cert.grantsAuthority !== false) findings.push('certificate:authority-literal-present');

  // ── THE SAME TWO LITERALS, ONE LEVEL DOWN ────────────────────────────────────────────────────
  //
  // `targetInclusion`/`tombstoneInclusion` each carry their own `advisoryOnly`/`grantsAuthority` — the
  // exact fields just checked above, duplicated by `proveInclusion` into every `InclusionEvidence`. They
  // ride inside the digest exactly like the outer pair, so the same reasoning applies: checked here or
  // not checked at all.
  if (cert.targetInclusion.advisoryOnly !== true) findings.push('certificate:target-inclusion-advisory-literal-missing');
  if (cert.targetInclusion.grantsAuthority !== false) findings.push('certificate:target-inclusion-authority-literal-present');
  if (cert.tombstoneInclusion.advisoryOnly !== true) findings.push('certificate:tombstone-inclusion-advisory-literal-missing');
  if (cert.tombstoneInclusion.grantsAuthority !== false) findings.push('certificate:tombstone-inclusion-authority-literal-present');

  const leafOf = (p: EventPreimage): string =>
    nextHead(p.previousHead, domainHash(DOMAIN.event, p.event));

  const idIn = (e: unknown): string | null => {
    const v = e as { occurrenceId?: unknown };
    return typeof v.occurrenceId === 'string' ? v.occurrenceId : null;
  };

  if (leafOf(cert.targetPreimage) !== cert.targetInclusion.leaf) {
    findings.push('certificate:target-preimage-mismatch');
  } else if (idIn(cert.targetPreimage.event) !== cert.targetId) {
    findings.push('certificate:target-id-not-in-preimage');
  }

  if (leafOf(cert.tombstonePreimage) !== cert.tombstoneInclusion.leaf) {
    findings.push('certificate:tombstone-preimage-mismatch');
  } else {
    const t = cert.tombstonePreimage.event as { kind?: unknown; target?: unknown; erased?: unknown };
    if (t.kind !== 'tombstone' || t.target !== cert.targetId) {
      findings.push('certificate:tombstone-names-another-target');
    }
    const recorded = [cert.targetId, ...(Array.isArray(t.erased) ? (t.erased as string[]) : [])].sort();
    if (JSON.stringify(recorded) !== JSON.stringify([...cert.closure].sort())) {
      findings.push('certificate:closure-not-as-recorded');
    }
  }

  if (!checkInclusion(cert.targetInclusion)) findings.push('certificate:target-inclusion-invalid');
  if (!checkInclusion(cert.tombstoneInclusion)) findings.push('certificate:tombstone-inclusion-invalid');
  if (cert.targetInclusion.root !== cert.preErasureRoot) findings.push('certificate:pre-root-mismatch');
  if (cert.tombstoneInclusion.root !== cert.postErasureRoot) findings.push('certificate:post-root-mismatch');
  if (cert.targetInclusion.size !== cert.preErasureCount) findings.push('certificate:pre-root-mismatch');
  if (cert.tombstoneInclusion.size !== cert.postErasureCount) findings.push('certificate:post-root-mismatch');
  if (cert.postErasureCount <= cert.preErasureCount) findings.push('certificate:log-did-not-grow');

  const accounted = new Set([...cert.shredded, ...cert.alreadyGone, ...cert.destroyFailed]);
  if (cert.closure.some((id) => !accounted.has(id))) findings.push('certificate:closure-not-covered');

  if (cert.residualReadable > 0) findings.push('certificate:residual-readable');
  if (cert.residualKeys > 0) findings.push('certificate:residual-key-material');
  if (cert.destroyFailed.length > 0) findings.push('certificate:erasure-incomplete');

  // ── CIPHERTEXT THAT SURVIVED THE ERASURE IS A COMPLETENESS FACT ──────────────────────────────
  //
  // `ciphertextRetained` was recorded by `vault.ts`, carried into the certificate, folded into the
  // digest — and then read by nothing. `accounted` above is shredded + alreadyGone + destroyFailed, so
  // a blob whose ciphertext is still on disk after an "erasure" was certified without comment.
  //
  // It is deliberately NOT `valid: false`. A certificate that honestly records retained ciphertext is a
  // correct certificate about an incomplete erasure — the module header already draws that line for
  // `destroyFailed`, and this is the same kind of fact. What it must not do is pass silently.
  const retained = cert.ciphertextRetained?.length ?? 0;
  if (retained > 0) findings.push('certificate:ciphertext-retained-unaccounted');

  if (cert.complete && (cert.residualReadable > 0 || cert.residualKeys > 0
    || cert.destroyFailed.length > 0 || retained > 0)) {
    findings.push('certificate:completeness-contradicted');
  }

  const completenessOnly = new Set<CertificateFinding>([
    'certificate:residual-readable', 'certificate:residual-key-material', 'certificate:erasure-incomplete',
    'certificate:ciphertext-retained-unaccounted',
  ]);
  const structural = findings.filter((f) => !completenessOnly.has(f));

  return Object.freeze({
    valid: structural.length === 0,
    complete: findings.length === 0 && cert.complete,
    findings: Object.freeze(findings),
    extensionProved: false as const,
    advisoryOnly: true as const,
    grantsAuthority: false as const,
  });
}

/** HARD: a certificate is evidence, never permission. Constant, by construction. */
export function erasureCertificateGrantsAuthority(): false {
  return false;
}
