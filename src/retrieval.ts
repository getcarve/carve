import type { CarveDatabase } from './db.js'
import type { ProcedureVersion } from './types.js'
import { cosineSimilarity, localEmbedding, tokenize } from './util.js'

export const EXECUTABLE_RETRIEVAL_THRESHOLD = 0.45
/** A related reviewed procedure may scaffold a new plan, but only with tighter supervision. */
export const ADAPTIVE_RETRIEVAL_THRESHOLD = 0.25
export const ADAPTIVE_RETRIEVAL_MARGIN = 0.06

export interface RetrievalHit {
  procedure: ProcedureVersion
  score: number
  components: { metadata: number; fullText: number; embedding: number; graph: number }
}

export class LowConfidenceRetrievalError extends Error {
  constructor(readonly bestScore: number) {
    super(`No learned procedure matched the goal with sufficient confidence (best score ${bestScore.toFixed(2)}; required ${EXECUTABLE_RETRIEVAL_THRESHOLD.toFixed(2)}).`)
    this.name = 'LowConfidenceRetrievalError'
  }
}

export class ProcedureRetriever {
  constructor(private readonly database: CarveDatabase) {}

  retrieve(goal: string, threshold = EXECUTABLE_RETRIEVAL_THRESHOLD): RetrievalHit {
    const hits = this.rank(goal)
    const best = hits[0]
    if (!best || best.score < threshold) throw new LowConfidenceRetrievalError(best?.score ?? 0)
    return best
  }

  rank(goal: string): RetrievalHit[] {
    const procedures = this.database.listProcedures(true).filter((procedure) => procedure.confidence >= 0.5 && procedure.graph.steps.some((step) => step.action))
    if (procedures.length === 0) return []
    const goalTokens = tokenize(goal)
    const fts = new Set(this.database.searchProcedureIds(goalTokens.join(' OR ')).map((hit) => `${hit.procedureId}:${hit.version}`))
    const queryVector = localEmbedding(goal)

    return procedures.map((procedure): RetrievalHit => {
      const metadataText = `${procedure.name} ${procedure.goal}`
      const metadataTokens = tokenize(metadataText)
      const overlap = goalTokens.filter((token) => metadataTokens.includes(token)).length
      const metadata = goalTokens.length === 0 ? 0 : overlap / goalTokens.length
      const body = `${metadataText} ${procedure.graph.steps.map((step) => `${step.name} ${step.description}`).join(' ')}`
      const bodyTokens = tokenize(body)
      const graphOverlap = goalTokens.filter((token) => bodyTokens.includes(token)).length
      const graph = goalTokens.length === 0 ? 0 : graphOverlap / goalTokens.length
      const embedding = Math.max(0, cosineSimilarity(queryVector, localEmbedding(body)))
      const fullText = fts.has(`${procedure.procedureId}:${procedure.version}`) ? 1 : 0
      const score = metadata * 0.45 + fullText * 0.15 + embedding * 0.3 + graph * 0.1
      return { procedure, score, components: { metadata, fullText, embedding, graph } }
    }).sort((left, right) => right.score - left.score)

  }
}
