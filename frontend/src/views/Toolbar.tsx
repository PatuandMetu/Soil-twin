import { useState } from 'react'
import { usePanels } from '../panels/context'
import { useAppState } from '../state'
import { MAIN_PANELS, PANEL_TITLE, mainPanelOptions } from './panels'

export function Toolbar() {
  const { ref, shifted, search, actions } = useAppState()
  const panels = usePanels()
  const [q, setQ] = useState('')
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
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (!search.busy) actions.search(q)
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find my field: town, address, or 42.03, -93.62"
          aria-label="Find my field by place name, address, or coordinates"
        />
        <button type="submit" className="btn" disabled={search.busy || !q.trim()}>
          {search.busy ? 'Searching…' : 'Search'}
        </button>
        {search.message && !search.busy && (
          <div className={`search-msg ${search.tone}`} role="status">
            {search.message}
            {search.place && <span className="muted"> from {search.place.label}</span>}
            <button type="button" className="fp-btn" aria-label="Dismiss" title="Dismiss" onClick={actions.dismissSearch}>
              ✕
            </button>
          </div>
        )}
      </form>
      <button type="button" className="btn" disabled={!ref} onClick={actions.clearRef}>
        Change field
      </button>
    </div>
  )
}
