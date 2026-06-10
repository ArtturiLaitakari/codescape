import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../lib/api-base.js'
import { VIRTUAL_API_COLOR } from '../lib/runtime-colors.js'
import { t } from '../lib/i18n.js'

const FILE_COLOR = 'var(--cs-text-primary)'
const LIB_COLOR  = VIRTUAL_API_COLOR

// Complexity tiers
const TIER_WAY_TOO_HIGH = { min: 20, color: '#c026d3', label: 'way_too_high' }
const TIER_HIGH         = { min: 10, color: '#ef4444', label: 'high'         }
const TIER_MED          = { min: 4,  color: '#eab308', label: 'medium'       }
const TIER_LOW          = { min: 0,  color: '#22c55e', label: 'low'          }

function tierOf(cc) {
  if (cc >= TIER_WAY_TOO_HIGH.min) return TIER_WAY_TOO_HIGH
  if (cc >= TIER_HIGH.min)         return TIER_HIGH
  if (cc >= TIER_MED.min)          return TIER_MED
  return TIER_LOW
}

// Maintainability index → color
function miColor(mi) {
  if (mi >= 70) return '#22c55e'
  if (mi >= 40) return '#eab308'
  return '#ef4444'
}

// ── Layout ──────────────────────────────────────────────────────────────────
const FILE_R = 28
const TRUNC  = 22
// Horizontal tree: column width and row height
const COL_W  = 240   // horizontal gap per depth level
const ROW_H  = 46    // vertical gap between siblings

const trim = (s) =>
  s && s.length > TRUNC ? s.slice(0, TRUNC - 1) + '…' : (s || '')

// Count total leaf slots in subtree (for height calculation)
function countSlots(fn) {
  if (!fn.children || fn.children.length === 0) return 1
  return fn.children.reduce((s, c) => s + countSlots(c), 0)
}

function buildLayout(data) {
  const { functions = [], file = '' } = data
  const center = { x: 80, y: 0, label: file.split('/').pop() }

  const roots = [...functions].sort((a, b) => b.cyclomatic - a.cyclomatic)
  if (roots.length === 0) return { center, nodes: [], edges: [], height: 200 }

  const nodes = []
  const edges = []

  // Assign a Y slot index to every node using an in-order traversal
  let slotCounter = 0

  function placeSubtree(fn, depth) {
    const mySlotStart = slotCounter
    const children = fn.children ?? []

    // Place children first to get their slots
    const childNodes = []
    for (const child of [...children].sort((a, b) => b.cyclomatic - a.cyclomatic)) {
      childNodes.push(placeSubtree(child, depth + 1))
    }

    // My Y = centre of my children's range (or current slot if leaf)
    let mySlot
    if (childNodes.length === 0) {
      mySlot = slotCounter
      slotCounter++
    } else {
      mySlot = (mySlotStart + slotCounter - 1) / 2
    }

    const tier = tierOf(fn.cyclomatic)
    const r    = Math.max(5, 4 + Math.sqrt(Math.max(1, fn.lines)) * 1.1)
    const x    = 80 + (depth + 1) * COL_W
    const y    = mySlot * ROW_H
    const id   = `fn:${fn.name}:${fn.startLine ?? depth}`

    nodes.push({
      id, label: fn.name, kind: 'fn', isRoot: fn.isRoot ?? false,
      startLine: fn.startLine ?? null, lines: fn.lines, params: fn.params,
      cyclomatic: fn.cyclomatic, fnKind: fn.kind,
      tier: tier.label, color: tier.color, r, x, y, depth,
    })

    return { id, x, y, color: tier.color, depth, childNodes }
  }

  // First pass: build node list + slot assignments
  const rootResults = roots.map(fn => placeSubtree(fn, 0))
  const totalHeight = Math.max(200, slotCounter * ROW_H)

  // Center file node vertically
  center.y = (slotCounter - 1) / 2 * ROW_H

  // Second pass: build edges (needs x/y which are now known)
  function buildEdges(parentX, parentY, result) {
    const node = nodes.find(n => n.id === result.id)
    if (!node) return
    edges.push({ fromX: parentX, fromY: parentY, toX: node.x, toY: node.y, color: node.color, depth: node.depth })
    for (const child of result.childNodes) {
      buildEdges(node.x, node.y, child)
    }
  }
  for (const r of rootResults) buildEdges(center.x, center.y, r)

  return { center, nodes, edges, height: totalHeight }
}

// Horizontal right-angle elbow connector
function elbowPath(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2
  return `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`
}

// ── SVG Mind Map — horizontal tree + pan/zoom ────────────────────────────────
function MindMap({ data, hovered, onHover, filePath, activeRoot }) {
  const svgRef  = useRef(null)
  const [view,  setView]  = useState({ x: 40, y: 0, scale: 1 })
  const dragRef = useRef(null)

  function openInEditor(n) {
    if (!n.startLine || !filePath) return
    const absPath = filePath.startsWith('/')
      ? filePath
      : activeRoot ? `${activeRoot}/${filePath}` : filePath
    window.location.href = `vscode://file/${absPath}:${n.startLine}`
  }

  const { center, nodes, edges, height } = buildLayout(data)
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0)

  // Reset view to fit when data changes
  useEffect(() => { setView({ x: 40, y: 0, scale: 1 }) }, [data])

  // Pan — only start if not clicking a node (target === svg or g[data-bg])
  function onMouseDown(e) {
    if (e.button !== 0) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
  }
  function onMouseMove(e) {
    const drag = dragRef.current
    if (!drag) return
    setView(v => ({ ...v,
      x: drag.vx + (e.clientX - drag.sx),
      y: drag.vy + (e.clientY - drag.sy),
    }))
  }
  function onMouseUp() { dragRef.current = null }

  // Zoom toward cursor
  function onWheel(e) {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const rect  = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    setView(v => {
      const ns = Math.min(5, Math.max(0.1, v.scale * delta))
      return {
        scale: ns,
        x: px - (px - v.x) * (ns / v.scale),
        y: py - (py - v.y) * (ns / v.scale),
      }
    })
  }

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      style={{ position: 'absolute', inset: 0, cursor: dragRef.current ? 'grabbing' : 'grab', userSelect: 'none' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>

        {/* Edges */}
        {edges.map((e, i) => (
          <path
            key={`e-${i}`}
            d={elbowPath(e.fromX, e.fromY, e.toX, e.toY)}
            stroke={e.color}
            strokeWidth={e.depth === 0 ? 1.5 : 1}
            strokeOpacity={Math.max(0.15, 0.38 - e.depth * 0.04)}
            fill="none"
          />
        ))}

        {/* Nodes */}
        {nodes.map(n => {
          const isHov = hovered?.id === n.id
          const nodeR = n.r + (isHov ? 2 : 0)
          const lx    = n.x + nodeR + 7
          const fs    = Math.max(8, 11 - n.depth)

          return (
            <g
              key={n.id}
              style={{ cursor: n.startLine ? 'pointer' : 'default' }}
              onMouseEnter={e => { e.stopPropagation(); onHover(n) }}
              onMouseLeave={e => { e.stopPropagation(); onHover(null) }}
              onDoubleClick={e => { e.stopPropagation(); openInEditor(n) }}
            >
              {isHov && <circle cx={n.x} cy={n.y} r={nodeR + 6} fill={n.color} fillOpacity={0.12} />}
              {n.isRoot ? (
                <rect
                  x={n.x - nodeR} y={n.y - nodeR}
                  width={nodeR * 2} height={nodeR * 2} rx={3}
                  fill={n.color} fillOpacity={isHov ? 1 : 0.85}
                  stroke="#fff" strokeWidth={isHov ? 1.5 : 0.8} strokeOpacity={isHov ? 1 : 0.4}
                />
              ) : (
                <circle cx={n.x} cy={n.y} r={nodeR}
                  fill={n.color} fillOpacity={isHov ? 1 : 0.85}
                  stroke={isHov ? '#fff' : 'none'} strokeWidth={1.5}
                />
              )}
              <text x={lx} y={n.y - 3} textAnchor="start" fontSize={fs}
                fill="var(--cs-text-primary)" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {trim(n.label)}
              </text>
              {!n.isRoot && (
                <text x={lx} y={n.y + fs - 2} textAnchor="start" fontSize={fs - 2}
                  fill={n.color} style={{ fontFamily: 'monospace' }}>
                  {`CC:\u00a0${n.cyclomatic}`}
                </text>
              )}
              <text x={lx} y={n.isRoot ? n.y + fs - 2 : n.y + fs * 2 - 2} textAnchor="start" fontSize={fs - 2}
                fill="#64748b" style={{ fontFamily: 'monospace' }}>
                {`row:\u00a0${n.lines}`}
              </text>
            </g>
          )
        })}

        {/* Center file node */}
        <circle cx={center.x} cy={center.y} r={FILE_R}
          fill="#1e293b" stroke={FILE_COLOR} strokeWidth={2} />
        <text x={center.x} y={center.y - 5} textAnchor="middle" fontSize={10}
          fill={FILE_COLOR} style={{ fontFamily: 'ui-monospace, monospace' }}>
          {trim(center.label)}
        </text>
        {data.loc != null && (
          <text x={center.x} y={center.y + 7} textAnchor="middle" fontSize={8} fill="#64748b">
            {data.loc}&nbsp;loc
          </text>
        )}

      </g>

      {/* Zoom hint */}
      <text x="8" y="16" fontSize={9} fill="#334155" style={{ pointerEvents: 'none', userSelect: 'none' }}>
        scroll to zoom · drag to pan · double-click to open
      </text>
    </svg>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function FileCodeView({ filePath, activeRoot, onClose, lang = 'en' }) {
  const [data,    setData]    = useState(null)
  const [status,  setStatus]  = useState('loading')
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setStatus('loading')
    setData(null)
    fetch(`${API_BASE}/api/filecode?path=${encodeURIComponent(filePath)}`)
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

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const fileName = filePath
    ? filePath.replace(activeRoot ? activeRoot + '/' : '', '')
    : ''

  return (
    <div
      className="cs-overlay cs-view--filecode"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="cs-overlay__header">
        <span className="cs-overlay__brand">Codescape</span>
        <span className="cs-overlay__sub">{t('subtitle_filecode', lang)}</span>
        <span className="cs-overlay__name">{fileName}</span>
        {status === 'ready' && data && (
          <span className="cs-overlay__meta">
            · {data.loc} loc · {data.complexity?.functionCount ?? data.functions.length} {t('functions', lang)} · {data.externalImports.length} {t('libraries_label', lang)}
          </span>
        )}
        {status === 'loading' && (
          <span className="cs-overlay__sub">{t('scanning', lang)}</span>
        )}
        {status.startsWith('error') && (
          <span className="cs-overlay__sub cs-status--error">{status}</span>
        )}
        <button onClick={onClose} className="cs-btn cs-btn--ghost cs-push-right">
          {t('close', lang)} (Esc)
        </button>
      </div>

      {/* Mind map */}
      <div className="cs-overlay__canvas">
        {status === 'loading' && (
          <div className="cs-spinner-wrap">
            <svg className="cs-spinner" viewBox="0 0 50 50">
              <circle cx="25" cy="25" r="20" fill="none" strokeWidth="3"
                stroke="#64748b" />
              <circle cx="25" cy="25" r="20" fill="none" strokeWidth="3"
                stroke="#6366f1" strokeDasharray="60 200" strokeLinecap="round" />
            </svg>
            <span className="cs-spinner-label">{t('scanning', lang)}</span>
          </div>
        )}
        {status === 'ready' && data && (
          <MindMap data={data} hovered={hovered} onHover={setHovered} filePath={filePath} activeRoot={activeRoot} />
        )}
      </div>

      {/* Analysis panel */}
      {status === 'ready' && data?.complexity && (
        <AnalysisPanel complexity={data.complexity} lang={lang} />
      )}

      {hovered && <CodeTooltip node={hovered} lang={lang} />}
      {status === 'ready' && <CodeLegend lang={lang} />}
    </div>
  )
}

function AnalysisPanel({ complexity, lang }) {
  const {
    loc, functionCount, avgCyclomatic, maxCyclomatic,
    vocabulary, maintainability, wayTooHighCount, highCount, medCount, lowCount,
  } = complexity

  const total = Math.max(1, wayTooHighCount + highCount + medCount + lowCount)
  const miC = miColor(maintainability)

  return (
    <div className="cs-analysis">
      <div className="cs-analysis__head">
        <span className="cs-analysis__title">{t('analysis', lang)}</span>
        <div className="cs-analysis__score">
          <span className="cs-analysis__mi" style={{ '--cs-ink': miC }}>
            {maintainability}
          </span>
          <span className="cs-analysis__mi-label">{t('maintainability', lang)} {t('mi_label', lang)}</span>
        </div>
      </div>
      <div className="cs-analysis__body">
        <MetricRow label={t('loc', lang)}           val={loc} />
        <MetricRow label={t('fn_count', lang)}      val={functionCount} />
        <MetricRow label={t('avg_cyclomatic', lang)} val={avgCyclomatic} color={miColor(100 - avgCyclomatic * 5)} />
        <MetricRow label={t('max_cyclomatic', lang)} val={maxCyclomatic} color={tierOf(maxCyclomatic).color} />
        <MetricRow label={t('vocab', lang)}          val={vocabulary} />

        <div className="cs-analysis__sep" />

        <div style={{ color: 'var(--cs-text-muted)', fontSize: 10, marginBottom: 2 }}>
          {t('complexity_dist', lang).toUpperCase()}
        </div>

        <BandBar color={TIER_WAY_TOO_HIGH.color} label={t('band_way_too_high', lang)} count={wayTooHighCount} total={total} />
        <BandBar color={TIER_HIGH.color}         label={t('band_high',         lang)} count={highCount}       total={total} />
        <BandBar color={TIER_MED.color}          label={t('band_med',          lang)} count={medCount}        total={total} />
        <BandBar color={TIER_LOW.color}          label={t('band_low',          lang)} count={lowCount}        total={total} />
      </div>
    </div>
  )
}

function MetricRow({ label, val, color }) {
  return (
    <div className="cs-analysis__row">
      <span className="cs-analysis__key">{label}</span>
      <span className="cs-analysis__val" style={color ? { '--cs-ink': color } : undefined}>{val}</span>
    </div>
  )
}

function BandBar({ color, label, count, total }) {
  const pct = Math.round((count / total) * 100)
  return (
    <div className="cs-analysis__band">
      <span className="cs-analysis__band-dot" style={{ '--cs-swatch': color }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span className="cs-analysis__band-label">{label}</span>
          <span className="cs-analysis__band-count">{count}</span>
        </div>
        <div className="cs-analysis__bar-wrap">
          <div className="cs-analysis__bar-fill" style={{ '--cs-ink': color, width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function CodeTooltip({ node, lang }) {
  return (
    <div className="cs-tooltip" style={{ bottom: 16, right: 16, left: 'unset' }}>
      <div className="cs-tooltip__title" style={{ '--cs-ink': node.color }}>{node.label}</div>
      {node.kind === 'fn' && (
        <>
          <div className="cs-tooltip__sub">
            {node.fnKind} · {node.tier}
            {node.isRoot && <span style={{ marginLeft: 6, color: '#a78bfa', fontWeight: 600 }}>⬛ root export</span>}
          </div>
          <div className="cs-tooltip__section">
            <Row label={t('fn_lines',  lang)} value={node.lines} />
            <Row label={t('fn_params', lang)} value={node.params} />
            <Row label={t('cyclomatic', lang)} value={node.cyclomatic} color={tierOf(node.cyclomatic).color} />
          </div>
        </>
      )}
      {node.kind === 'lib' && (
        <div className="cs-tooltip__sub">{t('external_import', lang)}</div>
      )}
      {node.kind === 'file' && (
        <div className="cs-tooltip__sub">{node.loc} loc</div>
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
    { color: FILE_COLOR,             label: t('file_center', lang) },
    { color: TIER_WAY_TOO_HIGH.color, label: `${t('cyclomatic', lang)} ≥20` },
    { color: TIER_HIGH.color,        label: `${t('cyclomatic', lang)} 10–19` },
    { color: TIER_MED.color,         label: `${t('cyclomatic', lang)} 4–9` },
    { color: TIER_LOW.color,         label: `${t('cyclomatic', lang)} <4` },
    { color: LIB_COLOR,              label: t('external_import', lang) },
  ]
  return (
    <div className="cs-legend">
      <div className="cs-legend__title">{t('legend', lang).toUpperCase()}</div>
      {entries.map(({ color, label }) => (
        <div key={label} className="cs-legend__row">
          <span className="cs-legend__dot" style={{ '--cs-swatch': color }} />
          <span className="cs-legend__label">{label}</span>
        </div>
      ))}
    </div>
  )
}

