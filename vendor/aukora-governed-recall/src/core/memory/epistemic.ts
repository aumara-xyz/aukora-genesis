// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * φ — THE EPISTEMIC ENVELOPE. What an artifact is with respect to the world, and what dies with it.
 *
 * ══ FUTURE — NOTHING IN PRODUCTION CALLS THIS YET, AND THAT IS THE HONEST LABEL ══
 *
 * KIMI's sweep (issue #187) found `consent` and `provenance` carried on envelopes and read by nothing.
 * The cause is one layer up and larger than those two fields: `sealEnvelope` and `deriveEnvelope` have
 * ZERO PRODUCTION CALLERS. Measured — the only non-test references are this module's own definitions
 * and one internal call from `deriveEnvelope` to `sealEnvelope`. So every field here is written by
 * tests and read by tests, `consent` included, and consent scope is carried nowhere because nothing
 * carries anything yet.
 *
 * THE VERDICT IS **FUTURE**, NOT **DELETE**, and the distinction is the point of saying it out loud.
 * The weakening rule below is correct, tested, and is the shape a caller will need the day something
 * produces artifacts with provenance. Deleting it would cost that and save nothing. What is NOT
 * acceptable is the previous state — an unused module reading as a live guarantee, so that a later
 * reader infers consent is enforced somewhere because a field for it exists.
 *
 * It is a capability, not a claim in force. When the first production caller arrives, this block is
 * what should be deleted; `test/dead-fields-verdicts.test.ts` fails if callers appear and it does not.
 *
 * ══ A STATUS THAT CAN ONLY GET WEAKER ══
 *
 * Every artifact carries one of five words:
 *
 *     observed · reconstructed · inferred · simulated · generated
 *
 * ordered by distance from the world. The rule that makes the label worth anything is that it **can
 * only ever weaken**. A summary of a guess is a guess; a view rendered from a reconstruction is at
 * best a reconstruction; and if a model filled in what the camera never saw, every descendant is
 * `generated` forever, with no path back up the vocabulary.
 *
 * **Saving an imagined viewpoint must never make it observed.** That is the sentence this file
 * exists for, and it is enforced structurally rather than by convention: `deriveEnvelope` takes the
 * weakest of its sources as a ceiling and treats the caller's claim as a request that may only lower
 * it. There is no function here that strengthens a status, and `observed` is unreachable for anything
 * with sources — because an observation is something the world handed you, not something you computed.
 *
 * ══ AND ERASURE HAS TO CASCADE ══
 *
 * `docs/MEMORY-PORT.md` §2 warns about this directly. If a photograph is forgotten, the geometry
 * reconstructed from it, the views rendered from that geometry, the embeddings, summaries, clusters
 * and any adapter trained on it must die with it. Otherwise erasure is false the first time anything
 * derives from anything: the plaintext is gone, and a live, queryable descendant of it is still
 * sitting there answering questions about a thing the owner deleted.
 *
 * The cascade runs ONE WAY. Forgetting a rendered view must not delete the photograph it came from —
 * a cascade that ran both directions would make one careless deletion destroy the archive.
 *
 * ══ THE BOUNDARY, AND IT IS THE MOST IMPORTANT PARAGRAPH HERE ══
 *
 * `docs/MEMORY-PORT.md` §2 also says that when a derivative-producing feature arrives, the donor's
 * LEASE mechanism must come back with it "in full, not reinvented smaller". **This is not that.**
 *
 * The lease solves a different problem: making a lineage claim TRUE, by gating reads so that an
 * unregistered derivative is provably unreadable — you could not have obtained the plaintext to
 * derive from without registering that you read it. This file solves what happens once a lineage has
 * been DECLARED.
 *
 * So what is offered here is **cascading erasure over declared lineage**, and it is exactly as good
 * as the producer's honesty. A producer that reads A and declares its output derived from B still
 * leaves a live descendant of A, and nothing in this module can tell. That hole belongs to the lease,
 * it is still open, and this file must never be quoted as closing it.
 */

/** Ordered by distance from the world. Index 0 is strongest; later is weaker. */
export const STATUS_ORDER = ['observed', 'reconstructed', 'inferred', 'simulated', 'generated'] as const;
export type EpistemicStatus = (typeof STATUS_ORDER)[number];

/** Statuses that mean a model filled something in, and therefore must name which model. */
const MODEL_FILLED: readonly EpistemicStatus[] = ['inferred', 'simulated', 'generated'];

export type ConsentScope = 'owner-only' | 'private' | 'shared';

export interface Envelope {
  readonly artifactId: string;
  readonly status: EpistemicStatus;
  /** What this was derived from. Always empty when the status is `observed`; the converse is NOT enforced —
   * a sealed non-observation may declare none, and only `deriveEnvelope` requires a non-empty lineage. */
  readonly sourceIds: readonly string[];
  /** `0..1`. Required for anything that is not a direct observation. */
  readonly uncertainty: number | null;
  readonly consent: ConsentScope;
  readonly provenance: string;
  /** Which model filled in the gaps. Required for inferred/simulated/generated, refused for `observed`
   * (a camera is not a model), and OPTIONAL for `reconstructed` — which "refused otherwise" wrongly
   * claimed was refused. */
  readonly modelDigest: string | null;
  readonly at: string;
}

/**
 * Both arms carry both keys, one of them always `undefined`.
 *
 * Symmetric on purpose: a union where `reason` exists only on the failure arm forces every caller to
 * narrow before it can even READ the refusal, and a test asserting `ok === false` cannot narrow at
 * all. The result is casts at every call site — which is how a refusal ends up being inspected with
 * `as any` and its shape stops being checked at all.
 */
export type SealResult =
  | { readonly ok: true; readonly envelope: Envelope; readonly reason?: undefined }
  | { readonly ok: false; readonly reason: string; readonly envelope?: undefined };

/** The weakest (largest-index) status in a set. An empty set is `observed` — nothing weakens it. */
export function weakestStatus(statuses: readonly EpistemicStatus[]): EpistemicStatus {
  let worst = 0;
  for (const s of statuses) worst = Math.max(worst, STATUS_ORDER.indexOf(s));
  return STATUS_ORDER[worst]!;
}

/**
 * Seal an envelope, or refuse it by name.
 *
 * `observed` is the one that is checked hardest, because it is the only word here anybody has an
 * incentive to reach for: it must have no sources and no model digest. A camera is not a model, and
 * an artifact with sources is by construction not an observation.
 */
export function sealEnvelope(input: {
  artifactId: string;
  status: EpistemicStatus;
  sourceIds?: readonly string[];
  uncertainty?: number | null;
  consent: ConsentScope;
  provenance: string;
  modelDigest?: string | null;
  at: string;
}): SealResult {
  const sourceIds = [...(input.sourceIds ?? [])].sort();
  const uncertainty = input.uncertainty ?? null;
  const modelDigest = input.modelDigest ?? null;

  if (!STATUS_ORDER.includes(input.status)) return { ok: false, reason: `unknown status: ${String(input.status)}` };

  if (input.status === 'observed') {
    if (sourceIds.length) {
      return { ok: false, reason: 'observed artifacts have no sources — an artifact derived from something else is not an observation' };
    }
    if (modelDigest !== null) {
      return { ok: false, reason: 'observed artifacts carry no model digest — a camera is not a model' };
    }
  } else {
    if (typeof uncertainty !== 'number' || !(uncertainty >= 0 && uncertainty <= 1)) {
      return { ok: false, reason: `${input.status} must state an uncertainty in 0..1 — an unstated one reads as certainty` };
    }
    if (MODEL_FILLED.includes(input.status) && (typeof modelDigest !== 'string' || modelDigest.length === 0)) {
      return { ok: false, reason: `${input.status} must name the model digest that filled it in` };
    }
  }

  return {
    ok: true,
    envelope: {
      artifactId: input.artifactId,
      status: input.status,
      sourceIds,
      uncertainty,
      consent: input.consent,
      provenance: input.provenance,
      modelDigest,
      at: input.at,
    },
  };
}

/**
 * Derive a new artifact from existing ones.
 *
 * THE CEILING IS THE WEAKEST SOURCE, and `claimed` may only lower it. This is the whole enforcement:
 * there is no argument a caller can pass that makes the result stronger than what it was built from,
 * so a rendered viewpoint cannot be saved as an observation no matter how it is labelled.
 */
export function deriveEnvelope(input: {
  artifactId: string;
  from: readonly Envelope[];
  claimed: EpistemicStatus;
  uncertainty?: number | null;
  consent: ConsentScope;
  provenance: string;
  modelDigest?: string | null;
  at: string;
}): SealResult {
  if (!input.from.length) return { ok: false, reason: 'a derivative must name what it was derived from' };

  const ceiling = weakestStatus(input.from.map((e) => e.status));
  // `claimed` is a REQUEST. Take whichever of the two is weaker — admitting to less is always allowed,
  // claiming more never is.
  const status = weakestStatus([ceiling, input.claimed]);

  return sealEnvelope({
    artifactId: input.artifactId,
    status,
    sourceIds: input.from.map((e) => e.artifactId),
    uncertainty: input.uncertainty ?? null,
    consent: input.consent,
    provenance: input.provenance,
    // A model digest on a result that landed at `observed` would be refused by `sealEnvelope`, which
    // cannot happen here — a derivative always has sources — but the digest is dropped rather than
    // forced through if it ever could.
    modelDigest: status === 'observed' ? null : (input.modelDigest ?? null),
    at: input.at,
  });
}

/** Anything with `sourceIds`. Loose on purpose so a malformed record still participates in a cascade. */
interface HasLineage { readonly artifactId: string; readonly sourceIds?: readonly string[] }

/**
 * Every artifact that dies when these ids die, including the ids themselves.
 *
 * Transitive and one-directional: descendants of descendants go, ancestors never do. Bounded by the
 * visited set, so a lineage cycle — impossible with content-addressed ids, entirely possible with a
 * malformed record — terminates instead of hanging. A store an attacker can stop by writing one bad
 * line is a store with an availability bug in its erasure path.
 */
export function derivativeClosure(all: readonly HasLineage[], forgetIds: readonly string[]): Set<string> {
  const dead = new Set(forgetIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of all) {
      if (dead.has(a.artifactId)) continue;
      if ((a.sourceIds ?? []).some((s) => dead.has(s))) { dead.add(a.artifactId); grew = true; }
    }
  }
  return dead;
}

/** Split a world into what the cascade takes and what honestly survives it. */
export function cascadeForget<T extends HasLineage>(all: readonly T[], forgetIds: readonly string[]): {
  forgotten: Set<string>; surviving: T[];
} {
  const forgotten = derivativeClosure(all, forgetIds);
  return { forgotten, surviving: all.filter((a) => !forgotten.has(a.artifactId)) };
}

/**
 * Does anything left alive still point at something forgotten?
 *
 * The check that makes the claim checkable rather than asserted. Its real target is the HALF-DONE
 * deletion: someone removes the photograph and its geometry by hand and leaves the rendered view.
 * Every hash still verifies, the file is genuinely gone, and a live descendant is still answering
 * questions about it. That reads as success to every other verifier in this repository.
 */
export function auditErasure(
  surviving: readonly HasLineage[],
  forgotten: ReadonlySet<string>,
): { ok: boolean; dangling: { artifactId: string; references: string[] }[] } {
  const dangling: { artifactId: string; references: string[] }[] = [];
  for (const a of surviving) {
    const refs = (a.sourceIds ?? []).filter((s) => forgotten.has(s));
    if (refs.length) dangling.push({ artifactId: a.artifactId, references: refs });
  }
  dangling.sort((x, y) => x.artifactId.localeCompare(y.artifactId));
  return { ok: dangling.length === 0, dangling };
}

/** An envelope describes; it never permits. Constant, by construction, like every predicate here. */
export function epistemicGrantsAuthority(): false {
  return false;
}
