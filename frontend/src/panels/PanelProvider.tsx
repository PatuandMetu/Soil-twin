import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PanelsContext, type OpenOptions, type Panel, type PanelsApi } from './context'
import { DEFAULT_SIZE, cascadeFrom, clampRect, restoreRect, type Rect } from './geometry'

type Saved = Partial<Rect> & { collapsed?: boolean; open?: boolean }

const STORAGE_KEY = 'fieldshift.panels.v1'

function readSaved(): Record<string, Saved> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, Saved>) : {}
  } catch {
    return {}
  }
}

function writeSaved(saved: Record<string, Saved>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // 저장이 막힌 브라우저에서도 패널은 그대로 동작한다
  }
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Panel[]>([])
  const saved = useRef<Record<string, Saved>>(readSaved())
  /** 이번 화면에서 한 번이라도 연 패널. 처음 열 때만 저장된 접힘 상태를 따른다 */
  const opened = useRef(new Set<string>())

  const open = useCallback((id: string, o: OpenOptions) => {
    const first = !opened.current.has(id)
    opened.current.add(id)
    setPanels((ps) => {
      const i = ps.findIndex((p) => p.id === id)
      if (i >= 0) return [...ps.slice(0, i), ...ps.slice(i + 1), { ...ps[i], title: o.title, content: o.content, collapsed: false }]
      const vw = window.innerWidth
      const vh = window.innerHeight
      const min = o.size ?? DEFAULT_SIZE
      const s = saved.current[id]
      const rect =
        restoreRect(s, min, vw, vh) ??
        clampRect({ ...(o.position ?? cascadeFrom(ps.at(-1)?.rect, min, vw, vh)), ...min }, vw, vh)
      return [...ps, { id, title: o.title, content: o.content, rect, min, collapsed: first && s?.collapsed === true }]
    })
  }, [])

  const close = useCallback((id: string) => {
    saved.current[id] = { ...saved.current[id], open: false }
    writeSaved(saved.current)
    setPanels((ps) => ps.filter((p) => p.id !== id))
  }, [])

  const focus = useCallback((id: string) => {
    setPanels((ps) => {
      const i = ps.findIndex((p) => p.id === id)
      if (i < 0 || i === ps.length - 1) return ps
      return [...ps.slice(0, i), ...ps.slice(i + 1), ps[i]]
    })
  }, [])

  const toggleCollapse = useCallback((id: string) => {
    setPanels((ps) => ps.map((p) => (p.id === id ? { ...p, collapsed: !p.collapsed } : p)))
  }, [])

  const setRect = useCallback((id: string, rect: Rect) => {
    setPanels((ps) => ps.map((p) => (p.id === id ? { ...p, rect } : p)))
  }, [])

  // 열린 패널의 위치·크기·접힘을 저장
  useEffect(() => {
    for (const p of panels) saved.current[p.id] = { ...p.rect, collapsed: p.collapsed, open: true }
    writeSaved(saved.current)
  }, [panels])

  // 창 크기가 바뀌면 패널을 화면 안으로 당긴다
  useEffect(() => {
    const onResize = () =>
      setPanels((ps) => ps.map((p) => ({ ...p, rect: clampRect(p.rect, window.innerWidth, window.innerHeight, p.collapsed) })))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const api = useMemo<PanelsApi>(
    () => ({
      panels,
      open,
      close,
      focus,
      toggleCollapse,
      setRect,
      isOpen: (id) => panels.some((p) => p.id === id),
      wasClosed: (id) => saved.current[id]?.open === false,
    }),
    [panels, open, close, focus, toggleCollapse, setRect],
  )

  return <PanelsContext.Provider value={api}>{children}</PanelsContext.Provider>
}
