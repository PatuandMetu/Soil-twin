import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE / "source"  # 원천 원본 (git 제외)
RAW_DIR = HERE / "raw"  # 원천 응답 저장 (git 제외)
PUBLIC_DIR = HERE.parent / "frontend" / "public" / "data"  # 앱이 읽는 결과

OUT_DIR = str(RAW_DIR)
IN_CSB = os.path.join(OUT_DIR, "raw_csb_sample.json")
POWER_DIR = os.path.join(OUT_DIR, "raw_power")
SSURGO_FILE = os.path.join(OUT_DIR, "raw_ssurgo.jsonl")

SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/tabular/post.rest"

SDA_QUERY_TEMPLATE = """SELECT mu.mukey, mu.muname, ma.drclassdcd, ma.aws0100wta, ma.brockdepmin, ma.flodfreqdcd,
c.cokey, c.compname, c.compkind, c.comppct_r, c.slope_r,
h.hzdept_r, h.hzdepb_r, h.sandtotal_r, h.silttotal_r, h.claytotal_r, h.om_r, h.ph1to1h2o_r, h.cec7_r, h.ec_r
FROM mapunit mu
JOIN muaggatt ma ON ma.mukey = mu.mukey
JOIN component c ON c.mukey = mu.mukey
LEFT JOIN chorizon h ON h.cokey = c.cokey AND h.hzdept_r < 30
WHERE mu.mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('%s'))"""


def bbox_wkt(lat: float, lon: float, d: float = 0.0025) -> str:
    return (
        f"POLYGON(({lon - d:.5f} {lat - d:.5f}, {lon + d:.5f} {lat - d:.5f}, "
        f"{lon + d:.5f} {lat + d:.5f}, {lon - d:.5f} {lat + d:.5f}, {lon - d:.5f} {lat - d:.5f}))"
    )


def fetch_power_cell(cid: str) -> tuple[str, bool, str]:
    out_path = os.path.join(POWER_DIR, f"{cid}.json")
    if os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
        return cid, True, "cached"

    parts = cid.split("_")
    clat, clon = float(parts[1]), float(parts[2])
    url = (
        "https://power.larc.nasa.gov/api/temporal/daily/point"
        "?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,GWETROOT"
        f"&community=AG&longitude={clon}&latitude={clat}"
        "&start=20010101&end=20251231&format=JSON"
    )
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read()
            data = json.loads(body)
            if "properties" in data and "parameter" in data["properties"]:
                tmp_path = out_path + ".tmp"
                with open(tmp_path, "wb") as f:
                    f.write(body)
                os.replace(tmp_path, out_path)
                return cid, True, "ok"
        except Exception as e:
            if attempt == 3:
                return cid, False, str(e)[:100]
            time.sleep(1.5 * (attempt + 1))
    return cid, False, "unknown"


def query_sda(wkt: str) -> list:
    sql = SDA_QUERY_TEMPLATE % wkt
    body = urllib.parse.urlencode({"format": "JSON", "query": sql}).encode("utf-8")
    req = urllib.request.Request(
        SDA_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read()
    if not raw:
        return []
    parsed = json.loads(raw)
    return parsed.get("Table", [])


def fetch_ssurgo_chunk(item: dict) -> tuple[str, list | None, str]:
    chunk_id = item["chunk_id"]
    wkt = item.get("wkt") or bbox_wkt(item["lat"], item["lon"])
    for attempt in range(3):
        try:
            rows = query_sda(wkt)
            if not rows and attempt == 0:
                # Fallback to small bounding box around inside point if complex polygon returned empty
                rows = query_sda(bbox_wkt(item["lat"], item["lon"]))
            return chunk_id, rows, "ok"
        except Exception as e:
            if attempt == 0:
                wkt = bbox_wkt(item["lat"], item["lon"])
            if attempt == 2:
                return chunk_id, None, str(e)[:100]
            time.sleep(1.0 * (attempt + 1))
    return chunk_id, None, "failed"


def main():
    os.makedirs(POWER_DIR, exist_ok=True)
    with open(IN_CSB, encoding="utf-8") as f:
        samples = json.load(f)

    cells = sorted({x["climate_cell"] for x in samples})
    print(f"=== Step 2A: Fetching NASA POWER for {len(cells)} climate cells ===", flush=True)
    t0 = time.time()
    ok_power = 0
    err_power = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_power_cell, c): c for c in cells}
        for idx, fut in enumerate(as_completed(futs), 1):
            cid, ok, msg = fut.result()
            if ok:
                ok_power += 1
            else:
                err_power += 1
                print(f"  [POWER ERR] {cid}: {msg}", flush=True)
            if idx % 25 == 0 or idx == len(cells):
                el = time.time() - t0
                print(f"  POWER {idx}/{len(cells)} (ok={ok_power}, err={err_power}) [{el:.1f}s]", flush=True)

    # Check already fetched SSURGO chunk_ids
    done_ssurgo = set()
    if os.path.exists(SSURGO_FILE):
        with open(SSURGO_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if obj.get("rows") is not None:
                        done_ssurgo.add(obj["chunk_id"])
                except Exception:
                    pass

    todo_samples = [x for x in samples if x["chunk_id"] not in done_ssurgo]
    print(
        f"=== Step 2B: Fetching SSURGO SDA for {len(todo_samples)} chunks "
        f"(already cached: {len(done_ssurgo)}) ===",
        flush=True,
    )
    t1 = time.time()
    ok_ssurgo = 0
    err_ssurgo = 0
    with open(SSURGO_FILE, "a", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=10) as ex:
            futs = {ex.submit(fetch_ssurgo_chunk, item): item["chunk_id"] for item in todo_samples}
            for idx, fut in enumerate(as_completed(futs), 1):
                cid, rows, msg = fut.result()
                if rows is not None:
                    ok_ssurgo += 1
                    out_f.write(json.dumps({"chunk_id": cid, "rows": rows}) + "\n")
                else:
                    err_ssurgo += 1
                    print(f"  [SSURGO ERR] {cid}: {msg}", flush=True)
                if idx % 100 == 0 or idx == len(todo_samples):
                    out_f.flush()
                    el = time.time() - t1
                    rate = idx / el if el > 0 else 0
                    print(
                        f"  SSURGO {idx}/{len(todo_samples)} (ok={ok_ssurgo}, err={err_ssurgo}) "
                        f"[{el:.1f}s, {rate:.1f} chunks/s]",
                        flush=True,
                    )

    print("Done fetching remote sources!", flush=True)


if __name__ == "__main__":
    main()
