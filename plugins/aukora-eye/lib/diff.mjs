/**
 * THE DIFF: what changed between two photographs of the same window.
 *
 * WHY THIS IS THE POINT OF THE EYE. A picture of the app answers "what is on screen"; two pictures
 * answer "what did my change do", which is the question a UI edit actually has. The capture is the
 * evidence; this is the measurement.
 *
 * WHAT IT IS NOT. It is not a judgement about whether the change was right, and it is not a diff of
 * the code. It compares pixels, so a change that renders identically reports identically — which is
 * exactly the finding a person needs when a CSS edit "should" have moved something.
 *
 * COORDINATES ARE THE IMAGE'S OWN. Callers get bounding boxes in the pixels of the images they
 * handed over, and the scale note from the door says whether those are the window's pixels or a
 * downscaled copy's.
 */

/** Pixels differing by less than this many levels on every channel are treated as equal. */
export const DEFAULT_TOLERANCE = 8

/** Side of one comparison cell, in pixels. Regions are reported on this grid. */
export const CELL_SIZE = 16

/** Most regions reported for one diff; the rest are summarized by the changed percentage. */
export const MAX_REGIONS = 12

/** @returns whether two channel values differ by more than the tolerance. */
function differs(a, b, tolerance) {
  return Math.abs(a - b) > tolerance
}

/**
 * Compare two decoded RGBA images and describe what moved.
 *
 * The algorithm is deliberately simple and total: mark a grid cell changed when any pixel in it
 * differs, merge neighbouring changed cells into rectangles, and report the largest few. A
 * finer-grained approach would report thousands of one-pixel regions for a moved glyph, which is
 * less useful to read than "these four areas".
 *
 * @param previous - the earlier image: `{ width, height, rgba }`.
 * @param current - the later image, decoded the same way.
 * @param options - `tolerance` (0-255) and `maxRegions`.
 * @returns the diff: whether the images are comparable at all, the share of changed pixels, and the
 *   changed regions sorted largest-first.
 */
export function diffRgba(previous, current, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const maxRegions = options.maxRegions ?? MAX_REGIONS
  const size = { width: current.width, height: current.height }
  // A RESIZED WINDOW IS NOT A CHANGED WINDOW. Comparing images of different sizes pixel-by-pixel
  // would report the whole frame as changed, which is true and useless. The caller is told instead.
  if (previous.width !== current.width || previous.height !== current.height) {
    return {
      comparable: false,
      reason: 'size-changed',
      size,
      previousSize: { width: previous.width, height: previous.height },
      changedPercent: null,
      changedPixels: null,
      regions: [],
    }
  }

  const columns = Math.ceil(current.width / CELL_SIZE)
  const rows = Math.ceil(current.height / CELL_SIZE)
  const changedCells = new Uint8Array(columns * rows)
  let changedPixels = 0
  for (let y = 0; y < current.height; y += 1) {
    const rowStart = y * current.width * 4
    for (let x = 0; x < current.width; x += 1) {
      const at = rowStart + x * 4
      if (differs(previous.rgba[at], current.rgba[at], tolerance)
        || differs(previous.rgba[at + 1], current.rgba[at + 1], tolerance)
        || differs(previous.rgba[at + 2], current.rgba[at + 2], tolerance)) {
        changedPixels += 1
        changedCells[Math.floor(y / CELL_SIZE) * columns + Math.floor(x / CELL_SIZE)] = 1
      }
    }
  }

  // Flood-fill adjacent changed cells into rectangles. Iterative, because a deep recursion over a
  // full-screen change would be a stack overflow in the one case that matters most.
  const visited = new Uint8Array(changedCells.length)
  const regions = []
  for (let index = 0; index < changedCells.length; index += 1) {
    if (changedCells[index] !== 1 || visited[index] === 1) continue
    let minX = columns
    let minY = rows
    let maxX = -1
    let maxY = -1
    const queue = [index]
    visited[index] = 1
    while (queue.length > 0) {
      const cell = queue.pop()
      const cx = cell % columns
      const cy = Math.floor(cell / columns)
      if (cx < minX) minX = cx
      if (cy < minY) minY = cy
      if (cx > maxX) maxX = cx
      if (cy > maxY) maxY = cy
      const neighbours = [
        cx > 0 ? cell - 1 : -1,
        cx < columns - 1 ? cell + 1 : -1,
        cy > 0 ? cell - columns : -1,
        cy < rows - 1 ? cell + columns : -1,
      ]
      for (const neighbour of neighbours) {
        if (neighbour >= 0 && changedCells[neighbour] === 1 && visited[neighbour] === 0) {
          visited[neighbour] = 1
          queue.push(neighbour)
        }
      }
    }
    // Cell bounds clipped to the image, so a region never claims pixels that do not exist.
    regions.push({
      x: minX * CELL_SIZE,
      y: minY * CELL_SIZE,
      width: Math.min(current.width, (maxX + 1) * CELL_SIZE) - minX * CELL_SIZE,
      height: Math.min(current.height, (maxY + 1) * CELL_SIZE) - minY * CELL_SIZE,
    })
  }
  regions.sort((a, b) => (b.width * b.height) - (a.width * a.height))

  const total = current.width * current.height
  return {
    comparable: true,
    size,
    changedPixels,
    changedPercent: total === 0 ? 0 : Number(((changedPixels / total) * 100).toFixed(3)),
    regions: regions.slice(0, maxRegions),
    regionCount: regions.length,
    cellSize: CELL_SIZE,
    tolerance,
  }
}

/**
 * Format a diff for a model, in one short block of text.
 * @param diff - a result from {@link diffRgba}.
 * @param previousAt - when the earlier capture was taken, ISO-8601.
 * @returns the model-facing summary.
 */
export function formatDiff(diff, previousAt) {
  if (diff.comparable === false) {
    return `Compared with the capture at ${previousAt}: the window changed size `
      + `(${diff.previousSize.width}x${diff.previousSize.height} -> ${diff.size.width}x${diff.size.height}), `
      + 'so the two pictures are not comparable pixel by pixel.'
  }
  if (diff.changedPixels === 0) {
    return `Compared with the capture at ${previousAt}: NO PIXEL CHANGED (tolerance ${diff.tolerance}/255). `
      + 'Whatever was edited did not alter what is on screen.'
  }
  const boxes = diff.regions
    .map(region => `x=${region.x} y=${region.y} ${region.width}x${region.height}`)
    .join('; ')
  const more = diff.regionCount > diff.regions.length
    ? ` (+${diff.regionCount - diff.regions.length} smaller regions not listed)`
    : ''
  return `Compared with the capture at ${previousAt}: ${diff.changedPercent}% of pixels changed, `
    + `${diff.regionCount} region(s) on a ${diff.cellSize}px grid — ${boxes}${more}.`
}
