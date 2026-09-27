#!/usr/bin/env node
// Runs only the imported upstream tests, using generated modules and the caller's installed Vitest.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--vitest')) {
  throw new Error('usage: node vendor/aukora-seed-app/run-tests.mjs [--vitest <vitest/vitest.mjs>]');
}
const vitest = args[1] ? resolve(args[1]) : resolve(here, '../dsh/node_modules/vitest/vitest.mjs');
const runnerVersion = JSON.parse(readFileSync(join(dirname(vitest), 'package.json'), 'utf8')).version;
const upstreamLock = JSON.parse(readFileSync(join(here, 'src/package-lock.json'), 'utf8'));
const lockedVersion = upstreamLock.packages['node_modules/vitest'].version;
const scratch = mkdtempSync(join(tmpdir(), 'aukora-seed-generated-tests-'));
try {
  // Two unchanged upstream tests invoke an absolute *.ts scanner through `npx tsx`.
  // This private PATH entry dispatches that exact command to its generated JS with the same args/cwd/status.
  // It neither installs a package nor substitutes any scanner/test behavior.
  const upstreamScanner = join(here, 'src/apps/seed/scripts/scan-public-tree.ts');
  const generatedScanner = join(here, 'lib/apps/seed/scripts/scan-public-tree.js');
  writeFileSync(join(scratch, 'npx'), `#!/usr/bin/env node\n` +
    `const { spawnSync } = require('node:child_process');\n` +
    `if (process.argv.length !== 4 || process.argv[2] !== 'tsx' || process.argv[3] !== ${JSON.stringify(upstreamScanner)}) {\n` +
    `  process.stderr.write('unexpected upstream subprocess; refusing\\n'); process.exit(1);\n}\n` +
    `const child = spawnSync(process.execPath, [${JSON.stringify(generatedScanner)}], { stdio: 'inherit', env: process.env });\n` +
    `if (child.error) process.stderr.write(String(child.error) + '\\n');\n` +
    `process.exit(child.status ?? 1);\n`, { mode: 0o700 });
  process.stdout.write(`Generated originals; Vitest ${runnerVersion} (upstream lock ${lockedVersion}). Source assertions read unchanged src; scanner subprocesses execute generated JS.\n`);
  const child = spawnSync(process.execPath, [vitest, 'run', '--config', join(here, 'run-tests.vitest.config.mjs')], {
    cwd: join(here, 'src/apps/seed'),
    env: { ...process.env, PATH: `${scratch}${delimiter}${process.env.PATH ?? ''}`, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
