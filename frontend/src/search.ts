import { cellIdOf } from './csb'
import { distanceKm, type Chunk } from './engine'

export type LatLon = { lat: number; lon: number }

/** 지도 범위와 같은 미국 본토 (서경 127°~65°, 북위 23°~51°) */
export function inMainland({ lat, lon }: LatLon): boolean {
  return lat >= 23 && lat <= 51 && lon >= -127 && lon <= -65
}

/** "42.03, -93.62" 같은 좌표면 위도·경도, 아니면 null */
export function parseCoords(q: string): LatLon | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/** 가장 가까운 청크와 거리(km). 거리가 같으면 앞에 있는 청크 */
export function nearestChunk(chunks: Chunk[], p: LatLon): { chunk: Chunk; km: number } | null {
  let best: { chunk: Chunk; km: number } | null = null
  for (const c of chunks) {
    const d = distanceKm(p, c)
    if (!best || d < best.km) best = { chunk: c, km: d }
  }
  return best
}

/** 같은 기후 칸 표본이 있으면 그중 가장 가까운 것, 없으면 전체에서 가장 가까운 것 */
export function nearestSample(
  chunks: Chunk[],
  point: LatLon,
): { chunk: Chunk; km: number; sameCell: boolean } | null {
  const cell = cellIdOf(point.lat, point.lon)
  const inCell = nearestChunk(
    chunks.filter((c) => c.climate_cell === cell),
    point,
  )
  if (inCell) return { ...inCell, sameCell: true }
  const any = nearestChunk(chunks, point)
  return any ? { ...any, sameCell: false } : null
}

/** "Ames, Story County, Iowa, 50010, United States" → "Ames, Iowa" */
export function shortPlaceName(displayName: string): string {
  const parts = displayName
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'United States' && !/County$|Parish$/.test(s) && !/^\d{5}(-\d{4})?$/.test(s))
  return parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : (parts[0] ?? displayName)
}

type NominatimHit = { lat: string; lon: string; display_name: string }

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
/** Nominatim 사용 정책: 초당 1회 이하 */
const MIN_GAP_MS = 1000
let lastRequestAt = 0

/**
 * 지명·주소로 위치를 찾는다 (OpenStreetMap Nominatim, API 키 없음).
 * 입력이 끝났을 때(검색 버튼·Enter)만 부르고, 앞 요청과 1초가 안 지났으면 기다렸다 보낸다.
 */
export async function geocode(q: string): Promise<(LatLon & { label: string })[]> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
  const url = `${NOMINATIM}?format=json&countrycodes=us&limit=5&accept-language=en&q=${encodeURIComponent(q)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const hits = (await res.json()) as NominatimHit[]
  return hits
    .map((h) => ({ lat: Number(h.lat), lon: Number(h.lon), label: shortPlaceName(h.display_name) }))
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon))
}
