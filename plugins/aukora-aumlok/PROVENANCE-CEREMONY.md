# The ceremony ports — where every byte came from

Step 1 of the owner's private Aumlok ceremony plan (not published). Each file below is a port of an existing,
working module from a repository that had it right. The digests are of the **source** file at the commit
named, so a future reader can re-verify rather than trust this table.

| Ported into | Source | Source commit | Source sha256 |
|---|---|---|---|
| `lib/ceremony-phrase.mjs` | `~/aukora-phi/ceremony/phrase.ts` | `a099901ad5a2d623c5343263de6ae5f9994d3159` | `0198b1cb1cc94702a63a4d7b29e693773e3260518d8f42aa7817b80d6f01c1f6` |
| `lib/ceremony-verify.mjs` | `~/aukora-phi/ceremony/verify.ts` | `a099901ad5a2d623c5343263de6ae5f9994d3159` | `578d791d1678c970960f8025e58bd3d02c35fa87878368297d6b1ca1d19f464a` |
| `lib/ceremony-recovery.mjs` | `~/aukora-phi/ceremony/recovery.ts` | `a099901ad5a2d623c5343263de6ae5f9994d3159` | `67e8889f701ec29e90ad14eb90c9a7490c209a173384bd872f5e7357b396bacb` |
| `lib/custody.mjs` | `~/AUKORA-MEMBRANE/core/aumlok-custody.ts` | `d8b17faca5f17bb6e279feb30a2ea808a1f31cb8` | `6aec4352234d922249f9f2ab1df8364b417d282015bfa7cc4711b4af01f9fd3c` |
| `data/ceremony-phrase.donor.json` | `~/aukora-phi/evidence/ceremony-phrase.donor.json` | `a099901a…` | `e8070c4052d731567a7f47b4702343caad1faedf469fe3e52b49d4d1f6812217` |
| `data/aumlok-custody-vector.json` | `~/AUKORA-MEMBRANE/scripts/fixtures/aumlok-custody-vector.json` | `d8b17fac…` | `c2582d610d14e5b5088884a3146e823a830a4b00d854aef2f7e5f56d86c3511c` |

**Only `ceremony-phrase.mjs`, `ceremony-verify.mjs` and the two data files remain (corrected
2026-09-26).** `custody.mjs` and `ceremony-recovery.mjs` were ported and then deleted with the v2 core in
`866a4a0c6`, and a court (`tests/aukora-aumlok-v3-no-v2.test.mjs`) now requires them to stay absent. The
sections below about them are history.

Licence: phi and Membrane are both AGPL-3.0-or-later, as is Genesis. Upstream pins are preserved; no
dependency was added.

## What was changed, and why

**TypeScript annotations removed** in all four `.ts` ports. Nothing else. The tables in
`ceremony-phrase.mjs` are unannotated and line-anchored on purpose — phi's own header records a real
failure caused by a comment spelling out a table declaration, because two of its courts read the file as
TEXT.

**Two primitives substituted in `custody.mjs`, and the substitution is PROVEN rather than argued:**

- `@noble/curves` `ed25519.getPublicKey(seed)` → `node:crypto`, wrapping the raw 32-byte seed in the
  PKCS#8 prefix the lane already used in `binding.mjs`. For an all-zero seed it returned
  `3b6a27bc…da29`, which `node:crypto` reproduces. That is not an RFC 8032 test vector (none uses an
  all-zero seed). The module has since been deleted (`866a4a0c6`).
- `@noble/post-quantum` `ml_dsa65.keygen(seed)` → the plugin's own vendored copy at
  `lib/vendor/noble-ml-dsa/`, which is the same upstream. No behaviour change.

The port was checked against the donor's own output by `tests/aukora-aumlok-custody.test.mjs`, which
reproduced the donor-computed Ed25519 key, the 1952-byte ML-DSA-65 key and the rootId from fixed seeds
`0x01*32` / `0x02*32` (computed by Membrane on 2026-08-07), until the v2 deletion (`866a4a0c6`). No court
checks it now.

**Historical: `custody.mjs` was kept pure** (the module and its purity court were deleted with the v2
core in `866a4a0c6`). No filesystem, no HOME, no state root, no ambient randomness on a tested
path — every entropy-bearing input is injectable. A court asserts this over the module's CODE with
comments stripped, and carries a positive control so the stripper cannot pass on an emptied file.

## Verified fidelity of the phrase tables (step 1's court)

These digests were recomputed by step 1's court, which was deleted in `866a4a0c6`. The donor pin still
records them, and `ceremony-phrase.mjs` has not changed since `7238461e1`, but nothing re-checks them today:

| Digest | phi's source | this port | the donor pin |
|---|---|---|---|
| anchor block | `24b84ba3eb25721c8a60fd3276dff4e10dbbcb7ea14eeb3f642e037dac5226ed` | **identical** | `24b84ba3…` |
| word set | `61876024101745a087fb1b81f4d468794f36586c0612ca8e37ada7af82e9771e` | **identical** | `61876024…` |

The extracted word sets are identical in both directions: nothing in phi's source is missing from this
port, and nothing here was invented.

## Two findings this step surfaced, recorded rather than resolved

**1. The donor pin records a word-count drift that is phi's, not this port's.** `donorWordCount: 275`,
`ourWordCount: 274`, and the two word-set digests differ. The anchors are byte-identical
(`anchorsIdentical: true`) and `invented: []`. So this port is faithful to phi and **short by one word
against the owner's original**. The pin records the drift (275 vs 274). No court has asserted it since
the v2 deletion (`866a4a0c6`); editing the pin to agree with the port would make the discrepancy
unauditable. Resolving it needs the
donor checkout (`~/aukora-pqc-integration/core/src/aumlokPhrase.ts`), which is not present here.

**2. The documented example phrase is not producible, and must never be bound.**
`harbor → hazel amber raven birch ochre rowan` appears in phi's docstring (`phrase.ts:56`) and is quoted
in the plan. It spells the anchor, but four of its six rows draw from the wrong theme: `raven` (not in
`unite.r`), `birch` (not in `unite.b`), `ochre` (not in `rise.o`) and `rowan` (not in `rise.r`). It
illustrates the SHAPE. The court that asserted it is not generable was deleted with the v2 core
(`866a4a0c6`); a phrase printed in documentation is still a disclosed phrase.
