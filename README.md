# Codespace

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
Import graph colored by fan-in (how many other files import this file). Red = highly depended-on, blue = rarely used.

- Hover a node → shows fan-in, fan-out, file type, and full importer/import lists (up to 10 each)
- Click a node → focus on its direct import neighborhood

### Change Impact Map
"If I change this file, what breaks?" Click a file to highlight the full reverse-import chain via BFS. Click a directory to highlight all files it contains.

- Hover a node → shows importer/import counts and lists
- Red nodes = orphan files (fan-in = 0, nothing imports them)
- Two selection modes indicated in the legend: file impact chain vs. directory contents

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
    DependencyHeatmap.jsx
    ChangeImpactMap.jsx
    NodeSearchBar.jsx
  lib/
    graph-colors.js        # Node colors by file extension
    graph-layout.js        # Radial tree layout
    heatmap-colors.js      # Fan-in heat scale
    i18n.js                # EN / FI / SV translations
vite-plugin-filemap.js     # Dev-server API (fs walk + ts-morph parsing)
```

