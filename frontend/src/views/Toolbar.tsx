import { usePanels } from '../panels/context'
import { useAppState } from '../state'
import { MAIN_PANELS, PANEL_TITLE, mainPanelOptions } from './panels'

export function Toolbar() {
  const { ref, shifted, actions } = useAppState()
  const panels = usePanels()
  return (
    <div className="toolbar" role="toolbar" aria-label="Field Shift">
      <span className="brand">Field Shift</span>
      <div className="seg" role="group" aria-label="Climate">
        <button type="button" aria-pressed={!shifted} onClick={() => actions.setShifted(false)}>
          Today’s climate
        </button>
        <button type="button" aria-pressed={shifted} onClick={() => actions.setShifted(true)}>
          Warmer: +2.2 °C, 15% less summer rain
        </button>
      </div>
      <div className="seg" role="group" aria-label="Panels">
        {MAIN_PANELS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={panels.isOpen(id)}
            onClick={() => panels.open(id, mainPanelOptions(id, window.innerWidth, window.innerHeight))}
          >
            {PANEL_TITLE[id]}
          </button>
        ))}
      </div>
      <button type="button" className="btn" disabled={!ref} onClick={actions.clearRef}>
        Change field
      </button>
    </div>
  )
}
