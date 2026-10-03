import type { LiveComputerSession } from './types.js'

/** Structured controller facts only: never retain conversation or screen text. */
export function liveWaitingDetails(session: LiveComputerSession | null) {
  if (!session) return {}
  const requiresApproval = session.supervision ? session.supervision.planReview === 'always' : session.autonomy === 'approve_plan'
  const approvalPending = requiresApproval && !session.missionPlan.approvedAt && ['awaiting_plan_approval', 'paused'].includes(session.status)
  return {
    planHash: session.missionPlan.hash,
    actionCount: session.actionCount,
    waitingFor: approvalPending ? 'plan_approval' : session.status === 'paused' ? 'resume' : null,
    nextAction: approvalPending ? 'review_and_approve_plan' : session.status === 'paused' ? 'resume_task' : null,
  }
}

/** Deduplicate renderer acknowledgements, while retaining hide/show transitions. */
export class ApprovalVisibilityAudit {
  private current: { sessionId: string; runId: string; planHash: string } | null = null
  constructor(private readonly emit: (details: Record<string, unknown>) => void, private readonly surface: 'capsule' | 'main_app' = 'capsule') {}
  hiddenFor(sessionId: string, planHash: string): void {
    if (this.current?.sessionId === sessionId && this.current.planHash === planHash) this.hidden('renderer_hidden_or_unmounted')
  }
  presented(value: { sessionId: string; runId: string; planHash: string } | null): void {
    if (this.current?.sessionId === value?.sessionId && this.current?.planHash === value?.planHash) return
    this.hidden('presentation_changed')
    if (!value) return
    this.current = value
    this.emit({ ...value, surface: this.surface, state: 'presented', evidence: this.surface === 'capsule' ? 'renderer_acknowledged_and_window_shown' : 'renderer_reports_intersection_and_document_visible' })
  }
  hidden(reason: string): void {
    if (!this.current) return
    this.emit({ ...this.current, surface: this.surface, state: 'hidden', reason })
    this.current = null
  }
}
