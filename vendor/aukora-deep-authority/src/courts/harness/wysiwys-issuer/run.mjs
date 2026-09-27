/**
 * courts/harness/wysiwys-issuer — the signing prompt presents the exact
 * content-addressed object body and fixed operation fields.
 *
 * The issuer daemon holds the root Ed25519 private key. It attempts to mint a
 * grant only after the active prompt discloses a fresh challenge and receives
 * a complete input line equal to `yes <challenge>`. Input outside the active
 * prompt is discarded. The issuer also refuses a returned grant whose signed
 * operation digest differs from the digest it presented.
 *
 * Every row spawns `node aukora/issuer/issuer.mjs`, connects to its Unix socket
 * and grades its captured stderr. W7 checks shared-renderer identity, while W8
 * independently decodes the live exact-body field and compares its UTF-8 bytes
 * with `effectBody(args)`.
 *
 *   W1.key-alphabet   a bidi/zero-width KEY never reaches the render at all:
 *                     KEY_SHAPE refuses it first (`issuer:key-not-a-name`).
 *                     The remaining hostile code points are in the effect
 *                     body.
 *   W2.bidi           no raw bidi override/embedding/isolate code point
 *                     survives into the issuer's stderr.
 *   W3.invisible      no raw soft hyphen, zero-width, variation selector,
 *                     tag, directional-mark or Unicode line separator does.
 *   W4.ansi           no raw C0 byte — ESC included — survives into stderr.
 *   W5.multiline      an effect body carrying real newlines and a forged
 *                     `key:` line adds no lines and draws no field: the render
 *                     is exactly the shared body plus a header and a footer,
 *                     and each of the nine fields appears exactly once.
 *   W6.digest-signed  the operationDigest and contentSha256 printed on the
 *                     approval screen are the ones the returned grant is bound
 *                     to. Approval covers a digest the human was shown.
 *   W7.one-renderer   the issuer's rendered body is byte-identical to
 *                     `renderOperation()` — one renderer, not a trusted copy
 *                     and an untrusted copy that can drift.
 *   W8.effect-body    the live `effectBodyUtf8` JSON string decodes to the
 *                     exact `effectBody(args)` UTF-8 bytes, including the
 *                     terminal newline. This does not grade the shared
 *                     renderer against itself.
 *   W9.omitted-value  omitted `value` refuses by name before a prompt.
 *   W9.rider-key      any rider key refuses by name before a prompt.
 *   W10.denial        an answer other than the displayed fresh challenge
 *                     refuses; the render assertions use a settled denial.
 *   W11.ascii         every live prompt byte is LF or printable ASCII; the
 *                     exact-body field carries all other code points as JSON
 *                     escapes while still decoding byte-exactly.
 *   W12.fields        every singleton live field equals the independently
 *                     derived effect bytes, hashes and fixed operation data.
 *   W13.mint-drift     an approved issuance returns a grant over the exact
 *                     operation shown to the human. A substituted minter that
 *                     signs different operation bytes is refused before its
 *                     artifact leaves the issuer.
 *
 *   MUTATION          a copy of the issuer retains the shared renderer but
 *                     replaces the exact object-body field with the semantic
 *                     `JSON.stringify(value)` display. Mutation mode requires
 *                     W7-W8 and the expected Unicode rows to breach while all
 *                     named non-target controls hold.
 *   RIDER MUTATION    a second copy bypasses only the exact-argument check.
 *                     W9 must breach while every non-target row holds.
 *   FIELD MUTATION    a copy changes only the displayed content digest. The
 *                     independent field-binding row must detect the drift.
 *   MINT-DRIFT         a copied minter signs an expiry one second later while
 *                     returning an auxiliary digest for the original prompt.
 *                     The issuer must reject the signed artifact rather than
 *                     trusting that auxiliary value.
 *
 *   node courts/harness/wysiwys-issuer/run.mjs
 *   node courts/harness/wysiwys-issuer/run.mjs --mutate
 *   node courts/harness/wysiwys-issuer/run.mjs --mutate-rider
 *   node courts/harness/wysiwys-issuer/run.mjs --mutate-fields
 *   node courts/harness/wysiwys-issuer/run.mjs --mutate-mint-drift
 */
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { cpSync, mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, generateKeyPairSync } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const ISSUER = join(ROOT, 'aukora/issuer/issuer.mjs')
const { buildOperation, effectBody, operationDigest } = await import(join(ROOT, 'aukora/broker/operation.mjs'))
const { renderOperation } = await import(join(ROOT, 'aukora/broker/review.mjs'))
const { definitionDigest, MEMORY_PUT } = await import(join(ROOT, 'aukora/broker/effect.mjs'))
const { payloadDigest } = await import(join(ROOT, 'aukora/host-dsh/src/grant.mjs'))

const MUTATE_RENDERER = process.argv.includes('--mutate')
const MUTATE_RIDER = process.argv.includes('--mutate-rider')
const MUTATE_FIELDS = process.argv.includes('--mutate-fields')
const MUTATE_MINT_DRIFT = process.argv.includes('--mutate-mint-drift')
const RECEIPT_KEY_ID = 'b'.repeat(64)
const EXPECTED_ROWS = [
  'W1.key-alphabet', 'W2.bidi', 'W3.invisible', 'W4.ansi', 'W5.multiline',
  'W6.digest-signed', 'W7.one-renderer', 'W8.effect-body', 'W9.omitted-value',
  'W9.rider-key', 'W10.denial', 'W11.ascii', 'W12.fields', 'W13.mint-drift',
]
if ([MUTATE_RENDERER, MUTATE_RIDER, MUTATE_FIELDS, MUTATE_MINT_DRIFT].filter(Boolean).length > 1) {
  throw new Error('court: choose one mutation mode')
}
const MUTANT_DIRS = []

function cleanupMutants() {
  while (MUTANT_DIRS.length > 0) {
    rmSync(MUTANT_DIRS.pop(), { recursive: true, force: true })
  }
}

process.once('exit', cleanupMutants)

function exitCourt(code) {
  cleanupMutants()
  process.exit(code)
}

/** Code points a terminal either hides or lets reorder its neighbours. */
const BIDI = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f]
const INVISIBLE = [0x00ad, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfe0f, 0xfeff, 0xe0061]
const LINE_SEPARATORS = [0x2028, 0x2029]
const cp = (n) => String.fromCodePoint(n)

/** Decode the one reversible exact-body field without invoking the renderer. */
function effectBodyField(render) {
  const prefix = /^\s*\|\s*effectBodyUtf8: /
  const matches = render.split('\n').filter((line) => prefix.test(line))
  const encoded = matches.length === 1 ? matches[0].replace(prefix, '') : null
  if (encoded === null) return { count: matches.length, encoded, decoded: null, parseOk: false }
  try {
    const decoded = JSON.parse(encoded)
    return { count: matches.length, encoded, decoded, parseOk: typeof decoded === 'string' }
  } catch {
    return { count: matches.length, encoded, decoded: null, parseOk: false }
  }
}

/** Parse every live review field and retain duplicate counts. */
function issuerFieldMap(render) {
  const values = new Map()
  const counts = new Map()
  for (const line of render.split('\n')) {
    const match = line.match(/^\s*\|\s*([A-Za-z][A-Za-z0-9]*): (.*)$/)
    if (match === null) continue
    const [, name, value] = match
    counts.set(name, (counts.get(name) ?? 0) + 1)
    if (!values.has(name)) values.set(name, value)
  }
  return { values, counts }
}

/**
 * Make one narrow mutant from the real issuer source. The shared renderer still
 * supplies every field, but the exact body display is replaced by a safe-looking
 * semantic value display. Relative imports become absolute so only the temp
 * copy changes and the repository remains untouched.
 */
function rendererMutantSource() {
  let s = readFileSync(ISSUER, 'utf8')
  const reviewImport = "import { renderOperation } from '../broker/review.mjs'"
  const bodyRender = 'const body = renderOperation(operation, args)'
  if (!s.includes(reviewImport) || !s.includes(bodyRender)) {
    throw new Error('court: could not locate the issuer effect-body render to mutate')
  }
  s = s.replace(
    bodyRender,
    'const body = renderOperation(operation, args)\n' +
      '    .replace(/^effectBodyUtf8:.*$/m, `effectBodyUtf8: ${JSON.stringify(args.value ?? null)}`)',
  )
  return rewriteIssuerImports(s)
}

/** Change one displayed digest without changing the shared operation. */
function fieldMutantSource() {
  let s = readFileSync(ISSUER, 'utf8')
  const bodyRender = 'const body = renderOperation(operation, args)'
  if (!s.includes(bodyRender)) throw new Error('court: could not locate the issuer field render to mutate')
  s = s.replace(
    bodyRender,
    'const body = renderOperation(operation, args)\n' +
      "    .replace(/^contentSha256:.*$/m, `contentSha256: ${'0'.repeat(64)}`)",
  )
  return rewriteIssuerImports(s)
}

/** Rewrite every local issuer dependency to the unmodified authority tree. */
function rewriteIssuerImports(source) {
  return source
    .replace(/from '\.\/([^']+)'/g, (_, f) => `from '${join(ROOT, 'aukora/issuer', f)}'`)
    .replace(/from '\.\.\/approval\/([^']+)'/g, (_, f) => `from '${join(ROOT, 'aukora/approval', f)}'`)
    .replace(/from '\.\.\/broker\/([^']+)'/g, (_, f) => `from '${join(ROOT, 'aukora/broker', f)}'`)
    .replace(/from '\.\.\/host-dsh\/src\/([^']+)'/g, (_, f) => `from '${join(ROOT, 'aukora/host-dsh/src', f)}'`)
}

/** Materialize one issuer-only mutant outside the repository. */
function materializeIssuerMutant(source, label) {
  const dir = mkdtempSync(join(tmpdir(), `wysiwys-${label}-`))
  MUTANT_DIRS.push(dir)
  const path = join(dir, 'issuer-mutant.mjs')
  writeFileSync(path, source)
  return path
}

/** Copy Aukora and bypass its one shared exact-argument predicate. */
function materializeRiderMutant() {
  const dir = mkdtempSync(join(tmpdir(), 'wysiwys-rider-'))
  MUTANT_DIRS.push(dir)
  const aukora = join(dir, 'aukora')
  cpSync(join(ROOT, 'aukora'), aukora, { recursive: true })
  const predicatePath = join(aukora, 'broker/memory-put-args.mjs')
  let source = readFileSync(predicatePath, 'utf8')
  const declaration = 'export function isExactMemoryPutArgs(input) {'
  if (source.split(declaration).length !== 2) {
    throw new Error('court: could not uniquely locate the exact-argument predicate to mutate')
  }
  source = source.replace(declaration, `${declaration}\n  return true`)
  writeFileSync(predicatePath, source)
  return join(aukora, 'issuer/issuer.mjs')
}

/**
 * Copy the authority tree and replace only the minter's signed expiry. Its
 * auxiliary operationDigestValue still describes the original prompt, so this
 * distinguishes a real signed-artifact check from trust in a helper return.
 */
function materializeMintDriftMutant() {
  const dir = mkdtempSync(join(tmpdir(), 'wysiwys-mint-drift-'))
  MUTANT_DIRS.push(dir)
  const aukora = join(dir, 'aukora')
  cpSync(join(ROOT, 'aukora'), aukora, { recursive: true })
  const mintPath = join(aukora, 'issuer/mint.mjs')
  let source = readFileSync(mintPath, 'utf8')
  const originalOperation = '  const operation = buildOperation(args, exp)'
  const originalExpiry = '    exp,\n    definitionId: definitionDigest(),'
  const originalReturn = '  return { grant: { ...claims, signature }, operation, operationDigestValue: claims.operationDigest }'
  if (source.split(originalOperation).length !== 2
    || source.split(originalExpiry).length !== 2
    || source.split(originalReturn).length !== 2) {
    throw new Error('court: could not uniquely locate the minter fields to mutate')
  }
  source = source
    .replace(originalOperation, '  const presentedOperation = buildOperation(args, exp)\n  const operation = buildOperation(args, exp + 1)')
    .replace(originalExpiry, '    exp: exp + 1,\n    definitionId: definitionDigest(),')
    .replace(originalReturn, '  return { grant: { ...claims, signature }, operation, operationDigestValue: operationDigest(presentedOperation) }')
  writeFileSync(mintPath, source)
  return join(aukora, 'issuer/issuer.mjs')
}

/**
 * Spawn one issuer, send one issue request, capture the stderr bytes it wrote
 * before asking, answer the prompt it actually rendered, and return both the
 * render and the reply.
 */
async function ask(issuerPath, args, expiry, decision) {
  const dir = mkdtempSync(join(tmpdir(), 'wysiwys-court-'))
  const { privateKey } = generateKeyPairSync('ed25519')
  const keyFile = join(dir, 'root.pem')
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  chmodSync(keyFile, 0o600)
  const sock = join(dir, 'sd', 'issuer.sock')
  const child = spawn(process.execPath, [issuerPath], {
    env: {
      ...process.env,
      AUKORA_ISSUER_SOCKET: sock,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: RECEIPT_KEY_ID,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let err = Buffer.alloc(0)
  let promptRender = null
  let answerPrompt = () => {}
  child.stderr.on('data', (c) => { err = Buffer.concat([err, c]); answerPrompt() })
  let boot = ''
  const ready = new Promise((res, rej) => {
    child.stdout.on('data', (c) => { boot += c.toString(); if (boot.includes('listening')) res() })
    child.once('exit', (code) => rej(new Error(`issuer exited ${code}: ${err.toString()}`)))
    setTimeout(res, 1500)
  })
  await ready
  const conn = createConnection(sock)
  await new Promise((res, rej) => { conn.once('connect', res); conn.once('error', rej) })
  let answered = false
  let challenge = null
  answerPrompt = () => {
    if (answered) return
    const rendered = err.toString('utf8')
    const fresh = rendered.match(/approve\? type "yes ([0-9a-f]{16})": $/)
    const legacy = /approve\? \[y\/N\] $/.test(rendered)
    if (fresh === null && !legacy) return
    answered = true
    promptRender = rendered
    challenge = fresh?.[1] ?? null
    if (decision === 'approve') {
      child.stdin.write(fresh === null ? 'y\n' : `yes ${fresh[1]}\n`)
    } else {
      child.stdin.write('no\n')
    }
  }
  conn.write(`${JSON.stringify({ op: 'issue', toolName: 'memory.put', arguments: args, expiry })}\n`)
  const reply = await new Promise((res) => {
    let buf = ''
    conn.on('data', (d) => { buf += d.toString(); if (buf.includes('\n')) res(JSON.parse(buf.split('\n')[0])) })
  })
  conn.destroy()
  child.kill()
  rmSync(dir, { recursive: true, force: true })
  return { render: promptRender ?? err.toString('utf8'), reply, challenge }
}

const HOSTILE_VALUE =
  `ship v2${cp(0x202e)}dnetni.suoicilam${cp(0x202c)}${cp(0x200b)}` +
  `${cp(0x1b)}[2K${cp(0x1b)}[1G` +
  `\n  | key: "notes.safe"\n  | operationDigest: 0000\n` +
  `${cp(0x2066)}iso${cp(0x2069)}${cp(0x200e)}${cp(0x2028)}line${cp(0x2029)}paragraph` +
  `${cp(0x00ad)}soft-hyphen${cp(0xfe0f)}variation${cp(0xe0061)}tag`

const issuerPath = MUTATE_RENDERER
  ? materializeIssuerMutant(rendererMutantSource(), 'renderer')
  : MUTATE_FIELDS
    ? materializeIssuerMutant(fieldMutantSource(), 'fields')
    : MUTATE_RIDER
      ? materializeRiderMutant()
      : MUTATE_MINT_DRIFT
        ? materializeMintDriftMutant()
        : ISSUER

const expiry = Math.floor(Date.now() / 1000) + 300
// Deliberately reverse lexical insertion order at two levels. A semantic
// JSON.stringify(value) display differs visibly from the canonical bytes.
const args = {
  key: 'notes.release',
  value: {
    zeta: HOSTILE_VALUE,
    alpha: { zulu: 'last', alpha: 'first' },
  },
}
const rows = []

// W1 — the key vector is closed before any rendering happens.
const badKey = await ask(issuerPath, { key: `notes.${cp(0x202e)}evil`, value: 'x' }, expiry, 'deny')
rows.push({
  n: 'W1.key-alphabet',
  ok: badKey.reply.ok === false && badKey.reply.reason === 'issuer:key-not-a-name' && badKey.render === '',
  d: `reason=${badKey.reply.reason} renderedBytes=${Buffer.byteLength(badKey.render)}`,
})

// W2-W5, W7 — one denied approval, graded on the bytes the issuer printed.
const denied = await ask(issuerPath, args, expiry, 'deny')
const text = denied.render

const leakedBidi = BIDI.filter((c) => text.includes(cp(c)))
rows.push({ n: 'W2.bidi', ok: leakedBidi.length === 0, d: `leaked=[${leakedBidi.map((c) => 'U+' + c.toString(16).toUpperCase()).join(' ')}]` })

const leakedInvis = [...INVISIBLE, ...LINE_SEPARATORS].filter((c) => text.includes(cp(c)))
rows.push({ n: 'W3.invisible', ok: leakedInvis.length === 0, d: `leaked=[${leakedInvis.map((c) => 'U+' + c.toString(16).toUpperCase()).join(' ')}]` })

const leakedC0 = [...text].filter((ch) => { const c = ch.codePointAt(0); return c < 0x20 && ch !== '\n' })
rows.push({ n: 'W4.ansi', ok: leakedC0.length === 0, d: `rawC0=${leakedC0.length}` })

const nonAsciiArtifact = [...text].filter((ch) => {
  const code = ch.codePointAt(0) ?? 0
  return ch !== '\n' && (code < 0x20 || code > 0x7e)
})
const nonAsciiPoints = [...new Set(nonAsciiArtifact.map((ch) => ch.codePointAt(0) ?? 0))]
rows.push({
  n: 'W11.ascii',
  ok: nonAsciiArtifact.length === 0,
  d: `nonLfPrintableAscii=${nonAsciiArtifact.length} points=[${nonAsciiPoints.map((code) => `U+${code.toString(16).toUpperCase()}`).join(' ')}]`,
})

const lines = text.split('\n')
const sharedRender = renderOperation(buildOperation(args, expiry), args)
const expectedIssuerRender = `${sharedRender}\nreceiptKeyId: ${RECEIPT_KEY_ID}`
const expectedBodyLineCount = expectedIssuerRender.split('\n').length
const liveFields = issuerFieldMap(text)
const fieldLines = (name) => liveFields.counts.get(name) ?? 0
// An object body carrying real newlines must add no lines and forge no field:
// the render is exactly the shared body plus a header and a footer, and each
// field is drawn exactly once. Missing and duplicated are different failures.
const FIELDS = ['tool', 'key', 'effectBodyUtf8', 'bytes', 'contentSha256', 'definitionId', 'expiry', 'oneUse', 'operationDigest', 'receiptKeyId']
const counts = FIELDS.map((f) => [f, fieldLines(f)])
const missing = counts.filter(([, c]) => c === 0).map(([f]) => f)
const duplicated = counts.filter(([, c]) => c > 1).map(([f]) => f)
const unexpected = [...liveFields.counts.keys()].filter((name) => !FIELDS.includes(name))
const expectedLines = expectedBodyLineCount + 2
rows.push({
  n: 'W5.multiline',
  ok: missing.length === 0 && duplicated.length === 0 && unexpected.length === 0 && lines.length === expectedLines,
  d: `lines=${lines.length} expected=${expectedLines} missing=[${missing.join(' ')}] duplicated=[${duplicated.join(' ')}] unexpected=[${unexpected.join(' ')}]`,
})

const renderedBody = lines
  .filter((l) => /^\s*\|\s/.test(l) && !/approve\?/.test(l))
  .map((l) => l.replace(/^\s*\|\s/, ''))
  .join('\n')
rows.push({ n: 'W7.one-renderer', ok: renderedBody === expectedIssuerRender, d: `identical=${renderedBody === expectedIssuerRender} issuerBytes=${Buffer.byteLength(renderedBody)} expectedBytes=${Buffer.byteLength(expectedIssuerRender)}` })

// W8 — unlike W7, this oracle does not ask the production renderer what it
// should have displayed. It independently decodes the live JSON string and
// compares the recovered UTF-8 bytes with the bytes the effect writes.
const canonicalBody = effectBody(args)
const displayedBody = effectBodyField(text)
const semanticValue = JSON.stringify(args.value)
const noncanonicalOrderWitness = semanticValue.indexOf('"zeta"') < semanticValue.indexOf('"alpha"')
  && canonicalBody.indexOf('"alpha"') < canonicalBody.indexOf('"zeta"')
const exactBodyHeld = displayedBody.count === 1
  && displayedBody.parseOk
  && Buffer.from(displayedBody.decoded, 'utf8').equals(Buffer.from(canonicalBody, 'utf8'))
  && canonicalBody.endsWith('\n')
  && displayedBody.decoded.endsWith('\n')
  && noncanonicalOrderWitness
rows.push({
  n: 'W8.effect-body',
  ok: exactBodyHeld,
  d: `fields=${displayedBody.count} reversible=${displayedBody.parseOk} exactBytes=${displayedBody.parseOk && Buffer.from(displayedBody.decoded, 'utf8').equals(Buffer.from(canonicalBody, 'utf8'))} terminalNewline=${displayedBody.parseOk && canonicalBody.endsWith('\n') && displayedBody.decoded.endsWith('\n')} noncanonicalOrder=${noncanonicalOrderWitness}`,
})

// W12 — parse the live prompt, then derive every expected value without asking
// the renderer. The operation digest uses the independently constructed fixed
// operation over the exact body byte count, content hash and definition.
const expectedBytes = Buffer.byteLength(canonicalBody, 'utf8')
const expectedContentSha256 = createHash('sha256').update(canonicalBody, 'utf8').digest('hex')
const expectedDefinitionId = definitionDigest()
const expectedOperation = {
  tool: MEMORY_PUT,
  key: args.key,
  bytes: expectedBytes,
  contentSha256: expectedContentSha256,
  definitionId: expectedDefinitionId,
  exp: expiry,
  oneUse: true,
}
const expectedOperationDigest = operationDigest(expectedOperation)
const expectedFieldValues = new Map([
  ['tool', MEMORY_PUT],
  ['key', args.key],
  ['bytes', String(expectedBytes)],
  ['contentSha256', expectedContentSha256],
  ['definitionId', expectedDefinitionId],
  ['expiry', String(expiry)],
  ['oneUse', 'true'],
  ['operationDigest', expectedOperationDigest],
  ['receiptKeyId', RECEIPT_KEY_ID],
])
const fieldMismatches = [...expectedFieldValues].filter(([name, expected]) => liveFields.values.get(name) !== expected).map(([name]) => name)
const singletonFields = FIELDS.every((name) => liveFields.counts.get(name) === 1)
  && liveFields.counts.size === FIELDS.length
const exactObjectBodyField = displayedBody.parseOk && displayedBody.decoded === canonicalBody
rows.push({
  n: 'W12.fields',
  ok: singletonFields && exactObjectBodyField && fieldMismatches.length === 0,
  d: `singleton=${singletonFields} exactObjectBody=${exactObjectBodyField} mismatches=[${fieldMismatches.join(' ')}]`,
})

// W9 — the issuer accepts exactly {key,value}. Missing effect bytes and rider
// fields refuse before a human can be asked to authorize anything.
const omittedArgs = { key: 'notes.omitted-value' }
const riderArgs = { key: 'notes.rider', value: null, hidden: 'signed-but-not-rendered' }
const omitted = await ask(issuerPath, omittedArgs, expiry, 'approve')
const rider = await ask(issuerPath, riderArgs, expiry, 'approve')
rows.push({
  n: 'W9.omitted-value',
  ok: omitted.reply.ok === false
    && omitted.reply.reason === 'issuer:arguments-not-exact'
    && omitted.render === '',
  d: `reason=${String(omitted.reply.reason)} renderBytes=${Buffer.byteLength(omitted.render)} signed=${omitted.reply.ok === true}`,
})
rows.push({
  n: 'W9.rider-key',
  ok: rider.reply.ok === false
    && rider.reply.reason === 'issuer:arguments-not-exact'
    && rider.render === '',
  d: `reason=${String(rider.reply.reason)} renderBytes=${Buffer.byteLength(rider.render)} signed=${rider.reply.ok === true}`,
})
const omittedMutationBody = effectBodyField(omitted.render)
const riderMutationBody = effectBodyField(rider.render)
const riderMutationFields = issuerFieldMap(rider.render)
const riderMutationWitness = omitted.challenge !== null
  && omitted.reply.ok === true
  && omitted.reply.grant?.digest === payloadDigest(MEMORY_PUT, omittedArgs)
  && omittedMutationBody.parseOk
  && rider.challenge !== null
  && rider.reply.ok === true
  && rider.reply.grant?.digest === payloadDigest(MEMORY_PUT, riderArgs)
  && riderMutationBody.parseOk
  && !riderMutationBody.decoded.includes('"hidden"')
  && riderMutationFields.counts.get('operationDigest') === 1
  && riderMutationFields.values.get('operationDigest') === rider.reply.grant?.operationDigest
rows.push({
  n: 'W10.denial',
  ok: denied.reply.ok === false && denied.reply.reason === 'issuer:human-denied-or-unavailable',
  d: `reason=${String(denied.reply.reason)}`,
})

// W6 — approve, and check the grant is bound to the digest that was on screen.
const approved = await ask(issuerPath, args, expiry, 'approve')
const wantDigest = expectedOperationDigest
const approvedFields = issuerFieldMap(approved.render)
const shown = approvedFields.counts.get('operationDigest') === 1
  && approvedFields.values.get('operationDigest') === wantDigest
const boundOk = approved.challenge !== null
  && approved.reply.ok === true
  && approved.reply.operationDigest === wantDigest
  && approved.reply.grant?.operationDigest === wantDigest
  && approved.reply.grant?.receiptKeyId === RECEIPT_KEY_ID
rows.push({
  n: 'W6.digest-signed',
  ok: shown && boundOk,
  d: `freshChallengeAnswered=${approved.challenge !== null} shownOnScreen=${shown} grant.operationDigest=${String(approved.reply.grant?.operationDigest ?? approved.reply.reason).slice(0, 16)} want=${wantDigest.slice(0, 16)}`,
})
rows.push({
  n: 'W13.mint-drift',
  ok: approved.reply.ok === true
    && approved.reply.grant?.operationDigest === wantDigest
    && approved.reply.grant?.exp === expiry,
  d: `reply=${String(approved.reply.reason ?? 'issued')} grant.exp=${String(approved.reply.grant?.exp ?? '')} wantExp=${expiry} grant.operationDigest=${String(approved.reply.grant?.operationDigest ?? '').slice(0, 16)} want=${wantDigest.slice(0, 16)}`,
})

console.log('\n  courts/harness/wysiwys-issuer — the trusted screen is not the weaker screen\n  ' + '-'.repeat(72))
for (const r of rows) console.log(`  ${r.n.padEnd(17)} ${r.ok ? 'held' : '*** BREACH ***'}  ${r.d}`)
console.log('\n  --- the issuer process\'s own stderr, as bytes ---')
console.log(JSON.stringify(text))

const anyBreach = rows.some((r) => !r.ok)

/** Require one complete partition: named breaches red, named controls green. */
const mutationRowsMatch = (breaches, controls) => {
  const expectedBreaches = new Set(breaches)
  const expectedControls = new Set(controls)
  const names = new Set(rows.map(({ n }) => n))
  return expectedBreaches.size === breaches.length
    && expectedControls.size === controls.length
    && [...expectedBreaches].every((name) => !expectedControls.has(name))
    && names.size === rows.length
    && expectedBreaches.size + expectedControls.size === rows.length
    && rows.every(({ n, ok }) => expectedBreaches.has(n) ? !ok : expectedControls.has(n) && ok)
}

/** Normal mode also fails if a row is omitted, duplicated, or newly invented. */
const ordinaryRowsHeld = () => mutationRowsMatch([], EXPECTED_ROWS)

if (MUTATE_RENDERER) {
  const rowByName = new Map(rows.map((row) => [row.n, row]))
  const discriminators = ['W7.one-renderer', 'W8.effect-body']
  const expectedBreaches = ['W2.bidi', 'W3.invisible', 'W5.multiline', 'W11.ascii', 'W12.fields']
  const controls = ['W1.key-alphabet', 'W4.ansi', 'W6.digest-signed', 'W9.omitted-value', 'W9.rider-key', 'W10.denial', 'W13.mint-drift']
  const discriminatorsBreached = discriminators.every((name) => rowByName.get(name)?.ok === false)
  const expectedBreachesObserved = expectedBreaches.every((name) => rowByName.get(name)?.ok === false)
  const controlsHeld = controls.every((name) => rowByName.get(name)?.ok === true)
  const exactRows = mutationRowsMatch([...discriminators, ...expectedBreaches], controls)
  const mutationDetected = discriminatorsBreached && expectedBreachesObserved && controlsHeld && exactRows
  const breached = rows.filter((r) => !r.ok).map((r) => r.n)
  console.log(`\n  MUTATION exact object body replaced by semantic JSON.stringify(value)`)
  console.log(`  discriminatorsBreached=${discriminatorsBreached} rows=[${discriminators.join(' ')}]`)
  console.log(`  expectedBreachesObserved=${expectedBreachesObserved} rows=[${expectedBreaches.join(' ')}]`)
  console.log(`  controlsHeld=${controlsHeld} rows=[${controls.join(' ')}]`)
  console.log(`  exactRowPartition=${exactRows}`)
  console.log(`  breached=[${breached.join(' ')}]  ${mutationDetected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  exitCourt(mutationDetected ? 0 : 1)
}
if (MUTATE_RIDER) {
  const rowByName = new Map(rows.map((row) => [row.n, row]))
  const discriminators = ['W9.omitted-value', 'W9.rider-key']
  const controls = ['W1.key-alphabet', 'W2.bidi', 'W3.invisible', 'W4.ansi', 'W5.multiline', 'W6.digest-signed', 'W7.one-renderer', 'W8.effect-body', 'W10.denial', 'W11.ascii', 'W12.fields', 'W13.mint-drift']
  const discriminatorsBreached = discriminators.every((name) => rowByName.get(name)?.ok === false)
  const controlsHeld = controls.every((name) => rowByName.get(name)?.ok === true)
  const exactRows = mutationRowsMatch(discriminators, controls)
  const mutationDetected = discriminatorsBreached && riderMutationWitness && controlsHeld && exactRows
  const breached = rows.filter((row) => !row.ok).map((row) => row.n)
  console.log(`\n  RIDER MUTATION exact-argument predicate bypassed`)
  console.log(`  discriminatorsBreached=${discriminatorsBreached} rows=[${discriminators.join(' ')}]`)
  console.log(`  promptAndSignatureMismatch=${riderMutationWitness}`)
  console.log(`  controlsHeld=${controlsHeld} rows=[${controls.join(' ')}]`)
  console.log(`  exactRowPartition=${exactRows}`)
  console.log(`  breached=[${breached.join(' ')}]  ${mutationDetected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  exitCourt(mutationDetected ? 0 : 1)
}
if (MUTATE_FIELDS) {
  const rowByName = new Map(rows.map((row) => [row.n, row]))
  const discriminators = ['W12.fields']
  const expectedBreaches = ['W7.one-renderer']
  const controls = ['W1.key-alphabet', 'W2.bidi', 'W3.invisible', 'W4.ansi', 'W5.multiline', 'W6.digest-signed', 'W8.effect-body', 'W9.omitted-value', 'W9.rider-key', 'W10.denial', 'W11.ascii', 'W13.mint-drift']
  const discriminatorsBreached = discriminators.every((name) => rowByName.get(name)?.ok === false)
  const expectedBreachesObserved = expectedBreaches.every((name) => rowByName.get(name)?.ok === false)
  const controlsHeld = controls.every((name) => rowByName.get(name)?.ok === true)
  const exactRows = mutationRowsMatch([...discriminators, ...expectedBreaches], controls)
  const mutationDetected = discriminatorsBreached && expectedBreachesObserved && controlsHeld && exactRows
  const breached = rows.filter((row) => !row.ok).map((row) => row.n)
  console.log(`\n  FIELD MUTATION displayed contentSha256 replaced`)
  console.log(`  discriminatorsBreached=${discriminatorsBreached} rows=[${discriminators.join(' ')}]`)
  console.log(`  expectedBreachesObserved=${expectedBreachesObserved} rows=[${expectedBreaches.join(' ')}]`)
  console.log(`  controlsHeld=${controlsHeld} rows=[${controls.join(' ')}]`)
  console.log(`  exactRowPartition=${exactRows}`)
  console.log(`  breached=[${breached.join(' ')}]  ${mutationDetected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  exitCourt(mutationDetected ? 0 : 1)
}
if (MUTATE_MINT_DRIFT) {
  const rowByName = new Map(rows.map((row) => [row.n, row]))
  const expectedBreaches = ['W6.digest-signed', 'W13.mint-drift']
  const controls = EXPECTED_ROWS.filter((name) => !expectedBreaches.includes(name))
  const issuerRefused = approved.reply.ok === false && approved.reply.reason === 'issuer:presented-signed-drift'
  const expectedBreachesObserved = expectedBreaches.every((name) => rowByName.get(name)?.ok === false)
  const controlsHeld = controls.every((name) => rowByName.get(name)?.ok === true)
  const exactRows = mutationRowsMatch(expectedBreaches, controls)
  const mutationDetected = issuerRefused && expectedBreachesObserved && controlsHeld && exactRows
  const breached = rows.filter((row) => !row.ok).map((row) => row.n)
  console.log(`\n  MINT-DRIFT MUTATION signed expiry differs from the displayed operation`)
  console.log(`  issuerRefusedPresentedSignedDrift=${issuerRefused}`)
  console.log(`  expectedBreachesObserved=${expectedBreachesObserved} rows=[${expectedBreaches.join(' ')}]`)
  console.log(`  controlsHeld=${controlsHeld} rows=[${controls.join(' ')}]`)
  console.log(`  exactRowPartition=${exactRows}`)
  console.log(`  breached=[${breached.join(' ')}]  ${mutationDetected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  exitCourt(mutationDetected ? 0 : 1)
}
console.log('\n  observationClass: SELF-REPORTED\n')
exitCourt(anyBreach || !ordinaryRowsHeld() ? 1 : 0)
