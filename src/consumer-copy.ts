/** Presentation-only language. Never use these labels as protocol values or
 * rewrite a person's request, document, or model-authored result with them. */
export function consumerStatus(value: string): string {
  const labels: Record<string, string> = {
    budget_exhausted: 'Task limit reached', objective_not_achieved: 'This part is not finished yet',
    awaiting_approval: 'Waiting for your approval', awaiting_guidance: 'Needs your input',
    awaiting_checkpoint: 'Waiting for your approval', awaiting_budget: 'Needs more room to finish',
    awaiting_steering_review: 'Review the new direction', initializing: 'Getting ready',
    reconciling_input: 'Checking the last change', verifying: 'Checking the result',
    criterion_failed: 'Could not confirm the result', not_accepted: 'Change not confirmed',
    handoff: 'Needs your help', blocked: 'Could not continue', failed: 'Could not finish',
    cancelled: 'Stopped', completed: 'Done', planned: 'Ready to review',
    provider_failure: 'AI service unavailable', environment_failure: 'Window unavailable',
    execution_limit: 'Task limit reached', planning_error: 'Could not plan the next step',
    plan_invalid: 'The plan needs updating', input_not_accepted: 'The change did not go through',
    authentication_required: 'Please sign in', missing_evidence: 'Not enough information to confirm',
    recovery: 'Trying another way', recovering: 'Trying another way', replanning: 'Updating the plan',
  }
  return labels[value] ?? value.replaceAll('_', ' ').replace(/^./u, letter => letter.toUpperCase())
}

/** Known legacy system messages remain readable in old task records. Unknown
 * messages are preserved, including names, amounts and error details. */
export function consumerSystemMessage(message: string): string {
  const exact: Record<string, string> = {
    'Budget was exhausted': 'Carve reached the task limit before finishing.',
    'Budget exhausted': 'Carve reached the task limit before finishing.',
    'Objective was not achieved': 'Carve has not finished this part yet.',
    'Objective not achieved': 'Carve has not finished this part yet.',
    'Carve reached its inference budget. Add a bounded extension and continue?': 'Carve needs more room to finish. Keep going?',
    'Add budget and continue': 'Give Carve more room',
  }
  return exact[message.replace(/[.!]$/u, '')] ?? exact[message] ?? message
}

/** Controller stop reasons are written for the audit and the engine router,
 * which match their wording; the person reads what happened instead (a two-site
 * task: "The provider repeated the same ineffective
 * batch after 2 controller recovery prompts" was the whole answer). */
const controllerStops: Array<[RegExp, string]> = [
  [/repeated the same ineffective batch|proposed the same action|changed nothing visible|remained identical for/iu, 'I stopped because my last steps were not changing anything on the page, and I could not confirm an answer.'],
  [/final check (?:rejected the answer|returned invalid verdicts)/iu, 'I stopped because I could not confirm an answer from what the page showed.'],
  [/read budget for this request/iu, 'I stopped here so you would not keep waiting, but I could not confirm an answer from what I had found. You can ask me to keep looking.'],
  [/OpenAI response stream reported|OpenAI stream ended without|stream reported a transient error/iu, 'I stopped because the AI service had a temporary error partway through. You can ask again.'],
]

export function consumerStopReason(reason: string): string {
  return controllerStops.find(([pattern]) => pattern.test(reason))?.[1] ?? consumerSystemMessage(reason)
}

const activityLabels: Record<string, string> = {
  'computer.session_started': 'Carve started working', 'computer.session_terminal': 'Task ended',
  'computer.run_ended': 'Task ended', 'computer.action_proposed': 'Chose the next step',
  'computer.action_automatic_checkpoint': 'Continued with your existing permission',
  'computer.action_criterion_failed': 'Could not confirm this step worked',
  'computer.action_criterion_verified': 'Confirmed this step worked',
  'computer.model_decision_context': 'Reviewed the current task',
  'computer.interaction_started': 'Started a step', 'computer.interaction_failed': 'A step did not work as expected',
  'computer.delivery_completed': 'Sent a click or keystroke', 'computer.effect_observed': 'Checked the screen for changes',
  'computer.control_lane_released': 'Finished the current interaction',
  'computer.guidance_requested': 'Asked for your input', 'computer.guidance_provided': 'Received your answer',
  'computer.resource_budget_exhausted': 'Reached the task limit', 'agent.budget_exhausted': 'Reached the task limit',
  'work.budget_amendment_approved': 'You allowed more work', 'computer.budget_extended': 'Allowed more steps',
  'computer.universal_budget_extended': 'You allowed more steps', 'computer.universal_budget_checkpoint': 'Asked to keep going',
  'computer.action_executed': 'Performed a step', 'computer.action_verified': 'Checked that a step worked',
  'computer.frame_captured': 'Looked at the selected window', 'computer.frame_sent': 'Sent the selected window to the AI service',
  'computer.plan_approved': 'You approved the plan', 'computer.plan_created': 'Prepared a plan',
  'computer.session_paused': 'Paused the task', 'computer.session_resumed': 'Resumed the task',
  'computer.session_stopped': 'Stopped the task', 'computer.universal_started': 'Carve started working',
  'computer.universal_finished': 'Task ended', 'computer.universal_blocked': 'Carve could not continue',
  'computer.input_checkpoint': 'Checked a change to a field', 'computer.pointer_checkpoint': 'Checked the screen after a click',
}

export function consumerActivityLabel(event: { category: string; details: Record<string, unknown> }): string {
  if (['computer.session_terminal', 'computer.run_ended', 'computer.universal_finished'].includes(event.category)) {
    const status = event.details.status
    if (typeof status === 'string') return `Task: ${consumerStatus(status).toLowerCase()}`
  }
  return activityLabels[event.category] ?? 'Recorded an activity update'
}

export function consumerActor(actor: string): string {
  return ({ user: 'You', system: 'Carve', model: 'Carve’s AI', policy: 'Permission check' } as Record<string, string>)[actor] ?? consumerStatus(actor)
}

/** Shared voice for generated display fields, not internal schemas. */
export const consumerVoiceInstruction = 'Write user-visible summaries, questions, explanations and result text in plain everyday language. Say what happened and what the person can do next. Avoid internal terms such as objective, inference budget, criterion, execution graph and bounded contract in those display fields. Preserve exact amounts, destinations, permissions, uncertainty and the difference between an attempted action and a confirmed result. Keep protocol field names and enum values unchanged.'
