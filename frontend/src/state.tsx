import { createContext, useContext } from 'react'
import type { Chunk, CropNames, Region, SimilarResult } from './engine'

export type SearchState = {
  busy: boolean
  /** 도구줄 아래에 띄우는 한 줄 (없으면 null) */
  message: string | null
  tone: 'info' | 'error'
  /** 찾은 자리와 거기서 가장 가까운 표본 밭까지 거리 */
  place: { lat: number; lon: number; label: string; nearestKm: number } | null
}

export const IDLE_SEARCH: SearchState = { busy: false, message: null, tone: 'info', place: null }

export type AppActions = {
  selectChunk: (id: string) => void
  clearRef: () => void
  setShifted: (v: boolean) => void
  /** 지역을 고르고 Detail 패널을 연다 */
  selectRegion: (cell: string) => void
  setCompare: (id: string) => void
  search: (query: string) => void
  /** 검색 결과 말풍선만 닫는다 (찾은 자리와 거리는 Areas에 남는다) */
  dismissSearch: () => void
}

export type AppState = {
  chunks: Chunk[]
  crops: CropNames
  ref: Chunk | null
  shifted: boolean
  result: SimilarResult | null
  regions: Region[]
  /** 지금 보는 지역 (고른 것이 없으면 1위) */
  region: Region | null
  /** Crops 패널에서 내 밭과 나란히 볼 밭 */
  compareId: string | null
  search: SearchState
  actions: AppActions
}

export const AppStateContext = createContext<AppState | null>(null)

export function useAppState(): AppState {
  const s = useContext(AppStateContext)
  if (!s) throw new Error('useAppState는 AppStateContext 안에서 쓴다')
  return s
}
