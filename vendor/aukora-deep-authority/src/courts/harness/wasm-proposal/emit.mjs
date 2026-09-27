/** Minimal WebAssembly binary emitter. No toolchain, no dependencies. */
const uleb = n => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b) } while (n); return o }
const sleb = n => { const o = []; for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o } o.push(b | 0x80) } }
const str = s => { const b = [...Buffer.from(s, 'utf8')]; return [...uleb(b.length), ...b] }
const vec = items => [...uleb(items.length), ...items.flat()]
const sect = (id, body) => [id, ...uleb(body.length), ...body]

const I32 = 0x7f
/**
 * Emit a proposal cell: imports exactly `imports` plus its memory, exports `main`,
 * and sends `payload` through the first import.
 *
 * The cell IMPORTS its linear memory and never defines one. A defined memory
 * carries limits that no reflection API exposes, so an admission check reading
 * `WebAssembly.Module.imports()` cannot see it; the wasm-cell court measures
 * that blindness at C11 and refuses the shape at C15, and this emitter is the
 * reference cell those rows admit, so it must obey the rule they enforce. The
 * host therefore owns the memory object and its maximum, and the cell exports
 * no `mem`: callers read guest bytes through the memory they supplied.
 *
 * @param {{ imports: [string, string][], payload: string }} spec Function imports as
 *   `[module, name]` pairs, and the UTF-8 payload placed at offset 0 of linear memory.
 * @returns {Uint8Array} The complete WebAssembly module bytes.
 */
export function emitCell({ imports, payload }) {
  const bytes = [...Buffer.from(payload, 'utf8')]
  const typeSec = sect(1, vec([
    [0x60, 0x02, I32, I32, 0x01, I32],
    [0x60, 0x00, 0x01, I32],
  ]))
  const importSec = sect(2, vec([
    ...imports.map(([m, n]) => [...str(m), ...str(n), 0x00, 0x00]),
    [...str('aukora'), ...str('mem'), 0x02, 0x00, ...uleb(1)],
  ]))
  const funcSec = sect(3, vec([[0x01]]))
  const idx = imports.length                                        // memory imports do not occupy the function index space
  const exportSec = sect(7, vec([[...str('main'), 0x00, ...uleb(idx)]]))
  const body = [0x00, 0x41, ...sleb(0), 0x41, ...sleb(bytes.length), 0x10, ...uleb(0), 0x0b]
  const codeSec = sect(10, vec([[...uleb(body.length), ...body]]))
  const dataSec = sect(11, vec([[0x00, 0x41, ...sleb(0), 0x0b, ...uleb(bytes.length), ...bytes]]))
  return Uint8Array.from([0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00,
    ...typeSec, ...importSec, ...funcSec, ...exportSec, ...codeSec, ...dataSec])
}
