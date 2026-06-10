# Codescape

An interactive codebase visualizer. Point it at any JS/TS project and explore its structure and dependencies as a live graph.

---

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173, enter an absolute path to a JS/TS project, and load.

---

## Views

### File Map
Radial tree of the directory structure. Every file and folder is a node; edges represent the parent–child relationship. Color = file type, size = directory depth.

- Hover a node → shows label, kind, and path
- Click a node → focus: dim everything not connected to it
- Search bar → dim non-matching nodes in-graph (no dropdown)

### Dependency Heatmap
Import graph colored by fan-in (how many other files import this file). Directories are green; cold files are dark blue; hot files are red/amber.

Two modes in one view:

**Idle (no selection)** — fan-in heat coloring across the whole graph
- Hover a node → shows fan-in, fan-out, file type, and full importer/import lists (up to 10 each)

**Click a file** → BFS reverse-import chain: which files would be affected if this file changes
- Depth 0 = the clicked file (gold), depth 1 = direct importers (orange), depth 2+ fade to pale yellow
- Header shows `filename → N files affected`

**Click a directory** → BFS forward-tree: all files contained in the directory
- Legend switches to show folder-contents depth coloring

Click the same node again or click the background to reset.

---

## Features

- **In-graph search** — type to dim non-matching nodes; press Escape or click any node to clear
- **Click-to-focus** — click a node to dim everything unrelated; click stage to reset
- **Language switcher** — EN / FI / SV flag menu (top-right)
- **Path input** — load any absolute directory path without restarting the dev server
- **Shared path state** — switching between tabs keeps the loaded project path

---

## Stack

| Layer | Library |
|-------|---------|
| Import parsing | [`ts-morph`](https://github.com/dsherret/ts-morph) |
| Graph model | [`graphology`](https://graphology.github.io/) |
| 2D rendering | [`sigma.js`](https://www.sigmajs.org/) (WebGL) |
| UI | React 19 + Vite |
| Dev-server API | Vite plugin middleware (`vite-plugin-filemap.js`) |

The Vite plugin exposes two endpoints:
- `GET /api/filemap?path=…` — directory tree (nodes + edges)
- `GET /api/depgraph?path=…` — JS/TS import graph (tree edges + import edges + fan-in/out counts)

---

## Project structure

```
src/
  App.jsx                  # Root — tabs, lang state, path state
  hooks/
    useSigmaGraph.js       # Sigma lifecycle, focus, search filter
  components/
    FileMap.jsx
    DependencyHeatmap.jsx  # Heatmap + click-for-impact (combined view)
    NodeSearchBar.jsx
  lib/
    graph-colors.js        # Node colors by file extension
    graph-layout.js        # Radial tree layout
    heatmap-colors.js      # Fan-in heat scale
    i18n.js                # EN / FI / SV translations
vite-plugin-filemap.js     # Dev-server API (fs walk + ts-morph parsing)
```

