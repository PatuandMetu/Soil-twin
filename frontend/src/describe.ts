import {
  PRECIP_KEYS,
  SOIL_KEYS,
  TEMP_KEYS,
  config,
  grade,
  median,
  profileOf,
  type Block,
  type ItemKey,
  type Profile,
  type Region,
  type Spread,
} from './engine'
import { DRAINAGE, FLOODING, ITEM_LABEL } from './text'

/** 4~9월 (0부터 셈) */
const GROWING = [3, 4, 5, 6, 7, 8]

export const growingTemp = (p: Profile) => GROWING.reduce((s, i) => s + p[TEMP_KEYS[i]], 0) / GROWING.length
export const growingRain = (p: Profile) => GROWING.reduce((s, i) => s + p[PRECIP_KEYS[i]], 0)

export type ItemRow = {
  key: ItemKey
  label: string
  block: Block
  /** 지역 안 청크들의 항목 점수: 중앙값·최솟값·최댓값 */
  score: Spread
  you: string
  there: string
  /** 그쪽이 내 밭보다 어떤지 (예: "4 mm less") */
  diff: string
  /** 점수 중앙값이 가장 낮은 항목 */
  biggest: boolean
}

const SAME = 'about the same'

/** 차이를 반올림해 0이면 "about the same", 아니면 "<크기><단위> <더/덜>" */
function compare(d: number, digits: number, unit: string, more: string, less: string): string {
  const v = Number(Math.abs(d).toFixed(digits))
  if (v === 0) return SAME
  return `${v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit} ${d > 0 ? more : less}`
}

const int = (x: number) => Math.round(x).toLocaleString('en-US')

const bedrock = (cm: number) => (cm >= 200 ? 'no bedrock within 2 m' : `bedrock at ${int(cm)} cm`)

type Describer = { you: (p: Profile) => string; diff: (you: Profile, there: Profile) => string }

const DESCRIBE: Record<ItemKey, Describer> = {
  texture: {
    you: (p) => `${int(p.sand)}% sand · ${int(p.silt)}% silt · ${int(p.clay)}% clay`,
    diff: (a, b) => {
      const shift = (Math.abs(b.sand - a.sand) + Math.abs(b.silt - a.silt) + Math.abs(b.clay - a.clay)) / 2
      return Math.round(shift) === 0 ? SAME : `${int(shift)} %-points of the mix differ`
    },
  },
  aws: {
    you: (p) => `${int(p.aws_mm)} mm`,
    diff: (a, b) => compare(b.aws_mm - a.aws_mm, 0, ' mm', 'more', 'less'),
  },
  drainage_flood: {
    you: (p) => `${DRAINAGE[grade(p.drainage)]}, ${FLOODING[grade(p.flood)]}`,
    diff: (a, b) => {
      const dd = grade(b.drainage) - grade(a.drainage)
      const df = grade(b.flood) - grade(a.flood)
      const parts = []
      if (dd !== 0) parts.push(`${Math.abs(dd)} drainage class${Math.abs(dd) > 1 ? 'es' : ''} ${dd > 0 ? 'wetter' : 'drier'}`)
      if (df !== 0) parts.push(`${df > 0 ? 'more' : 'less'} flooding`)
      return parts.length ? parts.join(', ') : 'same classes'
    },
  },
  ph: {
    you: (p) => `pH ${p.ph.toFixed(1)}`,
    diff: (a, b) => compare(b.ph - a.ph, 1, '', 'more alkaline', 'more acidic'),
  },
  om: {
    you: (p) => `${p.om.toFixed(1)}%`,
    diff: (a, b) => compare(b.om - a.om, 1, ' points', 'more', 'less'),
  },
  cec: {
    you: (p) => `${p.cec.toFixed(0)} meq/100 g`,
    diff: (a, b) => compare(b.cec - a.cec, 0, '', 'higher', 'lower'),
  },
  bedrock_salinity: {
    you: (p) => `${bedrock(p.bedrock_cm)}, EC ${p.ec.toFixed(1)} dS/m`,
    diff: (a, b) => {
      const parts = []
      const ra = Math.min(a.bedrock_cm, 200)
      const rb = Math.min(b.bedrock_cm, 200)
      if (Math.round(rb - ra) !== 0) parts.push(`bedrock ${int(Math.abs(rb - ra))} cm ${rb > ra ? 'deeper' : 'shallower'}`)
      const ec = compare(b.ec - a.ec, 1, '', 'saltier (EC)', 'less salty (EC)')
      if (ec !== SAME) parts.push(ec)
      return parts.length ? parts.join(', ') : SAME
    },
  },
  slope: {
    you: (p) => `${p.slope.toFixed(1)}%`,
    diff: (a, b) => compare(b.slope - a.slope, 1, ' points', 'steeper', 'flatter'),
  },
  temp_monthly: {
    you: (p) => `${growingTemp(p).toFixed(1)} °C average`,
    diff: (a, b) => compare(growingTemp(b) - growingTemp(a), 1, ' °C', 'warmer', 'cooler'),
  },
  precip_monthly: {
    you: (p) => `${int(growingRain(p))} mm`,
    diff: (a, b) => compare(growingRain(b) - growingRain(a), 0, ' mm', 'more', 'less'),
  },
  ffd: {
    you: (p) => `${int(p.ffd)} days`,
    diff: (a, b) => compare(b.ffd - a.ffd, 0, ' days', 'longer', 'shorter'),
  },
  gdd10: {
    you: (p) => `${int(p.gdd10)} °C·days`,
    diff: (a, b) => compare(b.gdd10 - a.gdd10, 0, '', 'more', 'fewer'),
  },
  gwet_summer: {
    you: (p) => `${int(p.gwet_summer * 100)}% wet`,
    diff: (a, b) => compare((b.gwet_summer - a.gwet_summer) * 100, 0, ' points', 'wetter', 'drier'),
  },
  heat_days: {
    you: (p) => `${int(p.heat_days)} days a year`,
    diff: (a, b) => compare(b.heat_days - a.heat_days, 0, ' days', 'more', 'fewer'),
  },
  drought_freq: {
    you: (p) => `${int(p.drought_freq * 100)}% of years`,
    diff: (a, b) => compare((b.drought_freq - a.drought_freq) * 100, 0, ' points', 'more often', 'less often'),
  },
}

/**
 * 지역의 "그쪽" 값: 토양은 지역 안 청크 값의 중앙값, 기후는 같은 칸이라 첫 청크의 값(현재 기후).
 */
export function regionProfile(region: Region): Profile {
  const p: Profile = profileOf(region.members[0].chunk)
  for (const k of SOIL_KEYS) p[k] = median(region.members.map((s) => s.chunk[k]))
  return p
}

/** Detail 패널의 항목 줄. 순서는 엔진 항목 순서 그대로(토양 → 기후) */
export function describeItems(you: Profile, region: Region): ItemRow[] {
  const there = regionProfile(region)
  const keys = region.members[0].score.items.map((it) => it.key)
  const lowest = keys.reduce((lo, k) => (region.items[k].median < region.items[lo].median ? k : lo), keys[0])
  return keys.map((key) => ({
    key,
    label: ITEM_LABEL[key],
    block: config.blockOf[key],
    score: region.items[key],
    you: DESCRIBE[key].you(you),
    there: DESCRIBE[key].you(there),
    diff: DESCRIBE[key].diff(you, there),
    biggest: key === lowest,
  }))
}

/** Areas 패널의 내 밭 토양 한 줄 */
export function soilSummary(p: Profile): string {
  return [
    DESCRIBE.texture.you(p),
    DRAINAGE[grade(p.drainage)].toLowerCase(),
    `pH ${p.ph.toFixed(1)}`,
    `${p.om.toFixed(1)}% organic matter`,
  ].join(' · ')
}
