/**
 * Reingold–Tilford radial layout.
 * Each node claims angular width = max(sum of children widths, min arc for the ring).
 * Nodes are placed at the centre of their wedge with deterministic jitter for an
 * organic look. BFS builds the spanning tree so cycles in the graph are ignored.
 */
export function radialTreeLayout(graph, rootKey, levelRadius = 90, nodeGap = 22) {
  // ── 1. Spanning tree via BFS (ignore back/cross edges) ────────────────────
  const children = {}
  const depth = {}
  graph.forEachNode((n) => { children[n] = [] })

  const bfsQueue = [rootKey]
  const inTree = new Set([rootKey])
  depth[rootKey] = 0
  const bfsOrder = [rootKey]  // BFS order doubles as reverse-post-order parent list

  while (bfsQueue.length) {
    const n = bfsQueue.shift()
    for (const nb of graph.outNeighbors(n)) {
      if (!inTree.has(nb)) {
        inTree.add(nb)
        children[n].push(nb)
        depth[nb] = depth[n] + 1
        bfsQueue.push(nb)
        bfsOrder.push(nb)
      }
    }
  }

  // ── 2. Bottom-up angular widths (reverse BFS = leaves first) ─────────────
  const angleWidth = {}
  for (const node of [...bfsOrder].reverse()) {
    const minAngle = nodeGap / ((depth[node] + 1) * levelRadius)
    const childSum = children[node].reduce((s, c) => s + (angleWidth[c] ?? 0), 0)
    angleWidth[node] = Math.max(childSum, minAngle)
  }

  // Clamp to 2π: scale every node's width proportionally if root overflows
  const rootTotal = children[rootKey].reduce((s, c) => s + angleWidth[c], 0) || 1
  if (rootTotal > 2 * Math.PI) {
    const scale = (2 * Math.PI) / rootTotal
    for (const n of bfsOrder) angleWidth[n] *= scale
  }

  // ── 3. Top-down placement — each node at the centre of its wedge ─────────
  // Precompute cos/sin/r per node (LUTs) — zoom-spread reuses them with a single multiply
  const cosLUT = {}
  const sinLUT = {}
  const radLUT = {}  // effective radius per node, including jitter

  const pos = { [rootKey]: { x: 0, y: 0 } }
  const rootSpan = children[rootKey].reduce((s, c) => s + angleWidth[c], 0)
  const placeStack = [{ node: rootKey, angleStart: -rootSpan / 2 }]

  while (placeStack.length) {
    const { node, angleStart } = placeStack.pop()
    let a = angleStart
    for (const child of children[node]) {
      const w = angleWidth[child]
      const mid = a + w / 2

      // Deterministic per-node jitter — stays inside wedge, same result on every render
      let h = 0
      for (let i = 0; i < child.length; i++) h = (h * 31 + child.charCodeAt(i)) | 0
      const r = (depth[child] + 1) * levelRadius + ((h & 0xff) / 255 - 0.5) * levelRadius * 0.6
      const angle = mid + (((h >> 8) & 0xff) / 255 - 0.5) * w * 0.4

      cosLUT[child] = Math.cos(angle)
      sinLUT[child] = Math.sin(angle)
      radLUT[child] = r
      pos[child] = { x: cosLUT[child] * r, y: sinLUT[child] * r }
      placeStack.push({ node: child, angleStart: a })
      a += w
    }
  }

  graph.forEachNode((n) => {
    const p = pos[n] ?? { x: 0, y: 0 }
    graph.setNodeAttribute(n, 'x', p.x)
    graph.setNodeAttribute(n, 'y', p.y)
  })

  // Return LUTs so callers can rescale positions with a multiply instead of rerunning trig
  return { cosLUT, sinLUT, radLUT }
}
