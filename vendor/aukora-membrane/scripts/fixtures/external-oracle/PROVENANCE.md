# External oracle vectors — provenance

| field | value |
| --- | --- |
| source | https://github.com/transparency-dev/merkle |
| path | testdata/consistency/** |
| git commit | `59b9f8f274f0de033db924e0b9f04e458f1ed255` |
| license | Apache-2.0 (upstream) |
| collected | 2026-08-10 (Grok Build external-oracle court) |

These JSON probes were **not authored by Aukora**.

Also noted but not used as closed pairs:
- RFC 6962 §2.1.3 / RFC 9162 §2.1.5 — structural tree only, no published leaf digests
- Live CT `get-sth-consistency` (e.g. Argon2026h2) — returns proof path only; older root not in response

Admission divergence experiment (duplicate keys): see SUMMARY + court notes; Rust vs Python deliberately not equalized.
