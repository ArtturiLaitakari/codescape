import { useEffect, useRef, useState, useCallback } from 'react'
import { useSigmaGraph } from './useSigmaGraph.js'
import { useForceGraph3D, DEFAULT_LAYOUT_OPTIONS } from './useForceGraph3D.js'

const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx'])

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

  useEffect(() => { activeRootRef.current = activeRoot }, [activeRoot])

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
    if (attrs?.kind === 'file' && CODE_EXTS.has(attrs?.ext) && activeRootRef.current) {
      setSelectedFile(activeRootRef.current.replace(/\/$/, '') + '/' + key)
    }
  }, [])

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
    searchResetRef,
    load, getNodes, setFilter, patchNodes, addEdges, focusNode, refreshTheme,
  }
}
