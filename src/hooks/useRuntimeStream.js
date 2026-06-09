import { useCallback } from 'react'
import { API_BASE } from '../lib/api-base.js'
import { nodeColor, nodeSize } from '../lib/graph-colors.js'
import {
  calcRuntimeScore, runtimeColor, runtimeSize, SCORE_CEILING,
  VIRTUAL_DB_COLOR, VIRTUAL_API_COLOR, VIRTUAL_NODE_SIZE,
} from '../lib/runtime-colors.js'

// ── Initial node colour (neutral, before runtime data arrives) ───────────────
const DIR_COLOR       = '#334155'
const DIR_EMPTY_COLOR = '#1e293b'

function initialNodeColor(a) {
  if (a.kind === 'virtual-db')  return VIRTUAL_DB_COLOR
  if (a.kind === 'virtual-api') return VIRTUAL_API_COLOR
  if (a.kind === 'file')        return DIR_COLOR  // neutral until batch arrives
  if (a.kind === 'dir')         return DIR_COLOR
  if (a.kind === 'dir-empty')   return DIR_EMPTY_COLOR
  return nodeColor(a)
}

function initialNodeSize(a) {
  if (a.kind === 'virtual-db' || a.kind === 'virtual-api') return VIRTUAL_NODE_SIZE
  return nodeSize(a)
}

/**
 * Manages the SSE stream from /api/runtimegraph/stream.
 *
 * Returns a `startStream(targetPath)` function that opens the connection and
 * returns a cleanup function — ready to be used directly as a useEffect return.
 *
 * @param {{
 *   nodeAttrsRef: React.MutableRefObject<Record<string, object>>,
 *   load:       (nodes, edges, rootKey, extraEdges) => void,
 *   patchNodes: (updates) => void,
 *   addEdges:   (edges) => void,
 *   onRootChange?: (root: string | null) => void,
 *   setStatus:        (s: string) => void,
 *   setScanProgress:  (p: {done,total}|null) => void,
 *   setActiveRoot:    (r: string) => void,
 *   setInputValue:    (v: string) => void,
 *   setFileList:      (list: object[]) => void,
 * }} deps
 */
export function useRuntimeStream({
  nodeAttrsRef,
  load, patchNodes, addEdges, onRootChange,
  setStatus, setScanProgress, setActiveRoot, setInputValue, setFileList,
}) {
  const startStream = useCallback((targetPath) => {
    setStatus('loading')
    setScanProgress(null)

    const url = targetPath
      ? `${API_BASE}/api/runtimegraph/stream?path=${encodeURIComponent(targetPath)}`
      : `${API_BASE}/api/runtimegraph/stream`

    const es = new EventSource(url)

    // Mutable accumulator — lives for the lifetime of this SSE connection
    const accData = {}   // key → { ...metrics, runtimeScore }

    function buildNodeAttrs(key, metrics) {
      const rs = calcRuntimeScore(metrics)
      const base = nodeAttrsRef.current[key] ?? { kind: 'file' }
      return {
        ...metrics,
        runtimeScore: rs,
        color: runtimeColor(rs),
        size:  runtimeSize(rs, nodeSize(base)),
      }
    }

    const handlers = {
      tree(msg) {
        // Index node attrs and build initial graph with neutral colours
        const attrsMap = {}
        for (const { key, attributes } of msg.nodes) attrsMap[key] = attributes
        nodeAttrsRef.current = attrsMap

        const nodes = msg.nodes.map(({ key, attributes: a }) => ({
          key,
          attributes: { ...a, color: initialNodeColor(a), size: initialNodeSize(a) },
        }))

        load(nodes, msg.treeEdges, '__root__', [])
        setActiveRoot(msg.root)
        setInputValue(msg.root)
        onRootChange?.(msg.root)
        setScanProgress({ done: 0, total: msg.total })
        setStatus('scanning')
      },

      batch(msg) {
        for (const [key, metrics] of Object.entries(msg.runtimeData)) {
          const rs = calcRuntimeScore(metrics)
          accData[key] = { ...metrics, runtimeScore: rs }
        }
        patchNodes(
          Object.entries(accData).map(([key, d]) => ({
            key,
            attributes: buildNodeAttrs(key, d),
          }))
        )
        setScanProgress({ done: msg.done, total: msg.total })
      },

      done(msg) {
        // Update virtual node call counts + add runtime edges
        patchNodes([
          { key: '__db__',  attributes: { dbCallerCount:  msg.dbCallerCount  } },
          { key: '__api__', attributes: { apiCallerCount: msg.apiCallerCount } },
        ])
        addEdges(msg.runtimeEdges)

        // Build sorted file list for the legend/panel
        const fileList = Object.entries(accData)
          .map(([key, d]) => {
            const na = nodeAttrsRef.current[key] ?? {}
            return {
              key,
              label:        na.label ?? key.split('/').pop(),
              color:        runtimeColor(d.runtimeScore),
              runtimeScore: d.runtimeScore,
              tScore:       Math.min(d.runtimeScore / SCORE_CEILING, 1),
              kind:         'file',
              ext:          na.ext,
              dbCallCount:  d.dbCallCount,
              apiCallCount: d.apiCallCount,
              cyclomatic:   d.cyclomatic,
            }
          })
          .sort((a, b) => b.runtimeScore - a.runtimeScore)

        setFileList(fileList)
        setScanProgress(null)
        setStatus('ready')
        es.close()
      },

      error(msg) {
        setStatus(`error: ${msg.error}`)
        setScanProgress(null)
        es.close()
      },
    }

    es.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      handlers[msg.type]?.(msg)
    }

    es.onerror = () => {
      setStatus('error: connection failed')
      setScanProgress(null)
      es.close()
    }

    return () => es.close()
  }, [load, patchNodes, addEdges, onRootChange, nodeAttrsRef,
      setStatus, setScanProgress, setActiveRoot, setInputValue, setFileList])

  return startStream
}
