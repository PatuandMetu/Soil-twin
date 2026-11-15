import type { Chunk, CropNames } from './engine'

/** builder/가 만든 실데이터. 다른 파일을 읽으려면 VITE_CHUNKS_FILE로 이름을 준다 (public/data/ 안) */
const CHUNKS_FILE = import.meta.env.VITE_CHUNKS_FILE ?? 'chunks.json'

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  return res.json() as Promise<T>
}

export async function loadData(): Promise<{ chunks: Chunk[]; crops: CropNames; file: string }> {
  const [chunks, crops] = await Promise.all([getJson<Chunk[]>(CHUNKS_FILE), getJson<CropNames>('crops.json')])
  return { chunks, crops, file: CHUNKS_FILE }
}
