# The conformance suite

Twelve executable cases that **both** `aukora-one` and `aukora-seed` must
answer identically. Vendored byte-identically into both. Each repository
supplies only an adapter.

## Why it exists

Two repositories implement the same idea and have drifted twice, in both
directions, without anyone noticing by reading:

- the chain-lock defect was fixed in `adapters/membrane/chain.mjs` and stayed
  **live** in the transplanted `seed/chain.mjs` for days
- the hard-link hole is closed in `aukora-one` and **open** in `aukora-seed`

Prose does not catch that. This does. **A finding becomes a case first and a fix
second, in both repos**, and a case that passes in one and fails in the other
names the divergence in one line.

## Running it

```bash
node conformance/run.mjs                                  # this repo's adapter
node conformance/run.mjs --adapter path/to/other.mjs
```

Exit 0 only when every case passes **and** the control held.

## The adapter contract

```js
export const NAME = 'aukora-one';
export function protectedPatterns(): string[];
export async function judge({ root, spec, materialize, path, op })
  : Promise<'ALLOW' | 'REFUSE' | 'ERROR'>;
```

**The adapter must ask the real fence.** One that reimplements the checks proves
the adapter conforms, which is worth nothing.

**The adapter materialises the fixture itself**, in the directory its fence
expects, by calling `materialize(spec, dir)`. It must never copy a built
fixture: `cpSync` does not preserve hard links — measured, `nlink` 2 → 1 — which
silently turns the `hardlink-nlink` case into an ordinary file and makes a
correct fence look broken. That mistake was made writing this suite and cost a
false accusation before it was caught.

## The control is not optional

`lawful-write` must return `ALLOW`. A fence that refuses everything passes every
other case here and protects nothing. A run whose control fails is reported as
untrustworthy regardless of the count.

## ⚠️ WHAT 12/12 DOES *NOT* MEAN FOR `aukora-one`

Read this before quoting the score.

`aukora-one`'s organism is an **allow-list**: three declared editable paths
(`world/mind.md`, `world/memory.jsonl`, `world/state.bin`) and everything else
refused. `aukora-seed` is a **deny-list**: protected globs, everything else
permitted.

Those shapes answer these cases for different reasons, and for `aukora-one`
several cases pass **for the right outcome and the wrong reason**:

| case | aukora-one refuses because… | does it exercise the named mechanism? |
| --- | --- | --- |
| `case-fold` | `LAW.JS` is not one of the three | **no** |
| `trailing-dot` | `law.js.` is not one of the three | **no** |
| `nfd-decompose` | not one of the three | **no** |
| `empty-segment-glob` | not one of the three | **no** |
| `repo-root` | not one of the three | **no** |
| `undeclared-path` | not one of the three | yes — this *is* the mechanism |
| `dotdot-traversal` | resolution, after the allow-list | yes |
| `dangling-symlink` | `O_NOFOLLOW` → `ELOOP` | **yes** |
| `symlink-to-protected` | resolved parent leaves the world | **yes** |
| `symlinked-parent` | resolved parent leaves the world | **yes** |
| `hardlink-nlink` | `fstat(st_nlink) !== 1` | **yes** |
| `lawful-write` | it is one of the three | yes (control) |

So `aukora-one` genuinely demonstrates **six** of these mechanisms. The other
five are answered by the allow-list's shape and would keep passing even if the
case-folding logic were deleted, because there is none to delete.

**Those five cases are here for `aukora-seed`**, where they are discriminating —
its deny-list must decide `LAW.JS` against a `law.js` rule, and its own source
says folding is what makes that work.

An allow-list is the stronger shape and it is not a substitute for the checks.
The moment `aukora-one` grows a fourth editable path with a pattern in it, the
five become live here too. **Do not report 12/12 as "aukora-one implements
Unicode path folding." It does not, and it does not need to yet.**
