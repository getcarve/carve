import type {
  ActionSpec,
  LearningSession,
  ObservationRecord,
  ProcedureEvidenceSummary,
  ProcedureGraph,
  ProcedureParameter,
  ProcedureVersion,
  WorkflowEdge,
  WorkflowStep,
} from '../types.js'
import { clamp, id, nowIso, sha256 } from '../util.js'
import { markerForParameter } from '../parameters.js'

export interface DemonstrationEpisode {
  session: LearningSession
  observations: ObservationRecord[]
  result: 'complete' | 'interrupted' | 'quarantined'
}

interface ObservedTransition {
  tool: 'browser.click' | 'browser.fill'
  fromState: string
  toState: string
  target: string
  controlName: string
  before: ObservationRecord
  after: ObservationRecord
  verificationKey: string
  verificationExpected: string | number | boolean
  fillValue?: string
}

interface TransitionVariant {
  tool: 'browser.click' | 'browser.fill'
  fromState: string
  toState: string
  target: string
  controlName: string
  evidence: ObservationRecord[]
  beforeEvidence: ObservationRecord[]
  afterEvidence: ObservationRecord[]
  verificationKey: string
  verificationExpected: string | number | boolean
  fillValues: string[]
}

const ignoredBranchKeys = new Set(['view', 'outcome', 'revision', 'requestId'])

export function browserLearningKey(goal: string): string {
  return `semantic-browser:${sha256(goal.trim().toLowerCase()).slice(0, 16)}`
}

export function isSemanticBrowserDemonstration(observations: ObservationRecord[]): boolean {
  return observations.some((observation) => observation.source !== 'fixture')
}

export function assessEpisode(session: LearningSession, observations: ObservationRecord[]): DemonstrationEpisode {
  const included = observations.filter((observation) => !observation.excluded)
  const quarantined = included.some((observation) => observation.injectionSignals.length > 0)
  const reachedVerifiedOutcome = included.some((observation) => {
    const outcome = observation.facts.state.outcome
    return observation.facts.state.view === 'complete' && typeof outcome === 'string' && outcome !== 'pending'
  })
  return {
    session,
    observations: included,
    result: quarantined ? 'quarantined' : reachedVerifiedOutcome ? 'complete' : 'interrupted',
  }
}

export function buildSemanticBrowserProcedure(
  session: LearningSession,
  episodes: DemonstrationEpisode[],
  previous: ProcedureVersion | null,
): ProcedureVersion {
  const complete = episodes.filter((episode) => episode.result === 'complete')
  const interrupted = episodes.filter((episode) => episode.result === 'interrupted')
  const quarantined = episodes.filter((episode) => episode.result === 'quarantined')
  const transitions = complete.flatMap((episode) => observedTransitions(episode.observations))
  const variants = mergeTransitionVariants(transitions)
  const branchValues: Record<string, string[]> = {}
  const parameters = procedureParameters(variants)
  const graph = variants.length > 0
    ? transitionGraph(variants, interrupted, quarantined, branchValues)
    : evidenceOnlyGraph(interrupted, quarantined)
  const confidence = confidenceFor(complete.length, interrupted.length, quarantined.length, variants)
  const allObservations = uniqueObservations(episodes.flatMap((episode) => episode.observations))
  const evidenceSummary: ProcedureEvidenceSummary = {
    inductionMethod: 'semantic_transition_alignment',
    completedSessionIds: complete.map((episode) => episode.session.id),
    interruptedSessionIds: interrupted.map((episode) => episode.session.id),
    quarantinedSessionIds: quarantined.map((episode) => episode.session.id),
    observedBranchValues: branchValues,
  }

  return {
    procedureId: previous?.procedureId ?? id('procedure'),
    version: previous ? previous.version + 1 : 1,
    learningKey: browserLearningKey(session.goalHint),
    name: previous?.name ?? session.name,
    goal: session.goalHint,
    confidence,
    inputs: ['current record identifier', ...parameters.map((parameter) => parameter.label), ...Object.keys(branchValues).map((key) => `current ${humanize(key).toLowerCase()}`)],
    parameters,
    outputs: complete.length > 0 ? ['verified completion in the allowlisted browser sandbox'] : [],
    graph,
    provenanceObservationIds: allObservations.map((observation) => observation.id),
    evidenceSummary,
    correctionSummary: null,
    createdAt: nowIso(),
  }
}

function observedTransitions(observations: ObservationRecord[]): ObservedTransition[] {
  const ordered = [...observations].sort((left, right) => left.sequence - right.sequence)
  const candidates: Array<Omit<ObservedTransition, 'fromState' | 'toState'>> = []
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const before = ordered[index]
    const after = ordered[index + 1]
    if (!before || !after) continue
    const verification = inferVerification(before, after)
    if (!verification) continue
    const viewChanged = before.facts.state.view !== after.facts.state.view
    const control = viewChanged ? inferControl(before, after) : null
    const fill = viewChanged ? null : inferFillControl(before, after, verification)
    if (control) candidates.push({ tool: 'browser.click', target: control.identifier, controlName: control.name, before, after, verificationKey: verification.key, verificationExpected: verification.expected })
    else if (fill) candidates.push({ tool: 'browser.fill', target: fill.identifier, controlName: fill.name, before, after, verificationKey: verification.key, verificationExpected: verification.expected, fillValue: fill.value })
  }
  const phaseKeys = uniqueStrings(['view', 'outcome', ...candidates.map((candidate) => candidate.verificationKey)])
  const filledKeys = new Set(candidates.filter((candidate) => candidate.tool === 'browser.fill').map((candidate) => candidate.verificationKey))
  return candidates.map((candidate) => ({
    ...candidate,
    fromState: phaseSignature(candidate.before, phaseKeys, filledKeys),
    toState: phaseSignature(candidate.after, phaseKeys, filledKeys),
  })).filter((transition) => transition.fromState !== transition.toState)
}

function inferControl(before: ObservationRecord, after: ObservationRecord): { identifier: string; name: string } | null {
  const controls = (before.facts.accessibility ?? [])
    .filter((element): element is typeof element & { identifier: string } => element.role === 'button' && Boolean(element.identifier))
  if (controls.length === 1) return { identifier: controls[0]!.identifier, name: controls[0]!.name }
  const changedValues = changedState(before, after).flatMap(({ value }) => tokenize(String(value)))
  const ranked = controls.map((control) => ({
    control,
    score: tokenize(`${control.identifier} ${control.name}`).filter((token) => changedValues.includes(token)).length,
  })).sort((left, right) => right.score - left.score)
  if (!ranked[0] || ranked[0].score === 0 || ranked[0].score === ranked[1]?.score) return null
  return { identifier: ranked[0].control.identifier, name: ranked[0].control.name }
}

function inferFillControl(
  before: ObservationRecord,
  after: ObservationRecord,
  verification: { key: string; expected: string | number | boolean },
): { identifier: string; name: string; value: string } | null {
  if (typeof verification.expected !== 'string') return null
  const beforeElements = before.facts.accessibility ?? []
  const afterElements = after.facts.accessibility ?? []
  for (const element of afterElements) {
    if (!element.identifier || element.sensitive || !['textbox', 'searchbox'].includes(element.role) || element.value !== verification.expected) continue
    const prior = beforeElements.find((candidate) => candidate.identifier === element.identifier)
    if (prior?.value === element.value) continue
    if (element.identifier !== verification.key) continue
    return { identifier: element.identifier, name: element.name || humanize(element.identifier), value: verification.expected }
  }
  return null
}

function inferVerification(before: ObservationRecord, after: ObservationRecord): { key: string; expected: string | number | boolean } | null {
  const changes = changedState(before, after)
  const selected = changes.find((change) => change.key === 'outcome' && change.value !== 'pending')
    ?? changes.find((change) => change.key === 'view')
    ?? changes.find((change) => change.key !== 'revision')
  return selected && primitiveValue(selected.value) ? { key: selected.key, expected: selected.value } : null
}

function changedState(before: ObservationRecord, after: ObservationRecord): Array<{ key: string; value: string | number | boolean }> {
  return Object.entries(after.facts.state).flatMap(([key, value]) => {
    if (!primitiveValue(value) || before.facts.state[key] === value) return []
    return [{ key, value }]
  })
}

function mergeTransitionVariants(transitions: ObservedTransition[]): TransitionVariant[] {
  const bySignature = new Map<string, TransitionVariant>()
  for (const transition of transitions) {
    const signature = `${transition.fromState}\u0000${transition.toState}\u0000${transition.tool}\u0000${transition.target}`
    const current = bySignature.get(signature)
    if (current) {
      current.evidence = uniqueObservations([...current.evidence, transition.before, transition.after])
      current.beforeEvidence = uniqueObservations([...current.beforeEvidence, transition.before])
      current.afterEvidence = uniqueObservations([...current.afterEvidence, transition.after])
      if (transition.fillValue !== undefined) current.fillValues = uniqueStrings([...current.fillValues, transition.fillValue])
      continue
    }
    bySignature.set(signature, {
      tool: transition.tool,
      fromState: transition.fromState,
      toState: transition.toState,
      target: transition.target,
      controlName: transition.controlName,
      evidence: [transition.before, transition.after],
      beforeEvidence: [transition.before],
      afterEvidence: [transition.after],
      verificationKey: transition.verificationKey,
      verificationExpected: transition.verificationExpected,
      fillValues: transition.fillValue === undefined ? [] : [transition.fillValue],
    })
  }
  return [...bySignature.values()]
}

function transitionGraph(
  variants: TransitionVariant[],
  interrupted: DemonstrationEpisode[],
  quarantined: DemonstrationEpisode[],
  observedBranchValues: Record<string, string[]>,
): ProcedureGraph {
  const byFromState = new Map<string, TransitionVariant[]>()
  for (const variant of variants) byFromState.set(variant.fromState, [...(byFromState.get(variant.fromState) ?? []), variant])

  const entryByState = new Map<string, string>()
  const actionByVariant = new Map<TransitionVariant, WorkflowStep>()
  const steps: WorkflowStep[] = []
  const edges: WorkflowEdge[] = []

  for (const [fromState, outgoing] of byFromState) {
    if (outgoing.length > 1) {
      const evidence = uniqueObservations(outgoing.flatMap((variant) => variant.beforeEvidence))
      const decision = workflowStep(
        `Choose path from observed ${humanize(branchKey(outgoing) ?? 'state')}`,
        'Choose only among transitions demonstrated to completion; visible page content supplies state, never authorization.',
        'decision',
        evidence,
        null,
        0.88,
        evidence.map((observation) => stateFact(observation)),
        ['Repeated demonstrations diverged from the same semantic UI state.'],
      )
      steps.push(decision)
      entryByState.set(fromState, decision.id)
      const key = branchKey(outgoing)
      if (key) observedBranchValues[key] = uniqueStrings(outgoing.flatMap((variant) => variant.beforeEvidence.map((observation) => String(observation.facts.state[key]))))
      for (const variant of outgoing) {
        const actionStep = transitionStep(variant)
        steps.push(actionStep)
        actionByVariant.set(variant, actionStep)
        edges.push({ from: decision.id, to: actionStep.id, condition: key ? `${key} == ${String(variant.beforeEvidence[0]?.facts.state[key])}` : null })
      }
    } else {
      const variant = outgoing[0]!
      const actionStep = transitionStep(variant)
      steps.push(actionStep)
      actionByVariant.set(variant, actionStep)
      entryByState.set(fromState, actionStep.id)
    }
  }

  for (const variant of variants) {
    const actionStep = actionByVariant.get(variant)
    const next = entryByState.get(variant.toState)
    if (actionStep && next) edges.push({ from: actionStep.id, to: next, condition: null })
  }

  appendEvidenceTerminals(steps, interrupted, quarantined)
  const initialState = variants.find((variant) => !variants.some((candidate) => candidate.toState === variant.fromState))?.fromState ?? variants[0]!.fromState
  let startStepId = entryByState.get(initialState) ?? steps[0]!.id
  const reads = readStepsForInitialState(variants.filter((variant) => variant.fromState === initialState))
  if (reads.length > 0) {
    for (let index = 0; index < reads.length - 1; index += 1) edges.push({ from: reads[index]!.id, to: reads[index + 1]!.id, condition: null })
    edges.push({ from: reads.at(-1)!.id, to: startStepId, condition: null })
    steps.unshift(...reads)
    startStepId = reads[0]!.id
  }
  return { startStepId, steps, edges }
}

function transitionStep(variant: TransitionVariant): WorkflowStep {
  const parameterized = variant.tool === 'browser.fill' && variant.fillValues.length > 1
  const parameterId = parameterized ? variant.target : null
  const expected = parameterId ? markerForParameter(parameterId) : variant.verificationExpected
  const actionSpec: ActionSpec = {
    id: id('action'),
    tool: variant.tool,
    input: variant.tool === 'browser.fill'
      ? parameterId ? { target: variant.target, parameterId } : { target: variant.target, value: variant.fillValues[0] }
      : { target: variant.target },
    risk: 'reversible_write',
    sensitiveClass: null,
    stateChanging: true,
    preview: variant.tool === 'browser.fill' ? parameterId ? `Fill “${variant.controlName}” with supplied workflow input` : `Fill “${variant.controlName}” with the demonstrated safe value` : `Click “${variant.controlName}” in the isolated local browser`,
    expectedStateChange: `${humanize(variant.verificationKey)} becomes ${String(expected)}`,
    verification: { method: 'state_equals', target: variant.verificationKey, expected },
    group: 'browser-demonstration',
  }
  const result = workflowStep(
    variant.tool === 'browser.fill' ? `Fill ${variant.controlName || humanize(variant.target)}` : variant.controlName || humanize(variant.target),
    `Replay the demonstrated transition from ${humanize(variant.fromState)} to ${humanize(variant.toState)} and verify the result before continuing.`,
    'action',
    variant.evidence,
    actionSpec,
    Math.min(0.96, 0.82 + variant.beforeEvidence.length * 0.04),
    variant.evidence.map((observation) => stateFact(observation)),
    [`The control identifier “${variant.target}” was aligned with a verified ${variant.fromState} → ${variant.toState} transition.${parameterId ? ` ${variant.fillValues.length} distinct safe values support a runtime parameter.` : ''}`],
  )
  result.preconditions = [`Browser semantic state equals ${variant.fromState}`, `Control ${variant.target} is visible`]
  result.postconditions = [`${variant.verificationKey} equals ${String(expected)}`]
  return result
}

function procedureParameters(variants: TransitionVariant[]): ProcedureParameter[] {
  return variants.flatMap((variant): ProcedureParameter[] => {
    if (variant.tool !== 'browser.fill' || variant.fillValues.length < 2) return []
    return [{
      id: variant.target,
      label: variant.controlName || humanize(variant.target),
      type: 'safe_text',
      required: true,
      sensitive: false,
      constraints: { minLength: 1, maxLength: 160 },
      examples: variant.fillValues,
      evidenceObservationIds: uniqueObservations(variant.evidence).map((observation) => observation.id),
      confidence: Math.min(0.96, 0.78 + variant.fillValues.length * 0.07),
    }]
  })
}

function readStepsForInitialState(initialVariants: TransitionVariant[]): WorkflowStep[] {
  const evidence = uniqueObservations(initialVariants.flatMap((variant) => variant.beforeEvidence))
  const readable = new Map<string, { name: string; value: string; evidence: ObservationRecord[] }>()
  for (const observation of evidence) {
    for (const element of observation.facts.accessibility ?? []) {
      if (!element.identifier || element.sensitive || element.role !== 'status' || !element.value) continue
      if (observation.facts.state[element.identifier] !== element.value) continue
      const existing = readable.get(element.identifier)
      if (existing && existing.value !== element.value) {
        readable.delete(element.identifier)
        continue
      }
      readable.set(element.identifier, { name: element.name, value: element.value, evidence: uniqueObservations([...(existing?.evidence ?? []), observation]) })
    }
  }
  return [...readable.entries()].map(([target, item]) => {
    const action: ActionSpec = {
      id: id('action'), tool: 'browser.read', input: { target }, risk: 'read_only', sensitiveClass: null, stateChanging: false,
      preview: `Read “${item.name || humanize(target)}” from the isolated local browser`,
      expectedStateChange: 'No state change; confirm the demonstrated precondition',
      verification: { method: 'state_equals', target, expected: item.value }, group: 'browser-demonstration',
    }
    const result = workflowStep(`Read ${item.name || humanize(target)}`, 'Read an allowlisted non-sensitive value and verify the demonstrated precondition before writing.', 'action', item.evidence, action, 0.9, item.evidence.map((observation) => stateFact(observation)), ['The semantic status value was stable at the workflow entry state.'])
    result.preconditions = [`Readable value ${target} is visible and non-sensitive`]
    result.postconditions = [`${target} equals ${item.value}`]
    return result
  })
}

function evidenceOnlyGraph(interrupted: DemonstrationEpisode[], quarantined: DemonstrationEpisode[]): ProcedureGraph {
  const steps: WorkflowStep[] = []
  appendEvidenceTerminals(steps, interrupted, quarantined)
  if (steps.length === 0) {
    steps.push(workflowStep('Insufficient evidence', 'No completed semantic transition was captured.', 'terminal', [], null, 0.2, ['No verified outcome was observed.'], ['Replay is disabled until a completed demonstration is available.']))
  }
  return { startStepId: steps[0]!.id, steps, edges: [] }
}

function appendEvidenceTerminals(steps: WorkflowStep[], interrupted: DemonstrationEpisode[], quarantined: DemonstrationEpisode[]): void {
  if (interrupted.length > 0) {
    const evidence = uniqueObservations(interrupted.flatMap((episode) => episode.observations))
    steps.push(workflowStep(
      'Incomplete demonstration — not replayed',
      'This episode ended without a verified outcome. It is retained as failure evidence but contributes no executable action.',
      'terminal', evidence, null, 0.99,
      evidence.map((observation) => stateFact(observation)),
      ['Fail-closed classification based on the absence of a completed outcome.'],
    ))
  }
  if (quarantined.length > 0) {
    const evidence = uniqueObservations(quarantined.flatMap((episode) => episode.observations))
    steps.push(workflowStep(
      'Quarantined screen instructions — not replayed',
      'Potential prompt-injection content is retained for review and excluded from executable transitions.',
      'terminal', evidence, null, 0.99,
      evidence.map((observation) => stateFact(observation)),
      ['Untrusted screen instructions must never become authorization or procedure actions.'],
    ))
  }
}

function workflowStep(
  name: string,
  description: string,
  kind: WorkflowStep['kind'],
  evidence: ObservationRecord[],
  action: ActionSpec | null,
  confidence: number,
  factBasis: string[],
  interpretation: string[],
): WorkflowStep {
  return {
    id: id('step'), name, description, kind, preconditions: [], postconditions: [], confidence, action,
    evidenceObservationIds: uniqueObservations(evidence).map((observation) => observation.id), factBasis, interpretation,
  }
}

function branchKey(variants: TransitionVariant[]): string | null {
  const phaseKeys = new Set(variants.map((variant) => variant.verificationKey))
  const keys = uniqueStrings(variants.flatMap((variant) => variant.beforeEvidence.flatMap((observation) => Object.keys(observation.facts.state))))
    .filter((key) => !ignoredBranchKeys.has(key) && !phaseKeys.has(key))
  for (const key of keys) {
    const values = variants.map((variant) => uniqueStrings(variant.beforeEvidence.map((observation) => String(observation.facts.state[key]))))
    if (values.every((items) => items.length === 1) && new Set(values.map((items) => items[0])).size === variants.length) return key
  }
  return null
}

function phaseSignature(observation: ObservationRecord, keys: string[], filledKeys: Set<string>): string {
  return keys.map((key) => {
    const value = observation.facts.state[key] ?? ''
    return `${key}=${filledKeys.has(key) && typeof value === 'string' && value.length > 0 ? '<filled>' : String(value)}`
  }).join('|')
}

function confidenceFor(completed: number, interrupted: number, quarantined: number, variants: TransitionVariant[]): number {
  if (completed === 0) return quarantined > 0 ? 0.12 : 0.34
  const branchStates = new Set(variants.map((variant) => variant.fromState)).size
  return clamp(0.68 + Math.min(completed, 3) * 0.07 + Math.min(variants.length, 4) * 0.035 + Math.min(branchStates, 3) * 0.02 - interrupted * 0.01 - quarantined * 0.18)
}

function stateFact(observation: ObservationRecord): string {
  const state = Object.entries(observation.facts.state).filter(([, value]) => primitiveValue(value)).map(([key, value]) => `${key}=${String(value)}`).join(', ')
  return `Observed ${observation.facts.windowTitle}: ${state}`
}

function primitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 1 && token !== 'reviewed' && token !== 'complete')
}

function humanize(value: string): string {
  return value.replace(/[-_]+/gu, ' ').replace(/^./u, (character) => character.toUpperCase())
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function uniqueObservations(observations: ObservationRecord[]): ObservationRecord[] {
  return [...new Map(observations.map((observation) => [observation.id, observation])).values()]
}
