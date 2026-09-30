/** Single data boundary. Synthetic people only; vouches do not imply invitation parentage. */
export async function getGraph({ signal } = {}) {
  signal?.throwIfAborted()
  let seed = 180250
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const nodes = [{ id: 'human-0', name: 'YOU', parent: null, depth: 0, cluster: -1, position: [0, 0, 0] }]
  const branches = [], vouches = [], groups = [], pairs = new Set(), degree = Array(250).fill(0)
  const addEdge = (a, b, list) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`
    if (a === b || degree[a] >= 8 || degree[b] >= 8 || pairs.has(key)) return false
    pairs.add(key); degree[a]++; degree[b]++
    list.push({ source: `human-${a}`, target: `human-${b}` })
    return true
  }
  for (let c = 0; c < 8; c++) {
    const group = []
    for (let j = 0; j < (c === 0 ? 32 : 31); j++) {
      const i = nodes.length, parent = j === 0 ? 0 : group[Math.floor((j - 1) / 2)]
      group.push(i)
      nodes.push({ id: `human-${i}`, name: `Demo person ${i}`, parent: `human-${parent}`,
        depth: nodes[parent].depth + 1, cluster: c,
        position: [(random() - 0.5) * 45, (random() - 0.5) * 45, (random() - 0.5) * 45] })
      addEdge(parent, i, branches)
    }
    groups.push(group)
  }
  // Close friend circles plus local shortcuts; invitation and vouch pairs are unique.
  for (const group of groups) for (let j = 0; j < group.length; j++) {
    addEdge(group[j], group[(j + 1) % group.length], vouches)
    addEdge(group[j], group[(j + 5) % group.length], vouches)
  }
  // Long-range friendships make this a small world, not eight disconnected spokes.
  for (let round = 0; round < 3; round++) for (let a = 1; a < 250; a++) {
    if (degree[a] >= 7) continue
    const candidates = nodes.map((_, i) => i).filter(b => b > 0 && degree[b] < 8
      && nodes[b].cluster !== nodes[a].cluster && !pairs.has(`${Math.min(a, b)}:${Math.max(a, b)}`))
    if (candidates.length) addEdge(a, candidates[Math.floor(random() * candidates.length)], vouches)
  }
  // The ring already guarantees degree >= 3; fill any low-degree endpoints deterministically.
  for (let a = 1; a < 250; a++) for (let b = 1; degree[a] < 3 && b < 250; b++) addEdge(a, b, vouches)

  // Bounded 3D spring simulation: pair repulsion, short local springs, longer weak
  // inter-cluster springs and a weak centre force. YOU is pinned on every step.
  const edges = [...branches, ...vouches].map(e => [+e.source.slice(6), +e.target.slice(6)])
  const velocities = nodes.map(() => [0, 0, 0]), forces = nodes.map(() => [0, 0, 0])
  for (let step = 0; step < 320; step++) {
    signal?.throwIfAborted()
    for (let i = 0; i < 250; i++) for (let k = 0; k < 3; k++) forces[i][k] = -nodes[i].position[k] * 0.008
    for (let a = 0; a < 250; a++) for (let b = a + 1; b < 250; b++) {
      const p = nodes[a].position, q = nodes[b].position
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2]
      const d2 = dx * dx + dy * dy + dz * dz + 0.8, f = 15 / (d2 * Math.sqrt(d2))
      forces[a][0] += dx * f; forces[b][0] -= dx * f
      forces[a][1] += dy * f; forces[b][1] -= dy * f
      forces[a][2] += dz * f; forces[b][2] -= dz * f
    }
    for (const [a, b] of edges) {
      const p = nodes[a].position, q = nodes[b].position
      const d = Math.hypot(...p.map((v, k) => v - q[k])) || 0.01
      const local = nodes[a].cluster === nodes[b].cluster
      const f = (d - (local ? 4 : a === 0 ? 14 : 24)) / d * (local ? 0.09 : 0.009)
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
  return { root: nodes[0].id, nodes, branches, vouches }
}
