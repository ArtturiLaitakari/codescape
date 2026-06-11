/* global setImmediate */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { Project } from 'ts-morph'
import {
  IGNORE_DIRS, SOURCE_EXTS,
  DB_PACKAGES, API_PACKAGES,
  BRANCH_KINDS, CC_BANDS, RUNTIME_WEIGHTS,
  TS_PROJECT_OPTS as PROJECT_OPTS,
} from './node.properties.js'
import {
  IGNORE_DIRS as IGNORE_DIRS_DOTNET,
  SOURCE_EXTS as SOURCE_EXTS_DOTNET,
} from './dotnet.properties.js'
import {
  isMixedCodeFile,
  extractInlineScripts,
} from './src/lib/mixed-code-utils.js'

// ── Tuning constants (not language-specific) ──────────────────────────────────
const CHUNK = 50          // files added to ts-morph per event-loop tick
const STREAM_CHUNK = 20   // files analysed per SSE batch

// Aliases kept for backward compat with the rest of this file
const IGNORE = IGNORE_DIRS
const JS_TS_EXTS = SOURCE_EXTS

const PROPS = {
  node:   { ignoreDirs: IGNORE_DIRS,        sourceExts: SOURCE_EXTS },
  dotnet: { ignoreDirs: IGNORE_DIRS_DOTNET, sourceExts: SOURCE_EXTS_DOTNET },
}
function getProps(type) { return PROPS[type] ?? PROPS.node }

// suppress unused-var lint for re-exported names used only via aliases above
void DB_PACKAGES, void API_PACKAGES, void BRANCH_KINDS, void CC_BANDS, void RUNTIME_WEIGHTS

// ── Generic utilities ────────────────────────────────────────────────────────
const tick = () => new Promise((resolve) => setImmediate(resolve))
const isHidden = (name) => name.startsWith('.') || IGNORE.has(name)
const tryOr = (fn, fallback) => { try { return fn() } catch { return fallback } }
const runtimeScore = ({ dbCallCount = 0, apiCallCount = 0, cyclomatic = 1 }) =>
  dbCallCount * RUNTIME_WEIGHTS.db + apiCallCount * RUNTIME_WEIGHTS.api + cyclomatic * RUNTIME_WEIGHTS.cyclo

// ── Filesystem walk ──────────────────────────────────────────────────────────
function readEntries(dir, ignoreDirs = IGNORE) {
  const hidden = (name) => name.startsWith('.') || ignoreDirs.has(name)
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => !hidden(e.name)) }
  catch { return [] }
}

function isDirEmpty(dirPath, ignoreDirs) {
  return readEntries(dirPath, ignoreDirs).length === 0
}

/** Build directory tree (nodes + parent→child edges). Iterative. */
function walkDir(rootDir, { ignoreDirs = IGNORE } = {}) {
  const nodes = [{
    key: '__root__',
    attributes: { label: path.basename(rootDir), kind: 'root', ext: null, depth: 0 },
  }]
  const edges = []
  const stack = [rootDir]

  while (stack.length) {
    const current = stack.pop()
    for (const entry of readEntries(current, ignoreDirs)) {
      const fullPath = path.join(current, entry.name)
      const rel = path.relative(rootDir, fullPath)
      const parentRel = path.relative(rootDir, current)
      const parentKey = parentRel === '' ? '__root__' : parentRel
      const isDir = entry.isDirectory()

      nodes.push({
        key: rel,
        attributes: {
          label: entry.name,
          kind: isDir ? (isDirEmpty(fullPath, ignoreDirs) ? 'dir-empty' : 'dir') : 'file',
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

/** Iteratively collect all source file paths under rootDir. */
function collectJsTsFiles(rootDir, { ignoreDirs = IGNORE, sourceExts = JS_TS_EXTS } = {}) {
  const files = []
  const stack = [rootDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const e of readEntries(dir, ignoreDirs)) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (sourceExts.includes(path.extname(e.name))) files.push(full)
    }
  }
  return files
}

// ── ts-morph helpers ─────────────────────────────────────────────────────────
function createProject() {
  return new Project(PROJECT_OPTS)
}

/**
 * For server-side template files (.aspx, .razor, .jsp, .php, .erb, …):
 * extract inline JS and return a virtual source file descriptor.
 * Returns { virtualPath, content } or null for plain JS/TS files.
 */
function extractScriptForFile(filePath) {
  if (!isMixedCodeFile(filePath)) return null

  let src
  try { src = fs.readFileSync(filePath, 'utf8') } catch { return null }

  const ext = path.extname(filePath).toLowerCase()
  const js = extractInlineScripts(src, ext)
  if (!js) return null

  return {
    virtualPath: filePath + '.extracted.js',
    content: js,
  }
}

/** Add files in chunks, yielding the event loop between batches. */
async function loadProjectChunked(project, files) {
  for (let i = 0; i < files.length; i += CHUNK) {
    for (const f of files.slice(i, i + CHUNK)) {
      const extracted = extractScriptForFile(f)
      if (extracted) {
        tryOr(() => project.createSourceFile(extracted.virtualPath, extracted.content, { overwrite: true }), null)
      } else {
        tryOr(() => project.addSourceFileAtPath(f), null)
      }
    }
    await tick()
  }
}

const FUNCTION_KINDS = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunction',
])

/**
 * Cyclomatic complexity of `node` counting only branches that belong directly
 * to this function — branches inside nested functions are excluded, so parent
 * functions don't absorb their children's complexity.
 */
function cyclomaticOf(node) {
  let c = 1
  const descendants = tryOr(() => node.getDescendants(), [])
  for (const d of descendants) {
    // Skip anything inside a nested function scope
    const kind = d.getKindName()
    if (FUNCTION_KINDS.has(kind)) continue   // don't count nested fn roots
    // Skip branch nodes whose nearest function ancestor is not `node` itself
    if (!BRANCH_KINDS.includes(kind)) continue
    // Walk up to find the enclosing function; skip if it's not `node`
    let ancestor = d.getParent?.()
    let insideNested = false
    while (ancestor && ancestor !== node) {
      if (FUNCTION_KINDS.has(tryOr(() => ancestor.getKindName(), ''))) {
        insideNested = true
        break
      }
      ancestor = ancestor.getParent?.()
    }
    if (!insideNested) c++
  }
  return c
}

function linesOf(node) {
  return tryOr(() => node.getEndLineNumber() - node.getStartLineNumber() + 1, 1)
}

/** Names that this file exports — used to flag root functions in the UI. */
function collectExportedNames(sf) {
  const names = new Set()

  tryOr(() => {
    for (const [, decls] of sf.getExportedDeclarations()) {
      for (const d of decls) {
        const n = tryOr(() => d.getName?.(), null)
        if (n) names.add(n)
      }
    }
  })

  // Catch `export default HOC(Name)` — getName() fails on CallExpression
  tryOr(() => {
    for (const ea of sf.getExportAssignments()) {
      const expr = ea.getExpression()
      const idents = [expr, ...expr.getDescendants()].filter(n => n.getKindName() === 'Identifier')
      for (const id of idents) {
        const t = tryOr(() => id.getText(), null)
        if (t) names.add(t)
      }
    }
  })

  return names
}

/** Walk the source file and collect every function-like declaration. */
/**
 * Resolve the actual function node from a variable initializer.
 *   const f = () => {}                → ArrowFunction
 *   const f = function() {}           → FunctionExpression
 *   const f = useCallback(() => {}, []) → first arg (ArrowFunction / FunctionExpression)
 */
function resolveInitFnNode(init) {
  if (!init) return null
  const kind = tryOr(() => init.getKindName(), null)
  if (kind === 'ArrowFunction' || kind === 'FunctionExpression') return init
  if (kind === 'CallExpression') {
    const firstArg = tryOr(() => init.getArguments?.()[0], null)
    const argKind  = firstArg ? tryOr(() => firstArg.getKindName(), null) : null
    if (argKind === 'ArrowFunction' || argKind === 'FunctionExpression') return firstArg
  }
  return null
}

/** Collect FunctionDeclarations and const/arrow variables at any depth. */
function collectTopLevelFunctions(sf, exportedNames) {
  const results = []
  for (const node of sf.getDescendants()) {
    const kind = tryOr(() => node.getKindName(), null)
    if (kind === 'FunctionDeclaration') {
      const name = tryOr(() => node.getName?.(), '')
      if (name) results.push(buildFunctionEntry(name, 'function', node, node, exportedNames))
    } else if (kind === 'VariableDeclaration') {
      const fnNode = resolveInitFnNode(tryOr(() => node.getInitializer?.(), null))
      const name   = fnNode && tryOr(() => node.getName?.(), null)
      if (name) results.push(buildFunctionEntry(name, 'arrow', node, fnNode, exportedNames))
    }
  }
  return results
}

/** Collect all class method entries across every class declaration in the file. */
function collectClassMethods(sf) {
  const results = []
  for (const cls of sf.getClasses()) {
    const clsName = cls.getName() ?? 'Class'
    for (const method of cls.getMethods()) {
      tryOr(() => {
        results.push(buildFunctionEntry(`${clsName}.${method.getName()}`, 'method', method, method, new Set()))
      })
    }
  }
  return results
}

function collectFunctions(sf, exportedNames) {
  return [...collectTopLevelFunctions(sf, exportedNames), ...collectClassMethods(sf)]
}

/** Standard shape of a single function record. */
function buildFunctionEntry(name, kind, startNode, bodyNode, exportedNames) {
  return {
    name,
    kind,
    isRoot:     exportedNames.has(name),
    startLine:  startNode.getStartLineNumber(),
    endLine:    bodyNode.getEndLineNumber(),
    lines:      linesOf(bodyNode),
    params:     bodyNode.getParameters?.()?.length ?? 0,
    cyclomatic: cyclomaticOf(bodyNode),
  }
}

/** Reshape flat function list into parent/child tree using start/end ranges. */
function buildFunctionTree(flat) {
  if (flat.length === 0) return []
  const sorted = [...flat].sort((a, b) =>
    a.startLine !== b.startLine ? a.startLine - b.startLine : b.endLine - a.endLine
  )
  const roots = []
  const stack = []
  for (const fn of sorted) {
    while (stack.length && fn.startLine > stack[stack.length - 1].endLine) stack.pop()
    fn.children = []
    if (stack.length === 0) roots.push(fn)
    else stack[stack.length - 1].children.push(fn)
    stack.push(fn)
  }
  return roots
}

/** Aggregate file-level complexity metrics from per-function CC. */
function computeFileComplexity(functions, text, loc) {
  // cyclomaticOf already excludes nested functions' branches, so every function's
  // CC is self-contained. maxCyclomatic can safely use all functions.
  const totalCyclomatic = functions.reduce((s, f) => s + f.cyclomatic, 0)
  const avgCyclomatic   = functions.length ? +(totalCyclomatic / functions.length).toFixed(1) : 1
  const maxCyclomatic   = functions.reduce((m, f) => Math.max(m, f.cyclomatic), 1)
  const totalLines = functions.reduce((s, f) => s + f.lines, 0)

  // Halstead-lite vocabulary proxy
  const tokens = text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) ?? []
  const vocabulary = new Set(tokens).size

  // Simplified maintainability index, clamped to [0, 100]
  const V = Math.max(1, vocabulary)
  const maintainability = Math.max(0, Math.min(100,
    Math.round(171 - 5.2 * Math.log(V) - 0.23 * totalCyclomatic - 16.2 * Math.log(Math.max(1, loc)))
  ))

  const wayTooHighCount = functions.filter(f => f.cyclomatic >= CC_BANDS.wayTooHigh).length
  const highCount       = functions.filter(f => f.cyclomatic >= CC_BANDS.high && f.cyclomatic < CC_BANDS.wayTooHigh).length
  const medCount        = functions.filter(f => f.cyclomatic >= CC_BANDS.med  && f.cyclomatic < CC_BANDS.high).length
  const lowCount        = functions.filter(f => f.cyclomatic < CC_BANDS.med).length

  return {
    loc, functionCount: functions.length,
    totalCyclomatic, avgCyclomatic, maxCyclomatic,
    totalLines, vocabulary, maintainability,
    wayTooHighCount, highCount, medCount, lowCount,
  }
}

/** Top-level: extract functions + complexity for a file. */
function detectFileFunctions(sf) {
  const text = sf.getText()
  const loc = text.split('\n').length

  const externalImports = sf.getImportDeclarations()
    .map(d => d.getModuleSpecifierValue())
    .filter(s => !s.startsWith('.'))

  const exportedNames = collectExportedNames(sf)
  const functions = collectFunctions(sf, exportedNames)
  const complexity = computeFileComplexity(functions, text, loc)

  return {
    functions: buildFunctionTree(functions),
    externalImports: [...new Set(externalImports)],
    loc,
    complexity,
  }
}

/** Strip subpath: '@prisma/client/edge' → '@prisma/client', 'fs/promises' → 'fs' */
function packageRoot(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
}

/** Count DB / API / fetch invocations + worst per-function CC in the file. */
function detectRuntimeCalls(sf) {
  let dbCallCount = 0
  let apiCallCount = 0

  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue()
    const root = packageRoot(spec)
    if (DB_PACKAGES.has(spec)  || DB_PACKAGES.has(root))  dbCallCount++
    if (API_PACKAGES.has(spec) || API_PACKAGES.has(root)) apiCallCount++
  }

  // Built-in fetch() needs no import — count textual occurrences as a rough proxy
  const fetchMatches = sf.getText().match(/\bfetch\s*\(/g)
  if (fetchMatches) apiCallCount += fetchMatches.length

  // Max per-function CC represents the worst hotspot in the file
  const cyclomatic = tryOr(() => detectFileFunctions(sf).complexity.maxCyclomatic, 1)

  return { dbCallCount, apiCallCount, cyclomatic }
}

// ── Import resolver ──────────────────────────────────────────────────────────
function resolveImport(fromDir, spec) {
  const base = path.resolve(fromDir, spec)
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const ext of JS_TS_EXTS) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  for (const ext of JS_TS_EXTS) {
    const idx = path.join(base, `index${ext}`)
    if (fs.existsSync(idx)) return idx
  }
  return null
}

// ── .NET namespace/using resolver ─────────────────────────────────────────────
const DOTNET_EXTS = new Set(SOURCE_EXTS_DOTNET)

/**
 * Scan all .NET source files in `files` and return:
 *   - namespaceMap: namespace → filePath[]  (one namespace can span many files)
 *   - fileNamespaces: filePath → string[]   (namespaces declared in this file)
 *   - fileUsings: filePath → string[]       (namespaces referenced by this file)
 */
function scanDotnetNamespaces(files) {
  const namespaceMap   = {}   // ns → [filePath, ...]
  const fileNamespaces = {}   // filePath → [ns, ...]
  const fileUsings     = {}   // filePath → [ns, ...]

  // Patterns:
  //   C#  namespace Foo.Bar { ...  or  namespace Foo.Bar;
  //   VB  Namespace Foo.Bar
  //   using Foo.Bar;          (C# / F#)
  //   @using Foo.Bar          (Razor)
  //   Imports Foo.Bar         (VB)
  const nsRe    = /(?:^|\n)\s*(?:namespace|Namespace)\s+([\w.]+)/g
  const usingRe = /(?:^|\n)\s*(?:using|@using|Imports)\s+([\w.]+)\s*;?/g

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase()
    if (!DOTNET_EXTS.has(ext)) continue
    let src
    try { src = fs.readFileSync(filePath, 'utf8') } catch { continue }

    // Declared namespaces
    const ns = []
    let m
    nsRe.lastIndex = 0
    while ((m = nsRe.exec(src)) !== null) ns.push(m[1])
    fileNamespaces[filePath] = ns
    for (const n of ns) (namespaceMap[n] ??= []).push(filePath)

    // Used namespaces
    const usings = []
    usingRe.lastIndex = 0
    while ((m = usingRe.exec(src)) !== null) {
      // Ignore static / alias usings: "using static Foo" or "using X = Y"
      const candidate = m[1]
      if (!candidate.includes('=')) usings.push(candidate)
    }
    fileUsings[filePath] = usings
  }

  return { namespaceMap, fileNamespaces, fileUsings }
}

/**
 * Build import edges for a .NET project using namespace/using analysis.
 * Returns { importEdges, fanIn, fanOut } like the JS version.
 */
function buildDotnetDeps(files, rootDir) {
  const fileKeySet = new Set(files.map(f => path.relative(rootDir, f)))
  const fanIn  = Object.fromEntries([...fileKeySet].map(k => [k, 0]))
  const fanOut = Object.fromEntries([...fileKeySet].map(k => [k, 0]))
  const importEdges = []
  const seen = new Set()

  const { namespaceMap, fileUsings } = scanDotnetNamespaces(files)

  for (const srcPath of files) {
    const srcRel  = path.relative(rootDir, srcPath)
    const usings  = fileUsings[srcPath] ?? []

    for (const ns of usings) {
      // Match both exact namespace and any file whose namespace starts with `ns`
      // (e.g. "using MyApp.Services" → matches "MyApp.Services.UserService")
      const targets = Object.entries(namespaceMap)
        .filter(([declaredNs]) => declaredNs === ns || declaredNs.startsWith(ns + '.'))
        .flatMap(([, paths]) => paths)

      for (const tgtPath of targets) {
        if (tgtPath === srcPath) continue   // skip self-references
        const tgtRel = path.relative(rootDir, tgtPath)
        if (!fileKeySet.has(tgtRel)) continue
        const edgeKey = `${srcRel}→${tgtRel}`
        if (seen.has(edgeKey)) continue
        seen.add(edgeKey)
        importEdges.push({ source: srcRel, target: tgtRel })
        fanOut[srcRel]  = (fanOut[srcRel]  ?? 0) + 1
        fanIn[tgtRel]   = (fanIn[tgtRel]   ?? 0) + 1
      }
    }
  }

  return { importEdges, fanIn, fanOut }
}

// ── Dependency graph ─────────────────────────────────────────────────────────

/**
 * Build fan-in/fanOut/importEdges for a JS/TS project using ts-morph import declarations.
 * Returns { importEdges, fanIn, fanOut }.
 */
async function buildJsDeps(allFiles, rootDir) {
  const project = createProject()
  await loadProjectChunked(project, allFiles)

  const fileKeySet = new Set(allFiles.map(f => path.relative(rootDir, f)))
  const fanIn  = Object.fromEntries([...fileKeySet].map(k => [k, 0]))
  const fanOut = Object.fromEntries([...fileKeySet].map(k => [k, 0]))
  const importEdges = []

  const sourceFiles = project.getSourceFiles()
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
        fanOut[srcRel]    = (fanOut[srcRel]    ?? 0) + 1
        fanIn[targetRel]  = (fanIn[targetRel]  ?? 0) + 1
      }
    }
    await tick()
  }
  return { importEdges, fanIn, fanOut }
}

async function buildDepGraph(rootDir, props = {}) {
  const allFiles = collectJsTsFiles(rootDir, props)

  const isDotnet = props.sourceExts && props.sourceExts.some(e => e === '.cs' || e === '.vb')
  const { importEdges, fanIn, fanOut } = isDotnet
    ? buildDotnetDeps(allFiles, rootDir)
    : await buildJsDeps(allFiles, rootDir)

  const fileKeySet = new Set(allFiles.map(f => path.relative(rootDir, f)))
  const { nodes: treeNodes, edges: treeEdges } = walkDir(rootDir, props)
  const nodes = treeNodes
    .filter(n => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    .map(n => n.attributes.kind === 'file'
      ? { ...n, attributes: { ...n.attributes, fanIn: fanIn[n.key] ?? 0, fanOut: fanOut[n.key] ?? 0 } }
      : n)

  const nodeKeys = new Set(nodes.map(n => n.key))
  return {
    nodes,
    treeEdges:   treeEdges.filter(e => nodeKeys.has(e.source) && nodeKeys.has(e.target)),
    importEdges: importEdges.filter(e => nodeKeys.has(e.source) && nodeKeys.has(e.target)),
  }
}

// ── Runtime graph (non-streaming + helpers shared with SSE) ──────────────────

/** Add virtual DB/API root children to the node + tree-edge lists. */
function appendVirtualNodes(nodes, treeEdges, dbCallerCount, apiCallerCount) {
  nodes.push(
    { key: '__db__',  attributes: { label: 'Database',     kind: 'virtual-db',  ext: null, depth: 1, dbCallerCount  } },
    { key: '__api__', attributes: { label: 'External API', kind: 'virtual-api', ext: null, depth: 1, apiCallerCount } },
  )
  treeEdges.push(
    { source: '__root__', target: '__db__'  },
    { source: '__root__', target: '__api__' },
  )
}

/** Aggregate runtimeData → (caller counts, runtime edges). */
function computeRuntimeEdges(runtimeData) {
  let dbCallerCount = 0, apiCallerCount = 0
  const runtimeEdges = []
  for (const [key, { dbCallCount, apiCallCount }] of Object.entries(runtimeData)) {
    if (dbCallCount  > 0) { dbCallerCount++;  runtimeEdges.push({ source: key, target: '__db__'  }) }
    if (apiCallCount > 0) { apiCallerCount++; runtimeEdges.push({ source: key, target: '__api__' }) }
  }
  return { runtimeEdges, dbCallerCount, apiCallerCount }
}

async function buildRuntimeGraph(rootDir, props = {}) {
  const allFiles = collectJsTsFiles(rootDir, props)
  const project = createProject()
  await loadProjectChunked(project, allFiles)

  const fileKeySet = new Set(allFiles.map(f => path.relative(rootDir, f)))
  const runtimeData = {}
  const sourceFiles = project.getSourceFiles()

  for (let i = 0; i < sourceFiles.length; i += CHUNK) {
    for (const sf of sourceFiles.slice(i, i + CHUNK)) {
      const rel = path.relative(rootDir, sf.getFilePath())
      if (!fileKeySet.has(rel)) continue
      runtimeData[rel] = tryOr(() => detectRuntimeCalls(sf), { dbCallCount: 0, apiCallCount: 0, cyclomatic: 1 })
    }
    await tick()
  }

  const { nodes: treeNodes, edges: treeEdges } = walkDir(rootDir)
  const nodes = treeNodes
    .filter(n => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    .map(n => {
      if (n.attributes.kind !== 'file') return n
      const data = runtimeData[n.key] ?? { dbCallCount: 0, apiCallCount: 0, cyclomatic: 1 }
      return { ...n, attributes: { ...n.attributes, ...data, runtimeScore: runtimeScore(data) } }
    })

  const { runtimeEdges, dbCallerCount, apiCallerCount } = computeRuntimeEdges(runtimeData)
  appendVirtualNodes(nodes, treeEdges, dbCallerCount, apiCallerCount)

  const nodeKeys = new Set(nodes.map(n => n.key))
  return {
    nodes,
    treeEdges: treeEdges.filter(e => nodeKeys.has(e.source) && nodeKeys.has(e.target)),
    runtimeEdges,
  }
}

// ── File-code parse cache ─────────────────────────────────────────────────────
// Avoids re-creating a ts-morph Project on every open of the same file.
// Keyed by absolute path; invalidated when the file's mtime changes.
const FILE_CODE_CACHE = new Map()   // path → { mtime, result }
const FILE_CODE_CACHE_MAX = 40      // evict oldest when over limit

function fileCodeCacheGet(filePath) {
  const entry = FILE_CODE_CACHE.get(filePath)
  if (!entry) return null
  try {
    const mtime = fs.statSync(filePath).mtimeMs
    if (mtime !== entry.mtime) { FILE_CODE_CACHE.delete(filePath); return null }
    return entry.result
  } catch { FILE_CODE_CACHE.delete(filePath); return null }
}

function fileCodeCacheSet(filePath, result) {
  try {
    const mtime = fs.statSync(filePath).mtimeMs
    if (FILE_CODE_CACHE.size >= FILE_CODE_CACHE_MAX) {
      FILE_CODE_CACHE.delete(FILE_CODE_CACHE.keys().next().value)
    }
    FILE_CODE_CACHE.set(filePath, { mtime, result })
  } catch { /* ignore stat errors */ }
}

async function buildFileCode(filePath) {
  const cached = fileCodeCacheGet(filePath)
  if (cached) return cached

  await tick()  // yield before heavy synchronous parse
  const project = createProject()

  let sf
  const extracted = extractScriptForFile(filePath)
  if (extracted) {
    sf = tryOr(() => project.createSourceFile(extracted.virtualPath, extracted.content, { overwrite: true }), null)
  } else {
    try { project.addSourceFileAtPath(filePath) }
    catch (e) { throw new Error(`Cannot parse file: ${e.message}`, { cause: e }) }
    sf = project.getSourceFile(filePath)
  }

  if (!sf) throw new Error('File not found in project after adding')
  await tick()  // yield after parse, before analysis
  const result = detectFileFunctions(sf)
  fileCodeCacheSet(filePath, result)
  return result
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function sendJson(res, data, statusCode = 200) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

function sendError(res, statusCode, message) {
  sendJson(res, { error: message }, statusCode)
}

/** Wrap an async (req, res) handler so any throw becomes a 500 JSON response. */
function jsonHandler(fn) {
  return async (req, res) => {
    try { await fn(req, res) }
    catch (e) { sendError(res, 500, e.message) }
  }
}

function getQueryPath(req) {
  return new URL(req.url, 'http://localhost').searchParams.get('path')
}

function getQueryType(req) {
  return new URL(req.url, 'http://localhost').searchParams.get('type') ?? 'node'
}

/**
 * Like getProps(), but merges any ?exclude=dir1,dir2 query param into ignoreDirs.
 * This lets the frontend exclude specific directory names at request time.
 */
function getPropsWithExclude(req) {
  const props  = getProps(getQueryType(req))
  const raw    = new URL(req.url, 'http://localhost').searchParams.get('exclude')
  if (!raw) return props
  const extra  = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (extra.length === 0) return props
  return { ...props, ignoreDirs: new Set([...props.ignoreDirs, ...extra]) }
}

/** Validate a user-supplied path; resolves to absolute or returns { error }. */
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

// ── SSE helpers ──────────────────────────────────────────────────────────────
function sseStart(res) {
  res.setHeader('Content-Type',   'text/event-stream')
  res.setHeader('Cache-Control',  'no-cache')
  res.setHeader('Connection',     'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
}

const sseSend = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

// ── Endpoint handlers ────────────────────────────────────────────────────────
function handleBrowse(req, res, rootDir) {
  const reqPath = getQueryPath(req)
  const target = reqPath ? path.resolve(reqPath) : rootDir
  try {
    if (!fs.statSync(target).isDirectory()) return sendError(res, 400, 'Not a directory')
  } catch (e) {
    return sendError(res, 400, e.message)
  }
  const parent = path.dirname(target)
  const dirs = readEntries(target)
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  sendJson(res, { path: target, parent: parent !== target ? parent : null, dirs })
}

function handleFileMap(req, res, rootDir) {
  const { target, error } = validatePath(getQueryPath(req), rootDir)
  if (error) return sendError(res, 400, error)
  const props = getPropsWithExclude(req)
  sendJson(res, { ...walkDir(target, props), root: target })
}

async function handleDepGraph(req, res, rootDir) {
  const { target, error } = validatePath(getQueryPath(req), rootDir)
  if (error) return sendError(res, 400, error)
  const props = getPropsWithExclude(req)
  sendJson(res, { ...(await buildDepGraph(target, props)), root: target })
}

async function handleDepGraphStream(req, res, rootDir) {
  sseStart(res)

  const { target, error } = validatePath(getQueryPath(req), rootDir)
  if (error) {
    sseSend(res, { type: 'error', error })
    res.end()
    return
  }
  const props = getPropsWithExclude(req)

  try {
    // 1. Walk dir tree and send it immediately so the graph appears at once
    const { nodes: treeNodes, edges: treeEdges } = walkDir(target, props)
    const allFiles = collectJsTsFiles(target, props)
    const fileKeySet = new Set(allFiles.map(f => path.relative(target, f)))
    const initNodes = treeNodes.filter(n => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    sseSend(res, { type: 'tree', total: allFiles.length, nodes: initNodes, treeEdges, root: target })

    // 2. Analyse dependencies — strategy depends on project type
    const isDotnet = props.sourceExts && props.sourceExts.some(e => e === '.cs' || e === '.vb')

    let importEdges, fanIn, fanOut
    if (isDotnet) {
      // Synchronous regex-based namespace/using analysis — no ts-morph needed
      ;({ importEdges, fanIn, fanOut } = buildDotnetDeps(allFiles, target))
      sseSend(res, { type: 'progress', done: allFiles.length, total: allFiles.length })
    } else {
      // JS/TS: parse with ts-morph and stream progress per chunk
      const project = createProject()
      await loadProjectChunked(project, allFiles)

      fanIn  = Object.fromEntries([...fileKeySet].map(k => [k, 0]))
      fanOut = Object.fromEntries([...fileKeySet].map(k => [k, 0]))
      importEdges = []

      const sourceFiles = project.getSourceFiles()
      for (let i = 0; i < sourceFiles.length; i += CHUNK) {
        for (const sf of sourceFiles.slice(i, i + CHUNK)) {
          const srcRel = path.relative(target, sf.getFilePath())
          if (!fileKeySet.has(srcRel)) continue
          for (const decl of sf.getImportDeclarations()) {
            const spec = decl.getModuleSpecifierValue()
            if (!spec.startsWith('.')) continue
            const resolved = resolveImport(path.dirname(sf.getFilePath()), spec)
            if (!resolved) continue
            const targetRel = path.relative(target, resolved)
            if (!fileKeySet.has(targetRel)) continue
            importEdges.push({ source: srcRel, target: targetRel })
            fanOut[srcRel]   = (fanOut[srcRel]   ?? 0) + 1
            fanIn[targetRel] = (fanIn[targetRel] ?? 0) + 1
          }
        }
        sseSend(res, { type: 'progress', done: Math.min(i + CHUNK, allFiles.length), total: allFiles.length })
        await tick()
      }
    }

    // 3. Send fan-in/out patches and import edges
    const nodeKeys = new Set(initNodes.map(n => n.key))
    const filteredImportEdges = importEdges.filter(e => nodeKeys.has(e.source) && nodeKeys.has(e.target))

    sseSend(res, {
      type: 'done',
      root: target,
      importEdges: filteredImportEdges,
      fanData: Object.fromEntries(
        [...fileKeySet].map(k => [k, { fanIn: fanIn[k] ?? 0, fanOut: fanOut[k] ?? 0 }])
      ),
    })
    res.end()
  } catch (e) {
    tryOr(() => sseSend(res, { type: 'error', error: e.message }))
    res.end()
  }
}

async function handleRuntimeGraph(req, res, rootDir) {
  const { target, error } = validatePath(getQueryPath(req), rootDir)
  if (error) return sendError(res, 400, error)
  const props = getPropsWithExclude(req)
  sendJson(res, { ...(await buildRuntimeGraph(target, props)), root: target })
}

// ── Code Complexity graph ─────────────────────────────────────────────
async function buildCCGraph(rootDir, props = {}) {
  const allFiles = collectJsTsFiles(rootDir, props)
  const project = createProject()
  await loadProjectChunked(project, allFiles)

  const fileKeySet = new Set(allFiles.map(f => path.relative(rootDir, f)))
  const { nodes: treeNodes, edges: treeEdges } = walkDir(rootDir, props)

  const ccData = {}
  const sourceFiles = project.getSourceFiles()
  for (let i = 0; i < sourceFiles.length; i += CHUNK) {
    for (const sf of sourceFiles.slice(i, i + CHUNK)) {
      const rel = path.relative(rootDir, sf.getFilePath())
      if (!fileKeySet.has(rel)) continue
      ccData[rel] = tryOr(() => detectFileFunctions(sf).complexity, null)
    }
    await tick()
  }

  const nodes = treeNodes
    .filter(n => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    .map(n => {
      if (n.attributes.kind !== 'file') return n
      const cc = ccData[n.key]
      return { ...n, attributes: { ...n.attributes, ...(cc ?? {}), hasCC: !!cc } }
    })

  const nodeKeys = new Set(nodes.map(n => n.key))
  return {
    nodes,
    treeEdges: treeEdges.filter(e => nodeKeys.has(e.source) && nodeKeys.has(e.target)),
  }
}

async function handleCCGraph(req, res, rootDir) {
  const { target, error } = validatePath(getQueryPath(req), rootDir)
  if (error) return sendError(res, 400, error)
  const props = getPropsWithExclude(req)
  sendJson(res, { ...(await buildCCGraph(target, props)), root: target })
}

async function handleCCStream(req, res, rootDir) {
  sseStart(res)

  const { target, error } = validatePath(getQueryPath(req), rootDir)
  if (error) {
    sseSend(res, { type: 'error', error })
    res.end()
    return
  }
  const props = getPropsWithExclude(req)

  try {
    // 1. Walk dir tree and send it immediately (graph appears at once)
    const { nodes: treeNodes, edges: treeEdges } = walkDir(target, props)
    const allFiles = collectJsTsFiles(target, props)
    const fileKeySet = new Set(allFiles.map(f => path.relative(target, f)))
    const initNodes = treeNodes.filter(n => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    sseSend(res, { type: 'tree', total: allFiles.length, nodes: initNodes, treeEdges, root: target })

    // 2. Load AST project in chunks (non-blocking)
    const project = createProject()
    await loadProjectChunked(project, allFiles)

    // 3. Analyse files in streaming batches
    const sourceFiles = project.getSourceFiles()
      .filter(sf => fileKeySet.has(path.relative(target, sf.getFilePath())))

    for (let i = 0; i < sourceFiles.length; i += STREAM_CHUNK) {
      const batchData = {}
      for (const sf of sourceFiles.slice(i, i + STREAM_CHUNK)) {
        const rel = path.relative(target, sf.getFilePath())
        batchData[rel] = tryOr(() => detectFileFunctions(sf).complexity, null)
      }
      sseSend(res, {
        type: 'batch',
        done: Math.min(i + STREAM_CHUNK, sourceFiles.length),
        total: sourceFiles.length,
        ccData: batchData,
      })
      await tick()
    }

    sseSend(res, { type: 'done', root: target })
    res.end()
  } catch (e) {
    tryOr(() => sseSend(res, { type: 'error', error: e.message }))
    res.end()
  }
}

async function handleFileCode(req, res) {
  const filePath = getQueryPath(req)
  if (!filePath) return sendError(res, 400, 'path required')
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) return sendError(res, 404, 'File not found')
  sendJson(res, { ...(await buildFileCode(resolved)), file: resolved })
}

/**
 * Open a file (at an optional line) in VS Code.
 * GET /api/open-in-vscode?path=/abs/path&line=42
 */
function handleOpenInVsCode(req, res) {
  const url      = new URL(req.url, 'http://localhost')
  const filePath = url.searchParams.get('path')
  const line     = url.searchParams.get('line')

  if (!filePath || !path.isAbsolute(filePath)) {
    return sendError(res, 400, 'Absolute path required')
  }
  if (line && !/^\d+$/.test(line)) {
    return sendError(res, 400, 'line must be a positive integer')
  }

  const vscodeUrl = line ? `vscode://file/${filePath}:${line}` : `vscode://file/${filePath}`
  const cb = (err) => err
    ? sendError(res, 500, `Failed to open VS Code: ${err.message}`)
    : sendJson(res, { ok: true })

  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', vscodeUrl], cb)
  } else if (process.platform === 'darwin') {
    execFile('open', [vscodeUrl], cb)
  } else {
    // Linux
    execFile('xdg-open', [vscodeUrl], cb)
  }
}

async function handleRuntimeStream(req, res, rootDir) {
  sseStart(res)  // start SSE first so any error reply is also SSE-formatted

  const { target, error } = validatePath(getQueryPath(req), rootDir)
  if (error) {
    sseSend(res, { type: 'error', error })
    res.end()
    return
  }
  const props = getPropsWithExclude(req)

  try {
    // 1. Tree + placeholder virtual nodes — sent immediately
    const { nodes: treeNodes, edges: treeEdges } = walkDir(target, props)
    const allFiles = collectJsTsFiles(target, props)
    const fileKeySet = new Set(allFiles.map(f => path.relative(target, f)))
    const initNodes = treeNodes.filter(n => n.attributes.kind !== 'file' || fileKeySet.has(n.key))
    appendVirtualNodes(initNodes, treeEdges, 0, 0)
    sseSend(res, { type: 'tree', total: allFiles.length, nodes: initNodes, treeEdges, root: target })

    // 2. Parse project in chunks
    const project = createProject()
    await loadProjectChunked(project, allFiles)

    // 3. Analyse files in streaming batches
    const sourceFiles = project.getSourceFiles()
      .filter(sf => fileKeySet.has(path.relative(target, sf.getFilePath())))
    const runtimeData = {}

    for (let i = 0; i < sourceFiles.length; i += STREAM_CHUNK) {
      const batchData = {}
      for (const sf of sourceFiles.slice(i, i + STREAM_CHUNK)) {
        const rel = path.relative(target, sf.getFilePath())
        const data = tryOr(() => detectRuntimeCalls(sf), { dbCallCount: 0, apiCallCount: 0, cyclomatic: 1 })
        runtimeData[rel] = data
        batchData[rel]   = data
      }
      sseSend(res, {
        type: 'batch',
        done: Math.min(i + STREAM_CHUNK, sourceFiles.length),
        total: sourceFiles.length,
        runtimeData: batchData,
      })
      await tick()
    }

    // 4. Final edges + caller counts
    const { runtimeEdges, dbCallerCount, apiCallerCount } = computeRuntimeEdges(runtimeData)
    sseSend(res, { type: 'done', root: target, runtimeEdges, dbCallerCount, apiCallerCount })
    res.end()
  } catch (e) {
    tryOr(() => sseSend(res, { type: 'error', error: e.message }))
    res.end()
  }
}

// ── Shared exports (used by electron/api-server.js) ──────────────────────────
export {
  handleBrowse, handleFileMap, handleDepGraph, handleDepGraphStream,
  handleRuntimeGraph, handleFileCode, handleOpenInVsCode, handleRuntimeStream,
  handleCCGraph, handleCCStream,
  jsonHandler,
}

// ── Plugin entry point ───────────────────────────────────────────────────────
export function fileMapPlugin(rootDir) {
  return {
    name: 'vite-filemap',
    configureServer(server) {
      const mount = (route, handler) => server.middlewares.use(route, handler)
      mount('/api/browse',              jsonHandler((req, res) => handleBrowse(req, res, rootDir)))
      mount('/api/filemap',             jsonHandler((req, res) => handleFileMap(req, res, rootDir)))
      mount('/api/depgraph/stream',     (req, res) => handleDepGraphStream(req, res, rootDir))
      mount('/api/depgraph',            jsonHandler((req, res) => handleDepGraph(req, res, rootDir)))
      // /stream must come BEFORE /api/runtimegraph — connect middlewares match by prefix,
      // and the shorter path would otherwise catch the SSE request and respond with JSON.
      mount('/api/runtimegraph/stream', (req, res) => handleRuntimeStream(req, res, rootDir))
      mount('/api/runtimegraph',        jsonHandler((req, res) => handleRuntimeGraph(req, res, rootDir)))
      mount('/api/ccgraph/stream',       (req, res) => handleCCStream(req, res, rootDir))
      mount('/api/ccgraph',             jsonHandler((req, res) => handleCCGraph(req, res, rootDir)))
      mount('/api/filecode',            jsonHandler((req, res) => handleFileCode(req, res)))
      mount('/api/open-in-vscode',      jsonHandler((req, res) => handleOpenInVsCode(req, res)))
    },
  }
}
