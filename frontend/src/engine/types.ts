export const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] as const
export type Month = (typeof MONTHS)[number]

export const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const
export type Year = (typeof YEARS)[number]

export type TempKey = `t_m${Month}`
export type PrecipKey = `p_m${Month}`
export type ClimateScalarKey = 'ffd' | 'gdd10' | 'heat_days' | 'gwet_summer' | 'drought_freq'
export type ClimateKey = TempKey | PrecipKey | ClimateScalarKey
export type ShiftKey = `s_${ClimateKey}`
export type CropKey = `crop_${Year}`

export const TEMP_KEYS = MONTHS.map((m) => `t_m${m}` as TempKey)
export const PRECIP_KEYS = MONTHS.map((m) => `p_m${m}` as PrecipKey)
export const CLIMATE_SCALAR_KEYS: ClimateScalarKey[] = ['ffd', 'gdd10', 'heat_days', 'gwet_summer', 'drought_freq']
export const CLIMATE_KEYS: ClimateKey[] = [...TEMP_KEYS, ...PRECIP_KEYS, ...CLIMATE_SCALAR_KEYS]
export const CROP_KEYS = YEARS.map((y) => `crop_${y}` as CropKey)

export const SOIL_KEYS = [
  'sand',
  'silt',
  'clay',
  'aws_mm',
  'drainage',
  'flood',
  'ph',
  'om',
  'cec',
  'ec',
  'slope',
  'bedrock_cm',
] as const
export type SoilKey = (typeof SOIL_KEYS)[number]

export type Soil = Record<SoilKey, number>
export type Climate = Record<ClimateKey, number>

/** 비교에 쓰는 한쪽 값: 토양 + 기후 */
export type Profile = Soil & Climate

/** chunks*.json의 한 행 */
export type Chunk = {
  chunk_id: string
  lat: number
  lon: number
  state: string
  climate_cell: string
  acres: number
} & Soil &
  Climate &
  Record<ShiftKey, number> &
  Record<CropKey, number>

/** crops.json: CDL 코드(문자열) → 이름 */
export type CropNames = Record<string, string>

export type Block = 'soil' | 'climate'

export type ItemKey =
  | 'texture'
  | 'aws'
  | 'drainage_flood'
  | 'ph'
  | 'om'
  | 'cec'
  | 'bedrock_salinity'
  | 'slope'
  | 'temp_monthly'
  | 'precip_monthly'
  | 'ffd'
  | 'gdd10'
  | 'gwet_summer'
  | 'heat_days'
  | 'drought_freq'

export type ItemScore = {
  key: ItemKey
  block: Block
  weight: number
  /** 0~100 */
  score: number
  /** 가중치 × (100 − 점수) */
  penalty: number
}

export type WarningCode = 'drainage' | 'ph' | 'flood' | 'bedrock' | 'salinity'
export type Warning = { code: WarningCode; ref: number; cand: number }

export type Status = 'twin' | 'constrained' | 'climate_only' | 'none'

export type PairScore = {
  total: number
  soil: number
  climate: number
  items: ItemScore[]
  warnings: Warning[]
  status: Status
}

export type Scored = { chunk: Chunk; score: PairScore }
