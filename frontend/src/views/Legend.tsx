import { MAP_COLOR } from '../mapColors'

export function Legend() {
  return (
    <div className="legend-box" aria-label="Map legend">
      <span>
        <i className="sq" style={{ background: 'rgba(21, 101, 192, 0.25)', borderColor: '#1565c0' }} /> Your field
      </span>
      <span>
        <i style={{ background: MAP_COLOR.ref }} /> Sample used
      </span>
      <span>
        <i style={{ background: MAP_COLOR.twin }} /> Close match
      </span>
      <span>
        <i style={{ background: MAP_COLOR.constrained }} /> With constraint
      </span>
      <span>
        <i style={{ background: MAP_COLOR.other }} /> Other samples
      </span>
      <span>
        <b className="pin-sample">1</b> Area rank
      </span>
    </div>
  )
}
