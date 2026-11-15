import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CLIMATE_KEYS, CROP_KEYS, findSimilar, groupRegions, type Chunk, type CropNames } from '../engine'
import { AppStateContext, IDLE_SEARCH, NO_REGION_POPUPS, type AppActions, type AppState, type PickedField } from '../state'
import { AreasView } from './AreasView'
import { DetailView } from './DetailView'
import { SideColumns } from './panels'

const CROPS: CropNames = { '1': 'Corn', '5': 'Soybeans' }

function makeChunk(id: string, over: Partial<Chunk> = {}): Chunk {
  const base: Record<string, number | string> = {
    chunk_id: id,
    lat: 42,
    lon: -93,
    state: 'IA',
    climate_cell: 'C_+42.00_-093.125',
    acres: 100,
    sand: 30,
    silt: 50,
    clay: 20,
    aws_mm: 200,
    drainage: 3,
    flood: 0,
    ph: 6.5,
    om: 3,
    cec: 20,
    ec: 0.5,
    slope: 2,
    bedrock_cm: 200,
  }
  for (const k of CLIMATE_KEYS) {
    base[k] = 15
    base[`s_${k}`] = 16
  }
  CROP_KEYS.forEach((k, i) => (base[k] = i % 2 === 0 ? 1 : 5))
  return { ...(base as Chunk), ...over }
}

const NOOP_ACTIONS: AppActions = {
  selectChunk: () => {},
  clearRef: () => {},
  setShifted: () => {},
  selectRegion: () => {},
  showRegionOnMap: () => {},
  pinRegionPopup: () => {},
  closeRegionPopup: () => {},
  search: () => {},
  dismissSearch: () => {},
}

function makeState(over: Partial<AppState> = {}): AppState {
  const ref = makeChunk('ref')
  const cand = makeChunk('cand', { lat: 40, lon: -93, climate_cell: 'C_+40.00_-093.125' })
  const chunks = [ref, cand]
  const result = findSimilar(ref, chunks, false, CROPS)
  const regions = groupRegions(ref, result.similar)
  return {
    chunks,
    crops: CROPS,
    ref,
    shifted: false,
    result,
    otherResult: result,
    regions,
    region: regions[0] ?? null,
    regionPopups: NO_REGION_POPUPS,
    search: IDLE_SEARCH,
    picked: null,
    actions: NOOP_ACTIONS,
    ...over,
  }
}

function makePicked(sampleKm: number, sameCell = true): PickedField {
  return {
    csbid: '190001',
    acres: 80,
    state: 'IA',
    crops: [1, 5, 1, 5, 1, 5, 1, 5],
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-93, 42],
          [-92.99, 42],
          [-92.99, 42.01],
          [-93, 42.01],
          [-93, 42],
        ],
      ],
    },
    lat: 42.005,
    lon: -92.995,
    cell: 'C_+42.00_-093.125',
    sampleId: 'ref',
    sampleKm,
    sameCell,
  }
}

const SOIL_NOTE = 'This demo links pre-sampled fields rather than querying soil live, so soil at your field may differ.'
const CLIMATE_WARN = 'No sample field in this climate area — results are less reliable.'

describe('표본 밭 거리·기후 칸 안내', () => {
  it('AreasView: 고른 실제 밭이 10 km를 넘으면 표본 토양 안내를 띄운다', () => {
    const nearHtml = renderToStaticMarkup(
      <AppStateContext.Provider value={makeState({ picked: makePicked(8, true) })}>
        <AreasView />
      </AppStateContext.Provider>,
    )
    expect(nearHtml).not.toContain(SOIL_NOTE)

    const farHtml = renderToStaticMarkup(
      <AppStateContext.Provider value={makeState({ picked: makePicked(12, true) })}>
        <AreasView />
      </AppStateContext.Provider>,
    )
    expect(farHtml).toContain(SOIL_NOTE)
  })

  it('AreasView: 검색 위치가 10 km 초과·다른 기후 칸일 때 각각 안내를 띄운다', () => {
    const nearSameHtml = renderToStaticMarkup(
      <AppStateContext.Provider
        value={makeState({
          search: {
            ...IDLE_SEARCH,
            place: { lat: 42, lon: -93, label: 'Ames, Iowa', nearestKm: 5, sameCell: true },
          },
        })}
      >
        <AreasView />
      </AppStateContext.Provider>,
    )
    expect(nearSameHtml).not.toContain(SOIL_NOTE)
    expect(nearSameHtml).not.toContain(CLIMATE_WARN)

    const farDiffHtml = renderToStaticMarkup(
      <AppStateContext.Provider
        value={makeState({
          search: {
            ...IDLE_SEARCH,
            place: { lat: 42, lon: -93, label: 'Ames, Iowa', nearestKm: 15, sameCell: false },
          },
        })}
      >
        <AreasView />
      </AppStateContext.Provider>,
    )
    expect(farDiffHtml).toContain(SOIL_NOTE)
    expect(farDiffHtml).toContain(CLIMATE_WARN)
  })

  it('DetailView: 고른 실제 밭이 10 km를 넘으면 표본 토양 안내를 덧붙인다', () => {
    const nearHtml = renderToStaticMarkup(
      <AppStateContext.Provider value={makeState({ picked: makePicked(6, true) })}>
        <DetailView />
      </AppStateContext.Provider>,
    )
    expect(nearHtml).not.toContain(SOIL_NOTE)

    const farHtml = renderToStaticMarkup(
      <AppStateContext.Provider value={makeState({ picked: makePicked(14, false) })}>
        <DetailView />
      </AppStateContext.Provider>,
    )
    expect(farHtml).toContain(SOIL_NOTE)
    expect(farHtml).toContain('It is in a different climate area, so results are less reliable.')
  })

  it('DetailView: 지역 윤작 상위 목록과 Show fields on the map 버튼을 그린다', () => {
    const html = renderToStaticMarkup(
      <AppStateContext.Provider value={makeState()}>
        <DetailView />
      </AppStateContext.Provider>,
    )
    expect(html).toContain('Show fields on the map')
    expect(html).toContain('Rotations in this area')
    expect(html).toContain('Corn + Soybeans')
    expect(html).toContain('same as yours')
    expect(html).toContain('Choices, not proof they worked.')
  })

  it('SideColumns: Land Info 접기 버튼과 Comparison 닫기 버튼을 함께 그린다', () => {
    const html = renderToStaticMarkup(
      <AppStateContext.Provider value={makeState()}>
        <SideColumns />
      </AppStateContext.Provider>,
    )
    expect(html).toContain('aria-label="Collapse Land Info"')
    expect(html).toContain('aria-label="Close Comparison"')
  })
})
