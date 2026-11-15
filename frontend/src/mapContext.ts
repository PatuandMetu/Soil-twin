import type { MapLibreMap } from 'maplibre-gl'
import { createContext, useContext, useEffect, useState } from 'react'

/** 지도 위에 붙는 것(팝업)이 지도 인스턴스를 쓰려고. MapView가 지도를 만든 뒤에만 채운다 */
export const MapInstanceContext = createContext<MapLibreMap | null>(null)

export function useMapInstance(): MapLibreMap {
  const map = useContext(MapInstanceContext)
  if (!map) throw new Error('useMapInstance는 MapView 안에서 쓴다')
  return map
}

/** 지도 줌이 z보다 작은지 (경계를 넘을 때만 다시 그린다) */
export function useZoomBelow(z: number): boolean {
  const map = useMapInstance()
  const [below, setBelow] = useState(() => map.getZoom() < z)
  useEffect(() => {
    const f = () => setBelow(map.getZoom() < z)
    map.on('zoom', f)
    return () => {
      map.off('zoom', f)
    }
  }, [map, z])
  return below
}
