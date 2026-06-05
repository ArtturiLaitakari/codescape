# Codespace — Runtime Heatmap Suunnitelma

## Tavoite

Uusi kolmas välilehti **"Runtime Heatmap"** joka värikoodaa tiedostot runtime-kustannuspisteillä.  
Kuuma tiedosto = paljon DB-kutsuja, API-kutsuja tai korkea syklomaattinen monimutkaisuus.

**Pisteytysfunktio:**
```
runtimeScore = dbCallCount × 3 + apiCallCount × 2 + cyclomatic × 0.5
```

Kaksi virtuaalisolmua (`__db__` ja `__api__`) näkyvät radiaalisessa puussa `__root__`-lapsilta. Tiedostot jotka kutsuvat tietokantaa tai ulkoista API:a saavat kaaren kyseiseen virtuaalisolmuun.

---

## Vaihe 1 — Backend (`vite-plugin-filemap.js`)

### 1. `detectRuntimeCalls(sourceFile)` — uusi apufunktio

Analysoi yhden ts-morph `SourceFile`-objektin AST:n. Palauttaa:

```js
{ dbCallCount, apiCallCount, cyclomatic }
```

**DB-tunnistus** — import declaration check:
- `pg`, `mysql`, `mysql2`, `sqlite3`, `better-sqlite3`
- `knex`, `sequelize`, `mongoose`
- `@prisma/client`, `typeorm`, `drizzle-orm`

**API-tunnistus** — import declaration check:
- `axios`, `ky`, `node-fetch`, `got`, `superagent`, `undici`
- `node:http`, `node:https` (+ `.request(` metodikutsu)
- Built-in `fetch` — CallExpression jonka callee on `fetch` (ei importtia tarvita)

**Syklomaattisuus** — `getDescendantsOfKind()` laskee:
`IfStatement`, `ConditionalExpression`, `ForStatement`, `ForInStatement`,
`ForOfStatement`, `WhileStatement`, `DoStatement`, `CatchClause`, `CaseClause`

### 2. `buildRuntimeGraph(rootDir)` — uusi async funktio

Sama chunked-rakenne kuin `buildDepGraph`. Vaiheet:

1. Kerää kaikki JS/TS-tiedostot (sama `dirStack`-logiikka)
2. Lisää ts-morph projektin `CHUNK`-erissä
3. Aja `detectRuntimeCalls` jokaiselle lähdetiedostolle
4. Laske `runtimeScore = dbCallCount * 3 + apiCallCount * 2 + cyclomatic * 0.5`
5. Rakenna puu `walkDir()`-kutsulla
6. Lisää virtuaalisolmut puuhun:
   - `{ key: '__db__', attributes: { label: 'Database', kind: 'virtual-db', depth: 1 } }`
   - `{ key: '__api__', attributes: { label: 'External API', kind: 'virtual-api', depth: 1 } }`
7. Lisää treeEdges: `__root__ → __db__` ja `__root__ → __api__`
8. Laske `dbCallerCount` ja `apiCallerCount` (virtuaalisolmujen tooltip-dataksi)
9. Rakenna `runtimeEdges`:
   - `tiedosto → __db__` jos `dbCallCount > 0`
   - `tiedosto → __api__` jos `apiCallCount > 0`

Palauttaa:
```js
{ nodes, treeEdges, runtimeEdges }
// nodes: kaikki puu-solmut + virtuaalisolmut
// tiedostot saavat: runtimeScore, dbCallCount, apiCallCount, cyclomatic
// virtuaalisolmut saavat: dbCallerCount / apiCallerCount
```

### 3. `/api/runtimegraph` — uusi endpoint

Sama rakenne kuin `/api/depgraph`:
- Lukee `?path=` parametrin, validoi `validatePath()`
- Kutsuu `await buildRuntimeGraph(target)`
- Palauttaa JSON

---

## Vaihe 2 — Uusi värikirjasto (`src/lib/runtime-colors.js`)

```
RUNTIME_STOPS:
  0.00 → #22c55e  (vihreä — ei kuormaa)
  0.30 → #a3e635  (lime)
  0.60 → #eab308  (keltainen)
  0.85 → #f97316  (oranssi)
  1.00 → #ef4444  (punainen — korkea kuorma)
```

Exportit:
- `runtimeColor(score, maxScore)` — normalisoi + lerp STOPS-taulukon läpi
- `runtimeSize(score, base=6)` → `base + Math.log1p(score) * 2`
- `RUNTIME_LEGEND_STOPS` — gradientin renderöintiä varten
- `VIRTUAL_DB_COLOR = '#06b6d4'`  (syaani)
- `VIRTUAL_API_COLOR = '#a855f7'` (violetti)
- `VIRTUAL_NODE_SIZE = 22`

---

## Vaihe 3 — Uusi komponentti (`src/components/RuntimeHeatmap.jsx`)

Mallina `DependencyHeatmap.jsx` — sama rakenne, eri data ja väritys.

**Data-flow:**
1. Hae `/api/runtimegraph?path=...` → `{ root, nodes, treeEdges, runtimeEdges }`
2. Laske `maxScore` tiedostosolmuista
3. Mappaa solmut ennen `load()`:
   - `kind === 'file'` → `runtimeColor(score, maxScore)` + `runtimeSize(score)`
   - `kind === 'virtual-db'` → `VIRTUAL_DB_COLOR` + `VIRTUAL_NODE_SIZE`
   - `kind === 'virtual-api'` → `VIRTUAL_API_COLOR` + `VIRTUAL_NODE_SIZE`
   - `kind === 'dir'` / `'root'` → `nodeColor(attrs)` + `nodeSize(attrs)` (ennallaan)
4. `load(nodes, body.treeEdges, '__root__', body.runtimeEdges)`
   — runtimeEdges menevät `extraEdges`-parametrina, sama kuin importEdges heatmapissa

**Hover-tooltip tiedostoille:**
```
src/components/App.jsx
──────────────────────
Runtime score:   12.5
DB calls:        2
API calls:       1
Cyclomatic:      8
```

**Hover-tooltip virtuaalisolmuille:**
```
Database
──────────
5 tiedostoa kutsuu tätä
```

**Legenda:**
- Gradienttipalkki vihreästä punaiseen (RUNTIME_LEGEND_STOPS)
- Kaksi väripistettä: ● syaani = Database, ● violetti = External API

**Ei impact-zone BFS-logiikkaa** — klikkausta ei tarvita, tieto näkyy heti värissä.

---

## Vaihe 4 — Muokkaukset olemassa oleviin tiedostoihin

### `src/lib/i18n.js`

Lisää kaikille kolmelle kielelle (fi/en/sv):

| Avain | fi | en | sv |
|---|---|---|---|
| `tab_runtime` | Runtime-kartta | Runtime Map | Runtime-karta |
| `nodes_runtime` | `{count} solmua · runtime-lämpö` | `{count} nodes · runtime heat` | `{count} noder · runtime-värme` |
| `db_calls` | DB-kutsut | DB calls | DB-anrop |
| `api_calls` | API-kutsut | API calls | API-anrop |
| `cyclomatic` | Haarautumia | Branches | Förgreningar |
| `runtime_score` | Runtime-pisteet | Runtime score | Runtime-poäng |
| `subtitle_runtime` | Runtime-kartta | Runtime Map | Runtime-karta |

### `src/App.jsx`

- Lisää `{ id: 'runtime', labelKey: 'tab_runtime' }` VIEWS-taulukkoon
- Lisää `import RuntimeHeatmap from './components/RuntimeHeatmap.jsx'`
- Lisää renderöinti: `{activeView === 'runtime' && <RuntimeHeatmap sharedRoot={sharedRoot} onRootChange={setSharedRoot} lang={lang} />}`

---

## Muutettavat tiedostot

| Tiedosto | Muutos |
|---|---|
| `vite-plugin-filemap.js` | `detectRuntimeCalls`, `buildRuntimeGraph`, `/api/runtimegraph` endpoint |
| `src/App.jsx` | 3. välilehti + RuntimeHeatmap-renderöinti |
| `src/lib/i18n.js` | Uudet käännösavaimet |
| `src/lib/runtime-colors.js` | **Uusi tiedosto** |
| `src/components/RuntimeHeatmap.jsx` | **Uusi tiedosto** |

---

## Hook-yhteensopivuus (3D-migraatio)

RuntimeHeatmap käyttää samaa `useSigmaGraph`-hook-APIa (`load`, `focusNode`, `setFilter`, `getNodes`) kuin muutkin näkymät. Kun 3D-migraatio (`3dPlan.md`) toteutetaan, RuntimeHeatmap voidaan vaihtaa käyttämään `useForceGraph3D`-hookia ilman komponenttimuutoksia.

---

## Verifiointi

1. `npm run dev` — kolmen välilehden asettelu renderöityy virheittä
2. Avaa projekti jossa `axios` tai `@prisma/client` — tiedostot värjäytyvät oranssiksi/punaiseksi
3. Avaa puhdas projekti (ei DB/API) — väritys perustuu pelkkään syklomaattisuuteen
4. Hover kuumalle tiedostolle — tooltip näyttää kaikki 4 metriikkaa oikein
5. `__db__` ja `__api__` näkyvät suurina syaani/violetti-solmuina radiaalisessa puussa
6. Hover virtuaalisolmulle — näyttää kutsujavien tiedostojen oikean määrän
7. Vaihda kieltä — kaikki runtime-tekstit päivittyvät

---

## Päätökset

- Virtuaalisolmut ovat `__root__`-lapsia puuhierarkiassa — radiaalinen layout sijoittaa ne automaattisesti
- DB- ja API-kaarien väri sama (ei erottelua), samoin kuin importEdgesillä
- `dbCallCount` = importtien määrä per tiedosto — yksinkertaisin ja luotettavin indikaattori
- Impact-zone BFS-logiikkaa ei lisätä — tieto näkyy suoraan värissä
- `ChangeImpactMap` (jo koodattu) tulee 4. välilehdeksi 3D-migraation yhteydessä
