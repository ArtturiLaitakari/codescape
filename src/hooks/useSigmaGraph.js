import { useEffect, useRef, useCallback } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'
import { radialTreeLayout } from '../lib/graph-layout.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'

const SIGMA_DEFAULTS = {
  renderEdgeLabels: false,
  defaultEdgeColor: '#334155',
  labelFont: 'monospace',
  labelSize: 11,
  labelColor: { color: '#e2e8f0' },
  minCameraRatio: 0.001,
  maxCameraRatio: 100,
}

const SPREAD_THRESHOLD = 0.05  // only recompute when zoom changes >5%
const MAX_NODE_SCREEN_PX = 40  // node pixel cap regardless of zoom

/**
 * Manages a Sigma graph instance tied to a DOM container.
 * Handles graph construction, layout, zoom-spread, and cleanup.
 *
 * @param {React.RefObject} containerRef - ref to the Sigma mount element
 * @param {{ onEnterNode, onLeaveNode, onReady }} callbacks
 * @returns {{ load: (nodes, edges, rootKey) => void }}
 */
export function useSigmaGraph(containerRef, { onEnterNode, onLeaveNode, onReady }) {
  const sigmaRef = useRef(null)

  const destroy = useCallback(() => {
    sigmaRef.current?.kill()
    sigmaRef.current = null
  }, [])

  useEffect(() => () => destroy(), [destroy])

  const load = useCallback((nodes, edges, rootKey = '__root__') => {
    destroy()

    const graph = new Graph({ type: 'directed' })

    nodes.forEach(({ key, attributes }) => {
      graph.addNode(key, {
        ...attributes,
        x: 0, y: 0,
        size: nodeSize(attributes),
        color: nodeColor(attributes),
        label: attributes.label,
      })
    })

    edges.forEach(({ source, target }) => {
      if (graph.hasNode(source) && graph.hasNode(target) && !graph.hasEdge(source, target)) {
        graph.addDirectedEdge(source, target, { color: '#334155', size: 1 })
      }
    })

    radialTreeLayout(graph, rootKey)

    // Snapshot positions after layout — zoom-spread scales from these
    const base = {}
    graph.forEachNode((n) => {
      base[n] = { x: graph.getNodeAttribute(n, 'x'), y: graph.getNodeAttribute(n, 'y') }
    })

    // cam.ratio is read every frame by nodeReducer — updated by camera listener
    const cam = { ratio: 1 }

    const sigma = new Sigma(graph, containerRef.current, {
      ...SIGMA_DEFAULTS,
      nodeReducer: (_node, data) => {
        const maxGraphSize = MAX_NODE_SCREEN_PX * cam.ratio
        const scale = Math.pow(1 / cam.ratio, 0.4)
        return { ...data, size: Math.min(data.size * scale, maxGraphSize) }
      },
    })
    sigmaRef.current = sigma

    let lastRatio = sigma.getCamera().ratio
    sigma.getCamera().on('updated', () => {
      const ratio = sigma.getCamera().ratio
      cam.ratio = ratio
      if (Math.abs(ratio - lastRatio) / lastRatio < SPREAD_THRESHOLD) return
      lastRatio = ratio
      // Spread nodes proportionally — preserves planarity (no separateNodes)
      const spread = 1 / ratio
      graph.forEachNode((n) => {
        graph.setNodeAttribute(n, 'x', base[n].x * spread)
        graph.setNodeAttribute(n, 'y', base[n].y * spread)
      })
      sigma.refresh({ skipIndexation: false })
    })

    sigma.on('enterNode', ({ node }) => onEnterNode?.(node, graph.getNodeAttributes(node)))
    sigma.on('leaveNode', () => onLeaveNode?.())

    onReady?.(graph.order)
  }, [containerRef, destroy, onEnterNode, onLeaveNode, onReady])

  return { load }
}
