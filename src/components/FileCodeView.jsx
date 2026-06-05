import { useEffect, useRef, useState, useCallback } from 'react'
import ForceGraph3D from '3d-force-graph'
import { runtimeColor } from '../lib/runtime-colors.js'
import { VIRTUAL_API_COLOR } from '../lib/runtime-colors.js'
import { t } from '../lib/i18n.js'

const FILE_COLOR   = '#e2e8f0'
const FILE_SIZE    = 18
const LIB_COLOR    = VIRTUAL_API_COLOR   // syaani kirjastoille
const LIB_SIZE     = 10

function buildGraphData(data) {
  const { functions, externalImports, loc } = data

  const maxCyclomatic = Math.max(1, ...functions.map(f => f.cyclomatic))

  const nodes = [
    { id: '__file__', label: data.file.split('/').pop(), kind: 'file', loc, color: FILE_COLOR, val: FILE_SIZE },
    ...functions.map(fn => ({
      id: `fn:${fn.name}`,
      label: fn.name,
      kind: 'fn',
      lines: fn.lines,
      params: fn.params,
      cyclomatic: fn.cyclomatic,
      fnKind: fn.kind,
      color: runtimeColor(fn.cyclomatic, maxCyclomatic),
      val: 4 + Math.log1p(fn.lines) * 2,
    })),
    ...externalImports.map(lib => ({
      id: `lib:${lib}`,
      label: lib,
      kind: 'lib',
      color: LIB_COLOR,
      val: LIB_SIZE,
    })),
  ]

  const links = [
    ...functions.map(fn => ({ source: '__file__', target: `fn:${fn.name}` })),
    ...externalImports.map(lib => ({ source: '__file__', target: `lib:${lib}` })),
  ]

  return { nodes, links }
}

export default function FileCodeView({ filePath, activeRoot, onClose, lang = 'en' }) {
  const containerRef = useRef(null)
  const graphRef     = useRef(null)
  const [data, setData]       = useState(null)
  const [status, setStatus]   = useState('loading')
  const [hovered, setHovered] = useState(null)

  // Fetch file code data
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setStatus('loading')
    setData(null)
    const url = `/api/filecode?path=${encodeURIComponent(filePath)}`
    fetch(url)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (body.error) { setStatus(`error: ${body.error}`); return }
        setData(body)
        setStatus('ready')
      })
      .catch(e => { if (!cancelled) setStatus(`error: ${e.message}`) })
    return () => { cancelled = true }
  }, [filePath])

  // Build / destroy 3D graph
  useEffect(() => {
    if (status !== 'ready' || !data || !containerRef.current) return

    const { nodes, links } = buildGraphData(data)

    // Read the active theme's graph background from CSS so the 3D canvas matches
    const graphBg = getComputedStyle(document.documentElement)
      .getPropertyValue('--cs-graph-bg').trim() || '#0f172a'

    // Pin functions on z=0, libs on z=-300 for layered look
    nodes.forEach(n => {
      if (n.kind === 'fn')   n.fz = 0
      if (n.kind === 'lib')  n.fz = -300
      if (n.kind === 'file') n.fz = 200
    })

    const graph = ForceGraph3D()(containerRef.current)
      .backgroundColor(graphBg)
      .graphData({ nodes, links })
      .nodeColor(n => n.color)
      .nodeVal(n => n.val)
      .nodeLabel('')  // we handle tooltip ourselves
      .linkColor(() => '#334155')
      .linkWidth(0.5)
      .linkOpacity(0.6)
      .onNodeHover(node => setHovered(node ?? null))
      .onNodeClick(node => {
        if (node) {
          graph.cameraPosition(
            { x: node.x * 1.5, y: node.y * 1.5, z: node.z + 150 },
            node,
            600,
          )
        }
      })
      .d3Force('z-fn', () => {
        // Custom force: softly pin nodes to their fz layer
        nodes.forEach(n => {
          if (n.fz !== undefined) {
            n.vz = (n.vz ?? 0) + (n.fz - (n.z ?? 0)) * 0.05
          }
        })
      })

    graphRef.current = graph

    // Initial camera angle
    graph.cameraPosition({ x: 0, y: 0, z: 500 })

    return () => {
      graph._destructor?.()
      graphRef.current = null
    }
  }, [status, data])

  // Keyboard close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const fileName = filePath ? filePath.replace(activeRoot ? activeRoot + '/' : '', '') : ''

  return (
    <div
      className="cs-overlay cs-view--filecode"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Header bar */}
      <div className="cs-overlay__header">
        <span className="cs-overlay__brand">
          Codespace
        </span>
        <span className="cs-overlay__sub">
          {t('subtitle_filecode', lang)}
        </span>
        <span className="cs-overlay__name">
          {fileName}
        </span>
        {status === 'ready' && data && (
          <span className="cs-overlay__meta">
            · {data.loc} loc · {data.functions.length} {t('functions', lang)} · {data.externalImports.length} {t('imports', lang)}
          </span>
        )}
        {status === 'loading' && (
          <span className="cs-overlay__sub">
            {t('scanning', lang)}
          </span>
        )}
        {status.startsWith('error') && (
          <span className="cs-overlay__sub cs-status--error">{status}</span>
        )}
        <button
          onClick={onClose}
          className="cs-btn cs-btn--ghost cs-push-right"
        >
          {t('close', lang)} (Esc)
        </button>
      </div>

      {/* 3D canvas area */}
      <div ref={containerRef} className="cs-overlay__canvas" />

      {/* Hover tooltip */}
      {hovered && <CodeTooltip node={hovered} lang={lang} />}

      {/* Legend */}
      {status === 'ready' && <CodeLegend lang={lang} />}
    </div>
  )
}

function CodeTooltip({ node, lang }) {
  return (
    <div className="cs-tooltip">
      <div className="cs-tooltip__title" style={{ '--cs-ink': node.color }}>{node.label}</div>
      {node.kind === 'fn' && (
        <div className="cs-tooltip__section">
          <Row label={t('fn_kind', lang)}      value={node.fnKind} />
          <Row label={t('fn_lines', lang)}     value={node.lines} />
          <Row label={t('fn_params', lang)}    value={node.params} />
          <Row label={t('cyclomatic', lang)}   value={node.cyclomatic} color={node.color} />
        </div>
      )}
      {node.kind === 'lib' && (
        <div className="cs-tooltip__sub">{t('external_import', lang)}</div>
      )}
      {node.kind === 'file' && (
        <div className="cs-tooltip__sub">
          {node.loc} loc
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color }) {
  return (
    <div className="cs-metric">
      <span className="cs-metric__label">{label}</span>
      <span className="cs-metric__value" style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

function CodeLegend({ lang }) {
  const entries = [
    { color: FILE_COLOR, label: t('file_center', lang) },
    { color: '#22c55e',  label: `${t('cyclomatic', lang)} low` },
    { color: '#ef4444',  label: `${t('cyclomatic', lang)} high` },
    { color: LIB_COLOR,  label: t('external_import', lang) },
  ]
  return (
    <div className="cs-legend">
      <div className="cs-legend__title">
        {t('legend', lang).toUpperCase()}
      </div>
      {entries.map(({ color, label }) => (
        <div key={label} className="cs-legend__row">
          <span className="cs-legend__dot" style={{ '--cs-swatch': color }} />
          <span className="cs-legend__label">{label}</span>
        </div>
      ))}
    </div>
  )
}
