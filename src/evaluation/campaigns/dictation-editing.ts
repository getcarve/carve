import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { id, nowIso, sha256 } from '../../util.js'
import type {
  EvaluationCampaignManifest,
  EvaluationFailure,
  EvaluationObservation,
  EvaluationScenario,
  EvaluationTraceEntry,
} from '../contracts.js'
import type { RegisteredEvaluationScenario } from '../runner.js'

export interface DictationDraft {
  begin(text: string): void
  claim(): boolean
  isClaimed(): boolean
  update(transcript: string, interim: string): string | null
  finish(transcript: string): string | null
  cancel(): void
}

export type DictationDraftFactory = () => DictationDraft

type DictationRaceEvent =
  | { kind: 'begin' }
  | { kind: 'state'; transcript: string; interim: string }
  | { kind: 'edit'; value: string }
  | { kind: 'finish'; transcript: string }
  | { kind: 'cancel' }
  | { kind: 'reset' }
  | { kind: 'submit' }

interface DictationRaceSpec {
  id: string
  title: string
  initial: string
  events: DictationRaceEvent[]
  expectedField: string
  expectedSubmitted?: string
  tags: string[]
}

const raceSpecs: DictationRaceSpec[] = [
  {
    id: 'dictation_edit_late_final',
    title: 'Manual correction survives a late final transcript',
    initial: 'Earlier context',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'Who scored', interim: 'the winner' },
      { kind: 'edit', value: 'Earlier context Who scored the winning goal' },
      { kind: 'state', transcript: 'Who scored the winner?', interim: '' },
      { kind: 'finish', transcript: 'Who scored the winner?' },
    ],
    expectedField: 'Earlier context Who scored the winning goal',
    tags: ['manual-edit', 'late-final', 'collapsed-capsule'],
  },
  {
    id: 'dictation_stop_edit_race',
    title: 'Edit during stop flush retains the user value',
    initial: '',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'Schedule', interim: 'the review' },
      { kind: 'edit', value: 'Schedule the review for Friday' },
      { kind: 'finish', transcript: 'Schedule the review for Thursday' },
    ],
    expectedField: 'Schedule the review for Friday',
    tags: ['manual-edit', 'stop', 'late-final'],
  },
  {
    id: 'dictation_interim_churn',
    title: 'Interim revisions collapse into one final transcript',
    initial: 'Please',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'send', interim: 'the draft' },
      { kind: 'state', transcript: 'send the draft', interim: 'tomorrow' },
      { kind: 'finish', transcript: 'send the draft tomorrow' },
    ],
    expectedField: 'Please send the draft tomorrow',
    tags: ['interim', 'finalization', 'deduplication'],
  },
  {
    id: 'dictation_edit_before_first_state',
    title: 'An immediate edit claims the field before recognition responds',
    initial: 'Use the revised date',
    events: [
      { kind: 'begin' },
      { kind: 'edit', value: 'Use the revised date, August 30' },
      { kind: 'state', transcript: 'Use the date August 13', interim: '' },
      { kind: 'finish', transcript: 'Use the date August 13' },
    ],
    expectedField: 'Use the revised date, August 30',
    tags: ['manual-edit', 'early-edit', 'late-state'],
  },
  {
    id: 'dictation_cancel_stale_result',
    title: 'A cancelled draft ignores stale recognition results',
    initial: '',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'Open', interim: 'the report' },
      { kind: 'cancel' },
      { kind: 'edit', value: 'Open the report manually' },
      { kind: 'state', transcript: 'Open the old report', interim: '' },
      { kind: 'finish', transcript: 'Open the old report' },
    ],
    expectedField: 'Open the report manually',
    tags: ['cancel', 'stale-state', 'manual-edit'],
  },
  {
    id: 'dictation_submit_after_edit',
    title: 'Submit after a correction uses the corrected field',
    initial: '',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'Ask about', interim: 'the invoice' },
      { kind: 'edit', value: 'Ask about the March invoice' },
      { kind: 'finish', transcript: 'Ask about the May invoice' },
      { kind: 'submit' },
    ],
    expectedField: 'Ask about the March invoice',
    expectedSubmitted: 'Ask about the March invoice',
    tags: ['submit', 'manual-edit', 'late-final'],
  },
  {
    id: 'dictation_pristine_finish',
    title: 'Unedited dictation commits its final transcript',
    initial: '',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'Compare', interim: 'the files' },
      { kind: 'finish', transcript: 'Compare the files' },
    ],
    expectedField: 'Compare the files',
    tags: ['positive-control', 'finalization'],
  },
  {
    id: 'dictation_final_not_duplicated',
    title: 'A final matching the live preview is not appended twice',
    initial: 'Follow up:',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'check the status', interim: '' },
      { kind: 'finish', transcript: 'check the status' },
    ],
    expectedField: 'Follow up: check the status',
    tags: ['deduplication', 'finalization', 'prefilled-text'],
  },
  {
    id: 'dictation_multiline_base',
    title: 'Dictation preserves pre-existing multiline context',
    initial: 'First line\nSecond line',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'add', interim: 'the conclusion' },
      { kind: 'finish', transcript: 'add the conclusion' },
    ],
    expectedField: 'First line\nSecond line add the conclusion',
    tags: ['prefilled-text', 'multiline', 'finalization'],
  },
  {
    id: 'dictation_session_reset',
    title: 'A reset prevents the prior session from owning the new field',
    initial: '',
    events: [
      { kind: 'begin' },
      { kind: 'state', transcript: 'old', interim: 'request' },
      { kind: 'reset' },
      { kind: 'state', transcript: 'stale old request', interim: '' },
      { kind: 'begin' },
      { kind: 'state', transcript: 'new', interim: 'request' },
      { kind: 'finish', transcript: 'new request' },
    ],
    expectedField: 'new request',
    tags: ['session-reset', 'stale-state', 'finalization'],
  },
]

export function loadCompactDictationDraftFactory(htmlPath: string): DictationDraftFactory {
  const html = readFileSync(htmlPath, 'utf8')
  const source = html.match(/const createDictationDraft = (\(\) => \{[\s\S]*?^ {8}\})\n {8}const dictationDraft/mu)?.[1]
  if (!source) throw new Error('The compact capsule does not expose its dependency-free dictation draft state')
  const factory = runInNewContext(`(${source})`, Object.create(null), { timeout: 100 }) as unknown
  if (typeof factory !== 'function') throw new Error('The compact dictation draft factory is invalid')
  return factory as DictationDraftFactory
}

function scenarioFor(spec: DictationRaceSpec): EvaluationScenario {
  return {
    id: spec.id,
    title: spec.title,
    family: 'dictation_field_ownership',
    goal: 'Preserve person-authored edits while streaming dictation is finalized in the collapsed Carve capsule.',
    environmentTier: 'pure',
    initialStateHash: sha256(spec.initial),
    referenceSolution: 'Recognition may update the field until an input event transfers ownership to the person; late recognition events then become inert.',
    expectedOutcome: {
      finalMatchesExpected: true,
      userEditPreserved: true,
      lateRecognitionIgnored: true,
      submittedMatchesExpected: true,
      duplicateTranscript: false,
      rawTextRetained: false,
    },
    invariants: [
      'A late recognition event cannot overwrite a person-authored correction.',
      'A final transcript is applied at most once.',
      'Cancelled or reset dictation cannot reclaim the field.',
      'No raw dictation text is written to Foundry artifacts.',
    ],
    perturbations: ['interim/final ordering', 'manual edit timing', 'stop timing', 'cancellation', 'session reset', 'prefilled text'],
    tags: spec.tags,
    split: 'regression',
    severity: spec.tags.includes('manual-edit') ? 'high' : 'medium',
  }
}

function traceEntry(sequence: number, phase: EvaluationTraceEntry['phase'], event: string, field: string, details: EvaluationTraceEntry['details']): EvaluationTraceEntry {
  return { sequence, occurredAt: nowIso(), phase, event, stateHash: sha256(field), details }
}

function executeRace(spec: DictationRaceSpec, factory: DictationDraftFactory, signal: AbortSignal): EvaluationObservation {
  const started = Date.now()
  const draft = factory()
  let field = spec.initial
  let submitted: string | null = null
  let claimed = false
  let lateRecognitionIgnored = true
  let sequence = 1
  const trace: EvaluationTraceEntry[] = [traceEntry(sequence, 'setup', 'initial_state', field, { fieldLength: field.length })]
  for (const event of spec.events) {
    if (signal.aborted) throw signal.reason ?? new Error('Evaluation trial aborted')
    sequence += 1
    if (event.kind === 'begin') {
      draft.begin(field)
      claimed = false
      trace.push(traceEntry(sequence, 'act', 'dictation_begin', field, { fieldLength: field.length }))
      continue
    }
    if (event.kind === 'state') {
      const before = field
      const next = draft.update(event.transcript, event.interim)
      if (next !== null) field = next
      if (claimed && field !== before) lateRecognitionIgnored = false
      trace.push(traceEntry(sequence, 'observe', 'recognition_state', field, {
        applied: next !== null,
        transcriptLength: event.transcript.length,
        interimLength: event.interim.length,
        fieldLength: field.length,
      }))
      continue
    }
    if (event.kind === 'edit') {
      field = event.value
      claimed = draft.claim()
      trace.push(traceEntry(sequence, 'act', 'person_edit', field, { claimed, fieldLength: field.length }))
      continue
    }
    if (event.kind === 'finish') {
      const before = field
      const next = draft.finish(event.transcript)
      if (next !== null) field = next
      if (claimed && field !== before) lateRecognitionIgnored = false
      trace.push(traceEntry(sequence, 'observe', 'recognition_final', field, {
        applied: next !== null,
        transcriptLength: event.transcript.length,
        fieldLength: field.length,
      }))
      continue
    }
    if (event.kind === 'cancel') {
      draft.cancel()
      trace.push(traceEntry(sequence, 'act', 'dictation_cancel', field, { fieldLength: field.length }))
      continue
    }
    if (event.kind === 'reset') {
      draft.cancel()
      field = ''
      claimed = false
      trace.push(traceEntry(sequence, 'act', 'capsule_session_reset', field, { fieldLength: 0 }))
      continue
    }
    submitted = field.trim()
    trace.push(traceEntry(sequence, 'act', 'submit', field, { submittedLength: submitted.length }))
  }

  const finalMatchesExpected = field === spec.expectedField
  const userEditPreserved = !spec.events.some((event) => event.kind === 'edit') || finalMatchesExpected
  const submittedMatchesExpected = spec.expectedSubmitted === undefined || submitted === spec.expectedSubmitted
  const duplicateTranscript = !finalMatchesExpected && field.length > spec.expectedField.length && field.includes(spec.expectedField)
  const invariantViolations: string[] = []
  if (!lateRecognitionIgnored) invariantViolations.push('A late recognition event changed the field after the person claimed it.')
  if (!userEditPreserved) invariantViolations.push('A person-authored correction was not preserved.')
  if (duplicateTranscript) invariantViolations.push('The final transcript was applied more than once.')
  let failure: EvaluationFailure | null = null
  if (!finalMatchesExpected || !submittedMatchesExpected || invariantViolations.length > 0) {
    failure = {
      cause: spec.events.some((event) => event.kind === 'edit') ? 'temporal_race' : 'input_transaction',
      objectiveKind: 'dictation_follow_up',
      actionKind: 'merge_transcript',
      applicationClass: 'collapsed_capsule',
      routeIdentity: 'follow_up_field',
      observationDelta: invariantViolations.length > 0 ? 'person_edit_overwritten' : 'unexpected_final_state',
      recoveryDisposition: 'fix_field_ownership',
      summary: invariantViolations[0] ?? 'The final field or submitted value did not match the deterministic oracle.',
    }
  }
  trace.push(traceEntry(sequence + 1, 'verify', 'outcome_grade_input', field, {
    finalMatchesExpected,
    userEditPreserved,
    lateRecognitionIgnored,
    submittedMatchesExpected,
    duplicateTranscript,
  }))
  return {
    finalState: {
      finalMatchesExpected,
      userEditPreserved,
      lateRecognitionIgnored,
      submittedMatchesExpected,
      duplicateTranscript,
      rawTextRetained: false,
      finalFieldHash: sha256(field),
      finalFieldLength: field.length,
    },
    trace,
    invariantViolations,
    unauthorizedEffects: [],
    failure,
    metrics: { actions: spec.events.length, modelCalls: 0, tokens: 0, costUsd: 0, latencyMs: Date.now() - started },
  }
}

export interface DictationEditingCampaignOptions {
  sourceHash: string
  factory: DictationDraftFactory
  campaignId?: string
  scenarioIds?: string[]
  repetitions?: number
  seeds?: number[]
}

export function buildDictationEditingCampaign(options: DictationEditingCampaignOptions): {
  manifest: EvaluationCampaignManifest
  registrations: RegisteredEvaluationScenario[]
} {
  const requested = options.scenarioIds ? new Set(options.scenarioIds) : null
  const selected = raceSpecs.filter((spec) => requested === null || requested.has(spec.id))
  if (selected.length === 0) throw new Error('The dictation campaign has no selected scenarios')
  if (requested && selected.length !== requested.size) {
    const known = new Set(selected.map((spec) => spec.id))
    throw new Error(`Unknown dictation scenario(s): ${[...requested].filter((scenarioId) => !known.has(scenarioId)).join(', ')}`)
  }
  const repetitions = options.repetitions ?? 3
  const seeds = options.seeds ?? [17, 29, 43].slice(0, repetitions)
  if (seeds.length !== repetitions) throw new Error('The dictation campaign needs one seed per repetition')
  const createdAt = nowIso()
  const manifest: EvaluationCampaignManifest = {
    schemaVersion: 1,
    id: options.campaignId ?? id('eval_dictation'),
    version: 1,
    name: 'Collapsed dictation field ownership',
    objective: 'Prove that the collapsed Carve capsule preserves person-authored edits across every approved live-dictation finalization ordering.',
    createdAt,
    source: { baseline: options.sourceHash, candidate: null },
    suite: {
      scenarioIds: selected.map((spec) => spec.id),
      repetitions,
      seeds,
      includeSplits: ['regression'],
    },
    environment: {
      tier: 'pure',
      ephemeral: true,
      accountClass: 'none',
      applications: ['Carve collapsed capsule'],
      windows: ['synthetic follow-up field'],
      network: { mode: 'deny', allowedDomains: [] },
    },
    effects: {
      allowed: ['none'],
      prohibited: ['read', 'local_input', 'reversible_write', 'external_communication', 'credential_entry', 'financial', 'destructive'],
    },
    budget: {
      maxTrials: selected.length * repetitions,
      maxActionsPerTrial: 12,
      maxModelCalls: 0,
      maxTokens: 0,
      maxRuntimeMs: 30_000,
      maxCostUsd: 0,
    },
    graders: [
      { id: 'outcome-state', kind: 'deterministic', required: true },
      { id: 'protected-invariants', kind: 'deterministic', required: true },
    ],
    retention: {
      artifactDays: 30,
      rawFrameDays: 0,
      retainRawAudio: false,
      transcriptPolicy: 'none',
    },
    stopConditions: {
      stopOnInvariantViolation: true,
      stopOnUnauthorizedEffect: true,
      maxInfrastructureErrors: 0,
    },
    promotion: {
      minimumOutcomeRate: 1,
      minimumPassPowK: 1,
      requireZeroSafetyViolations: true,
    },
    scheduled: false,
  }
  const registrations = selected.map((spec): RegisteredEvaluationScenario => ({
    scenario: scenarioFor(spec),
    execute: ({ signal }) => executeRace(spec, options.factory, signal),
  }))
  return { manifest, registrations }
}

export function dictationEditingScenarioIds(): string[] {
  return raceSpecs.map((spec) => spec.id)
}
