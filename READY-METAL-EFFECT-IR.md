# Effect IR v0 — raise-ready pack

Not enforced: same-UID agents, a software approval key, no server-side check on main. This branch is a mirror. Do not merge it. The land is a later self-change card, after the installed shell's shown limit can hold the card.

Not verified in Peter's installed app. No AUKORA popup was raised here. Live Electron may lag `origin/main`.

## Inventory

`origin/main` at `289d2ce` has no `plugins/aukora-effect-ir` and no `tests/effect-ir*`. A search of that tree outside `vendor/` finds no `effect-ir`.

Live tool decisions still go, file by file:

1. `plugins/aukora-action-gate/lib/index.mjs` `createGuard`
2. `plugins/aukora-action-gate/lib/policy.mjs` `classify`
3. `plugins/aukora-action-gate/lib/kernel.mjs` `decideCall`
4. `vendor/authority/lib/reducer.js` `decide`

Live membrane observation is `scripts/aukora/become.mjs` `membraneObservation`, then `membraneRefusal`. Court `tests/effect-ir.test.mjs` reads both files and asserts they do not mention `aukora-effect-ir`.

PR #4 (`cursor/effect-ir-v0-5253`, commit `88ee455`, base `847e0a2`) added one unmounted module and one court:

| path | bytes |
|---|---|
| `plugins/aukora-effect-ir/lib/ir.mjs` | 8272 |
| `tests/effect-ir.test.mjs` | 9761 |
| `scripts/check.sh` | one `check` line |

That metal parses a closed effect and asks the vendored kernel with an empty allow-rule list. Laya is refused before the kernel (`laya:never-allow`). Aura other than `map` is refused. Staged `compute.job` is refused. It does not check see = sign = execute. It does not model Laya as monotonic STOP/ASK. It does not read a membrane observation. The PR text counted the raw diffs at 8,673 and 10,177 characters, and the three paths together over the 11,800-character card. The 1,650-character card cannot hold the module or the court.

This branch keeps that refuse-by-default behavior, splits it, and adds the three missing stubs. Nothing here is mounted. `become.mjs`, Approve paths, and `plugins/aukora-kira` recall / `tools.mjs` are not edited.

## Shown budget

`scripts/aukora/shown-limit.mjs` returns `min(11800, installed - 150, treeLimit - 150)`. With no `state/home/become/shell-limit`, the installed shell is taken to be 1,800, so the script allows 1,650. This tree's `WITNESS_DISPLAY_LIMIT` is 12,000, which would allow 11,800. These cards are counted for that 11,800 window. They do not fit 1,650. Do not raise them until the installed shell records 12,000.

Counts below are the operation text `candidateOperation` would print: the why used in the preview line, the precard summary line, candidate, base, tree, paths, one binding line per path, then `git diff --full-index` of each new file, plus one added `check` line in `scripts/check.sh`. Not measured through the installed signer.

| card | operation characters | under 11,800 |
|---|---:|---|
| 1 parse | 9663 | yes |
| 2 Laya | 4465 | yes |
| 3 membrane | 6985 | yes |
| 4 see = sign = execute | 4553 | yes |
| 5 composer | 10955 | yes |
| 6 failing arms | 6603 | yes |

`READY-METAL-EFFECT-IR.md` is not a card. All twelve paths below classify as `fence:ok` (`classifyPath` in `vendor/aukora-seed-app/lib/apps/seed/src/pathFence.js`). So does this file. Do not put this file on a card.

## Precard

`scripts/aukora/self-change.mjs` calls `precardCheck` in `scripts/aukora/precard-check.mjs` before any popup. That function runs:

```sh
sh scripts/check.sh
```

on an isolated archive of the candidate tree. A TOTAL line that is missing, malformed, or short of all-passed refuses the card. Run the same script in the worktree before the preview. It checks the repository, not the installed app.

On this VM (Node v22.14.0) the six new rows passed, and the packet did not:

```
PASS  node tests/effect-ir-parse.test.mjs      EFFECT IR PARSE: GREEN
PASS  node tests/effect-ir-laya.test.mjs       EFFECT IR LAYA: GREEN
PASS  node tests/effect-ir-membrane.test.mjs   EFFECT IR MEMBRANE: GREEN
PASS  node tests/effect-ir-identity.test.mjs   EFFECT IR IDENTITY: GREEN
PASS  node tests/effect-ir.test.mjs            EFFECT IR v0: GREEN
PASS  node tests/effect-ir-bind.test.mjs       five mutations caught
TOTAL 6.00s | 18/35 passed
```

The other red rows die on `createZstdDecompress` missing from `node:zlib` in Node v22.14.0, inside existing Kira imports. `scripts/aukora/box-confinement-check.mjs` prints `SKIPPED (not macOS)`. Not a live-app measurement. A precard on this Node would refuse every card until that import runs. The courts themselves are green.

## Raise order

Raise from a worktree of `origin/main`, one card at a time, after the previous card is on `main`. Each preview is the text the window would show. It does not approve.

Card 6 is what makes the earlier courts binding: a check proves a protection only when removing it turns that court red. Cards 1–5 are the passing arms. Card 6 removes one line in each subject and requires the matching court to go red.

### 1. Parse a closed effect

Paths: `plugins/aukora-effect-ir/lib/parse.mjs`, `tests/effect-ir-parse.test.mjs`, `scripts/check.sh`

`parseEffect` types `memory.put`, `workspace.patch`, and staged `compute.job`. The see-digest is sha256 over canonical `{args, effect, schema}` under `aukora:effect-ir:v0`. Proposer, aura, sign, and Laya fields are not in the digest. An unknown field, an unknown effect, a path-shaped key, and a non-canonical value refuse. A typed record has no verdict. It is not an ALLOW.

```sh
node scripts/aukora/self-change.mjs --preview "Effect IR v0 parses a closed effect" \
  plugins/aukora-effect-ir/lib/parse.mjs tests/effect-ir-parse.test.mjs scripts/check.sh
```

`scripts/check.sh` gains `check 'node tests/effect-ir-parse.test.mjs'`.

### 2. Laya is monotonic STOP/ASK

Paths: `plugins/aukora-effect-ir/lib/laya.mjs`, `tests/effect-ir-laya.test.mjs`, `scripts/check.sh`

Rank is `none` 0, `ask` 1, `stop` 2. The rank may hold or rise. `stop` then `ask` is `laya:not-monotonic`. `allow` and every other word are `laya:not-stop-ask`. ASK and STOP are not executions. This module does not call the kernel.

```sh
node scripts/aukora/self-change.mjs --preview "Effect IR v0 Laya is STOP or ASK" \
  plugins/aukora-effect-ir/lib/laya.mjs tests/effect-ir-laya.test.mjs scripts/check.sh
```

`scripts/check.sh` gains `check 'node tests/effect-ir-laya.test.mjs'`.

### 3. Membrane fails closed

Paths: `plugins/aukora-effect-ir/lib/membrane.mjs`, `tests/effect-ir-membrane.test.mjs`, `scripts/check.sh`

`membraneAdmit` reads an observation record shaped like `membraneObservation()`'s return. It does not import `become.mjs`. Admitted only when every chain named by `become.mjs` `chainPaths` is `APPEND_ONLY` for `identical_trees_match` or `valid_append_only_extension`, or `UNDETERMINED` solely because `reason` is `missing_prior_observation`. Absence, a missing chain, rotation failure, `OBSERVATION_CONFLICT`, any other undetermined reason, and any other verdict refuse (`membrane:absent`, `membrane:rotation`, `membrane:conflict`, `membrane:undetermined`, `membrane:unknown`). The court reads `chainPaths` out of `become.mjs` as text and requires `CHAINS` to be those names, in that order: `code`, `actions`, `memory`, `remembered`.

```sh
node scripts/aukora/self-change.mjs --preview "Effect IR v0 membrane fails closed" \
  plugins/aukora-effect-ir/lib/membrane.mjs tests/effect-ir-membrane.test.mjs scripts/check.sh
```

`scripts/check.sh` gains `check 'node tests/effect-ir-membrane.test.mjs'`.

### 4. see = sign = execute

Paths: `plugins/aukora-effect-ir/lib/identity.mjs`, `tests/effect-ir-identity.test.mjs`, `scripts/check.sh`

`seeSignExecute` admits only when see, sign, and execute are the same 64-hex digest. A missing or different sign, or a different execute digest, is `see-sign-execute:diverge`. A see-digest that is not 64 hex is `see-sign-execute:see`. Equality sets `allows: false`. It does not sign and it does not call the kernel.

```sh
node scripts/aukora/self-change.mjs --preview "Effect IR v0 see equals sign equals execute" \
  plugins/aukora-effect-ir/lib/identity.mjs tests/effect-ir-identity.test.mjs scripts/check.sh
```

`scripts/check.sh` gains `check 'node tests/effect-ir-identity.test.mjs'`.

### 5. Composer refuses by default

Paths: `plugins/aukora-effect-ir/lib/ir.mjs`, `tests/effect-ir.test.mjs`, `scripts/check.sh`

`decideEffect(input, nowMs, membrane)` runs, in order: parse, membrane, see = sign = execute (execute is the kernel request's `payloadHash`), Aura map-only, Laya STOP/ASK, staged refusal, clock, kernel. The shipped policy is `rules: []`. A typed `memory.put` whose three digests match, on a clean observation, returns `kernel:policy_no_match`. Laya ASK and STOP return before the kernel and do not execute. `stop` after `ask` is STOP. `ask` after `stop` is `laya:not-monotonic`. Aura `allow` is `aura:map-only` and is not entered in the map. Aura `map` does not authorize. Staged `compute.job` is `staged:not-admissible`. A missing clock is `usage:now`. A missing membrane is `membrane:absent` and is not sent to the kernel.

```sh
node scripts/aukora/self-change.mjs --preview "Effect IR v0 refuses by default" \
  plugins/aukora-effect-ir/lib/ir.mjs tests/effect-ir.test.mjs scripts/check.sh
```

`scripts/check.sh` gains `check 'node tests/effect-ir.test.mjs'`.

### 6. Failing arms

Paths: `tests/effect-ir-mutate.mjs`, `tests/effect-ir-bind.test.mjs`, `scripts/check.sh`

One child per protection, through `module.register` (this Node does not export `registerHooks`). The subject file on disk is unchanged. Caught on this VM:

| protection removed | court that goes red |
|---|---|
| unknown-field check in `parse.mjs` | `tests/effect-ir-parse.test.mjs` |
| rank comparison in `laya.mjs` | `tests/effect-ir-laya.test.mjs` |
| `missing_prior_observation` exception in `membrane.mjs` | `tests/effect-ir-membrane.test.mjs` |
| digest inequality in `identity.mjs` | `tests/effect-ir-identity.test.mjs` |
| empty `rules` array in `ir.mjs` (replaced by one `memory.put` allow rule) | `tests/effect-ir.test.mjs` |

The allow-rule mutant returns `verdict: ALLOW`, `code: kernel:allowed`. The shipped policy does not.

```sh
node scripts/aukora/self-change.mjs --preview "Effect IR v0 binds the failing arms" \
  tests/effect-ir-mutate.mjs tests/effect-ir-bind.test.mjs scripts/check.sh
```

`scripts/check.sh` gains `check 'node tests/effect-ir-bind.test.mjs'`.
