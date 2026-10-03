import type { AuditLog } from './audit.js'
import type { CarveDatabase } from './db.js'
import {
  assessEpisode,
  browserLearningKey,
  buildSemanticBrowserProcedure,
  isSemanticBrowserDemonstration,
} from './induction/browser-transitions.js'
import type {
  ActionSpec,
  LearningSession,
  MemoryEdge,
  MemoryEntity,
  MemoryEntityKind,
  ObservationRecord,
  ProcedureGraph,
  ProcedureVersion,
  WorkflowStep,
} from './types.js'
import { clamp, id, nowIso } from './util.js'

export type ProcedureCorrection =
  | { operation: 'rename'; name: string }
  | { operation: 'update_step'; stepId: string; name?: string; description?: string }
  | { operation: 'delete_step'; stepId: string }
  | { operation: 'split_step'; stepId: string; firstName: string; secondName: string }
  | { operation: 'merge_steps'; firstStepId: string; secondStepId: string; name: string }

function action(
  tool: string,
  input: Record<string, unknown>,
  preview: string,
  expected: string,
  verification: ActionSpec['verification'],
  risk: ActionSpec['risk'] = 'safe',
): ActionSpec {
  return {
    id: id('action'),
    tool,
    input,
    risk,
    sensitiveClass: null,
    stateChanging: tool !== 'mock.inspect',
    preview,
    expectedStateChange: expected,
    verification,
    group: tool.startsWith('artifact.') ? 'create-output' : 'inspect-request',
  }
}

function step(
  name: string,
  description: string,
  kind: WorkflowStep['kind'],
  evidence: ObservationRecord[],
  stepAction: ActionSpec | null,
  confidence: number,
  factBasis: string[],
  interpretation: string[],
): WorkflowStep {
  return {
    id: id('step'),
    name,
    description,
    kind,
    preconditions: [],
    postconditions: [],
    confidence,
    action: stepAction,
    evidenceObservationIds: evidence.map((item) => item.id),
    factBasis,
    interpretation,
  }
}

export class WorkflowService {
  constructor(
    private readonly database: CarveDatabase,
    private readonly audit: AuditLog,
  ) {}

  induce(sessionId: string): ProcedureVersion {
    const session = this.database.getSession(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    const observations = this.database.listObservations(sessionId).filter((item) => !item.excluded)
    if (observations.length === 0) throw new Error('No persisted observations are available for workflow induction')

    const semanticBrowser = isSemanticBrowserDemonstration(observations)
    const procedure = semanticBrowser
      ? this.buildCumulativeBrowserProcedure(session)
      : this.buildProcedure(session, observations)
    const procedureObservations = procedure.provenanceObservationIds.flatMap((observationId) => {
      const observation = this.database.getObservation(observationId)
      return observation ? [observation] : []
    })
    this.database.saveProcedure(procedure)
    const semanticMemory = this.buildSemanticMemory(procedure, procedureObservations)
    this.database.saveSemanticMemory(semanticMemory.entities, semanticMemory.edges)
    this.audit.append('memory.procedure_inferred', 'system', procedure.procedureId, {
      version: procedure.version,
      name: procedure.name,
      confidence: procedure.confidence,
      observationIds: procedure.provenanceObservationIds,
      factAndInterpretationSeparated: true,
      inferenceMethod: procedure.evidenceSummary.inductionMethod,
      demonstrationEvidence: procedure.evidenceSummary,
      modelCallMade: false,
    })
    this.audit.append('memory.semantic_graph_derived', 'system', procedure.procedureId, {
      entityIds: semanticMemory.entities.map((entity) => entity.id),
      edgeIds: semanticMemory.edges.map((edge) => edge.id),
      observationIds: procedure.provenanceObservationIds,
      inferenceMethod: procedure.evidenceSummary.inductionMethod,
      modelCallMade: false,
    })
    return procedure
  }

  private buildCumulativeBrowserProcedure(session: LearningSession): ProcedureVersion {
    const key = browserLearningKey(session.goalHint)
    const episodes = this.database.listSessions()
      .filter((candidate) => candidate.status === 'stopped' && candidate.goalHint === session.goalHint)
      .map((candidate) => assessEpisode(candidate, this.database.listObservations(candidate.id)))
      .filter((episode) => isSemanticBrowserDemonstration(episode.observations))
    return buildSemanticBrowserProcedure(session, episodes, this.database.getProcedureByLearningKey(key))
  }

  private buildSemanticMemory(
    procedure: ProcedureVersion,
    observations: ObservationRecord[],
  ): { entities: MemoryEntity[]; edges: MemoryEdge[] } {
    const entities: MemoryEntity[] = []
    const evidenceByEntity = new Map<string, Set<string>>()
    const entityByKey = new Map<string, MemoryEntity>()
    const add = (
      kind: MemoryEntityKind,
      name: string,
      observation: ObservationRecord,
      attributes: MemoryEntity['attributes'] = {},
    ): void => {
      const cleanName = name.trim()
      if (!cleanName || cleanName.startsWith('[')) return
      const key = `${kind}:${cleanName.toLowerCase()}`
      const current = entityByKey.get(key)
      if (current) {
        const evidence = evidenceByEntity.get(current.id)
        evidence?.add(observation.id)
        current.provenanceObservationIds = [...(evidence ?? [])]
        return
      }
      const entity: MemoryEntity = {
        id: id('entity'),
        kind,
        name: cleanName,
        attributes,
        provenanceObservationIds: [observation.id],
        confidence: procedure.confidence,
      }
      entities.push(entity)
      entityByKey.set(key, entity)
      evidenceByEntity.set(entity.id, new Set([observation.id]))
    }

    const first = observations[0]
    if (!first) return { entities, edges: [] }
    const task: MemoryEntity = {
      id: id('entity'),
      kind: 'task',
      name: procedure.goal,
      attributes: { procedureId: procedure.procedureId, procedureVersion: procedure.version },
      provenanceObservationIds: procedure.provenanceObservationIds,
      confidence: procedure.confidence,
    }
    entities.push(task)

    for (const observation of observations) {
      add('application', observation.facts.app, observation)
      const record = observation.facts.state.request ?? observation.facts.state.identifier
      if (typeof record === 'string') add('document', record, observation, { source: 'structured_state' })
      const artifact = observation.facts.state.artifact
      if (typeof artifact === 'string') add('artifact', artifact, observation, { source: 'structured_state' })
      const priority = observation.facts.state.priority
      if (typeof priority === 'string' && observation.facts.state.application !== 'handoff') add('concept', `priority:${priority}`, observation)
      const documentType = observation.facts.state.documentType
      if (typeof documentType === 'string') add('concept', `document-type:${documentType}`, observation)
      const customer = observation.facts.text.match(/\bcustomer\s+(?:receipt\s+\S+\s+for\s+)?([A-Z][\p{L}\d &.-]+)/u)?.[1]
      if (customer) add('customer', customer, observation, { source: 'observed_text' })
      const organization = observation.facts.text.match(/\bfrom\s+([A-Z][\p{L}\d &.-]+)/u)?.[1]
      if (organization) add('organization', organization, observation, { source: 'observed_text' })
    }

    const relationByKind: Record<Exclude<MemoryEntityKind, 'task'>, MemoryEdge['relation']> = {
      application: 'uses_application',
      document: 'handles_document',
      customer: 'serves_customer',
      organization: 'involves_organization',
      concept: 'uses_concept',
      artifact: 'produces_artifact',
    }
    const edges = entities.filter((entity) => entity.id !== task.id).map((entity): MemoryEdge => ({
      id: id('edge'),
      fromId: task.id,
      relation: relationByKind[entity.kind as Exclude<MemoryEntityKind, 'task'>],
      toId: entity.id,
      provenanceObservationIds: entity.provenanceObservationIds,
      confidence: Math.min(task.confidence, entity.confidence),
    }))
    return { entities, edges }
  }

  private buildProcedure(session: LearningSession, observations: ObservationRecord[]): ProcedureVersion {
    const allText = observations.map((item) => item.facts.text).join(' ')
    const hostile = observations.some((item) => item.injectionSignals.length > 0)
    const interrupted = allText.toLowerCase().includes('stopped before') || observations.length === 1 && session.fixtureId === 'interrupted'
    const blockedFixture = ['changed-ui', 'unsafe-model'].includes(session.fixtureId)
    const confidence = hostile || blockedFixture ? 0.12 : interrupted ? 0.36 : observations.length >= 3 ? 0.88 : 0.72
    let graph: ProcedureGraph

    if (hostile || blockedFixture || interrupted) {
      const terminal = step(
        hostile ? 'Quarantine untrusted instructions' : interrupted ? 'Mark demonstration incomplete' : 'Stop on incompatible state',
        hostile
          ? 'Do not convert screen-authored instructions into executable procedure steps.'
          : interrupted
            ? 'The session lacks a verified output and must not be replayed.'
            : 'The observed state does not meet the expected workflow precondition.',
        'terminal',
        observations,
        null,
        confidence,
        observations.map((item) => item.facts.text),
        ['Safety terminal inferred from incomplete, hostile, or incompatible evidence.'],
      )
      graph = { startStepId: terminal.id, steps: [terminal], edges: [] }
    } else if (session.fixtureId === 'branched-triage') {
      graph = this.branchedGraph(observations)
    } else {
      graph = this.linearGraph(session, observations)
    }

    return {
      procedureId: id('procedure'),
      version: 1,
      learningKey: `fixture:${session.id}`,
      name: session.name,
      goal: session.goalHint,
      confidence,
      inputs: session.fixtureId.includes('invoice') ? ['invoice identifier'] : session.fixtureId.includes('receipt') ? ['receipt identifier'] : ['request identifier', 'priority when present'],
      parameters: [],
      outputs: interrupted || hostile || blockedFixture ? [] : session.fixtureId === 'browser-triage-live' ? ['review completion in local browser sandbox'] : ['review note in Carve sandbox'],
      graph,
      provenanceObservationIds: observations.map((item) => item.id),
      evidenceSummary: {
        inductionMethod: 'deterministic_fixture_rules',
        completedSessionIds: interrupted || hostile || blockedFixture ? [] : [session.id],
        interruptedSessionIds: interrupted ? [session.id] : [],
        quarantinedSessionIds: hostile ? [session.id] : [],
        observedBranchValues: session.fixtureId === 'branched-triage' ? { priority: ['standard', 'urgent'] } : {},
      },
      correctionSummary: null,
      createdAt: nowIso(),
    }
  }

  private linearGraph(session: LearningSession, observations: ObservationRecord[]): ProcedureGraph {
    const documentType = session.fixtureId.includes('invoice') ? 'invoice' : session.fixtureId.includes('receipt') ? 'receipt' : 'intake'
    const inspect = step(
      `Inspect ${documentType} source`,
      'Read the current record and confirm its type before producing an output.',
      'action',
      observations.slice(0, 1),
      action('mock.set_state', { key: 'source_checked', value: true }, 'Inspect the source record', 'Source state is marked checked', { method: 'state_equals', target: 'source_checked', expected: true }),
      0.9,
      [observations[0]?.facts.text ?? 'Source opened'],
      ['The first state appears to be the source record for the output.'],
    )
    inspect.preconditions = ['A source record is visible']
    inspect.postconditions = ['The source record type is confirmed']
    const filename = `${documentType}-result.txt`
    const write = step(
      `Create ${documentType} note`,
      'Write a scoped text artifact in Carve’s sandbox output directory.',
      'action',
      observations.slice(-1),
      action(
        'artifact.write',
        { path: filename, content: `Carve demo output for: ${session.goalHint}\n` },
        `Create ${filename} inside the Carve sandbox`,
        `${filename} exists with the planned content`,
        { method: 'artifact_exists', target: filename, expected: true },
        'reversible_write',
      ),
      0.86,
      [observations.at(-1)?.facts.text ?? 'Output saved'],
      ['The final observed state is consistent with creating a local note.'],
    )
    write.preconditions = ['The source record has been checked']
    write.postconditions = ['A review note exists in the sandbox']
    return {
      startStepId: inspect.id,
      steps: [inspect, write],
      edges: [{ from: inspect.id, to: write.id, condition: null }],
    }
  }

  private branchedGraph(observations: ObservationRecord[]): ProcedureGraph {
    const inspect = step(
      'Inspect request',
      'Open the request and read its current priority.',
      'action',
      observations.slice(0, 2),
      action('mock.set_state', { key: 'priority_checked', value: true }, 'Read the request priority', 'Priority is marked checked', { method: 'state_equals', target: 'priority_checked', expected: true }),
      0.92,
      ['Request opened', 'Priority field was visible'],
      ['Opening the request is a precondition for routing.'],
    )
    const decide = step(
      'Choose review path',
      'Branch on the observed priority: urgent versus standard.',
      'decision',
      observations.slice(1, 2),
      null,
      0.84,
      ['The UI showed both urgent and standard review paths.'],
      ['Priority is the decision variable controlling the output type.'],
    )
    const urgent = step(
      'Create urgent review note',
      'Create the urgent review artifact with an escalation checklist.',
      'action',
      observations.slice(2, 3),
      action(
        'artifact.write',
        { path: 'urgent-review-result.txt', content: 'Urgent review\n- Verify owner\n- Escalate within policy\n' },
        'Create an urgent review note inside the Carve sandbox',
        'Urgent review note exists',
        { method: 'artifact_exists', target: 'urgent-review-result.txt', expected: true },
        'reversible_write',
      ),
      0.9,
      ['Urgent branch produced an escalation checklist.'],
      ['This output applies only when priority is urgent.'],
    )
    const standard = step(
      'Create standard review note',
      'Create the standard review artifact without escalation.',
      'action',
      observations.slice(3),
      action(
        'artifact.write',
        { path: 'standard-review-result.txt', content: 'Standard review\n- Queue for normal handling\n' },
        'Create a standard review note inside the Carve sandbox',
        'Standard review note exists',
        { method: 'artifact_exists', target: 'standard-review-result.txt', expected: true },
        'reversible_write',
      ),
      0.71,
      ['A standard branch variation was explicitly recorded.'],
      ['This output applies when priority is not urgent.'],
    )
    return {
      startStepId: inspect.id,
      steps: [inspect, decide, urgent, standard],
      edges: [
        { from: inspect.id, to: decide.id, condition: null },
        { from: decide.id, to: urgent.id, condition: 'priority == urgent' },
        { from: decide.id, to: standard.id, condition: 'priority != urgent' },
      ],
    }
  }

  correct(procedureId: string, correction: ProcedureCorrection): ProcedureVersion {
    const current = this.database.getProcedure(procedureId)
    if (!current) throw new Error(`Unknown procedure: ${procedureId}`)
    const next = structuredClone(current)
    next.version += 1
    next.createdAt = nowIso()
    next.confidence = clamp(next.confidence + 0.04)
    next.correctionSummary = correction.operation

    if (correction.operation === 'rename') {
      if (!correction.name.trim()) throw new Error('Procedure name cannot be blank')
      next.name = correction.name.trim()
    } else if (correction.operation === 'update_step') {
      const target = this.requireStep(next, correction.stepId)
      if (correction.name !== undefined) target.name = correction.name.trim()
      if (correction.description !== undefined) target.description = correction.description.trim()
    } else if (correction.operation === 'delete_step') {
      this.deleteStep(next, correction.stepId)
    } else if (correction.operation === 'split_step') {
      this.splitStep(next, correction)
    } else {
      this.mergeSteps(next, correction)
    }

    this.database.saveProcedure(next)
    this.audit.append('memory.procedure_corrected', 'user', procedureId, {
      fromVersion: current.version,
      toVersion: next.version,
      operation: correction.operation,
      originalEvidencePreserved: next.provenanceObservationIds,
    })
    return next
  }

  private requireStep(procedure: ProcedureVersion, stepId: string): WorkflowStep {
    const target = procedure.graph.steps.find((candidate) => candidate.id === stepId)
    if (!target) throw new Error(`Unknown step: ${stepId}`)
    return target
  }

  private deleteStep(procedure: ProcedureVersion, stepId: string): void {
    this.requireStep(procedure, stepId)
    const incoming = procedure.graph.edges.filter((edge) => edge.to === stepId)
    const outgoing = procedure.graph.edges.filter((edge) => edge.from === stepId)
    procedure.graph.steps = procedure.graph.steps.filter((candidate) => candidate.id !== stepId)
    procedure.graph.edges = procedure.graph.edges.filter((edge) => edge.from !== stepId && edge.to !== stepId)
    for (const before of incoming) {
      for (const after of outgoing) {
        procedure.graph.edges.push({ from: before.from, to: after.to, condition: after.condition ?? before.condition })
      }
    }
    if (procedure.graph.startStepId === stepId) {
      const replacement = outgoing[0]?.to ?? procedure.graph.steps[0]?.id
      if (!replacement) throw new Error('Cannot delete the only workflow step')
      procedure.graph.startStepId = replacement
    }
  }

  private splitStep(procedure: ProcedureVersion, correction: Extract<ProcedureCorrection, { operation: 'split_step' }>): void {
    const target = this.requireStep(procedure, correction.stepId)
    const first = { ...structuredClone(target), id: id('step'), name: correction.firstName, action: null }
    const second = { ...structuredClone(target), id: id('step'), name: correction.secondName }
    const edges = procedure.graph.edges.flatMap((edge) => {
      if (edge.to === target.id) return [{ ...edge, to: first.id }]
      if (edge.from === target.id) return [{ ...edge, from: second.id }]
      return [edge]
    })
    edges.push({ from: first.id, to: second.id, condition: null })
    procedure.graph.steps = procedure.graph.steps.flatMap((candidate) => candidate.id === target.id ? [first, second] : [candidate])
    procedure.graph.edges = edges
    if (procedure.graph.startStepId === target.id) procedure.graph.startStepId = first.id
  }

  private mergeSteps(procedure: ProcedureVersion, correction: Extract<ProcedureCorrection, { operation: 'merge_steps' }>): void {
    const first = this.requireStep(procedure, correction.firstStepId)
    const second = this.requireStep(procedure, correction.secondStepId)
    const connected = procedure.graph.edges.some((edge) => edge.from === first.id && edge.to === second.id)
    if (!connected) throw new Error('Only directly connected steps can be merged')
    const merged: WorkflowStep = {
      ...structuredClone(second),
      id: id('step'),
      name: correction.name,
      description: `${first.description} ${second.description}`,
      preconditions: first.preconditions,
      evidenceObservationIds: [...new Set([...first.evidenceObservationIds, ...second.evidenceObservationIds])],
      factBasis: [...first.factBasis, ...second.factBasis],
      interpretation: [...first.interpretation, ...second.interpretation],
      confidence: Math.min(first.confidence, second.confidence),
    }
    procedure.graph.steps = procedure.graph.steps.filter((candidate) => candidate.id !== first.id && candidate.id !== second.id)
    procedure.graph.steps.push(merged)
    procedure.graph.edges = procedure.graph.edges
      .filter((edge) => !(edge.from === first.id && edge.to === second.id))
      .map((edge) => ({
        ...edge,
        from: edge.from === second.id ? merged.id : edge.from,
        to: edge.to === first.id ? merged.id : edge.to,
      }))
    if (procedure.graph.startStepId === first.id) procedure.graph.startStepId = merged.id
  }
}
