import { useState } from 'react'
import FileMap from './components/FileMap.jsx'
import DependencyHeatmap from './components/DependencyHeatmap.jsx'

const VIEWS = [
  { id: 'filemap', label: 'Tiedostokartta' },
  { id: 'heatmap', label: 'Riippuvuuslämpökartta' },
]

export default function App() {
  const [activeView, setActiveView] = useState('filemap')
  // Shared across views so switching tabs doesn't forget the loaded folder
  const [sharedRoot, setSharedRoot] = useState(null)

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <TabNav views={VIEWS} active={activeView} onChange={setActiveView} />

      {activeView === 'filemap' && <FileMap sharedRoot={sharedRoot} onRootChange={setSharedRoot} />}
      {activeView === 'heatmap' && <DependencyHeatmap sharedRoot={sharedRoot} onRootChange={setSharedRoot} />}
    </div>
  )
}

function TabNav({ views, active, onChange }) {
  return (
    <div style={{
      position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20, display: 'flex', gap: 2,
      background: 'rgba(15,23,42,0.85)', borderRadius: 8,
      border: '1px solid #1e293b', padding: 3,
      backdropFilter: 'blur(6px)',
    }}>
      {views.map(({ id, label, disabled }) => (
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
          {label}{disabled ? ' 🔜' : ''}
        </button>
      ))}
    </div>
  )
}
