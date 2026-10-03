import { createHash, randomUUID } from 'node:crypto'

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 2))]
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    dot += l * r
    leftNorm += l * l
    rightNorm += r * r
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export function localEmbedding(value: string, dimensions = 64): number[] {
  const vector = Array.from<number>({ length: dimensions }).fill(0)
  for (const token of tokenize(value)) {
    const digest = createHash('sha256').update(token).digest()
    const index = digest.readUInt16BE(0) % dimensions
    vector[index] = (vector[index] ?? 0) + ((digest[2] ?? 0) % 2 === 0 ? 1 : -1)
  }
  return vector
}

export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`)
}
