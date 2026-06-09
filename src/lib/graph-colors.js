export const EXT_COLORS = {
  jsx: '#06b6d4',
  tsx: '#06b6d4',
  js:  '#f59e0b',
  ts:  '#f59e0b',
  css: '#ec4899',
  json:'#10b981',
  md:  '#f97316',
  html:'#a78bfa',
  svg: '#fb7185',
  png: '#94a3b8',
  other:'#6b7280',
}

export function nodeColor(attrs) {
  if (attrs.kind === 'root')      return '#8b5cf6'
  if (attrs.kind === 'dir')       return '#3b82f6'
  if (attrs.kind === 'dir-empty') return '#1e3a5f'
  return EXT_COLORS[attrs.ext] ?? EXT_COLORS.other
}

export function nodeSize(attrs) {
  if (attrs.kind === 'root')      return 18
  if (attrs.kind === 'dir')       return 12
  if (attrs.kind === 'dir-empty') return 5
  return 6
}

// Impact-zone depth → highlight colour (shared by 2D and 3D renderers)
export const IMPACT_COLORS = ['#fbbf24', '#f97316', '#f59e0b', '#fde68a']
export const impactColor = (depth) => IMPACT_COLORS[Math.min(depth, IMPACT_COLORS.length - 1)]

/**
 * Classify the visual state of a node given the current focus/filter.
 * Returns one of:
 *   'impact'   — impactZone active and node IS in the zone  (color = impactColor(depth))
 *   'dim'      — should be dimmed (focus or filter hides it)
 *   'normal'   — fully visible
 *
 * Callers apply their own alpha/format on top of this result so 2D and 3D
 * renderers stay independent while sharing the same decision logic.
 */
export function nodeDimState(nodeId, focus, filter) {
  if (focus?.impactZone) {
    const depth = focus.impactZone.get(nodeId)
    return depth === undefined ? 'dim' : 'impact'
  }
  if (focus) return (nodeId === focus.node || focus.neighbors.has(nodeId)) ? 'normal' : 'dim'
  if (filter && !filter.has(nodeId)) return 'dim'
  return 'normal'
}

/**
 * Classify the visual state of an edge given the current focus/filter.
 * Returns 'visible' or 'hidden'.
 */
export function edgeVisibility(src, tgt, focus, filter) {
  if (focus?.impactZone) return focus.impactZone.has(src) && focus.impactZone.has(tgt) ? 'visible' : 'hidden'
  if (focus) return src === focus.node || tgt === focus.node ? 'visible' : 'hidden'
  if (filter && !filter.has(src) && !filter.has(tgt)) return 'hidden'
  return 'visible'
}

export const LEGEND = [
  { label: 'root',       color: '#8b5cf6' },
  { label: 'dir',        color: '#3b82f6' },
  { label: 'dir (empty)',color: '#1e3a5f', border: '#3b82f6' },
  { label: 'jsx/tsx',    color: '#06b6d4' },
  { label: 'js/ts',      color: '#f59e0b' },
  { label: 'css',        color: '#ec4899' },
  { label: 'json',       color: '#10b981' },
  { label: 'md',         color: '#f97316' },
]
