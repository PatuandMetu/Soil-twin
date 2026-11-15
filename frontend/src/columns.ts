/** 화면 3분할(지도 | Land Info | Comparison)에서 사용자가 끌어 바꾼 오른쪽 두 칸의 너비 (px) */

export type ColWidths = { info: number; detail: number }

/** 칸마다 이보다 좁아지지 않는다 */
export const COL_MIN = { map: 320, info: 260, detail: 320 }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 지도|Info 경계를 dx만큼 끌었을 때: 왼쪽으로 끌면 Info가 넓어지고 지도가 좁아진다. Comparison은 그대로 */
export function dragMapEdge(start: ColWidths, dx: number, vw: number): ColWidths {
  return { ...start, info: clamp(start.info - dx, COL_MIN.info, vw - start.detail - COL_MIN.map) }
}

/** Info|Comparison 경계를 dx만큼 끌었을 때: 두 칸 합은 그대로, 지도도 그대로 */
export function dragMiddleEdge(start: ColWidths, dx: number): ColWidths {
  const total = start.info + start.detail
  const info = clamp(start.info + dx, COL_MIN.info, total - COL_MIN.detail)
  return { info, detail: total - info }
}

/** 창이 좁아져 지도가 최소 폭보다 좁아지면 Comparison부터, 그다음 Info를 줄인다 */
export function fitColumns(w: ColWidths, vw: number): ColWidths {
  let over = w.info + w.detail + COL_MIN.map - vw
  if (over <= 0) return w
  const detail = Math.max(COL_MIN.detail, w.detail - over)
  over -= w.detail - detail
  const info = Math.max(COL_MIN.info, w.info - Math.max(0, over))
  return { info, detail }
}

/** 저장값 검사: 숫자가 아니면 null (기본 너비) */
export function parseColumns(raw: string | null): ColWidths | null {
  try {
    const v: unknown = JSON.parse(raw ?? 'null')
    if (typeof v !== 'object' || v === null) return null
    const { info, detail } = v as Record<string, unknown>
    if (typeof info !== 'number' || typeof detail !== 'number' || !Number.isFinite(info) || !Number.isFinite(detail)) return null
    return { info: Math.max(COL_MIN.info, info), detail: Math.max(COL_MIN.detail, detail) }
  } catch {
    return null
  }
}
