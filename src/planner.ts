import type { AuditLog } from './audit.js'
import type { CarveDatabase } from './db.js'
import type { AutonomyLevel, ExecutionPlan, PlannedAction, ProcedureVersion, WorkflowStep, WorkBudgetEnvelope, WorkBudgetPreset, WorkContextSummary, WorkPreparation, WorkRun } from './types.js'
import { id, nowIso } from './util.js'
import type { ProviderRegistry } from './providers/registry.js'
import { requireCapabilities } from './providers/types.js'
import { type ProcedureRetriever, type RetrievalHit } from './retrieval.js'
import { bindProcedureParameters } from './parameters.js'
import type { WorkContextAssembler, WorkContextAssembly } from './work-context.js'
import { buildWorkflowContract, contextReceiptHash, executionPlanHash } from './work-contract.js'
import type { CapabilityCatalog, CapabilityPlanDraft } from './capabilities.js'
import { recommendWorkBudget, resolveWorkBudget } from './work-budget.js'
import { buildWorkPhases } from './work-phases.js'
import { supervisionPolicyFromLegacy, supervisionPreset, type SupervisionSelection } from './supervision-policy.js'

export interface RuntimePlanningState {
  priority?: string
  view?: string
  source?: string
  [key: string]: string | number | boolean | undefined
}

export class Planner {
  constructor(
    private readonly database: CarveDatabase,
    private readonly audit: AuditLog,
    private readonly retriever: ProcedureRetriever,
    private readonly providers: ProviderRegistry,
    private readonly workContext: WorkContextAssembler,
    private readonly capabilities: CapabilityCatalog,
  ) {}

  create(goal: string, autonomy: AutonomyLevel, providerId?: string, runtimeState: RuntimePlanningState = {}, parameterValues: Record<string, string> = {}, budgetPreset?: WorkBudgetPreset, supervisionSelection?: SupervisionSelection): WorkRun {
    const prepared = this.prepare(goal, autonomy, providerId, runtimeState, parameterValues, budgetPreset, supervisionSelection)
    if (!prepared.run) throw new Error(prepared.blocker ?? 'No connected executable capability can satisfy this goal')
    return prepared.run
  }

  prepare(goal: string, autonomy: AutonomyLevel, providerId?: string, runtimeState: RuntimePlanningState = {}, parameterValues: Record<string, string> = {}, budgetPreset?: WorkBudgetPreset, supervisionSelection?: SupervisionSelection): WorkPreparation {
    if (!goal.trim()) throw new Error('A work goal is required')
    const provider = providerId ? this.providers.get(providerId) : this.providers.active()
    requireCapabilities(provider, ['text'])
    const assembly = this.workContext.assemble(goal)
    return this.prepareFromAssembly(goal, autonomy, provider.summary.id, provider.summary.name, assembly, runtimeState, parameterValues, budgetPreset, supervisionSelection)
  }

  prepareFromAssembly(goal: string, autonomy: AutonomyLevel, providerId: string, providerName: string, assembly: WorkContextAssembly, runtimeState: RuntimePlanningState = {}, parameterValues: Record<string, string> = {}, budgetPreset?: WorkBudgetPreset, supervisionSelection?: SupervisionSelection): WorkPreparation {
    const budget = resolveWorkBudget(budgetPreset ?? recommendWorkBudget(goal))
    if (assembly.summary.readiness === 'needs_clarification') {
      return {
        context: assembly.summary,
        run: null,
        blocker: 'Carve found more than one plausible context. Choose the intended context before it resolves execution capabilities or drafts actions.',
      }
    }
    if (!assembly.retrieval) {
      const resolution = this.capabilities.resolve(goal, assembly.summary, runtimeState)
      if (resolution.plan) {
        const context: WorkContextSummary = {
          ...assembly.summary,
          readiness: 'adaptive',
          boundary: 'history_is_context_only_contract_authorizes_capabilities',
        }
        return {
          context,
          run: this.createFromCapability(goal, autonomy, providerId, providerName, context, resolution.plan, budget, supervisionSelection),
          blocker: null,
        }
      }
      return {
        context: assembly.summary,
        run: null,
        blocker: resolution.missingTools.length > 0
          ? `Carve resolved the context, but the matching capability requires ${resolution.missingTools.join(', ')}. Connect that tool before execution.`
          : 'Carve understood the goal, but no connected executable capability can perform it yet. Connect an appropriate tool or choose a goal supported by the current capability catalog.',
      }
    }
    return {
      context: assembly.summary,
      run: this.createFromAssembly(goal, autonomy, providerId, providerName, assembly, runtimeState, parameterValues, budget, supervisionSelection),
      blocker: null,
    }
  }

  private createFromAssembly(goal: string, autonomy: AutonomyLevel, providerId: string, providerName: string, assembly: WorkContextAssembly, runtimeState: RuntimePlanningState, parameterValues: Record<string, string>, budget: WorkBudgetEnvelope, supervisionSelection?: SupervisionSelection): WorkRun {
    const retrieval = assembly.retrieval as RetrievalHit
    const adapted = assembly.match === 'adapted'
    const effectiveAutonomy = adaptiveAutonomy(autonomy, adapted)
    const usesBrowserState = retrieval.procedure.graph.steps.some((step) => step.action?.tool.startsWith('browser.'))
    const effectiveRuntimeState = usesBrowserState ? runtimeState : {}
    const steps = this.resumeAfterVerifiedState(this.selectPath(retrieval.procedure, goal, effectiveRuntimeState), effectiveRuntimeState)
    const inspectedContext = effectiveRuntimeState.application === 'handoff' && typeof effectiveRuntimeState['account-tier'] === 'string'
      ? ` Current inspected account tier: ${effectiveRuntimeState['account-tier']}.`
      : effectiveRuntimeState.application === 'triage' && effectiveRuntimeState.priority
        ? ` Current inspected priority: ${effectiveRuntimeState.priority}.`
        : ''
    const proposedActions = steps.flatMap((workflowStep) => workflowStep.action ? [{
      ...structuredClone(workflowStep.action),
      id: id('planned_action'),
      sourceStepId: workflowStep.id,
      status: 'proposed' as const,
    }] : [])
    const bound = bindProcedureParameters(retrieval.procedure.parameters, parameterValues, proposedActions)
    const legacyActions: PlannedAction[] = bound.actions.map((action, index) => ({ ...action, sourceStepId: proposedActions[index]!.sourceStepId, status: 'proposed' }))
    const selectedSupervision = effectiveSupervision(effectiveAutonomy, supervisionSelection, adapted)
    const compiled = supervisionSelection ? buildWorkPhases(legacyActions) : { actions: legacyActions, phases: [] }
    const actions = compiled.actions
    const contextHash = contextReceiptHash(assembly.summary)
    const contract = buildWorkflowContract({
      goal,
      procedure: retrieval.procedure,
      context: assembly.summary,
      actions,
      autonomy: effectiveAutonomy,
      basis: adapted ? 'adapted_procedure' : 'reviewed_procedure',
      budget,
      ...(supervisionSelection ? { intent: selectedSupervision.intent, supervision: selectedSupervision.supervision } : {}),
    })
    const plan: ExecutionPlan = {
      id: id('plan'),
      goal: goal.trim(),
      procedureId: retrieval.procedure.procedureId,
      procedureVersion: retrieval.procedure.version,
      retrievalScore: retrieval.score,
      rationale: adapted
        ? `No exact method matched the goal. Carve adapted the related reviewed procedure “${retrieval.procedure.name}” as a scaffold, bound its exact actions into a new contract, and tightened supervision to ask every step. Retrieved history remained context-only. Provider capability profile: ${providerName}.${inspectedContext}`
        : `Retrieved “${retrieval.procedure.name}” using metadata, FTS5, local embeddings, and graph-step overlap. Assembled ${assembly.summary.sessions.length} related session${assembly.summary.sessions.length === 1 ? '' : 's'} and ${assembly.summary.moments.length} history match${assembly.summary.moments.length === 1 ? '' : 'es'}; history remained context-only. Provider capability profile: ${providerName}.${inspectedContext} The deterministic MVP planner made no model call.`,
      planningMode: adapted ? 'adapted_replay' : 'reviewed_replay',
      autonomy: effectiveAutonomy,
      ...(supervisionSelection ? { intent: selectedSupervision.intent, supervision: selectedSupervision.supervision, hashVersion: 2 as const, phases: compiled.phases } : {}),
      parameterValues: bound.values,
      context: assembly.summary,
      contextHash,
      contract,
      actions,
      createdAt: nowIso(),
    }
    plan.planHash = executionPlanHash(plan)
    const run: WorkRun = {
      id: id('run'),
      plan,
      status: 'planned',
      currentActionIndex: 0,
      stopRequested: false,
      result: null,
      recoveryProposal: null,
      planApproval: null,
      ...(supervisionSelection ? { planAuthorization: null, supervisionAmendments: [] } : {}),
      budgetUsage: { actionsUsed: 0, activeDurationMs: 0 },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    this.database.saveRun(run)
    this.audit.append('agent.memory_retrieved', 'system', run.id, {
      procedureId: plan.procedureId,
      procedureVersion: plan.procedureVersion,
      score: plan.retrievalScore,
      components: retrieval.components,
    })
    this.audit.append('agent.plan_proposed', 'system', plan.id, {
      runId: run.id,
      goal: plan.goal,
      autonomy: plan.autonomy,
      actions: plan.actions.map((action) => ({ id: action.id, tool: action.tool, risk: action.risk, preview: action.preview })),
      provider: providerId,
      parameterValues: bound.values,
      planningMethod: adapted ? 'adapted_graph_path' : 'deterministic_graph_path',
      modelCallMade: false,
      runtimeState: effectiveRuntimeState,
      contextHash,
      planHash: plan.planHash,
      workflowContract: contract,
      workBudget: budget,
    })
    return run
  }

  createFromCapability(goal: string, autonomy: AutonomyLevel, providerId: string, providerName: string, context: WorkContextSummary, capability: CapabilityPlanDraft, budget: WorkBudgetEnvelope, supervisionSelection?: SupervisionSelection): WorkRun {
    const effectiveAutonomy = adaptiveAutonomy(autonomy, true)
    const selectedSupervision = effectiveSupervision(effectiveAutonomy, supervisionSelection, true)
    const compiled = supervisionSelection ? buildWorkPhases(capability.actions) : { actions: capability.actions, phases: [] }
    const contextHash = contextReceiptHash(context)
    const contract = buildWorkflowContract({
      goal,
      context,
      actions: compiled.actions,
      autonomy: effectiveAutonomy,
      basis: 'capability_plan',
      expectedOutputs: capability.expectedOutputs,
      budget,
      ...(supervisionSelection ? { intent: selectedSupervision.intent, supervision: selectedSupervision.supervision } : {}),
    })
    const plan: ExecutionPlan = {
      id: id('plan'),
      goal: goal.trim(),
      procedureId: capability.id,
      procedureVersion: 1,
      retrievalScore: 0,
      rationale: `${capability.rationale} No operational method was required: the planner selected connected typed capabilities, proposed their exact parameters and verification, and tightened supervision to ask every step. Historical context informed the goal but granted no authority. Provider capability profile: ${providerName}.`,
      planningMode: 'capability_plan',
      autonomy: effectiveAutonomy,
      ...(supervisionSelection ? { intent: selectedSupervision.intent, supervision: selectedSupervision.supervision, hashVersion: 2 as const, phases: compiled.phases } : {}),
      parameterValues: {},
      context,
      contextHash,
      contract,
      actions: compiled.actions,
      createdAt: nowIso(),
    }
    plan.planHash = executionPlanHash(plan)
    const run: WorkRun = {
      id: id('run'),
      plan,
      status: 'planned',
      currentActionIndex: 0,
      stopRequested: false,
      result: null,
      recoveryProposal: null,
      planApproval: null,
      ...(supervisionSelection ? { planAuthorization: null, supervisionAmendments: [] } : {}),
      budgetUsage: { actionsUsed: 0, activeDurationMs: 0 },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    this.database.saveRun(run)
    this.audit.append('agent.capabilities_selected', 'system', run.id, {
      capabilityId: capability.id,
      goal: plan.goal,
      tools: [...new Set(capability.actions.map((action) => action.tool))],
      requestedAutonomy: autonomy,
      effectiveAutonomy,
      historyGrantedExecutionAuthority: false,
    })
    this.audit.append('agent.plan_proposed', 'system', plan.id, {
      runId: run.id,
      goal: plan.goal,
      autonomy: plan.autonomy,
      actions: plan.actions.map((action) => ({ id: action.id, tool: action.tool, risk: action.risk, preview: action.preview })),
      provider: providerId,
      parameterValues: {},
      planningMethod: 'connected_capability_planner',
      modelCallMade: false,
      contextHash,
      planHash: plan.planHash,
      workflowContract: contract,
      workBudget: budget,
    })
    return run
  }

  private selectPath(procedure: ProcedureVersion, goal: string, runtimeState: RuntimePlanningState): WorkflowStep[] {
    const selected: WorkflowStep[] = []
    const visited = new Set<string>()
    let currentId: string | undefined = procedure.graph.startStepId
    while (currentId) {
      if (visited.has(currentId)) throw new Error('Procedure graph contains a cycle; MVP execution requires an acyclic selected path')
      visited.add(currentId)
      const current = procedure.graph.steps.find((candidate) => candidate.id === currentId)
      if (!current) throw new Error(`Procedure graph references missing step ${currentId}`)
      selected.push(current)
      const outgoing = procedure.graph.edges.filter((edge) => edge.from === currentId)
      if (outgoing.length === 0) break
      const planningState: RuntimePlanningState = {
        priority: runtimeState.priority ?? (/\burgent\b/iu.test(goal) ? 'urgent' : 'standard'),
        ...runtimeState,
      }
      const selectedEdge = outgoing.length === 1
        ? outgoing[0]
        : outgoing.find((edge) => conditionMatches(edge.condition, planningState))
      if (outgoing.length > 1 && !selectedEdge) throw new Error(`No demonstrated branch matches the inspected state at step ${current.name}`)
      currentId = selectedEdge?.to
    }
    return selected
  }

  private resumeAfterVerifiedState(steps: WorkflowStep[], runtimeState: RuntimePlanningState): WorkflowStep[] {
    let verifiedPrefix = -1
    for (let index = 0; index < steps.length; index += 1) {
      const verification = steps[index]?.action?.verification
      if (steps[index]?.action?.stateChanging && verification?.method === 'state_equals' && runtimeState[verification.target] === verification.expected) verifiedPrefix = index
    }
    return verifiedPrefix >= 0 ? steps.slice(verifiedPrefix + 1) : steps
  }
}

function adaptiveAutonomy(requested: AutonomyLevel, adaptive: boolean): AutonomyLevel {
  if (!adaptive || requested === 'observe_only' || requested === 'preview' || requested === 'approve_each' || requested === 'approve_plan') return requested
  return 'approve_each'
}

function effectiveSupervision(autonomy: AutonomyLevel, selected: SupervisionSelection | undefined, adapted: boolean): SupervisionSelection {
  const base = selected ?? supervisionPolicyFromLegacy(autonomy)
  if (!adapted || base.intent !== 'execute' || base.supervision.preset !== 'fast') return base
  return { intent: base.intent, supervision: supervisionPreset('step_by_step') }
}

function conditionMatches(condition: string | null, runtimeState: RuntimePlanningState): boolean {
  if (!condition) return false
  const match = condition.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(==|!=)\s*(.+)$/u)
  if (!match?.[1] || !match[2] || match[3] === undefined) return false
  const actual = runtimeState[match[1]]
  if (actual === undefined) return false
  const expected = match[3].trim()
  return match[2] === '==' ? String(actual) === expected : String(actual) !== expected
}
