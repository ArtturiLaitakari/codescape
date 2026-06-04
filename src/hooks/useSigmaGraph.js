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
  // Read label color from node attribute so nodeReducer can override it per-node
  labelColor: { attribute: 'labelColor' },
  minCameraRatio: 0.001,
  maxCameraRatio: 100,
}

const SPREAD_THRESHOLD = 0.05  // only recompute when zoom changes >5%
const MAX_NODE_SCREEN_PX = 40  // node pixel cap regardless of zoom

/** Append a 2-hex-digit alpha to a #rrggbb color (strips existing alpha first) */
function withAlpha(hex, alpha) {
  const base = hex.startsWith('#') ? hex.slice(1, 7) : hex.slice(0, 6)
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `#${base}${a}`
}

// Impact zone depth → color: selected=gold, direct=orange, 2nd=amber, 3+=pale
const IMPACT_COLORS = ['#fbbf24', '#f97316', '#f59e0b', '#fde68a']
function impactColor(depth) {
  return IMPACT_COLORS[Math.min(depth, IMPACT_COLORS.length - 1)]
}

/**
 * Manages a Sigma graph instance tied to a DOM container.
 * Handles graph construction, layout, zoom-spread, and cleanup.
 *
 * @param {React.RefObject} containerRef - ref to the Sigma mount element
 * @param {{ onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus }} callbacks
 * @returns {{ load: (nodes, edges, rootKey) => void }}
 */
export function useSigmaGraph(containerRef, { onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus }) {
  const sigmaRef = useRef(null)
  const graphRef = useRef(null)
  const nodesRef = useRef([])
  // Mutable ref so nodeReducer/edgeReducer always see the current value without
  // needing to recreate the Sigma instance.
  const focusRef = useRef(null)  // null | { node, neighbors: Set<string>, impactZone: Map|null }
  const lastFocusTimeRef = useRef(0)  // guard: ignore clickStage fired right after focusNode
  const filterRef = useRef(null)  // null | Set<string> — keys that match the search query

  const destroy = useCallback(() => {
    sigmaRef.current?.kill()
    sigmaRef.current = null
    graphRef.current = null
    nodesRef.current = []
    focusRef.current = null
    filterRef.current = null
  }, [])

  useEffect(() => () => destroy(), [destroy])

  const load = useCallback((nodes, edges, rootKey = '__root__', extraEdges = []) => {  // eslint-disable-line
    destroy()

    const graph = new Graph({ type: 'directed' })

    nodes.forEach(({ key, attributes }) => {
      graph.addNode(key, {
        ...attributes,
        x: 0, y: 0,
        // Preserve caller-supplied color/size (e.g. heatmap); fall back to defaults
        color: attributes.color ?? nodeColor(attributes),
        size: attributes.size ?? nodeSize(attributes),
        labelColor: '#e2e8f0',
      })
    })

    // Only tree edges used during layout — no cycles
    edges.forEach(({ source, target }) => {
      if (graph.hasNode(source) && graph.hasNode(target) && !graph.hasEdge(source, target)) {
        graph.addDirectedEdge(source, target, { color: '#334155', size: 1 })
      }
    })

    radialTreeLayout(graph, rootKey)

    // Snapshot for search / programmatic focus
    graphRef.current = graph
    nodesRef.current = []
    graph.forEachNode((key, attrs) => {
      nodesRef.current.push({ key, label: attrs.label, kind: attrs.kind, ext: attrs.ext })
    })

    // Add extra edges (e.g. import edges) after layout — they may form cycles
    extraEdges.forEach(({ source, target }) => {
      if (graph.hasNode(source) && graph.hasNode(target) && !graph.hasEdge(source, target)) {
        graph.addDirectedEdge(source, target, { color: '#475569', size: 0.5 })
      }
    })

    // Snapshot positions after layout — zoom-spread scales from these
    const base = {}
    graph.forEachNode((n) => {
      base[n] = { x: graph.getNodeAttribute(n, 'x'), y: graph.getNodeAttribute(n, 'y') }
    })

    // cam.ratio is read every frame by nodeReducer — updated by camera listener
    const cam = { ratio: 1 }

    const sigma = new Sigma(graph, containerRef.current, {
      ...SIGMA_DEFAULTS,
      nodeReducer: (node, data) => {
        const maxGraphSize = MAX_NODE_SCREEN_PX * cam.ratio
        const scale = Math.pow(1 / cam.ratio, 0.4)
        const result = { ...data, size: Math.min(data.size * scale, maxGraphSize) }

        const focus = focusRef.current
        const filter = filterRef.current
        if (focus) {
          if (focus.impactZone) {
            // Impact mode: color each node by its depth in the impact zone
            const depth = focus.impactZone.get(node)
            if (depth === undefined) {
              result.color = withAlpha(data.color, 0.2)
              result.labelColor = '#1e3a5f'
            } else {
              const c = impactColor(depth)
              result.color = c
              result.labelColor = c
            }
          } else if (node !== focus.node && !focus.neighbors.has(node)) {
            // Normal neighbor mode: dim unconnected nodes
            result.color = withAlpha(data.color, 0.2)
            result.labelColor = '#1e3a5f'
          }
        } else if (filter && !filter.has(node)) {
          // Search filter mode: dim nodes that don't match the query
          result.color = withAlpha(data.color, 0.15)
          result.labelColor = '#1e3a5f'
        }
        return result
      },
      edgeReducer: (edge, data) => {
        const focus = focusRef.current
        const filter = filterRef.current
        if (!focus && !filter) return data
        const src = graph.source(edge)
        const tgt = graph.target(edge)
        if (focus) {
          if (focus.impactZone) {
            // Show only edges where both endpoints are in the impact zone
            if (!focus.impactZone.has(src) || !focus.impactZone.has(tgt)) return { ...data, hidden: true }
            return data
          }
          const connected = src === focus.node || tgt === focus.node
          // WebGL edge renderer ignores hex alpha — hide inactive edges entirely
          if (!connected) return { ...data, hidden: true }
          return data
        }
        // Search filter mode: hide edges where neither endpoint matches
        if (!filter.has(src) && !filter.has(tgt)) return { ...data, hidden: true }
        return data
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

    // Click node → focus; click same node or background → clear focus
    sigma.on('clickNode', ({ node }) => {
      if (focusRef.current?.node === node) {
        focusRef.current = null
        onClearFocus?.()
      } else {
        if (getImpactZone) {
          const impactZone = getImpactZone(node)   // Map<key, depth> returned by caller
          focusRef.current = { node, neighbors: new Set(impactZone.keys()), impactZone }
        } else {
          const neighbors = new Set(graph.neighbors(node))
          focusRef.current = { node, neighbors, impactZone: null }
        }
      }
      sigma.refresh()
    })
    sigma.on('clickStage', () => {
      // Ignore stage clicks that arrive right after a programmatic focusNode() call
      // (the dropdown closes mid-click, causing mouseup/click to land on the canvas)
      if (Date.now() - lastFocusTimeRef.current < 300) return
      if (focusRef.current) {
        focusRef.current = null
        onClearFocus?.()
        sigma.refresh()
      }
    })

    sigma.on('enterNode', ({ node }) => onEnterNode?.(node, graph.getNodeAttributes(node)))
    sigma.on('leaveNode', () => onLeaveNode?.())

    onReady?.(graph.order)
  }, [containerRef, destroy, onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus])

  const getNodes = useCallback(() => nodesRef.current, [])

  const setFilter = useCallback((keys) => {
    const sigma = sigmaRef.current
    filterRef.current = keys  // Set<string> | null
    sigma?.refresh()
  }, [])

  const focusNode = useCallback((key) => {
    const sigma = sigmaRef.current
    const graph = graphRef.current
    if (!sigma || !graph || !graph.hasNode(key)) return
    if (getImpactZone) {
      const impactZone = getImpactZone(key)
      focusRef.current = { node: key, neighbors: new Set(impactZone.keys()), impactZone }
    } else {
      const neighbors = new Set(graph.neighbors(key))
      focusRef.current = { node: key, neighbors, impactZone: null }
    }
    lastFocusTimeRef.current = Date.now()
    sigma.refresh()
    const x = graph.getNodeAttribute(key, 'x')
    const y = graph.getNodeAttribute(key, 'y')
    sigma.getCamera().animate({ x, y, ratio: Math.min(sigma.getCamera().ratio, 0.8) }, { duration: 350 })
  }, [getImpactZone])

  return { load, focusNode, getNodes, setFilter }
}
