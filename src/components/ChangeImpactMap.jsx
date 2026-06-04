import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import { t, tf } from '../lib/i18n.js'
import { NodeSearchBar } from './NodeSearchBar.jsx'

const HEADER_H = 56

// Legend entries are functions of lang so they update when language switches
const FILE_LEGEND = (lang) => [
  { color: '#fbbf24', label: t('l_changed_file', lang) },
  { color: '#f97316', label: t('l_direct_users', lang) },
  { color: '#f59e0b', label: t('l_depth2', lang) },
  { color: '#fde68a', label: t('l_depth3plus', lang) },
]
const DIR_LEGEND = (lang) => [
  { color: '#fbbf24', label: t('l_selected_folder', lang) },
  { color: '#f97316', label: t('l_direct_children', lang) },
  { color: '#f59e0b', label: t('l_depth2_content', lang) },
  { color: '#fde68a', label: t('l_deeper', lang) },
]

export default function ChangeImpactMap({ sharedRoot, onRootChange, lang = 'fi' }) {
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

  const searchResetRef = useRef(null)
  const onClickNode = useCallback(() => { searchResetRef.current?.() }, [])

  const { load, getNodes, setFilter } = useSigmaGraph(containerRef, { onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus, onClickNode })

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
        lang={lang}
        getNodes={getNodes}
        setFilter={setFilter}
        searchResetRef={searchResetRef}
        onInputChange={(v) => setInputValue(v)}
        onSubmit={handleSubmit}
        onReset={handleReset}
      />

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, paddingTop: HEADER_H }} />

      {hovered && <HoverTooltip hovered={hovered} lang={lang} />}
      {status === 'ready' && <ImpactLegend selectMode={selectMode} lang={lang} />}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImpactHeader({ status, nodeCount, inputValue, activeRoot, selectedImpact, selectMode, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
  const loading = status === 'loading'
  const name = selectedImpact?.node.split('/').pop() ?? ''
  const statusMsg = selectedImpact
    ? selectMode === 'dir'
      ? tf(selectedImpact.count === 0 ? 'impact_dir_empty' : 'impact_dir_has', { name, count: selectedImpact.count }, lang)
      : tf(selectedImpact.count === 0 ? 'impact_file_none' : 'impact_file_has', { name, count: selectedImpact.count }, lang)
    : null
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <span style={styles.title}>koodikartta</span>
        <span style={styles.subtitle}>{t('subtitle_impact', lang)}</span>
        {statusMsg ? (
          <span style={{ ...styles.statusText, marginLeft: 'auto', color: '#fbbf24' }}>{statusMsg}</span>
        ) : (
          <span style={{ ...styles.statusText, marginLeft: 'auto', color: status.startsWith('error') ? '#f87171' : '#64748b' }}>
            {status === 'ready' ? tf('nodes_impact', { count: nodeCount }, lang)
             : status === 'loading' ? t('parsing_imports', lang)
             : status}
          </span>
        )}
      </div>
      <form onSubmit={onSubmit} style={styles.pathRow}>
        <span style={styles.folderIcon}>📁</span>
        <input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={activeRoot ?? t('path_placeholder', lang)}
          spellCheck={false}
          style={styles.pathInput}
          onFocus={(e) => (e.target.style.borderColor = '#22c55e')}
          onBlur={(e)  => (e.target.style.borderColor = '#334155')}
        />
        <button type="submit" disabled={loading} style={{ ...styles.submitBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {t('open', lang)}
        </button>
        {activeRoot && (
          <button type="button" onClick={onReset} disabled={loading} style={{ ...styles.resetBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {t('reset', lang)}
          </button>
        )}
        <div style={{ width: 1, background: '#334155', alignSelf: 'stretch', margin: '0 4px', flexShrink: 0 }} />
        <NodeSearchBar getNodes={getNodes} setFilter={setFilter} lang={lang} accent='#22c55e' resetRef={searchResetRef} />
      </form>
    </div>
  )
}

function HoverTooltip({ hovered, lang }) {
  const isFile = hovered.kind === 'file'
  return (
    <div style={styles.tooltip}>
      <div style={{ color: hovered.color ?? '#e2e8f0', fontWeight: 700 }}>{hovered.label}</div>
      <div style={{ color: '#64748b', marginTop: 2 }}>
        {isFile
          ? `${t('importers', lang)}: ${hovered.fanIn ?? 0}  ·  ${t('imports', lang)}: ${hovered.fanOut ?? 0}  ·  .${hovered.ext}`
          : hovered.kind}
      </div>
      <div style={{ color: '#475569', marginTop: 2, maxWidth: 280, wordBreak: 'break-all' }}>{hovered.key}</div>
    </div>
  )
}

function ImpactLegend({ selectMode, lang }) {
  const entries = (selectMode === 'dir' ? DIR_LEGEND : FILE_LEGEND)(lang)
  const title = t(selectMode === 'dir' ? 'legend_folder_contents' : 'legend_impact_depth', lang)
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
          <span style={{ color: '#475569', fontSize: 11 }}>{t('l_not_selected', lang)}</span>
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
  headerTop: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px' },
  title: { color: '#22c55e', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' },
  subtitle: { color: '#475569', fontSize: 12 },
  statusText: { fontSize: 12 },
  pathRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 12px 6px' },
  folderIcon: { color: '#475569', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' },
  pathInput: {
    flex: 1, minWidth: 0, background: '#1e293b', border: '1px solid #334155',
    borderRadius: 6, padding: '3px 8px', fontFamily: 'monospace',
    fontSize: 11, color: '#e2e8f0', outline: 'none',
  },
  submitBtn: {
    background: '#22c55e', border: 'none', borderRadius: 6,
    padding: '3px 10px', color: '#0f172a', fontFamily: 'monospace',
    fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
  },
  resetBtn: {
    background: 'transparent', border: '1px solid #334155', borderRadius: 6,
    padding: '3px 10px', color: '#94a3b8', fontFamily: 'monospace',
    fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
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
