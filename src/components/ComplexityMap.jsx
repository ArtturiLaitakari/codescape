import { useEffect, useRef, useState } from 'react'
import { useGraphView, DEFAULT_LAYOUT_OPTIONS } from '../hooks/useGraphView.js'
import { useCCStream, ccColor, CC_LEGEND_STOPS } from '../hooks/useCCStream.js'
import { t, tf } from '../lib/i18n.js'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import FileCodeView from './FileCodeView.jsx'

export default function ComplexityMap({ sharedRoot, onRootChange, lang = 'en', theme, is3D, projectType = 'node', onViewReady }) {
  const containerRef = useRef(null)
  const cleanupRef   = useRef(null)
  const [scanProgress, setScanProgress] = useState(null)

  const {
    status, setStatus,
    hovered, setHovered,
    pinned,
    nodeCount,
    inputValue, setInputValue,
    activeRoot, setActiveRoot,
    selectedFile, setSelectedFile,
    searchResetRef,
    load, getNodes, setFilter, patchNodes,
  } = useGraphView(containerRef, {
    is3D, theme, sharedRoot, onViewReady,
    setStatusOnReady: false,
    forceOptions: {
      layoutMode: 'orbital',
      layoutOptions: {
        ...DEFAULT_LAYOUT_OPTIONS,
        orbitRadius: 140, radialStrength: 0.8, chargeStrength: -80,
        linkDistance: 50, linkStrength: 0.15,
      },
    },
  })

  const startStream = useCCStream({
    load, patchNodes, onRootChange,
    setStatus, setScanProgress, setActiveRoot, setInputValue,
    projectType,
  })

  function loadGraph(targetPath) {
    cleanupRef.current?.()
    setHovered(null)
    const cleanup = startStream(targetPath)
    cleanupRef.current = cleanup
    return cleanup
  }

  useEffect(() => {
    const cleanup = loadGraph(sharedRoot ?? '')
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const val = inputValue.trim()
    if (val) loadGraph(val)
  }

  function handleReset() {
    setInputValue('')
    setActiveRoot(null)
    onRootChange?.(null)
    loadGraph('')
  }

  return (
    <div className="cs-view cs-view--cc">
      <CCHeader
        status={status}
        scanProgress={scanProgress}
        nodeCount={nodeCount}
        inputValue={inputValue}
        activeRoot={activeRoot}
        lang={lang}
        getNodes={getNodes}
        setFilter={setFilter}
        searchResetRef={searchResetRef}
        onInputChange={v => setInputValue(v)}
        onSelect={p => loadGraph(p)}
        onSubmit={handleSubmit}
        onReset={handleReset}
      />

      <div ref={containerRef} className="cs-canvas" />

      {(hovered ?? pinned) && <CCTooltip hovered={hovered ?? pinned} lang={lang} />}
      {status === 'ready' && <CCLegend />}
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

function CCHeader({ status, scanProgress, nodeCount, inputValue, activeRoot, lang, getNodes, setFilter, searchResetRef, onInputChange, onSelect, onSubmit, onReset }) {
  const loading = status === 'loading' || status === 'scanning'
  const statusText = status === 'ready'
    ? tf('nodes_cc', { count: nodeCount }, lang)
    : scanProgress
      ? `${t('scanning', lang)} ${scanProgress.done} / ${scanProgress.total}`
      : t('parsing_imports', lang)
  return (
    <div className="cs-header">
      <div className="cs-header__top">
        <span className="cs-title">Codescape</span>
        <span className="cs-subtitle">{t('subtitle_cc', lang)}</span>
        <span className={`cs-status${status.startsWith('error') ? ' cs-status--error' : ''}`}>
          {status.startsWith('error') ? status : statusText}
        </span>
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

function CCTooltip({ hovered }) {
  if (!hovered.hasCC) {
    return (
      <div className="cs-tooltip">
        <div className="cs-tooltip__title">{hovered.label}</div>
        <div className="cs-tooltip__path">{hovered.key}</div>
      </div>
    )
  }
  return (
    <div className="cs-tooltip">
      <div className="cs-tooltip__title" style={{ '--cs-ink': ccColor(hovered.maxCyclomatic, hovered.maxCyclomatic) }}>{hovered.label}</div>
      <div className="cs-tooltip__path">{hovered.key}</div>
      <div className="cs-tooltip__rows">
        <CCRow label="Max CC"     value={hovered.maxCyclomatic} />
        <CCRow label="Avg CC"     value={hovered.avgCyclomatic} />
        <CCRow label="Functions"  value={hovered.functionCount} />
        <CCRow label="LOC"        value={hovered.loc} />
        <CCRow label="Maintain."  value={`${hovered.maintainability ?? '?'} / 100`} />
        {hovered.wayTooHighCount > 0 && <CCRow label="🔴 Critical" value={hovered.wayTooHighCount} />}
        {hovered.highCount > 0       && <CCRow label="🟠 High"     value={hovered.highCount} />}
        {hovered.medCount > 0        && <CCRow label="🟡 Medium"   value={hovered.medCount} />}
      </div>
    </div>
  )
}

function CCRow({ label, value }) {
  return (
    <div className="cs-tooltip__row">
      <span className="cs-tooltip__key">{label}</span>
      <span className="cs-tooltip__val">{value}</span>
    </div>
  )
}

function CCLegend() {
  return (
    <div className="cs-legend">
      <div className="cs-legend__title">MAX CC</div>
      <div
        className="cs-legend__gradient"
        style={{ '--cs-gradient': `linear-gradient(to right, ${CC_LEGEND_STOPS.join(', ')})` }}
      />
      <div className="cs-legend__scale">
        <span>low</span>
        <span>high</span>
      </div>
      <div className="cs-legend__col">
        {[
          { color: '#8b5cf6', label: 'root' },
          { color: '#3b82f6', label: 'dir' },
          { color: '#6b7280', label: 'no analysis' },
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
