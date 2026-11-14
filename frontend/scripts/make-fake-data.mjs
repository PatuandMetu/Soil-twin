// 가짜 청크 테이블 생성기. seed 고정이라 다시 돌려도 같은 파일이 나온다.
// 실행: npm run data:fake  →  public/data/chunks.fake.json, public/data/crops.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const SEED = 20261115

// ---- 난수 ----
function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(SEED)
const uni = (lo, hi) => lo + (hi - lo) * rand()
const int = (lo, hi) => Math.floor(uni(lo, hi + 1))
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const pickWeighted = (entries) => {
  const sum = entries.reduce((s, [, w]) => s + w, 0)
  let r = rand() * sum
  for (const [v, w] of entries) {
    if ((r -= w) <= 0) return v
  }
  return entries[entries.length - 1][0]
}
const r1 = (x) => Math.round(x * 10) / 10
const r2 = (x) => Math.round(x * 100) / 100
const r3 = (x) => Math.round(x * 1000) / 1000
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

// ---- 작물 코드 ----
const CROPS = {
  1: 'Corn',
  4: 'Sorghum',
  5: 'Soybeans',
  21: 'Barley',
  24: 'Winter Wheat',
  28: 'Oats',
  36: 'Alfalfa',
  37: 'Other Hay/Non Alfalfa',
  61: 'Fallow/Idle Cropland',
  176: 'Grassland/Pasture',
}

// ---- 기후 칸 (약 50 km 격자 하나에 기후 값 하나) ----
const CELLS = [
  { id: 'C01', lat: 42.0, lon: -93.5, state: 'IA', n: 12 },
  { id: 'C02', lat: 40.5, lon: -89.6, state: 'IL', n: 10 },
  { id: 'C03', lat: 41.2, lon: -97.0, state: 'NE', n: 10 },
  { id: 'C04', lat: 38.9, lon: -99.8, state: 'KS', n: 10 },
  { id: 'C05', lat: 44.4, lon: -96.8, state: 'SD', n: 9 },
  { id: 'C06', lat: 37.6, lon: -95.4, state: 'KS', n: 9 },
]
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// 남쪽일수록 덥고, 서쪽일수록 건조하게.
function baseClimate(lat, lon) {
  const tMean = 10.2 - 0.85 * (lat - 41) + 0.05 * (lon + 95)
  const amp = 14.5 + 0.35 * (lat - 41)
  const pAnnual = 860 + 50 * (lon + 95) - 8 * (lat - 41)
  const pShape = Array.from({ length: 12 }, (_, i) => 1 + 0.85 * Math.cos((2 * Math.PI * (i + 1 - 6)) / 12))
  const pShapeSum = pShape.reduce((s, x) => s + x, 0)
  const t = Array.from({ length: 12 }, (_, i) => tMean + amp * Math.cos((2 * Math.PI * (i + 1 - 7)) / 12))
  const p = pShape.map((w) => (pAnnual * w) / pShapeSum)
  const ffd = 165 - 7 * (lat - 41) + 0.6 * (lon + 95)
  const heatDays = Math.max(0, 5 * (t[6] - 21) + (900 - pAnnual) / 40)
  const gwet = clamp(0.32 + (pAnnual - 500) / 1400, 0.2, 0.8)
  const drought = clamp(0.12 + (900 - pAnnual) / 1600, 0.05, 0.6)
  return { t, p, ffd, heatDays, gwet, drought }
}

const gdd10 = (t) => t.reduce((s, x, i) => s + Math.max(0, x - 10) * MONTH_DAYS[i], 0)

function climateFields(c, prefix = '') {
  const out = {}
  c.t.forEach((x, i) => (out[`${prefix}t_m${String(i + 1).padStart(2, '0')}`] = r1(x)))
  c.p.forEach((x, i) => (out[`${prefix}p_m${String(i + 1).padStart(2, '0')}`] = r1(x)))
  out[`${prefix}ffd`] = Math.round(c.ffd)
  out[`${prefix}gdd10`] = Math.round(gdd10(c.t))
  out[`${prefix}heat_days`] = Math.round(c.heatDays)
  out[`${prefix}gwet_summer`] = r3(c.gwet)
  out[`${prefix}drought_freq`] = r3(c.drought)
  return out
}

// 시프트: 기온 +2.2℃, 4~9월 강수 −15%, 폭염일 +18일, 무상기간·생육도일·가뭄 빈도 증가.
function shiftClimate(c) {
  return {
    t: c.t.map((x) => x + 2.2),
    p: c.p.map((x, i) => (i >= 3 && i <= 8 ? x * 0.85 : x)),
    ffd: c.ffd + 12,
    heatDays: c.heatDays + 18,
    gwet: c.gwet,
    drought: clamp(c.drought + 0.12, 0, 0.9),
  }
}

// ---- 토양 ----
const SOILS = {
  sand: { sand: [70, 88], clay: [3, 10], aws: [70, 120], drain: [1, 3], om: [0.6, 1.6] },
  loam: { sand: [35, 50], clay: [12, 22], aws: [150, 200], drain: [3, 4], om: [2.0, 3.8] },
  siltloam: { sand: [8, 22], clay: [15, 26], aws: [200, 260], drain: [3, 5], om: [2.5, 4.5] },
  clayloam: { sand: [25, 40], clay: [28, 38], aws: [170, 220], drain: [4, 6], om: [2.8, 5.0] },
  clay: { sand: [5, 20], clay: [42, 58], aws: [140, 190], drain: [5, 7], om: [3.0, 5.5] },
}

function makeSoil(cell) {
  const west = (cell.lon + 89) / -12 // 0 동쪽 ~ 1 서쪽
  const kind = pickWeighted([
    ['sand', 0.15],
    ['loam', 0.25],
    ['siltloam', 0.25 * (1 - west) + 0.08],
    ['clayloam', 0.2],
    ['clay', 0.12],
  ])
  const s = SOILS[kind]
  const sand = r1(uni(...s.sand))
  const clay = r1(uni(...s.clay))
  const silt = r1(100 - sand - clay)
  const om = r2(uni(...s.om) * (1 - 0.35 * west))
  const flood = rand() < (kind === 'clay' || kind === 'clayloam' ? 0.35 : 0.12) ? int(1, 4) : 0
  const saline = west > 0.6 && rand() < 0.15
  return {
    sand,
    silt,
    clay,
    aws_mm: Math.round(uni(...s.aws)),
    drainage: int(...s.drain),
    flood,
    ph: r1(clamp(uni(5.9, 6.9) + 1.2 * west + uni(-0.3, 0.3), 5.2, 8.4)),
    om,
    cec: r1(3 + 0.5 * clay + 2 * om + uni(-2, 2)),
    ec: saline ? r2(uni(4.2, 8)) : r2(uni(0.2, 1.6)),
    slope: r1(rand() < 0.15 ? uni(6, 12) : uni(0.3, 5)),
    bedrock_cm: rand() < 0.15 ? int(50, 150) : 200,
  }
}

// ---- 작물 순서 2018~2025 ----
const ROTATIONS = {
  cornSoy: () => (rand() < 0.5 ? [1, 5] : [5, 1]),
  cornCont: () => [1],
  wheatFallow: () => (rand() < 0.5 ? [24, 61] : [61, 24]),
  wheatSorghumFallow: () => [24, 4, 61],
  cornSoyWheat: () => [1, 5, 24],
  alfalfaCorn: () => [36, 36, 36, 1, 5, 1],
  oatsAlfalfa: () => [1, 5, 28, 36, 36],
  hayPasture: () => (rand() < 0.5 ? [37, 37, 176] : [176]),
}

function makeCrops(cell) {
  const west = (cell.lon + 89) / -12
  const north = (cell.lat - 37) / 8
  const kind = pickWeighted([
    ['cornSoy', 0.5 * (1 - west) + 0.08],
    ['cornCont', 0.14],
    ['wheatFallow', 0.3 * west],
    ['wheatSorghumFallow', 0.4 * west],
    ['cornSoyWheat', 0.08],
    ['alfalfaCorn', 0.08 + 0.06 * north],
    ['oatsAlfalfa', 0.05 * north],
    ['hayPasture', 0.05],
  ])
  const cycle = ROTATIONS[kind]()
  const start = int(0, cycle.length - 1)
  const out = {}
  for (let y = 0; y < 8; y++) {
    let code = cycle[(start + y) % cycle.length]
    if (rand() < 0.05) code = pick([1, 5, 21, 24, 28, 37])
    out[`crop_${2018 + y}`] = code
  }
  return out
}

// ---- 조립 ----
const rows = []
for (const cell of CELLS) {
  const cur = baseClimate(cell.lat, cell.lon)
  const climate = climateFields(cur)
  const shifted = climateFields(shiftClimate(cur), 's_')
  shifted.s_gwet_summer = climate.gwet_summer
  for (let i = 0; i < cell.n; i++) {
    rows.push({
      chunk_id: `${cell.id}-${String(i + 1).padStart(2, '0')}`,
      lat: r3(cell.lat + uni(-0.22, 0.22)),
      lon: r3(cell.lon + uni(-0.28, 0.28)),
      state: cell.state,
      climate_cell: cell.id,
      acres: Math.round(uni(20, 320)),
      ...makeSoil(cell),
      ...climate,
      ...shifted,
      ...makeCrops(cell),
    })
  }
}

const nFields = Object.keys(rows[0]).length
if (nFields !== 84) throw new Error(`필드 수가 84가 아님: ${nFields}`)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'chunks.fake.json'), JSON.stringify(rows))
writeFileSync(join(OUT_DIR, 'crops.json'), JSON.stringify(CROPS, null, 2) + '\n')
console.log(`chunks.fake.json: ${rows.length}행 × ${nFields}필드, 기후 칸 ${CELLS.length}개`)
