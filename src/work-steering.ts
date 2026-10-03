export type WorkSteeringIntent =
  | 'stop'
  | 'pause'
  | 'resume'
  | 'status_question'
  | 'redirect'
  | 'scope_change'
  | 'take_over'
  | 'unclear'

export type WorkSteeringScope = 'not_applicable' | 'same_contract' | 'requires_revision'

export type WorkSteeringReasonCode =
  | 'protected_action'
  | 'new_application'
  | 'new_destination'
  | 'new_recipient'
  | 'new_sensitive_data'
  | 'new_task'

export interface WorkSteeringClassification {
  intent: WorkSteeringIntent
  scope: WorkSteeringScope
  reasonCodes: WorkSteeringReasonCode[]
  /** Controller-authored copy only. The steering transcript is never returned. */
  summary: string
}

interface WorkSteeringInput {
  text: string
  originalGoal: string
}

const exactIntent = new Map<string, WorkSteeringIntent>([
  ['stop', 'stop'],
  ['stop now', 'stop'],
  ['cancel', 'stop'],
  ['cancel the task', 'stop'],
  ['end this task', 'stop'],
  ['give me control', 'stop'],
  ['pause', 'pause'],
  ['pause now', 'pause'],
  ['hold on', 'pause'],
  ['wait', 'pause'],
  ['wait a moment', 'pause'],
  ['continue', 'resume'],
  ['resume', 'resume'],
  ['keep going', 'resume'],
  ['let me do this', 'take_over'],
  ['let me take over', 'take_over'],
  ['i will do this', 'take_over'],
  ['i will take over', 'take_over'],
  ['status', 'status_question'],
  ['what are you doing', 'status_question'],
  ['what is happening', 'status_question'],
  ['whats happening', 'status_question'],
  ['where are you', 'status_question'],
  ['not that', 'unclear'],
  ['the other one', 'unclear'],
  ['no the other thing', 'unclear'],
])

const protectedActionFamilies: ReadonlyArray<RegExp> = [
  /\b(?:buy|purchase|checkout|pay|transfer|subscribe|donate)\b/u,
  /\b(?:send|email|message|post|publish|share)\b/u,
  /\b(?:submit|sign|accept)\b/u,
  /\b(?:save|delete|erase|remove|archive|trash)\b/u,
  /\b(?:install|download|upload|import|export)\b/u,
  /\b(?:allow|authorize|approve|grant|permission)\b/u,
  /\b(?:log in|login|sign in|authenticate)\b/u,
]

const sensitiveDataPattern = /\b(?:password|passcode|credential|secret|api key|one time code|otp|social security|ssn|credit card|bank account)\b/u
const newApplicationPattern = /\b(?:(?:open|use|switch to|move to) (?:an? )?(?:another|different|new) (?:app|application|window)|(?:another|different) (?:app|application|window))\b/u
const explicitNewTaskPattern = /\b(?:start (?:a )?new task|do (?:a )?different task|change the goal|new goal|broaden the task)\b/u
const recipientPattern = /\b(?:to|with) (?:the )?(?:team|whole team|everyone|everybody|all users|all customers|another person|a different person|new recipient)\b/u
const navigationPattern = /\b(?:go to|navigate to|open) https?:\/\/[^\s]+/u

/**
 * Routes live human steering without another model call. Exact local commands
 * are deliberately conservative: a compound direction such as "stop clicking
 * that and use the sidebar" remains a correction instead of becoming Stop.
 * Free-form redirects are held only when they clearly introduce new authority.
 */
export function classifyWorkSteering(input: WorkSteeringInput): WorkSteeringClassification {
  const normalized = normalize(input.text)
  if (!normalized) return result('unclear', 'not_applicable', [], 'Add a correction to continue')

  const directIntent = exactIntent.get(normalized)
  if (directIntent) return directIntentResult(directIntent)
  if (/^why (?:are|did|do) you\b/u.test(normalized)) {
    return result('status_question', 'not_applicable', [], 'Carve is paused while you review its current status')
  }

  const goal = normalize(input.originalGoal)
  const reasons = new Set<WorkSteeringReasonCode>()
  for (const family of protectedActionFamilies) {
    if (family.test(normalized) && !family.test(goal)) reasons.add('protected_action')
  }
  if (sensitiveDataPattern.test(normalized) && !sensitiveDataPattern.test(goal)) reasons.add('new_sensitive_data')
  if (newApplicationPattern.test(normalized)) reasons.add('new_application')
  if (explicitNewTaskPattern.test(normalized)) reasons.add('new_task')
  if (recipientPattern.test(normalized) && !recipientPattern.test(goal)) reasons.add('new_recipient')

  const directiveDestination = normalized.match(navigationPattern)?.[0] ?? null
  if (directiveDestination && !goal.includes(directiveDestination.replace(/^(?:go to|navigate to|open) /u, ''))) {
    reasons.add('new_destination')
  }

  const reasonCodes = [...reasons]
  if (reasonCodes.length > 0) {
    return result(
      'scope_change',
      'requires_revision',
      reasonCodes,
      scopeReviewSummary(reasonCodes),
    )
  }
  return result('redirect', 'same_contract', [], 'Correction accepted for your task')
}

function directIntentResult(intent: WorkSteeringIntent): WorkSteeringClassification {
  if (intent === 'stop') return result(intent, 'not_applicable', [], 'Stopping your task')
  if (intent === 'pause') return result(intent, 'not_applicable', [], 'Your task will stay paused')
  if (intent === 'resume') return result(intent, 'not_applicable', [], 'Resuming your task')
  if (intent === 'take_over') return result(intent, 'not_applicable', [], 'Carve is paused so you can take over')
  if (intent === 'status_question') return result(intent, 'not_applicable', [], 'Carve is paused while you review its current status')
  return result('unclear', 'not_applicable', [], 'Carve is paused and needs a clearer direction')
}

function scopeReviewSummary(reasons: WorkSteeringReasonCode[]): string {
  if (reasons.includes('new_sensitive_data')) return 'This correction needs access to sensitive information you haven’t approved'
  if (reasons.includes('new_application')) return 'This correction uses an app or window you haven’t approved'
  if (reasons.includes('new_recipient')) return 'This correction adds a recipient you haven’t approved'
  if (reasons.includes('new_destination')) return 'This correction adds a destination you haven’t approved'
  if (reasons.includes('protected_action')) return 'This correction adds an action you haven’t approved'
  return 'This correction goes beyond the task you approved'
}

function result(
  intent: WorkSteeringIntent,
  scope: WorkSteeringScope,
  reasonCodes: WorkSteeringReasonCode[],
  summary: string,
): WorkSteeringClassification {
  return { intent, scope, reasonCodes, summary }
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/gu, '')
    .replace(/[^\p{L}\p{N}:/.\s-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.]+$/gu, '')
}
