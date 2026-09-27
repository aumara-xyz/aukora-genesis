// Auma Live's presentation-only echo of Aura's canonical tesseract.
//
// This module owns geometry and motion only. It does not read Aura coherence
// coefficients or claim that the live voice surface is a system-state record.

const TAU = Math.PI * 2;
const ROTATION_PERIOD_MS = 72_000;
// The fold. Rotating in a plane that involves the fourth axis carries the
// inner cube out through the outer one and back, which reads as the figure
// turning inside out rather than merely spinning. ZW drives that cycle while
// XW and YW sway across it at different rates, so no two folds in a cycle
// present the same face. All three divide ROTATION_PERIOD_MS, which keeps the
// whole presentation exactly periodic at its one declared period.
const FOLD_PERIOD_MS = ROTATION_PERIOD_MS / 3;
const FOLD_SWAY_XW_MS = ROTATION_PERIOD_MS / 4;
const FOLD_SWAY_YW_MS = ROTATION_PERIOD_MS / 5;
const REST_SCALE_LIMIT = 0.008;
const PLANES = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([0, 2]),
  Object.freeze([1, 2]),
  Object.freeze([0, 3]),
  Object.freeze([1, 3]),
  Object.freeze([2, 3]),
]);
const FIGURE_ORIENTATION = Object.freeze([0.38, -0.32, 0.2, 0, 0, 0]);

/** Canonical bit-order vertices in `{−1,+1}^4`. */
export const AURA_TRACE_VERTICES = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze([
  (index & 1) === 0 ? -1 : 1,
  (index & 2) === 0 ? -1 : 1,
  (index & 4) === 0 ? -1 : 1,
  (index & 8) === 0 ? -1 : 1,
])));

/** Thirty-two canonical tesseract edges. */
export const AURA_TRACE_EDGES = Object.freeze((() => {
  const edges = [];
  for (let vertex = 0; vertex < 16; vertex++) {
    for (let axis = 0; axis < 4; axis++) {
      const neighbor = vertex ^ (1 << axis);
      if (neighbor > vertex) edges.push(Object.freeze([vertex, neighbor]));
    }
  }
  return edges;
})());

/** Twenty-four square faces carrying their canonical six-plane index. */
export const AURA_TRACE_FACES = Object.freeze((() => {
  const axes = [0, 1, 2, 3];
  const faces = [];
  for (const [planeIndex, [leftAxis, rightAxis]] of PLANES.entries()) {
    const fixedAxes = axes.filter((axis) => axis !== leftAxis && axis !== rightAxis);
    for (let fixedPattern = 0; fixedPattern < 4; fixedPattern++) {
      let base = 0;
      for (const [offset, axis] of fixedAxes.entries()) {
        if ((fixedPattern & (1 << offset)) !== 0) base |= 1 << axis;
      }
      const left = 1 << leftAxis;
      const right = 1 << rightAxis;
      faces.push(Object.freeze({
        planeIndex,
        vertices: Object.freeze([base, base ^ left, base ^ left ^ right, base ^ right]),
      }));
    }
  }
  return faces;
})());

function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finite(value)));
}

function rotate4(point, angles) {
  const rotated = [finite(point[0]), finite(point[1]), finite(point[2]), finite(point[3])];
  for (const [planeIndex, [leftAxis, rightAxis]] of PLANES.entries()) {
    const angle = finite(angles[planeIndex]);
    if (angle === 0) continue;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const left = rotated[leftAxis];
    const right = rotated[rightAxis];
    rotated[leftAxis] = left * cosine - right * sine;
    rotated[rightAxis] = left * sine + right * cosine;
  }
  return rotated;
}

function project4(point, distance = 4.2) {
  const denominator = Math.max(0.25, distance - finite(point[3]));
  const scale = distance / denominator;
  return [finite(point[0]) * scale, finite(point[1]) * scale, finite(point[2]) * scale];
}

/**
 * Resolve the trace's data-independent viewing motion.
 * @param {number} elapsedMs active visible presentation time.
 * @param {boolean} reducedMotion whether continuous presentation motion is disabled.
 * @returns {{ orientation: readonly number[], scale: number }} viewing orientation and idle scale.
 */
export function auraTracePresentation(elapsedMs, reducedMotion = false) {
  if (reducedMotion) return { orientation: FIGURE_ORIENTATION, scale: 1 };
  const time = Math.max(0, finite(elapsedMs));
  const phase = TAU * (time % ROTATION_PERIOD_MS) / ROTATION_PERIOD_MS;
  return {
    orientation: [
      FIGURE_ORIENTATION[0] + 0.09 * Math.sin(phase),
      FIGURE_ORIENTATION[1] + 0.12 * Math.sin(phase * 2 + 0.8),
      FIGURE_ORIENTATION[2] + phase,
      FIGURE_ORIENTATION[3] + 0.22 * Math.sin(TAU * time / FOLD_SWAY_XW_MS),
      FIGURE_ORIENTATION[4] + 0.18 * Math.sin(TAU * time / FOLD_SWAY_YW_MS + 1.1),
      FIGURE_ORIENTATION[5] + TAU * (time % FOLD_PERIOD_MS) / FOLD_PERIOD_MS,
    ],
    scale: 1
      + 0.006 * Math.sin(TAU * time / 6_800)
      + 0.002 * Math.sin(TAU * time / 4_100),
  };
}

/**
 * Project one canonical tesseract frame into the trace's normalized display plane.
 * @param {number} elapsedMs active visible presentation time.
 * @param {boolean} reducedMotion whether continuous presentation motion is disabled.
 * @param {number} transientScale real voice-envelope scale added by the caller.
 * @returns {Array<readonly [number, number, number]>} normalized screen points plus depth.
 */
export function auraTraceFrame(elapsedMs, reducedMotion = false, transientScale = 0) {
  const presentation = auraTracePresentation(elapsedMs, reducedMotion);
  const scale = presentation.scale + (reducedMotion ? 0 : clamp(transientScale, 0, 0.046));
  const yaw = -0.48;
  const pitch = 0.34;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return AURA_TRACE_VERTICES.map((vertex) => {
    const point = project4(rotate4(vertex, presentation.orientation));
    const yawX = point[0] * cy - point[2] * sy;
    const yawZ = point[0] * sy + point[2] * cy;
    const pitchY = point[1] * cp - yawZ * sp;
    const pitchZ = point[1] * sp + yawZ * cp;
    const perspective = 1 / Math.max(0.72, 1.18 - pitchZ * 0.055);
    return Object.freeze([yawX * perspective * scale, pitchY * perspective * scale, pitchZ]);
  });
}

/**
 * Create the canvas renderer embedded in Auma Live's existing animation loop.
 * @returns {{ element: HTMLCanvasElement, resize: () => void, draw: (elapsedMs: number, state: { color: ArrayLike<number>, mic: number, say: number, think: number }) => void, destroy: () => void }} trace renderer.
 */
export function createAuraTrace() {
  const element = document.createElement('canvas');
  element.className = 'alv-aura-trace';
  element.setAttribute('aria-hidden', 'true');
  const context = element.getContext('2d');
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let reducedMotion = media?.matches ?? false;
  let width = 1;
  let height = 1;
  let dpr = 1;

  const onMotionChange = (event) => { reducedMotion = event.matches; };
  media?.addEventListener?.('change', onMotionChange);

  function resize() {
    const bounds = element.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (element.width !== pixelWidth || element.height !== pixelHeight) {
      element.width = pixelWidth;
      element.height = pixelHeight;
    }
  }

  function draw(elapsedMs, state) {
    if (!context) return;
    const mic = clamp(state.mic, 0, 1);
    const say = clamp(state.say, 0, 1);
    const think = clamp(state.think, 0, 1);
    const activity = Math.max(mic, say, think);
    const pulse = activity * (0.036 + 0.01 * Math.sin(TAU * Math.max(0, finite(elapsedMs)) / 1_240));
    const frame = auraTraceFrame(elapsedMs, reducedMotion, pulse);
    const unit = Math.min(width, height) * 0.105;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const red = Math.round(clamp(state.color[0], 0, 255));
    const green = Math.round(clamp(state.color[1], 0, 255));
    const blue = Math.round(clamp(state.color[2], 0, 255));
    const faceAlpha = 0.014 + activity * 0.026;
    const edgeAlpha = 0.065 + activity * 0.085;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';

    const faces = AURA_TRACE_FACES.map((face) => ({
      ...face,
      depth: face.vertices.reduce((sum, vertex) => sum + (frame[vertex]?.[2] ?? 0), 0) / 4,
    })).sort((left, right) => left.depth - right.depth);
    for (const face of faces) {
      const first = frame[face.vertices[0]];
      if (!first) continue;
      context.beginPath();
      context.moveTo(centerX + first[0] * unit, centerY + first[1] * unit);
      for (let index = 1; index < face.vertices.length; index++) {
        const point = frame[face.vertices[index]];
        if (point) context.lineTo(centerX + point[0] * unit, centerY + point[1] * unit);
      }
      context.closePath();
      const depthLight = clamp((face.depth + 2.4) / 4.8, 0.35, 1);
      context.fillStyle = `rgba(${red},${green},${blue},${(faceAlpha * depthLight).toFixed(4)})`;
      context.fill();
    }

    context.lineWidth = 0.72 + activity * 0.28;
    context.strokeStyle = `rgba(${red},${green},${blue},${edgeAlpha.toFixed(4)})`;
    for (const [from, to] of AURA_TRACE_EDGES) {
      const left = frame[from];
      const right = frame[to];
      if (!left || !right) continue;
      context.beginPath();
      context.moveTo(centerX + left[0] * unit, centerY + left[1] * unit);
      context.lineTo(centerX + right[0] * unit, centerY + right[1] * unit);
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
  }

  function destroy() {
    media?.removeEventListener?.('change', onMotionChange);
    context?.clearRect(0, 0, element.width, element.height);
  }

  return { element, resize, draw, destroy };
}

/** Rotation period shared with Aura's primary spatial presentation. */
export const AURA_TRACE_ROTATION_PERIOD_MS = ROTATION_PERIOD_MS;

/** Maximum idle scale displacement shared with Aura's rest carrier. */
export const AURA_TRACE_REST_SCALE_LIMIT = REST_SCALE_LIMIT;
