import { AreasView } from './AreasView'
import { DetailView } from './DetailView'

/**
 * 화면 3분할의 오른쪽 두 칸: Land Info | Detail. 둘 다 위아래를 채우고 각자 스크롤한다.
 * 너비는 CSS --info-w, --detail-w (지도:Info:Detail ≈ 2:1:1, 최소 폭 있음)
 */
export function SideColumns() {
  return (
    <div className="side-cols">
      <section className="side-col" aria-label="Land Info">
        <h2 className="side-head">Land Info</h2>
        <div className="fp-body side-body">
          <AreasView />
        </div>
      </section>
      <section className="side-col" aria-label="Detail">
        <h2 className="side-head">Detail</h2>
        <div className="fp-body side-body">
          <DetailView />
        </div>
      </section>
    </div>
  )
}
