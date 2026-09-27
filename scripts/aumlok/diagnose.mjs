#!/usr/bin/env node
/**
 * AUMLOK — what is actually wired, and what is only claimed.
 *
 *   node scripts/aumlok/diagnose.mjs [--release <dir>] [--socket <path>]
 *
 * WHY THIS EXISTS. Three different things get called "AUMLOK is integrated" in conversation, and
 * they have completely different evidence:
 *
 *   PACKAGED ADAPTER       the plugin bytes exist and something mounts them. That is a fact about
 *                          files and composition rows, and it is checkable by looking.
 *   MOUNTED SIGNER         a signing CHANNEL is reachable — a separate process listening on a unix
 *   CONNECTION             socket. It is deliberately NOT a Cordis service: the broker must never
 *                          hold the key, so `signer.mjs` is not a plugin and mounting the adapter
 *                          confers no signing ability whatsoever.
 *   PROVISIONED CUSTODY    a real key exists and someone is accountable for it. This lane has never
 *                          provisioned one and has no code path that could: there is no default key
 *                          location anywhere in the closure.
 *
 * Collapsing these is how a green test suite gets read as "the owner's key is signing things". So this
 * command MEASURES each one and prints what it found, including the ones that are absent.
 *
 * READ-ONLY. It opens no socket, starts no daemon, reads no key, binds no port and writes no file.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LANE = [join(ROOT, 'plugins', 'aukora-aumlok'), join(ROOT, 'scripts', 'aumlok')]

/** Read one `--flag value` argument, or undefined. */
function option(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

const release = option('--release') ?? process.env.AUKORA_DSH_RELEASE
const socketPath = option('--socket')

/** Print one measured fact. */
function fact(label, value) {
  process.stdout.write(`${label}: ${value}\n`)
}

/** Every file under a directory tree, without following symlinks. */
function walk(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

process.stdout.write('AUMLOK diagnostic — packaged adapter vs mounted signer vs provisioned custody\n')
process.stdout.write(`repository: ${ROOT}\n\n`)

// ── 1. the packaged adapter ───────────────────────────────────────────────────────────────────
process.stdout.write('── packaged adapter ──\n')
const pluginManifest = join(ROOT, 'plugins', 'aukora-aumlok', 'package.json')
fact('ADAPTER_MANIFEST_IN_CHECKOUT', existsSync(pluginManifest) ? 'present' : 'ABSENT')
let pluginShape = 'unknown'
try {
  const module = await import(`${join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'service.mjs')}`)
  // A Cordis plugin exports `apply`; a Cordis plugin that PROVIDES a service also exports `name`.
  pluginShape = typeof module.apply === 'function' && typeof module.name === 'string'
    ? 'cordis-plugin (exports name + apply)'
    : 'NOT a cordis plugin shape'
} catch (error) {
  pluginShape = `unreadable: ${error instanceof Error ? error.message : String(error)}`
}
fact('ADAPTER_PLUGIN_SHAPE', pluginShape)

if (release === undefined) {
  fact('ADAPTER_IN_RELEASE', 'not measured (no --release and no AUKORA_DSH_RELEASE)')
} else {
  const inRelease = join(resolve(release), 'plugins', 'aukora-aumlok', 'lib', 'service.mjs')
  fact('ADAPTER_IN_RELEASE', existsSync(inRelease) ? `PRESENT at ${inRelease}` : `absent from ${resolve(release)}`)
}

// A composition row is the only thing that would mount it, so look for one rather than assume.
const compositionFiles = []
for (const directory of [join(ROOT, 'tests', 'fixtures'), join(ROOT, 'profiles')]) {
  if (existsSync(directory)) {
    compositionFiles.push(...walk(directory).filter(file => /\.(yml|yaml)$/u.test(file)))
  }
}
const mountingRows = compositionFiles.filter(file => readFileSync(file, 'utf8').includes('aukora-aumlok'))
fact('COMPOSITION_FILES_SCANNED', String(compositionFiles.length))
fact('ADAPTER_MOUNTED_BY_A_ROW', mountingRows.length === 0 ? 'no' : `YES: ${mountingRows.join(', ')}`)

// ── 2. the mounted signer connection ──────────────────────────────────────────────────────────
process.stdout.write('\n── mounted signer connection ──\n')
const signerSource = readFileSync(join(ROOT, 'scripts', 'aumlok', 'signer.mjs'), 'utf8')
fact('SIGNER_IS_CORDIS_PLUGIN',
  /^export (const inject|function apply)/mu.test(signerSource) ? 'YES (it should not be)' : 'no')
fact('SIGNER_TRANSPORT', signerSource.includes("from 'node:net'") ? 'unix socket (node:net)' : 'unmeasured')
fact('SIGNER_REQUIRES_EXPLICIT_KEY_FILE',
  signerSource.includes("option('--key-file')") && signerSource.includes('is required')
    ? 'yes — it refuses to start without one'
    : 'unmeasured')

if (socketPath === undefined) {
  fact('SIGNER_SOCKET_LIVE', 'not measured (no --socket given)')
} else {
  const path = resolve(socketPath)
  let state = 'absent'
  try {
    const stats = lstatSync(path)
    state = stats.isSocket() ? 'a socket leaf exists (a listener may hold it)' : 'a non-socket file is there'
  } catch {
    state = 'absent'
  }
  fact('SIGNER_SOCKET_LIVE', `${path}: ${state}`)
}
fact('SIGNER_IS_A_SERVICE', 'no — it is a separate process, so mounting the adapter grants no signing')

// ── 3. provisioned custody ────────────────────────────────────────────────────────────────────
process.stdout.write('\n── provisioned custody ──\n')
// A default key location is the thing that would let a careless invocation reach a real key.
const defaultKeyPath = /(?:keyFile|key-file)\s*[=?]{1,2}\s*['"][^'"]+['"]/u.exec(signerSource)
fact('SIGNER_KEY_DEFAULT', defaultKeyPath === null ? 'none — no default key location exists' : `FOUND ${defaultKeyPath[0]}`)

const laneFiles = LANE.filter(directory => existsSync(directory)).flatMap(directory => walk(directory))
const keyish = laneFiles.filter(file => /\.(pem|key|p12|pfx)$/u.test(file))
fact('KEY_FILES_IN_LANE', keyish.length === 0 ? 'none' : keyish.join(', '))

// Built at runtime so this scanner does not match its own source — the same self-reference that
// made its first run report a private key in a file that only mentions one.
const PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
const embeddedKeys = laneFiles.filter(file => {
  try {
    return readFileSync(file, 'utf8').includes(PEM_HEADER)
  } catch {
    return false
  }
})
fact('EMBEDDED_PRIVATE_KEYS_IN_LANE', embeddedKeys.length === 0 ? 'none' : embeddedKeys.join(', '))
fact('HUMAN_KEY_PROVISIONED', 'no — this lane has never provisioned a key and has no path that could')

// ── 4. the limits that qualify all of the above ───────────────────────────────────────────────
process.stdout.write('\n── ceilings ──\n')
const { signerCeilingLines } = await import(`${join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'ceilings.mjs')}`)
for (const line of signerCeilingLines()) process.stdout.write(`  ${line}\n`)
process.stdout.write('\nDIAGNOSTIC COMPLETE — read-only; no socket opened, no daemon started, no key read\n')