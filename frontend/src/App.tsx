import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { MapView, type MapFocus, type PickedOnMap, type RegionPin } from './components/MapView'
import { cellIdOf, centroidOf, cropsOf, stateOfFips, type CsbFeature } from './csb'
import { loadData } from './data'
import { findSimilar, groupRegions, type Chunk, type CropNames, type Status } from './engine'
import { geocode, inMainland, nearestSample, parseCoords } from './search'
import {
  AppStateContext,
  IDLE_SEARCH,
  NO_REGION_POPUPS,
  type AppActions,
  type AppState,
  type PickedField,
  type RegionPopupState,
  type SearchState,
} from './state'
import { km } from './text'
import { SideColumns } from './views/panels'
import { FieldPopup, RegionPopups } from './views/MapPopups'
import { Toolbar } from './views/Toolbar'

type Data = { chunks: Chunk[]; crops: CropNames }

/** 지역으로 옮길 때 이보다 멀면 여기까지 들어간다 (지역 밭들이 점으로 보이는 정도) */
const REGION_ZOOM = 7
/** 검색한 자리로 옮길 때 이보다 멀면 여기까지 들어간다 (실제 밭 윤곽선이 바로 보이는 줌) */
const SEARCH_ZOOM = 13

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refId, setRefId] = useState<string | null>(null)
  const [shifted, setShifted] = useState(false)
  const [cell, setCell] = useState<string | null>(null)
  const [regionPopups, setRegionPopups] = useState<RegionPopupState>(NO_REGION_POPUPS)
  const [search, setSearch] = useState<SearchState>(IDLE_SEARCH)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [picked, setPicked] = useState<PickedField | null>(null)

  useEffect(() => {
    loadData()
      .then((d) => setData({ chunks: d.chunks, crops: d.crops }))
      .catch((e: unknown) => setError(String(e)))
  }, [])

  const ref = useMemo(() => data?.chunks.find((c) => c.chunk_id === refId) ?? null, [data, refId])
  // 밭을 고르면 오른쪽 칸이 나온다 (지도 폭은 CSS --side로 줄어든다). 지도 맞추기보다 먼저 바꾸려고 layout effect
  const sideOpen = ref !== null
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('side-open', sideOpen)
  }, [sideOpen])
  const result = useMemo(
    () => (data && ref ? findSimilar(ref, data.chunks, shifted, data.crops) : null),
    [data, ref, shifted],
  )
  const otherResult = useMemo(
    () => (data && ref ? findSimilar(ref, data.chunks, !shifted, data.crops) : null),
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
        place: { ...place, nearestKm: near.km, sameCell: near.sameCell },
      })
      setFocus((f) => ({ seq: (f?.seq ?? 0) + 1, center: [place.lon, place.lat], minZoom: SEARCH_ZOOM }))
    },
    [chunks, pick],
  )
  const selectRegion = useCallback((c: string) => {
    setCell(c)
    // 떠 있는 팝업을 그 지역으로 옮긴다 (이미 고정한 지역이면 그 팝업을 맨 위로)
    setRegionPopups((p) => ({
      floating: p.pinned.includes(c) ? p.floating : c,
      pinned: p.pinned,
      raised: { cell: c, seq: (p.raised?.seq ?? 0) + 1 },
    }))
  }, [])
  const showRegionOnMap = useCallback(
    (c: string) => {
      const r = regions.find((x) => x.cell === c)
      if (!r) return
      selectRegion(c)
      setFocus((f) => ({ seq: (f?.seq ?? 0) + 1, center: [r.lon, r.lat], minZoom: REGION_ZOOM }))
    },
    [regions, selectRegion],
  )
  const actions = useMemo<AppActions>(
    () => ({
      selectChunk,
      clearRef: () => {
        pick(null)
        setSearch(IDLE_SEARCH)
        setRegionPopups(NO_REGION_POPUPS)
      },
      setShifted,
      selectRegion,
      showRegionOnMap,
      pinRegionPopup: (c) =>
        setRegionPopups((p) => ({ ...p, pinned: p.pinned.includes(c) ? p.pinned : [...p.pinned, c], floating: p.floating === c ? null : p.floating })),
      closeRegionPopup: (c) =>
        setRegionPopups((p) => ({ ...p, pinned: p.pinned.filter((x) => x !== c), floating: p.floating === c ? null : p.floating })),
      search: (q) => void runSearch(q),
      dismissSearch: () => setSearch((x) => ({ ...x, message: null })),
    }),
    [pick, selectChunk, selectRegion, showRegionOnMap, runSearch],
  )

  const state = useMemo<AppState | null>(
    () =>
      data && {
        chunks: data.chunks,
        crops: data.crops,
        ref,
        shifted,
        result,
        otherResult,
        regions,
        region,
        regionPopups,
        search,
        picked,
        actions,
      },
    [data, ref, shifted, result, otherResult, regions, region, regionPopups, search, picked, actions],
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
      >
        <FieldPopup />
        <RegionPopups />
      </MapView>
      <Toolbar />
      {sideOpen && <SideColumns />}
    </AppStateContext.Provider>
  )
}
