import { t } from '../lib/i18n.js'

const MAX_LIST = 10

/**
 * Hover/pinned tooltip for dependency and impact views.
 * Shows fan-in/out counts and importer/import file lists.
 */
export function ImportTooltip({ hovered, lang }) {
  const isFile = hovered.kind === 'file'
  const importers = hovered.importers ?? []
  const imports = hovered.imports ?? []
  return (
    <div className="cs-tooltip">
      <div className="cs-tooltip__title" style={{ '--cs-ink': hovered.color ?? 'var(--cs-text-primary)' }}>{hovered.label}</div>
      <div className="cs-tooltip__sub">
        {isFile
          ? `${t('importers', lang)}: ${hovered.fanIn ?? 0}  ·  ${t('imports', lang)}: ${hovered.fanOut ?? 0}  ·  .${hovered.ext}`
          : hovered.kind}
      </div>
      <div className="cs-tooltip__path">{hovered.key}</div>
      {isFile && (importers.length > 0 || imports.length > 0) && (
        <div className="cs-tooltip__section">
          {importers.length > 0 && (
            <div>
              <div className="cs-list__label">{t('importers', lang).toUpperCase()} ({importers.length})</div>
              {importers.slice(0, MAX_LIST).map(f => (
                <div key={f} className="cs-list__item">{f}</div>
              ))}
              {importers.length > MAX_LIST && <div className="cs-list__more">…</div>}
            </div>
          )}
          {imports.length > 0 && (
            <div className={importers.length > 0 ? 'cs-list__group' : undefined}>
              <div className="cs-list__label">{t('imports', lang).toUpperCase()} ({imports.length})</div>
              {imports.slice(0, MAX_LIST).map(f => (
                <div key={f} className="cs-list__item">{f}</div>
              ))}
              {imports.length > MAX_LIST && <div className="cs-list__more">…</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
