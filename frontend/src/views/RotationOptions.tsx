import {
  CROP_KEYS,
  METRIC_KEYS,
  rotationOptions,
  type MetricKey,
  type RotationOption,
  type Spread,
} from '../engine'
import { useAppState } from '../state'
import { patternLabel, plural } from '../text'

const METRIC_LABEL: Record<MetricKey, string> = {
  legumeYears: 'Legume years',
  fallowYears: 'Fallow years',
  perennialCoverYears: 'Perennial cover years',
  doubleCropYears: 'Double-crop years',
  cropTypes: 'Crop types',
  longestSameCropRun: 'Longest same-crop run',
}

/** 일반 농학 안내 (이 밭들에서 잰 것이 아님). 대안 카드는 지표 중앙값으로 본다 */
function benefits(v: Record<MetricKey, number>): string[] {
  const out: string[] = []
  if (v.legumeYears >= 1) out.push('Legumes add nitrogen to the soil.')
  if (v.perennialCoverYears >= 2) out.push('Perennial cover protects soil from erosion and can build organic matter.')
  if (v.fallowYears >= 1) out.push('Fallow leaves soil bare (erosion risk) but can store moisture in dry areas.')
  if (v.cropTypes >= 3) out.push('More crop types can break pest and disease cycles.')
  if (v.longestSameCropRun >= 3) out.push('The same crop several years in a row can build up pests.')
  return out
}

const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))
const spreadText = (s: Spread) => (s.min === s.max ? num(s.median) : `${num(s.median)} (${num(s.min)}–${num(s.max)})`)

function Metrics({ values }: { values: Record<MetricKey, string> }) {
  return (
    <dl className="rot-metrics">
      {METRIC_KEYS.map((k) => (
        <div key={k}>
          <dt>{METRIC_LABEL[k]}</dt>
          <dd>{values[k]}</dd>
        </div>
      ))}
    </dl>
  )
}

function Benefits({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="rot-benefits">
      <div className="rot-sub">General agronomy — not measured on these fields</div>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

function OptionCard({ o, index, otherName }: { o: RotationOption; index: number; otherName: string }) {
  const medians = Object.fromEntries(METRIC_KEYS.map((k) => [k, o.metrics[k].median])) as Record<MetricKey, number>
  return (
    <div className="rot-card">
      <div className="rot-tag">Option {index + 1}</div>
      <div className="rot-key">{patternLabel(o.key)}</div>
      <p className="kv">
        {o.count} of {plural(o.total, 'similar field')} · {plural(o.cellCount, 'area')}
      </p>
      <p className="muted">
        {o.other.total === 0
          ? `No ${otherName} analogs were found`
          : o.other.count === 0
            ? `Not seen in ${otherName} analogs`
            : `${otherName} analogs: ${o.other.count} of ${o.other.total}`}
      </p>
      <Metrics values={Object.fromEntries(METRIC_KEYS.map((k) => [k, spreadText(o.metrics[k])])) as Record<MetricKey, string>} />
      <p className="muted rot-hint">Median over these fields (range in brackets).</p>
      {o.hasOrchard && <p className="muted">Includes orchard or perennial horticulture years</p>}
      <Benefits items={benefits(medians)} />
      <div className="rot-check">
        <div className="rot-sub">Check locally</div>
        <ul>
          <li>
            {o.warnedCount > 0
              ? `${o.warnedCount} of ${plural(o.count, 'field')} ${o.warnedCount === 1 ? 'has' : 'have'} a growing constraint`
              : 'No growing constraint flagged in these fields'}
          </li>
          <li>Yield and profit are not in the data</li>
          <li>Irrigation, markets and equipment need local review</li>
          {o.count < 5 && <li>Few fields — treat as an example, not a trend</li>}
        </ul>
      </div>
    </div>
  )
}

const NOTE_TEXT = {
  'only-one': 'Only one other rotation was found among similar fields.',
  'all-same': 'All similar fields use the same rotation as yours.',
  'none-found': 'No similar fields were found for this mode. Try the other climate mode or another field.',
} as const

/** Land Info 아래: 현재 윤작 + 닮은 밭들의 흔한 대안 2개 (지금 기후 모드 기준, 다른 모드 비율 함께) */
export function RotationOptionsSection() {
  const { ref, crops, picked, shifted, result, otherResult } = useAppState()
  if (!ref || !result) return null

  // 현재 윤작 기준: 실제 밭을 골랐으면 그 밭 2017~2024, 아니면 연결된 표본 2018~2025
  const current = picked
    ? { codes: picked.crops, label: 'Your field, 2017–2024' }
    : { codes: CROP_KEYS.map((k) => ref[k]), label: `Sample field …${ref.chunk_id.slice(-6)}, 2018–2025` }
  const r = rotationOptions(
    current,
    { similar: result.similar, noneFound: result.noneFound },
    { similar: otherResult?.similar ?? [] },
    crops,
  )
  const otherName = shifted ? 'Today' : 'Near-future'
  const m = r.current.metrics

  return (
    <>
      <h3>Rotation options</h3>
      {shifted && (
        <p className="muted">
          Fields that already have your field’s 2035–2050 climate grow these rotations — examples, not predictions.
        </p>
      )}
      <div className="rot-card current">
        <div className="rot-tag">Current rotation</div>
        <div className="rot-key">{patternLabel(r.current.key)}</div>
        <p className="muted">{r.current.label}</p>
        <Metrics values={Object.fromEntries(METRIC_KEYS.map((k) => [k, num(m[k])])) as Record<MetricKey, string>} />
        {m.hasOrchard && <p className="muted">Includes orchard or perennial horticulture years</p>}
        <Benefits items={benefits(m)} />
      </div>
      {r.options.map((o, i) => (
        <OptionCard key={o.key} o={o} index={i} otherName={otherName} />
      ))}
      {r.note && <p className="note">{NOTE_TEXT[r.note]}</p>}
    </>
  )
}
