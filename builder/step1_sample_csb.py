import json
import os
import random
import time
from collections import Counter, defaultdict

import numpy as np
import pyogrio.raw
import pyproj
import shapely
from shapely.ops import transform

from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE / "source"  # 원천 원본 (git 제외)
RAW_DIR = HERE / "raw"  # 원천 응답 저장 (git 제외)
PUBLIC_DIR = HERE.parent / "frontend" / "public" / "data"  # 앱이 읽는 결과

GDB_PATH = str(SOURCE_DIR / "CSB1825.gdb")
OUT_DIR = str(RAW_DIR)
OUT_CSB = os.path.join(OUT_DIR, "raw_csb_sample.json")
OUT_CROPS = os.path.join(OUT_DIR, "crops.json")

# FIPS State code -> 2-letter postal abbreviation (CONUS)
FIPS_TO_STATE = {
    "01": "AL", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    "10": "DE", "12": "FL", "13": "GA", "16": "ID", "17": "IL", "18": "IN",
    "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
    "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
    "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY",
    "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA",
    "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
}

# Official USDA CDL crop names (cultivated crops + fallow/hay, excluding forest/urban/water/barren/shrub/grassland)
CDL_CROPS = {
    1: "Corn",
    2: "Cotton",
    3: "Rice",
    4: "Sorghum",
    5: "Soybeans",
    6: "Sunflower",
    10: "Peanuts",
    11: "Tobacco",
    12: "Sweet Corn",
    13: "Pop or Orn Corn",
    14: "Mint",
    21: "Barley",
    22: "Durum Wheat",
    23: "Spring Wheat",
    24: "Winter Wheat",
    25: "Other Small Grains",
    26: "Dbl Crop WinWht/Soybeans",
    27: "Rye",
    28: "Oats",
    29: "Millet",
    30: "Speltz",
    31: "Canola",
    32: "Flaxseed",
    33: "Safflower",
    34: "Rape Seed",
    35: "Mustard",
    36: "Alfalfa",
    37: "Other Hay/Non Alfalfa",
    38: "Camelina",
    39: "Buckwheat",
    41: "Sugarbeets",
    42: "Dry Beans",
    43: "Potatoes",
    44: "Other Crops",
    45: "Sugarcane",
    46: "Sweet Potatoes",
    47: "Misc Vegs & Fruits",
    48: "Watermelons",
    49: "Onions",
    50: "Cucumbers",
    51: "Chick Peas",
    52: "Lentils",
    53: "Peas",
    54: "Tomatoes",
    55: "Caneberries",
    56: "Hops",
    57: "Herbs",
    58: "Clover/Wildflowers",
    59: "Sod/Grass Seed",
    60: "Switchgrass",
    61: "Fallow/Idle Cropland",
    66: "Cherries",
    67: "Peaches",
    68: "Apples",
    69: "Grapes",
    71: "Other Tree Crops",
    72: "Citrus",
    74: "Pecans",
    75: "Almonds",
    76: "Walnuts",
    77: "Pears",
    204: "Pistachios",
    205: "Triticale",
    206: "Carrots",
    207: "Asparagus",
    208: "Garlic",
    209: "Cantaloupes",
    211: "Olives",
    212: "Oranges",
    214: "Broccoli",
    216: "Peppers",
    219: "Greens",
    220: "Plums",
    221: "Strawberries",
    222: "Squash",
    224: "Vetch",
    225: "Dbl Crop WinWht/Corn",
    226: "Dbl Crop Oats/Corn",
    227: "Lettuce",
    229: "Pumpkins",
    236: "Dbl Crop WinWht/Sorghum",
    237: "Dbl Crop Barley/Corn",
    238: "Dbl Crop WinWht/Cotton",
    239: "Dbl Crop Soybeans/Cotton",
    240: "Dbl Crop Soybeans/Oats",
    241: "Dbl Crop Corn/Soybeans",
    242: "Blueberries",
    243: "Cabbage",
    244: "Cauliflower",
    245: "Celery",
    246: "Radishes",
    247: "Turnips",
    248: "Eggplants",
    249: "Gourds",
    250: "Cranberries",
    254: "Dbl Crop Barley/Soybeans",
}

# Core harvested crops (to avoid chunks that are 8 years of pure idle fallow or pure hay)
CORE_HARVEST_CROPS = set(CDL_CROPS.keys()) - {37, 58, 59, 61}


def cell_id_of(lat: float, lon: float) -> str:
    ri = int(round(lat / 0.5))
    rj = int(round(lon / 0.625))
    clat = ri * 0.5
    clon = rj * 0.625
    return f"C_{clat:+06.2f}_{clon:+08.3f}"


def pattern_key_of(codes: list[int]) -> str:
    counts = Counter(codes)
    names = sorted(CDL_CROPS[c] for c, cnt in counts.items() if cnt >= 2 and c in CDL_CROPS)
    return "+".join(names)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    t0 = time.time()
    info = pyogrio.read_info(GDB_PATH)
    total_features = info["features"]
    crs_wkt = info["crs"]
    print(f"Total features in GDB: {total_features:,}")

    transformer = pyproj.Transformer.from_crs(crs_wkt, "EPSG:4326", always_xy=True)

    # Probe every 160th FID across 15.97M rows (~99,831 rows) without geometry first
    step = 160
    probe_fids = list(range(1, total_features + 1, step))
    print(f"Probing {len(probe_fids):,} rows across the US (step={step})...")

    meta, fids, _, fields = pyogrio.raw.read(
        GDB_PATH,
        fids=probe_fids,
        read_geometry=False,
        return_fids=True,
    )
    print(f"Read attributes in {time.time() - t0:.2f}s")

    col_idx = {name: i for i, name in enumerate(meta["fields"])}
    csbid_arr = fields[col_idx["CSBID"]]
    acres_arr = fields[col_idx["CSBACRES"]]
    state_arr = fields[col_idx["STATEFIPS"]]
    cnty_arr = fields[col_idx["CNTY"]]
    ix_arr = fields[col_idx["INSIDE_X"]]
    iy_arr = fields[col_idx["INSIDE_Y"]]
    cdl_arrs = [fields[col_idx[f"CDL{y}"]] for y in range(2018, 2026)]

    # Vectorized coordinate transformation
    lons, lats = transformer.transform(ix_arr, iy_arr)

    by_cell = defaultdict(list)
    valid_count = 0

    for i in range(len(fids)):
        st_fips = str(state_arr[i]).zfill(2)
        if st_fips not in FIPS_TO_STATE:
            continue
        acres = float(acres_arr[i])
        if not (15.0 <= acres <= 400.0):
            continue
        lat = float(lats[i])
        lon = float(lons[i])
        if not (25.0 <= lat <= 49.0 and -124.5 <= lon <= -67.0):
            continue

        codes = [int(cdl_arrs[y][i]) for y in range(8)]
        # All 8 years must be in known CDL_CROPS so crops.json covers every code in the table
        if not all(c in CDL_CROPS for c in codes):
            continue
        # At least 2 years of core harvested crops
        if sum(1 for c in codes if c in CORE_HARVEST_CROPS) < 2:
            continue
        pk = pattern_key_of(codes)
        if not pk:
            continue

        cid = cell_id_of(lat, lon)
        valid_count += 1
        by_cell[cid].append({
            "fid": int(fids[i]),
            "chunk_id": str(csbid_arr[i]),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "state": FIPS_TO_STATE[st_fips],
            "county": str(cnty_arr[i]),
            "climate_cell": cid,
            "acres": round(acres, 2),
            "crops": codes,
            "pattern_key": pk,
        })

    print(f"Valid agricultural chunks: {valid_count:,} across {len(by_cell):,} climate cells")

    # Filter cells with at least 6 valid chunks so each selected cell has good soil/rotation diversity
    rich_cells = [cid for cid, items in by_cell.items() if len(items) >= 6]
    print(f"Cells with >= 6 valid chunks: {len(rich_cells):,}")

    # Select ~280 cells evenly spread across CONUS (sorted by coarse lat/lon bucket, then richness)
    random.seed(42)
    target_cells = 280
    if len(rich_cells) > target_cells:
        # Group into 2.0 deg x 2.5 deg super-cells to guarantee nationwide climate coverage
        super_buckets = defaultdict(list)
        for cid in rich_cells:
            parts = cid.split("_")
            clat, clon = float(parts[1]), float(parts[2])
            sb = (int(clat // 2.0), int(clon // 2.5))
            super_buckets[sb].append(cid)
        for sb in super_buckets:
            super_buckets[sb].sort(key=lambda c: (-len(by_cell[c]), c))

        selected_cells = []
        round_idx = 0
        sbs = sorted(super_buckets.keys())
        while len(selected_cells) < target_cells:
            added = False
            for sb in sbs:
                if round_idx < len(super_buckets[sb]):
                    selected_cells.append(super_buckets[sb][round_idx])
                    added = True
                    if len(selected_cells) >= target_cells:
                        break
            if not added:
                break
            round_idx += 1
    else:
        selected_cells = sorted(rich_cells)

    # From each selected cell, pick up to 9 chunks with diverse crop patterns
    selected_items = []
    for cid in sorted(selected_cells):
        items = by_cell[cid]
        # Group by pattern_key for diversity within the cell
        by_pat = defaultdict(list)
        for it in items:
            by_pat[it["pattern_key"]].append(it)
        picked = []
        pats = sorted(by_pat.keys(), key=lambda k: (-len(by_pat[k]), k))
        r = 0
        while len(picked) < min(9, len(items)):
            progressed = False
            for p in pats:
                if r < len(by_pat[p]):
                    picked.append(by_pat[p][r])
                    progressed = True
                    if len(picked) >= 9:
                        break
            if not progressed:
                break
            r += 1
        selected_items.extend(picked)

    print(f"Selected {len(selected_items):,} chunks across {len(selected_cells):,} climate cells.")

    # Read geometries for the selected FIDs and convert to WGS84 WKT for SSURGO intersection
    selected_items.sort(key=lambda x: x["fid"])
    sel_fids = [x["fid"] for x in selected_items]
    t1 = time.time()
    _, got_fids, geoms, _ = pyogrio.raw.read(
        GDB_PATH,
        fids=sel_fids,
        read_geometry=True,
        return_fids=True,
    )
    print(f"Read {len(got_fids):,} geometries in {time.time() - t1:.2f}s")

    fid_to_wkb = {int(f): g for f, g in zip(got_fids, geoms)}
    final_samples = []
    for item in selected_items:
        wkb = fid_to_wkb.get(item["fid"])
        if wkb is None:
            continue
        geom_albers = shapely.from_wkb(wkb)
        if geom_albers.geom_type == "MultiPolygon":
            # Take largest polygon component
            poly_albers = max(geom_albers.geoms, key=lambda g: g.area)
        elif geom_albers.geom_type == "Polygon":
            poly_albers = geom_albers
        else:
            continue

        poly_wgs84 = transform(transformer.transform, poly_albers)
        # Light simplification (~5m) to keep WKT compact for SDA POST request
        poly_simple = poly_wgs84.simplify(0.00005, preserve_topology=True)
        if poly_simple.geom_type == "MultiPolygon":
            poly_simple = max(poly_simple.geoms, key=lambda g: g.area)
        wkt = shapely.to_wkt(poly_simple, rounding_precision=5)
        item["wkt"] = wkt
        final_samples.append(item)

    with open(OUT_CSB, "w", encoding="utf-8") as f:
        json.dump(final_samples, f, indent=2)

    with open(OUT_CROPS, "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in sorted(CDL_CROPS.items())}, f, indent=2)

    states_cnt = Counter(x["state"] for x in final_samples)
    print(f"Saved {len(final_samples):,} samples to {OUT_CSB} across {len(states_cnt)} states: {dict(states_cnt.most_common(12))}")


if __name__ == "__main__":
    main()
