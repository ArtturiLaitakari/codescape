// ── Per-project-type extension colour maps ───────────────────────────────────
// Only extensions listed here get a legend entry.
// Unknown extensions still render — they use EXT_COLORS.other (gray).

const EXT_COLORS_NODE = {
  jsx:  '#06b6d4',
  tsx:  '#06b6d4',
  js:   '#f59e0b',
  ts:   '#f59e0b',
  mjs:  '#f59e0b',
  cjs:  '#f59e0b',
  css:  '#ec4899',
  json: '#10b981',
  html: '#a78bfa',
  svg:  '#fb7185',
}

const EXT_COLORS_DOTNET = {
  // C# / VB / F#
  cs:     '#06b6d4',
  vb:     '#f59e0b',
  fs:     '#10b981',
  // ASP.NET Web Forms
  aspx:   '#818cf8',
  ascx:   '#a78bfa',
  asax:   '#c4b5fd',
  ashx:   '#c4b5fd',
  master: '#7c3aed',
  // Razor / MVC
  razor:  '#ec4899',
  cshtml: '#a78bfa',
  vbhtml: '#a78bfa',
  // Data / config
  edmx:   '#34d399',
  resx:   '#6ee7b7',
  xml:    '#f97316',
  config: '#f97316',
  json:   '#10b981',
  sql:    '#38bdf8',
  // UI
  xaml:   '#fb7185',
  scss:   '#f472d6',
  less:   '#f472c6',
  css:    '#ec4899',
  // Code gen
  tt:     '#94a3b8',
  // Scripting
  ps1:    '#facc15',
  psd1:   '#fbbf24',
  psm1:   '#fbbf24',
}

// Misc types that can appear in any project
const EXT_COLORS_MISC = {
  md:   '#f97316',
  txt:  '#94a3b8',
  xml:  '#f97316',
  yml:  '#facc15',
  yaml: '#facc15',
  pdf:  '#ef4444',
  csv:  '#34d399',
  sh:   '#a3e635',
  env:  '#fbbf24',
  lock: '#6b7280',
  md:   '#f97316',
  png:  '#84a3b8',
  gif:  '#a4a3b8',
}

const EXT_COLORS_BY_TYPE = {
  node:   { ...EXT_COLORS_MISC, ...EXT_COLORS_NODE },
  dotnet: { ...EXT_COLORS_MISC, ...EXT_COLORS_DOTNET },
}

// Merged map used by nodeColor so every known extension gets a colour
export const EXT_COLORS = {
  ...EXT_COLORS_NODE,
  ...EXT_COLORS_DOTNET,
  other: '#6b7280',
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

/**
 * Build a legend from the nodes currently in the graph.
 * Only extensions that have an explicit colour in the project-type map
 * get a legend entry — unknown/binary extensions (gray fallback) are omitted.
 */
export function computeLegend(getNodes, projectType = 'node') {
  const colorMap = EXT_COLORS_BY_TYPE[projectType] ?? EXT_COLORS_NODE
  const base = [
    { label: 'root',       color: '#8b5cf6' },
    { label: 'dir',        color: '#3b82f6' },
    { label: 'dir (empty)',color: '#1e3a5f', border: '#3b82f6' },
  ]
  const seen = new Set()
  const extEntries = []
  for (const node of (getNodes?.() ?? [])) {
    if (node.kind !== 'file' || !node.ext || seen.has(node.ext)) continue
    if (!(node.ext in colorMap)) continue   // skip gray/unknown extensions
    seen.add(node.ext)
    extEntries.push({ label: `.${node.ext}`, color: colorMap[node.ext] })
  }
  return [...base, ...extEntries]
}
