import { useCallback } from 'react'
import { API_BASE } from '../lib/api-base.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import { buildAdjacency } from '../lib/impact-utils.js'

/**
 * Manages the SSE stream from /api/depgraph/stream.
 *
 * Events:
 *   tree     → load initial graph with neutral node colours
 *   progress → update scan progress bar
 *   done     → patch fan-in/out onto nodes + add import edges
 *   error    → set error status
 *
 * @param {{
 *   nodeAttrsRef:     React.MutableRefObject<Record<string, object>>,
 *   reverseAdjRef:    React.MutableRefObject<Record<string, string[]>>,
 *   forwardImportRef: React.MutableRefObject<Record<string, string[]>>,
 *   load:             (nodes, edges, rootKey, extraEdges) => void,
 *   patchNodes:       (updates) => void,
 *   addEdges:         (edges) => void,
 *   onRootChange?:    (root: string | null) => void,
 *   setStatus:        (s: string) => void,
 *   setScanProgress:  (p: {done,total}|null) => void,
 *   setActiveRoot:    (r: string) => void,
 *   setInputValue:    (v: string) => void,
 *   projectType?:     string,
 * }} deps
 * @returns {(targetPath: string) => () => void}  startStream(path) → cleanup fn
 */
export function useDepStream({
  nodeAttrsRef,
  reverseAdjRef,
  forwardImportRef,
  load, patchNodes, addEdges, onRootChange,
  onDone,
  setStatus, setScanProgress, setActiveRoot, setInputValue,
  projectType = 'node',
}) {
  const startStream = useCallback((targetPath) => {
    setStatus('loading')
    setScanProgress(null)

    const params = new URLSearchParams({ type: projectType })
    if (targetPath) params.set('path', targetPath)
    const url = `${API_BASE}/api/depgraph/stream?${params}`

    const es = new EventSource(url)
    let lastTreeEdges = []

    const handlers = {
      tree(msg) {
        lastTreeEdges = msg.treeEdges
        // Index node attrs
        const attrsMap = {}
        for (const { key, attributes } of msg.nodes) attrsMap[key] = attributes
        nodeAttrsRef.current = attrsMap

        // Build initial graph — file nodes get their extension colour immediately
        const nodes = msg.nodes.map(({ key, attributes: a }) => ({
          key,
          attributes: { ...a, color: nodeColor(a), size: nodeSize(a) },
        }))
        load(nodes, msg.treeEdges, '__root__')
        setActiveRoot(msg.root)
        setInputValue(msg.root)
        onRootChange?.(msg.root)
        setScanProgress({ done: 0, total: msg.total })
        setStatus('scanning')
      },

      progress(msg) {
        setScanProgress({ done: msg.done, total: msg.total })
      },

      done(msg) {
        // Build reverse / forward adjacency maps
        const reverseAdj = {}
        const forwardImport = {}
        for (const { source, target } of msg.importEdges) {
          ;(reverseAdj[target] ??= []).push(source)
          ;(forwardImport[source] ??= []).push(target)
        }
        reverseAdjRef.current    = reverseAdj
        forwardImportRef.current = forwardImport

        // Patch fan-in / fan-out onto file nodes
        patchNodes(
          Object.entries(msg.fanData).map(([key, { fanIn, fanOut }]) => ({
            key,
            attributes: { fanIn, fanOut },
          }))
        )

        // Add import edges to graph
        addEdges(msg.importEdges)

        onDone?.(reverseAdj, forwardImport, lastTreeEdges)
        setScanProgress(null)
        setStatus('ready')
      },

      error(msg) {
        setStatus(`error: ${msg.error}`)
        setScanProgress(null)
      },
    }

    es.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      handlers[msg.type]?.(msg)
      if (msg.type === 'done' || msg.type === 'error') es.close()
    }
    es.onerror = () => {
      handlers.error({ error: 'connection failed' })
      es.close()
    }

    return () => es.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectType])

  return startStream
}
