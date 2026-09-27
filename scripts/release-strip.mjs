#!/usr/bin/env node
/**
 * Strip a materialized release and write its strip manifest.
 *
 *   node scripts/release-strip.mjs --release <release-root> [--plan]
 *
 * Invoked by scripts/materialize-aukora-release.py between the copy and the artifact
 * record. The rules come from scripts/artifacts-coverage.json, the same declaration the
 * artifact record binds by digest, so the consumer re-checks the tree with the rules the
 * producer actually used. The last stdout line is the JSON summary.
 *
 * `--plan` reports what would be deleted and touches nothing.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadCoverage } from './lib/artifact-integrity.mjs';
import { applyStrip, runtimePathReferences, stripSelected } from './lib/release-strip.mjs';

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const genesisRoot = fileURLToPath(new URL('../', import.meta.url));
const coverage = loadCoverage(genesisRoot);
const strip = coverage.value.strip;
const release = resolve(option('--release') ?? coverage.value.source);

if (args.includes('--plan')) {
  const selected = stripSelected(release, strip);
  const referenced = new Set(runtimePathReferences(release, strip));
  const kept = selected.filter(path => referenced.has(path));
  const deleted = selected.filter(path => !referenced.has(path));
  console.log(`strip plan for ${release}: ${String(deleted.length)} path(s) would be deleted, ${String(kept.length)} kept by runtime reference`);
  for (const path of deleted) console.log(`  delete ${path}`);
  for (const path of kept) console.log(`  keep   ${path}`);
  console.log(JSON.stringify({ release, delete: deleted.length, keptByRule: kept }));
  process.exit(0);
}

const manifest = applyStrip(release, strip);
console.log(
  `STRIPPED ${String(manifest.counts.deleted.files)} file(s), ${String(manifest.counts.deleted.bytes)} bytes, ${String(manifest.counts.deleted.directories)} emptied director(ies), ${String(manifest.counts.deleted.brokenLinks)} dead link(s); tree ${String(manifest.counts.before.files)} -> ${String(manifest.counts.after.files)} file(s), ${String(manifest.counts.before.bytes)} -> ${String(manifest.counts.after.bytes)} bytes`,
);
console.log(`left no dead link behind in the scanned tree (${String(manifest.brokenLinks.length)}): ${manifest.brokenLinks.join(', ') || 'none'}; the dependency store at the root is not scanned, and its links are not counted (limits in scripts/artifacts-coverage.json)`);
console.log(`kept by runtime reference (${String(manifest.runtimeReferences.keptByRule.length)}): ${manifest.runtimeReferences.keptByRule.join(', ') || 'none'}`);
console.log(JSON.stringify({
  release,
  manifest: resolve(release, strip.manifest),
  deletedFiles: manifest.counts.deleted.files,
  deletedBytes: manifest.counts.deleted.bytes,
  keptByRule: manifest.runtimeReferences.keptByRule,
  counts: manifest.counts,
}));

