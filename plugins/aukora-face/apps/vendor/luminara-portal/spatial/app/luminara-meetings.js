// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE MEETINGS: the deck's relations drawn, not listed. Two cards' windings
// laid on ONE torus cross a counted number of times, and the count is the
// determinant of their two laws: p·q' - q·p'. This is the intersection number
// of the classes (p, q) and (p', q') on the torus, arithmetic before it is
// ink, and it is exact: no drawing decision can move it. The module computes
// the meeting points themselves by solving the two winding congruences, one
// component pair at a time, so a link meets with every strand it owns.
//
// CHOSEN here: one number only. The second curve is parted from the first by
// a fixed golden separation in the tube angle, because two windings drawn
// from the same gate would share their starting point and a tangency is not
// a crossing. Any irrational separation gives the same count in a different
// dress; the golden one is the house's.
//
// The module is pure: no clock, no state, no draw. Same numbers in, same
// meetings out, forever.

const TAU = 2 * Math.PI;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// the determinant of the two laws, taken on the full (unreduced) windings:
// a link's class is its whole family, so its meetings count every strand
export const meetingDet = (pA, qA, pB, qB) => pA * qB - qA * pB;

// the golden separation: an irrational parting so no meeting is a tangency
export const MEETING_SEP = TAU / ((1 + Math.sqrt(5)) / 2) / 2;

// the meeting points of the two windings on the shared torus, as angles
// (th around the longitude, ph around the tube). Exactly |meetingDet| points
// come back, spread over every pair of components; parallel laws (det zero)
// come back empty, since parallels never meet.
export function meetingPoints(pA, qA, pB, qB, sep = MEETING_SEP) {
  const gA = qA === 0 ? 1 : Math.abs(gcd(pA, Math.abs(qA)));
  const gB = qB === 0 ? 1 : Math.abs(gcd(pB, Math.abs(qB)));
  const pfA = pA / gA, qfA = qA / gA, pfB = pB / gB, qfB = qB / gB;
  const detF = pfA * qfB - qfA * pfB;
  if (!detF) return [];
  const pts = [];
  const R = Math.abs(pfA) + Math.abs(qfA) + Math.abs(pfB) + Math.abs(qfB) + 2;
  for (let i = 0; i < gA; i++) {
    for (let j = 0; j < gB; j++) {
      // solve  pfA·t = pfB·s (mod 2pi)  and  qfA·t + offA = qfB·s + offB + sep (mod 2pi)
      const del = TAU * j / gB - TAU * i / gA + sep;
      for (let m = -R; m <= R; m++) {
        for (let n = -R; n <= R; n++) {
          const t = (qfB * TAU * m - pfB * (TAU * n - del)) / detF;
          const s = (qfA * TAU * m - pfA * (TAU * n - del)) / detF;
          if (t < -1e-9 || t >= TAU - 1e-9 || s < -1e-9 || s >= TAU - 1e-9) continue;
          pts.push({ th: pfA * t, ph: qfA * t + TAU * i / gA });
        }
      }
    }
  }
  return pts;
}
