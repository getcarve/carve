import { readComputerOutcome } from './outcome.js'

export interface CompactOutcome {
  status: string
  remaining: string[]
  title?: string | null
}

export const compactSourceReceiptSchema = { type: ['object', 'null'], additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['handoff_source_v1'] }, content: { type: 'string', minLength: 1, maxLength: 12000 },
    coverage: { type: 'string', enum: ['complete', 'partial', 'unknown'] }, provenance: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 300 } } },
  required: ['kind', 'content', 'coverage', 'provenance'] }

export function serializeCompactSourceReceipt(value: unknown): string {
  const v = value as Record<string, unknown> | null
  if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['kind', 'content', 'coverage', 'provenance'].includes(k))
    || v.kind !== 'handoff_source_v1' || typeof v.content !== 'string' || !v.content.trim() || v.content.length > 12000
    || !['complete', 'partial', 'unknown'].includes(String(v.coverage)) || !Array.isArray(v.provenance)
    || v.provenance.length > 100 || v.provenance.some(p => typeof p !== 'string' || p.length > 300)) {
    throw new Error('Invalid sourceReceipt: supply bounded observed content, coverage and provenance')
  }
  return JSON.stringify(v)
}

/** Serialize transport metadata once. The actor supplies content and a status;
 * a reviewer checks truth, never repairs an adapter's JSON envelope. */
export function compactReport(answer: string, outcome: CompactOutcome): string {
  if (!['completed', 'partial', 'blocked'].includes(outcome.status)
      || !Array.isArray(outcome.remaining) || outcome.remaining.length > 20
      || outcome.remaining.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000)
      || (outcome.status === 'completed' ? outcome.remaining.length !== 0 : outcome.remaining.length === 0)) {
    throw new Error('A final answer needs an outcome: completed with no remaining requirements, or partial/blocked naming the unmet requirements')
  }
  let message = answer, inheritedTitle: string | undefined
  // Older stage instructions asked the actor to put the outcome in answer.
  // Unwrap only an exact, status-consistent report; never turn a limitation
  // into completion or interpret a source receipt as executable instructions.
  for (let depth = 0; depth < 3; depth++) {
    let value: unknown
    try { value = JSON.parse(message) } catch { break }
    if (!value || typeof value !== 'object' || !('status' in value) || !('message' in value)) break
    const nested = readComputerOutcome(message)
    if (nested.status === 'unclassified' || nested.status !== outcome.status
        || JSON.stringify([...nested.remaining].sort()) !== JSON.stringify([...outcome.remaining].sort())) {
      throw new Error('Nested report disagrees with outcome; preserve the actual status and all unmet requirements')
    }
    if (depth === 2) throw new Error('Repeatedly nested report; put only the final content or source receipt in program.answer')
    message = nested.message
    inheritedTitle ??= nested.title
  }
  if (!message.trim() || message.length > 100_000) throw new Error('A final report needs bounded nonempty content')
  // Legacy string receipts must be valid before a reviewer can accept them.
  // New actors use the typed sourceReceipt field, serialized in code once.
  let receipt: unknown
  try { receipt = JSON.parse(message) } catch {
    if (message.trimStart().startsWith('{') && message.includes('"handoff_source_v1"')) {
      throw new Error('Invalid handoff source JSON; use the typed sourceReceipt field instead of JSON inside program.answer')
    }
  }
  if (receipt && typeof receipt === 'object' && 'kind' in receipt && receipt.kind === 'handoff_source_v1') {
    message = serializeCompactSourceReceipt(receipt)
    if (outcome.status === 'completed' && 'coverage' in receipt && receipt.coverage !== 'complete') throw new Error('Incomplete source coverage cannot report completed')
  }
  const rawTitle = typeof outcome.title === 'string' ? outcome.title : inheritedTitle
  const title = rawTitle?.replace(/\s+/gu, ' ').trim().replace(/[.!?:;,]+$/u, '').split(' ').slice(0, 6).join(' ').slice(0, 40)
    || (outcome.status === 'completed' ? 'Task completed' : 'Task incomplete')
  return JSON.stringify({ status: outcome.status, message, remaining: outcome.remaining, title })
}
