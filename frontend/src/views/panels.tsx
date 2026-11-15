import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { dragDetailMapEdge, dragMapEdge, dragMiddleEdge, fitColumns, parseColumns, type ColWidths } from '../columns'
import { useAppState } from '../state'
import { AreasView } from './AreasView'
import { DetailView } from './DetailView'

const STORAGE_KEY = 'magicmap.columns.v1'
const KEY_STEP = 16

/** 끈 너비를 CSS 변수로 (null이면 기본 clamp 너비). 지도 칸은 --sidebar-w를 보고 따라 줄어든다 */
function applyWidths(w: ColWidths | null) {
  const s = document.documentElement.style
  if (w) {
    s.setProperty('--info-w', `${w.info}px`)
    s.setProperty('--detail-w', `${w.detail}px`)
  } else {
    s.removeProperty('--info-w')
    s.removeProperty('--detail-w')
  }
}

function load(): ColWidths | null {
  try {
    return parseColumns(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function save(w: ColWidths | null) {
  try {
    if (w) localStorage.setItem(STORAGE_KEY, JSON.stringify(w))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 저장이 막혀도 이번 화면에서는 그대로 동작한다
  }
}

type Edge = 'map' | 'middle' | 'detail-map'

const defaultInfoW = () => Math.min(400, Math.max(320, Math.round(window.innerWidth * 0.25)))
const defaultDetailW = () => Math.min(480, Math.max(380, Math.round(window.innerWidth * 0.25)))

/**
 * 화면 3분할의 오른쪽 두 칸: Land Info | Comparison. 둘 다 위아래를 채우고 각자 스크롤한다.
 * 기본 너비는 CSS --info-w, --detail-w (지도:Info:Comparison ≈ 2:1:1). 칸 왼쪽 경계를 끌어 바꾸고,
 * 더블클릭하면 기본 너비로 돌아간다. 바꾼 너비는 저장한다.
 * Land Info는 오른쪽 가장자리로 접고 펼칠 수 있고, Comparison은 ✕로 닫고 지역을 고르거나 버튼으로 다시 연다.
 */
export function SideColumns() {
  const { regionPopups } = useAppState()
  const root = useRef<HTMLDivElement>(null)
  const infoCol = useRef<HTMLElement>(null)
  const detailCol = useRef<HTMLElement>(null)
  const [widths, setWidths] = useState<ColWidths | null>(load)
  const [dragging, setDragging] = useState<Edge | null>(null)
  const [infoCollapsed, setInfoCollapsed] = useState(false)
  const [detailOpen, setDetailOpen] = useState(true)

  // 지역(목록·지도 핀)을 고르면 닫혀 있던 Comparison을 다시 연다
  const raisedSeq = regionPopups.raised?.seq
  const [prevRaisedSeq, setPrevRaisedSeq] = useState(raisedSeq)
  if (raisedSeq !== prevRaisedSeq) {
    setPrevRaisedSeq(raisedSeq)
    if (raisedSeq !== undefined && !detailOpen) setDetailOpen(true)
  }

  useLayoutEffect(() => applyWidths(widths), [widths])

  useLayoutEffect(() => {
    const cl = document.documentElement.classList
    cl.toggle('info-collapsed', infoCollapsed)
    cl.toggle('detail-closed', !detailOpen)
    return () => {
      cl.remove('info-collapsed', 'detail-closed')
    }
  }, [infoCollapsed, detailOpen])

  // 창이 좁아지면 지도 최소 폭을 지키게 줄인다
  useEffect(() => {
    if (!widths) return
    const onResize = () => {
      const next = fitColumns(widths, window.innerWidth)
      if (next.info !== widths.info || next.detail !== widths.detail) setWidths(next)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [widths])

  /** 지금 화면에 그려진 너비 (접히거나 닫힌 칸은 저장값 또는 기본 너비) */
  const current = (): ColWidths => ({
    info: infoCol.current ? infoCol.current.getBoundingClientRect().width : (widths?.info ?? defaultInfoW()),
    detail: detailCol.current ? detailCol.current.getBoundingClientRect().width : (widths?.detail ?? defaultDetailW()),
  })
  const next = (edge: Edge, start: ColWidths, dx: number) =>
    edge === 'map'
      ? dragMapEdge(start, dx, window.innerWidth)
      : edge === 'detail-map'
        ? dragDetailMapEdge(start, dx, window.innerWidth)
        : dragMiddleEdge(start, dx)
  const commit = (w: ColWidths) => {
    const r = { info: Math.round(w.info), detail: Math.round(w.detail) }
    setWidths(r)
    save(r)
  }

  const startDrag = (edge: Edge) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const start = current()
    let last = start
    setDragging(edge)
    // 끄는 동안은 CSS 변수만 바꾼다 (React 다시 그리기 없이)
    const move = (ev: globalThis.PointerEvent) => {
      last = next(edge, start, ev.clientX - sx)
      applyWidths(last)
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      setDragging(null)
      commit(last)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  const onKey = (edge: Edge) => (e: KeyboardEvent<HTMLDivElement>) => {
    const dx = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0
    if (!dx) return
    e.preventDefault()
    commit(next(edge, current(), dx))
  }

  const reset = () => {
    setWidths(null)
    save(null)
  }

  const resizer = (edge: Edge, label: string) => (
    <div
      className={`col-resizer${dragging === edge ? ' active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      tabIndex={0}
      onPointerDown={startDrag(edge)}
      onKeyDown={onKey(edge)}
      onDoubleClick={reset}
    />
  )

  return (
    <div ref={root} className={`side-cols${dragging ? ' resizing' : ''}`}>
      <button
        type="button"
        className="side-fold-tab"
        aria-expanded={!infoCollapsed}
        aria-label={infoCollapsed ? 'Expand Land Info' : 'Collapse Land Info'}
        title={infoCollapsed ? 'Expand Land Info' : 'Collapse Land Info'}
        onClick={() => setInfoCollapsed((v) => !v)}
      >
        {infoCollapsed ? '◂' : '▸'}
      </button>
      {!infoCollapsed && (
        <section ref={infoCol} className="side-col info-col" aria-label="Land Info">
          {resizer('map', 'Resize map and Land Info')}
          <div className="side-head">
            <h2 className="side-title">Land Info</h2>
            {!detailOpen && (
              <button
                type="button"
                className="pop-btn"
                onClick={() => setDetailOpen(true)}
                title="Open Comparison"
              >
                Comparison
              </button>
            )}
          </div>
          <div className="fp-body side-body">
            <AreasView />
          </div>
        </section>
      )}
      {detailOpen && (
        <section ref={detailCol} className="side-col detail-col" aria-label="Comparison">
          {infoCollapsed
            ? resizer('detail-map', 'Resize map and Comparison')
            : resizer('middle', 'Resize Land Info and Comparison')}
          <div className="side-head">
            <h2 className="side-title">Comparison</h2>
            <button
              type="button"
              className="fp-btn"
              aria-label="Close Comparison"
              title="Close Comparison"
              onClick={() => setDetailOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="fp-body side-body">
            <DetailView />
          </div>
        </section>
      )}
    </div>
  )
}
