# crypto-spine LIMITS (AUMLOK-SPINE-UNBLOCK-v0)

## What this brick did

| Item | Status |
| --- | --- |
| Search `aukora-phi` + membrane for `registry.js` / `errors.js` / `registries` | **Not found** (no donor file on this machine) |
| Local `registry.ts` + `errors.ts` | **Added** — smallest surface so `authority.ts` / `schema.ts` import-resolve |
| `@aukora/kernel/*` imports in hybrid-keygen / hybrid-signer / aumlok-gate | **Rewired** to local `./authority.js` and `./registry.js` |

## What this is NOT

- **Not** `@aukora/kernel` parity. No claim that `KERNEL_SCHEMAS`, `RINGS`, or `PURPOSE_DOMAINS.receiptHead` match aukora-one byte-for-byte.
- **Not** a completed AUMLOK ceremony / bind.
- **Not** forge-accept wiring; **not** `identityBound: true`.
- **Not** a substitute for installing the real kernel package when it becomes available.

## Documented vs guessed constants

| Constant | Source |
| --- | --- |
| `PURPOSE_DOMAINS.aumlokPromotion` = `aumlok-promotion-v2` | hybrid-signer comment + `docs/swarm/patches/integr-I3/RECONCILIATION.md` |
| `PURPOSE_DOMAINS.receiptHead` = `aukora-membrane-receipt-v1` | RECONCILIATION “membrane receipt domain” naming (local fill) |
| `KERNEL_SCHEMAS.*` = `local-kernel-*-v0` | **Local only** — so real kernel docs cannot be mistaken for these |
| `RINGS` = `0 \| 1 \| 2` | **Local only** — donor list absent |

## Residual honesty

When the real `kernel/src/registry.ts` (or package) is available, replace this stub and delete the “local-kernel-*-v0” names. Until then, anything that validates against these schema strings is validating the **local** ladder, not the kernel’s.
