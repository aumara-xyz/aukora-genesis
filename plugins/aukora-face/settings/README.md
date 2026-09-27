# @aukora/face-settings

The settings chrome for the spatial shell, and the reason the System corner has
anything in it.

## What it does that the upstream chrome does not

Every settings package — general, models, plugins, agent presets — registers a
section into one shared ledger. The upstream chrome renders those sections inside a
settings surface and stops there. This one ALSO projects that ledger into rows in
the shell's System menu, which is where a person reaches settings in a three-lane
shell with no settings button of its own.

So on the client side this package replaces the upstream chrome; it also has a host
half (below). No settings package is modified, and each one keeps registering exactly as
it did.

## What it registers

| slot | entry |
| --- | --- |
| `shell.surface` | the settings surface |
| `shell.menu.system` | the System-menu rows, projected from the section ledger |
| `settings.section` | the General section |
| `settings.header`, `settings.action`, `settings.close` | the surface's own chrome |
| `shell.overlay` | first-run onboarding |

The host half (`src/index.ts`) registers the Aura-coherence session projection (below), an onboarding
settings namespace, and two authenticated GET routes, each of which calls
`connection.requestRejection`: `/api/aukora/aura-evidence`, which spawns `evidence/aura-evidence.py`
over the Aura adapter, and `/api/aukora/backend-identity`, which spawns nothing. The evidence projection
reads without writing and refuses by name; that is measured by
`tests/aukora-face-aura-evidence.test.mjs --mutate` (plain and `--mutate` in `.github/workflows/b1.yml`),
which asserts a named refusal for an absent log, no writes into the state root, and verdicts that come
from the adapter. No court drives the System-menu projection this README is mostly about.

## What it gives up on this harness

**Row descriptions.** A list-slot registration here carries id, order and label. The
grey second line under each row needs a `description` option that exists only in the
slots core of the tree this chrome came from. Porting that core to win one line of
text is not a trade worth making, so rows show labels alone.

**Nothing else.** Aura Coherence used to be listed here: its surface read session
state through an API this harness reshaped, and its host-side projection went with
it. Both are built and mounted now — the projection registers through the optional
`ctx.inject(['sessionProjections'], …)` form, so a host without that service simply
skips it, and the surface reads the projected value off the session. The `aura.*`
dictionary entries came with them.

## Where it came from

`aukora-deep` at `7be3a614`, package `@deepseek-ai/dsh-client-ui-settings-general`,
built here from source by `scripts/build-face.py`. Its document store is NOT Deep's:
that one spoke to a connection's api handle, and this harness moved the operation
behind `ctx.remote.settings`, so the pinned harness's own copy of the store is used
instead — which is also why `remote` and `remote.settings` are injected.
