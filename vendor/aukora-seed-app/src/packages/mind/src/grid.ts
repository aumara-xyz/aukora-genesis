// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Grid reference domain — make one frame legible enough to reason over, and
 * verify plan expectations against real frames. Observation, not interpretation.
 *
 * ONE RIGID-MOVE LAW. The donor carried an asymmetry: diff rendering labeled a
 * block as MOVED at >=4 cells with integer displacement, while plan-expectation
 * checking verified a move at >=2 cells with >0.5 centroid shift. This module
 * unifies both sides on a single law — a color is a rigid move when its gained
 * cell count is >=2 and equals its lost cell count, the centroid displacement
 * exceeds 0.5 on some axis, and the direction is the dominant axis. Both
 * `renderDiff` (mover labeling) and `checkPlanExpectation` call the same
 * `detectRigidMoves`.
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */
import type { Grid, Obs, Region, Segmentation } from './ports.js';
import type { MoveDirection } from './plan.js';

export const COLOR_NAME: Readonly<Record<number, string>> = {
  0: 'white', 1: 'silver', 2: 'grey', 3: 'dkgrey', 4: 'charcoal', 5: 'black',
  6: 'magenta', 7: 'pink', 8: 'red', 9: 'blue', 10: 'cyan', 11: 'yellow',
  12: 'orange', 13: 'maroon', 14: 'green', 15: 'purple',
};
const HEX = '0123456789abcdef';

// ---------------------------------------------------------------------------
// Segmentation — connected color regions (4-neighbour). Background = the most
// common color. Regions come back sorted large→small.
// ---------------------------------------------------------------------------
export function segment(grid: Grid, maxRegions = 96): Segmentation {
  const H = grid.length;
  const W = H > 0 ? grid[0].length : 0;
  if (H === 0 || W === 0) return { background: 0, regions: [] };
  const counts = new Array<number>(16).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) counts[grid[y][x]]++;
  let background = 0;
  for (let c = 1; c < 16; c++) if (counts[c] > counts[background]) background = c;

  const seen = new Uint8Array(W * H);
  const regions: Region[] = [];
  const qx = new Int16Array(W * H);
  const qy = new Int16Array(W * H);
  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const c = grid[sy][sx];
      if (c === background || seen[sy * W + sx]) continue;
      // BFS flood
      let head = 0;
      let tail = 0;
      qx[tail] = sx; qy[tail] = sy; tail++;
      seen[sy * W + sx] = 1;
      let size = 0, sumX = 0, sumY = 0;
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      while (head < tail) {
        const x = qx[head], y = qy[head]; head++;
        size++; sumX += x; sumY += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && !seen[y * W + x - 1] && grid[y][x - 1] === c) { seen[y * W + x - 1] = 1; qx[tail] = x - 1; qy[tail] = y; tail++; }
        if (x < W - 1 && !seen[y * W + x + 1] && grid[y][x + 1] === c) { seen[y * W + x + 1] = 1; qx[tail] = x + 1; qy[tail] = y; tail++; }
        if (y > 0 && !seen[(y - 1) * W + x] && grid[y - 1][x] === c) { seen[(y - 1) * W + x] = 1; qx[tail] = x; qy[tail] = y - 1; tail++; }
        if (y < H - 1 && !seen[(y + 1) * W + x] && grid[y + 1][x] === c) { seen[(y + 1) * W + x] = 1; qx[tail] = x; qy[tail] = y + 1; tail++; }
      }
      regions.push({
        color: c, size,
        box: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        cx: sumX / size, cy: sumY / size,
      });
    }
  }
  const sorted = [...regions].sort((a, b) => b.size - a.size);
  return { background, regions: sorted.slice(0, maxRegions) };
}

// ---------------------------------------------------------------------------
// The unified rigid-move law.
// ---------------------------------------------------------------------------
/** A rigid move needs at least this many cells of one color to relocate together. */
export const RIGID_MOVE_MIN_CELLS = 2;
/** ...and a centroid displacement strictly greater than this on some axis. */
export const RIGID_MOVE_MIN_SHIFT = 0.5;

export interface ChangedCell {
  readonly x: number;
  readonly y: number;
  readonly from: number;
  readonly to: number;
}

export interface RigidMove {
  readonly color: number;
  /** Centroid displacement (fractional cells). */
  readonly dx: number;
  readonly dy: number;
  /** Dominant-axis direction (ties go to the horizontal axis). */
  readonly dir: MoveDirection;
}

export interface GridDelta {
  readonly changed: readonly ChangedCell[];
  readonly moves: readonly RigidMove[];
}

/**
 * THE one mover law, used by BOTH renderDiff and checkPlanExpectation:
 * per color, gained cells >= RIGID_MOVE_MIN_CELLS and gained === lost, centroid
 * displacement > RIGID_MOVE_MIN_SHIFT on some axis, direction by dominant axis.
 */
export function detectRigidMoves(prevGrid: Grid, nextGrid: Grid): GridDelta {
  const changed: ChangedCell[] = [];
  const gained = new Map<number, Array<{ x: number; y: number }>>();
  const lost = new Map<number, Array<{ x: number; y: number }>>();
  for (let y = 0; y < nextGrid.length; y++) {
    for (let x = 0; x < nextGrid[0].length; x++) {
      const from = prevGrid[y][x];
      const to = nextGrid[y][x];
      if (from === to) continue;
      changed.push({ x, y, from, to });
      let l = lost.get(from);
      if (!l) { l = []; lost.set(from, l); }
      l.push({ x, y });
      let g = gained.get(to);
      if (!g) { g = []; gained.set(to, g); }
      g.push({ x, y });
    }
  }
  const moves: RigidMove[] = [];
  for (const [color, g] of gained) {
    const l = lost.get(color) ?? [];
    if (g.length < RIGID_MOVE_MIN_CELLS || g.length !== l.length) continue;
    const cg = g.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    const cl = l.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    const dx = (cg.x - cl.x) / g.length;
    const dy = (cg.y - cl.y) / g.length;
    if (Math.abs(dx) > RIGID_MOVE_MIN_SHIFT || Math.abs(dy) > RIGID_MOVE_MIN_SHIFT) {
      const dir: MoveDirection = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      moves.push({ color, dx, dy, dir });
    }
  }
  return { changed, moves };
}

// ---------------------------------------------------------------------------
// Rendering — the same rendering the hand-driven session harnesses used.
// ---------------------------------------------------------------------------

function boundingBox(grid: Grid, bg: number) {
  let x0 = 64, y0 = 64, x1 = -1, y1 = -1;
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) {
    if (grid[y][x] !== bg) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: grid[0].length - 1, y1: grid.length - 1 };
  return { x0: Math.max(0, x0 - 2), y0: Math.max(0, y0 - 2), x1: Math.min(grid[0].length - 1, x1 + 2), y1: Math.min(grid.length - 1, y1 + 2) };
}

export function renderGrid(grid: Grid, bg: number): string {
  const bb = boundingBox(grid, bg);
  const lines: string[] = [];
  let tens = '     ';
  let units = '     ';
  for (let x = bb.x0; x <= bb.x1; x++) { tens += (x % 10 === 0 ? String(Math.floor(x / 10)) : ' '); units += String(x % 10); }
  lines.push(tens);
  lines.push(units);
  for (let y = bb.y0; y <= bb.y1; y++) {
    let row = String(y).padStart(3, ' ') + '  ';
    for (let x = bb.x0; x <= bb.x1; x++) { const c = grid[y][x]; row += (c === bg ? '.' : HEX[c]); }
    lines.push(row);
  }
  lines.push(`  (crop cols ${bb.x0}..${bb.x1} x rows ${bb.y0}..${bb.y1}; '.' = background color ${bg} ${COLOR_NAME[bg]})`);
  return lines.join('\n');
}

export function renderSegments(seg: Segmentation): string {
  const rows = seg.regions.filter((r) => r.color !== seg.background).slice(0, 14);
  const lines = ['regions (non-background), largest first:'];
  for (const r of rows) {
    lines.push(`  color ${String(r.color).padStart(2)} ${(COLOR_NAME[r.color] || '?').padEnd(8)} size ${String(r.size).padStart(5)}  box (${r.box.x0},${r.box.y0})-(${r.box.x1},${r.box.y1})  center (${r.cx.toFixed(0)},${r.cy.toFixed(0)})`);
  }
  return lines.join('\n');
}

export interface DiffRender {
  readonly text: string;
  /** -1 = first frame (no prior); 0 = true no-op. */
  readonly changedCount: number;
}

/**
 * Diff between two grids. Returns { text, changedCount } so callers can detect
 * a true no-op (changedCount === 0) without re-diffing. Mover labeling uses the
 * unified rigid-move law (`detectRigidMoves`) — the SAME law plan verification uses.
 */
export function renderDiff(prev: Grid | null | undefined, grid: Grid): DiffRender {
  if (!prev) return { text: '(first frame — no prior to diff)', changedCount: -1 };
  const { changed, moves } = detectRigidMoves(prev, grid);
  if (!changed.length) return { text: 'DIFF: nothing changed (NO-OP).', changedCount: 0 };
  const lines = [`DIFF: ${changed.length} cell(s) changed.`];
  for (const m of moves) {
    lines.push(`  -> color ${m.color} ${COLOR_NAME[m.color]} block MOVED (dx ${Math.round(m.dx)}, dy ${Math.round(m.dy)}) [${m.dir}]`);
  }
  lines.push(`  cells: ${changed.slice(0, 24).map((c) => `(${c.x},${c.y})${c.from}->${c.to}`).join(' ')}${changed.length > 24 ? ' ...' : ''}`);
  return { text: lines.join('\n'), changedCount: changed.length };
}

export interface FrameRender {
  readonly text: string;
  readonly changedCount: number;
}

/** Full frame text for one turn. `prevGrid` may be null on the first frame. */
export function renderFrame(obs: Obs, prevGrid: Grid | null | undefined): FrameRender {
  const seg = obs.segments ?? segment(obs.grid);
  const d = renderDiff(prevGrid, obs.grid);
  const out: string[] = [];
  out.push(`state ${obs.state} · levels completed ${obs.levelsCompleted}/${obs.winLevels}`);
  out.push(`actions available this turn: ${obs.availableActions.join(', ')}`);
  out.push('');
  out.push(d.text);
  out.push('');
  out.push(renderSegments(seg));
  out.push('');
  out.push(renderGrid(obs.grid, seg.background));
  return { text: out.join('\n'), changedCount: d.changedCount };
}

// ---------------------------------------------------------------------------
// Plan-step verification — the cheap harness-side reality check that makes
// mind-authored plans safe to run without a model call per move.
// ---------------------------------------------------------------------------

export interface ExpectationCheck {
  readonly ok: boolean;
  readonly note: string;
}

/**
 * Verify one plan expectation against the previous and next grids. Pure.
 * Grammar (see plan.ts): 'any' | 'changed' | 'moved' | 'moved:<color>:<dir>'.
 * Unknown expectations fail safe. Movement verification uses the SAME unified
 * rigid-move law as renderDiff's mover labeling.
 */
export function checkPlanExpectation(expect: string, prevGrid: Grid | null | undefined, nextGrid: Grid | null | undefined): ExpectationCheck {
  if (expect === 'any') return { ok: true, note: 'any' };
  if (!prevGrid || !nextGrid) return { ok: false, note: 'no grids to compare' };
  const { changed, moves } = detectRigidMoves(prevGrid, nextGrid);
  const changedCount = changed.length;
  if (expect === 'changed') return changedCount > 0 ? { ok: true, note: `${changedCount} cells` } : { ok: false, note: 'no-op' };
  if (expect === 'moved') {
    return moves.length
      ? { ok: true, note: `moved ${moves.map((m) => m.color + ':' + m.dir).join(',')}` }
      : { ok: false, note: changedCount ? 'changed but no rigid move' : 'no-op' };
  }
  const m = expect.match(/^moved:(\d+):(up|down|left|right)$/);
  if (m) {
    const hit = moves.find((v) => v.color === Number(m[1]) && v.dir === m[2]);
    return hit
      ? { ok: true, note: 'matched' }
      : { ok: false, note: `wanted ${expect}, saw ${moves.map((v) => v.color + ':' + v.dir).join(',') || (changedCount ? 'non-move change' : 'no-op')}` };
  }
  return { ok: false, note: `unknown expectation "${expect}"` };
}
