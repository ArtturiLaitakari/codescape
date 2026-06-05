import { useRef } from 'react'
import { t } from '../lib/i18n.js'

/**
 * Search bar that dims non-matching graph nodes as you type.
 * No dropdown — matching nodes are highlighted directly in the graph.
 *
 * Props:
 *   getNodes()          – returns array of { key, label, kind, ext }
 *   setFilter(keys)     – pass Set<string> of matching keys, or null to clear
 *   lang                – current UI language
 *   resetRef            – optional ref; gets a clear() function attached so parents can reset the input
 */
export function NodeSearchBar({ getNodes, setFilter, lang = 'fi', resetRef }) {
  const inputRef = useRef(null)

  // Expose a reset function so the parent can clear the field (e.g. on node click)
  if (resetRef) {
    resetRef.current = () => {
      if (inputRef.current) inputRef.current.value = ''
      setFilter(null)
    }
  }
  function handleChange(e) {
    const q = e.target.value.trim().toLowerCase()
    if (!q) { setFilter(null); return }
    const nodes = getNodes()
    const matched = new Set(
      nodes
        .filter(n => n.kind !== 'root')
        .filter(n => n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q))
        .map(n => n.key)
    )
    setFilter(matched)
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (inputRef.current) inputRef.current.value = ''
      setFilter(null)
    }
  }

  return (
    <div className="cs-search">
      <span className="cs-search__icon">🔍</span>
      <input
        ref={inputRef}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t('search_placeholder', lang)}
        spellCheck={false}
        className="cs-search__input"
      />
    </div>
  )
}
