import type { CheckpointDecision, UniversalComputerSession } from '../../src/types.js'

interface ApprovalState {
  liveComputer: {
    universalSession: Pick<UniversalComputerSession, 'id' | 'runId' | 'status' | 'pendingPlanReview' | 'pendingCheckpointId'> | null
    assistance?: { executionId: string | null }
  }
  checkpoints: CheckpointDecision[]
}

/** Bind the visible decision to the exact active conversation and session. */
export function assistanceCheckpoint(state: ApprovalState): CheckpointDecision | undefined {
  const session = state.liveComputer.universalSession
  const conversation = state.liveComputer.assistance
  if (!session || session.status !== 'awaiting_checkpoint' || session.pendingPlanReview || conversation?.executionId !== session.id) return
  return state.checkpoints.find(checkpoint => checkpoint.id === session.pendingCheckpointId && checkpoint.sessionId === session.id && checkpoint.runId === session.runId && checkpoint.subject === 'computer_batch' && checkpoint.status === 'pending')
}
