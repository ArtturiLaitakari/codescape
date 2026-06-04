/**
 * Color scale for dependency heatmap.
 * fanIn 0 = cool blue, high fanIn = hot red/orange.
 */

// Lerp between two hex colors
function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16)
  const bh = parseInt(b.slice(1), 16)
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl2 = Math.round(ab + (bb - ab) * t)
  return `#${((r << 16) | (g << 8) | bl2).toString(16).padStart(6, '0')}`
}

const STOPS = [
  { t: 0.0, color: '#1e3a5f' },  // cold — not imported at all
  { t: 0.2, color: '#3b82f6' },  // cool
  { t: 0.5, color: '#f59e0b' },  // warm
  { t: 0.8, color: '#ef4444' },  // hot
  { t: 1.0, color: '#fbbf24' },  // scorching — top importees
]

export function fanInColor(fanIn, maxFanIn) {
  if (maxFanIn === 0) return STOPS[0].color
  const t = Math.min(fanIn / maxFanIn, 1)
  // Find segment
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

export function fanInSize(fanIn, baseSize = 6) {
  // Logarithmic scaling: 0 imports = baseSize, scales up smoothly
  return baseSize + Math.log1p(fanIn) * 3
}

export const HEATMAP_LEGEND_STOPS = STOPS
