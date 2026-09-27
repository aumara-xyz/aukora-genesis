// φ · ceremony/genesis.ts — the public genesis packet
//
// ══ TRANSPLANTED FROM aukora-one/ui/ceremony/genesis.mjs ══
//
// Which was a mechanical port of the owner's `core/src/aumlokGenesisAura.ts`. In the donor this is the
// seed the AURA draws itself from, and the donor's header records why it had to exist: his page reads
// `g.packet.genesisRef` and `g.base.rings`, an earlier `/api/bind/genesis` returned a flat
// `{ genesisRef }`, so `startBirth()` took its honest early return every time and the ceremony ended on
// a static trefoil instead of the figure unfolding. A shape mismatch, nothing more.
//
// ══ WHAT IS TRUE ABOUT IT HERE, WHICH IS LESS THAN IT WAS THERE ══
//
// φ has no AURA renderer and no ceremony page. `genesisAuraParams()` returns three rings that NOTHING
// IN THIS REPOSITORY DRAWS. That is stated rather than implied, because "the AURA unfolds" is exactly
// the kind of sentence that gets written in the present tense about a capability that is one asset
// bundle short of existing.
//
// What it IS here: a deterministic, content-free public echo of a completed vow, with tests. The
// ceremony emits it on `/api/bind/genesis`, the shapes are the owner's, and when φ grows a surface that
// can draw the figure, the data is already the right shape and already proven.
//
// ══ WHY THE REF IS DERIVED AND NOT INVENTED ══
//
// From two rotation-stable PUBLIC facts and nothing else: the root id and the instant of binding. So it
// is deterministic forever for a given vow — the same node redraws the identical figure on every load,
// for the rest of its life, and a later rotation lays a ripple OVER that figure without replacing it.
//
// It is also content-free. It carries no date a reader can parse, no counter, no person-derived number.
// The binding FACT lives in the receipt; this is the visible echo, and an echo that leaked the thing it
// echoes would be a different and much worse object.
//
// ══ ONE NAME CHANGED MEANING, AND THE FIELD DID NOT ══
//
// In aukora-one `rootId` is the id of an Ed25519 + ML-DSA-65 owner root. φ mints no keys (see `vow.ts`),
// so what is passed here is the VOW id. The field keeps the donor's name deliberately: the domain string
// `aumlok-genesis-aura-ref:` is the owner's verbatim and the derivation must stay byte-compatible with
// his, so a φ vow and an aukora-one binding produce the same echo from the same inputs. Renaming the
// field would have been cosmetic honesty bought with real interoperability.

import { createHash } from 'node:crypto';

export const GENESIS_AURA_SCHEMA = 'aumlok-genesis-aura-v1';

export interface GenesisPacket {
  schema: typeof GENESIS_AURA_SCHEMA;
  /** In φ, the vow id. See the header — the donor's field name is kept for derivation compatibility. */
  rootId: string;
  genesisRef: string;
  boundAt: string;
}

export interface GenesisRing { radius: number; phase: number; weight: number }

/**
 * The genesis reference. 24 hex characters, from `rootId` and `boundAt`.
 *
 * The domain string is his, verbatim, and it matters: it is deliberately distinct from the transient
 * echo's domain so the two families can never collide or be mistaken for one another.
 */
export function deriveGenesisRef({ rootId, boundAt }: { rootId: string; boundAt: string }): string {
  return createHash('sha256')
    .update(`aumlok-genesis-aura-ref:${rootId}|${boundAt}`)
    .digest('hex').slice(0, 24);
}

/** The standing packet. Closed field set — his validator refuses unknown keys. */
export function buildGenesisPacket(
  { rootId, boundAt }: { rootId?: unknown; boundAt?: unknown },
): { ok: true; packet: GenesisPacket } | { ok: false; reason: string } {
  if (typeof rootId !== 'string' || rootId.length === 0) return { ok: false, reason: 'rootId' };
  if (typeof boundAt !== 'string' || boundAt.length === 0) return { ok: false, reason: 'boundAt' };
  return {
    ok: true,
    packet: {
      schema: GENESIS_AURA_SCHEMA,
      rootId,
      genesisRef: deriveGenesisRef({ rootId, boundAt }),
      boundAt,
    },
  };
}

/**
 * The three standing rings a shell would render as the silver base.
 *
 * Bounded [0,1) and fully determined by the packet, so the base is display and evidence — never a
 * channel. Nothing here is random at draw time. Nothing in φ draws it yet; see the header.
 */
export function genesisAuraParams(packet: GenesisPacket): { state: 'silver'; rings: GenesisRing[] } {
  const seed = createHash('sha256')
    .update(`genesis-aura-base:${packet.rootId}|${packet.genesisRef}`)
    .digest();
  const unit = (i: number): number => seed.readUInt16BE(i * 2) / 0x10000;
  return {
    state: 'silver',
    rings: [0, 1, 2].map((i) => ({ radius: unit(i * 3), phase: unit(i * 3 + 1), weight: unit(i * 3 + 2) })),
  };
}

/** The one visible caption. Named state plus a content-free reference. */
export function genesisAuraCaption(packet: GenesisPacket): string {
  return `silver · genesis ${packet.genesisRef.slice(0, 12)}`;
}

/** The whole `/api/bind/genesis` body, in the shape his page reads. */
export function genesisResponse({ rootId, boundAt }: { rootId?: unknown; boundAt?: unknown } = {}) {
  const built = buildGenesisPacket({ rootId, boundAt });
  if (!built.ok) return { ok: true as const, present: false as const };
  return {
    ok: true as const,
    present: true as const,
    packet: built.packet,
    base: genesisAuraParams(built.packet),
    caption: genesisAuraCaption(built.packet),
    grantsAuthority: false,
  };
}

/** A public echo grants nothing. It is a picture of a fact, not the fact. */
export function genesisGrantsAuthority(): boolean {
  return false;
}
