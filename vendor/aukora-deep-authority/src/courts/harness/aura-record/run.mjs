/**
 * courts/harness/aura-record — the record is the golden chain, not the view.
 *
 * The owner's binding correction, measured: Aura IS the record — receipts
 * are the locations of memory, linked to the actual data. This court
 * measures the v0 of that: every memory.put settlement appends one entry to
 * an append-only hash-linked chain; each entry binds the authorization tuple,
 * the settlement receipt's digest, and exact post-dispatch evidence at a
 * content-addressed object location the broker API does not overwrite. The
 * state-owning UID can still replace object and record coherently.
 *
 *   R1 control     the chain verifies and replays byte-identical
 *   R2 walk        record -> entry.location -> bytes -> digest matches
 *   R3 history     a second put to the same key leaves the FIRST entry's
 *                  location walkable through ordinary broker API use
 *   R4 rebuild     delete the key projections, replay the chain, the
 *                  surviving state reproduces exactly
 *   R5 binding     entry.receiptSha256 equals the digest of the receipt the
 *                  broker signed
 *   R6 tamper      one flipped byte inside the chain refuses by name
 *   R7 truncate    a cut tail refuses by name
 *   R8 limit       a self-consistent same-uid rewrite verifies clean —
 *                  the measured, kept hole; no external head anchor exists
 *   R9 path        a dangling record symlink refuses without writing its target
 *   R10 bytes      a digest-named regular object with different bytes refuses
 *
 * E1-E5 grade the line encoding. The entry hash covers the PARSE RESULT, so
 * every byte difference the parser normalizes away rehashes clean: JSON.parse
 * keeps the last of two duplicate keys, discards inserted whitespace, and reads
 * `17.0` as `17`. Each attack line is RAW TEXT derived from a genuine
 * broker-written line, because a serializer cannot emit any of them, and each
 * row records that the entry still rehashes, so the refusal is the encoding
 * check rather than the hash check.
 *
 *   E1.honest      every genuine line, rewritten as raw text, verifies
 *   E2.decoy-first a duplicate key whose decoy the bytes show first refuses
 *   E3.decoy-last  a duplicate key whose decoy the hash commits to refuses
 *   E4.padding     one inserted space refuses
 *   E5.number      a value-preserving decimal refuses
 *   E6.reserved    a reserved `domain` the digest cannot cover refuses under
 *                  its own mark; neither reserved-field mark is attributable
 *
 * --mutate changes a stored entry hash and cuts an incomplete final line. It
 * passes only when every ordinary row holds and both corruptions are refused.
 *
 * Each --arm deletes one read-path predicate from a copy of record.mjs and
 * passes only when exactly that predicate's rows turn red while E1 and every
 * other row still holds. revert-line-encoding must redden E2-E5;
 * revert-reserved-field must redden E6 alone.
 *
 *   node courts/harness/aura-record/run.mjs
 *   node courts/harness/aura-record/run.mjs --mutate
 *   node courts/harness/aura-record/run.mjs --arm=revert-line-encoding
 *   node courts/harness/aura-record/run.mjs --arm=revert-reserved-field
 */
import { generateKeyPairSync, sign as edSign, createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, lstatSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConnection } from 'node:net'
import { buildOperation, operationDigest } from '../../../aukora/broker/operation.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const { payloadDigest, grantPreimage, newNonce } = await import(join(HERE, '../../../aukora/host-dsh/src/grant.mjs'))
const { definitionDigest, MEMORY_PUT } = await import(join(HERE, '../../../aukora/broker/effect.mjs'))
const { provisionBrokerIdentity, spawnBroker } = await import(join(HERE, '../../../aukora/broker/broker.mjs'))
const { verifyChain, readEntries, appendEntry, entryHash, compareObjectInventory, RECORD_DOMAIN, RECORD_REFUSE } = await import(join(HERE, '../../../aukora/aura/record.mjs'))
const { canonicalJSON } = await import(join(HERE, '../../../aukora/kernel-seed/chain.mjs'))

const ARM_PREFIX = '--arm='
const isArmFlag = (value) => value.startsWith(ARM_PREFIX) && value.length > ARM_PREFIX.length
const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate' && !isArmFlag(args[0]))) {
  console.error('usage: node courts/harness/aura-record/run.mjs [--mutate | --arm=<name>]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'
// An unrecognized arm name is accepted and applies no sabotage, so a decorative
// arm reaches the arm exit and is reported there rather than at the parser.
const ARM = args.length === 1 && isArmFlag(args[0]) ? args[0].slice(ARM_PREFIX.length) : null
const TMP = mkdtempSync(join(tmpdir(), 'aukora-aura-record-'))
const socketPath = join(TMP, 'broker.sock')
const stateDir = join(TMP, 'state')
const chainFile = join(stateDir, 'aura.jsonl')
const DEF = definitionDigest()
const RECEIPT_KEY_ID = provisionBrokerIdentity(stateDir).receiptKeyId

const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const mintGrant = (key, value) => {
  const args = { key, value }
  const exp = Math.floor(Date.now() / 1000) + 300
  const g = { toolName: MEMORY_PUT, digest: payloadDigest(MEMORY_PUT, args), nonce: newNonce(), exp, definitionId: DEF, operationDigest: operationDigest(buildOperation(args, exp)), receiptKeyId: RECEIPT_KEY_ID }
  return { grant: { ...g, signature: edSign(null, grantPreimage(g), root.privateKey).toString('base64') }, args }
}

const client = (socket) => {
  const conn = createConnection(socket)
  let buffer = ''
  const pending = new Map()
  conn.on('data', (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() === '') continue
      const reply = JSON.parse(line)
      const waiter = pending.get(reply.id)
      if (waiter) { pending.delete(reply.id); waiter(reply) }
    }
  })
  let id = 0
  return {
    send: (request) => new Promise((resolve) => {
      const rid = ++id
      pending.set(rid, resolve)
      conn.write(`${JSON.stringify({ id: rid, ...request })}\n`)
    }),
    close: () => conn.destroy(),
  }
}

const rows = []
const EXPECTED_ROWS = [
  'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10',
  'E1.honest', 'E2.decoy-first', 'E3.decoy-last', 'E4.padding', 'E5.number',
  'E6.reserved',
]
const KEPT_BREACH_ROWS = new Set(['R8'])
// The one arm that grades the line-encoding predicate, and the exact rows its
// deletion must turn red. E1 is the honest control and must survive the arm:
// an arm that also reddens E1 has broken chain reading rather than reverted one
// check, and is reported NOT DETECTED.
const LINE_ENCODING_ARM = 'revert-line-encoding'
const RESERVED_FIELD_ARM = 'revert-reserved-field'
const RECORD_MODULE = join(HERE, '../../../aukora/aura/record.mjs')
const CANONICAL_JSON_MODULE = join(HERE, '../../../aukora/kernel-seed/canonical-json.mjs')
const LINE_ENCODING_PREDICATE = 'if (JSON.stringify(entry) !== lines[i]) return { ok: false, reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL, line: i + 1 }'
const RESERVED_FIELD_PREDICATE = `if (RESERVED_ENTRY_NAMES.some((reserved) => Object.hasOwn(fields, reserved))) {
      return { ok: false, reason: RECORD_REFUSE.RESERVED_FIELD_ON_WIRE, line: i + 1 }
    }`
const CANONICAL_JSON_IMPORT = "from '../kernel-seed/canonical-json.mjs'"
// Each arm names the predicate it deletes and the exact rows that deletion must
// turn red. E1 is the honest control and must survive every arm: an arm that
// also reddens E1 has broken chain reading rather than reverted one check.
const ARMS = Object.freeze({
  [LINE_ENCODING_ARM]: {
    predicate: LINE_ENCODING_PREDICATE,
    reddens: ['E2.decoy-first', 'E3.decoy-last', 'E4.padding', 'E5.number'],
  },
  [RESERVED_FIELD_ARM]: {
    predicate: RESERVED_FIELD_PREDICATE,
    reddens: ['E6.reserved'],
  },
})

/**
 * Load a copy of record.mjs with the line-encoding predicate deleted, which is
 * the read path as it stood before the repair. The copy is written into the
 * court's temporary directory and reaches the real canonical-json module
 * through an absolute URL, so the repository is never written to. Both source
 * replacements must be unique; otherwise the arm reports that it moved nothing
 * rather than grading rows against an unchanged module.
 *
 * @returns {Promise<{applied: boolean, verifyChain: ((file: string) => object) | null}>}
 */
const loadRevertedRecord = async (armName) => {
  const source = readFileSync(RECORD_MODULE, 'utf8')
  const unmoved = { applied: false, verifyChain: null }
  const predicate = ARMS[armName]?.predicate
  if (predicate === undefined) return unmoved
  if (source.split(predicate).length !== 2) return unmoved
  if (source.split(CANONICAL_JSON_IMPORT).length !== 2) return unmoved
  const mutantPath = join(TMP, `reverted-${armName}.mjs`)
  writeFileSync(mutantPath, source
    .replace(predicate, '')
    .replace(CANONICAL_JSON_IMPORT, `from ${JSON.stringify(pathToFileURL(CANONICAL_JSON_MODULE).href)}`), 'utf8')
  return { applied: true, verifyChain: (await import(pathToFileURL(mutantPath).href)).verifyChain }
}
const row = (n, label, observed, expected) => {
  const breach = JSON.stringify(observed) !== JSON.stringify(expected)
  rows.push({ n, label, observed, expected, breach })
}
const rowsAreExact = (ordinaryRows) => {
  const names = ordinaryRows.map((result) => result.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}
const mutationVerdict = ({ ordinaryRows, tamperDetected, truncDetected }) =>
  rowsAreExact(ordinaryRows)
  && ordinaryRows.every((result) => !result.breach)
  && tamperDetected
  && truncDetected

const broker = await spawnBroker({
  socketPath, stateDir, rootPublicKeyPem: rootPem,
})
const cli = client(socketPath)

// R1 — the control: one settlement, one entry, a verifiable chain.
const { grant: g1, args: a1 } = mintGrant('alpha', { text: 'first' })
const put1 = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: a1, grant: g1 })
const v1 = verifyChain(chainFile)
const replay = readFileSync(chainFile, 'utf8')
row('R1', 'one settlement appends one entry; the chain verifies', {
  ok: put1.ok === true && v1.ok === true && v1.count === 1 && put1.chainHash === v1.lastChainHash,
  replaysIdentically: readFileSync(chainFile, 'utf8') === replay,
}, { ok: true, replaysIdentically: true }, put1.ok !== true || v1.ok !== true || v1.count !== 1 || put1.chainHash !== v1.lastChainHash)

// R2 — the walk: record -> location -> bytes -> digest.
{
  const entry = readEntries(chainFile)[0]
  const bytes = readFileSync(entry.path, 'utf8')
  const walked = createHash('sha256').update(bytes, 'utf8').digest('hex')
  row('R2', 'the walk record -> location -> bytes -> digest holds', {
    matches: walked === entry.contentSha256 && bytes.length === entry.bytes,
  }, { matches: true }, walked !== entry.contentSha256)
}

// R3 — history survives ordinary broker API use: a second put to the same key
// leaves the first entry's content-addressed location walkable.
const { grant: g2, args: a2 } = mintGrant('alpha', { text: 'second' })
const put2 = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: a2, grant: g2 })
{
  const first = readEntries(chainFile)[0]
  const bytes = readFileSync(first.path, 'utf8')
  const walked = createHash('sha256').update(bytes, 'utf8').digest('hex')
  row('R3', 'the first entry still walks to its own bytes after a second put', {
    matches: walked === first.contentSha256 && put2.ok === true,
  }, { matches: true }, walked !== first.contentSha256 || put2.ok !== true)
}

// R4 — delete the derived index, replay the chain, the surviving state reproduces.
{
  const { rebuildIndex } = await import(join(HERE, '../../../aukora/broker/effect.mjs'))
  const keysDir = join(stateDir, 'memory', 'keys')
  const before = readdirSync(keysDir).sort().map((f) => [f, readFileSync(join(keysDir, f), 'utf8')])
  rmSync(keysDir, { recursive: true, force: true })
  const rebuilt = rebuildIndex(stateDir, readEntries(chainFile))
  const after = readdirSync(keysDir).sort().map((f) => [f, readFileSync(join(keysDir, f), 'utf8')])
  row('R4', 'delete the index, replay the chain, the surviving state reproduces', {
    rebuilt: rebuilt.ok === true,
    identical: JSON.stringify(before) === JSON.stringify(after),
    latestWins: readFileSync(join(keysDir, 'alpha.json'), 'utf8').includes(put2.evidence.contentSha256),
  }, { rebuilt: true, identical: true, latestWins: true }, rebuilt.ok !== true || JSON.stringify(before) !== JSON.stringify(after))
}

// R5 — the entry binds the receipt the broker signed.
{
  const entry = readEntries(chainFile)[0]
  const expected = createHash('sha256').update(canonicalJSON(put1.receipt), 'utf8').digest('hex')
  row('R5', 'entry.receiptSha256 binds the signed settlement receipt', {
    bound: entry.receiptSha256 === expected,
  }, { bound: true }, entry.receiptSha256 !== expected)
}

// R6 — tamper: flip one byte inside the chain.
{
  const lines = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean)
  const victim = JSON.parse(lines[0])
  victim.contentSha256 = `${victim.contentSha256[0] === 'a' ? 'b' : 'a'}${victim.contentSha256.slice(1)}`
  const flipped = JSON.stringify(victim)
  const tampered = join(TMP, 'tampered.jsonl')
  writeFileSync(tampered, `${[flipped, ...lines.slice(1)].join('\n')}\n`, 'utf8')
  const v = verifyChain(tampered)
  row('R6', 'one flipped byte refuses by name', { reason: v.reason }, { reason: RECORD_REFUSE.TAMPERED }, v.reason !== RECORD_REFUSE.TAMPERED)
}

// R7 — truncation: cut the tail.
{
  const lines = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean)
  const truncated = join(TMP, 'truncated.jsonl')
  writeFileSync(truncated, `${lines[0]}`, 'utf8')
  const v = verifyChain(truncated)
  row('R7', 'a cut tail refuses by name', { reason: v.reason }, { reason: RECORD_REFUSE.TRUNCATED }, v.reason !== RECORD_REFUSE.TRUNCATED)
}

// R8 — the measured, kept hole: a self-consistent same-uid rewrite verifies
// clean, because nothing outside this file anchors the head.
{
  const rewritten = join(TMP, 'rewritten.jsonl')
  const forged = {
    sequence: 999, key: 'forged', requestDigest: 'f'.repeat(64), definitionId: DEF,
    nonce: 'forged-nonce', receiptSha256: 'e'.repeat(64), path: '/never/existed',
    bytes: 1, contentSha256: 'd'.repeat(64), inode: 0, mtimeNs: '1',
  }
  const forgedHash = entryHash(RECORD_DOMAIN, forged)
  writeFileSync(rewritten, `${JSON.stringify({ hash: forgedHash, prev: RECORD_DOMAIN, ...forged })}\n`, 'utf8')
  const v = verifyChain(rewritten)
  row('R8', 'the same-uid rewrite limit — a coherent forgery verifies (kept)', {
    verifies: v.ok === true,
  }, { verifies: true }, v.ok !== true)
}

// R9 — absence is not a dangling symlink. The writer must refuse the link
// itself and must not create or append to its target.
{
  const redirect = join(TMP, 'redirected-aura.jsonl')
  const linked = join(TMP, 'linked-aura.jsonl')
  symlinkSync(redirect, linked)
  let reason = null
  try {
    appendEntry({ file: linked, fields: { sequence: 1 } })
  } catch (error) {
    reason = String(error?.message ?? error)
  }
  row('R9', 'a dangling record symlink refuses without creating its target', {
    reason,
    linkRemains: lstatSync(linked).isSymbolicLink(),
    targetCreated: existsSync(redirect),
  }, {
    reason: RECORD_REFUSE.UNAVAILABLE,
    linkRemains: true,
    targetCreated: false,
  })
}

// R10 — a name is not content. Corrupt one real object without changing its
// digest-derived filename, require reconciliation to hash and refuse it, then
// restore the court's temporary state for the remaining controls.
{
  const original = readFileSync(put1.evidence.path)
  writeFileSync(put1.evidence.path, 'wrong bytes under the digest-derived name\n')
  const verdict = compareObjectInventory(stateDir, readEntries(chainFile))
  writeFileSync(put1.evidence.path, original)
  const name = `${put1.evidence.contentSha256}.json`
  row('R10', 'a correctly named regular object with different bytes refuses', {
    reason: verdict.reason,
    restored: createHash('sha256').update(readFileSync(put1.evidence.path)).digest('hex') === put1.evidence.contentSha256,
  }, {
    reason: `object-inventory: content mismatch ${JSON.stringify([name])}`,
    restored: true,
  })
}

// E1-E5 — bytes are not meaning. The entry hash covers the parse result, so a
// byte difference the parser normalizes away leaves the hash intact while
// changing what a human, a grep, or any first-wins reader sees. Every line
// below is raw text derived from a genuine broker-written line: a serializer
// cannot emit a duplicate key, padding, or a folded decimal, so a fixture built
// by serializing an object cannot express any of these attacks. Under
// --arm=revert-line-encoding these five rows read through a copy of record.mjs
// with the predicate deleted, and E2-E5 must be the only rows that turn red.
const armed = ARM !== null ? await loadRevertedRecord(ARM) : { applied: false, verifyChain: null }
const readChain = armed.verifyChain ?? verifyChain
{
  const genuine = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean)
  const line = genuine[0]
  const parsed = JSON.parse(line)
  const { hash: genuineHash, prev: genuinePrev, ...genuineFields } = parsed
  const bytesRead = (raw) => /"verdict":"([^"]*)"/.exec(raw)?.[1]
  const rehashes = (raw) => {
    const { hash, prev: link, ...fields } = JSON.parse(raw)
    return entryHash(link, fields) === hash
  }
  // Each attack is its own single-line chain rooted at the domain, so a refusal
  // names the line under test and never a link break in a following line.
  const refusalFor = (raw, name) => {
    const path = join(TMP, `${name}.jsonl`)
    writeFileSync(path, `${raw}\n`, 'utf8')
    return readChain(path).reason ?? null
  }

  const honestFile = join(TMP, 'encoding-honest.jsonl')
  writeFileSync(honestFile, `${genuine.join('\n')}\n`, 'utf8')
  const honest = readChain(honestFile)
  row('E1.honest', 'every genuine line, rewritten as raw text, verifies', {
    ok: honest.ok === true,
    count: honest.count,
    head: honest.lastChainHash === JSON.parse(genuine[genuine.length - 1]).hash,
  }, { ok: true, count: genuine.length, head: true })

  // The parser keeps the LAST duplicate, so the decoy the bytes show first is
  // invisible to the hash: the stored hash is the genuine one, untouched.
  const decoyFirst = line.replace('"verdict":"settled"', '"verdict":"refused","verdict":"settled"')
  row('E2.decoy-first', 'a duplicate key whose decoy the bytes show first refuses by name', {
    rewritten: decoyFirst !== line,
    rehashes: rehashes(decoyFirst),
    bytesRead: bytesRead(decoyFirst),
    parserReads: JSON.parse(decoyFirst).verdict,
    reason: refusalFor(decoyFirst, 'encoding-decoy-first'),
  }, {
    rewritten: true,
    rehashes: true,
    bytesRead: 'refused',
    parserReads: 'settled',
    reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL,
  })

  // The mirror image, and the one a same-uid rewriter can actually mount: the
  // decoy goes last, so the hash commits to it, and the recomputed hash makes
  // the chain verify to a meaning the bytes never show.
  const decoyLast = line
    .replace(`"hash":"${genuineHash}"`, `"hash":"${entryHash(genuinePrev, { ...genuineFields, verdict: 'refused' })}"`)
    .replace('"verdict":"settled"', '"verdict":"settled","verdict":"refused"')
  row('E3.decoy-last', 'a duplicate key whose decoy the hash commits to refuses by name', {
    rewritten: decoyLast !== line,
    rehashes: rehashes(decoyLast),
    bytesRead: bytesRead(decoyLast),
    parserReads: JSON.parse(decoyLast).verdict,
    reason: refusalFor(decoyLast, 'encoding-decoy-last'),
  }, {
    rewritten: true,
    rehashes: true,
    bytesRead: 'settled',
    parserReads: 'refused',
    reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL,
  })

  const padded = line.replace('{"hash":', '{ "hash":')
  row('E4.padding', 'one inserted space the parser discards refuses by name', {
    addedBytes: padded.length - line.length,
    rehashes: rehashes(padded),
    parsesToTheSameEntry: JSON.stringify(JSON.parse(padded)) === JSON.stringify(parsed),
    reason: refusalFor(padded, 'encoding-padded'),
  }, {
    addedBytes: 1,
    rehashes: true,
    parsesToTheSameEntry: true,
    reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL,
  })

  // E6 is not an encoding attack: the line IS the writer's encoding, the parser
  // reads exactly what the bytes show, and E1-E5's predicate passes. `domain` is
  // written into the preimage AFTER the body spread, so its on-wire value is
  // discarded before hashing and the stored hash stays the genuine one. That
  // makes this the only mutation whose head is byte-identical to a record that
  // never carried it, so an external head anchor cannot see it either — the
  // reader has to refuse the name, exactly as the writer already does.
  const reserved = line.slice(0, -1) + ',"domain":"ATTACKER-CONTROLLED-UNHASHED-DATA"}'
  const reservedParsed = JSON.parse(reserved)
  row('E6.reserved', 'a reserved `domain` the digest cannot cover refuses by name', {
    isWritersEncoding: JSON.stringify(reservedParsed) === reserved,
    rehashes: rehashes(reserved),
    headUnchanged: reservedParsed.hash === genuineHash,
    carriesAttackerBytes: reservedParsed.domain === 'ATTACKER-CONTROLLED-UNHASHED-DATA',
    reason: refusalFor(reserved, 'encoding-reserved-domain'),
  }, {
    isWritersEncoding: true,
    rehashes: true,
    headUnchanged: true,
    carriesAttackerBytes: true,
    reason: RECORD_REFUSE.RESERVED_FIELD_ON_WIRE,
  })

  const numbered = line.replace(/"bytes":(\d+)([,}])/, '"bytes":$1.0$2')
  row('E5.number', 'a value-preserving decimal the parser folds refuses by name', {
    decimalWritten: /"bytes":\d+\.0[,}]/.test(numbered),
    rehashes: rehashes(numbered),
    sameNumber: JSON.parse(numbered).bytes === parsed.bytes,
    reason: refusalFor(numbered, 'encoding-number'),
  }, {
    decimalWritten: true,
    rehashes: true,
    sameNumber: true,
    reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL,
  })
}

await cli.close()
broker.kill?.()

console.log('\n  courts/harness/aura-record — the record is the golden chain, not the view\n  ' + '-'.repeat(72))
for (const r of rows) {
  const matches = JSON.stringify(r.observed) === JSON.stringify(r.expected)
  const verdict = !matches ? '*** BREACH ***' : KEPT_BREACH_ROWS.has(r.n) ? '*** KEPT BREACH ***' : 'held'
  console.log(`  ${r.n}  ${String(r.label).padEnd(58)} ${verdict}  ${JSON.stringify(r.observed).slice(0, 70)}`)
}
if (ARM !== null) {
  const reddened = rows.filter((result) => result.breach).map((result) => result.n).sort()
  const required = [...(ARMS[ARM]?.reddens ?? [])].sort()
  const detected = armed.applied && JSON.stringify(reddened) === JSON.stringify(required)
  console.log(`\n  MUTATION arm '${ARM}'  predicateDeleted=${armed.applied}`
    + `  reddened=[${reddened.join(' ')}]  required=[${required.join(' ')}]`
    + `  ${detected ? 'MUTATION CONFIRMED' : 'NOT DETECTED'}\n`)
  rmSync(TMP, { recursive: true, force: true })
  // Three outcomes, three codes. An arm whose result cannot be told from a dead
  // arm's grades nothing: 1 says the sabotage was caught, 2 says this arm moved
  // no row and is decorative, 3 says the court did not finish its rows. 0 stays
  // impossible under an arm, because holding everything while sabotaged is the
  // one result that must never read as success.
  if (!rowsAreExact(rows)) process.exit(3)
  process.exit(detected ? 1 : 2)
}
if (MUTATE) {
  // Real mutation: tamper with an entry's stored hash and prove verifyChain
  // detects the broken link. Also truncate mid-line and prove TRUNCATED.
  const raw = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean)
  if (raw.length < 2) { console.error('not enough entries to tamper'); process.exit(1) }
  const tamperedEntry = JSON.parse(raw[0])
  tamperedEntry.hash = 'ff'.repeat(32)
  raw[0] = JSON.stringify(tamperedEntry)
  const tamperFile = join(TMP, 'tampered.jsonl')
  writeFileSync(tamperFile, raw.join('\n') + '\n')
  const tamperResult = verifyChain(tamperFile)
  const tamperDetected = !tamperResult.ok

  const truncFile = join(TMP, 'truncated.jsonl')
  writeFileSync(truncFile, readFileSync(chainFile, 'utf8').slice(0, -5))
  const truncResult = verifyChain(truncFile)
  const truncDetected = !truncResult.ok

  const ordinaryHeld = rows.every((result) => !result.breach)
  const sabotagedRows = rows.map((result) => result.n === 'R1' ? { ...result, breach: true } : result)
  const sabotageRejected = !mutationVerdict({
    ordinaryRows: sabotagedRows,
    tamperDetected,
    truncDetected,
  })
  const detected = mutationVerdict({ ordinaryRows: rows, tamperDetected, truncDetected })
    && sabotageRejected
  console.log(`\n  MUTATION chain integrity  ordinaryHeld=${ordinaryHeld}`
    + `  tamperDetected=${tamperDetected} truncationDetected=${truncDetected}`
    + `  sabotagedOrdinaryRejected=${sabotageRejected}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}
const anyBreach = !rowsAreExact(rows) || rows.some((r) => r.breach)
console.log(`  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log('\n  observationClass: SELF-REPORTED\n')
rmSync(TMP, { recursive: true, force: true })
process.exit(anyBreach ? 1 : 0)
