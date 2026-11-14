"""손으로 계산한 값으로 계산기를 검사한다. 실행: python3 -m unittest -v

기대값은 식에 손으로 대입해 얻은 것이다. 가우시안은 차이/허용차이 비율 r에 대해 100·2^(-r²)이라
r = 0.5 → 100·2^(-1/4) ≈ 84.0896, r = 1 → 50, r = 2 → 6.25 처럼 손으로 확인할 수 있다.
"""

import json
import math
import tempfile
import unittest
from pathlib import Path

import fscalc as F

HALF = 84.08964152537145  # 100·2^(-0.25)


def base() -> dict:
    """모든 값이 같은 기본 청크."""
    row = {
        "chunk_id": "X",
        "climate_cell": "C",
        "acres": 100,
        "sand": 40.0,
        "silt": 40.0,
        "clay": 20.0,
        "aws_mm": 180.0,
        "drainage": 3,
        "flood": 0,
        "ph": 6.5,
        "om": 3.0,
        "cec": 18.0,
        "ec": 0.5,
        "slope": 2.0,
        "bedrock_cm": 200.0,
        "ffd": 160.0,
        "gdd10": 1600.0,
        "heat_days": 10.0,
        "gwet_summer": 0.5,
        "drought_freq": 0.2,
    }
    for i, k in enumerate(F.TEMP_KEYS):
        row[k] = float(i)
    for i, k in enumerate(F.PRECIP_KEYS):
        row[k] = 50.0 + i
    for k in F.CLIMATE_KEYS:
        row[f"s_{k}"] = row[k]
    for k in F.CROP_KEYS:
        row[k] = 1
    return row


def with_(**kw) -> dict:
    r = base()
    r.update(kw)
    return r


def full_row(**kw) -> dict:
    """검사를 통과하는 완전한 행."""
    r = base()
    r.update(lat=42.0, lon=-93.5, state="IA")
    r.update(kw)
    return r


FAKE = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data" / "chunks.fake.json"


class Validation(unittest.TestCase):
    """틀린 값을 실제로 넣어 보고, 어느 행의 어느 열이 틀렸는지 잡는지 본다."""

    def errs(self, *rows, names=None):
        return F.validate(list(rows), {"1": "Corn"} if names is None else names)

    def assertCaught(self, field, **bad):
        errs = self.errs(full_row(**bad))
        self.assertTrue(any(f" {field}" in e for e in errs), f"{field} 오류를 못 잡음: {errs}")

    def test_good_row_passes(self):
        self.assertEqual(self.errs(full_row()), [])

    def test_fake_table_passes(self):
        chunks, _ = F.load(FAKE)
        self.assertEqual(len(chunks), 60)

    def test_missing_and_non_numbers(self):
        r = full_row()
        del r["ph"]
        self.assertTrue(any("ph 열이 없음" in e for e in self.errs(r)))
        self.assertCaught("om", om=None)
        self.assertCaught("cec", cec="18")
        self.assertCaught("slope", slope=math.nan)
        self.assertCaught("aws_mm", aws_mm=math.inf)
        self.assertCaught("sand", sand=True)

    def test_power_missing_value(self):
        self.assertCaught("t_m07", t_m07=-999)
        self.assertCaught("s_gdd10", s_gdd10=-999.0)

    def test_ranges(self):
        for field, value in [
            ("drainage", 0.4), ("drainage", 7.6), ("flood", -1), ("flood", 5.5), ("ph", 2.9), ("ph", 11.5),
            ("bedrock_cm", 0), ("bedrock_cm", 250), ("om", -0.1), ("ec", -1), ("gwet_summer", 1.2),
            ("drought_freq", -0.1), ("ffd", 400), ("heat_days", -3), ("p_m05", -1), ("s_p_m05", -1), ("acres", -5),
        ]:
            with self.subTest(field=field, value=value):
                self.assertCaught(field, **{field: value})

    def test_range_edges_pass(self):
        self.assertEqual(self.errs(full_row(drainage=1, flood=0, bedrock_cm=200, ph=3, gwet_summer=1)), [])
        self.assertEqual(self.errs(full_row(drainage=7, flood=5, bedrock_cm=0.1, ph=11, drought_freq=0)), [])

    def test_texture_sum(self):
        self.assertCaught("sand+silt+clay", sand=40.0, silt=40.0, clay=19.4)  # 99.4
        self.assertEqual(self.errs(full_row(sand=40.0, silt=40.0, clay=19.5)), [])  # 99.5 → 허용

    def test_crop_codes(self):
        self.assertCaught("crop_2020", crop_2020=1.5)
        self.assertCaught("crop_2021", crop_2021=None)
        self.assertCaught("crop_2022", crop_2022="1")

    def test_text_fields(self):
        self.assertCaught("climate_cell", climate_cell="")
        errs = self.errs(full_row(chunk_id=None))
        self.assertTrue(any(e.startswith("#0: chunk_id") for e in errs), errs)

    def test_duplicate_ids(self):
        errs = self.errs(full_row(chunk_id="A"), full_row(chunk_id="A"))
        self.assertTrue(any("chunk_id 중복" in e for e in errs), errs)

    def test_crops_file_missing(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / "chunks.json"
            data.write_text(json.dumps([full_row()]), encoding="utf-8")
            with self.assertRaises(F.InvalidTable) as cm:
                F.load(data)
            self.assertIn("crops.json: 파일이 없음", cm.exception.errors)

    def test_every_error_is_reported(self):
        errs = self.errs(full_row(chunk_id="A", ph=20, om=None), full_row(chunk_id="B", drainage=9))
        self.assertEqual(len(errs), 3)


class Basics(unittest.TestCase):
    def test_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(F.P["weights"].values()), 1.0, places=12)

    def test_soil_block_weight_is_055(self):
        self.assertAlmostEqual(sum(F.P["weights"][k] for k in F.P["soil_items"]), 0.55, places=12)

    def test_same_row_is_100(self):
        s = F.score_pair(base(), base())
        self.assertAlmostEqual(s["total"], 100.0, places=9)
        self.assertEqual(s["status"], "twin")
        self.assertEqual(s["warnings"], [])

    def test_gauss_points(self):
        self.assertAlmostEqual(F.gauss(2.8, 2.8), 50.0, places=9)
        self.assertAlmostEqual(F.gauss(1.4, 2.8), HALF, places=9)
        self.assertAlmostEqual(F.gauss(-5.6, 2.8), 6.25, places=9)


class Items(unittest.TestCase):
    def score(self, **kw):
        return F.item_scores(base(), with_(**kw))

    def test_texture_distance(self):
        # Δsand 11, Δclay 11 → 22/200 = 0.11 = 허용차이 0.22의 절반
        self.assertAlmostEqual(self.score(sand=51.0, silt=40.0, clay=9.0)["texture"], HALF, places=9)

    def test_aws(self):
        self.assertAlmostEqual(self.score(aws_mm=230.0)["aws"], 50.0, places=9)

    def test_drainage_table(self):
        for d, want in [(1, 75.0), (2, 35.0), (3, 10.0), (4, 10.0)]:
            self.assertEqual(self.score(drainage=3 + d)["drainage_flood"], want)

    def test_flood_penalty_and_floor(self):
        self.assertEqual(self.score(drainage=5, flood=1)["drainage_flood"], 10.0)  # 35 − 25
        self.assertEqual(self.score(drainage=6, flood=1)["drainage_flood"], 0.0)  # 10 − 25 → 0

    def test_bedrock_salinity_average(self):
        # 암반 75 cm 차이 → 선형 50점, ec 같음 → 100점, 평균 75
        self.assertAlmostEqual(self.score(bedrock_cm=125.0)["bedrock_salinity"], 75.0, places=9)
        # 암반 같음 100점, ec 2.0 차이 → 50점, 평균 75
        self.assertAlmostEqual(self.score(ec=2.5)["bedrock_salinity"], 75.0, places=9)

    def test_slope_linear(self):
        self.assertAlmostEqual(self.score(slope=7.0)["slope"], 50.0, places=9)
        self.assertEqual(self.score(slope=14.0)["slope"], 0.0)

    def test_monthly_weights(self):
        # 1월만 2.8℃ 차이 → 1월 50점, 나머지 100점 → (1·50 + 17·100) / 18
        self.assertAlmostEqual(self.score(t_m01=2.8)["temp_monthly"], (50 + 1700) / 18, places=9)
        # 7월만 차이 → 가중치 2 → (2·50 + 16·100) / 18
        self.assertAlmostEqual(self.score(t_m07=6.0 + 2.8)["temp_monthly"], (100 + 1600) / 18, places=9)
        # 강수: 4월만 30 mm 차이
        self.assertAlmostEqual(self.score(p_m04=53.0 + 30.0)["precip_monthly"], (100 + 1600) / 18, places=9)


class Grades(unittest.TestCase):
    """배수·침수 등급은 실수로 저장하고 반올림(0.5는 올림)해서 정수 등급으로 쓴다."""

    def test_grade_rounding(self):
        self.assertEqual([F.grade(x) for x in (4.5, 4.49, 4.0, 1.5, 0.49, 5.5)], [5, 4, 4, 2, 0, 6])

    def test_drainage_uses_grade(self):
        s = F.item_scores
        self.assertEqual(s(base(), with_(drainage=3.49))["drainage_flood"], 100.0)  # 3 → 3
        self.assertEqual(s(base(), with_(drainage=3.5))["drainage_flood"], 75.0)  # 3 → 4
        self.assertEqual(s(base(), with_(drainage=4.5))["drainage_flood"], 35.0)  # 3 → 5

    def test_flood_uses_grade(self):
        self.assertEqual(F.item_scores(base(), with_(flood=0.4))["drainage_flood"], 100.0)  # 0 → 0, 감점 없음
        self.assertEqual(F.item_scores(base(), with_(flood=0.5))["drainage_flood"], 75.0)  # 0 → 1, 100 − 25

    def test_warnings_use_grade(self):
        self.assertEqual(F.warnings(base(), with_(drainage=4.49)), [])  # 3 vs 4
        self.assertEqual(F.warnings(base(), with_(drainage=4.5)), ["drainage"])  # 3 vs 5
        self.assertEqual(F.warnings(base(), with_(flood=1.5)), ["flood"])  # 0 vs 2


class Rules(unittest.TestCase):
    """문서의 규칙이 바뀌면 실패해야 하는 테스트. 값(허용 차이 등)은 P에서 읽고, 연결과 구조를 본다."""

    def test_each_gaussian_item_uses_its_own_tolerance(self):
        # 각 항목에 그 항목의 허용 차이만큼 차이를 주면 50점. 다른 항목의 허용 차이를 잘못 쓰면 실패한다.
        cases = {"aws": "aws_mm", "ph": "ph", "om": "om", "cec": "cec", "ffd": "ffd", "gdd10": "gdd10",
                 "gwet_summer": "gwet_summer", "heat_days": "heat_days", "drought_freq": "drought_freq"}
        for item, field in cases.items():
            with self.subTest(item=item):
                t = F.P["t"][field]
                s = F.item_scores(base(), with_(**{field: base()[field] + t}))
                self.assertAlmostEqual(s[item], 50.0, places=9)
                self.assertEqual([k for k, v in s.items() if abs(v - 100.0) > 1e-9], [item])

    def test_ec_and_texture_use_their_tolerance(self):
        t = F.P["t"]
        self.assertAlmostEqual(F.item_scores(base(), with_(ec=0.5 + t["ec"]))["bedrock_salinity"], 75.0, places=9)
        d = t["texture"] * 200 / 2  # 모래 +d, 점토 −d → 거리 = t
        self.assertAlmostEqual(F.item_scores(base(), with_(sand=40.0 + d, clay=20.0 - d))["texture"], 50.0, places=9)

    def test_month_weights_follow_growing_season(self):
        # 문서: 4~9월은 2배. 달마다 하나씩만 차이를 줘서 그 달의 가중치를 확인한다.
        t = F.P["t"]["t_month"]
        for i, key in enumerate(F.TEMP_KEYS):
            w = 2 if 3 <= i <= 8 else 1
            with self.subTest(month=i + 1):
                got = F.item_scores(base(), with_(**{key: base()[key] + t}))["temp_monthly"]
                self.assertAlmostEqual(got, (w * 50 + (18 - w) * 100) / 18, places=9)
        tp = F.P["t"]["p_month"]
        for i, key in enumerate(F.PRECIP_KEYS):
            w = 2 if 3 <= i <= 8 else 1
            with self.subTest(precip_month=i + 1):
                got = F.item_scores(base(), with_(**{key: base()[key] + tp}))["precip_monthly"]
                self.assertAlmostEqual(got, (w * 50 + (18 - w) * 100) / 18, places=9)

    def test_reference_is_never_a_candidate(self):
        # 기준 청크와 똑같은 다른 청크가 없을 때도 기준 청크 자신은 후보가 아니다.
        ref = with_(chunk_id="R")
        others = [with_(chunk_id=f"N{i}", slope=3.0 + i) for i in range(3)]
        r = F.find_similar(ref, [ref, *others], shifted=False)
        ids = [c["chunk_id"] for c, _ in r["selected"]]
        self.assertNotIn("R", ids)
        self.assertEqual(ids, ["N0", "N1", "N2"])

    def test_below_tau_is_filtered_even_when_fewer_than_k(self):
        ref = with_(chunk_id="R")
        hi = with_(chunk_id="HI", slope=4.0)  # 97.6
        lo = with_(chunk_id="LO", drainage=6, flood=1, slope=12.0, aws_mm=280.0)  # 80 미만
        r = F.find_similar(ref, [ref, hi, lo], shifted=False)
        self.assertLess(F.score_pair(ref, lo)["total"], F.P["tau"])
        self.assertEqual([c["chunk_id"] for c, _ in r["selected"]], ["HI"])

    def test_cell_cap_with_unsorted_input_and_two_cells(self):
        sim = [(with_(chunk_id=f"A{i:02d}", climate_cell="C1"), {"total": 90.0 - i, "warnings": []}) for i in range(12)]
        sim += [(with_(chunk_id=f"B{i:02d}", climate_cell="C2"), {"total": 95.0 - i, "warnings": []}) for i in range(3)]
        sim.reverse()
        kept = [c["chunk_id"] for c, _ in F.cell_cap(sim)]
        self.assertEqual(kept[:3], ["B00", "B01", "B02"])
        self.assertEqual(sorted(k for k in kept if k.startswith("A")), [f"A{i:02d}" for i in range(10)])

    def test_patterns_tie_on_count_broken_by_area(self):
        names = {"1": "Corn", "5": "Soybeans", "24": "Winter Wheat", "61": "Fallow/Idle Cropland"}

        def seq(codes, **kw):
            r = with_(**kw)
            for k, c in zip(F.CROP_KEYS, codes):
                r[k] = c
            return r

        sim = [
            (seq([1, 5] * 4, chunk_id="A", acres=100), {"total": 95.0, "warnings": []}),
            (seq([24, 61] * 4, chunk_id="B", acres=300), {"total": 94.0, "warnings": []}),
        ]
        s = F.summarize(seq([1] * 8, chunk_id="R"), sim, names)
        self.assertEqual([p["key"] for p in s["patterns"]], ["Fallow/Idle Cropland+Winter Wheat", "Corn+Soybeans"])


class Total(unittest.TestCase):
    def test_only_slope_differs(self):
        # 경사만 50점 → 종합 = 100 − 0.06·50 = 97, 토양 블록 = 100 − 0.06·50/0.55
        s = F.score_pair(base(), with_(slope=7.0))
        self.assertAlmostEqual(s["total"], 97.0, places=9)
        self.assertAlmostEqual(s["soil"], 100 - 3 / 0.55, places=9)
        self.assertAlmostEqual(s["climate"], 100.0, places=9)
        self.assertAlmostEqual(s["items"]["slope"]["penalty"], 3.0, places=9)

    def test_penalties_add_up(self):
        s = F.score_pair(base(), with_(slope=7.0, ph=7.4, t_m05=6.0, drainage=4))
        self.assertAlmostEqual(sum(i["penalty"] for i in s["items"].values()), 100 - s["total"], places=9)


class Warnings(unittest.TestCase):
    def warn(self, a, b):
        return F.warnings(a, b)

    def test_ph_exact_boundary(self):
        # 수학적으로 정확히 1.0 차이 → 경고 없음 (7.3 vs 8.3은 부동소수점으로 1.0000000000000009)
        self.assertEqual(self.warn(with_(ph=7.3), with_(ph=8.3)), [])
        self.assertEqual(self.warn(with_(ph=7.3), with_(ph=8.4)), ["ph"])

    def test_each_rule(self):
        self.assertEqual(self.warn(base(), with_(drainage=5)), ["drainage"])
        self.assertEqual(self.warn(base(), with_(drainage=4)), [])
        self.assertEqual(self.warn(base(), with_(flood=2)), ["flood"])
        self.assertEqual(self.warn(base(), with_(flood=1)), [])
        self.assertEqual(self.warn(base(), with_(bedrock_cm=99.0)), ["bedrock"])
        self.assertEqual(self.warn(with_(bedrock_cm=100.0), with_(bedrock_cm=200.0)), [])
        self.assertEqual(self.warn(base(), with_(ec=4.0)), ["salinity"])
        self.assertEqual(self.warn(base(), with_(ec=3.99)), [])


class Boundary(unittest.TestCase):
    """문턱은 "이상(≥)"이고, 비교는 소수 9자리 반올림 뒤에 한다 (문서 "경계 비교")."""

    def exact80(self, **extra):
        # 감점: 배수 2단계+침수 다름 → 10점(감점 9), 유효수분 r=1(5), 경사 5(3), 유기물 r=1(1.5), CEC r=1(1.5) → 합 20
        kw = dict(chunk_id="E", drainage=5, flood=1, aws_mm=230.0, slope=7.0, om=5.2, cec=27.0)
        kw.update(extra)
        return with_(**kw)

    def test_total_exactly_tau_is_selected(self):
        ref, cand = with_(chunk_id="R"), self.exact80()
        s = F.score_pair(ref, cand)
        self.assertAlmostEqual(s["total"], 80.0, places=9)
        self.assertEqual(s["status"], "constrained")  # 배수 2단계 차이 경고
        r = F.find_similar(ref, [ref, cand], shifted=False)
        self.assertEqual([c["chunk_id"] for c, _ in r["selected"]], ["E"])

    def test_just_below_tau_is_not_selected(self):
        ref, cand = with_(chunk_id="R"), self.exact80(slope=7.01)
        r = F.find_similar(ref, [ref, cand], shifted=False)
        self.assertEqual(r["selected"], [])
        self.assertTrue(r["none_found"])

    def test_shift_gate_is_inclusive(self):
        ref = with_(chunk_id="R")
        for k in F.TEMP_KEYS:
            ref[f"s_{k}"] = ref[k] + 1.4
        cand = with_(chunk_id="C")
        climate = F.score_pair(F.profile(ref, True), cand)["climate"]
        old = F.P["shift_climate_gate"]
        self.addCleanup(F.P.__setitem__, "shift_climate_gate", old)
        F.P["shift_climate_gate"] = F._exact(climate)  # 게이트와 정확히 같으면 통과
        self.assertEqual(F.find_similar(ref, [ref, cand], shifted=True)["gated_count"], 1)
        F.P["shift_climate_gate"] = F._exact(climate) + 1e-6  # 조금이라도 낮으면 탈락
        self.assertEqual(F.find_similar(ref, [ref, cand], shifted=True)["gated_count"], 0)


class Status(unittest.TestCase):
    def test_tau_wins_over_climate_only(self):
        self.assertEqual(F.status_of(80.2, 64.0, 100.0, 0), "twin")
        self.assertEqual(F.status_of(80.2, 64.0, 100.0, 1), "constrained")

    def test_climate_only(self):
        self.assertEqual(F.status_of(79.9, 64.9, 80.0, 0), "climate_only")
        self.assertEqual(F.status_of(79.9, 65.0, 80.0, 0), "none")


class Rotation(unittest.TestCase):
    names = {"1": "Corn", "5": "Soybeans", "24": "Winter Wheat"}

    def seq(self, codes, **kw):
        r = with_(**kw)
        for k, c in zip(F.CROP_KEYS, codes):
            r[k] = c
        return r

    def test_pattern_key(self):
        self.assertEqual(F.pattern_key(self.seq([1, 5] * 4), self.names), "Corn+Soybeans")
        self.assertEqual(F.pattern_key(self.seq([1, 5, 1, 5, 1, 5, 1, 24]), self.names), "Corn+Soybeans")
        self.assertEqual(F.pattern_key(self.seq([1, 5, 24, 99, 98, 97, 96, 95]), self.names), "")

    def test_summary_counts(self):
        ref = self.seq([1] * 8, chunk_id="R")
        sim = [
            (self.seq([1, 5] * 4, chunk_id="A", climate_cell="C1", acres=100), {"total": 95.0, "warnings": []}),
            (self.seq([1, 5] * 4, chunk_id="B", climate_cell="C2", acres=300), {"total": 90.0, "warnings": ["ph"]}),
            (self.seq([1] * 8, chunk_id="C", climate_cell="C1", acres=100), {"total": 85.0, "warnings": []}),
        ]
        s = F.summarize(ref, sim, self.names)
        cur, top = s["cards"][0], s["cards"][1]
        self.assertEqual((cur["key"], cur["count"], cur["total"]), ("Corn", 1, 3))
        self.assertAlmostEqual(cur["area_share"], 0.2, places=12)
        self.assertEqual((top["key"], top["count"], top["cell_count"], top["warned_count"]), ("Corn+Soybeans", 2, 2, 1))
        self.assertAlmostEqual(top["area_share"], 0.8, places=12)

    def test_empty_pattern_is_excluded(self):
        ref = self.seq([1, 5] * 4, chunk_id="R")
        mixed = [1, 5, 24, 99, 98, 97, 96, 95]  # 2번 이상 나온 작물 없음
        sim = [
            (self.seq([1, 5] * 4, chunk_id="A", climate_cell="C1", acres=100), {"total": 95.0, "warnings": []}),
            (self.seq(mixed, chunk_id="B", climate_cell="C1", acres=900), {"total": 99.0, "warnings": []}),
        ]
        s = F.summarize(ref, sim, self.names)
        self.assertEqual(s["counted"], ["A"])
        self.assertEqual([c["key"] for c in s["cards"]], ["Corn+Soybeans"])
        self.assertEqual((s["cards"][0]["count"], s["cards"][0]["total"]), (1, 1))
        self.assertAlmostEqual(s["cards"][0]["area_share"], 1.0, places=12)

    def test_empty_pattern_does_not_use_cell_cap_slot(self):
        mixed = [1, 5, 24, 99, 98, 97, 96, 95]
        sim = [(self.seq(mixed, chunk_id=f"M{i:02d}", climate_cell="C1"), {"total": 99.0 - i, "warnings": []}) for i in range(10)]
        sim.append((self.seq([1, 5] * 4, chunk_id="P", climate_cell="C1"), {"total": 80.0, "warnings": []}))
        s = F.summarize(self.seq([1] * 8, chunk_id="R"), sim, self.names)
        self.assertEqual(s["counted"], ["P"])

    def test_reference_with_empty_pattern(self):
        ref = self.seq([1, 5, 24, 99, 98, 97, 96, 95], chunk_id="R")
        sim = [(self.seq([1, 5] * 4, chunk_id="A", climate_cell="C1"), {"total": 95.0, "warnings": []})]
        cur = F.summarize(ref, sim, self.names)["cards"][0]
        self.assertEqual((cur["key"], cur["count"], cur["total"]), ("", 0, 1))

    def test_cell_cap(self):
        sim = [(with_(chunk_id=f"K{i:02d}", climate_cell="C1"), {"total": 100.0 - i, "warnings": []}) for i in range(15)]
        kept = F.cell_cap(sim)
        self.assertEqual([c["chunk_id"] for c, _ in kept], [f"K{i:02d}" for i in range(10)])


class Select(unittest.TestCase):
    def test_top_k_and_tau(self):
        ref = with_(chunk_id="R")
        others = [with_(chunk_id=f"N{i:02d}", slope=2.0 + i * 0.1) for i in range(40)]
        r = F.find_similar(ref, [ref, *others], shifted=False)
        self.assertEqual(len(r["selected"]), 30)
        self.assertEqual(r["selected"][0][0]["chunk_id"], "N00")

    def test_shift_gate(self):
        # 시프트 +6℃: 월별 기온 점수 100·2^(-(6/2.8)²) ≈ 4.2 → 기후 블록 ≈ (0.10·4.2 + 0.35·100)/0.45 ≈ 78.7 < 85
        ref = with_(chunk_id="R")
        for k in F.TEMP_KEYS:
            ref[f"s_{k}"] = ref[k] + 6.0
        same = with_(chunk_id="SAME")
        warm = with_(chunk_id="WARM", **{k: base()[k] + 6.0 for k in F.TEMP_KEYS})
        r = F.find_similar(ref, [ref, same, warm], shifted=True)
        ids = [c["chunk_id"] for c, _ in r["selected"]]
        self.assertEqual(ids, ["WARM"])
        self.assertEqual(r["gated_count"], 1)


if __name__ == "__main__":
    unittest.main()
