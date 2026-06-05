# Codespace — 3D Migraatiosuunnitelma

## Kirjasto

**`3d-force-graph`** + **`three`**

```bash
npm install 3d-force-graph three
npm uninstall sigma @sigma/graph-layouts
```

Orbit controls (pyöritys, zoom, pan) sisäänrakennettu. Ei lisäkonfiguraatiota.

---

## Mikä säilyy / mikä poistuu

| Poistetaan | Säilytetään |
|------------|-------------|
| `sigma`, `@sigma/graph-layouts` | `graphology` (datamalli) |
| `src/hooks/useSigmaGraph.js` | `vite-plugin-filemap.js` — API muuttumaton |
| `src/lib/graph-layout.js` (radialTree) | `src/lib/graph-colors.js` |
| nodeReducer / edgeReducer pattern | `src/lib/heatmap-colors.js` |
| `NodeSearchBar` filterRef/sigma.refresh() | `src/lib/i18n.js` |
| | Kaikki 3 view-komponentti (rakenne säilyy) |

---

## Vaihe 1 — `useForceGraph3D` hook

Kirjoitetaan `src/hooks/useForceGraph3D.js` korvaamaan `useSigmaGraph.js`.

Sama ulkoinen API:
```js
const { load, focusNode, setFilter, getNodes } = useForceGraph3D(containerRef, {
  onClickNode, onEnterNode, onLeaveNode, onReady, onClearFocus
})
```

Sisäisesti:
- `ForceGraph3D(containerRef.current)` — luo WebGL canvas
- `.graphData({ nodes, links })` — nodes: `{ id, label, kind, ext, depth, color, ... }`, links: `{ source, target }`
- `.nodeColor(n => n.color)` — suoraan `graph-colors.js` / `heatmap-colors.js`
- `.nodeVal(n => n.size)` — node-koko
- `.onNodeClick(node => ...)` — suora mapping `onClickNode`
- `.onNodeHover(node => ...)` — suora mapping `onEnterNode` / `onLeaveNode`
- `filterRef` — `Set<id> | null`, `.nodeOpacity()` callback tarkistaa sen automaattisesti per frame
- `focusNode` — `graph.cameraPosition({ x, y, z }, node, 600)` smooth zoom nodeen

---

## Vaihe 2 — Layout-strategia per näkymä

### FileMap (hakemistopuu)
**Depth-pinned** — säilyttää hierarkian z-akselilla:
```js
nodes.forEach(n => {
  n.fz = n.depth * -200   // z = syvyys, root edessä
  // x/y vapaa force-simulaatiolle
})
graph.d3Force('z', forceZ(n => n.fz).strength(1))
```
Root on lähimpänä kameraa, syvimmät tiedostot kaukana — puumainen näkymä ilman manuaalista layouttia.

### DependencyHeatmap
**Force-directed vapaa** — simulaatio klusteroi automaattisesti importtien mukaan. Korkean fan-in -tiedostot ajautuvat keskelle luonnostaan.

### ChangeImpactMap
**Force-directed vapaa** — click-to-impact logiikka pysyy samana (BFS reverseAdjRef), vain fokusoidut nodet korostetaan.

---

## Vaihe 3 — Tooltip-positiointi 3D:ssä

`onNodeHover` antaa node-objektin suoraan. Screen-koordinaatit:
```js
// 3d-force-graph kutsuu onNodeHover(node, prevNode)
// node sisältää { x, y, z } — world coords
// Projektointi screen coordseiksi:
const vec = new THREE.Vector3(node.x, node.y, node.z)
vec.project(graph.camera())
const sx = (vec.x + 1) / 2 * width
const sy = (-vec.y + 1) / 2 * height
setHovered({ ...node, sx, sy })
```
Tooltip renderöidään React-diviin `position: absolute, left: sx, top: sy` — sama rakenne kuin nyt.

---

## Vaihe 4 — Search / filter

`filterRef`-pattern toimii identtisesti:
- `setFilter(matchedIds: Set<string> | null)`
- `.nodeOpacity(n => filterRef.current ? (filterRef.current.has(n.id) ? 1 : 0.08) : 1)`
- `.linkOpacity(l => filterRef.current ? ... : 0.3)`

`NodeSearchBar.jsx` muuttuu vain: `sigma.refresh()` → `graph.refresh()` (tai poistuu kokonaan — opacity-callbackit ajetaan per frame automaattisesti).

---

## Vaihe 5 — Suoritettava järjestys

```
1.  npm install 3d-force-graph three
2.  npm uninstall sigma @sigma/graph-layouts
3.  Kirjoita src/hooks/useForceGraph3D.js
4.  Tee FileMap.jsx käyttämään uutta hookia — testaa:
      - Graafi latautuu
      - Orbit controls toimii (pyöritys / zoom / pan)
      - Node-klikkaus ja focus
      - Search/filter (dimming)
      - Tooltip
5.  Kopioi pattern → DependencyHeatmap.jsx
6.  Kopioi pattern → ChangeImpactMap.jsx
7.  Poista src/hooks/useSigmaGraph.js ja src/lib/graph-layout.js
8.  Poista sigma-importit package.json:sta
```

---

## Työmääräarvio

| Työ | Arvio |
|-----|-------|
| `useForceGraph3D` hook | ~3h |
| FileMap 3D (pilotti) | ~3h |
| DependencyHeatmap + ChangeImpactMap | ~2h |
| Tooltip screen-projektointi | ~1h |
| Siivous + testaus | ~1h |
| **Yhteensä** | **~10h** |

Suurin työ on hook-rewrite. Komponenttien rakenne, data-API, värit ja i18n pysyvät ennallaan — muutos on pienempi kuin miltä se näyttää.
