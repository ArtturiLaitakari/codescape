import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'

const HEADER_H = 72

// Must match IMPACT_COLORS in useSigmaGraph.js
const FILE_LEGEND = [
  { color: '#fbbf24', label: 'Muutettu tiedosto' },
  { color: '#f97316', label: 'Suorat käyttäjät (depth 1)' },
  { color: '#f59e0b', label: '2. tason vaikutus' },
  { color: '#fde68a', label: '3.+ tason vaikutus' },
]
const DIR_LEGEND = [
  { color: '#fbbf24', label: 'Valittu kansio' },
  { color: '#f97316', label: 'Suorat lapset' },
  { color: '#f59e0b', label: '2. tason sisältö' },
  { color: '#fde68a', label: 'Syvemmät tasot' },
]

export default function ChangeImpactMap({ sharedRoot, onRootChange }) {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [hovered, setHovered] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [inputValue, setInputValue] = useState(sharedRoot ?? '')
  const [activeRoot, setActiveRoot] = useState(null)
  // { node: string, count: number } when a node is focused, else null
  const [selectedImpact, setSelectedImpact] = useState(null)

  // Reverse adjacency: target → Set<source>  (who imports each file)
  const reverseAdjRef = useRef({})
  // Forward tree adjacency: parent → Set<child>  (directory containment)
  const forwardTreeRef = useRef({})
  // Node attributes: key → attrs
  const nodeAttrsRef = useRef({})
  // 'file' | 'dir' — mode of the current selection
  const [selectMode, setSelectMode] = useState(null)

  const onEnterNode = useCallback((key, attrs) => setHovered({ key, ...attrs }), [])
  const onLeaveNode = useCallback(() => setHovered(null), [])
  const onReady = useCallback((count) => { setNodeCount(count); setStatus('ready') }, [])

  // Returns Map<nodeKey, depth> where depth 0 = clicked node itself.
  // - Directory: BFS forward through tree (show contained nodes)
  // - File: BFS reverse through imports (show who would be affected)
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
  }, [])

  const onClearFocus = useCallback(() => { setSelectedImpact(null); setSelectMode(null) }, [])

  const { load } = useSigmaGraph(containerRef, { onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus })

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setHovered(null)
    setSelectedImpact(null)
    let cancelled = false
    const url = targetPath ? `/api/depgraph?path=${encodeURIComponent(targetPath)}` : '/api/depgraph'
    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body.error) throw new Error(body.error)
        setActiveRoot(body.root)
        setInputValue(body.root)
        onRootChange?.(body.root)

        // Build reverse adjacency: target → Set<source>  (who imports each file)
        const rev = {}
        for (const { source, target } of body.importEdges) {
          if (!rev[target]) rev[target] = new Set()
          rev[target].add(source)
        }
        reverseAdjRef.current = rev

        // Build forward tree adjacency: parent → Set<child>  (directory containment)
        const fwd = {}
        for (const { source, target } of body.treeEdges) {
          if (!fwd[source]) fwd[source] = new Set()
          fwd[source].add(target)
        }
        forwardTreeRef.current = fwd

        // Index node attributes for kind lookups in getImpactZone
        const nodeAttrs = {}
        for (const { key, attributes } of body.nodes) nodeAttrs[key] = attributes
        nodeAttrsRef.current = nodeAttrs

        // Default file-type colours — orphaned files (fanIn === 0) get red
        const nodes = body.nodes.map(({ key, attributes }) => {
          const orphan = attributes.kind === 'file' && (attributes.fanIn ?? 0) === 0
          return {
            key,
            attributes: {
              ...attributes,
              color: orphan ? '#ef4444' : nodeColor(attributes),
              size: nodeSize(attributes),
            },
          }
        })

        load(nodes, body.treeEdges, '__root__', body.importEdges)
      })
      .catch((e) => { if (!cancelled) setStatus(`error: ${e.message}`) })
    return () => { cancelled = true }
  }, [load, onRootChange])

  useEffect(() => {
    const cleanup = loadGraph(sharedRoot ?? '')
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount — sharedRoot is the initial value, not a live dependency

  function handleSubmit(e) {
    e.preventDefault()
    const val = inputValue.trim()
    if (val) loadGraph(val)
  }

  function handleReset() {
    setInputValue('')
    setActiveRoot(null)
    setSelectedImpact(null)
    onRootChange?.(null)
    loadGraph('')
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0f172a' }}>
      <ImpactHeader
        status={status}
        nodeCount={nodeCount}
        inputValue={inputValue}
        activeRoot={activeRoot}
        selectedImpact={selectedImpact}
        selectMode={selectMode}
        onInputChange={(v) => setInputValue(v)}
        onSubmit={handleSubmit}
        onReset={handleReset}
      />

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, paddingTop: HEADER_H }} />

      {hovered && <HoverTooltip hovered={hovered} />}
      {status === 'ready' && <ImpactLegend selectMode={selectMode} />}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImpactHeader({ status, nodeCount, inputValue, activeRoot, selectedImpact, selectMode, onInputChange, onSubmit, onReset }) {
  const loading = status === 'loading'
  const name = selectedImpact?.node.split('/').pop() ?? ''
  const statusMsg = selectedImpact
    ? selectMode === 'dir'
      ? selectedImpact.count === 0
        ? `${name}/ on tyhjä`
        : `${name}/ sisältää ${selectedImpact.count} solmua`
      : selectedImpact.count === 0
        ? `${name} — ei liitoksia`
        : `${name} → ${selectedImpact.count} tiedostoa vaikuttuisi`
    : null
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <span style={styles.title}>koodikartta</span>
        <span style={styles.subtitle}>Muutosvaikutuskartta</span>
        {statusMsg ? (
          <span style={{ ...styles.statusText, marginLeft: 'auto', color: '#fbbf24' }}>{statusMsg}</span>
        ) : (
          <span style={{ ...styles.statusText, marginLeft: 'auto', color: status.startsWith('error') ? '#f87171' : '#64748b' }}>
            {status === 'ready' ? `${nodeCount} nodes · klikkaa tiedostoa tai kansiota`
             : status === 'loading' ? 'parsitaan importteja…'
             : status}
          </span>
        )}
      </div>
      <form onSubmit={onSubmit} style={styles.pathRow}>
        <span style={styles.folderIcon}>📁</span>
        <input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={activeRoot ?? 'Liitä projektin absoluuttinen polku…'}
          spellCheck={false}
          style={styles.pathInput}
          onFocus={(e) => (e.target.style.borderColor = '#22c55e')}
          onBlur={(e)  => (e.target.style.borderColor = '#334155')}
        />
        <button type="submit" disabled={loading} style={{ ...styles.submitBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
          Avaa
        </button>
        {activeRoot && (
          <button type="button" onClick={onReset} disabled={loading} style={{ ...styles.resetBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            Nollaa
          </button>
        )}
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
          ? `importoijia: ${hovered.fanIn ?? 0}  ·  importteja: ${hovered.fanOut ?? 0}  ·  .${hovered.ext}`
          : hovered.kind}
      </div>
      <div style={{ color: '#475569', marginTop: 2, maxWidth: 280, wordBreak: 'break-all' }}>{hovered.key}</div>
    </div>
  )
}

function ImpactLegend({ selectMode }) {
  const entries = selectMode === 'dir' ? DIR_LEGEND : FILE_LEGEND
  const title = selectMode === 'dir' ? 'KANSIOSISÄLTÖ' : 'VAIKUTUSSYVYYS'
  return (
    <div style={styles.legend}>
      <div style={{ color: '#64748b', fontSize: 10, marginBottom: 7, letterSpacing: 1 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {entries.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#94a3b8', fontSize: 11 }}>{label}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, borderTop: '1px solid #1e293b', paddingTop: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#334155', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#475569', fontSize: 11 }}>Ei valittu</span>
        </div>
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
  title: { color: '#22c55e', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' },
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
    background: '#22c55e', border: 'none', borderRadius: 6,
    padding: '5px 14px', color: '#0f172a', fontFamily: 'monospace',
    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
  },
  resetBtn: {
    background: 'transparent', border: '1px solid #334155', borderRadius: 6,
    padding: '5px 14px', color: '#94a3b8', fontFamily: 'monospace',
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
