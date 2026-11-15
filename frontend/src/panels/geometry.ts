/** 지도를 옮길 때 가리는 영역을 비우는 여백 계산 (화면 좌표, px) */

export type Rect = { x: number; y: number; w: number; h: number }

export type Padding = { top: number; bottom: number; left: number; right: number }

/**
 * 지도를 옮길 때 패널에 가리지 않게 비울 여백. 펼친 패널 중 화면 왼쪽 절반에 있는 것은 왼쪽 여백,
 * 오른쪽 절반에 있는 것은 오른쪽 여백이 된다. 가운데가 minFree px보다 좁아지면 여백을 줄인다.
 */
export function freePadding(rects: Rect[], vw: number, vh: number, base: Padding, minFree = 240): Padding {
  let { left, right } = base
  for (const r of rects) {
    if (r.x + r.w / 2 < vw / 2) left = Math.max(left, r.x + r.w + base.left)
    else right = Math.max(right, vw - r.x + base.right)
  }
  const room = vw - left - right
  if (room < minFree) {
    const k = Math.max(0, vw - minFree) / (left + right)
    left = Math.floor(left * k)
    right = Math.floor(right * k)
  }
  return { top: Math.min(base.top, vh / 3), bottom: Math.min(base.bottom, vh / 3), left, right }
}
