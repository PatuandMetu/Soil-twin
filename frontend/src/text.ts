import type { CropNames, Direction, ItemKey, Warning } from './engine'

/** 화면 문구는 영어 (제출 규칙) */

export const ITEM_LABEL: Record<ItemKey, string> = {
  texture: 'Soil texture (top 30 cm)',
  aws: 'Water the soil holds (top 1 m)',
  drainage_flood: 'Drainage & flooding',
  ph: 'Soil pH (top 30 cm)',
  om: 'Organic matter (top 30 cm)',
  cec: 'Nutrient holding, CEC (top 30 cm)',
  bedrock_salinity: 'Bedrock depth & salinity',
  slope: 'Slope',
  temp_monthly: 'Temperature, Apr–Sep',
  precip_monthly: 'Rainfall, Apr–Sep',
  ffd: 'Frost-free days',
  gdd10: 'Growing degree days (base 10 °C)',
  gwet_summer: 'Summer root-zone moisture',
  heat_days: 'Hot days (32 °C or more)',
  drought_freq: 'Dry years (Apr–Sep rain under 80% of normal)',
}

/** 배수 등급 1~7 (SSURGO drainage class) */
export const DRAINAGE = [
  '',
  'Excessively drained',
  'Somewhat excessively drained',
  'Well drained',
  'Moderately well drained',
  'Somewhat poorly drained',
  'Poorly drained',
  'Very poorly drained',
]

/** 침수 빈도 0~5 (SSURGO flooding frequency class) */
export const FLOODING = ['no flooding', 'very rare flooding', 'rare flooding', 'occasional flooding', 'frequent flooding', 'very frequent flooding']

export function warningText(w: Warning): string {
  switch (w.code) {
    case 'drainage':
      return 'Drainage differs by 2+ classes'
    case 'ph':
      return 'Soil pH differs by more than 1.0'
    case 'flood':
      return 'Flooding frequency differs by 2+ classes'
    case 'bedrock':
      return 'Bedrock within 1 m on one side only'
    case 'salinity':
      return 'Salty soil (EC 4+) on one side only'
  }
}

export const WARNING_SHORT: Record<Warning['code'], string> = {
  drainage: 'drainage',
  ph: 'pH',
  flood: 'flooding',
  bedrock: 'bedrock',
  salinity: 'salinity',
}

/** 패턴 키 "Corn+Soybeans" → "Corn + Soybeans" */
export const patternLabel = (key: string) => (key ? key.split('+').join(' + ') : 'No crop repeated (2+ of 8 years)')

export const pct = (x: number) => `${Math.round(x)}%`
export const km = (x: number) => (x < 10 ? `${x.toFixed(1)} km` : `${Math.round(x).toLocaleString('en-US')} km`)
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const DIRECTION_SHORT: Record<Direction, string> = {
  north: 'N',
  northeast: 'NE',
  east: 'E',
  southeast: 'SE',
  south: 'S',
  southwest: 'SW',
  west: 'W',
  northwest: 'NW',
}

export function latLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`
}

// ---- 작물 띠 색 ----

const CROP_COLOR: Record<number, string> = {
  1: '#f2c12e', // Corn
  5: '#3f8f3f', // Soybeans
  36: '#9c5fb5', // Alfalfa
  2: '#d7dde3', // Cotton
  24: '#b5873a', // Winter Wheat
  23: '#d9b26f', // Spring Wheat
  22: '#c9a35a', // Durum Wheat
  61: '#bdbdbd', // Fallow/Idle Cropland
  4: '#e07b39', // Sorghum
  26: '#7a8b3a', // Dbl Crop WinWht/Soybeans
  21: '#e3c77a', // Barley
  10: '#8d6e63', // Peanuts
  37: '#9ccc65', // Other Hay/Non Alfalfa
  42: '#a1887f', // Dry Beans
  45: '#26a69a', // Sugarcane
  43: '#795548', // Potatoes
  75: '#ef9a9a', // Almonds
  28: '#d4c08a', // Oats
  3: '#4fc3f7', // Rice
  69: '#7e57c2', // Grapes
  31: '#fff176', // Canola
  53: '#81c784', // Peas
}

const CROP_SHORT: Record<number, string> = {
  1: 'Corn',
  5: 'Soy',
  36: 'Alf',
  2: 'Cotton',
  24: 'W.Wht',
  23: 'S.Wht',
  22: 'Durum',
  61: 'Fallow',
  4: 'Sorg',
  26: 'Wht/Soy',
  21: 'Barley',
  10: 'Peanut',
  37: 'Hay',
  42: 'Beans',
  45: 'Cane',
  43: 'Potato',
  75: 'Almond',
  28: 'Oats',
  3: 'Rice',
  69: 'Grape',
  31: 'Canola',
  53: 'Peas',
}

/** 표에 없는 작물은 코드로 색을 정한다 (항상 같은 색) */
export function cropColor(code: number): string {
  return CROP_COLOR[code] ?? `hsl(${(code * 137) % 360} 35% 62%)`
}

export function cropShort(code: number, crops: CropNames): string {
  return CROP_SHORT[code] ?? (crops[String(code)] ?? `CDL ${code}`).slice(0, 6)
}

/** 밝은 바탕이면 검은 글자 */
export function cropInk(code: number): string {
  const c = CROP_COLOR[code]
  if (!c) return '#1b1b1b'
  const n = parseInt(c.slice(1), 16)
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 140 ? '#1b1b1b' : '#ffffff'
}
