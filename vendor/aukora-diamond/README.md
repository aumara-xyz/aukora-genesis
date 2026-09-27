# aukora-diamond (vendored whole)

Diamond: offline cold verification of grants, receipts, mediator settlement, device pairing and composition, with explicit ceilings (Python stdlib; pynacl optional).
Source: github.com/aumara-xyz/aukora-diamond @ 0d3cc665d88a905d89f22211546ec7e445cb5c46, every path of that tree under `src/`, byte for byte. Blob ids, sha256 and modes are in `PROVENANCE.json`.
LICENSE, NOTICE.md and LICENSING.md are the upstream files (also at `src/`). AGPL-3.0-or-later.
Own tests, from this directory: `cd src && PYTHONPATH="$PWD" TMPDIR="$(mktemp -d)" ./scripts/diamond.sh` (expect `DIAMOND: GREEN`, exit 0). The rest of upstream CI is `src/.github/workflows/diamond.yml`.
`vendor/diamond-cold/` is a separate, older partial copy (cold Kira evidence consumer only) and is left untouched.

STATUS: imported byte for byte, not yet wired into Genesis.
