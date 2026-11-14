import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Chunk, Status } from '../engine'

const COLOR = {
  ref: '#d62728',
  twin: '#2ca02c',
  constrained: '#ff7f0e',
  other: '#888888',
}

type Props = {
  chunks: Chunk[]
  refId: string
  /** 닮은 청크의 상태 (twin / constrained) */
  similar: Map<string, Status>
  onSelect: (id: string) => void
}

export function MapView({ chunks, refId, similar, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const markers = useRef(new Map<string, L.CircleMarker>())
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    for (const c of chunks) {
      const m = L.circleMarker([c.lat, c.lon], { radius: 6, weight: 1, color: '#333', fillOpacity: 0.9 })
        .bindTooltip(`${c.chunk_id} (${c.climate_cell})`)
        .on('click', () => onSelectRef.current(c.chunk_id))
        .addTo(map)
      markers.current.set(c.chunk_id, m)
    }
    map.fitBounds(L.latLngBounds(chunks.map((c) => [c.lat, c.lon])), { padding: [20, 20] })
    const ms = markers.current
    return () => {
      map.remove()
      ms.clear()
    }
  }, [chunks])

  useEffect(() => {
    for (const [id, m] of markers.current) {
      const st = similar.get(id)
      const fill = id === refId ? COLOR.ref : st === 'twin' ? COLOR.twin : st === 'constrained' ? COLOR.constrained : COLOR.other
      m.setStyle({ fillColor: fill, radius: id === refId ? 9 : st ? 7 : 5 })
      if (id === refId || st) m.bringToFront()
    }
  }, [refId, similar])

  return (
    <div>
      <div ref={el} style={{ height: 420 }} />
      <div className="legend">
        <span style={{ color: COLOR.ref }}>● 기준 청크</span> <span style={{ color: COLOR.twin }}>● twin</span>{' '}
        <span style={{ color: COLOR.constrained }}>● constrained</span> <span style={{ color: COLOR.other }}>● 그 외</span>
      </div>
    </div>
  )
}
