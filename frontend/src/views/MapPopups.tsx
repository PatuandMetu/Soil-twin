import { useState } from 'react'
import { MapPopup } from '../components/MapPopup'
import { CSB_YEARS } from '../csb'
import type { Region } from '../engine'
import { useZoomBelow } from '../mapContext'
import { shortId, useAppState, useYourRotation } from '../state'
import { patternLabel, pct, warningText } from '../text'
import { CodesBand, CropBand, CropCells, YearHeads } from './CropBand'

/** 이 줌보다 축소하면 팝업은 제목줄만 */
const COLLAPSE_BELOW = 6

/** 고른 밭 옆에 붙는 팝업: 이름표, 8년 작물 띠, 현재 윤작 (실제 밭이면 연결 표본 띠도) */
export function FieldPopup() {
  const { ref, crops, picked } = useAppState()
  const small = useZoomBelow(COLLAPSE_BELOW)
  const yours = useYourRotation()
  if (!ref || !yours) return null
  const at = picked ? { lon: picked.lon, lat: picked.lat } : { lon: ref.lon, lat: ref.lat }
  return (
    <MapPopup lon={at.lon} lat={at.lat} className="map-pop field-pop" offset={16}>
      <div className="pop-head">
        <span className="pop-title">Your field</span>
      </div>
      {!small && (
        <div className="pop-body">
          <p className="muted">{yours.label}</p>
          {picked ? (
            <CodesBand years={CSB_YEARS} codes={picked.crops} crops={crops} />
          ) : (
            <CropBand chunk={ref} crops={crops} />
          )}
          <p className="kv">
            Current rotation: <b>{patternLabel(yours.key)}</b>
          </p>
          {picked && (
            <>
              <p className="muted">Linked sample {shortId(ref.chunk_id)}, 2018–2025</p>
              <CropBand chunk={ref} crops={crops} />
            </>
          )}
        </div>
      )}
    </MapPopup>
  )
}

function RegionPopup({ region, pinned, raise }: { region: Region; pinned: boolean; raise?: number }) {
  const { ref, crops, picked, actions } = useAppState()
  const small = useZoomBelow(COLLAPSE_BELOW)
  const [compareId, setCompareId] = useState<string | null>(null)
  if (!ref) return null

  const pick = region.members.find((s) => s.chunk.chunk_id === compareId) ?? region.members[0]
  const youLabel = picked ? 'Sample' : 'You'

  return (
    <MapPopup lon={region.lon} lat={region.lat} className="map-pop region-pop" offset={18} raise={raise}>
      <div className="pop-head">
        <span className="rank">{region.rank}</span>
        <span className="pop-title">
          Area {region.rank} · {pct(region.similarity)} · {region.states.join('/')}
        </span>
        {!pinned && (
          <button type="button" className="pop-btn" onClick={() => actions.pinRegionPopup(region.cell)} title="Keep this popup open">
            Pin
          </button>
        )}
        <button
          type="button"
          className="fp-btn"
          aria-label={`Close area ${region.rank}`}
          title="Close"
          onClick={() => actions.closeRegionPopup(region.cell)}
        >
          ✕
        </button>
      </div>
      {!small && (
        <div className="pop-body">
          <div className="pop-sub">What was planted, 2018–2025 · click a field</div>
          <table className="bands">
            <thead>
              <tr>
                <th></th>
                <YearHeads />
                <th className="num">Match</th>
              </tr>
            </thead>
            <tbody>
              <tr className="you">
                <th title={picked ? 'Linked sample field' : undefined}>{youLabel}</th>
                <CropCells chunk={ref} crops={crops} />
                <td></td>
              </tr>
              {region.members.map((s) => (
                <tr
                  key={s.chunk.chunk_id}
                  className={`pickable${s === pick ? ' active' : ''}`}
                  onClick={() => setCompareId(s.chunk.chunk_id)}
                >
                  <th title={s.chunk.chunk_id}>{shortId(s.chunk.chunk_id)}</th>
                  <CropCells chunk={s.chunk} crops={crops} />
                  <td className="num">{pct(s.score.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv">
            Field {shortId(pick.chunk.chunk_id)} · {pick.chunk.state} · {Math.round(pick.chunk.acres)} acres · overall{' '}
            {pct(pick.score.total)} · soil {pct(pick.score.soil)} · climate {pct(pick.score.climate)}
          </p>
          {pick.score.warnings.length > 0 ? (
            <ul className="warn-list">
              {pick.score.warnings.map((w) => (
                <li key={w.code}>{warningText(w)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No growing constraint flagged between the two fields.</p>
          )}
          <p className="muted">No yield or profit data; crops are satellite-classified.</p>
        </div>
      )}
    </MapPopup>
  )
}

/**
 * 지역 작물 팝업: 고른 지역에 하나(떠 있는 팝업, 다른 지역을 고르면 옮겨 감) + Pin으로 남긴 것들.
 * 밭·모드가 바뀌어 지역이 사라지면 그 팝업은 그리지 않는다.
 */
export function RegionPopups() {
  const { regions, regionPopups } = useAppState()
  const byCell = new Map(regions.map((r) => [r.cell, r]))
  const { floating, pinned, raised } = regionPopups
  const cells = [...pinned, ...(floating && !pinned.includes(floating) ? [floating] : [])]
  return (
    <>
      {cells
        .filter((c) => byCell.has(c))
        .map((c) => (
          <RegionPopup
            key={c}
            region={byCell.get(c)!}
            pinned={pinned.includes(c)}
            raise={raised?.cell === c ? raised.seq : undefined}
          />
        ))}
    </>
  )
}
