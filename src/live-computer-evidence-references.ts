type Context = Record<string, unknown>
const object = (value: unknown): value is Context => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

const format = 'Evidence references v1. References name a sequence in recentTransitions in this JSON. textRef means its observed text followed by its evidence, joined with newline. observationRef means observedState=observed and evidence=evidence. References do not change status, source, authority, or freshness.'

/** Request-local, exact deduplication only. No persisted state, receipt,
 * artifact, failed observation, or uncertainty is removed or summarized.
 * The full source observation remains in this same model request. */
export function referenceRepeatedEvidence(context: Context): Context {
  if ('evidenceReferenceFormat' in context || !Array.isArray(context.recentTransitions)) return context
  if (object(context.taskContext) && Array.isArray(context.taskContext.evidence) && context.taskContext.evidence.some(entry => object(entry) && 'textRef' in entry)) return context
  if (object(context.executive) && Array.isArray(context.executive.attempts) && context.executive.attempts.some(entry => object(entry) && 'observationRef' in entry)) return context
  const all = context.recentTransitions.filter(object)
  const sources = all.filter(t => Number.isSafeInteger(t.sequence) && t.status === 'verified'
    && typeof t.observed === 'string' && strings(t.evidence)
    && all.filter(other => other.sequence === t.sequence).length === 1)
  if (!sources.length) return context
  let references = 0
  const taskContext = object(context.taskContext) && Array.isArray(context.taskContext.evidence)
    ? { ...context.taskContext, evidence: context.taskContext.evidence.map(entry => {
      if (!object(entry) || entry.source !== 'verified_observation' || typeof entry.text !== 'string' || 'textRef' in entry) return entry
      const source = sources.find(t => t.sequence === entry.sequence && entry.text === [t.observed, ...(t.evidence as string[])].join('\n'))
      if (!source) return entry
      const metadata = { ...entry }; delete metadata.text
      references++
      return { ...metadata, textRef: { transitionSequence: source.sequence } }
    }) } : context.taskContext
  const executive = object(context.executive) && Array.isArray(context.executive.attempts)
    ? { ...context.executive, attempts: context.executive.attempts.map(entry => {
      if (!object(entry) || entry.status !== 'succeeded' || typeof entry.observedState !== 'string' || !strings(entry.evidence) || 'observationRef' in entry) return entry
      const source = sources.find(t => t.observed === entry.observedState && JSON.stringify(t.evidence) === JSON.stringify(entry.evidence))
      if (!source) return entry
      const metadata = { ...entry }; delete metadata.observedState; delete metadata.evidence
      references++
      return { ...metadata, observationRef: { transitionSequence: source.sequence } }
    }) } : context.executive
  if (!references) return context
  const candidate = { ...context, ...('taskContext' in context ? { taskContext } : {}), ...('executive' in context ? { executive } : {}), evidenceReferenceFormat: format }
  // Include the reference explanation in the comparison. Small contexts
  // stay in their original representation rather than getting larger.
  return JSON.stringify(candidate).length < JSON.stringify(context).length ? candidate : context
}

/** Offline integrity checker for this versioned representation. Never treats
 * arbitrary nested objects or page strings as instructions/references. */
export function expandRepeatedEvidence(context: Context): Context {
  if (context.evidenceReferenceFormat !== format) return context
  if (!Array.isArray(context.recentTransitions)) throw new Error('Missing reference sources')
  const transitions = context.recentTransitions.filter(object)
  const sourceFor = (ref: unknown) => {
    if (!object(ref) || !Number.isSafeInteger(ref.transitionSequence)) throw new Error('Invalid evidence reference')
    const matches = transitions.filter(t => t.sequence === ref.transitionSequence)
    const source = matches[0]
    if (matches.length !== 1 || !source || source.status !== 'verified' || typeof source.observed !== 'string' || !strings(source.evidence)) throw new Error('Missing or ambiguous verified evidence')
    return source
  }
  const expanded = { ...context }; delete expanded.evidenceReferenceFormat
  if (object(context.taskContext) && Array.isArray(context.taskContext.evidence)) expanded.taskContext = {
    ...context.taskContext, evidence: context.taskContext.evidence.map(entry => {
      if (!object(entry) || !('textRef' in entry)) return entry
      const source = sourceFor(entry.textRef)
      const metadata = { ...entry }; delete metadata.textRef
      return { ...metadata, text: [source.observed, ...(source.evidence as string[])].join('\n') }
    }),
  }
  if (object(context.executive) && Array.isArray(context.executive.attempts)) expanded.executive = {
    ...context.executive, attempts: context.executive.attempts.map(entry => {
      if (!object(entry) || !('observationRef' in entry)) return entry
      const source = sourceFor(entry.observationRef)
      const metadata = { ...entry }; delete metadata.observationRef
      return { ...metadata, observedState: source.observed, evidence: source.evidence }
    }),
  }
  return expanded
}
