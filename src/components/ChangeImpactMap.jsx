import { useEffect, useRef, useCallback, useState } from 'react'
import { useGraphView } from '../hooks/useGraphView.js'
import { t, tf, impactStatusMsg } from '../lib/i18n.js'
import { buildAdjacency } from '../lib/impact-utils.js'
import { useImpactZone } from '../hooks/useImpactZone.js'
import { useDepStream } from '../hooks/useDepStream.js'
import { ImportTooltip } from './ImportTooltip.jsx'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import { ImpactDepthLegend } from './ImpactDepthLegend.jsx'

export default function ChangeImpactMap({ sharedRoot, onRootChange, lang = 'fi', theme, is3D, projectType = 'node', onViewReady }) {
  const containerRef     = useRef(null)
  const reverseAdjRef    = useRef({})
  const forwardImportRef = useRef({})
  const forwardTreeRef   = useRef({})
  const nodeAttrsRef     = useRef({})
  const cleanupRef       = useRef(null)
  const [scanProgress, setScanProgress] = useState(null)

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
    selectedFileAttrs,
    searchResetRef,
    load, getNodes, setFilter, addEdges, patchNodes,
  } = useGraphView(containerRef, {
    is3D, theme, sharedRoot, onViewReady,
    setStatusOnReady: false,
    openInVsCode: true,
    buildHovered,
    sigmaOptions: { getImpactZone, onClearFocus },
  })

  const startStream = useDepStream({
    nodeAttrsRef,
    reverseAdjRef,
    forwardImportRef,
    load, patchNodes, addEdges, onRootChange,
    setStatus, setScanProgress, setActiveRoot, setInputValue,
    projectType,
    onDone: (rev, fwdImport, treeEdges) => {
      const { fwdTree } = buildAdjacency([], treeEdges ?? [])
      forwardTreeRef.current = fwdTree
    },
  })

  const loadGraph = useCallback((targetPath) => {
    setHovered(null)
    onClearFocus()
    cleanupRef.current?.()
    const cleanup = startStream(targetPath)
    cleanupRef.current = cleanup
    return cleanup
  }, [startStream, setHovered, onClearFocus])

  useEffect(() => {
    const cleanup = loadGraph(sharedRoot ?? '')
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

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
        scanProgress={scanProgress}
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
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImpactHeader({ status, scanProgress, nodeCount, inputValue, activeRoot, selectedImpact, selectMode, lang, getNodes, setFilter, searchResetRef, onInputChange, onSelect, onSubmit, onReset }) {
  const loading = status === 'loading' || status === 'scanning'
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
             : scanProgress ? `${t('scanning', lang)} ${scanProgress.done} / ${scanProgress.total}`
             : t('parsing_imports', lang)}
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

