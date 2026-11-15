# Magic Map

Interactive climate-analog decision-support tool built for the **NASA Space Apps Challenge — Field Shift: Adapting Farms with NASA Data**.

**Magic Map** helps farmers explore observed crop-rotation alternatives by matching a selected U.S. field against distant fields (100+ km away) with similar soil and either **Today’s climate (2001–2025)** or **Near-future climate (2035–2050, SSP2-4.5)**.

---

## Key Features

- **Field Selection (`Toolbar` & Map):** Search any U.S. town, address, or `lat, lon` coordinates, zoom in (`zoom ≥ 12`) to click real field polygons from the **USDA NASS Crop Sequence Boundaries (CSB 2024)** FeatureServer, or click pre-sampled fields directly. Searches and clicks link to the nearest pre-sampled field in the same `0.5° × 0.625°` NASA POWER climate cell (or the nearest overall sample with a lower-reliability warning if none exists in that cell, plus a >10 km prototype notice).
- **Soil & Climate Matching Engine:** Computes weighted similarity in the browser across soil/terrain attributes (55%, USDA SSURGO) and climate/stress indicators (45%, NASA POWER). Growing constraints (large drainage differences, pH gap > 1.0, flooding/bedrock/salinity mismatches) are surfaced as separate warnings rather than hidden inside a single score.
- **Near-Future Climate Analog Mode (2035–2050):** Applies cell-level monthly temperature deltas (`ΔT`) and precipitation ratios (`r_P`) from a 3-GCM **NASA NEX-GDDP-CMIP6 (`SSP2-4.5`)** ensemble median (`2035–2050` vs `2001–2025`) to daily NASA POWER series via the Delta Method, identifying distant farms whose current climate matches the selected field's projected near-future conditions.
- **Side-by-Side Comparison (`Land Info`, `Rotation options`, `Comparison`):** Compares the field's current 8-year rotation with up to two common rotations observed on distant soil-climate analogs, showing cross-mode prevalence (Today vs. Near-future), legume/fallow/perennial/double-crop metrics, item-by-item score bars, general agronomy notes, and local verification prompts.

---

## Repository Structure

- `frontend/` — React + TypeScript + MapLibre GL client-side web application and static field dataset (`public/data/`).
- `builder/` — Offline Python data pipeline scripts (`step1_sample_csb.py`, `step2_fetch_remote.py`, `step2b_fetch_nexgddp.py`, `step3_build_table.py`) that sample U.S. fields and precompute the static browser table.
- `calc/` — Independent Python reference calculator and cross-check suite verifying parity with the frontend engine.

---

## Running Locally

### Frontend

```bash
cd frontend
npm install
npm run dev
```

To test and build for GitHub Pages (`Soil-twin` repository subpath):

```bash
cd frontend
npm test
npm run lint
BASE_PATH=/Soil-twin/ npm run build
```

---

## Data Sources & Attribution

### NASA Datasets
- **NASA POWER (Prediction Of Worldwide Energy Resources)** — Agroclimatology Daily Point API (`https://power.larc.nasa.gov/`), `2001–2025` daily `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, and `GWETROOT` (`0.5° × 0.625°` grid). Open U.S. Government / NASA dataset.
- **NASA NEX-GDDP-CMIP6 (NASA Earth Exchange Global Daily Downscaled Projections)** — Scenario `SSP2-4.5` (`r1i1p1f1`), 3-GCM ensemble median (`ACCESS-CM2`, `GFDL-ESM4`, `MPI-ESM1-2-HR`), variables `tas` and `pr`, baseline `2001–2025` vs. near-future `2035–2050` monthly deltas (via NASA NCCS THREDDS / AWS Open Data). License: **CC0 1.0 Public Domain Dedication**.

### USDA, Map Basemap & Geocoding Data
- **USDA NRCS SSURGO** — Soil Data Access tabular API (`https://sdmdataaccess.sc.egov.usda.gov/tabular/post.rest`). Public domain U.S. Government dataset.
- **USDA NASS Crop Sequence Boundaries (CSB)** — `NationalCSB_2018-2025_rev23` (pre-sampled crops/boundaries) and **CSB 2024** ArcGIS FeatureServer (`https://pdi.scinet.usda.gov/`). Public domain U.S. Government dataset.
- **USDA NASS Cropland Data Layer (CDL)** — Crop classification codes and names. Public domain U.S. Government dataset.
- **OpenStreetMap & Nominatim** — Standard raster basemap tiles (`https://tile.openstreetmap.org/`) and geocoding (`https://nominatim.openstreetmap.org/`), © OpenStreetMap contributors.
- **USGS The National Map (`USGSImageryOnly`)** — High-zoom orthoimagery basemap tiles (`https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`), U.S. Geological Survey. Public domain U.S. Government dataset.

---

## Open-Source Libraries

- **React & ReactDOM** (`19.3.1`) — MIT License
- **MapLibre GL JS** (`6.16.0`) — BSD-3-Clause License
- **Vite** (`8.3.8`) — MIT License
- **Python builder packages:** NumPy, Pyogrio, PyProj, Shapely (see respective upstream OSI-approved licenses)

---

## Limitations & Responsible Use

- **Initial Heuristic Parameters:** Similarity weights and selection thresholds (overall ≥ 80, soil ≥ 65, minimum distance ≥ 100 km, near-future climate gate ≥ 85, cap 10 per climate cell, top 30 overall) are initial design values, not empirically calibrated yield predictors.
- **No Yield, Profit, or Market Data:** Datasets do not include yield, revenue, equipment, irrigation capacity, pest pressure, or local market viability. Always review options locally with farmers and agronomists.
- **Pre-Sampled Prototype Linkage:** Clicking a live CSB polygon or searching a location links to the nearest pre-sampled field rather than querying soil live. When linked beyond 10 km, local soil conditions at your field may differ.
- **Near-Future Analog Projection:** Near-future values reflect historical NASA POWER observations adjusted by regional monthly deltas from 3 NEX-GDDP-CMIP6 models (`SSP2-4.5`), intended for analog exploration rather than deterministic farm forecasting.

---

## Use of Super Intelligence (AI) Disclosure

Problem framing, challenge alignment, system architecture, data-source selection, and UX/domain decisions were led by the team. **All application source code, data-pipeline scripts, and documentation drafts in this repository were implemented with the assistance of AI coding tools (Claude and Gemini/Antigravity)** and reviewed by the team. No NASA logos, flags, or mission identifiers were generated or used.

---

## License

Unless otherwise noted for third-party data and open-source dependencies listed above, original project code and documentation are made available under the **Apache License 2.0** (matching NASA Space Apps Challenge terms).
