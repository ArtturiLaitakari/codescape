import { useEffect, useRef, useCallback } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'
import { radialTreeLayout } from '../lib/graph-layout.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'

// ── Constants ────────────────────────────────────────────────────────────────
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

const SPREAD_THRESHOLD   = 0.05  // only recompute layout spread when zoom changes >5%
const MAX_NODE_SCREEN_PX = 40    // node pixel cap regardless of zoom
const CLICK_STAGE_GUARD  = 300   // ms — ignore stage clicks right after programmatic focus
const DIM_COLOR_ALPHA    = 0.2   // alpha for dimmed (non-focused / non-matched) nodes
const FILTER_DIM_ALPHA   = 0.15  // alpha for nodes outside search filter
const DEFAULT_LABEL_COLOR = '#e2e8f0'  // fallback; overridden at load time by getThemeLabelColor()
const TREE_EDGE_COLOR    = '#334155'
const EXTRA_EDGE_COLOR   = '#475569'

/** Read --cs-text-primary from the document root (theme-aware). Falls back to dark-theme value. */
function getThemeLabelColor() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--cs-text-primary').trim()
  return v || '#e2e8f0'  // dark theme fallback
}

/** Color that makes a label invisible — matches the graph canvas background. */
function getThemeDimLabelColor() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--cs-graph-bg').trim()
  return v || '#0f172a'  // dark theme fallback
}

// Impact zone depth → color: selected=gold, direct=orange, 2nd=amber, 3+=pale
const IMPACT_COLORS = ['#fbbf24', '#f97316', '#f59e0b', '#fde68a']
const impactColor = (depth) => IMPACT_COLORS[Math.min(depth, IMPACT_COLORS.length - 1)]

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Append a 2-hex-digit alpha to a #rrggbb color (strips existing alpha first) */
function withAlpha(hex, alpha) {
  const base = hex.startsWith('#') ? hex.slice(1, 7) : hex.slice(0, 6)
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `#${base}${a}`
}

/** Build a directed graphology graph from node + tree-edge specs. */
function buildGraph(nodes, edges, labelColor = DEFAULT_LABEL_COLOR) {
  const graph = new Graph({ type: 'directed' })
  nodes.forEach(({ key, attributes }) => {
    graph.addNode(key, {
      ...attributes,
      x: 0, y: 0,
      color: attributes.color ?? nodeColor(attributes),
      size: attributes.size ?? nodeSize(attributes),
      labelColor,
    })
  })
  addEdgesSafe(graph, edges, TREE_EDGE_COLOR, 1)
  return graph
}

/** Add edges; skip duplicates and edges whose endpoints don't exist. */
function addEdgesSafe(graph, edges, color, size) {
  edges.forEach(({ source, target }) => {
    if (graph.hasNode(source) && graph.hasNode(target) && !graph.hasEdge(source, target)) {
      graph.addDirectedEdge(source, target, { color, size })
    }
  })
}

/** Snapshot a lightweight node list for the search bar. */
function snapshotNodes(graph) {
  const out = []
  graph.forEachNode((key, attrs) => {
    out.push({ key, label: attrs.label, kind: attrs.kind, ext: attrs.ext })
  })
  return out
}

/** Compute the focus state object for a clicked / programmatically-focused node. */
function computeFocus(node, graph, getImpactZone) {
  if (getImpactZone) {
    const impactZone = getImpactZone(node)
    return { node, neighbors: new Set(impactZone.keys()), impactZone }
  }
  return { node, neighbors: new Set(graph.neighbors(node)), impactZone: null }
}

// ── Reducers (decide per-frame how each node/edge looks) ─────────────────────

/** Apply focus/filter dimming + zoom-aware sizing to a single node. */
function reduceNode(node, data, { focus, filter, camRatio, dimLabelColor }) {
  const maxGraphSize = MAX_NODE_SCREEN_PX * camRatio
  const scale = Math.pow(1 / camRatio, 0.4)
  const result = { ...data, size: Math.min(data.size * scale, maxGraphSize) }

  if (focus?.impactZone) {
    const depth = focus.impactZone.get(node)
    if (depth === undefined) {
      result.color = withAlpha(data.color, DIM_COLOR_ALPHA)
      result.labelColor = dimLabelColor
    } else {
      const c = impactColor(depth)
      result.color = c
      result.labelColor = c
    }
    return result
  }

  if (focus && node !== focus.node && !focus.neighbors.has(node)) {
    result.color = withAlpha(data.color, DIM_COLOR_ALPHA)
    result.labelColor = dimLabelColor
    return result
  }

  if (!focus && filter && !filter.has(node)) {
    result.color = withAlpha(data.color, FILTER_DIM_ALPHA)
    result.labelColor = dimLabelColor
  }
  return result
}

/** Hide edges that aren't relevant to the current focus or search filter. */
function reduceEdge(graph, edge, data, { focus, filter }) {
  if (!focus && !filter) return data
  const src = graph.source(edge)
  const tgt = graph.target(edge)

  if (focus?.impactZone) {
    if (!focus.impactZone.has(src) || !focus.impactZone.has(tgt)) return { ...data, hidden: true }
    return data
  }
  if (focus) {
    if (src !== focus.node && tgt !== focus.node) return { ...data, hidden: true }
    return data
  }
  // filter-only mode
  if (!filter.has(src) && !filter.has(tgt)) return { ...data, hidden: true }
  return data
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages a Sigma graph instance bound to a DOM container.
 *
 * @param {React.RefObject<HTMLElement>} containerRef
 * @param {{
 *   onEnterNode?: (key, attrs) => void,
 *   onLeaveNode?: () => void,
 *   onClickNode?: (key, attrs) => void,
 *   onDoubleClickNode?: (key, attrs) => void,
 *   onReady?: (nodeCount: number) => void,
 *   onClearFocus?: () => void,
 *   getImpactZone?: (key) => Map<string, number>,
 * }} callbacks
 * @returns {{
 *   load: (nodes, edges, rootKey?, extraEdges?) => void,
 *   focusNode: (key) => void,
 *   getNodes: () => Array<{ key, label, kind, ext }>,
 *   setFilter: (keys: Set<string> | null) => void,
 *   patchNodes: (updates: Array<{ key, attributes }>) => void,
 *   addEdges: (edges) => void,
 * }}
 */
export function useSigmaGraph(containerRef, {
  onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus, onClickNode, onDoubleClickNode,
} = {}) {
  const sigmaRef = useRef(null)
  const graphRef = useRef(null)
  const nodesRef = useRef([])
  // Mutable refs so reducers always see the current value without recreating Sigma
  const focusRef        = useRef(null)  // null | { node, neighbors: Set<string>, impactZone: Map|null }
  const filterRef       = useRef(null)  // null | Set<string>
  const lastFocusTimeRef = useRef(0)    // guard: ignore clickStage fired right after focusNode
  const camRef          = useRef(null)  // ref to current cam object so refreshTheme can update dimLabelColor

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const destroy = useCallback(() => {
    sigmaRef.current?.kill()
    sigmaRef.current = null
    graphRef.current = null
    nodesRef.current = []
    focusRef.current = null
    filterRef.current = null
  }, [])

  useEffect(() => () => destroy(), [destroy])

  // ── Event wiring ───────────────────────────────────────────────────────────
  const attachZoomSpread = useCallback((sigma, graph, layoutLUTs, cam) => {
    const { cosLUT, sinLUT, radLUT } = layoutLUTs
    let lastRatio = sigma.getCamera().ratio
    sigma.getCamera().on('updated', () => {
      const ratio = sigma.getCamera().ratio
      cam.ratio = ratio
      if (Math.abs(ratio - lastRatio) / lastRatio < SPREAD_THRESHOLD) return
      lastRatio = ratio
      const spread = 1 / ratio
      // LUT-based rescale: cos/sin computed once at layout time, here just cos * r * spread
      graph.forEachNode((n) => {
        if (radLUT[n] === undefined) return  // root node stays at (0,0)
        graph.setNodeAttribute(n, 'x', cosLUT[n] * radLUT[n] * spread)
        graph.setNodeAttribute(n, 'y', sinLUT[n] * radLUT[n] * spread)
      })
      sigma.refresh({ skipIndexation: false })
    })
  }, [])

  const attachInteractionHandlers = useCallback((sigma, graph) => {
    sigma.on('clickNode', ({ node }) => {
      if (focusRef.current?.node === node) {
        focusRef.current = null
        onClearFocus?.()
      } else {
        focusRef.current = computeFocus(node, graph, getImpactZone)
      }
      filterRef.current = null  // focus and filter are mutually exclusive
      onClickNode?.(node, graph.getNodeAttributes(node))
      sigma.refresh()
    })

    sigma.on('clickStage', () => {
      // Ignore stage clicks that arrive right after a programmatic focusNode()
      // (e.g. closing a dropdown lets the mouseup land on the canvas)
      if (Date.now() - lastFocusTimeRef.current < CLICK_STAGE_GUARD) return
      if (focusRef.current) {
        focusRef.current = null
        onClearFocus?.()
        sigma.refresh()
      }
    })

    sigma.on('enterNode',       ({ node })        => onEnterNode?.(node, graph.getNodeAttributes(node)))
    sigma.on('leaveNode',       ()                => onLeaveNode?.())
    sigma.on('doubleClickNode', ({ node, event }) => {
      event.preventSigmaDefault()  // suppress sigma's built-in zoom
      onDoubleClickNode?.(node, graph.getNodeAttributes(node))
    })
  }, [getImpactZone, onClickNode, onClearFocus, onEnterNode, onLeaveNode, onDoubleClickNode])

  // ── Public: load a fresh graph ─────────────────────────────────────────────
  const load = useCallback((nodes, edges, rootKey = '__root__', extraEdges = []) => {
    destroy()

    const labelColor = getThemeLabelColor()
    const dimLabelColor = getThemeDimLabelColor()
    const graph = buildGraph(nodes, edges, labelColor)
    const layoutLUTs = radialTreeLayout(graph, rootKey)

    graphRef.current = graph
    nodesRef.current = snapshotNodes(graph)

    // Extra edges (cycles allowed) are added AFTER layout so they don't perturb it
    addEdgesSafe(graph, extraEdges, EXTRA_EDGE_COLOR, 0.5)

    const cam = { ratio: 1, dimLabelColor }  // mutated by zoom listener, read by node reducer
    camRef.current = cam

    const sigma = new Sigma(graph, containerRef.current, {
      ...SIGMA_DEFAULTS,
      nodeReducer: (node, data) =>
        reduceNode(node, data, { focus: focusRef.current, filter: filterRef.current, camRatio: cam.ratio, dimLabelColor: camRef.current?.dimLabelColor ?? cam.dimLabelColor }),
      edgeReducer: (edge, data) =>
        reduceEdge(graph, edge, data, { focus: focusRef.current, filter: filterRef.current }),
    })
    sigmaRef.current = sigma

    attachZoomSpread(sigma, graph, layoutLUTs, cam)
    attachInteractionHandlers(sigma, graph)

    onReady?.(graph.order)
  }, [containerRef, destroy, attachZoomSpread, attachInteractionHandlers, onReady])

  // ── Public: query / mutation API ───────────────────────────────────────────
  const getNodes = useCallback(() => nodesRef.current, [])

  const setFilter = useCallback((keys) => {
    filterRef.current = keys  // Set<string> | null
    sigmaRef.current?.refresh()
  }, [])

  const focusNode = useCallback((key) => {
    const sigma = sigmaRef.current
    const graph = graphRef.current
    if (!sigma || !graph) return

    // Clear / no-op when the key is unknown
    if (!key || !graph.hasNode(key)) {
      focusRef.current = null
      sigma.refresh()
      return
    }
    // Toggle off when re-focusing the same node
    if (focusRef.current?.node === key) {
      focusRef.current = null
    } else {
      focusRef.current = computeFocus(key, graph, getImpactZone)
    }
    lastFocusTimeRef.current = Date.now()  // suppress the next clickStage
    sigma.refresh()
  }, [getImpactZone])

  const patchNodes = useCallback((updates) => {
    const graph = graphRef.current
    const sigma = sigmaRef.current
    if (!graph || !sigma) return
    for (const { key, attributes } of updates) {
      if (!graph.hasNode(key)) continue
      for (const [attr, val] of Object.entries(attributes)) {
        graph.setNodeAttribute(key, attr, val)
      }
    }
    sigma.refresh()
  }, [])

  const addEdges = useCallback((edges) => {
    const graph = graphRef.current
    const sigma = sigmaRef.current
    if (!graph || !sigma) return
    addEdgesSafe(graph, edges, EXTRA_EDGE_COLOR, 0.5)
    sigma.refresh()
  }, [])

  /** Re-read theme colors from CSS and patch every node's labelColor in place. */
  const refreshTheme = useCallback(() => {
    const graph = graphRef.current
    const sigma = sigmaRef.current
    if (!graph || !sigma) return
    const labelColor = getThemeLabelColor()
    const dimLabelColor = getThemeDimLabelColor()
    // Update cam so next nodeReducer call uses the new dimLabelColor
    // cam is closed over inside load; store on sigma for access here
    if (camRef.current) camRef.current.dimLabelColor = dimLabelColor
    graph.forEachNode((n) => graph.setNodeAttribute(n, 'labelColor', labelColor))
    sigma.refresh()
  }, [])

  return { load, focusNode, getNodes, setFilter, patchNodes, addEdges, refreshTheme }
}
