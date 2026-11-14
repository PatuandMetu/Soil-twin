import { config as defaultConfig, type Config } from './config'
import { exact } from './score'

type LatLon = { lat: number; lon: number }

const RAD = Math.PI / 180

/**
 * 두 청크 중심(lat, lon) 사이의 대원거리(km). Haversine, 지구 반지름 cfg.earthRadiusKm.
 * h = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2), d = 2R · atan2(√h, √(1−h))
 */
export function distanceKm(a: LatLon, b: LatLon, cfg: Config = defaultConfig): number {
  const p1 = a.lat * RAD
  const p2 = b.lat * RAD
  const dp = (b.lat - a.lat) * RAD
  const dl = (b.lon - a.lon) * RAD
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * cfg.earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}

/** 후보 최소 거리 조건: 반올림한 거리 ≥ minDistanceKm (정확히 100 km면 후보) */
export function meetsMinDistance(km: number, cfg: Config = defaultConfig): boolean {
  return exact(km, cfg) >= cfg.minDistanceKm
}
