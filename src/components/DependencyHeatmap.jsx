import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import { fanInColor, fanInSize, HEATMAP_LEGEND_STOPS } from '../lib/heatmap-colors.js'

const HEADER_H = 72

export default function DependencyHeatmap() {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [hovered, setHovered] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [inputValue, setInputValue] = useState('')
  const [activeRoot, setActiveRoot] = useState(null)

  const onEnterNode = useCallback((key, attrs) => setHovered({ key, ...attrs }), [])
  const onLeaveNode = useCallback(() => setHovered(null), [])
  const onReady = useCallback((count) => { setNodeCount(count); setStatus('ready') }, [])

  const { load } = useSigmaGraph(containerRef, { onEnterNode, onLeaveNode, onReady })

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setHovered(null)
    let cancelled = false
    const url = targetPath ? `/api/depgraph?path=${encodeURIComponent(targetPath)}` : '/api/depgraph'
    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body.error) throw new Error(body.error)
        setActiveRoot(body.root)
        setInputValue(body.root)

        // Compute max fanIn so we can normalise the colour scale
        const maxFanIn = body.nodes.reduce((m, n) => Math.max(m, n.attributes.fanIn ?? 0), 0)

        // Map nodes: override color/size with heatmap values for files
        const nodes = body.nodes.map(({ key, attributes }) => {
          if (attributes.kind === 'file') {
            return {
              key,
              attributes: {
                ...attributes,
                color: fanInColor(attributes.fanIn ?? 0, maxFanIn),
                size: fanInSize(attributes.fanIn ?? 0, nodeSize(attributes)),
              },
            }
          }
          return { key, attributes: { ...attributes, color: nodeColor(attributes), size: nodeSize(attributes) } }
        })

        // treeEdges only for layout (no cycles), importEdges added after
        load(nodes, body.treeEdges, '__root__', body.importEdges)
      })
      .catch((e) => { if (!cancelled) setStatus(`error: ${e.message}`) })
    return () => { cancelled = true }
  }, [load])

  useEffect(() => {
    const cleanup = loadGraph('')
    return cleanup
  }, [loadGraph])

  function handleSubmit(e) {
    e.preventDefault()
    const val = inputValue.trim()
    if (val) loadGraph(val)
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0f172a' }}>
      <HeatmapHeader
        status={status}
        nodeCount={nodeCount}
        inputValue={inputValue}
        activeRoot={activeRoot}
        onInputChange={(v) => setInputValue(v)}
        onSubmit={handleSubmit}
      />

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, paddingTop: HEADER_H }} />

      {hovered && <HoverTooltip hovered={hovered} />}
      {status === 'ready' && <HeatmapLegend />}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeatmapHeader({ status, nodeCount, inputValue, activeRoot, onInputChange, onSubmit }) {
  const loading = status === 'loading'
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <span style={styles.title}>koodikartta</span>
        <span style={styles.subtitle}>Dependency Heatmap</span>
        <span style={{ ...styles.statusText, marginLeft: 'auto', color: status.startsWith('error') ? '#f87171' : '#64748b' }}>
          {status === 'ready' ? `${nodeCount} nodes · fan-in heat · scroll/drag`
           : status === 'loading' ? 'parsing imports…'
           : status}
        </span>
      </div>
      <form onSubmit={onSubmit} style={styles.pathRow}>
        <span style={styles.folderIcon}>📁</span>
        <input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={activeRoot ?? 'Liitä projektin absoluuttinen polku…'}
          spellCheck={false}
          style={styles.pathInput}
          onFocus={(e) => (e.target.style.borderColor = '#ef4444')}
          onBlur={(e)  => (e.target.style.borderColor = '#334155')}
        />
        <button type="submit" disabled={loading} style={{ ...styles.submitBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
          Avaa
        </button>
      </form>
    </div>
  )
}

function HoverTooltip({ hovered }) {
  const isFile = hovered.kind === 'file'
  return (
    <div style={styles.tooltip}>
      <div style={{ color: hovered.color ?? '#e2e8f0', fontWeight: 700 }}>{hovered.label}</div>
      <div style={{ color: '#64748b', marginTop: 2 }}>
        {isFile
          ? `fan-in: ${hovered.fanIn ?? 0}  ·  fan-out: ${hovered.fanOut ?? 0}  ·  .${hovered.ext}`
          : hovered.kind}
      </div>
      <div style={{ color: '#475569', marginTop: 2, maxWidth: 280, wordBreak: 'break-all' }}>{hovered.key}</div>
    </div>
  )
}

function HeatmapLegend() {
  return (
    <div style={styles.legend}>
      <div style={{ color: '#64748b', fontSize: 10, marginBottom: 5, letterSpacing: 1 }}>FAN-IN</div>
      {/* Gradient bar */}
      <div style={{
        height: 8, borderRadius: 4, marginBottom: 6, width: 120,
        background: `linear-gradient(to right, ${HEATMAP_LEGEND_STOPS.map(s => s.color).join(', ')})`,
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', width: 120 }}>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>0</span>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>max</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {[
          { color: '#3b82f6', label: 'dir' },
          { color: '#8b5cf6', label: 'root' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            <span style={{ color: '#94a3b8', fontSize: 11 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    background: 'rgba(15,23,42,0.9)',
    borderBottom: '1px solid #1e293b', backdropFilter: 'blur(6px)',
  },
  headerTop: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' },
  title: { color: '#ef4444', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' },
  subtitle: { color: '#475569', fontSize: 12 },
  statusText: { fontSize: 12 },
  pathRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 10px' },
  folderIcon: { color: '#475569', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' },
  pathInput: {
    flex: 1, background: '#1e293b', border: '1px solid #334155',
    borderRadius: 6, padding: '5px 10px', fontFamily: 'monospace',
    fontSize: 12, color: '#e2e8f0', outline: 'none',
  },
  submitBtn: {
    background: '#ef4444', border: 'none', borderRadius: 6,
    padding: '5px 14px', color: '#fff', fontFamily: 'monospace',
    fontSize: 12, whiteSpace: 'nowrap',
  },
  tooltip: {
    position: 'absolute', bottom: 16, left: 16, zIndex: 10,
    background: 'rgba(15,23,42,0.95)', border: '1px solid #1e293b',
    borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace',
    fontSize: 12, color: '#e2e8f0', pointerEvents: 'none',
  },
  legend: {
    position: 'absolute', bottom: 16, right: 16, zIndex: 10,
    background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b',
    borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11,
  },
}
