// φ · seed/core.mjs — THE MOUNT. Loads the wasm law core, and holds it against φ's own JS law.
//
// ══ THE ONE RULE THIS FILE EXISTS FOR ══
//
// When the wasm and the JS disagree about a path, that is a LOUD FAILURE. Not a preference for either.
// A mount that silently picked the wasm would be a second law nobody voted for; one that silently
// picked the JS would make the core decoration. Both are the same defect — a disagreement absorbed
// instead of reported — and this project has a name for it: an instrument whose failure mode is
// indistinguishable from a clean result.
//
// ══ AND ABSENCE IS SAID IN WORDS ══
//
// `seed/dist/core.wasm` may not be there: a fresh clone before a build, a platform where it did not
// compile. Then `judgeBoth` reports `agreement: 'wasm-absent'` and returns the JS verdict, and NOTHING
// anywhere claims two judges agreed. "Both judged and agreed" and "one judged" are different sentences
// and only one of them is true at a time.

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CORE_WASM = join(HERE, 'dist', 'core.wasm');

/** 0 ok · 1 malformed · 2 traversal · 3 ring0 · 4 undeclared. The shared vocabulary, named once. */
export const REFUSAL = Object.freeze({
  OK: 0, MALFORMED: 1, TRAVERSAL: 2, RING0: 3, UNDECLARED: 4,
});
export const REFUSAL_NAME = Object.freeze(['ok', 'malformed', 'traversal', 'ring0', 'undeclared']);

let cached = null;

/**
 * Load the core. `{ ok: false, why }` when it is not there — never a throw, because a missing build
 * artifact is an ordinary state of a fresh clone and not an error in the caller.
 */
export function loadCore() {
  if (cached) return cached;
  if (!existsSync(CORE_WASM)) {
    cached = { ok: false, why: `no wasm core at ${CORE_WASM} — run \`bun run build:core\`` };
    return cached;
  }
  try {
    const mod = new WebAssembly.Module(readFileSync(CORE_WASM));
    // NO IMPORTS BEYOND ABORT. The core does no I/O, reaches no clock and takes no host function that
    // could decide anything — so the surface it presents to this process is exactly its exports.
    const inst = new WebAssembly.Instance(mod, {
      env: {
        abort: (msg, file, line, col) => {
          throw new Error(`wasm core aborted at ${line}:${col}`);
        },
      },
    });
    const ex = inst.exports;
    const id = probeStringId(ex);
    if (id < 0) {
      cached = { ok: false, why: 'the wasm core loaded but its string class id could not be probed — refusing to guess' };
      return cached;
    }
    // ON THE CACHE, NOT ON THE EXPORTS. A WebAssembly exports object is read-only: assigning the id
    // onto it succeeded silently and read back `undefined`, so every string was allocated with class
    // id `undefined` and the digests came out wrong with nothing throwing. Measured, not reasoned.
    cached = { ok: true, exports: ex, stringId: id };
  } catch (e) {
    cached = { ok: false, why: `the wasm core would not instantiate: ${e?.message ?? e}` };
  }
  return cached;
}

// ── STRING MARSHALLING, BY HAND ──────────────────────────────────────────────────────────────
//
// `--exportRuntime` on this AssemblyScript gives `__new`/`__pin` and NOT `__newString`/`__getString`,
// so the conversion is done here. AS strings are UTF-16LE with the byte length in the object header
// four bytes before the pointer.
//
// THE CLASS ID WAS MEASURED, NOT ASSUMED. It is probed once at load by allocating an empty string and
// checking that `sha256Hex('')` returns the known digest of the empty input — so a future compiler that
// renumbers its classes fails here, loudly, instead of silently hashing whatever the wrong id produced.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function probeStringId(ex) {
  for (let id = 0; id < 8; id++) {
    try {
      const ptr = ex.__new(0, id);
      ex.__pin(ptr);
      const got = readStr(ex, ex.sha256Hex(ptr));
      ex.__unpin(ptr);
      if (got === EMPTY_SHA256) return id;
    } catch { /* the wrong id traps or garbles; both mean keep looking */ }
  }
  return -1;
}

function readStr(ex, ptr) {
  const len = new Uint32Array(ex.memory.buffer)[(ptr - 4) >>> 2] >>> 1;
  return String.fromCharCode(...new Uint16Array(ex.memory.buffer, ptr, len));
}

/**
 * Allocate an AS string AND PIN IT.
 *
 * MEASURED, and it is the whole reason this function is not two lines: `pathRefusalCore` takes three
 * strings, so three `__new` calls happen before the call. Without `__pin`, the collector is free to
 * reclaim the FIRST string while the third is being allocated — and the failure is length-dependent,
 * so short paths pass and long ones return garbage. The sweep over every tracked file caught it:
 * `seed/core.ts` (12 chars) agreed, `conformance/sandbox.ts` (22) came back as traversal.
 *
 * Callers must `unpinAll` when the call returns.
 */
function put(ex, s, stringId, pins) {
  const ptr = ex.__new(s.length * 2, stringId);
  ex.__pin(ptr);
  pins.push(ptr);
  const view = new Uint16Array(ex.memory.buffer, ptr, s.length);
  for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i);
  return ptr;
}

function unpinAll(ex, pins) {
  for (const p of pins) { try { ex.__unpin(p); } catch { /* already gone */ } }
}
function get(ex, ptr) { return readStr(ex, ptr); }

export function coreSha256Hex(s) {
  const c = loadCore();
  if (!c.ok) return null;
  const ex = c.exports;
  const pins = [];
  try { return get(ex, ex.sha256Hex(put(ex, s, c.stringId, pins))); }
  finally { unpinAll(ex, pins); }
}

export function corePathRefusal(path, protectedPats, writablePats) {
  const c = loadCore();
  if (!c.ok) return null;
  const ex = c.exports;
  const pins = [];
  try {
    return ex.pathRefusalCore(
      put(ex, path, c.stringId, pins),
      put(ex, (protectedPats ?? []).join('\n'), c.stringId, pins),
      put(ex, (writablePats ?? []).join('\n'), c.stringId, pins),
    );
  } finally { unpinAll(ex, pins); }
}

export function coreGrantsAuthority() {
  const c = loadCore();
  // ABSENT IS NOT PERMISSIVE. A core that failed to load must not be readable as "it did not refuse".
  if (!c.ok) return false;
  return c.exports.coreGrantsAuthority() !== 0;
}

// ── addr27, the wasm side ────────────────────────────────────────────────────────────────────
export const addr27 = Object.freeze({
  encode: (t2, t1, t0) => { const c = loadCore(); return c.ok ? c.exports.addr27Encode(t2, t1, t0) : null; },
  trit: (a, i) => { const c = loadCore(); return c.ok ? c.exports.addr27Trit(a, i) : null; },
  shell: (a) => { const c = loadCore(); return c.ok ? c.exports.addr27Shell(a) : null; },
  distance: (a, b) => { const c = loadCore(); return c.ok ? c.exports.addr27Distance(a, b) : null; },
  centre: () => { const c = loadCore(); return c.ok ? c.exports.addr27Centre() : null; },
  fromBits: (b) => { const c = loadCore(); return c.ok ? c.exports.addr27FromBits(b) : null; },
});

// ── the JS twin ──────────────────────────────────────────────────────────────────────────────

/**
 * The same five codes, decided by φ'S OWN LAW MODULE rather than by a second implementation.
 *
 * `compilePattern` is imported from `core/witness/law.mjs`, so the pattern language this compares
 * against is the real one. Re-implementing it here would make the parity test compare two things I
 * wrote on the same afternoon, which is agreement with myself and proves nothing.
 */
export async function jsPathRefusal(path, protectedPats, writablePats) {
  const { compilePattern } = await import('../core/witness/law.mjs');
  if (typeof path !== 'string' || path.length === 0) return REFUSAL.MALFORMED;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 0 || c === 92) return REFUSAL.TRAVERSAL;
  }
  if (path.startsWith('/')) return REFUSAL.TRAVERSAL;
  if (/^[A-Za-z]:/.test(path)) return REFUSAL.TRAVERSAL;
  for (const seg of path.split('/')) {
    if (seg.length === 0 || seg === '.' || seg === '..') return REFUSAL.TRAVERSAL;
  }
  const hits = (pats) => (pats ?? [])
    .filter(Boolean)
    .some((p) => { const re = compilePattern(p); return re ? re.test(path) : false; });
  if (hits(protectedPats)) return REFUSAL.RING0;
  if ((writablePats ?? []).filter(Boolean).length > 0 && !hits(writablePats)) return REFUSAL.UNDECLARED;
  return REFUSAL.OK;
}

export function jsSha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ── the mount: both judge, and a disagreement is loud ────────────────────────────────────────

/**
 * Ask both, and report WHAT HAPPENED rather than an answer alone.
 *
 *   agreement: 'agreed'       both ran and said the same thing
 *   agreement: 'wasm-absent'  only the JS ran, and this says so
 *   agreement: 'DISAGREED'    both ran and differ — `ok` is false and neither verdict is preferred
 *
 * The disagreement case deliberately does NOT return a verdict. A caller that wanted one would have to
 * choose a winner, and choosing a winner in this function is the thing that must not happen quietly.
 */
export async function judgeBoth(path, protectedPats, writablePats, opts = {}) {
  // INJECTABLE TWIN, so the disagreement branch is REACHABLE. Without a seam the only way to exercise
  // it is to break one of the two implementations, and a fixture that edits its own subject proves
  // nothing. Defaults to the real twin, so production takes exactly the path production always took.
  const twin = opts.jsTwin ?? jsPathRefusal;
  const js = await twin(path, protectedPats, writablePats);
  const core = loadCore();
  if (!core.ok) {
    return {
      ok: true,
      agreement: 'wasm-absent',
      verdict: js,
      js,
      wasm: null,
      why: core.why,
      said: `the wasm core did not judge this — ${core.why}. Only the JS law ran.`,
    };
  }
  const wasm = corePathRefusal(path, protectedPats, writablePats);
  if (wasm !== js) {
    return {
      ok: false,
      agreement: 'DISAGREED',
      verdict: null,
      js,
      wasm,
      said: `the wasm core and the JS law disagree about ${JSON.stringify(path)}: `
        + `wasm says ${REFUSAL_NAME[wasm] ?? wasm}, JS says ${REFUSAL_NAME[js] ?? js}. `
        + 'Neither is preferred and no verdict is returned — one of the two is wrong and which is not '
        + 'a thing this function may decide.',
    };
  }
  return { ok: true, agreement: 'agreed', verdict: js, js, wasm, said: null };
}

/** A mount is not an authority. Stated as a literal, like every other ring in this repository. */
export function coreMountGrantsAuthority() {
  return false;
}
