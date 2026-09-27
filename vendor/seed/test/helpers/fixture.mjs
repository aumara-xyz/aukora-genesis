// aukora · test/helpers/fixture.mjs — a throwaway repo to attack

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';

/**
 * A repo with a law file, a protected tree, an innocent tree, and every alias
 * an attacker gets for free on macOS.
 *
 * The root is realpath'd because `os.tmpdir()` on macOS is `/var/folders/…` and
 * `/var` is itself a symlink to `/private/var`. A test that skipped this would
 * be testing the symlink resolver against the symlink resolver.
 */
export function makeRepo(extraLaw = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-test-')));

  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'secrets'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.js'), 'export const ok = 1;\n');
  writeFileSync(join(root, 'secrets', 'key.txt'), 'sensitive\n');
  writeFileSync(join(root, '.claude', 'settings.json'), '{}\n');
  writeFileSync(join(root, 'aukora.law.json'), JSON.stringify({
    schema: 'aukora-law-v0',
    protected: ['secrets/**', ...(extraLaw.protected ?? [])],
    ...extraLaw,
  }, null, 2));

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A symlink at `from` pointing at `to`. Returns the repo-relative name. */
export function link(root, from, to) {
  const abs = join(root, from);
  mkdirSync(dirname(abs), { recursive: true });
  symlinkSync(to, abs);
  return from;
}

/** A hard link at `from` to the existing file `to`. */
export function hardlink(root, from, to) {
  const abs = join(root, from);
  mkdirSync(dirname(abs), { recursive: true });
  linkSync(join(root, to), abs);
  return from;
}

/**
 * The fence Aukora is NOT.
 *
 * A purely lexical matcher — `resolve`, `relative`, string prefix — which is
 * what every one of these guards would be if nobody had gone looking. Kept in
 * the test tree on purpose: each attack runs against BOTH, so EVIDENCE.md can
 * show the naive one letting it through and the real one catching it, and both
 * halves stay runnable forever instead of being a screenshot in a document.
 */
export function naiveJudge(root, raw, patterns) {
  if (typeof raw !== 'string' || raw.length === 0) return { protected: false, rule: null };
  const abs = isAbsolute(raw) ? raw : resolve(root, raw);
  const rel = relative(root, abs).split(sep).join('/');
  for (const p of patterns) {
    const base = p.replace(/\/\*\*$/u, '').replace(/\/+$/u, '');
    if (rel === base || rel.startsWith(`${base}/`)) return { protected: true, rule: p };
  }
  return { protected: false, rule: null };
}
