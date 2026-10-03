import { isComputerActionValidationFailure } from './computer-use/batch.js'
import { captureRefusalLabelEnabled, screenCaptureRefused } from './capture-refusal.js'
import { maximumRetryNoteCharacters } from './computer-use/universal-termination.js'
import { capsuleFailureMessage } from './capsule-feedback.js'
import { universalComputerActivityPhase } from './universal-interaction-state.js'
import { isApprovalPreset, type ApprovalPreset } from './approval-preference.js'
import { assistanceRequestMaxLength } from './assistance-request.js'
import { parseDrawingEdit, type DrawingEdit } from './annotation-scene.js'
import type { GuideAnnotation } from './guide-annotations.js'
import { capsuleDecision, type CapsuleDecision } from './live-computer-supervision.js'
import { boundNavigationDestinations } from './navigation-authority.js'
import { liveComputerGoalSeeksInformation } from './live-computer-planning.js'
import { liveComputerActivityPhase, liveComputerOverlayPhaseCopy, liveComputerProgressHealth, liveComputerProgressHealthLabel, type LiveComputerProgressHealth } from './live-computer-activity.js'
import type { LiveComputerAction, LiveComputerActionKind, LiveComputerActivityPhase, LiveComputerSession, LiveComputerTarget, UniversalComputerSession } from './types.js'
import { cleanCompletionResultText, universalComputerCompletionKind, universalComputerCompletionResult } from './universal-completion.js'
import { preparationChecklist, universalComputerChecklist, universalComputerServiceWaitSince, universalComputerTurnOverrun, universalComputerWaitingSince, type LiveComputerChecklistItem } from './live-computer-progress.js'
import type { GuideAnswer, GuideGrounding } from './guide.js'
import type { AssistanceState, AssistanceMode, AssistanceCommandIdentity } from './conversation-interaction.js'

export interface LiveComputerOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LiveComputerOverlayLayout {
  window: LiveComputerOverlayRect
  frame: LiveComputerOverlayRect
  badge: { x: number; y: number; maxWidth: number; inside: boolean; dock: LiveComputerOverlayDock }
}

export type LiveComputerOverlayInsideDock = 'inside-bottom-left' | 'inside-bottom-right' | 'inside-top-left' | 'inside-top-right'
export type LiveComputerOverlayDock = 'above-left' | 'below-right' | LiveComputerOverlayInsideDock | 'inside-center' | 'away-top-right' | 'manual'

export interface LiveComputerOverlayLayoutOptions {
  /** Local to the selected window. Used only to move an inside capsule away
   * from the control Carve is about to manipulate. */
  cuePoint?: { x: number; y: number } | null
  /** Retain the prior inside corner until it would occlude the action cue. */
  preferredInsideDock?: LiveComputerOverlayInsideDock
  /** Every annotation, in selected-window logical coordinates. */
  avoidBounds?: LiveComputerOverlayRect[]
  /** User-chosen position relative to the selected window, in screen points. */
  position?: { x: number; y: number } | null
  /** Human-blocking decisions use the center of the active display instead
   * of reading like another status update at the edge of the work. */
  centered?: boolean
  /** The selected window is behind another one. The capsule leaves it for
   * one fixed place, the top-right of the display (passed as both target and
   * display), so it never sits in the corner of whatever window is in front
   * and reads as that window's. */
  away?: boolean
}

export interface LiveComputerOverlayWindowState {
  /** Age only, never key content or pointer locations. Used to retire cues. */
  inputAgeMs?: number
  available: boolean
  focused: boolean
  /** Exact normal-level window beneath Carve's floating capsule, if known. */
  frontmostNormal?: boolean
  bounds: LiveComputerOverlayRect | null
}

/** The exact target must remain the frontmost normal window during a
 * capsule interaction. Engagement bridges macOS activation before key focus. */
export function liveComputerCapsuleVisible(state: LiveComputerOverlayWindowState, focus: {
  targetBundleIdentifier: string
  frontmostBundleIdentifier: string | null
  capsuleFocused: boolean
  capsuleEngaged?: boolean
  mainWindowFocused: boolean
}): boolean {
  if (!state.available || !state.bounds || focus.mainWindowFocused) return false
  if (state.focused && (!focus.frontmostBundleIdentifier || focus.frontmostBundleIdentifier === focus.targetBundleIdentifier)) return true
  return state.frontmostNormal === true && (focus.capsuleFocused || focus.capsuleEngaged === true) && focus.frontmostBundleIdentifier === 'app.carve.desktop'
}

/** Deliberately excludes typed text, goals, expected states, and model
 * summaries. The desktop overlay should explain the physical interaction
 * without turning a screen share into a second data-exfiltration surface.
 * The single exception is the terminal completion answer — see
 * liveComputerCompletionAnswer. */
export interface LiveComputerOverlayAction {
  id: string
  kind: LiveComputerActionKind
  targetLabel: string | null
  point: { x: number; y: number } | null
  endPoint?: { x: number; y: number } | null
  elementAction?: LiveComputerAction['elementAction']
  command?: LiveComputerAction['command']
  scrollY: number | null
  key: string | null
  /** Window-relative bounds of the validated target element, when the
   * controller stamped one. Geometry only — the frame draws aim brackets. */
  targetBounds: LiveComputerOverlayRect | null
}

export interface LiveComputerOverlayCue {
  sequence: number
  occurredAt: number
  action: LiveComputerOverlayAction
}

export type LiveComputerOverlayTheme = 'selected' | 'active' | 'checking' | 'paused' | 'attention' | 'complete'
export type LiveComputerOverlayCueKind = 'none' | 'pointer' | 'click' | 'scroll' | 'typing' | 'key' | 'wait'

export interface LiveComputerOverlayPresentation {
  assistance?: AssistanceState | undefined
  sessionId: string
  /** Carve is holding its next step for the person (person-turn.ts). */
  personTurn?: { reason: PersonTurnPresentationReason; since: string; compactLabel: string } | null
  /** The selected window is behind another; the capsule waits at the display's top-right and names it. */
  away?: boolean
  /** Local builds only: the model in use, shown as a small debug tag on the Line and Card. */
  debugModel?: string | null
  sharingStatus?: string | null
  /** User-facing task goal for a specific spoken acknowledgement. */
  taskGoal?: string
  /** The request's short title from interpretation, or the actor's result heading once one exists; the spoken acknowledgement uses it instead of echoing the request. */
  taskTitle?: string
  /** Stable across presentation/session handoffs within one work run. */
  voiceContextId?: string
  /** State timestamps are distinct from the renderer's heartbeat. */
  completionEvidence?: 'verified' | 'model_reported' | null
  /** Result card heading: the request's title, else the answer's first sentence; never the verification state. */
  resultTitle?: string | null
  /** How long the task took, for the result footer. */
  elapsedLabel?: string | null
  updatedAt?: string | null
  phaseStartedAt?: string | null
  frameVisible?: boolean
  canPause?: boolean
  canResume?: boolean
  /** The pause request is pending; the current action may still be finishing. */
  pausing?: boolean
  decision?: CapsuleDecision | null
  /** The person is asked to choose (Explain is on: "Start task" or "Keep explaining"). Like a decision, it keeps the capsule on screen. */
  personChoice?: 'switch_mode' | null
  workConsent?: { providerId: string; providerName: string; catalog?: boolean } | null
  application: string
  phase: LiveComputerActivityPhase
  health: LiveComputerProgressHealth
  healthLabel: string
  startedAt: string | null
  endedAt: string | null
  theme: LiveComputerOverlayTheme
  label: string
  detail: string
  /** Terminal completion result, shown wrapped in an expanded capsule. For
   * assured sessions this is criterion-verified; for Universal sessions it is
   * explicitly labeled model-reported. This is the one model-text exception
   * to the overlay's no-summaries rule. */
  answer: string | null
  /** True only when the capsule offers controls: the terminal completed state
   * (follow-up field, expand), a mission plan awaiting approval (Start), or
   * the hotkey ask capsule. Every executing state stays click-through so the
   * frame can never intercept input meant for the selected window. */
  interactive: boolean
  /** 'launch' is the status-only handoff before the execution service has
   * published a session; 'ask' renders the legacy hotkey question capsule;
   * 'guide' answers and points without ever sending input; 'steer' carries
   * active Universal interruption controls; 'budget' is a strict no-input
   * checkpoint; 'result' is a terminal result with a door to Carve. */
  mode: 'session' | 'launch' | 'ask' | 'guide' | 'steer' | 'budget' | 'result' | 'failure'
  /** Guide capsule state. The answer rides the `answer` field: the person
   * just asked a question, so its answer belongs where they are looking —
   * the same explicit-human-request carve-out as completion answers and
   * guidance. The pointer is controller-validated geometry (an element from
   * the captured digest, or a bounded estimate ring), never model-supplied
   * bounds. */
  guide: GuideCapsulePresentation | null
  /** Universal mode exposes a single controller-owned interruption surface.
   * This flag lets an empty submit explicitly resume a paused run. */
  steeringPaused: boolean
  /** True when the last direction was discarded because it requires a new
   * Work contract. An empty submit keeps the original scope and resumes. */
  steeringReview: boolean
  steeringReceiptId: string | null
  /** Set while the session's mission plan awaits approval: the capsule offers
   * a hash-bound Start control beside the plan's step titles. Titles ride the
   * same explicit-human-decision carve-out as guidance and completion answers —
   * they exist only to be judged before anything runs. Step instructions,
   * success states, the outcome, and the goal stay inside the Carve window. */
  planApproval: {
    planHash: string
    stepCount: number
    stepTitles: string[]
    /** The windows this plan may use, in order, each with its source. */
    route?: LiveComputerOverlayRouteStop[]
    /** A fresh browser window the goal implies but the route lacks. Choosing
     * it opens the window and adds it before Start; Start still approves. */
    freshSuggestion?: { bundleIdentifier: string; application: string; url: string | null; label: string } | null
  } | null
  /** The authorized route while a multi-window session runs: where Carve is
   * now, where it has been, where it may go next. Null for one window. */
  route?: LiveComputerOverlayRouteStop[] | null
  /** True when the window under the frame is one Carve opened itself. */
  freshSurface?: boolean
  /** Whether the capsule may offer its dictation mic. Stamped by the desktop
   * shell from the control plane's dictation status; builders default to
   * false. */
  voice?: { available: boolean; enabled: boolean }
  dictationAvailable: boolean
  dictationSharingAllowed?: boolean
  /** While Carve works and no one is touching the capsule, the desktop shell
   * collapses it to one quiet line: mark, current activity, clock, Stop.
   * Decision states never collapse. Stamped by the shell at present time. */
  collapsed?: boolean
  minimized?: boolean
  minimizeAvailable?: boolean
  /** The capsule's size, chosen by the shell from the presentation: the Dot
   * (orb and ring only), the Line (one row: orb, lease lamp, verb, clock,
   * Stop), or the Card (the Line plus every row beneath it). `collapsed` and
   * `minimized` remain as the boolean projections of `line` and `dot`. */
  tier?: LiveComputerOverlayTier
  /** Who holds the pointer and keyboard right now, for the lease lamp:
   * Carve is only looking, Carve is sending input, the person has it, work is
   * paused, Carve is waiting on a decision, or the work is done. */
  inputLease?: LiveComputerInputLease
  /** Closed-vocabulary activity copy for the one-line pill. It deliberately
   * omits target names and other unbounded text so the collapsed state never
   * needs to communicate by truncation. Stamped by the desktop shell. */
  compactLabel?: string
  /** The application the Line may name beside its verb. The renderer shows it
   * only when the capsule is detached from its window or the route spans
   * more than one window; inside its own frame the name is redundant. */
  compactApplication?: string
  /** Inputs used against the approved allowance, 0..1, for the ring around
   * the mark. Null when the session carries no allowance. */
  progressFraction?: number | null
  /** Set while the session holds on a decision point: the question and its
   * option chips. Consequence text rides too — this is model text shown at an
   * explicit human decision, the same carve-out class as completion answers. */
  guidance: { id?: string; question: string; context?: string; options: Array<{ id: string; label: string; consequence: string; mode: 'agent_continues' | 'person_takes_over' }> } | null
  /** Exact, controller-authored resource checkpoint. The held provider batch
   * has not run; the only additive action is the explicit bounded grant. */
  budgetCheckpoint: UniversalComputerSession['pendingBudgetCheckpoint']
  /** Controller-authored terminal failure feedback. Failure copy is derived
   * from the failure taxonomy, never provider reasoning. A retry always starts
   * a fresh Work contract and provider chain. */
  failure: { title?: string; message: string; canRetry: boolean; offerAutopilot?: boolean } | null
  progress: string
  shortcut: string
  /** Stamped by the desktop: a bare Escape outside Carve's windows also stops this work. */
  escapeStops?: boolean
  cueKind: LiveComputerOverlayCueKind
  cueLabel: string | null
  cueDirection: 'up' | 'down' | null
  cuePoint: { x: number; y: number } | null
  cueSequence: number
  proposed: boolean
  /** Window-relative bounds of the control the current input is grounded on,
   * drawn as aim brackets before the input lands. Null for proposals, for
   * actions without a validated element, and whenever no input is executing:
   * a bare point never grows a rectangle. */
  aimBounds: LiveComputerOverlayRect | null
  aimSequence: number
  /** Identity and capture time of the latest frame the model will decide
   * from. The renderer fires one read exposure per change, coalesced and
   * freshness-gated, so local settle probes and stale re-shows stay silent. */
  readKey: string | null
  readAt: string | null
  /** Controller-fact progress rows for the working Card: what is done, what
   * is happening now, what comes next. Never estimated, never model text
   * beyond the person's own request echoed back to them. */
  checklist?: LiveComputerChecklistItem[] | null
  /** Set while Carve waits on the person, so the capsule can show how long
   * the task has been waiting on them. */
  waitingSince?: string | null
  /** The model's declared next step (compact narration lever). Intent, not a
   * fact: the renderer styles it as pending, and it never names delivered
   * input. Bounded and sanitized before it reaches the session. */
  intent?: string | null
  /** Physical inputs delivered so far, for the Line's second line. */
  inputsDone?: number
  /** Set while a slow AI response holds the task, for a live wait clock. */
  serviceWaitSince?: string | null
}

export type GuideCapsuleState = 'idle' | 'reading' | 'thinking' | 'answered' | 'failed'

export interface GuideCapsulePresentation {
  state: GuideCapsuleState
  /** Identity of the answer on show, so the renderer speaks each answer once
   * and holds its pointer until the next state change. */
  answerId: string | null
  grounding: GuideGrounding | null
  annotations?: GuideAnnotation[]
  frameSize?: { width: number; height: number }
  pointer: { kind: 'element' | 'visual'; bounds: LiveComputerOverlayRect; shape?: 'outline' | 'circle' | 'arrow'; expiresAt?: number } | null
  /** Monotonic per answer so a re-render never restarts the pointer motion. */
  pointerSequence: number
  offerToDo: boolean
  /** Controller-authored failure copy. Never provider text. */
  failure: string | null
  /** Screen Recording and Accessibility as the capsule should describe them:
   * without Accessibility the pointer can only ever be an estimate. */
  accessibility: 'granted' | 'denied' | 'unknown'
  /** When the only thing standing between the question and an answer is the
   * frame-sharing consent for a hosted provider, the capsule can collect it
   * in place. Null whenever consent is not what failed. */
  consentProviderId: string | null
  consentProviderName: string | null
  consentCatalog?: boolean
  /** The allowance is used up: the capsule offers plans (Settings → Account) instead of a retry. */
  allowance?: boolean
}

export interface LiveComputerOverlayRouteStop {
  application: string
  title: string
  state: 'done' | 'now' | 'next'
  source: 'existing' | 'fresh' | 'ask'
}

export interface LiveComputerOverlayBuildOptions {
  /** `${bundleIdentifier}:${windowId}` of every window Carve opened itself. */
  freshWindowKeys?: ReadonlySet<string>
  /** A fresh browser window the goal implies; offered on the plan capsule. */
  freshSuggestion?: { bundleIdentifier: string; application: string; url: string | null; label: string } | null
}

/** The desktop owns this short handoff state before the execution service has
 * published a session. In particular, opening or foregrounding a fresh work
 * window can precede the first selected-window capture by several seconds.
 * Keeping that interval explicit means the person never has to infer whether
 * Carve noticed the Start gesture. The copy is controller-authored and carries
 * no goal, window title, or provider reasoning. */
export function buildLiveComputerLaunchPresentation(
  launchId: string,
  target: LiveComputerTarget,
  shortcut: string,
  startedAt: string,
  request: string | null = null,
): LiveComputerOverlayPresentation {
  return {
    sessionId: `launch:${launchId}`,
    checklist: preparationChecklist({ request, application: target.application, stage: 'launching' }),
    application: target.application.slice(0, 80),
    phase: 'preparing',
    health: 'starting',
    healthLabel: liveComputerProgressHealthLabel('starting'),
    startedAt,
    endedAt: null,
    theme: 'checking',
    label: 'Carve · Getting ready',
    detail: `Checking access to ${target.application.slice(0, 80)} and preparing a fresh view. Nothing has been clicked or typed.`,
    answer: null,
    interactive: false,
    mode: 'launch',
    guide: null,
    steeringPaused: false,
    steeringReview: false,
    steeringReceiptId: null,
    planApproval: null,
    route: null,
    freshSurface: false,
    dictationAvailable: false,
    guidance: null,
    budgetCheckpoint: null,
    failure: null,
    progressFraction: null,
    progress: 'Starting · no input sent',
    shortcut,
    cueKind: 'none',
    cueLabel: null,
    cueDirection: null,
    cuePoint: null,
    cueSequence: 0,
    proposed: false,
    aimBounds: null,
    aimSequence: 0,
    readKey: null,
    readAt: null,
  }
}

export interface GuideCapsuleInput {
  state: GuideCapsuleState
  answer: GuideAnswer | null
  failure: string | null
  failureKind?: 'search_uncited' | 'allowance' | 'task_start'
  sequence: number
  accessibility?: 'granted' | 'denied' | 'unknown'
  /** The hosted provider whose frame-sharing consent is still missing. */
  consent?: { providerId: string; providerName: string; catalog?: boolean } | null
}

function guideGroundingCopy(grounding: GuideGrounding | null, accessibility: GuideCapsulePresentation['accessibility']): string {
  switch (grounding) {
    case 'element': return 'Pointing to the button or field · no clicks or typing'
    case 'visual': return 'Approximate location from the screenshot · no clicks or typing'
    case 'none': return accessibility === 'denied'
      ? 'Answered from the picture · allow Accessibility for exact pointers'
      : 'Answer only · no clicks or typing'
    default: return 'No input was sent'
  }
}

/** The Guide capsule: a question field framed on the window the person was
 * looking at, then a short answer with a pointer at the control it names. No
 * session exists, no plan is made, and no input can be sent from this
 * capsule; the only way to act is the Turn into task chip, which starts the
 * ordinary supervised Work flow and its hash-bound plan approval. */
export function buildLiveComputerGuidePresentation(target: LiveComputerTarget, shortcut: string, guide: GuideCapsuleInput): LiveComputerOverlayPresentation {
  const accessibility = guide.accessibility ?? 'unknown'
  const answer = guide.state === 'answered' ? guide.answer : null
  const pointer = answer?.pointer
    ? { kind: answer.pointer.kind, shape: answer.pointer.shape ?? 'outline', bounds: { x: answer.pointer.bounds.x, y: answer.pointer.bounds.y, width: answer.pointer.bounds.width, height: answer.pointer.bounds.height } }
    : null
  let label = 'Carve · Ask about this window'
  let detail = 'Ask about this window. Carve can explain and point things out without clicking or typing.'
  let theme: LiveComputerOverlayTheme = 'selected'
  switch (guide.state) {
    case 'reading':
      label = 'Carve · Reading the window'; detail = 'One picture of this window is being read. No input is sent.'; theme = 'checking'; break
    case 'thinking':
      label = 'Carve · Thinking'; detail = 'Working out the answer from the picture and the window’s controls.'; theme = 'checking'; break
    case 'answered':
      label = answer?.grounding === 'element' ? 'Carve · Here' : 'Carve · Answer'
      detail = guideGroundingCopy(answer?.grounding ?? null, accessibility)
      theme = 'complete'
      break
    case 'failed':
      if (guide.consent) {
        label = 'Carve · One permission needed'
        detail = guide.consent.catalog ? `Allow app names and selected-window content to go to ${guide.consent.providerName} for your tasks?` : `Allow this window’s images, visible text and controls, and conversation context to go to ${guide.consent.providerName} when you ask?`
      } else if (guide.failureKind === 'allowance') {
        // Not a fault to retry: the plan's allowance ran out. The capsule offers plans.
        label = 'Carve · Your allowance is used up'
        // Carve's own copy for the gateway code (cloudErrorMessage), never provider text.
        detail = guide.failure?.trim().slice(0, 300) || 'Your Carve allowance is used up. Choose a plan or a task pack to continue.'
      } else if (guide.failureKind === 'task_start' && guide.failure?.trim()) {
        // A task that could not start (in testing, a saved window's new title read as "closed"). The reason is
        // Carve's own copy, never provider text, so it is shown instead of a generic "Couldn't answer".
        label = 'Carve · Couldn’t start the task'
        detail = capsuleFailureMessage(guide.failure, guide.failure.trim().slice(0, 300))
      } else if (guide.failureKind === 'search_uncited') {
        // Not a failure of Carve's: the web had nothing to cite for a question about this page.
        label = 'Carve · Nothing to cite online'
        detail = 'That question depends on what’s on this page. I can check it here.'
      } else {
        label = 'Carve · Couldn’t answer'
        detail = capsuleFailureMessage(guide.failure, 'Carve couldn’t answer this request. Try again, or open task details in Carve.')
      }
      theme = 'attention'
      break
    case 'idle':
      break
  }
  return {
    sessionId: `guide:${target.windowId}:${target.bundleIdentifier}`,
    application: target.application.slice(0, 80),
    phase: guide.state === 'reading' || guide.state === 'thinking' ? 'deciding' : guide.state === 'answered' ? 'ended' : 'waiting',
    health: guide.state === 'answered' ? 'complete' : 'waiting',
    healthLabel: liveComputerProgressHealthLabel(guide.state === 'answered' ? 'complete' : 'waiting'),
    startedAt: null,
    endedAt: null,
    theme,
    label,
    detail,
    answer: answer ? answer.answer : null,
    interactive: true,
    mode: 'guide',
    guide: {
      state: guide.state,
      answerId: answer?.id ?? null,
      grounding: answer?.grounding ?? null,
      pointer,
      annotations: answer?.annotations ?? [],
      ...(answer?.frameSize ? { frameSize: answer.frameSize } : {}),
      pointerSequence: pointer ? guide.sequence : 0,
      offerToDo: answer?.offerToDo === true,
      failure: guide.state === 'failed' ? detail : null,
      accessibility,
      consentProviderId: guide.state === 'failed' && guide.consent ? guide.consent.providerId : null,
      consentProviderName: guide.state === 'failed' && guide.consent ? guide.consent.providerName : null,
      consentCatalog: guide.consent?.catalog === true,
      allowance: guide.state === 'failed' && guide.failureKind === 'allowance',
    },
    steeringPaused: false,
    steeringReview: false,
    steeringReceiptId: null,
    planApproval: null,
    dictationAvailable: false,
    guidance: null,
    budgetCheckpoint: null,
    failure: null,
    progress: 'Guide · no input',
    shortcut,
    cueKind: 'none',
    cueLabel: null,
    cueDirection: null,
    cuePoint: null,
    cueSequence: 0,
    proposed: false,
    aimBounds: null,
    aimSequence: 0,
    // One Read exposure per captured frame: the capture is the real event.
    readKey: answer ? `guide:${answer.frameSha256}` : null,
    readAt: answer?.frameCapturedAt ?? null,
  }
}

/** Lead between the aim brackets settling on the grounded control and the
 * physical input. It is the only latency Read & Aim adds, so it lives in one
 * bounded constant that review and tests can see. */
export const liveComputerAimLeadMs = 180

/** How long a delivered input's cue still describes what Carve is doing. */
export const liveComputerCueFreshMs = 1_600

/** Only pointer input is held. Typing into an already-focused field and key
 * chords still show brackets when bounds exist, but nothing is gained by
 * delaying them, and field transactions would otherwise pay the lead twice. */
export function liveComputerAimHoldMs(action: Pick<LiveComputerAction, 'kind' | 'targetBounds'>): number {
  if (!action.targetBounds) return 0
  return action.kind === 'click' || action.kind === 'move' || action.kind === 'drag' || action.kind === 'element_action'
    ? liveComputerAimLeadMs
    : 0
}

export type LiveComputerOverlayTier = 'dot' | 'line' | 'card'
export type LiveComputerInputLease = 'observe' | 'act' | 'you' | 'paused' | 'wait' | 'done'

const overlayPadding = 8
// The base badge fits its label/detail column beside the meta column's
// progress line, Stop pill, and shortcut hint.
const badgeHeight = 132
// The Line: one 44px row that hugs its content. The window reserves a
// little shadow room beneath it so the pill is never clipped.
const lineBadgeHeight = 70
const lineBadgeWidthCap = 354
// The Dot: the orb, its ring, and the status dot. Click restores the Line.
const dotBadgeSize = 48
const badgeGap = 6
const badgeWidthCap = 440
const wideBadgeWidthCap = 440
const decisionBadgeWidthCap = 440
const answerLineHeight = 15
// A completed answer is the capsule's primary content. Give it a substantial
// viewport and scroll only when the available screen, rather than an arbitrary
// character limit, requires it.
const resultPreviewLineLimit = 28
const guideAnswerLineLimit = 24

/**
 * The one place model-authored text is allowed onto the desktop frame. The
 * overlay excludes goals, typed text, and step summaries throughout a session
 * so a screen share never becomes a second exfiltration surface — but a goal
 * that asked a question owes its answer where the person is looking. This
 * releases only the criterion-verified result summary, only in the terminal
 * completed state, and only for information-seeking goals; action-only goals
 * keep the compact completion receipt.
 */
export function liveComputerCompletionAnswer(session: LiveComputerSession): string | null {
  if (session.status !== 'completed') return null
  const summary = session.resultSummary ? cleanCompletionResultText(session.resultSummary, null, true, true) : null
  if (!summary) return null
  if (!liveComputerGoalSeeksInformation(session.goal, session.ledger)) return null
  return summary
}

/** A collapsed capsule has room for one complete thought, not a shortened
 * sentence. Map every physical cue to a small closed vocabulary and retain a
 * phase label only when it is already concise. Unknown prose becomes the
 * truthful generic "Working" instead of an ambiguous visual ellipsis. */
export function liveComputerCompactLabel(
  presentation: Pick<LiveComputerOverlayPresentation, 'label' | 'cueKind' | 'cueLabel' | 'cueDirection'> & Partial<Pick<LiveComputerOverlayPresentation, 'intent'>>,
): string {
  // A cue label names its control in quotes ("Clicking “Search”"). A short
  // control name reads better than the generic noun; a long or absent one
  // falls back to the closed vocabulary so the Line never truncates.
  const noun = compactControlNoun(presentation.cueLabel)
  switch (presentation.cueKind) {
    case 'pointer': return /^drag/iu.test(presentation.cueLabel ?? '') ? `Dragging ${noun ?? 'control'}` : 'Moving pointer'
    case 'click':
      if (/^open/iu.test(presentation.cueLabel ?? '')) return `Opening ${noun ?? 'control'}`
      if (/^(?:increas|decreas|adjust)/iu.test(presentation.cueLabel ?? '')) return `Adjusting ${noun ?? 'control'}`
      return `Clicking ${noun ?? 'control'}`
    case 'scroll': return `Scrolling ${presentation.cueDirection ?? 'window'}`
    case 'typing': return /^apply/iu.test(presentation.cueLabel ?? '') ? 'Applying result' : noun ? `Typing in ${noun}` : 'Typing'
    case 'key':
      if (/return/iu.test(presentation.cueLabel ?? '')) return 'Pressing Return'
      if (/tab/iu.test(presentation.cueLabel ?? '')) return 'Switching field'
      return 'Using the keyboard'
    case 'wait': return /^switch/iu.test(presentation.cueLabel ?? '') ? 'Switching window' : 'Waiting for window'
    case 'none': {
      if (presentation.intent) return compactHeading(presentation.intent, 28)
      const phase = presentation.label.replace(/^Carve\s*·\s*/u, '').trim()
      return phase.length > 0 && phase.length <= 28 ? phase : 'Working'
    }
  }
}

/** The quoted control name inside a cue label, when it is short enough to
 * sit in the Line without an ellipsis. Anything longer is private or
 * unbounded text and stays off the pill. */
function compactControlNoun(cueLabel: string | null | undefined): string | null {
  const match = /[“"]([^”"]{1,18})[”"]/u.exec(cueLabel ?? '')
  if (!match) return null
  const noun = match[1]!.trim()
  return noun.length > 0 && !/\s{2,}|\n/u.test(noun) ? noun : null
}

/** Who holds the input right now, derived from the presentation the shell
 * already carries. `you` is reserved for an explicit lease release (the
 * attachments plan) and is never inferred here. */
export function liveComputerInputLease(
  presentation: Pick<LiveComputerOverlayPresentation, 'phase' | 'theme' | 'mode'>
    & Partial<Pick<LiveComputerOverlayPresentation, 'decision' | 'planApproval' | 'guidance' | 'budgetCheckpoint' | 'failure' | 'inputLease' | 'endedAt'>>,
): LiveComputerInputLease {
  if (presentation.inputLease) return presentation.inputLease
  if (presentation.theme === 'complete' || presentation.phase === 'complete') return 'done'
  if (presentation.decision || presentation.planApproval || presentation.guidance || presentation.budgetCheckpoint || presentation.failure) return 'wait'
  if (presentation.theme === 'attention' || presentation.phase === 'waiting') return 'wait'
  if (presentation.theme === 'paused' || presentation.phase === 'paused') return 'paused'
  if (presentation.phase === 'ended' || presentation.endedAt) return 'wait'
  if (presentation.phase === 'acting') return 'act'
  return 'observe'
}

/** The badge width the layout will grant for a capsule over this window.
 * Capsules carrying multi-line content — a completion answer, a plan row,
 * guidance chips — get a wider cap so their text is not squeezed into an
 * ellipsis at ordinary window sizes. */
export function liveComputerOverlayBadgeWidth(
  _targetWidth: number,
  presentation: Pick<LiveComputerOverlayPresentation, 'answer' | 'planApproval' | 'guidance'>
    & Partial<Pick<LiveComputerOverlayPresentation, 'mode'>>
    & Partial<Pick<LiveComputerOverlayPresentation, 'budgetCheckpoint' | 'failure' | 'guide' | 'collapsed' | 'minimized' | 'decision'>>,
): number {
  if (presentation.minimized) return dotBadgeSize
  if (presentation.collapsed) return lineBadgeWidthCap
  if (presentation.mode === 'budget' || presentation.decision) return decisionBadgeWidthCap
  const textRich = presentation.mode === 'ask' || presentation.mode === 'steer'
    || Boolean(presentation.answer || presentation.planApproval || presentation.guidance || presentation.budgetCheckpoint || presentation.failure || presentation.guide)
  return textRich ? wideBadgeWidthCap : badgeWidthCap
}

/** The completion answer wraps inside the copy column. Estimate the lines it
 * needs from the width the layout will grant so the capsule grows to show the
 * whole answer; the CSS line clamp stays only as the backstop for the
 * estimate's worst case. */
function answerCapsuleHeight(answer: string, badgeMaxWidth: number, lineLimit = resultPreviewLineLimit): number {
  // The answer spans the full capsule width beneath the status row. Results
  // grow through a substantial reading viewport and scroll only when the
  // screen cannot reasonably hold more. Guide follows the same principle.
  const previewWidth = Math.max(120, badgeMaxWidth - 36)
  const charactersPerLine = Math.max(20, Math.floor(previewWidth / 6))
  const estimatedLines = answer.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0)
  const lines = Math.min(lineLimit, Math.max(2, estimatedLines))
  // Header, grid gaps, evidence row, and the two result controls consume a
  // little more space than their line boxes. Reserve it explicitly so an
  // outside-below capsule is never clipped by its BrowserWindow.
  return 78 + lines * answerLineHeight
}

/** The completion answer wraps over several lines and the interactive
 * capsule adds a control row (follow-up field, ask field, or plan Start), so
 * those capsules need more vertical room than the single-line status badge. */
export function liveComputerOverlayBadgeHeight(
  presentation: Pick<LiveComputerOverlayPresentation, 'answer' | 'interactive' | 'planApproval' | 'guidance'>
    & Partial<Pick<LiveComputerOverlayPresentation, 'budgetCheckpoint' | 'failure' | 'guide' | 'decision'>>
    & Partial<Pick<LiveComputerOverlayPresentation, 'mode' | 'collapsed' | 'minimized' | 'route' | 'workConsent' | 'assistance' | 'checklist'>>,
  badgeMaxWidth = badgeWidthCap,
): number {
  if (presentation.minimized) return dotBadgeSize
  if (presentation.collapsed) return lineBadgeHeight
  if (presentation.decision) return 560
  // The Guide answer shows its grounding row (optional task handoff and
  // speech toggle) beneath
  // the answer and above the question field. A failed Guide shows its
  // controller copy in the detail line, so it needs no extra room.
  const guideRoom = presentation.guide?.state === 'answered'
    ? 52
    : presentation.guide?.state === 'failed' && presentation.guide.consentProviderId
      ? 128
      : 0
  // Interactive capsules reserve the composer at its largest auto-growing
  // height. The badge itself stays content-sized; this room makes sure the
  // transparent BrowserWindow never clips it as typing or dictation adds lines.
  const controlRoom = presentation.interactive ? presentation.mode === 'result' ? 184 : presentation.mode === 'failure' ? 0 : presentation.mode === 'budget' ? 0 : 136 : 0
  // Failures give their complete explanation a full-width row and keep the
  // recovery buttons beneath it. This reserve remains stable even when all
  // three recovery choices are present.
  const failureRoom = presentation.failure ? 112 : 0
  // Plan approval lists its step titles above the Start/Adjust row (the row
  // itself is the interactive control room). One extra line advertises any
  // steps beyond the titles the capsule carries.
  const planTitleLines = presentation.planApproval
    ? presentation.planApproval.stepTitles.length
      + (presentation.planApproval.stepCount > presentation.planApproval.stepTitles.length ? 1 : 0)
    : 0
  const wrappedPlanLines = presentation.planApproval?.stepTitles.reduce((lines, title) => lines + Math.max(1, Math.ceil(title.length / 48)), 0) ?? 0
  const planRoom = planTitleLines > 0 ? Math.min(214, Math.max(22 + planTitleLines * 30, 22 + wrappedPlanLines * 16)) : 0
  // The route strip is one line; the fresh-window offer on the plan capsule
  // is one chip row.
  const routeStops = presentation.route ?? presentation.planApproval?.route ?? null
  const routeRoom = routeStops && (routeStops.length > 1 || presentation.planApproval?.freshSuggestion) ? 26 : 0
  const freshOfferRoom = presentation.planApproval?.freshSuggestion ? 30 : 0
  // A decision point shows its question plus a wrapping chip row.
  const guidanceContextRoom = presentation.guidance?.context
    ? 8 + Math.ceil(presentation.guidance.context.length / Math.max(20, Math.floor((badgeMaxWidth - 48) / 7))) * 18
    : 0
  const guidanceRoom = presentation.guidance ? (presentation.guidance.options.length > 2 ? 118 : 82) + guidanceContextRoom : 0
  // A budget decision is not a compact status row. It explains why Carve is
  // paused, what approval means in everyday language, and offers two clear
  // choices, so reserve the full centered decision card.
  const budgetRoom = presentation.budgetCheckpoint ? 260 : 0
  // On very narrow displays the status column moves under the title instead
  // of causing either to disappear.
  const narrowRoom = badgeMaxWidth <= 300 ? 48 : 0
  // The working Card lists its progress rows under the status copy: one line
  // each, plus a second line for a row that carries detail.
  const checklistRoom = presentation.checklist?.length && !presentation.answer
    ? 96 + presentation.checklist.reduce((room, item) => room + 28 + (item.detail ? 18 : 0), 0)
    : 0
  const answerLineLimit = presentation.mode === 'guide' ? guideAnswerLineLimit : resultPreviewLineLimit
  // Reserve the chapter header and result
  // review disclosure in the native window as well as the HTML layout.
  const signatureRoom = presentation.mode ? ['ask', 'guide', 'result'].includes(presentation.mode) ? 48 : 32 : 0
  return (presentation.answer ? answerCapsuleHeight(presentation.answer, badgeMaxWidth, answerLineLimit) : badgeHeight) + controlRoom + failureRoom + planRoom + guidanceRoom + budgetRoom + guideRoom + (presentation.workConsent ? 184 : 0) + narrowRoom + routeRoom + freshOfferRoom + checklistRoom + (presentation.assistance ? 80 : 0) + signatureRoom
}

/** The hotkey capsule: a question field framed on the window the person was
 * looking at when they pressed the shortcut. No session exists yet and no
 * input can be sent; submitting the question starts the ordinary supervised
 * Work flow bound to exactly this window. */
/** The Do-it capsule: a task field framed on the window the person is
 * looking at. Once a task is submitted the same capsule holds a planning
 * state so the wait is never blank; the session's own capsule takes over
 * the moment the plan is ready. */
export function buildLiveComputerAskPresentation(target: LiveComputerTarget, shortcut: string, planning = false, immediate = false, consent: LiveComputerOverlayPresentation['workConsent'] = null): LiveComputerOverlayPresentation {
  return {
    sessionId: `ask:${target.windowId}:${target.bundleIdentifier}`,
    workConsent: planning ? null : consent,
    application: target.application.slice(0, 80),
    phase: planning ? 'deciding' : 'waiting',
    health: planning ? 'exploring' : 'waiting',
    healthLabel: liveComputerProgressHealthLabel(planning ? 'exploring' : 'waiting'),
    startedAt: null,
    endedAt: null,
    theme: planning ? 'checking' : 'selected',
    label: planning ? (immediate ? 'Carve · Starting' : 'Carve · Planning') : 'Carve · Do it in this window',
    // Assured drafts a plan the person approves in this capsule; Universal
    // starts at once and stops only for consequential steps. Say which.
    detail: planning
      ? immediate
        ? 'Reading this window. Carve starts next and pauses before consequential actions.'
        : 'Reading this window and drafting a plan for you to approve. Nothing runs yet.'
      : immediate
        ? 'Describe the outcome. Carve starts right away and pauses before consequential actions.'
        : 'Describe the outcome. Carve shows you its plan before anything runs.',
    answer: null,
    interactive: true,
    mode: 'ask',
    guide: null,
    steeringPaused: false,
    steeringReview: false,
    steeringReceiptId: null,
    planApproval: null,
    dictationAvailable: false,
    guidance: null,
    budgetCheckpoint: null,
    failure: null,
    progress: immediate ? 'Fast pace' : 'Plan first',
    shortcut,
    cueKind: 'none',
    cueLabel: null,
    cueDirection: null,
    cuePoint: null,
    cueSequence: 0,
    proposed: false,
    aimBounds: null,
    aimSequence: 0,
    readKey: null,
    readAt: null,
  }
}

/** Shared projection for the entire pre-session handoff. A model's proposed
 * action is not a completed answer and must not reopen the question form. */
export function buildLiveComputerAssistancePresentation(target: LiveComputerTarget, shortcut: string, assistance: AssistanceState,
  options: { immediate?: boolean; accessibility?: GuideCapsuleInput['accessibility']; consent?: LiveComputerOverlayPresentation['workConsent'] } = {},
): LiveComputerOverlayPresentation {
  const immediate = assistance.approvalPreset ? assistance.approvalPreset === 'fast' : options.immediate
  // Choosing between a public lookup and this window is still working out
  // the request; only an accepted task handoff is getting the window ready.
  // Rows must never move backwards between the two.
  if (assistance.preparing) {
    const handingOff = assistance.handingOff !== false
    return {
      ...buildLiveComputerAskPresentation(target, shortcut, true, immediate),
      mode: 'launch', phase: 'preparing', health: 'starting', healthLabel: liveComputerProgressHealthLabel('starting'),
      label: handingOff ? `Carve · Getting ${target.application.slice(0, 40)} ready` : 'Carve · Choosing how to help',
      detail: handingOff ? 'Checking which window to use and how to start. Nothing has been clicked or typed.' : 'Deciding whether this needs the web or this window. Nothing has been clicked or typed.',
      checklist: preparationChecklist({ request: assistance.question ?? assistance.goal, application: target.application, stage: handingOff ? 'preparing' : 'understanding', understandDetail: 'Choosing between the web and this window' }),
    }
  }
  if (assistance.showGuide) {
    const presentation = buildLiveComputerGuidePresentation(target, shortcut, {
    ...assistance.guide,
    ...(options.accessibility ? { accessibility: options.accessibility } : {}),
    consent: assistance.guide.state === 'failed' ? options.consent ?? null : null,
  })
    const switchAction = assistance.followUps.find(action => action.kind === 'switch_mode')
    if (switchAction) return { ...presentation, theme: 'attention', phase: 'waiting', health: 'waiting',
      label: 'Carve · Let Carve take action?', detail: 'Explain is on. Carve needs to click or type to carry out this request.', answer: switchAction.request,
      ...(switchChoiceKeepsCapsuleEnabled() ? { personChoice: 'switch_mode' as const } : {}) }
    if (assistance.guide.state === 'failed' && assistance.guide.failureKind !== 'search_uncited' && assistance.followUps.some(action => action.kind === 'retry_start')) {
      return { ...presentation, label: 'Carve · Couldn’t start the task' }
    }
    // A request in Do mode is being interpreted: echo it at once and name
    // the stage, instead of a bare "Thinking" for the first seconds.
    if (assistance.mode === 'do' && assistance.guide.state === 'thinking' && assistance.question) return {
      ...presentation,
      label: 'Carve · Working out what you need',
      detail: 'Reading your request against this window. Nothing has been clicked or typed.',
      checklist: preparationChecklist({ request: assistance.question, application: target.application, stage: 'understanding', understandDetail: 'Reading your request against this window' }),
    }
    return presentation
  }
  return buildLiveComputerAskPresentation(target, shortcut, false, immediate, options.consent)
}

/** The renderer's only voice back to the main process. Commands are inert
 * declarations of user intent — the main process re-validates every one and
 * acts only in the states that offer controls: the terminal completed
 * capsule, a mission plan awaiting its hash-bound approval, or the hotkey ask
 * capsule before any session exists. The two exceptions, honored in every
 * state, only ever reduce what Carve does: `stop` is the same fail-safe as
 * the global emergency-stop shortcut, and `pointer` merely reports hover so
 * the Stop control is clickable while a session executes. A compromised
 * overlay page can steer only an active Universal session, and every such
 * command first closes the controller-owned interruption gate. */
export type LiveComputerOverlayCommand =
  | { kind: 'handoff_decline'; taskId: string; revision: string }
  | { kind: 'voice_enabled'; enabled: boolean }
  | { kind: 'voice_listening'; enabled: boolean }
  | { kind: 'voice_playback'; id: number; state: 'started' | 'ended' | 'error' }
  | { kind: 'result_link'; sessionId: string; url: string }
  | { kind: 'public_source'; runId: string; url: string }
  | ({ kind: 'assistance_approvals'; preset: ApprovalPreset } & AssistanceCommandIdentity)
  | ({ kind: 'assistance_mode'; mode: AssistanceMode } & AssistanceCommandIdentity)
  | { kind: 'follow_up_accept'; conversationId: string; turnId: string; candidateId: string; commandId: string }
  | { kind: 'guide_clear' }
  | { kind: 'drawing_start' }
  | { kind: 'drawing_edit'; edit: DrawingEdit }
  | { kind: 'drawing_capture'; active: boolean; sceneId: string; revision: number }
  | { kind: 'guide_refresh' }
  | { kind: 'guide_next' }
  | { kind: 'guide_step' }
  | { kind: 'minimize'; minimized: boolean }
  /** `control` says the pointer rests on a button of the capsule (Stop, Close, Pause): the person is aiming, not reading. */
  | { kind: 'pointer'; engaged: boolean; control?: boolean }
  | { kind: 'capsule_position'; phase: 'start' | 'end' | 'cancel' | 'reset'; sessionId: string; x: number; y: number }
  | { kind: 'expand' }
  | { kind: 'pause'; sessionId: string }
  /** Bring the session's own window back so Carve can continue there. Only
   * ever the window the person already gave this session. */
  | { kind: 'show_window'; sessionId: string }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'approve_decision'; sessionId: string; id: string; revision: string }
  | { kind: 'presented'; sessionId: string; presentationId?: number }
  | { kind: 'dismiss' }
  | { kind: 'stop' }
  | { kind: 'follow_up'; text: string }
  | { kind: 'ask'; text: string }
  | { kind: 'ask_allow'; text: string; providerId: string; sessionId: string; remember?: boolean }
  | { kind: 'guide_ask'; text: string }
  | { kind: 'guide_do_it' }
  | { kind: 'open_account' }
  | { kind: 'guide_allow'; providerId: string; sessionId: string; remember?: boolean }
  | { kind: 'add_fresh_window'; bundleIdentifier: string; url: string | null }
  | { kind: 'approve_plan'; planHash: string }
  | { kind: 'revise_plan'; text: string }
  | { kind: 'guidance_option'; questionId?: string; optionId: string }
  | { kind: 'guidance'; questionId?: string; text: string }
  | { kind: 'steer_pause'; source: 'text' | 'voice' }
  | { kind: 'steer'; text: string; source: 'text' | 'voice' }
  | { kind: 'steer_resume' }
  | { kind: 'budget_grant'; checkpointId: string }
  | { kind: 'budget_finish'; checkpointId: string }
  | { kind: 'retry'; sessionId: string; preset?: 'autopilot'; note?: string }
  | { kind: 'dictate_begin'; mimeType: string; sharing?: 'session' | 'remembered' }
  | { kind: 'dictate_push'; audioBase64: string }
  | { kind: 'dictate_end' }

function sanitizedCommandText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > assistanceRequestMaxLength) return null
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/gu, ' ').trim()
  return text && text.length <= assistanceRequestMaxLength ? text : null
}

export function parseLiveComputerOverlayCommand(value: unknown): LiveComputerOverlayCommand | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { taskId?: unknown; revision?: unknown; kind?: unknown; questionId?: unknown; engaged?: unknown; control?: unknown; minimized?: unknown; text?: unknown; planHash?: unknown; checkpointId?: unknown; sessionId?: unknown; audioBase64?: unknown; mimeType?: unknown; sharing?: unknown; presentationId?: unknown }
  if (candidate.kind === 'voice_playback') {
    const c = candidate as Record<string, unknown>
    return Number.isSafeInteger(c.id) && Number(c.id) >= 0 && (c.state === 'started' || c.state === 'ended' || c.state === 'error')
      ? { kind: 'voice_playback', id: Number(c.id), state: c.state } : null
  }
  if (candidate.kind === 'result_link') {
    const c = candidate as Record<string, unknown>
    return typeof c.sessionId === 'string' && c.sessionId.length > 0 && c.sessionId.length <= 200 && typeof c.url === 'string' && c.url.length <= 4096
      ? { kind: 'result_link', sessionId: c.sessionId, url: c.url } : null
  }
  if (candidate.kind === 'voice_enabled' || candidate.kind === 'voice_listening') {
    const enabled = (value as { enabled?: unknown }).enabled
    return typeof enabled === 'boolean' ? { kind: candidate.kind, enabled } : null
  }
  if (candidate.kind === 'public_source') {
    const c = value as Record<string, unknown>
    return typeof c.runId === 'string' && c.runId.length > 0 && c.runId.length <= 100 && typeof c.url === 'string' && c.url.length > 0 && c.url.length <= 4096 ? { kind: 'public_source', runId: c.runId, url: c.url } : null
  }
  if (candidate.kind === 'drawing_start') return { kind: 'drawing_start' }
  if (candidate.kind === 'drawing_capture') {
    const c = value as Record<string, unknown>
    if (typeof c.active !== 'boolean' || typeof c.sceneId !== 'string' || !c.sceneId || c.sceneId.length > 100 || !Number.isSafeInteger(c.revision) || Number(c.revision) < 0) return null
    return { kind: 'drawing_capture', active: c.active, sceneId: c.sceneId, revision: Number(c.revision) }
  }
  if (candidate.kind === 'drawing_edit') {
    const edit = parseDrawingEdit((value as { edit?: unknown }).edit)
    return edit ? { kind: 'drawing_edit', edit } : null
  }
  if (candidate.kind === 'guide_clear' || candidate.kind === 'guide_refresh' || candidate.kind === 'guide_next' || candidate.kind === 'guide_step') return { kind: candidate.kind }
  if (candidate.kind === 'follow_up_accept') {
    const c = value as Record<string, unknown>
    if (![c.conversationId, c.turnId, c.candidateId, c.commandId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200)) return null
    return { kind: 'follow_up_accept', conversationId: c.conversationId as string, turnId: c.turnId as string, candidateId: c.candidateId as string, commandId: c.commandId as string }
  }
  if (candidate.kind === 'assistance_approvals') {
    const c = value as Record<string, unknown>
    if (!isApprovalPreset(c.preset) || typeof c.conversationId !== 'string' || !c.conversationId || c.conversationId.length > 200
      || typeof c.commandId !== 'string' || !c.commandId || c.commandId.length > 200 || !Number.isSafeInteger(c.revision) || Number(c.revision) < 0) return null
    return { kind: 'assistance_approvals', preset: c.preset, conversationId: c.conversationId, commandId: c.commandId, revision: Number(c.revision) }
  }
  if (candidate.kind === 'assistance_mode') {
    const c = value as { mode?: unknown; conversationId?: unknown; commandId?: unknown; revision?: unknown }
    if ((c.mode !== 'guide' && c.mode !== 'do') || typeof c.conversationId !== 'string' || !c.conversationId || c.conversationId.length > 200
      || typeof c.commandId !== 'string' || !c.commandId || c.commandId.length > 200 || !Number.isSafeInteger(c.revision) || Number(c.revision) < 0) return null
    return { kind: 'assistance_mode', mode: c.mode, conversationId: c.conversationId, commandId: c.commandId, revision: Number(c.revision) }
  }
  if (candidate.kind === 'minimize') return typeof candidate.minimized === 'boolean' ? { kind: 'minimize', minimized: candidate.minimized } : null
  if (candidate.kind === 'capsule_position') {
    const c = value as Record<string, unknown>
    if (!['start', 'end', 'cancel', 'reset'].includes(String(c.phase)) || typeof c.sessionId !== 'string' || !c.sessionId || c.sessionId.length > 200
      || typeof c.x !== 'number' || !Number.isFinite(c.x) || Math.abs(c.x) > 100_000
      || typeof c.y !== 'number' || !Number.isFinite(c.y) || Math.abs(c.y) > 100_000) return null
    return { kind: 'capsule_position', phase: c.phase as 'start' | 'end' | 'cancel' | 'reset', sessionId: c.sessionId, x: c.x, y: c.y }
  }
  if (candidate.kind === 'pointer') return typeof candidate.engaged === 'boolean' ? { kind: 'pointer', engaged: candidate.engaged, ...(typeof candidate.control === 'boolean' ? { control: candidate.control } : {}) } : null
  if (candidate.kind === 'presented') {
    if (typeof candidate.sessionId !== 'string' || !candidate.sessionId.length || candidate.sessionId.length > 200) return null
    if (candidate.presentationId !== undefined && (typeof candidate.presentationId !== 'number' || !Number.isSafeInteger(candidate.presentationId) || candidate.presentationId < 1)) return null
    return { kind: 'presented', sessionId: candidate.sessionId, ...(candidate.presentationId === undefined ? {} : { presentationId: candidate.presentationId as number }) }
  }
  if (candidate.kind === 'show_window') {
    return typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0 && candidate.sessionId.length <= 200 ? { kind: 'show_window', sessionId: candidate.sessionId } : null
  }
  if (candidate.kind === 'pause' || candidate.kind === 'resume') {
    return typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0 && candidate.sessionId.length <= 200 ? { kind: candidate.kind, sessionId: candidate.sessionId } : null
  }
  if (candidate.kind === 'handoff_decline') return typeof candidate.taskId === 'string' && typeof candidate.revision === 'string' ? { kind: 'handoff_decline', taskId: candidate.taskId, revision: candidate.revision } : null
  if (candidate.kind === 'approve_decision') {
    const { sessionId, id, revision } = candidate as { sessionId?: unknown; id?: unknown; revision?: unknown }
    return [sessionId, id, revision].every(value => typeof value === 'string' && value.length > 0 && value.length <= 200)
      ? { kind: 'approve_decision', sessionId: sessionId as string, id: id as string, revision: revision as string } : null
  }
  if (candidate.kind === 'expand') return { kind: 'expand' }
  if (candidate.kind === 'dismiss') return { kind: 'dismiss' }
  if (candidate.kind === 'stop') return { kind: 'stop' }
  if (candidate.kind === 'follow_up' || candidate.kind === 'ask' || candidate.kind === 'guide_ask' || candidate.kind === 'revise_plan' || candidate.kind === 'guidance') {
    const text = candidate.kind === 'guidance'
      ? typeof candidate.text === 'string' && candidate.text.trim().length <= 4_000 ? candidate.text.trim() : null
      : sanitizedCommandText(candidate.text)
    if (candidate.kind === 'guidance' && candidate.questionId !== undefined) {
      if (typeof candidate.questionId !== 'string' || !candidate.questionId || candidate.questionId.length > 100) return null
      return text ? { kind: 'guidance', text, questionId: candidate.questionId } : null
    }
    return text ? { kind: candidate.kind, text } : null
  }
  if (candidate.kind === 'ask_allow') {
    const { providerId, sessionId } = candidate as { providerId?: unknown; sessionId?: unknown }
    const text = candidate.text === '' ? '' : sanitizedCommandText(candidate.text)
    return text !== null && typeof providerId === 'string' && providerId.length > 0 && providerId.length <= 200
      && typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200
      ? { kind: 'ask_allow', text, providerId, sessionId, ...((candidate as { remember?: unknown }).remember === true ? { remember: true } : {}) } : null
  }
  if (candidate.kind === 'guide_do_it') return { kind: 'guide_do_it' }
  if (candidate.kind === 'open_account') return { kind: 'open_account' }
  if (candidate.kind === 'guide_allow') {
    const { providerId, sessionId, remember } = candidate as { providerId?: unknown; sessionId?: unknown; remember?: unknown }
    return typeof providerId === 'string' && providerId.length > 0 && providerId.length <= 200 && typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200
      ? { kind: 'guide_allow', providerId, sessionId, ...(remember === true ? { remember: true } : {}) } : null
  }
  if (candidate.kind === 'add_fresh_window') {
    const bundleIdentifier = (candidate as { bundleIdentifier?: unknown }).bundleIdentifier
    const url = (candidate as { url?: unknown }).url
    if (typeof bundleIdentifier !== 'string' || !bundleIdentifier.trim() || bundleIdentifier.length > 240) return null
    if (url !== null && url !== undefined && (typeof url !== 'string' || url.length > 2_000 || !/^https:\/\/[^\s/?#]+/u.test(url))) return null
    return { kind: 'add_fresh_window', bundleIdentifier: bundleIdentifier.trim(), url: typeof url === 'string' ? url : null }
  }
  if (candidate.kind === 'steer_pause') {
    const source = (candidate as { source?: unknown }).source
    return source === 'text' || source === 'voice' ? { kind: 'steer_pause', source } : null
  }
  if (candidate.kind === 'steer') {
    const source = (candidate as { source?: unknown }).source
    const text = sanitizedCommandText(candidate.text)
    return text && (source === 'text' || source === 'voice') ? { kind: 'steer', text, source } : null
  }
  if (candidate.kind === 'steer_resume') return { kind: 'steer_resume' }
  if (candidate.kind === 'budget_grant') {
    if (typeof candidate.checkpointId !== 'string' || !candidate.checkpointId || candidate.checkpointId.length > 100) return null
    return { kind: 'budget_grant', checkpointId: candidate.checkpointId }
  }
  if (candidate.kind === 'budget_finish') {
    if (typeof candidate.checkpointId !== 'string' || !candidate.checkpointId || candidate.checkpointId.length > 100) return null
    return { kind: 'budget_finish', checkpointId: candidate.checkpointId }
  }
  if (candidate.kind === 'retry') {
    if (typeof candidate.sessionId !== 'string' || !candidate.sessionId || candidate.sessionId.length > 100) return null
    const preset = (candidate as { preset?: unknown }).preset
    const rawNote = (candidate as { note?: unknown }).note
    if (rawNote !== undefined && rawNote !== null && (typeof rawNote !== 'string' || rawNote.length > maximumRetryNoteCharacters)) return null
    const note = typeof rawNote === 'string' && rawNote.trim() ? { note: rawNote.trim() } : {}
    if (preset === 'autopilot') return { kind: 'retry', sessionId: candidate.sessionId, preset: 'autopilot', ...note }
    return preset === undefined || preset === null ? { kind: 'retry', sessionId: candidate.sessionId, ...note } : null
  }
  if (candidate.kind === 'guidance_option') {
    const optionId = (candidate as { optionId?: unknown }).optionId
    if (typeof optionId !== 'string' || !optionId.trim() || optionId.length > 40) return null
    if (candidate.questionId !== undefined && (typeof candidate.questionId !== 'string' || !candidate.questionId || candidate.questionId.length > 100)) return null
    return { kind: 'guidance_option', optionId: optionId.trim(), ...(typeof candidate.questionId === 'string' ? { questionId: candidate.questionId } : {}) }
  }
  if (candidate.kind === 'approve_plan') {
    if (typeof candidate.planHash !== 'string' || !candidate.planHash || candidate.planHash.length > 200) return null
    return { kind: 'approve_plan', planHash: candidate.planHash }
  }
  if (candidate.kind === 'dictate_begin') {
    if (typeof candidate.mimeType !== 'string' || !candidate.mimeType || candidate.mimeType.length > 100) return null
    if (candidate.sharing !== undefined && candidate.sharing !== 'session' && candidate.sharing !== 'remembered') return null
    return { kind: 'dictate_begin', mimeType: candidate.mimeType, ...(candidate.sharing ? { sharing: candidate.sharing } : {}) }
  }
  if (candidate.kind === 'dictate_push') {
    if (typeof candidate.audioBase64 !== 'string' || !candidate.audioBase64 || candidate.audioBase64.length > 1_000_000) return null
    return { kind: 'dictate_push', audioBase64: candidate.audioBase64 }
  }
  if (candidate.kind === 'dictate_end') return { kind: 'dictate_end' }
  return null
}

/** ScreenCaptureKit and Electron both describe desktop geometry in screen
 * points. Keep the window integral for BrowserWindow while retaining precise
 * local offsets for the CSS frame and action marker. */
export function layoutLiveComputerOverlay(
  target: LiveComputerOverlayRect,
  display: LiveComputerOverlayRect,
  capsuleHeight = badgeHeight,
  badgeWidth = badgeWidthCap,
  options: LiveComputerOverlayLayoutOptions = {},
): LiveComputerOverlayLayout {
  if (options.position && !options.away) {
    const window = { x: Math.floor(display.x), y: Math.floor(display.y), width: Math.ceil(display.width), height: Math.ceil(display.height) }
    const maxWidth = Math.min(badgeWidth, Math.max(48, window.width - 16))
    return { window, frame: { x: target.x - window.x, y: target.y - window.y, width: target.width, height: target.height },
      badge: { x: Math.max(8, Math.min(target.x + options.position.x - window.x, window.width - maxWidth - 8)),
        y: Math.max(8, Math.min(target.y + options.position.y - window.y, window.height - 48 - 8)),
        maxWidth, inside: true, dock: 'manual' } }
  }
  if (options.away) {
    const maxWidth = Math.max(120, Math.min(badgeWidth, display.width - 24 - overlayPadding * 2))
    const margin = 12
    // Slack below the estimate: the page clamps a taller-than-estimated card
    // to the viewport, which would otherwise clip its controls.
    const window = {
      x: Math.floor(display.x + display.width - margin - maxWidth - overlayPadding * 2),
      y: Math.floor(display.y + margin - overlayPadding),
      width: Math.ceil(maxWidth + overlayPadding * 2),
      height: Math.ceil(Math.min(display.height - margin, capsuleHeight + overlayPadding * 2 + 48)),
    }
    return {
      window,
      frame: { x: target.x - window.x, y: target.y - window.y, width: target.width, height: target.height },
      badge: { x: overlayPadding, y: overlayPadding, maxWidth, inside: true, dock: 'away-top-right' },
    }
  }
  if (options.centered) {
    const window = {
      x: Math.floor(display.x),
      y: Math.floor(display.y),
      width: Math.max(1, Math.ceil(display.width)),
      height: Math.max(1, Math.ceil(display.height)),
    }
    const frame = {
      x: target.x - window.x,
      y: target.y - window.y,
      width: target.width,
      height: target.height,
    }
    const badgeMaxWidth = Math.max(Math.min(120, badgeWidth), Math.min(badgeWidth, window.width - 32))
    return {
      window,
      frame,
      badge: {
        x: Math.max(8, Math.round((window.width - badgeMaxWidth) / 2)),
        y: Math.max(8, Math.round((window.height - capsuleHeight) / 2)),
        maxWidth: badgeMaxWidth,
        inside: true,
        dock: 'inside-center',
      },
    }
  }
  const hasRoomAbove = target.y - display.y >= capsuleHeight + badgeGap + overlayPadding
  const displayBottom = display.y + display.height
  const targetBottom = target.y + target.height
  const hasRoomBelow = displayBottom - targetBottom >= capsuleHeight + badgeGap + overlayPadding
  const outsideBelow = !hasRoomAbove && hasRoomBelow
  const naturalWindowX = Math.floor(target.x - overlayPadding)
  const windowY = Math.floor(hasRoomAbove ? target.y - capsuleHeight - badgeGap : target.y - overlayPadding)
  const naturalWindowRight = Math.ceil(target.x + target.width + overlayPadding)
  const windowBottom = Math.ceil(outsideBelow
    ? targetBottom + capsuleHeight + badgeGap + overlayPadding
    : targetBottom + overlayPadding)
  // A readable capsule is allowed to be wider than a narrow selected window.
  // Grow the transparent, click-through overlay around the target while
  // keeping both the target and capsule on the active display.
  const naturalWindowWidth = naturalWindowRight - naturalWindowX
  const requiredWindowWidth = Math.min(Math.ceil(display.width), Math.max(naturalWindowWidth, Math.ceil(badgeWidth) + 24))
  const extraWidth = requiredWindowWidth - naturalWindowWidth
  const displayLeft = Math.floor(display.x)
  const displayRight = Math.ceil(display.x + display.width)
  let windowX = Math.max(displayLeft, naturalWindowX - Math.floor(extraWidth / 2))
  let windowRight = windowX + requiredWindowWidth
  if (windowRight > displayRight) {
    windowRight = displayRight
    windowX = displayRight - requiredWindowWidth
  }
  const frame = {
    x: target.x - windowX,
    y: target.y - windowY,
    width: target.width,
    height: target.height,
  }
  const windowWidth = Math.max(1, windowRight - windowX)
  const windowHeight = Math.max(1, windowBottom - windowY)
  const badgeMaxWidth = Math.max(Math.min(120, badgeWidth), Math.min(badgeWidth, windowWidth - 24))
  const leftX = Math.max(8, Math.min(frame.x + 12, windowWidth - badgeMaxWidth - 8))
  const rightX = Math.max(8, Math.min(frame.x + frame.width - badgeMaxWidth - 12, windowWidth - badgeMaxWidth - 8))
  const belowY = frame.y + frame.height + badgeGap + 3
  const insideY = Math.max(frame.y + 10, Math.min(
    frame.y + frame.height - capsuleHeight - 12,
    windowHeight - capsuleHeight - 4,
  ))

  let dock: LiveComputerOverlayDock = hasRoomAbove ? 'above-left' : outsideBelow ? 'below-right' : options.preferredInsideDock ?? 'inside-bottom-right'
  const topY = Math.max(8, Math.min(frame.y + 12, windowHeight - capsuleHeight - 8))
  const inside = dock.startsWith('inside-')
  const at = (corner: LiveComputerOverlayInsideDock) => ({ x: corner.endsWith('left') ? leftX : rightX, y: corner.includes('-top-') ? topY : insideY })
  if (inside) {
    // Four constant-size candidates; no capture, OCR, or model call. Score all
    // known marks and the next action together so one cannot undo the other.
    const bounds = [...(options.avoidBounds ?? [])]
    if (options.cuePoint) bounds.push({ x: options.cuePoint.x - 36, y: options.cuePoint.y - 36, width: 72, height: 72 })
    const overlap = (corner: LiveComputerOverlayInsideDock) => {
      const { x, y } = at(corner)
      return bounds.reduce((sum, b) => {
        const bx = frame.x + b.x, by = frame.y + b.y
        const area = Math.max(0, Math.min(x + badgeMaxWidth, bx + b.width + 12) - Math.max(x, bx - 12))
          * Math.max(0, Math.min(y + capsuleHeight, by + b.height + 12) - Math.max(y, by - 12))
        return sum + area / Math.max(1, (b.width + 24) * (b.height + 24))
      }, 0)
    }
    const preferred = dock as LiveComputerOverlayInsideDock
    let best = overlap(preferred)
    // Retain the existing corner on ties; prefer the other bottom corner
    // before browser chrome at the top. Never oscillate on clear heartbeats.
    for (const candidate of ['inside-bottom-right', 'inside-bottom-left', 'inside-top-right', 'inside-top-left'] as const) {
      const score = overlap(candidate)
      if (score < best - .001) { dock = candidate; best = score }
    }
  }
  const badgeX = inside ? at(dock as LiveComputerOverlayInsideDock).x : dock === 'above-left' ? leftX : rightX
  const badgeY = inside ? at(dock as LiveComputerOverlayInsideDock).y : dock === 'above-left' ? Math.max(3, frame.y - capsuleHeight - 3) : belowY
  return {
    window: { x: windowX, y: windowY, width: windowWidth, height: windowHeight },
    frame,
    badge: {
      x: badgeX,
      y: badgeY,
      maxWidth: badgeMaxWidth,
      inside,
      dock,
    },
  }
}

export function overlayAction(action: LiveComputerAction, prior: LiveComputerOverlayAction | null = null): LiveComputerOverlayAction {
  const sameTransaction = prior?.id === action.id
  return {
    id: action.id,
    kind: action.kind,
    targetLabel: action.targetLabel?.trim().slice(0, 80) || null,
    point: action.point ? { x: action.point.x, y: action.point.y } : sameTransaction ? prior.point : null,
    endPoint: action.endPoint ? { x: action.endPoint.x, y: action.endPoint.y } : sameTransaction ? prior?.endPoint ?? null : null,
    elementAction: action.elementAction ?? null,
    command: action.command ?? null,
    scrollY: action.scrollY,
    key: action.key?.trim().slice(0, 40) || null,
    targetBounds: action.targetBounds
      ? { x: action.targetBounds.x, y: action.targetBounds.y, width: action.targetBounds.width, height: action.targetBounds.height }
      : sameTransaction ? prior?.targetBounds ?? null : null,
  }
}

export function liveComputerOverlayRoute(session: Pick<LiveComputerSession, 'target' | 'targets'>, freshWindowKeys: ReadonlySet<string> = new Set()): LiveComputerOverlayRouteStop[] {
  const key = (target: { bundleIdentifier: string; windowId: number }) => `${target.bundleIdentifier}:${target.windowId}`
  const currentIndex = session.targets.findIndex((entry) => key(entry.target) === key(session.target))
  return session.targets.map((entry, index) => ({
    application: entry.target.application.slice(0, 40),
    title: entry.target.title.slice(0, 48),
    state: index < currentIndex ? 'done' : index === currentIndex ? 'now' : 'next',
    source: entry.source ?? (freshWindowKeys.has(key(entry.target)) ? 'fresh' : 'existing'),
  }))
}

/** The request's own title when interpretation produced one, else a compact
 * heading from the answer's first sentence. The heading sits directly above
 * the answer, so a long first sentence repeated in full says nothing twice;
 * the first clause of it is the heading. */
export function resultTitleFor(title: string | undefined, answer: string | null | undefined): string | null {
  const own = title?.replace(/\s+/gu, ' ').trim()
  if (own) return own.slice(0, 60)
  const text = (answer ?? '').replace(/[*_`#>]/gu, '').replace(/\s+/gu, ' ').trim()
  if (!text) return null
  // A sentence ends at punctuation after a word of four or more letters or a number, so "vs." and "St." do not cut it short.
  const sentence = text.split(/(?<=(?:\p{L}{4,}|\p{N}+)[.!?])\s+(?=\p{Lu})/u)[0] ?? text
  return compactHeading(sentence.replace(/[.!?:;,]+$/u, ''))
}

/** At most 44 characters: a whole short sentence, else its first clause when
 * a clause boundary leaves at least 16 characters, else a word cut with an ellipsis. */
export function compactHeading(sentence: string, limit = 44): string {
  if (sentence.length <= limit) return sentence
  let cut = -1
  for (const match of sentence.matchAll(/,\s|;\s|\s[—–-]\s|\s(?:and|while|so|but|then|which|because)\s/gu)) {
    if (match.index > limit) break
    if (match.index >= 16) cut = match.index
  }
  if (cut > 0) return sentence.slice(0, cut).replace(/[.!?:;,]+$/u, '')
  // A word cut never ends on a function word: "…the site is vs…" reads as nothing.
  let head = sentence.slice(0, limit - 1).replace(/\s+\S*$/u, '').replace(/[.!?:;,]+$/u, '')
  while (/\s(?:a|an|the|is|are|was|were|vs|at|on|of|in|to|for|and|or|by|with|from|that|this|as)$/iu.test(head)) head = head.replace(/\s\S+$/u, '').replace(/[.!?:;,]+$/u, '')
  return head + '…'
}

export function elapsedLabelFor(startedAt: string | undefined, endedAt: string | undefined): string | null {
  const start = startedAt ? Date.parse(startedAt) : NaN, end = endedAt ? Date.parse(endedAt) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  const seconds = Math.round((end - start) / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

export function buildLiveComputerOverlayPresentation(
  session: LiveComputerSession,
  cue: LiveComputerOverlayCue | null,
  shortcut: string,
  options: LiveComputerOverlayBuildOptions = {},
): LiveComputerOverlayPresentation {
  const freshWindowKeys = options.freshWindowKeys ?? new Set<string>()
  const route = liveComputerOverlayRoute(session, freshWindowKeys)
  // A proposal is not an action that Carve has taken. Prefer the pending
  // proposal over any short-lived cue from the preceding transaction so the
  // frame never describes unapproved input in the present tense.
  const proposed = session.status === 'awaiting_approval' && Boolean(session.pendingAction)
  const action = proposed && session.pendingAction
    ? overlayAction(session.pendingAction)
    : cue?.action ?? (session.pendingAction ? overlayAction(session.pendingAction) : null)
  const described = describeAction(action, session.target)
  const objectiveIndex = session.ledger.currentObjectiveId
    ? session.ledger.objectives.findIndex((objective) => objective.id === session.ledger.currentObjectiveId)
    : session.ledger.objectives.length - 1
  const objectiveProgress = session.ledger.objectives.length > 0
    ? `Step ${Math.max(1, objectiveIndex + 1)} of ${session.ledger.objectives.length}`
    : `${session.actionCount} of ${session.maxActions} actions`
  const phase = liveComputerActivityPhase(session)
  const health = liveComputerProgressHealth(session)
  const safePhase = liveComputerOverlayPhaseCopy(phase)

  let theme: LiveComputerOverlayTheme = 'active'
  let label = safePhase.label
  let detail = safePhase.detail
  switch (session.status) {
    case 'initializing':
      theme = 'checking'; label = 'Carve · Getting ready'; detail = 'Reading this window and planning your task. Nothing has been clicked or typed yet.'; break
    case 'awaiting_plan_approval': {
      theme = 'selected'
      const stepCount = session.missionPlan.steps.length
      label = stepCount > 0 ? `Carve has a plan · ${stepCount === 1 ? '1 step' : `${stepCount} steps`}` : 'Carve has a plan'
      const windowCount = session.missionPlan.windows.length
      detail = windowCount > 1
        ? `It works only in ${windowCount} authorized windows, and nothing runs until you say go.`
        : 'It works only in this window, and nothing runs until you say go.'
      break
    }
    case 'awaiting_guidance':
      theme = 'attention'; label = 'Carve · Your call'; detail = session.pendingGuidance?.question ?? 'Carve is asking for your direction'; break
    case 'awaiting_context_transfer':
      theme = 'attention'; label = 'Carve · Review what to share'; detail = session.pendingContextTransfer
        ? `${session.pendingContextTransfer.itemCount} verified ${session.pendingContextTransfer.itemCount === 1 ? 'item is' : 'items are'} ready for ${session.pendingContextTransfer.toApplication}.`
        : 'Open Carve to review the data moving to the next window'; break
    case 'ready':
      theme = phase === 'recovering' ? 'selected' : 'active'; label = safePhase.label; detail = safePhase.detail; break
    case 'awaiting_approval': {
      const approvalKind = session.pendingApproval?.kind
      const actionDetail = described.label ? `Proposed: ${described.label}` : 'Open Carve to review the proposed action'
      if (approvalKind === 'immediate' || approvalKind === 'group') {
        theme = 'attention'; label = 'Carve · Approval needed'; detail = actionDetail
      } else if (approvalKind === 'countdown') {
        theme = 'selected'; label = 'Carve · Starting shortly'; detail = actionDetail
      } else {
        theme = 'active'; label = 'Carve · Preparing action'; detail = actionDetail
      }
      break
    }
    case 'acting':
      theme = 'active'; label = safePhase.label; detail = described.label ?? safePhase.detail; break
    case 'verifying':
      theme = 'checking'; label = safePhase.label; detail = safePhase.detail; break
    case 'paused':
      theme = 'paused'; label = 'Carve · Paused'; detail = session.pendingInputTransaction ? 'No next operation will start. The previous input still needs checking.' : 'Your turn — no input can be sent'; break
    case 'handoff':
      theme = 'attention'; label = 'Carve · Needs you'; detail = 'Take over here or open Carve for guidance'; break
    case 'completed':
      // The verified result summary is the completion receipt: for a question
      // it is the answer, for an action goal it is a one-line report of the
      // work. The generic line survives only as the no-summary fallback.
      theme = 'complete'; label = 'Carve · Complete'; detail = session.resultSummary?.trim() || 'The requested outcome was verified'; break
    case 'blocked':
      theme = 'attention'
      if (session.actionCount === 0 && /no computer input was sent/iu.test(session.blockedReason ?? '')) {
        label = 'Carve · Couldn’t prepare'
        detail = 'Nothing changed. Open Carve to retry.'
      } else {
        label = 'Carve · Stopped'; detail = 'Open Carve to review what needs attention'
      }
      break
    case 'stopped':
      theme = 'paused'; label = 'Carve · Stopped'; detail = 'Carve has stopped working in this window.'; break
  }
  if (health === 'needs_attention' && theme !== 'complete' && theme !== 'paused') theme = 'attention'

  return {
    sessionId: session.id,
    ...(session.status === 'awaiting_plan_approval' ? {} : { taskGoal: session.goal }),
    voiceContextId: session.runId,
    completionEvidence: session.status === 'completed' ? 'verified' : null,
    updatedAt: session.updatedAt,
    phaseStartedAt: session.activityEvents?.at(-1)?.startedAt ?? session.updatedAt,
    canPause: ['ready', 'acting', 'verifying', 'reconciling_input'].includes(session.status),
    canResume: session.status === 'paused',
    decision: capsuleDecision(session, null),
    application: session.target.application.slice(0, 80),
    phase,
    health,
    healthLabel: liveComputerProgressHealthLabel(health),
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? (['completed', 'blocked', 'handoff', 'stopped'].includes(session.status) ? session.updatedAt : null),
    theme,
    label,
    detail,
    answer: liveComputerCompletionAnswer(session),
    interactive: session.status === 'completed' || session.status === 'awaiting_plan_approval' || session.status === 'awaiting_guidance' || session.status === 'paused' || Boolean(capsuleDecision(session, null)),
    mode: 'session',
    guide: null,
    steeringPaused: false,
    steeringReview: false,
    steeringReceiptId: null,
    planApproval: session.status === 'awaiting_plan_approval'
      ? {
        planHash: session.missionPlan.hash,
        stepCount: session.missionPlan.steps.length,
        stepTitles: session.missionPlan.steps.slice(0, 6).map((step) => {
          const objective = session.ledger.objectives.find(candidate => candidate.id === step.id)
          const destinations = objective ? boundNavigationDestinations(session.missionPlan.navigationBindings ?? [], session.ledger, objective) : []
          return [step.title.trim().slice(0, 80), ...destinations.map(binding => binding.url)].join(' · ')
        }),
        route,
        freshSuggestion: options.freshSuggestion ?? null,
      }
      : null,
    route: route.length > 1 ? route : null,
    freshSurface: freshWindowKeys.has(`${session.target.bundleIdentifier}:${session.target.windowId}`),
    dictationAvailable: false,
    guidance: session.status === 'awaiting_guidance' && session.pendingGuidance
      ? {
        ...(session.pendingGuidance.id ? { id: session.pendingGuidance.id } : {}),
        question: session.pendingGuidance.question,
        ...(session.pendingGuidance.displayContext || session.pendingResourceBudget
          ? { context: session.pendingGuidance.displayContext ?? session.pendingGuidance.context } : {}),
        options: session.pendingGuidance.options.map((option) => ({ id: option.id, label: option.label, consequence: option.consequence, mode: option.mode })),
      }
      : null,
    budgetCheckpoint: null,
    failure: null,
    progressFraction: session.maxActions > 0 ? Math.min(1, session.actionCount / session.maxActions) : null,
    progress: session.status === 'initializing' ? 'Starting · no input sent' : `${objectiveProgress} · ${session.actionCount}/${session.maxActions} actions`,
    shortcut,
    cueKind: described.kind,
    cueLabel: described.label,
    cueDirection: described.direction,
    cuePoint: described.point,
    cueSequence: proposed ? 0 : cue?.sequence ?? 0,
    proposed,
    // A proposal has not been aimed at anything yet; only executed input
    // carries brackets, and only when the controller validated an element.
    aimBounds: !proposed && cue ? cue.action.targetBounds : null,
    aimSequence: !proposed && cue ? cue.sequence : 0,
    readKey: session.latestFrame?.id ?? null,
    readAt: session.latestFrame?.capturedAt ?? null,
  }
}

/** Plain-language failure feedback shared by the selected-window capsule and
 * the full Carve console. It deliberately says what stopped, whether any
 * more input was sent, and whether a clean retry is available. */
export function universalComputerFailureFeedback(
  session: Pick<UniversalComputerSession, 'status' | 'reason' | 'terminalKind' | 'terminalCategory' | 'canResume'> & Partial<Pick<UniversalComputerSession, 'latestFrame' | 'reportedOutcome' | 'remainingClauses'>>,
): { label: string; message: string; canRetry: boolean; offerAutopilot: boolean } | null {
  if (session.status !== 'blocked') return null
  // A stop the person can pick up says what they can do next, not only that work ended ("Work stopped"
  // after a Google sign-in felt final). The person's own step comes first: a sign-in or a check left for them.
  const continueHint = session.canResume ? ' Choose Continue to pick up from here, and add a note if Carve should do something differently.' : ''
  if (/Signing in is yours to do/u.test(session.reason ?? '')) return {
    label: 'Carve · Sign in to continue',
    message: `This needs you to sign in. Carve never types passwords. Sign in in the window, then choose Continue.`,
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (/No input was sent to the human-verification check/u.test(session.reason ?? '')) return {
    label: 'Carve · Confirm you’re human',
    message: `The site wants you to confirm you’re human. Complete the check in the window, then choose Continue.`,
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'partial') {
    const remaining = (session.remainingClauses ?? []).map(item => item.trim().replace(/[.;\s]+$/u, '')).filter(Boolean)
    return {
      label: 'Carve · Partly done',
      message: (remaining.length ? `Still to do: ${remaining.slice(0, 3).join('; ')}.` : 'Part of your request is still open.') + continueHint,
      canRetry: session.canResume,
      offerAutopilot: false,
    }
  }
  // The actor itself said it could go no further; the controller saw nothing wrong with progress.
  if (session.terminalKind === 'stalled' && session.reportedOutcome === 'blocked') return {
    label: 'Carve · Needs your help',
    message: 'Carve couldn’t go further on its own.' + continueHint,
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (isComputerActionValidationFailure(session.reason)) return {
    label: 'Carve · Couldn’t validate the next step',
    message: 'Carve rejected an invalid action before it ran. The task has stopped; earlier changes may remain. Try again from the current window.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'planning_failure' && session.latestFrame?.elementCaptureStatus === 'not_requested') return {
    label: 'Carve · Couldn’t read this window',
    message: 'Carve couldn’t read the buttons and fields needed for the next step. That step didn’t run. Earlier changes may remain. Try again from the current window.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  const controlsUnreadable = session.latestFrame?.elementCaptureStatus !== undefined && session.latestFrame.elementCaptureStatus !== 'available'
  const timeout = /(?:timed?\s*out|timeout|aborted due to timeout)/iu.test(session.reason ?? '')
  const creditsUnavailable = /(?:no credits remaining|credit_balance_exhausted|API credits|billing quota|insufficient[_\s-]*quota|exceeded your current quota|billing (?:hard )?limit|credit balance (?:is )?(?:too low|insufficient|exhausted))/iu.test(session.reason ?? '')
  if (/^Action review unavailable/u.test(session.reason ?? '')) return {
    label: 'Carve · Couldn’t finish checking the action',
    message: 'The action review did not finish. That step did not run; earlier completed work remains. Try again to continue from the current page.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  // A read stopped by its time budget (read-recovery-policy.ts) whose report could not be completed.
  if (/read budget for this request/u.test(session.reason ?? '')) return {
    label: 'Carve · Stopped to report back',
    message: 'Carve stopped so you wouldn’t keep waiting, but couldn’t put together a checked answer from what it found. Try again, or ask a narrower question.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalCategory === 'execution_limit') return {
    label: 'Carve · Work limit reached',
    message: /time limit/u.test(session.reason ?? '') ? 'Carve reached the time limit for this task and stopped clicking and typing.' : 'Carve reached the step limit for this task and stopped clicking and typing.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'verification_rejected') return {
    label: 'Carve · Couldn’t confirm the answer',
    message: 'Carve’s final check did not accept the answer, so nothing here is a confirmed result. Carve stopped clicking and typing. Try again to continue from the current page.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'stalled') return {
    label: 'Carve · No visible progress',
    message: 'Carve paused because it could not see any progress.' + continueHint,
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  // In testing, macOS refused a capture mid-run (ScreenCaptureKit -3801) and the capsule said "OpenAI interrupted".
  if (captureRefusalLabelEnabled() && screenCaptureRefused(session.reason)) return {
    label: 'Carve · Couldn’t capture the screen',
    message: 'Carve couldn’t capture the screen: macOS refused screen capture for Carve. Open System Settings › Privacy & Security › Screen & System Audio Recording and make sure Carve is on (if it already is, turn it off and on again), then choose Try again. Carve stopped clicking and typing.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'environment_failure' && /ownership is ambiguous/iu.test(session.reason ?? '')) return {
    label: 'Carve · Which window to use?',
    message: 'Carve could not distinguish overlapping windows and stopped. Bring the intended window to the front before trying again.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'environment_failure') return /\blive computer helper\b/iu.test(session.reason ?? '')
    // The window was fine and so was the model; Carve's own macOS helper did
    // not answer. Say that, so a local stall is never read as either one.
    ? {
      label: 'Carve · Couldn’t control your Mac',
      message: 'The part of Carve that controls your Mac stopped responding. The task has stopped.',
      canRetry: session.canResume,
      offerAutopilot: false,
    }
    : {
      label: 'Carve · Window unavailable',
      message: 'Carve can no longer reach the selected window. Reopen it before trying again.',
      canRetry: session.canResume,
      offerAutopilot: false,
    }
  if (session.terminalKind === 'planning_failure' && /frame or semantic binding changed|page changed/iu.test(session.reason ?? '')) return {
    label: 'Carve · Couldn’t verify the next step',
    message: 'Carve could not consistently verify the next control. That step did not run. Earlier changes may remain. Try again from the current page.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'planning_failure' && /could not establish the exact content or change/iu.test(session.reason ?? '')) return {
    label: 'Carve · Couldn’t verify what would be sent or changed',
    message: 'Carve found the control, but could not verify exactly what it would send or change. That step did not run; earlier changes may remain.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'planning_failure') return controlsUnreadable
    ? {
      label: 'Carve · Couldn’t read this window',
      message: 'Carve could not read the controls needed for the next step. That step did not run; earlier changes may remain. Bring the intended page into view, then try again.',
      canRetry: session.canResume,
      offerAutopilot: false,
    }
    : {
      label: 'Carve · Couldn’t find the next control',
      message: 'Carve could not identify the control needed for the next step. That step did not run; earlier changes may remain. Try again from the current page.',
      canRetry: session.canResume,
      offerAutopilot: false,
    }
  if (session.terminalKind === 'provider_failure' && creditsUnavailable) return {
    label: 'Carve · OpenAI credits required',
    message: 'The OpenAI API organization has no credits remaining. Add credits in OpenAI billing, then choose Try again. Carve stopped clicking and typing.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'provider_failure' && /fetch failed|network|connection|socket|ENOTFOUND|ECONN|EAI_AGAIN|DNS/iu.test(session.reason ?? '')) return {
    label: 'Carve · Connection interrupted',
    message: 'The AI connection was interrupted. This task is no longer clicking or typing. Try again to continue from the current page; earlier changes may remain.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'provider_failure' && /rate.?limit|too many requests|(?:status|HTTP|\()\s*429/iu.test(session.reason ?? '')) return {
    label: 'Carve · AI service limit reached',
    message: 'The AI service is temporarily limiting requests. Wait a little, then try again. Carve stopped clicking and typing.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'provider_failure' && /invalid.?api.?key|unauthorized|authentication|(?:status|HTTP|\()\s*401/iu.test(session.reason ?? '')) return {
    label: 'Carve · AI connection needs attention',
    message: 'Check your AI provider credentials in Settings, then try again. Carve stopped clicking and typing.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'provider_failure' && /transient service failure|service_auth_failure/iu.test(session.reason ?? '')) return {
    label: 'Carve · OpenAI service error',
    message: 'OpenAI’s service failed this request before the model saw it (HTTP 404, service auth failure). That is on OpenAI’s side and usually clears within seconds. Carve retried, then stopped clicking and typing; choose Try again.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  if (session.terminalKind === 'provider_failure') return {
    label: timeout ? 'Carve · OpenAI timed out' : 'Carve · OpenAI interrupted',
    message: timeout
      ? 'OpenAI did not respond in time. Try again when you’re ready. Carve stopped clicking and typing.'
      : 'OpenAI’s response was interrupted. Carve stopped clicking and typing.',
    canRetry: session.canResume,
    offerAutopilot: false,
  }
  return {
    label: session.canResume ? 'Carve · Didn’t finish' : 'Carve · Work stopped',
    message: 'Carve stopped before finishing this task. It is no longer clicking or typing.' + continueHint,
    canRetry: session.canResume,
    offerAutopilot: false,
  }
}

/** Universal uses the same selected-window capsule, but its copy is projected
 * solely from controller events. It never displays provider reasoning. Its
 * terminal answer/result is explicitly model-reported because Universal has
 * no independent criterion verifier. Active capsules expose one
 * course-correction surface; completion becomes a read-only result surface. */
export function buildUniversalComputerOverlayPresentation(
  session: UniversalComputerSession,
  shortcut: string,
): LiveComputerOverlayPresentation {
  const phase = universalComputerActivityPhase(session)
  const active = ['starting', 'running', 'pausing', 'paused', 'awaiting_checkpoint', 'awaiting_steering_review', 'awaiting_budget', 'replanning'].includes(session.status)
  // Terminal states are decided first: a run that finished after a retry is
  // complete, not "retrying safely".
  const health: LiveComputerProgressHealth = session.status === 'starting'
    ? phase === 'recovering' ? 'retrying' : 'starting'
    : session.status === 'completed'
      ? 'complete'
      : ['stopped', 'blocked', 'safety_check'].includes(session.status)
        ? 'stopped'
        : session.status === 'pausing' || session.status === 'paused' || session.status === 'awaiting_checkpoint' || session.status === 'awaiting_steering_review' || session.status === 'awaiting_budget'
          ? 'paused'
          : session.status === 'replanning' || session.noProgressBatches > 0
            ? 'retrying'
            : session.status === 'running'
              ? 'exploring'
              : 'stopped'
  const safePhase = liveComputerOverlayPhaseCopy(phase)
  let theme: LiveComputerOverlayTheme = phase === 'verifying' ? 'checking' : phase === 'paused' ? 'paused' : phase === 'recovering' ? 'selected' : 'active'
  let label = safePhase.label
  let detail = safePhase.detail
  const completionResult = universalComputerCompletionResult(session, null, true, true)
  const completionKind = universalComputerCompletionKind(session.completionAnswer?.question ?? session.goal)
  const failure = universalComputerFailureFeedback(session)
  switch (session.status) {
    case 'starting':
      theme = 'checking'
      label = phase === 'recovering'
        ? session.activityEvents.at(-1)?.headline === 'Waiting for model response' ? 'Carve · Waiting for a response' : 'Carve · Retrying'
        : universalComputerTurnOverrun(session)?.label ?? (session.observationsCaptured > 0 || session.providerTurns > 0 ? 'Carve · Working out the first step' : `Carve · Reading ${session.target.application.slice(0, 40)}`)
      detail = phase === 'recovering'
        ? session.activityEvents.at(-1)?.headline === 'Waiting for model response'
          ? 'Waiting for the AI service. No new clicks or typing have been sent; you can still stop the task.'
          : 'Trying the AI service again. No clicks or typing were sent for this attempt.'
        : 'Reading this window and getting the task ready. Nothing has been clicked or typed.'
      break
    case 'pausing':
      theme = 'paused'; label = 'Carve · Pausing'; detail = 'Finishing the current action, then pausing.'; break
    case 'paused':
      theme = 'paused'; label = 'Carve · Paused'; detail = 'Talk or type a correction, or resume from the current window'; break
    case 'awaiting_checkpoint': {
      // A sign-in or a human check is the person's own step, not an approval of Carve's (awaitUniversalHumanVerification).
      const personStep = !session.pendingPlanReview && session.activityEvents.at(-1)?.phase === 'paused' && session.activityEvents.at(-1)?.headline === 'Waiting for you'
      theme = 'attention'
      label = session.pendingPlanReview ? 'Carve · Review the plan' : personStep ? 'Carve · Waiting for you' : 'Carve · Your approval needed'
      detail = session.pendingPlanReview ? 'Review these steps before Carve starts, or edit the plan.' : personStep ? session.activityEvents.at(-1)?.detail ?? 'Carve continues once you are done.' : 'Review the next steps in Carve. They have not run yet.'
      break
    }
    case 'awaiting_steering_review':
      theme = 'attention'; label = 'Carve · Review the new direction'; detail = session.pendingSteeringReview?.summary ?? 'This change goes beyond the plan you approved. Please review it first.'; break
    case 'awaiting_budget': {
      const checkpoint = session.pendingBudgetCheckpoint
      theme = 'attention'; label = checkpoint?.forecast.recommendation === 'change_approach'
        ? 'Carve · Review the approach'
        : 'Carve needs your approval to continue'
      detail = checkpoint
        ? `Carve has used the amount of work you approved. It is paused and won’t do anything else until you choose.`
        : 'Carve is paused. Nothing else will happen until you choose.'
      break
    }
    case 'replanning': {
      // The same status covers a person's course correction and Carve's own
      // silent retry of a batch it could not name. Only the first is "your
      // direction".
      const steeredAt = session.lastSteeringReceipt ? Date.parse(session.lastSteeringReceipt.appliedAt) : NaN
      const steered = Number.isFinite(steeredAt) && Date.now() - steeredAt < 15_000
      theme = 'selected'
      label = steered ? 'Carve · Updating the plan' : 'Carve · Looking again'
      detail = steered
        ? 'Got it — updating the plan with your correction.'
        : 'Carve couldn’t find the right control. Looking again before continuing.'
      break
    }
    case 'completed':
      theme = 'complete'; label = completionKind === 'answer' ? 'Carve · Answer ready' : 'Carve · Done'; detail = completionResult ?? 'OpenAI reported that the requested work is complete'; break
    case 'safety_check':
      theme = 'attention'; label = 'Carve · Safety review needed'; detail = 'Stopped before further input'; break
    case 'blocked':
      theme = 'attention'
      label = universalPartialReport(session) ? 'Carve · Partly done' : failure?.label ?? 'Carve · Work stopped'
      detail = failure?.message ?? (universalPartialReport(session) ? 'Part of your request is still open. Carve stopped clicking and typing.' : 'Carve stopped before finishing this task. It is no longer clicking or typing.')
      break
    case 'stopped':
      theme = 'paused'; label = 'Carve · Stopped'; detail = 'Carve has stopped working in this window.'; break
    case 'running': {
      if (phase === 'recovering' && session.activityEvents.at(-1)?.headline === 'Waiting for model response') {
        label = 'Carve · Waiting for a response'
        detail = 'The response is taking longer than usual. No new clicks or typing have been sent; you can still stop the task.'
      }
      const overrun = universalComputerTurnOverrun(session)
      if (overrun) { label = overrun.label; detail = overrun.detail }
      // A declared next step is the most specific thing the capsule can say;
      // a long turn keeps its explanation as the detail line.
      if (session.narration && phase !== 'recovering') label = `Carve · ${session.narration.text}`
      break
    }
  }
  const receipt = session.lastSteeringReceipt
  const receiptAt = receipt ? Date.parse(receipt.appliedAt) : NaN
  const receiptIsRecent = receipt && Number.isFinite(receiptAt) && Date.now() - receiptAt < 6_000
  if (receiptIsRecent && !session.pendingSteeringReview && active && session.status !== 'pausing') {
    if (receipt.disposition === 'applied') {
      theme = 'selected'; label = 'Carve · Plan updated'; detail = 'Got it — your correction has been applied.'
    } else if (receipt.disposition === 'answered') {
      theme = 'paused'; label = 'Carve · Current status'; detail = receipt.summary
    } else if (receipt.disposition === 'needs_clarity') {
      theme = 'paused'; label = 'Carve · Paused for clarity'; detail = receipt.summary
    } else if (receipt.disposition === 'paused') {
      theme = 'paused'; label = receipt.intent === 'take_over' ? 'Carve · Your turn' : 'Carve · Paused'; detail = receipt.summary
    } else if (receipt.disposition === 'resumed') {
      theme = 'selected'; label = 'Carve · Resuming your task'; detail = receipt.summary
    }
  }
  // An input cue describes the present only while input is running or just
  // ran. Held past that, the Line claimed "Clicking" through the next model
  // turn and the final check (live run).
  const cueAt = session.latestActionCue ? Date.parse(session.latestActionCue.occurredAt) : NaN
  const actionCue = active && session.latestActionCue && (phase === 'acting' || (Number.isFinite(cueAt) && Date.now() - cueAt < liveComputerCueFreshMs)) ? session.latestActionCue : null
  const cuePoint = actionCue
    ? actionCue.point ?? { x: session.target.bounds.width / 2, y: session.target.bounds.height / 2 }
    : null
  return {
    sessionId: session.id,
    taskGoal: session.goal,
    ...(session.title ? { taskTitle: session.title } : {}),
    voiceContextId: session.runId,
    completionEvidence: session.status === 'completed' ? session.actionEngine === 'compact_v1' || session.completionVerified === true ? 'verified' : 'model_reported' : null,
    resultTitle: session.status === 'completed' ? resultTitleFor(session.title, completionResult) : null,
    elapsedLabel: session.status === 'completed' ? elapsedLabelFor(session.startedAt, session.updatedAt) : null,
    updatedAt: session.updatedAt,
    phaseStartedAt: session.activityEvents?.at(-1)?.startedAt ?? session.updatedAt,
    canPause: ['starting', 'running', 'replanning'].includes(session.status),
    canResume: session.status === 'paused',
    pausing: session.status === 'pausing',
    application: session.target.application.slice(0, 80),
    phase,
    health,
    healthLabel: liveComputerProgressHealthLabel(health),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    theme,
    label,
    detail,
    answer: session.status === 'completed' ? completionResult ?? 'OpenAI reported that the requested work is complete.' : universalPartialReport(session),
    interactive: active || session.status === 'completed' || session.status === 'blocked',
    mode: session.pendingPlanReview ? 'session' : session.status === 'completed' ? 'result' : session.status === 'blocked' ? 'failure' : session.status === 'awaiting_budget' && session.pendingBudgetCheckpoint?.forecast.recommendation !== 'change_approach' ? 'budget' : 'steer',
    guide: null,
    steeringPaused: session.status === 'pausing' || session.status === 'paused' || session.status === 'awaiting_checkpoint' || session.status === 'awaiting_steering_review' || session.status === 'awaiting_budget' && session.pendingBudgetCheckpoint?.forecast.recommendation === 'change_approach',
    steeringReview: session.status === 'awaiting_steering_review',
    steeringReceiptId: session.lastSteeringReceipt?.id ?? null,
    planApproval: session.status === 'awaiting_checkpoint' && session.pendingPlanReview ? { planHash: session.pendingPlanReview.hash, stepCount: session.pendingPlanReview.steps.length, stepTitles: session.pendingPlanReview.steps } : null,
    dictationAvailable: false,
    guidance: null,
    budgetCheckpoint: session.status === 'awaiting_budget' ? session.pendingBudgetCheckpoint : null,
    failure: failure ? { title: failure.label.replace(/^Carve · /u, ''), message: failure.message, canRetry: failure.canRetry, offerAutopilot: failure.offerAutopilot } : null,
    progressFraction: session.maxInputActions > 0 ? Math.min(1, session.inputActionsCompleted / session.maxInputActions) : null,
    progress: session.status === 'starting'
      ? 'Starting · no input sent'
      : session.status === 'awaiting_budget'
      ? 'Paused · waiting for you'
      : `Turn ${Math.max(1, session.providerTurns)} · ${session.inputActionsCompleted} input${session.inputActionsCompleted === 1 ? '' : 's'}`,
    shortcut,
    cueKind: actionCue?.kind ?? 'none',
    cueLabel: actionCue?.label ?? null,
    cueDirection: actionCue?.direction ?? null,
    cuePoint,
    cueSequence: actionCue?.sequence ?? session.actionsCompleted,
    proposed: false,
    aimBounds: actionCue?.bounds ?? null,
    aimSequence: actionCue?.sequence ?? 0,
    // Only post-batch observations count as reads; the backend's settle probes
    // update latestFrame but never reach the provider, so they stay silent.
    readKey: session.observationsCaptured > 0 ? `observation:${session.observationsCaptured}` : null,
    readAt: session.lastObservationAt ?? null,
    checklist: universalComputerChecklist(session),
    waitingSince: universalComputerWaitingSince(session),
    intent: session.status === 'running' && phase !== 'recovering' ? session.narration?.text ?? null : null,
    inputsDone: session.inputActionsCompleted,
    serviceWaitSince: universalComputerServiceWaitSince(session),
  }
}

/** `STEWARD_SWITCH_CHOICE_IN_CAPSULE=off` restores hiding the "Let Carve take action?" choice with the capsule whenever its window is not in front. */
export function switchChoiceKeepsCapsuleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_SWITCH_CHOICE_IN_CAPSULE?.trim().toLowerCase() !== 'off'
}

/** A question for the person (budget, guidance, plan, approval, consent, a retryable failure, or the Explain-to-action
 * choice) stays on screen even when its window is not in front: it docks to the display like a working session instead
 * of vanishing. In one test, after Stop, "Please continue where you left off." produced the
 * "Start task / Keep explaining" choice while the capsule was not attached; the capsule was hidden (so it stopped
 * receiving state and read "Status connection lost"), macOS made Carve's main window key, and the choice waited there
 * unseen by anyone looking at the capsule for five minutes. */
export function liveComputerCapsuleNeedsAnswer(shape: Pick<LiveComputerOverlayPresentation, 'budgetCheckpoint' | 'guidance' | 'decision' | 'planApproval' | 'workConsent' | 'failure' | 'personChoice'>): boolean {
  return Boolean(shape.budgetCheckpoint || shape.guidance || shape.decision || shape.planApproval || shape.workConsent || shape.failure?.canRetry
    || (shape.personChoice && switchChoiceKeepsCapsuleEnabled()))
}

/** `STEWARD_PARTIAL_IN_CAPSULE=off` restores sending partial reports to the main window with a generic capsule message. */
export function partialReportInCapsuleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_PARTIAL_IN_CAPSULE?.trim().toLowerCase() !== 'off'
}

/** The checked closing report of a session that stopped with part of the request done, shown as the capsule's answer. */
export function universalPartialReport(session: Pick<UniversalComputerSession, 'status' | 'terminalKind' | 'reason'>): string | null {
  if (!partialReportInCapsuleEnabled() || session.status !== 'blocked' || session.terminalKind !== 'partial') return null
  const text = session.reason?.trim()
  return text ? text : null
}

/** Normal Universal completion is already represented truthfully in the
 * compact capsule. Only states that require intervention may take the person
 * back to Carve's full console without an explicit Expand gesture. */
export function universalComputerShouldSurfaceMain(
  value: UniversalComputerSession['status'] | Pick<UniversalComputerSession, 'status' | 'terminalKind' | 'canResume' | 'pendingPlanReview'>,
): boolean {
  const status = typeof value === 'string' ? value : value.status
  if (status === 'awaiting_checkpoint') return typeof value === 'string' || !value.pendingPlanReview
  if (status === 'safety_check') return true
  if (typeof value === 'string' || status !== 'blocked') return false
  // A checked partial report is an answer, like a completion: it stays in the capsule where the person asked
  // (sending it to the main window once hid the capsule, which then showed "Status connection lost").
  if (value.terminalKind === 'partial' && partialReportInCapsuleEnabled()) return false
  // A missing selected window needs the full picker, and a non-resumable
  // policy terminal needs its detailed receipt. Recoverable provider, stall,
  // and budget failures stay where the person was working.
  return value.terminalKind === 'environment_failure' || !value.canResume
}

/** A stable key for checkpoints that require a person in the Carve window.
 * Automatic and countdown checkpoints remain visible in the selected app and
 * must not steal focus. */
export function liveComputerManualApprovalSurfaceKey(session: LiveComputerSession): string | null {
  if (session.status !== 'awaiting_approval' || !session.pendingAction || !session.pendingApproval) return null
  if (session.pendingApproval.kind !== 'immediate' && session.pendingApproval.kind !== 'group') return null
  return `${session.id}:${session.pendingAction.id}`
}

function describeAction(action: LiveComputerOverlayAction | null, target: LiveComputerTarget): {
  kind: LiveComputerOverlayCueKind
  label: string | null
  direction: 'up' | 'down' | null
  point: { x: number; y: number } | null
} {
  if (!action) return { kind: 'none', label: null, direction: null, point: null }
  const targetName = action.targetLabel ? ` “${action.targetLabel}”` : ''
  switch (action.kind) {
    case 'move': return { kind: 'pointer', label: `Moving to${targetName || ' the target'}`, direction: null, point: action.point }
    case 'click': return { kind: 'click', label: `Clicking${targetName || ' the target'}`, direction: null, point: action.point }
    case 'drag': return { kind: 'pointer', label: `Dragging${targetName || ' the selected control'}`, direction: null, point: action.point }
    case 'element_action': return {
      kind: action.elementAction === 'focus' ? 'pointer' : 'click',
      label: `${action.elementAction === 'increment' ? 'Increasing' : action.elementAction === 'decrement' ? 'Decreasing' : action.elementAction === 'show_menu' ? 'Opening' : action.elementAction === 'focus' ? 'Focusing' : 'Activating'}${targetName || ' the selected control'}`,
      direction: null,
      point: action.point,
    }
    case 'invoke_safe_command': return {
      kind: 'key',
      label: action.command === 'textedit.save_document' ? 'Saving the fresh document to the approved new file' : 'Making the approved change',
      direction: null,
      point: null,
    }
    case 'scroll': {
      const direction = (action.scrollY ?? 1) >= 0 ? 'down' : 'up'
      return {
        kind: 'scroll', label: `Scrolling ${direction}`, direction,
        point: action.point ?? { x: target.bounds.width / 2, y: target.bounds.height / 2 },
      }
    }
    case 'type':
    case 'type_into': return { kind: 'typing', label: `Typing in${targetName || ' the selected field'}`, direction: null, point: action.point }
    case 'enter_sequence': return { kind: 'typing', label: `Entering text and keystrokes${targetName ? ` in${targetName}` : ''}`, direction: null, point: action.point }
    case 'apply_artifact': return { kind: 'typing', label: `Adding the checked result to${targetName || ' the selected destination'}`, direction: null, point: action.point }
    case 'keypress': return { kind: 'key', label: keyLabel(action.key), direction: null, point: action.point }
    case 'new_tab': return { kind: 'key', label: 'Opening a browser tab', direction: null, point: null }
    case 'cycle_tab': return { kind: 'key', label: action.key?.toUpperCase() === 'PREVIOUS' ? 'Returning to the original browser tab' : 'Revisiting the managed browser tab', direction: null, point: null }
    case 'wait': return { kind: 'wait', label: 'Waiting for the window to settle', direction: null, point: null }
    // A conclude sends no input; it states the composed result for verification.
    case 'conclude': return { kind: 'none', label: 'Stating the result from the visible evidence', direction: null, point: null }
    // The overlay follows the newly active window, so the switch itself needs
    // no pointer cue — only an honest label for what is about to happen.
    case 'switch_window': return { kind: 'wait', label: 'Switching to another authorized window', direction: null, point: null }
    case 'request_window': return { kind: 'none', label: `Asking for ${action.targetLabel ?? 'another window'}`, direction: null, point: null }
    case 'ask_user': return { kind: 'none', label: 'Asking for your direction', direction: null, point: null }
    case 'done': return { kind: 'none', label: 'Finishing the task', direction: null, point: null }
    case 'handoff': return { kind: 'none', label: 'Handing control back to you', direction: null, point: null }
  }
}

function keyLabel(key: string | null): string {
  switch (key?.toUpperCase()) {
    case 'SELECT_ALL': return 'Selecting existing text'
    case 'SHIFT+TAB': return 'Moving to the previous field'
    case 'RETURN':
    case 'ENTER': return 'Pressing Return'
    case 'ESC':
    case 'ESCAPE': return 'Pressing Escape'
    case 'TAB': return 'Moving to the next field'
    case 'SPACE': return 'Pressing Space'
    case 'UP': return 'Pressing Up Arrow'
    case 'DOWN': return 'Pressing Down Arrow'
    case 'LEFT': return 'Pressing Left Arrow'
    case 'RIGHT': return 'Pressing Right Arrow'
    default: return 'Pressing a navigation key'
  }
}

/** A window's name for the capsule: the tab or document title, short. Local
 * display only; it never reaches a model. */
export function capsuleWindowLabel(title: string | null | undefined, limit = 28): string | null {
  const clean = (title ?? '').replace(/\s+/gu, ' ').replace(/\s+[-–—]\s+(Google Chrome|Safari|Firefox|Microsoft Edge|Arc|Brave Browser)(\s+[-–—].*)?$/u, '').trim()
  if (!clean) return null
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`
}

export type PersonTurnPresentationReason = 'person_in_window' | 'person_elsewhere'

/** What the capsule says while Carve holds its next step for the person. */
export function personTurnCopy(reason: PersonTurnPresentationReason, application: string, windowLabel: string | null = null): { label: string; compactLabel: string; detail: string } {
  return reason === 'person_in_window'
    ? { label: 'You’re driving', compactLabel: 'You’re driving · Carve waits',
      detail: 'Carve sends nothing while you use the keyboard or mouse, and picks up once you pause.' }
    : { label: 'Waiting for you', compactLabel: 'Waiting for you',
      detail: `Carve needs ${windowLabel ? `“${windowLabel}”` : `this ${application} window`} in front to click or type. It won’t pull you back: return to it when you’re ready, or press Continue.` }
}
