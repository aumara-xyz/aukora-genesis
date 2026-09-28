# ARCHIVE — what was removed on 2026-09-27, and where it still lives

On 2026-09-27 this tree was cut down to what the running app, its release path and its cold checks use.
**Nothing was deleted from history.** The history up to 2026-09-27, with every removed file, is kept in
aumara-xyz/aukora-genesis-archive (private archive, not a link), read-only and private. Work continues on `main` of `aumara-xyz/aukora-genesis`,
whose history starts clean. In the archive, every removed file is still in git at commit **`5c8508b7f`**, the parent
of the cut commit `4d603f8dd` that removed it.

## Before and after

| | tracked files | size |
| --- | --- | --- |
| before (`5c8508b7f`) | 2,848 | 78.0 MB |
| removed | 1,609 | 34.2 MB |
| after (`4d603f8dd`) | 1,240 | 43.8 MB |

(The one added file is this page.)

## Removed, by category

| category | files | size |
| --- | --- | --- |
| Lane coordination: notes, orders, reports, skills and the relay (`.agents/`) | 370 | 12.90 MB |
| Test forest (`tests/`, all but the 22 files that stayed) | 606 | 10.04 MB |
| Court runners, the court registry, logged court evidence and the Docker courts (`courts/`) | 29 | 0.83 MB |
| CI, push-stamp and court tooling: `.github/`, `.githooks/`, `scripts/ci/`, `scripts/aukora-courts.sh`, `scripts/courts-for.sh`, `scripts/nightly-preflight.sh`, `scripts/mutation/`, `scripts/verify-clean.sh`, the `*-test.py` and `*-selftest` scripts, four court helpers in `scripts/lib/`, `plugins/aukora-composition-gate/test/`, and four court scripts in `scripts/kira/` and `scripts/aura/` | 66 | 1.45 MB |
| Experiments: the Laya GPU spend gate, its runbooks and vectors (`experiments/`) | 94 | 3.16 MB |
| Internal documents: status pages, claim ledgers, plans and reviews (`docs/` except the five kept, `proposals/`, `GENESIS-PLAN.md`, `START-HERE.md`) | 48 | 0.69 MB |
| Dead code: the unmounted spatial client (`plugins/aukora-spatial/`) and the never-built `runtime` and `council` faces (`plugins/aukora-face/runtime/`, `plugins/aukora-face/council/`) | 302 | 3.89 MB |
| Scripted demos (`scripts/demo/`, `scripts/show-stopper-demo.sh`, `plugins/aukora-aumlok/demo/`, `plugins/aukora-kira/demo/`) | 20 | 0.22 MB |
| Dev probes, diagnostics and superseded tools: probes in `scripts/aukora/`, `scripts/{eye,face,chain,promotion}/`, `scripts/upgrade-release.py` and other one-off scripts, and spikes and rehearsals in `scripts/aumlok/` | 73 | 0.98 MB |
| A stale snapshot of a local desktop config (`apps/aukora-desktop/config.json.next`) | 1 | 0.01 MB |
| **total** | **1,609** | **34.18 MB** |

## What stayed, and why

A file stayed if the running app, the release materializer, the cutover, the two live commands
(`scripts/aukora/remember.mjs`, `scripts/aukora/self-change.mjs`) or a cold check reads, imports or spawns
it, and also wherever the two reviews of this cut disagreed. The checks that run from a clone are
`sh scripts/check.sh`, the README's reviewer packet; `docs/CLAIMS.md` lists thirteen of them with their limits.

Kept on purpose although they are not on the live path:

- `tests/aukora-owner-{protocol,ingress,authority}.test.mjs` and their three helpers, because
  `scripts/owner/setup-owner.sh` runs them and refuses to install the owner cut without them.
- The whole stock-app vendor tree under `plugins/aukora-face/apps/vendor/` (401 files, 28.8 MB, two thirds of
  the tree's size right after the cut; the Luminara documents alone are 19.6 MB). Luminara is served as a stock
  app, and trimming it means regenerating its `manifest.json`, rebuilding the faces and a boot smoke.
- The word-list tools in `scripts/aumlok/`, and
  `scripts/aukora-relay.mjs`, which a local launchd job runs.

## Changed with the cut, so the tree stays true

- `README.md`, `SECURITY.md`, `AGENTS.md`, `NOTICE` and `docs/CLAIMS.md` were rewritten or edited to cite
  only what is in the tree. `README.md` keeps its `## Reviewer packet` section and `docs/CLAIMS.md` keeps its
  table format, because Auma Live's claims lens reads both.
- `scripts/artifacts-coverage.json` no longer names five removed suites as coverage patterns.
- `scripts/aukora/advance-main.mjs` and `plugins/aukora-aumlok/lib/main-advance-proposal.mjs` no longer tell
  a person to run the removed court runner or dispatch the removed CI workflow. Their gate-path lists still
  name `.github/workflows/b1.yml`, `scripts/aukora-courts.sh` and `tests/GREEN-ONLY.txt`, so that bringing
  one back is still a gate change.
- `scripts/build-face.py` no longer lists the two removed faces as deferred.
- `.gitignore` ignores `/.agents/`, `/courts/` and `/experiments/`, because lanes and local tools may still
  write there in a working checkout.
- Comments that named the owner's home directory were changed to say `$HOME` or "the owner's home directory".
  Later additions name it again: `scripts/aura/echo-head.mjs` and several byte-for-byte vendored files.

## Still citing archived paths

In-plugin READMEs, `PROVENANCE` files, the research paper and its evidence map, and many code comments still
name archived suites, courts and documents as the evidence behind a statement, usually with the date and
commit it was measured at. Those citations are historical: they resolve at `5c8508b7f` in the private archive. The paper and the
evidence map say so at the top.
