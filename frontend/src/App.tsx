import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapView, type RegionPin } from './components/MapView'
import { loadData } from './data'
import { findSimilar, groupRegions, type Chunk, type CropNames, type Status } from './engine'
import { PanelHost } from './panels/PanelHost'
import { usePanels } from './panels/context'
import { AppStateContext, IDLE_SEARCH, type AppActions, type AppState, type SearchState } from './state'
import { Legend } from './views/Legend'
import { MAIN_PANELS, mainPanelOptions } from './views/panels'
import { Toolbar } from './views/Toolbar'

type Data = { chunks: Chunk[]; crops: CropNames }

export default function App() {
  const { open, wasClosed } = usePanels()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refId, setRefId] = useState<string | null>(null)
  const [shifted, setShifted] = useState(false)
  const [cell, setCell] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [search, setSearch] = useState<SearchState>(IDLE_SEARCH)

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

  const selectChunk = useCallback((id: string) => {
    setRefId(id)
    setCell(null)
    setCompareId(null)
    setSearch(IDLE_SEARCH)
  }, [])
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
        setRefId(null)
        setCell(null)
        setCompareId(null)
        setSearch(IDLE_SEARCH)
      },
      setShifted,
      selectRegion,
      setCompare: setCompareId,
      search: () => {},
    }),
    [selectChunk, selectRegion],
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
      />
      <Toolbar />
      <PanelHost />
      <Legend />
    </AppStateContext.Provider>
  )
}
