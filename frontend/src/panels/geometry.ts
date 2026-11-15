/** 떠 있는 패널의 위치·크기 계산 (화면 좌표, px) */

export type Point = { x: number; y: number }
export type Size = { w: number; h: number }
export type Rect = Point & Size
export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** 접었을 때 남는 제목줄 높이 */
export const TITLE_H = 34
/** 크기를 주지 않고 연 패널의 기본 크기 */
export const DEFAULT_SIZE: Size = { w: 380, h: 420 }
/** 새 패널이 앞 패널에서 비켜 뜨는 거리 */
export const CASCADE = 28

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 패널이 화면 밖으로 나가지 않게 위치만 당긴다. 크기는 그대로.
 * 화면보다 큰 패널은 왼쪽·위에 붙인다. 접힌 패널은 제목줄 높이로 본다.
 */
export function clampRect(r: Rect, vw: number, vh: number, collapsed = false): Rect {
  const h = collapsed ? TITLE_H : r.h
  return { ...r, x: clamp(r.x, 0, Math.max(0, vw - r.w)), y: clamp(r.y, 0, Math.max(0, vh - h)) }
}

/**
 * 모서리를 dx, dy만큼 끌었을 때의 새 사각형.
 * 기본 크기(min)보다 작아지지 않고, 화면 밖으로 늘어나지 않는다. 반대쪽 모서리는 제자리.
 */
export function resizeRect(start: Rect, dx: number, dy: number, corner: Corner, min: Size, vw: number, vh: number): Rect {
  let { x, y, w, h } = start
  if (corner === 'ne' || corner === 'se') w = clamp(start.w + dx, min.w, vw - start.x)
  if (corner === 'sw' || corner === 'se') h = clamp(start.h + dy, min.h, vh - start.y)
  if (corner === 'nw' || corner === 'sw') {
    w = clamp(start.w - dx, min.w, start.x + start.w)
    x = start.x + start.w - w
  }
  if (corner === 'nw' || corner === 'ne') {
    h = clamp(start.h - dy, min.h, start.y + start.h)
    y = start.y + start.h - h
  }
  return { x, y, w, h }
}

/** 위치를 주지 않고 연 패널: 맨 위 패널에서 조금 비켜서. 열린 패널이 없으면 왼쪽 위 근처 */
export function cascadeFrom(top: Rect | undefined, size: Size, vw: number, vh: number): Point {
  const p = top ? { x: top.x + CASCADE, y: top.y + CASCADE } : { x: 80, y: 80 }
  const { x, y } = clampRect({ ...p, ...size }, vw, vh)
  return { x, y }
}

/** 저장된 사각형을 쓸 수 있는 값으로: 숫자 검사, 기본 크기 이상, 화면 안 */
export function restoreRect(saved: unknown, min: Size, vw: number, vh: number): Rect | null {
  if (typeof saved !== 'object' || saved === null) return null
  const { x, y, w, h } = saved as Record<string, unknown>
  if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return clampRect({ x: x as number, y: y as number, w: Math.max(min.w, w as number), h: Math.max(min.h, h as number) }, vw, vh)
}
