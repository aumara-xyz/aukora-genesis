// aukora-composition-gate — the Cordis-facing entry.
//
// WHAT THIS FILE DOES AND DOES NOT DO. It loads as a plugin, prints the ceilings, and exposes
// the gate's decided state for inspection. It CANNOT enforce: by the time any plugin's
// `apply()` runs, the governed module has already been imported — measured at 151 ms earlier —
// so a hook installed here arrives second. Enforcement therefore lives in `policy.js`,
// installed as a node bootstrap (`install.js`), and this file says so rather than implying
// coverage it does not have.
//
// Installing it in a profile is still useful: it is where the ceilings and the inspection
// surface belong, and where an operator can see whether the hook is actually in place. If the
// hook is absent it says so in the loudest terms available, because a gate that looks
// installed and enforces nothing is the worst state this brick can be in.

import { CEILINGS, installPolicy, policyHandle } from './policy.js';

export const name = 'aukora-composition-gate';

export function apply(ctx, config = {}) {
  const log = (line) => console.log(`[composition-gate] ${line}`);
  for (const ceiling of CEILINGS) log(`CEILING: ${ceiling}`);
  log('ATTENDANCE: reported-not-proven');

  let handle = policyHandle();

  // If the bootstrap is missing, this plugin can still install the hook — it will simply be
  // too late for anything already imported. It does that rather than loading inert, and it
  // reports exactly how much of the boot it could not cover.
  if (!handle && (config.installIfMissing ?? true) && config.stateDir) {
    try {
      handle = installPolicy({
        governed: config.governed ?? [],
        governedFiles: config.governedFiles ?? [],
        stateDir: config.stateDir,
        ...(config.grantDir ? { grantDir: config.grantDir } : {}),
        ...(config.governorPkFile ? { governorPkFile: config.governorPkFile } : {}),
      });
      log('NOTE: the hook was NOT installed as a node bootstrap, so it was installed here.');
      log('      Everything the application imported BEFORE this line was not covered.');
      log('      For coverage from the first import, start node with --import of install.js.');
    } catch (err) {
      log(`WARNING: could not install the policy from the plugin either: ${err.message}`);
    }
  }

  if (!handle) {
    log('NO ENFORCEMENT IS IN PLACE. The admission hook was not installed as a node bootstrap');
    log('and no state directory was configured for this plugin to install one. Governed files');
    log('will load. Any enforcement test run against this process is void.');
  }

  ctx.on('internal/ready', () => {
    if (!handle) return;
    const status = handle.status();
    log(`readiness: ${status.accepted.length} accepted, ${status.refusals.length} refused`);
    const set = status.pluginSet;
    if (set) {
      log(`plugin set (${set.mode}): ${String(set.admitted.length)} of ${String(set.count)} AUKORA plugins loaded `
        + `through their approved record, ${String(set.checkedLoads)} file load(s) checked, `
        + `${String(set.tainted.length)} with changed bytes${set.tainted.length ? ` (${set.tainted.join(', ')})` : ''}`);
      const missing = set.ids.filter((id) => !set.admitted.includes(id));
      if (missing.length) log(`  not loaded through the record: ${missing.join(', ')} (refused above, or not imported by this composition)`);
    }
  }, { global: true });

  const surface = {
    ceilings: [...CEILINGS],
    enforcement: handle ? 'policy installed' : 'NOT INSTALLED — this process refuses nothing',
    governed: handle ? handle.governed : [],
    digestCovers: handle ? handle.digestCovers : 'nothing: no hook is installed',
    status: () => (handle ? handle.status() : { accepted: [], refusals: [], governed: [] }),
  };
  if (typeof ctx.provide === 'function') ctx.provide('aukora.composition.gate', surface);
  return surface;
}
