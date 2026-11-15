import { describe, expect, it } from 'vitest'
import { freePadding } from './geometry'

const VW = 1440
const VH = 900

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
