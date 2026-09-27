#!/usr/bin/env node
/** Produce the B1 artifact record for one built tree. Run only after `pnpm run build`. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildRecord, loadCoverage, loadPin } from './lib/artifact-integrity.mjs';

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const genesisRoot = fileURLToPath(new URL('../', import.meta.url));
const coverage = loadCoverage(genesisRoot);
const source = resolve(genesisRoot, option('--source') ?? coverage.value.source);
const pin = loadPin(genesisRoot);

try {
  const record = buildRecord({ genesisRoot, source, pin, coverage });
  console.log(
    `RECORDED ${record.host.fileCount} covered artifact(s), ${String(record.host.bytes)} bytes, host ${record.host.sha256}, client ${record.clientFace.sha256} (${String(record.clientFace.fileCount)} files); upstream=${record.upstream.commit}; genesis=${record.producer.genesisCommit}`,
  );
  console.log(`record: ${resolve(source, coverage.value.record)}`);
} catch (error) {
  console.error(`artifact-record-failed: ${error.message}`);
  process.exit(1);
}
