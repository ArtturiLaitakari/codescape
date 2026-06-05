import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from '../hooks/useSigmaGraph.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import {
  runtimeColor, runtimeSize,
  RUNTIME_LEGEND_STOPS,
  VIRTUAL_DB_COLOR, VIRTUAL_API_COLOR, VIRTUAL_NODE_SIZE,
} from '../lib/runtime-colors.js'
import { t, tf } from '../lib/i18n.js'
import { NodeSearchBar } from './NodeSearchBar.jsx'

const HEADER_H = 56

export default function RuntimeHeatmap({ sharedRoot, onRootChange, lang = 'en' }) {
  const containerRef = useRef(null)
  const [status, setStatus]     = useState('loading')
  const [hovered, setHovered]   = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [inputValue, setInputValue] = useState(sharedRoot ?? '')
  const [activeRoot, setActiveRoot] = useState(null)

  // key → { dbCallCount, apiCallCount, cyclomatic, runtimeScore } for virtual node callers lookup
  const nodeAttrsRef = useRef({})

  const onEnterNode = useCallback((key, attrs) => {
    setHovered({ key, ...attrs })
  }, [])
  const onLeaveNode = useCallback(() => setHovered(null), [])
  const onReady = useCallback((count) => { setNodeCount(count); setStatus('ready') }, [])

  const searchResetRef = useRef(null)
  const onClickNode = useCallback(() => { searchResetRef.current?.() }, [])

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
    onRootChange?.(null)
    loadGraph('')
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0f172a' }}>
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

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, paddingTop: HEADER_H }} />

      {hovered && <RuntimeTooltip hovered={hovered} nodeAttrsRef={nodeAttrsRef} lang={lang} />}
      {status === 'ready' && <RuntimeLegend lang={lang} />}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RuntimeHeader({ status, nodeCount, inputValue, activeRoot, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
  const loading = status === 'loading'
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <span style={styles.title}>Codespace</span>
        <span style={styles.subtitle}>{t('subtitle_runtime', lang)}</span>
        <span style={{
          ...styles.statusText, marginLeft: 'auto',
          color: status.startsWith('error') ? '#f87171' : '#64748b',
        }}>
          {status === 'ready'
            ? tf('nodes_runtime', { count: nodeCount }, lang)
            : status === 'loading'
              ? t('scanning', lang)
              : status}
        </span>
      </div>
      <form onSubmit={onSubmit} style={styles.pathRow}>
        <span style={styles.folderIcon}>📁</span>
        <input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={activeRoot ?? t('path_placeholder', lang)}
          spellCheck={false}
          style={styles.pathInput}
          onFocus={(e) => (e.target.style.borderColor = '#06b6d4')}
          onBlur={(e)  => (e.target.style.borderColor = '#334155')}
        />
        <button type="submit" disabled={loading} style={{ ...styles.submitBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {t('open', lang)}
        </button>
        {activeRoot && (
          <button type="button" onClick={onReset} disabled={loading} style={{ ...styles.resetBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {t('reset', lang)}
          </button>
        )}
        <div style={{ width: 1, background: '#334155', alignSelf: 'stretch', margin: '0 4px', flexShrink: 0 }} />
        <NodeSearchBar getNodes={getNodes} setFilter={setFilter} lang={lang} accent='#06b6d4' resetRef={searchResetRef} />
      </form>
    </div>
  )
}

function RuntimeTooltip({ hovered, lang }) {
  const isFile   = hovered.kind === 'file'
  const isVirtDb = hovered.kind === 'virtual-db'
  const isVirtApi = hovered.kind === 'virtual-api'

  return (
    <div style={styles.tooltip}>
      <div style={{ color: hovered.color ?? '#e2e8f0', fontWeight: 700 }}>{hovered.label}</div>

      {isFile && (
        <>
          <div style={{ color: '#64748b', marginTop: 2 }}>.{hovered.ext}</div>
          <div style={{ color: '#475569', marginTop: 2, maxWidth: 280, wordBreak: 'break-all' }}>{hovered.key}</div>
          <div style={{ marginTop: 8, borderTop: '1px solid #1e293b', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <MetricRow label={t('runtime_score', lang)} value={(hovered.runtimeScore ?? 0).toFixed(1)} color='#f97316' />
            <MetricRow label={t('db_calls',       lang)} value={hovered.dbCallCount  ?? 0} color={VIRTUAL_DB_COLOR}  />
            <MetricRow label={t('api_calls',      lang)} value={hovered.apiCallCount ?? 0} color={VIRTUAL_API_COLOR} />
            <MetricRow label={t('cyclomatic',     lang)} value={hovered.cyclomatic   ?? 1} color='#94a3b8' />
          </div>
        </>
      )}

      {(isVirtDb || isVirtApi) && (
        <>
          <div style={{ color: '#475569', marginTop: 2 }}>{hovered.key}</div>
          <div style={{ marginTop: 8, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
            <MetricRow
              label={isVirtDb ? t('db_calls', lang) : t('api_calls', lang)}
              value={isVirtDb ? (hovered.dbCallerCount ?? 0) : (hovered.apiCallerCount ?? 0)}
              color={isVirtDb ? VIRTUAL_DB_COLOR : VIRTUAL_API_COLOR}
            />
          </div>
        </>
      )}

      {!isFile && !isVirtDb && !isVirtApi && (
        <div style={{ color: '#475569', marginTop: 2 }}>{hovered.kind}</div>
      )}
    </div>
  )
}

function MetricRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: '#64748b', fontSize: 11 }}>{label}</span>
      <span style={{ color, fontSize: 11, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function RuntimeLegend({ lang }) {
  return (
    <div style={styles.legend}>
      <div style={{ color: '#64748b', fontSize: 10, marginBottom: 5, letterSpacing: 1 }}>
        {t('runtime_score', lang).toUpperCase()}
      </div>
      <div style={{
        height: 8, borderRadius: 4, marginBottom: 4, width: 120,
        background: `linear-gradient(to right, ${RUNTIME_LEGEND_STOPS.map(s => s.color).join(', ')})`,
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', width: 120, marginBottom: 10 }}>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>0</span>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>max</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: VIRTUAL_DB_COLOR, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94a3b8', fontSize: 11 }}>Database</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: VIRTUAL_API_COLOR, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94a3b8', fontSize: 11 }}>External API</span>
        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    background: 'rgba(15,23,42,0.92)',
    borderBottom: '1px solid #1e293b',
    backdropFilter: 'blur(6px)',
    padding: '6px 12px 6px 12px',
    height: HEADER_H,
    display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
  },
  headerTop: {
    display: 'flex', alignItems: 'baseline', gap: 10,
  },
  title: {
    color: '#06b6d4', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: 1,
  },
  subtitle: {
    color: '#475569', fontFamily: 'monospace', fontSize: 11,
  },
  statusText: {
    fontFamily: 'monospace', fontSize: 11,
  },
  pathRow: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  folderIcon: {
    fontSize: 14, flexShrink: 0,
  },
  pathInput: {
    flex: 1, minWidth: 0,
    background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
    color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11,
    padding: '3px 8px', outline: 'none',
    transition: 'border-color 0.15s',
  },
  submitBtn: {
    background: '#06b6d4', border: 'none', borderRadius: 5,
    color: '#0f172a', fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
    padding: '3px 10px', flexShrink: 0,
  },
  resetBtn: {
    background: 'transparent', border: '1px solid #334155', borderRadius: 5,
    color: '#64748b', fontFamily: 'monospace', fontSize: 11,
    padding: '3px 10px', flexShrink: 0,
  },
  tooltip: {
    position: 'absolute', bottom: 20, left: 20,
    background: 'rgba(15,23,42,0.95)', border: '1px solid #1e293b',
    borderRadius: 8, padding: '10px 14px',
    fontFamily: 'monospace', fontSize: 12,
    pointerEvents: 'none', zIndex: 15,
    minWidth: 180,
  },
  legend: {
    position: 'absolute', bottom: 20, right: 20,
    background: 'rgba(15,23,42,0.92)', border: '1px solid #1e293b',
    borderRadius: 8, padding: '12px 14px',
    fontFamily: 'monospace', fontSize: 11,
    pointerEvents: 'none', zIndex: 15,
  },
}
