import { createContext, useContext, type ReactNode } from 'react'
import type { Point, Rect, Size } from './geometry'

export type OpenOptions = {
  title: string
  /** 패널 내용. 내용 쪽은 패널 동작(옮기기·접기 등)을 몰라도 된다 */
  content: ReactNode
  /** 기본 크기 = 최소 크기. 없으면 DEFAULT_SIZE */
  size?: Size
  /** 처음 위치. 없으면 맨 위 패널에서 조금 비켜서 뜬다. 저장된 위치가 있으면 그것을 쓴다 */
  position?: Point
}

export type Panel = {
  id: string
  title: string
  content: ReactNode
  rect: Rect
  min: Size
  collapsed: boolean
}

export type PanelsApi = {
  /** 열린 패널, 겹침 순서(마지막이 맨 위) */
  panels: Panel[]
  /** 열거나(이미 열려 있으면 내용·제목을 바꾸고) 펼쳐서 맨 위로 */
  open: (id: string, options: OpenOptions) => void
  close: (id: string) => void
  focus: (id: string) => void
  toggleCollapse: (id: string) => void
  setRect: (id: string, rect: Rect) => void
  isOpen: (id: string) => boolean
  /** 지난번에 사용자가 닫아 둔 패널인지 (새로고침 뒤 다시 열지 않으려고) */
  wasClosed: (id: string) => boolean
}

export const PanelsContext = createContext<PanelsApi | null>(null)

export function usePanels(): PanelsApi {
  const api = useContext(PanelsContext)
  if (!api) throw new Error('usePanels는 PanelProvider 안에서 쓴다')
  return api
}

