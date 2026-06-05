import { t } from '../lib/i18n.js'
import { FILE_LEGEND, DIR_LEGEND } from '../lib/impact-utils.js'

/**
 * Color-depth legend for impact zone views (file depth or dir containment).
 * Used by both DependencyHeatmap and ChangeImpactMap.
 */
export function ImpactDepthLegend({ selectMode, lang }) {
  const entries = (selectMode === 'dir' ? DIR_LEGEND : FILE_LEGEND)(lang)
  const title = t(selectMode === 'dir' ? 'legend_folder_contents' : 'legend_impact_depth', lang)
  return (
    <div className="cs-legend">
      <div className="cs-legend__title">{title}</div>
      <div className="cs-legend__col">
        {entries.map(({ color, label }) => (
          <div key={label} className="cs-legend__row">
            <span className="cs-legend__dot" style={{ '--cs-swatch': color }} />
            <span className="cs-legend__label">{label}</span>
          </div>
        ))}
        <div className="cs-legend__row cs-legend__sep">
          <span className="cs-legend__dot cs-legend__dot--muted" />
          <span className="cs-legend__label">{t('l_not_selected', lang)}</span>
        </div>
      </div>
    </div>
  )
}
