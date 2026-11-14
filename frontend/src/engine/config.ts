import type { Block, ItemKey } from './types'

/** 엔진의 숫자는 전부 여기에 모은다. */
export const config = {
  /** 종합 점수 문턱 τ */
  tau: 80,
  /** 상위 K개만 고른다 */
  topK: 30,
  /** 시프트 모드에서 먼저 거르는 기후 블록 점수 하한 */
  shiftClimateGate: 85,
  /** 윤작 집계 때 한 기후 칸에서 세는 청크 최대 수 */
  cellCap: 10,
  /** 패턴 키에 넣는 작물의 최소 등장 횟수(8년 중) */
  patternMinCount: 2,
  /** 비교 카드에 넣는 흔한 패턴 수(현재 윤작 제외) */
  comparePatterns: 2,

  /** climate_only 판정 */
  climateOnly: { climateMin: 80, soilMax: 65 },

  /** 가우시안 허용 폭 t: 차이가 t면 50점 */
  tolerance: {
    texture: 0.22,
    aws_mm: 50,
    ph: 0.9,
    om: 2.2,
    cec: 9.0,
    ec: 2.0,
    t_month: 2.8,
    p_month: 30,
    ffd: 28,
    gdd10: 450,
    gwet_summer: 0.14,
    heat_days: 20,
    drought_freq: 0.25,
  },

  /** 선형 감소: max(0, 1 − |Δ| / span) × 100 */
  linearSpan: { bedrock_cm: 150, slope: 10 },

  /** 배수 등급 차 0, 1, 2, 3 이상 → 점수 */
  drainageByDiff: [100, 75, 35, 10],
  /** 침수 등급이 다르면 깎는 점수 */
  floodPenalty: 25,

  /** 월별 기온·강수 가중치 (1~12월) */
  monthWeights: [1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1],

  /** 항목 가중치 (합 1.00) */
  weights: {
    texture: 0.15,
    aws: 0.1,
    drainage_flood: 0.1,
    ph: 0.06,
    om: 0.03,
    cec: 0.03,
    bedrock_salinity: 0.02,
    slope: 0.06,
    temp_monthly: 0.1,
    precip_monthly: 0.1,
    ffd: 0.05,
    gdd10: 0.05,
    gwet_summer: 0.05,
    heat_days: 0.05,
    drought_freq: 0.05,
  } satisfies Record<ItemKey, number>,

  blockOf: {
    texture: 'soil',
    aws: 'soil',
    drainage_flood: 'soil',
    ph: 'soil',
    om: 'soil',
    cec: 'soil',
    bedrock_salinity: 'soil',
    slope: 'soil',
    temp_monthly: 'climate',
    precip_monthly: 'climate',
    ffd: 'climate',
    gdd10: 'climate',
    gwet_summer: 'climate',
    heat_days: 'climate',
    drought_freq: 'climate',
  } satisfies Record<ItemKey, Block>,

  /** 재배 제약 경고 (Gate B) */
  gate: {
    drainageDiff: 2,
    phDiff: 1.0,
    floodDiff: 2,
    bedrockCm: 100,
    ec: 4,
  },
}

export type Config = typeof config
