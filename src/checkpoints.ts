import type { AuditLog } from './audit.js'
import type { CarveDatabase } from './db.js'
import type { CheckpointDecision, CheckpointGrantScope, CheckpointPreview, CheckpointSubject, ActionEffectClass, CheckpointLivePreview } from './types.js'
import { id, nowIso } from './util.js'

interface CheckpointWaiter {
  runId: string
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout | null
}

export interface CreateCheckpointInput {
  runId: string
  sessionId?: string | null
  subject: CheckpointSubject
  subjectId: string
  subjectHash: string
  planHash: string
  supervisionPolicyHash: string
  boundary: CheckpointDecision['boundary']
  effectClasses: ActionEffectClass[]
  reasonCodes: string[]
  preview: CheckpointPreview
  scope: CheckpointGrantScope
  expiresAt?: string | null
}

/** Durable checkpoint records plus ephemeral waiters. Restart preserves truth
 * about a pending decision, but deliberately never resumes computer input. */
export class CheckpointService {
  private readonly waiters = new Map<string, CheckpointWaiter>()
  /** On-screen descriptions of held batches, keyed by decision id. Memory only; cleared with the waiter. */
  private readonly livePreviews = new Map<string, CheckpointLivePreview>()

  constructor(
    private readonly database: CarveDatabase,
    private readonly audit: AuditLog,
  ) {}

  create(input: CreateCheckpointInput): CheckpointDecision {
    const duplicate = this.database.listCheckpointDecisions(input.runId, input.sessionId ?? undefined)
      .find((candidate) => candidate.status === 'pending'
        && candidate.subjectHash === input.subjectHash
        && candidate.planHash === input.planHash
        && candidate.supervisionPolicyHash === input.supervisionPolicyHash)
    if (duplicate) return duplicate
    const decision: CheckpointDecision = {
      version: 2,
      id: id('checkpoint'),
      runId: input.runId,
      sessionId: input.sessionId ?? null,
      subject: input.subject,
      subjectId: input.subjectId,
      subjectHash: input.subjectHash,
      planHash: input.planHash,
      supervisionPolicyHash: input.supervisionPolicyHash,
      boundary: input.boundary,
      effectClasses: [...new Set(input.effectClasses)],
      reasonCodes: [...new Set(input.reasonCodes)],
      preview: structuredClone(input.preview),
      scope: structuredClone(input.scope),
      status: 'pending',
      createdAt: nowIso(),
      expiresAt: input.expiresAt ?? null,
      decidedAt: null,
      decidedBy: null,
    }
    this.database.saveCheckpointDecision(decision)
    this.audit.append('checkpoint.requested', 'policy', decision.id, safeAuditDetails(decision))
    return decision
  }

  decide(decisionId: string, approved: boolean): CheckpointDecision {
    const decision = this.requirePending(decisionId)
    if (decision.expiresAt && Date.parse(decision.expiresAt) <= Date.now()) {
      decision.status = 'expired'
      decision.decidedAt = nowIso()
      this.database.updateCheckpointDecision(decision)
      this.finishWaiter(decision.id, false)
      this.audit.append('checkpoint.expired', 'policy', decision.id, safeAuditDetails(decision))
      throw new Error('That checkpoint expired; review the current action again')
    }
    decision.status = approved ? 'approved' : 'declined'
    decision.decidedAt = nowIso()
    decision.decidedBy = 'user'
    this.database.updateCheckpointDecision(decision)
    this.finishWaiter(decision.id, approved)
    this.audit.append(approved ? 'checkpoint.approved' : 'checkpoint.declined', 'user', decision.id, safeAuditDetails(decision))
    return decision
  }

  /** Keep what the person should see for a pending decision. It is never written to the checkpoint record. */
  hold(decisionId: string, preview: CheckpointLivePreview): void {
    if (this.database.getCheckpointDecision(decisionId)?.status === 'pending') this.livePreviews.set(decisionId, preview)
  }

  livePreview(decisionId: string): CheckpointLivePreview | null {
    return this.livePreviews.get(decisionId) ?? null
  }

  pendingLivePreviews(): Array<{ checkpointId: string } & CheckpointLivePreview> {
    return [...this.livePreviews].map(([checkpointId, preview]) => ({ checkpointId, ...preview }))
  }

  wait(decision: CheckpointDecision): Promise<boolean> {
    if (decision.status !== 'pending') return Promise.resolve(decision.status === 'approved')
    return new Promise<boolean>((resolve) => {
      const delay = decision.scope.kind === 'countdown_once' ? decision.scope.delayMs : null
      const timer = delay === null ? null : setTimeout(() => {
        const current = this.database.getCheckpointDecision(decision.id)
        if (!current || current.status !== 'pending') return
        current.status = 'approved'
        current.decidedAt = nowIso()
        current.decidedBy = 'user'
        this.database.updateCheckpointDecision(current)
        this.waiters.delete(current.id)
        this.livePreviews.delete(current.id)
        this.audit.append('checkpoint.approved', 'user', current.id, { ...safeAuditDetails(current), source: 'cancellable_countdown' })
        resolve(true)
      }, delay)
      this.waiters.set(decision.id, { runId: decision.runId, resolve, timer })
    })
  }

  matchingApproved(runId: string, planHash: string, policyHash: string): CheckpointDecision[] {
    const now = Date.now()
    return this.database.listCheckpointDecisions(runId).filter((decision) => {
      if (decision.status !== 'approved' || decision.planHash !== planHash || decision.supervisionPolicyHash !== policyHash) return false
      if (decision.expiresAt && Date.parse(decision.expiresAt) <= now) {
        decision.status = 'expired'
        decision.decidedAt = nowIso()
        this.database.updateCheckpointDecision(decision)
        this.audit.append('checkpoint.expired', 'policy', decision.id, safeAuditDetails(decision))
        return false
      }
      return true
    })
  }

  consume(decisionId: string): CheckpointDecision {
    const decision = this.database.getCheckpointDecision(decisionId)
    if (!decision || decision.status !== 'approved') throw new Error('Checkpoint grant is missing or already consumed')
    if (decision.scope.kind === 'phase' || decision.scope.kind === 'plan') return decision
    decision.status = 'consumed'
    decision.decidedAt = decision.decidedAt ?? nowIso()
    this.database.updateCheckpointDecision(decision)
    this.audit.append('checkpoint.consumed', 'policy', decision.id, safeAuditDetails(decision))
    return decision
  }

  /** The controller settles a pending hand-off itself: the person's step is
   * observed done (a human-verification check no longer shows) or its wait
   * ended. Never used for an approval that grants input. */
  settleBySystem(decisionId: string, approved: boolean, reason: string): CheckpointDecision | null {
    const decision = this.database.getCheckpointDecision(decisionId)
    if (!decision || decision.status !== 'pending') return null
    decision.status = approved ? 'approved' : 'declined'
    decision.decidedAt = nowIso()
    decision.decidedBy = null
    this.database.updateCheckpointDecision(decision)
    this.finishWaiter(decision.id, approved)
    this.audit.append(approved ? 'checkpoint.approved' : 'checkpoint.declined', 'system', decision.id, { ...safeAuditDetails(decision), source: reason })
    return decision
  }

  cancelRun(runId: string, actor: 'user' | 'system' = 'user'): void {
    for (const decision of this.database.listCheckpointDecisions(runId).filter((candidate) => candidate.status === 'pending')) {
      decision.status = 'cancelled'
      decision.decidedAt = nowIso()
      decision.decidedBy = actor === 'user' ? 'user' : null
      this.database.updateCheckpointDecision(decision)
      this.finishWaiter(decision.id, false)
      this.audit.append('checkpoint.cancelled', actor, decision.id, safeAuditDetails(decision))
    }
  }

  cancelBroaderGrants(runId: string): void {
    for (const decision of this.database.listCheckpointDecisions(runId).filter((candidate) => candidate.status === 'approved' && (candidate.scope.kind === 'phase' || candidate.scope.kind === 'plan'))) {
      decision.status = 'cancelled'
      decision.decidedAt = nowIso()
      this.database.updateCheckpointDecision(decision)
      this.audit.append('checkpoint.superseded', 'system', decision.id, { ...safeAuditDetails(decision), reason: 'supervision_tightened' })
    }
  }

  supersedePlan(runId: string, oldPlanHash: string): void {
    for (const decision of this.database.listCheckpointDecisions(runId).filter((candidate) => candidate.planHash === oldPlanHash && ['pending', 'approved'].includes(candidate.status))) {
      decision.status = 'cancelled'
      decision.decidedAt = nowIso()
      this.database.updateCheckpointDecision(decision)
      this.finishWaiter(decision.id, false)
      this.audit.append('checkpoint.superseded', 'system', decision.id, safeAuditDetails(decision))
    }
  }

  private requirePending(decisionId: string): CheckpointDecision {
    const decision = this.database.getCheckpointDecision(decisionId)
    if (!decision || decision.status !== 'pending') throw new Error('Checkpoint is missing or no longer pending')
    return decision
  }

  private finishWaiter(decisionId: string, approved: boolean): void {
    const waiter = this.waiters.get(decisionId)
    if (waiter?.timer) clearTimeout(waiter.timer)
    waiter?.resolve(approved)
    this.waiters.delete(decisionId)
    this.livePreviews.delete(decisionId)
  }
}

function safeAuditDetails(decision: CheckpointDecision): Record<string, unknown> {
  return {
    runId: decision.runId,
    sessionId: decision.sessionId,
    subject: decision.subject,
    subjectId: decision.subjectId,
    subjectHash: decision.subjectHash,
    planHash: decision.planHash,
    supervisionPolicyHash: decision.supervisionPolicyHash,
    boundary: decision.boundary,
    effectClasses: decision.effectClasses,
    reasonCodes: decision.reasonCodes,
    scope: decision.scope,
    status: decision.status,
  }
}
