/**
 * Distributional semantics learned from the user's own corpus.
 *
 * The problem this replaces: `localEmbedding` is a hash-bucket sketch. Two
 * tokens either collide or are orthogonal, so "invoice" and "bill" score 0.000
 * — identical to "invoice" and "photosynthesis". Fusing that into a ranking and
 * calling it an embedding made search work only for questions that reused the
 * exact stored words.
 *
 * What this does instead is the classical, pre-neural answer, and a real one:
 * terms that appear in similar contexts get similar vectors.
 *
 *   1. count term co-occurrence inside a sliding window
 *   2. weight each pair by positive pointwise mutual information
 *   3. project with Random Indexing — every term gets a sparse ternary index
 *      vector, and its context vector is the PPMI-weighted sum of the index
 *      vectors of the terms it occurs beside
 *
 * Random Indexing is chosen over LSA deliberately: it needs no matrix
 * factorisation, is incremental, is deterministic given the same corpus, and
 * requires no dependency, model download, or network call. The trade is that it
 * only knows the associations present in the corpus — it cannot know that
 * "invoice" means "bill" until it has seen them used alike. That is an honest
 * limit of learning from your own data, and it is why `ProviderVectors` exists
 * as a drop-in upgrade when a real embedding model is configured.
 */
import { createHash } from 'node:crypto'
import { sha256, tokenize } from './util.js'

export interface SemanticOptions {
  /** Vector width. Random Indexing tolerates far fewer dimensions than one-hot. */
  dimensions: number
  /** Non-zeros in each term's random index vector. */
  seedDensity: number
  /** Tokens either side counted as context. */
  window: number
  /** Tokens read per document, bounding index build on very long captures. */
  maxTokensPerDocument: number
  /** Terms rarer than this are noise and are not given vectors. */
  minTermFrequency: number
}

export const defaultSemanticOptions: SemanticOptions = {
  dimensions: 256,
  seedDensity: 10,
  window: 4,
  maxTokensPerDocument: 600,
  minTermFrequency: 2,
}

export interface SemanticDocument {
  id: string
  text: string
  /** Stable document identity prepended to every chunk before embedding. */
  context?: string
}

export interface RecallEmbeddingChunk extends SemanticDocument {
  momentId: string
  ordinal: number
  contentSha256: string
  preprocessingVersion: string
}

export const recallEmbeddingPreprocessingVersion = 'recall-contextual-text-v2'

/**
 * Keeps individual embedding inputs comfortably below hosted token limits and
 * gives changed OCR a content identity that survives process restarts.
 */
export function chunkEmbeddingDocuments(
  documents: SemanticDocument[],
  maxCharacters = 6_000,
  overlapCharacters = 400,
): RecallEmbeddingChunk[] {
  if (maxCharacters < 500) throw new Error('Embedding chunks must allow at least 500 characters')
  if (overlapCharacters < 0 || overlapCharacters >= maxCharacters) throw new Error('Embedding chunk overlap must be smaller than the chunk')
  const chunks: RecallEmbeddingChunk[] = []
  const stride = maxCharacters - overlapCharacters
  for (const document of documents) {
    const text = document.text.trim()
    const context = document.context?.trim() ?? ''
    if (!text && !context) continue
    let ordinal = 0
    for (let start = 0; start < Math.max(1, text.length); start += stride) {
      const body = text.slice(start, start + maxCharacters)
      // A later OCR chunk must not become an anonymous fragment: its page
      // title and source are part of what makes a semantic match meaningful.
      const contextualized = context ? `${context}\n\n${body}`.trim() : body
      const contentSha256 = sha256(contextualized)
      chunks.push({
        id: `chunk:${sha256(`${document.id}\u0000${recallEmbeddingPreprocessingVersion}\u0000${ordinal}\u0000${contentSha256}`)}`,
        momentId: document.id,
        ordinal,
        contentSha256,
        preprocessingVersion: recallEmbeddingPreprocessingVersion,
        text: contextualized,
      })
      ordinal += 1
      if (start + maxCharacters >= text.length || text.length === 0) break
    }
  }
  return chunks
}

function unit(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  if (sum === 0) return vector
  const norm = Math.sqrt(sum)
  for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / norm
  return vector
}

export function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0
  for (let index = 0; index < left.length; index += 1) dot += (left[index] ?? 0) * (right[index] ?? 0)
  return dot
}

export class SemanticIndex {
  readonly options: SemanticOptions
  private readonly termFrequency = new Map<string, number>()
  private readonly documentFrequency = new Map<string, number>()
  private readonly contextVectors = new Map<string, Float32Array>()
  private readonly documentVectors = new Map<string, Float32Array>()
  private documentCount = 0
  private pairTotal = 0

  private constructor(options: SemanticOptions) {
    this.options = options
  }

  /** Deterministic sparse ternary index vector for a term. */
  private seedVector(term: string): Float32Array {
    const vector = new Float32Array(this.options.dimensions)
    const digest = createHash('sha256').update(term).digest()
    for (let index = 0; index < this.options.seedDensity; index += 1) {
      const byte = digest[index % digest.length] ?? 0
      const next = digest[(index + 7) % digest.length] ?? 0
      const position = ((byte << 8) | next) % this.options.dimensions
      vector[position] = (vector[position] ?? 0) + (index % 2 === 0 ? 1 : -1)
    }
    return vector
  }

  static build(documents: SemanticDocument[], overrides: Partial<SemanticOptions> = {}): SemanticIndex {
    const options = { ...defaultSemanticOptions, ...overrides }
    const index = new SemanticIndex(options)
    const tokenized = documents.map((document) => ({
      id: document.id,
      tokens: tokenize(document.text).slice(0, options.maxTokensPerDocument),
    }))

    for (const { tokens } of tokenized) {
      index.documentCount += 1
      for (const token of tokens) index.termFrequency.set(token, (index.termFrequency.get(token) ?? 0) + 1)
      for (const token of new Set(tokens)) index.documentFrequency.set(token, (index.documentFrequency.get(token) ?? 0) + 1)
    }

    // Co-occurrence within a sliding window, kept sparse.
    const pairs = new Map<string, number>()
    const contextTotals = new Map<string, number>()
    for (const { tokens } of tokenized) {
      for (let position = 0; position < tokens.length; position += 1) {
        const term = tokens[position]
        if (!term || (index.termFrequency.get(term) ?? 0) < options.minTermFrequency) continue
        for (let offset = 1; offset <= options.window; offset += 1) {
          for (const neighbour of [tokens[position - offset], tokens[position + offset]]) {
            if (!neighbour || neighbour === term) continue
            if ((index.termFrequency.get(neighbour) ?? 0) < options.minTermFrequency) continue
            pairs.set(`${term}\u0000${neighbour}`, (pairs.get(`${term}\u0000${neighbour}`) ?? 0) + 1)
            contextTotals.set(term, (contextTotals.get(term) ?? 0) + 1)
            index.pairTotal += 1
          }
        }
      }
    }

    // PPMI-weighted sum of neighbour seed vectors: the term's meaning is the
    // company it keeps.
    const seeds = new Map<string, Float32Array>()
    const seedFor = (term: string): Float32Array => {
      const existing = seeds.get(term)
      if (existing) return existing
      const created = index.seedVector(term)
      seeds.set(term, created)
      return created
    }
    for (const [key, count] of pairs) {
      const [term, neighbour] = key.split('\u0000')
      if (!term || !neighbour) continue
      const pJoint = count / Math.max(1, index.pairTotal)
      const pTerm = (contextTotals.get(term) ?? 0) / Math.max(1, index.pairTotal)
      const pNeighbour = (contextTotals.get(neighbour) ?? 0) / Math.max(1, index.pairTotal)
      if (pTerm === 0 || pNeighbour === 0) continue
      const ppmi = Math.max(0, Math.log2(pJoint / (pTerm * pNeighbour)))
      if (ppmi === 0) continue
      const vector = index.contextVectors.get(term) ?? new Float32Array(options.dimensions)
      const seed = seedFor(neighbour)
      for (let dimension = 0; dimension < options.dimensions; dimension += 1) {
        vector[dimension] = (vector[dimension] ?? 0) + ppmi * (seed[dimension] ?? 0)
      }
      index.contextVectors.set(term, vector)
    }
    for (const [term, vector] of index.contextVectors) index.contextVectors.set(term, unit(vector))

    for (const { id, tokens } of tokenized) index.documentVectors.set(id, index.vectorFor(tokens.join(' ')))
    return index
  }

  get size(): number { return this.documentCount }
  get vocabulary(): number { return this.contextVectors.size }

  /** Inverse document frequency, so common words contribute little. */
  idf(term: string): number {
    const seen = this.documentFrequency.get(term) ?? 0
    return Math.log(1 + (this.documentCount + 1) / (seen + 1))
  }

  termVector(term: string): Float32Array | null {
    return this.contextVectors.get(term) ?? null
  }

  /** IDF-weighted centroid of a text's term vectors. */
  vectorFor(text: string): Float32Array {
    const vector = new Float32Array(this.options.dimensions)
    for (const token of tokenize(text).slice(0, this.options.maxTokensPerDocument)) {
      const termVector = this.contextVectors.get(token)
      if (!termVector) continue
      const weight = this.idf(token)
      for (let dimension = 0; dimension < this.options.dimensions; dimension += 1) {
        vector[dimension] = (vector[dimension] ?? 0) + weight * (termVector[dimension] ?? 0)
      }
    }
    return unit(vector)
  }

  documentVector(id: string): Float32Array | null {
    return this.documentVectors.get(id) ?? null
  }

  /** Ranks every document against a free-text query. */
  search(query: string, limit = 50): Array<{ id: string; score: number }> {
    const queryVector = this.vectorFor(query)
    let empty = true
    for (const value of queryVector) if (value !== 0) { empty = false; break }
    if (empty) return []
    const scored: Array<{ id: string; score: number }> = []
    for (const [id, vector] of this.documentVectors) {
      const score = cosine(queryVector, vector)
      if (score > 0) scored.push({ id, score })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * Terms used in similar contexts to the query's own. Used to widen a lexical
   * search so it stops depending on the asker's exact vocabulary.
   */
  expand(query: string, perTerm = 3): string[] {
    const found = new Map<string, number>()
    for (const token of new Set(tokenize(query))) {
      const source = this.contextVectors.get(token)
      if (!source) continue
      const neighbours: Array<{ term: string; score: number }> = []
      for (const [term, vector] of this.contextVectors) {
        if (term === token) continue
        const score = cosine(source, vector)
        if (score > 0.35) neighbours.push({ term, score })
      }
      for (const { term, score } of neighbours.sort((a, b) => b.score - a.score).slice(0, perTerm)) {
        found.set(term, Math.max(found.get(term) ?? 0, score))
      }
    }
    return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term)
  }
}

/**
 * Where semantic vectors come from. Two implementations, one interface, so the
 * retrieval code never learns which is in use.
 *
 * The distinction that matters to a user is vocabulary. Corpus vectors are
 * learned from their own history: free, offline, deterministic, and blind to
 * any word they have never written. Pretrained vectors come from a configured
 * embedding model and carry outside knowledge of the language, so a question
 * phrased in words that appear nowhere in the history can still match.
 */
export interface VectorSource {
  readonly id: string
  /** True when the vectors carry knowledge of language beyond this corpus. */
  readonly pretrained: boolean
  embed(texts: string[]): Promise<Float32Array[]>
}

export class CorpusVectorSource implements VectorSource {
  readonly id = 'corpus'
  readonly pretrained = false
  constructor(private readonly index: SemanticIndex) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.index.vectorFor(text))
  }
}

export class ProviderVectorSource implements VectorSource {
  readonly pretrained = true
  /** Tokens consumed since construction, so the caller can record the spend. */
  private consumed = 0
  constructor(readonly id: string, private readonly embedder: (texts: string[]) => Promise<{ vectors: number[][]; usage: { inputTokens: number | null } }>) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    const result = await this.embedder(texts)
    this.consumed += result.usage.inputTokens ?? 0
    if (result.vectors.length !== texts.length) {
      throw new Error(`Embedding provider returned ${result.vectors.length} vectors for ${texts.length} inputs`)
    }
    let dimensions: number | null = null
    return result.vectors.map((values) => {
      if (values.length === 0 || values.some((value) => !Number.isFinite(value))) throw new Error('Embedding provider returned an invalid vector')
      dimensions ??= values.length
      if (values.length !== dimensions) throw new Error('Embedding provider returned inconsistent vector dimensions')
      return unit(Float32Array.from(values))
    })
  }
  /** Reads and clears, so each recall records only its own tokens. */
  takeConsumedTokens(): number {
    const total = this.consumed
    this.consumed = 0
    return total
  }
}

export class EmbeddingDimensionMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`Embedding dimensions changed from ${expected} to ${actual}`)
    this.name = 'EmbeddingDimensionMismatchError'
  }
}

/** Ranks documents against a query using whichever source is supplied. */
export interface SimilarityHit {
  id: string
  score: number
}

export async function rankBySimilarityWithScores(
  source: VectorSource,
  query: string,
  documents: Array<{ id: string; text: string }>,
  cache: Map<string, Float32Array>,
  limit = 200,
  options: {
    batchSize?: number
    onEmbedded?: (documents: SemanticDocument[], vectors: Float32Array[]) => void | Promise<void>
  } = {},
): Promise<SimilarityHit[]> {
  let expectedDimensions: number | null = null
  for (const document of documents) {
    const vector = cache.get(document.id)
    if (!vector) continue
    if (expectedDimensions === null) expectedDimensions = vector.length
    else if (vector.length !== expectedDimensions) throw new EmbeddingDimensionMismatchError(expectedDimensions, vector.length)
  }
  const missing = documents.filter((document) => !cache.has(document.id))
  const batchSize = Math.max(1, Math.min(256, options.batchSize ?? 128))
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize)
    const embedded = await source.embed(batch.map((document) => document.text))
    if (embedded.length !== batch.length) throw new Error(`Embedding source returned ${embedded.length} vectors for ${batch.length} documents`)
    const batchDimensions = embedded[0]?.length ?? 0
    if (batchDimensions === 0 || embedded.some((vector) => vector.length !== batchDimensions)) throw new Error('Embedding source returned invalid vector dimensions')
    if (expectedDimensions !== null && batchDimensions !== expectedDimensions) throw new EmbeddingDimensionMismatchError(expectedDimensions, batchDimensions)
    expectedDimensions = batchDimensions
    await options.onEmbedded?.(batch, embedded)
    batch.forEach((document, index) => {
      const vector = embedded[index]
      if (vector) cache.set(document.id, vector)
    })
  }
  const [queryVector] = await source.embed([query])
  if (!queryVector) return []
  if (expectedDimensions !== null && queryVector.length !== expectedDimensions) throw new EmbeddingDimensionMismatchError(expectedDimensions, queryVector.length)
  let empty = true
  for (const value of queryVector) if (value !== 0) { empty = false; break }
  if (empty) return []

  return documents
    .map((document) => {
      const vector = cache.get(document.id)
      return { id: document.id, score: vector && vector.length === queryVector.length ? cosine(queryVector, vector) : 0 }
    })
    .filter((entry) => entry.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Backward-compatible rank-only view for callers that do not need calibration. */
export async function rankBySimilarity(
  source: VectorSource,
  query: string,
  documents: Array<{ id: string; text: string }>,
  cache: Map<string, Float32Array>,
  limit = 200,
  options: {
    batchSize?: number
    onEmbedded?: (documents: SemanticDocument[], vectors: Float32Array[]) => void | Promise<void>
  } = {},
): Promise<string[]> {
  const ranked = await rankBySimilarityWithScores(source, query, documents, cache, limit, options)
  return ranked.map((entry) => entry.id)
}
