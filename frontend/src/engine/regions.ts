import { config as defaultConfig, type Config } from './config'
import { distanceKm } from './geo'
import { compareCode } from './order'
import { exact } from './score'
import type { Chunk, ItemKey, Scored } from './types'

/**
 * 비슷한 지역 = findSimilar가 고른 닮은 청크를 기후 칸(climate_cell)별로 묶은 것.
 * 엔진 계산은 바꾸지 않고 결과를 묶기만 한다.
 */

export const DIRECTIONS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const
export type Direction = (typeof DIRECTIONS)[number]

export type Spread = { median: number; min: number; max: number }

export type Region = {
  cell: string
  /** 1부터. 유사율 높은 순 */
  rank: number
  /** 지역 안 닮은 청크 (받은 순서 그대로: 점수 높은 순) */
  members: Scored[]
  /** 지역 유사율 = 지역 안 청크 종합 점수의 중앙값 */
  similarity: number
  /** 지역 위치 = 지역 안 청크 좌표의 평균 */
  lat: number
  lon: number
  /** 기준 청크에서 지역 위치까지 대원거리(km)와 8방위 */
  distanceKm: number
  direction: Direction
  /** 지역 안 청크의 주: 많은 순, 같으면 문자 코드 순 */
  states: string[]
  /** 항목별 점수의 중앙값·최솟값·최댓값 */
  items: Record<ItemKey, Spread>
}

/** 중앙값. 짝수 개면 가운데 두 값의 평균 */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function spreadOf(xs: number[]): Spread {
  return { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) }
}

const RAD = Math.PI / 180

/** a에서 b로 가는 대원 경로의 처음 방위각(도, 북 = 0, 시계 방향, 0 이상 360 미만) */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p1 = a.lat * RAD
  const p2 = b.lat * RAD
  const dl = (b.lon - a.lon) * RAD
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360
}

/** 8방위: 북 = 337.5° 이상 또는 22.5° 미만, 북동 = 22.5° 이상 67.5° 미만, … */
export function directionOf(deg: number): Direction {
  const d = ((deg % 360) + 360) % 360
  return DIRECTIONS[Math.floor(((d + 22.5) % 360) / 45)]
}

function statesOf(members: Scored[]): string[] {
  const n = new Map<string, number>()
  for (const s of members) n.set(s.chunk.state, (n.get(s.chunk.state) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || compareCode(a[0], b[0])).map(([st]) => st)
}

/**
 * 닮은 청크를 기후 칸별 지역으로 묶는다.
 * 정렬: 지역 유사율 높은 순(소수 9자리 반올림해 비교), 같으면 climate_cell 문자 코드 순.
 */
export function groupRegions(ref: Chunk, similar: Scored[], cfg: Config = defaultConfig): Region[] {
  const byCell = new Map<string, Scored[]>()
  for (const s of similar) byCell.set(s.chunk.climate_cell, [...(byCell.get(s.chunk.climate_cell) ?? []), s])

  const regions = [...byCell].map(([cell, members]): Omit<Region, 'rank'> => {
    const lat = members.reduce((t, s) => t + s.chunk.lat, 0) / members.length
    const lon = members.reduce((t, s) => t + s.chunk.lon, 0) / members.length
    const keys = members[0].score.items.map((it) => it.key)
    const items = Object.fromEntries(
      keys.map((k) => [k, spreadOf(members.map((s) => s.score.items.find((it) => it.key === k)!.score))]),
    ) as Record<ItemKey, Spread>
    return {
      cell,
      members,
      similarity: median(members.map((s) => s.score.total)),
      lat,
      lon,
      distanceKm: distanceKm(ref, { lat, lon }, cfg),
      direction: directionOf(bearingDeg(ref, { lat, lon })),
      states: statesOf(members),
      items,
    }
  })

  return regions
    .sort((a, b) => exact(b.similarity, cfg) - exact(a.similarity, cfg) || compareCode(a.cell, b.cell))
    .map((r, i) => ({ ...r, rank: i + 1 }))
}
