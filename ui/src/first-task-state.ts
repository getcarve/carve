import type { AssistanceState } from '../../src/conversation-interaction.js'
import type { WorkRun } from '../../src/types.js'

export interface PracticeAttempt {
  conversationId: string
  previousRunIds: string[]
  runId: string | null
  feedback: 'worked' | 'partial' | 'stuck' | null
}
export interface PreparedPractice {
  id: string
  conversationId: string | null
  question: string
}

export function practiceRun(attempt: PracticeAttempt | null, runs: WorkRun[], assistance: AssistanceState | undefined): WorkRun | null {
  if (!attempt) return null
  const id = attempt.runId ?? (assistance?.conversationId === attempt.conversationId ? assistance.runId : null)
  if (!id || attempt.previousRunIds.includes(id)) return null
  return runs.find(run => run.id === id) ?? null
}

/** Only a persisted terminal execution attempt enables outcome feedback.
 * Opening a page, preparing a plan, or an unrelated run is insufficient. */
export function canReviewPractice(run: WorkRun | null): boolean {
  if (run?.status === 'cancelled' && !(run.budgetUsage && run.budgetUsage.actionsUsed > 0)) return false
  return Boolean(run?.outcome && ['completed', 'failed', 'blocked', 'cancelled'].includes(run.status))
}

export function practicePhase(input: { busy: boolean; prepared: boolean; worked: boolean; run: WorkRun | null; assistance: AssistanceState | undefined; conversationId: string | undefined }): 'intro' | 'opening' | 'ready' | 'watch' | 'check' | 'retry' | 'own' {
  if (input.worked) return 'own'
  if (input.busy) return 'opening'
  const matching = input.conversationId && input.assistance?.conversationId === input.conversationId
  if (matching && (input.assistance?.active || input.assistance?.preparing)) return 'watch'
  if (canReviewPractice(input.run)) return 'check'
  if (input.run) return ['completed', 'failed', 'blocked', 'cancelled'].includes(input.run.status) ? 'retry' : 'watch'
  if (matching && input.assistance?.guide.state === 'failed') return 'retry'
  return input.prepared && matching ? 'ready' : 'intro'
}
