// Genesis-authored runner, NOT an upstream file (see PROVENANCE.json "genesisAuthored").
// Runs the GENERATED originals. No production aliases or source transforms.
// run-tests.mjs dispatches the upstream `npx tsx` scanner call to its generated JS.
// Containment's source-text assertions still read the byte-for-byte originals via the upstream cwd.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vitestPkg = dirname(realpathSync(process.argv[1])); // .../node_modules/vitest (vitest.mjs lives at its root)

export default {
  cacheDir: process.env.AUKORA_SEED_CACHE ?? join(tmpdir(), 'aukora-seed-app-vitest-cache'),
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: join(vitestPkg, 'dist/index.js') },
    ],
  },
  test: {
    environment: 'node',
    root: join(here, 'src/apps/seed'),
    include: ['../../../lib/apps/seed/test/**/*.test.js'],
  },
};
