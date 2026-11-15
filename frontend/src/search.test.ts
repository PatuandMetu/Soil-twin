import { describe, expect, it } from 'vitest'
import type { Chunk } from './engine'
import { inMainland, nearestChunk, parseCoords, shortPlaceName } from './search'

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

  it('지명 줄이기', () => {
    expect(shortPlaceName('Ames, Story County, Iowa, 50010, United States')).toBe('Ames, Iowa')
    expect(shortPlaceName('Iowa, United States')).toBe('Iowa')
  })
})
