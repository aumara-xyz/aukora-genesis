// LUMINARA SKY — the ephemeris, alone in a pure module so it can be pinned.
//
// The bench's own condition, honoured: "if any layer leaves this bench for
// the organ, the arithmetic graduates and gets pinned by test, or it does
// not leave." This module is that graduation. The terms are still linear
// (mean longitudes; no lunar theory), good to a few degrees, and the pins
// in core/tests/luminaraSky.test.ts hold them to exactly that honest
// tolerance against real eclipses, whose moments the linear terms did not
// know. No DOM, no state, no randomness: dates in, angles out.
//
// Longitudes are degrees from the spring crossing. The two pins of the
// phase cycle (THE ASTROLABE OF THE 27, the two forced correspondences)
// are computable here: conjunction is the dark moon, the cycle's own zero;
// opposition is the full, its antipode. Everything else the sky refuses by
// incommensurability, which is the boundary stone's own arithmetic.

export const SYNODIC = 29.530589;    // new moon to new moon
export const SIDEREAL = 27.321661;   // the moon's lap against the stars
export const TROPICAL_YEAR = 365.2422;

const J2000 = Date.UTC(2000, 0, 1, 12);
export const norm360 = (x) => ((x % 360) + 360) % 360;
const daysSinceJ2000 = (date) => (date.getTime() - J2000) / 86400000;

// the three walkers: mean longitudes, the dragon regressing
export function skyOf(date) {
  const dd = daysSinceJ2000(date);
  return {
    sun: norm360(280.460 + 0.9856474 * dd),
    moon: norm360(218.316 + 13.176396 * dd),
    node: norm360(125.04452 - 0.0529538 * dd),
  };
}

// the phase: the moon's angle ahead of the sun. 0 is the dark moon (the
// cycle's zero, the first pin); 180 is the full (the antipode, the second).
export const elongationOf = (sky) => norm360(sky.moon - sky.sun);

// the lit fraction of the face, from the elongation alone
export const litFraction = (elong) => (1 - Math.cos(elong * Math.PI / 180)) / 2;

// how far the sun stands from the nearer crossing: the dragon's windows
// open when this falls inside about fifteen degrees
export function nodeDistance(sky) {
  const raw = norm360(sky.sun - sky.node);
  const toHead = Math.min(raw, 360 - raw);      // angular distance to the head
  return Math.min(toHead, 180 - toHead);        // the tail stands opposite
}

// the equation of time, minutes, standard approximation: the breath, the
// oscillating carry between the clock and the sun, summing to zero each round
export function eotMinutes(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const N = (date.getTime() - start) / 86400000 + 1;
  const B = (2 * Math.PI * (N - 81)) / 365;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

// --- the true clocks: the sky's own thirds (coordinates, never meanings) ---
export const sunThird = (sky) => Math.floor(norm360(sky.sun) / 120) % 3;
export const phaseThird = (sky) => Math.floor(elongationOf(sky) / 120) % 3;
export const watchOf = (date) => Math.floor(date.getHours() / 8) % 3;

// the sky cell: the same seating as the chart (orbit on time, moon on
// depth, spin on state), read from the true clocks instead of the civil
// calendar. A coordinate on the frame, derived and never drawn.
export function skyCellOf(date) {
  const sky = skyOf(date);
  const t = sunThird(sky), d = phaseThird(sky), s = watchOf(date);
  return { time: t, depth: d, state: s, index: t * 9 + d * 3 + s, n: t * 9 + d * 3 + s + 1 };
}

// --- the observances: next events, found by walking and bisecting --------
// A signed function crosses zero; we walk in steps until the sign flips,
// then bisect. Plain arithmetic, no library, nothing fitted.
function nextZero(f, from, stepDays, horizonDays) {
  let t0 = from.getTime(), v0 = f(new Date(t0));
  const stepMs = stepDays * 86400000, endMs = t0 + horizonDays * 86400000;
  for (let t = t0 + stepMs; t <= endMs; t += stepMs) {
    const v = f(new Date(t));
    if (v0 < 0 && v >= 0) {
      let lo = t - stepMs, hi = t;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(new Date(mid)) < 0) lo = mid; else hi = mid;
      }
      return new Date((lo + hi) / 2);
    }
    v0 = v;
  }
  return null;
}
const signedAbout = (angle, target) => ((angle - target + 540) % 360) - 180;

export const nextNewMoon = (from) =>
  nextZero((d) => signedAbout(elongationOf(skyOf(d)), 0), from, 0.25, 35);
export const nextFullMoon = (from) =>
  nextZero((d) => signedAbout(elongationOf(skyOf(d)), 180), from, 0.25, 35);

// the four stations: the sun crossing 0, 90, 180, 270
export function nextStation(from) {
  const lon = skyOf(from).sun;
  const target = (Math.floor(lon / 90) + 1) * 90 % 360;
  const when = nextZero((d) => signedAbout(skyOf(d).sun, target), from, 0.5, 100);
  const names = ['the spring crossing', 'the northern standstill', 'the autumn crossing', 'the southern standstill'];
  return when ? { when, name: names[(target / 90) % 4] } : null;
}

// the breath's crossing: the clock agreeing with the sun exactly
export function nextEotZero(from) {
  const a = nextZero((d) => eotMinutes(d), from, 0.25, 140);
  const b = nextZero((d) => -eotMinutes(d), from, 0.25, 140);
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;             // crossings run both ways; take the nearer
}

// the dragon's window: the sun within fifteen degrees of a crossing
export const DRAGON_WINDOW_DEG = 15;
export function dragonWindow(from) {
  const dist = (d) => nodeDistance(skyOf(d)) - DRAGON_WINDOW_DEG;
  const now = dist(from);
  if (now <= 0) {
    return { open: true, closes: nextZero(dist, from, 0.5, 60) };
  }
  const opens = nextZero((d) => -dist(d), from, 0.5, 200);
  return { open: false, opens };
}

// the debt day: the next 29th of February the ladder grants
export function nextLeapDay(from) {
  for (let y = from.getUTCFullYear(); y < from.getUTCFullYear() + 9; y++) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (!leap) continue;
    const day = new Date(Date.UTC(y, 1, 29));
    if (day > from) return day;
  }
  return null;
}
