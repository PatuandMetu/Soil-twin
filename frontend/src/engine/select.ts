import { config as defaultConfig, type Config } from './config'
import { patternKey } from './rotation'
import { passesShiftGate, profileOf, scorePair } from './score'
import type { Chunk, CropNames, Scored, Status } from './types'

export type SimilarResult = {
  /** 후보(기준 청크와 빈 패턴 청크를 뺀 전체)의 점수, 점수 높은 순 */
  candidates: Scored[]
  /** 시프트 모드의 기후 게이트를 통과한 후보 수 (현재 모드면 후보 전체) */
  gatedCount: number
  /** 고른 닮은 청크: twin·constrained → 기후 칸 상한 → 상위 K */
  selected: Scored[]
  /** selected와 같다. 목록, 지도, 윤작 집계가 이것을 쓴다. */
  similar: Scored[]
  /** 닮은 청크 조건(twin·constrained)을 통과한 후보가 0개 */
  noneFound: boolean
}

const isSimilarStatus = (s: Status) => s === 'twin' || s === 'constrained'

/**
 * 닮은 청크 고르기.
 * 1) 후보: 기준 청크 자신과 빈 패턴 청크(8년 중 2번 이상 나온 작물이 없는 청크)는 뺀다
 * 2) 점수 높은 순으로 정렬
 * 3) 시프트 모드면 기후 게이트
 * 4) 닮은 청크 조건: 상태가 twin 또는 constrained
 * 5) 기후 칸마다 최대 cellCap개 (점수 높은 순)
 * 6) 상위 topK개
 * names를 주지 않으면 작물 코드로 빈 패턴을 판정한다. 코드마다 이름이 다르면 결과는 같다.
 */
export function findSimilar(
  ref: Chunk,
  all: Chunk[],
  shifted: boolean,
  names: CropNames = {},
  cfg: Config = defaultConfig,
): SimilarResult {
  const refProfile = profileOf(ref, shifted)
  const candidates = all
    .filter((c) => c.chunk_id !== ref.chunk_id && patternKey(c, names, cfg.patternMinCount) !== '')
    .map((chunk) => ({ chunk, score: scorePair(refProfile, profileOf(chunk), cfg) }))
    .sort(byScoreDesc)

  const gated = shifted ? candidates.filter((s) => passesShiftGate(s.score.climate, cfg)) : candidates
  const passing = gated.filter((s) => isSimilarStatus(s.score.status))
  const selected = applyCellCap(passing, cfg.cellCap).slice(0, cfg.topK)

  return { candidates, gatedCount: gated.length, selected, similar: selected, noneFound: passing.length === 0 }
}

/** 한 기후 칸에서 최대 cap개만, 점수 높은 순으로 남긴다. */
export function applyCellCap(scored: Scored[], cap: number): Scored[] {
  const perCell = new Map<string, number>()
  const out: Scored[] = []
  for (const s of [...scored].sort(byScoreDesc)) {
    const n = perCell.get(s.chunk.climate_cell) ?? 0
    if (n >= cap) continue
    perCell.set(s.chunk.climate_cell, n + 1)
    out.push(s)
  }
  return out
}

/** 점수 높은 순, 같으면 chunk_id 순 */
export function byScoreDesc(a: Scored, b: Scored): number {
  return b.score.total - a.score.total || a.chunk.chunk_id.localeCompare(b.chunk.chunk_id)
}
