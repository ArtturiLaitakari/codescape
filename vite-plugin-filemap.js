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
 * Iteratively collect all JS/TS files under rootDir.
 */
function collectJsTsFiles(rootDir) {
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
  return allFiles
}

/**
 * Async, chunked dependency graph builder.
 * Returns { nodes, treeEdges, importEdges } — kept separate so the client
 * can use treeEdges for layout and add importEdges afterward.
 */
async function buildDepGraph(rootDir) {
  // Collect JS/TS files — iterative
  const allFiles = collectJsTsFiles(rootDir)

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

// ── Runtime graph ─────────────────────────────────────────────────────────────

const DB_PACKAGES = new Set([
  'pg', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3',
  'knex', 'sequelize', 'mongoose',
  '@prisma/client', 'typeorm', 'drizzle-orm',
])

const API_PACKAGES = new Set([
  'axios', 'ky', 'node-fetch', 'got', 'superagent', 'undici',
  'node:http', 'node:https', 'http', 'https',
])

/**
 * Analyse a single ts-morph SourceFile for function/method structure.
 * Returns { functions, externalImports, loc }
 */
function detectFileFunctions(sf) {
  const text = sf.getText()
  const loc = text.split('\n').length

  // External imports (non-relative)
  const externalImports = []
  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue()
    if (!spec.startsWith('.')) externalImports.push(spec)
  }

  const BRANCH_KINDS = [
    'IfStatement', 'ConditionalExpression',
    'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoStatement',
    'CatchClause', 'CaseClause',
  ]

  function cyclomaticOf(node) {
    let c = 1
    for (const kindName of BRANCH_KINDS) {
      try {
        c += node.getDescendants().filter(n => n.getKindName() === kindName).length
      } catch { /* skip */ }
    }
    return c
  }

  function linesOf(node) {
    try {
      const start = node.getStartLineNumber()
      const end = node.getEndLineNumber()
      return end - start + 1
    } catch { return 1 }
  }

  const functions = []

  // Named function declarations
  for (const fn of sf.getFunctions()) {
    const name = fn.getName() ?? '(anonymous)'
    functions.push({
      name,
      kind: 'function',
      startLine: fn.getStartLineNumber(),
      lines: linesOf(fn),
      params: fn.getParameters().length,
      cyclomatic: cyclomaticOf(fn),
    })
  }

  // Arrow functions / function expressions assigned to variables
  for (const varDecl of sf.getVariableDeclarations()) {
    const init = varDecl.getInitializer()
    if (!init) continue
    const kindName = init.getKindName()
    if (kindName === 'ArrowFunction' || kindName === 'FunctionExpression') {
      functions.push({
        name: varDecl.getName(),
        kind: 'arrow',
        startLine: varDecl.getStartLineNumber(),
        lines: linesOf(init),
        params: init.getParameters?.()?.length ?? 0,
        cyclomatic: cyclomaticOf(init),
      })
    }
  }

  // Class methods
  for (const cls of sf.getClasses()) {
    for (const method of cls.getMethods()) {
      functions.push({
        name: `${cls.getName() ?? 'Class'}.${method.getName()}`,
        kind: 'method',
        startLine: method.getStartLineNumber(),
        lines: linesOf(method),
        params: method.getParameters().length,
        cyclomatic: cyclomaticOf(method),
      })
    }
  }

  // ── File-level complexity metrics ────────────────────────────────────────
  const totalCyclomatic = functions.reduce((s, f) => s + f.cyclomatic, 0)
  const avgCyclomatic   = functions.length ? +(totalCyclomatic / functions.length).toFixed(1) : 1
  const maxCyclomatic   = functions.length ? Math.max(...functions.map(f => f.cyclomatic)) : 1
  const totalLines      = functions.reduce((s, f) => s + f.lines, 0)

  // Halstead-lite: count unique operators/operands (rough proxy)
  const tokens = text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) ?? []
  const uniqueTokens = new Set(tokens).size
  const vocabulary = uniqueTokens

  // Maintainability index (simplified): 171 - 5.2*ln(V) - 0.23*CC - 16.2*ln(L)
  // Clamped to [0,100]
  const V = Math.max(1, vocabulary)
  const MI = Math.max(0, Math.min(100,
    Math.round(171 - 5.2 * Math.log(V) - 0.23 * totalCyclomatic - 16.2 * Math.log(Math.max(1, loc)))
  ))

  // Classify functions by complexity band
  const wayTooHighCount = functions.filter(f => f.cyclomatic >= 20).length
  const highCount       = functions.filter(f => f.cyclomatic >= 10 && f.cyclomatic < 20).length
  const medCount        = functions.filter(f => f.cyclomatic >= 4  && f.cyclomatic < 10).length
  const lowCount        = functions.filter(f => f.cyclomatic < 4).length

  const complexity = {
    loc,
    functionCount:    functions.length,
    totalCyclomatic,
    avgCyclomatic,
    maxCyclomatic,
    totalLines,
    vocabulary,
    maintainability:  MI,
    wayTooHighCount,
    highCount,
    medCount,
    lowCount,
  }

  return { functions, externalImports: [...new Set(externalImports)], loc, complexity }
}

/**
 * Analyse a single file and return function/complexity data.
 */
async function buildFileCode(filePath) {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: false,
  })
  try {
    project.addSourceFileAtPath(filePath)
  } catch (e) {
    throw new Error(`Cannot parse file: ${e.message}`)
  }
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error('File not found in project after adding')
  return detectFileFunctions(sf)
}

/**
 * Analyse a single ts-morph SourceFile for runtime cost indicators.
 * Returns { dbCallCount, apiCallCount, cyclomatic }
 */
function detectRuntimeCalls(sf) {
  const { SyntaxKind } = sf.getProject().getTypeChecker()._context ?? {}

  let dbCallCount = 0
  let apiCallCount = 0

  // Check import declarations for known DB/API packages
  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue()
    // Strip subpath (e.g. '@prisma/client/edge' → '@prisma/client')
    const root = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0]
    if (DB_PACKAGES.has(spec) || DB_PACKAGES.has(root)) dbCallCount++
    if (API_PACKAGES.has(spec) || API_PACKAGES.has(root)) apiCallCount++
  }

  // Also detect built-in fetch() calls (no import needed)
  const text = sf.getText()
  // Simple heuristic: count occurrences of standalone fetch( calls
  const fetchMatches = text.match(/\bfetch\s*\(/g)
  if (fetchMatches) apiCallCount += fetchMatches.length

  // Cyclomatic complexity: count branching constructs
  const BRANCH_KINDS = [
    'IfStatement',
    'ConditionalExpression',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoStatement',
    'CatchClause',
    'CaseClause',
  ]
  let cyclomatic = 1 // base complexity
  for (const kindName of BRANCH_KINDS) {
    try {
      // ts-morph exposes getDescendantsOfKind via string kind names
      const nodes = sf.getDescendants().filter(n => n.getKindName() === kindName)
      cyclomatic += nodes.length
    } catch { /* skip */ }
  }

  return { dbCallCount, apiCallCount, cyclomatic }
}

/**
 * Async, chunked runtime graph builder.
 * Returns { nodes, treeEdges, runtimeEdges }
 */
async function buildRuntimeGraph(rootDir) {
  // Collect JS/TS files
  const allFiles = collectJsTsFiles(rootDir)

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: false,
  })
  for (let i = 0; i < allFiles.length; i += CHUNK) {
    for (const f of allFiles.slice(i, i + CHUNK)) {
      try { project.addSourceFileAtPath(f) } catch { /* skip */ }
    }
    await tick()
  }

  const fileKeySet = new Set(allFiles.map((f) => path.relative(rootDir, f)))

  // Analyse each file
  const runtimeData = {}
  const sourceFiles = project.getSourceFiles()
  for (let i = 0; i < sourceFiles.length; i += CHUNK) {
    for (const sf of sourceFiles.slice(i, i + CHUNK)) {
      const rel = path.relative(rootDir, sf.getFilePath())
      if (!fileKeySet.has(rel)) continue
      try {
        runtimeData[rel] = detectRuntimeCalls(sf)
      } catch {
        runtimeData[rel] = { dbCallCount: 0, apiCallCount: 0, cyclomatic: 1 }
      }
    }
    await tick()
  }

  // Build tree
  const { nodes: treeNodes, edges: treeEdges } = walkDir(rootDir)

  // Augment file nodes with runtime data + score
  const nodes = treeNodes
    .filter((n) => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    .map((n) => {
      if (n.attributes.kind === 'file') {
        const { dbCallCount = 0, apiCallCount = 0, cyclomatic = 1 } = runtimeData[n.key] ?? {}
        const runtimeScore = dbCallCount * 3 + apiCallCount * 2 + cyclomatic * 0.5
        return { ...n, attributes: { ...n.attributes, dbCallCount, apiCallCount, cyclomatic, runtimeScore } }
      }
      return n
    })

  // Count callers of DB and API virtual nodes
  let dbCallerCount = 0
  let apiCallerCount = 0
  for (const { dbCallCount, apiCallCount } of Object.values(runtimeData)) {
    if (dbCallCount > 0) dbCallerCount++
    if (apiCallCount > 0) apiCallerCount++
  }

  // Add virtual nodes
  nodes.push(
    { key: '__db__', attributes: { label: 'Database', kind: 'virtual-db', ext: null, depth: 1, dbCallerCount } },
    { key: '__api__', attributes: { label: 'External API', kind: 'virtual-api', ext: null, depth: 1, apiCallerCount } },
  )

  const nodeKeys = new Set(nodes.map((n) => n.key))

  // treeEdges: connect virtual nodes to root + filter valid
  const allTreeEdges = [
    ...treeEdges.filter((e) => nodeKeys.has(e.source) && nodeKeys.has(e.target)),
    { source: '__root__', target: '__db__' },
    { source: '__root__', target: '__api__' },
  ]

  // runtimeEdges: file → __db__ or __api__
  const runtimeEdges = []
  for (const { key, attributes } of nodes) {
    if (attributes.kind !== 'file') continue
    if (attributes.dbCallCount > 0) runtimeEdges.push({ source: key, target: '__db__' })
    if (attributes.apiCallCount > 0) runtimeEdges.push({ source: key, target: '__api__' })
  }

  return { nodes, treeEdges: allTreeEdges, runtimeEdges }
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

      server.middlewares.use('/api/runtimegraph', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const { target, error } = validatePath(url.searchParams.get('path'), rootDir)
          if (error) { res.statusCode = 400; res.end(JSON.stringify({ error })); return }
          const data = await buildRuntimeGraph(target)
          data.root = target
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      server.middlewares.use('/api/filecode', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const filePath = url.searchParams.get('path')
          if (!filePath) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path required' })); return }
          const resolved = path.resolve(filePath)
          if (!fs.existsSync(resolved)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'File not found' })); return }
          const data = await buildFileCode(resolved)
          data.file = resolved
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
