import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, LEGEND } from '../lib/graph-colors.js'
import { t, tf } from '../lib/i18n.js'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import FileCodeView from './FileCodeView.jsx'

export default function FileMap({ sharedRoot, onRootChange, lang = 'fi' }) {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [hovered, setHovered]   = useState(null)
  const [pinned, setPinned]     = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [inputValue, setInputValue] = useState(sharedRoot ?? '')
  const [activeRoot, setActiveRoot] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)

  const onEnterNode = useCallback((key, attrs) => setHovered({ key, ...attrs }), [])
  const onLeaveNode = useCallback(() => setHovered(null), [])
  const onReady = useCallback((count) => { setNodeCount(count); setStatus('ready') }, [])

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
      const fullPath = activeRootRef.current.replace(/\/$/, '') + '/' + key
      setSelectedFile(fullPath)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { load, getNodes, setFilter } = useSigmaGraph(containerRef, { onEnterNode, onLeaveNode, onReady, onClickNode, onDoubleClickNode })

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
        onRootChange?.(body.root)
        load(body.nodes, body.edges, '__root__')
      })
      .catch((e) => { if (!cancelled) setStatus(`error: ${e.message}`) })
    return () => { cancelled = true }
  }, [load, onRootChange])

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
        onSubmit={handleSubmit}
        onReset={handleReset}
      />

      <div ref={containerRef} className="cs-canvas" />

      {(hovered ?? pinned) && <HoverTooltip hovered={hovered ?? pinned} lang={lang} />}
      {status === 'ready' && <Legend />}
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

function Header({ status, nodeCount, inputValue, activeRoot, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
  const loading = status === 'loading'
  return (
    <div className="cs-header">
      <div className="cs-header__top">
        <span className="cs-title">Codespace</span>
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

function Legend() {
  return (
    <div className="cs-legend">
      {LEGEND.map(({ label, color, border }) => (
        <div key={label} className="cs-legend__row">
          <span className="cs-legend__dot" style={{ '--cs-swatch': color, '--cs-swatch-border': border ? `1.5px solid ${border}` : undefined }} />
          <span className="cs-legend__label">{label}</span>
        </div>
      ))}
    </div>
  )
}


