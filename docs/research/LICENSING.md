# Licensing

This repository contains two bodies of work under two different licenses. The boundary is
deliberate and is stated here so that neither is misread as the other.

## AUKORA — GNU Affero General Public License v3.0 or later

Copyright (c) 2026 Peter Michael Viviani

The AUKORA authority and evidence layer is licensed under **AGPL-3.0-or-later**. The full text is
in [`LICENSE`](LICENSE). This covers the original work of the copyright holder, including:

| Path | Contents |
| --- | --- |
| `aukora/` | authority, identity, guest cell, record, broker, issuer, verifier, supervisor, approval, activation, aura, kernel-seed, kira, host-dsh, parent-launch |
| `packages/governed/` | the governed tool integrations |
| `courts/` | executable adversarial observations and the enrolled-breach gate |
| `demos/aukora-seed/` | the seed, the oracle, and the conformance material |
| `profiles/8088-inside-out/` | the governed composition under test |
| `provenance/`, `docs/`, `references/` | as marked |

**Section 13 applies.** Where a modified version of this work is made available to users over a
network, the corresponding source of that modified version must be offered to those users.

A separate commercial license is available from the copyright holder for parties who do not wish
to accept the terms above. Contact the copyright holder.

## DeepSeek Harness and the vendored Cordis framework — MIT

Copyright (c) 2026 DeepSeek, and the respective upstream authors.

The inherited harness — `apps/`, `packages/` other than `packages/governed/`, `vendor/`, `native/`,
`python/`, `website/`, and the build and configuration files supporting them — remains under the
**MIT License**, whose text and copyright notice are preserved verbatim in
[`LICENSE.MIT`](LICENSE.MIT). Nothing in this repository alters those terms, and the MIT notice must
be retained in all copies and substantial portions of that work.

Vendored upstream projects each preserve their own `LICENSE` file in their own directory. Exact
upstream commits and local modifications are recorded in [`vendor/README.md`](vendor/README.md).
Third-party dependency licensing is recorded in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## How the two combine

The MIT License permits sublicensing, so a combined or derivative work may be distributed under the
AGPL. Doing so does not remove the MIT grant from the MIT-licensed portions: a recipient may still
extract and use those portions under MIT, and their copyright notice travels with them.

Whether a given file is part of the AGPL-licensed work or the MIT-licensed work is determined by the
table above and by any per-file or per-directory notice, which governs over this summary.

## Open question, recorded rather than answered

Whether the AUKORA authority layer and the harness it governs constitute a single work or separable
works — and therefore how far AGPL §5 reaches across the boundary above — is a legal question and is
not resolved by this file. It is recorded here so that a reader is not left with the impression that
the question has been decided.
