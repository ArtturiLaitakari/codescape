import { useState, useCallback } from 'react'

/** BFS from startNode using the given adjacency map; returns node → depth Map. */
function bfsDepths(startNode, adj) {
  const depths = new Map()
  const queue = [[startNode, 0]]
  while (queue.length) {
    const [node, depth] = queue.shift()
    if (depths.has(node)) continue
    depths.set(node, depth)
    for (const neighbour of (adj[node] ?? [])) {
      if (!depths.has(neighbour)) queue.push([neighbour, depth + 1])
    }
  }
  return depths
}

/**
 * Manages impact zone selection state and BFS traversal.
 * @param {React.MutableRefObject} nodeAttrsRef   key → attrs
 * @param {React.MutableRefObject} forwardTreeRef parent → Set<child>
 * @param {React.MutableRefObject} reverseAdjRef  target → Set<source>
 */
export function useImpactZone(nodeAttrsRef, forwardTreeRef, reverseAdjRef) {
  const [selectedImpact, setSelectedImpact] = useState(null)
  const [selectMode, setSelectMode] = useState(null)

  const getImpactZone = useCallback((startNode) => {
    const attrs = nodeAttrsRef.current[startNode]
    const isDir = attrs?.kind === 'dir' || attrs?.kind === 'dir-empty' || attrs?.kind === 'root'

    const depths = isDir
      ? bfsDepths(startNode, forwardTreeRef.current)   // dir: walk tree children
      : bfsDepths(startNode, reverseAdjRef.current)    // file: walk reverse imports

    const mode = isDir ? 'dir' : 'file'
    setSelectMode(mode)
    setSelectedImpact({ node: startNode, count: depths.size - 1, mode })
    return depths
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // refs are stable — intentionally omitted from deps

  const onClearFocus = useCallback(() => {
    setSelectedImpact(null)
    setSelectMode(null)
  }, [])

  return { selectedImpact, setSelectedImpact, selectMode, setSelectMode, getImpactZone, onClearFocus }
}
