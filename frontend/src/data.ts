import type { Chunk, CropNames } from './engine'

/** 진짜 데이터가 오면 VITE_CHUNKS_FILE로 바꾸거나 이 기본값만 바꾼다. */
const CHUNKS_FILE = import.meta.env.VITE_CHUNKS_FILE ?? 'chunks.fake.json'

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  return res.json() as Promise<T>
}

export async function loadData(): Promise<{ chunks: Chunk[]; crops: CropNames; file: string }> {
  const [chunks, crops] = await Promise.all([getJson<Chunk[]>(CHUNKS_FILE), getJson<CropNames>('crops.json')])
  return { chunks, crops, file: CHUNKS_FILE }
}
