import { describe, expect, it } from 'vitest'
import { cellIdOf } from './csb'
import type { Chunk } from './engine'
import { inMainland, nearestChunk, nearestSample, parseCoords, shortPlaceName } from './search'

describe('내 밭 검색', () => {
  it('좌표 읽기: 쉼표나 띄어쓰기, 범위 밖은 null', () => {
    expect(parseCoords('42.03, -93.62')).toEqual({ lat: 42.03, lon: -93.62 })
    expect(parseCoords(' 42.03 -93.62 ')).toEqual({ lat: 42.03, lon: -93.62 })
    expect(parseCoords('42,-93')).toEqual({ lat: 42, lon: -93 })
    expect(parseCoords('Ames, Iowa')).toBeNull()
    expect(parseCoords('95, -93')).toBeNull()
  })

  it('미국 본토 안인지', () => {
    expect(inMainland({ lat: 42.03, lon: -93.62 })).toBe(true)
    expect(inMainland({ lat: 61.2, lon: -149.9 })).toBe(false) // Anchorage
    expect(inMainland({ lat: 21.3, lon: -157.8 })).toBe(false) // Honolulu
  })

  it('가장 가까운 청크와 거리', () => {
    const c = (id: string, lat: number, lon: number) => ({ chunk_id: id, lat, lon }) as Chunk
    const r = nearestChunk([c('far', 45, -93), c('near', 42.1, -93.62), c('mid', 43, -93.62)], { lat: 42.03, lon: -93.62 })
    expect(r?.chunk.chunk_id).toBe('near')
    expect(r?.km).toBeCloseTo((0.07 * Math.PI * 6371) / 180, 6)
    expect(nearestChunk([], { lat: 0, lon: 0 })).toBeNull()
  })

  it('같은 기후 칸 표본을 우선한다', () => {
    const point = { lat: 42.03, lon: -93.62 }
    const sameCellId = cellIdOf(point.lat, point.lon)
    const c = (id: string, lat: number, lon: number, climate_cell: string) =>
      ({ chunk_id: id, lat, lon, climate_cell }) as Chunk
    const closerOtherCell = c('other-near', 42.04, -93.62, 'C_+41.50_-093.750')
    const fartherSameCell = c('same-far', 42.2, -93.62, sameCellId)
    const evenFartherSameCell = c('same-very-far', 42.4, -93.62, sameCellId)

    const hit = nearestSample([closerOtherCell, evenFartherSameCell, fartherSameCell], point)
    expect(hit?.chunk.chunk_id).toBe('same-far')
    expect(hit?.sameCell).toBe(true)

    const fallback = nearestSample([closerOtherCell, c('other-far', 45, -93, 'C_+45.00_-093.125')], point)
    expect(fallback?.chunk.chunk_id).toBe('other-near')
    expect(fallback?.sameCell).toBe(false)

    expect(nearestSample([], point)).toBeNull()
  })

  it('지명 줄이기', () => {
    expect(shortPlaceName('Ames, Story County, Iowa, 50010, United States')).toBe('Ames, Iowa')
    expect(shortPlaceName('Iowa, United States')).toBe('Iowa')
  })
})
