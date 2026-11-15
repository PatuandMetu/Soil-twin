import { FloatingPanel } from './FloatingPanel'
import { usePanels } from './context'

/** 열린 패널을 겹침 순서대로 그린다 */
export function PanelHost() {
  const { panels, focus, close, toggleCollapse, setRect } = usePanels()
  return (
    <>
      {panels.map((p, i) => (
        <FloatingPanel
          key={p.id}
          id={p.id}
          title={p.title}
          rect={p.rect}
          min={p.min}
          collapsed={p.collapsed}
          z={10 + i}
          onFocus={focus}
          onClose={close}
          onToggleCollapse={toggleCollapse}
          onRect={setRect}
        >
          {p.content}
        </FloatingPanel>
      ))}
    </>
  )
}
