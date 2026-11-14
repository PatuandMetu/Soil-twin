"""Field Shift 유사도 독립 계산기.

앱 코드(TypeScript)를 하나도 가져오지 않고, 기준 문서의 식만 보고 파이썬으로 다시 짠 계산기다.
앱 엔진과 결과를 맞춰 보는 기준(정답지)으로 쓴다. 표준 라이브러리만 쓴다.

식의 출처
- 유사도 변수, 가중치, 허용 차이, 경고 조건: Field Shift 아키텍처 문서 (스펙 v0.2 기반)
- 상위 K, 시프트 기후 게이트, 기후 칸 상한, 패턴 키, 경고 세부 기준: MVP 1차 구현 지시
- 지시에 없던 세부(상한 적용 후 분모, 빈 패턴, 동점 정렬): 앱 쪽이 보고한 처리 방식을 따른다

앱과 일부러 다르게 한 점
- 가우시안을 exp(-ln2·r²) 대신 2^(-r²)로 계산한다. 수학적으로 같고, 부동소수점 경로만 다르다.
- 경고의 경계 비교는 소수 9자리에서 반올림한 값으로 한다. 7.3과 8.3의 차이는 수학적으로 정확히 1.0이다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 매개변수 (앱 config를 읽지 않고 문서에서 직접 옮긴 값)
# ---------------------------------------------------------------------------

P = {
    "tau": 80.0,
    "top_k": 30,
    "shift_climate_gate": 85.0,
    "cell_cap": 10,
    "pattern_min_count": 2,
    "compare_patterns": 2,
    "climate_only": {"climate_min": 80.0, "soil_max": 65.0},
    "t": {
        "texture": 0.22,
        "aws_mm": 50.0,
        "ph": 0.9,
        "om": 2.2,
        "cec": 9.0,
        "ec": 2.0,
        "t_month": 2.8,
        "p_month": 30.0,
        "ffd": 28.0,
        "gdd10": 450.0,
        "gwet_summer": 0.14,
        "heat_days": 20.0,
        "drought_freq": 0.25,
    },
    "span": {"bedrock_cm": 150.0, "slope": 10.0},
    "drainage_by_diff": [100.0, 75.0, 35.0, 10.0],
    "flood_penalty": 25.0,
    "month_weights": [1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1],
    "weights": {
        "texture": 0.15,
        "aws": 0.10,
        "drainage_flood": 0.10,
        "ph": 0.06,
        "om": 0.03,
        "cec": 0.03,
        "bedrock_salinity": 0.02,
        "slope": 0.06,
        "temp_monthly": 0.10,
        "precip_monthly": 0.10,
        "ffd": 0.05,
        "gdd10": 0.05,
        "gwet_summer": 0.05,
        "heat_days": 0.05,
        "drought_freq": 0.05,
    },
    "soil_items": ["texture", "aws", "drainage_flood", "ph", "om", "cec", "bedrock_salinity", "slope"],
    "gate": {"drainage_diff": 2, "ph_diff": 1.0, "flood_diff": 2, "bedrock_cm": 100.0, "ec": 4.0},
}

MONTHS = [f"{m:02d}" for m in range(1, 13)]
TEMP_KEYS = [f"t_m{m}" for m in MONTHS]
PRECIP_KEYS = [f"p_m{m}" for m in MONTHS]
SCALAR_KEYS = ["ffd", "gdd10", "heat_days", "gwet_summer", "drought_freq"]
CLIMATE_KEYS = TEMP_KEYS + PRECIP_KEYS + SCALAR_KEYS
CROP_KEYS = [f"crop_{y}" for y in range(2018, 2026)]


def _exact(x: float) -> float:
    """경계 비교용. 입력이 소수 몇 자리 값일 때 생기는 부동소수점 꼬리를 지운다."""
    return round(x, 9)


# ---------------------------------------------------------------------------
# 항목 점수
# ---------------------------------------------------------------------------


def gauss(diff: float, t: float) -> float:
    """차이가 t면 50점. 100·2^(-(차이/t)²)."""
    r = abs(diff) / t
    return 100.0 * 2.0 ** (-(r * r))


def linear(diff: float, span: float) -> float:
    return max(0.0, 1.0 - abs(diff) / span) * 100.0


def item_scores(a: dict, b: dict) -> dict[str, float]:
    t = P["t"]
    mw = P["month_weights"]
    d_tex = (abs(a["sand"] - b["sand"]) + abs(a["silt"] - b["silt"]) + abs(a["clay"] - b["clay"])) / 200.0
    table = P["drainage_by_diff"]
    dr = table[min(int(abs(a["drainage"] - b["drainage"])), len(table) - 1)]
    if a["flood"] != b["flood"]:
        dr -= P["flood_penalty"]

    def monthly(keys: list[str], tol: float) -> float:
        return sum(w * gauss(a[k] - b[k], tol) for w, k in zip(mw, keys)) / sum(mw)

    return {
        "texture": gauss(d_tex, t["texture"]),
        "aws": gauss(a["aws_mm"] - b["aws_mm"], t["aws_mm"]),
        "drainage_flood": max(0.0, dr),
        "ph": gauss(a["ph"] - b["ph"], t["ph"]),
        "om": gauss(a["om"] - b["om"], t["om"]),
        "cec": gauss(a["cec"] - b["cec"], t["cec"]),
        "bedrock_salinity": (linear(a["bedrock_cm"] - b["bedrock_cm"], P["span"]["bedrock_cm"]) + gauss(a["ec"] - b["ec"], t["ec"])) / 2.0,
        "slope": linear(a["slope"] - b["slope"], P["span"]["slope"]),
        "temp_monthly": monthly(TEMP_KEYS, t["t_month"]),
        "precip_monthly": monthly(PRECIP_KEYS, t["p_month"]),
        "ffd": gauss(a["ffd"] - b["ffd"], t["ffd"]),
        "gdd10": gauss(a["gdd10"] - b["gdd10"], t["gdd10"]),
        "gwet_summer": gauss(a["gwet_summer"] - b["gwet_summer"], t["gwet_summer"]),
        "heat_days": gauss(a["heat_days"] - b["heat_days"], t["heat_days"]),
        "drought_freq": gauss(a["drought_freq"] - b["drought_freq"], t["drought_freq"]),
    }


def warnings(a: dict, b: dict) -> list[str]:
    g = P["gate"]
    out = []
    if abs(a["drainage"] - b["drainage"]) >= g["drainage_diff"]:
        out.append("drainage")
    if _exact(abs(a["ph"] - b["ph"])) > g["ph_diff"]:
        out.append("ph")
    if abs(a["flood"] - b["flood"]) >= g["flood_diff"]:
        out.append("flood")
    if (a["bedrock_cm"] < g["bedrock_cm"]) != (b["bedrock_cm"] < g["bedrock_cm"]):
        out.append("bedrock")
    if (_exact(a["ec"]) >= g["ec"]) != (_exact(b["ec"]) >= g["ec"]):
        out.append("salinity")
    return out


def status_of(total: float, soil: float, climate: float, n_warn: int) -> str:
    if total >= P["tau"]:
        return "twin" if n_warn == 0 else "constrained"
    co = P["climate_only"]
    if climate >= co["climate_min"] and soil < co["soil_max"]:
        return "climate_only"
    return "none"


def score_pair(a: dict, b: dict) -> dict:
    s = item_scores(a, b)
    w = P["weights"]
    soil_keys = P["soil_items"]
    clim_keys = [k for k in w if k not in soil_keys]
    total = sum(w[k] * s[k] for k in w)
    soil = sum(w[k] * s[k] for k in soil_keys) / sum(w[k] for k in soil_keys)
    climate = sum(w[k] * s[k] for k in clim_keys) / sum(w[k] for k in clim_keys)
    warn = warnings(a, b)
    return {
        "total": total,
        "soil": soil,
        "climate": climate,
        "items": {k: {"score": s[k], "weight": w[k], "penalty": w[k] * (100.0 - s[k])} for k in w},
        "warnings": warn,
        "status": status_of(total, soil, climate, len(warn)),
    }


def profile(chunk: dict, shifted: bool = False) -> dict:
    p = dict(chunk)
    if shifted:
        for k in CLIMATE_KEYS:
            p[k] = chunk[f"s_{k}"]
    return p


# ---------------------------------------------------------------------------
# 고르기
# ---------------------------------------------------------------------------


def find_similar(ref: dict, chunks: list[dict], shifted: bool) -> dict:
    rp = profile(ref, shifted)
    cands = [(c, score_pair(rp, profile(c))) for c in chunks if c["chunk_id"] != ref["chunk_id"]]
    cands.sort(key=lambda x: (-x[1]["total"], x[0]["chunk_id"]))
    gated = [x for x in cands if x[1]["climate"] >= P["shift_climate_gate"]] if shifted else cands
    above = [x for x in gated if x[1]["total"] >= P["tau"]]
    selected = above[: P["top_k"]]
    similar = [x for x in selected if x[1]["status"] in ("twin", "constrained")]
    return {"gated_count": len(gated), "selected": selected, "similar": similar, "none_found": len(above) == 0}


# ---------------------------------------------------------------------------
# 윤작 집계
# ---------------------------------------------------------------------------


def crop_name(code: int, names: dict) -> str:
    return names.get(str(code), f"CDL {code}")


def pattern_key(chunk: dict, names: dict) -> str:
    counts: dict[str, int] = {}
    for k in CROP_KEYS:
        n = crop_name(chunk[k], names)
        counts[n] = counts.get(n, 0) + 1
    return "+".join(sorted(n for n, c in counts.items() if c >= P["pattern_min_count"]))


def cell_cap(similar: list) -> list:
    seen: dict[str, int] = {}
    out = []
    for c, s in sorted(similar, key=lambda x: (-x[1]["total"], x[0]["chunk_id"])):
        n = seen.get(c["climate_cell"], 0)
        if n >= P["cell_cap"]:
            continue
        seen[c["climate_cell"]] = n + 1
        out.append((c, s))
    return out


def summarize(ref: dict, similar: list, names: dict) -> dict:
    counted = cell_cap(similar)
    total = len(counted)
    total_acres = sum(c["acres"] for c, _ in counted)
    groups: dict[str, list] = {}
    for c, s in counted:
        groups.setdefault(pattern_key(c, names), []).append((c, s))

    def stat(key: str) -> dict:
        xs = groups.get(key, [])
        acres = sum(c["acres"] for c, _ in xs)
        return {
            "key": key,
            "count": len(xs),
            "total": total,
            "acres": acres,
            "total_acres": total_acres,
            "area_share": acres / total_acres if total_acres > 0 else 0.0,
            "cell_count": len({c["climate_cell"] for c, _ in xs}),
            "warned_count": sum(1 for _, s in xs if s["warnings"]),
        }

    patterns = sorted((stat(k) for k in groups), key=lambda p: (-p["count"], -p["acres"], p["key"]))
    current = stat(pattern_key(ref, names))
    others = [p for p in patterns if p["key"] != current["key"]][: P["compare_patterns"]]
    return {"counted": [c["chunk_id"] for c, _ in counted], "patterns": patterns, "cards": [current, *others]}


# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------


def load(data: Path) -> tuple[list[dict], dict]:
    chunks = json.loads(data.read_text(encoding="utf-8"))
    crops_path = data.with_name("crops.json")
    names = json.loads(crops_path.read_text(encoding="utf-8")) if crops_path.exists() else {}
    return chunks, names


def run_ref(ref: dict, chunks: list[dict], names: dict, shifted: bool) -> dict:
    r = find_similar(ref, chunks, shifted)
    summ = summarize(ref, r["similar"], names)
    return {
        "ref": ref["chunk_id"],
        "shifted": shifted,
        "gated_count": r["gated_count"],
        "none_found": r["none_found"],
        "selected": [
            {"id": c["chunk_id"], "total": s["total"], "soil": s["soil"], "climate": s["climate"], "status": s["status"], "warnings": s["warnings"]}
            for c, s in r["selected"]
        ],
        "cards": summ["cards"],
        "counted": summ["counted"],
    }


def by_id(chunks: list[dict], cid: str) -> dict:
    for c in chunks:
        if c["chunk_id"] == cid:
            return c
    sys.exit(f"청크 {cid}를 찾지 못했습니다")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Field Shift 유사도 독립 계산기")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("pair", help="두 청크의 항목별 점수")
    p1.add_argument("data", type=Path)
    p1.add_argument("a")
    p1.add_argument("b")
    p1.add_argument("--shift", action="store_true", help="a의 기후를 시프트 값으로")
    p2 = sub.add_parser("ref", help="기준 청크 하나의 닮은 청크와 윤작 카드")
    p2.add_argument("data", type=Path)
    p2.add_argument("ref")
    p2.add_argument("--shift", action="store_true")
    p2.add_argument("--json", action="store_true")
    p3 = sub.add_parser("all", help="모든 청크를 기준으로 두 모드 결과를 JSON으로")
    p3.add_argument("data", type=Path)
    args = ap.parse_args(argv)

    chunks, names = load(args.data)
    if args.cmd == "pair":
        a, b = by_id(chunks, args.a), by_id(chunks, args.b)
        s = score_pair(profile(a, args.shift), profile(b))
        print(f"{args.a} → {args.b}{' (시프트)' if args.shift else ''}")
        print(f"종합 {s['total']:.3f}  토양 {s['soil']:.3f}  기후 {s['climate']:.3f}  상태 {s['status']}  경고 {s['warnings']}")
        print(f"{'항목':<18}{'가중치':>8}{'점수':>10}{'감점':>9}")
        for k, it in sorted(s["items"].items(), key=lambda x: -x[1]["penalty"]):
            print(f"{k:<18}{it['weight']:>8.2f}{it['score']:>10.3f}{it['penalty']:>9.3f}")
    elif args.cmd == "ref":
        out = run_ref(by_id(chunks, args.ref), chunks, names, args.shift)
        if args.json:
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return
        print(f"기준 {out['ref']}{' (시프트)' if args.shift else ''}  닮은 청크 {len(out['selected'])}개  없음={out['none_found']}")
        for x in out["selected"]:
            print(f"  {x['id']:<8}{x['total']:>8.2f}{x['soil']:>8.2f}{x['climate']:>8.2f}  {x['status']:<12}{','.join(x['warnings'])}")
        for i, cd in enumerate(out["cards"]):
            label = "현재 윤작" if i == 0 else f"흔한 패턴 {i}"
            print(f"  [{label}] {cd['key'] or '(2번 이상 나온 작물 없음)'}  {cd['count']}/{cd['total']}  면적 {cd['area_share']:.1%}  칸 {cd['cell_count']}  경고 {cd['warned_count']}")
    else:
        res = [run_ref(c, chunks, names, sh) for c in chunks for sh in (False, True)]
        print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
