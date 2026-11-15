import { describe, expect, it } from 'vitest'
import { CASCADE, TITLE_H, cascadeFrom, clampRect, freePadding, resizeRect, restoreRect } from './geometry'

const VW = 1440
const VH = 900
const MIN = { w: 300, h: 200 }

describe('패널 위치', () => {
  it('화면 밖으로 나가지 않게 위치만 당긴다', () => {
    expect(clampRect({ x: -50, y: -10, w: 300, h: 200 }, VW, VH)).toEqual({ x: 0, y: 0, w: 300, h: 200 })
    expect(clampRect({ x: 1300, y: 800, w: 300, h: 200 }, VW, VH)).toEqual({ x: 1140, y: 700, w: 300, h: 200 })
  })
  it('접힌 패널은 제목줄만 화면 안에 있으면 된다', () => {
    expect(clampRect({ x: 0, y: 899, w: 300, h: 500 }, VW, VH, true).y).toBe(VH - TITLE_H)
  })
  it('화면보다 큰 패널은 왼쪽 위에 붙인다', () => {
    expect(clampRect({ x: 50, y: 50, w: 2000, h: 1000 }, VW, VH)).toEqual({ x: 0, y: 0, w: 2000, h: 1000 })
  })
})

describe('패널 크기', () => {
  const start = { x: 100, y: 100, w: 300, h: 200 }
  it('오른쪽 아래 모서리로 늘린다', () => {
    expect(resizeRect(start, 50, 30, 'se', MIN, VW, VH)).toEqual({ x: 100, y: 100, w: 350, h: 230 })
  })
  it('기본 크기보다 작게는 못 줄인다', () => {
    expect(resizeRect(start, -80, -80, 'se', MIN, VW, VH)).toEqual(start)
    expect(resizeRect(start, 80, 80, 'nw', MIN, VW, VH)).toEqual(start)
  })
  it('왼쪽 위 모서리로 늘리면 오른쪽 아래 모서리는 제자리', () => {
    const r = resizeRect(start, -40, -20, 'nw', MIN, VW, VH)
    expect(r).toEqual({ x: 60, y: 80, w: 340, h: 220 })
    expect(r.x + r.w).toBe(start.x + start.w)
  })
  it('화면 밖으로는 늘어나지 않는다', () => {
    expect(resizeRect(start, 5000, 5000, 'se', MIN, VW, VH)).toEqual({ x: 100, y: 100, w: VW - 100, h: VH - 100 })
    expect(resizeRect(start, -500, -500, 'nw', MIN, VW, VH)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })
})

describe('새 패널 위치와 저장값', () => {
  it('맨 위 패널에서 조금 비켜 뜬다', () => {
    expect(cascadeFrom({ x: 100, y: 120, w: 300, h: 200 }, MIN, VW, VH)).toEqual({ x: 100 + CASCADE, y: 120 + CASCADE })
    expect(cascadeFrom(undefined, MIN, VW, VH)).toEqual({ x: 80, y: 80 })
  })
  it('저장값이 깨졌으면 쓰지 않고, 쓸 때는 기본 크기 이상·화면 안으로', () => {
    expect(restoreRect(null, MIN, VW, VH)).toBeNull()
    expect(restoreRect({ x: 1, y: 2, w: 'a', h: 3 }, MIN, VW, VH)).toBeNull()
    expect(restoreRect({ x: 5000, y: 10, w: 100, h: 100 }, MIN, VW, VH)).toEqual({ x: VW - 300, y: 10, w: 300, h: 200 })
  })
})

describe('지도 여백', () => {
  const base = { top: 80, bottom: 60, left: 20, right: 20 }
  it('왼쪽 패널은 왼쪽 여백, 오른쪽 패널은 오른쪽 여백', () => {
    const p = freePadding([{ x: 12, y: 68, w: 360, h: 600 }, { x: 1008, y: 68, w: 420, h: 400 }], VW, VH, base)
    expect(p).toEqual({ top: 80, bottom: 60, left: 392, right: 452 })
  })
  it('가운데가 너무 좁으면 여백을 줄인다', () => {
    const p = freePadding([{ x: 0, y: 0, w: 700, h: 600 }, { x: 740, y: 0, w: 700, h: 400 }], VW, VH, base)
    expect(VW - p.left - p.right).toBeGreaterThanOrEqual(240)
  })
})
