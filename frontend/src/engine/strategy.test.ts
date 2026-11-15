import { describe, expect, it } from 'vitest'
import { CROP_KEYS, expandCode, rotationMetrics, rotationOptions, type Chunk, type CropNames, type Scored } from './index'

const NAMES: CropNames = {
  '1': 'Corn',
  '4': 'Sorghum',
  '5': 'Soybeans',
  '24': 'Winter Wheat',
  '26': 'Dbl Crop WinWht/Soybeans',
  '36': 'Alfalfa',
  '37': 'Other Hay/Non Alfalfa',
  '61': 'Fallow/Idle Cropland',
  '75': 'Almonds',
}

function field(id: string, codes: number[], over: Partial<Chunk> = {}, warned = false): Scored {
  const chunk = { chunk_id: id, climate_cell: 'A', acres: 100, ...over } as Chunk
  CROP_KEYS.forEach((k, i) => ((chunk as Record<string, unknown>)[k] = codes[i]))
  return {
    chunk,
    score: {
      total: 90,
      soil: 90,
      climate: 90,
      items: [],
      warnings: warned ? [{ code: 'ph', ref: 6, cand: 7.5 }] : [],
      status: warned ? 'constrained' : 'twin',
    },
  }
}

const CS = [1, 5, 1, 5, 1, 5, 1, 5] // Corn+Soybeans
const CSW = [1, 5, 24, 1, 5, 24, 1, 5] // Corn+Soybeans+Winter Wheat
const ALF = [1, 36, 36, 36, 1, 36, 36, 1] // Alfalfa+Corn

describe('작물 분류', () => {
  it('이모작 코드는 두 작물로 푼다', () => {
    expect(expandCode(26)).toEqual([24, 5])
    expect(expandCode(241)).toEqual([1, 5])
    expect(expandCode(1)).toEqual([1])
  })
})

describe('윤작 특징 지표 (밭 하나의 8년)', () => {
  it('옥수수-콩: 콩과 4, 작물 2종, 같은 작물 연속 1', () => {
    expect(rotationMetrics(CS, NAMES)).toEqual({
      legumeYears: 4,
      fallowYears: 0,
      perennialCoverYears: 0,
      doubleCropYears: 0,
      cropTypes: 2,
      longestSameCropRun: 1,
      hasOrchard: false,
    })
  })
  it('이모작은 해마다 이모작 1, 푼 작물로 콩과·작물 종류를 센다', () => {
    const m = rotationMetrics([26, 1, 26, 1, 26, 1, 26, 1], NAMES)
    expect(m.doubleCropYears).toBe(4)
    expect(m.legumeYears).toBe(4) // 26 = 밀 + 콩
    expect(m.cropTypes).toBe(3) // 밀, 콩, 옥수수
  })
  it('알팔파는 콩과이자 다년생 피복, 같은 작물 연속은 가장 긴 것', () => {
    const m = rotationMetrics(ALF, NAMES)
    expect(m.legumeYears).toBe(5)
    expect(m.perennialCoverYears).toBe(5)
    expect(m.longestSameCropRun).toBe(3)
  })
  it('휴경은 따로 세고, 작물 종류와 연속에는 넣지 않는다', () => {
    const m = rotationMetrics([24, 61, 24, 61, 24, 61, 61, 24], NAMES)
    expect(m.fallowYears).toBe(4)
    expect(m.cropTypes).toBe(1)
    expect(m.longestSameCropRun).toBe(1)
  })
  it('crops.json에 없는 코드와 과수 해는 지표에서 빼고 연속을 끊는다. 과수는 표시', () => {
    const m = rotationMetrics([1, 1, 999, 1, 1, 1, 75, 1], NAMES)
    expect(m.cropTypes).toBe(1)
    expect(m.longestSameCropRun).toBe(3)
    expect(m.hasOrchard).toBe(true)
    expect(rotationMetrics(CS, NAMES).hasOrchard).toBe(false)
  })
})

describe('윤작 전략 카드', () => {
  const cur = { codes: CS, label: 'Your field, 2017–2024' }
  const none = { similar: [] as Scored[] }

  it('현재 윤작 + 흔한 대안 2개 (현재 윤작 제외, 개수 → 면적 → 키 순)', () => {
    const similar = [
      field('a1', CS),
      field('a2', CS),
      field('b1', CSW, { climate_cell: 'B' }),
      field('b2', CSW, { climate_cell: 'C' }, true),
      field('b3', CSW),
      field('c1', ALF, { acres: 50 }),
      field('d1', [4, 4, 4, 4, 4, 4, 4, 4], { acres: 300 }),
    ]
    const r = rotationOptions(cur, { similar, noneFound: false }, none, NAMES)
    expect(r.current.key).toBe('Corn+Soybeans')
    expect(r.current.label).toBe('Your field, 2017–2024')
    expect(r.options.map((o) => o.key)).toEqual(['Corn+Soybeans+Winter Wheat', 'Sorghum'])
    expect(r.options[0]).toMatchObject({ count: 3, total: 7, cellCount: 3, warnedCount: 1, other: { count: 0, total: 0 } })
    expect(r.note).toBeNull()
  })

  it('대안 지표는 중앙값과 범위', () => {
    const similar = [field('x1', ALF), field('x2', [1, 36, 1, 36, 1, 36, 1, 36]), field('x3', [36, 36, 36, 36, 1, 1, 1, 1])]
    const o = rotationOptions(cur, { similar, noneFound: false }, none, NAMES).options[0]
    expect(o.metrics.legumeYears).toEqual({ median: 4, min: 4, max: 5 })
    expect(o.metrics.longestSameCropRun).toEqual({ median: 3, min: 1, max: 4 })
  })

  it('다른 기후 모드에서의 비율', () => {
    const similar = [field('b1', CSW)]
    const other = { similar: [field('o1', CSW), field('o2', CS), field('o3', ALF)] }
    expect(rotationOptions(cur, { similar, noneFound: false }, other, NAMES).options[0].other).toEqual({ count: 1, total: 3 })
  })

  it('대안이 1개, 0개, 닮은 청크 없음', () => {
    expect(rotationOptions(cur, { similar: [field('b1', CSW), field('a1', CS)], noneFound: false }, none, NAMES).note).toBe('only-one')
    const same = rotationOptions(cur, { similar: [field('a1', CS), field('a2', CS)], noneFound: false }, none, NAMES)
    expect(same.options).toEqual([])
    expect(same.note).toBe('all-same')
    const nf = rotationOptions(cur, { similar: [], noneFound: true }, none, NAMES)
    expect(nf.note).toBe('none-found')
    expect(nf.current.metrics.legumeYears).toBe(4) // 현재 카드 지표는 계산한다
  })

  it('현재 윤작 기준: 주어진 작물(실제 밭 2017~2024 또는 표본 2018~2025)로 계산한다', () => {
    const similar = [field('a1', CS), field('b1', CSW)]
    // 실제 밭이 2017~2024에 밀을 넣었다면 현재 윤작은 Corn+Soybeans+Winter Wheat, 대안에서 빠진다
    const fieldYears = rotationOptions({ codes: CSW, label: 'Your field, 2017–2024' }, { similar, noneFound: false }, none, NAMES)
    expect(fieldYears.current.key).toBe('Corn+Soybeans+Winter Wheat')
    expect(fieldYears.options.map((o) => o.key)).toEqual(['Corn+Soybeans'])
    const sampleYears = rotationOptions({ codes: CS, label: 'Sample field …123456, 2018–2025' }, { similar, noneFound: false }, none, NAMES)
    expect(sampleYears.current.key).toBe('Corn+Soybeans')
    expect(sampleYears.options.map((o) => o.key)).toEqual(['Corn+Soybeans+Winter Wheat'])
  })
})
