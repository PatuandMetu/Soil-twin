import { useEffect, useMemo, useState } from 'react'
import { MapView } from './components/MapView'
import { RefSummary } from './components/RefSummary'
import { RotationCards } from './components/RotationCards'
import { SimilarList } from './components/SimilarList'
import { loadData } from './data'
import { config, findSimilar, profileOf, summarizeRotations, type Chunk, type CropNames, type Status } from './engine'

type Data = { chunks: Chunk[]; crops: CropNames; file: string }

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refId, setRefId] = useState<string | null>(null)
  const [shifted, setShifted] = useState(false)

  useEffect(() => {
    loadData()
      .then((d) => {
        setData(d)
        setRefId(d.chunks[0]?.chunk_id ?? null)
      })
      .catch((e: unknown) => setError(String(e)))
  }, [])

  const ref = useMemo(() => data?.chunks.find((c) => c.chunk_id === refId) ?? null, [data, refId])
  const result = useMemo(
    () => (data && ref ? findSimilar(ref, data.chunks, shifted, data.crops) : null),
    [data, ref, shifted],
  )
  const summary = useMemo(
    () => (data && ref && result ? summarizeRotations(ref, result.similar, data.crops) : null),
    [data, ref, result],
  )
  const similarStatus = useMemo(
    () => new Map<string, Status>(result?.similar.map((s) => [s.chunk.chunk_id, s.score.status]) ?? []),
    [result],
  )

  if (error) return <p>데이터를 읽지 못했습니다: {error}</p>
  if (!data || !ref || !result || !summary) return <p>불러오는 중…</p>

  return (
    <main>
      <h1>Field Shift MVP</h1>
      <p className="meta">
        데이터 {data.file} · 청크 {data.chunks.length}개 · τ = {config.tau}, K = {config.topK}
        {shifted && `, 기후 게이트 ${config.shiftClimateGate} (통과 ${result.gatedCount}개)`}
      </p>
      <label>
        <input type="checkbox" checked={shifted} onChange={(e) => setShifted(e.target.checked)} /> 기후 시프트 모드
      </label>
      <MapView chunks={data.chunks} refId={ref.chunk_id} similar={similarStatus} onSelect={setRefId} />
      <RefSummary chunk={ref} crops={data.crops} shifted={shifted} />
      {result.noneFound ? (
        <p className="none">닮은 청크 없음</p>
      ) : (
        <>
          <RotationCards summary={summary} />
          <SimilarList refProfile={profileOf(ref, shifted)} similar={result.similar} />
        </>
      )}
    </main>
  )
}
