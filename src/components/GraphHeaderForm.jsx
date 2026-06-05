import { t } from '../lib/i18n.js'
import { NodeSearchBar } from './NodeSearchBar.jsx'

/**
 * Shared folder path input form used in all four graph views.
 */
export function GraphHeaderForm({ inputValue, activeRoot, loading, lang, getNodes, setFilter, searchResetRef, onInputChange, onSubmit, onReset }) {
  return (
    <form onSubmit={onSubmit} className="cs-header__row">
      <span className="cs-folder-icon">📁</span>
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
        <button type="button" onClick={onReset} disabled={loading} className="cs-btn cs-btn--ghost">
          {t('reset', lang)}
        </button>
      )}
      <div className="cs-divider" />
      <NodeSearchBar getNodes={getNodes} setFilter={setFilter} lang={lang} resetRef={searchResetRef} />
    </form>
  )
}
