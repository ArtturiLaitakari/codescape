import { useCallback } from 'react'
import { API_BASE } from '../lib/api-base.js'

/**
 * Generic SSE graph-stream hook.
 *
 * Manages the EventSource lifecycle (open, message routing, error, cleanup).
 * Type-specific logic lives entirely in the `handlers` object — this hook
 * knows nothing about colors, scores, or graph shapes.
 *
 * @param {string} endpoint   – e.g. '/api/ccgraph/stream'
 * @param {object} handlers   – { tree(msg), batch(msg), done(msg), error?(msg) }
 * @param {object} deps       – values that should trigger useCallback re-creation
 *                              (pass as an array via the `deps` param below)
 * @returns {(targetPath: string) => () => void}  startStream(path) → cleanup fn
 *
 * Usage:
 *   const startStream = useGraphStream('/api/ccgraph/stream', { tree, batch, done }, [projectType, load, patchNodes])
 */
export function useGraphStream(endpoint, handlers, deps = []) {
  const startStream = useCallback((targetPath) => {
    const url = targetPath
      ? `${API_BASE}${endpoint}?path=${encodeURIComponent(targetPath)}`
      : `${API_BASE}${endpoint}`

    const es = new EventSource(url)

    es.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      handlers[msg.type]?.(msg)
    }

    es.onerror = () => {
      handlers.error?.({ error: 'connection failed' })
      es.close()
    }

    return () => es.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return startStream
}
