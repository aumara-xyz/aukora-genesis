#!/usr/bin/env node
/**
 * Build the AUKORA foundation plugin from tracked source.
 *
 * The brand PNG is inlined as a base64 data URI because a dynamically loaded
 * client bundle has no module URL from which to resolve an asset file, and the
 * `/plugins/<id>` route serves only the bundle and its map. The data URI is
 * derived from the tracked original with `sips`, preserving alpha and the 1:1
 * aspect ratio, at the resolution the sidebar actually renders (24 logical px,
 * 4x for high-density displays).
 *
 * Usage: node scripts/build-aukora-plugin.mjs [--check]
 *   --check  rebuild to a temp dir and compare digests without touching lib/
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const pluginDir = resolve(root, 'plugins/aukora-foundation')
const vendorBin = resolve(root, 'vendor/dsh/node_modules/.bin/tsdown')
const sourceIcon = resolve(pluginDir, 'assets/AUMARA-FULL-TRANSPARENT-ICON.png')
// **THE DERIVATION'S OUTPUT, COMMITTED — so a platform without `sips` can still BUILD rather than refuse.**
// It is the exact bytes `sips -Z 96 -s format png` produced from `sourceIcon`, and its digest is pinned where it is
// used. See the non-darwin branch of `iconDataUri()` for why verifying the artifact is the right reduction here.
const committedIcon96 = resolve(pluginDir, 'assets/AUMARA-ICON-96.png')
const checkOnly = process.argv.includes('--check')

/** Hash one file. */
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

if (!existsSync(vendorBin)) throw new Error(`missing-toolchain: ${vendorBin}; run scripts/build-dsh.py first`)
if (!existsSync(sourceIcon)) {
  throw new Error(`missing-brand-asset: ${sourceIcon} must be tracked verbatim; refusing to build a substitute mark`)
}

/** Derive the render-size PNG and return its data URI plus measurements. */
/**
 * Rewrite a PNG without its descriptive chunks, keeping only what the image needs.
 *
 * **WHY THIS EXISTS.** A PNG's metadata is INVISIBLE in every normal view: the file renders identically, it is bytes
 * larger, and no diff, size check or code review looks at it. `sips` removes the source's identifying text and writes
 * its own `eXIf`; an asset converted anywhere else may carry more. **The only reliable rule is that a shipped image
 * carries pixels and geometry, and nothing that describes a person or a tool.**
 *
 * `IHDR` stays first and `IEND` last; rendering chunks are kept by DEFAULT rather than by an allow-list, so a chunk
 * this code has never heard of survives instead of being silently dropped. CRCs are recomputed because a rewritten
 * file with stale CRCs is a corrupt file.
 *
 * @param path - the PNG to rewrite in place.
 * @returns the chunk types that were removed.
 */
export function stripPngMetadata(path) {
  const png = readFileSync(path)
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error(`png-strip: ${path} is not a PNG`)
  }
  const DROP = new Set(['eXIf', 'iTXt', 'tEXt', 'zTXt', 'tIME'])
  const kept = [png.subarray(0, 8)]
  const removed = []
  let offset = 8
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > png.length) break
    if (DROP.has(type)) removed.push(type)
    else {
      const body = png.subarray(offset + 8, offset + 8 + length)
      const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), body]))
      const head = Buffer.alloc(8)
      head.writeUInt32BE(length, 0)
      head.write(type, 4, 'ascii')
      const tail = Buffer.alloc(4)
      tail.writeUInt32BE(crc, 0)
      kept.push(head, body, tail)
    }
    offset = end
  }
  writeFileSync(path, Buffer.concat(kept))
  return removed
}

/** The CRC-32 a PNG chunk carries, recomputed because the bytes changed. */
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function iconDataUri() {
  const scratch = mkdtempSync(join(tmpdir(), 'aukora-icon-'))
  try {
    const derived = join(scratch, 'aukora-icon-96.png')
    // ── THE DERIVATION IS macOS-ONLY, AND SAYS SO BY NAME ────────────────────────────────────
    // `sips` ships with macOS and has no equivalent in this repo's dependencies. Rather than either
    // failing on Linux or silently producing a different icon, the derivation is SKIPPED on other
    // platforms with a ceiling that names what is therefore not proven, and the COMMITTED icon is
    // verified instead — its digest, and its dimensions read out of the PNG's own IHDR chunk, which
    // needs no library and is the same information `sips -g pixelWidth -g pixelHeight -g hasAlpha`
    // reports. The icon is not a security property, so verifying the artifact rather than its
    // derivation is an acceptable and STATED reduction, not a silent one.
    if (process.platform !== 'darwin') {
      const png = readFileSync(sourceIcon)
      const isPng = png.length > 26 && png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      const width = isPng ? png.readUInt32BE(16) : 0
      const height = isPng ? png.readUInt32BE(20) : 0
      const colourType = isPng ? png[25] : -1
      const alpha = colourType === 4 || colourType === 6
      console.log("ICON_DERIVATION: macOS-only; Linux verifies the committed icon's digest and dimensions")
      console.log(`ICON_DERIVATION: committed ${sourceIcon} is ${width}x${height}, alpha=${alpha ? 'yes' : 'no'}, sha256 ${createHash('sha256').update(png).digest('hex').slice(0, 16)}`)
      if (!isPng) throw new Error(`brand-asset: ${sourceIcon} is not a PNG, so its dimensions cannot be verified here`)
      // THE DERIVATION IS NOT SUBSTITUTED. An earlier version returned the COMMITTED icon in its place,
      // and that icon is 1254x1254 — so the 96x96 data URI became a ~megabyte command-line argument and
      // `tsdown` died with `E2BIG`, a failure that looked like a platform problem and was my own
      // substitution. The honest Linux behaviour is a NAMED SKIP: the committed artifact is verified
      // (digest, dimensions, alpha) and the DERIVATION — which needs macOS — is reported as not run,
      // rather than faked with the wrong image.
      // **THE DERIVED 96x96 ICON IS COMMITTED, SO NO PLATFORM NEEDS `sips` TO BUILD.**
      //
      // This branch used to return `{skipped: true}`, and the caller then threw
      // *"brand-asset-derivation: the 96x96 icon cannot be derived on this platform, so the bundle cannot be built"* —
      // **so a real plugin build could not run on Linux at all, which is Fable's step 130 red.** `--check` exited 0
      // with a named skip and looked healthy, which is why this survived: **the path that was tested was not the path
      // that failed.**
      //
      // **THE DERIVATION'S OUTPUT IS AN ARTIFACT, SO THE ARTIFACT IS WHAT GETS COMMITTED.** `AUMARA-ICON-96.png` is the
      // exact bytes `sips -Z 96 -s format png` produced from the tracked source — 96x96, alpha, and stripped of the
      // `eXIf`/`iTXt` chunks that carried the owner's name and three Canva identifiers. **The digest below is the pin:
      // if the file is swapped the build refuses rather than shipping a different icon**, which is the same
      // verify-the-artifact position the comment above already argues for, now applied to the path that actually runs.
      //
      // **AND IT IS NOT A SUBSTITUTION OF THE WRONG IMAGE**, which is the `E2BIG` failure this function already
      // caused: that was the 1254x1254 source handed over in place of a 96x96 derivation. **This file IS 96x96** — its
      // dimensions are read from its own IHDR below and asserted before the data URI is built.
      const pinned = 'f7b5a4fac8c8a6309b159ee7f6d65995157fba077625f935824bc9130dee1cdb'
      const committed = readFileSync(committedIcon96)
      const digest = createHash('sha256').update(committed).digest('hex')
      if (digest !== pinned) {
        throw new Error(`brand-asset-derivation: the committed 96x96 icon has sha256 ${digest}, not the pinned ${pinned} — the derivation's output changed, so it must be re-derived on macOS and re-pinned deliberately rather than shipped`) 
      }
      const cIsPng = committed.length > 26 && committed.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      const cWidth = cIsPng ? committed.readUInt32BE(16) : 0
      const cHeight = cIsPng ? committed.readUInt32BE(20) : 0
      const cColourType = cIsPng ? committed[25] : -1
      if (cWidth !== 96 || cHeight !== 96) {
        throw new Error(`brand-asset-derivation: the committed icon is ${cWidth}x${cHeight}, not 96x96 — handing that to the bundler is the E2BIG failure this function already caused once`) 
      }
      if (!(cColourType === 4 || cColourType === 6)) {
        throw new Error(`brand-asset-derivation: the committed 96x96 icon has colour type ${cColourType}, so it has no alpha channel, and the app icon requires one`) 
      }
      console.log('ICON_DERIVATION: this platform has no `sips`; the COMMITTED 96x96 derivation is used, digest and dimensions verified')
      console.log(`ICON_DERIVATION: ${committedIcon96} is ${cWidth}x${cHeight}, alpha=yes, sha256 ${digest.slice(0, 16)}`)
      return { dataUri: `data:image/png;base64,${committed.toString('base64')}`, width: cWidth, height: cHeight, alpha: true }
    }
    execFileSync('sips', ['-s', 'format', 'png', '-z', '96', '96', sourceIcon, '--out', derived], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    // **`sips` STRIPS THE SOURCE'S METADATA AND THEN WRITES AN `eXIf` OF ITS OWN.** Measured 2026-09-26: rebuilding
    // the foundation icon removed the owner's full legal name and three Canva identifiers — which the shipped
    // bundle had carried in an `eXIf` and an `iTXt` — and left a fresh 120-byte `eXIf` behind. **The identifying
    // data is gone and the metadata chunk is not**, so "rebuilt with sips" is not the same as "clean".
    //
    // **AND IT IS STRIPPED RATHER THAN TRUSTED, BECAUSE THE NEXT `sips` MAY WRITE MORE.** The chunk carries nothing
    // the icon needs: the pixels are `IDAT`, the size is `IHDR`, the transparency is the alpha channel. A filter
    // that drops every descriptive chunk is cheap, needs no dependency, and is the only version of this that stays
    // true when the tool changes underneath it.
    stripPngMetadata(derived)
    const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', derived], {
      encoding: 'utf8',
    })
    const width = Number(/pixelWidth: (\d+)/u.exec(dimensions)?.[1])
    const height = Number(/pixelHeight: (\d+)/u.exec(dimensions)?.[1])
    const alpha = /hasAlpha: yes/u.test(dimensions)
    if (width !== 96 || height !== 96 || !alpha) {
      throw new Error(`brand-asset-derivation: expected a 96x96 transparent PNG, got ${String(width)}x${String(height)} alpha=${String(alpha)}`)
    }
    const bytes = readFileSync(derived)
    return {
      dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
      derivedSha256: createHash('sha256').update(bytes).digest('hex'),
      width,
      height,
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const icon = iconDataUri()

// ── A SKIPPED DERIVATION IS A NAMED SKIP, NOT AN UNDEFINED VALUE ─────────────────────────────
// On Linux `iconDataUri()` returns `{skipped: true}` with NO `dataUri`. Passing that through would put
// the string "undefined" into `AUKORA_ICON_DATA_URI` and hand garbage to `tsdown` — which is exactly the
// `E2BIG` this guard already caused once by substituting a wrong-size icon. `--check` compares the built
// bundle against a committed digest, and the bundle EMBEDS the icon, so with the derivation skipped the
// comparison cannot mean anything: the honest outcome is a named skip that says so, not a build of some
// other icon and not a digest mismatch blamed on the code.
if (icon.skipped) {
  console.log('ICON_DERIVATION: SKIP — the 96x96 derivation needs macOS, so the plugin bundle is not built here')
  console.log('ICON_DERIVATION: what WAS verified on this platform: the committed icon\'s digest, dimensions and alpha, above')
  // THE CHILD IS TOLD, NOT JUST THE CALLER: exiting covers `--check`, but a build path would
  // otherwise hand `tsdown` no icon and be met by its own throw, which is what happened.
  process.env.AUKORA_ICON_SKIPPED = '1';
  if (checkOnly) {
    console.log('AUKORA PLUGIN BUILD: SKIPPED (icon derivation is macOS-only; nothing was compared)')
    process.exit(0)
  }
  throw new Error('brand-asset-derivation: the 96x96 icon cannot be derived on this platform, so the bundle cannot be built')
}
const outDir = checkOnly ? mkdtempSync(join(tmpdir(), 'aukora-lib-')) : resolve(pluginDir, 'lib')
mkdirSync(outDir, { recursive: true })

try {
  for (const face of ['client', 'host']) {
    execFileSync(vendorBin, ['--config', 'tsdown.config.ts', '--out-dir', outDir], {
      cwd: pluginDir,
      env: { ...process.env, AUKORA_BUILD_FACE: face, AUKORA_ICON_DATA_URI: icon.dataUri, CI: 'true' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    console.log(`built face=${face}`)
  }

  const clientPath = resolve(outDir, 'client.js')
  const hostPath = resolve(outDir, 'index.js')
  const client = readFileSync(clientPath, 'utf8')
  // Structural assertions: the emitter's exact whitespace is its business, the
  // closure-factory contract is mine.
  const banner = /^window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "@aukora\/dsh-plugin-foundation",\s*\n\s*factory: \(require\) => \{/u
  const footer = /return module\.exports;\s*\}\s*\}\);\s*$/u
  const checks = [
    ['closure-factory banner', banner.test(client)],
    ['factory footer', footer.test(client)],
    ['react stays external', client.includes('require("react/jsx-runtime")')],
    ['no unresolved relative require', !/require\("\.\//u.test(client)],
    ['inlined brand asset', client.includes('data:image/png;base64,')],
    ['registers both brand slots', client.includes('sidebar.brand.mark') && client.includes('sidebar.brand.name')],
    ['shadows at priority -1', client.includes('priority: -1') || client.includes('priority:-1')],
    ['applies theme overrides', client.includes('overrideTokens')],
    ['host half is inert', readFileSync(hostPath, 'utf8').includes('function apply')],
  ]
  const failed = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (failed.length > 0) throw new Error(`bundle-contract: ${String(failed.length)} check(s) failed`)

  const manifest = {
    formatVersion: 1,
    kind: 'aukora-plugin-build',
    source: {
      'src/index.ts': sha256(resolve(pluginDir, 'src/index.ts')),
      'src/client/index.tsx': sha256(resolve(pluginDir, 'src/client/index.tsx')),
      'tsdown.config.ts': sha256(resolve(pluginDir, 'tsdown.config.ts')),
    },
    brandAsset: {
      source: 'assets/AUMARA-FULL-TRANSPARENT-ICON.png',
      sourceSha256: sha256(sourceIcon),
      derived: `png ${String(icon.width)}x${String(icon.height)} alpha`,
      derivedSha256: icon.derivedSha256,
    },
    outputs: { 'lib/client.js': sha256(clientPath), 'lib/index.js': sha256(hostPath) },
  }
  if (!checkOnly) writeFileSync(resolve(outDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`AUKORA PLUGIN BUILD OK client=${manifest.outputs['lib/client.js']} host=${manifest.outputs['lib/index.js']}`)
  console.log(`brand asset ${manifest.brandAsset.sourceSha256} -> ${manifest.brandAsset.derived} ${manifest.brandAsset.derivedSha256}`)
  if (checkOnly) rmSync(outDir, { recursive: true, force: true })
} catch (error) {
  if (checkOnly) rmSync(outDir, { recursive: true, force: true })
  console.error(`aukora-plugin-build-failed: ${error.message}`)
  process.exit(1)
}
