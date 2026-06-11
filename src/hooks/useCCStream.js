import { useCallback, useRef } from 'react'
import { nodeSize } from '../lib/graph-colors.js'
import { useGraphStream } from './useGraphStream.js'
import { API_BASE } from '../lib/api-base.js'

// ── CC colour scale ────────────────────────────────────────────────────────
// green (low) → yellow → orange → red (high)
const CC_STOPS = [
  { t: 0.0,  color: '#22c55e' },
  { t: 0.25, color: '#84cc16' },
  { t: 0.5,  color: '#eab308' },
  { t: 0.75, color: '#f97316' },
  { t: 1.0,  color: '#ef4444' },
]
export const CC_LEGEND_STOPS = CC_STOPS.map(s => s.color)

function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16)
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff
  const r  = Math.round(ar + (br - ar) * t)
  const g  = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}

// ⚠️  CC colouring is ALWAYS ABSOLUTE — never relative to the project's max.
//     Using a relative scale (e.g. normalising by globalMax) would make every
//     project look equally complex: a project where the worst file is CC 3
//     would show red, which is misleading.  The thresholds below are fixed
//     industry reference points and must not be changed to per-scan values.
// Absolute CC thresholds mapped to the colour scale t-values:
//   CC  0  → t 0.00  (green)      — trivial
//   CC  4  → t 0.25  (lime)       — med boundary
//   CC 10  → t 0.50  (yellow)     — high boundary
//   CC 20  → t 0.75  (orange)     — wayTooHigh boundary
//   CC 40+ → t 1.00  (red)        — saturates
const CC_ABS_KNEES = [
  { cc: 0,  t: 0.0  },
  { cc: 4,  t: 0.25 },
  { cc: 10, t: 0.5  },
  { cc: 20, t: 0.75 },
  { cc: 40, t: 1.0  },
]

function ccColorFromT(t) {
  const clamped = Math.max(0, Math.min(1, t))
  for (let i = 1; i < CC_STOPS.length; i++) {
    if (clamped <= CC_STOPS[i].t) {
      const seg = (clamped - CC_STOPS[i - 1].t) / (CC_STOPS[i].t - CC_STOPS[i - 1].t)
      return lerpColor(CC_STOPS[i - 1].color, CC_STOPS[i].color, seg)
    }
  }
  return CC_STOPS[CC_STOPS.length - 1].color
}

export function ccColor(maxCyclomatic) {
  if (!maxCyclomatic) return CC_STOPS[0].color
  const knees = CC_ABS_KNEES
  for (let i = 1; i < knees.length; i++) {
    if (maxCyclomatic <= knees[i].cc) {
      const seg = (maxCyclomatic - knees[i - 1].cc) / (knees[i].cc - knees[i - 1].cc)
      return ccColorFromT(knees[i - 1].t + seg * (knees[i].t - knees[i - 1].t))
    }
  }
  return CC_STOPS[CC_STOPS.length - 1].color
}

const DIR_COLORS = {
  root:      '#8b5cf6',
  dir:       '#3b82f6',
  'dir-empty': '#1e3a5f',
}

function initialNodeColor(a) {
  return DIR_COLORS[a.kind] ?? '#6b7280'  // neutral gray for files
}

// ── CC band definitions (matches CC_ABS_KNEES thresholds) ────────────────────
// Labels are in src/lib/i18n.js as cc_band_critical / high / medium / low
export const CC_LEGEND_BANDS = [
  { id: 'critical', minCC: 20,  maxCC: Infinity, color: '#ef4444' },
  { id: 'high',     minCC: 10,  maxCC: 20,       color: '#f97316' },
  { id: 'medium',   minCC: 4,   maxCC: 10,       color: '#eab308' },
  { id: 'low',      minCC: 0,   maxCC: 4,        color: '#22c55e' },
]

/**
 * Manages the SSE stream from /api/ccgraph/stream.
 *
 * @param {{
 *   load:            (nodes, edges, rootKey) => void,
 *   patchNodes:      (updates) => void,
 *   onRootChange?:   (root: string|null) => void,
 *   setStatus:       (s: string) => void,
 *   setScanProgress: (p: {done,total}|null) => void,
 *   setActiveRoot:   (r: string) => void,
 *   setInputValue:   (v: string) => void,
 *   setFileList?:    (files: object[]) => void,
 *   projectType?:    string,
 *   excludedDirs?:   string[],
 * }} deps
 * @returns {(targetPath: string, excluded?: string[]) => () => void}  startStream(path, excluded?) → cleanup fn
 */
export function useCCStream({
  load, patchNodes, onRootChange,
  setStatus, setScanProgress, setActiveRoot, setInputValue,
  setFileList,
  projectType = 'node',
  excludedDirs = [],
}) {
  const fileAccRef = useRef({})  // key → cc attrs, accumulated across batches
  const startStream = useCallback((targetPath, excluded = excludedDirs) => {
    setStatus('loading')
    setScanProgress(null)

    const params = new URLSearchParams({ type: projectType })
    if (targetPath) params.set('path', targetPath)
    if (excluded.length > 0) params.set('exclude', excluded.join(','))
    const url = `${API_BASE}/api/ccgraph/stream?${params}`

    fileAccRef.current = {}  // reset accumulator for this stream

    const handlers = {
      tree(msg) {
        const nodes = msg.nodes.map(({ key, attributes: a }) => ({
          key,
          attributes: { ...a, color: initialNodeColor(a), size: nodeSize(a) },
        }))
        load(nodes, msg.treeEdges, '__root__')
        setActiveRoot(msg.root)
        setInputValue(msg.root)
        onRootChange?.(msg.root)
        setScanProgress({ done: 0, total: msg.total })
        setStatus('scanning')
        setFileList?.([])
      },

      batch(msg) {
        // Colors are absolute — just paint the newly arrived nodes directly
        const updates = Object.entries(msg.ccData)
          .filter(([, cc]) => cc)
          .map(([key, cc]) => ({
            key,
            attributes: {
              ...cc,
              hasCC:  true,
              color:  ccColor(cc.maxCyclomatic ?? 0),
              size:   nodeSize({ kind: 'file' }) * (1 + Math.min((cc.maxCyclomatic ?? 1) / 10, 1.5)),
            },
          }))
        patchNodes(updates)
        // Accumulate file entries for the legend band counts
        for (const [key, cc] of Object.entries(msg.ccData)) {
          if (cc) fileAccRef.current[key] = { key, ...cc }
        }
        setFileList?.(Object.values(fileAccRef.current))
        setScanProgress({ done: msg.done, total: msg.total })
      },

      done() {
        setScanProgress(null)
        setStatus('ready')
      },

      error(msg) {
        setStatus(`error: ${msg.error}`)
        setScanProgress(null)
      },
    }

    const es = new EventSource(url)
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
  }, [load, patchNodes, onRootChange, setStatus, setScanProgress, setActiveRoot, setInputValue, projectType])

  return startStream
}
