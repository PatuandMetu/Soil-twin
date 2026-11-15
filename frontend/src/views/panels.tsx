import { useAppState, type SideTab } from '../state'
import { AreasView } from './AreasView'
import { DetailView } from './DetailView'

export const DOCK_WIDTH = 420
export const DOCK_TOP = 68 // 도구줄 아래
export const DOCK_BOTTOM = 52 // 지도 출처 표시 자리 위
export const DOCK_GAP = 12

const TABS: { id: SideTab; label: string }[] = [
  { id: 'info', label: 'Land Info' },
  { id: 'detail', label: 'Detail' },
]

/** 오른쪽 고정 탭 패널 (Land Info · Detail) */
export function SideDock() {
  const { tab, actions } = useAppState()
  return (
    <aside className="side-dock" aria-label="Field analysis">
      <div className="side-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`side-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => actions.setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="fp-body side-body" role="tabpanel">
        {tab === 'info' ? <AreasView /> : <DetailView />}
      </div>
    </aside>
  )
}
