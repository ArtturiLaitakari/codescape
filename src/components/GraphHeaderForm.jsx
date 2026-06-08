import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { NodeSearchBar } from './NodeSearchBar.jsx'
import { DirPickerPopup } from './DirPickerPopup.jsx'

/**
 * Shared folder path input form used in all four graph views.
 */
export function GraphHeaderForm({ inputValue, activeRoot, loading, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
  const [pickerOpen, setPickerOpen] = useState(false)

  function handleSelect(p) {
    onInputChange(p)
    onSelect(p)
  }

  return (
    <form onSubmit={(e) => { setPickerOpen(false); onSubmit(e) }} className="cs-header__row" style={{ position: 'relative' }}>
      <button
        type="button"
        className="cs-folder-btn"
        title="Browse directories"
        onClick={() => setPickerOpen(v => !v)}
      >
        📁
      </button>
      <input
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={activeRoot ?? t('path_placeholder', lang)}
        spellCheck={false}
        className="cs-input"
      />
      <button type="submit" disabled={loading} className="cs-btn cs-btn--primary">
        {t('open', lang)}
      </button>
      {activeRoot && (
        <button type="button" onClick={onReset} disabled={loading} className="cs-btn cs-btn--ghost" style={{ display: 'none' }}>
          {t('reset', lang)}
        </button>
      )}
      <div className="cs-divider" />
      <NodeSearchBar getNodes={getNodes} setFilter={setFilter} lang={lang} resetRef={searchResetRef} />

      {pickerOpen && (
        <DirPickerPopup
          startPath={activeRoot ?? null}
          onSelect={handleSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </form>
  )
}
