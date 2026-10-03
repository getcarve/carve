import { capsuleFailureMessage } from './capsule-feedback.js'
import { handoffBudgetCopy } from './application-handoff-budget.js'
import { handoffIsSource } from './application-handoff-semantics.js'
import { handoffWorkflowScope, handoffConversationCopy } from './application-handoff-scope.js'
import { handoffDestination, handoffPausedQuietEnabled, handoffResumableAfterStop, handoffRevision, type ApplicationHandoffTask } from './application-handoff.js'
import type { AssistanceState } from './conversation-interaction.js'
import { type LiveComputerOverlayPresentation, buildLiveComputerAssistancePresentation, partialReportInCapsuleEnabled } from './live-computer-overlay.js'

export function applicationHandoffPresentation(task: ApplicationHandoffTask, assistance: AssistanceState) {
  const stage = task.stages[task.stageIndex]!
  const source = task.stages.slice(0, task.stageIndex + 1).reverse().find(s => s.target || s.route.source === 'existing')
  const target = source?.target ?? (source?.route.source === 'existing' ? source.route.target : assistance.target)
  if (!target) return null
  const copy = handoffConversationCopy(task)
  const budget = task.budgetRequest ? handoffBudgetCopy(task.budgetRequest, task.providerId === 'carve-cloud') : null
  const opening = task.status === 'opening'
  const read = handoffIsSource(stage.route)
  const sourceFailed = read && task.status === 'failed'
  const destination = handoffDestination(stage)
  const reason = task.reason?.includes('The exact selected window could not be raised')
    ? 'Carve could not bring the selected window into focus. Keep it open and visible, then retry. The next stage has not started.'
    // A stage that stopped with a checked partial report says what it did and what is left (e2e-0928 C07: the text was
    // written but the save was not finished, and the capsule said only "Carve couldn't continue in the next app").
    : task.reason && task.personStep && sourceFailed ? task.reason
    : task.reason && task.partialReport && partialReportInCapsuleEnabled() ? task.reason
    : task.reason ? capsuleFailureMessage(task.reason, 'Carve couldn’t continue in the next app. Review the task details before trying again.') : null
  const blocked = task.status === 'failed' && (Boolean(stage.sessionId) || Boolean(task.retryExhausted))
  const stopped = handoffResumableAfterStop(task)
  const partialChoice = sourceFailed && Boolean(task.retryExhausted) && Boolean(task.partialSource)
  // A check or sign-in left for the person: the card names it, and Continue resumes reading the source (assess-0929 C07).
  const personStep = sourceFailed && task.personStep ? task.personStep : null
  const personTitle = personStep ? (personStep.kind === 'sign_in' ? 'Sign in to continue' : 'Confirm you’re human') : null
  const quiet = task.status === 'paused' && !task.budgetRequest && handoffPausedQuietEnabled()
  const shape = buildLiveComputerAssistancePresentation(target, '⌘⇧.', assistance)
  return { target, presentation: { ...shape, sessionId: task.id, voiceContextId: task.id, taskGoal: task.goal,
    updatedAt: task.updatedAt, mode: 'session' as const, phase: opening ? 'preparing' as const : 'waiting' as const,
    theme: opening || quiet ? 'selected' as const : 'attention' as const, label: budget ? budget.title : stopped ? 'Stopped' : quiet ? 'Paused' : opening ? `Opening ${destination}` : personStep ? 'Waiting for you' : sourceFailed ? 'Source needs attention' : blocked ? 'Document needs review' : 'Continue your task',
    detail: task.budgetRequest?.fundingError ?? budget?.detail ?? (stopped ? `You stopped this. What Carve gathered is kept. Continue in ${destination}, or type what to add and press Return.` : null) ?? (quiet ? `You chose not to continue in ${destination}. The work so far is kept; continue from the Carve window or ask again.` : null) ?? reason ?? (opening ? 'Opening the next app for your task.' : read ? 'Carve needs to read the source before creating the result.' : 'Carve will carry the information it gathered into the next part of your task.'),
    health: opening ? 'starting' as const : 'waiting' as const, interactive: true, answer: null, guide: null,
    assistance: undefined, planApproval: null, canPause: false, canResume: false,
    decision: opening || quiet ? null : { kind: blocked && !partialChoice ? 'review' as const : 'handoff' as const, sessionId: task.id, id: task.id,
      revision: handoffRevision(task), title: budget ? budget.title : personTitle ?? (partialChoice ? 'Only part of the source was found' : sourceFailed ? 'Source work did not finish' : blocked ? 'Choose the document to continue' : copy.question),
      facts: [], details: [{ label: 'From', value: target.application + (target.title ? ` · ${target.title}` : '') },
        { label: 'Steps', value: handoffWorkflowScope(task) },
        { label: 'Your task', value: task.goal },
        { label: 'How it works', value: `This approval covers the listed steps. Content may be sent to ${task.providerId}. Changes to this work need your approval.` },
        { label: 'Information gathered', value: task.evidence.length ? `${task.evidence.length} source ${task.evidence.length === 1 ? 'summary' : 'summaries'}. Coverage hasn’t been independently checked.` : task.stages.some(stage => stage.suppliedBy === 'conversation') ? 'Using the answer you referred to in this conversation. Coverage hasn’t been independently checked.' : 'Read the source before preparing the result' }],
      scope: task.budgetRequest?.fundingError ? `${task.budgetRequest.fundingError} ${budget?.detail ?? ''}` : budget?.detail ?? reason ?? copy.summary,
      approveDisabled: Boolean(task.budgetRequest && (!task.budgetRequest.canGrant || task.budgetRequest.fundingStatus === 'pending')),
      approveLabel: budget ? budget.approveLabel : stopped || personStep ? 'Continue' : partialChoice ? 'Continue with what was found' : sourceFailed ? (blocked ? 'Review source' : 'Retry source') : blocked ? 'Review document' : copy.approveLabel, declineLabel: stopped ? 'Close' : partialChoice ? 'Stop here' : copy.declineLabel },
  } }
}

/** Execution sessions change at each window; speech belongs to the user's task.
 * Match explicit ownership so a retained handoff cannot capture a later task. */
export function applicationHandoffVoicePresentation(
  shape: LiveComputerOverlayPresentation, task: ApplicationHandoffTask | null,
): LiveComputerOverlayPresentation {
  if (!task) return shape
  const owns = shape.sessionId === task.id || shape.voiceContextId === task.runId
    || task.stages.some(stage => stage.sessionId === shape.sessionId
      || Boolean(stage.runId && stage.runId === shape.voiceContextId))
  return owns ? { ...shape, voiceContextId: task.id, taskGoal: task.goal } : shape
}
