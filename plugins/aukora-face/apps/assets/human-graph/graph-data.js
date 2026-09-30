/** Single data boundary. Synthetic people only; vouches do not imply invitation parentage. */
export async function getGraph({ signal } = {}) {
  signal?.throwIfAborted()
  let seed = 180250
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const ball = () => {
    const z = random() * 2 - 1, angle = random() * Math.PI * 2, radius = Math.cbrt(random())
    const ring = Math.sqrt(1 - z * z) * radius
    return [Math.cos(angle) * ring, z * radius, Math.sin(angle) * ring]
  }
  // Uneven ellipsoid centres and spherical seeds avoid the eight corners of a box.
  const centres = Array.from({ length: 8 }, (_, c) => {
    const y = 1 - 2 * (c + 0.5) / 8, angle = c * Math.PI * (3 - Math.sqrt(5)) + random() * 0.3
    const ring = Math.sqrt(1 - y * y), radius = 15 + random() * 4
    return [Math.cos(angle) * ring * radius * 1.2, y * radius * 0.82, Math.sin(angle) * ring * radius]
  })
  const nodes = [{ id: 'human-0', name: 'YOU', parent: null, depth: 0, cluster: -1, position: [0, 0, 0] }]
  const branches = [], vouches = [], groups = [], cells = [], pairs = new Map(), degree = Array(250).fill(0)
  const addEdge = (a, b, list, cell = null) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`
    if (a === b) return false
    const existing = pairs.get(key)
    // A pair can be both an invitation and a mutual vouch; draw it once.
    if (existing) {
      if (cell !== null) Object.assign(existing, { mutual: true, cell, relation: 'mutual' })
      return false
    }
    if (cell === null && list === vouches && (degree[a] >= 12 || degree[b] >= 12)) return false
    const edge = { source: `human-${a}`, target: `human-${b}`, mutual: cell !== null, cell,
      relation: a === 0 || b === 0 ? 'direct' : cell !== null ? 'mutual' : 'second-degree' }
    pairs.set(key, edge); degree[a]++; degree[b]++
    list.push(edge)
    return true
  }
  for (let c = 0; c < 8; c++) {
    const group = []
    for (let j = 0; j < [24, 40, 29, 35, 22, 38, 27, 34][c]; j++) {
      const i = nodes.length, parent = j === 0 ? 0 : group[Math.floor((j - 1) / 2)]
      group.push(i)
      const offset = ball()
      nodes.push({ id: `human-${i}`, name: `Demo person ${i}`, parent: `human-${parent}`,
        depth: nodes[parent].depth + 1, cluster: c,
        position: offset.map((value, axis) => centres[c][axis] + value * 6) })
      addEdge(parent, i, branches)
    }
    groups.push(group)
  }
  // Explicit complete mutual groups, not a label inferred from cluster colour.
  // Every pair in a cell vouches for each other, including invitation pairs.
  for (const [cluster, group] of groups.entries()) {
    let offset = 0
    while (offset < group.length) {
      const remaining = group.length - offset
      let size = Math.min(3 + (cells.length * 3 + cluster) % 6, remaining)
      if (remaining - size > 0 && remaining - size < 3) size = remaining
      const members = group.slice(offset, offset + size), id = cells.length
      const direction = ball(), centre = direction.map((value, axis) => centres[cluster][axis] + value * 7)
      cells.push({ id, cluster, members: members.map(i => nodes[i].id), centre })
      for (const i of members) {
        nodes[i].cell = id
        nodes[i].position = ball().map((value, axis) => centre[axis] + value * 2.5)
      }
      for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) {
        addEdge(members[a], members[b], vouches, id)
      }
      offset += size
    }
  }
  // Loose local circles and shortcuts connect the cells; they remain dotted.
  for (const group of groups) for (let j = 0; j < group.length; j++) {
    addEdge(group[j], group[(j + 1) % group.length], vouches)
    addEdge(group[j], group[(j + 5) % group.length], vouches)
  }
  // Long-range friendships make this a small world, not eight disconnected spokes.
  for (let round = 0; round < 3; round++) for (let a = 1; a < 250; a++) {
    if (degree[a] >= 11) continue
    const candidates = nodes.map((_, i) => i).filter(b => b > 0 && degree[b] < 12
      && nodes[b].cluster !== nodes[a].cluster && !pairs.has(`${Math.min(a, b)}:${Math.max(a, b)}`))
    if (candidates.length) addEdge(a, candidates[Math.floor(random() * candidates.length)], vouches)
  }
  // Tight mutual cells inside an organic ellipsoid, joined by weak long springs.
  // YOU is pinned on every step.
  const edges = [...branches, ...vouches].map(e => [+e.source.slice(6), +e.target.slice(6), e.mutual])
  const velocities = nodes.map(() => [0, 0, 0]), forces = nodes.map(() => [0, 0, 0])
  for (let step = 0; step < 320; step++) {
    signal?.throwIfAborted()
    for (let i = 0; i < 250; i++) for (let k = 0; k < 3; k++) {
      const centre = i === 0 ? 0 : cells[nodes[i].cell].centre[k]
      forces[i][k] = (centre - nodes[i].position[k]) * 0.06
    }
    for (let a = 0; a < 250; a++) for (let b = a + 1; b < 250; b++) {
      const p = nodes[a].position, q = nodes[b].position
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2]
      const d2 = dx * dx + dy * dy + dz * dz + 0.8, f = 15 / (d2 * Math.sqrt(d2))
      forces[a][0] += dx * f; forces[b][0] -= dx * f
      forces[a][1] += dy * f; forces[b][1] -= dy * f
      forces[a][2] += dz * f; forces[b][2] -= dz * f
    }
    for (const [a, b, mutual] of edges) {
      const p = nodes[a].position, q = nodes[b].position
      const d = Math.hypot(...p.map((v, k) => v - q[k])) || 0.01
      const local = nodes[a].cluster === nodes[b].cluster
      const f = (d - (mutual ? 2.5 : local ? 9 : a === 0 ? 18 : 28)) / d * (mutual ? 0.15 : 0.006)
      for (let k = 0; k < 3; k++) { const pull = (q[k] - p[k]) * f; forces[a][k] += pull; forces[b][k] -= pull }
    }
    const cooling = 1 - step / 360
    for (let i = 1; i < 250; i++) for (let k = 0; k < 3; k++) {
      velocities[i][k] = (velocities[i][k] + forces[i][k] * 0.65) * 0.72
      nodes[i].position[k] += Math.max(-1, Math.min(1, velocities[i][k])) * cooling
    }
    if (step % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0))
  }
  signal?.throwIfAborted()
  return { root: nodes[0].id, nodes, branches, vouches,
    cells: cells.map(({ id, cluster, members }) => ({ id, cluster, members })) }
}
