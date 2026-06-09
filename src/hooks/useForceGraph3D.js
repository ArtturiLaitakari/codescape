import { useEffect, useRef, useCallback } from 'react'
import ForceGraph3D from '3d-force-graph'
import { forceZ } from 'd3-force-3d'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import SpriteText from 'three-spritetext'

// ── Constants ─────────────────────────────────────────────────────────────────
const DIM_OPACITY    = 0.08
const FILTER_OPACITY = 0.06
const EDGE_OPACITY   = 0.3
const Z_DEPTH_SCALE  = 220   // px per depth level on z-axis (FileMap depthPinned layout)
const LABEL_OFFSET   = 14     // world-units gap between sphere edge and label

// ── Default layout options (all overridable per hook instance) ───────────────
export const DEFAULT_LAYOUT_OPTIONS = {
  zDepthScale:    220,   // z-distance per depth level (depthPinned only)
  zStrength:      1,     // forceZ strength (depthPinned only)
  chargeStrength: -120,  // negative = repel nodes apart
  linkDistance:   40,    // preferred edge length
  linkStrength:   0.5,   // spring stiffness
  alphaDecay:     0.0228,// simulation cooling speed (default d3 = 0.0228)
  velocityDecay:  0.4,   // damping (higher = faster settle)
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Extract r,g,b from #rrggbb and return "r,g,b" */
function hexToRGB(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r},${g},${b}`
}

/** rgba string from hex + alpha */
function withAlpha(hex, alpha) {
  return `rgba(${hexToRGB(hex)},${alpha})`
}

/**
 * Snapshot a lightweight node list for the search bar — same shape as useSigmaGraph.
 */
function snapshotNodes(rawNodes) {
  return rawNodes.map(({ id, label, kind, ext }) => ({ key: id, label, kind, ext }))
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for useSigmaGraph that uses 3d-force-graph.
 *
 * Returned API mirrors useSigmaGraph exactly so view components need only
 * switch which hook they import.
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
 *   layoutMode?: 'depthPinned' | 'free',  // 'depthPinned' = FileMap z-axis layout
 * }} callbacks
 * @returns {{
 *   load: (nodes, edges, rootKey?, extraEdges?) => void,
 *   focusNode: (key) => void,
 *   getNodes: () => Array<{ key, label, kind, ext }>,
 *   setFilter: (keys: Set<string> | null) => void,
 *   patchNodes: (updates: Array<{ key, attributes }>) => void,
 *   addEdges: (edges) => void,
 *   refreshTheme: () => void,
 * }}
 */
export function useForceGraph3D(containerRef, {
  onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus,
  onClickNode, onDoubleClickNode, layoutMode = 'free', layoutOptions = {},
} = {}) {
  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...layoutOptions }
  const graphRef   = useRef(null)   // ForceGraph3D instance
  const nodesRef   = useRef([])     // raw node objects with all attrs
  const nodeMapRef = useRef({})     // id → node object

  // Mutable refs (avoids re-creating graph when callbacks change)
  const focusRef   = useRef(null)   // null | { node: id, neighbors: Set, impactZone: Map|null }
  const filterRef  = useRef(null)   // null | Set<string>

  // Keep color functions in refs so the graph always calls the latest closure
  // without needing to recreate the entire graph instance
  const nodeColorFnRef = useRef(null)
  const linkColorFnRef = useRef(null)

  // Refs for stable callback access
  const onEnterRef      = useRef(onEnterNode)
  const onLeaveRef      = useRef(onLeaveNode)
  const onClickRef      = useRef(onClickNode)
  const onDblClickRef   = useRef(onDoubleClickNode)
  const onReadyRef      = useRef(onReady)
  const getImpactRef    = useRef(getImpactZone)
  const lastClickTime   = useRef(0)

  useEffect(() => { onEnterRef.current = onEnterNode },    [onEnterNode])
  useEffect(() => { onLeaveRef.current = onLeaveNode },    [onLeaveNode])
  useEffect(() => { onClickRef.current = onClickNode },    [onClickNode])
  useEffect(() => { onDblClickRef.current = onDoubleClickNode }, [onDoubleClickNode])
  useEffect(() => { onReadyRef.current = onReady },        [onReady])
  useEffect(() => { getImpactRef.current = getImpactZone },[getImpactZone])

  // ── Color logic ────────────────────────────────────────────────────────────

  // Update color fn refs on every render so graph always uses latest focus/filter state
  nodeColorFnRef.current = function nodeColorFn(node) {
    const focus  = focusRef.current
    const filter = filterRef.current

    if (focus?.impactZone) {
      const depth = focus.impactZone.get(node.id)
      if (depth === undefined) return withAlpha(node._baseColor ?? '#6b7280', DIM_OPACITY)
      const IMPACT_COLORS = ['#fbbf24', '#f97316', '#f59e0b', '#fde68a']
      return IMPACT_COLORS[Math.min(depth, IMPACT_COLORS.length - 1)]
    }

    if (focus) {
      if (node.id !== focus.node && !focus.neighbors.has(node.id)) {
        return withAlpha(node._baseColor ?? '#6b7280', DIM_OPACITY)
      }
      return node._baseColor ?? '#6b7280'
    }

    if (filter && !filter.has(node.id)) {
      return withAlpha(node._baseColor ?? '#6b7280', FILTER_OPACITY)
    }

    return node._baseColor ?? '#6b7280'
  }

  linkColorFnRef.current = function linkColorFn(link) {
    const focus  = focusRef.current
    const filter = filterRef.current
    const src = typeof link.source === 'object' ? link.source.id : link.source
    const tgt = typeof link.target === 'object' ? link.target.id : link.target

    if (focus?.impactZone) {
      if (!focus.impactZone.has(src) || !focus.impactZone.has(tgt)) return 'rgba(51,65,85,0)'
      return link._baseColor ?? `rgba(51,65,85,${EDGE_OPACITY})`
    }
    if (focus) {
      if (src !== focus.node && tgt !== focus.node) return 'rgba(51,65,85,0)'
      return link._baseColor ?? `rgba(51,65,85,${EDGE_OPACITY})`
    }
    if (filter && !filter.has(src) && !filter.has(tgt)) return 'rgba(51,65,85,0)'

    return link._baseColor ?? `rgba(51,65,85,${EDGE_OPACITY})`
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  const destroy = useCallback(() => {
    console.log('[3D] destroy — had graph:', !!graphRef.current)
    if (graphRef.current) {
      try {
        graphRef.current.pauseAnimation()
        graphRef.current._destructor()
      } catch { /* ignore disposal errors */ }
      graphRef.current = null
    }
    nodesRef.current  = []
    nodeMapRef.current = {}
    focusRef.current  = null
    filterRef.current = null
  }, [])

  useEffect(() => () => destroy(), [destroy])

  // ── Graph construction ─────────────────────────────────────────────────────

  const ensureGraph = useCallback(() => {
    if (graphRef.current) return graphRef.current
    const container = containerRef.current
    if (!container) {
      console.log('[3D] ensureGraph — no container ref')
      return null
    }

    // 3d-force-graph reads clientWidth/clientHeight at init — must be > 0
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) {
      console.log('[3D] ensureGraph — container 0×0, will retry')
      return null
    }

    console.log(`[3D] ensureGraph — creating ForceGraph3D in ${w}×${h} container`)

    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--cs-graph-bg').trim() || '#0f172a'

    const g = ForceGraph3D({ antialias: true, alpha: false })(container)
      .backgroundColor(bg)
      .nodeId('id')
      .nodeLabel('')  // disable built-in hover tooltip — we have React tooltips
      .nodeColor(node => nodeColorFnRef.current(node))
      .nodeVal('_size')
      .nodeThreeObjectExtend(true)  // keep default sphere + add label sprite
      .nodeThreeObject(node => {
        const sprite = new SpriteText(node.label ?? node.id)
        sprite.color = nodeColorFnRef.current(node)
        sprite.textHeight = 3
        sprite.fontFace = 'monospace'
        sprite.strokeWidth = 0
        sprite.backgroundColor = 'rgba(0,0,0,0)'
        // Offset to the right of the sphere — sphere radius = cbrt(_size) * nodeRelSize(4)
        const sphereR = Math.cbrt(node._size ?? 4) * 4
        sprite.position.set(sphereR + LABEL_OFFSET, 0, 0)
        node._sprite = sprite  // store ref so setFilter/focus can update color
        return sprite
      })
      .linkColor(link => linkColorFnRef.current(link))
      .linkWidth(0.5)
      .linkDirectionalArrowLength(0)
      .linkOpacity(1)
      .onNodeHover((node) => {
        if (node) {
          const attrs = nodeMapRef.current[node.id]
          onEnterRef.current?.(node.id, attrs ?? node)
        } else {
          onLeaveRef.current?.()
        }
      })
      .onNodeClick((node, event) => {
        const now = Date.now()
        const attrs = nodeMapRef.current[node.id]

        // Double-click detection (two clicks within 300 ms)
        if (now - lastClickTime.current < 300) {
          onDblClickRef.current?.(node.id, attrs ?? node)
          lastClickTime.current = 0
          return
        }
        lastClickTime.current = now

        // Focus camera
        const dist = 120
        const distRatio = 1 + dist / Math.hypot(node.x ?? 1, node.y ?? 1, node.z ?? 1)
        graphRef.current?.cameraPosition(
          { x: (node.x ?? 0) * distRatio, y: (node.y ?? 0) * distRatio, z: (node.z ?? 0) * distRatio },
          node,
          600
        )

        onClickRef.current?.(node.id, attrs ?? node)
      })

    graphRef.current = g
    console.log('[3D] ensureGraph — ForceGraph3D instance created')
    return g
  }, [containerRef]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Load graph data. nodes = [{ key, attributes }], edges = [{ source, target }]
   * rootKey is ignored for layout (force-directed), extraEdges optional.
   */
  const load = useCallback((nodes, edges, rootKey, extraEdges) => {
    // If the container isn't laid out yet (0×0), retry on next animation frame
    if (!ensureGraph()) {
      console.log('[3D] load — container not ready, scheduling rAF retry')
      requestAnimationFrame(() => load(nodes, edges, rootKey, extraEdges))
      return
    }
    const g = ensureGraph()
    console.log(`[3D] load — ${nodes.length} nodes, ${edges.length} tree edges, ${extraEdges?.length ?? 0} extra edges, layoutMode=${layoutMode}, rootKey=${rootKey}`)

    focusRef.current  = null
    filterRef.current = null

    // Build internal node objects
    const gNodes = nodes.map(({ key, attributes }) => {
      const node = {
        id: key,
        label: attributes.label ?? key,
        _baseColor: attributes.color ?? nodeColor(attributes),
        _size: attributes.size ?? nodeSize(attributes),
        // Copy all attributes for tooltip / callbacks
        ...attributes,
      }
      // Depth-pinned z-axis for FileMap
      if (layoutMode === 'depthPinned' && attributes.depth != null) {
        node.fz = -(attributes.depth * opts.zDepthScale)
      }
      return node
    })

    // Build flat node-attr map for callback lookups
    const nodeMap = {}
    for (const n of gNodes) nodeMap[n.id] = n
    nodesRef.current  = gNodes
    nodeMapRef.current = nodeMap

    // Build link objects
    const allEdges = [...edges, ...(extraEdges ?? [])]
    const gLinks = allEdges.map(({ source, target }) => ({
      source,
      target,
      _baseColor: `rgba(51,65,85,${EDGE_OPACITY})`,
    }))

    if (layoutMode === 'depthPinned') {
      // Pin z per depth level before adding data so the force is active from the start
      g.d3Force('z', forceZ(n => n.fz ?? 0).strength(opts.zStrength))
    } else {
      g.d3Force('z', null) // clear any leftover z-force from a previous load
    }
    // Tune charge, link distance and simulation speed
    g.d3Force('charge')?.strength(opts.chargeStrength)
    g.d3Force('link')?.distance(opts.linkDistance).strength(opts.linkStrength)
    g.d3AlphaDecay(opts.alphaDecay)
    g.d3VelocityDecay(opts.velocityDecay)

    // Set data — simulation starts animating immediately
    g.graphData({ nodes: gNodes, links: gLinks })

    // Lazy loading: fire onReady after the first rendered frame so the graph
    // is visible while the force simulation is still running.
    // onEngineStop fires later when the simulation fully settles.
    let _readyFired = false
    requestAnimationFrame(() => {
      if (_readyFired) return
      _readyFired = true
      console.log(`[3D] first frame rendered → onReady(${gNodes.length})`)
      onReadyRef.current?.(gNodes.length)
    })

    // Fallback: if rAF somehow never ran (hidden tab etc.)
    const readyTimer = setTimeout(() => {
      if (!_readyFired) {
        console.warn('[3D] onReady fallback timer fired')
        _readyFired = true
        onReadyRef.current?.(gNodes.length)
      }
    }, 2000)

    g.onEngineStop(() => {
      clearTimeout(readyTimer)
      if (!_readyFired) {
        // Simulation settled before rAF — fire now
        _readyFired = true
        onReadyRef.current?.(gNodes.length)
      }
      console.log(`[3D] onEngineStop — simulation settled`)

      // Pan camera to root node once simulation has settled and coordinates are final
      if (rootKey) {
        const root = nodeMapRef.current[rootKey]
        if (root && root.x != null) {
          const dist = 400
          const distRatio = 1 + dist / Math.hypot(root.x || 1, root.y || 1, root.z || 1)
          g.cameraPosition(
            { x: (root.x || 0) * distRatio, y: (root.y || 0) * distRatio, z: (root.z || 0) * distRatio },
            root,
            800
          )
          console.log(`[3D] onEngineStop — camera focused on root "${rootKey}"`)
        }
      }
    })
  }, [ensureGraph, layoutMode])

  const focusNode = useCallback((key) => {
    const g = graphRef.current
    if (!g) return
    const node = nodeMapRef.current[key]
    if (!node) return
    const dist = 120
    const distRatio = 1 + dist / Math.hypot(node.x ?? 1, node.y ?? 1, node.z ?? 1)
    g.cameraPosition(
      { x: (node.x ?? 0) * distRatio, y: (node.y ?? 0) * distRatio, z: (node.z ?? 0) * distRatio },
      node,
      600
    )
  }, [])

  /** Sync sprite label colors to match the current node color (after focus/filter changes). */
  const syncSpriteColors = useCallback(() => {
    for (const node of nodesRef.current) {
      if (node._sprite) node._sprite.color = nodeColorFnRef.current(node)
    }
  }, [])

  const getNodes = useCallback(() => snapshotNodes(nodesRef.current), [])

  const setFilter = useCallback((keys) => {
    filterRef.current = keys ?? null
    graphRef.current?.refresh()
    syncSpriteColors()
  }, [syncSpriteColors])

  /**
   * Update node attributes in-place (used by RuntimeHeatmap for SSE streaming).
   */
  const patchNodes = useCallback((updates) => {
    const g = graphRef.current
    if (!g) return
    const data = g.graphData()
    for (const { key, attributes } of updates) {
      const node = data.nodes.find(n => n.id === key)
      if (!node) continue
      Object.assign(node, attributes)
      if (attributes.color) node._baseColor = attributes.color
      if (attributes.size)  node._size = attributes.size
      // Update nodeMap too
      if (nodeMapRef.current[key]) Object.assign(nodeMapRef.current[key], attributes)
    }
    g.graphData(data)
  }, [])

  /**
   * Add edges after initial load (used by DependencyHeatmap for import edges).
   */
  const addEdges = useCallback((edges) => {
    const g = graphRef.current
    if (!g) return
    const data = g.graphData()
    const existingPairs = new Set(data.links.map(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source
      const t = typeof l.target === 'object' ? l.target.id : l.target
      return `${s}->${t}`
    }))
    const nodeIds = new Set(data.nodes.map(n => n.id))
    const newLinks = []
    for (const { source, target } of edges) {
      const key = `${source}->${target}`
      if (!existingPairs.has(key) && nodeIds.has(source) && nodeIds.has(target)) {
        newLinks.push({ source, target, _baseColor: `rgba(71,85,105,${EDGE_OPACITY})` })
        existingPairs.add(key)
      }
    }
    if (newLinks.length) {
      g.graphData({ nodes: data.nodes, links: [...data.links, ...newLinks] })
    }
  }, [])

  const refreshTheme = useCallback(() => {
    const g = graphRef.current
    if (!g) return
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--cs-graph-bg').trim() || '#0f172a'
    g.backgroundColor(bg)
    g.refresh()
    syncSpriteColors()
  }, [syncSpriteColors])

  return { load, focusNode, getNodes, setFilter, patchNodes, addEdges, refreshTheme }
}
