/**
 * Release-strip semantics, shared by the producer and the consumer.
 *
 * A materialized release is the tree a launch actually loads. Upstream's built tree
 * still carries material that never runs in a release: its own agent notes (.agents/),
 * its documentation and translation twins, every package's sources and tests, the
 * build tooling, the Python SDK and the CI configuration. Those bytes make the tree
 * unreadable and they cannot be executed, so the release drops them — and says so.
 *
 * The producer (scripts/release-strip.mjs, invoked by scripts/materialize-aukora-release.py)
 * selects, hashes, deletes and records. The consumer (scripts/lib/artifact-integrity.mjs,
 * driven by scripts/genesis-check.mjs) refuses a release that still carries a selected
 * path, and refuses a strip manifest that the artifact record does not attest.
 *
 * No rule is hard-coded here: the patterns, the keep policy and the scan exclusions come
 * from scripts/artifacts-coverage.json, whose digest every artifact record carries. A
 * declaration edited after a release was recorded therefore fails that release's check.
 *
 * Selection is an explicit tree walk with an explicit pattern grammar, not a glob call.
 * A glob would silently do the wrong thing here: Node's `**` does not descend into
 * dot-directories, so `**\/*.zh.md` misses every translation twin under .agents/ — the
 * single largest block of stripped bytes. A pattern this module cannot parse is an error,
 * never a no-op, so a future declaration edit cannot quietly disable a rule.
 */
import { createHash } from 'node:crypto';
import { existsSync, globSync, lstatSync, readFileSync, readlinkSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Manifest schema version written and accepted by this module. */
export const STRIP_MANIFEST_FORMAT = 1;

/** Human-stable identifier stored in every strip manifest. */
export const STRIP_MANIFEST_KIND = 'aukora-release-strip';

/**
 * Built code that runs in a release. These are the bytes the keep policy greps: a path
 * under scripts/ or python/ that any of them names is kept, because deleting it could
 * break a runtime path no source-level check would catch.
 */
export const RUNTIME_SCAN_PATTERNS = [
  'apps/*/lib/**/*.js',
  'apps/*/lib/**/*.mjs',
  'apps/*/lib/**/*.cjs',
  'apps/*/dist/**/*.js',
  'apps/*/dist/**/*.html',
  'packages/*/*/lib/**/*.js',
  'vendor/*/lib/**/*.js',
  'plugins/*/lib/**/*.js',
];

/** A path-like reference to the build tooling or the Python tree inside built code. */
const RUNTIME_PATH_REFERENCE = /(?:^|[^\w.-])((?:\.{0,2}\/)*(?:scripts|python)\/[\w./-]+)/gu;

/** Hash one file's bytes. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Byte count and digest of one removable entry, without following anything.
 * Removing a symlink removes the link, never its target, so a link is measured by the
 * text it carries — reading through it would either hash bytes the strip does not
 * remove or fail on a link to a directory.
 * @param absolute - path to the entry.
 * @returns the byte count and digest the manifest records for it.
 */
export function entryDigest(absolute) {
  const stats = lstatSync(absolute);
  if (stats.isSymbolicLink()) {
    const target = readlinkSync(absolute);
    return { bytes: stats.size, sha256: sha256Buffer(Buffer.from(target)) };
  }
  return { bytes: stats.size, sha256: sha256File(absolute) };
}

/** Hash an arbitrary buffer. */
export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Turn one declared pattern into a predicate over release-relative paths.
 * Supported shapes are the ones the declaration uses; anything else throws.
 * @param pattern - one entry of strip.patterns.
 * @returns predicate over a normalized release-relative path.
 */
export function selectionMatcher(pattern) {
  if (pattern.startsWith('**/*') && pattern.length > 4) {
    const suffix = pattern.slice(4);
    return path => path.endsWith(suffix);
  }
  const rootDirectory = /^([^/*]+)\/\*\*$/u.exec(pattern);
  if (rootDirectory !== null) {
    const [name] = [rootDirectory[1]];
    return path => path === name || path.startsWith(`${name}/`);
  }
  const nestedDirectory = /^([^/*]+)\/(\*)\/(\*)\/([^/*]+)\/\*\*$/u.exec(pattern);
  if (nestedDirectory !== null) {
    const group = nestedDirectory[1];
    const leaf = nestedDirectory[4];
    return path => {
      const segments = path.split('/');
      return segments.length >= 5 && segments[0] === group && segments[3] === leaf;
    };
  }
  const rootPrefix = /^([^/*]+)\*$/u.exec(pattern);
  if (rootPrefix !== null) {
    const prefix = rootPrefix[1];
    return path => !path.includes('/') && path.startsWith(prefix) && path.length > prefix.length;
  }
  if (!pattern.includes('*') && !pattern.includes('/')) {
    return path => path === pattern;
  }
  throw new Error(`unsupported-strip-pattern: ${pattern} is not a shape this module understands; refusing to strip with a rule that would do nothing`);
}

/**
 * Turn one `strip.keep` entry into a predicate over release-relative paths.
 *
 * DELIBERATELY NOT `selectionMatcher`. A strip PATTERN selects a directory to delete and is
 * written at the root (`scripts/**`), while a KEEP names a nested path that must survive
 * (`scripts/aura/**`) — a shape `selectionMatcher` rejects, because as a deletion rule it would
 * do nothing. Separate grammars, each refusing what it cannot honor, so neither is widened to
 * accommodate the other. Segment-based rather than suffix-based, so `scripts/aura/**` cannot
 * match `vendor/x/scripts/aura/y`.
 *
 * @param pattern - one entry of strip.keep, or a `!`-prefixed exception to it.
 * @returns predicate over a normalized release-relative path.
 */
export function keepMatcher(pattern) {
  // `!` IS REFUSED, not interpreted. A negation in a KEEP list reads as an exception, but this
  // consumer is additive: a `!`-prefixed entry would be added to the kept set like any other and
  // `!scripts/**` would keep nearly every candidate — the opposite of what the author meant, and
  // silent. Refusing the shape costs nothing today (no declaration uses it) and removes a way to
  // widen the release's contents by writing what looks like a restriction.
  if (pattern.startsWith('!')) {
    throw new Error(`unsupported-strip-keep: ${pattern} starts with '!', which this consumer does not implement; declared keeps are additive, so a negation would keep rather than exclude`);
  }
  const body = pattern;
  if (body === '' || body.includes('//')) {
    throw new Error(`unsupported-strip-keep: ${pattern} is not a shape this module understands`);
  }
  const match = (whole => {
    const segments = body.split('/');
    return path => {
      const parts = path.split('/');
      if (whole && parts.length !== segments.length) return false;
      if (!whole && parts.length < segments.length) return false;
      for (const [index, segment] of segments.entries()) {
        if (segment === '**') continue;
        if (segment !== parts[index]) return false;
      }
      return true;
    };
  })(!body.endsWith('/**'));
  return match;
}

/** Parse strip.scanExclude, which is structured rather than glob-shaped on purpose. */
function scanExclusions(strip) {
  const exclude = strip.scanExclude;
  if (typeof exclude !== 'object' || exclude === null) {
    throw new Error('invalid-strip-declaration: scanExclude must be an object');
  }
  const names = (list, label) => {
    if (!Array.isArray(list) || list.some(item => typeof item !== 'string' || item === '')) {
      throw new Error(`invalid-strip-declaration: scanExclude.${label} must be a list of names`);
    }
    return new Set(list);
  };
  // rootEntries are skipped at the release root only: the installed dependency store is
  // never scanned or counted, while a node_modules *inside* a stripped directory leaves
  // with that directory instead of surviving as a husk.
  return { rootEntries: names(exclude.rootEntries, 'rootEntries'), fileNames: names(exclude.fileNames, 'fileNames') };
}

/**
 * Every file in a tree, relative and sorted, minus the declared scan exclusions.
 * Symlinks count as files and are measured without being followed.
 * @param root - absolute tree root.
 * @param exclude - parsed scan exclusions.
 * @returns sorted release-relative file paths.
 */
export function walkFiles(root, exclude) {
  const files = [];
  const walk = directory => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (directory === root && exclude.rootEntries.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (exclude.fileNames.has(entry.name)) continue;
      files.push(path);
    }
  };
  walk(root);
  return files.sort();
}

/** File count and byte total over one scope of a tree. */
export function treeTotals(root, exclude, excludedPaths = []) {
  const skip = new Set(excludedPaths);
  const files = walkFiles(root, exclude).filter(path => !skip.has(path));
  return {
    files: files.length,
    bytes: files.reduce((total, path) => total + lstatSync(resolve(root, path)).size, 0),
  };
}

/**
 * Every file the strip rules select, relative to the release root.
 * The producer deletes exactly this list; the consumer forbids it.
 * @param release - release root.
 * @param strip - strip declaration from scripts/artifacts-coverage.json.
 * @returns sorted release-relative file paths.
 */
export function stripSelected(release, strip) {
  const matchers = strip.patterns.map(selectionMatcher);
  return walkFiles(release, scanExclusions(strip)).filter(path => matchers.some(matches => matches(path)));
}

/**
 * Paths under scripts/ or python/ that built runtime code names, resolved against the
 * file that names them. These are the keep exceptions: a file the runtime reaches is not
 * stripped even though its directory is.
 * @param release - release root.
 * @param strip - strip declaration from scripts/artifacts-coverage.json.
 * @returns sorted release-relative paths that exist in the release.
 */
export function runtimePathReferences(release, strip) {
  const excluded = [...scanExclusions(strip).rootEntries].map(name => `${name}/**`);
  const referencing = globSync(RUNTIME_SCAN_PATTERNS, { cwd: release, exclude: excluded });
  const found = new Set();
  for (const source of referencing) {
    const absolute = resolve(release, source);
    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    for (const match of content.matchAll(RUNTIME_PATH_REFERENCE)) {
      const reference = match[1];
      const from = reference.startsWith('.') ? dirname(absolute) : release;
      const resolved = resolve(from, reference);
      if (!resolved.startsWith(`${release}${sep}`)) continue;
      const path = relative(release, resolved).replaceAll('\\', '/');
      if (!path.startsWith('scripts/') && !path.startsWith('python/')) continue;
      let stats;
      try {
        stats = lstatSync(resolved);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;
      found.add(path);
    }
  }
  return [...found].sort();
}

/**
 * Remove symlinks whose target no longer resolves inside the release, and return them.
 * After a strip, upstream's own links into stripped material (`.claude/skills ->
 * ../.agents/skills`) point at nothing; a release must not ship a dead link.
 * @param root - release root.
 * @param exclude - parsed scan exclusions.
 * @returns sorted release-relative paths that were removed.
 */
export function removeBrokenLinks(root, exclude) {
  const removed = [];
  for (const path of walkFiles(root, exclude)) {
    const absolute = resolve(root, path);
    if (!lstatSync(absolute).isSymbolicLink()) continue;
    if (existsSync(absolute)) continue;
    unlinkSync(absolute);
    removed.push(path);
  }
  return removed.sort();
}

/** Remove every directory the strip emptied, deepest first. */
export function pruneEmptyDirectories(release, exclude) {
  const removed = [];
  const walk = directory => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        empty = false;
        continue;
      }
      if (directory === release && exclude.rootEntries.has(entry.name)) {
        empty = false;
        continue;
      }
      const child = join(directory, entry.name);
      if (walk(child)) {
        // rmdirSync, not rmSync: Node refuses to remove a directory non-recursively.
        // A directory that turns out not to be empty stays, and the strip never
        // reports a file it did not delete.
        try {
          rmdirSync(child);
          removed.push(relative(release, child).replaceAll('\\', '/'));
        } catch {
          empty = false;
        }
      } else {
        empty = false;
      }
    }
    return empty && directory !== release;
  };
  walk(release);
  return removed.sort();
}

/** The scope every recorded total is measured over. */
function manifestScope(strip) {
  return {
    skipsAtRoot: [...scanExclusions(strip).rootEntries],
    excludesFileNames: [...scanExclusions(strip).fileNames],
    excludesPaths: [strip.manifest],
    note: 'the release tree minus the skip list and minus the strip manifest itself; the installed dependency store at the root is copied unchanged and is never scanned or counted',
  };
}

/**
 * Strip one release in place and return its strip manifest value.
 * @param release - absolute release root.
 * @param strip - strip declaration.
 * @returns the manifest object, already written to `<release>/<strip.manifest>`.
 */
export function applyStrip(release, strip) {
  const exclude = scanExclusions(strip);
  const before = treeTotals(release, exclude, [strip.manifest]);
  const candidates = stripSelected(release, strip);
  const references = runtimePathReferences(release, strip);
  const referenced = new Set(references);
  // DECLARED KEEPS: a second source of truth, deliberately separate from the runtime scan.
  // The scan keeps bytes a built runtime NAMES by path. These are paths a lane's own tools
  // EXECUTE — an operator's CLI, a lane's verifier — which no built runtime names, so without
  // this the strip deletes them and the release stops carrying that lane's producer while every
  // remaining check stays green.
  const declaredKeeps = [];
  for (const pattern of strip.keep ?? []) {
    const matcher = keepMatcher(pattern);
    const matched = candidates.filter(path => matcher(path));
    // A keep that selects nothing is refused rather than tolerated. A pattern matching no
    // candidate is a rule that does nothing, and the failure it hides is the exact one this
    // mechanism exists to prevent: the release quietly stops carrying a lane's bytes while the
    // manifest and the record both stay green.
    if (matched.length === 0) {
      throw new Error(`strip-keep-matched-nothing: ${pattern} selected no stripped path; refusing to keep a rule that does nothing`);
    }
    declaredKeeps.push(...matched);
  }
  for (const path of declaredKeeps) referenced.add(path);
  const kept = candidates.filter(path => referenced.has(path));
  const removed = candidates.filter(path => !referenced.has(path));
  const deleted = removed.map(path => ({ path, ...entryDigest(resolve(release, path)) }));
  // unlinkSync, not rmSync({force:true}): Node's rm stats the path first, so a dangling
  // symlink (upstream ships CLAUDE.md -> AGENTS.md, and AGENTS.md is itself stripped)
  // reports ENOENT and `force` swallows it — the link survives while the manifest claims
  // it was deleted. unlink removes exactly the named entry, link or file.
  for (const path of removed) unlinkSync(resolve(release, path));
  // Prune, then drop the links that pruning broke, then prune what those left behind.
  // Two passes because a link can only be seen to dangle once the directory it pointed
  // into is gone: `.claude/skills -> ../.agents/skills` resolves while .agents/ is an
  // empty husk and dangles the moment that husk is removed.
  const prunedDirectories = [];
  const brokenLinks = [];
  for (let pass = 0; pass < 2; pass += 1) {
    prunedDirectories.push(...pruneEmptyDirectories(release, exclude));
    brokenLinks.push(...removeBrokenLinks(release, exclude));
  }
  const after = treeTotals(release, exclude, [strip.manifest]);
  const manifest = {
    formatVersion: STRIP_MANIFEST_FORMAT,
    kind: STRIP_MANIFEST_KIND,
    release,
    rules: {
      source: 'scripts/artifacts-coverage.json',
      patterns: strip.patterns,
      keepPolicy: strip.keepPolicy,
      scanExclude: strip.scanExclude,
      brokenLinks: 'a symlink whose target no longer resolves inside the release is removed after the strip',
      symlinkEntries: 'a removed symlink is recorded by the text it carries: removing it removes the link, never its target',
    },
    runtimeReferences: { scanPatterns: RUNTIME_SCAN_PATTERNS, matched: references, keptByRule: kept },
    // Top-level for the consumer: the paths that survive their own directory's rule.
    kept,
    // WHICH RULE KEPT EACH ONE, recorded because the two are not the same claim. A runtime
    // reference is a path built code names; a declared keep is a path the declaration says must
    // travel with the release. A reader asking "is this kept because something loads it, or
    // because we decided it ships?" can answer from this field instead of from prose.
    keptByDeclaredKeep: [...new Set(declaredKeeps)].sort(),
    counts: {
      scope: manifestScope(strip),
      before,
      after,
      deleted: {
        files: deleted.length,
        bytes: deleted.reduce((total, entry) => total + entry.bytes, 0),
        directories: prunedDirectories.length,
        brokenLinks: brokenLinks.length,
      },
    },
    deleted,
    brokenLinks,
    prunedDirectories,
  };
  writeFileSync(resolve(release, strip.manifest), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Parse one strip manifest, rejecting a schema this module does not understand. */
export function parseStripManifest(raw, path) {
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`strip-manifest-invalid-json: ${path} is not valid JSON: ${error.message}`);
  }
  if (value?.formatVersion !== STRIP_MANIFEST_FORMAT || value?.kind !== STRIP_MANIFEST_KIND) {
    throw new Error(`strip-manifest-schema: ${path} is not a strip manifest of this format`);
  }
  if (!Array.isArray(value.deleted)) throw new Error(`strip-manifest-schema: ${path} has no deleted list`);
  for (const entry of value.deleted) {
    if (typeof entry?.path !== 'string' || entry.path === '' || entry.path.startsWith('/') || entry.path.includes('..')) {
      throw new Error(`strip-manifest-schema: ${path} has an invalid deleted path ${JSON.stringify(entry?.path)}`);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`strip-manifest-schema: ${path} has an invalid byte count for ${entry.path}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new Error(`strip-manifest-schema: ${path} has an invalid digest for ${entry.path}`);
    }
  }
  if (!Array.isArray(value.kept)) value.kept = [];
  return value;
}

/**
 * Re-check a stripped release. Each invariant has its own failure code: the record must
 * attest the manifest, the manifest must still hash to what the record consumed, no path
 * the rules select may be present again, and the recorded after-state must still match
 * the tree (a partial copy — a mutation-arm root — is exempt from the last one only).
 * @param options - release root, strip declaration, artifact record and full/partial mode.
 * @returns failures (empty means verified) plus a summary of what was measured.
 */
export function verifyStrip({ release, strip, record, partial = false }) {
  const failures = [];
  const manifestPath = resolve(release, strip.manifest);
  const attestation = record?.strip;
  if (attestation === undefined || attestation === null) {
    // A tree without a strip is a build tree, not a release. A tree that carries strip
    // evidence the record does not attest is neither, and must not pass as one.
    if (existsSync(manifestPath)) {
      failures.push(`strip-manifest-unattested: ${strip.manifest} is present but the artifact record does not attest it`);
    }
    if (existsSync(resolve(release, strip.releaseManifest))) {
      failures.push(`release-not-stripped: ${strip.releaseManifest} marks a materialized release but the record carries no strip attestation`);
    }
    return { failures, summary: undefined };
  }
  let manifest;
  const raw = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
  if (raw === undefined) {
    failures.push(`strip-manifest-missing: ${strip.manifest} is attested by the artifact record but absent from ${release}`);
  } else {
    if (sha256Buffer(raw) !== attestation.sha256) {
      failures.push(`strip-manifest-changed: ${strip.manifest} hashes to ${sha256Buffer(raw)} but the record consumed ${String(attestation.sha256)}`);
    }
    try {
      manifest = parseStripManifest(raw, strip.manifest);
    } catch (error) {
      failures.push(error.message);
    }
  }
  const keptByRule = new Set(manifest?.kept ?? []);
  const violations = stripSelected(release, strip).filter(path => !keptByRule.has(path));
  if (violations.length > 0) {
    failures.push(`strip-violation: ${String(violations.length)} stripped path(s) present in ${release}: ${violations.slice(0, 5).join(', ')}`);
  }
  // A DECLARED KEEP THAT IS ABSENT IS A FAILURE, and not a strip violation — nothing was left
  // behind, something that was supposed to travel did not. Without this the release can stop
  // carrying a lane's producer while every other check stays green; the kept list above is
  // consulted as a permission, never as an obligation.
  const keptPaths = new Set(walkFiles(release, scanExclusions(strip)));
  const declaredKeeps = (strip.keep ?? []).flatMap(pattern => {
    const matcher = keepMatcher(pattern);
    return [...keptPaths].filter(path => matcher(path));
  });
  if (declaredKeeps.length !== new Set(declaredKeeps).size) {
    failures.push('strip-keep-duplicate: a declared keep matched the same path twice');
  }
  for (const pattern of strip.keep ?? []) {
    const matcher = keepMatcher(pattern);
    if (![...keptPaths].some(path => matcher(path))) {
      failures.push(`strip-keep-missing: ${pattern} matched no path in ${release}; a declared keep that travels nowhere is a rule that does nothing`);
    }
  }
  let totals;
  if (!partial) {
    totals = treeTotals(release, scanExclusions(strip), [strip.manifest]);
    const expected = manifest?.counts?.after;
    if (expected === undefined) {
      failures.push(`strip-totals-unmeasurable: ${strip.manifest} records no after-state totals`);
    } else if (totals.files !== expected.files || totals.bytes !== expected.bytes) {
      failures.push(`strip-totals-mismatch: the tree holds ${String(totals.files)} file(s)/${String(totals.bytes)} bytes but ${strip.manifest} records ${String(expected.files)}/${String(expected.bytes)}`);
    }
  }
  return {
    failures,
    summary: {
      manifest: strip.manifest,
      sha256: attestation.sha256,
      deletedFiles: attestation.deletedFiles,
      deletedBytes: attestation.deletedBytes,
      keptByRule: [...keptByRule],
      totals,
    },
  };
}
