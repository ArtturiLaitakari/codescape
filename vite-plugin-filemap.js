import fs from 'node:fs'
import path from 'node:path'
import { Project } from 'ts-morph'

const IGNORE = new Set(['node_modules', '.git', 'dist', '.cache', 'coverage', '.vite'])
const CHUNK = 50  // files processed per event-loop tick

// Yield control back to the event loop
const tick = () => new Promise((resolve) => setImmediate(resolve))

// ── Iterative directory walk ──────────────────────────────────────────────────
function walkDir(rootDir) {
  const nodes = []
  const edges = []

  nodes.push({
    key: '__root__',
    attributes: { label: path.basename(rootDir), kind: 'root', ext: null, depth: 0 },
  })

  // Explicit stack instead of recursion — safe for arbitrarily deep trees
  const stack = [rootDir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }

    for (const entry of entries) {
      if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = path.join(current, entry.name)
      const rel = path.relative(rootDir, fullPath)
      const parentRel = path.relative(rootDir, current)
      const parentKey = parentRel === '' ? '__root__' : parentRel
      const isDir = entry.isDirectory()

      let isEmpty = false
      if (isDir) {
        try {
          const ch = fs.readdirSync(fullPath, { withFileTypes: true })
          isEmpty = !ch.some(c => !IGNORE.has(c.name) && !c.name.startsWith('.'))
        } catch { isEmpty = true }
      }

      nodes.push({
        key: rel,
        attributes: {
          label: entry.name,
          kind: isDir ? (isEmpty ? 'dir-empty' : 'dir') : 'file',
          ext: isDir ? null : path.extname(entry.name).slice(1) || 'other',
          depth: rel.split(path.sep).length,
        },
      })
      edges.push({ source: parentKey, target: rel })

      if (isDir) stack.push(fullPath)
    }
  }

  return { nodes, edges }
}

const JS_TS_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

/**
 * Async, chunked dependency graph builder.
 * Returns { nodes, treeEdges, importEdges } — kept separate so the client
 * can use treeEdges for layout and add importEdges afterward.
 */
async function buildDepGraph(rootDir) {
  // Collect JS/TS files — iterative
  const allFiles = []
  const dirStack = [rootDir]
  while (dirStack.length) {
    const dir = dirStack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) dirStack.push(full)
      else if (JS_TS_EXTS.includes(path.extname(e.name))) allFiles.push(full)
    }
  }

  // Add source files in chunks to avoid blocking
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: false,
  })
  for (let i = 0; i < allFiles.length; i += CHUNK) {
    for (const f of allFiles.slice(i, i + CHUNK)) {
      try { project.addSourceFileAtPath(f) } catch { /* unreadable, skip */ }
    }
    await tick()
  }

  const fileKeySet = new Set(allFiles.map((f) => path.relative(rootDir, f)))
  const fanIn  = {}
  const fanOut = {}
  for (const k of fileKeySet) { fanIn[k] = 0; fanOut[k] = 0 }

  const importEdges = []
  const sourceFiles = project.getSourceFiles()

  // Process imports in chunks
  for (let i = 0; i < sourceFiles.length; i += CHUNK) {
    for (const sf of sourceFiles.slice(i, i + CHUNK)) {
      const srcRel = path.relative(rootDir, sf.getFilePath())
      if (!fileKeySet.has(srcRel)) continue
      for (const decl of sf.getImportDeclarations()) {
        const spec = decl.getModuleSpecifierValue()
        if (!spec.startsWith('.')) continue
        const resolved = resolveImport(path.dirname(sf.getFilePath()), spec)
        if (!resolved) continue
        const targetRel = path.relative(rootDir, resolved)
        if (!fileKeySet.has(targetRel)) continue
        importEdges.push({ source: srcRel, target: targetRel })
        fanOut[srcRel] = (fanOut[srcRel] ?? 0) + 1
        fanIn[targetRel] = (fanIn[targetRel] ?? 0) + 1
      }
    }
    await tick()
  }

  // Build tree structure
  const { nodes: treeNodes, edges: treeEdges } = walkDir(rootDir)

  const nodes = treeNodes
    .filter((n) => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    .map((n) => {
      if (n.attributes.kind === 'file') {
        return { ...n, attributes: { ...n.attributes, fanIn: fanIn[n.key] ?? 0, fanOut: fanOut[n.key] ?? 0 } }
      }
      return n
    })

  const nodeKeys = new Set(nodes.map((n) => n.key))

  return {
    nodes,
    // treeEdges: only parent→child, used for layout
    treeEdges: treeEdges.filter((e) => nodeKeys.has(e.source) && nodeKeys.has(e.target)),
    // importEdges: added after layout so they don't confuse the radial tree
    importEdges: importEdges.filter((e) => nodeKeys.has(e.source) && nodeKeys.has(e.target)),
  }
}

function resolveImport(fromDir, spec) {
  const base = path.resolve(fromDir, spec)
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const ext of JS_TS_EXTS) {
    const p = base + ext
    if (fs.existsSync(p)) return p
  }
  for (const ext of JS_TS_EXTS) {
    const p = path.join(base, `index${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

// ── Shared path validation helper ─────────────────────────────────────────────
function validatePath(requested, rootDir) {
  if (!requested) return { target: rootDir }
  const resolved = path.resolve(requested)
  if (!path.isAbsolute(resolved)) return { error: 'Path must be absolute' }
  try {
    if (!fs.statSync(resolved).isDirectory()) return { error: 'Not a directory' }
  } catch (e) {
    return { error: `Invalid path: ${e.message}` }
  }
  return { target: resolved }
}

export function fileMapPlugin(rootDir) {
  return {
    name: 'vite-filemap',
    configureServer(server) {

      server.middlewares.use('/api/filemap', (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const { target, error } = validatePath(url.searchParams.get('path'), rootDir)
          if (error) { res.statusCode = 400; res.end(JSON.stringify({ error })); return }
          const data = walkDir(target)
          data.root = target
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      server.middlewares.use('/api/depgraph', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const { target, error } = validatePath(url.searchParams.get('path'), rootDir)
          if (error) { res.statusCode = 400; res.end(JSON.stringify({ error })); return }
          const data = await buildDepGraph(target)
          data.root = target
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    },
  }
}
