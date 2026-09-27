/**
 * Shared artifact-integrity semantics for the B1 producer and consumer.
 *
 * The producer (scripts/artifact-record.mjs, invoked by scripts/build-dsh.py
 * after `pnpm run build`) writes one build-produced record. The consumer
 * (scripts/genesis-check.mjs) re-derives every covered digest from the real
 * bytes and refuses to pass when the tree differs from the record.
 *
 * The aggregate digest scheme mirrors vendor/dsh/scripts/client-build-environment.ts
 * so the Genesis check can cross-check upstream's own client build record, which
 * is produced independently by the pinned build.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseStripManifest, verifyStrip } from './release-strip.mjs';

/** Record schema version written and accepted by this module. */
export const RECORD_FORMAT = 1;

/** Human-stable identifier stored in every record. */
export const RECORD_KIND = 'genesis-artifact-record';

/** Path of the coverage declaration, relative to the Genesis root. */
export const COVERAGE_DECLARATION_PATH = 'scripts/artifacts-coverage.json';

/** Path of the build pin, relative to the Genesis root. */
export const PIN_PATH = 'upstream-dsh.json';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

/** Hash one file's bytes. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Hash an arbitrary buffer. */
export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Load and validate the committed coverage declaration.
 * @param genesisRoot - Genesis repository root holding the declaration.
 * @returns declaration path, raw byte digest and parsed value.
 */
export function loadCoverage(genesisRoot) {
  const path = resolve(genesisRoot, COVERAGE_DECLARATION_PATH);
  if (!existsSync(path)) throw new Error(`missing-coverage-declaration: ${COVERAGE_DECLARATION_PATH}`);
  const raw = readFileSync(path);
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid-coverage-declaration: ${error.message}`);
  }
  const stringList = (name, minimum) => {
    const list = value[name];
    if (!Array.isArray(list) || list.length < minimum || list.some(item => typeof item !== 'string' || item === '')) {
      throw new Error(`invalid-coverage-declaration: ${name} must list at least ${String(minimum)} non-empty string(s)`);
    }
    return list;
  };
  if (value.formatVersion !== RECORD_FORMAT) {
    throw new Error(`invalid-coverage-declaration: formatVersion ${String(value.formatVersion)} is not ${String(RECORD_FORMAT)}`);
  }
  for (const name of ['source', 'record', 'upstreamClientRecord', 'sourceLockfile']) {
    if (typeof value[name] !== 'string' || value[name] === '' || value[name].startsWith('/')) {
      throw new Error(`invalid-coverage-declaration: ${name} must be a non-empty relative path`);
    }
  }
  // The release strip is declared here, not in code, so the patterns the producer
  // applies and the patterns the consumer forbids are one list bound by one digest.
  const rawStrip = value.strip;
  if (typeof rawStrip !== 'object' || rawStrip === null) {
    throw new Error('invalid-coverage-declaration: strip must declare the release strip rules');
  }
  const stripList = (name, minimum) => {
    const list = rawStrip[name];
    if (!Array.isArray(list) || list.length < minimum || list.some(item => typeof item !== 'string' || item === '')) {
      throw new Error(`invalid-coverage-declaration: strip.${name} must list at least ${String(minimum)} non-empty string(s)`);
    }
    return list;
  };
  for (const name of ['manifest', 'releaseManifest']) {
    if (typeof rawStrip[name] !== 'string' || rawStrip[name] === '' || rawStrip[name].startsWith('/')) {
      throw new Error(`invalid-coverage-declaration: strip.${name} must be a non-empty relative path`);
    }
  }
  // Scan exclusions are structured, not glob-shaped: a name list cannot silently fail to
  // match the way a glob can, and this file is the only place the rules live.
  const scanExclude = rawStrip.scanExclude;
  if (typeof scanExclude !== 'object' || scanExclude === null) {
    throw new Error('invalid-coverage-declaration: strip.scanExclude must be an object of name lists');
  }
  const stripNames = (list, label) => {
    if (!Array.isArray(list) || list.length < 1 || list.some(item => typeof item !== 'string' || item === '')) {
      throw new Error(`invalid-coverage-declaration: strip.scanExclude.${label} must list at least 1 non-empty name`);
    }
    return [...list];
  };
  return {
    path: COVERAGE_DECLARATION_PATH,
    sha256: sha256Buffer(raw),
    value: {
      formatVersion: value.formatVersion,
      source: value.source,
      record: value.record,
      upstreamClientRecord: value.upstreamClientRecord,
      sourceLockfile: value.sourceLockfile,
      hostPatterns: stringList('hostPatterns', 1),
      clientPatterns: stringList('clientPatterns', 1),
      requiredEntries: stringList('requiredEntries', 1),
      genesisPatterns: stringList('genesisPatterns', 0),
      excluded: stringList('excluded', 0),
      uncoveredInputs: stringList('uncoveredInputs', 0),
      limits: stringList('limits', 0),
      strip: {
        manifest: rawStrip.manifest,
        releaseManifest: rawStrip.releaseManifest,
        patterns: stripList('patterns', 1),
        // An EXPLICIT allowlist of paths that survive the strip even though a pattern selects
        // them. The runtime-reference scan cannot reach these: they are scripts a lane's tools
        // run, not bytes a built runtime names, so without a declared keep they are deleted and
        // the release silently stops carrying the lane's producer and verifiers. Optional, so a
        // declaration that does not need one is unchanged.
        keep: stripList('keep', 0),
        keepPolicy: stripList('keepPolicy', 1),
        scanExclude: {
          rootEntries: stripNames(scanExclude.rootEntries, 'rootEntries'),
          fileNames: stripNames(scanExclude.fileNames, 'fileNames'),
          note: typeof scanExclude.note === 'string' ? scanExclude.note : '',
        },
      },
    },
  };
}

/**
 * Resolve the covered file set for one source tree.
 * @param source - extracted upstream source or release root.
 * @param patterns - glob patterns from the coverage declaration.
 * @param excluded - glob patterns the declaration declares as uncovered.
 * @returns sorted, de-duplicated repository-relative file paths.
 */
export function coveredPaths(source, patterns, excluded = []) {
  const matched = globSync([...patterns], { cwd: source, exclude: [...excluded] })
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => {
      try {
        return statSync(resolve(source, path)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  return [...new Set(matched)];
}

/**
 * Digest a covered set with the upstream client-record scheme.
 * @param source - tree the paths are relative to.
 * @param paths - already sorted repository-relative paths.
 * @returns lowercase SHA-256 digest binding every path to its bytes.
 */
export function aggregateDigest(source, paths) {
  const digest = createHash('sha256');
  for (const path of paths) {
    const content = readFileSync(resolve(source, path));
    digest.update(`${Buffer.byteLength(path)}:`);
    digest.update(path);
    digest.update(`${content.byteLength}:`);
    digest.update(content);
  }
  return digest.digest('hex');
}

/**
 * Read the upstream client build record produced by `pnpm run build`.
 * @param source - upstream source or release root.
 * @param relativePath - record path from the coverage declaration.
 * @returns raw digest, parsed record and the client-face digest it claims.
 */
export function readUpstreamClientRecord(source, relativePath) {
  const path = resolve(source, relativePath);
  if (!existsSync(path)) {
    throw new Error(`upstream-client-record-missing: ${relativePath}; run a complete pnpm run build first`);
  }
  const raw = readFileSync(path);
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`upstream-client-record-invalid: ${relativePath} is not valid JSON: ${error.message}`);
  }
  const artifacts = value?.artifacts;
  if (typeof artifacts?.fileCount !== 'number' || !Number.isSafeInteger(artifacts.fileCount) || artifacts.fileCount < 1) {
    throw new Error(`upstream-client-record-invalid: ${relativePath} has no usable artifacts.fileCount`);
  }
  if (typeof artifacts.sha256 !== 'string' || !DIGEST_PATTERN.test(artifacts.sha256)) {
    throw new Error(`upstream-client-record-invalid: ${relativePath} has no usable artifacts.sha256`);
  }
  return {
    relativePath,
    sha256: sha256Buffer(raw),
    environment: typeof value.environment === 'object' && value.environment !== null ? value.environment : {},
    fileCount: artifacts.fileCount,
    digest: artifacts.sha256,
  };
}

/** Read the pinned upstream identity. */
export function loadPin(genesisRoot) {
  const path = resolve(genesisRoot, PIN_PATH);
  if (!existsSync(path)) throw new Error(`missing-pin: ${PIN_PATH}`);
  const pin = JSON.parse(readFileSync(path, 'utf8'));
  for (const name of ['commit', 'archiveSha256', 'lockfileSha256']) {
    if (typeof pin[name] !== 'string' || pin[name] === '') throw new Error(`missing-pin: ${PIN_PATH} has no ${name}`);
  }
  return pin;
}

/** Report the Genesis commit whose bytes are under test, without guessing. */
export function genesisCommit(genesisRoot) {
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: genesisRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[0-9a-f]{40}$/u.test(value) ? value : `unresolved:${value}`;
  } catch {
    return 'unborn-or-unavailable';
  }
}

/**
 * Build the deterministic record for one built tree.
 * @param options - Genesis root, built source root, pin and coverage declaration.
 * @returns the record object that was written.
 */
export function buildRecord({ genesisRoot, source, pin, coverage }) {
  const declaration = coverage.value;
  const paths = coveredPaths(source, declaration.hostPatterns, declaration.excluded);
  if (paths.length === 0) throw new Error('empty-coverage: no build output matched the declared host patterns; refusing to record zero coverage');
  for (const required of declaration.requiredEntries) {
    if (!paths.includes(required)) {
      throw new Error(`required-entry-missing: ${required} is absent from the built tree; run a complete pinned build`);
    }
  }
  const lockfile = resolve(source, declaration.sourceLockfile);
  if (!existsSync(lockfile)) throw new Error(`source-lockfile-missing: ${declaration.sourceLockfile}`);
  if (sha256File(lockfile) !== pin.lockfileSha256) {
    throw new Error(`source-lockfile-mismatch: ${declaration.sourceLockfile} does not match the pinned dependency inputs`);
  }
  const upstream = readUpstreamClientRecord(source, declaration.upstreamClientRecord);
  const clientPaths = coveredPaths(source, declaration.clientPatterns, declaration.excluded);
  const clientDigest = aggregateDigest(source, clientPaths);
  if (clientDigest !== upstream.digest || clientPaths.length !== upstream.fileCount) {
    throw new Error(
      `upstream-client-record-mismatch: ${declaration.upstreamClientRecord} claims ${String(upstream.fileCount)} files/${upstream.digest} but the built bytes are ${String(clientPaths.length)} files/${clientDigest}`,
    );
  }
  const entries = paths.map(path => {
    const bytes = statSync(resolve(source, path)).size;
    return { path, bytes, sha256: sha256File(resolve(source, path)) };
  });
  const genesisPaths = coveredPaths(genesisRoot, declaration.genesisPatterns, declaration.excluded);
  if (declaration.genesisPatterns.length > 0 && genesisPaths.length === 0) {
    throw new Error('empty-genesis-coverage: declared Genesis patterns matched no file; refusing to record zero foundation coverage');
  }
  const genesisEntries = genesisPaths.map(path => ({
    path,
    bytes: statSync(resolve(genesisRoot, path)).size,
    sha256: sha256File(resolve(genesisRoot, path)),
  }));
  // A materialized release carries its strip manifest, and the record attests it by
  // digest: the consumer can then refuse a stripped path left behind AND a manifest
  // rewritten after this record was produced. A build tree has no manifest and no
  // attestation, which is why the consumer stays silent for it — and why the same
  // consumer refuses a release manifest that arrives without one.
  const stripManifestPath = resolve(source, declaration.strip.manifest);
  let strip;
  if (existsSync(stripManifestPath)) {
    const rawStrip = readFileSync(stripManifestPath);
    const parsed = parseStripManifest(rawStrip, declaration.strip.manifest);
    const counts = parsed.counts ?? {};
    strip = {
      manifest: declaration.strip.manifest,
      sha256: sha256Buffer(rawStrip),
      patterns: declaration.strip.patterns,
      before: counts.before,
      after: counts.after,
      deletedFiles: Number.isSafeInteger(counts.deleted?.files) ? counts.deleted.files : parsed.deleted.length,
      deletedBytes: Number.isSafeInteger(counts.deleted?.bytes) ? counts.deleted.bytes : 0,
      keptByRule: [...(parsed.kept ?? [])],
    };
  }
  const record = {
    formatVersion: RECORD_FORMAT,
    kind: RECORD_KIND,
    generatedBy: 'scripts/artifact-record.mjs (invoked by scripts/build-dsh.py after pnpm run build)',
    upstream: { commit: pin.commit, archiveSha256: pin.archiveSha256, lockfileSha256: pin.lockfileSha256 },
    producer: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      genesisCommit: genesisCommit(genesisRoot),
    },
    coverage: {
      declarationSha256: coverage.sha256,
      hostPatterns: declaration.hostPatterns,
      excluded: declaration.excluded,
      uncoveredInputs: declaration.uncoveredInputs,
      limits: declaration.limits,
    },
    host: {
      fileCount: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      sha256: aggregateDigest(source, paths),
    },
    clientFace: {
      patterns: declaration.clientPatterns,
      fileCount: clientPaths.length,
      sha256: clientDigest,
      upstreamRecord: upstream.relativePath,
      upstreamRecordSha256: upstream.sha256,
      upstreamEnvironment: upstream.environment,
    },
    requiredEntries: declaration.requiredEntries.map(path => ({ path, sha256: sha256File(resolve(source, path)) })),
    genesis: {
      patterns: declaration.genesisPatterns,
      fileCount: genesisEntries.length,
      bytes: genesisEntries.reduce((total, entry) => total + entry.bytes, 0),
      sha256: aggregateDigest(genesisRoot, genesisPaths),
      entries: genesisEntries,
    },
    entries,
    ...(strip === undefined ? {} : { strip }),
  };
  const recordPath = resolve(source, declaration.record);
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** Parse a record and reject any schema this module does not fully understand. */
function parseRecord(raw, recordPath) {
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`record-invalid-json: ${recordPath} is not valid JSON: ${error.message}`);
  }
  const fail = message => {
    throw new Error(`record-schema: ${recordPath} ${message}`);
  };
  if (value?.formatVersion !== RECORD_FORMAT || value?.kind !== RECORD_KIND) fail('is not a record of this format');
  if (!Array.isArray(value.entries) || value.entries.length === 0) fail('has no artifact entries');
  for (const entry of value.entries) {
    if (typeof entry?.path !== 'string' || entry.path === '' || entry.path.startsWith('/') || entry.path.includes('..')) {
      fail(`has an invalid entry path ${JSON.stringify(entry?.path)}`);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) fail(`has an invalid byte count for ${entry.path}`);
    if (typeof entry.sha256 !== 'string' || !DIGEST_PATTERN.test(entry.sha256)) fail(`has an invalid digest for ${entry.path}`);
  }
  if (!Number.isSafeInteger(value.host?.fileCount) || typeof value.host?.sha256 !== 'string') fail('has no host digest');
  if (!Array.isArray(value.requiredEntries) || value.requiredEntries.length === 0) fail('has no required entries');
  return value;
}

/**
 * Verify a built tree against its record, its pins and the committed declaration.
 * @param options - Genesis root, source root, optional explicit record path, and whether
 *   the tree under test is a partial copy (mutation-arm root) rather than a whole tree.
 * @returns failures (empty means verified) plus a summary of what was measured.
 */
export function verifyArtifacts({ genesisRoot, source, recordPath, partial = false }) {
  const failures = [];
  const add = message => failures.push(message);
  let pin;
  let coverage;
  try {
    pin = loadPin(genesisRoot);
  } catch (error) {
    return { ok: false, failures: [error.message], summary: undefined };
  }
  try {
    coverage = loadCoverage(genesisRoot);
  } catch (error) {
    return { ok: false, failures: [error.message], summary: undefined };
  }
  const resolvedRecord = recordPath ?? resolve(source, coverage.value.record);
  if (!existsSync(resolvedRecord)) {
    return {
      ok: false,
      failures: [`record-missing: ${coverage.value.record} is absent from ${source}; run scripts/build-dsh.py`],
      summary: undefined,
    };
  }
  const raw = readFileSync(resolvedRecord);
  let record;
  try {
    record = parseRecord(raw, coverage.value.record);
  } catch (error) {
    return { ok: false, failures: [error.message], summary: undefined };
  }
  const recordSha256 = sha256Buffer(raw);

  if (record.coverage?.declarationSha256 !== coverage.sha256) {
    add(`coverage-declaration-mismatch: record was produced for declaration ${String(record.coverage?.declarationSha256)} but ${COVERAGE_DECLARATION_PATH} now hashes to ${coverage.sha256}`);
  }
  for (const [name, expected] of [['commit', pin.commit], ['archiveSha256', pin.archiveSha256], ['lockfileSha256', pin.lockfileSha256]]) {
    if (record.upstream?.[name] !== expected) {
      add(`pin-mismatch: record upstream.${name} is ${String(record.upstream?.[name])} but ${PIN_PATH} pins ${expected}`);
    }
  }
  const lockfile = resolve(source, coverage.value.sourceLockfile);
  if (!existsSync(lockfile)) add(`source-lockfile-missing: ${coverage.value.sourceLockfile}`);
  else if (sha256File(lockfile) !== pin.lockfileSha256) {
    add(`source-lockfile-mismatch: ${coverage.value.sourceLockfile} does not match the pinned dependency inputs`);
  }

  const paths = coveredPaths(source, coverage.value.hostPatterns, coverage.value.excluded);
  const recorded = new Map(record.entries.map(entry => [entry.path, entry]));
  const onDisk = new Set(paths);
  const absentFromRecord = paths.filter(path => !recorded.has(path));
  const staleInRecord = [...recorded.keys()].filter(path => !onDisk.has(path));
  if (absentFromRecord.length > 0 || staleInRecord.length > 0) {
    add(`record-coverage-set-mismatch: ${String(absentFromRecord.length)} covered file(s) absent from the record${absentFromRecord.length > 0 ? ` (${absentFromRecord.slice(0, 3).join(', ')})` : ''}; ${String(staleInRecord.length)} recorded file(s) no longer covered or present${staleInRecord.length > 0 ? ` (${staleInRecord.slice(0, 3).join(', ')})` : ''}`);
  }

  let measuredBytes = 0;
  let missing = 0;
  let changed = 0;
  for (const path of paths) {
    const entry = recorded.get(path);
    const absolute = resolve(source, path);
    if (entry === undefined) continue;
    const size = statSync(absolute).size;
    measuredBytes += size;
    if (entry.bytes !== size) {
      changed += 1;
      if (changed <= 5) add(`changed-artifact: ${path} is ${String(size)} bytes but the record attests ${String(entry.bytes)}`);
      continue;
    }
    const digest = sha256File(absolute);
    if (digest !== entry.sha256) {
      changed += 1;
      if (changed <= 5) add(`changed-artifact: ${path} hashes to ${digest} but the record attests ${entry.sha256}`);
    }
  }
  for (const entry of record.entries) {
    if (!existsSync(resolve(source, entry.path))) {
      missing += 1;
      if (missing <= 5) add(`missing-artifact: ${entry.path} is attested by the record but absent from ${source}`);
    }
  }
  for (const required of record.requiredEntries) {
    if (!existsSync(resolve(source, required.path))) {
      if (!failures.some(failure => failure.includes(required.path))) {
        add(`required-entry-missing: ${required.path} is absent from ${source}`);
      }
    } else if (sha256File(resolve(source, required.path)) !== required.sha256) {
      add(`changed-artifact: required entry ${required.path} no longer matches the recorded digest`);
    }
  }
  const hostPaths = paths.filter(path => recorded.has(path) && existsSync(resolve(source, path)));
  if (hostPaths.length > 0 && hostPaths.length === recorded.size) {
    const measured = aggregateDigest(source, hostPaths);
    if (measured !== record.host.sha256) add(`host-digest-mismatch: rebuilt closure hashes to ${measured} but the record attests ${record.host.sha256}`);
  } else if (hostPaths.length !== recorded.size) {
    add(`host-digest-unmeasurable: ${String(recorded.size - hostPaths.length)} recorded artifact(s) cannot be hashed`);
  }

  let clientSummary;
  try {
    const upstream = readUpstreamClientRecord(source, coverage.value.upstreamClientRecord);
    const clientPaths = coveredPaths(source, coverage.value.clientPatterns, coverage.value.excluded);
    const measured = aggregateDigest(source, clientPaths);
    if (upstream.sha256 !== record.clientFace?.upstreamRecordSha256) {
      add(`upstream-client-record-changed: ${upstream.relativePath} hashes to ${upstream.sha256} but the record consumed ${String(record.clientFace?.upstreamRecordSha256)}`);
    }
    if (measured !== upstream.digest || clientPaths.length !== upstream.fileCount) {
      add(`upstream-client-record-mismatch: ${upstream.relativePath} claims ${String(upstream.fileCount)} client file(s)/${upstream.digest} but the tree has ${String(clientPaths.length)}/${measured}`);
    }
    if (measured !== record.clientFace?.sha256 || clientPaths.length !== record.clientFace?.fileCount) {
      add(`client-face-mismatch: client artifacts hash to ${measured} over ${String(clientPaths.length)} file(s) but the record attests ${String(record.clientFace?.sha256)} over ${String(record.clientFace?.fileCount)}`);
    }
    clientSummary = { fileCount: clientPaths.length, sha256: measured, upstreamRecordSha256: upstream.sha256 };
  } catch (error) {
    add(error.message);
  }

  let genesisSummary;
  const recordedGenesis = record.genesis?.entries ?? [];
  if (recordedGenesis.length > 0) {
    const genesisPaths = coveredPaths(genesisRoot, coverage.value.genesisPatterns, coverage.value.excluded);
    const byPath = new Map(recordedGenesis.map(entry => [entry.path, entry]));
    const absent = genesisPaths.filter(path => !byPath.has(path));
    const stale = [...byPath.keys()].filter(path => !genesisPaths.includes(path));
    if (absent.length > 0 || stale.length > 0) {
      add(`genesis-coverage-set-mismatch: ${String(absent.length)} foundation file(s) unrecorded${absent.length > 0 ? ` (${absent.slice(0, 3).join(', ')})` : ''}; ${String(stale.length)} recorded file(s) gone${stale.length > 0 ? ` (${stale.slice(0, 3).join(', ')})` : ''}`);
    }
    for (const path of genesisPaths) {
      const entry = byPath.get(path);
      if (entry === undefined) continue;
      const absolute = resolve(genesisRoot, path);
      if (!existsSync(absolute)) {
        add(`genesis-artifact-missing: ${path} is attested but absent from the Genesis tree`);
        continue;
      }
      const bytes = statSync(absolute).size;
      if (bytes !== entry.bytes) {
        add(`genesis-artifact-changed: ${path} is ${String(bytes)} bytes but the record attests ${String(entry.bytes)}`);
      } else if (sha256File(absolute) !== entry.sha256) {
        add(`genesis-artifact-changed: ${path} no longer matches the recorded digest`);
      }
    }
    genesisSummary = { fileCount: recordedGenesis.length, sha256: record.genesis.sha256 };
  }

  const stripped = verifyStrip({ release: source, strip: coverage.value.strip, record, partial });
  for (const failure of stripped.failures) add(failure);

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      recordSha256,
      upstreamCommit: record.upstream.commit,
      genesisCommit: genesisCommit(genesisRoot),
      producer: record.producer,
      host: { fileCount: record.entries.length, bytes: record.host.bytes, sha256: record.host.sha256, measuredBytes },
      client: clientSummary ?? record.clientFace,
      genesis: genesisSummary,
      strip: stripped.summary,
    },
  };
}
