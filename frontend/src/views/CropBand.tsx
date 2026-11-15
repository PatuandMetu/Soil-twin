import { CROP_KEYS, YEARS, cropName, type Chunk, type CropNames } from '../engine'
import { cropColor, cropInk, cropShort } from '../text'

/** 2018~2025 작물 8칸 (표 한 줄의 td들) */
export function CropCells({ chunk, crops }: { chunk: Chunk; crops: CropNames }) {
  return (
    <>
      {CROP_KEYS.map((k, i) => {
        const code = chunk[k]
        return (
          <td
            key={k}
            className="crop"
            style={{ background: cropColor(code), color: cropInk(code) }}
            title={`${YEARS[i]}: ${cropName(code, crops)}`}
          >
            {cropShort(code, crops)}
          </td>
        )
      })}
    </>
  )
}

export function YearHeads() {
  return (
    <>
      {YEARS.map((y) => (
        <th key={y} className="year">
          {`'${String(y).slice(2)}`}
        </th>
      ))}
    </>
  )
}

/** 밭 하나의 작물 띠 (연도 머리 포함) */
export function CropBand({ chunk, crops }: { chunk: Chunk; crops: CropNames }) {
  return (
    <table className="bands">
      <thead>
        <tr>
          <YearHeads />
        </tr>
      </thead>
      <tbody>
        <tr>
          <CropCells chunk={chunk} crops={crops} />
        </tr>
      </tbody>
    </table>
  )
}
