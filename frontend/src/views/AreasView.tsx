import { CSB_YEARS } from '../csb'
import { config, profileOf } from '../engine'
import { growingRain, growingTemp, soilSummary } from '../describe'
import { useAppState } from '../state'
import { DIRECTION_SHORT, km, latLon, pct, plural } from '../text'
import { CodesBand, CropBand } from './CropBand'

/** 내 밭 요약 + 비슷한 지역 목록 */
export function AreasView() {
  const { chunks, crops, ref, shifted, result, regions, region, search, picked, actions } = useAppState()

  if (!ref || !result)
    return (
      <div className="empty">
        <p>
          <b>Pick your field.</b> Click a dot on the map, or search above for a town, an address, or coordinates such as
          “42.03, -93.62”.
        </p>
        <p className="muted">
          The map shows {chunks.length.toLocaleString('en-US')} sample fields from USDA NASS Crop Sequence Boundaries.
          Their crops are satellite-classified, not farmer records.
        </p>
      </div>
    )

  const now = profileOf(ref)
  const warm = profileOf(ref, true)
  const nFields = result.similar.length

  return (
    <>
      {picked && (
        <>
          <h3>Your field</h3>
          <p className="kv">
            {picked.state} · {latLon(picked.lat, picked.lon)} · {picked.acres.toFixed(1)} acres
            <br />
            <span className="muted">USDA Crop Sequence Boundaries field {picked.csbid}, crops 2017–2024</span>
          </p>
          <CodesBand years={CSB_YEARS} codes={picked.crops} crops={crops} />
          <p className={picked.sameCell ? 'note' : 'warn-box'}>
            Analysis uses the nearest sample field, {km(picked.sampleKm)} away.
            {!picked.sameCell && (
              <>
                <br />
                <b>No sample field in this climate area — results are less reliable.</b>
              </>
            )}
          </p>
        </>
      )}
      <h3>{picked ? 'Linked sample field' : 'Your field'}</h3>
      <p className="kv">
        Sample field {ref.chunk_id} · {ref.state} · {latLon(ref.lat, ref.lon)} · {Math.round(ref.acres)} acres
        {picked && <span className="muted"> · crops 2018–2025</span>}
      </p>
      {search.place && (
        <p className="note">
          Nearest sample field: {km(search.place.nearestKm)} away from {search.place.label}
        </p>
      )}
      <CropBand chunk={ref} crops={crops} />
      <p className="kv">
        Apr–Sep: {growingTemp(now).toFixed(1)} °C average, {Math.round(growingRain(now))} mm rain
        {shifted && (
          <>
            <br />
            Warmer scenario: {growingTemp(warm).toFixed(1)} °C, {Math.round(growingRain(warm))} mm
          </>
        )}
      </p>
      <p className="kv">Soil: {soilSummary(now)}</p>

      <h3>Similar areas</h3>
      {shifted && <p className="muted">Places whose climate today is like your field’s warmer climate.</p>}
      {result.noneFound ? (
        <p className="none">
          No sample field is similar enough (overall 80+ and soil 65+
          {shifted ? `, climate ${config.shiftClimateGate}+` : ''}) among the {chunks.length.toLocaleString('en-US')}{' '}
          samples. The sample is small, so this does not mean nothing similar exists.
        </p>
      ) : (
        <>
          <p className="muted">
            {plural(nFields, 'similar field')} in {plural(regions.length, 'area')} (at most {config.cellCap} per area,
            fields 100 km or more away). Area similarity = median score of its fields.
          </p>
          <ol className="area-list">
            {regions.map((r) => (
              <li key={r.cell}>
                <button
                  type="button"
                  className={`area-row${r.cell === region?.cell ? ' active' : ''}`}
                  onClick={() => actions.selectRegion(r.cell)}
                >
                  <span className="rank">{r.rank}</span>
                  <span className="sim">{pct(r.similarity)}</span>
                  <span className="st">{r.states.join('/')}</span>
                  <span className="dist">
                    {km(r.distanceKm)} {DIRECTION_SHORT[r.direction]}
                  </span>
                  <span className="n">{plural(r.members.length, 'field')}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  )
}
