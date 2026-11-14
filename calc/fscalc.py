"""Field Shift 유사도 독립 계산기.

앱 코드(TypeScript)를 하나도 가져오지 않고, 기준 문서의 식만 보고 파이썬으로 다시 짠 계산기다.
앱 엔진과 결과를 맞춰 보는 기준(정답지)으로 쓴다. 표준 라이브러리만 쓴다.

식의 출처
- Field Shift 아키텍처 문서의 "유사도 정의"와 "테이블 값 검사"
- 상위 K, 시프트 기후 게이트, 기후 칸 상한, 패턴 키, 경고 세부 기준: MVP 1차 구현 지시
- 동점 정렬(청크 번호, 패턴 이름, 패턴 키 안의 작물 이름)은 유니코드 문자 코드 순서. 환경마다 결과가
  달라질 수 있는 로캘 비교(localeCompare 등)는 쓰지 않는다.

계산 경로
- 가우시안을 exp(-ln2·r²) 대신 2^(-r²)로 계산한다. 수학적으로 같은 식을 다른 경로로 계산해서,
  앱과 같은 코드를 베낀 실수를 하지 않게 한다.
- 문턱·경계 비교는 전부 소수 9자리에서 반올림한 값으로 한다(문서 "경계 비교"). 계산 경로가 달라도
  판정은 같아야 한다.
"""

from __future__ import annotations

import argparse
import json
import math
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
    # 핵심 닮은 청크는 토양 점수도 이 값 이상이어야 한다. 미만이면서 기후가 climate_only_min 이상이면 "기후만 닮음".
    "soil_min": 65.0,
    "climate_only_min": 80.0,
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


PRECISION = 9


def _exact(x: float) -> float:
    """문턱·경계 비교용. 소수 9자리에서 반올림해 부동소수점 꼬리를 지운다."""
    return round(x, PRECISION)


def grade(x: float) -> int:
    """면적 가중 평균(실수)으로 저장된 배수·침수 등급을 정수 등급으로 분류한다. 반올림, 0.5는 올림."""
    return math.floor(_exact(x) + 0.5)


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
    dr = table[min(abs(grade(a["drainage"]) - grade(b["drainage"])), len(table) - 1)]
    if grade(a["flood"]) != grade(b["flood"]):
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
    if abs(grade(a["drainage"]) - grade(b["drainage"])) >= g["drainage_diff"]:
        out.append("drainage")
    if _exact(abs(a["ph"] - b["ph"])) > g["ph_diff"]:
        out.append("ph")
    if abs(grade(a["flood"]) - grade(b["flood"])) >= g["flood_diff"]:
        out.append("flood")
    if (_exact(a["bedrock_cm"]) < g["bedrock_cm"]) != (_exact(b["bedrock_cm"]) < g["bedrock_cm"]):
        out.append("bedrock")
    if (_exact(a["ec"]) >= g["ec"]) != (_exact(b["ec"]) >= g["ec"]):
        out.append("salinity")
    return out


def status_of(total: float, soil: float, climate: float, n_warn: int) -> str:
    if _exact(total) >= P["tau"] and _exact(soil) >= P["soil_min"]:
        return "twin" if n_warn == 0 else "constrained"
    if _exact(climate) >= P["climate_only_min"] and _exact(soil) < P["soil_min"]:
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


def find_similar(ref: dict, chunks: list[dict], shifted: bool, names: dict | None = None) -> dict:
    names = names or {}
    rp = profile(ref, shifted)
    # 기준 청크 자신과, 2번 이상 나온 작물이 없는 청크(빈 패턴)는 후보가 아니다.
    cands = [
        (c, score_pair(rp, profile(c)))
        for c in chunks
        if c["chunk_id"] != ref["chunk_id"] and pattern_key(c, names) != ""
    ]
    cands.sort(key=lambda x: (-x[1]["total"], x[0]["chunk_id"]))
    gated = [x for x in cands if _exact(x[1]["climate"]) >= P["shift_climate_gate"]] if shifted else cands
    # 닮은 청크 = 종합 ≥ τ 이고 토양 ≥ soil_min (상태가 twin 또는 constrained)
    above = [x for x in gated if x[1]["status"] in ("twin", "constrained")]
    # 기후 칸마다 상한을 먼저 적용하고, 그다음 상위 K개를 자른다. 목록과 윤작 카드가 같은 청크를 쓴다.
    selected = cell_cap(above)[: P["top_k"]]
    similar = [x for x in selected if x[1]["status"] in ("twin", "constrained")]
    return {"gated_count": len(gated), "selected": selected, "similar": similar, "none_found": len(above) == 0}


def pair_verdict(ref: dict, cand: dict, shifted: bool, names: dict | None = None) -> dict:
    """두 청크만 놓고, 후보가 닮은 청크로 뽑힐 조건을 통과하는지 본다. 상위 K와 칸 상한은 여기서 보지 않는다."""
    s = score_pair(profile(ref, shifted), profile(cand))
    reasons = []
    gate_ok = None
    if shifted:
        gate_ok = _exact(s["climate"]) >= P["shift_climate_gate"]
        if not gate_ok:
            reasons.append(f"시프트 기후 게이트 탈락 (기후 {s['climate']:.2f} < {P['shift_climate_gate']:g})")
    if pattern_key(cand, names or {}) == "":
        reasons.append("빈 패턴 (2번 이상 나온 작물 없음)")
    if s["status"] not in ("twin", "constrained"):
        reasons.append(f"상태 {s['status']}")
    return {"score": s, "gate_ok": gate_ok, "eligible": not reasons, "reasons": reasons}


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
    # 칸 상한은 고를 때 이미 적용했다. 고른 닮은 청크를 그대로 센다.
    counted = list(similar)
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


# ---------------------------------------------------------------------------
# 테이블 값 검사 (문서 "테이블 값 검사")
# ---------------------------------------------------------------------------

MISSING = -999  # NASA POWER 결측값

# 열 → (최솟값, 최댓값, 최솟값 포함 여부). None은 그쪽 제한 없음.
RANGES: dict[str, tuple] = {
    "lat": (-90, 90, True),
    "lon": (-180, 180, True),
    "acres": (0, None, True),
    "sand": (0, 100, True),
    "silt": (0, 100, True),
    "clay": (0, 100, True),
    "aws_mm": (0, None, True),
    "drainage": (1, 7, True),
    "flood": (0, 5, True),
    "ph": (3, 11, True),
    "om": (0, None, True),
    "cec": (0, None, True),
    "ec": (0, None, True),
    "slope": (0, None, True),
    "bedrock_cm": (0, 200, False),
}
for _pre in ("", "s_"):
    for _k in PRECIP_KEYS:
        RANGES[_pre + _k] = (0, None, True)
    RANGES[_pre + "ffd"] = (0, 366, True)
    RANGES[_pre + "heat_days"] = (0, 366, True)
    RANGES[_pre + "gwet_summer"] = (0, 1, True)
    RANGES[_pre + "drought_freq"] = (0, 1, True)

TEXT_FIELDS = ["chunk_id", "state", "climate_cell"]
SOIL_FIELDS = ["sand", "silt", "clay", "aws_mm", "drainage", "flood", "ph", "om", "cec", "ec", "slope", "bedrock_cm"]
NUMBER_FIELDS = ["lat", "lon", "acres", *SOIL_FIELDS, *CLIMATE_KEYS, *[f"s_{k}" for k in CLIMATE_KEYS]]
TEXTURE_TOLERANCE = 0.5


class InvalidTable(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__(f"테이블 값 오류 {len(errors)}건")
        self.errors = errors


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate(chunks, names) -> list[str]:
    """테이블과 작물 이름표를 검사해 오류 목록을 돌려준다. 비어 있으면 통과."""
    errs: list[str] = []
    if names is None:
        errs.append("crops.json: 파일이 없음")
    if not isinstance(chunks, list):
        return errs + ["테이블: 행 배열이 아님"]
    seen: dict[str, int] = {}
    for i, row in enumerate(chunks):
        if not isinstance(row, dict):
            errs.append(f"#{i}: 행이 객체가 아님")
            continue
        cid = row.get("chunk_id")
        who = cid if isinstance(cid, str) and cid else f"#{i}"
        for k in TEXT_FIELDS:
            v = row.get(k)
            if not isinstance(v, str) or not v:
                errs.append(f"{who}: {k}={v!r} 빈 값이거나 문자열이 아님")
        for k in NUMBER_FIELDS:
            if k not in row:
                errs.append(f"{who}: {k} 열이 없음")
                continue
            v = row[k]
            if not _is_number(v):
                errs.append(f"{who}: {k}={v!r} 유한한 숫자가 아님")
                continue
            if v == MISSING:
                errs.append(f"{who}: {k}={v} 결측값(-999)")
                continue
            if k in RANGES:
                lo, hi, lo_inclusive = RANGES[k]
                if lo is not None and (v < lo if lo_inclusive else v <= lo):
                    errs.append(f"{who}: {k}={v} 범위 밖({'≥' if lo_inclusive else '>'} {lo})")
                if hi is not None and v > hi:
                    errs.append(f"{who}: {k}={v} 범위 밖(≤ {hi})")
        for k in CROP_KEYS:
            v = row.get(k)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v != int(v):
                errs.append(f"{who}: {k}={v!r} 작물 코드가 정수가 아님")
        if all(_is_number(row.get(k)) for k in ("sand", "silt", "clay")):
            total = row["sand"] + row["silt"] + row["clay"]
            if abs(total - 100) > TEXTURE_TOLERANCE:
                errs.append(f"{who}: sand+silt+clay={_exact(total)} 100 ± {TEXTURE_TOLERANCE}이 아님")
        if isinstance(cid, str) and cid:
            if cid in seen:
                errs.append(f"{who}: chunk_id 중복 (#{seen[cid]}, #{i})")
            else:
                seen[cid] = i
    return errs


def load(data: Path) -> tuple[list[dict], dict]:
    """테이블과 같은 폴더의 crops.json을 읽고 검사한다. 오류가 있으면 InvalidTable."""
    chunks = json.loads(data.read_text(encoding="utf-8"))
    crops_path = data.with_name("crops.json")
    names = json.loads(crops_path.read_text(encoding="utf-8")) if crops_path.exists() else None
    errs = validate(chunks, names)
    if errs:
        raise InvalidTable(errs)
    return chunks, names


def run_ref(ref: dict, chunks: list[dict], names: dict, shifted: bool) -> dict:
    r = find_similar(ref, chunks, shifted, names)
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

    try:
        chunks, names = load(args.data)
    except InvalidTable as e:
        print(f"{args.data}: {e}", file=sys.stderr)
        for line in e.errors[:50]:
            print(f"  {line}", file=sys.stderr)
        if len(e.errors) > 50:
            print(f"  … 외 {len(e.errors) - 50}건", file=sys.stderr)
        sys.exit(2)
    if args.cmd == "pair":
        a, b = by_id(chunks, args.a), by_id(chunks, args.b)
        v = pair_verdict(a, b, args.shift, names)
        s = v["score"]
        print(f"{args.a} → {args.b}{' (시프트)' if args.shift else ''}")
        print(f"종합 {s['total']:.3f}  토양 {s['soil']:.3f}  기후 {s['climate']:.3f}  상태 {s['status']}  경고 {s['warnings']}")
        if args.shift:
            mark = "통과" if v["gate_ok"] else "탈락"
            print(f"시프트 기후 게이트: 기후 {s['climate']:.2f} {'≥' if v['gate_ok'] else '<'} {P['shift_climate_gate']:g} → {mark}")
        if v["eligible"]:
            print("닮은 청크 조건: 통과 (상위 K·기후 칸 상한은 ref 명령에서 적용)")
        else:
            print(f"닮은 청크 조건: 탈락 — {'; '.join(v['reasons'])}")
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
