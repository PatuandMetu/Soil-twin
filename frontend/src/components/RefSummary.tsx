import { CROP_KEYS, PRECIP_KEYS, SOIL_KEYS, TEMP_KEYS, YEARS, cropName, type Chunk, type Climate, type CropNames } from '../engine'
import { fmt } from '../labels'

const GROWING = [3, 4, 5, 6, 7, 8] // 4~9월 (0부터 셈)

function growing(c: Climate) {
  const t = GROWING.reduce((s, i) => s + c[TEMP_KEYS[i]], 0) / GROWING.length
  const p = GROWING.reduce((s, i) => s + c[PRECIP_KEYS[i]], 0)
  return { t, p }
}

export function RefSummary({ chunk, crops, shifted }: { chunk: Chunk; crops: CropNames; shifted: boolean }) {
  const now = growing(chunk)
  const s = growing({
    ...chunk,
    ...Object.fromEntries([...TEMP_KEYS, ...PRECIP_KEYS].map((k) => [k, chunk[`s_${k}`]])),
  })
  return (
    <section>
      <h2>
        기준 청크 {chunk.chunk_id} <small>({chunk.state}, 기후 칸 {chunk.climate_cell}, {chunk.acres} ac)</small>
      </h2>
      <table>
        <tbody>
          <tr>
            {SOIL_KEYS.map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
          <tr>
            {SOIL_KEYS.map((k) => (
              <td key={k}>{fmt(chunk[k], 2)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <p>
        4~9월 평균 기온 {now.t.toFixed(1)}℃, 강수 합계 {now.p.toFixed(0)} mm
        {shifted && (
          <>
            {' '}
            → 시프트 후 {s.t.toFixed(1)}℃, {s.p.toFixed(0)} mm
          </>
        )}
      </p>
      <table>
        <tbody>
          <tr>
            {YEARS.map((y) => (
              <th key={y}>{y}</th>
            ))}
          </tr>
          <tr>
            {CROP_KEYS.map((k) => (
              <td key={k}>{cropName(chunk[k], crops)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  )
}
