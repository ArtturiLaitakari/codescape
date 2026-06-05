import { t } from './i18n.js'

export const FILE_LEGEND = (lang) => [
  { color: '#fbbf24', label: t('l_changed_file', lang) },
  { color: '#f97316', label: t('l_direct_users', lang) },
  { color: '#f59e0b', label: t('l_depth2', lang) },
  { color: '#fde68a', label: t('l_depth3plus', lang) },
]

export const DIR_LEGEND = (lang) => [
  { color: '#fbbf24', label: t('l_selected_folder', lang) },
  { color: '#f97316', label: t('l_direct_children', lang) },
  { color: '#f59e0b', label: t('l_depth2_content', lang) },
  { color: '#fde68a', label: t('l_deeper', lang) },
]

/**
 * Build reverse + forward import adjacency, and forward tree adjacency from edge lists.
 * @returns {{ rev: Object, fwdImport: Object, fwdTree: Object }}
 */
export function buildAdjacency(importEdges, treeEdges) {
  const rev = {}, fwdImport = {}, fwdTree = {}

  for (const { source, target } of importEdges) {
    if (!rev[target]) rev[target] = new Set()
    rev[target].add(source)
    if (!fwdImport[source]) fwdImport[source] = new Set()
    fwdImport[source].add(target)
  }

  for (const { source, target } of treeEdges) {
    if (!fwdTree[source]) fwdTree[source] = new Set()
    fwdTree[source].add(target)
  }

  return { rev, fwdImport, fwdTree }
}
