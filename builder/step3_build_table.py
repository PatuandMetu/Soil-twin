import json
import math
import os
import shutil
from collections import defaultdict

from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE / "source"  # 원천 원본 (git 제외)
RAW_DIR = HERE / "raw"  # 원천 응답 저장 (git 제외)
PUBLIC_DIR = HERE.parent / "frontend" / "public" / "data"  # 앱이 읽는 결과

OUT_DIR = str(RAW_DIR)
IN_CSB = os.path.join(OUT_DIR, "raw_csb_sample.json")
POWER_DIR = os.path.join(OUT_DIR, "raw_power")
SSURGO_FILE = os.path.join(OUT_DIR, "raw_ssurgo.jsonl")
OUT_CHUNKS = str(PUBLIC_DIR / "chunks.json")
IN_CROPS = os.path.join(OUT_DIR, "crops.json")
OUT_CROPS = str(PUBLIC_DIR / "crops.json")

DRAINAGE_MAP = {
    "Excessively drained": 1.0,
    "Somewhat excessively drained": 2.0,
    "Well drained": 3.0,
    "Moderately well drained": 4.0,
    "Somewhat poorly drained": 5.0,
    "Poorly drained": 6.0,
    "Very poorly drained": 7.0,
    "Subaqueous": 7.0,
}

FLOOD_MAP = {
    "None": 0.0,
    "Very rare": 1.0,
    "Rare": 2.0,
    "Occasional": 3.0,
    "Frequent": 4.0,
    "Very frequent": 5.0,
}

NON_SOIL_KEYWORDS = (
    "urban land",
    "water",
    "rock outcrop",
    "pits",
    "dumps",
    "badland",
    "rubble land",
    "miscellaneous water",
    "dam",
    "quarries",
    "gravel pit",
    "dune land",
    "lava",
    "glacier",
    "chute",
)


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        f = float(val)
        if not math.isfinite(f):
            return None
        return f
    except Exception:
        return None


def compute_soil_for_chunk(rows: list) -> tuple[dict | None, str]:
    if not rows:
        return None, "empty_ssurgo"

    # Group horizon rows by (mukey, cokey)
    comp_meta = {}
    comp_horizons = defaultdict(list)

    for r in rows:
        # 0: mukey, 1: muname, 2: drclassdcd, 3: aws0100wta, 4: brockdepmin, 5: flodfreqdcd,
        # 6: cokey, 7: compname, 8: compkind, 9: comppct_r, 10: slope_r,
        # 11: hzdept_r, 12: hzdepb_r, 13: sandtotal_r, 14: silttotal_r, 15: claytotal_r,
        # 16: om_r, 17: ph1to1h2o_r, 18: cec7_r, 19: ec_r
        mukey = str(r[0])
        cokey = str(r[6])
        key = (mukey, cokey)
        if key not in comp_meta:
            comp_meta[key] = {
                "mukey": mukey,
                "muname": str(r[1] or ""),
                "drclassdcd": r[2],
                "aws0100wta": safe_float(r[3]),
                "brockdepmin": safe_float(r[4]),
                "flodfreqdcd": r[5],
                "compname": str(r[7] or ""),
                "compkind": str(r[8] or ""),
                "comppct_r": safe_float(r[9]),
                "slope_r": safe_float(r[10]),
            }
        top = safe_float(r[11])
        bot = safe_float(r[12])
        if top is not None and bot is not None and bot > top and top < 30.0:
            comp_horizons[key].append({
                "top": top,
                "bot": bot,
                "sand": safe_float(r[13]),
                "silt": safe_float(r[14]),
                "clay": safe_float(r[15]),
                "om": safe_float(r[16]),
                "ph": safe_float(r[17]),
                "cec": safe_float(r[18]),
                "ec": safe_float(r[19]),
            })

    total_pct = 0.0
    non_soil_pct = 0.0
    valid_comps = []

    for key, meta in comp_meta.items():
        pct = meta["comppct_r"]
        if pct is None or pct <= 0:
            continue
        total_pct += pct
        cname_low = meta["compname"].lower()
        muname_low = meta["muname"].lower()
        ckind_low = meta["compkind"].lower()
        if (
            ckind_low == "miscellaneous area"
            or any(kw in cname_low for kw in NON_SOIL_KEYWORDS)
            or any(kw in muname_low for kw in ("urban land", "water"))
        ):
            non_soil_pct += pct
            continue

        # Aggregate 0~30cm horizons weighted by thickness overlap
        hzs = comp_horizons.get(key, [])
        if not hzs:
            continue

        hz_vars = {}
        for v in ("sand", "silt", "clay", "om", "ph", "cec", "ec"):
            w_sum = 0.0
            v_sum = 0.0
            for h in hzs:
                val = h[v]
                if val is None:
                    continue
                dh = min(30.0, h["bot"]) - max(0.0, h["top"])
                if dh > 0:
                    w_sum += dh
                    v_sum += dh * val
            hz_vars[v] = (v_sum / w_sum) if w_sum > 0 else None

        # Must have core texture and pH/OM
        if any(hz_vars[v] is None for v in ("sand", "silt", "clay", "ph", "om")):
            continue

        dr_val = DRAINAGE_MAP.get(meta["drclassdcd"])
        if dr_val is None:
            continue
        fl_val = FLOOD_MAP.get(meta["flodfreqdcd"], 0.0)
        aws_cm = meta["aws0100wta"]
        if aws_cm is None:
            continue
        slope = meta["slope_r"]
        if slope is None:
            continue

        brock = meta["brockdepmin"]
        if brock is None or brock <= 0 or brock > 200.0:
            bedrock_cm = 200.0
        else:
            bedrock_cm = float(brock)

        cec_val = hz_vars["cec"]
        if cec_val is None or cec_val < 0:
            # Standard pedotransfer fallback when neutral-pH CEC7 is omitted (e.g., calcareous soils with ECEC only)
            cec_val = max(1.0, 0.5 * hz_vars["clay"] + 2.0 * hz_vars["om"])

        ec_val = hz_vars["ec"]
        if ec_val is None or ec_val < 0:
            ec_val = 0.0

        valid_comps.append({
            "weight": pct,
            "sand": hz_vars["sand"],
            "silt": hz_vars["silt"],
            "clay": hz_vars["clay"],
            "aws_mm": max(0.0, aws_cm * 10.0),
            "drainage": dr_val,
            "flood": fl_val,
            "ph": hz_vars["ph"],
            "om": max(0.0, hz_vars["om"]),
            "cec": max(0.0, cec_val),
            "ec": max(0.0, ec_val),
            "slope": max(0.0, slope),
            "bedrock_cm": bedrock_cm,
        })

    if total_pct <= 0:
        return None, "zero_pct"

    # Gate A: non-soil/urban > 30%
    if (non_soil_pct / total_pct) > 0.30:
        return None, "gate_a_non_soil"

    valid_w = sum(c["weight"] for c in valid_comps)
    if valid_w <= 0 or (valid_w / total_pct) < 0.60:
        return None, "gate_a_missing_soil"

    agg = {}
    for k in ("sand", "silt", "clay", "aws_mm", "drainage", "flood", "ph", "om", "cec", "ec", "slope", "bedrock_cm"):
        agg[k] = sum(c["weight"] * c[k] for c in valid_comps) / valid_w

    # Normalize sand + silt + clay = 100.0 exactly
    tex_sum = agg["sand"] + agg["silt"] + agg["clay"]
    if tex_sum <= 0:
        return None, "invalid_texture"
    sand_r = round(agg["sand"] * 100.0 / tex_sum, 2)
    silt_r = round(agg["silt"] * 100.0 / tex_sum, 2)
    clay_r = round(100.0 - sand_r - silt_r, 2)
    if clay_r < 0:
        clay_r = 0.0
        silt_r = round(100.0 - sand_r, 2)

    ph_clamped = min(11.0, max(3.0, round(agg["ph"], 2)))
    bedrock_clamped = min(200.0, max(1.0, round(agg["bedrock_cm"], 1)))
    drainage_clamped = min(7.0, max(1.0, round(agg["drainage"], 2)))
    flood_clamped = min(5.0, max(0.0, round(agg["flood"], 2)))

    return {
        "sand": sand_r,
        "silt": silt_r,
        "clay": clay_r,
        "aws_mm": round(agg["aws_mm"], 1),
        "drainage": drainage_clamped,
        "flood": flood_clamped,
        "ph": ph_clamped,
        "om": round(agg["om"], 2),
        "cec": round(agg["cec"], 2),
        "ec": round(agg["ec"], 2),
        "slope": round(agg["slope"], 2),
        "bedrock_cm": bedrock_clamped,
    }, "ok"


def compute_metrics_from_daily(daily_rows, baseline_apr_sep_precip=None):
    # daily_rows: list of (year, month, day, t2m, tmax, tmin, prec, gwet)
    month_t = defaultdict(list)
    ym_prec = defaultdict(float)
    year_days = defaultdict(list)
    summer_gwet = []
    apr_sep_by_year = defaultdict(float)

    for yr, mo, dy, t2m, tmax, tmin, prec, gwet in daily_rows:
        if t2m is not None:
            month_t[mo].append(t2m)
        if prec is not None and prec >= 0:
            ym_prec[(yr, mo)] += prec
            if 4 <= mo <= 9:
                apr_sep_by_year[yr] += prec
        if 2018 <= yr <= 2025:
            year_days[yr].append((mo, dy, t2m, tmax, tmin))
            if 6 <= mo <= 8 and gwet is not None and 0.0 <= gwet <= 1.0:
                summer_gwet.append(gwet)

    # Monthly averages across 2001-2025
    t_m = {}
    p_m = {}
    for mo in range(1, 13):
        vals_t = month_t[mo]
        t_m[mo] = round(sum(vals_t) / len(vals_t), 2) if vals_t else 0.0
        vals_p = [ym_prec[(yr, mo)] for yr in range(2001, 2026) if (yr, mo) in ym_prec]
        p_m[mo] = round(max(0.0, sum(vals_p) / len(vals_p)), 1) if vals_p else 0.0

    # 2018-2025 FFD, GDD10, heat_days
    ffds = []
    gdds = []
    heats = []
    for yr in range(2018, 2026):
        days = year_days.get(yr, [])
        if not days:
            continue
        # Longest consecutive frost-free run (T2M_MIN > 0.0 C)
        max_run = 0
        cur_run = 0
        gdd_yr = 0.0
        heat_yr = 0
        for mo, dy, t2m, tmax, tmin in days:
            if tmin is not None and tmin > 0.0:
                cur_run += 1
                if cur_run > max_run:
                    max_run = cur_run
            else:
                cur_run = 0
            if t2m is not None and t2m > 10.0:
                gdd_yr += (t2m - 10.0)
            if tmax is not None and tmax >= 32.0:
                heat_yr += 1
        ffds.append(float(max_run))
        gdds.append(gdd_yr)
        heats.append(float(heat_yr))

    ffd = round(min(366.0, max(0.0, sum(ffds) / len(ffds))), 1) if ffds else 180.0
    gdd10 = round(max(0.0, sum(gdds) / len(gdds)), 1) if gdds else 1500.0
    heat_days = round(min(366.0, max(0.0, sum(heats) / len(heats))), 1) if heats else 10.0
    gwet_summer = round(min(1.0, max(0.0, sum(summer_gwet) / len(summer_gwet))), 3) if summer_gwet else 0.5

    # Drought frequency: share of years (2001-2025) where Apr-Sep precip < 80% of baseline normal
    apr_sep_vals = [apr_sep_by_year[yr] for yr in range(2001, 2026) if yr in apr_sep_by_year]
    if baseline_apr_sep_precip is None:
        baseline_apr_sep_precip = (sum(apr_sep_vals) / len(apr_sep_vals)) if apr_sep_vals else 500.0

    threshold_80 = 0.80 * baseline_apr_sep_precip
    drought_years = sum(1 for v in apr_sep_vals if v < threshold_80)
    drought_freq = round(min(1.0, max(0.0, drought_years / len(apr_sep_vals))), 3) if apr_sep_vals else 0.0

    return {
        "t_m": t_m,
        "p_m": p_m,
        "ffd": ffd,
        "gdd10": gdd10,
        "heat_days": heat_days,
        "gwet_summer": gwet_summer,
        "drought_freq": drought_freq,
        "baseline_apr_sep_precip": baseline_apr_sep_precip,
    }


def compute_climate_for_cell(cid: str) -> dict | None:
    path = os.path.join(POWER_DIR, f"{cid}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    param = data.get("properties", {}).get("parameter", {})
    t2m_d = param.get("T2M", {})
    tmax_d = param.get("T2M_MAX", {})
    tmin_d = param.get("T2M_MIN", {})
    prec_d = param.get("PRECTOTCORR", {})
    gwet_d = param.get("GWETROOT", {})

    if not t2m_d:
        return None

    def clean(v):
        if v is None or v <= -900:
            return None
        return float(v)

    cur_rows = []
    shift_rows = []
    for dt_str in sorted(t2m_d.keys()):
        if len(dt_str) != 8:
            continue
        yr = int(dt_str[:4])
        mo = int(dt_str[4:6])
        dy = int(dt_str[6:8])
        t2m = clean(t2m_d.get(dt_str))
        tmax = clean(tmax_d.get(dt_str))
        tmin = clean(tmin_d.get(dt_str))
        prec = clean(prec_d.get(dt_str))
        gwet = clean(gwet_d.get(dt_str))
        cur_rows.append((yr, mo, dy, t2m, tmax, tmin, prec, gwet))

        # Shift scenario: +2.2 C temperature, -15% Apr-Sep precipitation
        s_t2m = (t2m + 2.2) if t2m is not None else None
        s_tmax = (tmax + 2.2) if tmax is not None else None
        s_tmin = (tmin + 2.2) if tmin is not None else None
        if prec is not None:
            s_prec = prec * 0.85 if (4 <= mo <= 9) else prec
        else:
            s_prec = None
        shift_rows.append((yr, mo, dy, s_t2m, s_tmax, s_tmin, s_prec, gwet))

    cur = compute_metrics_from_daily(cur_rows, baseline_apr_sep_precip=None)
    shf = compute_metrics_from_daily(shift_rows, baseline_apr_sep_precip=cur["baseline_apr_sep_precip"])

    out = {}
    for mo in range(1, 13):
        out[f"t_m{mo:02d}"] = cur["t_m"][mo]
    for mo in range(1, 13):
        out[f"p_m{mo:02d}"] = cur["p_m"][mo]
    out["ffd"] = cur["ffd"]
    out["gdd10"] = cur["gdd10"]
    out["heat_days"] = cur["heat_days"]
    out["gwet_summer"] = cur["gwet_summer"]
    out["drought_freq"] = cur["drought_freq"]

    for mo in range(1, 13):
        out[f"s_t_m{mo:02d}"] = shf["t_m"][mo]
    for mo in range(1, 13):
        out[f"s_p_m{mo:02d}"] = shf["p_m"][mo]
    out["s_ffd"] = shf["ffd"]
    out["s_gdd10"] = shf["gdd10"]
    out["s_heat_days"] = shf["heat_days"]
    # Per spec: s_gwet_summer equals current gwet_summer
    out["s_gwet_summer"] = cur["gwet_summer"]
    out["s_drought_freq"] = shf["drought_freq"]
    return out


def validate_row(row: dict, crops_map: dict, seen_ids: set):
    assert len(row) == 84, f"Expected 84 columns, got {len(row)}"
    cid = row["chunk_id"]
    assert isinstance(cid, str) and cid and cid not in seen_ids, f"Duplicate or invalid chunk_id {cid}"
    seen_ids.add(cid)

    for k, v in row.items():
        if k in ("chunk_id", "state", "climate_cell"):
            assert isinstance(v, str) and len(v) > 0, f"{cid}.{k} invalid string"
        elif k.startswith("crop_"):
            assert isinstance(v, int) and str(v) in crops_map, f"{cid}.{k}={v} not in crops.json"
        else:
            assert isinstance(v, (int, float)) and math.isfinite(v) and v != -999, f"{cid}.{k}={v} invalid number"

    tex = row["sand"] + row["silt"] + row["clay"]
    assert abs(tex - 100.0) <= 0.5, f"{cid} texture sum {tex}"
    assert 1.0 <= row["drainage"] <= 7.0, f"{cid} drainage {row['drainage']}"
    assert 0.0 <= row["flood"] <= 5.0, f"{cid} flood {row['flood']}"
    assert 0.0 < row["bedrock_cm"] <= 200.0, f"{cid} bedrock {row['bedrock_cm']}"
    assert 3.0 <= row["ph"] <= 11.0, f"{cid} ph {row['ph']}"
    for k in ("om", "cec", "ec", "slope", "aws_mm", "acres", "gdd10", "s_gdd10"):
        assert row[k] >= 0.0, f"{cid}.{k}={row[k]} < 0"
    for mo in range(1, 13):
        assert row[f"p_m{mo:02d}"] >= 0.0 and row[f"s_p_m{mo:02d}"] >= 0.0
    for k in ("gwet_summer", "s_gwet_summer", "drought_freq", "s_drought_freq"):
        assert 0.0 <= row[k] <= 1.0, f"{cid}.{k}={row[k]} out of [0,1]"
    for k in ("ffd", "s_ffd", "heat_days", "s_heat_days"):
        assert 0.0 <= row[k] <= 366.0, f"{cid}.{k}={row[k]} out of [0,366]"


def main():
    with open(IN_CSB, encoding="utf-8") as f:
        samples = json.load(f)
    with open(IN_CROPS, encoding="utf-8") as f:
        crops_map = json.load(f)

    # Load SSURGO raw responses
    ssurgo_by_id = {}
    with open(SSURGO_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            ssurgo_by_id[obj["chunk_id"]] = obj["rows"]

    # Compute climate per cell
    cells = sorted({x["climate_cell"] for x in samples})
    climate_by_cell = {}
    for cid in cells:
        clim = compute_climate_for_cell(cid)
        if clim is not None:
            climate_by_cell[cid] = clim

    print(f"Computed climate for {len(climate_by_cell)}/{len(cells)} cells")

    table = []
    drop_reasons = defaultdict(int)
    seen_ids = set()

    for item in samples:
        cid = item["chunk_id"]
        cell_id = item["climate_cell"]
        clim = climate_by_cell.get(cell_id)
        if clim is None:
            drop_reasons["missing_climate"] += 1
            continue
        s_rows = ssurgo_by_id.get(cid)
        if s_rows is None:
            drop_reasons["missing_ssurgo"] += 1
            continue
        soil, reason = compute_soil_for_chunk(s_rows)
        if soil is None:
            drop_reasons[reason] += 1
            continue

        row = {
            "chunk_id": cid,
            "lat": item["lat"],
            "lon": item["lon"],
            "state": item["state"],
            "climate_cell": cell_id,
            "acres": item["acres"],
        }
        row.update(soil)
        row.update(clim)
        for idx, yr in enumerate(range(2018, 2026)):
            row[f"crop_{yr}"] = int(item["crops"][idx])

        validate_row(row, crops_map, seen_ids)
        table.append(row)

    table.sort(key=lambda r: r["chunk_id"])
    with open(OUT_CHUNKS, "w", encoding="utf-8") as f:
        json.dump(table, f, indent=2)

    shutil.copyfile(IN_CROPS, OUT_CROPS)

    size_mb = os.path.getsize(OUT_CHUNKS) / (1024 * 1024)
    print(f"Built {len(table):,} valid chunks -> {OUT_CHUNKS} ({size_mb:.2f} MB)")
    print(f"Copied crop names -> {OUT_CROPS}")
    print(f"Dropped chunks by reason (Gate A / missing): {dict(drop_reasons)}")


if __name__ == "__main__":
    main()
