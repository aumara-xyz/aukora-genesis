# aukora-core-read-deny

**A CORE session's content reads through the fs service (`readText`, `readBytes`, `readByteRange`,
`readStream`) are refused at these named files, directories, the `.sock` suffix and two basenames** — the
launch state, the lane door, the eye, the gate state, the Kira keys, every `*.sock`, and the approve-queue
and owner-console binaries. A CORE session is the conductor inside Auma, which does not hold Peter's
authority. This is an in-process guard on the same uid, not isolation. It does not cover copies under
other names, sessionless host reads, tools that read without the fs service (`tool-fs-search` spawns
ripgrep; by reading the code, not measured), or processes a CORE session spawns. No boot-level court is
wired.

## What is here

| module | what it is |
|---|---|
| `lib/policy.mjs` | the decision, as a pure function — `coreReadRefusal({preset, target})` |
| `lib/guard.mjs` | the denial — `guardReads(provider, {presetOf})` |
| `lib/preset.mjs` | who is reading — `presetOfFromContext(ctx)`, from three real services |
| `lib/seatbelt.mjs` | the Seatbelt profile, **measured and recorded as unusable** — see below, including a 2026-09-26 finding that reopens it |
| `lib/index.mjs` | the entry — `apply(ctx, {providerClass, providerConfig})` |
| `lib/hands-fence.mjs` | a check of whether the operator's protected directories are `0700` and operator-owned, which fences them only from OTHER uids (`tests/aukora-core-hands-fence.test.mjs`). Nothing at runtime calls it, and the hands currently run as the operator |
| `tests/aukora-core-read-deny.test.mjs` | 62 arms and 11 mutations (62/62 green, plain and `--mutate`, 2026-09-26) |
| `tests/aukora-core-seatbelt.test.mjs` | 9 arms; see the Seatbelt section for what it records and what its result depends on |

## The one change this needs to take effect

**Mount this INSTEAD OF `@deepseek-ai/dsh-fs-sandbox`.** The materializer emits these rows (disable the
base row, insert the guard with the provider module):

```yaml
- id: fs-sandbox
  disabled: true
- insert:
    - id: aukora-core-read-deny
      name: ./plugins/aukora-core-read-deny/lib/index.mjs
      config:
        providerModule: '@deepseek-ai/dsh-fs-sandbox'
```

Renaming the `fs-sandbox` row instead, as an earlier version of this README showed, is silently skipped
at boot (`applyEntryPatches` logs a name mismatch and skips it), so a guard mounted that way never runs.

**Why a swap and not a wrapper.** MEASURED: `ctx.provide` throws on a second registration of a name, so a
plugin that re-provided `fs` beside `fs-sandbox` would refuse to mount. The harness's own answer is the
same shape — *"loading it INSTEAD OF `dsh-fs-local`, together with a `ctx.sandboxPolicy`, is the whole
swap — the model-facing tools are untouched."* Mounted this way, the write fencing and every non-read
method come from `SandboxedFileSystem` and **only reads are added.**

**Why not a preset row.** MEASURED: `dsh-tool-fs` declares `inject = ['tools', 'fs', 'systemPrompt']`, and
the preset mount resolves injection before any session exists — *"such a service belongs on the host
plane."* `presets/core/agent.cordis.yml` says the same thing in its own words: *"The `fs` service and its
policy stay in the host."*

## The ceiling

**A session that clears its initiator boundary is indistinguishable from a sessionless host read, so it is
not refused.** A clearing-boundary session and a sessionless host read both arrive with no initiator
(`READER_NONE`) and are allowed, because a cold host read — a transcript reader, an export, a court — has
no initiator and must keep working. A session with no preset set yet is also allowed, even at protected
paths. A session whose preset cannot be established is refused as `aukora-core:reader-unknown`.

MEASURED: exactly **two** production call sites pass an Agent to `withInitiator` — the agent loop
(`core/agent-loop/src/agent.ts:208`) and a browser-use stage
(`experimental/browser-use-stagehand-native/src/index.ts:203`) — **and neither passes `undefined`, which is
what would establish a clearing boundary. Nothing in this tree creates one today.**

**A copy of a protected file under another name is also not covered.** `file` rows match one exact name,
so `state/launch.json.bak` is readable and carries the same bytes. There is an arm asserting it is
readable, so the list above is not read as more than it says. No list of backup spellings was added,
because that list would be invented rather than measured.

## The Seatbelt route, as measured — and a finding that reopens it

`lib/seatbelt.mjs` emits the deny-default profile item 4 asked for. `tests/aukora-core-seatbelt.test.mjs`
records that no measured SBPL shape both runs a process and withholds the read, and it is GREEN (9/9) when
run on macOS with the default temporary directory.

**Finding, 2026-09-26, Darwin 25.1 (not yet folded into the court):** the court builds its protected paths
under `os.tmpdir()`. With the default `/tmp` or `/var/folders/…` (both symlinks into `/private`), a targeted
deny after `(allow default)` is ignored — the result recorded below. With `TMPDIR` set to a canonical
`/private/tmp/…` path, the same three targeted-deny arms go **red because the deny applies** (`cat` exits
1). So "a targeted deny does not narrow `(allow default)`" is, on this measurement, a finding about a
non-canonical path in the rule, not about rule precedence. The route should be re-measured with the deny
paths canonicalized (`realpath`) before it is recorded as unusable.

What the court records with the default temporary directory: a targeted deny after `(allow default)`,
before it, or under a `(deny default)` base with a blanket `(allow file-read*)` did not stop a real
`/bin/cat` from printing the secret.

It then tries an **absent allow**. A narrow allow-list kills the process before it reads (observed as a
signal, `exit null`), which is an abort, not a refusal; the court's "refuses the read" arm is satisfied by
a process that never started. The author reports that **four different system read lists all aborted with
exit 134** (the court drives one profile). Something a process needs to start lies outside all of them,
and it fails as an abort with no diagnostic rather than a refusal naming what was missing.
`(subpath "/")` is the only read grant that runs, **which is exactly as broad as the `(allow default)` the
item exists to replace.**

`tests/aukora-core-seatbelt.test.mjs` runs on the front door and in the macOS CI job, plain and with
`--mutate`. It skips by name on non-macOS, and that skip is not coverage. Its `--mutate` mode rewrites
`lib/seatbelt.mjs` in place and then restores it. Its own header still says it is red on purpose and not on
the front door; both are out of date.
