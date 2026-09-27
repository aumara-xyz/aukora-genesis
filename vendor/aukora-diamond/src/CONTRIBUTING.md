# Contributing to AUKORA Diamond

Diamond's primary deliverable is a cold verifier with reproducible, bounded claims.
Read [SECURITY.md](SECURITY.md) and the [profile guides](docs/README.md) first.

## Make a focused change

1. Identify the artifact profile and the invariant you are changing. Keep producer
   execution, guest runtimes and agent orchestration outside the cold consumer.
2. Use synthetic or reviewed public fixtures. Never commit credentials, private
   operator records, real signing keys, generated output or a local environment.
3. Add a positive case and a negative control. A failed check must return nonzero;
   missing mandatory inputs must not become skipped success.
4. Run the relevant local acceptance command, inspect the diff, and record the
   exact commit, command, exit and remaining limits in the pull request.
5. Batch related local fixes before pushing. Do not manually rerun unchanged CI.
   Wait for checks on the exact candidate before merging; do not assume GitHub
   auto-merge enforces a repository gate that has not been configured.

The core regression command is `bash scripts/diamond.sh`. Imported Alpha changes
also require `python3 -B scripts/verify-cold-distillation.py`. Additional profile
commands are listed in the [workflow](.github/workflows/diamond.yml).

## Preserve the contract

- Public keys and retained observations are supplied independently by the caller.
- Artifact kind and canonicalization are explicit; profiles are not interchangeable.
- A valid receipt never becomes authorization, attendance or proof of execution.
- Preserve upstream notices and pins. Document an adaptation rather than silently
  editing a frozen historical source or recalculating a pin to hide drift.
- Source-budget changes need a reviewed reason and a measured byte/line delta.
- Generated tests are not production transactions. Keep their status visible.

Report sensitive security findings using an agreed private channel with the
maintainer; do not put secrets or operational details in a public issue. Ordinary
bug reports should include the revision and a minimal non-sensitive description.

## Licensing

Contribute only material you have permission to contribute. Diamond-owned changes
use [AGPL-3.0-or-later](LICENSE); read [LICENSING.md](LICENSING.md) for the explicit
Alpha grant and preserved historical notices. This document does not change any existing grant or notice.
