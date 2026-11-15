import { MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef } from 'react'
import type { Chunk, Status } from '../engine'
import { MAP_COLOR } from '../mapColors'
import type { Padding } from '../panels/geometry'

// maplibre-gl v6는 워커 파일을 따로 읽는다. Vite가 내보낸 주소를 알려 준다.
setWorkerUrl(workerUrl)


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
/** 클릭·툴팁을 찾는 점 층 */
const POINT_LAYERS = [LAYER.ref, LAYER.similar, LAYER.all]

/** 필지 윤곽선: 경계 파일(chunks.geo.json)은 이 줌에 가까워질 때 처음 읽는다 */
const PARCEL_LOAD_ZOOM = 8
/** 이 줌부터 윤곽선이 나타나고, 점은 다음 줌까지 옅어지다 사라진다 */
const PARCEL_ZOOM = 10
const PARCELS = 'parcels'
const MARKED_PARCELS = 'marked-parcels'
const PARCEL_LAYER = {
  fill: 'parcel-fill',
  line: 'parcel-line',
  similarFill: 'parcel-similar-fill',
  similarLine: 'parcel-similar-line',
  refFill: 'parcel-ref-fill',
  refLine: 'parcel-ref-line',
}
/** 클릭·툴팁을 찾는 윤곽선 층 (채우기만) */
const PARCEL_PICK = [PARCEL_LAYER.refFill, PARCEL_LAYER.similarFill, PARCEL_LAYER.fill]

type ParcelFeature = {
  type: 'Feature'
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }
  properties: { chunk_id: string; role?: Role }
}
type Parcels = { type: 'FeatureCollection'; features: ParcelFeature[] }

/** 표시 중인 점(기준 + 닮은 청크)과 같은 청크의 윤곽선 */
function markedParcelsOf(marked: Points, byId: Map<string, ParcelFeature>): Parcels {
  const features: ParcelFeature[] = []
  for (const f of marked.features) {
    const g = byId.get(f.properties.id)
    if (g) features.push({ ...g, properties: { chunk_id: f.properties.id, role: f.properties.role } })
  }
  return { type: 'FeatureCollection', features }
}

/** 줌 PARCEL_ZOOM에서 0, 반 줌 뒤에 v */
const fadeIn = (v: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], PARCEL_ZOOM, 0, PARCEL_ZOOM + 0.5, v]
/** 줌 PARCEL_ZOOM에서 v, 한 줌 뒤에 0 */
const fadeOut = (v: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], PARCEL_ZOOM, v, PARCEL_ZOOM + 1, 0]

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
function markedOf(chunks: Chunk[], refId: string | null, similar: Map<string, Status>): Points {
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

/** 지도를 이 범위로 옮긴다. seq가 바뀔 때마다 한 번 */
export type MapFocus = { seq: number; bounds: [[number, number], [number, number]]; padding: Padding }

/** 지도에 번호로 표시하는 비슷한 지역 */
export type RegionPin = { cell: string; rank: number; lat: number; lon: number }

type Props = {
  chunks: Chunk[]
  /** 기준 청크 (고르기 전이면 null) */
  refId: string | null
  /** 닮은 청크의 상태 (twin / constrained) */
  similar: Map<string, Status>
  regions: RegionPin[]
  activeCell: string | null
  onSelect: (id: string) => void
  onSelectRegion: (cell: string) => void
  focus: MapFocus | null
  /** 검색으로 찾은 자리 (핀 표시) */
  place: { lat: number; lon: number; label: string } | null
}

export function MapView({ chunks, refId, similar, regions, activeCell, onSelect, onSelectRegion, focus, place }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onSelectRef = useRef(onSelect)
  const onSelectRegionRef = useRef(onSelectRegion)
  useEffect(() => {
    onSelectRef.current = onSelect
    onSelectRegionRef.current = onSelectRegion
  }, [onSelect, onSelectRegion])

  const marked = useMemo(() => markedOf(chunks, refId, similar), [chunks, refId, similar])
  const markedRef = useRef(marked)
  /** 경계 파일을 읽은 뒤: chunk_id → 윤곽선 */
  const parcelsRef = useRef<Map<string, ParcelFeature> | null>(null)

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
      attributionControl: { compact: false },
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-left')
    const tip = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'chunk-tip' })
    const byId = new Map(chunks.map((c) => [c.chunk_id, c]))

    map.on('load', () => {
      map.addSource(ALL, { type: 'geojson', data: { type: 'FeatureCollection', features: chunks.map((c) => pointOf(c)) } })
      map.addSource(MARKED, { type: 'geojson', data: markedRef.current })
      map.addLayer({
        id: LAYER.all,
        type: 'circle',
        source: ALL,
        paint: { 'circle-radius': 5, 'circle-color': MAP_COLOR.other, ...STROKE },
      })
      map.addLayer({
        id: LAYER.similar,
        type: 'circle',
        source: MARKED,
        filter: ['!=', ['get', 'role'], 'ref'],
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'role'], 'twin', MAP_COLOR.twin, MAP_COLOR.constrained],
          ...STROKE,
        },
      })
      // 기준 청크는 다른 점에 가리지 않게 맨 위 층
      map.addLayer({
        id: LAYER.ref,
        type: 'circle',
        source: MARKED,
        filter: ['==', ['get', 'role'], 'ref'],
        paint: { 'circle-radius': 9, 'circle-color': MAP_COLOR.ref, ...STROKE },
      })

      let pick = POINT_LAYERS
      const topChunk = (point: { x: number; y: number }) => {
        const props = map.queryRenderedFeatures([point.x, point.y], { layers: pick })[0]?.properties
        const id = props?.id ?? props?.chunk_id
        return typeof id === 'string' ? byId.get(id) : undefined
      }

      // 필지 윤곽선: 확대해 가면 경계 파일을 한 번 읽어 점 아래 층으로 넣는다
      let parcelState: 'none' | 'loading' | 'done' = 'none'
      const loadParcels = () => {
        if (parcelState !== 'none' || map.getZoom() < PARCEL_LOAD_ZOOM) return
        parcelState = 'loading'
        fetch(`${import.meta.env.BASE_URL}data/chunks.geo.json`)
          .then((r) => {
            if (!r.ok) throw new Error(`chunks.geo.json: ${r.status}`)
            return r.json() as Promise<Parcels>
          })
          .then((geo) => {
            if (mapRef.current !== map) return
            const byChunk = new Map(geo.features.map((f) => [f.properties.chunk_id, f]))
            parcelsRef.current = byChunk
            map.addSource(PARCELS, { type: 'geojson', data: geo })
            map.addSource(MARKED_PARCELS, { type: 'geojson', data: markedParcelsOf(markedRef.current, byChunk) })
            const below = LAYER.all
            const fill = (id: string, source: string, color: unknown, opacity: number, filter?: unknown) =>
              map.addLayer(
                {
                  id,
                  type: 'fill',
                  source,
                  minzoom: PARCEL_ZOOM,
                  ...(filter ? { filter } : {}),
                  paint: { 'fill-color': color, 'fill-opacity': fadeIn(opacity) },
                } as never,
                below,
              )
            const line = (id: string, source: string, color: string, width: number, filter?: unknown) =>
              map.addLayer(
                {
                  id,
                  type: 'line',
                  source,
                  minzoom: PARCEL_ZOOM,
                  ...(filter ? { filter } : {}),
                  paint: { 'line-color': color, 'line-width': width, 'line-opacity': fadeIn(1) },
                } as never,
                below,
              )
            const notRef = ['!=', ['get', 'role'], 'ref']
            const isRef = ['==', ['get', 'role'], 'ref']
            fill(PARCEL_LAYER.fill, PARCELS, MAP_COLOR.other, 0.3)
            line(PARCEL_LAYER.line, PARCELS, '#444', 1)
            fill(PARCEL_LAYER.similarFill, MARKED_PARCELS, ['match', ['get', 'role'], 'twin', MAP_COLOR.twin, MAP_COLOR.constrained], 0.55, notRef)
            line(PARCEL_LAYER.similarLine, MARKED_PARCELS, '#1b1b1b', 1.5, notRef)
            // 기준 청크 윤곽선이 맨 위
            fill(PARCEL_LAYER.refFill, MARKED_PARCELS, MAP_COLOR.ref, 0.55, isRef)
            line(PARCEL_LAYER.refLine, MARKED_PARCELS, '#6d0000', 2.5, isRef)
            // 점은 윤곽선이 나오면 옅어지다가 다음 줌부터 그리지 않는다 (안 보이는 점이 클릭되지 않게)
            for (const id of POINT_LAYERS) {
              map.setPaintProperty(id, 'circle-opacity', fadeOut(0.9))
              map.setPaintProperty(id, 'circle-stroke-opacity', fadeOut(1))
              map.setLayerZoomRange(id, 0, PARCEL_ZOOM + 1)
            }
            pick = [...POINT_LAYERS, ...PARCEL_PICK]
            parcelState = 'done'
          })
          .catch((err: unknown) => {
            console.warn('필지 윤곽선을 읽지 못했다', err)
            parcelState = 'none' // 다음 확대 때 다시 시도
          })
      }
      map.on('zoom', loadParcels)
      loadParcels()
      map.on('mousemove', (e) => {
        const c = topChunk(e.point)
        map.getCanvas().style.cursor = c ? 'pointer' : ''
        if (c) tip.setLngLat([c.lon, c.lat]).setText(`Sample field ${c.chunk_id} · ${c.state}`).addTo(map)
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
    const map = mapRef.current
    void map?.getSource<GeoJSONSource>(MARKED)?.setData(marked)
    if (parcelsRef.current)
      void map?.getSource<GeoJSONSource>(MARKED_PARCELS)?.setData(markedParcelsOf(marked, parcelsRef.current))
  }, [marked])

  // 비슷한 지역 번호 (최대 30개라 DOM 표시로). 누르면 그 지역을 고른다
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const pins = regions.map((r) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `region-pin${r.cell === activeCell ? ' active' : ''}`
      b.textContent = String(r.rank)
      b.title = `Similar area ${r.rank}`
      b.setAttribute('aria-label', `Similar area ${r.rank}`)
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        onSelectRegionRef.current(r.cell)
      })
      return new Marker({ element: b }).setLngLat([r.lon, r.lat]).addTo(map)
    })
    return () => pins.forEach((m) => m.remove())
  }, [regions, activeCell, chunks])

  // 검색 결과로 옮기기: 찾은 자리와 가장 가까운 표본 밭이 같이 보이게 (여백은 패널 자리)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.fitBounds(focus.bounds, { padding: focus.padding, maxZoom: 12, duration: 1200 })
  }, [focus])

  // 찾은 자리 핀
  useEffect(() => {
    const map = mapRef.current
    if (!map || !place) return
    const m = new Marker({ color: '#1565c0' }).setLngLat([place.lon, place.lat]).addTo(map)
    m.getElement().title = place.label
    return () => {
      m.remove()
    }
  }, [place, chunks])

  // MapLibre CSS가 지도 칸을 position: relative로 바꾸므로, 화면 전체 고정은 바깥 칸이 맡는다
  return (
    <div className="map">
      <div ref={el} className="map-canvas" />
    </div>
  )
}
