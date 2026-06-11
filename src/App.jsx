import { useState, useRef, useEffect } from 'react'
import FileMap from './components/FileMap.jsx'
import DependencyHeatmap from './components/DependencyHeatmap.jsx'
import ChangeImpactMap from './components/ChangeImpactMap.jsx'
import RuntimeHeatmap from './components/RuntimeHeatmap.jsx'
import { t } from './lib/i18n.js'

const LANG_FLAGS = { fi: '🇫🇮', en: '🇬🇧', sv: '🇸🇪' }
const LANG_LABELS = { fi: 'Suomi', en: 'English', sv: 'Svenska' }
const LANGS = ['fi', 'en', 'sv']

const PROJECT_TYPES = [
  { id: 'node',   emoji: '🧩', label: 'Node.js' },
  { id: 'dotnet', emoji: '🔷', label: '.NET'    },
]

const VIEWS = [
  { id: 'filemap',  labelKey: 'tab_filemap' },
  { id: 'heatmap',  labelKey: 'tab_heatmap' },
  { id: 'impact',   labelKey: 'tab_impact'  },
  { id: 'runtime',  labelKey: 'tab_runtime'  },
]

export default function App() {
  const [activeView, setActiveView] = useState('filemap')
  const [sharedRoot, setSharedRoot] = useState(null)
  const [lang, setLang] = useState('en')
  const [theme, setTheme] = useState('dark')
  const [viewReady, setViewReady] = useState(false)
  const [is3D, setIs3D] = useState(false)
  const [projectType, setProjectType] = useState('node')

  function handleViewChange(id) {
    setViewReady(false)
    setActiveView(id)
  }

  function toggleTheme() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('cs-light', next === 'light')
      return next
    })
  }

  function toggle3D() {
    setViewReady(false)
    setIs3D(v => !v)
  }

  return (
    <div className="cs-app">
      <TabNav views={VIEWS} active={activeView} onChange={handleViewChange} lang={lang} onLangChange={setLang} theme={theme} onThemeToggle={toggleTheme} is3D={is3D} on3DToggle={toggle3D} projectType={projectType} onProjectTypeChange={setProjectType} />

      {activeView === 'filemap'  && <FileMap key={`${projectType}-${is3D ? '3d' : '2d'}`} sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} theme={theme} is3D={is3D} projectType={projectType} onViewReady={() => setViewReady(true)} />}
      {activeView === 'heatmap'  && <DependencyHeatmap key={`${projectType}-${is3D ? '3d' : '2d'}`} sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} theme={theme} is3D={is3D} projectType={projectType} onViewReady={() => setViewReady(true)} />}
      {activeView === 'impact'   && <ChangeImpactMap key={`${projectType}-${is3D ? '3d' : '2d'}`} sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} theme={theme} is3D={is3D} projectType={projectType} onViewReady={() => setViewReady(true)} />}
      {activeView === 'runtime'  && <RuntimeHeatmap key={`${projectType}-${is3D ? '3d' : '2d'}`} sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} theme={theme} is3D={is3D} projectType={projectType} onViewReady={() => setViewReady(true)} />}

      {!viewReady && (
        <div className="cs-spinner-wrap cs-spinner-wrap--view">
          <svg className="cs-spinner" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" strokeWidth="3" stroke="#64748b" />
            <circle cx="25" cy="25" r="20" fill="none" strokeWidth="3"
              stroke="#6366f1" strokeDasharray="60 200" strokeLinecap="round" />
          </svg>
          <span className="cs-spinner-label">{t('scanning', lang)}</span>
        </div>
      )}
    </div>
  )
}

function TabNav({ views, active, onChange, lang, onLangChange, theme, onThemeToggle, is3D, on3DToggle, projectType, onProjectTypeChange }) {
  const [open, setOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const popupRef = useRef(null)
  const projectPopupRef = useRef(null)

  // Close popup when clicking outside
  useEffect(() => {
    if (!open && !projectOpen) return
    function handle(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false)
      if (projectPopupRef.current && !projectPopupRef.current.contains(e.target)) setProjectOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, projectOpen])

  const isDark = theme === 'dark'

  return (
    <div className="cs-tabnav">
      {views.map(({ id, labelKey, disabled }) => (
        <button
          key={id}
          onClick={() => !disabled && onChange(id)}
          disabled={disabled}
          className={`cs-tab${active === id ? ' cs-tab--active' : ''}`}
        >
          {t(labelKey, lang)}{disabled ? ' 🔜' : ''}
        </button>
      ))}
      <div className="cs-tabnav__sep" />

      {/* Theme toggle */}
      <button
        onClick={onThemeToggle}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="cs-iconbtn"
      >
        {isDark ? '☀️' : '🌙'}
      </button>

      <div className="cs-tabnav__sep" />

      {/* 3D toggle */}
      <button
        onClick={on3DToggle}
        title={is3D ? 'Switch to 2D view' : 'Switch to 3D view'}
        className={`cs-iconbtn cs-iconbtn--3d${is3D ? ' cs-iconbtn--3d-active' : ''}`}
      >
        3D
      </button>

      <div className="cs-tabnav__sep" />
      <div ref={projectPopupRef} className="cs-langwrap">
        <button
          onClick={() => setProjectOpen((v) => !v)}
          title="Project type"
          className={`cs-iconbtn cs-iconbtn--lang${projectOpen ? ' cs-iconbtn--open' : ''}`}
        >
          🧩
        </button>

        {projectOpen && (
          <div className="cs-langmenu">
            {PROJECT_TYPES.map((p) => (
              <button
                key={p.id}
                onClick={() => { onProjectTypeChange(p.id); setProjectOpen(false) }}
                className={`cs-langmenu__item${p.id === projectType ? ' cs-langmenu__item--active' : ''}`}
              >
                {p.label}
                {p.id === projectType && <span className="cs-langmenu__check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cs-tabnav__sep" />
      <div ref={popupRef} className="cs-langwrap">
        <button
          onClick={() => setOpen((v) => !v)}
          title={LANG_LABELS[lang]}
          className={`cs-iconbtn cs-iconbtn--lang${open ? ' cs-iconbtn--open' : ''}`}
        >
          {LANG_FLAGS[lang]}
        </button>

        {open && (
          <div className="cs-langmenu">
            {LANGS.map((l) => (
              <button
                key={l}
                onClick={() => { onLangChange(l); setOpen(false) }}
                className={`cs-langmenu__item${l === lang ? ' cs-langmenu__item--active' : ''}`}
              >
                <span className="cs-langmenu__flag">{LANG_FLAGS[l]}</span>
                {LANG_LABELS[l]}
                {l === lang && <span className="cs-langmenu__check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
