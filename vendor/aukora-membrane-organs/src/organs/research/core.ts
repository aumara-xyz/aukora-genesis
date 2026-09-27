// φ · seed/core.ts — THE LAW CORE, COMPILED TO WASM. Ring-0 artifact, AssemblyScript.
//
// ══ THE PARITY CONTRACT, AGAINST φ'S OWN LAW — NOT THE DONOR'S ══
//
//   sha256Hex(s)         === node's sha256(utf8(s)) as lowercase hex
//   chainHashHex(p, b)   === core/witness/chain.mjs `hashOf(prev, body)` — sha256(prev ++ canonicalJSON)
//   pathRefusalCore      === the codes below, checked against core/witness/law.mjs by the JS twin
//   addr27*              === docs/TERNARY-27.md, all 27 addresses
//   coreGrantsAuthority  === 0, forever. This core cannot authorize anything.
//
// ══ WHAT WAS LIFTED AND WHAT WAS NOT ══
//
// The SHA-256 above `pathRefusalCore` is lifted verbatim from `aukora-one/seed/core.ts`: a hash is a
// hash and re-deriving one by hand is how digests drift.
//
// `pathRefusalCore` IS NOT LIFTED, and that is the whole care in this file. The donor's version encodes
// AUKORA-ONE'S law — `world/` is the only lawful destination and everything else is ring-0. φ's law is
// a protected-glob set in `core/witness/law.mjs` with an optional writable allowlist. Lifting the
// donor's function would have compiled a DIFFERENT ORGANISM'S CONSTITUTION into this one and passed its
// own parity test, because the test would have been written against the thing that was lifted.
//
// So the five-code SHAPE is kept and the semantics are φ's:
//
//   0 ok          nothing in the law refuses it
//   1 malformed   empty
//   2 traversal   NUL, backslash, absolute, drive letter, or an empty / `.` / `..` segment
//   3 ring0       matches a protected pattern (φ: DEFAULT_PROTECTED + the law file's own list)
//   4 undeclared  a writable allowlist is declared and this path is not on it
//
// The patterns arrive as newline-joined strings from the caller. The core does no I/O and reads no
// file: it cannot open `aukora.law.json`, so it cannot disagree with the JS about what the law SAYS —
// only about what the law MEANS, which is the only disagreement worth detecting.
//
// ══ WHAT THIS IS NOT ══
//
// Not a second authority. `coreGrantsAuthority()` returns 0 and there is no path by which this module
// permits anything: it returns integers. The guard still decides, and when the two disagree the mount
// refuses rather than picking a winner.

const K: u32[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

@inline
function rotr(x: u32, n: u32): u32 {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(data: Uint8Array): Uint8Array {
  // pad to length ≡ 56 (mod 64), then append the 8-byte big-endian bit length
  let total = data.length + 1;
  const rem = total % 64;
  if (rem > 56) total += 120 - rem;
  else total += 56 - rem;
  total += 8;

  const msg = new Uint8Array(total);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];
  msg[data.length] = 0x80;
  const bitLen = (data.length as u64) * 8;
  for (let i = 0; i < 8; i++) msg[total - 1 - i] = <u8>(bitLen >> (8 * i));

  let h0: u32 = 0x6a09e667, h1: u32 = 0xbb67ae85, h2: u32 = 0x3c6ef372, h3: u32 = 0xa54ff53a;
  let h4: u32 = 0x510e527f, h5: u32 = 0x9b05688c, h6: u32 = 0x1f83d9ab, h7: u32 = 0x5be0cd19;

  const w = new Array<u32>(64);
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) {
      const b = off + t * 4;
      w[t] = ((msg[b] as u32) << 24) | ((msg[b + 1] as u32) << 16) | ((msg[b + 2] as u32) << 8) | (msg[b + 3] as u32);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = w[t - 16] + s0 + w[t - 7] + s1;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = h + S1 + ch + K[i] + w[i];
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = S0 + maj;
      h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h0 += a; h1 += b; h2 += c; h3 += d; h4 += e; h5 += f; h6 += g; h7 += h;
  }

  const out = new Uint8Array(32);
  const hs: u32[] = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = <u8>(hs[i] >>> 24);
    out[i * 4 + 1] = <u8>(hs[i] >>> 16);
    out[i * 4 + 2] = <u8>(hs[i] >>> 8);
    out[i * 4 + 3] = <u8>hs[i];
  }
  return out;
}

// ---------------------------------------------------------------- hex ---

const HEX: string = "0123456789abcdef";

function hexEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += HEX.charAt(b >>> 4) + HEX.charAt(b & 0x0f);
  }
  return s;
}

function hexNibble(c: i32): u8 {
  if (c >= 48 && c <= 57) return <u8>(c - 48);
  if (c >= 97 && c <= 102) return <u8>(c - 87);
  if (c >= 65 && c <= 70) return <u8>(c - 55);
  return 0;
}

function hexDecode(hex: string): Uint8Array {
  const n = hex.length / 2;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (hexNibble(hex.charCodeAt(i * 2)) << 4) | hexNibble(hex.charCodeAt(i * 2 + 1));
  }
  return out;
}

// ---------------------------------------------------------------- exports ---

export function sha256Hex(s: string): string {
  return hexEncode(sha256Bytes(Uint8Array.wrap(String.UTF8.encode(s))));
}
// ------------------------------------------------------------------ glob ---

/**
 * The one pattern form φ's law uses, matched the way `compilePattern` matches it.
 *
 * `**` crosses separators, `*` does not, everything else is literal. Written as a small recursive
 * matcher rather than by translating to a regex, because a regex here would be a SECOND translation of
 * the law's language and the two would drift — which is the defect this whole file exists to detect.
 */
function globMatch(pat: string, s: string): bool {
  return globAt(pat, 0, s, 0);
}

function globAt(pat: string, pi: i32, s: string, si: i32): bool {
  let p = pi;
  let i = si;
  while (p < pat.length) {
    const c = pat.charCodeAt(p);
    if (c == 42) { // '*'
      const doubled = p + 1 < pat.length && pat.charCodeAt(p + 1) == 42;
      if (doubled) {
        let next = p + 2;
        // `**/` also matches zero segments, so `core/**` behaves the way the law reads.
        if (next < pat.length && pat.charCodeAt(next) == 47) next += 1;
        for (let k = i; k <= s.length; k++) if (globAt(pat, next, s, k)) return true;
        return false;
      }
      for (let k = i; k <= s.length; k++) {
        if (k > i && s.charCodeAt(k - 1) == 47) break; // a single star never crosses '/'
        if (globAt(pat, p + 1, s, k)) return true;
      }
      return false;
    }
    if (i >= s.length) return false;
    if (s.charCodeAt(i) != c) return false;
    p += 1;
    i += 1;
  }
  return i == s.length;
}

function anyMatch(joined: string, path: string): bool {
  if (joined.length == 0) return false;
  const pats = joined.split("\n");
  for (let i = 0; i < pats.length; i++) {
    if (pats[i].length > 0 && globMatch(pats[i], path)) return true;
  }
  return false;
}

// ------------------------------------------------------------------- law ---

/** 0 ok, 1 malformed, 2 traversal, 3 ring0, 4 undeclared. See the header. */
export function pathRefusalCore(path: string, protectedJoined: string, writableJoined: string): i32 {
  if (path.length == 0) return 1;
  // NUL BY CODE POINT, never as a literal in the source. A control character embedded in a file is
  // invisible in every diff and every review that would otherwise have caught it.
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c == 0 || c == 92) return 2; // NUL or backslash
  }
  if (path.startsWith("/")) return 2;
  if (path.length >= 2) {
    const c0 = path.charCodeAt(0);
    if (((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) && path.charCodeAt(1) == 58) return 2;
  }
  const segs = path.split("/");
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.length == 0 || s == "." || s == "..") return 2;
  }
  // PROTECTED BEFORE WRITABLE, deliberately: a path on both lists is refused. An allowlist that could
  // re-open a protected path would make the writable list a way to edit the law by editing the law.
  if (anyMatch(protectedJoined, path)) return 3;
  if (writableJoined.length > 0 && !anyMatch(writableJoined, path)) return 4;
  return 0;
}

// ----------------------------------------------------------------- chain ---

/**
 * φ's receipt hash: sha256 of the previous hex ASCII concatenated with the canonical JSON body, with
 * no separator between them.
 *
 * The canonical JSON is built by the CALLER and passed in. This core does not re-serialise it, because
 * two independent JSON canonicalisers is exactly the drift `chain.mjs` says its preimage exists to
 * prevent: "defined once, here, and nowhere else".
 */
export function chainHashHex(prevHex: string, canonicalBody: string): string {
  return sha256Hex(prevHex + canonicalBody);
}

// ---------------------------------------------------------------- addr27 ---

/**
 * The 27-cell address space of docs/TERNARY-27.md, which had a spec and a golden table and no code.
 *
 *   a = 9*t2 + 3*t1 + t0,  a in 0..26,  ti in {0,1,2},  1 is the MIDDLE value
 *
 * The shell is how many coordinates are NOT at the middle: 0 centre, 1 face, 2 edge, 3 corner — which
 * is exactly the Hamming distance from the centre 13 = (1,1,1). That identity is the fact the document
 * says is worth keeping, and the test walks all 27 addresses to hold it rather than trusting this note.
 */
export function addr27Encode(t2: i32, t1: i32, t0: i32): i32 {
  if (t2 < 0 || t2 > 2 || t1 < 0 || t1 > 2 || t0 < 0 || t0 > 2) return -1;
  return 9 * t2 + 3 * t1 + t0;
}

/** Trit `i` (0 = least significant) of address `a`, or -1 if the address is out of range. */
export function addr27Trit(a: i32, i: i32): i32 {
  if (a < 0 || a > 26 || i < 0 || i > 2) return -1;
  if (i == 0) return a % 3;
  if (i == 1) return (a / 3) % 3;
  return (a / 9) % 3;
}

/** 0 centre, 1 face, 2 edge, 3 corner. */
export function addr27Shell(a: i32): i32 {
  if (a < 0 || a > 26) return -1;
  let n = 0;
  for (let i = 0; i < 3; i++) if (addr27Trit(a, i) != 1) n += 1;
  return n;
}

/** Hamming distance in trits: how many of the three coordinates differ. Range 0..3. */
export function addr27Distance(a: i32, b: i32): i32 {
  if (a < 0 || a > 26 || b < 0 || b > 26) return -1;
  let d = 0;
  for (let i = 0; i < 3; i++) if (addr27Trit(a, i) != addr27Trit(b, i)) d += 1;
  return d;
}

/** The address where every coordinate declines to commit — the space's own home for UNKNOWN. */
export function addr27Centre(): i32 {
  return 13;
}

/**
 * A three-bit value reaches only the 8 corners, which is why binary is a strict subset of this space.
 * Each bit picks an extreme (0 or 2); no bit pattern can ever name a middle coordinate.
 */
export function addr27FromBits(bits: i32): i32 {
  if (bits < 0 || bits > 7) return -1;
  const b2 = (bits >> 2) & 1;
  const b1 = (bits >> 1) & 1;
  const b0 = bits & 1;
  return addr27Encode(b2 * 2, b1 * 2, b0 * 2);
}

// ------------------------------------------------------------- authority ---

/** Zero. Forever. There is no argument that changes this and no branch that returns anything else. */
export function coreGrantsAuthority(): i32 {
  return 0;
}
