import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ACTIVATION_REFUSE,
  ACTIVATION_STATEMENT_DOMAIN,
  activationDigest,
  assertActivationDigest,
  encodeActivationStatement,
  parseActivationStatement,
  parseActivationStatementFrame,
} from '../aukora/activation/statement.mjs'
import {
  ACTIVATION_MEASURE_REFUSE,
  measureClosureMember,
  measureDigestManifest,
  measureVerifiedDigestManifest,
} from '../aukora/activation/measure.mjs'
import {
  ACTIVATION_ADMIT_REFUSE,
  ACTIVATION_STATE_REFUSE,
  activationBindingPath,
  admitActivation,
  bindActivation,
  readActivationBinding,
} from '../aukora/activation/broker-state.mjs'
import {
  ACTIVATION_DIGEST_ENV,
  BROKER_REFUSE,
  scrubEnv,
  serve,
} from '../aukora/broker/broker.mjs'
import { grantPreimage, newNonce, payloadDigest } from '../aukora/host-dsh/src/grant.mjs'
import { MEMORY_PUT, definitionDigest } from '../aukora/broker/effect-definition.mjs'
import { buildOperation, operationDigest } from '../aukora/broker/operation.mjs'
import {
  SOURCE_MODEL_EMISSION_POLICY,
  SOURCE_RENDERER_ID,
  buildSourceActivationStatement,
} from '../aukora/supervisor/developer-launch.mjs'

const hex = (pair: string): string => pair.repeat(32)
const EXPECTED_AUTHORITY_CORE_PATHS = [
  'aukora/activation/broker-state.mjs',
  'aukora/activation/statement.mjs',
  'aukora/activation/web-upgrade-record.mjs',
  'aukora/approval/artifact.mjs',
  'aukora/approval/occurrence.mjs',
  'aukora/approval/render.mjs',
  'aukora/aura/record.mjs',
  'aukora/aura/authority-evidence.mjs',
  'aukora/broker/broker.mjs',
  'aukora/broker/confinement.mjs',
  'aukora/broker/effect-body.mjs',
  'aukora/broker/effect-definition.mjs',
  'aukora/broker/effect.mjs',
  'aukora/broker/kira-recall.mjs',
  'aukora/broker/memory-entries.mjs',
  'aukora/broker/memory-put-args.mjs',
  'aukora/broker/operation.mjs',
  'aukora/broker/receipt.mjs',
  'aukora/broker/review.mjs',
  'aukora/broker/subject-authority.mjs',
  'aukora/broker/workspace-patch-args.mjs',
  'aukora/broker/workspace-patch.mjs',
  'aukora/host-dsh/src/grant-v5.mjs',
  'aukora/host-dsh/src/grant.mjs',
  'aukora/host-dsh/src/nonce-book.mjs',
  'aukora/host-dsh/src/verifier-bytes.mjs',
  'aukora/identity/validation.mjs',
  'aukora/identity/broker-state.mjs',
  'aukora/identity/control.mjs',
  'aukora/identity/delegation.mjs',
  'aukora/identity/genesis.mjs',
  'aukora/issuer/issuer.mjs',
  'aukora/issuer/approval-carrier.mjs',
  'aukora/issuer/mint.mjs',
  'aukora/kernel-seed/canonical-json.mjs',
  'aukora/kira/recall.mjs',
  'aukora/kira/stage.mjs',
].toSorted()

/** A complete, valid statement. Every negative case below is exactly one edit away from this. */
const exactStatement = () => ({
  domain: ACTIVATION_STATEMENT_DOMAIN,
  epoch: 1_700_000_000,
  coreManifest: {
    'aukora/broker/broker.mjs': hex('11'),
    'aukora/issuer/issuer.mjs': hex('12'),
  },
  compositionDigest: hex('22'),
  closure: {
    executable: { node: hex('33') },
    resolver: { 'profile-boot': hex('44'), 'staged-profile-patch': hex('45') },
  },
  proposalCellSha256: hex('55'),
  rendererId: hex('56'),
  modelEmissionPolicy: 'aukora:model-emission:none:v1',
  issuerId: hex('66'),
  brokerId: hex('77'),
})

const reasonOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return (error as { reason?: string }).reason ?? `unnamed: ${String(error)}`
  }
  return 'ACCEPTED'
}

const temporaryRoots: string[] = []
const newRoot = (): string => {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'aukora-activation-')))
  temporaryRoots.push(root)
  return root
}

const REPO_ROOT = realpathSync(join(import.meta.dirname, '..'))
const sourceLaunchFixture = (): string => {
  const root = newRoot()
  cpSync(join(REPO_ROOT, 'aukora'), join(root, 'aukora'), { recursive: true })
  for (const path of [
    'apps/cli/src/profile-boot.ts',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'profiles/8088-inside-out/cordis.patch.yml',
    'profiles/8088-inside-out/package.json',
    'tsconfig.base.json',
    'tsconfig.host.json',
    'tsconfig.json',
  ]) {
    const destination = join(root, path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(join(REPO_ROOT, path), destination)
  }
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ActivationStatement is closed and canonical', () => {
  it('accepts one exact statement and digests it deterministically', () => {
    const statement = parseActivationStatement(exactStatement())
    expect(statement.domain).toBe(ACTIVATION_STATEMENT_DOMAIN)
    expect(activationDigest(statement)).toMatch(/^[0-9a-f]{64}$/u)
    expect(activationDigest(exactStatement())).toBe(activationDigest(exactStatement()))
    expect(assertActivationDigest(exactStatement(), activationDigest(exactStatement())))
      .toBe(activationDigest(exactStatement()))
  })

  it('gives every authority-relevant one-byte change a different digest', () => {
    const baseline = activationDigest(exactStatement())
    const mutations: Array<[string, () => Record<string, unknown>]> = [
      ['epoch', () => ({ ...exactStatement(), epoch: 1_700_000_001 })],
      ['coreManifest', () => ({
        ...exactStatement(),
        coreManifest: { 'aukora/broker/broker.mjs': hex('11'), 'aukora/issuer/issuer.mjs': hex('13') },
      })],
      ['compositionDigest', () => ({ ...exactStatement(), compositionDigest: hex('23') })],
      ['closure.executable', () => ({
        ...exactStatement(),
        closure: { executable: { node: hex('34') }, resolver: exactStatement().closure.resolver },
      })],
      ['closure.resolver', () => ({
        ...exactStatement(),
        closure: {
          executable: exactStatement().closure.executable,
          resolver: { 'profile-boot': hex('44'), 'staged-profile-patch': hex('46') },
        },
      })],
      ['proposalCellSha256', () => ({ ...exactStatement(), proposalCellSha256: hex('56') })],
      ['rendererId', () => ({ ...exactStatement(), rendererId: hex('57') })],
      ['modelEmissionPolicy', () => ({ ...exactStatement(), modelEmissionPolicy: 'aukora:model-emission:any:v1' })],
      ['issuerId', () => ({ ...exactStatement(), issuerId: hex('67') })],
      ['brokerId', () => ({ ...exactStatement(), brokerId: hex('78') })],
    ]
    const digests = new Map<string, string>()
    for (const [field, build] of mutations) digests.set(field, activationDigest(build()))
    for (const [field, digest] of digests) {
      expect(digest, `${field} did not move the activation digest`).not.toBe(baseline)
    }
    // Every field must move it to a DIFFERENT place, or two changes would collide.
    expect(new Set(digests.values()).size).toBe(mutations.length)
  })

  it('refuses extra and missing fields by name', () => {
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), extra: 1 })))
      .toBe(ACTIVATION_REFUSE.FIELDS_NOT_EXACT)
    const { brokerId: _dropped, ...missing } = exactStatement()
    expect(reasonOf(() => parseActivationStatement(missing))).toBe(ACTIVATION_REFUSE.FIELDS_NOT_EXACT)
    expect(reasonOf(() => parseActivationStatement({
      ...exactStatement(),
      closure: { executable: { node: hex('33') }, resolver: { a: hex('44') }, extra: {} },
    }))).toBe(ACTIVATION_REFUSE.FIELDS_NOT_EXACT)
  })

  it('refuses an invalid domain, epoch, digest, atom, and manifest by name', () => {
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), domain: 'aukora:activation-statement:v2' })))
      .toBe(ACTIVATION_REFUSE.DOMAIN_MISMATCH)
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), epoch: -1 })))
      .toBe(ACTIVATION_REFUSE.EPOCH_INVALID)
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), epoch: 1.5 })))
      .toBe(ACTIVATION_REFUSE.EPOCH_INVALID)
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), compositionDigest: 'ABC' })))
      .toBe(ACTIVATION_REFUSE.DIGEST_INVALID)
    // Uppercase hex is a different string that names the same bytes; only the
    // lowercase form is canonical. `hex('ab')` is used because an all-digit
    // digest is unchanged by toUpperCase and would assert nothing.
    expect(hex('ab').toUpperCase()).not.toBe(hex('ab'))
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), compositionDigest: hex('ab').toUpperCase() })))
      .toBe(ACTIVATION_REFUSE.DIGEST_INVALID)
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), rendererId: 'renderer with spaces' })))
      .toBe(ACTIVATION_REFUSE.DIGEST_INVALID)
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), coreManifest: {} })))
      .toBe(ACTIVATION_REFUSE.MANIFEST_EMPTY)
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), coreManifest: { a: 'not-a-digest' } })))
      .toBe(ACTIVATION_REFUSE.DIGEST_INVALID)
    expect(reasonOf(() => parseActivationStatement({ ...exactStatement(), coreManifest: [] })))
      .toBe(ACTIVATION_REFUSE.MANIFEST_INVALID)
  })

  it('accepts only the canonical encoding of a frame', () => {
    const canonical = encodeActivationStatement(exactStatement())
    expect(parseActivationStatementFrame(canonical).epoch).toBe(1_700_000_000)
    // Same value, different key order: one activation, so it must not be
    // presentable as a second differently-encoded one.
    const reordered = JSON.stringify(exactStatement())
    expect(reordered).not.toBe(canonical)
    expect(JSON.parse(reordered)).toStrictEqual(JSON.parse(canonical))
    expect(reasonOf(() => parseActivationStatementFrame(reordered)))
      .toBe(ACTIVATION_REFUSE.FRAME_NOT_CANONICAL)
    expect(reasonOf(() => parseActivationStatementFrame(`${canonical} `)))
      .toBe(ACTIVATION_REFUSE.FRAME_NOT_CANONICAL)
    expect(reasonOf(() => parseActivationStatementFrame('{'))).toBe(ACTIVATION_REFUSE.FRAME_MALFORMED)
    expect(reasonOf(() => parseActivationStatementFrame(42))).toBe(ACTIVATION_REFUSE.FRAME_MALFORMED)
  })

  it('refuses a digest that does not belong to the statement', () => {
    expect(reasonOf(() => assertActivationDigest(exactStatement(), hex('99'))))
      .toBe(ACTIVATION_REFUSE.DIGEST_MISMATCH)
  })
})

describe('closure measurement refuses substituted and mutable members', () => {
  it('measures an exact private regular file', () => {
    const root = newRoot()
    const member = join(root, 'member.mjs')
    writeFileSync(member, 'export const a = 1\n', { mode: 0o600 })
    expect(measureClosureMember(member)).toMatch(/^[0-9a-f]{64}$/u)
    expect(measureDigestManifest([{ name: 'member', path: member }])).toStrictEqual({
      member: measureClosureMember(member),
    })
  })

  it('refuses a symlinked member, and the positive control passes', () => {
    const root = newRoot()
    const real = join(root, 'real.mjs')
    writeFileSync(real, 'export const a = 1\n', { mode: 0o600 })
    const link = join(root, 'link.mjs')
    symlinkSync(real, link)
    expect(measureClosureMember(real)).toMatch(/^[0-9a-f]{64}$/u)
    expect(reasonOf(() => measureClosureMember(link))).toBe(ACTIVATION_MEASURE_REFUSE.PATH_SYMLINK)
  })

  it('refuses a member reachable only through a substituted path', () => {
    const root = newRoot()
    const real = join(root, 'real.mjs')
    writeFileSync(real, 'export const a = 1\n', { mode: 0o600 })
    expect(reasonOf(() => measureClosureMember(`${root}/./real.mjs`)))
      .toBe(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED)
    expect(reasonOf(() => measureClosureMember('aukora/broker/broker.mjs')))
      .toBe(ACTIVATION_MEASURE_REFUSE.PATH_NOT_ABSOLUTE)
    // An ancestor link is caught even when the leaf is a real file.
    const linkedDir = join(root, 'linked')
    symlinkSync(root, linkedDir)
    expect(reasonOf(() => measureClosureMember(join(linkedDir, 'real.mjs'))))
      .toBe(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED)
  })

  it('refuses a member any other principal may rewrite', () => {
    const root = newRoot()
    const member = join(root, 'member.mjs')
    writeFileSync(member, 'export const a = 1\n', { mode: 0o600 })
    expect(measureClosureMember(member)).toMatch(/^[0-9a-f]{64}$/u)
    chmodSync(member, 0o620)
    expect(reasonOf(() => measureClosureMember(member))).toBe(ACTIVATION_MEASURE_REFUSE.MEMBER_MUTABLE)
    chmodSync(member, 0o606)
    expect(reasonOf(() => measureClosureMember(member))).toBe(ACTIVATION_MEASURE_REFUSE.MEMBER_MUTABLE)
    chmodSync(member, 0o600)
    expect(measureClosureMember(member)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('refuses a directory and a duplicate member name', () => {
    const root = newRoot()
    const member = join(root, 'member.mjs')
    writeFileSync(member, 'export const a = 1\n', { mode: 0o600 })
    expect(reasonOf(() => measureClosureMember(root))).toBe(ACTIVATION_MEASURE_REFUSE.MEMBER_NOT_FILE)
    expect(reasonOf(() => measureDigestManifest([
      { name: 'a', path: member },
      { name: 'a', path: member },
    ]))).toBe(ACTIVATION_MEASURE_REFUSE.MEMBER_NAME_INVALID)
  })

  it('reports a changed member as a different digest', () => {
    const root = newRoot()
    const member = join(root, 'member.mjs')
    writeFileSync(member, 'export const a = 1\n', { mode: 0o600 })
    const before = measureClosureMember(member)
    writeFileSync(member, 'export const a = 2\n', { mode: 0o600 })
    expect(measureClosureMember(member)).not.toBe(before)
  })

  it('remeasures a selected graph member and refuses stale selector evidence', () => {
    const root = newRoot()
    const member = join(root, 'member.mjs')
    writeFileSync(member, 'export const a = 1\n', { mode: 0o600 })
    const sha256 = measureClosureMember(member)
    expect(measureVerifiedDigestManifest([{ name: 'member', path: member, sha256 }]))
      .toStrictEqual({ member: sha256 })
    writeFileSync(member, 'export const a = 2\n', { mode: 0o600 })
    expect(reasonOf(() => measureVerifiedDigestManifest([{ name: 'member', path: member, sha256 }])))
      .toBe(ACTIVATION_MEASURE_REFUSE.MEMBER_DIGEST_MISMATCH)
    chmodSync(member, 0o620)
    expect(reasonOf(() => measureVerifiedDigestManifest([{ name: 'member', path: member, sha256 }])))
      .toBe(ACTIVATION_MEASURE_REFUSE.MEMBER_MUTABLE)
  })
})

describe('the broker-owned activation binding', () => {
  it('binds create-if-absent and refuses a second activation', () => {
    const root = newRoot()
    expect(readActivationBinding(root)).toBeNull()
    expect(bindActivation(root, hex('ab'))).toBe(hex('ab'))
    expect(readActivationBinding(root)).toBe(hex('ab'))
    // A restart over surviving state may serve the same activation.
    expect(bindActivation(root, hex('ab'))).toBe(hex('ab'))
    expect(reasonOf(() => bindActivation(root, hex('cd')))).toBe(ACTIVATION_STATE_REFUSE.CONFLICT)
    expect(readActivationBinding(root)).toBe(hex('ab'))
  })

  it('treats corruption as an answer, never as absence', () => {
    const root = newRoot()
    bindActivation(root, hex('ab'))
    writeFileSync(activationBindingPath(root), '{ not json', { mode: 0o600 })
    expect(reasonOf(() => readActivationBinding(root))).toBe(ACTIVATION_STATE_REFUSE.MALFORMED)
    writeFileSync(activationBindingPath(root), JSON.stringify({
      activationDigest: hex('ab'),
      domain: 'aukora:activation-binding:v2',
    }), { mode: 0o600 })
    expect(reasonOf(() => readActivationBinding(root))).toBe(ACTIVATION_STATE_REFUSE.MALFORMED)
    expect(reasonOf(() => bindActivation(root, 'not-a-digest'))).toBe(ACTIVATION_STATE_REFUSE.MALFORMED)
  })
})

describe('check-at-use admission', () => {
  it('admits only when all three activations agree', () => {
    expect(admitActivation({ expected: hex('ab'), persisted: hex('ab'), presented: hex('ab') }))
      .toStrictEqual({ ok: true })
  })

  it('refuses a swapped state directory, a stale authorization, and an unbound effect', () => {
    const swapped = admitActivation({ expected: hex('ab'), persisted: hex('cd'), presented: hex('ab') })
    expect(swapped).toMatchObject({ ok: false, reason: ACTIVATION_ADMIT_REFUSE.MISMATCH })
    const erased = admitActivation({ expected: hex('ab'), persisted: null, presented: hex('ab') })
    expect(erased).toMatchObject({ ok: false, reason: ACTIVATION_ADMIT_REFUSE.MISMATCH })
    const stale = admitActivation({ expected: hex('ab'), persisted: hex('ab'), presented: hex('cd') })
    expect(stale).toMatchObject({ ok: false, reason: ACTIVATION_ADMIT_REFUSE.STALE })
    const unbound = admitActivation({ expected: hex('ab'), persisted: hex('ab'), presented: null })
    expect(unbound).toMatchObject({ ok: false, reason: ACTIVATION_ADMIT_REFUSE.UNBOUND })
    expect(admitActivation({ expected: hex('ab'), persisted: hex('ab'), presented: undefined }))
      .toMatchObject({ ok: false, reason: ACTIVATION_ADMIT_REFUSE.UNBOUND })
  })

  it('defers when this broker serves no activation binding', () => {
    expect(admitActivation({ expected: null, persisted: null, presented: null })).toStrictEqual({ ok: true })
    expect(admitActivation({ expected: null, persisted: hex('ab'), presented: hex('cd') }))
      .toStrictEqual({ ok: true })
  })
})

/** One newline-delimited broker request. */
function brokerRequest(socketPath: string, request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolveReply, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      run()
    }
    const timer = setTimeout(() => {
      finish(() => { reject(new Error('broker request timed out')) })
    }, 10_000)
    socket.once('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
    socket.once('error', (error) => { finish(() => { reject(error) }) })
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      const reply = JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>
      finish(() => { resolveReply(reply) })
    })
  })
}

describe('the broker enforces its activation immediately before the effect', () => {
  const started: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    for (const broker of started.splice(0)) await broker.close().catch(() => {})
  })

  /** Start one real broker over a real socket, optionally bound to an activation. */
  const startBroker = async (activation?: string) => {
    const root = newRoot()
    const stateDir = join(root, 'state')
    mkdirSync(stateDir, { mode: 0o700 })
    const socketPath = join(root, 'b.sock')
    const root_ = generateKeyPairSync('ed25519')
    const rootPublicKeyPem = root_.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const broker = await serve({
      socketPath,
      stateDir,
      rootPublicKeyPem,
      ...(activation === undefined ? {} : { activationDigest: activation }),
    })
    started.push(broker)
    return { socketPath, stateDir, privateKey: root_.privateKey }
  }

  /** Mint one genuinely valid v3 grant for `memory.put`. */
  const mintGrant = (
    privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
    receiptKeyId: string,
    args: { key: string; value: unknown },
  ) => {
    const exp = Math.floor(Date.now() / 1000) + 300
    const claims = {
      toolName: MEMORY_PUT,
      digest: payloadDigest(MEMORY_PUT, args),
      nonce: newNonce(),
      exp,
      definitionId: definitionDigest(),
      operationDigest: operationDigest(buildOperation(args, exp)),
      receiptKeyId,
    }
    return {
      ...claims,
      signature: edSign(null, grantPreimage(claims), privateKey).toString('base64'),
    }
  }

  it('settles a valid grant when no activation is bound — the positive control', async () => {
    const { socketPath, privateKey } = await startBroker()
    const status = await brokerRequest(socketPath, { op: 'status' })
    expect(status.activationDigest).toBeNull()
    const args = { key: 'notes.control', value: { a: 1 } }
    const grant = mintGrant(privateKey, status.receiptKeyId as string, args)
    const settled = await brokerRequest(socketPath, {
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: args,
      grant,
    })
    expect(settled).toMatchObject({ ok: true, state: 'SETTLED' })
  })

  it('publishes its binding and writes it to broker-owned state', async () => {
    const activation = hex('ab')
    const { socketPath, stateDir } = await startBroker(activation)
    const status = await brokerRequest(socketPath, { op: 'status' })
    expect(status.activationDigest).toBe(activation)
    expect(readActivationBinding(stateDir)).toBe(activation)
    expect(JSON.parse(readFileSync(activationBindingPath(stateDir), 'utf8'))).toStrictEqual({
      activationDigest: activation,
      domain: 'aukora:activation-binding:v1',
    })
  })

  it('refuses an otherwise valid grant that names no activation', async () => {
    const activation = hex('ab')
    const { socketPath, stateDir, privateKey } = await startBroker(activation)
    const status = await brokerRequest(socketPath, { op: 'status' })
    const args = { key: 'notes.unbound', value: { a: 1 } }
    // The SAME grant construction settles in the control above, so the refusal
    // below is the activation gate and nothing else.
    const grant = mintGrant(privateKey, status.receiptKeyId as string, args)
    const settled = await brokerRequest(socketPath, {
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: args,
      grant,
    })
    expect(settled).toMatchObject({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.ACTIVATION_UNBOUND })
    expect(existsSync(join(stateDir, 'nonces', grant.nonce))).toBe(false)
    expect(existsSync(join(stateDir, 'memory'))).toBe(false)
    expect(existsSync(join(stateDir, 'aura.jsonl'))).toBe(false)
  })

  it('re-reads its binding at use, so a state directory swapped while running refuses', async () => {
    const activation = hex('ab')
    const { socketPath, stateDir, privateKey } = await startBroker(activation)
    const status = await brokerRequest(socketPath, { op: 'status' })
    // The broker is already running and already reported the right binding.
    // Only a check that reads state again at use can see this.
    writeFileSync(activationBindingPath(stateDir), JSON.stringify({
      activationDigest: hex('cd'),
      domain: 'aukora:activation-binding:v1',
    }), { mode: 0o600 })
    const args = { key: 'notes.swapped', value: { a: 1 } }
    const grant = mintGrant(privateKey, status.receiptKeyId as string, args)
    const settled = await brokerRequest(socketPath, {
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: args,
      grant,
    })
    expect(settled).toMatchObject({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.ACTIVATION_MISMATCH })
    expect(existsSync(join(stateDir, 'nonces', grant.nonce))).toBe(false)
    expect(existsSync(join(stateDir, 'memory'))).toBe(false)
    expect(existsSync(join(stateDir, 'aura.jsonl'))).toBe(false)
  })

  it('refuses when the binding is corrupted rather than treating it as absent', async () => {
    const activation = hex('ab')
    const { socketPath, stateDir, privateKey } = await startBroker(activation)
    const status = await brokerRequest(socketPath, { op: 'status' })
    writeFileSync(activationBindingPath(stateDir), '{ not json', { mode: 0o600 })
    const args = { key: 'notes.corrupt', value: { a: 1 } }
    const grant = mintGrant(privateKey, status.receiptKeyId as string, args)
    const settled = await brokerRequest(socketPath, {
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: args,
      grant,
    })
    expect(settled).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.ACTIVATION_STATE_MALFORMED,
    })
  })

  it('refuses to serve a state directory bound to another activation', () => {
    const root = newRoot()
    const stateDir = join(root, 'state')
    mkdirSync(stateDir, { mode: 0o700 })
    bindActivation(stateDir, hex('cd'))
    const keys = generateKeyPairSync('ed25519')
    expect(() => serve({
      socketPath: join(root, 'b.sock'),
      stateDir,
      rootPublicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      activationDigest: hex('ab'),
    })).toThrow(ACTIVATION_STATE_REFUSE.CONFLICT)
  })

  it('refuses to restart bound state when the activation option is omitted', () => {
    const root = newRoot()
    const stateDir = join(root, 'state')
    mkdirSync(stateDir, { mode: 0o700 })
    bindActivation(stateDir, hex('ab'))
    const keys = generateKeyPairSync('ed25519')
    expect(() => serve({
      socketPath: join(root, 'b.sock'),
      stateDir,
      rootPublicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })).toThrow(BROKER_REFUSE.ACTIVATION_UNBOUND)
  })

  it('accepts an activation digest only from the explicit spawn option', () => {
    expect(scrubEnv({
      [ACTIVATION_DIGEST_ENV]: hex('ab'),
      AUKORA_TEST_KEEP: 'yes',
    })).toEqual({ AUKORA_TEST_KEEP: 'yes' })
  })
})

describe('the source launcher validates its activation before any child starts', () => {
  const stage = (root: string, patchBody: string) => {
    const manifestPath = join(root, 'package.json')
    const patchPath = join(root, 'cordis.patch.yml')
    writeFileSync(manifestPath, '{"name":"staged"}\n', { mode: 0o600 })
    writeFileSync(patchPath, patchBody, { mode: 0o600 })
    return {
      stagedManifestPath: manifestPath,
      stagedPatchPath: patchPath,
      stagedProfile: { manifestSha256: hex('aa'), patchSha256: hex('bb') },
      rendererId: SOURCE_RENDERER_ID,
      issuerId: hex('cc'),
      brokerId: hex('dd'),
      epoch: 1_700_000_000,
    }
  }

  it('builds one complete statement from real measured members', () => {
    const inputs = stage(newRoot(), 'brokerSocket: "/run/x.sock"\n')
    const statement = buildSourceActivationStatement(inputs)
    expect(statement.domain).toBe(ACTIVATION_STATEMENT_DOMAIN)
    expect(statement.rendererId).toBe(SOURCE_RENDERER_ID)
    expect(statement.modelEmissionPolicy).toBe(SOURCE_MODEL_EMISSION_POLICY)
    expect(statement.issuerId).toBe(hex('cc'))
    expect(statement.brokerId).toBe(hex('dd'))
    // Every current static authority node plus the graph selector is measured.
    expect(Object.keys(statement.coreManifest).toSorted()).toStrictEqual(EXPECTED_AUTHORITY_CORE_PATHS)
    expect(statement.coreManifest['aukora/broker/broker.mjs']).toMatch(/^[0-9a-f]{64}$/u)
    expect(Object.keys(statement.closure.executable).toSorted())
      .toStrictEqual([
        'activation-measure',
        'activation-statement',
        'developer-launch-error',
        'guest-entry',
        'issuer-approval-bridge',
        'node',
        'parent-launcher',
        'parent-terminal-renderer',
      ])
    expect(Object.keys(statement.closure.resolver).toSorted())
      .toStrictEqual([
        'profile-boot',
        'root-package-manifest',
        'source-profile-manifest',
        'source-profile-patch',
        'staged-profile-manifest',
        'staged-profile-patch',
        'tsx-host-program',
        'tsx-paths-base',
        'tsx-paths-root',
        'workspace-layout',
        'workspace-lockfile',
      ])
    expect(activationDigest(statement)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('moves the activation digest when either activation-semantics source changes', async () => {
    const root = sourceLaunchFixture()
    const copied = await import(
      pathToFileURL(join(root, 'aukora/supervisor/developer-launch.mjs')).href,
    ) as typeof import('../aukora/supervisor/developer-launch.mjs')
    const inputs = stage(newRoot(), 'brokerSocket: "/run/x.sock"\n')
    const baseline = activationDigest(copied.buildSourceActivationStatement(inputs))

    for (const path of ['activation/statement.mjs', 'activation/measure.mjs']) {
      const member = join(root, 'aukora', path)
      const original = readFileSync(member)
      writeFileSync(member, Buffer.concat([original, Buffer.from('\n// source-identity mutation\n')]))
      expect(activationDigest(copied.buildSourceActivationStatement(inputs))).not.toBe(baseline)
      writeFileSync(member, original)
      expect(activationDigest(copied.buildSourceActivationStatement(inputs))).toBe(baseline)
    }
  })

  it('gives a changed staged composition a different activation digest', () => {
    const before = buildSourceActivationStatement(stage(newRoot(), 'brokerSocket: "/run/a.sock"\n'))
    const after = buildSourceActivationStatement(stage(newRoot(), 'brokerSocket: "/run/b.sock"\n'))
    expect(activationDigest(after)).not.toBe(activationDigest(before))
  })

  it('binds the parent-owned KIRA recall policy into the composition identity', () => {
    const inputs = stage(newRoot(), 'brokerSocket: "/run/x.sock"\n')
    const withoutRecall = buildSourceActivationStatement(inputs)
    const withRecall = buildSourceActivationStatement({
      ...inputs,
      kiraRecallPolicy: { subject: 'aukora:subject:owner', privacy: ['local'] },
    })
    const widerRecall = buildSourceActivationStatement({
      ...inputs,
      kiraRecallPolicy: { subject: 'aukora:subject:owner', privacy: ['local', 'private'] },
    })
    expect(activationDigest(withRecall)).not.toBe(activationDigest(withoutRecall))
    expect(activationDigest(widerRecall)).not.toBe(activationDigest(withRecall))
  })

  it('refuses to build a statement over a substituted staged member', () => {
    const root = newRoot()
    const inputs = stage(root, 'brokerSocket: "/run/x.sock"\n')
    // A launch whose staged patch is a link to bytes reviewed elsewhere must
    // not produce an activation at all: it dies before the first child.
    const decoy = join(root, 'decoy.yml')
    writeFileSync(decoy, 'brokerSocket: "/run/evil.sock"\n', { mode: 0o600 })
    rmSync(inputs.stagedPatchPath)
    symlinkSync(decoy, inputs.stagedPatchPath)
    expect(reasonOf(() => buildSourceActivationStatement(inputs)))
      .toBe(ACTIVATION_MEASURE_REFUSE.PATH_SYMLINK)
  })

  it('refuses to build a statement over a mutable staged member', () => {
    const root = newRoot()
    const inputs = stage(root, 'brokerSocket: "/run/x.sock"\n')
    expect(activationDigest(buildSourceActivationStatement(inputs))).toMatch(/^[0-9a-f]{64}$/u)
    chmodSync(inputs.stagedPatchPath, 0o620)
    expect(reasonOf(() => buildSourceActivationStatement(inputs)))
      .toBe(ACTIVATION_MEASURE_REFUSE.MEMBER_MUTABLE)
  })

  it('refuses a malformed identity supplied to the statement builder', () => {
    const inputs = stage(newRoot(), 'brokerSocket: "/run/x.sock"\n')
    expect(reasonOf(() => buildSourceActivationStatement({ ...inputs, rendererId: 'named-but-unmeasured' })))
      .toBe(ACTIVATION_REFUSE.DIGEST_INVALID)
    expect(reasonOf(() => buildSourceActivationStatement({ ...inputs, brokerId: 'not-a-digest' })))
      .toBe(ACTIVATION_REFUSE.DIGEST_INVALID)
    expect(reasonOf(() => buildSourceActivationStatement({ ...inputs, epoch: -1 })))
      .toBe(ACTIVATION_REFUSE.EPOCH_INVALID)
  })
})
