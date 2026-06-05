import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import { t, tf } from '../lib/i18n.js'
import { buildAdjacency } from '../lib/impact-utils.js'
import { useImpactZone } from '../hooks/useImpactZone.js'
import { ImportTooltip } from './ImportTooltip.jsx'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import { ImpactDepthLegend } from './ImpactDepthLegend.jsx'
import FileCodeView from './FileCodeView.jsx'

export default function ChangeImpactMap({ sharedRoot, onRootChange, lang = 'fi', onViewReady }) {
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
  }, [load, onRootChange, onClearFocus])

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
    onClearFocus()
    onRootChange?.(null)
    loadGraph('')
  }

  return (
    <div className="cs-view cs-view--impact">
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

      <div ref={containerRef} className="cs-canvas" />

      {(hovered ?? pinned) && (
        <ImportTooltip
          key={(hovered ?? pinned).key}
          hovered={hovered ?? pinned}
          lang={lang}
        />
      )}
      {status === 'ready' && <ImpactDepthLegend selectMode={selectMode} lang={lang} />}
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

function ImpactHeader({ status, nodeCount, inputValue, activeRoot, selectedImpact, selectMode, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
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
        <span className="cs-subtitle">{t('subtitle_impact', lang)}</span>
        {statusMsg ? (
          <span className="cs-status cs-status--warn">{statusMsg}</span>
        ) : (
          <span className={`cs-status${status.startsWith('error') ? ' cs-status--error' : ''}`}>
            {status === 'ready' ? tf('nodes_impact', { count: nodeCount }, lang)
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

