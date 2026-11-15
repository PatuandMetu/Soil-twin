import { config as defaultConfig, type Config } from './config'
import { compareCode } from './order'
import { CROP_KEYS, type Chunk, type CropNames, type Scored } from './types'

export function cropName(code: number, names: CropNames): string {
  return names[String(code)] ?? `CDL ${code}`
}

/** 8년 중 minCount번 이상 나온 작물을 이름의 문자 코드 순으로 정렬해 +로 잇는다. 없으면 빈 문자열. */
export function patternKey(chunk: Chunk, names: CropNames, minCount = defaultConfig.patternMinCount): string {
  return patternKeyOf(
    CROP_KEYS.map((k) => chunk[k]),
    names,
    minCount,
  )
}

/** patternKey와 같은 규칙을 작물 코드 목록에 (예: USDA 실제 밭의 2017~2024) */
export function patternKeyOf(codes: number[], names: CropNames, minCount = defaultConfig.patternMinCount): string {
  const counts = new Map<string, number>()
  for (const code of codes) {
    const name = cropName(code, names)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts]
    .filter(([, n]) => n >= minCount)
    .map(([name]) => name)
    .sort(compareCode)
    .join('+')
}

export type PatternStat = {
  key: string
  /** 이 패턴인 청크 수 (분자) */
  count: number
  /** 센 닮은 청크 전체 수 (분모) */
  total: number
  acres: number
  totalAcres: number
  /** acres / totalAcres (total이 0이면 0) */
  areaShare: number
  /** 이 패턴이 나온 기후 칸 수 */
  cellCount: number
  /** 이 패턴 중 경고가 있는 청크 수 */
  warnedCount: number
}

export type RotationSummary = {
  /** 센 닮은 청크: 받은 닮은 청크 그대로 (빈 패턴 제외와 기후 칸 상한은 findSimilar가 이미 했다) */
  counted: Scored[]
  /** 흔한 순 전체 패턴 */
  patterns: PatternStat[]
  /** 기준 청크 자신의 패턴 */
  current: PatternStat
  /** 비교 카드: 현재 윤작 + 흔한 패턴 상위 N개(현재 윤작 제외) */
  cards: PatternStat[]
}

export function summarizeRotations(
  ref: Chunk,
  similar: Scored[],
  names: CropNames,
  cfg: Config = defaultConfig,
): RotationSummary {
  // 빈 패턴 제외와 기후 칸 상한은 findSimilar가 고를 때 이미 했다. 받은 닮은 청크를 그대로 센다.
  // 그래서 목록 수 = 카드 분모다.
  const counted = similar
  const total = counted.length
  const totalAcres = counted.reduce((s, x) => s + x.chunk.acres, 0)

  const groups = new Map<string, Scored[]>()
  for (const s of counted) {
    const key = patternKey(s.chunk, names, cfg.patternMinCount)
    groups.set(key, [...(groups.get(key) ?? []), s])
  }

  const stat = (key: string): PatternStat => {
    const xs = groups.get(key) ?? []
    const acres = xs.reduce((s, x) => s + x.chunk.acres, 0)
    return {
      key,
      count: xs.length,
      total,
      acres,
      totalAcres,
      areaShare: totalAcres > 0 ? acres / totalAcres : 0,
      cellCount: new Set(xs.map((x) => x.chunk.climate_cell)).size,
      warnedCount: xs.filter((x) => x.score.warnings.length > 0).length,
    }
  }

  const patterns = [...groups.keys()]
    .map(stat)
    .sort((a, b) => b.count - a.count || b.acres - a.acres || compareCode(a.key, b.key))
  const current = stat(patternKey(ref, names, cfg.patternMinCount))
  const others = patterns.filter((p) => p.key !== current.key).slice(0, cfg.comparePatterns)

  return { counted, patterns, current, cards: [current, ...others] }
}
