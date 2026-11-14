import { describe, expect, it } from 'vitest'
import {
  CLIMATE_KEYS,
  CROP_KEYS,
  PRECIP_KEYS,
  TEMP_KEYS,
  applyCellCap,
  compareCode,
  summarizeRotations,
  config,
  distanceKm,
  drainageFloodScore,
  exact,
  findSimilar,
  gaussian,
  grade,
  meetsMinDistance,
  meetsTau,
  passesShiftGate,
  patternKey,
  profileOf,
  scorePair,
  statusOf,
  warnings,
  type Chunk,
  type Climate,
  type CropNames,
  type Scored,
} from './index'

const NAMES: CropNames = { '1': 'Corn', '5': 'Soybeans', '24': 'Winter Wheat', '61': 'Fallow/Idle Cropland', '36': 'Alfalfa' }

function climate(dT = 0, pFactor = 1): Climate {
  const c = {} as Climate
  TEMP_KEYS.forEach((k, i) => (c[k] = 10 + 14 * Math.cos((2 * Math.PI * (i - 6)) / 12) + dT))
  PRECIP_KEYS.forEach((k, i) => (c[k] = (i >= 3 && i <= 8 ? 100 * pFactor : 40)))
  c.ffd = 160
  c.gdd10 = 1600
  c.heat_days = 15
  c.gwet_summer = 0.6
  c.drought_freq = 0.1
  return c
}

const CURRENT = climate()
const SHIFTED: Climate = { ...climate(2.2, 0.85), ffd: 172, gdd10: 2050, heat_days: 33, drought_freq: 0.22 }

function makeChunk(id: string, over: Partial<Chunk> = {}, cur: Climate = CURRENT, shift: Climate = SHIFTED): Chunk {
  const base: Record<string, number | string> = {
    chunk_id: id,
    lat: 41,
    lon: -93,
    state: 'IA',
    climate_cell: 'A',
    acres: 100,
    sand: 30,
    silt: 50,
    clay: 20,
    aws_mm: 200,
    drainage: 3,
    flood: 0,
    ph: 6.5,
    om: 3,
    cec: 20,
    ec: 0.5,
    slope: 2,
    bedrock_cm: 200,
  }
  for (const k of CLIMATE_KEYS) {
    base[k] = cur[k]
    base[`s_${k}`] = shift[k]
  }
  CROP_KEYS.forEach((k, i) => (base[k] = i % 2 === 0 ? 1 : 5))
  return { ...(base as Chunk), ...over }
}

/**
 * 기준 청크는 후보(makeChunk 기본 좌표 41°N, 93°W)에서 북쪽으로 2°(약 222 km) 떨어뜨린다.
 * 같은 좌표면 후보 최소 거리(100 km) 조건에 걸려 후보가 하나도 남지 않는다.
 */
const REF_AT = { lat: 43, lon: -93 }
const makeRef = (over: Partial<Chunk> = {}) => makeChunk('ref', { ...REF_AT, ...over })

const withCrops = (codes: number[]) => Object.fromEntries(CROP_KEYS.map((k, i) => [k, codes[i]])) as Partial<Chunk>
const CORN_SOY = withCrops([1, 5, 1, 5, 1, 5, 1, 5])
const EMPTY = withCrops([1, 5, 24, 61, 36, 21, 28, 4]) // 8년 모두 다른 작물 → 빈 패턴

const scoredOf = (chunk: Chunk, total = 90): Scored => ({
  chunk,
  score: { total, soil: total, climate: total, items: [], warnings: [], status: 'twin' },
})

describe('점수', () => {
  it('같은 행끼리는 100점, 경고 없음, twin', () => {
    const a = makeChunk('a')
    const s = scorePair(profileOf(a), profileOf(a))
    expect(s.total).toBeCloseTo(100, 10)
    expect(s.soil).toBeCloseTo(100, 10)
    expect(s.climate).toBeCloseTo(100, 10)
    expect(s.warnings).toEqual([])
    expect(s.status).toBe('twin')
    for (const it of s.items) expect(it.penalty).toBeCloseTo(0, 10)
  })

  it('가우시안은 차이가 t일 때 50점', () => {
    expect(gaussian(10, 12.8, 2.8)).toBeCloseTo(50, 10)
    expect(gaussian(5, 5, 1)).toBe(100)
  })

  it('가중치 합은 1', () => {
    const sum = Object.values(config.weights).reduce((s, w) => s + w, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('감점 기여 합 = 100 − 종합 점수', () => {
    const s = scorePair(profileOf(makeChunk('a')), profileOf(makeChunk('b', { sand: 60, silt: 25, clay: 15, ph: 7.4 })))
    const pen = s.items.reduce((acc, it) => acc + it.penalty, 0)
    expect(pen).toBeCloseTo(100 - s.total, 10)
  })
})

describe('배수·침수', () => {
  const ref = profileOf(makeChunk('a', { drainage: 3, flood: 0 }))
  it.each([
    [3, 100],
    [4, 75],
    [5, 35],
    [6, 10],
    [7, 10],
    [1, 35],
  ])('배수 등급 %i → %i점', (d, want) => {
    expect(drainageFloodScore(ref, profileOf(makeChunk('b', { drainage: d })))).toBe(want)
  })

  it('침수 등급이 다르면 −25', () => {
    expect(drainageFloodScore(ref, profileOf(makeChunk('b', { flood: 1 })))).toBe(75)
  })

  it('침수 감점은 0 밑으로 내려가지 않는다', () => {
    expect(drainageFloodScore(ref, profileOf(makeChunk('b', { drainage: 7, flood: 3 })))).toBe(0)
  })
})

describe('배수·침수 등급 (실수로 저장 → 정수 등급으로 분류)', () => {
  it('grade는 반올림, 0.5는 올림', () => {
    expect(grade(4.49)).toBe(4)
    expect(grade(4.5)).toBe(5)
    expect(grade(4.5 - 1e-12)).toBe(5) // 부동소수점 꼬리는 exact로 지운다
    expect(grade(0.49)).toBe(0)
    expect(grade(7)).toBe(7)
  })

  it('배수표는 등급 차로 찾고, 실수 drainage에서도 NaN이 나오지 않는다', () => {
    const ref = profileOf(makeChunk('a', { drainage: 3 }))
    const score = (drainage: number) => drainageFloodScore(ref, profileOf(makeChunk('b', { drainage })))
    expect(score(3.4)).toBe(100) // 3 vs 3
    expect(score(4.49)).toBe(75) // 3 vs 4
    expect(score(4.5)).toBe(35) // 3 vs 5
    expect(score(6.7)).toBe(10) // 3 vs 7
  })

  it('침수 −25는 정수 등급이 다를 때만', () => {
    const ref = profileOf(makeChunk('a', { flood: 0 }))
    expect(drainageFloodScore(ref, profileOf(makeChunk('b', { flood: 0.49 })))).toBe(100)
    expect(drainageFloodScore(ref, profileOf(makeChunk('b', { flood: 0.5 })))).toBe(75)
  })

  it('경고의 배수·침수 차도 등급으로 계산', () => {
    const ref = profileOf(makeChunk('a', { drainage: 3, flood: 0 }))
    const codes = (over: Partial<Chunk>) => warnings(ref, profileOf(makeChunk('b', over))).map((w) => w.code)
    expect(codes({ drainage: 4.5 })).toEqual(['drainage']) // 3 vs 5
    expect(codes({ drainage: 4.49 })).toEqual([]) // 3 vs 4
    expect(codes({ flood: 1.5 })).toEqual(['flood']) // 0 vs 2
    expect(codes({ flood: 1.49 })).toEqual([]) // 0 vs 1
  })

  it('실수 등급 청크가 고르기에서 조용히 사라지지 않는다', () => {
    const ref = makeRef({ drainage: 3, flood: 0 })
    const cand = makeChunk('cand', { drainage: 3.4, flood: 0.3 })
    const r = findSimilar(ref, [ref, cand], false)
    expect(Number.isNaN(r.candidates[0].score.total)).toBe(false)
    expect(r.candidates[0].score.total).toBeCloseTo(100, 9)
    expect(r.selected.map((x) => x.chunk.chunk_id)).toEqual(['cand'])
  })
})

describe('재배 제약 경고', () => {
  const ref = makeChunk('a')
  const codes = (over: Partial<Chunk>, r: Chunk = ref) =>
    warnings(profileOf(r), profileOf(makeChunk('b', over))).map((w) => w.code)

  it('배수 등급 차 ≥ 2', () => {
    expect(codes({ drainage: 5 })).toEqual(['drainage'])
    expect(codes({ drainage: 4 })).toEqual([])
  })
  it('|Δph| > 1.0', () => {
    expect(codes({ ph: 7.6 })).toEqual(['ph'])
    expect(codes({ ph: 7.5 })).toEqual([])
  })
  it('|Δflood| ≥ 2', () => {
    expect(codes({ flood: 2 })).toEqual(['flood'])
    expect(codes({ flood: 1 })).toEqual([])
  })
  it('암반: 한쪽 < 100, 다른 쪽 ≥ 100', () => {
    expect(codes({ bedrock_cm: 99 })).toEqual(['bedrock'])
    expect(codes({ bedrock_cm: 100 })).toEqual([])
    expect(codes({ bedrock_cm: 60 }, makeChunk('a', { bedrock_cm: 90 }))).toEqual([])
  })
  it('염류: 한쪽 ec ≥ 4, 다른 쪽 < 4', () => {
    expect(codes({ ec: 4 })).toEqual(['salinity'])
    expect(codes({ ec: 3.9 })).toEqual([])
    expect(codes({ ec: 6 }, makeChunk('a', { ec: 4.5 }))).toEqual([])
  })
  it('경고가 있어도 점수는 그대로, 상태만 constrained', () => {
    const s = scorePair(profileOf(ref), profileOf(makeChunk('b', { ec: 4 })))
    const s0 = scorePair(profileOf(ref), profileOf(makeChunk('b', { ec: 3.99 })))
    expect(s.total).toBeCloseTo(s0.total, 2)
    expect(s.status).toBe('constrained')
    expect(s0.status).toBe('twin')
  })
})

describe('상태', () => {
  it('twin·constrained: 종합 ≥ τ 이고 토양 ≥ 65', () => {
    expect(statusOf(85, 70, 95, 0)).toBe('twin')
    expect(statusOf(85, 70, 95, 1)).toBe('constrained')
    expect(statusOf(85, 65, 100, 1)).toBe('constrained')
  })
  it('climate_only: 기후 ≥ 80 이고 토양 < 65 (종합과 무관)', () => {
    expect(statusOf(70, 50, 95, 0)).toBe('climate_only')
    expect(statusOf(85, 64.9, 100, 0)).toBe('climate_only')
    expect(statusOf(70, 70, 95, 0)).toBe('none')
    expect(statusOf(70, 50, 79.9, 0)).toBe('none')
  })
})

describe('경계 비교 (소수 9자리 반올림)', () => {
  it('exact는 부동소수점 꼬리를 지운다', () => {
    expect(Math.abs(8.3 - 7.3)).not.toBe(1) // 1.0000000000000009
    expect(exact(Math.abs(8.3 - 7.3))).toBe(1)
  })

  it('pH 7.3 vs 8.3은 차이가 1.0이라 경고 없음, 7.3 vs 8.4는 경고', () => {
    const ref = makeChunk('a', { ph: 7.3 })
    const codes = (ph: number) => warnings(profileOf(ref), profileOf(makeChunk('b', { ph }))).map((w) => w.code)
    expect(codes(8.3)).toEqual([])
    expect(codes(8.4)).toEqual(['ph'])
  })

  it('종합 점수가 수학적으로 정확히 80인 후보가 선택된다', () => {
    // 토양 감점: 토성 7.5(d 0.22 = t) + 유효수분 5(Δ 50 = t) + 산도 3(Δ 0.9 = t) + 유기물 1.5(Δ 2.2 = t)
    //            + 암반·염류 0.5(암반 Δ 75) = 17.5 → 토양 68.2
    // 기후 감점: 무상기간 2.5(Δ 28 = t) → 기후 94.4. 종합 = 100 − 17.5 − 2.5 = 80
    // 부동소수점 꼬리로 80 바로 밑이 되는 경우는 아래 meetsTau 테스트가 맡는다.
    const ref = makeRef()
    const cand = makeChunk('cand', { sand: 52, silt: 28, aws_mm: 250, ph: 7.4, om: 5.2, bedrock_cm: 125, ffd: 188 })
    const r = findSimilar(ref, [ref, cand], false)
    const s = r.candidates[0].score
    expect(s.total).toBeCloseTo(80, 9)
    expect(s.soil).toBeGreaterThanOrEqual(config.soilMin)
    expect(s.warnings).toEqual([])
    expect(s.status).toBe('twin')
    expect(r.selected.map((x) => x.chunk.chunk_id)).toEqual(['cand'])
    expect(r.noneFound).toBe(false)
  })

  it('τ, 시프트 기후 게이트, 상태 판정도 반올림 값으로 비교', () => {
    expect(meetsTau(80 - 1e-12)).toBe(true)
    expect(meetsTau(80 - 1e-6)).toBe(false)
    expect(passesShiftGate(85 - 1e-12)).toBe(true)
    expect(passesShiftGate(85 - 1e-6)).toBe(false)
    expect(statusOf(80 - 1e-12, 100, 100, 0)).toBe('twin')
    expect(statusOf(85, 65 - 1e-12, 100, 0)).toBe('twin') // 토양 65 − 1e-12도 65 이상으로 본다
    // 토양 65 − 1e-12는 65로 보므로 "토양 < 65"가 아니다
    expect(statusOf(70, 65 - 1e-12, 80 - 1e-12, 0)).toBe('none')
    expect(statusOf(70, 65 - 1e-6, 80 - 1e-12, 0)).toBe('climate_only')
  })

  it('점수 자체는 반올림하지 않는다', () => {
    const s = scorePair(profileOf(makeChunk('a', { ph: 6.5 })), profileOf(makeChunk('b', { ph: 7.4 })))
    const ph = s.items.find((it) => it.key === 'ph')!
    expect(ph.score).not.toBe(50)
    expect(ph.score).toBeCloseTo(50, 9)
  })
})

describe('핵심 닮은 청크는 토양 점수 65 이상', () => {
  // 토양 감점: 토성 7.5 + 유효수분 5 + 산도 3 + 유기물 1.5 + CEC 1.5 + 경사 0.75(Δ 1.25) = 19.25
  // → 토양 정확히 65, 기후 100 → 종합 80.75
  const ref = makeRef()
  const soil65 = { sand: 52, silt: 28, aws_mm: 250, ph: 7.4, om: 5.2, cec: 29 }

  it('종합 80.75·토양 정확히 65 → twin, 선택됨', () => {
    const r = findSimilar(ref, [ref, makeChunk('cand', { ...soil65, slope: 3.25 })], false, NAMES)
    const s = r.candidates[0].score
    expect(s.total).toBeCloseTo(80.75, 9)
    expect(s.soil).toBeCloseTo(65, 9)
    expect(s.status).toBe('twin')
    expect(r.similar.map((x) => x.chunk.chunk_id)).toEqual(['cand'])
  })

  it('토양 65 바로 아래 → 종합이 τ 이상이어도 climate_only, 선택 안 됨', () => {
    const r = findSimilar(ref, [ref, makeChunk('cand', { ...soil65, slope: 3.26 })], false, NAMES)
    const s = r.candidates[0].score
    expect(s.total).toBeGreaterThanOrEqual(config.tau)
    expect(s.soil).toBeLessThan(65)
    expect(s.status).toBe('climate_only')
    expect(r.similar).toEqual([])
    expect(r.noneFound).toBe(true)
  })
})

describe('동점 정렬: 유니코드 문자 코드 순서', () => {
  const NAMES_LOWER: CropNames = { ...NAMES, '21': 'barley' }

  it('대문자가 소문자보다 앞', () => {
    expect(compareCode('B1', 'a1')).toBeLessThan(0)
    expect(['a1', 'B1', 'A1'].sort(compareCode)).toEqual(['A1', 'B1', 'a1'])
  })

  it("후보 동점 'a1'과 'B1' → 'B1'이 먼저", () => {
    const ref = makeRef()
    const r = findSimilar(ref, [ref, makeChunk('a1'), makeChunk('B1')], false, NAMES)
    expect(r.similar.map((s) => s.chunk.chunk_id)).toEqual(['B1', 'a1'])
  })

  it("패턴 'Corn'과 'barley' 동점(개수·면적 같음) → 'Corn'이 먼저", () => {
    const corn = makeChunk('c', withCrops([1, 1, 1, 1, 1, 1, 1, 1]))
    const barley = makeChunk('b', withCrops([21, 21, 21, 21, 21, 21, 21, 21]))
    const sum = summarizeRotations(makeRef(), [scoredOf(barley), scoredOf(corn)], NAMES_LOWER)
    expect(sum.patterns.map((p) => p.key)).toEqual(['Corn', 'barley'])
  })

  it('패턴 키 안 작물 이름도 문자 코드 순', () => {
    expect(patternKey(makeChunk('x', withCrops([21, 1, 21, 1, 21, 1, 21, 1])), NAMES_LOWER)).toBe('Corn+barley')
  })
})

describe('패턴 키', () => {
  it('2번 이상 나온 작물을 이름순으로', () => {
    expect(patternKey(makeChunk('a', withCrops([5, 1, 5, 1, 5, 1, 5, 1])), NAMES)).toBe('Corn+Soybeans')
  })
  it('한 번만 나온 작물은 무시', () => {
    expect(patternKey(makeChunk('a', withCrops([1, 5, 1, 5, 36, 5, 1, 5])), NAMES)).toBe('Corn+Soybeans')
  })
  it('연작은 작물 하나', () => {
    expect(patternKey(makeChunk('a', withCrops([1, 1, 1, 1, 1, 1, 1, 1])), NAMES)).toBe('Corn')
  })
  it('이름에 없는 코드는 CDL 번호로', () => {
    expect(patternKey(makeChunk('a', withCrops([24, 61, 24, 61, 999, 999, 24, 61])), NAMES)).toBe(
      'CDL 999+Fallow/Idle Cropland+Winter Wheat',
    )
  })
})

describe('기후 칸 상한', () => {
  it('한 칸에서 점수 높은 순으로 최대 cellCap개', () => {
    const fake = (id: string, cell: string, total: number): Scored => ({
      chunk: makeChunk(id, { climate_cell: cell }),
      score: { total, soil: total, climate: total, items: [], warnings: [], status: 'twin' },
    })
    const xs = [
      ...Array.from({ length: 15 }, (_, i) => fake(`A${i}`, 'A', 80 + i)),
      ...Array.from({ length: 3 }, (_, i) => fake(`B${i}`, 'B', 81 + i)),
    ]
    const kept = applyCellCap(xs, config.cellCap)
    const a = kept.filter((s) => s.chunk.climate_cell === 'A')
    expect(a).toHaveLength(10)
    expect(Math.min(...a.map((s) => s.score.total))).toBe(85)
    expect(kept.filter((s) => s.chunk.climate_cell === 'B')).toHaveLength(3)
  })
})

describe('후보 최소 거리 100 km (Haversine, 지구 반지름 6,371 km)', () => {
  const R = config.earthRadiusKm
  /** 기준 청크에서 정북으로 km만큼 떨어진 위도 */
  const northBy = (km: number) => REF_AT.lat + (km / R) * (180 / Math.PI)

  it('대원거리: 같은 점 0, 적도에서 경도 90° 차이는 R·π/2, 극에서 극은 R·π, 위도 1°는 R·π/180', () => {
    expect(distanceKm({ lat: 41, lon: -93 }, { lat: 41, lon: -93 })).toBe(0)
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo((R * Math.PI) / 2, 9)
    expect(distanceKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(R * Math.PI, 9)
    expect(distanceKm({ lat: 41, lon: -93 }, { lat: 42, lon: -93 })).toBeCloseTo((R * Math.PI) / 180, 9)
  })

  it('경계는 반올림한 거리로 비교: 100 − 1e-12 km는 100 km로 본다', () => {
    expect(meetsMinDistance(100)).toBe(true)
    expect(meetsMinDistance(100 - 1e-12)).toBe(true)
    expect(meetsMinDistance(100 - 1e-6)).toBe(false)
  })

  it('100 km 미만은 후보가 아니고, 정확히 100 km(반올림 비교)는 후보', () => {
    const ref = makeRef()
    const at100 = makeChunk('at100', { lat: northBy(100), lon: REF_AT.lon })
    const at99 = makeChunk('at99', { lat: northBy(99.9), lon: REF_AT.lon })
    const same = makeChunk('same', REF_AT)
    expect(exact(distanceKm(ref, at100))).toBe(100)
    const r = findSimilar(ref, [ref, at100, at99, same], false, NAMES)
    expect(r.candidates.map((s) => s.chunk.chunk_id)).toEqual(['at100'])
    expect(r.similar.map((s) => s.chunk.chunk_id)).toEqual(['at100'])
  })

  it('가까운 청크는 100점이어도 후보가 아니고, 기후 칸 상한 자리를 차지하지 않는다', () => {
    const ref = makeRef()
    // 같은 칸 A: 기준 청크와 같은 자리의 100점 청크 10개 + 222 km 떨어진 조금 덜 닮은 청크 10개
    const near = Array.from({ length: 10 }, (_, i) => makeChunk(`N${i}`, REF_AT))
    const far = Array.from({ length: 10 }, (_, i) => makeChunk(`F${i}`, { ph: 6.8 }))
    expect(scorePair(profileOf(ref), profileOf(near[0])).total).toBeCloseTo(100, 9)
    const r = findSimilar(ref, [ref, ...near, ...far], false, NAMES)
    expect(r.candidates.some((s) => s.chunk.chunk_id.startsWith('N'))).toBe(false)
    expect(r.similar).toHaveLength(10)
    expect(r.similar.every((s) => s.chunk.chunk_id.startsWith('F'))).toBe(true)
  })
})

describe('고르기 순서: 최소 거리·빈 패턴 제외 → 닮은 청크 조건 → 기후 칸 상한 → 상위 K', () => {
  const ref = makeRef(CORN_SOY)
  const many = (cell: string, n: number) =>
    Array.from({ length: n }, (_, i) => makeChunk(`${cell}${String(i).padStart(2, '0')}`, { climate_cell: cell }))

  it('한 칸에 25개, 다른 칸에 15개가 문턱을 넘으면 목록 20개(10 + 10), 카드 분모 20', () => {
    const r = findSimilar(ref, [ref, ...many('A', 25), ...many('B', 15)], false, NAMES)
    const cells = r.similar.map((s) => s.chunk.climate_cell)
    expect(cells.filter((c) => c === 'A')).toHaveLength(10)
    expect(cells.filter((c) => c === 'B')).toHaveLength(10)
    const sum = summarizeRotations(ref, r.similar, NAMES)
    expect(sum.counted).toHaveLength(20)
    expect(sum.current).toMatchObject({ key: 'Corn+Soybeans', count: 20, total: 20 })
  })

  it('칸 4개에 10개씩이면 상위 30개로 잘린다', () => {
    const all = [ref, ...many('A', 10), ...many('B', 10), ...many('C', 10), ...many('D', 10)]
    const r = findSimilar(ref, all, false, NAMES)
    expect(r.similar).toHaveLength(config.topK)
    // 점수가 모두 같으면 chunk_id 순이라 D 칸이 잘린다
    expect(r.similar.some((s) => s.chunk.climate_cell === 'D')).toBe(false)
  })

  it('빈 패턴 청크는 기준 청크와 100점이어도 후보가 아니고, 칸 상한 자리를 차지하지 않는다', () => {
    const empties = Array.from({ length: 3 }, (_, i) => makeChunk(`E${i}`, { climate_cell: 'A', ...EMPTY }))
    expect(scorePair(profileOf(ref), profileOf(empties[0])).total).toBeCloseTo(100, 9)
    const r = findSimilar(ref, [ref, ...empties, ...many('A', 10)], false, NAMES)
    expect(r.candidates.some((s) => s.chunk.chunk_id.startsWith('E'))).toBe(false)
    expect(r.similar).toHaveLength(10)
    expect(r.similar.every((s) => s.chunk.chunk_id.startsWith('A'))).toBe(true)
  })

  it('빈 패턴만 문턱을 넘으면 닮은 청크 없음', () => {
    // far는 토양이 많이 달라 문턱 아래
    const far = makeChunk('far', { sand: 85, silt: 10, clay: 5, aws_mm: 80, drainage: 7, ph: 8.4 })
    const r = findSimilar(ref, [ref, makeChunk('E0', EMPTY), far], false, NAMES)
    expect(r.candidates.map((s) => s.chunk.chunk_id)).toEqual(['far'])
    expect(r.noneFound).toBe(true)
    expect(r.similar).toEqual([])
  })

  it('이름표를 주지 않으면 작물 코드로 빈 패턴을 판정한다', () => {
    const r = findSimilar(ref, [ref, makeChunk('E0', EMPTY), makeChunk('P0')], false)
    expect(r.similar.map((s) => s.chunk.chunk_id)).toEqual(['P0'])
  })
})

describe('윤작 집계', () => {
  it('받은 닮은 청크를 그대로 센다 (칸 상한·빈 패턴 제외를 다시 하지 않음)', () => {
    const similar = Array.from({ length: 12 }, (_, i) => scoredOf(makeChunk(`P${i}`, CORN_SOY)))
    const sum = summarizeRotations(makeRef(CORN_SOY), similar, NAMES)
    expect(sum.counted).toHaveLength(12)
    expect(sum.current).toMatchObject({
      key: 'Corn+Soybeans',
      count: 12,
      total: 12,
      acres: 1200,
      totalAcres: 1200,
      areaShare: 1,
      cellCount: 1,
    })
  })

  it('기준 청크가 빈 패턴이면 현재 윤작 카드는 count 0', () => {
    const sum = summarizeRotations(makeRef(EMPTY), [scoredOf(makeChunk('P0', CORN_SOY))], NAMES)
    expect(sum.current).toMatchObject({ key: '', count: 0, total: 1 })
    expect(sum.cards.map((c) => c.key)).toEqual(['', 'Corn+Soybeans'])
  })
})

describe('기후 시프트 모드', () => {
  const ref = makeRef()
  // 현재 기후가 기준 청크와 같은 후보, 현재 기후가 기준 청크의 시프트 기후와 같은 후보
  const sameNow = makeChunk('same-now')
  const likeShift = makeChunk('like-shift', { climate_cell: 'B' }, SHIFTED, SHIFTED)
  const all = [ref, sameNow, likeShift]

  it('현재 모드는 기후 게이트 없이 τ만 본다', () => {
    const r = findSimilar(ref, all, false)
    expect(r.gatedCount).toBe(2)
    expect(r.similar.map((s) => s.chunk.chunk_id)).toContain('same-now')
  })

  it('시프트 모드는 기후 블록 ≥ 85만 남긴 뒤 고른다', () => {
    const r = findSimilar(ref, all, true)
    const dropped = r.candidates.find((s) => s.chunk.chunk_id === 'same-now')!
    // 종합은 τ를 넘지만 기후 블록이 게이트 밑이라 빠져야 한다
    expect(dropped.score.total).toBeGreaterThanOrEqual(config.tau)
    expect(dropped.score.climate).toBeLessThan(config.shiftClimateGate)
    expect(r.selected.map((s) => s.chunk.chunk_id)).toEqual(['like-shift'])
    expect(r.selected[0].score.climate).toBeCloseTo(100, 10)
  })

  it('시프트 모드는 기준 청크의 기후만 바꾼다', () => {
    const r = findSimilar(ref, all, true)
    const s = r.candidates.find((x) => x.chunk.chunk_id === 'like-shift')!
    expect(s.score.soil).toBeCloseTo(100, 10)
  })

  it('τ 이상 후보가 없으면 noneFound', () => {
    const r = findSimilar(ref, all, true, NAMES, { ...config, shiftClimateGate: 101 })
    expect(r.noneFound).toBe(true)
    expect(r.similar).toEqual([])
  })
})
