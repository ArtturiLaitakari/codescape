import fs from 'node:fs'
import path from 'node:path'

const IGNORE = new Set(['node_modules', '.git', 'dist', '.cache', 'coverage', '.vite'])

function walkDir(rootDir) {
  const nodes = []
  const edges = []

  nodes.push({
    key: '__root__',
    attributes: {
      label: path.basename(rootDir),
      kind: 'root',
      ext: null,
      depth: 0,
    },
  })

  function walk(current) {
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = path.join(current, entry.name)
      const rel = path.relative(rootDir, fullPath)
      const parentRel = path.relative(rootDir, current)
      const parentKey = parentRel === '' ? '__root__' : parentRel
      const isDir = entry.isDirectory()

      // Check if directory is empty (ignoring hidden/ignored entries)
      let isEmpty = false
      if (isDir) {
        try {
          const children = fs.readdirSync(fullPath, { withFileTypes: true })
          isEmpty = !children.some(c => !IGNORE.has(c.name) && !c.name.startsWith('.'))
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

      if (isDir) walk(fullPath)
    }
  }

  walk(rootDir)
  return { nodes, edges }
}

export function fileMapPlugin(rootDir) {
  return {
    name: 'vite-filemap',
    configureServer(server) {
      server.middlewares.use('/api/filemap', (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const requested = url.searchParams.get('path')

          let target = rootDir
          if (requested) {
            const resolved = path.resolve(requested)
            // Safety: must be absolute and directory must exist
            if (!path.isAbsolute(resolved)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Path must be absolute' }))
              return
            }
            try {
              const stat = fs.statSync(resolved)
              if (!stat.isDirectory()) throw new Error('Not a directory')
            } catch (e) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Invalid path: ${e.message}` }))
              return
            }
            target = resolved
          }

          const data = walkDir(target)
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
