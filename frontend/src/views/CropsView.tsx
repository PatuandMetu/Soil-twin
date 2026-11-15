import { CSB_YEARS } from '../csb'
import { CROP_KEYS, patternKey, summarizeRotations, type Chunk } from '../engine'
import { useAppState } from '../state'
import { patternLabel, pct, plural, warningText } from '../text'
import { CodesBand, CropCells, YearHeads } from './CropBand'

const shortId = (id: string) => `…${id.slice(-6)}`

/** 고른 지역 밭들의 작물 띠, 윤작 요약, 밭 하나와 내 밭 비교 */
export function CropsView() {
  const { ref, crops, region, compareId, picked, actions } = useAppState()
  if (!ref) return <p className="empty">Pick your field first.</p>
  if (!region) return <p className="empty">No similar area to show.</p>

  const summary = summarizeRotations(ref, region.members, crops)
  const pick = region.members.find((s) => s.chunk.chunk_id === compareId) ?? region.members[0]
  const n = region.members.length
  // 지도에서 실제 밭을 골랐으면 "내 윤작"은 그 밭(2017~2024)으로 본다. 표본 행은 "Sample"
  const yourKey = picked
    ? patternKey(Object.fromEntries(CROP_KEYS.map((k, i) => [k, picked.crops[i]])) as unknown as Chunk, crops)
    : summary.current.key
  const youLabel = picked ? 'Sample' : 'You'

  return (
    <>
      <p className="head">
        <span className="rank">{region.rank}</span> Area {region.rank} · {region.states.join('/')} · {plural(n, 'field')}
      </p>

      {picked && (
        <>
          <h4>Your field, 2017–2024</h4>
          <CodesBand years={CSB_YEARS} codes={picked.crops} crops={crops} />
          <p className="muted">USDA’s current field layer covers 2017–2024; the sample table covers 2018–2025.</p>
        </>
      )}
      <h4>What was planted, 2018–2025</h4>
      <p className="muted">Click a field to compare it with yours below.</p>
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
              onClick={() => actions.setCompare(s.chunk.chunk_id)}
            >
              <th title={s.chunk.chunk_id}>{shortId(s.chunk.chunk_id)}</th>
              <CropCells chunk={s.chunk} crops={crops} />
              <td className="num">{pct(s.score.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Rotations in this area</h4>
      <ul className="patterns">
        {summary.patterns.map((p) => (
          <li key={p.key}>
            <b>{patternLabel(p.key)}</b>: {p.count} of {plural(p.total, 'field')}, {pct(p.areaShare * 100)} of the area
            {p.key === yourKey && <span className="badge same">same as yours</span>}
          </li>
        ))}
      </ul>
      <p className="muted">
        Your rotation: {patternLabel(yourKey)} (crops grown 2+ of 8 years{picked ? ', your field 2017–2024' : ''}).
      </p>
      <p className="caveat">
        These are choices farmers made, not proof that they worked. There is no yield or profit data here, and the crops
        are satellite-classified, so check locally before changing a rotation.
      </p>

      <h4>
        {picked ? 'Linked sample' : 'Your field'} vs. field {shortId(pick.chunk.chunk_id)}
      </h4>
      <p className="kv">
        {pick.chunk.state} · {Math.round(pick.chunk.acres)} acres · overall {pct(pick.score.total)} · soil{' '}
        {pct(pick.score.soil)} · climate {pct(pick.score.climate)}
      </p>
      <table className="bands">
        <thead>
          <tr>
            <th></th>
            <YearHeads />
          </tr>
        </thead>
        <tbody>
          <tr className="you">
            <th>{youLabel}</th>
            <CropCells chunk={ref} crops={crops} />
          </tr>
          <tr>
            <th>There</th>
            <CropCells chunk={pick.chunk} crops={crops} />
          </tr>
        </tbody>
      </table>
      {pick.score.warnings.length > 0 ? (
        <ul className="warn-list">
          {pick.score.warnings.map((w) => (
            <li key={w.code}>{warningText(w)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No growing constraint flagged between the two fields.</p>
      )}
    </>
  )
}
