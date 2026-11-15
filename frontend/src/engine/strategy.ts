import { config as defaultConfig, type Config } from './config'
import { compareCode } from './order'
import { spreadOf, type Spread } from './regions'
import { patternKey, patternKeyOf } from './rotation'
import { CROP_KEYS, type CropNames, type Scored } from './types'

/**
 * 윤작 전략 카드: 현재 윤작 + 닮은 청크에서 흔한 대안 패턴 2개, 그리고 밭 하나의 8년 특징 지표.
 * 계산만 한다(문구는 화면 쪽).
 */

/** 이모작 코드 → 두 작물 */
export const DOUBLE_CROP: Readonly<Record<number, readonly [number, number]>> = {
  26: [24, 5],
  225: [24, 1],
  226: [28, 1],
  236: [24, 4],
  237: [21, 1],
  238: [24, 2],
  239: [5, 2],
  240: [5, 28],
  241: [1, 5],
  254: [21, 5],
}
/** 콩과 */
export const LEGUME: ReadonlySet<number> = new Set([5, 10, 36, 42, 51, 52, 53, 58, 224])
/** 휴경 */
export const FALLOW: ReadonlySet<number> = new Set([61])
/** 다년생 피복: 사료·초지·피복 */
export const PERENNIAL_COVER: ReadonlySet<number> = new Set([36, 37, 58, 59, 60])
/** 과수·다년생 원예: 윤작 지표에는 넣지 않고 표시만 */
export const ORCHARD: ReadonlySet<number> = new Set([
  14, 45, 55, 56, 66, 67, 68, 69, 71, 72, 74, 75, 76, 77, 204, 207, 211, 212, 220, 221, 242, 250,
])

export const METRIC_KEYS = [
  'legumeYears',
  'fallowYears',
  'perennialCoverYears',
  'doubleCropYears',
  'cropTypes',
  'longestSameCropRun',
] as const
export type MetricKey = (typeof METRIC_KEYS)[number]
export type RotationMetrics = Record<MetricKey, number> & {
  /** 과수·다년생 원예 해가 있다 (지표에서는 뺐다) */
  hasOrchard: boolean
}

/** 이모작 코드면 두 작물로, 아니면 그대로 */
export function expandCode(code: number): number[] {
  const d = DOUBLE_CROP[code]
  return d ? [...d] : [code]
}

/**
 * 밭 하나의 연속된 해(보통 8년) 특징 지표.
 * - crops.json에 없는 코드("other")와 과수·다년생 원예 해는 지표에서 빼고, 같은 작물 연속도 그 해에서 끊긴다.
 * - 이모작은 풀어서 본다: 콩과 해는 푼 작물 중 하나라도 콩과면, 작물 종류는 푼 작물을 각각 센다.
 * - 작물 종류와 같은 작물 연속에는 휴경을 넣지 않는다 (작물이 아니므로).
 */
export function rotationMetrics(codes: number[], names: CropNames): RotationMetrics {
  const m: RotationMetrics = {
    legumeYears: 0,
    fallowYears: 0,
    perennialCoverYears: 0,
    doubleCropYears: 0,
    cropTypes: 0,
    longestSameCropRun: 0,
    hasOrchard: false,
  }
  const types = new Set<number>()
  let runCode: number | null = null
  let run = 0
  for (const code of codes) {
    const counted = String(code) in names && !ORCHARD.has(code)
    if (ORCHARD.has(code)) m.hasOrchard = true
    if (!counted || FALLOW.has(code)) {
      if (counted) m.fallowYears++
      runCode = null
      run = 0
      continue
    }
    const parts = expandCode(code)
    if (parts.some((c) => LEGUME.has(c))) m.legumeYears++
    if (parts.some((c) => PERENNIAL_COVER.has(c))) m.perennialCoverYears++
    if (code in DOUBLE_CROP) m.doubleCropYears++
    for (const c of parts) types.add(c)
    run = code === runCode ? run + 1 : 1
    runCode = code
    m.longestSameCropRun = Math.max(m.longestSameCropRun, run)
  }
  m.cropTypes = types.size
  return m
}

export type CurrentRotation = {
  key: string
  /** 어느 밭·어느 연도인지 (예: "Your field, 2017–2024") */
  label: string
  metrics: RotationMetrics
}

export type RotationOption = {
  key: string
  /** 이 패턴인 닮은 청크 수 / 닮은 청크 전체 */
  count: number
  total: number
  /** 이 패턴 청크들이 걸친 지역(기후 칸) 수 */
  cellCount: number
  /** 이 패턴 청크 중 재배 제약 경고가 있는 수 */
  warnedCount: number
  /** 지표마다 중앙값·최솟값·최댓값 */
  metrics: Record<MetricKey, Spread>
  hasOrchard: boolean
  /** 다른 기후 모드의 닮은 청크 중 이 패턴 수 / 그 모드의 닮은 청크 전체 */
  other: { count: number; total: number }
}

export type RotationNote = 'none-found' | 'all-same' | 'only-one' | null

export type RotationOptions = { current: CurrentRotation; options: RotationOption[]; note: RotationNote }

/**
 * 카드 1 = 현재 윤작(주어진 작물 코드), 카드 2·3 = 닮은 청크에서 흔한 패턴 상위 cfg.comparePatterns개(현재 윤작 제외).
 * 정렬은 summarizeRotations와 같다: 개수 → 면적 → 패턴 키 문자 코드 순.
 * other는 다른 기후 모드의 결과(닮은 청크 전체)로, 대안마다 그 모드에서의 비율을 센다.
 */
export function rotationOptions(
  current: { codes: number[]; label: string },
  mode: { similar: Scored[]; noneFound: boolean },
  other: { similar: Scored[] },
  names: CropNames,
  cfg: Config = defaultConfig,
): RotationOptions {
  const cur: CurrentRotation = {
    key: patternKeyOf(current.codes, names, cfg.patternMinCount),
    label: current.label,
    metrics: rotationMetrics(current.codes, names),
  }
  if (mode.noneFound || mode.similar.length === 0) return { current: cur, options: [], note: 'none-found' }

  const groups = new Map<string, Scored[]>()
  for (const s of mode.similar) {
    const k = patternKey(s.chunk, names, cfg.patternMinCount)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const acresOf = (xs: Scored[]) => xs.reduce((t, s) => t + s.chunk.acres, 0)
  const otherKeys = other.similar.map((s) => patternKey(s.chunk, names, cfg.patternMinCount))

  const options = [...groups]
    .filter(([k]) => k !== cur.key)
    .sort(([ka, a], [kb, b]) => b.length - a.length || acresOf(b) - acresOf(a) || compareCode(ka, kb))
    .slice(0, cfg.comparePatterns)
    .map(([key, xs]): RotationOption => {
      const ms = xs.map((s) => rotationMetrics(CROP_KEYS.map((k) => s.chunk[k]), names))
      return {
        key,
        count: xs.length,
        total: mode.similar.length,
        cellCount: new Set(xs.map((s) => s.chunk.climate_cell)).size,
        warnedCount: xs.filter((s) => s.score.warnings.length > 0).length,
        metrics: Object.fromEntries(METRIC_KEYS.map((m) => [m, spreadOf(ms.map((x) => x[m]))])) as Record<MetricKey, Spread>,
        hasOrchard: ms.some((x) => x.hasOrchard),
        other: { count: otherKeys.filter((k) => k === key).length, total: other.similar.length },
      }
    })

  const note: RotationNote = options.length === 0 ? 'all-same' : options.length === 1 ? 'only-one' : null
  return { current: cur, options, note }
}
