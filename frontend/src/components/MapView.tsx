import {
  MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type PaddingOptions,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CSB_MIN_ZOOM, createCsbLoader, type CsbFeature, type CsbGeometry, type CsbStatus } from '../csb'
import { cropName, type Chunk, type CropNames, type Status } from '../engine'
import { MapInstanceContext } from '../mapContext'
import { MAP_COLOR } from '../mapColors'
import { Legend } from '../views/Legend'

// maplibre-gl v6는 워커 파일을 따로 읽는다. Vite가 내보낸 주소를 알려 준다.
setWorkerUrl(workerUrl)

/** 미국 본토 (표본이 없을 때 처음 보여 줄 범위) */
const US_BOUNDS: [[number, number], [number, number]] = [
  [-127, 23],
  [-65, 51],
]
/**
 * 지도를 움직일 수 있는 범위: 태평양·대서양까지 (서경 160°~40°, 북위 0°~70°).
 * 지도 칸이 세로로 길어도 가장 멀리 축소했을 때 본토 전체(경도 약 59°)가 한 화면에 들어가는 넓이다
 * (지도 700×900 px → 경도 77°, 580×800 px → 72°).
 */
const MAP_BOUNDS: [[number, number], [number, number]] = [
  [-160, 0],
  [-40, 70],
]

/** 배경: 멀리서는 OpenStreetMap, 확대하면(실제 밭 윤곽선이 나오는 줌) 위성사진 (둘 다 API 키 없음) */
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Fields: USDA NASS CSB',
    },
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, USDA FSA',
    },
  },
  layers: [
    { id: 'osm', type: 'raster', source: 'osm', maxzoom: 13 },
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      minzoom: 11,
      paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, CSB_MIN_ZOOM, 1] },
    },
  ],
}

const SRC = {
  /** 표본 청크 전체: 처음 한 번만 넣는다 */
  all: 'chunks',
  /** 기준 청크 + 닮은 청크(최대 31개): 선택이 바뀔 때 이것만 바꾼다 */
  marked: 'marked',
  /** 위와 같은 청크의 표본 윤곽선 (chunks.geo.json) */
  markedParcels: 'marked-parcels',
  /** USDA CSB 2024 실제 밭 윤곽선 (화면 범위만) */
  csb: 'csb',
  /** 사용자가 고른 실제 밭 */
  picked: 'picked',
  /** 고른 밭 → 연결된 표본 밭 */
  link: 'link',
}
const LAYER = {
  csbFill: 'csb-fill',
  csbLine: 'csb-line',
  parcelSimilarFill: 'parcel-similar-fill',
  parcelSimilarLine: 'parcel-similar-line',
  parcelRefFill: 'parcel-ref-fill',
  parcelRefLine: 'parcel-ref-line',
  pickedFill: 'picked-fill',
  pickedLine: 'picked-line',
  link: 'link-line',
  all: 'chunk-all',
  similar: 'chunk-similar',
  ref: 'chunk-ref',
}
/** 클릭·툴팁: 표본 점이 먼저, 그다음 실제 밭 */
const POINT_LAYERS = [LAYER.ref, LAYER.similar, LAYER.all]
const PICKED_COLOR = '#1565c0'

/** 표본 윤곽선(chunks.geo.json)은 이 줌에 이르면 한 번 받는다 */
const PARCEL_LOAD_ZOOM = 8
const PARCEL_ZOOM = 10

type Role = 'ref' | 'twin' | 'constrained'
type ChunkPoint = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { id: string; role?: Role }
}
type Points = { type: 'FeatureCollection'; features: ChunkPoint[] }
type ParcelFeature = {
  type: 'Feature'
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }
  properties: { chunk_id: string; role?: Role }
}
type Parcels = { type: 'FeatureCollection'; features: ParcelFeature[] }

const EMPTY = { type: 'FeatureCollection' as const, features: [] }

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

function markedParcelsOf(marked: Points, byId: Map<string, ParcelFeature>): Parcels {
  const features: ParcelFeature[] = []
  for (const f of marked.features) {
    const g = byId.get(f.properties.id)
    if (g) features.push({ ...g, properties: { chunk_id: f.properties.id, role: f.properties.role } })
  }
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
const fadeIn = (zoom: number, v: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], zoom, 0, zoom + 0.5, v]

const CSB_STATUS_TEXT: Record<CsbStatus, string> = {
  zoom: 'Zoom in to see field outlines and pick your own field',
  loading: 'Loading field outlines from USDA…',
  ready: 'Click a field outline to analyze it',
  partial: 'Some places show only the first 2,000 fields — zoom in to see all',
  error: 'USDA field outlines did not load. You can still pick a sample dot.',
}

/** 지도를 이 범위로 옮긴다. seq가 바뀔 때마다 한 번 */
/** 지도를 옮긴다. seq가 바뀔 때마다 한 번: bounds면 그 범위에 맞추고, center면 줌은 그대로 두고 옮긴다 */
export type MapFocus =
  | { seq: number; bounds: [[number, number], [number, number]]; padding: PaddingOptions }
  | { seq: number; center: [number, number] }

/** 지도에 번호로 표시하는 비슷한 지역 */
export type RegionPin = { cell: string; rank: number; lat: number; lon: number }

/** 사용자가 고른 실제 밭과 연결된 표본 밭 위치 */
export type PickedOnMap = { geometry: CsbGeometry; from: { lat: number; lon: number }; to: { lat: number; lon: number } }

type Props = {
  chunks: Chunk[]
  crops: CropNames
  /** 기준 청크 (고르기 전이면 null) */
  refId: string | null
  /** 닮은 청크의 상태 (twin / constrained) */
  similar: Map<string, Status>
  regions: RegionPin[]
  activeCell: string | null
  picked: PickedOnMap | null
  onSelect: (id: string) => void
  onSelectRegion: (cell: string) => void
  onPickField: (f: CsbFeature) => void
  focus: MapFocus | null
  /** 검색으로 찾은 자리 (핀 표시) */
  place: { lat: number; lon: number; label: string } | null
  /** 지도에 붙는 팝업들 (지도를 만든 뒤에 그린다) */
  children?: ReactNode
}

export function MapView(props: Props) {
  const { chunks, refId, similar, regions, activeCell, picked, focus, place } = props
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const handlers = useRef(props)
  useEffect(() => {
    handlers.current = props
  })
  const [csbStatus, setCsbStatus] = useState<CsbStatus>('zoom')
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null)

  const marked = useMemo(() => markedOf(chunks, refId, similar), [chunks, refId, similar])
  const markedRef = useRef(marked)
  /** 표본 윤곽선을 읽은 뒤: chunk_id → 윤곽선 */
  const parcelsRef = useRef<Map<string, ParcelFeature> | null>(null)
  const pickedRef = useRef(picked)

  useEffect(() => {
    if (!el.current) return
    const map = new MapLibreMap({
      container: el.current,
      style: BASE_STYLE,
      bounds: boundsOf(chunks),
      fitBoundsOptions: { padding: 20 },
      maxBounds: MAP_BOUNDS,
      // 회전·기울이기는 쓰지 않는다
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
    /** 화면 안 실제 밭: csbid → 밭 (윤곽선이 타일로 잘려도 원래 모양을 쓰려고) */
    let csbById = new Map<string, CsbFeature>()
    const loader = createCsbLoader((features, status) => {
      csbById = new Map(features.map((f) => [f.properties.csbid, f]))
      void map.getSource<GeoJSONSource>(SRC.csb)?.setData({ type: 'FeatureCollection', features })
      setCsbStatus(status)
    })
    const refreshCsb = () => {
      const b = map.getBounds()
      loader.update({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }, map.getZoom())
    }

    map.on('load', () => {
      map.addSource(SRC.all, { type: 'geojson', data: { type: 'FeatureCollection', features: chunks.map((c) => pointOf(c)) } })
      map.addSource(SRC.marked, { type: 'geojson', data: markedRef.current })
      map.addSource(SRC.csb, { type: 'geojson', data: EMPTY })
      map.addSource(SRC.picked, { type: 'geojson', data: EMPTY })
      map.addSource(SRC.link, { type: 'geojson', data: EMPTY })

      // 실제 밭 윤곽선 (확대했을 때만, 위성사진 위에서 잘 보이게 밝은 노란 선)
      map.addLayer({
        id: LAYER.csbFill,
        type: 'fill',
        source: SRC.csb,
        minzoom: CSB_MIN_ZOOM,
        paint: { 'fill-color': '#fff7d6', 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: LAYER.csbLine,
        type: 'line',
        source: SRC.csb,
        minzoom: CSB_MIN_ZOOM,
        paint: { 'line-color': '#ffd54f', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.8] },
      })
      // 고른 실제 밭과 표본 밭까지 잇는 점선
      map.addLayer({
        id: LAYER.pickedFill,
        type: 'fill',
        source: SRC.picked,
        paint: { 'fill-color': PICKED_COLOR, 'fill-opacity': 0.25 },
      })
      map.addLayer({
        id: LAYER.pickedLine,
        type: 'line',
        source: SRC.picked,
        paint: { 'line-color': PICKED_COLOR, 'line-width': 3 },
      })
      map.addLayer({
        id: LAYER.link,
        type: 'line',
        source: SRC.link,
        paint: { 'line-color': PICKED_COLOR, 'line-width': 2, 'line-dasharray': [2, 2] },
      })
      // 표본 점: 그 외 표본은 옅게, 실제 밭 윤곽선이 나오는 줌부터는 숨긴다
      map.addLayer({
        id: LAYER.all,
        type: 'circle',
        source: SRC.all,
        maxzoom: CSB_MIN_ZOOM,
        paint: {
          'circle-radius': 4,
          'circle-color': MAP_COLOR.other,
          'circle-opacity': 0.45,
          'circle-stroke-color': '#333',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.45,
        },
      })
      map.addLayer({
        id: LAYER.similar,
        type: 'circle',
        source: SRC.marked,
        filter: ['!=', ['get', 'role'], 'ref'],
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'role'], 'twin', MAP_COLOR.twin, MAP_COLOR.constrained],
          ...STROKE,
        },
      })
      // 기준 청크(연결된 표본 밭)는 맨 위 층
      map.addLayer({
        id: LAYER.ref,
        type: 'circle',
        source: SRC.marked,
        filter: ['==', ['get', 'role'], 'ref'],
        paint: { 'circle-radius': 9, 'circle-color': MAP_COLOR.ref, ...STROKE },
      })
      setPicked(map, pickedRef.current)

      const sampleAt = (p: { x: number; y: number }) => {
        const id = map.queryRenderedFeatures([p.x, p.y], { layers: POINT_LAYERS })[0]?.properties.id
        return typeof id === 'string' ? byId.get(id) : undefined
      }
      const fieldAt = (p: { x: number; y: number }) => {
        if (map.getZoom() < CSB_MIN_ZOOM) return undefined
        const id = map.queryRenderedFeatures([p.x, p.y], { layers: [LAYER.csbFill] })[0]?.properties.csbid
        return typeof id === 'string' ? csbById.get(id) : undefined
      }
      map.on('mousemove', (e) => {
        const c = sampleAt(e.point)
        const f = c ? undefined : fieldAt(e.point)
        map.getCanvas().style.cursor = c || f ? 'pointer' : ''
        if (c) tip.setLngLat([c.lon, c.lat]).setText(`Sample field ${c.chunk_id} · ${c.state}`).addTo(map)
        else if (f) {
          const p = f.properties
          tip
            .setLngLat(e.lngLat)
            .setText(`Field · ${Math.round(p.csbacres)} acres · 2024: ${cropName(Number(p.cdl2024), handlers.current.crops)} — click to analyze`)
            .addTo(map)
        } else tip.remove()
      })
      map.on('mouseout', () => {
        map.getCanvas().style.cursor = ''
        tip.remove()
      })
      map.on('click', (e) => {
        const c = sampleAt(e.point)
        if (c) return handlers.current.onSelect(c.chunk_id)
        const f = fieldAt(e.point)
        if (f) handlers.current.onPickField(f)
      })

      // 표본 윤곽선: 확대해 가면 한 번 받아 둔다 (기준 청크·닮은 청크 강조용)
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
            map.addSource(SRC.markedParcels, { type: 'geojson', data: markedParcelsOf(markedRef.current, byChunk) })
            const notRef = ['!=', ['get', 'role'], 'ref']
            const isRef = ['==', ['get', 'role'], 'ref']
            const add = (layer: object) => map.addLayer({ source: SRC.markedParcels, minzoom: PARCEL_ZOOM, ...layer } as never, LAYER.pickedFill)
            add({
              id: LAYER.parcelSimilarFill,
              type: 'fill',
              filter: notRef,
              paint: {
                'fill-color': ['match', ['get', 'role'], 'twin', MAP_COLOR.twin, MAP_COLOR.constrained],
                'fill-opacity': fadeIn(PARCEL_ZOOM, 0.55),
              },
            })
            add({ id: LAYER.parcelSimilarLine, type: 'line', filter: notRef, paint: { 'line-color': '#1b1b1b', 'line-width': 1.5 } })
            add({ id: LAYER.parcelRefFill, type: 'fill', filter: isRef, paint: { 'fill-color': MAP_COLOR.ref, 'fill-opacity': fadeIn(PARCEL_ZOOM, 0.55) } })
            add({ id: LAYER.parcelRefLine, type: 'line', filter: isRef, paint: { 'line-color': '#6d0000', 'line-width': 2.5 } })
            parcelState = 'done'
          })
          .catch((err: unknown) => {
            console.warn('표본 윤곽선을 읽지 못했다', err)
            parcelState = 'none' // 다음 확대 때 다시 시도
          })
      }
      map.on('zoom', loadParcels)
      loadParcels()
      map.on('moveend', refreshCsb)
      refreshCsb()
    })

    mapRef.current = map
    setMapInstance(map)
    return () => {
      setMapInstance(null)
      loader.destroy()
      tip.remove()
      map.remove()
      mapRef.current = null
    }
  }, [chunks])

  // 선택이 바뀌면 작은 소스(기준 + 닮은 청크)만 바꾼다. 표본 전체 소스는 그대로 둔다.
  useEffect(() => {
    markedRef.current = marked
    const map = mapRef.current
    void map?.getSource<GeoJSONSource>(SRC.marked)?.setData(marked)
    if (parcelsRef.current)
      void map?.getSource<GeoJSONSource>(SRC.markedParcels)?.setData(markedParcelsOf(marked, parcelsRef.current))
  }, [marked])

  // 고른 실제 밭과 연결선
  useEffect(() => {
    pickedRef.current = picked
    if (mapRef.current) setPicked(mapRef.current, picked)
  }, [picked])

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
        handlers.current.onSelectRegion(r.cell)
      })
      return new Marker({ element: b }).setLngLat([r.lon, r.lat]).addTo(map)
    })
    return () => pins.forEach((m) => m.remove())
  }, [regions, activeCell, chunks])

  // 검색 결과로 옮기기: 찾은 자리와 가장 가까운 표본 밭이 같이 보이게 (여백은 패널 자리)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    // 오른쪽 칸이 막 나와 지도 칸이 좁아졌을 수 있으니 크기를 먼저 맞춘다
    map.resize()
    if ('center' in focus) map.easeTo({ center: focus.center, duration: 800 })
    else map.fitBounds(focus.bounds, { padding: focus.padding, maxZoom: 12, duration: 1200 })
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
      {/* 지도 칸 아래 가운데: 윤곽선 안내 위에 범례 (좁은 지도에서도 겹치지 않게 쌓는다) */}
      <div className="map-bottom">
        <div className={`map-status ${csbStatus}`} role="status">
          {CSB_STATUS_TEXT[csbStatus]}
        </div>
        <Legend />
      </div>
      {mapInstance && <MapInstanceContext.Provider value={mapInstance}>{props.children}</MapInstanceContext.Provider>}
    </div>
  )
}

function setPicked(map: MapLibreMap, picked: PickedOnMap | null) {
  const area = map.getSource<GeoJSONSource>(SRC.picked)
  const link = map.getSource<GeoJSONSource>(SRC.link)
  if (!area || !link) return
  if (!picked) {
    void area.setData(EMPTY)
    void link.setData(EMPTY)
    return
  }
  void area.setData({ type: 'Feature', geometry: picked.geometry, properties: {} } as never)
  void link.setData({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [picked.from.lon, picked.from.lat],
        [picked.to.lon, picked.to.lat],
      ],
    },
    properties: {},
  })
}
