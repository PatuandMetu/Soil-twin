import { MAP_COLOR } from '../mapColors'

export function Legend() {
  return (
    <div className="legend-box" aria-label="Map legend">
      <span>
        <i className="sq" style={{ background: 'rgba(21, 101, 192, 0.25)', borderColor: '#1565c0' }} /> Your field (outline)
      </span>
      <span>
        <i style={{ background: MAP_COLOR.ref }} /> Sample field used
      </span>
      <span>
        <i style={{ background: MAP_COLOR.twin }} /> Close match
      </span>
      <span>
        <i style={{ background: MAP_COLOR.constrained }} /> Match with a growing constraint
      </span>
      <span>
        <i style={{ background: MAP_COLOR.other }} /> Other sample fields
      </span>
      <span>
        <b className="pin-sample">1</b> Similar area (rank)
      </span>
    </div>
  )
}
