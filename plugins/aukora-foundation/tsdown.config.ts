/**
 * Genesis-owned build config for the AUKORA foundation plugin.
 *
 * The stock `@deepseek-ai/dsh-client-ui-*` preset cannot build this package:
 * `clientBundle()` resolves a package id through `packages/* /package.json`
 * inside the pinned upstream workspace and throws for anything else. This
 * config reproduces the parts of that preset the browser actually requires —
 * CJS output, the closure-factory banner/footer/intro, and the platform
 * module table as the external set — and nothing else.
 *
 * Face is selected with `AUKORA_BUILD_FACE` (client | host), mirroring the
 * upstream build's `DSH_BUILD_FACE`.
 *
 * The config exports a plain object rather than calling tsdown's
 * `defineConfig`: this package lives outside the upstream workspace, so a
 * value import of `tsdown` would be resolved from here and fail.
 */

/** Module specifiers the shell shares into the frozen browser module table. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Package id the client module system maps this bundle to. */
const PACKAGE_ID = '@aukora/dsh-plugin-foundation'

const face = process.env.AUKORA_BUILD_FACE ?? 'client'
const iconDataUri = process.env.AUKORA_ICON_DATA_URI ?? ''

if (face === 'client' && !iconDataUri.startsWith('data:image/png;base64,')) {
  // A NAMED SKIP, HONOURED HERE TOO. `scripts/build-aukora-plugin.mjs` derives the 96x96 icon with
  // `sips`, which is macOS-only; elsewhere it verifies the committed icon and reports
  // `ICON_DERIVATION: SKIP` instead of substituting a wrong-size image (that substitution made the
  // base64 a megabyte-scale argv and `tsdown` died with `E2BIG`). The skip set no icon, so THIS throw
  // fired next and turned a named skip into a hard failure — the guard's promise broken one layer down.
  if (process.env.AUKORA_ICON_SKIPPED === '1') {
    console.log('ICON_DERIVATION: SKIP honoured by tsdown — building without an embedded icon (macOS-only derivation)')
  } else {
    throw new Error('aukora-build: AUKORA_ICON_DATA_URI is missing; run scripts/build-aukora-plugin.mjs')
  }
}

/** Build config for the selected face. */
const config = face === 'client'
  ? {
      entry: ['src/client/index.tsx'],
      outDir: 'lib',
      format: 'cjs',
      platform: 'browser',
      clean: false,
      dts: false,
      sourcemap: false,
      define: { __AUKORA_ICON_DATA_URI__: JSON.stringify(iconDataUri) },
      deps: { neverBundle: PLATFORM_MODULES },
      outputOptions: {
        entryFileNames: 'client.js',
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
        intro: 'var module = { exports: {} }; var exports = module.exports;',
        footer: 'return module.exports; } });',
      },
    }
  : {
      entry: ['src/index.ts'],
      outDir: 'lib',
      format: 'esm',
      platform: 'node',
      clean: false,
      dts: false,
      sourcemap: false,
      outputOptions: { entryFileNames: 'index.js' },
    }

export default config
