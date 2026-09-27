// THE PHI TEST — is the golden torus found, or chosen?
//
// The Atlas (docs/map-room/THE_ATLAS.md, §V) holds this slot open: the claim
// that R = phi distributes the crossings of the deck's knots with unusual
// evenness is seductive and undemonstrated. This script runs the named test.
//
// PREREGISTERED, before any number was seen:
//
//   MEASURE. For each card whose projected curve has at least six
//   self-crossings, compute every 2D crossing point of the projection
//   (the whole deck's true windings, tilt beta), then the coefficient of
//   variation (sd/mean) of nearest-neighbour distances among those
//   crossings. CV is scale-free, so no radius is favoured by size alone.
//   Lower CV = crossings spread more evenly. The deck's score E(R) is the
//   mean CV over eligible cards.
//
//   SWEEP. R from 1.10 to 3.00 in steps of 0.05, plus phi exactly, at two
//   tilts: beta = 0.5 (the plate's view) and beta = 0.3 (the card's).
//   r = 1 throughout. Same sampling density at every R.
//
//   CRITERION. Phi is FOUND if, at BOTH tilts, the sweep's minimum lies
//   within 0.10 of phi AND E(phi) beats the sweep's median by more than
//   half the sweep's standard deviation. Anything less: phi is A FINE
//   CHOICE AMONG MANY, and the chart says so.
//
// The verdict enters THE ATLAS either way. Usage: bun scripts/phiTest.mjs

import { CARDS, knotOf } from '../spatial/app/luminara-canon.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };

function strandsOf(p, q, R, beta) {
  const g = q === 0 ? 1 : gcd(p, Math.abs(q));
  const pf = p / g, qf = q / g;
  const N = Math.max(80, Math.min(240, Math.round(60 + 24 * (pf + Math.abs(qf)))));
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const strands = [];
  for (let s = 0; s < g; s++) {
    const phase = 2 * Math.PI * s / g, pts = [];
    for (let j = 0; j < N; j++) {
      const t = j / N * 2 * Math.PI, tube = qf * t + phase, lon = pf * t;
      const x = (R + Math.cos(tube)) * Math.cos(lon);
      const y = (R + Math.cos(tube)) * Math.sin(lon);
      const z = Math.sin(tube);
      pts.push([x, y * cb - z * sb]);
    }
    strands.push(pts);
  }
  return strands;
}

// segment intersection, excluding pairs adjacent along the same strand
function crossings(strands) {
  const segs = [];
  strands.forEach((pts, s) => {
    const N = pts.length;
    for (let i = 0; i < N; i++) segs.push([pts[i], pts[(i + 1) % N], s, i, N]);
  });
  // spatial hash so the pair test stays near-linear
  let maxLen = 0;
  for (const [a, b] of segs) maxLen = Math.max(maxLen, Math.hypot(b[0] - a[0], b[1] - a[1]));
  const cell = Math.max(1e-6, 2 * maxLen);
  const buckets = new Map();
  segs.forEach((sg, idx) => {
    const [a, b] = sg;
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let X = x0; X <= x1; X++) for (let Y = y0; Y <= y1; Y++) {
      const k = X + ':' + Y;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(idx);
    }
  });
  const seen = new Set(), pts = [];
  for (const list of buckets.values()) {
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const i = list[u], j = list[v];
      const key = i < j ? i * 100000 + j : j * 100000 + i;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = segs[i], B = segs[j];
      if (A[2] === B[2]) {  // same strand: skip neighbours along the curve
        const d = Math.abs(A[3] - B[3]);
        if (d < 2 || d > A[4] - 2) continue;
      }
      const [p1, p2] = A, [p3, p4] = B;
      const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
      const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
      const s2 = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
      if (t <= 0 || t >= 1 || s2 <= 0 || s2 >= 1) continue;
      pts.push([p1[0] + t * d1x, p1[1] + t * d1y]);
    }
  }
  return pts;
}

function cvNN(pts) {
  if (pts.length < 6) return null;
  const nn = pts.map((p, i) => {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(pts[j][0] - p[0], pts[j][1] - p[1]);
      if (d < best) best = d;
    }
    return best;
  });
  const mean = nn.reduce((a, b) => a + b, 0) / nn.length;
  const sd = Math.sqrt(nn.reduce((a, b) => a + (b - mean) ** 2, 0) / nn.length);
  return sd / mean;
}

function E(R, beta) {
  let sum = 0, n = 0;
  for (const c of CARDS) {
    const k = knotOf(c.n);
    if (k.q === 0) continue;
    const cv = cvNN(crossings(strandsOf(k.p, k.q, R, beta)));
    if (cv !== null) { sum += cv; n++; }
  }
  return { score: sum / n, cards: n };
}

const sweep = [];
for (let R = 1.10; R <= 3.001; R += 0.05) sweep.push(Number(R.toFixed(2)));
if (!sweep.some((R) => Math.abs(R - PHI) < 1e-9)) sweep.push(Number(PHI.toFixed(6)));
sweep.sort((a, b) => a - b);

for (const beta of [0.5, 0.3]) {
  const rows = sweep.map((R) => ({ R, ...E(R, beta) }));
  const scores = rows.map((r) => r.score);
  const min = rows.reduce((a, b) => (b.score < a.score ? b : a));
  const phiRow = rows.find((r) => Math.abs(r.R - PHI) < 1e-3);
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  const rank = sorted.indexOf(phiRow.score) + 1;
  console.log('=== beta ' + beta + ' ===');
  for (const r of rows) {
    const tag = Math.abs(r.R - PHI) < 1e-3 ? '  <-- PHI' : (r.R === min.R ? '  <-- MIN' : '');
    console.log('R=' + r.R.toFixed(3) + '  E=' + r.score.toFixed(4) + ' (' + r.cards + ' cards)' + tag);
  }
  console.log('phi: E=' + phiRow.score.toFixed(4) + ' rank ' + rank + '/' + rows.length
    + ' | min at R=' + min.R.toFixed(3) + ' E=' + min.score.toFixed(4)
    + ' | median=' + median.toFixed(4) + ' sd=' + sd.toFixed(4));
  const found = Math.abs(min.R - PHI) <= 0.10 && (median - phiRow.score) > 0.5 * sd;
  console.log('criterion at this tilt: ' + (found ? 'FOUND' : 'A FINE CHOICE') + '\n');
}

// THE FOUND RADIUS, the companion check (entered with the verdict): a torus
// weighs its two directions by the conformal measure 2pi/sqrt(R^2 - 1);
// through equals around at R = sqrt(2) alone, the conformally square torus,
// which is also the stereographic shadow of the Clifford torus in the
// three-sphere, where every T(p,q) is a geodesic: a straight walk that the
// shape of the space closes into a knot. Verified here so the Atlas's claim
// is re-runnable from the repo.
console.log('=== the found radius: conformal aspect (through/around) ===');
for (const R of [1.2, Math.SQRT2, PHI, 2.0]) {
  let s = 0; const M = 200000;
  for (let i = 0; i < M; i++) { const psi = (i + 0.5) / M * 2 * Math.PI; s += 1 / (R + Math.cos(psi)); }
  s *= 2 * Math.PI / M;
  console.log('R=' + R.toFixed(6) + '  aspect=' + (s / (2 * Math.PI)).toFixed(4)
    + (Math.abs(s - 2 * Math.PI) < 1e-3 ? '   <-- SQUARE: the found radius' : ''));
}
