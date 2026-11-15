import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapFocus, type RegionPin } from './components/MapView'
import { loadData } from './data'
import { findSimilar, groupRegions, type Chunk, type CropNames, type Status } from './engine'
import { PanelHost } from './panels/PanelHost'
import { geocode, inMainland, nearestChunk, parseCoords } from './search'
import { usePanels } from './panels/context'
import { freePadding } from './panels/geometry'
import { AppStateContext, IDLE_SEARCH, type AppActions, type AppState, type SearchState } from './state'
import { km } from './text'
import { Legend } from './views/Legend'
import { MAIN_PANELS, mainPanelOptions } from './views/panels'
import { Toolbar } from './views/Toolbar'

type Data = { chunks: Chunk[]; crops: CropNames }

export default function App() {
  const { open, wasClosed, panels } = usePanels()
  // 검색으로 지도를 옮길 때 패널 자리를 비우려고 최신 패널 위치를 들고 있는다
  const panelRects = useRef(panels)
  useEffect(() => {
    panelRects.current = panels
  }, [panels])
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refId, setRefId] = useState<string | null>(null)
  const [shifted, setShifted] = useState(false)
  const [cell, setCell] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [search, setSearch] = useState<SearchState>(IDLE_SEARCH)
  const [focus, setFocus] = useState<MapFocus | null>(null)

  useEffect(() => {
    loadData()
      .then((d) => setData({ chunks: d.chunks, crops: d.crops }))
      .catch((e: unknown) => setError(String(e)))
  }, [])

  // 처음: 지난번에 닫아 두지 않은 기본 패널을 연다
  useEffect(() => {
    if (!data) return
    for (const id of MAIN_PANELS) if (!wasClosed(id)) open(id, mainPanelOptions(id, window.innerWidth, window.innerHeight))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 데이터가 처음 왔을 때 한 번만
  }, [data])

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
  }, [])
  const selectChunk = useCallback(
    (id: string) => {
      pick(id)
      setSearch(IDLE_SEARCH)
    },
    [pick],
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
      const near = nearestChunk(chunks, place)
      if (!near) return fail('No sample fields loaded.')
      pick(near.chunk.chunk_id)
      setSearch({
        busy: false,
        message: `Nearest sample field: ${km(near.km)} away`,
        tone: 'info',
        place: { ...place, nearestKm: near.km },
      })
      const padding = freePadding(
        panelRects.current.filter((p) => !p.collapsed).map((p) => p.rect),
        window.innerWidth,
        window.innerHeight,
        { top: 110, bottom: 60, left: 40, right: 40 },
      )
      setFocus((f) => ({
        seq: (f?.seq ?? 0) + 1,
        padding,
        bounds: [
          [Math.min(place.lon, near.chunk.lon), Math.min(place.lat, near.chunk.lat)],
          [Math.max(place.lon, near.chunk.lon), Math.max(place.lat, near.chunk.lat)],
        ],
      }))
    },
    [chunks, pick],
  )
  const selectRegion = useCallback(
    (c: string) => {
      setCell(c)
      setCompareId(null)
      open('detail', mainPanelOptions('detail', window.innerWidth, window.innerHeight))
    },
    [open],
  )
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
        actions,
      },
    [data, ref, shifted, result, regions, region, compareId, search, actions],
  )

  if (error) return <p className="status">Could not load the data: {error}</p>
  if (!state || !data) return <p className="status">Loading…</p>

  return (
    <AppStateContext.Provider value={state}>
      <MapView
        chunks={data.chunks}
        refId={ref?.chunk_id ?? null}
        similar={similarStatus}
        regions={pins}
        activeCell={region?.cell ?? null}
        onSelect={selectChunk}
        onSelectRegion={selectRegion}
        focus={focus}
        place={search.place}
      />
      <Toolbar />
      <PanelHost />
      <Legend />
    </AppStateContext.Provider>
  )
}
