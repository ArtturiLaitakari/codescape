import { useEffect, useRef, useState } from 'react'
import { useGraphView, DEFAULT_LAYOUT_OPTIONS } from '../hooks/useGraphView.js'
import { useRuntimeStream } from '../hooks/useRuntimeStream.js'
import {
  RUNTIME_LEGEND_STOPS,
  VIRTUAL_DB_COLOR, VIRTUAL_API_COLOR,
} from '../lib/runtime-colors.js'
import { t, tf } from '../lib/i18n.js'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import FileCodeView from './FileCodeView.jsx'

// ── Band definitions (static) ─────────────────────────────────────────────────
const RUNTIME_BANDS = [
  { id: 'danger',  minT: 0.60,              color: '#ef4444' },
  { id: 'warning', minT: 0.30, maxT: 0.60,  color: '#eab308' },
  { id: 'ok',      minT: 0.00, maxT: 0.30,  color: '#22c55e' },
]
const BAND_LABEL = {
  danger:  { fi: 'Kriittinen', en: 'Critical',  sv: 'Kritisk'  },
  warning: { fi: 'Kohtalainen', en: 'Moderate', sv: 'Måttlig' },
  ok:      { fi: 'Matala',      en: 'Low',       sv: 'Låg'     },
}
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx'])

function getBandLabel(id, lang) {
  return BAND_LABEL[id]?.[lang] ?? BAND_LABEL[id]?.en ?? id
}
function countBand(fileList, band) {
  return fileList.filter(f => f.tScore >= band.minT && f.tScore < (band.maxT ?? Infinity)).length
}
function filterBand(fileList, bandId) {
  const band = RUNTIME_BANDS.find(b => b.id === bandId)
  if (!band) return fileList
  return fileList.filter(f => f.tScore >= band.minT && f.tScore < (band.maxT ?? Infinity))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RuntimeHeatmap({ sharedRoot, onRootChange, lang = 'en', theme, is3D, projectType = 'node', onViewReady }) {
  const containerRef   = useRef(null)
  const nodeAttrsRef   = useRef({})
  const cleanupRef     = useRef(null)

  const [fileList,     setFileList]     = useState([])
  const [selectedBand, setSelectedBand] = useState(null)
  const [scanProgress, setScanProgress] = useState(null)

  const {
    status, setStatus,
    hovered, setHovered,
    pinned, setPinned,
    nodeCount,
    inputValue, setInputValue,
    activeRoot, setActiveRoot,
    selectedFile, setSelectedFile,
    searchResetRef,
    load, getNodes, setFilter, patchNodes, addEdges, focusNode,
  } = useGraphView(containerRef, {
    is3D, theme, sharedRoot, onViewReady,
    setStatusOnReady: false,  // SSE done handler sets status='ready'
    forceOptions: {
      layoutMode: 'free',
      layoutOptions: { ...DEFAULT_LAYOUT_OPTIONS, chargeStrength: -120, linkDistance: 60, linkStrength: 0.3 },
    },
  })

  // ── SSE streaming ─────────────────────────────────────────────────────────

  const startStream = useRuntimeStream({
    nodeAttrsRef, load, patchNodes, addEdges, onRootChange,
    setStatus, setScanProgress, setActiveRoot, setInputValue, setFileList,
    projectType,
  })

  function loadGraph(targetPath) {
    cleanupRef.current?.()  // cancel any active SSE connection
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

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSubmit(e) {
    e.preventDefault()
    const val = inputValue.trim()
    if (val) loadGraph(val)
  }

  function handleReset() {
    setInputValue('')
    setFileList([])
    setSelectedBand(null)
    onRootChange?.(null)
    loadGraph('')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="cs-view cs-view--runtime">
      <RuntimeHeader
        status={status}
        scanProgress={scanProgress}
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

      {(hovered ?? pinned) && <RuntimeTooltip hovered={hovered ?? pinned} lang={lang} />}

      {status === 'ready' && (
        <RuntimeLegend
          lang={lang}
          fileList={fileList}
          selectedBand={selectedBand}
          onBandSelect={setSelectedBand}
        />
      )}

      {status === 'ready' && selectedBand !== null && (
        <RuntimeFilePanel
          fileList={filterBand(fileList, selectedBand)}
          selectedBand={selectedBand}
          onClose={() => setSelectedBand(null)}
          onSelectFile={(key, f) => {
            searchResetRef.current?.()
            setPinned(prev => prev?.key === key ? null : { key, ...f })
            focusNode(key)
          }}
          pinned={pinned}
          lang={lang}
        />
      )}

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

function RuntimeHeader({ status, scanProgress, nodeCount, inputValue, activeRoot, lang,
                         getNodes, setFilter, searchResetRef,
                         onInputChange, onSelect, onSubmit, onReset }) {
  const statusText = status === 'ready'
    ? tf('nodes_runtime', { count: nodeCount }, lang)
    : scanProgress
      ? `${t('scanning', lang)} ${scanProgress.done} / ${scanProgress.total}`
      : status === 'loading'
        ? t('scanning', lang)
        : status
  return (
    <div className="cs-header">
      <div className="cs-header__top">
        <span className="cs-title">Codescape</span>
        <span className="cs-subtitle">{t('subtitle_runtime', lang)}</span>
        <span className={`cs-status${status.startsWith('error') ? ' cs-status--error' : ''}`}>
          {statusText}
        </span>
      </div>
      <GraphHeaderForm
        inputValue={inputValue}
        activeRoot={activeRoot}
        loading={status === 'loading'}
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

// Tooltip body components keyed by node kind
function FileTooltipBody({ h, lang }) {
  return (
    <>
      <div className="cs-tooltip__sub">.{h.ext}</div>
      <div className="cs-tooltip__path">{h.key}</div>
      <div className="cs-tooltip__section">
        <MetricRow label={t('runtime_score',  lang)} value={(h.runtimeScore ?? 0).toFixed(1)} color="#f97316" />
        <MetricRow label={t('db_calls',        lang)} value={h.dbCallCount  ?? 0} color={VIRTUAL_DB_COLOR}  />
        <MetricRow label={t('api_calls',       lang)} value={h.apiCallCount ?? 0} color={VIRTUAL_API_COLOR} />
        <MetricRow label={t('max_cyclomatic',  lang)} value={h.cyclomatic   ?? 1} color="#94a3b8" />
      </div>
    </>
  )
}

function VirtualTooltipBody({ h, lang }) {
  const isDb  = h.kind === 'virtual-db'
  const color = isDb ? VIRTUAL_DB_COLOR : VIRTUAL_API_COLOR
  const value = isDb ? (h.dbCallerCount ?? 0) : (h.apiCallerCount ?? 0)
  return (
    <>
      <div className="cs-tooltip__path">{h.key}</div>
      <div className="cs-tooltip__section">
        <MetricRow
          label={isDb ? t('db_calls', lang) : t('api_calls', lang)}
          value={value}
          color={color}
        />
      </div>
    </>
  )
}

const TOOLTIP_BODY = {
  'file':        FileTooltipBody,
  'virtual-db':  VirtualTooltipBody,
  'virtual-api': VirtualTooltipBody,
}

function RuntimeTooltip({ hovered, lang }) {
  const Body = TOOLTIP_BODY[hovered.kind]
    ?? (() => <div className="cs-tooltip__path">{hovered.kind}</div>)
  return (
    <div className="cs-tooltip">
      <div className="cs-tooltip__title" style={{ '--cs-ink': hovered.color ?? 'var(--cs-text-primary)' }}>
        {hovered.label}
      </div>
      <Body h={hovered} lang={lang} />
    </div>
  )
}

function MetricRow({ label, value, color }) {
  return (
    <div className="cs-metric">
      <span className="cs-metric__label">{label}</span>
      <span className="cs-metric__value" style={{ '--cs-ink': color }}>{value}</span>
    </div>
  )
}

function RuntimeLegend({ lang, fileList, selectedBand, onBandSelect }) {
  return (
    <div className="cs-legend cs-legend--interactive">
      <div className="cs-legend__title">{t('runtime_score', lang).toUpperCase()}</div>
      <div
        className="cs-legend__gradient"
        style={{ '--cs-gradient': `linear-gradient(to right, ${RUNTIME_LEGEND_STOPS.map(s => s.color).join(', ')})` }}
      />
      <div className="cs-legend__scale"><span>0</span><span>max</span></div>
      <div className="cs-legend__col cs-legend__col--bands">
        {RUNTIME_BANDS.map(band => {
          const count = countBand(fileList, band)
          return (
            <div
              key={band.id}
              className={`cs-legend__band${selectedBand === band.id ? ' cs-legend__band--active' : ''}`}
              onClick={() => onBandSelect(selectedBand === band.id ? null : band.id)}
            >
              <div className="cs-legend__band-label">
                <span className="cs-legend__dot" style={{ '--cs-swatch': band.color }} />
                <span className="cs-legend__label">{getBandLabel(band.id, lang)}</span>
              </div>
              {count > 0 && <span className="cs-legend__count">{count}</span>}
            </div>
          )
        })}
      </div>
      <div className="cs-legend__sep" />
      <div className="cs-legend__col">
        {[
          { color: VIRTUAL_DB_COLOR,  label: 'Database'     },
          { color: VIRTUAL_API_COLOR, label: 'External API' },
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

function RuntimeFilePanel({ fileList, selectedBand, onClose, onSelectFile, pinned, lang }) {
  const band  = RUNTIME_BANDS.find(b => b.id === selectedBand)
  const label = getBandLabel(selectedBand, lang)
  const color = band?.color ?? 'var(--cs-text-sec)'

  return (
    <div className="cs-file-panel">
      <div className="cs-file-panel__head">
        <div className="cs-file-panel__title">
          <span className="cs-legend__dot" style={{ '--cs-swatch': color }} />
          {label}
          <span className="cs-legend__count">({fileList.length})</span>
        </div>
        <button className="cs-file-panel__close" onClick={onClose} title="Sulje">✕</button>
      </div>
      <div className="cs-file-panel__list">
        {fileList.length === 0
          ? <div className="cs-file-panel__empty">—</div>
          : fileList.map(f => (
            <div
              key={f.key}
              className={`cs-file-panel__row${pinned?.key === f.key ? ' cs-file-panel__row--pinned' : ''}`}
              onClick={() => onSelectFile(f.key, f)}
              title={f.key}
            >
              <span className="cs-legend__dot" style={{ '--cs-swatch': f.color }} />
              <span className="cs-file-panel__name">{f.label}</span>
              <span className="cs-file-panel__score" style={{ '--cs-ink': f.color }}>
                {f.runtimeScore.toFixed(1)}
              </span>
            </div>
          ))
        }
      </div>
    </div>
  )
}
