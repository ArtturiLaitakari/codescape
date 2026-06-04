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
