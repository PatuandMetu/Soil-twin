import { describe, expect, it } from 'vitest'
import {
  CLIMATE_KEYS,
  CROP_KEYS,
  PRECIP_KEYS,
  TEMP_KEYS,
  applyCellCap,
  config,
  drainageFloodScore,
  exact,
  findSimilar,
  gaussian,
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

const withCrops = (codes: number[]) => Object.fromEntries(CROP_KEYS.map((k, i) => [k, codes[i]])) as Partial<Chunk>

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
  it('climate_only: 기후 ≥ 80, 토양 < 65, 종합 < τ', () => {
    expect(statusOf(70, 50, 95, 0)).toBe('climate_only')
    expect(statusOf(70, 70, 95, 0)).toBe('none')
    expect(statusOf(85, 70, 95, 1)).toBe('constrained')
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
    // 감점: 토성 7.5(d 0.22 = t) + 유효수분 5(Δ 50 = t) + 산도 3(Δ 0.9 = t) + 유기물 1.5(Δ 2.2 = t)
    //       + CEC 1.5(Δ 9 = t) + 경사 1.5(Δ 2.5 → 75점) = 20 → 종합 80
    // 부동소수점 꼬리로 80 바로 밑이 되는 경우는 아래 meetsTau 테스트가 맡는다.
    const ref = makeChunk('ref')
    const cand = makeChunk('cand', { sand: 52, silt: 28, aws_mm: 250, ph: 7.4, om: 5.2, cec: 29, slope: 4.5 })
    const r = findSimilar(ref, [ref, cand], false)
    const s = r.candidates[0].score
    expect(s.total).toBeCloseTo(80, 9)
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

describe('기후 시프트 모드', () => {
  const ref = makeChunk('ref')
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
    const r = findSimilar(ref, all, true, { ...config, shiftClimateGate: 101 })
    expect(r.noneFound).toBe(true)
    expect(r.similar).toEqual([])
  })
})
