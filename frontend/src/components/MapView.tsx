import { MapLibreMap, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef } from 'react'
import type { Chunk, Status } from '../engine'

// maplibre-gl v6는 워커 파일을 따로 읽는다. Vite가 내보낸 주소를 알려 준다.
setWorkerUrl(workerUrl)

const COLOR = {
  ref: '#d62728',
  twin: '#2ca02c',
  constrained: '#ff7f0e',
  other: '#888888',
}

/** 지도 범위: 미국 본토 (서경 127°~65°, 북위 23°~51°) */
const US_BOUNDS: [[number, number], [number, number]] = [
  [-127, 23],
  [-65, 51],
]

/** 배경: OpenStreetMap 래스터 타일 (API 키 없음) */
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

/** 청크 전체: 처음 한 번만 넣고 다시 만들지 않는다 */
const ALL = 'chunks'
/** 기준 청크 + 닮은 청크(최대 31개): 선택이 바뀔 때 이것만 바꾼다 */
const MARKED = 'marked'
const LAYER = { all: 'chunk-all', similar: 'chunk-similar', ref: 'chunk-ref' }
/** 클릭·툴팁은 위에 그린 층부터 찾는다 */
const PICK_ORDER = [LAYER.ref, LAYER.similar, LAYER.all]

type Role = 'ref' | 'twin' | 'constrained'
type ChunkPoint = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { id: string; role?: Role }
}
type Points = { type: 'FeatureCollection'; features: ChunkPoint[] }

const pointOf = (c: Chunk, role?: Role): ChunkPoint => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
  properties: role ? { id: c.chunk_id, role } : { id: c.chunk_id },
})

/** 기준 청크와 닮은 청크만. 닮은 청크는 청크 순서대로, 기준 청크는 맨 끝 */
function markedOf(chunks: Chunk[], refId: string, similar: Map<string, Status>): Points {
  const features: ChunkPoint[] = []
  let ref: Chunk | undefined
  for (const c of chunks) {
    if (c.chunk_id === refId) ref = c
    else {
      const st = similar.get(c.chunk_id)
      if (st === 'twin' || st === 'constrained') features.push(pointOf(c, st))
    }
  }
  if (ref) features.push(pointOf(ref, 'ref'))
  return { type: 'FeatureCollection', features }
}

function boundsOf(chunks: Chunk[]): [[number, number], [number, number]] {
  if (chunks.length === 0) return US_BOUNDS
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const c of chunks) {
    w = Math.min(w, c.lon)
    e = Math.max(e, c.lon)
    s = Math.min(s, c.lat)
    n = Math.max(n, c.lat)
  }
  return [
    [w, s],
    [e, n],
  ]
}

const STROKE = { 'circle-stroke-color': '#333', 'circle-stroke-width': 1, 'circle-opacity': 0.9 }

type Props = {
  chunks: Chunk[]
  refId: string
  /** 닮은 청크의 상태 (twin / constrained) */
  similar: Map<string, Status>
  onSelect: (id: string) => void
}

export function MapView({ chunks, refId, similar, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  const marked = useMemo(() => markedOf(chunks, refId, similar), [chunks, refId, similar])
  const markedRef = useRef(marked)

  useEffect(() => {
    if (!el.current) return
    const map = new MapLibreMap({
      container: el.current,
      style: BASE_STYLE,
      bounds: boundsOf(chunks),
      fitBoundsOptions: { padding: 20 },
      maxBounds: US_BOUNDS,
      // 지금 지도처럼 회전·기울이기는 쓰지 않는다
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left')
    const tip = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'chunk-tip' })
    const byId = new Map(chunks.map((c) => [c.chunk_id, c]))

    map.on('load', () => {
      map.addSource(ALL, { type: 'geojson', data: { type: 'FeatureCollection', features: chunks.map((c) => pointOf(c)) } })
      map.addSource(MARKED, { type: 'geojson', data: markedRef.current })
      map.addLayer({
        id: LAYER.all,
        type: 'circle',
        source: ALL,
        paint: { 'circle-radius': 5, 'circle-color': COLOR.other, ...STROKE },
      })
      map.addLayer({
        id: LAYER.similar,
        type: 'circle',
        source: MARKED,
        filter: ['!=', ['get', 'role'], 'ref'],
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'role'], 'twin', COLOR.twin, COLOR.constrained],
          ...STROKE,
        },
      })
      // 기준 청크는 다른 점에 가리지 않게 맨 위 층
      map.addLayer({
        id: LAYER.ref,
        type: 'circle',
        source: MARKED,
        filter: ['==', ['get', 'role'], 'ref'],
        paint: { 'circle-radius': 9, 'circle-color': COLOR.ref, ...STROKE },
      })

      const topChunk = (point: { x: number; y: number }) => {
        const id = map.queryRenderedFeatures([point.x, point.y], { layers: PICK_ORDER })[0]?.properties.id
        return typeof id === 'string' ? byId.get(id) : undefined
      }
      map.on('mousemove', (e) => {
        const c = topChunk(e.point)
        map.getCanvas().style.cursor = c ? 'pointer' : ''
        if (c) tip.setLngLat([c.lon, c.lat]).setText(`${c.chunk_id} (${c.climate_cell})`).addTo(map)
        else tip.remove()
      })
      map.on('mouseout', () => {
        map.getCanvas().style.cursor = ''
        tip.remove()
      })
      map.on('click', (e) => {
        const c = topChunk(e.point)
        if (c) onSelectRef.current(c.chunk_id)
      })
    })

    mapRef.current = map
    return () => {
      tip.remove()
      map.remove()
      mapRef.current = null
    }
  }, [chunks])

  // 선택이 바뀌면 작은 소스(기준 + 닮은 청크)만 바꾼다. 청크 전체 소스는 그대로 둔다.
  useEffect(() => {
    markedRef.current = marked
    void mapRef.current?.getSource<GeoJSONSource>(MARKED)?.setData(marked)
  }, [marked])

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
