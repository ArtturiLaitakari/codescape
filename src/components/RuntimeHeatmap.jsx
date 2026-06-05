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

export default function RuntimeHeatmap({ sharedRoot, onRootChange, lang = 'en' }) {
  const containerRef = useRef(null)
  const [status, setStatus]     = useState('loading')
  const [hovered, setHovered]   = useState(null)
  const [pinned, setPinned]     = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [inputValue, setInputValue] = useState(sharedRoot ?? '')
  const [activeRoot, setActiveRoot] = useState(null)
  const [fileList, setFileList]     = useState([])  // [{ key, label, color, runtimeScore, tScore, ... }]
  const [selectedBand, setSelectedBand] = useState(null)

  // key → { dbCallCount, apiCallCount, cyclomatic, runtimeScore } for virtual node callers lookup
  const nodeAttrsRef = useRef({})

  const onEnterNode = useCallback((key, attrs) => {
    setHovered({ key, ...attrs })
  }, [])
  const onLeaveNode = useCallback(() => setHovered(null), [])
  const onReady = useCallback((count) => { setNodeCount(count); setStatus('ready') }, [])

  const searchResetRef = useRef(null)
  const onClickNode = useCallback((key, attrs) => {
    searchResetRef.current?.()
    setPinned(prev => prev?.key === key ? null : { key, ...attrs })
  }, [])

  const { load, getNodes, setFilter } = useSigmaGraph(containerRef, {
    onEnterNode, onLeaveNode, onReady, onClickNode,
  })

  const loadGraph = useCallback((targetPath) => {
    setStatus('loading')
    setHovered(null)
    let cancelled = false
    const url = targetPath
      ? `/api/runtimegraph?path=${encodeURIComponent(targetPath)}`
      : '/api/runtimegraph'

    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body.error) throw new Error(body.error)
        setActiveRoot(body.root)
        setInputValue(body.root)
        onRootChange?.(body.root)

        // Index node attributes for tooltip lookups
        const attrsMap = {}
        for (const { key, attributes } of body.nodes) attrsMap[key] = attributes
        nodeAttrsRef.current = attrsMap

        // Compute max score from file nodes only
        const maxScore = body.nodes.reduce((m, n) => {
          return n.attributes.kind === 'file' ? Math.max(m, n.attributes.runtimeScore ?? 0) : m
        }, 0)

        // Map nodes: override color/size based on kind
        const nodes = body.nodes.map(({ key, attributes }) => {
          if (attributes.kind === 'file') {
            return {
              key,
              attributes: {
                ...attributes,
                color: runtimeColor(attributes.runtimeScore ?? 0, maxScore),
                size:  runtimeSize(attributes.runtimeScore ?? 0, nodeSize(attributes)),
              },
            }
          }
          if (attributes.kind === 'virtual-db') {
            return { key, attributes: { ...attributes, color: VIRTUAL_DB_COLOR,  size: VIRTUAL_NODE_SIZE } }
          }
          if (attributes.kind === 'virtual-api') {
            return { key, attributes: { ...attributes, color: VIRTUAL_API_COLOR, size: VIRTUAL_NODE_SIZE } }
          }
          // dirs / root
          const dirColor = attributes.kind === 'dir'
            ? '#334155'
            : attributes.kind === 'dir-empty'
              ? '#1e293b'
              : nodeColor(attributes)
          return { key, attributes: { ...attributes, color: dirColor, size: nodeSize(attributes) } }
        })

        load(nodes, body.treeEdges, '__root__', body.runtimeEdges)

        // Build sorted file list for the filter panel
        const fileSorted = nodes
          .filter(n => n.attributes.kind === 'file')
          .map(n => ({
            key: n.key,
            label: n.attributes.label,
            color: n.attributes.color,
            runtimeScore: n.attributes.runtimeScore ?? 0,
            tScore: maxScore > 0 ? (n.attributes.runtimeScore ?? 0) / maxScore : 0,
            kind: n.attributes.kind,
            ext: n.attributes.ext,
            dbCallCount: n.attributes.dbCallCount,
            apiCallCount: n.attributes.apiCallCount,
            cyclomatic: n.attributes.cyclomatic,
          }))
          .sort((a, b) => b.runtimeScore - a.runtimeScore)
        setFileList(fileSorted)
      })
      .catch((e) => { if (!cancelled) setStatus(`error: ${e.message}`) })

    return () => { cancelled = true }
  }, [load, onRootChange])

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
          }}
          pinned={pinned}
          lang={lang}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RuntimeHeader({ status, nodeCount, inputValue, activeRoot, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
  const loading = status === 'loading'
  return (
    <div className="cs-header">
      <div className="cs-header__top">
        <span className="cs-title">Codespace</span>
        <span className="cs-subtitle">{t('subtitle_runtime', lang)}</span>
        <span className={`cs-status${status.startsWith('error') ? ' cs-status--error' : ''}`}>
          {status === 'ready'
            ? tf('nodes_runtime', { count: nodeCount }, lang)
            : status === 'loading'
              ? t('scanning', lang)
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

function RuntimeTooltip({ hovered, lang }) {
  const isFile   = hovered.kind === 'file'
  const isVirtDb = hovered.kind === 'virtual-db'
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
            <MetricRow label={t('cyclomatic',     lang)} value={hovered.cyclomatic   ?? 1} color='#94a3b8' />
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

