/**
 * Associative memory over the observation stream.
 *
 * The whole model rests on one learned statistic: P(next signature | current
 * signature), estimated from the ambient transition stream. Three behaviours
 * fall out of it, so there is one thing to learn, test, and be wrong about
 * rather than three subsystems bolted together.
 *
 *   association   spreading activation over the transition graph
 *   segmentation  an improbable transition is a surprise, and surprise is an
 *                 event boundary (Zacks & Tversky's event segmentation)
 *   strength      ACT-R base-level activation, so frequency and recency are one
 *                 principled number instead of an invented recency curve
 *
 * Nothing here calls a model or the network. Real embeddings remain an optional
 * additive term elsewhere; this layer is meant to work with none.
 *
 * The load-bearing risk is that a screen stream links things that merely happen
 * at the same time. The fan damping below is the mitigation — a signature that
 * co-occurs with everything carries almost no activation — and
 * `scripts/evaluate-memory.ts` exists to measure whether it is sufficient
 * before anything is built on top.
 */
import type { AmbientEvent } from './types.js'

export interface MemoryModelOptions {
  /** Additive smoothing, so an unseen transition is surprising but not infinite. */
  alpha: number
  /** Activation retained per hop while spreading. */
  hopDecay: number
  /** Hops explored from the seeds. */
  hops: number
  /**
   * Steps either side counted as co-occurring. Strict adjacency fails on a real
   * screen stream: people bounce to a chat window between every step of a task,
   * so the steps of that task are never literally adjacent.
   */
  coOccurrenceWindow: number
  /**
   * Background detection. A signature is scenery when it turns up beside many
   * different things *and* predicts none of them: high fan, high next-step
   * entropy. Measuring fan as a share of the vocabulary was the first attempt
   * and it misfired — on a small vocabulary it flagged ordinary task steps —
   * so both conditions must now hold, and the fan is judged against the
   * observed distribution rather than an absolute share.
   */
  hubMinimumFan: number
  hubEntropyRatio: number
}

export const defaultMemoryOptions: MemoryModelOptions = {
  alpha: 0.5,
  hopDecay: 0.45,
  hops: 2,
  coOccurrenceWindow: 3,
  hubMinimumFan: 4,
  hubEntropyRatio: 0.8,
}

export interface SegmentationOptions {
  /** Surprise at or above this many bits opens a new episode. */
  boundaryBits: number
  /** A pause longer than this always ends an episode. */
  idleGapMs: number
  /** Upper bound so one unbroken stretch cannot become a single vast episode. */
  maxEpisodeMs: number
}

export const defaultSegmentation: SegmentationOptions = {
  boundaryBits: 3.5,
  idleGapMs: 5 * 60 * 1_000,
  maxEpisodeMs: 45 * 60 * 1_000,
}

export interface Episode {
  id: string
  startedAt: string
  endedAt: string
  durationMs: number
  momentIds: string[]
  apps: string[]
  /** Why this episode began: the first one starts the stream. */
  boundary: 'stream_start' | 'idle_gap' | 'surprise' | 'max_duration'
  boundaryBits: number
  gist: string
}

export interface AssociationEdge {
  from: string
  to: string
  /** Positive pointwise mutual information, damped by how promiscuous the target is. */
  weight: number
  count: number
}

/**
 * Frequency and recency in one number, from ACT-R: B = ln(Σ tₖ^−d).
 * Every presentation — the original observation and each later retrieval —
 * contributes a decaying trace, so something recalled often stays strong.
 */
export function baseLevelActivation(presentationTimes: number[], now: number, decay = 0.5): number {
  let sum = 0
  for (const time of presentationTimes) {
    const seconds = Math.max(1, (now - time) / 1_000)
    sum += Math.pow(seconds, -decay)
  }
  return sum === 0 ? Number.NEGATIVE_INFINITY : Math.log(sum)
}

export class MemoryModel {
  readonly options: MemoryModelOptions
  private readonly occurrences = new Map<string, number>()
  private readonly outgoing = new Map<string, Map<string, number>>()
  private readonly neighbours = new Map<string, Set<string>>()
  private readonly coOccurrence = new Map<string, Map<string, number>>()
  private readonly hubs = new Set<string>()
  private transitionTotal = 0
  private pairTotal = 0

  constructor(events: AmbientEvent[], options: Partial<MemoryModelOptions> = {}) {
    this.options = { ...defaultMemoryOptions, ...options }
    const ordered = [...events].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    for (const event of ordered) {
      this.occurrences.set(event.signature, (this.occurrences.get(event.signature) ?? 0) + 1)
    }

    // Pass one: raw adjacency, only to find out which signatures are background.
    const rawNeighbours = new Map<string, Set<string>>()
    const rawAdjacency = new Map<string, number>()
    let previousRaw: string | null = null
    for (const event of ordered) {
      if (previousRaw && previousRaw !== event.signature) {
        rawAdjacency.set(`${previousRaw}\u0000${event.signature}`, (rawAdjacency.get(`${previousRaw}\u0000${event.signature}`) ?? 0) + 1)
        rawAdjacency.set(`${event.signature}\u0000${previousRaw}`, (rawAdjacency.get(`${event.signature}\u0000${previousRaw}`) ?? 0) + 1)
        if (!rawNeighbours.has(previousRaw)) rawNeighbours.set(previousRaw, new Set())
        if (!rawNeighbours.has(event.signature)) rawNeighbours.set(event.signature, new Set())
        rawNeighbours.get(previousRaw)?.add(event.signature)
        rawNeighbours.get(event.signature)?.add(previousRaw)
      }
      previousRaw = event.signature
    }
    const fans = [...rawNeighbours.values()].map((set) => set.size).sort((a, b) => a - b)
    const highFan = fans.length > 0 ? (fans[Math.floor(fans.length * 0.9)] ?? 0) : 0
    for (const [signature, set] of rawNeighbours) {
      if (set.size < Math.max(this.options.hubMinimumFan, highFan)) continue
      // Uniformity over the neighbours it appears beside: a signature that
      // predicts what follows is part of a routine, not scenery.
      const counts = new Map<string, number>()
      for (const neighbour of set) counts.set(neighbour, rawAdjacency.get(`${signature}\u0000${neighbour}`) ?? 1)
      const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
      let entropy = 0
      for (const count of counts.values()) {
        const p = count / total
        if (p > 0) entropy -= p * Math.log2(p)
      }
      const maximum = Math.log2(Math.max(2, counts.size))
      if (entropy / maximum >= this.options.hubEntropyRatio) this.hubs.add(signature)
    }

    // Pass two: the narrative stream, with background removed, drives both the
    // transition probabilities and the windowed co-occurrence counts.
    const salient = ordered.filter((event) => !this.hubs.has(event.signature))
    let previous: string | null = null
    for (const event of salient) {
      if (previous && previous !== event.signature) this.countTransition(previous, event.signature)
      previous = event.signature
    }
    for (let index = 0; index < salient.length; index += 1) {
      const left = salient[index]?.signature
      if (!left) continue
      for (let offset = 1; offset <= this.options.coOccurrenceWindow; offset += 1) {
        const right = salient[index + offset]?.signature
        if (!right || right === left) continue
        this.countPair(left, right)
      }
    }
  }

  private countTransition(from: string, to: string): void {
    const row = this.outgoing.get(from) ?? new Map<string, number>()
    row.set(to, (row.get(to) ?? 0) + 1)
    this.outgoing.set(from, row)
    this.transitionTotal += 1
  }

  private countPair(a: string, b: string): void {
    const forward = this.coOccurrence.get(a) ?? new Map<string, number>()
    forward.set(b, (forward.get(b) ?? 0) + 1)
    this.coOccurrence.set(a, forward)
    const backward = this.coOccurrence.get(b) ?? new Map<string, number>()
    backward.set(a, (backward.get(a) ?? 0) + 1)
    this.coOccurrence.set(b, backward)
    this.pairTotal += 1
    this.neighbour(a).add(b)
    this.neighbour(b).add(a)
  }

  private neighbour(signature: string): Set<string> {
    const set = this.neighbours.get(signature) ?? new Set<string>()
    this.neighbours.set(signature, set)
    return set
  }

  /** Background signatures: present everywhere, informative nowhere. */
  isHub(signature: string): boolean { return this.hubs.has(signature) }
  get backgroundSignatures(): string[] { return [...this.hubs] }

  get vocabulary(): number { return this.occurrences.size }
  get transitions(): number { return this.transitionTotal }

  /** Distinct neighbours of a signature. High fan means it tells you little. */
  fan(signature: string): number { return this.neighbours.get(signature)?.size ?? 0 }

  /** Smoothed P(to | from). */
  probability(from: string, to: string): number {
    const row = this.outgoing.get(from)
    const observed = row?.get(to) ?? 0
    const total = [...(row?.values() ?? [])].reduce((sum, value) => sum + value, 0)
    const { alpha } = this.options
    const vocabulary = Math.max(1, this.vocabulary)
    return (observed + alpha) / (total + alpha * vocabulary)
  }

  /** Bits of surprise for a transition. Improbable means a new event began. */
  surprise(from: string, to: string): number {
    return -Math.log2(Math.max(Number.MIN_VALUE, this.probability(from, to)))
  }

  /**
   * Positive PMI, damped by the target's fan. A signature adjacent to
   * everything — a chat app left open all day — is nearly uninformative, which
   * is the fan effect doing the work a stopword list would otherwise do badly.
   */
  association(from: string, to: string): number {
    if (from === to) return 0
    const joint = this.coOccurrence.get(from)?.get(to) ?? 0
    if (joint === 0 || this.pairTotal === 0) return 0
    const pJoint = joint / (2 * this.pairTotal)
    const total = [...this.occurrences.values()].reduce((sum, value) => sum + value, 0)
    const pFrom = (this.occurrences.get(from) ?? 0) / Math.max(1, total)
    const pTo = (this.occurrences.get(to) ?? 0) / Math.max(1, total)
    if (pFrom === 0 || pTo === 0) return 0
    const pmi = Math.log2(pJoint / (pFrom * pTo))
    if (pmi <= 0) return 0

    // Raw PMI is biased towards rare pairs: two things seen together twice, each
    // rare on its own, outscore a routine seen every day. Untreated, every
    // coincidence looks like a habit. The Pantel-Lin discount weights the score
    // by how much evidence stands behind it.
    const observedFrom = this.occurrences.get(from) ?? 0
    const observedTo = this.occurrences.get(to) ?? 0
    const rarest = Math.min(observedFrom, observedTo)
    const discount = (joint / (joint + 1)) * (rarest / (rarest + 1))
    return (pmi / Math.log2(2 + this.fan(to))) * discount
  }

  edges(minimumWeight = 0): AssociationEdge[] {
    const found: AssociationEdge[] = []
    for (const [from, row] of this.coOccurrence) {
      for (const [to, count] of row) {
        const weight = this.association(from, to)
        if (weight > minimumWeight) found.push({ from, to, weight, count })
      }
    }
    return found.sort((a, b) => b.weight - a.weight)
  }

  /**
   * Spreading activation from a set of seeds. Activation divides among a
   * signature's associates rather than being copied, so a hub cannot amplify
   * itself, and decays each hop.
   */
  spread(seeds: string[], options: Partial<MemoryModelOptions> = {}): Map<string, number> {
    const { hopDecay, hops } = { ...this.options, ...options }
    const activation = new Map<string, number>()
    let frontier = new Map<string, number>()
    for (const seed of seeds) if (this.occurrences.has(seed)) frontier.set(seed, 1)
    for (const [signature, value] of frontier) activation.set(signature, value)

    for (let hop = 0; hop < hops; hop += 1) {
      const next = new Map<string, number>()
      for (const [signature, value] of frontier) {
        const associates = [...(this.neighbours.get(signature) ?? [])]
          .map((candidate) => ({ candidate, weight: this.association(signature, candidate) }))
          .filter((entry) => entry.weight > 0)
        const totalWeight = associates.reduce((sum, entry) => sum + entry.weight, 0)
        if (totalWeight === 0) continue
        for (const { candidate, weight } of associates) {
          const delivered = value * hopDecay * (weight / totalWeight)
          if (delivered <= 0.001) continue
          next.set(candidate, (next.get(candidate) ?? 0) + delivered)
        }
      }
      for (const [signature, value] of next) activation.set(signature, Math.max(activation.get(signature) ?? 0, value))
      frontier = next
      if (frontier.size === 0) break
    }
    return activation
  }

  /**
   * Cuts the stream into episodes at prediction-error spikes and pauses. The
   * same statistic that ranks memories decides where one piece of work ended.
   */
  segment(events: AmbientEvent[], options: Partial<SegmentationOptions> = {}): Episode[] {
    const settings = { ...defaultSegmentation, ...options }
    const ordered = [...events].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    const episodes: Episode[] = []
    let current: AmbientEvent[] = []
    let boundary: Episode['boundary'] = 'stream_start'
    let boundaryBits = 0

    const flush = () => {
      if (current.length === 0) return
      episodes.push(buildEpisode(current, boundary, boundaryBits, episodes.length))
      current = []
    }

    let previous: AmbientEvent | null = null
    // Boundaries are judged between salient signatures. Glancing at an
    // always-open chat window does not end the task you were doing.
    let lastSalient: string | null = null
    for (const event of ordered) {
      const background = this.isHub(event.signature)
      if (previous) {
        const gap = Date.parse(event.startedAt) - Date.parse(previous.endedAt)
        const bits = background || !lastSalient || lastSalient === event.signature
          ? 0
          : this.surprise(lastSalient, event.signature)
        const first = current[0]
        const elapsed = first ? Date.parse(event.startedAt) - Date.parse(first.startedAt) : 0
        if (gap > settings.idleGapMs) { flush(); boundary = 'idle_gap'; boundaryBits = bits }
        else if (elapsed > settings.maxEpisodeMs) { flush(); boundary = 'max_duration'; boundaryBits = bits }
        else if (bits >= settings.boundaryBits) { flush(); boundary = 'surprise'; boundaryBits = bits }
      }
      current.push(event)
      previous = event
      if (!background) lastSalient = event.signature
    }
    flush()
    return episodes
  }
}

function buildEpisode(events: AmbientEvent[], boundary: Episode['boundary'], boundaryBits: number, index: number): Episode {
  const first = events[0]
  const last = events[events.length - 1]
  const startedAt = first?.startedAt ?? ''
  const endedAt = last?.endedAt ?? startedAt
  const apps = [...new Set(events.map((event) => event.app))]
  const byDwell = new Map<string, number>()
  for (const event of events) byDwell.set(event.windowTitle, (byDwell.get(event.windowTitle) ?? 0) + event.durationMs)
  // The gist is what you spent the episode on, not merely what opened it.
  const dominant = [...byDwell.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? apps[0] ?? 'activity'
  return {
    id: `ep_${startedAt}_${index}`,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    momentIds: events.map((event) => `amb:${event.id}`),
    apps,
    boundary,
    boundaryBits: Number(boundaryBits.toFixed(2)),
    gist: `${dominant}${apps.length > 1 ? ` · ${apps.length} apps` : ''}`,
  }
}
