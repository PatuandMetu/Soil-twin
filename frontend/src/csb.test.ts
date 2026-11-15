import { describe, expect, it } from 'vitest'
import { CSB_URL, cellIdOf, centroidOf, csbQueryUrl, stateOfFips, tileBounds, tilesFor } from './csb'

describe('실제 밭 윤곽선 (USDA CSB 2024)', () => {
  it('화면 범위를 0.1° 칸으로 나눈다', () => {
    expect(tilesFor({ w: -93.65, s: 41.95, e: -93.55, n: 42.02 }).sort()).toEqual(['-937_419', '-937_420', '-936_419', '-936_420'].sort())
    expect(tileBounds('-937_419')).toEqual({ w: -93.7, s: 41.9, e: -93.6, n: 42 })
  })

  it('요청 주소: 범위, 좌표계, 필드, geojson', () => {
    const u = new URL(csbQueryUrl({ w: -93.7, s: 41.9, e: -93.6, n: 42 }))
    expect(`${u.origin}${u.pathname}`).toBe(CSB_URL)
    expect(u.searchParams.get('geometry')).toBe('-93.7,41.9,-93.6,42')
    expect(u.searchParams.get('geometryType')).toBe('esriGeometryEnvelope')
    expect(u.searchParams.get('inSR')).toBe('4326')
    expect(u.searchParams.get('outSR')).toBe('4326')
    expect(u.searchParams.get('outFields')).toBe('csbid,csbacres,cdl2017,cdl2018,cdl2019,cdl2020,cdl2021,cdl2022,cdl2023,cdl2024,statefips')
    expect(u.searchParams.get('f')).toBe('geojson')
  })

  it('밭 중심: 사각형은 가운데, MultiPolygon은 가장 큰 조각', () => {
    const sq = (x: number, y: number, d: number): [number, number][] => [
      [x, y],
      [x + d, y],
      [x + d, y + d],
      [x, y + d],
      [x, y],
    ]
    expect(centroidOf({ type: 'Polygon', coordinates: [sq(-94, 42, 0.01)] })).toEqual({ lat: expect.closeTo(42.005, 9), lon: expect.closeTo(-93.995, 9) })
    const c = centroidOf({ type: 'MultiPolygon', coordinates: [[sq(-94, 42, 0.001)], [sq(-93, 41, 0.01)]] })
    expect(c.lat).toBeCloseTo(41.005, 9)
    expect(c.lon).toBeCloseTo(-92.995, 9)
  })

  it('기후 칸 번호는 builder와 같은 형식·반올림(0.5는 짝수 쪽)', () => {
    expect(cellIdOf(42.48, -97.77)).toBe('C_+42.50_-097.500')
    expect(cellIdOf(31.6, -85.7)).toBe('C_+31.50_-085.625')
    // 41.25/0.5 = 82.5 → 82 (짝수), 41.75/0.5 = 83.5 → 84
    expect(cellIdOf(41.25, -93)).toBe('C_+41.00_-093.125')
    expect(cellIdOf(41.75, -93)).toBe('C_+42.00_-093.125')
  })

  it('주 FIPS → 약자', () => {
    expect(stateOfFips('19')).toBe('IA')
    expect(stateOfFips('1')).toBe('AL')
  })
})
