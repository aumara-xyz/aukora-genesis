/**
 * THE SEATBELT PROFILE FOR ANY PROCESS A CORE SESSION COULD SPAWN.
 *
 * The host's own profile is ALLOW-DEFAULT. MEASURED, by calling the shipped builder directly
 * (`vendor/dsh/packages/sandbox/sandbox-local/src/profiles.ts:52`):
 *
 *     (version 1) (allow default) (deny file-write*)
 *     (allow file-write* (literal "/dev/null")) (allow file-write* (subpath "<workspace>") …
 *
 * **`(allow default)` PERMITS EVERYTHING THE PROFILE DOES NOT MENTION** — so a process under it may open
 * any socket, reach any host, and READ every file on the machine, including the launch state, the Kira
 * keys and the owner's sockets. It denies WRITES outside a few roots and nothing else.
 *
 * **THIS MODULE EMITS THE PROFILE AUKORA WANTS INSTEAD.** It is a pure string builder so the profile can
 * be asserted without running `sandbox-exec`, and it is deliberately separate from the module that
 * decides the read-deny: one states paths, the other states a program.
 *
 * **THE WHOLE CORRECTNESS OF AN SBPL PROFILE IS RULE ORDER, AND THAT IS WHY IT IS TESTED.**
 * Seatbelt evaluates every rule and the LAST one that matches decides. So a profile that denies the
 * protected paths BEFORE the broad allows would grant them straight back, and it would look correct to
 * anyone reading the denies first. The order below is: default, then what is needed to run, then what
 * is needed to work, **and the denies LAST so that nothing can reinstate what they refuse.**
 *
 * @module @aukora/dsh-plugin-core-read-deny/seatbelt
 */

import { join } from 'node:path'

import { CORE_PROTECTED } from './policy.mjs'

/**
 * The paths a spawned process needs to READ to start at all.
 *
 * **THIS LIST IS THE HONEST COST OF `(deny default)`, AND IT IS NOT A CONVENIENCE.** A deny-default
 * profile that omits these does not produce a safer process; it produces one that cannot exec, which
 * reads as the sandbox working. The system roots are read-only by construction.
 */
export const SYSTEM_READ_ROOTS = Object.freeze([
  '/usr', '/bin', '/sbin', '/System', '/Library', '/private/var/db/dyld', '/dev/null', '/dev/urandom',
])

/**
 * The temp roots the host profile grants writes to, kept in step with the shipped one.
 *
 * **A PROCESS THAT MAY WRITE SOMEWHERE MUST BE ABLE TO READ WHAT IT WROTE**, or an ordinary build step
 * fails in a way that reads as the sandbox refusing the build.
 */
export const TEMP_ROOTS = Object.freeze(['/tmp', '/private/tmp'])

/** Rights a process needs that are not file or network access. */
export const PROCESS_RIGHTS = Object.freeze([
  '(allow process-exec)',
  '(allow process-fork)',
  '(allow sysctl-read)',
  '(allow mach-lookup)',
])

/**
 * Build the SBPL profile for a CORE-spawned process.
 *
 * @param {object} input - the deployment's roots.
 * @param {string} input.deploymentRoot - the directory the policy's relative paths are relative TO.
 * @param {string} input.workspaceRoot - the one directory the process may write inside.
 * @param {readonly string[]} [input.protectedPaths] - DEPLOYMENT-RELATIVE paths denied for reading;
 *   defaults to the read policy's own list, so the profile and the policy cannot disagree.
 * @param {readonly string[]} [input.extraReadRoots] - further read roots the caller has justified.
 * @returns {string[]} `sandbox-exec` arguments, before the command argv.
 */
export function coreSeatbeltProfileArgs({ deploymentRoot, workspaceRoot, protectedPaths, extraReadRoots = [] }) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
    // **A PROFILE WITH NO WORKSPACE IS NOT A PROFILE WITH NO WRITES.** Defaulting it would silently widen
    // or narrow the sandbox, and either way the caller would not know which.
    throw new TypeError('coreSeatbeltProfileArgs needs the workspace root the process may write inside')
  }
  if (typeof deploymentRoot !== 'string' || !deploymentRoot.startsWith('/')) {
    // **A SEATBELT `subpath` FILTER NEEDS AN ABSOLUTE PATH, AND A RELATIVE ONE MATCHES NOTHING.**
    // MEASURED, by printing this profile: the first version emitted `(deny file-read* (subpath
    // "state/launch.json"))`, which is a deny that can never fire — **so the profile looked like it
    // protected five doors and protected none of them.** The caller must say what the policy's relative
    // paths are relative to, rather than this module guessing a root.
    throw new TypeError('coreSeatbeltProfileArgs needs an absolute deploymentRoot: a relative subpath '
      + 'filter matches nothing, so the denies would be printed and never applied')
  }
  const denied = (protectedPaths ?? defaultProtectedPaths())
    .map(path => (path.startsWith('/') ? path : join(deploymentRoot, path)))
  const forms = [
    '(version 1)',
    // ── 1. NOTHING IS ALLOWED UNLESS SOMETHING BELOW ALLOWS IT ────────────────────────────────────────
    '(deny default)',
    // ── 2. WHAT A PROCESS NEEDS TO EXIST ──────────────────────────────────────────────────────────────
    ...PROCESS_RIGHTS,
    // **EACH PATH NEEDS ITS OWN FILTER.** MEASURED: `(allow file-read* '/usr' '/bin')` is not valid
    // SBPL — `sandbox-exec` answers `illegal argument: '/usr'` and runs NOTHING, which is the loudest
    // possible failure and the easiest to misread as the sandbox working.
    `(allow file-read* ${[...SYSTEM_READ_ROOTS, ...extraReadRoots].map(root => `(subpath ${literal(root)})`).join(' ')})`,
    // ── 3. WHAT IT NEEDS TO WORK — THE SAME WRITE ROOTS THE HOST PROFILE GRANTS, AND NO MORE ─────────
    //
    // **A WRITE GRANT IS NOT A READ GRANT, AND THE FIRST VERSION OF THIS PROFILE LEARNED THAT THE HARD
    // WAY.** MEASURED: with only `(allow file-write* (subpath <workspace>))`, a process under this
    // profile could not read the work it was supposed to be doing — `cat` on a file in its own workspace
    // printed nothing at all. **A sandbox that denies the work is not a stricter sandbox; it is a broken
    // one, and it fails in the direction that looks like success.**
    // **METADATA ON EVERY ANCESTOR IS WHAT MAKES A PATH RESOLVABLE AT ALL.** MEASURED: without this,
    // `cat` on a file the profile grants died with SIGABRT (exit 134) rather than being refused —
    // because resolving `/a/b/c` needs `stat` on `/`, `/a` and `/a/b` before any read is attempted.
    // **It grants NAMES, NOT CONTENTS**: a process may learn that a path exists and still be refused the
    // bytes, which is exactly the distinction this profile turns on.
    '(allow file-read-metadata)',
    `(allow file-read* (subpath ${literal(workspaceRoot)}))`,
    `(allow file-write* (literal ${literal('/dev/null')}))`,
    `(allow file-write* (subpath ${literal(workspaceRoot)}))`,
    // The temp roots the host profile grants writes to; a process that may write there must be able to
    // read what it wrote.
    ...TEMP_ROOTS.map(root => `(allow file-read* (subpath ${literal(root)}))`),
    ...TEMP_ROOTS.map(root => `(allow file-write* (subpath ${literal(root)}))`),
    // ── 4. AND THE DENIES LAST, BECAUSE THE LAST MATCHING RULE DECIDES ────────────────────────────────
    //
    // **THIS POSITION IS THE PROTECTION.** Anywhere above, the read grant in step 2 or the write grant in
    // step 3 would match later and hand the path straight back.
    ...denied.map(path => `(deny file-read* (subpath ${literal(path)}))`),
    // **NETWORK IS DENIED BY DEFAULT AND NOT RE-ALLOWED AT ALL.** CORE has no network tool and no shell;
    // a spawned process that reaches a host would be the same authority by another road.
    '(deny network*)',
  ]
  return ['-p', forms.join(' ')]
}

/**
 * The paths this profile denies, derived from the read policy's own list.
 *
 * **DERIVED RATHER THAN RESTATED, SO THE TWO CANNOT DISAGREE.** A second list here would be a second
 * place to forget one of the doors, and the profile would then protect a path the read policy denies —
 * or the reverse, which is worse, because the profile is what a spawned process meets.
 *
 * @returns {readonly string[]} slash-free path tails to deny.
 */
export function defaultProtectedPaths() {
  return Object.freeze(CORE_PROTECTED
    .filter(rule => rule.kind === 'file' || rule.kind === 'dir')
    .map(rule => rule.path))
}

/**
 * Wrap one path for SBPL. Backslashes and quotes are escaped, and the path is always quoted.
 *
 * @param {string} path - the path to wrap.
 * @returns {string} the quoted literal.
 */
function literal(path) {
  return `"${String(path).replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}
