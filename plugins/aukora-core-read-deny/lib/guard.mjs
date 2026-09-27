/**
 * THE GUARD: a filesystem provider that refuses CORE the keys to the house.
 *
 * This is the part that actually denies a read. It wraps a provider — the same way the harness's own
 * `SandboxedFileSystem` wraps `LocalFileSystem` — and it decides, per call, whether the reading session
 * is CORE. **IT IS DEPENDENCY-FREE ON PURPOSE: it takes an inner provider and returns a guarded one, so
 * the denial can be measured against a real object without mounting a service.**
 *
 * WHY THE WRAPPER AND NOT A PRESET ROW. A preset cannot scope a read. MEASURED: `dsh-tool-fs` declares
 * `inject = ['tools', 'fs', 'systemPrompt']`, and the preset mount (`preset/agent-presets/src/mount.ts`)
 * resolves injection before any session exists — *"such a service belongs on the host plane."* The
 * harness's own answer is the swap: *"loading it INSTEAD OF `dsh-fs-local` … is the whole swap — the
 * model-facing tools are untouched."* **This module is that swap's contents.**
 *
 * @module @aukora/dsh-plugin-core-read-deny/guard
 */

import { coreReadRefusal } from './policy.mjs'

/** The methods that return file CONTENTS, and so are the ones a read-deny has to cover. */
export const READ_METHODS = Object.freeze(['readText', 'readBytes', 'readByteRange', 'readStream'])

/**
 * Wrap a filesystem provider so that a CORE session cannot read the protected paths.
 *
 * **A REFUSAL IS A NAME AND A MESSAGE, NEVER AN EMPTY FILE.** Every guarded method throws, so a caller
 * cannot mistake a denied read for a file with nothing in it — and the thrown error carries `code`, the
 * rule that refused it, and the target, so a log says which door was met rather than that something
 * failed.
 *
 * @param {object} inner - the provider to delegate to. Every method other than a read is passed through.
 * @param {object} options - how to learn who is reading, and what to protect.
 * @param {() => (string|null|undefined)} options.presetOf - returns the reading session's preset, or a
 *   nullish value when there is no session (a cold host read) or none could be determined.
 * @param {(target: unknown) => string} [options.resolveForCheck] - turns a target into the absolute,
 *   symlink-resolved path to test. **REQUIRED**, and it must be the resolver the deployment actually opens
 *   through — see the refusal below for why a default is not available.
 * @param {readonly object[]} [options.rules] - the protected rows; defaults to the read policy's own.
 * @returns {object} a provider with the same surface, guarded.
 */
export function guardReads(inner, { presetOf, resolveForCheck, rules }) {
  if (typeof presetOf !== 'function') {
    // **A GUARD THAT CANNOT LEARN WHO IS READING MUST NOT BE BUILT AT ALL.** Defaulting it to "nobody"
    // would produce a guard that silently permits every CORE read while looking installed, which is
    // strictly worse than not mounting one.
    throw new TypeError('guardReads needs presetOf: a guard that cannot tell who is reading permits '
      + 'every read while appearing to be installed')
  }
  if (typeof resolveForCheck !== 'function') {
    // **A GUARD THAT CANNOT RESOLVE MUST NOT PRETEND TO HAVE CHECKED (CODEX SWEEP, FINDING 3).** MEASURED: the
    // default was `String`, and the mount supplied none — **so the check ran against the LINK TEXT while the
    // open followed the link.** This policy's own contract says the target must already be symlink-resolved
    // (*"a symlink whose link text is innocent and whose referent is `kira-memory/keys` is a read of the
    // keys"*), so a guard that checks an unresolved name is checking a different file from the one it reads.
    // **Same shape as a guard that cannot tell who is reading, and it must fail the same way.**
    throw new TypeError('guardReads needs resolveForCheck: without a resolver the guard checks the name a '
      + 'caller wrote while the provider opens whatever that name points at, so a symlink to a protected path '
      + 'passes the check and is read anyway')
  }
  const guarded = Object.create(inner)
  for (const method of READ_METHODS) {
    if (typeof inner[method] !== 'function') continue
    guarded[method] = function guardedRead(...args) {
      // **THE PRESET IS READ PER CALL, NOT CAPTURED AT MOUNT.** A guard built once serves every session,
      // so a value captured at construction would be the preset of whoever happened to be first.
      const resolved = resolveForCheck(args[0])
      const met = coreReadRefusal({
        preset: presetOf(),
        target: resolved,
        ...rules === undefined ? {} : { rules },
      })
      if (met !== null) throw readDenied(met)
      // **THE PROVIDER IS HANDED THE PATH THAT WAS CHECKED, NOT THE ONE THE CALLER WROTE (CODEX SWEEP,
      // FINDING 3).** MEASURED: it delegated the ORIGINAL argument, so even a guard with a correct resolver
      // checked one path and opened another. **A check that is not bound to the open is a check of a
      // different file**, which is the whole of this finding: it is not enough to resolve before checking,
      // the resolved path has to be the one that is used.
      // **THE PROVIDER IS HANDED THE CALLER'S TARGET, NOT THE RESOLVED STRING (AUMLOK-95, MEASURED).**
      //
      // This used to pass `[resolved, ...args.slice(1)]`. **MEASURED AGAINST THE VENDOR'S OWN PROVIDER:**
      //
      //     readText('/private/tmp/…/innocent.txt')       -> THREW ERR_INVALID_ARG_TYPE
      //     readText(await resolve('/private/tmp/…/…'))   -> OK "INNOCENT\n"
      //
      // **The read methods take an `FsTarget`, and a path string is not one** — so EVERY guarded read threw,
      // for EVERY session, CORE and standard alike. **The file system was dark behind the guard.**
      //
      // **AND CODEX SWEEP FINDING 3 STILL HOLDS.** That finding was that this delegated the ORIGINAL argument
      // while checking a different one, so the check and the open could name different files. **They no longer
      // can**: `realResolver` derives the checked path from the target's own `targetKey`, which is the
      // symlink-resolved path the provider itself uses as the key it opens. **The check is bound to the open
      // by construction rather than by two computations that ought to agree.**
      // ── WHAT THE PROVIDER IS HANDED, AND WHEN THE TARGET MAY BE PASSED THROUGH ─────────────────────
      //
      // **THERE ARE TWO CALLER SHAPES AND THEY NEED DIFFERENT ARGUMENTS, WHICH IS WHY THE FIRST VERSION OF
      // THIS FIX BROKE A COURT.**
      //
      //   * A REAL CALLER PASSES AN `FsTarget` — `{ targetKey, displayPath }` — and `targetKey` IS the
      //     symlink-resolved path. **`realResolver` derives the checked path FROM that key**, so handing the
      //     target over means the thing checked and the thing opened are the same string BY CONSTRUCTION.
      //   * A CALLER THAT PASSES A STRING has its path resolved here, and **the provider must then be handed
      //     the RESOLVED path** — otherwise the guard checks one file and the provider opens the one the
      //     caller wrote, which is Codex sweep finding 3 exactly.
      //
      // **THE CONDITION IS THE EQUALITY, NOT THE SHAPE**: the target travels only when the checked path IS
      // its own key. Anything else falls back to the resolved path, so the check stays bound to the open in
      // both shapes rather than only in the one this item happened to need.
      const target = args[0]
      const carriesTheCheckedPath = target !== null && typeof target === 'object'
        && typeof target.targetKey === 'string' && target.targetKey === resolved
      const bound = args.length === 0 || carriesTheCheckedPath
        ? args
        : [resolved, ...args.slice(1)]
      return inner[method].apply(this === guarded ? inner : this, bound)
    }
  }
  return guarded
}

/**
 * The error a denied read throws.
 *
 * @param {{code: string, rule: string, target: string, why: string}} met - the policy's refusal.
 * @returns {Error} a refusal carrying its own name, rule and target.
 */
export function readDenied(met) {
  const error = new Error(
    `CORE cannot read ${met.target}: ${met.why}. The rule that refused it is \`${met.rule}\``)
  error.code = met.code
  error.rule = met.rule
  error.target = met.target
  return error
}
