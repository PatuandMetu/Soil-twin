import { profileOf, type Block, type Warning } from '../engine'
import { describeItems } from '../describe'
import { useAppState } from '../state'
import { WARNING_SHORT, km, pct, plural } from '../text'

/** 고른 지역의 항목별 유사율과 실제 값 비교 */
export function DetailView() {
  const { ref, shifted, region, picked } = useAppState()
  if (!ref) return <p className="empty">Pick your field first.</p>
  if (!region) return <p className="empty">No similar area to show.</p>

  const rows = describeItems(profileOf(ref, shifted), region)
  const n = region.members.length
  const counts = new Map<Warning['code'], number>()
  for (const s of region.members) for (const w of s.score.warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + 1)
  const warned = region.members.filter((s) => s.score.warnings.length > 0).length

  return (
    <>
      <p className="head">
        <span className="rank">{region.rank}</span> <b>{pct(region.similarity)} similar</b> · {region.states.join('/')} ·{' '}
        {km(region.distanceKm)} {region.direction} of your field · {plural(n, 'field')}
      </p>
      <p className="muted">
        Each score is the median over the {plural(n, 'field')} here{n > 1 ? ' (soil also shows the range)' : ''}. “There”
        soil values are medians too. Climate comes from one ~50 km grid cell, so it is the same for every field in an area.
      </p>
      {picked && (
        <p className="note">
          “You” values come from the linked sample field, {km(picked.sampleKm)} from your field.
          {!picked.sameCell && ' It is in a different climate area, so results are less reliable.'}
        </p>
      )}
      {warned > 0 && (
        <p className="warn">
          {warned} of {plural(n, 'field')} {warned === 1 ? 'has' : 'have'} a growing constraint:{' '}
          {[...counts].map(([code, c]) => `${WARNING_SHORT[code]} (${c})`).join(', ')}
        </p>
      )}
      {(['soil', 'climate'] as Block[]).map((block) => (
        <section key={block} className="items">
          <h4>{block === 'soil' ? 'Soil and land' : shifted ? 'Climate (yours: 2035–2050)' : 'Climate'}</h4>
          {rows
            .filter((r) => r.block === block)
            .map((r) => (
              <div key={r.key} className={`item${r.biggest ? ' biggest' : ''}`}>
                <div className="item-head">
                  <span className="item-label">{r.label}</span>
                  {r.biggest && <span className="badge">Biggest difference</span>}
                  <span className="item-score">
                    {pct(r.score.median)}
                    {block === 'soil' && Math.round(r.score.min) !== Math.round(r.score.max) && (
                      <small>
                        {' '}
                        ({pct(r.score.min)}–{pct(r.score.max)})
                      </small>
                    )}
                  </span>
                </div>
                <div className="bar" aria-hidden="true">
                  <div style={{ width: `${r.score.median}%` }} />
                </div>
                <div className="item-values">
                  You {r.you} · There {r.there} · <b>{r.diff}</b>
                </div>
              </div>
            ))}
        </section>
      ))}
      <p className="muted">Temperature and rainfall scores compare all 12 months (Apr–Sep count double); the lines show Apr–Sep.</p>
    </>
  )
}
