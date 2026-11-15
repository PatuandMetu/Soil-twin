import { createContext, useContext } from 'react'
import type { CsbGeometry } from './csb'
import type { Chunk, CropNames, Region, SimilarResult } from './engine'

export type SearchState = {
  busy: boolean
  /** 도구줄 아래에 띄우는 한 줄 (없으면 null) */
  message: string | null
  tone: 'info' | 'error'
  /** 찾은 자리와 거기서 가장 가까운 표본 밭까지 거리 */
  place: { lat: number; lon: number; label: string; nearestKm: number } | null
}

/** 사용자가 지도에서 고른 실제 밭 (USDA CSB 2024)과 연결된 표본 밭 */
export type PickedField = {
  csbid: string
  acres: number
  state: string
  /** 2017~2024 작물 코드 */
  crops: number[]
  geometry: CsbGeometry
  /** 밭 중심 */
  lat: number
  lon: number
  /** 밭 중심의 기후 칸 */
  cell: string
  /** 가장 가까운 표본 밭(= 기준 청크)과 거리 */
  sampleId: string
  sampleKm: number
  /** 표본 밭이 같은 기후 칸에 있는지 */
  sameCell: boolean
}

export const IDLE_SEARCH: SearchState = { busy: false, message: null, tone: 'info', place: null }

export type SideTab = 'info' | 'detail'

export type AppActions = {
  selectChunk: (id: string) => void
  clearRef: () => void
  setShifted: (v: boolean) => void
  /** 지역을 고르고 Detail 탭으로 전환한다 */
  selectRegion: (cell: string) => void
  setCompare: (id: string) => void
  setTab: (tab: SideTab) => void
  search: (query: string) => void
  /** 검색 결과 말풍선만 닫는다 (찾은 자리와 거리는 Land Info에 남는다) */
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
  compareId: string | null
  tab: SideTab
  search: SearchState
  /** 지도에서 고른 실제 밭 (표본 점이나 검색으로 골랐으면 null) */
  picked: PickedField | null
  actions: AppActions
}

export const AppStateContext = createContext<AppState | null>(null)

export function useAppState(): AppState {
  const s = useContext(AppStateContext)
  if (!s) throw new Error('useAppState는 AppStateContext 안에서 쓴다')
  return s
}
