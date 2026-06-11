import http from 'node:http'
import { fileURLToPath } from 'url'
import path from 'path'
import {
  handleBrowse, handleFileMap, handleDepGraph,
  handleRuntimeGraph, handleFileCode, handleRuntimeStream,
  handleCCGraph, handleCCStream,
  jsonHandler,
} from '../vite-plugin-filemap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const API_PORT = 3847

function addCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
}

export function startApiServer(rootDir) {
  const server = http.createServer((req, res) => {
    addCors(res)
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const pathname = new URL(req.url, 'http://localhost').pathname

    const withRoot = (handler) =>
      jsonHandler((req, res) => handler(req, res, rootDir))(req, res)

    switch (pathname) {
      case '/api/browse':              return withRoot(handleBrowse)
      case '/api/filemap':             return withRoot(handleFileMap)
      case '/api/depgraph':            return withRoot(handleDepGraph)
      case '/api/runtimegraph/stream': return handleRuntimeStream(req, res, rootDir)
      case '/api/runtimegraph':        return withRoot(handleRuntimeGraph)
      case '/api/ccgraph/stream':       return handleCCStream(req, res, rootDir)
      case '/api/ccgraph':             return withRoot(handleCCGraph)
      case '/api/filecode':            return jsonHandler((req, res) => handleFileCode(req, res))(req, res)
      default: {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    }
  })

  server.listen(API_PORT)
  return server
}
