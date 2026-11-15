import type { OpenOptions } from '../panels/context'
import { AreasView } from './AreasView'
import { CropsView } from './CropsView'
import { DetailView } from './DetailView'

/** 지금 쓰는 패널 세 가지. 새 정보는 내용 컴포넌트를 만들고 open(id, …)만 하면 된다 */
export const MAIN_PANELS = ['areas', 'detail', 'crops'] as const
export type MainPanel = (typeof MAIN_PANELS)[number]

export const PANEL_TITLE: Record<MainPanel, string> = { areas: 'Areas', detail: 'Detail', crops: 'Crops' }

const TOP = 68 // 도구줄 아래
const GAP = 12
const BOTTOM = 64 // 지도 출처 표시와 확대·축소 버튼 자리

/** 기본 크기와 첫 위치 (화면 크기에 맞춰). 저장된 위치·크기가 있으면 그것이 먼저다 */
export function mainPanelOptions(id: MainPanel, vw: number, vh: number): OpenOptions {
  const avail = Math.max(400, vh - TOP - BOTTOM)
  const detailH = Math.max(240, Math.round((avail - GAP) * 0.55))
  const cropsH = Math.max(220, avail - GAP - detailH)
  switch (id) {
    case 'areas':
      return {
        title: PANEL_TITLE.areas,
        content: <AreasView />,
        size: { w: 360, h: Math.max(300, Math.min(620, avail - 40)) },
        position: { x: GAP, y: TOP },
      }
    case 'detail':
      return {
        title: PANEL_TITLE.detail,
        content: <DetailView />,
        size: { w: 420, h: detailH },
        position: { x: vw - 420 - GAP, y: TOP },
      }
    case 'crops':
      return {
        title: PANEL_TITLE.crops,
        content: <CropsView />,
        size: { w: 460, h: cropsH },
        position: { x: vw - 460 - GAP, y: TOP + detailH + GAP },
      }
  }
}
