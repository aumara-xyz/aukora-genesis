// declared-id-regression.mjs — a declared governed id with no mapped path must not run.
//
//   node --import src/install.js declared-id-regression.mjs <module-to-import> <result.json>
//
// WHY THIS EXISTS, AND WHERE IT RUNS. The admission hook used to consult the declared id set
// only when `governedFiles` was empty:
//
//     const isGoverned = governedFiles.length ? governedFiles.includes(filePath)
//                                             : governed.has(governedIdFor(filePath));
//
// and launch-dsh.py fills `governedFiles` from the release's single `governedDemo`, so in every
// materialized release the id set was never consulted at all. Two declared ids with one mapped
// path measured as: the unmapped one imported, its body ran, and the gate logged neither ACCEPT
// nor REFUSE — no admission, so no receipt. A nonempty mapping silently un-governed every
// declaration it did not name.
//
// This drives the REAL import path: the same `install.js` bootstrap and the same `load` hook a
// launched process uses, on disposable state. It asserts on the module BODY'S EFFECT rather than
// on a log line, because "the body ran" is the property the gate claims to prevent.
//
// Neutralising the union in policy.js must make governed-demo.sh RED. That is the point of
// asserting here rather than describing the behaviour in a comment.
//
// argv[2] = absolute path of the module to import
// argv[3] = absolute path to write the observation JSON to
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { policyHandle } from '../src/policy.js';

const target = process.argv[2];
const outPath = process.argv[3];
const effectLog = process.env.AUKORA_REGRESSION_EFFECT_LOG;

const observation = {
  target,
  imported: false,
  importError: null,
  bodyRan: false,
  admitted: 0,
  refusalCodes: [],
  refusalReasons: [],
};

try {
  await import(pathToFileURL(target).href);
  observation.imported = true;
} catch (err) {
  observation.importError = String(err && err.message ? err.message : err);
}

// The body's real effect, read back rather than inferred from the absence of a throw: a body
// that ran and then threw would otherwise be indistinguishable from a refusal.
try {
  const text = readFileSync(effectLog, 'utf8');
  observation.bodyRan = text.includes('BODY-RAN');
} catch { /* absent log means the body never reached its append */ }

const handle = policyHandle();
if (handle) {
  observation.admitted = handle.accepted.length;
  observation.refusalCodes = handle.refusals.map((r) => r.code);
  observation.refusalReasons = handle.refusals.map((r) => r.reason);
}

writeFileSync(outPath, `${JSON.stringify(observation, null, 2)}\n`);
