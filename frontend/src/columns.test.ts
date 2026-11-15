import { describe, expect, it } from 'vitest'
import { COL_MIN, dragMapEdge, dragMiddleEdge, fitColumns, parseColumns } from './columns'

const VW = 1440
const start = { info: 360, detail: 380 }

describe('사이드바 너비 조절', () => {
  it('지도|Info 경계를 왼쪽으로 끌면 Info가 넓어지고 Comparison은 그대로', () => {
    expect(dragMapEdge(start, -100, VW)).toEqual({ info: 460, detail: 380 })
    expect(dragMapEdge(start, 50, VW)).toEqual({ info: 310, detail: 380 })
  })
  it('지도와 Info는 최소 폭 아래로 줄지 않는다', () => {
    expect(dragMapEdge(start, -5000, VW).info).toBe(VW - 380 - COL_MIN.map)
    expect(dragMapEdge(start, 5000, VW).info).toBe(COL_MIN.info)
  })
  it('Info|Comparison 경계는 두 칸 합을 지키며 옮긴다', () => {
    expect(dragMiddleEdge(start, 40)).toEqual({ info: 400, detail: 340 })
    expect(dragMiddleEdge(start, 500)).toEqual({ info: 740 - COL_MIN.detail, detail: COL_MIN.detail })
    expect(dragMiddleEdge(start, -500)).toEqual({ info: COL_MIN.info, detail: 740 - COL_MIN.info })
  })
  it('창이 좁아지면 Comparison부터 줄여 지도 최소 폭을 지킨다', () => {
    expect(fitColumns({ info: 400, detail: 600 }, 1440)).toEqual({ info: 400, detail: 600 })
    expect(fitColumns({ info: 400, detail: 600 }, 1200)).toEqual({ info: 400, detail: 480 })
    expect(fitColumns({ info: 400, detail: 600 }, 900)).toEqual({ info: COL_MIN.info, detail: COL_MIN.detail })
  })
  it('저장값이 깨졌으면 기본 너비(null)', () => {
    expect(parseColumns(null)).toBeNull()
    expect(parseColumns('{bad')).toBeNull()
    expect(parseColumns('{"info":"a","detail":3}')).toBeNull()
    expect(parseColumns('{"info":100,"detail":500}')).toEqual({ info: COL_MIN.info, detail: 500 })
  })
})
