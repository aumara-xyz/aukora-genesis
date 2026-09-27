/**
 * courts/harness/wasm-cell — a guest cell whose entire reach is enumerable
 * before it runs, and refused before it runs when it asks for more.
 *
 * WHY THIS COURT EXISTS. Every other confinement mechanism in this repository
 * mediates a CALL: the guest invokes something, and a check decides. Cordis
 * §6.3 rules that class moot against untrusted code, because a component that
 * reaches the host runtime reaches the underlying objects directly and no
 * language-level check sees it. §6.7 names the remedy and labels it future
 * work: bound a component to the dependencies it declares, "as a WebAssembly
 * module receives its imports from its embedder at instantiation".
 *
 * That is a different mechanism, and the difference is the whole point. The
 * embedder does not deny a call. It declines to build a machine that could
 * make the call. A WebAssembly module reaches exactly the functions its
 * import table names and has no syntax for anything else -- no ambient
 * globals, no module system, no `process`, no way to name a host object that
 * was not handed in. `WebAssembly.Module.imports()` enumerates that reach from
 * the bytes, BEFORE instantiation, which makes the reach a reviewable list
 * rather than a runtime surprise.
 *
 * AUKORA-SKELETON-KEY.md:759 cites `courts/harness/wasm/run.mjs` with rows W1
 * and W4 as "the only artifact in this record that instantiates the sources'
 * prescribed remedies at all". No such file has ever existed in this
 * repository. This court is written to make that citation true rather than to
 * leave it phantom, and it does not reuse the claimed row numbers, because the
 * rows below are this court's own and were not measured by anything before it.
 *
 *   C1  emitted        the cell is emitted byte by byte here, no toolchain
 *   C2  enumerated     total reach is readable from the bytes before running
 *   C3  admitted       reach subset of grant -> instantiates, proposal arrives
 *   C4  refused        reach exceeds grant -> refused BEFORE instantiation
 *   C5  backstop       withheld import -> LinkError from the runtime itself
 *   C6  no-ambient     no fs, net, proc, clock or random appears in any reach
 *   C7  isolated       cell memory is a separate buffer the host reads on demand
 *   C8  host-open      THE CEILING: the Node host embedding it is unconfined
 *   C9  bound          authorization names one exact cell; a swapped cell refuses
 *   C10 reviewable     THE LIMIT: the reach list is reviewable, not extra integrity
 *   C11 memory-blind   a cell that DEFINES memory declares nothing; limits invisible
 *   C12 memory-costs   such a cell commits real host memory when it touches pages
 *   C13 memory-capped  a cell that IMPORTS memory is bounded by the host's maximum
 *   C14 memory-refused a cell demanding more memory than supplied fails at link time
 *   C15 memory-shape   THE DEFENSE: a cell defining its own memory is refused
 *   C16 start-section  refusal precedes the one mechanism that runs guest code
 *                      at instantiation, shown with the control that runs it
 *
 * THE MEMORY SURFACE (C11-C15). Rows C2 through C10 rest on the claim that a
 * cell's reach is enumerable from its bytes. That claim covers IMPORTS only. A
 * module may instead DEFINE a memory or a table, and a defined resource appears
 * in no reflection API at all: `Module.imports()` returns [] for a cell
 * declaring two gibibytes. The remedy is a shape rule rather than a larger
 * allowlist, because the quantity to be checked is not readable -- a governed
 * cell must IMPORT its memory, and one that defines any unmeasurable resource
 * is refused for being unmeasurable.
 *
 * Mutation arms disable the reach check and widen the grant. Either one must
 * admit the over-reaching cell, or the check those rows describe is decoration.
 */
import { createHash } from 'node:crypto'
import { emitCell } from './emit.mjs'

/** Hex sha256 over exact module bytes. @param {Uint8Array} b Bytes. @returns {string} Digest. */
const sha256 = b => createHash('sha256').update(b).digest('hex')

const EXIT_INCONCLUSIVE = 78
const MUTATE = process.argv.includes('--mutate')
const ARM = (process.argv.find(a => a.startsWith('--arm=')) || '').slice(6) || (MUTATE ? 'skip-reach-check' : '')

/** The host's full capability table. The reach check decides which subset a cell receives. */
const HOST_CAPS = {
  aukora: { propose: null, status: () => 0, mem: null },
  wasi_snapshot_preview1: { fd_write: () => 0, path_open: () => 0 },
}
/** The host owns the memory and its ceiling; a governed cell may not declare its own. */
const HOST_MEMORY_PAGES = Object.freeze({ initial: 1, maximum: 2 })
const GRANTED = ARM === 'widen-grant'
  ? ['aukora.propose:function', 'aukora.mem:memory', 'wasi_snapshot_preview1.fd_write:function']
  : ['aukora.propose:function', 'aukora.mem:memory']

/**
 * Enumerate a module's reach from its bytes. This is the mechanism under test.
 * Entries carry KIND, so a grant naming a function cannot admit a memory of the
 * same name.
 * @param {WebAssembly.Module} mod Compiled module.
 * @returns {string[]} `module.name:kind` for every declared import.
 */
const reachOf = mod => WebAssembly.Module.imports(mod).map(i => `${i.module}.${i.name}:${i.kind}`)

/**
 * Section ids a module may define rather than import, whose declared limits no
 * reflection API exposes: 4 is the table section and 5 the memory section. A
 * defined table is the worse of the two, because its backing store is committed
 * at instantiation rather than when the guest first touches it.
 */
const UNMEASURABLE_SECTIONS = Object.freeze([4, 5])

/**
 * Scan a module's section ids for a resource it defines instead of importing.
 * @param {Uint8Array} bytes Complete module bytes.
 * @returns {number|false} The offending section id, or false when none appears.
 */
function definesUnmeasurableResource(bytes) {
  let i = 8
  while (i < bytes.length) {
    const id = bytes[i]; i += 1
    let len = 0, shift = 0
    for (;;) { const b = bytes[i]; i += 1; len |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7 }
    if (UNMEASURABLE_SECTIONS.includes(id)) return id
    i += len
  }
  return false
}

/**
 * The one admission path: refuse a cell whose declared reach exceeds the grant,
 * whose bytes are not the authorized bytes, or whose shape is unmeasurable.
 *
 * `bytes` and `auth` are REQUIRED. Accepting them optionally lets a call site
 * silently skip the shape rule, and reading them without binding them to `mod`
 * lets a real over-declaring module be admitted behind an eight-byte header, so
 * the digest is checked before either `bytes` or `mod` is otherwise read.
 *
 * @param {WebAssembly.Module} mod Compiled module.
 * @param {string[]} granted Reach entries the host is willing to supply.
 * @param {Uint8Array} bytes The bytes `mod` was compiled from.
 * @param {{ moduleDigest: string }} auth Authorization naming one exact cell.
 * @returns {{ admitted: boolean, reason?: string, excess?: string[], reach: string[], imports?: object }} The decision.
 */
function admit(mod, granted, bytes, auth) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('admit: bytes are required')
  if (auth === undefined || typeof auth.moduleDigest !== 'string') throw new TypeError('admit: auth.moduleDigest is required')
  if (sha256(bytes) !== auth.moduleDigest) {
    return { admitted: false, reason: 'wasm-cell:module-digest-mismatch', reach: reachOf(mod) }
  }
  const defined = ARM === 'skip-reach-check' ? false : definesUnmeasurableResource(bytes)
  if (defined) {
    return { admitted: false, reason: `wasm-cell:defines-unmeasurable-section-${defined}`, reach: reachOf(mod) }
  }
  const reach = reachOf(mod)
  const excess = reach.filter(r => !granted.includes(r))
  if (excess.length && ARM !== 'skip-reach-check') {
    return { admitted: false, reason: 'wasm-cell:reach-exceeds-grant', excess, reach }
  }
  // Built BY KIND: a memory import needs a WebAssembly.Memory whose maximum the
  // host chooses, which is the whole reason C15 requires the cell to import one.
  const imports = {}
  for (const r of reach) {
    const [path, kind] = r.split(':')
    const [m, n] = path.split('.')
    imports[m] = imports[m] || {}
    imports[m][n] = kind === 'memory'
      ? new WebAssembly.Memory({ ...HOST_MEMORY_PAGES })
      : HOST_CAPS[m]?.[n] ?? (() => 0)
  }
  return { admitted: true, reach, imports }
}

const rows = []
const row = (n, name, breach, detail, inconclusive = false) =>
  rows.push({ n, name, breach, detail, inconclusive })
const EXPECTED = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16']

// ---- C1 emitted -------------------------------------------------------------
let honest, honestMod
try {
  honest = emitCell({ imports: [['aukora', 'propose']], payload: '{"op":"memory.put","key":"court","value":"c1"}' })
  honestMod = new WebAssembly.Module(honest)
  row('C1', 'emitted', false, `${honest.length} bytes emitted here, compiled by the runtime`)
} catch (e) {
  row('C1', 'emitted', false, `emitter failed: ${e.message}`, true)
}

// ---- C2 enumerated ----------------------------------------------------------
if (honestMod) {
  const reach = reachOf(honestMod)
  const EXPECT_REACH = ['aukora.propose:function', 'aukora.mem:memory']
  row('C2', 'enumerated', JSON.stringify([...reach].sort()) !== JSON.stringify([...EXPECT_REACH].sort()),
    `reach read from bytes before instantiation = [${reach.join(' ')}]. ` +
    'Entries carry KIND, so a grant naming a function cannot admit a memory of the same name. ' +
    'What is readable is the set of host names the cell may reference; declared LIMITS are not, which is why C11 exists.')
} else row('C2', 'enumerated', false, 'no module to enumerate', true)

// ---- C3 admitted ------------------------------------------------------------
let delivered = null
if (honestMod) {
  const a = admit(honestMod, GRANTED, honest, { moduleDigest: sha256(honest) })
  if (!a.admitted) row('C3', 'admitted', true, `honest cell refused: ${a.reason}`)
  else {
    let inst
    a.imports.aukora.propose = (p, l) => { delivered = Buffer.from(a.imports.aukora.mem.buffer, p, l).toString('utf8'); return 1 }
    inst = new WebAssembly.Instance(honestMod, a.imports)
    const rc = inst.exports.main()
    const ok = rc === 1 && delivered && JSON.parse(delivered).op === 'memory.put'
    row('C3', 'admitted', !ok, `main()=${rc}, host received ${delivered ? delivered.length : 0} bytes: ${delivered}`)
  }
} else row('C3', 'admitted', false, 'no module', true)

// ---- C4 refused before instantiation ----------------------------------------
let overMod
try {
  const over = emitCell({
    imports: [['aukora', 'propose'], ['wasi_snapshot_preview1', 'fd_write']],
    payload: '{"op":"memory.put","key":"court","value":"c4"}',
  })
  overMod = new WebAssembly.Module(over)
  const a = admit(overMod, GRANTED, over, { moduleDigest: sha256(over) })
  const refused = !a.admitted
  // Only reach-exceeds-grant carries `excess`; the digest and shape rules refuse
  // without one, and reading it unconditionally would turn a refusal this row
  // wants to report into an INCONCLUSIVE from the catch below.
  row('C4', 'refused', !refused,
    refused
      ? `${a.reason}${a.excess ? `; excess=[${a.excess.join(' ')}]` : ''} -- refused with zero guest instructions executed`
      : `*** ADMITTED *** reach=[${a.reach.join(' ')}] under arm '${ARM || 'none'}'`)
} catch (e) {
  row('C4', 'refused', false, `over-reaching cell would not compile: ${e.message}`, true)
}

// ---- C5 runtime backstop ----------------------------------------------------
if (honestMod) {
  let err = null
  try { new WebAssembly.Instance(honestMod, { aukora: {} }) } catch (e) { err = e }
  row('C5', 'backstop', !(err && err instanceof WebAssembly.LinkError),
    err ? `${err.constructor.name}: ${err.message}` : '*** instantiated with the import withheld ***')
} else row('C5', 'backstop', false, 'no module', true)

// ---- C6 no ambient ----------------------------------------------------------
const FORBIDDEN = /^(wasi|env\.(fd|path|proc|clock|random|sock))|fs|net|process|child_process|random|clock/i
if (honestMod) {
  const reach = reachOf(honestMod)
  const hits = reach.filter(r => FORBIDDEN.test(r))
  row('C6', 'no-ambient', hits.length > 0,
    `reach=[${reach.join(' ')}]; filesystem/network/process/clock/random imports present: ${hits.length}`)
} else row('C6', 'no-ambient', false, 'no module', true)

// ---- C7 memory isolated -----------------------------------------------------
if (honestMod) {
  const a = admit(honestMod, GRANTED, honest, { moduleDigest: sha256(honest) })
  // A refused honest cell leaves no import table to instantiate. Reporting it as
  // a red row keeps the rest of the table measurable; dereferencing a.imports
  // would abort the court before it prints anything at all.
  if (!a.admitted) row('C7', 'isolated', true, `honest cell refused: ${a.reason}`)
  else {
    new WebAssembly.Instance(honestMod, a.imports)
    const mem = a.imports.aukora.mem
    const detached = mem instanceof WebAssembly.Memory && mem.buffer instanceof ArrayBuffer
      && mem.buffer !== globalThis.ArrayBuffer.prototype && !ArrayBuffer.isView(mem.buffer)
    row('C7', 'isolated', !detached,
      `linear memory is a ${mem.buffer.byteLength}-byte ArrayBuffer SUPPLIED BY THE HOST, which the host must read explicitly. ` +
      'The cell cannot address the V8 heap, and cannot choose its own size because it does not declare a memory at all.')
  }
} else row('C7', 'isolated', false, 'no module', true)

// ---- C8 the ceiling ---------------------------------------------------------
let hostReach = 0
try { const fs = await import('node:fs'); hostReach = typeof fs.writeFileSync === 'function' ? 1 : 0 } catch { hostReach = 0 }
row('C8', 'host-open', false,
  hostReach
    ? 'CONFINEMENT_NOT_ESTABLISHED for the host: this Node process imported node:fs and holds full ambient reach. The cell is confined; its embedder is not.'
    : 'host could not import node:fs (unexpected on this platform)')


// ---- C9 bound to one exact cell ---------------------------------------------
// This row drives the real admission path. Comparing sha(honest) against a
// digest computed as sha(honest) asserts a property of SHA-256 rather than of
// this court, and would hold against an admit() that never consulted a digest.
const reachList = m => WebAssembly.Module.imports(m).map(i => `${i.module}.${i.name}:${i.kind}`).sort()
if (honest && honestMod) {
  const auth = { moduleDigest: sha256(honest) }
  const swapped = emitCell({ imports: [['aukora', 'propose']], payload: '{"op":"memory.put","key":"court","value":"SWAPPED"}' })
  const swappedMod = new WebAssembly.Module(swapped)
  const sameReach = JSON.stringify(reachList(swappedMod)) === JSON.stringify(reachList(honestMod))
  const original = admit(honestMod, GRANTED, honest, auth)
  const substituted = admit(swappedMod, GRANTED, swapped, auth)
  row('C9', 'bound', !(original.admitted && !substituted.admitted && sameReach),
    `the authorized cell is admitted, and a cell with IDENTICAL reach (${sameReach}) but a different payload is refused by the same call as ` +
    `${substituted.reason}. The refusal comes from admit() consulting auth.moduleDigest, not from comparing two hashes in this row.`)
} else row('C9', 'bound', false, 'no module', true)

// ---- C10 what the reach list is NOT -----------------------------------------
if (honestMod) {
  const wide = emitCell({ imports: [['aukora', 'propose'], ['wasi_snapshot_preview1', 'fd_write']], payload: '{"op":"x"}' })
  const wideMod = new WebAssembly.Module(wide)
  const reachDiffers = reachList(wideMod).join() !== reachList(honestMod).join()
  const digestAlsoDiffers = sha256(wide) !== sha256(honest)
  row('C10', 'reviewable', !(reachDiffers && digestAlsoDiffers),
    'a reach digest adds NO integrity over the module digest, reach being a function of the bytes. Its value is that [' +
    reachList(honestMod).join(' ') + '] is a capability list a person can approve, where a 64-hex module digest is not.')
} else row('C10', 'reviewable', false, 'no module', true)

// ---- C11..C14 the memory surface --------------------------------------------
// Reach enumeration covers IMPORTS. A module may also DEFINE a memory, and a
// defined memory appears in no reflection API, so the admission check that
// refuses an over-reaching import table cannot see it at all. These four rows
// measure the hole (C11, C12) and the shape that closes it (C13, C14).
const uleb = n => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b) } while (n); return o }
const sec = (id, body) => [id, ...uleb(body.length), ...body]
const nm = t => { const b = [...Buffer.from(t, 'utf8')]; return [...uleb(b.length), ...b] }
const definesMemory = pages => Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...sec(5, [0x01, 0x00, ...uleb(pages)]),
  ...sec(7, [0x01, ...nm('mem'), 0x02, 0x00])])
const importsMemory = pages => Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...sec(2, [0x01, ...nm('aukora'), ...nm('mem'), 0x02, 0x00, ...uleb(pages)])])

const PAGES = 32768                                   // 2 GiB; the wasm32 ceiling is 65536
const selfBytes = definesMemory(PAGES)
const selfMod = new WebAssembly.Module(selfBytes)
const declared = WebAssembly.Module.imports(selfMod)
row('C11', 'memory-blind', declared.length !== 0,
  `a cell defining a ${(PAGES * 64 / 1024).toFixed(0)} MiB memory reports Module.imports()=${JSON.stringify(declared)}. ` +
  'A defined memory appears in no reflection API, so the reach check C2 through C10 rest on cannot see it. ' +
  'The remedy is the shape rule at C15, not a bigger allowlist: the quantity to check is not readable.')

const selfInst = new WebAssembly.Instance(selfMod, {})
const view = new Uint8Array(selfInst.exports.mem.buffer)   // this cell DEFINES memory, which is the subject of C11 and C12
const rssBefore = process.memoryUsage().rss
for (let i = 0; i < view.length; i += 65536) view[i] = 1
const committedMiB = (process.memoryUsage().rss - rssBefore) / 1048576
row('C12', 'memory-costs', !(view.length === PAGES * 65536 && committedMiB > 64),
  `that cell instantiated with no host approval and, on touching one byte per page of its ${(view.length / 1048576).toFixed(0)} MiB, ` +
  `moved this process's RSS by ${committedMiB.toFixed(0)} MiB. The allocation is lazy, so instantiation alone is cheap and the cost arrives when the guest chooses.`)

const impMod = new WebAssembly.Module(importsMemory(1))
const impDeclared = WebAssembly.Module.imports(impMod).map(i => `${i.module}.${i.name}:${i.kind}`)
const capped = new WebAssembly.Memory({ initial: 1, maximum: 2 })
new WebAssembly.Instance(impMod, { aukora: { mem: capped } })
capped.grow(1)
let grewPastCap = true
try { capped.grow(1) } catch { grewPastCap = false }
row('C13', 'memory-capped', grewPastCap || impDeclared.length !== 1,
  `a cell importing its memory declares [${impDeclared.join(' ')}], which the reach check reads. ` +
  `The host supplied initial 1 / maximum 2 pages; growth to the cap succeeded and growth past it was refused: ${!grewPastCap}.`)

let linkRefusal = null
try {
  new WebAssembly.Instance(new WebAssembly.Module(importsMemory(100)),
    { aukora: { mem: new WebAssembly.Memory({ initial: 1, maximum: 2 }) } })
} catch (e) { linkRefusal = `${e.constructor.name}: ${e.message.slice(0, 70)}` }
row('C14', 'memory-refused', linkRefusal === null,
  linkRefusal === null
    ? '*** a memory below the cell\'s declared minimum was accepted ***'
    : `a cell declaring a 100-page minimum against a 1-page host memory is refused at link time -- ${linkRefusal}`)

// ---- C15 the defense C11 and C12 argue for ----------------------------------
const selfAdmission = admit(selfMod, GRANTED, selfBytes, { moduleDigest: sha256(selfBytes) })
row('C15', 'memory-shape', selfAdmission.admitted,
  selfAdmission.admitted
    ? '*** a cell defining its own memory was admitted ***'
    : `a cell defining its own memory is refused as ${selfAdmission.reason}, before instantiation and therefore before the ${(PAGES * 64 / 1024).toFixed(0)} MiB of C12 can be committed. ` +
      'A shape rule rather than a limit check, because the limit is not readable.')

// ---- C16 does refusal actually precede execution? ---------------------------
// C4 asserts an over-reaching cell is refused "with zero guest instructions
// executed". That is only meaningful if some mechanism could otherwise have run
// guest code before an export is called, and one can: a module's start section
// runs at instantiation. This row refuses an over-reaching cell that HAS a start
// section, then instantiates the identical module as a control to show the start
// section does fire when nothing refuses it first.
{
  const startCell = Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...sec(1, [0x02, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, 0x60, 0x00, 0x00]),
    ...sec(2, [0x02, ...nm('aukora'), ...nm('propose'), 0x00, 0x00,
      ...nm('wasi_snapshot_preview1'), ...nm('fd_write'), 0x00, 0x00]),
    ...sec(3, [0x01, 0x01]),
    ...sec(8, [0x02]),                                // start section -> the local function
    ...sec(10, [0x01, 0x09, 0x00, 0x41, 0x00, 0x41, 0x00, 0x10, 0x00, 0x1a, 0x0b]),
  ])
  const startMod = new WebAssembly.Module(startCell)
  let ranWhenRefused = false
  let ranWhenInstantiated = false
  const tableFor = flag => ({
    aukora: { propose: () => { flag(); return 0 }, status: () => 0 },
    wasi_snapshot_preview1: { fd_write: () => { flag(); return 0 }, path_open: () => 0 },
  })
  const decision = admit(startMod, GRANTED, startCell, { moduleDigest: sha256(startCell) })
  if (decision.admitted) new WebAssembly.Instance(startMod, tableFor(() => { ranWhenRefused = true }))
  try { new WebAssembly.Instance(startMod, tableFor(() => { ranWhenInstantiated = true })) } catch { /* control only; a link failure here leaves ranWhenInstantiated false and breaches the row */ }
  row('C16', 'start-section', decision.admitted || ranWhenRefused || !ranWhenInstantiated,
    `an over-reaching cell carrying a start section was ${decision.admitted ? '*** ADMITTED ***' : `refused as ${decision.reason}`}; guest code ran: ${ranWhenRefused}. ` +
    `Instantiating the identical module as a control DID run it: ${ranWhenInstantiated}. ` +
    'So C4\'s "zero guest instructions executed" is a property of refusing before instantiation, not an absence of any way to execute. ' +
    'An ADMITTED cell with a start section runs at instantiation, before the host calls an export, which bounds what a host may learn by instantiating a cell in order to inspect it.')
}

// ---- report -----------------------------------------------------------------
const measured = rows.map(r => r.n)
const complete = EXPECTED.every(n => measured.includes(n))
console.log('\n  courts/harness/wasm-cell — reach declared before execution\n')
for (const r of rows) {
  const v = r.inconclusive ? '*** INCONCLUSIVE ***' : r.breach ? '*** BREACH ***' : 'held'
  console.log(`  ${r.n.padEnd(3)}  ${r.name.padEnd(14)} ${v.padEnd(22)} ${r.detail}`)
}

if (ARM) {
  const c4 = rows.find(r => r.n === 'C4')
  const detected = c4 && c4.breach
  console.log(`\n  MUTATION arm '${ARM}'  over-reaching cell admitted = ${detected}   ${detected ? 'MUTATION CONFIRMED' : 'NOT DETECTED'}`)
  console.log(`  granted reach under this arm: [${GRANTED.join(' ')}]\n`)
  // Three outcomes, three codes. An arm that cannot be distinguished from a
  // dead arm grades nothing: 1 says the sabotage was caught, 2 says this arm
  // moved no row and is decorative, 3 says the court did not finish its rows.
  // 0 stays impossible under an arm, because holding everything while sabotaged
  // is the one result that must never read as success.
  if (!complete) process.exit(3)
  process.exit(detected ? 1 : 2)
}

const inconclusive = rows.filter(r => r.inconclusive)
const breach = rows.some(r => r.breach)
console.log(`\n  ${rows.length} rows, ${rows.filter(r => !r.breach && !r.inconclusive).length} held, ${inconclusive.length} inconclusive`)
console.log('  CEILING: this court measures one WebAssembly cell. It does not establish confinement')
console.log('  of the Node host, of native Cordis plugins, or of any same-uid process.\n')
if (!complete) { console.log(`  ROW TABLE INCOMPLETE: expected ${EXPECTED.join(',')} measured ${measured.join(',')}`); process.exit(1) }
if (inconclusive.length) process.exit(EXIT_INCONCLUSIVE)
process.exit(breach ? 1 : 0)
