import { defineConfig } from 'tsdown'

/** Each public entry embeds its helpers without loading sibling plugins. */
export default defineConfig(['index', 'invariant', 'workspace-patch', 'receipt-view'].map(name => ({
  entry: [`lib/types/${name}.js`],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
