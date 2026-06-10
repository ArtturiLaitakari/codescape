#!/usr/bin/env node
/**
 * Generates build/icon.icns (macOS) and build/icon.ico (Windows) from
 * build/app-icon.svg.
 *
 * Requirements (macOS):
 *   brew install librsvg        # for rsvg-convert
 *   iconutil is built-in to macOS (Xcode CLI tools)
 *
 * Usage:
 *   node scripts/gen-icons.js
 */

import { execSync } from 'child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SVG  = path.join(ROOT, 'build', 'app-icon.svg')
const ICONSET = path.join(ROOT, 'build', 'icon.iconset')

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd) {
  console.log('$', cmd)
  execSync(cmd, { stdio: 'inherit' })
}

function hasTool(name) {
  try { execSync(`which ${name}`, { stdio: 'pipe' }); return true }
  catch { return false }
}

// Render SVG → PNG at given pixel size
function renderPng(dest, size) {
  if (hasTool('rsvg-convert')) {
    run(`rsvg-convert -w ${size} -h ${size} -o "${dest}" "${SVG}"`)
  } else if (hasTool('inkscape')) {
    run(`inkscape --export-png="${dest}" -w ${size} -h ${size} "${SVG}"`)
  } else {
    throw new Error(
      'Need rsvg-convert or inkscape to render SVG to PNG.\n' +
      'Install with:  brew install librsvg',
    )
  }
}

// ── macOS .icns ───────────────────────────────────────────────────────────────

function buildIcns() {
  // Clean/create iconset dir
  if (existsSync(ICONSET)) rmSync(ICONSET, { recursive: true })
  mkdirSync(ICONSET)

  const sizes = [
    { name: 'icon_16x16',       px: 16  },
    { name: 'icon_16x16@2x',    px: 32  },
    { name: 'icon_32x32',       px: 32  },
    { name: 'icon_32x32@2x',    px: 64  },
    { name: 'icon_128x128',     px: 128 },
    { name: 'icon_128x128@2x',  px: 256 },
    { name: 'icon_256x256',     px: 256 },
    { name: 'icon_256x256@2x',  px: 512 },
    { name: 'icon_512x512',     px: 512 },
    { name: 'icon_512x512@2x',  px: 1024},
  ]

  for (const { name, px } of sizes) {
    renderPng(path.join(ICONSET, `${name}.png`), px)
  }

  const OUT = path.join(ROOT, 'build', 'icon.icns')
  run(`iconutil -c icns "${ICONSET}" -o "${OUT}"`)
  console.log('✓ Created', OUT)
}

// ── Windows .ico ──────────────────────────────────────────────────────────────
// .ico = concatenated ICONDIRENTRY structs + raw PNG blobs (modern Windows accepts PNG-in-ICO)

async function buildIco() {
  const icoSizes = [16, 32, 48, 64, 128, 256]
  const pngBuffers = []

  for (const size of icoSizes) {
    const tmp = path.join(ROOT, 'build', `_tmp_${size}.png`)
    renderPng(tmp, size)
    const { readFileSync } = await import('fs')
    pngBuffers.push({ size, data: readFileSync(tmp) })
    rmSync(tmp)
  }

  // Build ICO binary manually (PNG-in-ICO format, Windows Vista+)
  const count = pngBuffers.length
  const headerSize = 6 + count * 16
  let offset = headerSize

  // ICONDIR header
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)     // reserved
  header.writeUInt16LE(1, 2)     // type: 1 = ico
  header.writeUInt16LE(count, 4)

  const entries = []
  for (const { size, data } of pngBuffers) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)   // width (0 = 256 for ico)
    e.writeUInt8(size >= 256 ? 0 : size, 1)   // height
    e.writeUInt8(0, 2)  // color count
    e.writeUInt8(0, 3)  // reserved
    e.writeUInt16LE(1, 4)  // planes
    e.writeUInt16LE(32, 6) // bit count
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push({ entry: e, data })
  }

  const chunks = [header, ...entries.map(e => e.entry), ...entries.map(e => e.data)]
  const OUT = path.join(ROOT, 'build', 'icon.ico')
  writeFileSync(OUT, Buffer.concat(chunks))
  console.log('✓ Created', OUT)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Building icons from', SVG)
  buildIcns()
  await buildIco()
  console.log('\nDone! Now run: npm run electron:build')
}

main().catch(e => { console.error(e.message); process.exit(1) })
