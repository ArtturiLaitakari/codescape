import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from './useSigmaGraph.js'
import { useForceGraph3D, DEFAULT_LAYOUT_OPTIONS } from './useForceGraph3D.js'
import { API_BASE } from '../lib/api-base.js'

// Extensions that can be opened in FileCodeView (JS/TS + .NET + others)
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',   // JS/TS
  'cs', 'vb', 'fs',                          // .NET
  'py', 'rb', 'go', 'java', 'kt', 'swift',  // others
])

export { DEFAULT_LAYOUT_OPTIONS }

/**
 * Shared graph-view state and hook wiring used by all four tab components.
 *
 * @param {React.RefObject} containerRef  – the canvas div
 * @param {object} options
 *   is3D             – switch between Sigma (false) and ForceGraph3D (true)
 *   theme            – current theme string; triggers refreshTheme on change
 *   sharedRoot       – initial root path
 *   onViewReady      – called when first render is complete
 *   buildHovered     – optional (key, attrs) => object that enriches the hover
 *                      object (e.g. add importers/imports). Default: { key, ...attrs }
 *   setStatusOnReady – whether onReady sets status='ready'. Default: true.
 *                      Pass false for RuntimeHeatmap (SSE manages status).
 *   sigmaOptions     – extra options forwarded to useSigmaGraph
 *                      (getImpactZone, onClearFocus …)
 *   forceOptions     – options forwarded to useForceGraph3D
 *                      (layoutMode, layoutOptions …)
 */
export function useGraphView(containerRef, {
  is3D = false,
  theme,
  sharedRoot,
  onViewReady,
  buildHovered = null,
  setStatusOnReady = true,
  openInVsCode = false,
  sigmaOptions = {},
  forceOptions = {},
} = {}) {
  const searchResetRef = useRef(null)
  const activeRootRef  = useRef(null)

  const [status,       setStatus]       = useState('loading')
  const [hovered,      setHovered]      = useState(null)
  const [pinned,       setPinned]       = useState(null)
  const [nodeCount,    setNodeCount]    = useState(0)
  const [inputValue,   setInputValue]   = useState(sharedRoot ?? '')
  const [activeRoot,   setActiveRoot]   = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [selectedFileAttrs, setSelectedFileAttrs] = useState(null)
  const [excludedDirs, setExcludedDirs] = useState([])  // string[] — extra dirs to ignore

  useEffect(() => { activeRootRef.current = activeRoot }, [activeRoot])

  // ── Hover prefetch ────────────────────────────────────────────────────────
  // When the user hovers a file node for >400 ms, silently warm the filecode
  // cache so double-click opens instantly.
  const prefetchTimerRef = useRef(null)
  useEffect(() => {
    if (openInVsCode) return   // no prefetch needed — we open VS Code directly
    clearTimeout(prefetchTimerRef.current)
    const h = hovered
    if (!h || h.kind !== 'file' || !activeRootRef.current) return
    const ext = h.ext ?? ''
    if (!CODE_EXTS.has(ext) && !ext) return
    prefetchTimerRef.current = setTimeout(() => {
      const absPath = activeRootRef.current.replace(/\/$/, '') + '/' + h.key
      fetch(`${API_BASE}/api/filecode?path=${encodeURIComponent(absPath)}`).catch(() => {})
    }, 400)
    return () => clearTimeout(prefetchTimerRef.current)
  }, [hovered])

  const onEnterNode = useCallback((key, attrs) => {
    setHovered(buildHovered ? buildHovered(key, attrs) : { key, ...attrs })
  }, [buildHovered])

  const onLeaveNode = useCallback(() => setHovered(null), [])

  const onReady = useCallback((count) => {
    setNodeCount(count)
    if (setStatusOnReady) setStatus('ready')
    onViewReady?.()
  }, [onViewReady, setStatusOnReady])

  const onClickNode = useCallback((key, attrs) => {
    searchResetRef.current?.()
    setPinned(prev => prev?.key === key ? null : { key, ...attrs })
  }, [])

  const onDoubleClickNode = useCallback((key, attrs) => {
    if (attrs?.kind === 'file' && activeRootRef.current) {
      const ext = attrs?.ext ?? ''
      if (CODE_EXTS.has(ext) || ext) {
        const absPath = activeRootRef.current.replace(/\/$/, '') + '/' + key
        if (openInVsCode) {
          fetch(`${API_BASE}/api/open-in-vscode?path=${encodeURIComponent(absPath)}`).catch(() => {})
        } else {
          setSelectedFile(absPath)
          setSelectedFileAttrs(attrs ?? null)
        }
      }
    }
  }, [openInVsCode])

  const sigmaGraph = useSigmaGraph(is3D ? null : containerRef, {
    ...sigmaOptions,
    onEnterNode, onLeaveNode, onReady, onClickNode, onDoubleClickNode,
  })

  const forceGraph = useForceGraph3D(is3D ? containerRef : null, {
    ...forceOptions,
    getImpactZone: sigmaOptions.getImpactZone,
    onClearFocus:  sigmaOptions.onClearFocus,
    onEnterNode, onLeaveNode, onReady, onClickNode, onDoubleClickNode,
  })

  const { load, getNodes, setFilter, patchNodes, addEdges, focusNode, refreshTheme } =
    is3D ? forceGraph : sigmaGraph

  useEffect(() => { refreshTheme?.() }, [theme, refreshTheme])

  return {
    status, setStatus,
    hovered, setHovered,
    pinned, setPinned,
    nodeCount,
    inputValue, setInputValue,
    activeRoot, setActiveRoot,
    activeRootRef,
    selectedFile, setSelectedFile,
    selectedFileAttrs, setSelectedFileAttrs,
    excludedDirs, setExcludedDirs,
    searchResetRef,
    load, getNodes, setFilter, patchNodes, addEdges, focusNode, refreshTheme,
  }
}
