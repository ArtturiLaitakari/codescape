import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../lib/api-base.js'

/**
 * Directory picker popup.
 * Opens when triggerRef's anchor is set, lists subdirectories of `startPath`,
 * and calls onSelect(path) when the user confirms.
 */
export function DirPickerPopup({ startPath, onSelect, onClose }) {
  const [current, setCurrent] = useState(null)   // { path, parent, dirs }
  const [loading, setLoading] = useState(false)
  const popupRef = useRef(null)

  function browse(p) {
    setLoading(true)
    const url = p ? `${API_BASE}/api/browse?path=${encodeURIComponent(p)}` : `${API_BASE}/api/browse`
    fetch(url)
      .then(r => r.json())
      .then(data => { setLoading(false); if (!data.error) setCurrent(data) })
      .catch(() => setLoading(false))
  }

  // Open at startPath (or server default) on mount
  useEffect(() => { browse(startPath ?? null) }, [startPath])

  // Close on outside click
  useEffect(() => {
    function handle(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handle(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  return (
    <div ref={popupRef} className="cs-dirpicker">
      {/* Breadcrumb header */}
      <div className="cs-dirpicker__head">
        <button
          className="cs-dirpicker__up"
          disabled={!current?.parent || loading}
          onClick={() => current?.parent && browse(current.parent)}
          title="Parent directory"
        >
          ↑
        </button>
        <span className="cs-dirpicker__path" title={current?.path}>
          {current?.path ?? '…'}
        </span>
      </div>

      {/* Directory list */}
      <div className="cs-dirpicker__list">
        {loading && <div className="cs-dirpicker__hint">…</div>}
        {!loading && current?.dirs?.length === 0 && (
          <div className="cs-dirpicker__hint">No subdirectories</div>
        )}
        {!loading && current?.dirs?.map(d => (
          <div key={d.path} className="cs-dirpicker__row" onClick={() => browse(d.path)}>
            <span className="cs-dirpicker__icon">📁</span>
            <span className="cs-dirpicker__name">{d.name}</span>
          </div>
        ))}
      </div>

      {/* Confirm / cancel */}
      <div className="cs-dirpicker__footer">
        <button className="cs-btn cs-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          className="cs-btn cs-btn--primary"
          disabled={!current?.path}
          onClick={() => { onSelect(current.path); onClose() }}
        >
          Open
        </button>
      </div>
    </div>
  )
}
