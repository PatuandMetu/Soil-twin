import { config as defaultConfig, type Config } from './config'
import { meetsTau, passesShiftGate, profileOf, scorePair } from './score'
import type { Chunk, Scored } from './types'

export type SimilarResult = {
  /** 기준 청크를 뺀 모든 후보의 점수 (점수 높은 순) */
  candidates: Scored[]
  /** 시프트 모드의 기후 게이트를 통과한 후보 수 (현재 모드면 후보 전체) */
  gatedCount: number
  /** τ 이상, 상위 K */
  selected: Scored[]
  /** 고른 것 중 twin + constrained */
  similar: Scored[]
  /** τ 이상 후보가 0개 */
  noneFound: boolean
}

export function findSimilar(ref: Chunk, all: Chunk[], shifted: boolean, cfg: Config = defaultConfig): SimilarResult {
  const refProfile = profileOf(ref, shifted)
  const candidates = all
    .filter((c) => c.chunk_id !== ref.chunk_id)
    .map((chunk) => ({ chunk, score: scorePair(refProfile, profileOf(chunk), cfg) }))
    .sort(byScoreDesc)

  const gated = shifted ? candidates.filter((s) => passesShiftGate(s.score.climate, cfg)) : candidates
  const aboveTau = gated.filter((s) => meetsTau(s.score.total, cfg))
  const selected = aboveTau.slice(0, cfg.topK)
  const similar = selected.filter((s) => s.score.status === 'twin' || s.score.status === 'constrained')

  return { candidates, gatedCount: gated.length, selected, similar, noneFound: aboveTau.length === 0 }
}

/** 점수 높은 순, 같으면 chunk_id 순 */
export function byScoreDesc(a: Scored, b: Scored): number {
  return b.score.total - a.score.total || a.chunk.chunk_id.localeCompare(b.chunk.chunk_id)
}
