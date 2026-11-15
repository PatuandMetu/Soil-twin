import { Popup } from 'maplibre-gl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMapInstance } from '../mapContext'

/** 팝업끼리 겹치면 마지막에 누른(또는 연) 것이 위 */
let topZ = 10

type Props = {
  lon: number
  lat: number
  className?: string
  /** 핀 같은 표시와 겹치지 않게 띄우는 거리(px) */
  offset?: number
  /** 값이 바뀔 때마다 맨 위로 올린다 */
  raise?: number
  children: ReactNode
}

/**
 * 지도 좌표에 붙는 MapLibre 팝업 안에 React 내용을 그린다(portal이라 앱 상태를 그대로 읽는다).
 * 지도를 옮기거나 확대하면 따라 움직이고, 지도 밖으로 나가면 그대로 둔다.
 */
export function MapPopup({ lon, lat, className, offset = 14, raise, children }: Props) {
  const map = useMapInstance()
  const [el] = useState(() => document.createElement('div'))
  const popup = useRef<Popup | null>(null)

  useEffect(() => {
    const p = new Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
      maxWidth: 'none',
      offset,
      className,
    })
      .setDOMContent(el)
      .setLngLat([lon, lat])
      .addTo(map)
    const front = () => {
      p.getElement().style.zIndex = String(++topZ)
    }
    front()
    const node = p.getElement()
    node.addEventListener('pointerdown', front)
    popup.current = p
    return () => {
      node.removeEventListener('pointerdown', front)
      p.remove()
      popup.current = null
    }
    // 위치·맨 위로는 아래 효과들이 맡는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, el, className, offset])

  useEffect(() => {
    popup.current?.setLngLat([lon, lat])
  }, [lon, lat])

  useEffect(() => {
    const node = popup.current?.getElement()
    if (node && raise !== undefined) node.style.zIndex = String(++topZ)
  }, [raise])

  return createPortal(children, el)
}
