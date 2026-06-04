# Koodikartta

Interaktiivinen, monitasoinen visualisointityökalu koodikannan rakenteen, riippuvuuksien ja evoluution ymmärtämiseen. Tavoitteena tuoda "Google Maps" -tyyppinen kokemus lähdekoodin tutkimiseen — yksi graafi, useita näkymiä, zoomattava mistä tahansa kulmasta.

---

## 🎯 Vision

Suuri koodikanta on musta laatikko. Tiedostolista ei kerro mistä asiat alkavat, mihin ne johtavat, kuka omistaa ne tai mikä hajoaa kun jotain muutetaan. **Koodikartta** avaa tämän laatikon näyttämällä koodin **eläväksi graafiksi**, jota voi tarkastella eri linsseillä.

Käyttäjä voi:

- Hahmottaa repon rakenteen sekunneissa.
- Nähdä missä kompleksisuus kasaantuu.
- Ennakoida muutoksen vaikutusalueen ennen kuin koskee koodiin.
- Tunnistaa arkkitehtuuririkkomukset automaattisesti.
- Selvittää kuka tietää mistäkin osasta.

---

## 🗺️ Näkymät (Layers)

Sama graafi, eri värjäys ja painotus. Käyttäjä vaihtaa näkymää lennossa.

### 0. File Map — hakemistorakenne mind map -tyyliin
Lähtönäkymä. Kansiot ja tiedostot puuna / radial-layoutina. Tarkoitus: orientaatio.
- Node = tiedosto tai kansio
- Koko = LOC tai tiedostokoko
- Klusterointi = hakemistorakenne

### 1. Dependency Heatmap — riippuvuuksien lämpökartta
Mitkä modulit ovat keskeisiä, mitkä kytkeytyneet liian tiukasti?
- Iso node = paljon käytetty (korkea fan-in)
- Punainen = korkea coupling (fan-in + fan-out)
- Edge paksuus = importtien määrä

### 2. Change Impact Map — muutoksen vaikutusalue
"Jos muutan tätä → mitä hajoaa?" Valitse node, näe transitiivinen sulkeuma.
- Korostaa kaikki riippuvaiset (suora + epäsuora)
- Värjäys etäisyyden mukaan (1-hop, 2-hop, ...)
- Hyödyllinen refaktorointiin ja PR-arvioon

### 3. Ownership Map — omistajuus git-historian pohjalta
Kuka koskee mihinkin? Bus factor -analyysiä varten.
- Värjäys = pääasiallinen committaaja
- Saturaatio = kuinka yksinomistettu tiedosto on
- Paljastaa siiloutumiset ja knowledge-risk-alueet

### 4. Layer Violation Detection — kerrosrikkomukset
Käyttäjä määrittää sallitut kerrokset (esim. `ui → service → repository → db`). Työkalu korostaa rikkomukset.
- Vihreä edge = sallittu suunta
- Punainen edge = rikkomus (esim. `ui → db`)
- Konfiguroidaan `coderoutes.config.json` -tiedostolla

### Tulevia näkymiä (backlog)
- **Hotspot Map** — muutostiheys × kompleksisuus (Code-as-a-Crime-Scene-tyyli)
- **Test Coverage Map** — kattavuusprosentti node-värinä
- **Type Flow** — tyyppien leviäminen funktioiden läpi
- **Dead Code Map** — tavoittamattomat nodet

---

## 🛠️ Tekninen stack

| Kerros | Valinta | Peruste |
|---|---|---|
| Parsing | [`ts-morph`](https://github.com/dsherret/ts-morph) | TypeScript AST korkealla tasolla, importit ja symbolit ilmaiseksi |
| Graafimalli | [`graphology`](https://graphology.github.io/) | Headless graafi, runsas algoritmikirjasto (centrality, community detection) |
| Renderöinti (2D, ensisijainen) | [`sigma.js`](https://www.sigmajs.org/) tai [`cytoscape.js`](https://js.cytoscape.org/) | 2D riittää useimpiin näkymiin, parempi luettavuus ja suorituskyky. Valinta tehdään prototyypin perusteella. |
| Renderöinti (3D, valinnainen) | [`3d-force-graph`](https://github.com/vasturiano/3d-force-graph) | Vain isoille graafeille / "wow"-näkymälle, jos 2D ahtautuu |
| Build / dev | Vite + React | Workspace on jo Vite/React-pohjainen |
| Git-data | `simple-git` tai raaka `git log --numstat` | Ownership- ja hotspot-näkymiin |

### 2D-renderöijän valinta: Sigma vs. Cytoscape

Kumpikin sopii — päätös tehdään MVP-prototyypin jälkeen. Pikavertailu:

| | **Sigma.js** | **Cytoscape.js** |
|---|---|---|
| Renderöinti | WebGL | Canvas (WebGL-extension olemassa) |
| Vahvuus | Suorituskyky isoilla graafeilla (10k+ nodea) | Rikas API, valmiit layoutit ja algoritmit |
| Integraatio `graphology` | Natiivi, samat tekijät | Oma graafimalli — vaatii adapterin |
| Layoutit | ForceAtlas2, circular | cose-bilkent, dagre, klay, grid, breadthfirst, ... |
| Tyylittely | Custom-rendererit | CSS-tyyppinen selector-syntaksi |
| Parhaiten | Heatmap, dependency-näkymät massagraafeissa | File Map (hierarkkinen), Layer Violation (suunnatut layoutit) |

**Suositus:** aloita **Sigma.js**:llä, koska se istuu suoraan `graphology`-malliin ja MVP-näkymät (File Map, Heatmap) ovat painotuksia samasta graafista. Cytoscape mukaan, jos hierarkkiset / suunnatut layoutit (esim. Layer Violation) tarvitsevat enemmän kuin force-pohjaisen sijoittelun.

### Rinnakkaisia harkittavia
- **Madge** — nopea import-graafin extraktio (vertailukohta `ts-morph`-pohjalle)
- **D3.js** — radial / treemap-näkymät File Mapille
- **React Flow** — jos halutaan editoitava / interaktiivinen node-pohjainen UI

---

## 🏗️ Arkkitehtuuri (luonnos)

```
   ┌────────┐  ┌──────────┐  ┌─────────┐
   │ Parser │  │ Git scan │  │ Config  │
   │ts-morph│  │simple-git│  │ loader  │
   └────┬───┘  └────┬─────┘  └────┬────┘
        └───────────┼─────────────┘
                    ▼
          ┌──────────────────┐
          │  Graph builder   │  ← graphology
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │  Layer pipelines │  ← Graph → StyledGraph
          │ heatmap / impact │
          │ ownership / ...  │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │  React UI        │  ← 3d-force-graph
          └──────────────────┘
```

Vaiheet:
1. **Scan** — `ts-morph` kävelee lähdetiedostot, kerää nodet (file/symbol) ja edget (import/call).
2. **Enrich** — git-historia, LOC ja kompleksisuusmetriikat liitetään nodeihin.
3. **Layer compute** — kukin näkymä on puhdas funktio `Graph → StyledGraph` (värit, koot, korostukset).
4. **Render** — React-komponentti käärii `3d-force-graph`-instanssin ja layer-vaihtimen.

---

## 🚀 Roadmap

**MVP (v0.1)**
- [ ] File Map -näkymä JS/TS-projektille
- [ ] Dependency Heatmap importtien pohjalta
- [ ] Layer-vaihdin ja node-haku

**v0.2**
- [ ] Change Impact Map (klikkaa node → korosta vaikutusalue)
- [ ] Ownership Map git-historiasta

**v0.3**
- [ ] Layer Violation Detection + config-tiedosto
- [ ] Export PNG / JSON

**Myöhemmin**
- [ ] Monorepo-tuki (workspaces)
- [ ] Muiden kielten tuki (Python via tree-sitter, Go)
- [ ] Diff-näkymä kahden commitin välillä
- [ ] VS Code -laajennus

---

## 🎨 UX-periaatteet

- **Yksi graafi, monta linssiä.** Näkymän vaihto = painotuksen vaihto, ei datan uudelleenlatausta.
- **Ei seinää tekstiä.** Detaljit avautuvat hoverissa / klikatessa.
- **Zoom-tasot.** Repotaso → moduulitaso → tiedostotaso → symbolitaso.
- **Aina vastaus alle 2 s.** Renderöintibudjetti määrittää, mitä lasketaan etukäteen vs. lennossa.

## Koodi periaatteet

* Funktiot ja parametrit suomeksi

---

## 📐 Avoimet kysymykset

- Skaalautuminen yli 10k tiedoston repoissa — tarvitaanko level-of-detail / progressive loading?
- Onko 3D oikeasti hyödyllinen vai onko 2D selkeämpi? Tarjotaanko molemmat?
- Pitäisikö graafi laskea taustalla (worker) ja striimata UI:hin?
- Miten käsitellä dynaamiset importit ja string-pohjaiset reitit (esim. Next.js)?

