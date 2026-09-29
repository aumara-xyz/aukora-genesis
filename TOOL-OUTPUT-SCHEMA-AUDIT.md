# Tool output schema audit

Scratch only. Do not merge. `kira_recall` is not fixed here; Auma owns that declaration.

## Not enforced

This check runs in a checkout (`node tests/tool-output-schema.test.mjs`, also one line in `scripts/check.sh`). It does not run inside the installed app, and it does not call the harness. The walker in `tests/helpers/tool-output-schema.mjs` copies the closed-object rule from the pinned harness (deepseek-harness `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`, `packages/core/tools/src/json-schema.ts`, `validateJsonSchemaValue`). The rejection sentence it produces is the one that file prints:

`"value.<key>" is not a declared property (additionalProperties: false)`

A green court here is not a green installed app. Same-UID agents, a software approval key, and no server-side check on `main` are unchanged. Nothing in this branch was approved in an AUKORA popup.

## What broke

`reconcileRecallAvailability` (`plugins/aukora-kira/lib/partial-failure.mjs`) always returns `partialFailure`. The live dispatch copies that object out of the tool:

`plugins/aukora-kira/lib/index.js` registers `recallTool`. The handler calls `conversation.turn`, then, when `request.text` is a non-empty string, `reconcileRecallAvailability`, and returns that value.

`plugins/aukora-kira/lib/tools.mjs` `recallTool` declares `output.schema` with `additionalProperties: false` and does not name `partialFailure`. The harness validates the return against that schema and rejects the whole result. Courts that only assert `partialFailure` on the library object stay green.

Measured by this court, on an empty read-owner snapshot and the question `where is the note`:

- `conversation.turn({ action: 'query', text: '' })` conforms. It has no `partialFailure`. The index.js branch skips reconcile when text is missing or empty, so that arm is not the break.
- The reconciled object has exactly one schema violation: `"value.partialFailure" is not a declared property (additionalProperties: false)`. On this empty store the action is `proceed` and availability stays `empty`. The field is still there. The break is not limited to the ask/stop arms.

## Scan

Live tools whose definitions carry `output.schema` (plugins only; `plugins/aukora-action-gate/check.mjs` is a stand-in, not a mount):

| Tool | Schema | Producer checked | Result against the walker |
| --- | --- | --- | --- |
| `kira_recall` | closed object | `KiraConversation.turn`, then `reconcileRecallAvailability` on non-empty text | empty text conforms; non-empty text fails only on `partialFailure` |
| `kira_stage` | closed, including `queued`, `memoryPut`, `settlement` | `stageTool.execute` with a stub prover, with and without a queue | conforms. The queue result carries `dir`; execute copies only `state` and `recordId` |
| `kira_settle` | closed; `receipt` is open | `settleTool.execute` against a stub `settleAuthorized` | conforms. `approverPinned` and `controlPinned` are declared. A library-only field on the stub is not copied |
| `kira_queue` | closed, and each row is closed | `queue.list` / `queue.read` shaped by `queueRowOf` and an unreadable row | conforms, including `classification` and `classificationCeiling` |
| `aukora_see` | closed objects, but `required: true` (boolean) on properties | `diffRgba` wrapped the way `execute` wraps it (`previousAt` added) | 31 dialect violations, all `required must be an array of strings`. A same-size diff conforms. A resized diff conforms on keys and fails types: `changedPercent` null is not a number, `changedPixels` null is not an integer |
| `aukora_self_change` | `{ type: 'string' }` | schema only; execute was not called | a string conforms; an object does not. No closed-object surface |

Open on purpose, so a new nested field does not trip this gate: `kira_recall` `snippets` and `relations` items are `{}`; `interpretation`, `retrieval`, `bounds`, `state`, `counters`, and `remembered` set `additionalProperties: true`; `kira_settle` `receipt` is open. `semanticNotes` can grow inside `remembered` without a schema miss.

Kira's four output schemas have zero dialect violations under the pinned subset. Eye's do not.

## Pattern

`tests/helpers/tool-output-schema.mjs`

- `outputSchemaViolations(schema, value)` — the value check.
- `undeclaredProperties(schema, value)` — the closed-object misses only.
- `schemaDialectViolations(schema)` — schema shape the harness rejects before a value check (`required` must be a string array).

`tests/tool-output-schema.test.mjs` does three things:

1. Run a real producer and require the result to conform.
2. Copy that result, add `schemaAuditProbe: true`, and require the walker to report `"value.schemaAuditProbe" is not a declared property (additionalProperties: false)`. A mutation that adds an undeclared field is red.
3. Pin the known live miss by the exact violation list. Today that list is one line, `value.partialFailure`. A second undeclared key fails the court. Declaring `partialFailure` also fails it, until the waiver line is deleted. The waiver is the stale-fix tripwire, not a permit to add more fields.

Use the tool's own `output.schema`. Do not keep a second copy of the property list in the court.

## Top 5

1. **`kira_recall` / `partialFailure`.** Broken on every non-empty question. Call path above. Courts of `partial-failure.mjs` never pass the object through `recallTool`'s schema. Waiver is in the new court. Do not declare the field in this branch.

2. **`kira_queue` rows.** `additionalProperties: false` on the row. `queueRowOf` is the producer; unreadable files are a second row shape (`name`, `reason`). This file already records the same defect for `declined`: the row grew, the schema did not, and the harness rejected the listing. The court now locks `queueRowOf` plus an unreadable row. The next new row field without a schema line goes red here, and in the app.

3. **`kira_settle`.** Closed object, rebuilt in `execute`. CI run 35562773363 rejected `approverPinned` the same way. Both pin flags are declared now, and this court executes the stub and requires them to conform. `receipt` is open, so receipt-field drift is invisible. A new top-level key copied out of `settleAuthorized` is not.

4. **`kira_stage`.** Closed, including `queued`. `enqueuePending` returns `dir`. Execute drops it. Spreading the queue object into `queued` is red (`value.queued.dir`). `wrote` used to be `const: false`, which would have rejected a successful enqueue; the comment in `tools.mjs` is the same class of bug, already repaired.

5. **`aukora_see`.** Not an undeclared-key miss. Two other schema drifts: `required: true` is outside the pinned subset (31 nodes; the harness refuses that schema at registration if this pin is what the app loads — not verified in the installed app), and the size-changed diff returns `changedPercent: null` and `changedPixels: null` against `number` and `integer`. Same-size diffs conform. Resize is the path that fails the value check.

`aukora_self_change` is a string. It is not in this list.

## What the court does not prove

- On this Linux checkout, `sh scripts/check.sh` is not all green. The new line passed (`tool-output-schema: 7 passed, 0 failed`). Other lines die on `node:zlib` `createZstdDecompress`, which Node 22.14 does not export. That is the VM, not this court.
- It does not boot the app, and it does not import `vendor/dsh`.
- It does not see fields added under an open object (`remembered`, snippets, `receipt`).
- The recall sample is an empty store. The violation is the extra key, which `reconcileRecallAvailability` adds on every return, including `proceed`.
- Eye registration against the pinned schema assert was not run.
