import { workflowKey, type SupervisionPreset } from './autonomy.js'
import type { ApprovalRecord, AuditEvent, CheckpointDecision, RunStatus, WorkRun } from './types.js'

/**
 * The receipt: what a delegated run did, verified, refused, and asked about,
 * assembled from the durable record (the run, its audit events, checkpoints,
 * and approvals). It is derived, never stored separately, so it cannot
 * disagree with the audit chain.
 */

export type ReceiptLineKind = 'started' | 'action' | 'verified' | 'observed' | 'not_accepted' | 'checkpoint' | 'approval' | 'refused' | 'handoff' | 'budget' | 'cloud' | 'finished' | 'note'

export interface ReceiptLine {
  at: string
  kind: ReceiptLineKind
  text: string
  detail: string | null
}

export interface Receipt {
  runId: string
  goal: string
  workflowKey: string
  mode: 'universal' | 'assured' | 'capabilities' | 'review'
  status: RunStatus
  result: string | null
  outcome: WorkRun['outcome'] | null
  supervision: SupervisionPreset | null
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  totals: {
    actions: number
    verifications: number
    /** Universal path: batches after which the screen visibly changed / did not. */
    observedChanges: number
    observedNoChange: number
    notAccepted: number
    checkpoints: number
    approvals: number
    refusals: number
    budgetExtensions: number
    modelCalls: number
    inputTokens: number
    outputTokens: number
    recoveryEpisodes: number
  }
  cloud: { taskId: string; path: string; units: number; outcome: string | null } | null
  lines: ReceiptLine[]
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function humanizeStatus(status: RunStatus): string {
  return status === 'completed' ? 'Completed' : status === 'blocked' ? 'Needs you' : status === 'cancelled' ? 'Stopped' : status === 'failed' ? 'Did not finish' : status
}

export function buildReceipt(run: WorkRun, audit: AuditEvent[], checkpoints: CheckpointDecision[], approvals: ApprovalRecord[]): Receipt {
  const events = [...audit].sort((left, right) => left.sequence - right.sequence)
  const lines: ReceiptLine[] = []
  const totals: Receipt['totals'] = { actions: 0, verifications: 0, observedChanges: 0, observedNoChange: 0, notAccepted: 0, checkpoints: 0, approvals: 0, refusals: 0, budgetExtensions: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, recoveryEpisodes: 0 }
  let mode: Receipt['mode'] = run.plan.intent === 'context_only' || run.plan.intent === 'plan_only' ? 'review' : 'capabilities'
  let cloud: Receipt['cloud'] = null
  let endedAt: string | null = null

  for (const event of events) {
    const d = event.details
    switch (event.category) {
      case 'computer.universal_session_started':
        mode = 'universal'
        lines.push({ at: event.occurredAt, kind: 'started', text: `Started in ${str(d.application) ?? 'the selected window'}`, detail: str(d.model) ? `Universal path · ${str(d.model)}` : 'Universal path' })
        break
      case 'computer.session_started':
      case 'computer.live_session_started':
        mode = 'assured'
        lines.push({ at: event.occurredAt, kind: 'started', text: `Started in ${str(d.application) ?? 'the selected window'}`, detail: 'Each step is checked independently' })
        break
      case 'computer.input_subaction':
      case 'computer.pointer_subaction': {
        if (mode !== 'universal') mode = 'assured'
        const status = str(d.status)
        if (status === 'completed') {
          totals.actions += 1
          lines.push({ at: event.occurredAt, kind: 'action', text: describeSubaction(event.category, d), detail: null })
        } else if (status === 'failed') {
          lines.push({ at: event.occurredAt, kind: 'not_accepted', text: `${describeSubaction(event.category, d)} did not apply`, detail: str(d.error) })
        }
        break
      }
      case 'computer.input_checkpoint':
      case 'computer.pointer_checkpoint': {
        const status = str(d.status)
        if (status === 'accepted' || status === 'changed') {
          totals.verifications += 1
          lines.push({ at: event.occurredAt, kind: 'verified', text: event.category === 'computer.input_checkpoint' ? 'Verified the field changed as intended' : 'Verified the screen changed as intended', detail: evidenceDetail(d) })
        } else if (status === 'rejected' || status === 'unchanged') {
          totals.notAccepted += 1
          lines.push({ at: event.occurredAt, kind: 'not_accepted', text: 'Input was not accepted; Carve did not proceed on it', detail: evidenceDetail(d) })
        }
        break
      }
      case 'computer.universal_action': {
        mode = 'universal'
        const status = str(d.status)
        const budgetClass = str(d.budgetClass)
        if (budgetClass === 'observation' && status === 'completed') break
        if (budgetClass === 'wait' && status === 'completed') break
        const text = actionText(str(d.label), str(d.description))
        if (status === 'completed') {
          totals.actions += 1
          lines.push({ at: event.occurredAt, kind: 'action', text, detail: null })
        } else {
          lines.push({ at: event.occurredAt, kind: 'not_accepted', text: `${text} did not apply`, detail: str(d.error) })
        }
        break
      }
      case 'computer.universal_batch_progress': {
        mode = 'universal'
        const change = str(d.visibleChange)
        if (change === 'changed') {
          totals.observedChanges += 1
          lines.push({ at: event.occurredAt, kind: 'observed', text: 'Screen changed after this step', detail: null })
        } else if (d.noProgress === true || change === 'unchanged') {
          totals.observedNoChange += 1
          lines.push({ at: event.occurredAt, kind: 'not_accepted', text: 'No visible change after this step', detail: 'Carve asked the model for a different tactic' })
        }
        break
      }
      case 'computer.universal_budget_extended':
        totals.budgetExtensions += 1
        lines.push({ at: event.occurredAt, kind: 'budget', text: `Allowed ${num(d.additionalInputs)} more steps`, detail: 'You approved the extra work' })
        break
      case 'computer.budget_extended':
      case 'computer.universal_budget_checkpoint':
        totals.budgetExtensions += 1
        lines.push({ at: event.occurredAt, kind: 'budget', text: event.category === 'computer.budget_extended' ? `Allowed ${num(d.grantedActions)} more steps` : 'Reached the step limit and asked to keep going', detail: str(d.trigger) === 'automatic_progress' ? 'Automatic, because progress was verified' : str(d.trigger) === 'user_grant' ? 'Approved by you' : null })
        break
      case 'computer.universal_steering_received':
        lines.push({ at: event.occurredAt, kind: 'note', text: 'You changed the direction', detail: str(d.classification) })
        break
      case 'computer.universal_session_terminal':
        mode = 'universal'
        endedAt = event.occurredAt
        totals.actions = Math.max(totals.actions, num(d.actionsCompleted))
        totals.inputTokens += num(d.inputTokens)
        totals.outputTokens += num(d.outputTokens)
        totals.modelCalls += num(d.providerTurns)
        lines.push({ at: event.occurredAt, kind: 'finished', text: terminalText(str(d.status), str(d.terminalKind), 'universal'), detail: str(d.reason) ?? (str(d.status) === 'completed' ? 'The AI reported that it finished. This mode does not check the result independently, so please review it.' : null) })
        break
      case 'computer.session_terminal':
        mode = mode === 'universal' ? 'universal' : 'assured'
        endedAt = event.occurredAt
        totals.actions = Math.max(totals.actions, num(d.actionCount))
        totals.modelCalls += num(d.modelCalls)
        totals.inputTokens += num(d.inputTokens)
        totals.outputTokens += num(d.outputTokens)
        totals.recoveryEpisodes += num(d.recoveryEpisodes)
        lines.push({ at: event.occurredAt, kind: 'finished', text: terminalText(str(d.status), str(d.terminalCategory), 'assured'), detail: str(d.resultSummary) ?? str(d.reason) })
        break
      case 'run.completed':
      case 'run.failed':
      case 'run.blocked':
      case 'run.cancelled':
        endedAt = endedAt ?? event.occurredAt
        break
      case 'cloud.task_allocated':
        cloud = { taskId: str(d.taskId) ?? '', path: str(d.path) ?? 'universal', units: num(d.unitsConsumed) || 1, outcome: null }
        lines.push({ at: event.occurredAt, kind: 'cloud', text: 'Metered as one task on your Carve plan', detail: `${num(d.actionBudget)} actions before Carve asks` })
        break
      case 'cloud.task_continued':
        if (cloud) cloud.units = num(d.unitsConsumed) || cloud.units + 1
        lines.push({ at: event.occurredAt, kind: 'cloud', text: 'Continued using one more task from your allowance', detail: null })
        break
      case 'cloud.task_finished':
        if (cloud) cloud.outcome = str(d.outcome)
        break
      default:
        if (event.category.startsWith('policy.') && (str(d.decision) === 'deny' || str(d.outcome) === 'denied' || event.category.includes('denied') || event.category.includes('refused'))) {
          totals.refusals += 1
          lines.push({ at: event.occurredAt, kind: 'refused', text: 'Stopped by a permission rule', detail: str(d.reason) ?? str(d.rule) })
        }
        break
    }
  }

  for (const checkpoint of checkpoints) {
    totals.checkpoints += 1
    const status = String((checkpoint as { status?: unknown }).status ?? 'pending')
    lines.push({ at: recordTime(checkpoint), kind: 'checkpoint', text: status === 'approved' ? 'You approved the next steps' : status === 'pending' ? 'Waiting for your approval' : 'You declined the next steps; Carve stopped there', detail: str((checkpoint as { reason?: unknown }).reason) })
  }
  for (const approval of approvals) {
    totals.approvals += 1
    const status = String((approval as { status?: unknown }).status ?? 'pending')
    lines.push({ at: recordTime(approval), kind: 'approval', text: status === 'approved' ? 'You approved an exact action' : status === 'pending' ? 'Approval pending' : status === 'expired' ? 'An approval expired unused' : 'You declined an action', detail: str((approval as { preview?: unknown }).preview) ?? str((approval as { summary?: unknown }).summary) })
  }
  lines.sort((left, right) => left.at.localeCompare(right.at))

  const startedAt = run.createdAt
  const finishedAt = endedAt ?? (['completed', 'blocked', 'cancelled', 'failed'].includes(run.status) ? run.updatedAt : null)
  const usage = run.budgetUsage
  if (usage) {
    totals.modelCalls = Math.max(totals.modelCalls, num((usage as { modelCalls?: unknown }).modelCalls))
    totals.inputTokens = Math.max(totals.inputTokens, num((usage as { inputTokens?: unknown }).inputTokens))
    totals.outputTokens = Math.max(totals.outputTokens, num((usage as { outputTokens?: unknown }).outputTokens))
    totals.recoveryEpisodes = Math.max(totals.recoveryEpisodes, num((usage as { recoveryEpisodes?: unknown }).recoveryEpisodes))
    totals.actions = Math.max(totals.actions, num((usage as { actionsUsed?: unknown }).actionsUsed))
  }
  return {
    runId: run.id,
    goal: run.plan.goal,
    workflowKey: workflowKey(run.plan.goal),
    mode,
    status: run.status,
    result: run.result,
    outcome: run.outcome ?? null,
    supervision: run.supervisionAmendments?.at(-1)?.nextPolicy.preset ?? run.plan.supervision?.preset ?? null,
    startedAt,
    endedAt: finishedAt,
    durationMs: finishedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null,
    totals,
    cloud,
    lines,
  }
}

/** Records differ in which timestamp they carry; the decision time wins, then the request time. */
function recordTime(record: object): string {
  const value = record as { decidedAt?: unknown; requestedAt?: unknown; createdAt?: unknown; proposedAt?: unknown; occurredAt?: unknown }
  for (const candidate of [value.decidedAt, value.requestedAt, value.createdAt, value.proposedAt, value.occurredAt]) {
    if (typeof candidate === 'string' && candidate) return candidate
  }
  return ''
}

function describeSubaction(category: string, details: Record<string, unknown>): string {
  const phase = str(details.phase) ?? (category === 'computer.pointer_subaction' ? 'pointer' : 'input')
  const length = typeof details.textLength === 'number' ? details.textLength : null
  if (/type|text|field/u.test(phase)) return length !== null ? `Typed ${length} characters` : 'Typed into a field'
  if (/key/u.test(phase)) return 'Pressed a key'
  if (/scroll/u.test(phase)) return 'Scrolled'
  if (/click|pointer|press/u.test(phase)) return 'Clicked'
  return `Performed ${phase.replace(/_/gu, ' ')}`
}

function evidenceDetail(details: Record<string, unknown>): string | null {
  const channels = Array.isArray(details.evidenceChannels) ? details.evidenceChannels.filter((value): value is string => typeof value === 'string') : []
  if (channels.length === 0) return null
  return `Evidence: ${channels.map((channel) => channel.replace(/_/gu, ' ')).join(', ')}`
}

function actionText(label: string | null, description: string | null): string {
  if (label) return label.replace(/^(\w+)ing\b/u, (_match, verb: string) => `${verb}ed`).replace(/^Clicked/u, 'Clicked').replace(/^Typeed/u, 'Typed').replace(/^Pressed/u, 'Pressed').replace(/^Scrolled/u, 'Scrolled').replace(/^Dragged/u, 'Dragged')
  if (description) return description.charAt(0).toUpperCase() + description.slice(1)
  return 'Performed an action'
}

function terminalText(status: string | null, kind: string | null, path: 'universal' | 'assured'): string {
  if (status === 'completed') return path === 'assured' ? 'Finished and verified' : 'Finished'
  if (status === 'blocked' || kind === 'safety_hold' || kind === 'needs_user') return 'Stopped; needs your help'
  if (status === 'cancelled' || kind === 'user_stopped') return 'Stopped by you'
  if (kind === 'execution_limit') return 'Reached the task limit'
  return 'Did not finish'
}

export function totalsLine(receipt: Receipt): string {
  const checks = receipt.mode === 'assured'
    ? `${receipt.totals.verifications} verified`
    : `${receipt.totals.observedChanges} screen checks`
  return `${receipt.totals.actions} actions · ${checks} · ${receipt.totals.notAccepted} not accepted · ${receipt.totals.checkpoints + receipt.totals.approvals} decisions by you · ${receipt.totals.refusals} refused`
}

/** Plain-text rendering for copy and email. */
export function receiptText(receipt: Receipt): string {
  const duration = receipt.durationMs === null ? '' : ` · ${Math.round(receipt.durationMs / 1000)} s`
  const header = [
    `Carve task summary`,
    `Task: ${receipt.goal}`,
    `${humanizeStatus(receipt.status)} · ${receipt.mode === 'universal' ? 'Universal' : receipt.mode === 'assured' ? 'Assured' : receipt.mode === 'review' ? 'Plan only' : 'Connected apps'}${duration}`,
    receipt.supervision ? `Check-ins: ${receipt.supervision.replace(/_/gu, ' ')}` : null,
    '',
  ].filter((line): line is string => line !== null)
  const marks: Record<ReceiptLineKind, string> = { started: '▸', action: '•', verified: '✓', observed: '◇', not_accepted: '✗', checkpoint: '■', approval: '■', refused: '⛔', handoff: '■', budget: '⏸', cloud: '☁', finished: '▪', note: '–' }
  const body = receipt.lines.map((line) => `${marks[line.kind]} ${line.text}${line.detail ? ` (${line.detail})` : ''}`)
  const footer = [
    '',
    totalsLine(receipt),
    receipt.result ? `Result: ${receipt.result}` : null,
  ].filter((line): line is string => line !== null)
  return [...header, ...body, ...footer].join('\n')
}

/** Self-contained HTML for the image export; no external assets. */
export function receiptHtml(receipt: Receipt): string {
  const escape = (value: string) => value.replace(/[&<>"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char))
  const tone: Record<ReceiptLineKind, string> = { started: '#9aa3b2', action: '#e8ebf1', verified: '#4cc38a', observed: '#7fb7a0', not_accepted: '#f0a35c', checkpoint: '#d8b45a', approval: '#d8b45a', refused: '#e5484d', handoff: '#d8b45a', budget: '#d8b45a', cloud: '#7aa2f7', finished: '#e8ebf1', note: '#9aa3b2' }
  const marks: Record<ReceiptLineKind, string> = { started: '▸', action: '•', verified: '✓', observed: '◇', not_accepted: '✗', checkpoint: '■', approval: '■', refused: '⛔', handoff: '■', budget: '⏸', cloud: '☁', finished: '▪', note: '–' }
  const rows = receipt.lines.map((line) => `<div class="line"><span style="color:${tone[line.kind]}">${marks[line.kind]}</span><div><div>${escape(line.text)}</div>${line.detail ? `<small>${escape(line.detail)}</small>` : ''}</div></div>`).join('')
  const duration = receipt.durationMs === null ? '' : `${Math.round(receipt.durationMs / 1000)} s`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0f1115;color:#e8ebf1;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif;padding:32px;width:640px}
h1{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#d8b45a;margin:0 0 10px}
h2{font-size:20px;margin:0 0 6px;line-height:1.3}.meta{color:#9aa3b2;margin-bottom:18px}
.line{display:grid;grid-template-columns:22px 1fr;gap:8px;padding:6px 0;border-top:1px solid #262c38}.line small{color:#9aa3b2;display:block}
.totals{margin-top:18px;padding-top:12px;border-top:1px solid #262c38;color:#9aa3b2;font-size:13px}.brand{margin-top:22px;color:#9aa3b2;font-size:12px}
</style></head><body><h1>Carve task summary</h1><h2>${escape(receipt.goal)}</h2><div class="meta">${escape(humanizeStatus(receipt.status))} · ${receipt.mode === 'universal' ? 'Universal' : receipt.mode === 'assured' ? 'Assured' : 'Connected apps'}${duration ? ` · ${duration}` : ''}${receipt.supervision ? ` · ${escape(receipt.supervision.replace(/_/gu, ' '))}` : ''}</div>${rows}<div class="totals">${escape(totalsLine(receipt))}</div>${receipt.result ? `<div class="totals">Result: ${escape(receipt.result)}</div>` : ''}<div class="brand">This summary comes from Carve's activity record on this Mac.</div></body></html>`
}
