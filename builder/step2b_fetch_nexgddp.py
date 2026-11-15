"""Step 2B: NASA NEX-GDDP-CMIP6 근미래(2035-2050, SSP2-4.5) 3-GCM 앙상블 중앙값 델타 추출.

기준선(B): 2001-2025 (historical 2001-2014 + ssp245 2015-2025)
근미래(F): 2035-2050 (ssp245)
모델(3개): ACCESS-CM2, GFDL-ESM4, MPI-ESM1-2-HR (r1i1p1f1)
변수: tas (일평균 기온, K), pr (일강수량, kg m-2 s-1)
  - 기온 델타: ΔT = mean_F - mean_B (°C, t2m/tmax/tmin 공통 적용)
  - 강수 비율: r_P = clamp(mean_F / max(mean_B, MIN_PREC_MM_DAY), 0.3, 3.0)
"""

from __future__ import annotations

import ctypes
import glob
import json
import os
import queue
import statistics
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RAW_DIR = HERE / "raw"
IN_CSB = RAW_DIR / "raw_csb_sample.json"
POWER_DIR = RAW_DIR / "raw_power"
CACHE_DIR = RAW_DIR / "raw_nexgddp_cache"
OUT_DELTAS = RAW_DIR / "raw_nexgddp_deltas.json"

MODELS = [
    ("ACCESS-CM2", "r1i1p1f1", "gn"),
    ("GFDL-ESM4", "r1i1p1f1", "gr1"),
    ("MPI-ESM1-2-HR", "r1i1p1f1", "gn"),
]
VARS = ["tas", "pr"]
HIST_YEARS = list(range(2001, 2015))
SSP_BASE_YEARS = list(range(2015, 2026))
BASE_YEARS = HIST_YEARS + SSP_BASE_YEARS
FUT_YEARS = list(range(2035, 2051))
ALL_YEARS = BASE_YEARS + FUT_YEARS

PRECIP_CLAMP = (0.3, 3.0)
MIN_PREC_MM_DAY = 0.1  # ~3 mm/month 건조월 분모 하한

# CONUS slice inside global NEX-GDDP-CMIP6 (600x1440, lat -59.875..89.875, lon 0.125..359.875)
CONUS_LAT_START = 336  # 24.125 N
CONUS_LAT_COUNT = 105  # ..50.125 N
CONUS_LON_START = 940  # 235.125 E (-124.875 W)
CONUS_LON_COUNT = 241  # ..295.125 E (-64.875 W)

S3_BASE = "https://nex-gddp-cmip6.s3.us-west-2.amazonaws.com/NEX-GDDP-CMIP6"
NCSS_BASE = "https://ds.nccs.nasa.gov/thredds/ncss/grid/AMES/NEX/GDDP-CMIP6"

# ---- libhdf5 ctypes binding (thread-locked) ----
_HDF5_LOCK = threading.Lock()
_h5 = ctypes.CDLL("libhdf5.so")
_h5hl = ctypes.CDLL("libhdf5_hl.so")

_h5.H5Fopen.argtypes = [ctypes.c_char_p, ctypes.c_uint, ctypes.c_int64]
_h5.H5Fopen.restype = ctypes.c_int64
_h5.H5Fclose.argtypes = [ctypes.c_int64]
_h5.H5Dopen2.argtypes = [ctypes.c_int64, ctypes.c_char_p, ctypes.c_int64]
_h5.H5Dopen2.restype = ctypes.c_int64
_h5.H5Dclose.argtypes = [ctypes.c_int64]
_h5.H5Dget_space.argtypes = [ctypes.c_int64]
_h5.H5Dget_space.restype = ctypes.c_int64
_h5.H5Sclose.argtypes = [ctypes.c_int64]
_h5.H5Dget_type.argtypes = [ctypes.c_int64]
_h5.H5Dget_type.restype = ctypes.c_int64
_h5.H5Tclose.argtypes = [ctypes.c_int64]
_h5.H5Sselect_hyperslab.argtypes = [
    ctypes.c_int64,
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_uint64),
    ctypes.POINTER(ctypes.c_uint64),
    ctypes.POINTER(ctypes.c_uint64),
    ctypes.POINTER(ctypes.c_uint64),
]
_h5.H5Screate_simple.argtypes = [
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_uint64),
    ctypes.POINTER(ctypes.c_uint64),
]
_h5.H5Screate_simple.restype = ctypes.c_int64
_h5.H5Dread.argtypes = [
    ctypes.c_int64,
    ctypes.c_int64,
    ctypes.c_int64,
    ctypes.c_int64,
    ctypes.c_int64,
    ctypes.c_void_p,
]
_h5hl.H5LTget_dataset_info.argtypes = [
    ctypes.c_int64,
    ctypes.c_char_p,
    ctypes.POINTER(ctypes.c_uint64),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_size_t),
]
_h5hl.H5LTread_dataset_double.argtypes = [ctypes.c_int64, ctypes.c_char_p, ctypes.c_void_p]
_h5hl.H5LTread_dataset_float.argtypes = [ctypes.c_int64, ctypes.c_char_p, ctypes.c_void_p]


def read_conus_from_nc(nc_path: str, var: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """NetCDF-4(HDF5) 파일에서 CONUS 범위 (days, 105, 241) float32 배열과 (lat, lon) 좌표를 읽는다.
    전체 지구 파일(600x1440)과 THREDDS CONUS 서브셋(105x241) 모두 지원한다."""
    bpath = nc_path.encode("utf-8")
    bvar = f"/{var}".encode("utf-8")
    with _HDF5_LOCK:
        fid = _h5.H5Fopen(bpath, 0, 0)
        if fid < 0:
            raise RuntimeError(f"H5Fopen failed for {nc_path}")
        try:
            dims = (ctypes.c_uint64 * 4)()
            tclass = ctypes.c_int()
            tsize = ctypes.c_size_t()

            _h5hl.H5LTget_dataset_info(fid, b"/lat", dims, ctypes.byref(tclass), ctypes.byref(tsize))
            nlat = int(dims[0])
            lat = np.empty(nlat, dtype=np.float64)
            _h5hl.H5LTread_dataset_double(fid, b"/lat", lat.ctypes.data_as(ctypes.c_void_p))

            _h5hl.H5LTget_dataset_info(fid, b"/lon", dims, ctypes.byref(tclass), ctypes.byref(tsize))
            nlon = int(dims[0])
            lon = np.empty(nlon, dtype=np.float64)
            _h5hl.H5LTread_dataset_double(fid, b"/lon", lon.ctypes.data_as(ctypes.c_void_p))

            _h5hl.H5LTget_dataset_info(fid, bvar, dims, ctypes.byref(tclass), ctypes.byref(tsize))
            ndays = int(dims[0])

            if nlat == CONUS_LAT_COUNT and nlon == CONUS_LON_COUNT:
                arr = np.empty((ndays, nlat, nlon), dtype=np.float32)
                _h5hl.H5LTread_dataset_float(fid, bvar, arr.ctypes.data_as(ctypes.c_void_p))
                return lat, lon, arr

            # Global file: read only CONUS hyperslab
            did = _h5.H5Dopen2(fid, bvar, 0)
            if did < 0:
                raise RuntimeError(f"H5Dopen2 failed for {var}")
            try:
                fspace = _h5.H5Dget_space(did)
                start = (ctypes.c_uint64 * 3)(0, CONUS_LAT_START, CONUS_LON_START)
                count = (ctypes.c_uint64 * 3)(ndays, CONUS_LAT_COUNT, CONUS_LON_COUNT)
                _h5.H5Sselect_hyperslab(fspace, 0, start, None, count, None)
                mspace = _h5.H5Screate_simple(3, count, None)
                dtype = _h5.H5Dget_type(did)
                arr = np.empty((ndays, CONUS_LAT_COUNT, CONUS_LON_COUNT), dtype=np.float32)
                _h5.H5Dread(did, dtype, mspace, fspace, 0, arr.ctypes.data_as(ctypes.c_void_p))
                _h5.H5Tclose(dtype)
                _h5.H5Sclose(mspace)
                _h5.H5Sclose(fspace)
            finally:
                _h5.H5Dclose(did)
            return (
                lat[CONUS_LAT_START : CONUS_LAT_START + CONUS_LAT_COUNT],
                lon[CONUS_LON_START : CONUS_LON_START + CONUS_LON_COUNT],
                arr,
            )
        finally:
            _h5.H5Fclose(fid)


def load_all_cells() -> list[str]:
    with open(IN_CSB, encoding="utf-8") as f:
        samples = json.load(f)
    csb_cells = {x["climate_cell"] for x in samples}
    power_cells = {
        os.path.basename(p)[:-5]
        for p in glob.glob(str(POWER_DIR / "*.json"))
        if os.path.basename(p).startswith("C_")
    }
    return sorted(csb_cells | power_cells)


def build_cell_indices(
    cells: list[str], lat: np.ndarray, lon: np.ndarray, valid_2d: np.ndarray
) -> list[tuple[np.ndarray, np.ndarray]]:
    """각 climate_cell(0.5°×0.5°) 내 유효 육지 격자 좌표쌍 목록을 구한다(없으면 최근접 유효 육지 격자)."""
    valid_ys, valid_xs = np.where(valid_2d)
    valid_lats = lat[valid_ys]
    valid_lons = lon[valid_xs]
    indices = []
    for cid in cells:
        _, slat, slon = cid.split("_")
        clat = float(slat)
        clon = float(slon)
        clon360 = clon + 360.0 if clon < 0 else clon
        iy = np.where(np.abs(lat - clat) <= 0.25 + 1e-6)[0]
        ix = np.where(np.abs(lon - clon360) <= 0.25 + 1e-6)[0]
        yy, xx = np.meshgrid(iy, ix, indexing="ij")
        yy = yy.ravel()
        xx = xx.ravel()
        keep = valid_2d[yy, xx]
        if np.any(keep):
            indices.append((yy[keep], xx[keep]))
        else:
            # 최근접 유효 육지 격자 폴백
            d2 = (valid_lats - clat) ** 2 + (valid_lons - clon360) ** 2
            best = int(np.argmin(d2))
            indices.append((np.array([valid_ys[best]]), np.array([valid_xs[best]])))
    return indices


def month_slices(ndays: int) -> list[tuple[int, int]]:
    if ndays == 365:
        lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    elif ndays == 366:
        lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    elif ndays == 360:
        lengths = [30] * 12
    else:
        raise ValueError(f"Unexpected days in year: {ndays}")
    out = []
    cur = 0
    for L in lengths:
        out.append((cur, cur + L))
        cur += L
    return out


def extract_monthly_for_year(
    nc_path: str, var: str, cells: list[str]
) -> dict[str, list[float]]:
    """1년치 NetCDF 파일에서 칸별 12개월 평균값을 추출한다.
    pr는 kg m-2 s-1 -> mm/day (* 86400)로 변환한다."""
    lat, lon, arr = read_conus_from_nc(nc_path, var)
    valid_3d = np.isfinite(arr) & (arr < 1e10)
    valid_2d = np.any(valid_3d, axis=0)
    cell_idx = build_cell_indices(cells, lat, lon, valid_2d)

    ndays = arr.shape[0]
    mslices = month_slices(ndays)

    out: dict[str, list[float]] = {}
    for cid, (yy, xx) in zip(cells, cell_idx):
        sub = arr[:, yy, xx].astype(np.float64)
        sub_valid = valid_3d[:, yy, xx]
        if not np.all(sub_valid):
            sub = np.where(sub_valid, sub, np.nan)
            daily = np.nanmean(sub, axis=1)
        else:
            daily = np.mean(sub, axis=1)
        if var == "pr":
            daily = np.maximum(0.0, daily) * 86400.0
        out[cid] = [round(float(np.mean(daily[s:e])), 6) for s, e in mslices]
    return out


def cache_path_of(model: str, var: str, year: int) -> Path:
    return CACHE_DIR / f"{model}_{var}_{year}.json"


def rel_path_of(model: str, member: str, grid: str, var: str, year: int) -> str:
    scen = "historical" if year < 2015 else "ssp245"
    fname = f"{var}_day_{model}_{scen}_{member}_{grid}_{year}_v2.0.nc"
    return f"{model}/{scen}/{member}/{var}/{fname}"


def download_from_s3(rel: str, dest: str, timeout: int = 180) -> None:
    url = f"{S3_BASE}/{rel}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def download_from_ncss(rel: str, var: str, year: int, dest: str, timeout: int = 240) -> None:
    url = (
        f"{NCSS_BASE}/{rel}"
        f"?var={var}&north=50&west=-125&east=-65&south=24"
        f"&time_start={year}-01-01T00:00:00Z&time_end={year}-12-31T23:59:59Z&accept=netcdf4"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def process_one(
    task: tuple[str, str, str, str, int],
    cells: list[str],
    prefer: str,
) -> tuple[str, str, int, str, float]:
    model, member, grid, var, year = task
    cpath = cache_path_of(model, var, year)
    if cpath.exists() and cpath.stat().st_size > 1000:
        return model, var, year, "cached", 0.0

    rel = rel_path_of(model, member, grid, var, year)
    methods = ["s3", "ncss"] if prefer == "s3" else ["ncss", "s3"]
    last_err = ""
    for attempt in range(4):
        src = methods[attempt % 2]
        t0 = time.time()
        fd, tmp_nc = tempfile.mkstemp(prefix=f"nex_{model}_{var}_{year}_", suffix=".nc")
        os.close(fd)
        try:
            if src == "s3":
                download_from_s3(rel, tmp_nc)
            else:
                download_from_ncss(rel, var, year, tmp_nc)
            monthly = extract_monthly_for_year(tmp_nc, var, cells)
            tmp_json = str(cpath) + ".tmp"
            with open(tmp_json, "w", encoding="utf-8") as f:
                json.dump(monthly, f, separators=(",", ":"))
            os.replace(tmp_json, cpath)
            return model, var, year, src, time.time() - t0
        except Exception as e:
            last_err = f"{src}: {e}"
            time.sleep(1.5 * (attempt + 1))
        finally:
            if os.path.exists(tmp_nc):
                try:
                    os.remove(tmp_nc)
                except OSError:
                    pass
    raise RuntimeError(f"Failed {model} {var} {year}: {last_err}")


def compute_and_save_deltas(cells: list[str]) -> dict:
    # Load all cached monthly values: data[model][var][year][cid] -> list of 12 floats
    data: dict[str, dict[str, dict[int, dict[str, list[float]]]]] = {}
    for model, _, _ in MODELS:
        data[model] = {}
        for var in VARS:
            data[model][var] = {}
            for yr in ALL_YEARS:
                cpath = cache_path_of(model, var, yr)
                with open(cpath, encoding="utf-8") as f:
                    data[model][var][yr] = json.load(f)

    clamped_logs = []
    # model_deltas[model][cid] = {"delta_t": [12], "ratio_p": [12]}
    model_deltas: dict[str, dict[str, dict[str, list[float]]]] = {m: {} for m, _, _ in MODELS}

    for model, _, _ in MODELS:
        for cid in cells:
            dt_list = []
            rp_list = []
            for m_idx in range(12):
                b_tas = [data[model]["tas"][yr][cid][m_idx] for yr in BASE_YEARS]
                f_tas = [data[model]["tas"][yr][cid][m_idx] for yr in FUT_YEARS]
                dt = (sum(f_tas) / len(f_tas)) - (sum(b_tas) / len(b_tas))
                dt_list.append(dt)

                b_pr = [data[model]["pr"][yr][cid][m_idx] for yr in BASE_YEARS]
                f_pr = [data[model]["pr"][yr][cid][m_idx] for yr in FUT_YEARS]
                mean_b = sum(b_pr) / len(b_pr)
                mean_f = sum(f_pr) / len(f_pr)
                denom = max(mean_b, MIN_PREC_MM_DAY)
                raw_rp = mean_f / denom
                rp = min(PRECIP_CLAMP[1], max(PRECIP_CLAMP[0], raw_rp))
                if rp != raw_rp or mean_b < MIN_PREC_MM_DAY:
                    clamped_logs.append(
                        f"{model} {cid} mo={m_idx + 1}: mean_B={mean_b:.4f}, mean_F={mean_f:.4f}, raw={raw_rp:.3f} -> {rp:.3f}"
                    )
                rp_list.append(rp)
            model_deltas[model][cid] = {"delta_t": dt_list, "ratio_p": rp_list}

    out_cells: dict[str, dict[str, list[float]]] = {}
    model_names = [m for m, _, _ in MODELS]
    for cid in cells:
        med_dt = []
        med_rp = []
        for m_idx in range(12):
            dts = [model_deltas[m][cid]["delta_t"][m_idx] for m in model_names]
            rps = [model_deltas[m][cid]["ratio_p"][m_idx] for m in model_names]
            med_dt.append(round(float(statistics.median(dts)), 4))
            med_rp.append(round(float(statistics.median(rps)), 4))
        out_cells[cid] = {
            "delta_t2m": med_dt,
            "delta_tmax": med_dt,
            "delta_tmin": med_dt,
            "ratio_p": med_rp,
        }

    payload = {
        "metadata": {
            "source": "NASA NEX-GDDP-CMIP6",
            "scenario": "ssp245",
            "ensemble": "r1i1p1f1",
            "baseline": "2001-2025",
            "future": "2035-2050",
            "models": model_names,
            "vars": VARS,
            "precip_clamp": list(PRECIP_CLAMP),
            "min_baseline_mm_per_day": MIN_PREC_MM_DAY,
            "clamped_count": len(clamped_logs),
        },
        "cells": out_cells,
    }
    tmp_out = str(OUT_DELTAS) + ".tmp"
    with open(tmp_out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    os.replace(tmp_out, OUT_DELTAS)
    print(f"Saved ensemble median deltas for {len(out_cells)} cells -> {OUT_DELTAS}")
    if clamped_logs:
        print(f"Precip guard/clamp triggered on {len(clamped_logs)} model-cell-months (showing first 10):")
        for line in clamped_logs[:10]:
            print("  ", line)
    return payload


def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cells = load_all_cells()
    print(f"Loaded {len(cells)} climate cells", flush=True)

    # Seed from /tmp/test_s3.nc if present and not cached yet
    seed_cache = cache_path_of("ACCESS-CM2", "tas", 2035)
    if not seed_cache.exists() and os.path.exists("/tmp/test_s3.nc"):
        try:
            monthly = extract_monthly_for_year("/tmp/test_s3.nc", "tas", cells)
            with open(seed_cache, "w", encoding="utf-8") as f:
                json.dump(monthly, f, separators=(",", ":"))
            print("Seeded ACCESS-CM2 tas 2035 from /tmp/test_s3.nc", flush=True)
        except Exception as e:
            print("Seed skipped:", e, flush=True)

    tasks: list[tuple[str, str, str, str, int]] = []
    cached_count = 0
    for model, member, grid in MODELS:
        for var in VARS:
            for yr in ALL_YEARS:
                if cache_path_of(model, var, yr).exists():
                    cached_count += 1
                else:
                    tasks.append((model, member, grid, var, yr))

    total = len(MODELS) * len(VARS) * len(ALL_YEARS)
    print(f"Total model-var-years: {total} (cached: {cached_count}, todo: {len(tasks)})", flush=True)

    if tasks:
        q: queue.Queue[tuple[str, str, str, str, int]] = queue.Queue()
        for t in tasks:
            q.put(t)

        done_lock = threading.Lock()
        done = 0
        errors: list[str] = []
        t_start = time.time()

        def worker(prefer: str) -> None:
            nonlocal done
            while True:
                try:
                    task = q.get_nowait()
                except queue.Empty:
                    return
                try:
                    model, var, yr, src, dt = process_one(task, cells, prefer)
                    with done_lock:
                        done += 1
                        el = time.time() - t_start
                        rate = done / (el / 60.0) if el > 0 else 0.0
                        rem = (len(tasks) - done) / rate if rate > 0 else 0.0
                        if done % 5 == 0 or done <= 5 or done == len(tasks):
                            print(
                                f"  [{done}/{len(tasks)}] {model} {var} {yr} via {src} in {dt:.1f}s "
                                f"(elapsed {el/60:.1f}m, {rate:.1f}/min, ETA {rem:.1f}m)",
                                flush=True,
                            )
                except Exception as e:
                    with done_lock:
                        errors.append(str(e))
                        print(f"  [ERR] {e}", flush=True)
                finally:
                    q.task_done()

        # Run 10 S3 workers + 6 THREDDS NCSS workers in parallel
        threads: list[threading.Thread] = []
        for _ in range(10):
            th = threading.Thread(target=worker, args=("s3",), daemon=True)
            th.start()
            threads.append(th)
        for _ in range(6):
            th = threading.Thread(target=worker, args=("ncss",), daemon=True)
            th.start()
            threads.append(th)

        for th in threads:
            th.join()

        if errors:
            raise RuntimeError(f"{len(errors)} tasks failed: {errors[:5]}")

    compute_and_save_deltas(cells)


if __name__ == "__main__":
    main()
