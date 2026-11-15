import { useState } from 'react'
import { useAppState } from '../state'

export function Toolbar() {
  const { ref, shifted, search, actions } = useAppState()
  const [q, setQ] = useState('')
  return (
    <div className="toolbar" role="toolbar" aria-label="Magic Map">
      <span className="brand">Magic Map</span>
      <div className="seg" role="group" aria-label="Climate">
        <button type="button" aria-pressed={!shifted} onClick={() => actions.setShifted(false)}>
          Today’s climate
        </button>
        <button type="button" aria-pressed={shifted} onClick={() => actions.setShifted(true)}>
          Near-future (2035–2050)
        </button>
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
