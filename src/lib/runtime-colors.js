/**
 * Color scale for runtime heatmap.
 * Low score = green (fast), high score = red (slow / expensive).
 */

// ── Score weights ─────────────────────────────────────────────────────────────
export const SCORE_WEIGHTS = { db: 3, api: 2, cyclomatic: 0.5 }

/**
 * Compute the runtime score for a single file's metrics.
 * @param {{ dbCallCount: number, apiCallCount: number, cyclomatic: number }} d
 */
export function calcRuntimeScore(d) {
  return d.dbCallCount * SCORE_WEIGHTS.db
       + d.apiCallCount * SCORE_WEIGHTS.api
       + (d.cyclomatic ?? 1) * SCORE_WEIGHTS.cyclomatic
}

function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16)
  const bh = parseInt(b.slice(1), 16)
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff
  const r  = Math.round(ar + (br - ar) * t)
  const g  = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}

const STOPS = [
  { t: 0.00, color: '#22c55e' },  // green   — no cost
  { t: 0.30, color: '#a3e635' },  // lime
  { t: 0.60, color: '#eab308' },  // yellow
  { t: 0.85, color: '#f97316' },  // orange
  { t: 1.00, color: '#ef4444' },  // red     — high cost
]

export function runtimeColor(score, maxScore) {
  if (maxScore === 0) return STOPS[0].color
  const t = Math.min(score / maxScore, 1)
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i].t) {
      const prev = STOPS[i - 1]
      const curr = STOPS[i]
      const local = (t - prev.t) / (curr.t - prev.t)
      return lerpColor(prev.color, curr.color, local)
    }
  }
  return STOPS[STOPS.length - 1].color
}

export function runtimeSize(score, base = 6) {
  return base + Math.log1p(score) * 2
}

export const RUNTIME_LEGEND_STOPS = STOPS

export const VIRTUAL_DB_COLOR   = '#06b6d4'  // cyan
export const VIRTUAL_API_COLOR  = '#a855f7'  // violet
export const VIRTUAL_NODE_SIZE  = 22
