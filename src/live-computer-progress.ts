import type { UniversalComputerSession } from './types.js'

/** Perceived-speed layer (docs/perceived-speed-2026-09-23/PLAN.md). Every
 * row and every line here is a controller fact: a stage the handoff really
 * reached, an observation really captured, an input really delivered. Nothing
 * is estimated, animated forward on a timer, or taken from model reasoning.
 * The only text that is not controller-authored is the person's own request
 * title, echoed back to them in the capsule they just typed it into. */

export type LiveComputerChecklistState = 'done' | 'now' | 'next'

export interface LiveComputerChecklistItem {
  id: 'request' | 'understand' | 'window' | 'work' | 'check'
  label: string
  detail: string | null
  state: LiveComputerChecklistState
}

/** A model turn past this reads as silence; the capsule says what it is doing.
 * Live turns run about 3 s (23 September), so 5 s marks a genuinely long one. */
export const liveComputerTurnOverrunMs = 5_000
/** Past this, the honest explanation is a slow service, not more thinking. */
export const liveComputerSlowServiceMs = 15_000

const universalActiveStatuses: ReadonlyArray<UniversalComputerSession['status']> = ['starting', 'running', 'replanning']
const universalWaitingStatuses: ReadonlyArray<UniversalComputerSession['status']> = ['paused', 'awaiting_checkpoint', 'awaiting_steering_review', 'awaiting_budget']

/** At most `limit` characters of the person's request, cut at a word. */
export function requestEcho(text: string | null | undefined, limit = 56): string | null {
  const clean = (text ?? '').replace(/\s+/gu, ' ').trim()
  if (!clean) return null
  if (clean.length <= limit) return clean
  return clean.slice(0, limit - 1).replace(/\s+\S*$/u, '').replace(/[.,;:!?]+$/u, '') + '…'
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export type PreparationStage = 'understanding' | 'preparing' | 'launching'

/** The handoff before a session exists. Each stage is the state the assistance
 * controller or desktop shell is actually in; the rows never run ahead of it. */
export function preparationChecklist(input: { request: string | null; application: string; stage: PreparationStage; understandDetail?: string | null }): LiveComputerChecklistItem[] {
  const echo = requestEcho(input.request)
  const app = input.application.slice(0, 40) || 'this window'
  const order: PreparationStage[] = ['understanding', 'preparing', 'launching']
  const at = order.indexOf(input.stage)
  const state = (index: number): LiveComputerChecklistState => index < at ? 'done' : index === at ? 'now' : 'next'
  return [
    { id: 'request', label: 'Got your request', detail: echo ? `“${echo}”` : null, state: 'done' },
    { id: 'understand', label: at === 0 ? 'Working out what you need' : 'Worked out what you need', detail: at === 0 ? input.understandDetail ?? null : null, state: state(0) },
    { id: 'window', label: at <= 1 ? `Getting ${app} ready` : `${app} is ready`, detail: null, state: state(1) },
    { id: 'work', label: 'Taking a first look', detail: null, state: at === 2 ? 'now' : 'next' },
  ]
}

/** The running checklist for a Universal session: request, window, the work
 * itself, and the final check. Null once the session asks for or ends with
 * something else — those states have their own pages. */
export function universalComputerChecklist(
  session: Pick<UniversalComputerSession, 'status' | 'title' | 'goal' | 'target' | 'observationsCaptured' | 'providerTurns' | 'inputActionsCompleted' | 'latestActionCue' | 'activityEvents'> & Partial<Pick<UniversalComputerSession, 'draftAnswer'>>,
): LiveComputerChecklistItem[] | null {
  if (!universalActiveStatuses.includes(session.status) && !universalWaitingStatuses.includes(session.status) && session.status !== 'pausing') return null
  const app = session.target.application.slice(0, 40) || 'this window'
  const echo = requestEcho(session.title ?? session.goal)
  const looked = session.observationsCaptured > 0 || session.providerTurns > 0
  const checking = session.activityEvents.at(-1)?.phase === 'verifying'
  const inputs = session.inputActionsCompleted
  const last = session.latestActionCue?.label ? lastStep(session.latestActionCue.label) : null
  return [
    { id: 'request', label: 'Got your request', detail: echo ? `“${echo}”` : null, state: 'done' },
    { id: 'window', label: looked ? `Read ${app}` : `Reading ${app}`, detail: null, state: looked ? 'done' : 'now' },
    {
      id: 'work',
      label: inputs === 0 ? (checking ? 'Found it without clicking' : 'Working out the first step') : `Working in ${app}`,
      detail: inputs === 0 ? null : `${plural(inputs, 'action')} done${last ? ` · last: ${last}` : ''}`,
      state: !looked ? 'next' : checking ? 'done' : 'now',
    },
    // The draft's text is not shown while it is checked: 14 of 56 first drafts in
    // the 26 September qualification were wrong and corrected by this check, and
    // a person reads a visible draft as the answer (see the next-plan, decision D1).
    { id: 'check', label: checking ? (session.draftAnswer ? 'Found an answer, checking it against the page' : 'Checking it worked') : 'Check it worked', detail: null, state: checking ? 'now' : 'next' },
  ]
}

/** Present-tense cue labels ("Clicking “Search”") read as history once the
 * input is delivered ("clicked “Search”"). Unknown shapes pass unchanged. */
function lastStep(label: string): string {
  const past: Array<[RegExp, string]> = [
    [/^Clicking/u, 'clicked'], [/^Typing/u, 'typed'], [/^Scrolling/u, 'scrolled'], [/^Pressing/u, 'pressed'],
    [/^Opening/u, 'opened'], [/^Moving/u, 'moved'], [/^Dragging/u, 'dragged'], [/^Switching/u, 'switched'],
    [/^Selecting/u, 'selected'], [/^Activating/u, 'activated'], [/^Focusing/u, 'focused'], [/^Waiting/u, 'waited'],
  ]
  const trimmed = label.trim().slice(0, 60)
  for (const [pattern, verb] of past) if (pattern.test(trimmed)) return trimmed.replace(pattern, verb)
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
}

/** A model turn that has run long gets an explanation instead of the same
 * label it had at 0 s. Only the plain deciding/observing phases qualify:
 * retries, recoveries and waits already say what they are. */
export function universalComputerTurnOverrun(
  session: Pick<UniversalComputerSession, 'status' | 'phaseStartedAt' | 'activityEvents'>,
  now = Date.now(),
): { label: string; detail: string } | null {
  // The first turn runs while the session is still starting; once the
  // window has been read, it is the same wait as any other turn.
  if (session.status !== 'running' && !(session.status === 'starting' && session.activityEvents.at(-1)?.phase !== 'recovering' && session.activityEvents.length > 0)) return null
  const phase = session.activityEvents.at(-1)?.phase
  if (phase !== 'deciding' && phase !== 'observing') return null
  const since = Date.parse(session.activityEvents.at(-1)?.startedAt ?? session.phaseStartedAt)
  if (!Number.isFinite(since)) return null
  const elapsed = now - since
  if (elapsed >= liveComputerSlowServiceMs) return {
    label: 'Carve · Still working',
    detail: 'The AI service is slow to answer right now. Nothing new has been clicked or typed; you can stop at any time.',
  }
  if (elapsed >= liveComputerTurnOverrunMs) return {
    label: 'Carve · Taking a closer look',
    detail: 'This page needs a little more thought before the next step. Nothing new has been clicked or typed.',
  }
  return null
}

/** While Carve waits on a slow AI response, since when: the start of the
 * turn that is waiting, so the clock matches how long the person has waited. */
export function universalComputerServiceWaitSince(session: Pick<UniversalComputerSession, 'status' | 'activityEvents'>): string | null {
  if (session.status !== 'running' && session.status !== 'starting') return null
  const events = session.activityEvents
  const last = events.at(-1)
  if (!last || last.headline !== 'Waiting for model response') return null
  for (let index = events.length - 2; index >= 0; index--) {
    const event = events[index]!
    if (event.headline === 'Waiting for model response') continue
    return event.phase === 'deciding' || event.phase === 'observing' || event.phase === 'preparing' ? event.startedAt : last.startedAt
  }
  return last.startedAt
}

/** When Carve is waiting on the person, the capsule shows since when, so the
 * clock is visibly on their side rather than Carve's. */
export function universalComputerWaitingSince(session: Pick<UniversalComputerSession, 'status' | 'phaseStartedAt' | 'updatedAt'>): string | null {
  return universalWaitingStatuses.includes(session.status) ? session.phaseStartedAt || session.updatedAt : null
}
