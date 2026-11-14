import { config as defaultConfig, type Config } from './config'
import {
  CLIMATE_KEYS,
  PRECIP_KEYS,
  TEMP_KEYS,
  type Chunk,
  type ItemKey,
  type ItemScore,
  type PairScore,
  type Profile,
  type Status,
  type Warning,
} from './types'

/**
 * 문턱·경계 비교용 값: 소수 comparePrecision자리에서 반올림해 부동소수점 꼬리를 지운다.
 * 예: |8.3 − 7.3| = 1.0000000000000009 → 1. 점수 자체에는 쓰지 않고 비교할 때만 쓴다.
 */
export function exact(x: number, cfg: Config = defaultConfig): number {
  const f = 10 ** cfg.comparePrecision
  return Math.round(x * f) / f
}

/**
 * 배수(1~7)·침수(0~5) 등급은 청크 안 토양 구역의 면적 가중 평균이라 실수로 온다.
 * 점수와 경고에는 반올림한 정수 등급을 쓴다 (0.5는 올림: 4.5 → 5, 4.49 → 4).
 */
export function grade(x: number, cfg: Config = defaultConfig): number {
  return Math.floor(exact(x, cfg) + 0.5)
}

/** 가우시안 점수: 차이가 t면 50점 */
export function gaussian(a: number, b: number, t: number): number {
  const x = Math.abs(a - b) / t
  return 100 * Math.exp(-Math.LN2 * x * x)
}

function linear(a: number, b: number, span: number): number {
  return Math.max(0, 1 - Math.abs(a - b) / span) * 100
}

function monthly(a: number[], b: number[], t: number, weights: number[]): number {
  let sum = 0
  let wsum = 0
  for (let i = 0; i < 12; i++) {
    sum += weights[i] * gaussian(a[i], b[i], t)
    wsum += weights[i]
  }
  return sum / wsum
}

export function textureScore(ref: Profile, cand: Profile, cfg: Config = defaultConfig): number {
  const d = (Math.abs(ref.sand - cand.sand) + Math.abs(ref.silt - cand.silt) + Math.abs(ref.clay - cand.clay)) / 200
  return gaussian(d, 0, cfg.tolerance.texture)
}

export function drainageFloodScore(ref: Profile, cand: Profile, cfg: Config = defaultConfig): number {
  const diff = Math.abs(grade(ref.drainage, cfg) - grade(cand.drainage, cfg))
  const table = cfg.drainageByDiff
  let s = table[Math.min(diff, table.length - 1)]
  if (grade(ref.flood, cfg) !== grade(cand.flood, cfg)) s -= cfg.floodPenalty
  return Math.max(0, s)
}

export function itemScores(ref: Profile, cand: Profile, cfg: Config = defaultConfig): Record<ItemKey, number> {
  const t = cfg.tolerance
  const mw = cfg.monthWeights
  return {
    texture: textureScore(ref, cand, cfg),
    aws: gaussian(ref.aws_mm, cand.aws_mm, t.aws_mm),
    drainage_flood: drainageFloodScore(ref, cand, cfg),
    ph: gaussian(ref.ph, cand.ph, t.ph),
    om: gaussian(ref.om, cand.om, t.om),
    cec: gaussian(ref.cec, cand.cec, t.cec),
    bedrock_salinity:
      (linear(ref.bedrock_cm, cand.bedrock_cm, cfg.linearSpan.bedrock_cm) + gaussian(ref.ec, cand.ec, t.ec)) / 2,
    slope: linear(ref.slope, cand.slope, cfg.linearSpan.slope),
    temp_monthly: monthly(
      TEMP_KEYS.map((k) => ref[k]),
      TEMP_KEYS.map((k) => cand[k]),
      t.t_month,
      mw,
    ),
    precip_monthly: monthly(
      PRECIP_KEYS.map((k) => ref[k]),
      PRECIP_KEYS.map((k) => cand[k]),
      t.p_month,
      mw,
    ),
    ffd: gaussian(ref.ffd, cand.ffd, t.ffd),
    gdd10: gaussian(ref.gdd10, cand.gdd10, t.gdd10),
    gwet_summer: gaussian(ref.gwet_summer, cand.gwet_summer, t.gwet_summer),
    heat_days: gaussian(ref.heat_days, cand.heat_days, t.heat_days),
    drought_freq: gaussian(ref.drought_freq, cand.drought_freq, t.drought_freq),
  }
}

/** 재배 제약 경고 (Gate B). 점수는 바꾸지 않는다. 경계 비교는 exact 값으로 한다. */
export function warnings(ref: Profile, cand: Profile, cfg: Config = defaultConfig): Warning[] {
  const g = cfg.gate
  const ex = (x: number) => exact(x, cfg)
  const out: Warning[] = []
  if (Math.abs(grade(ref.drainage, cfg) - grade(cand.drainage, cfg)) >= g.drainageDiff)
    out.push({ code: 'drainage', ref: ref.drainage, cand: cand.drainage })
  if (ex(Math.abs(ref.ph - cand.ph)) > g.phDiff) out.push({ code: 'ph', ref: ref.ph, cand: cand.ph })
  if (Math.abs(grade(ref.flood, cfg) - grade(cand.flood, cfg)) >= g.floodDiff)
    out.push({ code: 'flood', ref: ref.flood, cand: cand.flood })
  if (ex(ref.bedrock_cm) < g.bedrockCm !== ex(cand.bedrock_cm) < g.bedrockCm)
    out.push({ code: 'bedrock', ref: ref.bedrock_cm, cand: cand.bedrock_cm })
  if (ex(ref.ec) >= g.ec !== ex(cand.ec) >= g.ec) out.push({ code: 'salinity', ref: ref.ec, cand: cand.ec })
  return out
}

export function scorePair(ref: Profile, cand: Profile, cfg: Config = defaultConfig): PairScore {
  const raw = itemScores(ref, cand, cfg)
  const items: ItemScore[] = (Object.keys(raw) as ItemKey[]).map((key) => {
    const weight = cfg.weights[key]
    return { key, block: cfg.blockOf[key], weight, score: raw[key], penalty: weight * (100 - raw[key]) }
  })

  const blockAvg = (block: 'soil' | 'climate') => {
    const xs = items.filter((it) => it.block === block)
    const w = xs.reduce((s, it) => s + it.weight, 0)
    return xs.reduce((s, it) => s + it.weight * it.score, 0) / w
  }
  const total = items.reduce((s, it) => s + it.weight * it.score, 0)
  const soil = blockAvg('soil')
  const climate = blockAvg('climate')
  const warns = warnings(ref, cand, cfg)
  return { total, soil, climate, items, warnings: warns, status: statusOf(total, soil, climate, warns.length, cfg) }
}

/** 종합 점수가 τ 이상인가 (exact 값으로 비교) */
export function meetsTau(total: number, cfg: Config = defaultConfig): boolean {
  return exact(total, cfg) >= cfg.tau
}

/** 시프트 모드의 기후 게이트를 통과하는가 (exact 값으로 비교) */
export function passesShiftGate(climate: number, cfg: Config = defaultConfig): boolean {
  return exact(climate, cfg) >= cfg.shiftClimateGate
}

/**
 * 상태. 종합 ≥ τ 이고 토양 ≥ soilMin → twin(경고 없음) / constrained(경고 있음).
 * 기후 ≥ climateOnly.climateMin 이고 토양 < soilMin → climate_only (종합과 무관). 그 외 none.
 */
export function statusOf(total: number, soil: number, climate: number, nWarnings: number, cfg: Config = defaultConfig): Status {
  const soilOk = exact(soil, cfg) >= cfg.soilMin
  if (meetsTau(total, cfg) && soilOk) return nWarnings === 0 ? 'twin' : 'constrained'
  if (exact(climate, cfg) >= cfg.climateOnly.climateMin && !soilOk) return 'climate_only'
  return 'none'
}

/** 청크의 비교용 값. shifted면 기후를 s_ 열로 바꾼다. */
export function profileOf(chunk: Chunk, shifted = false): Profile {
  const p: Profile = { ...chunk }
  if (shifted) for (const k of CLIMATE_KEYS) p[k] = chunk[`s_${k}`]
  return p
}
