import { config, type RotationSummary } from '../engine'
import { patternLabel, pct } from '../labels'

export function RotationCards({ summary }: { summary: RotationSummary }) {
  return (
    <section>
      <h2>
        윤작 비교 <small>(센 닮은 청크 {summary.counted.length}개, 기후 칸당 최대 {config.cellCap}개)</small>
      </h2>
      <div className="cards">
        {summary.cards.map((p, i) => (
          <div className="card" key={p.key + i}>
            <div className="card-tag">{i === 0 ? '현재 윤작' : `흔한 패턴 ${i}`}</div>
            <div className="card-key">{patternLabel(p.key)}</div>
            <div>
              청크 {p.count} / {p.total}
            </div>
            <div>면적 비중 {pct(p.areaShare)}</div>
            <div>기후 칸 {p.cellCount}개</div>
            <div>경고 있는 청크 {p.warnedCount}개</div>
          </div>
        ))}
      </div>
    </section>
  )
}
