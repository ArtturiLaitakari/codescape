import { useEffect, useRef, useCallback } from 'react'
import ForceGraph3D from '3d-force-graph'
import { forceZ, forceRadial } from 'd3-force-3d'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import SpriteText from 'three-spritetext'

// ── Constants ─────────────────────────────────────────────────────────────────
const DIM_OPACITY     = 0.08
const FILTER_OPACITY  = 0.06
const EDGE_OPACITY    = 0.3
const LABEL_OFFSET    = 14
const MISSING_COLOR   = '#6b7280'
const HIDDEN_LINK     = 'rgba(51,65,85,0)'
const TREE_LINK_COLOR = `rgba(51,65,85,${EDGE_OPACITY})`
const EXTRA_LINK_COLOR = `rgba(71,85,105,${EDGE_OPACITY})`
const DEFAULT_BG      = '#0f172a'
const IMPACT_COLORS   = ['#fbbf24', '#f97316', '#f59e0b', '#fde68a']
const DBL_CLICK_MS    = 300
const READY_FALLBACK_MS = 2000
const CAMERA_DIST_CLICK = 120
const CAMERA_DIST_ROOT  = 400
const CAMERA_DUR_CLICK  = 600
const CAMERA_DUR_ROOT   = 800

export const DEFAULT_LAYOUT_OPTIONS = {
  zDepthScale:    220,
  zStrength:      1,
  orbitRadius:    160,
  radialStrength: 0.9,
  chargeStrength: -120,
  linkDistance:   40,
  linkStrength:   0.5,
  alphaDecay:     0.0228,
  velocityDecay:  0.4,
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

const baseColor = (node) => node._baseColor ?? MISSING_COLOR

const linkEnd = (e) => (typeof e === 'object' ? e.id : e)

function hexToRGB(hex) {
  const h = hex.replace('#', '')
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`
}

const withAlpha = (hex, alpha) => `rgba(${hexToRGB(hex)},${alpha})`

/** Distribute N points evenly on a sphere of radius r using the Fibonacci lattice. */
function fibonacciSphere(n, r) {
  const phi = Math.PI * (Math.sqrt(5) - 1)
  const pts = []
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(n - 1, 1)) * 2
    const rr = Math.sqrt(1 - y * y)
    const theta = phi * i
    pts.push({ x: rr * Math.cos(theta) * r, y: y * r, z: rr * Math.sin(theta) * r })
  }
  return pts
}

const snapshotNodes = (raw) =>
  raw.map(({ id, label, kind, ext }) => ({ key: id, label, kind, ext }))

const readBgColor = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--cs-graph-bg').trim() || DEFAULT_BG

/** Pan camera so it ends up `dist` units from `node` along its current direction. */
function panCameraTo(g, node, dist, duration) {
  if (!g || !node || node.x == null) return
  const ratio = 1 + dist / Math.hypot(node.x || 1, node.y || 1, node.z || 1)
  g.cameraPosition(
    { x: (node.x || 0) * ratio, y: (node.y || 0) * ratio, z: (node.z || 0) * ratio },
    node,
    duration,
  )
}

/** Compute appearance color for one node given the current focus/filter state. */
function colorForNode(node, focus, filter) {
  if (focus?.impactZone) {
    const depth = focus.impactZone.get(node.id)
    return depth === undefined
      ? withAlpha(baseColor(node), DIM_OPACITY)
      : IMPACT_COLORS[Math.min(depth, IMPACT_COLORS.length - 1)]
  }
  if (focus) {
    return node.id === focus.node || focus.neighbors.has(node.id)
      ? baseColor(node)
      : withAlpha(baseColor(node), DIM_OPACITY)
  }
  if (filter && !filter.has(node.id)) {
    return withAlpha(baseColor(node), FILTER_OPACITY)
  }
  return baseColor(node)
}

/** Compute appearance color for one link given the current focus/filter state. */
function colorForLink(link, focus, filter) {
  const src = linkEnd(link.source)
  const tgt = linkEnd(link.target)
  const visible = link._baseColor ?? TREE_LINK_COLOR

  if (focus?.impactZone) {
    return focus.impactZone.has(src) && focus.impactZone.has(tgt) ? visible : HIDDEN_LINK
  }
  if (focus) {
    return src === focus.node || tgt === focus.node ? visible : HIDDEN_LINK
  }
  if (filter && !filter.has(src) && !filter.has(tgt)) return HIDDEN_LINK
  return visible
}

/** Build a node sprite (label) for a graph node. Caller assigns initial color. */
function createNodeSprite(node, color) {
  const sprite = new SpriteText(node.label ?? node.id)
  sprite.color = color
  sprite.textHeight = 3
  sprite.fontFace = 'monospace'
  sprite.strokeWidth = 0
  sprite.backgroundColor = 'rgba(0,0,0,0)'
  // Sphere radius = cbrt(_size) * nodeRelSize(=4)
  const sphereR = Math.cbrt(node._size ?? 4) * 4
  sprite.position.set(sphereR + LABEL_OFFSET, 0, 0)
  return sprite
}

/**
 * Pre-position nodes for orbital layout: each depth level lives on a Fibonacci
 * sphere of radius `depth * orbitRadius`. Mutates nodes in place.
 */
function prepositionOrbital(gNodes, orbitRadius) {
  const byDepth = {}
  for (const n of gNodes) {
    const d = n.depth ?? 0
    ;(byDepth[d] ??= []).push(n)
  }
  for (const [depthStr, depthNodes] of Object.entries(byDepth)) {
    const d = Number(depthStr)
    if (d === 0) {
      for (const n of depthNodes) { n.x = 0; n.y = 0; n.z = 0 }
      continue
    }
    const pts = fibonacciSphere(depthNodes.length, d * orbitRadius)
    depthNodes.forEach((n, i) => Object.assign(n, pts[i]))
  }
}

/** Configure d3 forces and per-node fixed attributes for the chosen layout mode. */
function applyLayout(g, gNodes, mode, opts) {
  if (mode === 'depthPinned') {
    for (const n of gNodes) {
      if (n.depth != null) n.fz = -(n.depth * opts.zDepthScale)
    }
    g.d3Force('z', forceZ((n) => n.fz ?? 0).strength(opts.zStrength))
    g.d3Force('radial', null)
  } else if (mode === 'orbital') {
    prepositionOrbital(gNodes, opts.orbitRadius)
    g.d3Force(
      'radial',
      forceRadial((n) => (n.depth ?? 0) * opts.orbitRadius, 0, 0, 0).strength(opts.radialStrength),
    )
    g.d3Force('z', null)
  } else {
    g.d3Force('z', null)
    g.d3Force('radial', null)
  }
  g.d3Force('charge')?.strength(opts.chargeStrength)
  g.d3Force('link')?.distance(opts.linkDistance).strength(opts.linkStrength)
  g.d3AlphaDecay(opts.alphaDecay)
  g.d3VelocityDecay(opts.velocityDecay)
}

/**
 * Fire `cb` exactly once: on next animation frame, on simulation stop, or after
 * a fallback timeout — whichever comes first. Returns the timer so callers can
 * clear it from `onEngineStop`.
 */
function scheduleReady(cb) {
  let fired = false
  const fire = () => { if (!fired) { fired = true; cb() } }
  requestAnimationFrame(fire)
  const timer = setTimeout(fire, READY_FALLBACK_MS)
  return { fire, timer }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for useSigmaGraph that renders with 3d-force-graph.
 * Public API is identical to useSigmaGraph so views can switch by import.
 */
export function useForceGraph3D(containerRef, {
  onEnterNode, onLeaveNode, onReady, getImpactZone,
  onClickNode, onDoubleClickNode,
  layoutMode = 'free', layoutOptions = {},
} = {}) {
  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...layoutOptions }

  const graphRef    = useRef(null)
  const nodesRef    = useRef([])
  const nodeMapRef  = useRef({})
  const focusRef    = useRef(null)   // { node, neighbors: Set, impactZone: Map|null }
  const filterRef   = useRef(null)   // Set<string> | null
  const lastClickAt = useRef(0)

  // Always-current callback access (avoids re-creating the graph instance)
  const cbRef = useRef({})
  cbRef.current = { onEnterNode, onLeaveNode, onClickNode, onDoubleClickNode, onReady, getImpactZone }

  // Color closures — refs so the graph always uses the latest focus/filter state
  const nodeColorFnRef = useRef(null)
  const linkColorFnRef = useRef(null)
  nodeColorFnRef.current = (n) => colorForNode(n, focusRef.current, filterRef.current)
  linkColorFnRef.current = (l) => colorForLink(l, focusRef.current, filterRef.current)

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  const destroy = useCallback(() => {
    if (graphRef.current) {
      try {
        graphRef.current.pauseAnimation()
        graphRef.current._destructor()
      } catch { /* ignore disposal errors */ }
      graphRef.current = null
    }
    nodesRef.current = []
    nodeMapRef.current = {}
    focusRef.current = null
    filterRef.current = null
  }, [])

  useEffect(() => () => destroy(), [destroy])

  // ── Graph construction ────────────────────────────────────────────────────

  const ensureGraph = useCallback(() => {
    if (graphRef.current) return graphRef.current
    const container = containerRef.current
    if (!container || container.clientWidth === 0 || container.clientHeight === 0) return null

    const g = ForceGraph3D({ antialias: true, alpha: false })(container)
      .backgroundColor(readBgColor())
      .nodeId('id')
      .nodeLabel('') // disable built-in tooltip — React tooltips handle hover UI
      .nodeColor((node) => nodeColorFnRef.current(node))
      .nodeVal('_size')
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((node) => {
        const sprite = createNodeSprite(node, nodeColorFnRef.current(node))
        node._sprite = sprite
        return sprite
      })
      .linkColor((link) => linkColorFnRef.current(link))
      .linkWidth(0.5)
      .linkDirectionalArrowLength(0)
      .linkOpacity(1)
      .onNodeHover((node) => {
        if (node) cbRef.current.onEnterNode?.(node.id, nodeMapRef.current[node.id] ?? node)
        else cbRef.current.onLeaveNode?.()
      })
      .onNodeClick((node) => {
        const now = Date.now()
        const attrs = nodeMapRef.current[node.id] ?? node
        if (now - lastClickAt.current < DBL_CLICK_MS) {
          cbRef.current.onDoubleClickNode?.(node.id, attrs)
          lastClickAt.current = 0
          return
        }
        lastClickAt.current = now
        panCameraTo(graphRef.current, node, CAMERA_DIST_CLICK, CAMERA_DUR_CLICK)
        cbRef.current.onClickNode?.(node.id, attrs)
      })

    graphRef.current = g
    return g
  }, [containerRef])

  // ── Public API ────────────────────────────────────────────────────────────

  const load = useCallback((nodes, edges, rootKey, extraEdges) => {
    if (!ensureGraph()) {
      // Container not laid out yet — retry next frame
      requestAnimationFrame(() => load(nodes, edges, rootKey, extraEdges))
      return
    }
    const g = graphRef.current
    focusRef.current = null
    filterRef.current = null

    // Build node objects
    const gNodes = nodes.map(({ key, attributes }) => ({
      id: key,
      label: attributes.label ?? key,
      _baseColor: attributes.color ?? nodeColor(attributes),
      _size: attributes.size ?? nodeSize(attributes),
      ...attributes,
    }))
    const nodeMap = Object.fromEntries(gNodes.map((n) => [n.id, n]))
    nodesRef.current = gNodes
    nodeMapRef.current = nodeMap

    // Build link objects — drop edges whose endpoints aren't in the node set,
    // otherwise d3-force throws "node not found".
    const nodeIds = new Set(gNodes.map((n) => n.id))
    const gLinks = [...edges, ...(extraEdges ?? [])]
      .filter(({ source, target }) => nodeIds.has(source) && nodeIds.has(target))
      .map(({ source, target }) => ({ source, target, _baseColor: TREE_LINK_COLOR }))

    applyLayout(g, gNodes, layoutMode, opts)
    g.graphData({ nodes: gNodes, links: gLinks })

    // Lazy ready: fire as soon as we render the first frame, fall back to a timer.
    const onReadyCb = () => cbRef.current.onReady?.(gNodes.length)
    const ready = scheduleReady(onReadyCb)

    g.onEngineStop(() => {
      clearTimeout(ready.timer)
      ready.fire()
      if (rootKey) panCameraTo(g, nodeMapRef.current[rootKey], CAMERA_DIST_ROOT, CAMERA_DUR_ROOT)
    })
  }, [ensureGraph, layoutMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const focusNode = useCallback((key) => {
    panCameraTo(graphRef.current, nodeMapRef.current[key], CAMERA_DIST_CLICK, CAMERA_DUR_CLICK)
  }, [])

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
   * Update node attributes in-place. Uses g.refresh() (visual-only) so the
   * simulation isn't reheated on every streaming batch — graphData() would
   * restart alpha=1 and prevent nodes from ever settling.
   */
  const patchNodes = useCallback((updates) => {
    const g = graphRef.current
    if (!g) return
    const { nodes } = g.graphData()
    for (const { key, attributes } of updates) {
      const node = nodes.find((n) => n.id === key)
      if (!node) continue
      Object.assign(node, attributes)
      if (attributes.color) node._baseColor = attributes.color
      if (attributes.size)  node._size = attributes.size
      if (nodeMapRef.current[key]) Object.assign(nodeMapRef.current[key], attributes)
    }
    g.refresh()
  }, [])

  const addEdges = useCallback((edges) => {
    const g = graphRef.current
    if (!g) return
    const data = g.graphData()
    const nodeIds = new Set(data.nodes.map((n) => n.id))
    const seen = new Set(data.links.map((l) => `${linkEnd(l.source)}->${linkEnd(l.target)}`))
    const newLinks = []
    for (const { source, target } of edges) {
      const key = `${source}->${target}`
      if (seen.has(key) || !nodeIds.has(source) || !nodeIds.has(target)) continue
      newLinks.push({ source, target, _baseColor: EXTRA_LINK_COLOR })
      seen.add(key)
    }
    if (newLinks.length) g.graphData({ nodes: data.nodes, links: [...data.links, ...newLinks] })
  }, [])

  const refreshTheme = useCallback(() => {
    const g = graphRef.current
    if (!g) return
    g.backgroundColor(readBgColor())
    g.refresh()
    syncSpriteColors()
  }, [syncSpriteColors])

  return { load, focusNode, getNodes, setFilter, patchNodes, addEdges, refreshTheme }
}
