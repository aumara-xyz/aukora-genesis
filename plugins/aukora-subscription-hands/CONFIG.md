# Subscription hands — the exact config the next release must carry

Two halves. **Corrected 2026-09-26: both halves now ship.** The materializer inserts the host rows
(`scripts/materialize-aukora-release.py`, about :431-452). **But the mounted rows do not route through
`lib/run.mjs`**, and nothing populates the `CODEX_HOME` or `CLAUDE_CONFIG_DIR` they name, so the pins
this file describes are court-tested only on a path production does not use (see §2).

## 1. The preset half — DONE, `presets/core/agent.cordis.yml`

Both `tool-subagent-codex` and `tool-subagent-claude-code` had `disabled: true` removed, in **the CORE preset
only**. `vendor/dsh/packages/preset/agent-presets/presets/standard/agent.cordis.yml:204,216` still ship
`disabled: true` and were not touched — vendor is never edited by hand, and a Standard-preset agent must still
have both adapters OFF. `tools/…` nothing else changed in the preset.

## 2. The host half — mounted, and NOT routed through the pins

The `subagents` registry is a host-plane process singleton, and **a provider name may only be registered once**,
so the two provider rows cannot go in a preset: a second session mounting CORE would collide with the first.
They belong in the host composition, beside the other AUKORA plugin rows.

**The rows below are the design as first written, not what ships.** The materializer emits
`./packages/subagent/…` names and literal `{LIVE_DSH_HOME}/subscription-hands/config/…` paths (the bare
package names failed to import on every boot); read the rows it emits (about :431-452) rather than these.
`tests/aukora-core-mounts.test.mjs` still requires the old `!!js path.join(dshHomePath(…))` spelling, which
the materializer no longer emits, and that court is registered in no gate.

```yaml
- insert:
    - id: subagent-codex
      name: '@deepseek-ai/dsh-subagent-codex'
      config:
        providerName: codex
        # `never` is the ONLY mode that sends an approval policy of `never`, and on its own it sends NO sandbox
        # — which is why CODEX_HOME below is not optional. The sandbox arrives from the owned config.toml.
        permissionMode: never
        env:
          CODEX_HOME: !!js path.join(dshHomePath('subscription-hands/config/codex'))
          CODEX_SANDBOX_NETWORK_DISABLED: '1'

    - id: subagent-claude-code
      name: '@deepseek-ai/dsh-subagent-claude-code'
      config:
        providerName: claude-code
        # NEVER `dontAsk` (the shipped default) and never `bypassPermissions`.
        permissionMode: acceptEdits
        env:
          CLAUDE_CONFIG_DIR: !!js path.join(dshHomePath('subscription-hands/config/claude'))
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
```

`dshHomePath` is the host's own resolver; substitute the deployment's equivalent if it differs. **The paths must
resolve inside the owned hand root and never inside `~/Library/Application Support/AUKORA` or
`~/aukora-private`.**

### Why `permissionMode` alone is not the pin

| what Fable asked for | the adapter's own lever | verdict |
|---|---|---|
| Codex `--sandbox workspace-write` | `permissionMode: approve-for-me` names `workspace-write` **and turns approvals on** | ✗ no mode is never + workspace-write |
| Codex `approval policy never` | `permissionMode: never` | ✓ but sends **no sandbox at all** |
| Codex network off | no such field | ✗ owned `config.toml` |
| Claude Code `acceptEdits` | `permissionMode: acceptEdits` | ✓ |
| Claude Code tool allowlist | `allowedTools` exists in the **SDK** (`claude-agent-sdk/sdk.d.ts`) but the adapter never sets it | ✗ in the adapter. `lib/run.mjs` passes `--allowedTools` on the argv and also writes it into the owned `settings.json` |
| Claude Code `--add-dir <worktree>` | no such field in the adapter | ✗ in the adapter. `lib/run.mjs` passes `--add-dir` on the argv and writes it into `settings.json`; for Codex, `--sandbox` and `--ask-for-approval` are also on the argv |
| fresh worktree per task | `cwd` comes from `resolveChildCwd(…, parentCwd)` — **the parent session's cwd** | ✗ `lib/run.mjs` |
| one child at a time | no such field | ✗ `lib/run.mjs`, sharing `scripts/lib/heavy-run.mjs`'s lock |
| wall-clock timeout | `disposeGraceMs` is termination grace, **not a deadline** | ✗ `lib/run.mjs` |
| process-group reap | managed-range terminate covers the child | partial; `lib/run.mjs` signals the group |

So the pins are implemented in `plugins/aukora-subscription-hands/lib/run.mjs` (`runHand`: owned `config.toml`
and `settings.json`, worktree, lock, timeout, reap), and **the mounted adapter rows do not call it.** The rows
point `CODEX_HOME` and `CLAUDE_CONFIG_DIR` at directories nothing populates (the only writer of those files,
`runHand`, writes under `<checkout>/.runtime/…`, and `runHand` is imported only by tests). What a hand spawned
through these rows gets is unmeasured, and none of the `runHand` pins apply to it.

## 3. The files written at run time

`lib/run.mjs` (`runHand`, the test-driven path) writes these before the child exists, under
`<checkout>/.runtime/subscription-hands/config/<run key>/`, one directory per run:

- `codex/config.toml` — `approval_policy = "never"`, `sandbox_mode = "workspace-write"`,
  `[sandbox_workspace_write] network_access = false`. With the argv's own `--sandbox`,
  `--ask-for-approval` and `-c network_access=false`, this is what makes "never + workspace-write" exist on
  the `runHand` path, because no permission mode expresses it.
- `claude/settings.json` — `permissions.allow` = Read, Edit, Write, Grep, Glob, `Bash(git:*)`, `Bash(node:*)`,
  `Bash(npm:*)`, `Bash(pnpm:*)`, `Bash(npx:*)`; `permissions.additionalDirectories` = the task's worktree only;
  `permissions.deny` covers Read, Grep and Glob on both forbidden roots, 15 common Bash read commands
  (everywhere, since a Bash rule cannot name a path), and `./.env`. `Bash(node|git|npm|pnpm|npx)` stays
  allowed and can read anything, as the CEILING says.

## 4. The ceiling — printed, because no CLI can enforce it

```
A hand is NOT a sandbox and this is NOT isolation.
Neither CLI can be fenced off from a directory it can read, so ~/Library/Application Support/AUKORA and
~/aukora-private are protected by never running a hand inside them, by refusing such a cwd, and by the
tools' own config living elsewhere — NOT by a kernel boundary. A determined child could still read them.
Both hands run as this user, with this user's subscription credentials.
The worktree keeps a hand out of the SHARED CHECKOUT; it does not keep it out of the machine.
```

That is the first six of the 20 lines of `CEILING` in `lib/pins.mjs`; print it from there rather than
retype it. The lines omitted above say that Claude Code's Bash deny can name commands but not paths, so the
allowed `node`, `git`, `npm`, `pnpm` and `npx` can read any file this user can; and that **Codex has no tool
allowlist at all and is not covered by the Read/Grep/Glob deny**: its reach is limited by
`sandbox_mode = "workspace-write"` and `network_access = false`, not by a list of permitted tools.

## 5. What is NOT done

- **The host rows are mounted in every materialized release.** The open gap is that they do not route
  through `lib/run.mjs` (§2).
- **No real subscription CLI has been run.** Every measurement is against a stub that records its argv and
  environment. Opus over OpenRouter is what this replaces; nothing here has yet spent a subscription token.
