import { useEffect, useRef, useCallback } from 'react'
import { useGraphView } from '../hooks/useGraphView.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import { t, tf, impactStatusMsg } from '../lib/i18n.js'
import { buildAdjacency } from '../lib/impact-utils.js'
import { useImpactZone } from '../hooks/useImpactZone.js'
import { ImportTooltip } from './ImportTooltip.jsx'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import { ImpactDepthLegend } from './ImpactDepthLegend.jsx'
import FileCodeView from './FileCodeView.jsx'
import { API_BASE } from '../lib/api-base.js'

export default function ChangeImpactMap({ sharedRoot, onRootChange, lang = 'fi', theme, is3D, onViewReady }) {
  const containerRef     = useRef(null)
  const reverseAdjRef    = useRef({})
  const forwardImportRef = useRef({})
  const forwardTreeRef   = useRef({})
  const nodeAttrsRef     = useRef({})

  const { selectedImpact, selectMode, getImpactZone, onClearFocus } =
    useImpactZone(nodeAttrsRef, forwardTreeRef, reverseAdjRef)

  const buildHovered = useCallback((key, attrs) => ({
    key, ...attrs,
    importers: [...(reverseAdjRef.current[key] ?? [])].sort(),
    imports:   [...(forwardImportRef.current[key] ?? [])].sort(),
  }), [])

  const {
    status, setStatus,
    hovered, setHovered,
    pinned,
    nodeCount,
    inputValue, setInputValue,
    activeRoot, setActiveRoot,
    selectedFile, setSelectedFile,
    searchResetRef,
    load, getNodes, setFilter,
  } = useGraphView(containerRef, {
    is3D, theme, sharedRoot, onViewReady,
    buildHovered,
    sigmaOptions: { getImpactZone, onClearFocus },
  })

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setHovered(null)
    onClearFocus()
    let cancelled = false
    const url = targetPath
      ? `${API_BASE}/api/depgraph?path=${encodeURIComponent(targetPath)}`
      : `${API_BASE}/api/depgraph`
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
  }, [load, onRootChange, onClearFocus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cleanup = loadGraph(sharedRoot ?? '')
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount — sharedRoot is not a live dependency

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
        onSelect={(p) => loadGraph(p)}
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

function ImpactHeader({ status, nodeCount, inputValue, activeRoot, selectedImpact, selectMode, lang, getNodes, setFilter, searchResetRef, onInputChange, onSelect, onSubmit, onReset }) {
  const loading = status === 'loading'
  const statusMsg = impactStatusMsg(selectedImpact, selectMode, lang)
  return (
    <div className="cs-header">
      <div className="cs-header__top">
        <span className="cs-title">Codescape</span>
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
        onSelect={onSelect}
        onSubmit={onSubmit}
        onReset={onReset}
      />
    </div>
  )
}

