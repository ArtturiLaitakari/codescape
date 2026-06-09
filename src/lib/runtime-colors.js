/**
 * Color scale for runtime heatmap.
 * Low score = green (fast), high score = red (slow / expensive).
 */

// ── Score weights ─────────────────────────────────────────────────────────────
export const SCORE_WEIGHTS = { db: 3, api: 2, cyclomatic: 0.5 }

/**
 * Fixed ceiling used to normalise scores to 0–1.
 * A score at or above this value maps to full red.
 * Examples at ceiling:
 *   5 DB imports (15) | 3 DB + 1 API + CC 8 (9+2+4 = 15)
 */
export const SCORE_CEILING = 15

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

// Absolute score breakpoints — independent of what's in the project.
// score 0  → green (cyclomatic noise only)
// score 3  → lime  (1 DB import)
// score 6  → yellow (2 DB, or 1 DB + heavy CC)
// score 9  → orange (3 DB, needs attention)
// score 15 → red   (ceiling, must fix)
const STOPS = [
  { score: 0,  color: '#22c55e' },
  { score: 3,  color: '#a3e635' },
  { score: 6,  color: '#eab308' },
  { score: 9,  color: '#f97316' },
  { score: 15, color: '#ef4444' },
]

export function runtimeColor(score) {
  const clamped = Math.min(score, STOPS[STOPS.length - 1].score)
  for (let i = 1; i < STOPS.length; i++) {
    if (clamped <= STOPS[i].score) {
      const prev  = STOPS[i - 1]
      const curr  = STOPS[i]
      const local = (clamped - prev.score) / (curr.score - prev.score)
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
