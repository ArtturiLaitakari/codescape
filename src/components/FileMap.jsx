import { useEffect, useRef, useCallback } from 'react'
import { useGraphView, DEFAULT_LAYOUT_OPTIONS } from '../hooks/useGraphView.js'
import { nodeColor, computeLegend } from '../lib/graph-colors.js'
import { t, tf } from '../lib/i18n.js'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import FileCodeView from './FileCodeView.jsx'
import { API_BASE } from '../lib/api-base.js'

export default function FileMap({ sharedRoot, onRootChange, lang = 'fi', theme, is3D, projectType = 'node', onViewReady }) {
  const containerRef = useRef(null)

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
    load, getNodes, setFilter,
  } = useGraphView(containerRef, {
    is3D, theme, sharedRoot, onViewReady,
    forceOptions: {
      layoutMode: 'orbital',
      layoutOptions: {
        ...DEFAULT_LAYOUT_OPTIONS,
        orbitRadius: 150, radialStrength: 0.9, chargeStrength: -60,
        linkDistance: 40, linkStrength: 0.2,
      },
    },
  })

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setHovered(null)
    let cancelled = false
    const url = targetPath
      ? `${API_BASE}/api/filemap?path=${encodeURIComponent(targetPath)}&type=${projectType}`
      : `${API_BASE}/api/filemap?type=${projectType}`
    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body.error) throw new Error(body.error)
        setActiveRoot(body.root)
        setInputValue(body.root)
        onRootChange?.(body.root)
        load(body.nodes, body.edges, '__root__')
      })
      .catch((e) => { if (!cancelled) setStatus(`error: ${e.message}`) })
    return () => { cancelled = true }
  }, [load, onRootChange]) // eslint-disable-line react-hooks/exhaustive-deps

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
    onRootChange?.(null)
    loadGraph('')
  }

  return (
    <div className="cs-view cs-view--filemap">
      <Header
        status={status}
        nodeCount={nodeCount}
        inputValue={inputValue}
        activeRoot={activeRoot}
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

      {(hovered ?? pinned) && <HoverTooltip hovered={hovered ?? pinned} lang={lang} />}
      {status === 'ready' && <Legend getNodes={getNodes} projectType={projectType} />}
      {selectedFile && (
        <FileCodeView
          filePath={selectedFile}
          preloadedComplexity={selectedFileAttrs}
          activeRoot={activeRoot}
          onClose={() => setSelectedFile(null)}
          lang={lang}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({ status, nodeCount, inputValue, activeRoot, lang, getNodes, setFilter, searchResetRef, onInputChange, onSelect, onSubmit, onReset }) {
  const loading = status === 'loading'
  return (
    <div className="cs-header">
      <div className="cs-header__top">
        <span className="cs-title">Codescape</span>
        <span className="cs-subtitle">{t('subtitle_filemap', lang)}</span>
        <span className={`cs-status${status.startsWith('error') ? ' cs-status--error' : ''}`}>
          {status === 'ready' ? tf('nodes_filemap', { count: nodeCount }, lang)
           : status === 'loading' ? t('scanning', lang)
           : status}
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

function HoverTooltip({ hovered, lang }) {
  const kindLabel =
    hovered.kind === 'file' ? `.${hovered.ext}` :
    hovered.kind === 'dir-empty' ? t('dir_empty', lang) :
    hovered.kind
  return (
    <div className="cs-tooltip">
      <div className="cs-tooltip__title" style={{ '--cs-ink': nodeColor(hovered) }}>{hovered.label}</div>
      <div className="cs-tooltip__sub">{kindLabel} · {t('depth', lang)} {hovered.depth}</div>
      <div className="cs-tooltip__path">{hovered.key}</div>
    </div>
  )
}

function Legend({ getNodes, projectType }) {
  const entries = computeLegend(getNodes, projectType)
  return (
    <div className="cs-legend">
      {entries.map(({ label, color, border }) => (
        <div key={label} className="cs-legend__row">
          <span className="cs-legend__dot" style={{ '--cs-swatch': color, '--cs-swatch-border': border ? `1.5px solid ${border}` : undefined }} />
          <span className="cs-legend__label">{label}</span>
        </div>
      ))}
    </div>
  )
}


