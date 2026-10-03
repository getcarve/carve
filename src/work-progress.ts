import type { ApplicationHandoffTask } from './application-handoff.js'
import type { UniversalComputerSession } from './types.js'

interface Settings { getSetting(key: string): string | null; setSetting(key: string, value: string): void }
export interface WorkProgress {
  version: 1
  taskId: string
  goal: string
  state: string
  updatedAt: string
  /** These are execution receipts, not independently verified deliverables. */
  evidence: 'model_reported'
  attempts: Array<{ id: string; runId: string; application: string; state: string; result: string | null; remaining: string[]; inputs: number; tokens: number | null }>
  remaining: string[]
  decision: { kind: 'budget' | 'review'; id: string | null; reason: string } | null
}

/** A journal of existing boundary events. It never plans actions, infers that
 * a deliverable exists, or inserts a new model/validation pass. Full results
 * stay in their WorkRun; the compact receipt links back to that run. */
export class WorkProgressJournal {
  constructor(private readonly store: Settings) {}
  read(taskId: string): WorkProgress | null {
    return WorkProgressJournal.parse(taskId, this.store.getSetting(`work.progress.v1.${taskId}`))
  }

  /** Progress for many tasks from one prefix read (desktop state lists every run). */
  readAll(settings: Array<{ key: string; value: string }>): Map<string, WorkProgress> {
    const out = new Map<string, WorkProgress>()
    for (const { key, value } of settings) {
      const taskId = key.slice('work.progress.v1.'.length)
      const progress = WorkProgressJournal.parse(taskId, value)
      if (progress) out.set(taskId, progress)
    }
    return out
  }

  private static parse(taskId: string, raw: string | null): WorkProgress | null {
    if (!raw) return null
    try {
      const record = JSON.parse(raw) as WorkProgress
      return record.version === 1 && record.taskId === taskId && Array.isArray(record.attempts) && Array.isArray(record.remaining) ? record : null
    } catch { return null }
  }
  private save(record: WorkProgress): void {
    this.store.setSetting(`work.progress.v1.${record.taskId}`, JSON.stringify(record))
  }
  recordSession(session: UniversalComputerSession, taskId = session.runId): void {
    const previous = this.read(taskId)
    const attempt = { id: session.id, runId: session.runId, application: session.target.application, state: session.status,
      result: session.terminalText?.slice(0, 12_000) ?? null, remaining: session.remainingClauses ?? [],
      inputs: session.inputActionsCompleted, tokens: session.totalTokens ?? null }
    const attempts = previous?.attempts ?? []
    const index = attempts.findIndex(a => a.id === session.id)
    if (index < 0) attempts.push(attempt); else attempts[index] = attempt
    this.save({ version: 1, taskId, goal: previous?.goal ?? session.goal, state: session.status, updatedAt: session.updatedAt,
      evidence: 'model_reported', attempts, remaining: attempt.remaining,
      decision: session.pendingBudgetCheckpoint ? { kind: 'budget', id: session.pendingBudgetCheckpoint.id,
        reason: session.pendingBudgetCheckpoint.fundingError ?? 'Review the additional work allowance.' } : null })
  }
  recordHandoff(task: ApplicationHandoffTask): void {
    const previous = this.read(task.runId)
    const remaining = task.stages.filter(stage => stage.status !== 'completed').map(stage => stage.route.purpose ||
      `Continue in ${stage.route.source === 'fresh' ? stage.route.application : stage.route.target.application}`)
    this.save({ version: 1, taskId: task.runId, goal: task.goal, state: task.status, updatedAt: task.updatedAt,
      evidence: 'model_reported', attempts: previous?.attempts ?? [], remaining,
      decision: task.budgetRequest ? { kind: 'budget', id: task.budgetRequest.id, reason: task.budgetRequest.fundingError ?? task.reason ?? 'More allowance needed' } : ['failed', 'paused', 'awaiting_consent'].includes(task.status) ? { kind: 'review', id: task.id, reason: task.reason ?? 'Review the planned application work.' } : null })
  }
}
