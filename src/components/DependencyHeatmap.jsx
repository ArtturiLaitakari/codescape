import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import { fanInColor, fanInSize, HEATMAP_LEGEND_STOPS } from '../lib/heatmap-colors.js'
import { t, tf } from '../lib/i18n.js'
import { buildAdjacency } from '../lib/impact-utils.js'
import { useImpactZone } from '../hooks/useImpactZone.js'
import { ImportTooltip } from './ImportTooltip.jsx'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import { ImpactDepthLegend } from './ImpactDepthLegend.jsx'
import FileCodeView from './FileCodeView.jsx'

export default function DependencyHeatmap({ sharedRoot, onRootChange, lang = 'fi', onViewReady }) {
  const containerRef = useRef(null)
  const reverseAdjRef = useRef({})
  const forwardImportRef = useRef({})
  const forwardTreeRef = useRef({})
  const nodeAttrsRef = useRef({})
  const [status, setStatus] = useState('loading')
  const [hovered, setHovered]   = useState(null)
  const [pinned, setPinned]     = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [inputValue, setInputValue] = useState(sharedRoot ?? '')
  const [activeRoot, setActiveRoot] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)

  const { selectedImpact, selectMode, getImpactZone, onClearFocus } =
    useImpactZone(nodeAttrsRef, forwardTreeRef, reverseAdjRef)

  const onEnterNode = useCallback((key, attrs) => {
    const importers = [...(reverseAdjRef.current[key] ?? [])].sort()
    const imports = [...(forwardImportRef.current[key] ?? [])].sort()
    setHovered({ key, ...attrs, importers, imports })
  }, [])
  const onLeaveNode = useCallback(() => setHovered(null), [])
  const onReady = useCallback((count) => { setNodeCount(count); setStatus('ready'); onViewReady?.() }, [onViewReady])

  const searchResetRef = useRef(null)
  const activeRootRef = useRef(activeRoot)
  useEffect(() => { activeRootRef.current = activeRoot }, [activeRoot])

  const onClickNode = useCallback((key, attrs) => {
    searchResetRef.current?.()
    setPinned(prev => prev?.key === key ? null : { key, ...attrs })
  }, [])

  const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx'])
  const onDoubleClickNode = useCallback((key, attrs) => {
    if (attrs?.kind === 'file' && CODE_EXTS.has(attrs?.ext) && activeRootRef.current) {
      setSelectedFile(activeRootRef.current.replace(/\/$/, '') + '/' + key)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { load, getNodes, setFilter } = useSigmaGraph(containerRef, { onEnterNode, onLeaveNode, onReady, getImpactZone, onClearFocus, onClickNode, onDoubleClickNode })

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setHovered(null)
    onClearFocus()
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

        const { rev, fwdImport, fwdTree } = buildAdjacency(body.importEdges, body.treeEdges)
        reverseAdjRef.current = rev
        forwardImportRef.current = fwdImport
        forwardTreeRef.current = fwdTree

        // Index node attributes for kind lookups in getImpactZone
        const nodeAttrs = {}
        for (const { key, attributes } of body.nodes) nodeAttrs[key] = attributes
        nodeAttrsRef.current = nodeAttrs

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
          // Dirs: green so they're visually distinct from the cold-blue end of the heat scale
          const dirColor = attributes.kind === 'dir' ? '#22c55e' : attributes.kind === 'dir-empty' ? '#166534' : nodeColor(attributes)
          return { key, attributes: { ...attributes, color: dirColor, size: nodeSize(attributes) } }
        })

        // treeEdges only for layout (no cycles), importEdges added after
        load(nodes, body.treeEdges, '__root__', body.importEdges)
      })
      .catch((e) => { if (!cancelled) setStatus(`error: ${e.message}`) })
    return () => { cancelled = true }
  }, [load, onRootChange, onClearFocus])

  useEffect(() => {
    const cleanup = loadGraph(sharedRoot ?? '')
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount — sharedRoot is the initial value, not a dependency

  function handleSubmit(e) {
    e.preventDefault()
    const val = inputValue.trim()
    if (val) loadGraph(val)
  }

  function handleReset() {
    setInputValue('')
    setActiveRoot(null)
    onClearFocus()
    onRootChange?.(null)
    loadGraph('')
  }

  return (
    <div className="cs-view cs-view--heatmap">
      <HeatmapHeader
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

      <div ref={containerRef} className="cs-canvas" />

      {(hovered ?? pinned) && (
        <ImportTooltip
          key={(hovered ?? pinned).key}
          hovered={hovered ?? pinned}
          lang={lang}
        />
      )}
      {status === 'ready' && <HeatmapLegend selectMode={selectMode} lang={lang} />}
      {selectedFile && (
        <FileCodeView
          filePath={selectedFile}
          activeRoot={activeRoot}
          onClose={() => setSelectedFile(null)}
          lang={lang}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeatmapHeader({ status, nodeCount, inputValue, activeRoot, selectedImpact, selectMode, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
  const loading = status === 'loading'
  const name = selectedImpact?.node.split('/').pop() ?? ''
  const statusMsg = selectedImpact
    ? selectMode === 'dir'
      ? tf(selectedImpact.count === 0 ? 'impact_dir_empty' : 'impact_dir_has', { name, count: selectedImpact.count }, lang)
      : tf(selectedImpact.count === 0 ? 'impact_file_none' : 'impact_file_has', { name, count: selectedImpact.count }, lang)
    : null
  return (
    <div className="cs-header">
      <div className="cs-header__top">
        <span className="cs-title">Codespace</span>
        <span className="cs-subtitle">{t('subtitle_heatmap', lang)}</span>
        {statusMsg ? (
          <span className="cs-status cs-status--warn">{statusMsg}</span>
        ) : (
          <span className={`cs-status${status.startsWith('error') ? ' cs-status--error' : ''}`}>
            {status === 'ready' ? tf('nodes_heatmap', { count: nodeCount }, lang)
             : status === 'loading' ? t('parsing_imports', lang)
             : status}
          </span>
        )}
      </div>
      <GraphHeaderForm
        inputValue={inputValue}
        activeRoot={activeRoot}
        loading={loading}
        lang={lang}
        getNodes={getNodes}
        setFilter={setFilter}
        searchResetRef={searchResetRef}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
        onReset={onReset}
      />
    </div>
  )
}


function HeatmapLegend({ selectMode, lang }) {
  if (selectMode) return <ImpactDepthLegend selectMode={selectMode} lang={lang} />
  return (
    <div className="cs-legend">
      <div className="cs-legend__title">FAN-IN</div>
      <div
        className="cs-legend__gradient"
        style={{ '--cs-gradient': `linear-gradient(to right, ${HEATMAP_LEGEND_STOPS.map(s => s.color).join(', ')})` }}
      />
      <div className="cs-legend__scale">
        <span>0</span>
        <span>max</span>
      </div>
      <div className="cs-legend__col">
        {[
          { color: '#22c55e', label: 'dir' },
          { color: '#166534', label: 'dir (empty)' },
          { color: '#8b5cf6', label: 'root' },
        ].map(({ color, label }) => (
          <div key={label} className="cs-legend__row">
            <span className="cs-legend__dot" style={{ '--cs-swatch': color }} />
            <span className="cs-legend__label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

