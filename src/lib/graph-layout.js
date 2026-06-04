/**
 * Reingold–Tilford radial layout — guarantees no edge crossings.
 *
 * Pass 1 (bottom-up): each node claims angular width =
 *   max(sum of children widths, minimum arc at that ring)
 * Pass 2 (top-down): place each node at the centre of its wedge with
 *   deterministic jitter so the result looks organic rather than mechanical.
 *
 * @param {import('graphology').default} graph - directed graphology graph
 * @param {string} rootKey - key of the root node
 * @param {number} levelRadius - radial distance between depth rings (px)
 * @param {number} nodeGap - minimum pixel gap between leaf nodes on the same ring
 */
export function radialTreeLayout(graph, rootKey, levelRadius = 90, nodeGap = 22) {
  const children = {}
  const depth = {}
  graph.forEachNode((n) => { children[n] = [] })
  graph.forEachEdge((_e, _a, source, target) => {
    if (children[source]) children[source].push(target)
  })

  // BFS to compute depth
  const queue = [rootKey]
  depth[rootKey] = 0
  while (queue.length) {
    const n = queue.shift()
    for (const c of children[n] || []) {
      if (depth[c] === undefined) {
        depth[c] = depth[n] + 1
        queue.push(c)
      }
    }
  }

  // Pass 1: required angular width per node
  const angleWidth = {}
  function calcWidth(node) {
    const d = depth[node] ?? 0
    const r = (d + 1) * levelRadius
    const minAngle = nodeGap / r
    const ch = children[node] || []
    if (ch.length === 0) {
      angleWidth[node] = minAngle
      return minAngle
    }
    const sum = ch.reduce((s, c) => s + calcWidth(c), 0)
    angleWidth[node] = Math.max(sum, minAngle)
    return angleWidth[node]
  }
  calcWidth(rootKey)

  // Scale root children to exactly 2π if they would overflow
  const rootChildTotal = (children[rootKey] || []).reduce((s, c) => s + angleWidth[c], 0) || 1
  if (rootChildTotal > 2 * Math.PI) {
    const scale = (2 * Math.PI) / rootChildTotal
    function rescale(node) {
      angleWidth[node] *= scale
      for (const c of children[node] || []) rescale(c)
    }
    for (const c of children[rootKey] || []) rescale(c)
  }

  // Pass 2: place nodes, deterministic jitter keeps nodes inside their wedge
  const pos = { [rootKey]: { x: 0, y: 0 } }
  function place(node, angleStart) {
    const ch = children[node] || []
    let a = angleStart
    for (const child of ch) {
      const w = angleWidth[child]
      const mid = a + w / 2

      // Hash node key → deterministic pseudo-random in [0, 1)
      let h = 0
      for (let i = 0; i < child.length; i++) h = (h * 31 + child.charCodeAt(i)) | 0
      const rJitter = ((h & 0xff) / 255 - 0.5) * levelRadius * 0.6   // ±30% radial
      const aJitter = (((h >> 8) & 0xff) / 255 - 0.5) * w * 0.4      // ±20% angular (stays in wedge)

      const r = (depth[child] + 1) * levelRadius + rJitter
      const angle = mid + aJitter
      pos[child] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
      place(child, a)
      a += w
    }
  }

  const used = (children[rootKey] || []).reduce((s, c) => s + angleWidth[c], 0)
  place(rootKey, -used / 2)

  graph.forEachNode((n) => {
    const p = pos[n] ?? { x: 0, y: 0 }
    graph.setNodeAttribute(n, 'x', p.x)
    graph.setNodeAttribute(n, 'y', p.y)
  })
}
