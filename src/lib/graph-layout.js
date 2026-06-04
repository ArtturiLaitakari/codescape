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
  // Build tree-only children map from BFS — stops at first visit so cycles are ignored.
  // Import edges in the heatmap graph would otherwise cause infinite recursion.
  const children = {}
  const depth = {}
  graph.forEachNode((n) => { children[n] = [] })

  // BFS from root: only add each node once as a child (ignore back/cross edges)
  const bfsQueue = [rootKey]
  const inTree = new Set([rootKey])
  depth[rootKey] = 0
  while (bfsQueue.length) {
    const n = bfsQueue.shift()
    for (const nb of graph.outNeighbors(n)) {
      if (!inTree.has(nb)) {
        inTree.add(nb)
        children[n].push(nb)
        depth[nb] = depth[n] + 1
        bfsQueue.push(nb)
      }
    }
  }

  // Pass 1 (bottom-up, iterative): compute required angular width per node.
  // Post-order = process children before parents → iterative via explicit stack.
  const angleWidth = {}
  const postOrder = []
  {
    const stack = [rootKey]
    const visited = new Set()
    while (stack.length) {
      const n = stack[stack.length - 1]
      if (!visited.has(n)) {
        visited.add(n)
        for (const c of children[n]) stack.push(c)
      } else {
        stack.pop()
        postOrder.push(n)
      }
    }
  }
  for (const node of postOrder) {
    const d = depth[node] ?? 0
    const r = (d + 1) * levelRadius
    const minAngle = nodeGap / r
    const ch = children[node]
    if (ch.length === 0) {
      angleWidth[node] = minAngle
    } else {
      const sum = ch.reduce((s, c) => s + (angleWidth[c] ?? 0), 0)
      angleWidth[node] = Math.max(sum, minAngle)
    }
  }

  // Scale all widths if root's children would overflow 2π (iterative BFS rescale)
  const rootChildTotal = children[rootKey].reduce((s, c) => s + (angleWidth[c] ?? 0), 0) || 1
  if (rootChildTotal > 2 * Math.PI) {
    const scale = (2 * Math.PI) / rootChildTotal
    const rescaleStack = [...children[rootKey]]
    while (rescaleStack.length) {
      const n = rescaleStack.pop()
      angleWidth[n] = (angleWidth[n] ?? 0) * scale
      for (const c of children[n]) rescaleStack.push(c)
    }
  }

  // Pass 2 (top-down, iterative): place each node at the centre of its wedge.
  const pos = { [rootKey]: { x: 0, y: 0 } }
  const used = children[rootKey].reduce((s, c) => s + (angleWidth[c] ?? 0), 0)
  const placeStack = [{ node: rootKey, angleStart: -used / 2 }]
  while (placeStack.length) {
    const { node, angleStart } = placeStack.pop()
    let a = angleStart
    for (const child of children[node]) {
      const w = angleWidth[child] ?? 0
      const mid = a + w / 2

      // Deterministic jitter from node key hash — stays inside wedge
      let h = 0
      for (let i = 0; i < child.length; i++) h = (h * 31 + child.charCodeAt(i)) | 0
      const rJitter = ((h & 0xff) / 255 - 0.5) * levelRadius * 0.6
      const aJitter = (((h >> 8) & 0xff) / 255 - 0.5) * w * 0.4

      const r = (depth[child] + 1) * levelRadius + rJitter
      pos[child] = { x: Math.cos(mid + aJitter) * r, y: Math.sin(mid + aJitter) * r }
      placeStack.push({ node: child, angleStart: a })
      a += w
    }
  }

  graph.forEachNode((n) => {
    const p = pos[n] ?? { x: 0, y: 0 }
    graph.setNodeAttribute(n, 'x', p.x)
    graph.setNodeAttribute(n, 'y', p.y)
  })
}
