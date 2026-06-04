import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileMapPlugin } from './vite-plugin-filemap.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), fileMapPlugin(__dirname)],
})
