import { useEffect, useState } from 'react'
import { VIRTUAL_API_COLOR } from '../lib/runtime-colors.js'
import { t } from '../lib/i18n.js'

const FILE_COLOR = '#e2e8f0'
const LIB_COLOR  = VIRTUAL_API_COLOR

// Complexity tiers
const TIER_HIGH   = { min: 10,  color: '#ef4444', label: 'high'   }
const TIER_MED    = { min: 4,   color: '#eab308', label: 'medium' }
const TIER_LOW    = { min: 0,   color: '#22c55e', label: 'low'    }

function tierOf(cc) {
  if (cc >= TIER_HIGH.min) return TIER_HIGH
  if (cc >= TIER_MED.min)  return TIER_MED
  return TIER_LOW
}

// Maintainability index → color
function miColor(mi) {
  if (mi >= 70) return '#22c55e'
  if (mi >= 40) return '#eab308'
  return '#ef4444'
}

// ── Layout ──────────────────────────────────────────────────────────────────
const VIEW_W = 1200
const VIEW_H = 750
const CX     = VIEW_W / 2
const CY     = VIEW_H / 2
const FILE_R = 28
const TRUNC  = 22

const trim = (s) =>
  s && s.length > TRUNC ? s.slice(0, TRUNC - 1) + '…' : (s || '')

function buildLayout(data) {
  const { functions = [], externalImports = [], file = '', loc } = data
  const center     = { x: CX, y: CY, label: file.split('/').pop(), loc }
  const sortedFns  = [...functions].sort((a, b) => b.cyclomatic - a.cyclomatic)
  const total      = sortedFns.length + externalImports.length

  if (total === 0) return { center, leaves: [] }

  // Radius: ensure ≥ 46 px of arc between adjacent nodes
  const baseR    = Math.max(230, (total * 46) / (2 * Math.PI))
  const GAP      = 0.28  // radian gap between fn-arc and lib-arc
  const totalArc = 2 * Math.PI - GAP
  const fnCount  = sortedFns.length
  const libCount = externalImports.length
  const fnArc    = (fnCount  / total) * totalArc
  const libArc   = (libCount / total) * totalArc
  const startA   = -Math.PI / 2  // 12 o'clock — highest CC at the top

  const leaves = []

  sortedFns.forEach((fn, i) => {
    const angle = fnCount === 1
      ? startA
      : startA + fnArc * (i / (fnCount - 1))
    const tier = tierOf(fn.cyclomatic)
    leaves.push({
      id:         `fn:${fn.name}`,
      label:      fn.name,
      kind:       'fn',
      lines:      fn.lines,
      params:     fn.params,
      cyclomatic: fn.cyclomatic,
      fnKind:     fn.kind,
      tier:       tier.label,
      color:      tier.color,
      r:          Math.max(5, 4 + Math.sqrt(Math.max(1, fn.lines)) * 1.1),
      x:          CX + Math.cos(angle) * baseR,
      y:          CY + Math.sin(angle) * baseR,
      angle,
    })
  })

  externalImports.forEach((lib, i) => {
    const angle = libCount === 1
      ? startA + fnArc + GAP
      : startA + fnArc + GAP + libArc * (i / (libCount - 1))
    leaves.push({
      id:    `lib:${lib}`,
      label: lib,
      kind:  'lib',
      color: LIB_COLOR,
      r:     7,
      x:     CX + Math.cos(angle) * baseR,
      y:     CY + Math.sin(angle) * baseR,
      angle,
    })
  })

  return { center, leaves }
}

// Gentle quadratic bezier from center to leaf
function curvePath(x1, y1, x2, y2) {
  const mx  = (x1 + x2) / 2
  const my  = (y1 + y2) / 2
  const dx  = x2 - x1
  const dy  = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const b   = len * 0.18
  return `M ${x1} ${y1} Q ${mx - (dy / len) * b} ${my + (dx / len) * b} ${x2} ${y2}`
}

// ── SVG Mind Map ─────────────────────────────────────────────────────────────
function MindMap({ data, hovered, onHover }) {
  const { center, leaves } = buildLayout(data)

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0 }}
    >
      <defs>
        <radialGradient id="fcv-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={FILE_COLOR} stopOpacity="0.07" />
          <stop offset="100%" stopColor={FILE_COLOR} stopOpacity="0"    />
        </radialGradient>
      </defs>

      {/* Soft halo behind center */}
      <circle cx={center.x} cy={center.y} r={95} fill="url(#fcv-halo)" />

      {/* Connection lines */}
      {leaves.map(n => (
        <path
          key={n.id + '-l'}
          d={curvePath(center.x, center.y, n.x, n.y)}
          stroke={n.color}
          strokeWidth={n.kind === 'fn' ? 1.4 : 0.9}
          strokeOpacity={0.28}
          fill="none"
        />
      ))}

      {/* Leaf nodes */}
      {leaves.map(n => {
        const isHov  = hovered?.id === n.id
        const right  = Math.cos(n.angle) >= 0
        const lx     = n.x + (right ? n.r + 6 : -(n.r + 6))
        const anchor = right ? 'start' : 'end'
        const nodeR  = n.r + (isHov ? 2 : 0)

        return (
          <g
            key={n.id}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => onHover(n)}
            onMouseLeave={() => onHover(null)}
          >
            {isHov && (
              <circle cx={n.x} cy={n.y} r={nodeR + 6} fill={n.color} fillOpacity={0.12} />
            )}
            <circle
              cx={n.x} cy={n.y} r={nodeR}
              fill={n.color}
              fillOpacity={isHov ? 1 : 0.82}
              stroke={isHov ? '#fff' : 'none'}
              strokeWidth={1.5}
            />
            <text
              x={lx} y={n.y - 2}
              textAnchor={anchor}
              fontSize={11} fill="#e2e8f0"
              style={{ fontFamily: 'ui-monospace, monospace' }}
            >
              {trim(n.label)}
            </text>
            <text
              x={lx} y={n.y + 11}
              textAnchor={anchor}
              fontSize={9}
              fill={n.kind === 'fn' ? n.color : n.color + '99'}
              style={{ fontFamily: 'monospace' }}
            >
              {n.kind === 'fn' ? `CC:${n.cyclomatic} · ${n.lines}L` : 'import'}
            </text>
          </g>
        )
      })}

      {/* Center file node */}
      <circle
        cx={center.x} cy={center.y} r={FILE_R}
        fill="#1e293b" stroke={FILE_COLOR} strokeWidth={2}
      />
      <text
        x={center.x} y={center.y - 6}
        textAnchor="middle" fontSize={10} fill={FILE_COLOR}
        style={{ fontFamily: 'ui-monospace, monospace' }}
      >
        {trim(center.label)}
      </text>
      {center.loc != null && (
        <text x={center.x} y={center.y + 8} textAnchor="middle" fontSize={9} fill="#64748b">
          {center.loc} loc
        </text>
      )}
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
    fetch(`/api/filecode?path=${encodeURIComponent(filePath)}`)
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
        <span className="cs-overlay__brand">Codespace</span>
        <span className="cs-overlay__sub">{t('subtitle_filecode', lang)}</span>
        <span className="cs-overlay__name">{fileName}</span>
        {status === 'ready' && data && (
          <span className="cs-overlay__meta">
            · {data.loc} loc · {data.functions.length} {t('functions', lang)} · {data.externalImports.length} {t('libraries_label', lang)}
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
        {status === 'ready' && data && (
          <MindMap data={data} hovered={hovered} onHover={setHovered} />
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
    vocabulary, maintainability, highCount, medCount, lowCount,
  } = complexity

  const total = Math.max(1, highCount + medCount + lowCount)
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

        <BandBar color={TIER_HIGH.color} label={t('band_high', lang)} count={highCount} total={total} />
        <BandBar color={TIER_MED.color}  label={t('band_med',  lang)} count={medCount}  total={total} />
        <BandBar color={TIER_LOW.color}  label={t('band_low',  lang)} count={lowCount}  total={total} />
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
          <div className="cs-tooltip__sub">{node.fnKind} · {node.tier}</div>
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
    { color: FILE_COLOR,      label: t('file_center', lang) },
    { color: TIER_HIGH.color, label: `${t('cyclomatic', lang)} ≥10` },
    { color: TIER_MED.color,  label: `${t('cyclomatic', lang)} 4–9` },
    { color: TIER_LOW.color,  label: `${t('cyclomatic', lang)} <4` },
    { color: LIB_COLOR,       label: t('external_import', lang) },
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

