"""앱 엔진(TypeScript)과 이 계산기의 결과를 모든 기준 청크·두 모드에서 맞춰 본다.

실행: python3 crosscheck.py [앱 frontend 폴더] [데이터 파일]
  인자 없이 돌리면 이 저장소의 ../frontend와 그 안의 public/data/chunks.json(실데이터)을 쓴다.

앱 폴더는 읽기만 한다. 엔진을 그 폴더의 rolldown으로 임시 폴더에 묶어 node로 돌린다.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import fscalc as F

TOL = 1e-9

DRIVER = """
import { readFileSync } from 'node:fs'
import { findSimilar, summarizeRotations } from '__ENGINE__'
const [dataPath, cropsPath] = process.argv.slice(2)
const chunks = JSON.parse(readFileSync(dataPath, 'utf8'))
const crops = JSON.parse(readFileSync(cropsPath, 'utf8'))
const out = []
for (const ref of chunks) for (const shifted of [false, true]) {
  const r = findSimilar(ref, chunks, shifted)
  const s = summarizeRotations(ref, r.similar, crops)
  out.push({
    ref: ref.chunk_id, shifted, gated_count: r.gatedCount, none_found: r.noneFound,
    selected: r.selected.map(x => ({ id: x.chunk.chunk_id, total: x.score.total, soil: x.score.soil,
      climate: x.score.climate, status: x.score.status, warnings: x.score.warnings.map(w => w.code) })),
    counted: s.counted.map(x => x.chunk.chunk_id),
    cards: s.cards.map(p => ({ key: p.key, count: p.count, total: p.total, acres: p.acres,
      area_share: p.areaShare, cell_count: p.cellCount, warned_count: p.warnedCount })),
  })
}
process.stdout.write(JSON.stringify(out))
"""


def run_engine(frontend: Path, data: Path) -> list[dict]:
    engine = frontend / "src" / "engine" / "index.ts"
    with tempfile.TemporaryDirectory(prefix="fscalc-") as tmp:
        drv = Path(tmp) / "driver.ts"
        out = Path(tmp) / "driver.mjs"
        drv.write_text(DRIVER.replace("__ENGINE__", str(engine)), encoding="utf-8")
        subprocess.run(
            ["npx", "--no-install", "rolldown", str(drv), "-o", str(out), "-f", "esm", "-p", "node"],
            cwd=frontend, check=True, capture_output=True,
        )
        res = subprocess.run(["node", str(out), str(data), str(data.with_name("crops.json"))], check=True, capture_output=True, text=True)
        return json.loads(res.stdout)


def compare(app: dict, calc: dict) -> list[str]:
    diffs = []
    for k in ("gated_count", "none_found"):
        if app[k] != calc[k]:
            diffs.append(f"{k}: 앱 {app[k]} / 계산기 {calc[k]}")
    a_ids = [x["id"] for x in app["selected"]]
    c_ids = [x["id"] for x in calc["selected"]]
    if a_ids != c_ids:
        diffs.append(f"고른 청크가 다름: 앱만 {sorted(set(a_ids) - set(c_ids))}, 계산기만 {sorted(set(c_ids) - set(a_ids))}, 순서 같음={sorted(a_ids) == sorted(c_ids)}")
    calc_by = {x["id"]: x for x in calc["selected"]}
    for x in app["selected"]:
        y = calc_by.get(x["id"])
        if not y:
            continue
        for k in ("total", "soil", "climate"):
            if abs(x[k] - y[k]) > TOL:
                diffs.append(f"{x['id']} {k}: 앱 {x[k]!r} / 계산기 {y[k]!r}")
        if x["status"] != y["status"]:
            diffs.append(f"{x['id']} 상태: 앱 {x['status']} / 계산기 {y['status']}")
        if sorted(x["warnings"]) != sorted(y["warnings"]):
            diffs.append(f"{x['id']} 경고: 앱 {x['warnings']} / 계산기 {y['warnings']}")
    if app["counted"] != calc["counted"]:
        diffs.append("기후 칸 상한 뒤 센 청크가 다름")
    if len(app["cards"]) != len(calc["cards"]):
        diffs.append(f"카드 수: 앱 {len(app['cards'])} / 계산기 {len(calc['cards'])}")
    for i, (p, q) in enumerate(zip(app["cards"], calc["cards"])):
        for k in ("key", "count", "total", "acres", "cell_count", "warned_count"):
            if p[k] != q[k]:
                diffs.append(f"카드 {i} {k}: 앱 {p[k]!r} / 계산기 {q[k]!r}")
        if abs(p["area_share"] - q["area_share"]) > TOL:
            diffs.append(f"카드 {i} 면적 비중: 앱 {p['area_share']} / 계산기 {q['area_share']}")
    return diffs


def main() -> None:
    default_frontend = Path(__file__).resolve().parent.parent / "frontend"
    frontend = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else default_frontend
    data = Path(sys.argv[2]).expanduser().resolve() if len(sys.argv) > 2 else frontend / "public" / "data" / "chunks.json"
    chunks, names = F.load(data)
    app = run_engine(frontend, data)
    calc = [F.run_ref(c, chunks, names, sh) for c in chunks for sh in (False, True)]
    max_dt = 0.0
    bad = 0
    for a, c in zip(app, calc):
        assert (a["ref"], a["shifted"]) == (c["ref"], c["shifted"])
        cb = {x["id"]: x for x in c["selected"]}
        for x in a["selected"]:
            if x["id"] in cb:
                max_dt = max(max_dt, abs(x["total"] - cb[x["id"]]["total"]))
        d = compare(a, c)
        if d:
            bad += 1
            print(f"[다름] 기준 {a['ref']} {'시프트' if a['shifted'] else '현재'}")
            for line in d:
                print(f"    {line}")
    print(f"\n비교한 경우 {len(app)}개 (청크 {len(chunks)} × 2모드), 다른 경우 {bad}개, 종합 점수 최대 차이 {max_dt:.2e}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
