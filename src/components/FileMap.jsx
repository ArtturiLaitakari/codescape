import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, LEGEND } from '../lib/graph-colors.js'

const HEADER_H = 72  // px — canvas offset so content isn't hidden under header

export default function FileMap() {
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
    const url = targetPath ? `/api/filemap?path=${encodeURIComponent(targetPath)}` : '/api/filemap'
    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body.error) throw new Error(body.error)
        setActiveRoot(body.root)
        setInputValue(body.root)
        load(body.nodes, body.edges, '__root__')
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
      <Header
        status={status}
        nodeCount={nodeCount}
        inputValue={inputValue}
        activeRoot={activeRoot}
        onInputChange={(v) => setInputValue(v)}
        onSubmit={handleSubmit}
      />

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, paddingTop: HEADER_H }} />

      {hovered && <HoverTooltip hovered={hovered} />}
      {status === 'ready' && <Legend />}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({ status, nodeCount, inputValue, activeRoot, onInputChange, onSubmit }) {
  const loading = status === 'loading'
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <span style={styles.title}>koodikartta</span>
        <span style={styles.subtitle}>File Map</span>
        <span style={{ ...styles.statusText, marginLeft: 'auto', color: status.startsWith('error') ? '#f87171' : '#64748b' }}>
          {status === 'ready' ? `${nodeCount} nodes · scroll to zoom · drag to pan`
           : status === 'loading' ? 'scanning…'
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
          onFocus={(e) => (e.target.style.borderColor = '#8b5cf6')}
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
  const kindLabel =
    hovered.kind === 'file' ? `.${hovered.ext}` :
    hovered.kind === 'dir-empty' ? 'dir (empty)' :
    hovered.kind
  return (
    <div style={styles.tooltip}>
      <div style={{ color: nodeColor(hovered), fontWeight: 700 }}>{hovered.label}</div>
      <div style={{ color: '#64748b', marginTop: 2 }}>{kindLabel} · depth {hovered.depth}</div>
      <div style={{ color: '#475569', marginTop: 2, maxWidth: 280, wordBreak: 'break-all' }}>{hovered.key}</div>
    </div>
  )
}

function Legend() {
  return (
    <div style={styles.legend}>
      {LEGEND.map(({ label, color, border }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, border: border ? `1.5px solid ${border}` : 'none', boxSizing: 'border-box', display: 'inline-block' }} />
          <span style={{ color: '#94a3b8' }}>{label}</span>
        </div>
      ))}
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
  headerTop: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
  },
  title: {
    color: '#8b5cf6', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap',
  },
  subtitle: { color: '#475569', fontSize: 12 },
  statusText: { fontSize: 12 },
  pathRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 10px',
  },
  folderIcon: { color: '#475569', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' },
  pathInput: {
    flex: 1, background: '#1e293b', border: '1px solid #334155',
    borderRadius: 6, padding: '5px 10px', fontFamily: 'monospace', fontSize: 12,
    color: '#e2e8f0', outline: 'none',
  },
  submitBtn: {
    background: '#8b5cf6', border: 'none', borderRadius: 6,
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
    borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace', fontSize: 11,
  },
}
