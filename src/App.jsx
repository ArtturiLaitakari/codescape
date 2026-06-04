import { useState, useRef, useEffect } from 'react'
import FileMap from './components/FileMap.jsx'
import DependencyHeatmap from './components/DependencyHeatmap.jsx'
import ChangeImpactMap from './components/ChangeImpactMap.jsx'
import { t } from './lib/i18n.js'

const LANG_FLAGS = { fi: '🇫🇮', en: '🇬🇧', sv: '🇸🇪' }
const LANG_LABELS = { fi: 'Suomi', en: 'English', sv: 'Svenska' }
const LANGS = ['fi', 'en', 'sv']

const VIEWS = [
  { id: 'filemap', labelKey: 'tab_filemap' },
  { id: 'heatmap', labelKey: 'tab_heatmap' },
  { id: 'impact',  labelKey: 'tab_impact'  },
]

export default function App() {
  const [activeView, setActiveView] = useState('filemap')
  // Shared across views so switching tabs doesn't forget the loaded folder
  const [sharedRoot, setSharedRoot] = useState(null)
  const [lang, setLang] = useState('en')

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <TabNav views={VIEWS} active={activeView} onChange={setActiveView} lang={lang} onLangChange={setLang} />

      {activeView === 'filemap' && <FileMap sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} />}
      {activeView === 'heatmap' && <DependencyHeatmap sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} />}
      {activeView === 'impact' && <ChangeImpactMap sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} />}
    </div>
  )
}

function TabNav({ views, active, onChange, lang, onLangChange }) {
  const [open, setOpen] = useState(false)
  const popupRef = useRef(null)

  // Close popup when clicking outside
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div style={{
      position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20, display: 'flex', gap: 2, alignItems: 'center',
      background: 'rgba(15,23,42,0.85)', borderRadius: 8,
      border: '1px solid #1e293b', padding: 3,
      backdropFilter: 'blur(6px)',
    }}>
      {views.map(({ id, labelKey, disabled }) => (
        <button
          key={id}
          onClick={() => !disabled && onChange(id)}
          disabled={disabled}
          style={{
            background: active === id ? '#8b5cf6' : 'transparent',
            border: 'none', borderRadius: 6,
            padding: '4px 14px',
            color: disabled ? '#334155' : active === id ? '#fff' : '#94a3b8',
            fontFamily: 'monospace', fontSize: 12,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {t(labelKey, lang)}{disabled ? ' 🔜' : ''}
        </button>
      ))}
      <div style={{ width: 1, background: '#334155', alignSelf: 'stretch', margin: '2px 4px' }} />

      {/* Flag button + popup */}
      <div ref={popupRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen((v) => !v)}
          title={LANG_LABELS[lang]}
          style={{
            background: open ? 'rgba(139,92,246,0.15)' : 'transparent',
            border: '1px solid ' + (open ? '#8b5cf6' : '#334155'),
            borderRadius: 5, padding: '2px 6px',
            fontSize: 18, lineHeight: 1.2,
            cursor: 'pointer', display: 'flex', alignItems: 'center',
          }}
        >
          {LANG_FLAGS[lang]}
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            background: 'rgba(15,23,42,0.97)', border: '1px solid #1e293b',
            borderRadius: 8, padding: 4, display: 'flex', flexDirection: 'column', gap: 2,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            minWidth: 130,
          }}>
            {LANGS.map((l) => (
              <button
                key={l}
                onClick={() => { onLangChange(l); setOpen(false) }}
                style={{
                  background: l === lang ? 'rgba(139,92,246,0.18)' : 'transparent',
                  border: 'none', borderRadius: 5,
                  padding: '5px 10px',
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', textAlign: 'left',
                  color: l === lang ? '#c4b5fd' : '#94a3b8',
                  fontFamily: 'monospace', fontSize: 12,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>{LANG_FLAGS[l]}</span>
                {LANG_LABELS[l]}
                {l === lang && <span style={{ marginLeft: 'auto', color: '#8b5cf6', fontSize: 10 }}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
