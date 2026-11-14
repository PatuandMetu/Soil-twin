import { Fragment, useState } from 'react'
import { CLIMATE_KEYS, SOIL_KEYS, type Profile, type Scored } from '../engine'
import { ITEM_LABEL, STATUS_LABEL, fmt, warningText } from '../labels'

type Props = { refProfile: Profile; similar: Scored[] }

export function SimilarList({ refProfile, similar }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section>
      <h2>닮은 청크 {similar.length}개</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>청크</th>
            <th>종합</th>
            <th>토양</th>
            <th>기후</th>
            <th>상태</th>
            <th>경고</th>
            <th>기후 칸</th>
          </tr>
        </thead>
        <tbody>
          {similar.map(({ chunk, score }) => {
            const isOpen = open === chunk.chunk_id
            return (
              <Fragment key={chunk.chunk_id}>
                <tr className="row" onClick={() => setOpen(isOpen ? null : chunk.chunk_id)}>
                  <td>{isOpen ? '▾' : '▸'}</td>
                  <td>{chunk.chunk_id}</td>
                  <td>{score.total.toFixed(1)}</td>
                  <td>{score.soil.toFixed(1)}</td>
                  <td>{score.climate.toFixed(1)}</td>
                  <td>{STATUS_LABEL[score.status]}</td>
                  <td>{score.warnings.map(warningText).join(', ')}</td>
                  <td>{chunk.climate_cell}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td></td>
                    <td colSpan={7}>
                      <div className="detail">
                        <table>
                          <thead>
                            <tr>
                              <th>항목</th>
                              <th>블록</th>
                              <th>가중치</th>
                              <th>점수</th>
                              <th>감점 기여</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...score.items]
                              .sort((a, b) => b.penalty - a.penalty)
                              .map((it) => (
                                <tr key={it.key}>
                                  <td>{ITEM_LABEL[it.key]}</td>
                                  <td>{it.block}</td>
                                  <td>{it.weight.toFixed(2)}</td>
                                  <td>{it.score.toFixed(1)}</td>
                                  <td>{it.penalty.toFixed(2)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        <table>
                          <thead>
                            <tr>
                              <th>값</th>
                              <th>기준</th>
                              <th>이 청크</th>
                              <th>차이</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...SOIL_KEYS, ...CLIMATE_KEYS].map((k) => (
                              <tr key={k}>
                                <td>{k}</td>
                                <td>{fmt(refProfile[k], 2)}</td>
                                <td>{fmt(chunk[k], 2)}</td>
                                <td>{fmt(chunk[k] - refProfile[k], 2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
