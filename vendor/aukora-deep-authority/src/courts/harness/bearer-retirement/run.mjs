/**
 * courts/harness/bearer-retirement - does the product guest receive signed
 * authorization, and what custody limits remain after the route migration?
 *
 * The default memory.put route now gives the guest only the broker socket. It
 * deposits an inert proposal and accepts only public proposal state. The v3
 * issuer bridge remains in the package as an explicit regression oracle; its
 * existence is not evidence that a product profile selects it.
 *
 * This court separates product routing from process custody:
 *
 *   B1  product route   omitted issuerSocket selects BrokerProposalClient
 *   B2  public surface  the product result contains no authority artifact
 *   B3  route active    production code calls all three proposal operations
 *   B4  legacy oracle   v3 issuance exists only behind explicit issuerSocket
 *   B5  issuer reach    a separate same-uid process reaches the issuer socket
 *   B6  key custody     a separate same-uid process reads the issuer key
 *
 * B1-B4 are source observations of the code and profile that ship. B5-B6 are
 * live ceilings: bearer retirement is not a privilege split. A missing source,
 * daemon, socket, or probe result is INCONCLUSIVE, never a held row.
 *
 * The mutation arm reverses the product route selector in memory. The court
 * must add B1 to the breach set while retaining the live custody observations.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { connect } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MUTATE = process.argv.includes('--mutate')
const EXIT_INCONCLUSIVE = 78
const rows = []
const row = (n, name, breach, detail, inconclusive = false) => {
  rows.push({ n, name, breach, detail, inconclusive })
}
const EXPECTED = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']
const read = (path) => {
  try {
    return readFileSync(join(ROOT, path), 'utf8')
  } catch {
    return null
  }
}

const indexSource = read('packages/governed/memory-put/src/index.ts')
const proposalSource = read('packages/governed/memory-put/src/proposal-client.ts')
const bridgeSource = read('packages/governed/memory-put/src/bridge.ts')
const profileSource = read('profiles/8088-inside-out/cordis.patch.yml')
const brokerSource = read('aukora/broker/broker.mjs')

// ---- B1: what route does the product select by default? --------------------
let observedIndex = indexSource
let mutationApplied = false
if (MUTATE && observedIndex !== null) {
  const honest = 'const proposalClient = config.issuerSocket === undefined'
  const mutant = 'const proposalClient = config.issuerSocket !== undefined'
  if (observedIndex.split(honest).length === 2) {
    observedIndex = observedIndex.replace(honest, mutant)
    mutationApplied = true
  }
}

if (observedIndex === null || profileSource === null) {
  const missing = [
    observedIndex === null ? 'index.ts' : null,
    profileSource === null ? 'cordis.patch.yml' : null,
  ].filter(Boolean)
  row('B1', 'product-route', false, `required source unreadable: ${missing.join(', ')}`, true)
} else if (MUTATE && !mutationApplied) {
  row('B1', 'product-route', false, 'route-selector mutation did not apply exactly once', true)
} else {
  const proposalIsDefault = /const proposalClient = config\.issuerSocket === undefined\s*\?\s*new BrokerProposalClient/.test(observedIndex)
  const legacyIsExplicit = /if \(config\.issuerSocket !== undefined\) \{\s*registerIssuerBridge/.test(observedIndex)
  const profileHasBroker = /^\s*brokerSocket:\s*['"][^'"]+['"]\s*$/m.test(profileSource)
  const profileHasIssuer = /^\s*issuerSocket:/m.test(profileSource)
  const held = proposalIsDefault && legacyIsExplicit && profileHasBroker && !profileHasIssuer
  row('B1', 'product-route', !held,
    `proposalDefault=${proposalIsDefault} legacyExplicit=${legacyIsExplicit} `
      + `profileBroker=${profileHasBroker} profileIssuer=${profileHasIssuer}`)
}

// ---- B2: can the product reply carry authority bytes? ----------------------
if (proposalSource === null || indexSource === null) {
  const missing = [
    proposalSource === null ? 'proposal-client.ts' : null,
    indexSource === null ? 'index.ts' : null,
  ].filter(Boolean)
  row('B2', 'public-surface', false, `required source unreadable: ${missing.join(', ')}`, true)
} else {
  const typeStart = proposalSource.indexOf('export type ProposalTerminalResult =')
  const typeEnd = proposalSource.indexOf('/** A named proposal failure', typeStart)
  const terminalType = typeStart === -1 || typeEnd === -1
    ? ''
    : proposalSource.slice(typeStart, typeEnd)
  const forbidden = ['grant', 'signature', 'nonce', 'authorizationDigest', 'receipt', 'issuerSocket']
  const forbiddenFields = forbidden.filter((field) => new RegExp(`\\b${field}\\b`).test(terminalType))
  const exactDeposit = /Object\.keys\(deposited\)\.length !== 3/.test(proposalSource)
  const exactSuccess = /Object\.keys\(reply\)\.length === 3/.test(proposalSource)
  const exactRefusal = /Object\.keys\(reply\)\.length === 4/.test(proposalSource)
  const productReturnsPublicState = /const result = await proposalClient\.settle[\s\S]*return result as JsonValue/.test(indexSource)
  const held = terminalType !== ''
    && forbiddenFields.length === 0
    && exactDeposit
    && exactSuccess
    && exactRefusal
    && productReturnsPublicState
  row('B2', 'public-surface', !held,
    `terminalType=${terminalType !== ''} forbidden=[${forbiddenFields.join(' ')}] `
      + `closedFrames=${exactDeposit && exactSuccess && exactRefusal} publicReturn=${productReturnsPublicState}`)
}

// ---- B3: is the proposal route a production caller, not dormant code? ------
if (proposalSource === null || indexSource === null || brokerSource === null || profileSource === null) {
  const missing = [
    proposalSource === null ? 'proposal-client.ts' : null,
    indexSource === null ? 'index.ts' : null,
    brokerSource === null ? 'broker.mjs' : null,
    profileSource === null ? 'cordis.patch.yml' : null,
  ].filter(Boolean)
  row('B3', 'route-active', false, `required source unreadable: ${missing.join(', ')}`, true)
} else {
  const operations = ['proposal.open', 'proposal.deposit', 'proposal.status']
  const clientOps = operations.filter((operation) => proposalSource.includes(`op: '${operation}'`))
  const brokerOps = operations.filter((operation) => brokerSource.includes(`'${operation}'`))
  const detachedArgsFlow = indexSource.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*proposeMemoryPutThroughCell\(args,\s*pendingEntry\.args\)\s+const\s+result\s*=\s*await\s+proposalClient\.settle\(callId,\s*\1,\s*exec\.signal\)/,
  )
  const productionCall = detachedArgsFlow !== null
  const productMount = /name:\s*['"]@deepseek-ai\/dsh-aukora-memory['"]/.test(profileSource)
  const held = clientOps.length === 3 && brokerOps.length === 3 && productionCall && productMount
  row('B3', 'route-active', !held,
    `clientOps=${clientOps.length}/3 brokerOps=${brokerOps.length}/3 `
      + `productionCall=${productionCall} productMount=${productMount}`)
}

// ---- B4: is the retained v3 bridge isolated from the product default? -------
if (bridgeSource === null || indexSource === null || profileSource === null) {
  const missing = [
    bridgeSource === null ? 'bridge.ts' : null,
    indexSource === null ? 'index.ts' : null,
    profileSource === null ? 'cordis.patch.yml' : null,
  ].filter(Boolean)
  row('B4', 'legacy-oracle', false, `required source unreadable: ${missing.join(', ')}`, true)
} else {
  const oracleIssues = /op:\s*'issue'/.test(bridgeSource)
    && /reply\.grant/.test(bridgeSource)
    && /grant:\s*reply\.grant/.test(bridgeSource)
  const optionalConfig = /issuerSocket\?:\s*string/.test(indexSource)
  const explicitGuard = /if \(config\.issuerSocket !== undefined\) \{\s*registerIssuerBridge/.test(indexSource)
  const productOmitsRoute = !/^\s*issuerSocket:/m.test(profileSource)
  const held = oracleIssues && optionalConfig && explicitGuard && productOmitsRoute
  row('B4', 'legacy-oracle', !held,
    `v3Oracle=${oracleIssues} optionalConfig=${optionalConfig} `
      + `explicitGuard=${explicitGuard} productOmitsRoute=${productOmitsRoute}`)
}

// ---- B5/B6: live process-custody ceilings ----------------------------------
const TEMP = mkdtempSync(join(tmpdir(), 'aukora-bearer-'))
let issuer = null
try {
  const { privateKey } = generateKeyPairSync('ed25519')
  const keyFile = join(TEMP, 'issuer.key')
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  const socket = join(TEMP, 'issuer.sock')
  issuer = spawn(process.execPath, [join(ROOT, 'aukora', 'issuer', 'issuer.mjs')], {
    env: {
      ...process.env,
      AUKORA_ISSUER_SOCKET: socket,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: createHash('sha256')
        .update('court-bearer-receipt-key')
        .digest('hex'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let issuerError = ''
  issuer.stderr?.on('data', (data) => { issuerError += String(data) })
  const ready = await new Promise((resolve) => {
    const started = Date.now()
    const attempt = () => {
      const connection = connect(socket)
      connection.once('connect', () => {
        connection.destroy()
        resolve(true)
      })
      connection.once('error', () => {
        connection.destroy()
        if (Date.now() - started >= 6_000) resolve(false)
        else setTimeout(attempt, 60)
      })
    }
    attempt()
  })

  if (!ready) {
    const detail = `issuer did not bind within 6s; stderr=${JSON.stringify(issuerError.slice(0, 200))}`
    row('B5', 'issuer-reach', false, detail, true)
  } else {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { connect } from 'node:net'
      const socket = connect(process.env.AUKORA_PROBE_SOCKET)
      let settled = false
      const finish = (answer) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        process.stdout.write(JSON.stringify({ uid: process.getuid(), ...answer }))
        socket.destroy()
      }
      const timer = setTimeout(() => finish({ reached: false, code: 'TIMEOUT' }), 3000)
      socket.once('connect', () => finish({ reached: true }))
      socket.once('error', (error) => finish({ reached: false, code: error.code ?? null }))
    `], {
      env: { ...process.env, AUKORA_PROBE_SOCKET: socket },
      encoding: 'utf8',
      timeout: 5_000,
    })
    let answer = null
    try {
      answer = JSON.parse(probe.stdout)
    } catch {
      // Graded below as missing probe evidence.
    }
    if (probe.status !== 0 || answer === null || typeof answer.reached !== 'boolean') {
      row('B5', 'issuer-reach', false,
        `peer probe produced no result (status=${String(probe.status)} stderr=${JSON.stringify(probe.stderr)})`, true)
    } else {
      const socketOwnerUid = statSync(socket).uid
      const sameUid = answer.uid === socketOwnerUid
      const breached = answer.reached === true && sameUid
      row('B5', 'issuer-reach', breached,
        `peerUid=${String(answer.uid)} socketOwnerUid=${String(socketOwnerUid)} `
          + `sameUid=${sameUid} reached=${String(answer.reached)} code=${String(answer.code ?? 'none')}`)
    }
  }

  const keyProbe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs'
    try {
      const bytes = readFileSync(process.env.AUKORA_PROBE_KEY)
      process.stdout.write(JSON.stringify({ uid: process.getuid(), opened: true, bytes: bytes.length }))
    } catch (error) {
      process.stdout.write(JSON.stringify({ uid: process.getuid(), opened: false, code: error.code ?? null }))
    }
  `], {
    env: { ...process.env, AUKORA_PROBE_KEY: keyFile },
    encoding: 'utf8',
    timeout: 5_000,
  })
  let keyAnswer = null
  try {
    keyAnswer = JSON.parse(keyProbe.stdout)
  } catch {
    // Graded below as missing probe evidence.
  }
  if (keyProbe.status !== 0 || keyAnswer === null || typeof keyAnswer.opened !== 'boolean') {
    row('B6', 'same-uid-key', false,
      `key probe produced no result (status=${String(keyProbe.status)} stderr=${JSON.stringify(keyProbe.stderr)})`, true)
  } else {
    const keyOwnerUid = statSync(keyFile).uid
    const sameUid = keyAnswer.uid === keyOwnerUid
    const breached = keyAnswer.opened === true && sameUid && keyAnswer.bytes > 0
    row('B6', 'same-uid-key', breached,
      `peerUid=${String(keyAnswer.uid)} keyOwnerUid=${String(keyOwnerUid)} sameUid=${sameUid} `
        + `opened=${String(keyAnswer.opened)} bytes=${String(keyAnswer.bytes ?? 0)} `
        + `code=${String(keyAnswer.code ?? 'none')}`)
  }
} catch (error) {
  const detail = `live custody setup failed: ${error instanceof Error ? error.message : String(error)}`
  if (!rows.some((result) => result.n === 'B5')) row('B5', 'issuer-reach', false, detail, true)
  if (!rows.some((result) => result.n === 'B6')) row('B6', 'same-uid-key', false, detail, true)
} finally {
  issuer?.kill('SIGKILL')
  rmSync(TEMP, { recursive: true, force: true })
}

// ---- report ----------------------------------------------------------------
console.log('\n  courts/harness/bearer-retirement - product bearer retirement and custody ceilings\n')
for (const result of rows) {
  const verdict = result.inconclusive
    ? '*** INCONCLUSIVE ***'
    : result.breach
      ? '*** BREACH ***'
      : 'held'
  console.log(`  ${result.n}  ${result.name.padEnd(15)} ${verdict.padEnd(22)} ${result.detail}`)
}

const measured = rows.map((result) => result.n)
const complete = EXPECTED.every((name) => measured.includes(name))
const inconclusive = rows.filter((result) => result.inconclusive).map((result) => result.n)
const breaches = rows.filter((result) => result.breach).map((result) => result.n).sort()
const expectedBreaches = MUTATE ? ['B1', 'B5', 'B6'] : ['B5', 'B6']
const matched = JSON.stringify(breaches) === JSON.stringify(expectedBreaches)
console.log(`\n  breached=[${breaches.join(' ')}]  predicted=[${expectedBreaches.join(' ')}]  matched=${matched}`)
console.log('  B1-B4 grade the product route. B5-B6 are retained process-custody ceilings.\n')

if (!complete || inconclusive.length > 0) {
  console.log(`  observationClass: INCONCLUSIVE rows=[${inconclusive.join(' ')}]\n`)
  process.exit(EXIT_INCONCLUSIVE)
}

if (!matched) {
  console.log('  observationClass: UNEXPECTED_BREACH_SET\n')
  process.exit(2)
}

if (MUTATE) {
  const detected = mutationApplied && rows.some((result) => result.n === 'B1' && result.breach)
  console.log(`  MUTATION product-selects-legacy-route   ${detected ? 'MUTATION CONFIRMED' : 'NOT DETECTED'}\n`)
  process.exit(1)
}

console.log('  observationClass: SELF-REPORTED\n')
process.exit(breaches.length > 0 ? 1 : 0)
