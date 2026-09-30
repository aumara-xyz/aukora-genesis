import { setImmediate } from 'node:timers/promises'

/** Unit-vector PCA, with canonical input order, axis seed and sign. No ID jitter or invented coordinates.
 * Distances are a two-dimensional approximation to embedding similarity, not an exact metric.
 * O(notes × dimensions × iterations), yields between iterations and honours the request deadline. */
export async function semanticLayout(input: readonly { id: string; vector: readonly number[] | Float32Array }[], signal?: AbortSignal): Promise<Map<string, readonly [number, number]>> {
  const rows = [...input].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const n = rows.length, d = rows[0]?.vector.length ?? 0
  if (!n || !d) throw new Error('memory:invalid-vectors')
  const mean = new Float64Array(d)
  const data = rows.map(row => {
    if (row.vector.length !== d || !row.vector.every(Number.isFinite)) throw new Error('memory:invalid-vectors')
    let squaredNorm = 0
    for (const value of row.vector) squaredNorm += value * value
    const norm = Math.sqrt(squaredNorm)
    if (norm < 1e-12) throw new Error('memory:invalid-vectors')
    const unit = Float64Array.from(row.vector, v => v / norm)
    for (let j = 0; j < d; j++) mean[j]! += unit[j]! / n
    return unit
  })
  const variance = new Float64Array(d)
  for (const row of data) for (let j = 0; j < d; j++) {
    row[j]! -= mean[j]!
    variance[j]! += row[j]! ** 2
  }
  const dot = (a: Float64Array, b: Float64Array): number => {
    let value = 0
    for (let j = 0; j < d; j++) value += a[j]! * b[j]!
    return value
  }
  const axes: Float64Array[] = []
  for (let axis = 0; axis < 2; axis++) {
    let seed = 0, best = -1
    for (let j = 0; j < d; j++) {
      const weight = variance[j]! * (1 - (axes[0]?.[j] ?? 0) ** 2)
      if (weight > best) { seed = j; best = weight }
    }
    let direction = new Float64Array(d)
    direction[seed] = 1
    for (let step = 0; step < 40; step++) {
      signal?.throwIfAborted()
      const next = new Float64Array(d)
      for (const row of data) {
        const weight = dot(row, direction)
        for (let j = 0; j < d; j++) next[j]! += row[j]! * weight
      }
      for (const previous of axes) {
        const overlap = dot(next, previous)
        for (let j = 0; j < d; j++) next[j]! -= overlap * previous[j]!
      }
      const norm = Math.sqrt(dot(next, next))
      if (norm < 1e-12) { direction.fill(0); break }
      for (let j = 0; j < d; j++) next[j]! /= norm
      const converged = Math.abs(dot(next, direction)) > 1 - 1e-9
      direction = next
      await setImmediate()
      if (converged) break
    }
    let pivot = 0
    for (let j = 1; j < d; j++) if (Math.abs(direction[j]!) > Math.abs(direction[pivot]!)) pivot = j
    if (direction[pivot]! < 0) for (let j = 0; j < d; j++) direction[j]! *= -1
    axes.push(direction)
  }
  const xy = data.map(row => [dot(row, axes[0]!), dot(row, axes[1]!)] as const)
  const extent = xy.reduce((max, [x, y]) => Math.max(max, Math.abs(x), Math.abs(y)), 1e-9)
  return new Map(rows.map((row, i) => [row.id, [xy[i]![0] / extent, xy[i]![1] / extent] as const]))
}
