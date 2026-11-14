import type { ItemKey, Status, Warning } from './engine'

export const ITEM_LABEL: Record<ItemKey, string> = {
  texture: '토성',
  aws: '유효수분',
  drainage_flood: '배수·침수',
  ph: '산도',
  om: '유기물',
  cec: 'CEC',
  bedrock_salinity: '암반·염류',
  slope: '경사',
  temp_monthly: '월별 기온',
  precip_monthly: '월별 강수',
  ffd: '무상기간',
  gdd10: '생육도일',
  gwet_summer: '뿌리층 수분',
  heat_days: '폭염일수',
  drought_freq: '가뭄 해 빈도',
}

export const STATUS_LABEL: Record<Status, string> = {
  twin: 'twin',
  constrained: 'constrained',
  climate_only: 'climate_only',
  none: 'none',
}

export function warningText(w: Warning): string {
  switch (w.code) {
    case 'drainage':
      return `배수 등급 차 ≥ 2 (${w.ref} vs ${w.cand})`
    case 'ph':
      return `pH 차 > 1.0 (${w.ref} vs ${w.cand})`
    case 'flood':
      return `침수 등급 차 ≥ 2 (${w.ref} vs ${w.cand})`
    case 'bedrock':
      return `암반 100 cm 경계 (${w.ref} vs ${w.cand})`
    case 'salinity':
      return `염류 EC 4 경계 (${w.ref} vs ${w.cand})`
  }
}

export const fmt = (x: number, d = 1) => (Number.isInteger(x) ? String(x) : x.toFixed(d))
export const pct = (x: number) => `${(x * 100).toFixed(0)}%`
export const patternLabel = (key: string) => key || '(2번 이상 나온 작물 없음)'
