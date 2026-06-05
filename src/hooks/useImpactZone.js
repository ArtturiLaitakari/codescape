import { useState, useCallback } from 'react'

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
    const depths = new Map()

    if (isDir) {
      const fwd = forwardTreeRef.current
      const queue = [[startNode, 0]]
      while (queue.length) {
        const [node, depth] = queue.shift()
        if (depths.has(node)) continue
        depths.set(node, depth)
        for (const child of (fwd[node] ?? [])) {
          if (!depths.has(child)) queue.push([child, depth + 1])
        }
      }
      setSelectMode('dir')
      setSelectedImpact({ node: startNode, count: depths.size - 1, mode: 'dir' })
    } else {
      const rev = reverseAdjRef.current
      const queue = [[startNode, 0]]
      while (queue.length) {
        const [node, depth] = queue.shift()
        if (depths.has(node)) continue
        depths.set(node, depth)
        for (const parent of (rev[node] ?? [])) {
          if (!depths.has(parent)) queue.push([parent, depth + 1])
        }
      }
      setSelectMode('file')
      setSelectedImpact({ node: startNode, count: depths.size - 1, mode: 'file' })
    }
    return depths
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // refs are stable — intentionally omitted from deps

  const onClearFocus = useCallback(() => {
    setSelectedImpact(null)
    setSelectMode(null)
  }, [])

  return { selectedImpact, setSelectedImpact, selectMode, setSelectMode, getImpactZone, onClearFocus }
}
