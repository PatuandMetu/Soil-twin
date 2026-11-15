import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapView, type MapFocus, type PickedOnMap, type RegionPin } from './components/MapView'
import { cellIdOf, centroidOf, cropsOf, stateOfFips, type CsbFeature } from './csb'
import { loadData } from './data'
import { findSimilar, groupRegions, type Chunk, type CropNames, type Status } from './engine'
import { geocode, inMainland, nearestSample, parseCoords } from './search'
import {
  AppStateContext,
  IDLE_SEARCH,
  type AppActions,
  type AppState,
  type PickedField,
  type SearchState,
} from './state'
import { km } from './text'
import { SideColumns } from './views/panels'
import { Toolbar } from './views/Toolbar'

type Data = { chunks: Chunk[]; crops: CropNames }

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refId, setRefId] = useState<string | null>(null)
  const [shifted, setShifted] = useState(false)
  const [cell, setCell] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [search, setSearch] = useState<SearchState>(IDLE_SEARCH)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [picked, setPicked] = useState<PickedField | null>(null)

  useEffect(() => {
    loadData()
      .then((d) => setData({ chunks: d.chunks, crops: d.crops }))
      .catch((e: unknown) => setError(String(e)))
  }, [])

  const ref = useMemo(() => data?.chunks.find((c) => c.chunk_id === refId) ?? null, [data, refId])
  const result = useMemo(
    () => (data && ref ? findSimilar(ref, data.chunks, shifted, data.crops) : null),
    [data, ref, shifted],
  )
  const regions = useMemo(() => (ref && result ? groupRegions(ref, result.similar) : []), [ref, result])
  const region = regions.find((r) => r.cell === cell) ?? regions[0] ?? null
  const similarStatus = useMemo(
    () => new Map<string, Status>(result?.similar.map((s) => [s.chunk.chunk_id, s.score.status]) ?? []),
    [result],
  )
  const pins = useMemo<RegionPin[]>(() => regions.map(({ cell, rank, lat, lon }) => ({ cell, rank, lat, lon })), [regions])

  const pick = useCallback((id: string | null) => {
    setRefId(id)
    setCell(null)
    setCompareId(null)
    setPicked(null)
  }, [])
  const selectChunk = useCallback(
    (id: string) => {
      pick(id)
      setSearch(IDLE_SEARCH)
    },
    [pick],
  )

  /** 지도에서 실제 밭을 고르면: 밭 중심에서 가장 가까운 표본 밭을 기준 청크로 삼는다 */
  const pickField = useCallback(
    (f: CsbFeature) => {
      if (!data) return
      const c = centroidOf(f.geometry)
      const near = nearestSample(data.chunks, c)
      if (!near) return
      const cell = cellIdOf(c.lat, c.lon)
      pick(near.chunk.chunk_id)
      setSearch(IDLE_SEARCH)
      setPicked({
        csbid: String(f.properties.csbid),
        acres: Number(f.properties.csbacres),
        state: stateOfFips(f.properties.statefips),
        crops: cropsOf(f.properties),
        geometry: f.geometry,
        lat: c.lat,
        lon: c.lon,
        cell,
        sampleId: near.chunk.chunk_id,
        sampleKm: near.km,
        sameCell: near.sameCell,
      })
    },
    [data, pick],
  )
  const pickedOnMap = useMemo<PickedOnMap | null>(
    () => (picked && ref ? { geometry: picked.geometry, from: { lat: picked.lat, lon: picked.lon }, to: { lat: ref.lat, lon: ref.lon } } : null),
    [picked, ref],
  )

  /** 내 밭 검색: 좌표면 바로, 아니면 Nominatim. 가장 가까운 표본 밭을 기준 청크로 */
  const chunks = data?.chunks
  const runSearch = useCallback(
    async (query: string) => {
      const q = query.trim()
      if (!q || !chunks) return
      const fail = (message: string) => setSearch({ ...IDLE_SEARCH, message, tone: 'error' })
      setSearch({ ...IDLE_SEARCH, busy: true, message: 'Searching…' })
      let place: { lat: number; lon: number; label: string } | undefined
      const coords = parseCoords(q)
      if (coords) place = { ...coords, label: `${coords.lat}, ${coords.lon}` }
      else {
        try {
          const hits = await geocode(q)
          place = hits.find(inMainland)
          if (!place) return fail(hits.length ? `“${q}” is outside the continental U.S.` : `No place found for “${q}”.`)
        } catch {
          return fail('Search failed. Check your connection and try again.')
        }
      }
      if (!inMainland(place)) return fail('That point is outside the continental U.S.')
      const near = nearestSample(chunks, place)
      if (!near) return fail('No sample fields loaded.')
      pick(near.chunk.chunk_id)
      setSearch({
        busy: false,
        message: `Nearest sample field: ${km(near.km)} away`,
        tone: 'info',
        place: { ...place, nearestKm: near.km },
      })
      // 지도 칸에는 오른쪽 칸들이 겹치지 않는다. 위는 도구줄·검색 말풍선, 아래는 범례 자리만 비운다
      setFocus((f) => ({
        seq: (f?.seq ?? 0) + 1,
        padding: { top: 150, bottom: 130, left: 40, right: 40 },
        bounds: [
          [Math.min(place.lon, near.chunk.lon), Math.min(place.lat, near.chunk.lat)],
          [Math.max(place.lon, near.chunk.lon), Math.max(place.lat, near.chunk.lat)],
        ],
      }))
    },
    [chunks, pick],
  )
  const selectRegion = useCallback((c: string) => {
    setCell(c)
    setCompareId(null)
  }, [])
  const actions = useMemo<AppActions>(
    () => ({
      selectChunk,
      clearRef: () => {
        pick(null)
        setSearch(IDLE_SEARCH)
      },
      setShifted,
      selectRegion,
      setCompare: setCompareId,
      search: (q) => void runSearch(q),
      dismissSearch: () => setSearch((x) => ({ ...x, message: null })),
    }),
    [pick, selectChunk, selectRegion, runSearch],
  )

  const state = useMemo<AppState | null>(
    () =>
      data && {
        chunks: data.chunks,
        crops: data.crops,
        ref,
        shifted,
        result,
        regions,
        region,
        compareId,
        search,
        picked,
        actions,
      },
    [data, ref, shifted, result, regions, region, compareId, search, picked, actions],
  )

  if (error) return <p className="status">Could not load the data: {error}</p>
  if (!state || !data) return <p className="status">Loading…</p>

  return (
    <AppStateContext.Provider value={state}>
      <MapView
        chunks={data.chunks}
        crops={data.crops}
        refId={ref?.chunk_id ?? null}
        similar={similarStatus}
        regions={pins}
        activeCell={region?.cell ?? null}
        onSelect={selectChunk}
        onSelectRegion={selectRegion}
        onPickField={pickField}
        picked={pickedOnMap}
        focus={focus}
        place={search.place}
      />
      <Toolbar />
      <SideColumns />
    </AppStateContext.Provider>
  )
}
