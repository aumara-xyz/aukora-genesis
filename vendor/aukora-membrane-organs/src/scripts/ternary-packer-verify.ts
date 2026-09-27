// scripts/ternary-packer-verify.ts — the gate core/swarm/ternary-packer.ts never had.
//
//     bun run scripts/ternary-packer-verify.ts
//
// The codec was inside core/swarm/t27-utility-discriminator.ts with ZERO gates in verify.sh,
// under a name that misdescribed it (packBase27Stream packs in base 32, not base 27). It is
// correct code, so it gets a gate; the name it was correct under does not survive.
//
// Every number below is measured in this process. No figure is a literal read from a comment.
import {
  packTritCells, unpackTritCells, bitsPerCell, packerGrantsAuthority,
  CELL_VALUES, BITS_PER_CELL, TernaryPackError,
} from '../core/swarm/ternary-packer';

let failures = 0;
const ok = (m: string) => console.log('  ok    ' + m);
const fail = (m: string) => { failures++; console.error('  FAIL  ' + m); };

// ── 1. LOSSLESS OVER THE WHOLE ALPHABET ─────────────────────────────────────
// Every one of the 27 symbols, at every offset within a byte, because a bit-packer's bugs live
// at the boundaries and a stream of one value would never find them.
{
  let bad = 0;
  for (let lead = 0; lead < 8; lead++) {
    const cells = [...Array(lead).fill(0), ...Array.from({ length: CELL_VALUES }, (_, i) => i)];
    const back = unpackTritCells(packTritCells(cells), cells.length);
    if (JSON.stringify(back) !== JSON.stringify(cells)) bad++;
  }
  if (bad === 0) ok(`lossless for all ${CELL_VALUES} symbols at all 8 bit offsets`);
  else fail(`${bad}/8 offsets lost data`);
}

// ── 2. LOSSLESS OVER RANDOM STREAMS ─────────────────────────────────────────
{
  let bad = 0, total = 0;
  for (const n of [0, 1, 2, 7, 8, 1000, 3001]) {
    const cells = Array.from({ length: n }, () => Math.floor(Math.random() * CELL_VALUES));
    const back = unpackTritCells(packTritCells(cells), n);
    total += n;
    if (JSON.stringify(back) !== JSON.stringify(cells)) bad++;
  }
  if (bad === 0) ok(`lossless round-trip across 7 lengths, ${total} cells total (including 0 and 1)`);
  else fail(`${bad} length(s) lost data`);
}

// ── 3. THE BITS-PER-CELL FIGURE, AND THE GAP IT DOES NOT CLOSE ──────────────
// The claim on the tin is 5.000. The optimum is log2(27) = 4.755. Both are asserted, because a
// codec gated only on what it achieves can quietly start claiming to be optimal.
{
  const N = 3000;
  const cells = Array.from({ length: N }, () => Math.floor(Math.random() * CELL_VALUES));
  const packed = packTritCells(cells);
  const measured = (packed.length * 8) / N;
  const optimum = Math.log2(CELL_VALUES);
  const naive = 8;

  if (measured === BITS_PER_CELL) ok(`${measured.toFixed(3)} bits/cell measured — exactly the fixed field width, at ${N} cells`);
  else fail(`expected ${BITS_PER_CELL}.000 bits/cell, measured ${measured.toFixed(3)}`);

  if (measured < naive) ok(`beats one-byte-per-cell: ${measured.toFixed(3)} < ${naive.toFixed(3)} (${(100 * (1 - measured / naive)).toFixed(1)}% smaller)`);
  else fail('the codec is not smaller than a byte per cell, which is its only reason to exist');

  const gap = measured - optimum;
  if (gap > 0) ok(`and does NOT reach the optimum: ${optimum.toFixed(3)} bits/cell, gap ${gap.toFixed(3)} (${(100 * gap / measured).toFixed(1)}% left on the table)`);
  else fail(`measured ${measured.toFixed(3)} is at or below log2(${CELL_VALUES}) = ${optimum.toFixed(3)} — impossible for a lossless code, so a number here is wrong`);
}

// ── 4. REFUSALS ARE BY NAME, NOT BY TRUNCATION ──────────────────────────────
{
  const cases: [string, () => unknown, string][] = [
    ['a value above the alphabet', () => packTritCells([27]), 'packer:not-a-cell'],
    ['a negative value', () => packTritCells([-1]), 'packer:not-a-cell'],
    ['a non-integer', () => packTritCells([1.5]), 'packer:not-a-cell'],
    ['a buffer too short for the count', () => unpackTritCells(new Uint8Array(1), 100), 'packer:short-buffer'],
    ['a negative count', () => unpackTritCells(new Uint8Array(8), -1), 'packer:bad-count'],
  ];
  let bad = 0;
  for (const [what, run, code] of cases) {
    try { run(); fail(`${what} was accepted`); bad++; }
    catch (e) { if (!(e instanceof TernaryPackError) || e.code !== code) { fail(`${what} refused, but as ${String((e as Error).message).slice(0, 50)}`); bad++; } }
  }
  if (bad === 0) ok('5 malformed inputs each refused by their own name, never masked into a valid cell');
}

// ── 5. MUTATION RED: the round-trip check can actually fail ─────────────────
// A packer gated only on "pack then unpack agrees" would pass if both sides were broken the same
// way. This corrupts the packed bytes and requires the comparison to notice.
{
  const cells = Array.from({ length: 64 }, () => Math.floor(Math.random() * CELL_VALUES));
  const packed = packTritCells(cells);
  const mutated = new Uint8Array(packed);
  mutated[3] ^= 0b0000_1000;                       // one bit, mid-stream
  const back = unpackTritCells(mutated, cells.length);
  const differs = JSON.stringify(back) !== JSON.stringify(cells);
  if (differs) ok('RED: flipping one bit of the packed stream changes the cells that come back');
  else fail('RED: a one-bit corruption round-tripped unchanged — the comparison proves nothing');
}

// ── 6. ZERO AUTHORITY ───────────────────────────────────────────────────────
if (packerGrantsAuthority() === false) ok('packerGrantsAuthority() === false — a codec is not a permission');
else fail('packerGrantsAuthority() did not return false');

console.log(failures ? `ternary-packer-verify: ${failures} failure(s)` : 'ternary-packer-verify: all gates green');
process.exit(failures ? 1 : 0);
