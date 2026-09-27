// aukora seed · conformance/adapter.aukora-seed.mjs
//
// The only file this repository supplies to the shared suite. `run.mjs` and
// `cases/` are vendored byte-identically from the sibling; if they differ, the
// suite is no longer shared and the whole exercise is theatre.
//
// ══ IT CALLS THE REAL FENCE ══
//
// `judge()` builds a hook payload and hands it to `runFence` — the same
// function `bin/aukora.mjs guard` calls, reached the same way, with the same
// law loading, the same path analysis and the same exit codes. It reimplements
// nothing. An adapter that re-derives the verdict proves the adapter conforms,
// which is worth nothing to anybody.
//
// ══ THE FIXTURE IS MATERIALISED IN PLACE ══
//
// Never copied. `cpSync` does not preserve hard links — nlink goes 2 → 1 —
// which silently turns `hardlink-nlink` into an ordinary file and makes a
// correct fence look broken. That cost the sibling a round; it is in `run.mjs`'s
// header and it is repeated here because this is the file where it would be
// re-broken.
//
// ══ ALLOW-LIST vs DENY-LIST — A REAL DIVERGENCE, NOT A BUG IN THE HARNESS ══
//
// The sibling's organism is an ALLOW-list: three declared editable paths, and
// everything else refused. This repository is a DENY-list: it refuses paths the
// owner declared off-limits and permits the rest. Both answer "would this write
// be permitted", which is all a case asks — but they cannot answer
// `undeclared-path` the same way, and that is a property of the design rather
// than a defect in either implementation. See the note on that case below.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

export const NAME = 'aukora-seed';

/**
 * What the fixture treats as off-limits.
 *
 * Derived from the cases' own fixtures, not from their expectations: every path
 * a case plants as the thing that must not be written, expressed as the globs
 * this repository's law actually uses. `world/mind.md` is deliberately absent —
 * `lawful-write` must ALLOW, and a law that refuses everything would pass every
 * case except the control while proving nothing.
 */
export function protectedPatterns() {
  return [
    'law.js',        // symlink-to-protected, hardlink-nlink, case-fold, trailing-dot
    'law/**',        // nfd-decompose
    'secrets/**',    // symlinked-parent
    '**/*.pem',      // empty-segment-glob
  ];
}

export async function judge({ root, spec, materialize, path, op }) {
  const { runFence, REFUSE, ALLOW } = await import(join(REPO, 'src/guard.mjs'));
  const { LAW_SCHEMA } = await import(join(REPO, 'src/law.mjs'));

  // The repo the fence will judge. Built here, in place, exactly once.
  const home = join(root, 'repo');
  mkdirSync(home, { recursive: true });

  // The law goes down BEFORE the fixture, so a case that plants a file at a
  // protected path cannot be affected by the order.
  writeFileSync(join(home, 'aukora.law.json'), `${JSON.stringify({
    schema: LAW_SCHEMA,
    protected: protectedPatterns(),
    writesOutsideRepo: 'refuse',
    unguardedTools: 'receipt',
  }, null, 2)}\n`);

  materialize(spec, home);

  // `op` is append or write. Both are declared file-tool calls to this fence —
  // `Edit` and `Write` — and both reach the identical decision path, so the
  // distinction changes the tool name and nothing else.
  const payload = {
    session_id: 'conformance',
    cwd: home,
    tool_name: op === 'append' ? 'Edit' : 'Write',
    tool_input: { file_path: path },
  };

  // The fence writes to stderr on refusal. Silence it: a conformance run is a
  // table, and forty lines of refusal prose in the middle of it is how someone
  // stops reading the table.
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  let code;
  try {
    code = runFence(payload);
  } catch {
    // The guard's own contract is that it refuses when it cannot reason. If a
    // throw ever escapes it, that is a defect — but the honest answer to "what
    // would this repository do" is still what the shell wrapper does, and
    // `|| exit 2` makes any non-zero a refusal.
    return 'REFUSE';
  } finally {
    process.stderr.write = real;
  }

  if (code === REFUSE) return 'REFUSE';
  if (code === ALLOW) return 'ALLOW';
  return 'ERROR';
}
