import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clampRect, resizeRect, type Corner, type Rect, type Size } from './geometry'

type Props = {
  id: string
  title: string
  rect: Rect
  min: Size
  collapsed: boolean
  z: number
  onFocus: (id: string) => void
  onClose: (id: string) => void
  onToggleCollapse: (id: string) => void
  /** 옮기기·늘리기가 끝났을 때 한 번 */
  onRect: (id: string, rect: Rect) => void
  children: ReactNode
}

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

/**
 * 떠 있는 패널 틀. 제목줄을 끌어 옮기고, 누르면 맨 위로, ▾로 접고, ✕로 닫고,
 * 모서리를 끌어 늘린다(기본 크기보다 작게는 못 줄임). 내용이 넘치면 패널 안에서 스크롤.
 */
export function FloatingPanel(p: Props) {
  // 끄는 동안의 위치·크기. 이 패널만 다시 그리고, 끝나면 onRect로 넘긴다
  const [draft, setDraft] = useState<Rect | null>(null)
  const r = draft ?? p.rect

  const startDrag = (e: ReactPointerEvent<HTMLElement>, mode: 'move' | Corner) => {
    if (e.button !== 0) return
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    p.onFocus(p.id)
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const start = p.rect
    let last = start
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      const vw = window.innerWidth
      const vh = window.innerHeight
      last =
        mode === 'move'
          ? clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh, p.collapsed)
          : resizeRect(start, dx, dy, mode, p.min, vw, vh)
      setDraft(last)
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      setDraft(null)
      if (last !== start) p.onRect(p.id, last)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  return (
    <section
      className={`fp${p.collapsed ? ' fp-collapsed' : ''}`}
      style={{ left: r.x, top: r.y, width: r.w, height: p.collapsed ? undefined : r.h, zIndex: p.z }}
      onPointerDownCapture={() => p.onFocus(p.id)}
      aria-label={p.title}
    >
      <header className="fp-title" onPointerDown={(e) => startDrag(e, 'move')}>
        <span className="fp-name">{p.title}</span>
        <button
          type="button"
          className="fp-btn"
          onClick={() => p.onToggleCollapse(p.id)}
          aria-label={p.collapsed ? `Expand ${p.title}` : `Collapse ${p.title}`}
          aria-expanded={!p.collapsed}
          title={p.collapsed ? 'Expand' : 'Collapse'}
        >
          {p.collapsed ? '▸' : '▾'}
        </button>
        <button type="button" className="fp-btn" onClick={() => p.onClose(p.id)} aria-label={`Close ${p.title}`} title="Close">
          ✕
        </button>
      </header>
      {!p.collapsed && <div className="fp-body">{p.children}</div>}
      {!p.collapsed &&
        CORNERS.map((c) => <div key={c} className={`fp-grip fp-grip-${c}`} onPointerDown={(e) => startDrag(e, c)} />)}
    </section>
  )
}
