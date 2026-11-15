import { describe, expect, it } from 'vitest'
import { bearingDeg, directionOf, groupRegions, median, type ItemKey, type ItemScore, type Scored, type Chunk } from './index'

const KEYS: ItemKey[] = ['texture', 'temp_monthly']

function scored(id: string, cell: string, total: number, over: Partial<Chunk> = {}, itemScores: number[] = [total, total]): Scored {
  const chunk = { chunk_id: id, climate_cell: cell, lat: 40, lon: -95, state: 'IA', acres: 100, ...over } as Chunk
  const items: ItemScore[] = KEYS.map((key, i) => ({
    key,
    block: i === 0 ? 'soil' : 'climate',
    weight: 0.5,
    score: itemScores[i],
    penalty: 0.5 * (100 - itemScores[i]),
  }))
  return { chunk, score: { total, soil: total, climate: total, items, warnings: [], status: 'twin' } }
}

const REF = { chunk_id: 'ref', lat: 40, lon: -95 } as Chunk

describe('중앙값', () => {
  it('홀수 개면 가운데 값, 짝수 개면 가운데 두 값의 평균', () => {
    expect(median([90, 70, 80])).toBe(80)
    expect(median([90, 70, 80, 85])).toBe(82.5)
    expect(median([5])).toBe(5)
  })
})

describe('방향', () => {
  it('처음 방위각: 북 0°, 동 약 90°, 남 180°', () => {
    expect(bearingDeg({ lat: 40, lon: -95 }, { lat: 41, lon: -95 })).toBeCloseTo(0, 9)
    expect(bearingDeg({ lat: 40, lon: -95 }, { lat: 40, lon: -94 })).toBeGreaterThan(89)
    expect(bearingDeg({ lat: 40, lon: -95 }, { lat: 40, lon: -94 })).toBeLessThan(90)
    expect(bearingDeg({ lat: 40, lon: -95 }, { lat: 39, lon: -95 })).toBeCloseTo(180, 9)
  })

  it('8방위 경계: 22.5°부터 northeast, 337.5°부터 north', () => {
    expect(directionOf(0)).toBe('north')
    expect(directionOf(22.4)).toBe('north')
    expect(directionOf(22.5)).toBe('northeast')
    expect(directionOf(135)).toBe('southeast')
    expect(directionOf(225)).toBe('southwest')
    expect(directionOf(270)).toBe('west')
    expect(directionOf(337.4)).toBe('northwest')
    expect(directionOf(337.5)).toBe('north')
  })
})

describe('비슷한 지역 = 기후 칸 묶음', () => {
  const a = [
    scored('a1', 'A', 90, { lat: 41, lon: -95, state: 'IA' }, [90, 95]),
    scored('a2', 'A', 80, { lat: 41.2, lon: -95.2, state: 'MN' }, [70, 95]),
    scored('a3', 'A', 70, { lat: 41.4, lon: -95.4, state: 'IA' }, [60, 95]),
  ]
  const b = [scored('b1', 'B', 95, { lat: 38, lon: -95 }), scored('b2', 'B', 85, { lat: 38, lon: -95 })]

  it('지역 유사율은 종합 점수 중앙값, 높은 순으로 순위', () => {
    const rs = groupRegions(REF, [b[0], a[0], b[1], a[1], a[2]])
    expect(rs.map((r) => [r.cell, r.rank, r.similarity])).toEqual([
      ['B', 1, 90],
      ['A', 2, 80],
    ])
    expect(rs[1].members.map((s) => s.chunk.chunk_id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('위치는 좌표 평균, 거리·방향은 기준 청크에서 그 위치까지', () => {
    const [r] = groupRegions(REF, a)
    expect(r.lat).toBeCloseTo(41.2, 9)
    expect(r.lon).toBeCloseTo(-95.2, 9)
    expect(r.direction).toBe('north')
    expect(r.distanceKm).toBeGreaterThan(130)
    expect(r.distanceKm).toBeLessThan(136)
    expect(groupRegions(REF, b)[0].direction).toBe('south')
  })

  it('항목별 점수는 중앙값과 범위', () => {
    const [r] = groupRegions(REF, a)
    expect(r.items.texture).toEqual({ median: 70, min: 60, max: 90 })
    expect(r.items.temp_monthly).toEqual({ median: 95, min: 95, max: 95 })
  })

  it('주는 많은 순', () => {
    expect(groupRegions(REF, a)[0].states).toEqual(['IA', 'MN'])
  })

  it('유사율이 같으면 climate_cell 문자 코드 순 (대문자가 먼저)', () => {
    const rs = groupRegions(REF, [scored('x', 'a', 88), scored('y', 'B', 88)])
    expect(rs.map((r) => r.cell)).toEqual(['B', 'a'])
  })

  it('닮은 청크가 없으면 지역도 없다', () => {
    expect(groupRegions(REF, [])).toEqual([])
  })
})
