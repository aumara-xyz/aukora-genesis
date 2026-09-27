// install.js — the node bootstrap that puts the composition gate's admission policy in place.
//
//   node --import <path>/install.js <dsh entry> --profile web …
//
// WHY A BOOTSTRAP AND NOT A PLUGIN. Measured: the governed plugin's body runs 151 ms before
// any profile plugin's `apply()` is called, so a hook installed from a plugin always arrives
// second. A module load hook has to exist before the first governed import, which means before
// the application starts importing — which means a node bootstrap.
//
// CONFIGURATION comes from the environment, because a bootstrap has no profile config to read:
//
//   AUKORA_GATE_GOVERNED   comma-separated plugin ids governed by this gate (default: none,
//                          which refuses nothing and says so)
//   AUKORA_GATE_STATE      the gate's state directory: governor.pk, spent-nonces.json and
//                          the grants/ directory live here
//   AUKORA_GATE_FILES      comma-separated absolute paths to govern by file rather than by id
//   AUKORA_GATE_ROOT       the root a grant's pluginPath is relative to (default: the working directory)
//
// With nothing configured the policy installs, refuses nothing, and prints that fact. A gate
// that silently governs nothing while appearing to be installed is worse than no gate.
import { readFileSync } from 'node:fs';
import { installPolicy } from './policy.js';

const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);

// CONFIGURATION, in order of precedence:
//
//   1. AUKORA_GATE_CONFIG — a JSON file the LAUNCHER writes into the private deployment state.
//      This is the supported path: the launcher computes it, records it in launch.json, and
//      keeps mutable grants and spent-grant state out of the immutable release.
//   2. The individual AUKORA_GATE_* variables, for a hand-driven disposable test.
//
// Reading a file rather than growing the launcher's environment whitelist keeps the whitelist
// intact: exactly one new variable is passed, and it names a path rather than carrying policy.
let fromFile = {};
const configPath = process.env.AUKORA_GATE_CONFIG;
if (configPath) {
  try {
    fromFile = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    // A configured path that cannot be read is a REFUSAL, not a fallback to defaults: silently
    // governing nothing because a file was missing is the failure this whole brick exists to
    // prevent, and it would look identical to a working gate in the logs.
    console.error(`[composition-gate] REFUSE: AUKORA_GATE_CONFIG is ${configPath} and could not be `
      + `read as JSON: ${err.message}`);
    console.error('[composition-gate] refusing to start with no policy rather than silently '
      + 'governing nothing.');
    throw err;
  }
}

/**
 * THE ADMISSION CUT, READ FROM THE CONFIG FILE AND VALIDATED FIELD BY FIELD.
 *
 * THE DEFECT THIS FIXES, MEASURED BY AUMLOK'S CHAIN COURT: this file forwards only governed, governedFiles,
 * stateDir, grantDir and governorPkFile. None of pilotArtifact, pilotGrant, requireGrant,
 * pilotDaemonKeyPath, pilotRelease, pilotRoot, pilotScope or the set-grant fields reached the policy — so
 * AN APPROVED GRANT COULD NEVER ADMIT ANYTHING IN A REAL LAUNCH. The capability was in the tree and
 * absent at runtime, which is the failure this project keeps finding: it is not enough for a protection to
 * exist, it has to be INSTALLED on the path a real launch takes.
 *
 * EVERY FIELD IS READ FROM `fromFile` AND NONE FROM THE ENVIRONMENT. That is deliberate and it is a
 * boundary, not a style choice: AUKORA_GATE_* variables are inherited by every child this process spawns,
 * so a pin path taken from the environment would be a pin the agent can set. THE PIN COMES FROM THE
 * CONFIG THE LAUNCHER WROTE, which lives in the deployment's private state.
 *
 * A WRONG SHAPE IS A NAMED REFUSAL, NEVER A SILENT DROP. A gate that quietly ignored a malformed grant
 * would install, admit by digest, and look exactly like a gate with no grant configured — which is the
 * one outcome an operator must never have to infer from behaviour.
 */
const refuseField = (field, why) => {
  const error = new Error(`AUKORA_GATE_CONFIG field ${field} ${why}`);
  error.code = 'gate-config-field-malformed';
  return error;
};
const optionalString = (field, value) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') throw refuseField(field, 'must be a non-empty string');
  return value;
};
const optionalObject = (field, value) => {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw refuseField(field, 'must be an object');
  return value;
};
const optionalBoolean = (field, value) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw refuseField(field, `must be a boolean, got ${typeof value}`);
  return value;
};
const optionalStringArray = (field, value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw refuseField(field, 'must be an array of strings');
  }
  return value;
};

installPolicy({
  governed: fromFile.governed ?? list(process.env.AUKORA_GATE_GOVERNED),
  governedFiles: fromFile.governedFiles ?? list(process.env.AUKORA_GATE_FILES),
  stateDir: fromFile.stateDir ?? process.env.AUKORA_GATE_STATE,
  ...(fromFile.grantDir ? { grantDir: fromFile.grantDir } : {}),
  ...(fromFile.governorPkFile ? { governorPkFile: fromFile.governorPkFile } : {}),
  // FOUND BY THE PARITY COURT, AND IT PREDATES THIS WORK: policy.js:536 reads `config.wantGrantKind` to
  // build the grant expectations, and this file never forwarded it — so the grant KIND could not be
  // configured through a real launch either. The same defect class as the admission cut, in a field
  // nobody had looked at, which is exactly what a parity check is for.
  ...(fromFile.wantGrantKind !== undefined ? { wantGrantKind: optionalString('wantGrantKind', fromFile.wantGrantKind) } : {}),
  // ── THE ADMISSION CUT ──────────────────────────────────────────────────────────────────────────
  ...(fromFile.pilotArtifact ? { pilotArtifact: optionalObject('pilotArtifact', fromFile.pilotArtifact) } : {}),
  ...(fromFile.pilotGrant ? { pilotGrant: optionalObject('pilotGrant', fromFile.pilotGrant) } : {}),
  // REQUIREGRANT IS THE LAUNCHER'S VERDICT, taken from Aumlok's detector before the process existed —
  // `ownerDaemonStatus()` is async and `installPolicy` is synchronous, so the answer travels in the
  // config rather than being probed here. A second detector is a second answer.
  ...(fromFile.requireGrant !== undefined ? { requireGrant: optionalBoolean('requireGrant', fromFile.requireGrant) } : {}),
  ...(fromFile.pilotDaemonKeyPath !== undefined ? { pilotDaemonKeyPath: optionalString('pilotDaemonKeyPath', fromFile.pilotDaemonKeyPath) } : {}),
  ...(fromFile.pilotRelease !== undefined ? { pilotRelease: optionalString('pilotRelease', fromFile.pilotRelease) } : {}),
  ...(fromFile.pilotRoot !== undefined ? { pilotRoot: optionalString('pilotRoot', fromFile.pilotRoot) } : {}),
  ...(fromFile.pilotScope !== undefined ? { pilotScope: optionalStringArray('pilotScope', fromFile.pilotScope) } : {}),
  // ── THE SET GRANT, SAME PATH ───────────────────────────────────────────────────────────────────
  ...(fromFile.pluginSet ? { pluginSet: optionalObject('pluginSet', fromFile.pluginSet) } : {}),
  ...(fromFile.setGrant ? { setGrant: optionalObject('setGrant', fromFile.setGrant) } : {}),
  // ── D3: THE ROOT A GRANT'S pluginPath IS RELATIVE TO (the launcher writes the release directory) ──
  ...(fromFile.grantRoot !== undefined ? { grantRoot: optionalString('grantRoot', fromFile.grantRoot) } : {}),
  // ── THE AUKORA PLUGIN SET (src/plugin-set.mjs), FROM THE CONFIG FILE ONLY ─────────────────────
  // The record is the release's `.dsh-build/plugin-set.json`; the approval and the pinned approver live in
  // the deployment's gate-state. `pluginSetMode` is `enforce` unless the launch passed --allow-unapproved.
  ...(fromFile.pluginSetPath !== undefined ? { pluginSetPath: optionalString('pluginSetPath', fromFile.pluginSetPath) } : {}),
  ...(fromFile.pluginSetRoot !== undefined ? { pluginSetRoot: optionalString('pluginSetRoot', fromFile.pluginSetRoot) } : {}),
  ...(fromFile.pluginSetMode !== undefined ? { pluginSetMode: optionalString('pluginSetMode', fromFile.pluginSetMode) } : {}),
  ...(fromFile.pluginSetPolicy !== undefined
    ? { pluginSetPolicy: optionalStringArray('pluginSetPolicy', fromFile.pluginSetPolicy) } : {}),
  ...(fromFile.pluginSetApprovalPath !== undefined
    ? { pluginSetApprovalPath: optionalString('pluginSetApprovalPath', fromFile.pluginSetApprovalPath) } : {}),
  ...(fromFile.pluginSetPinPath !== undefined
    ? { pluginSetPinPath: optionalString('pluginSetPinPath', fromFile.pluginSetPinPath) } : {}),
});
