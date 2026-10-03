import type { AuditLog } from './audit.js'
import type { CarveDatabase } from './db.js'
import type { PolicyEngine } from './policy.js'
import type { ToolRegistry } from './tools/registry.js'
import type { ApprovalRecord, CheckpointDecision, PlannedAction, WorkRun } from './types.js'
import { id, nowIso, sha256, stableJson } from './util.js'
import { contextReceiptHash, executionPlanHash } from './work-contract.js'
import { budgetForContract } from './work-budget.js'
import type { CheckpointService } from './checkpoints.js'
import { actionSubjectHash, effectClassList, effectiveSupervisionForRun, supervisionPolicyHash } from './supervision-policy.js'
import { compileActionEffects } from './action-effects.js'

interface WaitingApproval {
  runId: string
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout | null
}

export class Executor {
  private readonly waiting = new Map<string, WaitingApproval>()
  private readonly running = new Map<string, AbortController>()

  constructor(
    private readonly database: CarveDatabase,
    private readonly audit: AuditLog,
    private readonly tools: ToolRegistry,
    private readonly policy: PolicyEngine | null,
    private readonly checkpoints: CheckpointService | null,
    private readonly countdownMs = 5_000,
  ) {}

  start(runId: string): Promise<WorkRun> {
    if (this.running.has(runId)) throw new Error(`Run ${runId} is already executing`)
    const run = this.requireRun(runId)
    if (run.status !== 'planned') throw new Error(`Run ${runId} cannot start from terminal or active status ${run.status}; create a new plan`)
    const contextHash = run.plan.contextHash ?? contextReceiptHash(run.plan.context)
    run.plan.contextHash = contextHash
    const currentPlanHash = executionPlanHash(run.plan)
    if (run.plan.planHash && run.plan.planHash !== currentPlanHash) throw new Error('The proposed plan changed after review; prepare and approve a fresh plan')
    run.plan.planHash = currentPlanHash
    const budget = budgetForContract(run.plan.contract ?? { limits: { maxActions: run.plan.actions.length, maxDurationMinutes: 15 } })
    if (run.plan.actions.length > budget.maxActions) throw new Error(`This plan exceeds its ${budget.preset} work budget; prepare a fresh plan with a larger budget`)
    if (run.plan.hashVersion === 2 && run.plan.intent && run.plan.supervision) {
      const authorizedAt = nowIso()
      const explicitPlanReview = run.plan.supervision.preset !== 'fast'
      run.planAuthorization = run.plan.intent === 'execute' ? {
        version: 2,
        planHash: currentPlanHash,
        contextHash,
        supervisionPolicyHash: supervisionPolicyHash(run.plan.supervision),
        source: explicitPlanReview ? 'explicit_plan_review' : 'explicit_run_request',
        scope: explicitPlanReview ? 'exact_plan' : 'read_only_plan',
        authorizedAt,
        authorizedBy: 'user',
      } : null
      this.audit.append(run.plan.intent === 'execute'
        ? explicitPlanReview ? 'work.plan_authorized' : 'work.request_authorized'
        : run.plan.intent === 'plan_only' ? 'work.plan_reviewed' : 'work.context_reviewed', 'user', run.plan.id, {
        runId: run.id,
        planHash: currentPlanHash,
        contextHash,
        intent: run.plan.intent,
        supervisionPolicyHash: supervisionPolicyHash(run.plan.supervision),
        scope: run.planAuthorization?.scope ?? null,
      })
    } else {
      run.planApproval = {
        planHash: currentPlanHash,
        contextHash,
        approvedAt: nowIso(),
        approvedBy: 'user',
      }
      this.audit.append('approval.plan_granted', 'user', run.plan.id, {
        runId: run.id,
        planHash: currentPlanHash,
        contextHash,
        autonomy: run.plan.autonomy,
        contractVersion: run.plan.contract?.version ?? null,
        maxActions: run.plan.contract?.limits.maxActions ?? run.plan.actions.length,
        maxDurationMinutes: run.plan.contract?.limits.maxDurationMinutes ?? null,
      })
    }
    run.updatedAt = nowIso()
    this.database.updateRun(run)
    this.authorizeFirstSmartPhase(run)
    const controller = new AbortController()
    this.running.set(runId, controller)
    return this.execute(runId, controller).finally(() => this.running.delete(runId))
  }

  approve(approvalId: string): ApprovalRecord {
    return this.decideApproval(approvalId, true)
  }

  cancelApproval(approvalId: string): ApprovalRecord {
    return this.decideApproval(approvalId, false)
  }

  approveCheckpoint(checkpointId: string): CheckpointDecision {
    if (!this.checkpoints) throw new Error('Checkpoint service is unavailable')
    return this.checkpoints.decide(checkpointId, true)
  }

  declineCheckpoint(checkpointId: string): CheckpointDecision {
    if (!this.checkpoints) throw new Error('Checkpoint service is unavailable')
    return this.checkpoints.decide(checkpointId, false)
  }

  stop(runId: string): WorkRun {
    const run = this.requireRun(runId)
    run.stopRequested = true
    run.status = 'cancelled'
    run.result = 'Stopped by user'
    run.updatedAt = nowIso()
    this.database.updateRun(run)
    this.running.get(runId)?.abort('Stopped by user')
    this.checkpoints?.cancelRun(runId)
    for (const [approvalId, pending] of this.waiting) {
      if (pending.runId === runId) {
        if (pending.timer) clearTimeout(pending.timer)
        const approval = this.database.getApproval(approvalId)
        if (approval?.status === 'pending') {
          approval.status = 'cancelled'
          approval.decidedAt = nowIso()
          this.database.updateApproval(approval)
          this.audit.append('approval.cancelled', 'user', approvalId, {
            runId,
            actionId: approval.actionId,
            actionHash: approval.actionHash,
            reason: 'run stop requested',
          })
        }
        pending.resolve(false)
        this.waiting.delete(approvalId)
      }
    }
    this.audit.append('agent.stop_requested', 'user', runId, { immediate: true })
    return run
  }

  private decideApproval(approvalId: string, approved: boolean): ApprovalRecord {
    const record = this.database.getApproval(approvalId)
    if (!record || record.status !== 'pending') throw new Error('Approval is missing or no longer pending')
    const run = this.requireRun(record.runId)
    const action = run.plan.actions.find((candidate) => candidate.id === record.actionId)
    if (!action || record.actionHash !== actionHash(action)) throw new Error('Approval does not match the exact current action')
    record.status = approved ? 'approved' : 'cancelled'
    record.decidedAt = nowIso()
    this.database.updateApproval(record)
    const pending = this.waiting.get(approvalId)
    if (pending?.timer) clearTimeout(pending.timer)
    pending?.resolve(approved)
    this.waiting.delete(approvalId)
    this.audit.append(approved ? 'approval.granted' : 'approval.cancelled', 'user', approvalId, {
      runId: record.runId,
      actionId: record.actionId,
      actionHash: record.actionHash,
      kind: record.kind,
    })
    return record
  }

  private async execute(runId: string, controller: AbortController): Promise<WorkRun> {
    let run = this.requireRun(runId)
    if (run.plan.intent === 'plan_only' || run.plan.intent === 'context_only' || run.plan.autonomy === 'preview' || run.plan.autonomy === 'observe_only') {
      run.status = 'previewed'
      run.result = run.plan.intent === 'plan_only' || run.plan.autonomy === 'preview' ? 'Plan previewed; no actions executed' : 'Context-only mode; no actions executed'
      run.updatedAt = nowIso()
      this.database.updateRun(run)
      this.audit.append('agent.run_previewed', 'system', run.id, { autonomy: run.plan.autonomy, actionsExecuted: 0 })
      return run
    }

    run.status = 'running'
    run.budgetUsage = run.budgetUsage ?? { actionsUsed: run.currentActionIndex, activeDurationMs: 0 }
    run.updatedAt = nowIso()
    this.database.updateRun(run)
    this.audit.append('agent.run_started', 'system', run.id, { autonomy: run.plan.autonomy })
    const approvedGroups = new Set<string>()
    const budget = budgetForContract(run.plan.contract ?? { limits: { maxActions: run.plan.actions.length, maxDurationMinutes: 15 } })

    for (let index = run.currentActionIndex; index < run.plan.actions.length; index += 1) {
      run = this.requireRun(runId)
      let action = run.plan.actions[index]
      if (!action) return this.fail(run, 'Plan action disappeared during execution')
      if (controller.signal.aborted || run.stopRequested) return this.cancel(run, action.id)
      run.budgetUsage = run.budgetUsage ?? { actionsUsed: run.currentActionIndex, activeDurationMs: 0 }
      if (run.budgetUsage.actionsUsed >= budget.maxActions) return this.exhaustBudget(run, action, `The ${budget.preset} work budget used all ${budget.maxActions} steps before the outcome was verified`)
      const remainingActiveMs = budget.maxDurationMinutes * 60_000 - run.budgetUsage.activeDurationMs
      if (remainingActiveMs <= 0) return this.exhaustBudget(run, action, `The ${budget.preset} work budget used all ${budget.maxDurationMinutes} active minutes before the outcome was verified`)

      const effectiveSupervision = effectiveSupervisionForRun(run)
      if (run.plan.hashVersion === 2 && run.plan.intent && effectiveSupervision && run.plan.phases) {
        const phaseId = action.phaseId
        const phase = run.plan.phases.find((candidate) => candidate.id === phaseId)
        if (!phase || !this.checkpoints) return this.block(run, 'Fail closed: version-2 phase or checkpoint service is unavailable')
        const policyHash = supervisionPolicyHash(effectiveSupervision)
        let decision
        try {
          if (!this.policy) throw new Error('policy service unavailable')
          decision = this.policy.evaluateV2({
            intent: run.plan.intent,
            plan: run.plan,
            planAuthorization: run.planAuthorization ?? null,
            supervision: effectiveSupervision,
            action,
            phase,
            matchingGrants: this.checkpoints.matchingApproved(run.id, run.plan.planHash ?? '', policyHash),
            toolAvailable: this.tools.available(action.tool),
            targetStillValid: true,
            dataBoundaryStillValid: true,
          })
        } catch (error) {
          decision = { outcome: 'deny' as const, reasonCode: `policy_unavailable:${String(error)}` }
        }
        this.audit.append('policy.authorization_evaluated', 'policy', action.id, { runId, ...decision, policyHash })
        if (decision.outcome === 'deny' || decision.outcome === 'replan' || decision.outcome === 'handoff') {
          action.status = 'blocked'
          this.persistAction(run)
          return this.block(run, supervisionReason(decision.reasonCode))
        }
        if (decision.outcome === 'preview') continue
        if (decision.outcome === 'checkpoint') {
          action.status = 'awaiting_approval'
          run.status = 'awaiting_approval'
          this.persistAction(run)
          const checkpoint = this.createActionCheckpoint(run, action, phase, decision.boundary, decision.subject, decision.reasonCode)
          const approved = await this.checkpoints.wait(checkpoint)
          if (!approved || controller.signal.aborted) return this.cancel(this.requireRun(runId), action.id)
          if (checkpoint.scope.kind === 'once' || checkpoint.scope.kind === 'countdown_once') this.checkpoints.consume(checkpoint.id)
          run = this.requireRun(runId)
          const refreshedAction = run.plan.actions[index]
          if (!refreshedAction) return this.fail(run, 'Plan action disappeared while checkpoint was pending')
          action = refreshedAction
          action.status = 'approved'
          run.status = 'running'
          this.persistAction(run)
        } else if (decision.grantId) {
          this.checkpoints.consume(decision.grantId)
        }
      } else {
        let decision
        try {
          if (!this.policy) throw new Error('policy service unavailable')
          decision = this.policy.evaluate(action, run.plan.autonomy, this.tools.available(action.tool))
        } catch (error) {
          decision = { outcome: 'deny' as const, approvalKind: null, reason: `Fail closed: ${String(error)}` }
        }
        this.audit.append('policy.evaluated', 'policy', action.id, { runId, ...decision })

        if (decision.outcome === 'deny') {
          action.status = 'blocked'
          this.persistAction(run)
          return this.block(run, decision.reason)
        }
        if (decision.outcome === 'preview') continue

        const groupAlreadyApproved = decision.approvalKind === 'group' && approvedGroups.has(action.group)
        if (decision.outcome === 'approval' && !groupAlreadyApproved) {
          action.status = 'awaiting_approval'
          run.status = 'awaiting_approval'
          this.persistAction(run)
          const approved = await this.waitForApproval(run, action, decision.approvalKind ?? 'immediate')
          if (!approved || controller.signal.aborted) return this.cancel(this.requireRun(runId), action.id)
          if (decision.approvalKind === 'group') approvedGroups.add(action.group)
          run = this.requireRun(runId)
          const refreshedAction = run.plan.actions[index]
          if (!refreshedAction) return this.fail(run, 'Plan action disappeared while approval was pending')
          action = refreshedAction
          action.status = 'approved'
          run.status = 'running'
          this.persistAction(run)
        }
      }

      if (controller.signal.aborted) return this.cancel(this.requireRun(runId), action.id)
      action.status = 'executing'
      const usage = run.budgetUsage ?? { actionsUsed: run.currentActionIndex, activeDurationMs: 0 }
      usage.actionsUsed += 1
      run.budgetUsage = usage
      this.persistAction(run)
      this.audit.append('action.execution_started', 'tool', action.id, {
        runId,
        tool: action.tool,
        risk: action.risk,
        expectedStateChange: action.expectedStateChange,
      })

      const durationSignal = AbortSignal.timeout(Math.max(1, Math.ceil(remainingActiveMs)))
      const actionSignal = AbortSignal.any([controller.signal, durationSignal])
      const activeStartedAt = Date.now()
      try {
        const result = await this.tools.execute(action, { runId, actionId: action.id, signal: actionSignal })
        if (controller.signal.aborted) return this.cancel(Object.assign(run, this.requireRun(runId)), action.id)
        const observed = await this.tools.inspect(action.tool, action.verification, { runId, actionId: action.id, signal: actionSignal })
        if (controller.signal.aborted) return this.cancel(Object.assign(run, this.requireRun(runId)), action.id)
        const verified = result.ok && (action.verification.method === 'none' || observed === action.verification.expected)
        this.audit.append('action.verification', 'system', action.id, {
          runId,
          method: action.verification.method,
          expected: action.verification.expected,
          observed,
          verified,
        })
        if (!verified) {
          action.status = 'failed'
          this.persistAction(run)
          const reason = `Verification failed after ${action.tool}; execution stopped before the next action`
          await this.attachRecoveryProposal(run, action, reason)
          return this.fail(run, reason)
        }
        action.status = 'verified'
        if (result.publicLookup && action.tool === 'web.search') run.publicLookup = result.publicLookup
        run.currentActionIndex = index + 1
        this.persistAction(run)
        this.audit.append('action.executed', 'tool', action.id, { runId, tool: action.tool, summary: result.summary, output: result.output })
        if (result.producedArtifact) {
          this.audit.append('artifact.produced', 'tool', action.id, { runId, path: result.producedArtifact })
        }
      } catch (error) {
        if (controller.signal.aborted) return this.cancel(Object.assign(run, this.requireRun(runId)), action.id)
        if (durationSignal.aborted) {
          action.status = 'blocked'
          return this.exhaustBudget(run, action, `The ${budget.preset} work budget reached ${budget.maxDurationMinutes} active minutes while executing ${action.tool}`)
        }
        action.status = 'failed'
        this.persistAction(run)
        const reason = `Tool execution failed: ${String(error)}`
        await this.attachRecoveryProposal(run, action, reason)
        return this.fail(run, reason)
      } finally {
        // Stop may have persisted a newer terminal run while execute() was
        // awaiting the provider. Accounting must not resurrect its stale copy.
        Object.assign(run, this.requireRun(runId))
        run.budgetUsage = run.budgetUsage ?? { actionsUsed: run.currentActionIndex, activeDurationMs: 0 }
        if (action.tool === 'web.search') {
          const calls = this.database.listModelCalls(run.createdAt).filter((call) => call.runId === run.id)
          run.budgetUsage.modelCalls = calls.length
          // Missing usage remains null in the model-call receipt, never a claim
          // of zero spend. The budget fields contain only reported token totals.
          run.budgetUsage.inputTokens = calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0)
          run.budgetUsage.outputTokens = calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0)
          run.budgetUsage.visionFrames = 0
        }
        run.budgetUsage.activeDurationMs += Math.max(0, Date.now() - activeStartedAt)
        this.persistAction(run)
      }
    }

    run = this.requireRun(runId)
    run.status = 'completed'
    run.result = run.publicLookup ? publicLookupResult(run.publicLookup) : `Completed ${run.plan.actions.length} verified action${run.plan.actions.length === 1 ? '' : 's'}`
    run.updatedAt = nowIso()
    this.database.updateRun(run)
    this.audit.append('agent.run_completed', 'system', run.id, { verifiedActions: run.plan.actions.length })
    return run
  }

  private waitForApproval(run: WorkRun, action: PlannedAction, kind: ApprovalRecord['kind']): Promise<boolean> {
    const expiresAt = kind === 'countdown' ? new Date(Date.now() + this.countdownMs).toISOString() : null
    const approval: ApprovalRecord = {
      id: id('approval'),
      runId: run.id,
      actionId: action.id,
      actionHash: actionHash(action),
      kind,
      status: 'pending',
      preview: action.preview,
      expiresAt,
      decidedAt: null,
    }
    this.database.saveApproval(approval)
    this.audit.append('approval.requested', 'policy', approval.id, {
      runId: run.id,
      actionId: action.id,
      actionHash: approval.actionHash,
      kind,
      expiresAt,
      preview: action.preview,
    })
    return new Promise<boolean>((resolve) => {
      const timer = kind === 'countdown'
        ? setTimeout(() => {
          const current = this.database.getApproval(approval.id)
          if (!current || current.status !== 'pending') return
          current.status = 'approved'
          current.decidedAt = nowIso()
          this.database.updateApproval(current)
          this.waiting.delete(approval.id)
          this.audit.append('approval.countdown_elapsed', 'policy', approval.id, {
            runId: run.id,
            actionId: action.id,
            actionHash: approval.actionHash,
          })
          resolve(true)
        }, this.countdownMs)
        : null
      this.waiting.set(approval.id, { runId: run.id, resolve, timer })
    })
  }

  private createActionCheckpoint(
    run: WorkRun,
    action: PlannedAction,
    phase: NonNullable<WorkRun['plan']['phases']>[number],
    boundary: CheckpointDecision['boundary'],
    subject: CheckpointDecision['subject'],
    reasonCode: string,
  ): CheckpointDecision {
    const supervision = effectiveSupervisionForRun(run)
    if (!this.checkpoints || !supervision || !run.plan.planHash) throw new Error('Checkpoint context is incomplete')
    const effects = compileActionEffects(action)
    const policyHash = supervisionPolicyHash(supervision)
    const subjectId = subject === 'phase' ? phase.id : subject === 'plan' ? run.plan.id : action.id
    const subjectHash = subject === 'phase' ? phase.hash : subject === 'plan' ? run.plan.planHash : actionSubjectHash(action, run.plan.planHash, policyHash)
    const scope = boundary === 'phase'
      ? { kind: 'phase' as const, phaseHash: phase.hash }
      : boundary === 'plan'
        ? {
            kind: 'plan' as const,
            effectClasses: effectClassList(effects),
            targets: effects.flatMap((effect) => effect.target ? [effect.target] : []),
          }
        : boundary === 'countdown'
          ? { kind: 'countdown_once' as const, delayMs: supervision.eligibleCountdownMs ?? this.countdownMs }
          : { kind: 'once' as const }
    return this.checkpoints.create({
      runId: run.id,
      subject,
      subjectId,
      subjectHash,
      planHash: run.plan.planHash,
      supervisionPolicyHash: policyHash,
      boundary,
      effectClasses: effectClassList(effects),
      reasonCodes: [reasonCode],
      preview: {
        what: action.preview,
        where: effects.flatMap((effect) => effect.target ? [effect.target] : []).join(', ') || null,
        data: effects.some((effect) => effect.payloadDigest) ? 'Exact payload digest recorded' : null,
        whyNow: supervisionReason(reasonCode),
        verification: action.expectedStateChange,
      },
      scope,
      ...(boundary === 'countdown' ? { expiresAt: new Date(Date.now() + (supervision.eligibleCountdownMs ?? this.countdownMs)).toISOString() } : {}),
    })
  }

  private authorizeFirstSmartPhase(run: WorkRun): void {
    if (!this.checkpoints || run.plan.intent !== 'execute' || !run.plan.supervision || run.plan.supervision.preset !== 'smart_checkpoints' || !run.plan.planHash) return
    const phase = run.plan.phases?.[0]
    if (!phase || phase.effectClasses.some((effect) => ['unknown', 'communication', 'submission', 'financial', 'destructive', 'authentication', 'installation', 'privilege_escalation', 'confidential_disclosure', 'legal_acceptance', 'high_impact_decision', 'unclassified_control'].includes(effect))) return
    const checkpoint = this.checkpoints.create({
      runId: run.id,
      subject: 'phase',
      subjectId: phase.id,
      subjectHash: phase.hash,
      planHash: run.plan.planHash,
      supervisionPolicyHash: supervisionPolicyHash(run.plan.supervision),
      boundary: 'phase',
      effectClasses: phase.effectClasses,
      reasonCodes: ['covered_by_explicit_plan_review'],
      preview: {
        what: phase.title,
        where: phase.targets.join(', ') || null,
        data: null,
        whyNow: 'The plan review explicitly covers this first phase.',
        verification: phase.checkpointSummary,
      },
      scope: { kind: 'phase', phaseHash: phase.hash },
    })
    this.checkpoints.decide(checkpoint.id, true)
  }

  private persistAction(run: WorkRun): void {
    run.updatedAt = nowIso()
    this.database.updateRun(run)
  }

  private cancel(run: WorkRun, actionId: string): WorkRun {
    const action = run.plan.actions.find((candidate) => candidate.id === actionId)
    if (action) action.status = 'cancelled'
    run.status = 'cancelled'
    run.stopRequested = true
    run.result = 'Execution cancelled before the next state change'
    run.updatedAt = nowIso()
    this.database.updateRun(run)
    this.audit.append('agent.run_cancelled', 'system', run.id, { actionId })
    return run
  }

  private block(run: WorkRun, reason: string): WorkRun {
    run.status = 'blocked'
    run.result = reason
    run.updatedAt = nowIso()
    this.database.updateRun(run)
    this.audit.append('agent.run_blocked', 'policy', run.id, { reason })
    return run
  }

  private exhaustBudget(run: WorkRun, action: PlannedAction, reason: string): WorkRun {
    action.status = 'blocked'
    this.audit.append('agent.budget_exhausted', 'policy', run.id, {
      actionId: action.id,
      reason,
      budget: run.plan.contract?.budget ?? null,
      usage: run.budgetUsage ?? null,
    })
    return this.block(run, `${reason}. Choose a larger work budget to continue with a fresh plan.`)
  }

  private fail(run: WorkRun, reason: string): WorkRun {
    run.status = 'failed'
    run.result = reason
    run.updatedAt = nowIso()
    this.database.updateRun(run)
    this.audit.append('agent.run_failed', 'system', run.id, { reason })
    return run
  }

  private async attachRecoveryProposal(run: WorkRun, action: PlannedAction, reason: string): Promise<void> {
    if (!action.tool.startsWith('browser.')) return
    let observedState: Record<string, string | number | boolean | null> = {}
    try { observedState = await this.tools.recoveryContext(action.tool) } catch { /* a missing snapshot remains fail-closed */ }
    run.recoveryProposal = {
      id: id('recovery'),
      status: 'proposed',
      reason,
      failedActionId: action.id,
      observedState,
      suggestedGoal: run.plan.goal,
      autonomy: run.plan.autonomy,
      requiresExplicitPlan: true,
      replacementRunId: null,
      createdAt: nowIso(),
      decidedAt: null,
    }
    this.database.updateRun(run)
    this.audit.append('agent.recovery_proposed', 'system', run.recoveryProposal.id, {
      failedRunId: run.id,
      failedActionId: action.id,
      reason,
      observedState,
      autonomyPreserved: run.plan.autonomy,
      automaticExecution: false,
    })
  }

  private requireRun(runId: string): WorkRun {
    const run = this.database.getRun(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)
    return run
  }
}

function actionHash(action: PlannedAction): string {
  return sha256(stableJson({
    id: action.id,
    tool: action.tool,
    input: action.input,
    risk: action.risk,
    sensitiveClass: action.sensitiveClass,
    stateChanging: action.stateChanging,
    preview: action.preview,
    expectedStateChange: action.expectedStateChange,
    verification: action.verification,
    group: action.group,
  }))
}

function supervisionReason(reasonCode: string): string {
  const reasons: Record<string, string> = {
    protected_effect: 'This consequential effect needs your approval immediately before it happens',
    each_input_selected: 'You asked Carve to check before every computer input',
    each_state_change_selected: 'You asked Carve to check before every state-changing transaction',
    plan_authorization_required: 'Review the exact plan before Carve continues',
    external_effect_not_covered: 'This external effect was not covered by the current authorization',
    consequential_phase: 'A meaningful state-changing phase is ready to begin',
    effect_requires_resolution: 'Carve could not resolve the action to a known effect and stopped safely',
    authority_boundary_changed: 'The target or data boundary changed and requires a fresh plan',
    tool_unavailable: 'The required tool is unavailable',
    tool_outside_plan_contract: 'The action is outside the approved tool contract',
  }
  return reasons[reasonCode] ?? `Carve stopped safely (${reasonCode})`
}

function publicLookupResult(receipt: NonNullable<WorkRun['publicLookup']>): string {
  let answer = receipt.answer
  for (const [index, citation] of [...receipt.citations.entries()].reverse()) {
    answer = answer.slice(0, citation.start) + `[${index + 1}]` + answer.slice(citation.end)
  }
  return `${answer}\n\n${receipt.citations.map((citation, index) => `[${index + 1}] ${citation.title}: ${citation.url}`).join('\n')}`
}
