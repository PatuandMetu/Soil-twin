/**
 * 실제 밭 윤곽선: USDA NASS Crop Sequence Boundaries 2024판(2017~2024 작물) 공개 서비스.
 * 화면을 0.1° 칸으로 나눠 칸마다 요청하고, 받은 칸은 캐시한다. 서비스가 느리거나 실패해도 앱은 그대로 돈다.
 */

export const CSB_URL =
  'https://pdi.scinet.usda.gov/hosting/rest/services/Hosted/Crop_Sequence_Boundaries_2024/FeatureServer/0/query'
/** 이 줌 이상에서만 받는다 */
export const CSB_MIN_ZOOM = 12
export const CSB_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024] as const
/** 요청 한 번의 최대 개수 (서비스 maxRecordCount) */
export const CSB_MAX_RECORDS = 2000
const TILE = 0.1
const TIMEOUT_MS = 12000
const PARALLEL = 4
const CACHE_TILES = 300

export type CsbProps = {
  csbid: string
  csbacres: number
  statefips: string
} & Record<`cdl${(typeof CSB_YEARS)[number]}`, number>

type Ring = [number, number][]
export type CsbGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
export type CsbFeature = { type: 'Feature'; geometry: CsbGeometry; properties: CsbProps }

export type Bounds = { w: number; s: number; e: number; n: number }

/** 화면 범위에 걸치는 0.1° 칸 열쇠 ("ix_iy") */
export function tilesFor(b: Bounds): string[] {
  const keys: string[] = []
  for (let ix = Math.floor(b.w / TILE); ix <= Math.floor(b.e / TILE); ix++)
    for (let iy = Math.floor(b.s / TILE); iy <= Math.floor(b.n / TILE); iy++) keys.push(`${ix}_${iy}`)
  return keys
}

export function tileBounds(key: string): Bounds {
  const [ix, iy] = key.split('_').map(Number)
  const r = (x: number) => Math.round(x * 1e6) / 1e6
  return { w: r(ix * TILE), s: r(iy * TILE), e: r((ix + 1) * TILE), n: r((iy + 1) * TILE) }
}

/** 칸 하나의 요청 주소. 좌표는 소수 5자리(약 1 m), 약 2 m 이내 꼭짓점은 줄여서 받는다 */
export function csbQueryUrl(b: Bounds): string {
  const fields = ['csbid', 'csbacres', ...CSB_YEARS.map((y) => `cdl${y}`), 'statefips'].join(',')
  const q = new URLSearchParams({
    geometry: `${b.w},${b.s},${b.e},${b.n}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: fields,
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '5',
    maxAllowableOffset: '0.00002',
    f: 'geojson',
  })
  return `${CSB_URL}?${q}`
}

/** 바깥 고리의 면적 가중 중심 (밭 하나 크기라 평면으로 계산). MultiPolygon은 가장 큰 조각 */
export function centroidOf(g: CsbGeometry): { lat: number; lon: number } {
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0])
  let best = { a: -1, x: 0, y: 0 }
  for (const ring of rings) {
    // 첫 꼭짓점 기준으로 옮겨서 계산한다 (큰 경위도 값끼리 곱할 때 생기는 자릿수 손실을 막는다)
    const [ox, oy] = ring[0]
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const x0 = ring[i][0] - ox
      const y0 = ring[i][1] - oy
      const x1 = ring[i + 1][0] - ox
      const y1 = ring[i + 1][1] - oy
      const f = x0 * y1 - x1 * y0
      a += f
      cx += (x0 + x1) * f
      cy += (y0 + y1) * f
    }
    if (Math.abs(a) < 1e-15) {
      // 넓이가 0이면 꼭짓점 평균
      const n = ring.length
      const x = ring.reduce((s, p) => s + p[0], 0) / n
      const y = ring.reduce((s, p) => s + p[1], 0) / n
      if (best.a < 0) best = { a: 0, x, y }
      continue
    }
    if (Math.abs(a) > best.a) best = { a: Math.abs(a), x: ox + cx / (3 * a), y: oy + cy / (3 * a) }
  }
  return { lat: best.y, lon: best.x }
}

/** Python round(반올림 짝수)와 같게 */
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

/** NASA POWER 기후 칸 번호. builder의 cell_id_of와 같은 규칙·형식 ("C_+41.00_-097.500") */
export function cellIdOf(lat: number, lon: number): string {
  const fmt = (v: number, width: number, digits: number) =>
    (v < 0 ? '-' : '+') + Math.abs(v).toFixed(digits).padStart(width - 1, '0')
  return `C_${fmt(roundHalfEven(lat / 0.5) * 0.5, 6, 2)}_${fmt(roundHalfEven(lon / 0.625) * 0.625, 8, 3)}`
}

const FIPS: Record<string, string> = {
  '01': 'AL', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV',
  '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR',
  '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA',
  '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
}
export const stateOfFips = (fips: string) => FIPS[String(fips).padStart(2, '0')] ?? String(fips)

export const cropsOf = (p: CsbProps): number[] => CSB_YEARS.map((y) => Number(p[`cdl${y}`]))

export type CsbStatus = 'zoom' | 'loading' | 'ready' | 'partial' | 'error'

type Tile = { features: CsbFeature[]; partial: boolean }

/**
 * 화면이 멈출 때마다 update(범위, 줌)를 부른다. 필요한 칸만 받고(동시에 4개), 화면에서 벗어난 칸의 요청은
 * 취소하고, 받은 칸은 캐시한다. 화면 안 칸들의 밭을 csbid로 중복 없이 모아 onChange로 넘긴다.
 */
export function createCsbLoader(onChange: (features: CsbFeature[], status: CsbStatus) => void) {
  const cache = new Map<string, Tile>()
  const inflight = new Map<string, AbortController>()
  let want: string[] = []
  let failed = false
  let alive = true

  const emit = () => {
    if (!alive) return
    const seen = new Set<string>()
    const out: CsbFeature[] = []
    let partial = false
    let missing = 0
    for (const k of want) {
      const t = cache.get(k)
      if (!t) {
        missing++
        continue
      }
      partial ||= t.partial
      for (const f of t.features) {
        if (seen.has(f.properties.csbid)) continue
        seen.add(f.properties.csbid)
        out.push(f)
      }
    }
    const status: CsbStatus = missing === 0 ? (partial ? 'partial' : 'ready') : failed ? 'error' : 'loading'
    onChange(out, status)
  }

  const fetchTile = async (key: string) => {
    const ac = new AbortController()
    inflight.set(key, ac)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, TIMEOUT_MS)
    try {
      const res = await fetch(csbQueryUrl(tileBounds(key)), { signal: ac.signal })
      if (!res.ok) throw new Error(`CSB ${res.status}`)
      const body = (await res.json()) as {
        features?: CsbFeature[]
        error?: unknown
        properties?: { exceededTransferLimit?: boolean }
        exceededTransferLimit?: boolean
      }
      if (body.error || !Array.isArray(body.features)) throw new Error('CSB error response')
      const partial =
        body.properties?.exceededTransferLimit === true ||
        body.exceededTransferLimit === true ||
        body.features.length >= CSB_MAX_RECORDS
      cache.set(key, { features: body.features.filter((f) => f.geometry), partial })
      if (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value as string)
      failed = false
    } catch (e) {
      // 화면이 바뀌어 취소한 것은 실패가 아니다
      if (timedOut || !(e instanceof DOMException && e.name === 'AbortError')) failed = true
    } finally {
      clearTimeout(timer)
      inflight.delete(key)
    }
  }

  const queue: string[] = []
  let active = 0
  const drain = () => {
    while (alive && active < PARALLEL && queue.length) {
      const k = queue.shift()!
      if (!want.includes(k) || cache.has(k) || inflight.has(k)) continue
      active++
      void fetchTile(k).finally(() => {
        active--
        emit()
        drain()
      })
    }
  }

  return {
    update(b: Bounds, zoom: number) {
      if (zoom < CSB_MIN_ZOOM) {
        want = []
        for (const ac of inflight.values()) ac.abort()
        onChange([], 'zoom')
        return
      }
      // 화면 가운데 칸부터 받는다
      const cx = (b.w + b.e) / 2
      const cy = (b.s + b.n) / 2
      const dist = (k: string) => {
        const t = tileBounds(k)
        return Math.hypot((t.w + t.e) / 2 - cx, (t.s + t.n) / 2 - cy)
      }
      want = tilesFor(b).sort((a, c) => dist(a) - dist(c))
      for (const [k, ac] of inflight) if (!want.includes(k)) ac.abort()
      failed = false
      queue.length = 0
      queue.push(...want.filter((k) => !cache.has(k) && !inflight.has(k)))
      emit()
      drain()
    },
    destroy() {
      alive = false
      for (const ac of inflight.values()) ac.abort()
    },
  }
}
