import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import {
  runtimeColor, runtimeSize,
  RUNTIME_LEGEND_STOPS,
  VIRTUAL_DB_COLOR, VIRTUAL_API_COLOR, VIRTUAL_NODE_SIZE,
} from '../lib/runtime-colors.js'
import { t, tf } from '../lib/i18n.js'
import { GraphHeaderForm } from './GraphHeaderForm.jsx'
import FileCodeView from './FileCodeView.jsx'

// ── Band definitions (static) ────────────────────────────────────────────────
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

export default function RuntimeHeatmap({ sharedRoot, onRootChange, lang = 'en', onViewReady }) {
  const containerRef = useRef(null)
  const [status, setStatus]     = useState('loading')
  const [hovered, setHovered]   = useState(null)
  const [pinned, setPinned]     = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [inputValue, setInputValue] = useState(sharedRoot ?? '')
  const [activeRoot, setActiveRoot] = useState(null)
  const [fileList, setFileList]     = useState([])  // [{ key, label, color, runtimeScore, tScore, ... }]
  const [selectedBand, setSelectedBand] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [scanProgress, setScanProgress] = useState(null)  // null | { done, total }

  // key → { dbCallCount, apiCallCount, cyclomatic, runtimeScore } for virtual node callers lookup
  const nodeAttrsRef = useRef({})

  const onEnterNode = useCallback((key, attrs) => {
    setHovered({ key, ...attrs })
  }, [])
  const onLeaveNode = useCallback(() => setHovered(null), [])
  // onReady fires when Sigma first renders — dismiss the full-screen spinner,
  // but don't set status 'ready' yet if SSE streaming is still in progress.
  const onReady = useCallback((count) => { setNodeCount(count); onViewReady?.() }, [onViewReady])

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

  const { load, getNodes, setFilter, patchNodes, addEdges, focusNode } = useSigmaGraph(containerRef, {
    onEnterNode, onLeaveNode, onReady, onClickNode, onDoubleClickNode,
  })

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setScanProgress(null)
    setHovered(null)

    const url = targetPath
      ? `/api/runtimegraph/stream?path=${encodeURIComponent(targetPath)}`
      : '/api/runtimegraph/stream'

    const es = new EventSource(url)

    // Accumulated runtime data + running max score (both mutable, not React state)
    const accData = {}  // key → { dbCallCount, apiCallCount, cyclomatic, runtimeScore }
    let maxScore = 0

    function runtimeAttrs(key, d) {
      const rs = d.dbCallCount * 3 + d.apiCallCount * 2 + d.cyclomatic * 0.5
      const base = nodeAttrsRef.current[key] ?? { kind: 'file' }
      return { ...d, runtimeScore: rs, color: runtimeColor(rs, maxScore), size: runtimeSize(rs, nodeSize(base)) }
    }

    es.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'tree') {
        // Index attrs, build initial graph with neutral file colours
        const attrsMap = {}
        for (const { key, attributes } of msg.nodes) attrsMap[key] = attributes
        nodeAttrsRef.current = attrsMap

        const nodes = msg.nodes.map(({ key, attributes: a }) => {
          if (a.kind === 'virtual-db')  return { key, attributes: { ...a, color: VIRTUAL_DB_COLOR,  size: VIRTUAL_NODE_SIZE } }
          if (a.kind === 'virtual-api') return { key, attributes: { ...a, color: VIRTUAL_API_COLOR, size: VIRTUAL_NODE_SIZE } }
          if (a.kind === 'file') return { key, attributes: { ...a, color: '#334155', size: nodeSize(a) } }
          const dc = a.kind === 'dir' ? '#334155' : a.kind === 'dir-empty' ? '#1e293b' : nodeColor(a)
          return { key, attributes: { ...a, color: dc, size: nodeSize(a) } }
        })
        load(nodes, msg.treeEdges, '__root__', [])
        setActiveRoot(msg.root)
        setInputValue(msg.root)
        onRootChange?.(msg.root)
        setScanProgress({ done: 0, total: msg.total })
        setStatus('scanning')
      }

      if (msg.type === 'batch') {
        // Accumulate new data, update running maxScore
        for (const [key, d] of Object.entries(msg.runtimeData)) {
          const rs = d.dbCallCount * 3 + d.apiCallCount * 2 + d.cyclomatic * 0.5
          accData[key] = { ...d, runtimeScore: rs }
          if (rs > maxScore) maxScore = rs
        }
        // Recolor ALL seen file nodes so relative scale stays correct
        patchNodes(Object.entries(accData).map(([key, d]) => ({ key, attributes: runtimeAttrs(key, d) })))
        setScanProgress({ done: msg.done, total: msg.total })
      }

      if (msg.type === 'done') {
        // Update virtual node caller counts + add runtime edges
        patchNodes([
          { key: '__db__',  attributes: { dbCallerCount:  msg.dbCallerCount  } },
          { key: '__api__', attributes: { apiCallerCount: msg.apiCallerCount } },
        ])
        addEdges(msg.runtimeEdges)

        // Build file list from accumulated data
        const fileSorted = Object.entries(accData)
          .map(([key, d]) => {
            const na = nodeAttrsRef.current[key] ?? {}
            return {
              key, label: na.label ?? key.split('/').pop(),
              color: runtimeColor(d.runtimeScore, maxScore),
              runtimeScore: d.runtimeScore,
              tScore: maxScore > 0 ? d.runtimeScore / maxScore : 0,
              kind: 'file', ext: na.ext,
              dbCallCount: d.dbCallCount, apiCallCount: d.apiCallCount, cyclomatic: d.cyclomatic,
            }
          })
          .sort((a, b) => b.runtimeScore - a.runtimeScore)
        setFileList(fileSorted)
        setScanProgress(null)
        setStatus('ready')
        es.close()
      }

      if (msg.type === 'error') {
        setStatus(`error: ${msg.error}`)
        setScanProgress(null)
        es.close()
      }
    }

    es.onerror = () => { setStatus('error: connection failed'); setScanProgress(null); es.close() }

    return () => es.close()
  }, [load, patchNodes, addEdges, onRootChange])

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
    setFileList([])
    setSelectedBand(null)
    onRootChange?.(null)
    loadGraph('')
  }

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
            const isAlreadyPinned = pinned?.key === key
            setPinned(isAlreadyPinned ? null : { key, ...f })
            // Always focus the clicked node — never clear from panel
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

function RuntimeHeader({ status, scanProgress, nodeCount, inputValue, activeRoot, lang, getNodes, setFilter, searchResetRef, onInputChange, onSelect, onSubmit, onReset }) {
  const loading = status === 'loading'
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
        <span className="cs-title">Codespace</span>
        <span className="cs-subtitle">{t('subtitle_runtime', lang)}</span>
        <span className={`cs-status${status.startsWith('error') ? ' cs-status--error' : ''}`}>
          {statusText}
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

function RuntimeTooltip({ hovered, lang }) {
  const isFile    = hovered.kind === 'file'
  const isVirtDb  = hovered.kind === 'virtual-db'
  const isVirtApi = hovered.kind === 'virtual-api'

  return (
    <div className="cs-tooltip">
      <div className="cs-tooltip__title" style={{ '--cs-ink': hovered.color ?? 'var(--cs-text-primary)' }}>{hovered.label}</div>

      {isFile && (
        <>
          <div className="cs-tooltip__sub">.{hovered.ext}</div>
          <div className="cs-tooltip__path">{hovered.key}</div>
          <div className="cs-tooltip__section">
            <MetricRow label={t('runtime_score', lang)} value={(hovered.runtimeScore ?? 0).toFixed(1)} color='#f97316' />
            <MetricRow label={t('db_calls',       lang)} value={hovered.dbCallCount  ?? 0} color={VIRTUAL_DB_COLOR}  />
            <MetricRow label={t('api_calls',      lang)} value={hovered.apiCallCount ?? 0} color={VIRTUAL_API_COLOR} />
            <MetricRow label={t('max_cyclomatic',  lang)} value={hovered.cyclomatic   ?? 1} color='#94a3b8' />
          </div>
        </>
      )}

      {(isVirtDb || isVirtApi) && (
        <>
          <div className="cs-tooltip__path">{hovered.key}</div>
          <div className="cs-tooltip__section">
            <MetricRow
              label={isVirtDb ? t('db_calls', lang) : t('api_calls', lang)}
              value={isVirtDb ? (hovered.dbCallerCount ?? 0) : (hovered.apiCallerCount ?? 0)}
              color={isVirtDb ? VIRTUAL_DB_COLOR : VIRTUAL_API_COLOR}
            />
          </div>
        </>
      )}

      {!isFile && !isVirtDb && !isVirtApi && (
        <div className="cs-tooltip__path">{hovered.kind}</div>
      )}
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
      <div className="cs-legend__title">
        {t('runtime_score', lang).toUpperCase()}
      </div>
      <div
        className="cs-legend__gradient"
        style={{ '--cs-gradient': `linear-gradient(to right, ${RUNTIME_LEGEND_STOPS.map(s => s.color).join(', ')})` }}
      />
      <div className="cs-legend__scale">
        <span>0</span>
        <span>max</span>
      </div>
      <div className="cs-legend__col" style={{ marginBottom: 6 }}>
        {RUNTIME_BANDS.map(band => {
          const count = countBand(fileList, band)
          return (
            <div
              key={band.id}
              className={`cs-legend__band${selectedBand === band.id ? ' cs-legend__band--active' : ''}`}
              onClick={() => onBandSelect(selectedBand === band.id ? null : band.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <div className="cs-legend__row">
          <span className="cs-legend__dot" style={{ '--cs-swatch': VIRTUAL_DB_COLOR }} />
          <span className="cs-legend__label">Database</span>
        </div>
        <div className="cs-legend__row">
          <span className="cs-legend__dot" style={{ '--cs-swatch': VIRTUAL_API_COLOR }} />
          <span className="cs-legend__label">External API</span>
        </div>
      </div>
    </div>
  )
}

function RuntimeFilePanel({ fileList, selectedBand, onClose, onSelectFile, pinned, lang }) {
  const band = RUNTIME_BANDS.find(b => b.id === selectedBand)
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
        {fileList.map(f => (
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
        ))}
        {fileList.length === 0 && (
          <div style={{ padding: '8px 10px', color: 'var(--cs-text-dim)', fontSize: 10 }}>—</div>
        )}
      </div>
    </div>
  )
}

