import { useEffect, useRef, useState } from 'react'
import { useGraphView, DEFAULT_LAYOUT_OPTIONS } from '../hooks/useGraphView.js'
import { useCCStream, ccColor, CC_LEGEND_STOPS, CC_LEGEND_BANDS } from '../hooks/useCCStream.js'
import { t, tf } from '../lib/i18n.js'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import FileCodeView from './FileCodeView.jsx'

export default function ComplexityMap({ sharedRoot, onRootChange, lang = 'en', theme, is3D, projectType = 'node', onViewReady }) {
  const containerRef = useRef(null)
  const cleanupRef   = useRef(null)
  const [scanProgress,  setScanProgress]  = useState(null)
  const [fileList,      setFileList]      = useState([])
  const [selectedBand,  setSelectedBand]  = useState(null)

  const {
    status, setStatus,
    hovered, setHovered,
    pinned, setPinned,
    nodeCount,
    inputValue, setInputValue,
    activeRoot, setActiveRoot,
    selectedFile, setSelectedFile,
    selectedFileAttrs,
    excludedDirs, setExcludedDirs,
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
    setFileList,
    projectType, excludedDirs,
  })

  function loadGraph(targetPath, excluded = excludedDirs) {
    cleanupRef.current?.()
    setHovered(null)
    setPinned(null)
    const cleanup = startStream(targetPath, excluded)
    cleanupRef.current = cleanup
    return cleanup
  }

  function handleExcludeDir(dirName) {
    const next = [...new Set([...excludedDirs, dirName])]
    setExcludedDirs(next)
    setPinned(null)
    loadGraph(activeRoot ?? '', next)
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

      {(hovered ?? pinned) && (
        <CCTooltip
          hovered={hovered ?? pinned}
          lang={lang}
          onExclude={handleExcludeDir}
        />
      )}
      {excludedDirs.length > 0 && (
        <ExcludedBadges
          dirs={excludedDirs}
          onRemove={dir => {
            const next = excludedDirs.filter(d => d !== dir)
            setExcludedDirs(next)
            loadGraph(activeRoot ?? '', next)
          }}
        />
      )}
      {status === 'ready' && (
        <CCLegend
          lang={lang}
          fileList={fileList}
          selectedBand={selectedBand}
          onBandSelect={band => {
            const next = selectedBand === band ? null : band
            setSelectedBand(next)
            if (next) {
              const b = CC_LEGEND_BANDS.find(x => x.id === next)
              const keys = fileList
                .filter(f => (f.maxCyclomatic ?? 0) >= b.minCC && (f.maxCyclomatic ?? 0) < b.maxCC)
                .map(f => f.key)
              setFilter(new Set(keys))
            } else {
              setFilter(null)
            }
          }}
        />
      )}
      {status === 'ready' && selectedBand !== null && (
        <CCFilePanel
          lang={lang}
          band={CC_LEGEND_BANDS.find(b => b.id === selectedBand)}
          fileList={fileList.filter(f => {
            const b = CC_LEGEND_BANDS.find(x => x.id === selectedBand)
            return (f.maxCyclomatic ?? 0) >= b.minCC && (f.maxCyclomatic ?? 0) < b.maxCC
          })}
          onClose={() => { setSelectedBand(null); setFilter(null) }}
          onSelectFile={key => setSelectedFile(key)}
        />
      )}
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

function CCTooltip({ hovered, onExclude }) {
  const isDirLike = hovered.kind === 'dir' || hovered.kind === 'dir-empty' || hovered.kind === 'root'
  const hasExclude = isDirLike && hovered.kind !== 'root'
  if (!hovered.hasCC) {
    return (
      <div className={`cs-tooltip${hasExclude ? ' cs-tooltip--interactive' : ''}`}>
        <div className="cs-tooltip__title">{hovered.label}</div>
        <div className="cs-tooltip__path">{hovered.key}</div>
        {hasExclude && (
          <button
            className="cs-tooltip__exclude-btn"
            onClick={() => onExclude(hovered.label)}
          >⊘ Exclude directory</button>
        )}
      </div>
    )
  }
  return (
    <div className="cs-tooltip">
      <div className="cs-tooltip__title" style={{ '--cs-ink': ccColor(hovered.maxCyclomatic) }}>{hovered.label}</div>
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

function CCLegend({ lang, fileList, selectedBand, onBandSelect }) {
  return (
    <div className="cs-legend cs-legend--interactive">
      <div className="cs-legend__title">MAX CC</div>
      <div
        className="cs-legend__gradient"
        style={{ '--cs-gradient': `linear-gradient(to right, ${CC_LEGEND_STOPS.join(', ')})` }}
      />
      <div className="cs-legend__scale">
        <span>0</span>
        <span>40+</span>
      </div>
      <div className="cs-legend__col cs-legend__col--bands">
        {CC_LEGEND_BANDS.map(band => {
          const count = fileList.filter(f =>
            (f.maxCyclomatic ?? 0) >= band.minCC && (f.maxCyclomatic ?? 0) < band.maxCC
          ).length
          return (
            <div
              key={band.id}
              className={`cs-legend__band${selectedBand === band.id ? ' cs-legend__band--active' : ''}`}
              onClick={() => onBandSelect(band.id)}
            >
              <div className="cs-legend__band-label">
                <span className="cs-legend__dot" style={{ '--cs-swatch': band.color }} />
                <span className="cs-legend__label">{t(`cc_band_${band.id}`, lang)}</span>
              </div>
              {count > 0 && <span className="cs-legend__count">{count}</span>}
            </div>
          )
        })}
      </div>
      <div className="cs-legend__sep" />
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

function ExcludedBadges({ dirs, onRemove }) {
  return (
    <div className="cs-excluded-badges">
      {dirs.map(dir => (
        <span key={dir} className="cs-excluded-badge">
          <span className="cs-excluded-badge__name">⊘ {dir}</span>
          <button
            className="cs-excluded-badge__remove"
            onClick={() => onRemove(dir)}
            title="Remove exclusion"
          >×</button>
        </span>
      ))}
    </div>
  )
}

function CCFilePanel({ lang, band, fileList, onClose, onSelectFile }) {
  if (!band) return null
  const label = t(`cc_band_${band.id}`, lang)
  return (
    <div className="cs-file-panel">
      <div className="cs-file-panel__head">
        <div className="cs-file-panel__title">
          <span className="cs-legend__dot" style={{ '--cs-swatch': band.color }} />
          {label}
          <span className="cs-legend__count">({fileList.length})</span>
        </div>
        <button className="cs-file-panel__close" onClick={onClose} title="Sulje">✕</button>
      </div>
      <div className="cs-file-panel__list">
        {fileList.length === 0
          ? <div className="cs-file-panel__empty">—</div>
          : fileList
              .slice()
              .sort((a, b) => (b.maxCyclomatic ?? 0) - (a.maxCyclomatic ?? 0))
              .map(f => (
                <div
                  key={f.key}
                  className="cs-file-panel__item"
                  onClick={() => onSelectFile(f.key)}
                  title={f.key}
                >
                  <span className="cs-file-panel__name">{f.key.split(/[\\/]/).pop()}</span>
                  <span className="cs-file-panel__score" style={{ color: band.color }}>
                    {f.maxCyclomatic ?? '?'}
                  </span>
                </div>
              ))
        }
      </div>
    </div>
  )
}
