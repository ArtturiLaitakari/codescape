import { useEffect, useRef, useState, useCallback } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'

const EXT_COLORS = {
  jsx: '#06b6d4',
  tsx: '#06b6d4',
  js: '#f59e0b',
  ts: '#f59e0b',
  css: '#ec4899',
  json: '#10b981',
  md: '#f97316',
  html: '#a78bfa',
  svg: '#fb7185',
  png: '#94a3b8',
  other: '#6b7280',
}

function nodeColor(attrs) {
  if (attrs.kind === 'root') return '#8b5cf6'
  if (attrs.kind === 'dir') return '#3b82f6'
  if (attrs.kind === 'dir-empty') return '#1e3a5f'
  return EXT_COLORS[attrs.ext] ?? EXT_COLORS.other
}

function nodeSize(attrs) {
  if (attrs.kind === 'root') return 18
  if (attrs.kind === 'dir') return 12
  if (attrs.kind === 'dir-empty') return 5
  return 6
}

function nodeBorderColor(attrs) {
  if (attrs.kind === 'dir-empty') return '#3b82f6'
  return null
}

// Reingold–Tilford radial layout — guarantees no edge crossings.
// Two passes:
//   1) Bottom-up: each node claims an angular width = max(sum of children, minAngle at its ring)
//   2) Top-down: place each subtree inside its allocated wedge
function radialTreeLayout(graph, rootKey, levelRadius = 90, nodeGap = 22) {
  const children = {}
  const depth = {}
  graph.forEachNode((n) => { children[n] = [] })
  graph.forEachEdge((_e, _a, source, target) => {
    if (children[source]) children[source].push(target)
  })

  // Compute depth via BFS from root
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
  // A leaf at depth d needs angle = nodeGap / radius(d) so neighbours don't touch
  const angleWidth = {}
  function calcWidth(node) {
    const d = depth[node] ?? 0
    const r = Math.max(levelRadius, (d + 1) * levelRadius)
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

  // Pass 2: place each node at the centre of its allocated wedge
  const pos = { [rootKey]: { x: 0, y: 0 } }
  function place(node, angleStart) {
    const ch = children[node] || []
    let a = angleStart
    for (const child of ch) {
      const w = angleWidth[child]
      const mid = a + w / 2
      // Deterministic jitter from node key — radial only, stays inside wedge → planar
      let h = 0
      for (let i = 0; i < child.length; i++) h = (h * 31 + child.charCodeAt(i)) | 0
      const rJitter = ((h & 0xff) / 255 - 0.5) * levelRadius * 0.6   // ±30% of level
      const aJitter = (((h >> 8) & 0xff) / 255 - 0.5) * w * 0.4      // ±20% of own wedge
      const r = (depth[child] + 1) * levelRadius + rJitter
      const angle = mid + aJitter
      pos[child] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
      place(child, a)
      a += w
    }
  }
  // Root spans full 360°; deeper nodes are constrained by their parent's wedge
  const totalChildWidth = (children[rootKey] || []).reduce((s, c) => s + angleWidth[c], 0) || 1
  const targetSpan = 2 * Math.PI
  const scale = targetSpan / Math.max(totalChildWidth, targetSpan)
  if (totalChildWidth > targetSpan) {
    function rescale(node) {
      angleWidth[node] *= scale
      for (const c of children[node] || []) rescale(c)
    }
    for (const c of children[rootKey] || []) rescale(c)
  }
  const used = (children[rootKey] || []).reduce((s, c) => s + angleWidth[c], 0)
  place(rootKey, -used / 2)

  graph.forEachNode((n) => {
    const p = pos[n] ?? { x: 0, y: 0 }
    graph.setNodeAttribute(n, 'x', p.x)
    graph.setNodeAttribute(n, 'y', p.y)
  })
}

// Grid-accelerated separation: O(n) instead of O(n²×iters)
function separateNodes(graph, padding = 6, passes = 5, sizeScale = 1) {
  const CELL = 30

  for (let pass = 0; pass < passes; pass++) {
    const grid = new Map()
    const cellOf = {}
    graph.forEachNode((n) => {
      const x = graph.getNodeAttribute(n, 'x')
      const y = graph.getNodeAttribute(n, 'y')
      const cx = Math.floor(x / CELL)
      const cy = Math.floor(y / CELL)
      const key = `${cx},${cy}`
      cellOf[n] = { cx, cy }
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(n)
    })

    graph.forEachNode((a) => {
      const ax = graph.getNodeAttribute(a, 'x')
      const ay = graph.getNodeAttribute(a, 'y')
      const sa = graph.getNodeAttribute(a, 'size') * sizeScale
      const { cx, cy } = cellOf[a]

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighbours = grid.get(`${cx + dx},${cy + dy}`)
          if (!neighbours) continue
          for (const b of neighbours) {
            if (b <= a) continue
            const bx = graph.getNodeAttribute(b, 'x')
            const by = graph.getNodeAttribute(b, 'y')
            const sb = graph.getNodeAttribute(b, 'size') * sizeScale
            const minDist = sa + sb + padding
            const ddx = bx - ax
            const ddy = by - ay
            const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01
            if (dist < minDist) {
              const push = (minDist - dist) / 2
              const nx = (ddx / dist) * push
              const ny = (ddy / dist) * push
              graph.setNodeAttribute(a, 'x', ax - nx)
              graph.setNodeAttribute(a, 'y', ay - ny)
              graph.setNodeAttribute(b, 'x', bx + nx)
              graph.setNodeAttribute(b, 'y', by + ny)
            }
          }
        }
      }
    })
  }
}
export default function FileMap() {
  const containerRef = useRef(null)
  const sigmaRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [hovered, setHovered] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [projectPath, setProjectPath] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [activeRoot, setActiveRoot] = useState(null)

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setHovered(null)

    sigmaRef.current?.kill()
    sigmaRef.current = null

    const url = targetPath ? `/api/filemap?path=${encodeURIComponent(targetPath)}` : '/api/filemap'
    let cancelled = false

    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body.error) throw new Error(body.error)

        const { nodes, edges, root } = body
        setActiveRoot(root)
        setInputValue(root)

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
          if (graph.hasNode(source) && graph.hasNode(target)) {
            if (!graph.hasEdge(source, target)) {
              graph.addDirectedEdge(source, target, { color: '#334155', size: 1 })
            }
          }
        })

        radialTreeLayout(graph, '__root__')
        // No separateNodes here — the layout already guarantees no overlaps

        if (cancelled) return

        // Store base positions — camera listener reads these
        const basePositions = {}
        graph.forEachNode((node) => {
          basePositions[node] = {
            x: graph.getNodeAttribute(node, 'x'),
            y: graph.getNodeAttribute(node, 'y'),
          }
        })

        // Shared mutable ratio — set by camera listener, read by nodeReducer
        const cam = { ratio: 1 }

        let sigmaInstance = new Sigma(graph, containerRef.current, {
          renderEdgeLabels: false,
          defaultEdgeColor: '#334155',
          labelFont: 'monospace',
          labelSize: 11,
          labelColor: { color: '#e2e8f0' },
          minCameraRatio: 0.001,
          maxCameraRatio: 100,
          nodeReducer: (node, data) => {
            const scale = Math.min(Math.pow(1 / cam.ratio, 0.4), 0.4)
            return { ...data, size: data.size * scale }
          },
        })
        sigmaRef.current = sigmaInstance

        // Spread nodes in graph-space as user zooms in, then re-separate.
        // ratio < 1 = zoomed in → spread > 1 → nodes further apart.
        let lastRatio = sigmaInstance.getCamera().ratio
        // Threshold: only re-run when ratio changes by >5% to avoid per-pixel work
        const THRESHOLD = 0.05

        function applySpread(ratio) {
          const spread = 1 / ratio
          graph.forEachNode((node) => {
            const base = basePositions[node]
            graph.setNodeAttribute(node, 'x', base.x * spread)
            graph.setNodeAttribute(node, 'y', base.y * spread)
          })
          // Pure radial scaling preserves planarity — no separateNodes
          sigmaInstance.refresh({ skipIndexation: false })
        }

        sigmaInstance.getCamera().on('updated', () => {
          const ratio = sigmaInstance.getCamera().ratio
          cam.ratio = ratio
          // Trigger on relative change, not absolute — works at all zoom levels
          if (Math.abs(ratio - lastRatio) / lastRatio < THRESHOLD) return
          lastRatio = ratio
          applySpread(ratio)
        })

        sigmaRef.current.on('enterNode', ({ node }) => {
          setHovered({ key: node, ...graph.getNodeAttributes(node) })
        })
        sigmaRef.current.on('leaveNode', () => setHovered(null))

        setNodeCount(graph.order)
        setStatus('ready')
      })
      .catch((e) => {
        if (!cancelled) setStatus(`error: ${e.message}`)
      })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const cleanup = loadGraph('')
    return () => {
      cleanup?.()
      sigmaRef.current?.kill()
      sigmaRef.current = null
    }
  }, [loadGraph])

  function handleSubmit(e) {
    e.preventDefault()
    const val = inputValue.trim()
    if (!val) return
    setProjectPath(val)
    loadGraph(val)
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0f172a' }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        background: 'rgba(15,23,42,0.9)',
        borderBottom: '1px solid #1e293b', backdropFilter: 'blur(6px)',
      }}>
        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px' }}>
          <span style={{ color: '#8b5cf6', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>
            koodikartta
          </span>
          <span style={{ color: '#475569', fontSize: 12 }}>File Map</span>
          {status === 'ready' && (
            <span style={{ color: '#64748b', fontSize: 12, marginLeft: 'auto' }}>
              {nodeCount} nodes · scroll to zoom · drag to pan
            </span>
          )}
          {status === 'loading' && (
            <span style={{ color: '#64748b', fontSize: 12, marginLeft: 'auto' }}>scanning…</span>
          )}
          {status.startsWith('error') && (
            <span style={{ color: '#f87171', fontSize: 12, marginLeft: 'auto' }}>{status}</span>
          )}
        </div>

        {/* Path input row */}
        <form onSubmit={handleSubmit} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px 10px',
        }}>
          <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>📁</span>
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={activeRoot ?? 'Liitä projektin absoluuttinen polku…'}
            spellCheck={false}
            style={{
              flex: 1,
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '5px 10px',
              fontFamily: 'monospace',
              fontSize: 12,
              color: '#e2e8f0',
              outline: 'none',
            }}
            onFocus={(e) => e.target.style.borderColor = '#8b5cf6'}
            onBlur={(e) => e.target.style.borderColor = '#334155'}
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            style={{
              background: '#8b5cf6',
              border: 'none',
              borderRadius: 6,
              padding: '5px 14px',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              opacity: status === 'loading' ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            Avaa
          </button>
        </form>
      </div>

      {/* Sigma canvas — push down past header (≈72px) */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, paddingTop: 72 }} />

      {/* Hover tooltip */}
      {hovered && (
        <div style={{
          position: 'absolute', bottom: 16, left: 16, zIndex: 10,
          background: 'rgba(15,23,42,0.95)', border: '1px solid #1e293b',
          borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace',
          fontSize: 12, color: '#e2e8f0', pointerEvents: 'none',
        }}>
          <div style={{ color: nodeColor(hovered), fontWeight: 700 }}>{hovered.label}</div>
          <div style={{ color: '#64748b', marginTop: 2 }}>
            {hovered.kind === 'file' ? `.${hovered.ext}` : hovered.kind === 'dir-empty' ? 'dir (empty)' : hovered.kind}
            {' · depth '}{hovered.depth}
          </div>
          <div style={{ color: '#475569', marginTop: 2, maxWidth: 280, wordBreak: 'break-all' }}>
            {hovered.key}
          </div>
        </div>
      )}

      {/* Legend */}
      {status === 'ready' && (
        <div style={{
          position: 'absolute', bottom: 16, right: 16, zIndex: 10,
          background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b',
          borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace', fontSize: 11,
        }}>
          {[
            ['root', '#8b5cf6'],
            ['dir', '#3b82f6'],
            ['dir (empty)', '#1e3a5f', '#3b82f6'],
            ['jsx/tsx', '#06b6d4'],
            ['js/ts', '#f59e0b'],
            ['css', '#ec4899'],
            ['json', '#10b981'],
            ['md', '#f97316'],
          ].map(([label, color, border]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, border: border ? `1.5px solid ${border}` : 'none', boxSizing: 'border-box', display: 'inline-block' }} />
              <span style={{ color: '#94a3b8' }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
