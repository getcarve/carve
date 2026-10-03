import type { WindowLifecycleState } from './computer-use/window-lifecycle.js'
import { verifiedFreshTextDocument } from './fresh-document.js'
import { unmetProductRequirements, acquisitionRequirements, artifactDataDigest, initializeRequirementResolutions, requirementArtifactCoverage, requirementsContentReady, bindVerifiedSourceRequirements, refreshRequirementCoverage, validateTaskRequirementReferences } from './task-requirements.js'
import { availablePublicQueries } from './task-method.js'
import { shouldVerifyReadAnswerNow } from './live-computer-verification-policy.js'
import type { PublicLookupEvidence } from './public-web.js'
import { operationReplayKey, outcomeAssessment } from './live-computer-assessment.js'
import { acceptedDecision, decisionAnswerDigest, decisionContext, LiveComputerDecisionContextChangedError } from './live-computer-context.js'
import type { LiveComputerDeliveryFailure } from './types.js'
import { artifactPlacementText } from './live-computer-artifact-placement.js'
import { WorkResourceLimitError } from './work-budget.js'
import { artifactCellRepairContext, artifactReplayIssue, elementIdentityForInput, initialOperationEffect, resolveCurrentInputTarget, resolveInputTarget } from './live-computer-evidence.js'
import { boundNavigationDestinations, navigationOriginAuthorized, trustedTableServiceContinuity, navigationScopeDecision, navigationUrlExplicitlyRequested, requestedBoundNavigationDestination } from './navigation-authority.js'
import { recordLiveComputerSetup, recordLiveComputerEvidence } from './live-computer-task-state.js'
import { ActionScopeReviewRequired, ActionScopeAssessmentDeclined, bindActionScopeAssessment, hasActionScopeAssessment, actionScopeAccepted, assertActionScopeReviewEligible, actionScopeContextKey, clearActionScopeAssessment } from './live-computer-action-scope.js'
import type { ActionScopeAssessment, ActionScopeConstraint, ActionScopeReview } from './live-computer-action-scope.js'
import { createHash } from 'node:crypto'
import { setTimeout as captureRetryDelay } from 'node:timers/promises'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'
import { captureProtocolVersion, captureImageLimit, snapshotResponseLimit, accessibilityByteLimit, captureElementLimit, requestComputerHelper, persistentComputerHelper, persistentHelperEnabled, stopPersistentComputerHelpers, validateBinaryChannel, validateCaptureCompleteness, captureCompleteness, LiveComputerHelperError, type ElementCaptureCompleteness, type HelperMetrics } from './live-computer-protocol.js'
import { captureRefusalRetryEnabled, screenCaptureRefused } from './capture-refusal.js'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { ActionRisk, ApplicationOperationTransactionReceipt, AutonomyLevel, LiveComputerAction, LiveComputerActionEngine, LiveComputerActivityPhase, LiveComputerApplicationIdentity, LiveComputerApproval, LiveComputerArtifact, LiveComputerArtifactDraft, LiveComputerContextTransfer, LiveComputerCriterionResult, LiveComputerElement, LiveComputerExecutiveDecision, LiveComputerExecutionMode, LiveComputerFailureCause, LiveComputerFieldTextProvenance, LiveComputerFrame, LiveComputerMissionPlan, LiveComputerMissionStage, LiveComputerModelProfile, LiveComputerObjective, LiveComputerObjectiveGraphRevision, LiveComputerObservedActionReceipt, LiveComputerOperationFeasibility, LiveComputerPhysicalActionReceipt, LiveComputerProposalRejection, LiveComputerProposalRejectionStage, LiveComputerProposalRepair, LiveComputerSession, LiveComputerSessionTarget, LiveComputerStrategyMemo, LiveComputerSurfaceRole, LiveComputerTarget, LiveComputerTaskLedger, LiveComputerTerminalCategory, LiveComputerTextDelivery, LiveComputerTransition, LiveComputerVerifiedEffect, LiveComputerWorkProductContract, SupervisionPolicyV2, SurfaceDefaultApplication, TargetAuthorization } from './types.js'
import type { ApplicationOperationFailureCode } from './types.js'
import { liveComputerVisualQueryObjectiveCapability } from './live-computer-capability-runtime.js'
import { liveComputerActionMayBindElement, liveComputerElementSupportsTextEntry, liveComputerKeypressIsSafe, liveComputerObjectiveSupportsFieldSubmit } from './live-computer-action-contract.js'
import { activeLiveComputerObjective, liveComputerAdaptiveObjectiveCapacity, advanceLiveComputerInteractionState, canonicalLiveComputerRoute, classifyLiveComputerRouteTransition, compileLiveComputerTask, pendingLiveComputerTask, fieldEntryTerms, liveComputerActionSurface, looksLikeInstructionText, taskTerms, validateLiveComputerTaskLedger } from './live-computer-planning.js'
import { applyLiveComputerExecutiveDecision, liveComputerTacticSignature, liveComputerCoverageSnapshot, liveComputerExecutiveTrigger, recordLiveComputerAttempt, refreshLiveComputerExecutive, type LiveComputerExecutiveTrigger } from './live-computer-executive.js'
import { liveBudgetPolicy, liveVerificationPolicy } from './policy.js'
import { id, nowIso, sha256, stableJson } from './util.js'
import { pointRegion, regionChange, visiblyChanged } from './computer-use/visual-stability.js'
import { obstructionControls, obstructionCovering } from './computer-use/obstructions.js'
import { settleNavigationFrame, type NavigationProbe } from './computer-use/navigation-settle.js'
import { browserLocationCoveredByGoal, isBrowserLocationField } from './computer-use/effects.js'
import { requestedBrowserDestination } from './browser-destinations.js'
import { browserBundles, bundleForApplicationName, freshSurfaceSuggestion, neverOfferedSurface } from './fresh-surface.js'
import {
  beginLiveComputerInteraction,
  liveComputerActionNeedsInteractionTransaction,
  liveComputerInteractionIsTerminal,
  liveComputerInteractionRetryPolicy,
  markLiveComputerInteractionDelivering,
  observeLiveComputerInteraction,
  recordLiveComputerInteractionDelivery,
  resolveLiveComputerInteraction,
  type LiveComputerInteractionTransaction,
} from './live-computer-transactions.js'
import { activeLiveComputerOperationResolution, extractRequestedTextFilename, operationResolutionGuidance, validateNewTextFilePath } from './operation-feasibility.js'
import { classifyApplicationOperationFailure, validateApplicationOperationReceipt } from './application-operation-transaction.js'

export interface LiveComputerStatus {
  available: boolean
  platform: 'darwin' | 'unsupported'
  helperVersion: string | null
  screenRecording: 'granted' | 'denied' | 'unknown' | 'not_applicable'
  accessibility: 'granted' | 'denied' | 'unknown' | 'not_applicable'
  computerControl: boolean
  supportedActions: Array<'move' | 'click' | 'drag' | 'element_action' | 'invoke_safe_command' | 'scroll' | 'type' | 'keypress'>
  reason: string | null
}

function requiresMissionPlanReview(supervision: SupervisionPolicyV2 | undefined, autonomy: AutonomyLevel): boolean {
  return supervision ? supervision.planReview === 'always' : autonomy === 'approve_plan'
}

export interface CaptureOptions {
  /** Pixel coordinates include verified attached surfaces outside the parent. */
  ownedWindowGroup?: boolean
  elements?: boolean
  color?: boolean
  /** Lowercase goal words; the helper ranks controls whose label contains
   * one above generic links when the element budget cannot hold everything. */
  preferTerms?: string[]
  signal?: AbortSignal
}

export interface LiveComputerCapturedFrame extends LiveComputerFrame {
  /** Native-verified capture membership, not inferred from the root window ID. */
  capturedWindowIds?: number[]
  capturedWindows?: Array<{ windowId: number; bounds: LiveComputerTarget['bounds'] }>
  inputViewport?: { x: number; y: number; parentBounds: LiveComputerTarget['bounds'] }
  elementCompleteness?: ElementCaptureCompleteness
  captureDiagnostics?: Record<string, unknown>
  dataUrl: string
  /** Coarse, ephemeral grayscale pixels used only to detect visible change. */
  visualSample: string | null
  /** Higher-resolution ephemeral grayscale sample. The controller compares
   * only the bounded neighborhood around an intended control, avoiding the
   * false negatives of the legacy 12×12 whole-window sample. */
  annotationColorSample?: string | null
  localizedVisualSample?: string | null
  /** Bounded read-only accessibility elements for the selected window,
   * window-relative, captured with this frame. Empty when Accessibility data
   * is unavailable; grounding then falls back to pixels alone. */
  elements: LiveComputerElement[]
  /** Diagnostic from the helper's best-effort AX walk. Optional only for
   * synthetic/legacy backends; the macOS helper reports it on every frame. */
  elementCaptureStatus?: LiveComputerElementCaptureStatus
  elementMatchDiagnostics?: LiveComputerElementMatchDiagnostics | null
}

export interface LiveComputerElementMatchDiagnostics {
  owningProcessId: number | null
  candidateCount: number
  acceptedCandidateIndex: number | null
  uniqueBestMargin: number | null
  selectionEvidence: 'window_id' | 'scored_unique' | 'none'
  candidates: Array<{
    index: number
    iou: number
    positionDelta: number
    sizeDelta: number
    titleMatch: boolean
    titleRelation: 'exact' | 'elided' | 'contains' | 'none'
    windowIdMatch: boolean | null
    score: number
  }>
}

export type LiveComputerElementCaptureStatus =
  | 'available'
  | 'ax_untrusted'
  | 'window_match_failed'
  | 'walk_empty'
  | 'not_requested'
  | 'invalid_response'
  | 'unknown'

export function liveComputerTargetSupportsTabs(target: Pick<LiveComputerTarget, 'application' | 'bundleIdentifier'>): boolean {
  const bundle = target.bundleIdentifier.toLocaleLowerCase()
  return bundle === 'com.apple.safari'
    || bundle.startsWith('com.apple.safaritechnologypreview')
    || bundle.startsWith('com.google.chrome')
    || bundle.startsWith('com.microsoft.edgemac')
    || bundle.startsWith('com.brave.browser')
    || bundle.startsWith('org.mozilla.firefox')
    || bundle.startsWith('company.thebrowser.browser')
    || bundle === 'test.fixture.browser'
}

export interface LiveComputerBackend {
  readonly supportsOwnedWindowCapture?: boolean
  windowLifecycle?(target: LiveComputerTarget, restore: boolean, signal: AbortSignal): Promise<WindowLifecycleState>
  summary(): LiveComputerStatus
  refreshStatus(): Promise<LiveComputerStatus>
  requestScreenRecordingPermission(): Promise<LiveComputerStatus>
  requestAccessibilityPermission(): Promise<LiveComputerStatus>
  listTargets(): Promise<LiveComputerTarget[]>
  /** Read-only installed application identities; no window/document metadata. */
  listApplications?(): Promise<LiveComputerApplicationIdentity[]>
  /** Read-only macOS URL/content-type handlers; never changes system defaults. */
  listDefaultApplications?(): Promise<SurfaceDefaultApplication[]>
  /** Open a fresh window Carve owns: a browser at one https address, or a
   * new document in any app. Returns the window as a selectable target. */
  openWindow?(bundleIdentifier: string, url: string | null): Promise<LiveComputerTarget>
  /** Close one window Carve opened. */
  closeWindow?(target: LiveComputerTarget): Promise<void>
  capture(target: LiveComputerTarget, frameId: string, options?: CaptureOptions): Promise<LiveComputerCapturedFrame>
  /** Read-only visual timing sample. Null means this helper lacks support. */
  probe?(target: LiveComputerTarget, signal: AbortSignal): Promise<NavigationProbe | null>
  /** Which element would receive a click at a window-relative point, and
   * whether it is the intended target, one of its descendants, or something
   * in front of it. Advisory; the input bridge still verifies focus. */
  hitTest?(target: LiveComputerTarget, point: { x: number; y: number }, expected: LiveComputerHitTestExpectation | null): Promise<LiveComputerHitTest | null>
  /** The origin (`https://host`) the selected browser window shows now, read
   * from the page's accessibility tree; null when unavailable. */
  surfaceOrigin?(target: LiveComputerTarget): Promise<string | null>
  /** The selected window's whole document as text, including content scrolled
   * out of view; read-only, no input and no clipboard. Null when unavailable. */
  pageText?(target: LiveComputerTarget, limit?: number): Promise<LiveComputerPageText | null>
  tableDestination?(target: LiveComputerTarget): Promise<{ fingerprint: string; service: 'google_sheets' | 'google_docs' } | null>
  /** The local file the selected window's document is saved as, so the
   * controller can read a write back from disk; null when the window names
   * no local file. Used only inside the controller, never shown to a model. */
  documentLocation?(target: LiveComputerTarget): Promise<string | null>
  /** Raise and verify one already-authorized window without posting pointer or
   * keyboard input. Optional for synthetic/legacy backends. */
  activate?(target: LiveComputerTarget, signal: AbortSignal): Promise<void>
  /** Legacy/synthetic backends may return void; the controller then creates a
   * conservative receipt from the successful call and fresh observation. */
  execute(target: LiveComputerTarget, action: LiveComputerAction, signal: AbortSignal): Promise<LiveComputerPhysicalActionReceipt | void>
  /** One already-reviewed logical input transaction. The selected window is
   * resolved once and the controller keeps its physical steps together while
   * rechecking exact-window focus before native delivery. */
  executeTransaction?(
    target: LiveComputerTarget,
    action: LiveComputerAction,
    steps: LiveComputerAction[],
    signal: AbortSignal,
  ): Promise<LiveComputerPhysicalActionReceipt | void>
  setCaptureDiagnosticListener?(listener: (details: Record<string, unknown>) => void): void
  cleanupFrames?(sessionId: string): Promise<void>
  cleanupStaleFrames?(): Promise<number>
  dispose?(): Promise<void>
}

export interface LiveComputerRuntimeEvent {
  kind: 'capability_selected' | 'input_subaction' | 'input_checkpoint' | 'pointer_subaction' | 'pointer_checkpoint' | 'frame_cleanup' | 'budget_extended'
    | 'interaction_started' | 'delivery_completed' | 'delivery_partial' | 'effect_observed'
    | 'interaction_verified' | 'interaction_failed' | 'interaction_uncertain' | 'interaction_cancelled' | 'control_lane_released'
    | 'requirement_resolved' | 'requirement_conflicted' | 'operation_phase_retry' | 'navigation_settled' | 'obstruction_cleared' | 'obstruction_persisted' | 'navigation_origin_checked'
  requirement?: { id: string; revision: number; status: string; artifactId: string | null; sourceDigest: string | null }
  settleMetrics?: { probes: number; fullCaptures: number; elapsedMs: number; fallback: string | null }
  /** Obstruction clearing: which dialog, which control kind, which method. */
  obstruction?: { id: number; evidence: string; control: string | null; method: 'press' | 'escape' | 'scroll' | 'none' }
  originAuthorized?: boolean
  sessionId: string
  runId: string
  actionId: string | null
  objectiveId: string | null
  phase: string
  status: 'started' | 'completed' | 'failed' | 'changed' | 'unchanged' | 'accepted' | 'rejected' | 'uncertain'
  delivery: LiveComputerTextDelivery | null
  textLength: number | null
  textSha256: string | null
  frameSha256: string | null
  error: string | null
  /** A text post is not an outcome. Acceptance records which independent
   * channels proved (or failed to prove) that the intended field changed. */
  acceptance?: LiveComputerInputAcceptance
  evidenceChannels?: Array<'accessibility_focus' | 'accessibility_value' | 'capability_visual' | 'localized_visual' | 'coarse_visual' | 'semantic_visual' | 'frame_hash'>
  /** Controller-generated query provenance; never the typed plaintext. */
  textSource?: LiveComputerFieldTextProvenance['source'] | null
  textReferenceIds?: string[]
  /** For `budget_extended`: how many actions were added and the new budget. */
  grantedActions?: number
  newBudget?: number
  /** For `budget_extended`: `automatic_progress` or `user_grant`. */
  trigger?: string
  retryPolicy?: LiveComputerInteractionTransaction['retryPolicy']
  deliveryProgress?: LiveComputerInteractionTransaction['deliveryProgress']
  pressedInputsReleased?: boolean | null
  effectObservations?: number
  operationId?: string
  observationId?: string
  failureCode?: ApplicationOperationFailureCode
  failureFingerprint?: string
  inputReadback?: NonNullable<LiveComputerTransition['inputTransaction']>['readback']
}

export type LiveComputerRuntimeListener = (event: LiveComputerRuntimeEvent) => void

export type LiveComputerInputAcceptance = 'accepted' | 'rejected' | 'uncertain'

export interface LiveComputerInputEvidence {
  acceptance: LiveComputerInputAcceptance
  channels: Array<'accessibility_focus' | 'accessibility_value' | 'capability_visual' | 'localized_visual' | 'coarse_visual' | 'semantic_visual' | 'frame_hash'>
  reason: string
}

/** Optional visual evidence for a field transaction: focus before keyboard
 * input, or exact text after delivery. This cannot grant effect authority or
 * authorize duplicate delivery; those belong to the controller. */
export interface LiveComputerSemanticInputRequest {
  phase?: 'focus' | 'text' | 'text_and_focus'
  delivery?: Pick<LiveComputerPhysicalActionReceipt, 'deliveryProgress' | 'contentDelivery' | 'failure' | 'pressedInputsReleased'>
  session: LiveComputerSession
  action: LiveComputerAction
  before: LiveComputerCapturedFrame
  after: LiveComputerCapturedFrame
}

export type LiveComputerSemanticInputVerifier = (request: LiveComputerSemanticInputRequest) => Promise<LiveComputerInputEvidence>

export interface LiveComputerHitTestExpectation { fingerprint?: string | null; role: string; name: string; identifier: string | null; bounds: { x: number; y: number; width: number; height: number } | null }
export interface LiveComputerHitTest {
  available: boolean
  relation: 'target' | 'descendant' | 'other' | 'none'
  hit: { role: string; subrole: string | null; name: string; bounds: { x: number; y: number; width: number; height: number } | null } | null
  /** The nearest dialog-like ancestor of the hit element that the intended
   * target does not belong to. */
  obstruction: { role: string; subrole: string | null; name: string; bounds: { x: number; y: number; width: number; height: number } | null } | null
  /** Nearest non-dialog ancestor of the hit (at most 3 up) whose own subtree
   * holds the target (at most 3 down): same-widget evidence, never authority. */
  shared?: { role: string; subrole: string | null; name: string; bounds: { x: number; y: number; width: number; height: number } | null; levelsAboveHit: number; levelsAboveTarget: number } | null
  /** The hit element's frame was identical across two samples. */
  stable: boolean
}

export class LiveComputerActionError extends Error {
  constructor(
    readonly failureCause: LiveComputerFailureCause,
    message: string,
    readonly evidence?: LiveComputerInputEvidence,
    readonly operationTransaction?: ApplicationOperationTransactionReceipt,
    /** Sanitized numbers and identities for the audit trail; never screen text. */
    readonly diagnostics?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'LiveComputerActionError'
  }
}

/**
 * The Electron main process is the application macOS lists as "Carve" in
 * Accessibility. Input therefore has to be injected in that process, not in
 * the separate ScreenCaptureKit helper that owns selected-window frames.
 */
export interface LiveComputerPageText {
  text: string
  /** text_marker: the browser's own whole-document string; walk_*: static text in document order. */
  method: 'text_marker' | 'walk_document' | 'walk_window'
  truncated: boolean
  url: string | null
  elapsedMs: number | null
}

export interface LiveComputerInputController {
  windowLifecycle?(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, restore: boolean): WindowLifecycleState
  windowGroup?(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): Array<{ windowId: number; bounds: LiveComputerTarget['bounds'] }>
  isTrusted(): boolean
  requestTrust(): boolean
  hitTest?(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, point: { x: number; y: number }, expected: LiveComputerHitTestExpectation | null): LiveComputerHitTest | null
  surfaceOrigin?(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): string | null
  pageText?(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>, limit: number): LiveComputerPageText | null
  documentLocation?(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): string | null
  tableDestination?(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): { fingerprint: string; service: 'google_sheets' | 'google_docs' } | null
  /** Input-free exact-window activation used at a mission-stage boundary. */
  focus?(
    bounds: LiveComputerTarget['bounds'],
    target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>,
    signal?: AbortSignal,
  ): void | Promise<void>
  /** May hold briefly before posting input so the desktop frame can show the
   * grounded control first. A hold must re-check `signal` and send nothing
   * once it is aborted; the backend treats an aborted return as no input. */
  execute(
    bounds: LiveComputerTarget['bounds'],
    action: LiveComputerAction,
    target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>,
    signal?: AbortSignal,
  ): LiveComputerNativeDelivery | void | Promise<LiveComputerNativeDelivery | void>
  /** Transactional form used for focus → replace → type → submit. This keeps
   * helper resolution and UI presentation outside the individual substeps;
   * the native bridge still verifies the exact target before each chunk. */
  executeTransaction?(
    bounds: LiveComputerTarget['bounds'],
    action: LiveComputerAction,
    steps: LiveComputerAction[],
    target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>,
    signal?: AbortSignal,
  ): LiveComputerNativeDelivery | void | Promise<LiveComputerNativeDelivery | void>
}

/** Truthful low-level result from the process that posted the OS events. A
 * complete delivery still proves only that the gesture was posted, not that
 * the target application accepted its intended semantic effect. */
export interface LiveComputerNativeDelivery {
  deliveryProgress: 'none' | 'partial' | 'complete'
  pressedInputsReleased: boolean
  eventCount: number
  contentDelivery?: 'none' | 'partial' | 'complete' | 'unknown'
  failure?: LiveComputerDeliveryFailure
  verifiedEffect?: LiveComputerVerifiedEffect | null
  operationTransaction?: ApplicationOperationTransactionReceipt | null
  /** Where the input controller's own wall clock went before and during
   * dispatch (present, aim hold, person-turn wait, window focus handoff,
   * native dispatch), in milliseconds. Diagnostic only. */
  timings?: LiveComputerDispatchTimings
}

export interface LiveComputerDispatchTimings { presentMs: number; aimMs: number; personTurnMs: number; focusWindowMs: number; dispatchMs: number }

const unavailable = (reason: string): LiveComputerStatus => ({
  available: false,
  platform: process.platform === 'darwin' ? 'darwin' : 'unsupported',
  helperVersion: null,
  screenRecording: process.platform === 'darwin' ? 'unknown' : 'not_applicable',
  accessibility: process.platform === 'darwin' ? 'unknown' : 'not_applicable',
  computerControl: false,
  supportedActions: [],
  reason,
})

export class UnavailableLiveComputer implements LiveComputerBackend {
  private readonly status: LiveComputerStatus

  constructor(reason = 'Live computer use is available only in the macOS desktop app') {
    this.status = unavailable(reason)
  }

  summary(): LiveComputerStatus { return this.status }
  async refreshStatus(): Promise<LiveComputerStatus> { return this.status }
  async requestScreenRecordingPermission(): Promise<LiveComputerStatus> { throw new Error(this.status.reason ?? 'Live computer use is unavailable') }
  async requestAccessibilityPermission(): Promise<LiveComputerStatus> { throw new Error(this.status.reason ?? 'Live computer use is unavailable') }
  async listTargets(): Promise<LiveComputerTarget[]> { throw new Error(this.status.reason ?? 'Live computer use is unavailable') }
  async listApplications(): Promise<LiveComputerApplicationIdentity[]> { return [] }
  async capture(): Promise<LiveComputerCapturedFrame> { throw new Error(this.status.reason ?? 'Live computer use is unavailable') }
  async execute(): Promise<void> { throw new Error(this.status.reason ?? 'Live computer use is unavailable') }
}

interface HelperResponse {
  /** Helper-reported phase timings in milliseconds; diagnostics only. */
  timingsMs?: unknown
  freshDocument?: unknown
  inputViewport?: LiveComputerCapturedFrame['inputViewport']
  probeProtocols?: number[]
  windowId?: number
  bundleIdentifier?: string
  captureProtocols?: number[]
  protocolVersion?: number
  requestId?: string
  captureId?: string
  imageChannel?: unknown
  colorChannel?: unknown
  elementCompleteness?: unknown
  imageBytes?: Buffer
  colorBytes?: Buffer
  transportMetrics?: HelperMetrics
  ok: boolean
  helperVersion?: string
  screenRecording?: boolean
  accessibility?: boolean
  computerControl?: boolean
  windows?: Array<{
    windowId?: number
    application?: string
    bundleIdentifier?: string
    title?: string
    bounds?: { x?: number; y?: number; width?: number; height?: number }
  }>
  applications?: Array<{ application?: string; bundleIdentifier?: string }>
  defaults?: Array<{ capability?: string; application?: string; bundleIdentifier?: string; basis?: string }>
  appIcons?: Record<string, string>
  width?: number
  height?: number
  bounds?: { x?: number; y?: number; width?: number; height?: number }
  sha256?: string
  visualSample?: string
  annotationColorSample?: string
  localizedVisualSample?: string
  contentBounds?: { x?: number; y?: number; width?: number; height?: number } | null
  elements?: Array<{
    role?: string
    subrole?: string | null
    name?: string
    description?: string | null
    help?: string | null
    placeholder?: string | null
    identifier?: string | null
    value?: string | null
    bounds?: { x?: number; y?: number; width?: number; height?: number } | null
    sensitive?: boolean
    focused?: boolean | null
    enabled?: boolean | null
    focusable?: boolean | null
    editable?: boolean | null
    selected?: boolean | null
    expanded?: boolean | null
    checked?: boolean | null
    orientation?: string | null
    minValue?: number | null
    maxValue?: number | null
    actions?: unknown
    settableAttributes?: unknown
    containsFocus?: boolean | null
    valueComplete?: boolean
    depth?: number
    fingerprint?: unknown
    axPath?: unknown
    axRoot?: unknown
    dialogId?: unknown
    obstructed?: unknown
    pointerObstructions?: unknown
    media?: unknown
    url?: unknown
  }>
  obstructions?: unknown
  elementCaptureStatus?: string
  elementMatchDiagnostics?: unknown
  error?: string
}

/**
 * Thin macOS bridge for a selected-window, user-supervised control session.
 * The helper never receives arbitrary argv, a shell command, or a whole-screen
 * target. Every click is constrained to the selected window and rechecked by
 * the helper before Quartz receives an event.
 */
export class MacOSLiveComputerBackend implements LiveComputerBackend {
  get supportsOwnedWindowCapture(): boolean { return Boolean(this.inputController?.windowGroup) }
  private statusValue: LiveComputerStatus = unavailable('Live computer helper has not been checked')
  private lastHealthyStatus: LiveComputerStatus | null = null
  private statusCheckedAt = 0
  private readonly frameRoot: string
  private captureProtocols: number[] = [1]
  private supportsProbe = false
  private captureDiagnosticListener?: (details: Record<string, unknown>) => void

  setCaptureDiagnosticListener(listener: (details: Record<string, unknown>) => void): void { this.captureDiagnosticListener = listener }
  private captureDiagnostic(details: Record<string, unknown>): void { try { this.captureDiagnosticListener?.(details) } catch { /* Diagnostics never change capture outcome. */ } }

  constructor(private readonly helperPath: string, dataDir: string, private readonly inputController?: LiveComputerInputController) {
    this.frameRoot = resolve(dataDir, 'live-computer')
  }

  summary(): LiveComputerStatus { return this.statusValue }

  async refreshStatus(): Promise<LiveComputerStatus> {
    if (process.platform !== 'darwin') return this.statusValue = unavailable('Live computer use requires macOS')
    if (!existsSync(this.helperPath)) return this.statusValue = unavailable('Live computer helper is unavailable')
    try {
      const response = await this.request({ action: 'status' }, 15_000)
      this.supportsProbe = Array.isArray(response.probeProtocols) && response.probeProtocols.includes(1)
      this.captureProtocols = response.captureProtocols ?? [1]
      if (!Array.isArray(this.captureProtocols) || !this.captureProtocols.some(v => v === 1 || v === captureProtocolVersion)) throw new LiveComputerHelperError('protocol_mismatch', 'Unsupported capture protocol')
      const status = statusFrom(response, this.inputController?.isTrusted(), Boolean(this.inputController))
      if (status.available && status.accessibility === 'granted' && Boolean(status.computerControl)) {
        this.statusCheckedAt = Date.now()
        this.lastHealthyStatus = status
      }
      return this.statusValue = status
    } catch (error) {
      return this.statusValue = unavailable(`Live computer helper could not be checked: ${String(error)}`)
    }
  }

  async requestAccessibilityPermission(): Promise<LiveComputerStatus> {
    if (this.inputController) {
      this.inputController.requestTrust()
      return this.refreshStatus()
    }
    const response = await this.request({ action: 'requestAccessibilityPermission' }, 20_000)
    this.statusValue = statusFrom(response)
    return this.statusValue
  }

  async requestScreenRecordingPermission(): Promise<LiveComputerStatus> {
    await this.request({ action: 'requestScreenRecordingPermission' }, 20_000)
    return this.refreshStatus()
  }

  async listTargets(): Promise<LiveComputerTarget[]> {
    const status = await this.refreshStatus()
    if (status.screenRecording !== 'granted') throw new Error('Grant Screen Recording to the Carve live computer helper before selecting a window')
    const response = await this.request({ action: 'listWindows' })
    return this.mapTargets(response.windows ?? [], response.appIcons ?? {})
  }

  async listApplications(): Promise<LiveComputerApplicationIdentity[]> {
    const response = await this.request({ action: 'listApplications' }, 15_000)
    return (response.applications ?? []).flatMap((entry) => {
      const application = entry.application?.trim()
      const bundleIdentifier = entry.bundleIdentifier?.trim()
      return application && bundleIdentifier && !neverOfferedSurface(bundleIdentifier)
        ? [{ application, bundleIdentifier }]
        : []
    }).slice(0, 400)
  }

  async listDefaultApplications(): Promise<SurfaceDefaultApplication[]> {
    const response = await this.request({ action: 'listDefaultApplications' }, 15_000)
    const capabilities = new Set<SurfaceDefaultApplication['capability']>(['web_browser', 'text_document', 'spreadsheet', 'presentation', 'document_viewer'])
    const bases = new Set<SurfaceDefaultApplication['basis']>(['https_url', 'plain_text', 'spreadsheet', 'presentation', 'pdf'])
    return (response.defaults ?? []).flatMap((entry): SurfaceDefaultApplication[] => {
      const application = entry.application?.trim()
      const bundleIdentifier = entry.bundleIdentifier?.trim()
      const capability = entry.capability as SurfaceDefaultApplication['capability']
      const basis = entry.basis as SurfaceDefaultApplication['basis']
      return application && bundleIdentifier && capabilities.has(capability) && bases.has(basis) && !neverOfferedSurface(bundleIdentifier)
        ? [{ application, bundleIdentifier, capability, basis }]
        : []
    }).slice(0, 8)
  }

  private mapTargets(windows: NonNullable<HelperResponse['windows']>, appIcons: Record<string, unknown>): LiveComputerTarget[] {
    return windows
      .flatMap((window): LiveComputerTarget[] => {
        const bounds = window.bounds
        if (!Number.isInteger(window.windowId) || !window.application || !window.bundleIdentifier || !bounds) return []
        const x = Number(bounds.x); const y = Number(bounds.y); const width = Number(bounds.width); const height = Number(bounds.height)
        if (![x, y, width, height].every(Number.isFinite) || width < 120 || height < 80) return []
        const icon = appIcons[window.bundleIdentifier]
        const iconDataUrl = typeof icon === 'string' && icon.length <= 50_000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(icon) ? icon : null
        return [{ windowId: window.windowId!, application: window.application, bundleIdentifier: window.bundleIdentifier, title: window.title?.trim() || '[Untitled window]', iconDataUrl, bounds: { x, y, width, height } }]
      })
      .slice(0, 60)
  }

  async openWindow(bundleIdentifier: string, url: string | null): Promise<LiveComputerTarget> {
    const status = this.recentHealthyStatus() ?? this.statusForAction(await this.refreshStatus())
    if (status.screenRecording !== 'granted') throw new Error('Grant Screen Recording to the Carve live computer helper before opening a window')
    // With the persistent capture helper alive, the one-shot helper that opens the window waited on macOS's capture daemon
    // until its request timed out (5 of 8 fresh TextEdit opens); with the persistent helper off it opened at once. Stop the
    // persistent helper first; the next observation starts it again. Off: STEWARD_STOP_PERSISTENT_BEFORE_OPEN=off.
    if (persistentHelperEnabled() && process.env.STEWARD_STOP_PERSISTENT_BEFORE_OPEN?.trim().toLowerCase() !== 'off') persistentComputerHelper(this.helperPath, this.frameRoot).stop()
    // The helper waits up to 40 s for an app with many windows to show its new one.
    const response = await this.request({ action: 'openWindow', bundleIdentifier, ...(url ? { url } : {}) }, 50_000)
    const window = (response as { window?: HelperResponse['windows'] extends Array<infer W> | undefined ? W : never }).window
    const targets = this.mapTargets(window ? [window] : [], response.appIcons ?? {})
    const target = targets[0]
    if (!target) throw new Error('The fresh window could not be identified')
    if (target.bundleIdentifier !== bundleIdentifier) throw new Error('The fresh window belongs to a different application')
    // Older helpers accepted restored documents as fresh. Refuse that response
    // before the app records ownership or a handoff grants input authority.
    if (bundleIdentifier === 'com.apple.TextEdit') target.freshDocument = verifiedFreshTextDocument(response.freshDocument, target.windowId)
    return target
  }

  async closeWindow(target: LiveComputerTarget): Promise<void> {
    await this.request({ action: 'closeWindow', target }, 8_000)
  }

  async capture(target: LiveComputerTarget, frameId: string, options: CaptureOptions = {}): Promise<LiveComputerCapturedFrame> {
    validateFrameId(frameId)
    options.signal?.throwIfAborted()
    const status = this.recentHealthyStatus() ?? this.statusForAction(await this.refreshStatus())
    if (!status.available || status.screenRecording !== 'granted') throw new LiveComputerHelperError('permission_denied', status.reason ?? 'Screen Recording permission is required for live computer use')
    const v2 = this.captureProtocols.includes(captureProtocolVersion)
    const outputPath = resolve(this.frameRoot, `${frameId}.png`)
    if (!v2) await mkdir(this.frameRoot, { recursive: true, mode: 0o700 })
    const captureStartedAt = nowIso()
    const deadline = Date.now() + 20_000
    const requestId = id('capture')
    let response: HelperResponse | undefined
    let capturedWindowIds = [target.windowId]
    let capturedWindows: LiveComputerCapturedFrame['capturedWindows']
    let attempt = 0
    let refusalRetried = false
    try {
      // The retry of a refused capture is one extra attempt, whichever attempt it follows.
      for (; attempt < (refusalRetried ? 4 : 3); attempt++) {
        options.signal?.throwIfAborted()
        const captureId = `${frameId}-${attempt + 1}`
        try {
          const readOwnedWindowGroup = () => {
            try { return this.inputController?.windowGroup?.(target) }
            catch (error) {
              // AppKit can expose a partial hierarchy or animated geometry while a panel opens. An
              // incomplete read is not evidence of ownership: repeat the bounded
              // observation and both identity checks, never relax them or replay input.
              if (error instanceof Error && ['Owned sheet hierarchy was incomplete or exceeded its bound', 'Window group changed during inspection', 'Selected window ownership is ambiguous because another window has identical bounds'].includes(error.message)) {
                throw new LiveComputerHelperError('capture_changed', error.message)
              }
              throw error
            }
          }
          const ownedWindows = options.ownedWindowGroup ? readOwnedWindowGroup() : undefined
          if (options.ownedWindowGroup && (!v2 || !ownedWindows)) throw new Error('Owned window capture is unavailable')
          response = await this.request({ action: 'snapshot', target, requestId, ...(ownedWindows ? { ownedWindows } : {}), ...(v2 ? {
            protocolVersion: captureProtocolVersion, captureId,
            responseByteLimit: snapshotResponseLimit,
            elementByteLimit: attempt === 0 ? accessibilityByteLimit : 128_000,
            includeColor: options.color === true && attempt === 0,
          } : { outputPath }), ...(options.elements === false ? { includeElements: false } : {}), ...(options.preferTerms?.length ? { preferTerms: options.preferTerms.slice(0, 24) } : {}) }, Math.max(1, attempt === 0 ? Math.min(9_000, deadline - Date.now()) : deadline - Date.now()), options.signal)
          if (v2 && (response.protocolVersion !== captureProtocolVersion || response.requestId !== requestId || response.captureId !== captureId)) throw new LiveComputerHelperError('protocol_mismatch', 'Capture response identity does not match its request')
          if (ownedWindows) {
            const after = readOwnedWindowGroup()
            if (!after || after.length !== ownedWindows.length || ownedWindows.some(before => {
              const current = after.find(w => w.windowId === before.windowId)
              return !current || (['x','y','width','height'] as const).some(k => current.bounds[k] !== before.bounds[k])
            })) throw new LiveComputerHelperError('capture_changed', 'Owned window group changed during capture; capture again')
            const viewport = response.inputViewport
            const parent = ownedWindows[0]!.bounds
            if (!viewport || ![viewport.x, viewport.y].every(Number.isFinite)
              || !viewport.parentBounds || (['x','y','width','height'] as const).some(k => viewport.parentBounds[k] !== parent[k])
              || viewport.x > 0 || viewport.y > 0 || viewport.x + (response.width ?? 0) < parent.width || viewport.y + (response.height ?? 0) < parent.height)
              throw new Error('Owned window capture returned invalid coordinates')
          }
          capturedWindows = ownedWindows
          capturedWindowIds = ownedWindows?.map(window => window.windowId) ?? [target.windowId]
          break
        } catch (error) {
          if (!(v2 && error instanceof LiveComputerHelperError && Date.now() < deadline && !options.signal?.aborted
            && (error.code === 'output_limit' && attempt === 0 || error.code === 'capture_changed' && attempt < 2
              // A helper that hangs on one capture (a clothing retailer: one in six sessions, ending the
              // run before any decision) gets one fresh process within the same 20 s budget.
              || error.code === 'timeout' && attempt === 0
              // ScreenCaptureKit refused (-3801) right after that fresh process started. One more
              // capture after a short pause before the run ends on it; a standing refusal fails the same way again.
              || error.code === 'process_error' && !refusalRetried && screenCaptureRefused(error.message) && captureRefusalRetryEnabled()))) throw error
          const refusal = error.code === 'process_error'
          if (refusal) refusalRetried = true
          this.captureDiagnostic({ requestId, captureId, status: 'retrying', code: refusal ? 'capture_refused' : error.code, attempt: attempt + 1, ...error.details })
          // Retry only an incoherent observation, never an input or model turn.
          if (error.code === 'capture_changed') await captureRetryDelay(100 * (attempt + 1), undefined, { signal: options.signal })
          if (refusal) await captureRetryDelay(Math.max(0, Math.min(captureRefusalRetryDelayMs(), deadline - Date.now() - 1_000)), undefined, { signal: options.signal })
        }
      }
      if (!response) throw new LiveComputerHelperError('invalid_response', 'Capture returned no response')
      options.signal?.throwIfAborted()
      const width = boundedDimension(response.width, 'frame width')
      const height = boundedDimension(response.height, 'frame height')
      let bytes: Buffer
      let annotationColorSample: string | null = null
      if (v2) {
        bytes = response.imageBytes ?? Buffer.alloc(0)
        validateBinaryChannel(response.imageChannel, bytes, { kind: 'png', captureId: response.captureId!, width, height })
        const color = response.colorBytes ?? Buffer.alloc(0)
        if (response.colorChannel != null || color.length) {
          validateBinaryChannel(response.colorChannel, color, { kind: 'rgba', captureId: response.captureId!, width: 192, height: 128 })
          annotationColorSample = color.toString('base64')
        }
        if (!Array.isArray(response.elements)) throw new LiveComputerHelperError('invalid_response', 'Capture is missing accessibility elements')
        validateCaptureCompleteness(response.elementCompleteness, response.elements.length)
      } else {
        // Legacy helpers write a file before returning JSON. Reject symlinks
        // and bound the read before allocating; failed requests clean up too.
        const file = await open(outputPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
        try {
          const info = await file.stat()
          if (!info.isFile() || info.size < 1 || info.size > captureImageLimit) throw new LiveComputerHelperError('artifact_invalid', 'Live computer frame is empty or exceeds the 25 MB limit')
          bytes = await file.readFile()
        } finally { await file.close() }
        annotationColorSample = typeof response.annotationColorSample === 'string' && response.annotationColorSample.length === 131072 && Buffer.from(response.annotationColorSample, 'base64').length === 98304 ? response.annotationColorSample : null
      }
      if (!bytes.length || bytes.length > captureImageLimit) throw new LiveComputerHelperError('artifact_invalid', 'Live computer frame exceeds its limit')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (response.sha256 && response.sha256 !== sha256) throw new LiveComputerHelperError('artifact_invalid', 'Live computer frame integrity check failed')
      const elements = validElements(response.elements, width, height)
      const obstructions = validObstructions(response.obstructions, width, height)
      const completeness = captureCompleteness(response.elementCompleteness, response.elements?.length ?? 0, elements.length)
      // Helper phase timings (startup, resolve, screenshot, encode, accessibility,
      // samples, total) when the helper reports them; the transport's elapsedMs
      // minus the helper's own total is process launch and pipe overhead.
      const reportedTimings = response.timingsMs
      const helperTimings = reportedTimings && typeof reportedTimings === 'object' && !Array.isArray(reportedTimings)
        ? Object.fromEntries(Object.entries(reportedTimings as Record<string, unknown>).filter(([key, value]) => /^[a-z]{1,24}$/u.test(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 600_000).slice(0, 12))
        : null
      const diagnostics = { requestId, status: 'completed', rootWindowId: target.windowId, capturedWindowIds, protocolVersion: v2 ? 2 : 1, helperVersion: status.helperVersion, attempts: attempt + 1, ...response.transportMetrics, elementCompleteness: completeness, ...(helperTimings ? { helperTimings } : {}) }
      this.captureDiagnostic(diagnostics)
      return {
        id: frameId, capturedWindowIds, ...(capturedWindows ? { capturedWindows } : {}), capturedAt: nowIso(), captureInterval: { startedAt: captureStartedAt, completedAt: nowIso(), channelsAtomic: false },
        width, height, sha256, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        ...(options.ownedWindowGroup ? { inputViewport: response.inputViewport! } : {}),
        visualSample: validVisualSample(response.visualSample), localizedVisualSample: validLocalizedVisualSample(response.localizedVisualSample), annotationColorSample,
        elements, elementCompleteness: completeness, captureDiagnostics: diagnostics,
        elementCaptureStatus: validElementCaptureStatus(response.elementCaptureStatus, elements.length),
        elementMatchDiagnostics: validElementMatchDiagnostics(response.elementMatchDiagnostics),
        contentBounds: boundedLiveComputerContent(response.contentBounds, width, height),
        ...(obstructions.length ? { obstructions } : {}),
      }
    } catch (error) {
      if (error instanceof LiveComputerHelperError) Object.assign(error.details, { requestId, helperVersion: status.helperVersion, attempts: attempt + 1 })
      this.captureDiagnostic({ requestId, status: 'failed', protocolVersion: v2 ? 2 : 1, helperVersion: status.helperVersion, attempts: attempt + 1, code: error instanceof LiveComputerHelperError ? error.code : 'capture_failed', ...(error instanceof LiveComputerHelperError ? error.details : {}) })
      throw error
    } finally {
      // request() waits for child close, so no writer can recreate this file.
      if (!v2) await rm(outputPath, { force: true }).catch(() => this.captureDiagnostic({ requestId, status: 'cleanup_failed' }))
    }
  }

  async probe(target: LiveComputerTarget, signal: AbortSignal): Promise<NavigationProbe | null> {
    signal.throwIfAborted()
    if (!this.supportsProbe) return null
    const requestId = id('probe')
    const response = await this.request({ action: 'probe', target, requestId, protocolVersion: 1 }, 3_000, signal)
    signal.throwIfAborted()
    const visualSample = validVisualSample(response.visualSample)
    if (response.protocolVersion !== 1 || response.requestId !== requestId
      || response.windowId !== target.windowId || response.bundleIdentifier !== target.bundleIdentifier || !visualSample) {
      throw new LiveComputerHelperError('invalid_response', 'Visual probe identity or sample is invalid')
    }
    const result = { width: boundedDimension(response.width, 'probe width'), height: boundedDimension(response.height, 'probe height'), visualSample }
    this.captureDiagnostic({ requestId, status: 'completed', purpose: 'settle_probe', ...response.transportMetrics })
    return result
  }

  async hitTest(target: LiveComputerTarget, point: { x: number; y: number }, expected: LiveComputerHitTestExpectation | null): Promise<LiveComputerHitTest | null> {
    if (!this.inputController?.hitTest) return null
    try { return this.inputController.hitTest({ windowId: target.windowId, bundleIdentifier: target.bundleIdentifier }, point, expected) } catch { return null }
  }

  async tableDestination(target: LiveComputerTarget): Promise<{ fingerprint: string; service: 'google_sheets' | 'google_docs' } | null> {
    return this.inputController?.tableDestination?.(target) ?? null
  }

  async surfaceOrigin(target: LiveComputerTarget): Promise<string | null> {
    if (!this.inputController?.surfaceOrigin) return null
    try { return this.inputController.surfaceOrigin({ windowId: target.windowId, bundleIdentifier: target.bundleIdentifier }) } catch { return null }
  }

  async pageText(target: LiveComputerTarget, limit = 120_000): Promise<LiveComputerPageText | null> {
    if (!this.inputController?.pageText) return null
    try { return this.inputController.pageText({ windowId: target.windowId, bundleIdentifier: target.bundleIdentifier }, limit) } catch { return null }
  }

  async documentLocation(target: LiveComputerTarget): Promise<string | null> {
    if (!this.inputController?.documentLocation) return null
    try { return this.inputController.documentLocation({ windowId: target.windowId, bundleIdentifier: target.bundleIdentifier }) } catch { return null }
  }

  async windowLifecycle(target: LiveComputerTarget, restore: boolean, signal: AbortSignal): Promise<WindowLifecycleState> {
    signal.throwIfAborted()
    return this.inputController?.windowLifecycle?.(target, restore) ?? 'unknown'
  }

  async activate(target: LiveComputerTarget, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Live computer window transition was stopped before it began')
    const status = this.recentHealthyStatus() ?? this.statusForAction(await this.refreshStatus())
    if (!status.available || status.accessibility !== 'granted' || !status.computerControl) {
      throw new Error(status.reason ?? 'Accessibility permission is required to switch live computer windows')
    }
    if (!this.inputController?.focus) return
    // Activation can move/resize a window after prepareInput (for example
    // macOS brings an off-screen window back onto the display). Refresh the
    // exact target once; this path sends no coordinate-based document input.
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted()
      const preparation = await this.request({ action: 'prepareInput', target }, 25_000, signal)
      const bounds = preparation.bounds
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || (bounds.width ?? 0) < 1 || (bounds.height ?? 0) < 1) {
        throw new Error('Live computer helper returned invalid verified window bounds')
      }
      signal.throwIfAborted()
      try {
        await this.inputController.focus(
          { x: bounds.x!, y: bounds.y!, width: bounds.width!, height: bounds.height! },
          { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier },
          signal,
        )
        signal.throwIfAborted()
        return
      } catch (error) {
        signal.throwIfAborted()
        if (attempt !== 0 || !(error instanceof Error) || !error.message.includes('(reason: target_identity_changed)')) throw error
      }
    }
  }

  async execute(target: LiveComputerTarget, action: LiveComputerAction, signal: AbortSignal): Promise<LiveComputerPhysicalActionReceipt> {
    const startedAt = nowIso()
    if (signal.aborted) throw new Error('Live computer action was stopped before it began')
    const status = this.recentHealthyStatus() ?? this.statusForAction(await this.refreshStatus())
    if (!status.available || status.accessibility !== 'granted' || !status.computerControl) {
      throw new Error(status.reason ?? 'Accessibility permission is required for live computer control')
    }
    if (!['move', 'click', 'drag', 'element_action', 'invoke_safe_command', 'scroll', 'type', 'keypress'].includes(action.kind)) throw new Error(`Live action ${action.kind} does not inject input`)
    if (this.inputController) {
      // Window resolution goes through ScreenCaptureKit, which can take
      // several seconds under load; a stall here must not read as a failure.
      const preparedAt = Date.now()
      const preparation = await this.request({ action: 'prepareInput', target }, 25_000, signal)
      const prepareMs = Date.now() - preparedAt
      const bounds = preparation.bounds
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || (bounds.width ?? 0) < 1 || (bounds.height ?? 0) < 1) {
        throw new Error('Live computer helper returned invalid verified window bounds')
      }
      if (signal.aborted) throw new Error('Live computer action was stopped before input was sent')
      const delivery = await this.inputController.execute(
        { x: bounds.x!, y: bounds.y!, width: bounds.width!, height: bounds.height! },
        action,
        { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier },
        signal,
      )
      if (signal.aborted && (!delivery || delivery.deliveryProgress === 'none')) throw new Error('Live computer action was stopped before input was sent')
      const receipt = { ...physicalActionReceipt(action, target, startedAt, delivery ?? undefined), timings: { prepareMs, deliverMs: Date.now() - preparedAt - prepareMs, ...(delivery?.timings ? { dispatch: { ...delivery.timings } } : {}) } }
      if (receipt.pressedInputsReleased === false) {
        return { ...receipt, delivery: 'uncertain', deliveryProgress: receipt.deliveryProgress === 'none' ? 'none' : 'partial' }
      }
      return receipt
    }
    await this.request({ action: 'execute', target, input: action }, 15_000, signal)
    return physicalActionReceipt(action, target, startedAt)
  }

  async executeTransaction(target: LiveComputerTarget, action: LiveComputerAction, steps: LiveComputerAction[], signal: AbortSignal): Promise<LiveComputerPhysicalActionReceipt> {
    const startedAt = nowIso()
    if (signal.aborted) throw new Error('Live computer transaction was stopped before it began')
    const status = this.recentHealthyStatus() ?? this.statusForAction(await this.refreshStatus())
    if (!status.available || status.accessibility !== 'granted' || !status.computerControl) {
      throw new Error(status.reason ?? 'Accessibility permission is required for live computer control')
    }
    if (!this.inputController?.executeTransaction) throw new Error('The atomic live input transaction bridge is unavailable')
    if (steps.length < 1 || steps.length > 28 || steps.some((step) => !['click', 'type', 'keypress'].includes(step.kind))) {
      throw new Error('The live input transaction contains unsupported physical steps')
    }
    // Resolve immutable window identity and current bounds once for the whole
    // logical transaction. Individual native deliveries still fail closed if
    // focus or ownership changes before their event is posted.
    const transactionStartedAt = Date.now()
    const preparation = await this.request({ action: 'prepareInput', target }, 25_000, signal)
    const preparedMs = Date.now() - transactionStartedAt
    const bounds = preparation.bounds
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || (bounds.width ?? 0) < 1 || (bounds.height ?? 0) < 1) {
      throw new Error('Live computer helper returned invalid verified window bounds')
    }
    if (signal.aborted) throw new Error('Live computer transaction was stopped before input was sent')
    const delivery = await this.inputController.executeTransaction(
      { x: bounds.x!, y: bounds.y!, width: bounds.width!, height: bounds.height! },
      action,
      steps,
      { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier },
      signal,
    )
    if (signal.aborted && (!delivery || delivery.deliveryProgress === 'none')) throw new Error('Live computer transaction was stopped before input was sent')
    const prepareMs = preparedMs
    return { ...physicalActionReceipt(action, target, startedAt, delivery ?? undefined), timings: { prepareMs, deliverMs: Date.now() - transactionStartedAt - prepareMs, ...(delivery?.timings ? { dispatch: { ...delivery.timings } } : {}) } }
  }

  /** Every input action used to spawn a second helper process just to ask
   * whether the helper was healthy, and one slow answer surfaced as a run
   * ending in "helper timed out". A healthy answer from the last thirty
   * seconds stands; anything less than healthy is re-probed every time. */
  private recentHealthyStatus(maximumAgeMs = 30_000): LiveComputerStatus | null {
    const status = this.lastHealthyStatus
    return status && Date.now() - this.statusCheckedAt < maximumAgeMs ? status : null
  }

  /** A probe that fails to answer is not evidence that permissions were
   * revoked. Inside one live session the last healthy answer stands for ten
   * minutes; a real revocation surfaces as the helper refusing the action. */
  private statusForAction(fresh: LiveComputerStatus): LiveComputerStatus {
    if (fresh.available) return fresh
    return /timed out|could not be checked/iu.test(fresh.reason ?? '') ? this.recentHealthyStatus(600_000) ?? fresh : fresh
  }

  async cleanupFrames(sessionId: string): Promise<void> {
    validateFrameId(sessionId)
    let names: string[]
    try {
      names = await readdir(this.frameRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await Promise.all(names
      .filter((name) => name.startsWith(`${sessionId}-`) && name.endsWith('.png'))
      .map((name) => rm(resolve(this.frameRoot, name), { force: true })))
  }

  async cleanupStaleFrames(): Promise<number> {
    let names: string[]
    try {
      names = await readdir(this.frameRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    const stale = names.filter((name) => /^live_[a-z0-9_-]+\.png$/iu.test(name))
    await Promise.all(stale.map((name) => rm(resolve(this.frameRoot, name), { force: true })))
    return stale.length
  }

  async dispose(): Promise<void> {
    stopPersistentComputerHelpers()
    await rm(this.frameRoot, { recursive: true, force: true })
  }

  private async request(payload: Record<string, unknown>, timeoutMs = 10_000, signal?: AbortSignal): Promise<HelperResponse> {
    if (process.platform !== 'darwin') throw new Error('Live computer use requires macOS')
    if (!existsSync(this.helperPath)) throw new Error('Live computer helper is unavailable')
    const observation = payload.action === 'snapshot' || payload.action === 'probe'
    const result = observation && persistentHelperEnabled()
      ? await persistentComputerHelper(this.helperPath, this.frameRoot).request(payload, timeoutMs, signal)
      : await requestComputerHelper(this.helperPath, this.frameRoot, payload, timeoutMs, signal)
    return { ...result.response, imageBytes: result.image, colorBytes: result.color, transportMetrics: result.metrics } as unknown as HelperResponse
  }

}

export class LiveComputerService {
  private sessionValue: LiveComputerSession | null = null
  private publicLookupObservationEpoch = 0
  private publicLookupObservedEpoch = 0
  private frameDataUrl: string | null = null
  private frameVisualSample: string | null = null
  private frameLocalizedVisualSample: string | null = null
  private frameElements: LiveComputerElement[] = []
  private frameElementCaptureStatus: LiveComputerElementCaptureStatus = 'unknown'
  private frameElementMatchDiagnostics: LiveComputerElementMatchDiagnostics | null = null
  private preActionElements: LiveComputerElement[] = []
  private pendingInputBaseline: LiveComputerCapturedFrame | null = null
  private activePhysicalReceipt: LiveComputerPhysicalActionReceipt | null = null
  private activePhysicalSubsteps: LiveComputerPhysicalActionReceipt[] = []
  private activeContentDelivery: NonNullable<LiveComputerPhysicalActionReceipt['contentDelivery']> = 'none'
  private activeActionStartedAt: string | null = null
  private activeActionBeforeFrameSha256: string | null = null
  private activeActionBeforeVisualSample: string | null = null
  private activeActionBeforeLocalizedSample: string | null = null
  private activeActionSideEffectScope: LiveComputerPhysicalActionReceipt['sideEffectScope'] = 'selected_window'
  private activeInteractionTransaction: LiveComputerInteractionTransaction | null = null
  private readonly cleanupScheduled = new Set<string>()
  private disposed = false
  private assistanceInputHeld = false
  private physicalInputsInFlight = 0

  inputHeld(): boolean { return this.assistanceInputHeld }
  inputQuiescent(): boolean { return this.physicalInputsInFlight === 0 }
  private assertInputAdmission(): void {
    if (this.assistanceInputHeld || this.sessionValue?.status === 'stopped') throw new Error('Computer input is paused. Resume before continuing.')
  }

  constructor(
    private readonly backend: LiveComputerBackend,
    private readonly runtimeListener?: LiveComputerRuntimeListener,
    private readonly semanticInputVerifier?: LiveComputerSemanticInputVerifier,
    private readonly releaseInputPolicy?: (action: LiveComputerAction) => void,
  ) {}

  assertDecisionContext(expected: LiveComputerSession): void {
    const current = this.requireSession()
    if (current.id !== expected.id || decisionContext(current.ledger).digest !== decisionContext(expected.ledger).digest) {
      throw new LiveComputerDecisionContextChangedError()
    }
  }

  status(): LiveComputerStatus { return this.backend.summary() }
  session(): LiveComputerSession | null { return this.sessionValue ? structuredClone(this.sessionValue) : null }
  async refreshStatus(): Promise<LiveComputerStatus> { return this.backend.refreshStatus() }
  async requestScreenRecordingPermission(): Promise<LiveComputerStatus> { return this.backend.requestScreenRecordingPermission() }
  async requestAccessibilityPermission(): Promise<LiveComputerStatus> { return this.backend.requestAccessibilityPermission() }
  /** The most recent window listing, so a window request can offer real
   * candidates without an async hop inside the synchronous proposal path. */
  private knownTargets: LiveComputerTarget[] = []
  private knownApplications: LiveComputerApplicationIdentity[] = []

  async listTargets(): Promise<LiveComputerTarget[]> {
    const [listed, applications] = await Promise.all([
      this.backend.listTargets(),
      this.backend.listApplications?.().catch(() => []) ?? Promise.resolve([]),
    ])
    this.knownTargets = listed
    this.knownApplications = applications
    return listed
  }

  /** Fail environment readiness before a caller spends planning inference.
   * Fresh routes that are already execution-authorized also prove that macOS
   * can foreground the exact selected target (and therefore that the console
   * is not locked). Mission-plan review remains in Carve until approval. */
  async preflightStartTarget(input: {
    target: LiveComputerTarget
    source?: LiveComputerSessionTarget['source']
    autonomy: AutonomyLevel
    supervision?: SupervisionPolicyV2
    signal?: AbortSignal
  }): Promise<void> {
    input.signal?.throwIfAborted()
    const status = await this.backend.refreshStatus()
    input.signal?.throwIfAborted()
    if (!status.available || status.screenRecording !== 'granted' || status.accessibility !== 'granted' || !status.computerControl) {
      throw new Error(status.reason ?? 'Grant Screen Recording and Accessibility before starting live computer use')
    }
    const listed = await this.backend.listTargets()
    input.signal?.throwIfAborted()
    const exact = listed.find((available) => available.windowId === input.target.windowId
      && available.bundleIdentifier === input.target.bundleIdentifier)
    if (!exact) throw new Error(`The window “${input.target.title}” is no longer available; choose it again`)
    if (input.source === 'fresh'
      && !requiresMissionPlanReview(input.supervision, input.autonomy)
      && this.backend.activate) {
      await this.backend.activate(exact, AbortSignal.any([AbortSignal.timeout(5_000), ...(input.signal ? [input.signal] : [])]))
      input.signal?.throwIfAborted()
    }
  }
  latestFrame(): { dataUrl: string | null; frame: LiveComputerFrame | null; elements: LiveComputerElement[]; elementCaptureStatus: LiveComputerElementCaptureStatus; elementMatchDiagnostics: LiveComputerElementMatchDiagnostics | null; elementCompleteness?: ElementCaptureCompleteness } {
    return {
      dataUrl: this.frameDataUrl,
      frame: this.sessionValue?.latestFrame ?? null,
      elements: structuredClone(this.frameElements),
      elementCaptureStatus: this.frameElementCaptureStatus,
      ...(this.sessionValue?.latestFrame?.elementCompleteness ? { elementCompleteness: this.sessionValue.latestFrame.elementCompleteness } : {}),
      elementMatchDiagnostics: structuredClone(this.frameElementMatchDiagnostics),
    }
  }

  async start(input: { runId: string; goal: string; surfaceIntent?: LiveComputerSession['surfaceIntent']; priorExchange?: { goal: string; result: string | null } | null; providerId: string; verifierProviderId?: string | null; autonomy?: AutonomyLevel; supervision?: SupervisionPolicyV2; executionMode?: LiveComputerExecutionMode; actionEngine?: LiveComputerActionEngine; modelProfile?: LiveComputerModelProfile; remoteVisualsAllowed: boolean; target: LiveComputerTarget; targetSource?: LiveComputerSessionTarget['source']; targetInitialUrl?: string | null; targetRole?: LiveComputerSurfaceRole; targetPurpose?: string; additionalTargets?: LiveComputerSessionTarget[]; maxActions: number; maxDurationMinutes?: number; ledger?: LiveComputerTaskLedger; deferStrategy?: boolean; deferContract?: boolean; signal?: AbortSignal }): Promise<LiveComputerSession> {
    if (this.sessionValue && !terminal(this.sessionValue.status)) throw new Error('A live computer session is already active; stop it before selecting another window')
    const status = await this.backend.refreshStatus()
    if (!status.available || status.screenRecording !== 'granted' || status.accessibility !== 'granted' || !status.computerControl) {
      throw new Error(status.reason ?? 'Grant Screen Recording and Accessibility before starting live computer use')
    }
    const listed = await this.backend.listTargets()
    // The icon improves recognition in the picker but is not part of the
    // selected-window authority carried into capture and input commands.
    const resolve = (candidate: LiveComputerTarget): LiveComputerTarget => {
      const exact = listed.find((available) => available.windowId === candidate.windowId && available.bundleIdentifier === candidate.bundleIdentifier)
      if (!exact) throw new Error(`The window “${candidate.title}” is no longer available; choose it again`)
      return {
        windowId: exact.windowId,
        application: exact.application,
        bundleIdentifier: exact.bundleIdentifier,
        title: exact.title,
        bounds: exact.bounds,
      }
    }
    const selected = resolve(input.target)
    // The window the user picked always carries input authority; any further
    // window is authorized explicitly, at the authority it was granted.
    const targets: LiveComputerSessionTarget[] = [{
      target: selected,
      authority: 'input',
      ...(input.targetSource ? { source: input.targetSource } : {}),
      ...(input.targetInitialUrl !== undefined ? { initialUrl: input.targetInitialUrl } : {}),
      ...(input.targetRole ? { role: input.targetRole } : {}),
      ...(input.targetPurpose?.trim() ? { purpose: input.targetPurpose.trim().slice(0, 120) } : {}),
    }]
    for (const additional of input.additionalTargets ?? []) {
      const resolved = resolve(additional.target)
      if (targets.some((entry) => sameWindow(entry.target, resolved))) continue
      if (additional.authority !== 'observe' && additional.authority !== 'input') throw new Error('Each authorized window needs an explicit observe or input authority')
      targets.push({
        target: resolved,
        authority: additional.authority,
        ...(additional.source ? { source: additional.source } : {}),
        ...(additional.initialUrl !== undefined ? { initialUrl: additional.initialUrl } : {}),
        ...(additional.role ? { role: additional.role } : {}),
        ...(additional.purpose?.trim() ? { purpose: additional.purpose.trim().slice(0, 120) } : {}),
      })
    }
    if (targets.length > 4) throw new Error('A live session may span at most four authorized windows')
    const sessionId = id('live')
    this.assistanceInputHeld = false
    const targetAuthorization: TargetAuthorization = {
      version: 1,
      runId: input.runId,
      sessionId,
      targetHash: sha256(stableJson(targets.map((entry) => ({ windowId: entry.target.windowId, bundleIdentifier: entry.target.bundleIdentifier, authority: entry.authority, role: entry.role ?? 'workspace' })))),
      windows: targets.map((entry) => ({ windowId: entry.target.windowId, bundleIdentifier: entry.target.bundleIdentifier, authority: entry.authority, role: entry.role ?? 'workspace' })),
      remoteVisualsAllowed: input.remoteVisualsAllowed,
      authorizedAt: nowIso(),
      authorizedBy: 'user',
    }
    const autonomy = input.autonomy ?? 'approve_each'
    // A fresh surface already authorized for immediate execution should be
    // the active surface when its first frame is captured. Besides making the
    // handoff visible, this lets applications that publish only their focused
    // Accessibility window expose a semantic element digest. Plan-review
    // sessions remain in Carve until the person approves their mission plan.
    if (input.targetSource === 'fresh'
      && !requiresMissionPlanReview(input.supervision, autonomy)
      && this.backend.activate) {
      await this.backend.activate(selected, AbortSignal.timeout(5_000))
    }
    input.signal?.throwIfAborted()
    const first = await this.backend.capture(selected, `${sessionId}-1`)
    input.signal?.throwIfAborted()
    const ledger = input.deferContract ? pendingLiveComputerTask() : input.ledger
      ? validateLiveComputerTaskLedger(structuredClone(input.ledger))
      : compileLiveComputerTask(input.goal)
    assignLiveComputerObjectiveSurfaces(ledger, targets)
    recordLiveComputerSetup(ledger, targets)
    satisfyMaterializedRoutePrefix(ledger, targets)
    ledger.interactionState.authority = 'input'
    ledger.interactionState.activeWindowId = selected.windowId
    const missionPlan = createMissionPlan(input.goal, selected, targets, ledger, boundedSessionActions(input.maxActions))
    const sessionStartedAt = nowIso()
    const initialActivity = input.deferContract ? 'The request and selected windows are retained. Waiting for a complete result plan; no input can be sent.' : input.deferStrategy === true
      ? targets.length > 1
        ? `Authorized ${targets.length} windows and captured the first local frame of ${selected.application}. Preparing the bounded strategy; no input can be sent yet.`
        : 'Selected the window and captured its first local frame. Preparing the bounded strategy; no input can be sent yet.'
      : targets.length > 1
        ? `Authorized ${targets.length} windows and captured the first local frame of ${selected.application}.`
        : 'Selected a single window and captured its first local frame.'
    const initialPhase: LiveComputerActivityPhase = input.deferStrategy === true || input.deferContract === true ? 'preparing' : requiresMissionPlanReview(input.supervision, autonomy) ? 'waiting' : 'observing'
    this.publicLookupObservationEpoch = 0
    this.publicLookupObservedEpoch = 0
    this.sessionValue = {
      id: sessionId,
      runId: input.runId,
      goal: input.goal.trim(),
      ...(input.surfaceIntent ? { surfaceIntent: structuredClone(input.surfaceIntent) } : {}),
      providerId: input.providerId,
      verifierProviderId: input.verifierProviderId?.trim() || null,
      autonomy,
      ...(input.supervision ? { supervision: structuredClone(input.supervision) } : {}),
      targetAuthorization,
      executionMode: input.executionMode ?? 'legacy',
      actionEngine: input.actionEngine ?? 'structured_v1',
      modelProfile: input.modelProfile ?? 'adaptive_5_6',
      remoteVisualsAllowed: input.remoteVisualsAllowed,
      target: selected,
      targets,
      // The first frame is visible while the strategy is prepared, but the
      // session is deliberately inert. setStrategy atomically binds the
      // strategy, recreates the mission hash, and opens the appropriate
      // approval boundary. This prevents a fast approval from racing a slow
      // provider response and mutating a half-initialized session.
      pendingInitialContract: input.deferContract === true,
      status: input.deferStrategy === true || input.deferContract === true
        ? 'initializing'
        : requiresMissionPlanReview(input.supervision, autonomy) ? 'awaiting_plan_approval' : 'ready',
      actionCount: 0,
      maxActions: boundedSessionActions(input.maxActions),
      activeDurationMs: 0,
      maxDurationMinutes: Math.max(1, Math.min(liveBudgetPolicy.maxActiveDurationMinutes, input.maxDurationMinutes ?? 15)),
      startedAt: sessionStartedAt,
      updatedAt: sessionStartedAt,
      latestFrame: frameInfo(first),
      pendingAction: null,
      pendingApproval: null,
      pendingInputTransaction: null,
      contextTransfers: [],
      pendingContextTransfer: null,
      missionPlan,
      priorExchange: input.priorExchange ? structuredClone(input.priorExchange) : null,
      pendingGuidance: null,
      operationBindings: [],
      pendingOperationResolution: null,
      pendingBudgetGrant: null,
      guidanceLog: [],
      resultSummary: null,
      approvedObjectiveIds: [],
      tabWorkspace: { managedTabOpen: false, activeTab: 'original', windowId: null },
      ledger,
      activityEvents: [{
        id: id('live_activity'), phase: initialPhase,
        ...briefingCopy(initialActivity),
        startedAt: sessionStartedAt, endedAt: null,
        objectiveId: ledger.currentObjectiveId,
        actionId: null,
        visibility: 'overlay_safe',
      }],
      phaseStartedAt: sessionStartedAt,
      endedAt: null,
      activity: [initialActivity],
      blockedReason: null,
      terminalCategory: null,
    }
    this.frameDataUrl = first.dataUrl
    this.frameVisualSample = first.visualSample
    this.frameLocalizedVisualSample = first.localizedVisualSample ?? null
    this.frameElements = first.elements
    this.frameElementCaptureStatus = normalizedFrameElementCaptureStatus(first)
    this.frameElementMatchDiagnostics = structuredClone(first.elementMatchDiagnostics ?? null)
    this.pendingInputBaseline = null
    this.activeInteractionTransaction = null
    refreshLiveComputerExecutive(this.sessionValue.ledger, this.sessionValue.maxActions, this.sessionValue.actionCount)
    return this.snapshot()
  }

  /** A lookup occupies the controller lane but sends no physical input. */
  beginPublicLookup(query: string, objectiveId: string): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'ready' || !this.inputQuiescent() || this.inputHeld()
      || session.pendingAction || session.pendingInputTransaction || session.ledger.transitions.some(t => t.status === 'awaiting_verification')
      || activeLiveComputerObjective(session.ledger)?.id !== objectiveId
      || !availablePublicQueries(session.ledger).includes(query)) throw new Error('Public lookup is outside the current task scope or the input lane is busy')
    this.publicLookupObservationEpoch += 1
    session.ledger.publicLookups ??= []
    session.ledger.publicLookups.push({ id: id('public_lookup'), query, objectiveId, status: 'started' })
    session.status = 'acting'
    this.recordActivity(session, 'deciding', 'Looking up public information', query, 'in_app_only')
    return this.snapshot()
  }

  finishPublicLookup(sessionId: string, lookupId: string, result: PublicLookupEvidence | string): LiveComputerSession {
    const session = this.requireSession()
    if (session.id !== sessionId) throw new Error('The lookup session was superseded')
    const lookup = session.ledger.publicLookups?.find(candidate => candidate.id === lookupId)
    if (!lookup || lookup.status !== 'started') throw new Error('The lookup attempt is no longer pending')
    this.publicLookupObservationEpoch += 1
    if (typeof result === 'string') { lookup.status = 'failed'; lookup.failure = result.slice(0, 500) }
    else { lookup.status = 'completed'; lookup.evidence = structuredClone(result) }
    // A late response must never undo Stop, Pause, or an assistance hold.
    if (session.status === 'acting') session.status = 'ready'
    session.updatedAt = nowIso()
    return this.snapshot()
  }

  /** Records only time spent inside an approved execution turn. */
  recordActiveDuration(durationMs: number): LiveComputerSession | null {
    if (!this.sessionValue || !Number.isFinite(durationMs) || durationMs <= 0) return this.session()
    this.sessionValue.activeDurationMs = (this.sessionValue.activeDurationMs ?? 0) + Math.round(durationMs)
    this.sessionValue.updatedAt = nowIso()
    return this.snapshot()
  }

  /** Publish a phase before a potentially long operation begins. The desktop
   * shell observes `updatedAt`, so this reaches both the Work view and the
   * overlay while the operation is still running rather than after it ends. */
  announceActivity(
    phase: LiveComputerActivityPhase,
    headline: string,
    detail: string | null = null,
    visibility: 'overlay_safe' | 'in_app_only' = 'in_app_only',
  ): LiveComputerSession {
    const session = this.requireSession()
    if (terminal(session.status)) return this.snapshot()
    this.recordActivity(session, phase, headline, detail, visibility)
    return this.snapshot()
  }

  /** Bind global strategy after the first read-only frame but before any
   * proposal. That ordering lets the strategist reason about the actual
   * selected surface, while recreating the still-unapproved mission hash keeps
   * approve-plan review truthful. */
  /** Bind a complete contract to the input-free checkpoint without changing
   * its identity, window grants, usage or guidance history. */
  setInitialContract(ledger: LiveComputerTaskLedger, expectedSessionId: string): LiveComputerSession {
    const session = this.requireSession()
    if (session.id !== expectedSessionId || session.status !== 'initializing' || !session.pendingInitialContract
      || session.actionCount !== 0 || session.pendingAction || session.missionPlan.approvedAt) {
      throw new Error('The initial contract response belongs to a stopped or superseded checkpoint')
    }
    const validated = validateLiveComputerTaskLedger(structuredClone(ledger))
    if (!validated.strategy || !validated.outcomeContract) throw new Error('The initial result contract is incomplete')
    validateLiveComputerOutcomeContractAgainstLedger(validated.outcomeContract, validated)
    assignLiveComputerObjectiveSurfaces(validated, session.targets)
    recordLiveComputerSetup(validated, session.targets)
    satisfyMaterializedRoutePrefix(validated, session.targets)
    validated.interactionState.authority = 'input'
    validated.interactionState.activeWindowId = session.target.windowId
    validated.recovery.recoveryEpisodes += session.ledger.recovery.recoveryEpisodes
    validated.userDecisions = session.ledger.userDecisions ?? []
    session.ledger = validated
    session.pendingInitialContract = false
    session.missionPlan = createMissionPlan(session.goal, session.target, session.targets, validated, session.maxActions)
    return this.snapshot()
  }

  setStrategy(strategy: LiveComputerStrategyMemo, expectedSessionId?: string): LiveComputerSession {
    const session = this.requireSession()
    if (expectedSessionId && session.id !== expectedSessionId) throw new Error('The initial strategy response belongs to a superseded live session')
    if (!['initializing', 'awaiting_plan_approval', 'ready'].includes(session.status) || session.missionPlan.approvedAt) {
      throw new Error('The initial strategy can be bound only while the live session is initializing')
    }
    if (session.actionCount !== 0 || session.ledger.transitions.length > 0 || session.pendingAction) {
      throw new Error('A strategy can be bound only before the first computer action')
    }
    if (session.pendingInitialContract) throw new Error('A complete result contract is required before binding a strategy')
    validateLiveComputerOutcomeContractAgainstLedger(strategy.workProduct, session.ledger)
    session.ledger.outcomeContract = structuredClone(strategy.workProduct)
    initializeRequirementResolutions(session.ledger)
    session.ledger.strategy = structuredClone(strategy)
    session.missionPlan = createMissionPlan(session.goal, session.target, session.targets, session.ledger, session.maxActions)
    session.status = requiresMissionPlanReview(session.supervision, session.autonomy) ? 'awaiting_plan_approval' : 'ready'
    session.updatedAt = nowIso()
    this.note(session, session.status === 'awaiting_plan_approval'
      ? `Strategy prepared: ${strategy.summary} The bounded mission plan is ready for review; no input has been sent.`
      : `Strategy prepared: ${strategy.summary}`)
    return this.snapshot()
  }

  /** Convert a setup failure into a truthful terminal session. Once the first
   * frame has been published, callers must never leave the run planned with a
   * live overlay still awaiting input. */
  failInitialization(reason: string, category: Exclude<LiveComputerTerminalCategory, null> = 'planning_error'): LiveComputerSession {
    const session = this.requireSession()
    if (terminal(session.status)) return this.snapshot()
    if (session.status !== 'initializing') throw new Error('Only an initializing live session can fail during setup')
    session.ledger.disposition = 'handoff'
    session.ledger.recovery.cause = category === 'provider_error' ? 'provider_unavailable' : 'plan_invalid'
    session.ledger.recovery.disposition = 'handoff'
    return this.block(`Carve could not prepare this follow-up. No computer input was sent. ${reason}`.slice(0, 700), category)
  }

  /** Hold an input-free initialization defect as a resumable planning
   * checkpoint. Internal validator text stays in Audit; the person sees a
   * short recovery choice instead of a terminal invariant. */
  pauseInitializationForPlanning(cause: 'plan_invalid' | 'provider_unavailable' = 'plan_invalid'): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'initializing' || session.actionCount !== 0) throw new Error('Only input-free initialization can pause for planning repair')
    session.ledger.recovery.cause = cause
    session.ledger.recovery.disposition = 'replan'
    session.ledger.recovery.recoveryEpisodes += 1
    session.ledger.disposition = 'replan'
    session.pendingGuidance = { id: id('question'), channel: 'control',
      question: cause === 'provider_unavailable' ? 'Planning didn’t finish. Try again?' : 'Carve couldn’t work out a plan yet.',
      context: 'No computer input was sent. The selected window and approved authority remain unchanged.',
      displayContext: 'No clicks or typing have been sent. Try planning again, or take over from here.',
      options: [{
        id: 'retry_planning', label: 'Try planning again',
        consequence: 'Carve looks at this window again and tries planning the next step.', mode: 'agent_continues',
      }, {
        id: 'take_over', label: 'I’ll take it from here',
        consequence: 'Control returns to you; Carve sends no input.', mode: 'person_takes_over',
      }],
      askedAt: nowIso(),
    }
    session.status = 'awaiting_guidance'
    this.note(session, 'Planning needs a bounded repair. No input was sent and this checkpoint can resume.')
    return this.snapshot()
  }

  /** Recovery may invalidate an execution approach without changing the
   * person's approved outcome or authority. Keep that revised judgment in the
   * ledger, but never rewrite an already-approved mission hash: a strategy
   * revision can guide the next proposal, not grant new powers. */
  reviseStrategy(strategy: LiveComputerStrategyMemo, expectedSessionId?: string): LiveComputerSession {
    const session = this.requireSession()
    if (expectedSessionId && session.id !== expectedSessionId) throw new Error('The revised strategy response belongs to a superseded live session')
    if (session.status !== 'ready' || session.pendingAction || session.pendingApproval) {
      throw new Error('A live strategy can be revised only at a ready decision point')
    }
    const previousRevision = session.ledger.strategy?.revision ?? 0
    if (strategy.revision <= previousRevision) throw new Error('A revised live strategy must advance its revision number')
    const outcomeContract = session.ledger.outcomeContract
    session.ledger.strategy = structuredClone(outcomeContract
      ? { ...strategy, workProduct: outcomeContract }
      : strategy)
    session.updatedAt = nowIso()
    this.note(session, `Strategy revised after new evidence: ${strategy.summary}`)
    return this.snapshot()
  }

  /** Replace only the unverified suffix of the execution graph. The mission's
   * approved outcome, windows, effects, session ceiling, verified objectives,
   * facts, and artifacts remain immutable. */
  reviseObjectiveGraph(revision: LiveComputerObjectiveGraphRevision): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'ready' || session.pendingAction || session.pendingApproval) {
      throw new Error('The execution graph can be revised only at a ready decision point')
    }
    if (session.ledger.recovery.disposition !== 'replan') throw new Error('The execution graph can change only from an evidence-triggered replan state')
    if (session.ledger.recovery.graphReplans >= 2) throw new Error('The current no-progress epoch has exhausted its bounded graph revisions')
    const verified = session.ledger.objectives.filter((objective) => objective.status === 'verified')
    const superseded = session.ledger.objectives.filter((objective) => objective.status !== 'verified')
    if (verified.length + revision.objectives.length > (session.ledger.taskState ? liveComputerAdaptiveObjectiveCapacity : 16)) throw new Error('The revised execution graph exceeds the bounded objective limit')
    const currentShape = superseded.map((objective) => ({
      kind: objective.kind, instruction: objective.instruction, targetState: objective.targetState,
      clauseIds: objective.clauseIds, entityRefs: objective.entityRefs,
      ...(objective.producesRequirementIds ? { producesRequirementIds: objective.producesRequirementIds } : {}),
    }))
    if (stableJson(currentShape) === stableJson(revision.objectives)) throw new Error('The revised execution graph is materially identical to the failed graph')

    const previouslyAuthorizedCommits = new Set(session.ledger.objectives
      .filter((objective) => objective.kind === 'perform_commit')
      .flatMap((objective) => objective.clauseIds))
    const previouslyAuthorizedOutcomes = new Set(session.ledger.objectives
      .filter((objective) => objective.kind === 'perform_outcome')
      .flatMap((objective) => objective.clauseIds))
    for (const objective of revision.objectives.filter((candidate) => candidate.kind === 'perform_commit')) {
      if (!objective.clauseIds.some((clauseId) => previouslyAuthorizedCommits.has(clauseId))) {
        throw new Error('An execution-graph revision cannot add a new commit authority')
      }
    }
    for (const objective of revision.objectives.filter((candidate) => candidate.kind === 'perform_outcome')) {
      if (!objective.clauseIds.some((clauseId) => previouslyAuthorizedOutcomes.has(clauseId))) {
        throw new Error('An execution-graph revision cannot add a new state-changing outcome authority')
      }
    }

    const version = session.ledger.executionGraphVersion + 1
    const replacements: LiveComputerObjective[] = revision.objectives.map((objective, index) => {
      const previousId = index === 0 ? verified.at(-1)?.id ?? null : `objective_g${version}_${index}`
      return {
        id: `objective_g${version}_${index + 1}`,
        kind: objective.kind,
        instruction: objective.instruction.slice(0, 500),
        targetState: objective.targetState.slice(0, 500),
        status: index === 0 ? 'active' : 'pending',
        attempts: 0,
        actionBudget: objective.kind === 'perform_commit' ? liveBudgetPolicy.commitObjectiveActions : liveBudgetPolicy.objectiveActions,
        actionsUsed: 0,
        clauseIds: [...new Set(objective.clauseIds)],
        dependsOn: previousId ? [previousId] : [],
        entityRefs: [...new Set(objective.entityRefs)],
        ...(objective.producesRequirementIds ? { producesRequirementIds: [...objective.producesRequirementIds] } : {}),
      }
    })
    const candidate = structuredClone(session.ledger)
    candidate.objectives = [...verified, ...replacements]
    candidate.currentObjectiveId = replacements[0]?.id ?? null
    candidate.executionGraphVersion = version
    assignLiveComputerObjectiveSurfaces(candidate, session.targets)
    validateLiveComputerTaskLedger(candidate)

    session.ledger.objectives = candidate.objectives
    session.ledger.currentObjectiveId = candidate.currentObjectiveId
    session.ledger.coverage = candidate.coverage
    session.ledger.clauses = candidate.clauses
    session.ledger.executionGraphVersion = version
    session.ledger.executionGraphHistory.push({
      version,
      reason: revision.reason.slice(0, 500),
      atSequence: session.ledger.transitions.at(-1)?.sequence ?? 0,
      supersededObjectiveIds: superseded.map((objective) => objective.id),
      replacementObjectiveIds: replacements.map((objective) => objective.id),
    })
    session.ledger.executionGraphHistory = session.ledger.executionGraphHistory.slice(-8)
    session.ledger.recovery.graphReplans += 1
    session.ledger.recovery.disposition = 'replan'
    session.ledger.disposition = 'replan'
    this.note(session, `Execution graph revised (v${version}): ${revision.reason} Expected benefit: ${revision.expectedBenefit}`)
    refreshLiveComputerExecutive(session.ledger, session.maxActions, session.actionCount)
    return this.snapshot()
  }

  /** Deterministic event detection decides when the executive is worth a
   * model call. It never decides safety or performs input. */
  executiveTrigger(action?: LiveComputerAction | null): LiveComputerExecutiveTrigger | null {
    const session = this.requireSession()
    return liveComputerExecutiveTrigger(session.ledger, session.maxActions, session.actionCount, action, session.latestFrame?.sha256 ?? null)
  }

  /** Bind one bounded executive judgment to the task ledger. The captain may
   * steer tactics or request a checkpoint, but cannot widen authority or
   * manufacture a safety finding. */
  applyExecutiveDecision(trigger: LiveComputerExecutiveTrigger, decision: LiveComputerExecutiveDecision, reviewedAction?: LiveComputerAction | null): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'ready') throw new Error('An executive decision can be applied only at a ready decision point')
    if (decision.kind === 'ask_user') validateDecisionOptions(decision.instruction, decision.diagnosis, decision.options ?? [])
    applyLiveComputerExecutiveDecision(session.ledger, trigger, decision, reviewedAction)
    this.note(session, `Executive captain: ${decision.diagnosis} Next: ${decision.instruction}`)
    if (decision.kind === 'replan_objectives') {
      session.ledger.recovery.cause = 'plan_invalid'
      session.ledger.recovery.disposition = 'replan'
      session.ledger.recovery.failureSignature = `executive:${trigger.key}`
      session.ledger.disposition = 'replan'
    } else if (['repair_action', 'switch_tactic'].includes(decision.kind)
      && session.ledger.recovery.disposition === 'replan'
      && session.ledger.recovery.cause !== 'plan_invalid'
      && !['policy_violation', 'prompt_injection'].includes(session.ledger.recovery.cause ?? '')) {
      // A concrete repair already supplies the next tactic. Keep all failure
      // counts and authority gates, but do not pay a second strategist to
      // restate this instruction. Graph changes remain a separate decision.
      session.ledger.recovery.disposition = 'retry_same_objective'
      session.ledger.disposition = 'continue'
    } else if (decision.kind === 'finalize_artifact' && session.ledger.requirementStall
      && session.ledger.recovery.cause === 'plan_invalid'
      && ['extract_information', 'verify_outcome'].includes(activeLiveComputerObjective(session.ledger)?.kind ?? '')) {
      // Missing packaging is repaired by a normal conclude + verifier, not by
      // another strategy/graph generation. Keep the monotonic retry allowance:
      // the executive's opinion is neither progress nor completion evidence.
      session.ledger.recovery.disposition = 'continue'
      session.ledger.disposition = 'continue'
    } else if (decision.kind === 'request_budget') {
      return this.raiseBudgetCheckpoint(session, 'session', null)
    } else if (decision.kind === 'ask_user') {
      session.pendingGuidance = { id: id('question'), channel: 'task',
        question: decision.instruction,
        context: decision.diagnosis,
        options: structuredClone(decision.options ?? []),
        askedAt: nowIso(),
      }
      session.status = 'awaiting_guidance'
    } else if (decision.kind === 'stop_for_safety') {
      const cause = session.ledger.recovery.cause
      if (cause === 'policy_violation' || cause === 'prompt_injection') {
        return this.block(`The executive confirmed an existing controller safety boundary: ${decision.diagnosis}`, 'safety_block')
      }
      // Model introspection is not safety evidence. When the controller has no
      // typed boundary, preserve the concern as a person-visible fork.
      session.pendingGuidance = { id: id('question'), channel: 'control',
        question: 'Carve found a possible safety concern that the controller could not independently establish. How should it proceed?',
        context: `${decision.diagnosis} Carve will not treat model concern alone as proof of a policy boundary.`.slice(0, 500),
        options: [
          {
            id: 'inspect_again', label: 'Inspect again',
            consequence: 'Carve looks at this window again before choosing another action.', mode: 'agent_continues',
          },
          {
            id: 'take_over', label: 'I’ll take it from here',
            consequence: 'Control returns to you; Carve stops sending input.', mode: 'person_takes_over',
          },
        ],
        askedAt: nowIso(),
      }
      session.status = 'awaiting_guidance'
    }
    session.updatedAt = nowIso()
    return this.snapshot()
  }

  async refreshFrame(): Promise<LiveComputerSession> {
    const session = this.requireSession()
    if (terminal(session.status)) throw new Error('Live computer session has ended')
    const lookupEpoch = this.publicLookupObservationEpoch
    const frame = await this.backend.capture(session.target, `${session.id}-${session.actionCount + 1}-${Date.now()}`)
    if (this.sessionValue !== session || terminal(session.status)) throw new Error('The live observation was cancelled or superseded')
    this.applyFrame(session, frame)
    this.publicLookupObservedEpoch = lookupEpoch
    this.note(session, 'Read the current selected window.')
    return this.snapshot()
  }

  /**
   * Re-capture immediately before an OpenAI-computer proposal is allowed to
   * send input. Approval can take arbitrarily long; a frame-bound coordinate
   * never survives a material page change during that wait. This is local,
   * input-free, and consumes no action budget.
   */
  async refreshPendingProposalFrame(): Promise<{ session: LiveComputerSession; stale: boolean }> {
    const session = this.requireSession()
    const action = session.pendingAction
    if (!action || session.status !== 'awaiting_approval') throw new Error('No live action is awaiting a freshness check')
    if (action.proposalSource !== 'openai_computer') return { session: this.snapshot(), stale: false }
    const previousFrame = session.latestFrame
    const previousSample = this.frameVisualSample
    const previousLocalized = this.frameLocalizedVisualSample
    const frame = await this.backend.capture(session.target, `${session.id}-proposal-freshness-${action.id}-${Date.now()}`)
    const dimensionsChanged = !previousFrame || frame.width !== previousFrame.width || frame.height !== previousFrame.height
    const contentBoundsChanged = stableJson(previousFrame?.contentBounds ?? null) !== stableJson(frame.contentBounds ?? null)
    const sampleChanged = Boolean(previousSample && frame.visualSample && visiblyChanged(previousFrame?.sha256 ?? null, previousSample, frame))
    const conservativeHashChange = !previousSample || !frame.visualSample
      ? Boolean(previousFrame && previousFrame.sha256 !== frame.sha256)
      : false
    const proposalBindingChanged = action.proposalFrameSha256 !== previousFrame?.sha256
      || action.proposalFrameId !== previousFrame?.id
    const local = action.point && previousFrame && !dimensionsChanged
      ? regionChange(previousLocalized, frame.localizedVisualSample, { width: 96, height: 64 }, frame, action.targetBounds ?? pointRegion(action.point, frame))
      : null
    const visualChanged = local?.comparable ? local.changed : sampleChanged || conservativeHashChange
    const stale = dimensionsChanged || contentBoundsChanged || visualChanged || proposalBindingChanged
    this.applyFrame(session, frame)
    if (stale) {
      this.recoverPlanningFailure(liveComputerProposalRejection(
        'The selected window changed after the provider proposal. The stale action was discarded without sending input.',
        'grounding', { cause: 'target_moved', repair: 'fresh_observation' },
      ))
    }
    return { session: this.snapshot(), stale }
  }

  /** Re-observe an action whose semantic verifier may have judged a transient
   * frame. No input is sent and no action budget is consumed. When the window
   * materially changed while verification was running, bind the pending
   * transition to the newer frame so the next verdict cannot be rejected as
   * stale by applyVerification. */
  async refreshVerificationFrame(force = false): Promise<{ session: LiveComputerSession; materiallyChanged: boolean }> {
    const session = this.requireSession()
    if (session.status !== 'verifying') throw new Error('No live action is awaiting a freshness check')
    const transition = [...session.ledger.transitions].reverse().find((candidate) => candidate.status === 'awaiting_verification')
    if (!transition) throw new Error('The live action ledger has no transition awaiting a freshness check')
    const previousSha = session.latestFrame?.sha256 ?? null
    const previousSample = this.frameVisualSample
    const previousElements = this.frameElements.map(elementIdentity)
    const frame = await this.backend.capture(session.target, `${session.id}-verify-freshness-${transition.sequence}-${Date.now()}`)
    if (this.sessionValue !== session || session.status !== 'verifying') throw new Error('The verification continuation is no longer active')
    // A full-frame hash can change because of a caret, clock, animation, or
    // cursor. That is useful as a weak settling hint, but it is not strong
    // enough to invalidate an independent semantic verdict. Only supersede a
    // verifier when the bounded coarse visual samples prove material change.
    const materiallyChanged = Boolean(previousSample && frame.visualSample && visiblyChanged(previousSha, previousSample, frame))
    const semanticElementsChanged = stableJson(previousElements) !== stableJson(frame.elements.map(elementIdentity))
    if (force || materiallyChanged || semanticElementsChanged) {
      this.applyFrame(session, frame)
      transition.frameSha256 = frame.sha256
      this.note(session, 'The selected window changed while verification was running. Carve is re-checking the newer state before deciding that the action failed.')
    }
    return { session: this.snapshot(), materiallyChanged: materiallyChanged || semanticElementsChanged }
  }

  /** A nearly spent objective with no recent semantic progress is a planning
   * signal, not permission to stop. Raise a replan before the actor can spend
   * the final action and falsely describe the budget as exhausted. */
  requestBudgetAwareReplan(): LiveComputerSession {
    const session = this.requireSession()
    refreshLiveComputerExecutive(session.ledger, session.maxActions, session.actionCount)
    if (session.status !== 'ready') return this.snapshot()
    const active = activeLiveComputerObjective(session.ledger)
    if (!active || active.actionsUsed < Math.max(1, active.actionBudget - 1)) return this.snapshot()
    if (session.ledger.recovery.disposition === 'replan') return this.snapshot()
    const recentSemanticProgress = session.ledger.transitions.slice(-liveBudgetPolicy.progressWindowActions)
      .some((transition) => transition.objectiveId === active.id && transition.semanticProgress === true)
    if (recentSemanticProgress) return this.snapshot()
    const recovery = session.ledger.recovery
    recovery.cause = 'plan_invalid'
    recovery.disposition = 'replan'
    recovery.failureSignature = `budget_forecast:${active.id}:${active.actionsUsed}:${active.actionBudget}`
    session.ledger.disposition = 'replan'
    this.note(session, `Objective ${active.id} has ${active.actionBudget - active.actionsUsed} action remaining and no recent semantic progress. Carve is revising the execution graph before spending it.`)
    return this.snapshot()
  }

  /** Resolve adapter parameters before another model is asked for an action.
   * A missing external-effect target becomes one controller-owned decision
   * point, while resolved bindings are frozen into the ephemeral session and
   * survive objective-graph revisions. */
  prepareActiveOperation(): {
    session: LiveComputerSession
    feasibility: LiveComputerOperationFeasibility | null
    changedBindingIds: string[]
    requestedGuidance: boolean
  } {
    const session = this.requireSession()
    if (session.status !== 'ready') return { session: this.snapshot(), feasibility: null, changedBindingIds: [], requestedGuidance: false }
    const resolution = activeLiveComputerOperationResolution(session)
    if (!resolution) return { session: this.snapshot(), feasibility: null, changedBindingIds: [], requestedGuidance: false }

    const changedBindingIds: string[] = []
    const stored = [...(session.operationBindings ?? [])]
    for (const binding of resolution.feasibility.bindings.filter((candidate) => candidate.status === 'resolved')) {
      const index = stored.findIndex((candidate) => candidate.operationId === binding.operationId && candidate.parameterId === binding.parameterId)
      const existing = index >= 0 ? stored[index]! : null
      if (existing && existing.value === binding.value && existing.source === binding.source && existing.authorized === binding.authorized) continue
      if (index >= 0) stored.splice(index, 1, binding)
      else stored.push(binding)
      changedBindingIds.push(binding.id)
    }
    session.operationBindings = stored

    if (['needs_user', 'needs_contract_revision', 'unavailable'].includes(resolution.feasibility.status)) {
      const guidance = operationResolutionGuidance(resolution)
      session.pendingOperationResolution = structuredClone(resolution)
      session.pendingGuidance = { id: id('question'), ...guidance, askedAt: nowIso() }
      session.status = 'awaiting_guidance'
      session.terminalCategory = null
      session.blockedReason = null
      this.note(session, `Carve needs one concrete operation detail before continuing: ${guidance.question}`)
      return { session: this.snapshot(), feasibility: structuredClone(resolution.feasibility), changedBindingIds, requestedGuidance: true }
    }

    session.pendingOperationResolution = null
    if (changedBindingIds.length > 0) {
      session.updatedAt = nowIso()
      this.note(session, `Resolved ${changedBindingIds.length} operation ${changedBindingIds.length === 1 ? 'parameter' : 'parameters'} before planning the next action.`)
    }
    return { session: this.snapshot(), feasibility: structuredClone(resolution.feasibility), changedBindingIds, requestedGuidance: false }
  }

  /**
   * The human answer at a decision point. A chosen agent_continues option or
   * a free-text directive resumes the session with that direction quoted to
   * the model as the highest authority for the rest of the run; a
   * person_takes_over option converts to a structured handoff. Direction can
   * steer execution but never widens authority: every standing boundary —
   * window authority, routes, protected actions — still applies to whatever
   * it asks.
   */
  validateGuidanceAnswer(input: { questionId?: string | null; optionId?: string | null; directive?: string | null }): boolean {
    const session = this.requireSession()
    const accepted = input.questionId ? session.ledger.userDecisions?.find(entry => entry.questionId === input.questionId) : null
    if (accepted) {
      if (accepted.answerDigest !== decisionAnswerDigest(input)) throw new Error('That decision already has a different answer')
      return false
    }
    if (!session.pendingGuidance || session.status !== 'awaiting_guidance') throw new Error('No live decision point is awaiting your direction')
    if (input.questionId && input.questionId !== session.pendingGuidance.id) throw new Error('That question is no longer current')
    if (input.optionId && !session.pendingGuidance.options.some(option => option.id === input.optionId)) throw new Error('That option is not part of the current decision point')
    return true
  }

  provideGuidance(input: { questionId?: string | null; optionId?: string | null; directive?: string | null; approvalSurface?: 'main_app' | 'capsule' }, persist?: (session: LiveComputerSession) => void): LiveComputerSession {
    if (!this.validateGuidanceAnswer(input)) return this.snapshot()
    const before = structuredClone(this.requireSession())
    const baseline = this.pendingInputBaseline
    try {
      const result = this.applyGuidance(input)
      persist?.(result)
      return result
    } catch (error) {
      this.sessionValue = before
      this.pendingInputBaseline = baseline
      throw error
    }
  }

  private applyGuidance(input: { questionId?: string | null; optionId?: string | null; directive?: string | null; approvalSurface?: 'main_app' | 'capsule' }): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'awaiting_guidance' || !session.pendingGuidance) throw new Error('No live decision point is awaiting your direction')
    const guidance = session.pendingGuidance
    const option = input.optionId ? guidance.options.find((candidate) => candidate.id === input.optionId) : null
    if (input.optionId && !option) throw new Error('That option is not part of the current decision point')
    const directive = input.directive?.trim() ?? ''
    if (directive.length > 4000) throw new Error('Direction exceeds 4,000 characters; shorten it before submitting')
    if (!option && !directive) throw new Error('Choose an option or describe how Carve should proceed')
    const resource = session.pendingResourceBudget
    if (session.pendingBudgetGrant && option?.mode !== 'person_takes_over'
      && option?.id !== (session.pendingBudgetGrant.scope === 'time' ? 'grant_more_time' : 'grant_more_actions')) {
      throw new Error('Choose the displayed budget extension explicitly, or take over')
    }
    if (resource && option?.mode !== 'person_takes_over'
      && option?.id !== `grant_resources:${resource.id}`) {
      throw new Error('Choose the displayed budget extension explicitly, or take over; general direction does not approve more spending')
    }
    const operationResolution = session.pendingOperationResolution ?? null
    let operationLabel: string | null = null
    if (operationResolution && option?.mode !== 'person_takes_over') {
      let choice = input.optionId
        ? operationResolution.choices.find((candidate) => candidate.optionId === input.optionId) ?? null
        : null
      if (!choice && directive && operationResolution.feasibility.operationId === 'text_document.save_new') {
        const filename = operationResolution.feasibility.bindings.find((binding) => binding.parameterId === 'filename')?.value
          ?? extractRequestedTextFilename(session.goal)
        let candidate = directive
        if (isAbsolute(candidate) && existsSync(candidate) && statSync(candidate).isDirectory() && typeof filename === 'string') {
          candidate = join(candidate, filename)
        }
        const invalid = validateNewTextFilePath(candidate)
        if (invalid) throw new Error(`${invalid} Choose one of the suggested folders or provide an exact absolute path.`)
        choice = {
          optionId: `bind:operation_binding_${sha256(candidate).slice(0, 16)}`,
          operationId: operationResolution.feasibility.operationId,
          parameterId: 'destination_path',
          type: 'absolute_path',
          value: candidate,
          source: 'user_guidance',
          safeLabel: `Custom location ending in ${basename(candidate)}`,
          authorityImpact: 'external_effect',
        }
      }
      if (!choice) throw new Error('Choose one of the concrete operation targets or provide an exact valid target')
      const resolved = {
        id: choice.optionId.replace(/^bind:/u, ''),
        operationId: choice.operationId,
        parameterId: choice.parameterId,
        type: choice.type,
        status: 'resolved' as const,
        source: 'user_guidance' as const,
        value: choice.value,
        safeLabel: choice.safeLabel,
        authorized: true,
        authorityImpact: choice.authorityImpact,
        updatedAt: nowIso(),
      }
      session.operationBindings = [
        ...(session.operationBindings ?? []).filter((binding) => !(binding.operationId === resolved.operationId && binding.parameterId === resolved.parameterId)),
        resolved,
      ]
      operationLabel = resolved.safeLabel
    }
    const entry = {
      question: guidance.question,
      chosenOptionId: option?.id ?? null,
      chosenLabel: operationLabel ?? option?.label ?? null,
      // Operational values are represented by typed bindings. Do not also
      // leak a raw path/account/recipient into the generic model guidance log.
      directive: operationResolution ? null : directive || null,
      atAction: session.actionCount,
      providedAt: nowIso(),
    }
    const decision = acceptedDecision(session, guidance, entry, {
      ...input,
      channel: operationResolution ? 'operation' : session.pendingResourceBudget || session.pendingBudgetGrant ? 'budget'
        : session.pendingWindowRequest ? 'resource' : guidance.channel ?? 'task',
      consequence: operationResolution ? null : option?.consequence ?? null,
      operationId: operationResolution?.feasibility.operationId ?? null,
    })
    session.ledger.userDecisions = [...(session.ledger.userDecisions ?? []), decision]
    session.guidanceLog = session.ledger.userDecisions.slice(-8).map(({ question, chosenOptionId, chosenLabel, directive, atAction, providedAt }) => ({ question, chosenOptionId, chosenLabel, directive, atAction, providedAt }))
    session.pendingGuidance = null
    session.pendingOperationResolution = null
    const windowRequest = session.pendingWindowRequest ?? null
    if (windowRequest && option?.id.startsWith('grant_window:')) {
      const target = windowRequest.candidates.find((candidate) => `grant_window:${candidate.windowId}` === option.id)
      if (!target) throw new Error('That window is no longer available to grant')
      this.grantRequestedWindow(target, 'existing')
    } else if (windowRequest && option?.id !== 'fresh_window') {
      // A directive or a takeover answers the request without a window.
      session.pendingWindowRequest = null
    }
    if (option?.mode === 'person_takes_over') {
      this.resolveInteraction(session, 'cancelled', `Control returned to the user at the decision point: ${option.label}`)
      session.pendingBudgetGrant = null
      session.pendingResourceBudget = null
      session.ledger.disposition = 'handoff'
      session.status = 'handoff'
      session.terminalCategory = 'needs_user'
      session.blockedReason = `You chose: ${option.label}. ${option.consequence}`
      this.note(session, session.blockedReason)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    if (resource) {
      if (session.pendingInputTransaction?.phase === 'focus') this.pendingInputBaseline = null
      session.pendingResourceBudget = null
      session.status = resource.resumeStatus
      session.terminalCategory = null
      session.blockedReason = null
      this.note(session, 'You approved the displayed inference extension. Continuing from the preserved task phase.')
      return this.snapshot()
    }
    if (option?.id === 'inspect_again'
      && session.pendingInputTransaction
      && ['focus', 'reconcile', 'submit'].includes(session.pendingInputTransaction.phase)
      && session.pendingAction?.kind === 'type_into') {
      const phase = session.pendingInputTransaction.phase
      if (phase === 'focus') this.pendingInputBaseline = null
      session.status = 'awaiting_approval'
      session.terminalCategory = null
      session.blockedReason = null
      this.note(session, phase === 'focus'
        ? 'Retrying only the field-focus precondition from a fresh observation; no keyboard input has been sent.'
        : 'Inspecting the preserved input transaction again without focusing, replacing, or typing first.')
      return this.snapshot()
    }
    if ((option?.id === 'retry_planning' || session.pendingInitialContract && !resource) && session.actionCount === 0 && session.ledger.strategy === null) {
      session.status = 'initializing'
      session.terminalCategory = null
      session.blockedReason = null
      this.note(session, 'Retrying planning for the original request from a fresh observation; no input has been sent.')
      return this.snapshot()
    }
    // Apply the displayed action/time grant after an explicit selection.
    const grant = session.pendingBudgetGrant
    if (grant) {
      session.pendingBudgetGrant = null
      let newBudget = 0
      if (grant.scope === 'session') {
        session.maxActions = Math.min(liveBudgetPolicy.maxSessionActions, session.maxActions + grant.actions)
        newBudget = session.maxActions
      } else if (grant.scope === 'time') {
        session.maxDurationMinutes = Math.min(
          liveBudgetPolicy.maxActiveDurationMinutes,
          (session.maxDurationMinutes ?? 15) + (grant.durationMinutes ?? liveBudgetPolicy.durationExtensionMinutes),
        )
        newBudget = session.maxDurationMinutes
      } else {
        const objective = session.ledger.objectives.find((candidate) => candidate.id === grant.objectiveId)
        if (objective) {
          objective.actionBudget += grant.actions
          newBudget = objective.actionBudget
        }
      }
      this.emitRuntime({
        kind: 'budget_extended', sessionId: session.id, runId: session.runId,
        actionId: null, objectiveId: grant.objectiveId, phase: grant.scope,
        status: 'completed', delivery: null, textLength: null, textSha256: null,
        frameSha256: session.latestFrame?.sha256 ?? null, error: null,
        grantedActions: grant.actions, newBudget, trigger: 'user_grant',
      })
      this.note(session, grant.scope === 'time'
        ? `You granted ${grant.durationMinutes ?? liveBudgetPolicy.durationExtensionMinutes} more active minutes.`
        : `You granted ${grant.actions} more actions.`)
    }
    // More time/actions fund work; they do not establish progress or erase
    // failed tactics. Only a substantive user-directed retry starts a new
    // repair epoch here (inference grants preserve it in the branch above).
    if (!grant) resetRecovery(session, session.ledger.transitions.at(-1)?.sequence ?? 0)
    session.status = grant && session.pendingInputTransaction && session.pendingAction ? 'awaiting_approval' : 'ready'
    session.terminalCategory = null
    session.blockedReason = null
    this.note(session, operationResolution
      ? `You authorized: ${operationLabel ?? option?.label ?? 'the selected operation target'}.`
      : option
        ? `You chose: ${option.label}.${directive ? ` Direction: ${directive}` : ''}`
        : `Your direction: ${directive}`)
    return this.snapshot()
  }

  /** Adds a window to the authorized set while the mission plan awaits
   * approval. The plan is rebuilt so its hash covers the wider route; the
   * person's Start then approves exactly this set. Never after input ran. */
  addTarget(entry: LiveComputerSessionTarget): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'awaiting_plan_approval') throw new Error('Windows can be added only while the mission plan is awaiting your approval')
    if (session.targets.some((existing) => sameWindow(existing.target, entry.target))) throw new Error('That window is already part of this session')
    if (session.targets.length >= 4) throw new Error('A mission can use at most four windows')
    session.targets = [...session.targets, structuredClone(entry)]
    session.missionPlan = createMissionPlan(session.goal, session.target, session.targets, session.ledger, session.maxActions)
    session.updatedAt = nowIso()
    this.note(session, `Added ${entry.target.application} to the windows Carve may use; the plan now covers ${session.targets.length} windows and needs your approval again.`)
    return this.snapshot()
  }

  /** A window the model asked for and the person granted joins the mission
   * while it runs. The plan hash is not reopened: the person just made the
   * authority decision at the decision point, and the receipt records it. */
  grantRequestedWindow(target: LiveComputerTarget, source: 'existing' | 'fresh'): LiveComputerSession {
    const session = this.requireSession()
    const request = session.pendingWindowRequest
    if (!request) throw new Error('Carve has not asked for a window')
    if (session.targets.some((existing) => sameWindow(existing.target, target))) throw new Error('That window is already part of this session')
    if (session.targets.length >= 4) throw new Error('A mission can use at most four windows')
    // The window joins the mission where the model asked for it: a lookup
    // stage makes it the research surface for every objective up to the
    // first write; a write stage makes it the destination from there on.
    // Objectives already behind the active one keep their history.
    const objectives = session.ledger.objectives
    const active = activeLiveComputerObjective(session.ledger)
    const activeIndex = active ? objectives.findIndex((objective) => objective.id === active.id) : 0
    const firstWrite = objectives.findIndex((objective) => liveComputerDestinationObjectiveKind(objective.kind))
    const writeStage = active ? liveComputerDestinationObjectiveKind(active.kind) : false
    const role: LiveComputerSurfaceRole = writeStage ? 'destination' : 'research'
    if (role === 'destination') {
      session.targets = session.targets.map((entry) => entry.role === 'destination' ? { ...entry, role: 'workspace' } : entry)
    }
    session.targets = [...session.targets, {
      target: structuredClone(target), authority: 'input', source, role, purpose: request.reason,
    }]
    for (const [index, objective] of objectives.entries()) {
      if (index < Math.max(activeIndex, 0)) continue
      const belongs = role === 'research'
        ? firstWrite < 0 || index < firstWrite
        : firstWrite < 0 || index >= firstWrite
      if (!belongs) continue
      objective.surfaceWindowId = target.windowId
      objective.surfaceRole = role
    }
    // The receipt's plan shows the widened route; approval is not reopened
    // because the person just made this exact authority decision.
    const approvedAt = session.missionPlan.approvedAt
    session.missionPlan = createMissionPlan(session.goal, session.target, session.targets, session.ledger, session.maxActions)
    session.missionPlan.approvedAt = approvedAt
    session.pendingWindowRequest = null
    session.updatedAt = nowIso()
    this.note(session, source === 'fresh'
      ? `Opened a fresh ${target.application} window for Carve; it may work there for the rest of this task.`
      : `Allowed the ${target.application} window “${target.title.slice(0, 60)}”; Carve may work there for the rest of this task.`)
    return this.snapshot()
  }

  approvePlan(planHash: string): LiveComputerSession {
    const session = this.requireSession()
    if (!requiresMissionPlanReview(session.supervision, session.autonomy) || session.status !== 'awaiting_plan_approval') throw new Error('No live mission plan is awaiting approval')
    if (!planHash || planHash !== session.missionPlan.hash) throw new Error('The live mission plan changed; review the current plan before approving it')
    session.missionPlan.approvedAt = nowIso()
    if (session.supervision?.preset === 'smart_checkpoints') {
      const first = session.ledger.objectives.find((objective) => objective.status === 'pending' && objective.kind !== 'perform_commit')
      if (first) session.approvedObjectiveIds = [...new Set([...session.approvedObjectiveIds, first.id])]
    }
    session.status = 'ready'
    this.note(session, 'Mission plan approved. Carve will work continuously inside it and pause for deviations or protected actions.')
    return this.snapshot()
  }

  /** Pure proposal preflight used before any advisory critic or executive
   * call. It binds a model's semantic pointer intent to the strongest current
   * platform control, then runs the same deterministic checks used at commit.
   * No session state, budget, or approval state changes here. */
  preflightProposal(action: LiveComputerAction): LiveComputerAction {
    const session = this.requireSession()
    const candidate = this.resolveBrowserWindowRequest(structuredClone(action))
    // This field is minted below from session bindings. A hand-constructed or
    // provider-returned action can never carry its own operation authority.
    candidate.operationAuthorization = null
    candidate.targetObservationId = null
    candidate.targetIdentity = null
    candidate.submitTargetIdentity = null
    candidate.inputReceiver = null
    delete candidate.artifactBinding
    delete candidate.artifactDestination
    delete candidate.tablePayload
    // An actor sometimes repeats the verified payload beside its reference.
    // Discard only an exact redundant copy; never promote new cells or claims.
    if (candidate.kind === 'apply_artifact' && candidate.artifact) {
      const verified = session.ledger.artifacts.find(a => a.id === candidate.artifactId)
      if (verified && candidate.artifact.requirementId === verified.requirementId
        && artifactDataDigest(candidate.artifact) === artifactDataDigest(verified)) candidate.artifact = null
      else throw liveComputerProposalRejection('apply_artifact must reference an existing verified artifactId with artifact=null; new evidence belongs in conclude.', 'schema')
    }
    const objective = activeLiveComputerObjective(session.ledger)
    const terminator = candidate.key?.trim().toUpperCase() ?? null
    // The capability runtime needs a controller-minted payload capability
    // before it chooses between semantic and visual targeting. Legacy keeps
    // its historical validation order exactly, preserving rollback behavior.
    if (session.executionMode === 'capability_vm_v1' && candidate.kind === 'type_into' && objective
      && (liveComputerVisualQueryObjectiveCapability(session, objective).allowed
        || ((Boolean(terminator) || Boolean(candidate.submitPoint)) && liveComputerObjectiveSupportsFieldSubmit(objective.kind)))) {
      candidate.textProvenance = fieldEntryGroundingProvenance(session, objective, (candidate.text ?? '').trim(), candidate)
    }
    if (candidate.kind === 'type_into' && objective && liveComputerActionSurface(candidate) === 'browser_chrome'
      && liveComputerTargetSupportsTabs(session.target)) {
      candidate.textProvenance = fieldEntryGroundingProvenance(session, objective, (candidate.text ?? '').trim(), candidate)
    }
    if (candidate.targetingMode === 'visual') {
      if (!candidate.point) throw new LiveComputerActionError('plan_invalid', 'Visual targeting requires a point in the current selected-window observation')
      candidate.targetElementId = null
      candidate.groundingSource = 'provider_visual'
    }
    const prepared = this.bindSemanticTarget(candidate)
    if (prepared.kind === 'apply_artifact') {
      const artifact = session.ledger.artifacts.find(a => a.id === prepared.artifactId)
      if (artifact) prepared.artifactUnit = artifactPlacementText(artifact, prepared).unit
      prepared.artifactBinding = artifactActionBinding(session, prepared)
    }
    validateAction(prepared, session)
    this.releaseInputPolicy?.(prepared)
    prepared.operationAuthorization = operationAuthorizationForAction(prepared, session)
    this.validateElementBinding(prepared)
    this.validateBrowserNavigation(prepared, session)
    prepared.targetBounds = liveComputerTargetBounds(prepared, this.frameElements, session.latestFrame)
    prepared.targetObservationId = session.latestFrame?.id ?? null
    const targetElement = this.frameElements.find(element => element.id === prepared.targetElementId)
    prepared.targetIdentity = targetElement ? elementIdentityForInput(targetElement) : null
    const submitElement = this.frameElements.find(element => element.id === prepared.submitTargetElementId)
    prepared.submitTargetIdentity = submitElement ? elementIdentityForInput(submitElement) : null
    if (prepared.kind === 'type_into' && objective
      && (objective.kind === 'enter_query'
        || ((Boolean(terminator) || Boolean(prepared.submitPoint)) && liveComputerObjectiveSupportsFieldSubmit(objective.kind)))) {
      prepared.textProvenance ??= fieldEntryGroundingProvenance(session, objective, (prepared.text ?? '').trim(), prepared)
    }
    if (prepared.kind === 'type_into' && objective
      && !terminator && !prepared.submitPoint
      && ['perform_outcome', 'perform_commit'].includes(objective.kind)) {
      // A document write may contain either literal request text or a work
      // product composed from evidence. Stamp provenance only when the shared
      // grounding rule can prove the former here; otherwise preserve the
      // existing action path and require local evidence or an explicit
      // reconciliation decision after delivery.
      try {
        prepared.textProvenance ??= fieldEntryGroundingProvenance(session, objective, (prepared.text ?? '').trim(), prepared)
      } catch { /* no controller-minted provenance means no semantic acceptance path */ }
    }
    const replayKey = operationReplayKey(prepared, session.target.windowId)
    const unresolved = replayKey && session.ledger.transitions.find(t => t.replayKey === replayKey
      && t.effect?.state !== 'not_applied' && (t.status === 'unresolved' || t.effect?.state === 'unknown' || t.effect?.state === 'partial'))
    if (unresolved && !hasActionScopeAssessment(session, prepared, 'missing_artifact_cell')) throw new LiveComputerActionError('field_acceptance_unknown',
      `Operation ${unresolved.effect?.operationId ?? unresolved.actionId} may already have taken effect. Inspect its intended result before repeating this mutation; choose a different observation or repair only a proven missing portion.`)
    return prepared
  }

  /** Resolve the receiver before review so inference sees the executable
   * target, not a label/point that the binder might subsequently replace.
   * The provenance hint permits target resolution only; it is not a grant. */
  prepareActionScopeReview(action: LiveComputerAction, constraint: ActionScopeConstraint = 'lookup_only'): ActionScopeReview {
    const session = this.requireSession()
    clearActionScopeAssessment(session)
    assertActionScopeReviewEligible(session, action, constraint)
    const candidate = structuredClone(action)
    candidate.operationAuthorization = null
    candidate.textProvenance = { source: 'approved_goal', referenceIds: ['pending_semantic_action_scope'] }
    if (candidate.targetingMode === 'visual') {
      if (!candidate.point) throw new LiveComputerActionError('plan_invalid', 'Visual targeting requires a point in the current selected-window observation')
      candidate.targetElementId = null
      candidate.groundingSource = 'provider_visual'
    }
    const prepared = this.bindSemanticTarget(candidate)
    this.validateElementBinding(prepared)
    return { action: prepared, constraint, contextSha256: actionScopeContextKey(session) }
  }

  /** Bind an independent semantic review to the actual controller-resolved
   * receiver. This supplies payload provenance, never write/window authority. */
  bindReviewedAction(review: ActionScopeReview, assessment: ActionScopeAssessment): LiveComputerAction {
    const session = this.requireSession()
    clearActionScopeAssessment(session)
    const { action, constraint } = review
    if (actionScopeContextKey(session) !== review.contextSha256 || !session.latestFrame) {
      throw new LiveComputerActionError('target_moved', 'The receiver or authorized task changed after its scope review; observe and assess the current context.')
    }
    if (!actionScopeAccepted(assessment)) {
      throw new ActionScopeAssessmentDeclined(`Action scope needs resolution: ${assessment.evidence}. Choose an in-scope action or inspect the receiver; the original task remains active.`, assessment.decision === 'inspect' ? 'fresh_observation' : 'new_tactic')
    }
    const candidate = structuredClone(action)
    candidate.textProvenance = { source: 'approved_goal', referenceIds: ['semantic_action_scope'] }
    if (candidate.targetingMode === 'visual') {
      if (!candidate.point) throw new LiveComputerActionError('plan_invalid', 'Visual targeting requires a point in the current selected-window observation')
      candidate.targetElementId = null
      candidate.groundingSource = 'provider_visual'
    }
    const prepared = this.bindSemanticTarget(candidate)
    if (stableJson({ point: prepared.point, targetElementId: prepared.targetElementId ?? null })
      !== stableJson({ point: action.point, targetElementId: action.targetElementId ?? null })) {
      throw new LiveComputerActionError('target_moved', 'Resolve the executable receiver before reviewing its scope.')
    }
    bindActionScopeAssessment(session, prepared, assessment, session.latestFrame.sha256, constraint)
    try { return this.preflightProposal(prepared) }
    catch (error) { clearActionScopeAssessment(session); throw error }
  }

  /** A requested web product is a destination in the current browser. Compile
   * that intent to the existing atomic focus/type/readback/submit transaction
   * before approval, so it cannot be mistaken for a native window grant. */
  private resolveBrowserWindowRequest(action: LiveComputerAction): LiveComputerAction {
    const session = this.requireSession()
    if (action.kind === 'type_into' && liveComputerTargetSupportsTabs(session.target)
      && liveComputerActionSurface(action) === 'browser_chrome' && action.text
      && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/iu.test(action.text)) {
      // Preserve ordinary bare-domain proposals, but bind and review the
      // complete HTTPS address before any input or URL authorization.
      return { ...action, text: `https://${action.text}` }
    }
    if (action.kind !== 'request_window' || session.actionEngine !== 'structured_v1'
      || !liveComputerTargetSupportsTabs(session.target)) return action
    const objective = activeLiveComputerObjective(session.ledger)
    const destination = objective ? requestedBoundNavigationDestination(action.targetLabel ?? '',
      session.missionPlan.navigationBindings ?? [], session.ledger, objective) : null
    const resolvedDestination = destination ?? (session.ledger.navigationBindings === undefined
      ? (session.surfaceIntent?.version === 3 ? session.surfaceIntent.browserDestinations?.find(destination => destination.name.toLocaleLowerCase() === (action.targetLabel ?? '').trim().toLocaleLowerCase()) ?? null : requestedBrowserDestination(session.goal, action.targetLabel ?? '')) : null)
    if (!resolvedDestination) return action
    if (!objective || !liveComputerObjectiveSupportsFieldSubmit(objective.kind)) {
      throw new LiveComputerActionError('plan_invalid', `Opening ${resolvedDestination.name} needs a navigation objective before the document write.`)
    }
    const fields = this.frameElements.filter((element) => liveComputerElementSupportsTextEntry(element)
      && !element.sensitive && element.enabled !== false
      && /browser[-_ ]location|(?:address|location|url)(?: and search)? (?:bar|field)|omnibox/iu.test(`${element.identifier ?? ''} ${element.name}`)
      && element.bounds && element.bounds.y < 120)
    if (fields.length !== 1) {
      throw new LiveComputerActionError(fields.length ? 'control_ambiguous' : 'target_moved', `Locate the browser address field to open ${resolvedDestination.name} in this authorized window.`)
    }
    return {
      ...action, kind: 'type_into', surface: 'browser_chrome', operation: 'navigate', resourcePhase: 'launcher',
      route: 'browser_location', replanReason: action.replanReason ?? 'Continue to the web destination requested in the approved goal.',
      summary: `Open ${resolvedDestination.name} in the current browser`, targetLabel: fields[0]!.name,
      targetElementId: fields[0]!.id, targetWindowId: null, point: null,
      text: resolvedDestination.url, key: 'ENTER', replaceExisting: true, risk: 'read_only',
      expectedState: `${resolvedDestination.name} is visible at ${resolvedDestination.url}.`, completesObjective: false,
      handoffCause: null, question: null, guidanceContext: null, options: null,
    }
  }

  /** A stage boundary is scheduler work, not a visual-model judgment. When the
   * active objective belongs to another authorized surface, prepare the exact
   * switch locally before spending a screenshot or provider call. */
  prepareObjectiveWindowTransition(): LiveComputerSession | null {
    const session = this.requireSession()
    if (session.status !== 'ready') return null
    const objective = activeLiveComputerObjective(session.ledger)
    if (!objective?.surfaceWindowId || objective.surfaceWindowId === session.target.windowId) return null
    const destination = session.targets.find((entry) => entry.target.windowId === objective.surfaceWindowId)
    if (!destination) throw new Error('The active mission stage is bound to a window outside the authorized set')
    const action: LiveComputerAction = {
      id: id('live_action'),
      kind: 'switch_window',
      objectiveId: objective.id,
      route: `${surfaceRole(destination)} window: ${destination.target.application}`,
      surface: 'native_app',
      operation: 'switch_context',
      resourcePhase: objective.kind === 'perform_commit' || objective.kind === 'verify_outcome' ? 'destination' : 'transit',
      replanReason: null,
      summary: `Switch to ${destination.target.application} for ${surfacePurpose(destination).toLocaleLowerCase()}`,
      targetLabel: destination.target.title,
      targetWindowId: destination.target.windowId,
      expectedState: `${destination.target.application} is active and ready for the next mission stage.`,
      completesObjective: false,
      point: null,
      scrollY: null,
      scrollIntent: null,
      text: null,
      key: null,
      replaceExisting: false,
      confidence: 1,
      risk: 'read_only',
      requiresConfirmation: false,
      proposalSource: 'controller',
      groundingSource: 'not_applicable',
    }
    return this.setProposal(action, { kind: 'automatic', expiresAt: null })
  }

  /** Attach the durable policy checkpoint created by the application layer
   * to the otherwise ephemeral live-session projection. */
  bindContextTransferCheckpoint(transferId: string, checkpointId: string): LiveComputerSession {
    const session = this.requireSession()
    const transfer = session.contextTransfers.find((candidate) => candidate.id === transferId)
    if (!transfer || transfer.status !== 'pending_review' || session.pendingContextTransfer?.id !== transferId) {
      throw new Error('No matching context transfer is awaiting a durable checkpoint')
    }
    transfer.checkpointId = checkpointId
    session.pendingContextTransfer.checkpointId = checkpointId
    session.updatedAt = nowIso()
    return this.snapshot()
  }

  setProposal(action: LiveComputerAction, approval: LiveComputerApproval = { kind: 'immediate', expiresAt: null }): LiveComputerSession {
    if (this.publicLookupObservedEpoch !== this.publicLookupObservationEpoch) throw new Error('Refresh the selected window after the public lookup before proposing input')
    const session = this.requireSession()
    if (session.status !== 'ready') throw new Error('Live computer session is not ready for an action')
    if (this.activeInteractionTransaction && !liveComputerInteractionIsTerminal(this.activeInteractionTransaction)) {
      throw new Error(`The prior interaction is still ${this.activeInteractionTransaction.phase}; reconcile or cancel it before planning another action`)
    }
    action = this.preflightProposal(action)
    if (action.kind === 'wait') {
      const observationKey = this.observationKey(session, action.objectiveId, session.latestFrame?.sha256 ?? null, this.frameVisualSample)
      const repeated = [...session.ledger.transitions].reverse().find((transition) => transition.kind === 'wait'
        && transition.objectiveId === action.objectiveId
        && transition.observationKey === observationKey)
      if (repeated && repeated.status !== 'unresolved') {
        throw new Error('A no-input criterion check already inspected this objective and unchanged observation. Use its evidence to advance, replan, or hand off instead of waiting again.')
      }
    }
    // Native visual proposals already incorporate the fresh selected-window
    // evidence. They retain deterministic exact-repeat protection in the
    // coordinator, but a prior legacy executive opinion must not become a
    // second action compiler and veto a newly grounded provider action.
    if (action.proposalSource !== 'openai_computer') {
      const executiveTrigger = liveComputerExecutiveTrigger(session.ledger, session.maxActions, session.actionCount, action, session.latestFrame?.sha256 ?? null)
      const executiveDecision = session.ledger.executive.lastDecision
      if (executiveTrigger && session.ledger.executive.lastTriggerKey === executiveTrigger.key && executiveDecision) {
        // A steering rejection binds to the tactic the captain reviewed. The
        // trigger key describes the failure that raised the review, so every
        // proposal in that epoch shares it — including the one that follows
        // the captain's own repair (in a scroll trial the redirected
        // scroll was refused as "already rejected" and the run stalled out).
        const sameTactic = executiveDecision.rejectedTactic
          ? executiveDecision.rejectedTactic === liveComputerTacticSignature(session.ledger, action)
          : false
        if (sameTactic && ['repair_action', 'switch_tactic', 'replan_objectives'].includes(executiveDecision.kind)) {
          throw new Error(`The executive captain already rejected this tactic for the current evidence epoch: ${executiveDecision.instruction}`)
        }
        if (executiveDecision.kind === 'finalize_artifact' && action.kind !== 'conclude' && action.kind !== 'apply_artifact') {
          throw new Error(`The executive captain reserved the next decision for work-product finalization: ${executiveDecision.instruction}`)
        }
      }
    }
    validateApproval(approval)
    // Accepting a proposal is not evidence of progress: it can still fail at
    // the dispatch boundary. Preserve the repair epoch and its diagnostics
    // until verified progress or an explicit user-directed retry resets it.
    if (action.kind === 'request_window') {
      // The model may want a window it was never granted; it can never take
      // one. The controller turns the want into a decision point: grant a
      // visible window of that app, open a fresh one Carve owns, or stop.
      const application = (action.targetLabel ?? '').trim().slice(0, 80)
      const reason = action.summary.trim().slice(0, 240)
      const known = bundleForApplicationName(application, this.knownApplications)
      const candidates = this.knownTargets
        .filter((target) => target.application.toLowerCase() === application.toLowerCase()
          || (known !== null && target.bundleIdentifier === known.bundleIdentifier))
        .filter((target) => !neverOfferedSurface(target.bundleIdentifier))
        .filter((target) => !session.targets.some((entry) => sameWindow(entry.target, target)))
        .slice(0, 2)
      const bundleIdentifier = candidates[0]?.bundleIdentifier ?? known?.bundleIdentifier ?? null
      const canOpenFresh = bundleIdentifier !== null && !neverOfferedSurface(bundleIdentifier) && session.targets.length < 4
      if (candidates.length === 0 && !canOpenFresh) {
        throw new Error(`Carve cannot use ${application || 'that application'} for this task`)
      }
      // A fresh browser window needs one https address to exist at all; the
      // goal's own words pick it, otherwise a neutral search page.
      const isBrowser = bundleIdentifier !== null && browserBundles.some((entry) => entry.bundleIdentifier === bundleIdentifier)
      const url = isBrowser ? (freshSurfaceSuggestion(session.goal, [bundleIdentifier])?.url ?? 'https://www.google.com') : null
      const host = url ? new URL(url).hostname.replace(/^www\./u, '') : null
      session.actionCount += 1
      session.pendingWindowRequest = { application, bundleIdentifier, url, reason, candidates }
      const appLabel = known?.application ?? candidates[0]?.application ?? application
      session.pendingGuidance = { id: id('question'), channel: 'resource',
        question: `Carve needs ${appLabel} to continue. ${reason}`.slice(0, 300),
        context: 'A window joins this task only when you allow it here; it is written to the receipt either way.',
        options: [
          ...candidates.slice(0, 4 - (canOpenFresh ? 2 : 1)).map((target) => ({
            id: `grant_window:${target.windowId}`,
            label: `Use “${target.title.trim().slice(0, 40) || appLabel}”`.slice(0, 80),
            consequence: `Carve may work in that ${appLabel} window for the rest of this task.`.slice(0, 160),
            mode: 'agent_continues' as const,
          })),
          ...(canOpenFresh ? [{
            id: 'fresh_window',
            label: `Open a fresh ${appLabel} window`.slice(0, 80),
            consequence: (host
              ? `Opens at ${host} in a window of Carve's own; nothing of yours is in it, and it closes with the task.`
              : 'Carve opens a window of its own; nothing of yours is in it, and it closes with the task.').slice(0, 160),
            mode: 'agent_continues' as const,
          }] : []),
          { id: 'take_over', label: 'Not for this task', consequence: 'Control returns to you; Carve sends no more input.', mode: 'person_takes_over' as const },
        ],
        askedAt: nowIso(),
      }
      session.pendingAction = null
      session.pendingApproval = null
      session.status = 'awaiting_guidance'
      this.note(session, `Carve is asking for a window: ${session.pendingGuidance.question}`)
      return this.snapshot()
    }
    if (action.kind === 'ask_user') {
      // A decision point holds the session open, costs one planning action,
      // and sends no input. The person answers with a chip or a directive.
      session.actionCount += 1
      session.pendingGuidance = { id: id('question'),
        question: (action.question ?? '').trim().slice(0, 300),
        context: (action.guidanceContext ?? '').trim().slice(0, 500),
        options: (action.options ?? []).map((option) => ({
          id: option.id, label: option.label.trim().slice(0, 80),
          consequence: option.consequence.trim().slice(0, 160), mode: option.mode,
        })),
        askedAt: nowIso(),
      }
      session.pendingAction = null
      session.pendingApproval = null
      session.status = 'awaiting_guidance'
      this.note(session, `Carve is asking for your direction: ${session.pendingGuidance.question}`)
      return this.snapshot()
    }
    if (action.kind === 'done') {
      if (session.ledger.currentObjectiveId !== null || session.ledger.objectives.some((objective) => objective.status !== 'verified')) {
        throw new Error('The live outcome cannot be declared complete before every objective has criterion-level evidence')
      }
      if (liveComputerContractNeedsArtifact(session.ledger.outcomeContract)
        && !requirementsContentReady(session.ledger)) {
        throw new Error('The live outcome cannot be declared complete before a verified artifact satisfies the immutable outcome contract')
      }
      session.ledger.disposition = 'done'
      session.status = 'completed'
      session.pendingAction = null
      session.pendingApproval = null
      session.resultSummary = session.ledger.facts.at(-1) ?? (action.summary || 'The requested outcome is complete.')
      session.terminalCategory = null
      this.note(session, session.resultSummary)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    if (action.kind === 'handoff') {
      const cause = action.handoffCause!
      session.ledger.disposition = 'handoff'
      session.ledger.recovery.cause = cause === 'authentication_required'
        ? 'authentication_required'
        : cause === 'environment_lost' ? 'environment_lost' : 'policy_violation'
      session.ledger.recovery.disposition = 'handoff'
      session.status = 'handoff'
      session.pendingAction = null
      session.pendingApproval = null
      session.terminalCategory = 'needs_user'
      session.blockedReason = controllerHandoffMessage(cause, action.summary)
      this.note(session, session.blockedReason)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    const active = activeLiveComputerObjective(session.ledger)
    if (!active) throw new Error('No live objective is available for another action')
    const routeDecision = classifyLiveComputerRouteTransition(session.ledger, action, session.targets)
    if (routeDecision.classification === 'authority_change') {
      throw new Error('The proposed route transition changes the frozen authority envelope')
    }
    if (routeDecision.classification === 'unplanned_deviation' && action.proposalSource !== 'controller') {
      if (!action.replanReason) throw new Error('Changing the chosen navigation route requires an explicit replan reason')
      const routesSinceProgress = session.ledger.routeTransitions
        .filter((transition) => transition.sequence > session.ledger.recovery.lastProgressSequence)
        .map((transition) => transition.to)
      if (routesSinceProgress.includes(routeDecision.to)) throw new Error('The proposed route repeats a failed route without new criterion-level progress')
    }
    session.pendingAction = structuredClone(action)
    session.pendingApproval = structuredClone(approval)
    const transfer = action.kind === 'switch_window' ? contextTransferForWindowSwitch(session, action) : null
    if (transfer) {
      const automatic = session.supervision?.preset === 'autopilot'
      transfer.status = automatic ? 'automatic' : 'pending_review'
      transfer.approvedAt = automatic ? nowIso() : null
      session.contextTransfers.push(transfer)
      session.contextTransfers = session.contextTransfers.slice(-20)
      if (!automatic) {
        session.pendingContextTransfer = structuredClone(transfer)
        session.status = 'awaiting_context_transfer'
        this.note(session, `Ready to pass ${transfer.itemCount} verified ${transfer.itemCount === 1 ? 'item' : 'items'} from ${transfer.fromApplication} to ${transfer.toApplication}. Review the exact context before Carve switches windows.`)
        return this.snapshot()
      }
      this.note(session, `Passed ${transfer.itemCount} verified ${transfer.itemCount === 1 ? 'item' : 'items'} to ${transfer.toApplication} automatically under Autopilot.`)
    }
    session.status = 'awaiting_approval'
    this.note(session, `Ready for your approval: ${action.summary}`)
    return this.snapshot()
  }

  decideContextTransfer(transferId: string, decision: 'approve' | 'decline'): LiveComputerSession {
    const session = this.requireSession()
    const pending = session.pendingContextTransfer
    if (session.status !== 'awaiting_context_transfer' || !pending || pending.id !== transferId) {
      throw new Error('No matching context transfer is awaiting review')
    }
    const stored = session.contextTransfers.find((transfer) => transfer.id === transferId)
    if (!stored) throw new Error('The context transfer is no longer available')
    const decidedAt = nowIso()
    stored.status = decision === 'approve' ? 'approved' : 'declined'
    stored.approvedAt = decision === 'approve' ? decidedAt : null
    session.pendingContextTransfer = null
    session.updatedAt = decidedAt
    if (decision === 'approve') {
      session.status = 'awaiting_approval'
      // The person just reviewed exactly what will be placed and where. The
      // destination objective's own checkpoint would ask the same question
      // seconds later with no work in between (seen live), so
      // this approval covers it. Authority is unchanged: the destination
      // window was authorized at route review, and a commit objective's
      // reversible write still takes its immediate approval.
      const destinationObjectiveId = session.pendingAction?.objectiveId ?? null
      if (destinationObjectiveId && !session.approvedObjectiveIds.includes(destinationObjectiveId)) {
        session.approvedObjectiveIds = [...session.approvedObjectiveIds, destinationObjectiveId]
      }
      this.note(session, `You approved the verified context for ${stored.toApplication}. Carve can now switch to that window and continue the destination objective without a second checkpoint.`)
    } else {
      session.pendingAction = null
      session.pendingApproval = null
      session.status = 'paused'
      this.note(session, `You declined the context transfer to ${stored.toApplication}. The completed source work is preserved and no destination input was sent.`)
    }
    return this.snapshot()
  }

  async executePending(signal: AbortSignal): Promise<LiveComputerSession> {
    const session = this.requireSession()
    const action = session.pendingAction
    if (!action || session.status !== 'awaiting_approval') throw new Error('No approved live computer action is waiting')
    this.activePhysicalReceipt = null
    this.activePhysicalSubsteps = []
    this.activeContentDelivery = session.pendingInputTransaction?.actionId === action.id
      ? session.pendingInputTransaction.contentDelivery ?? 'none' : 'none'
    this.activeActionStartedAt = nowIso()
    signal.throwIfAborted()
    validateAction(action, session)
    this.releaseInputPolicy?.(action)
    const submittingLocation = action.kind === 'keypress'
      && ['ENTER', 'RETURN'].includes(action.key?.trim().toUpperCase() ?? '')
      && liveComputerTargetSupportsTabs(session.target)
      && (liveComputerActionSurface(action) === 'browser_chrome'
        || this.frameElements.some(element => element.focused === true && isBrowserLocationField(element)))
    if (submittingLocation) {
      if (signal.aborted) throw new Error('Live computer action was stopped')
      const frame = await this.backend.capture(session.target, `${session.id}-navigation-submit-${Date.now()}`)
      if (signal.aborted) throw new Error('Live computer action was stopped')
      this.applyFrame(session, frame)
    }
    this.validateBrowserNavigation(submittingLocation ? { ...action, surface: 'browser_chrome' } : action, session)
    // The action budget bounds input into the selected window. A `wait` or
    // `conclude` on the final verification objective injects nothing — it
    // exists so a fresh no-input criterion check can bind evidence of work
    // already done. A session that has proven its outcome must not be
    // discarded because the proof itself would exceed the input budget;
    // repeats stay bounded by the recovery machinery.
    const terminalVerification = (action.kind === 'wait' || action.kind === 'conclude')
      && activeLiveComputerObjective(session.ledger)?.kind === 'verify_outcome'
    const activeDurationLimitMs = (session.maxDurationMinutes ?? 15) * 60_000
    if ((session.activeDurationMs ?? 0) >= activeDurationLimitMs && !terminalVerification) {
      return this.raiseBudgetCheckpoint(session, 'time', null)
    }
    if (session.actionCount >= session.maxActions && !terminalVerification) {
      // The session ceiling was part of the approved plan, so it never grows
      // silently: the person decides whether the outcome is worth more.
      return this.raiseBudgetCheckpoint(session, 'session', null)
    }
    // One objective must not consume the session before the later parts of the
    // approved outcome are ever attempted. But exhaustion during verified
    // progress is pacing, not a runaway: the budget grows automatically while
    // the ledger shows fresh criterion-level progress, and only a stalled
    // objective interrupts the person.
    const activeObjective = activeLiveComputerObjective(session.ledger)
    if (activeObjective && activeObjective.actionsUsed >= activeObjective.actionBudget) {
      const latestSequence = session.ledger.transitions.at(-1)?.sequence ?? 0
      const progressing = session.ledger.transitions.at(-1)?.status !== 'unresolved'
        && session.ledger.recovery.stalledAttempts === 0
        && latestSequence - session.ledger.recovery.lastProgressSequence < liveBudgetPolicy.progressWindowActions
      if (!progressing || activeObjective.actionBudget >= liveBudgetPolicy.maxAutoObjectiveActions) {
        return this.raiseBudgetCheckpoint(session, 'objective', activeObjective)
      }
      const granted = Math.min(liveBudgetPolicy.objectiveExtensionActions, liveBudgetPolicy.maxAutoObjectiveActions - activeObjective.actionBudget)
      activeObjective.actionBudget += granted
      this.emitRuntime({
        kind: 'budget_extended', sessionId: session.id, runId: session.runId,
        actionId: action.id, objectiveId: activeObjective.id, phase: 'objective',
        status: 'completed', delivery: null, textLength: null, textSha256: null,
        frameSha256: session.latestFrame?.sha256 ?? null, error: null,
        grantedActions: granted, newBudget: activeObjective.actionBudget, trigger: 'automatic_progress',
      })
      this.note(session, `Objective ${activeObjective.id} is progressing, so its budget grew by ${granted} actions (now ${activeObjective.actionBudget}).`)
    }
    if (action.point && ['click', 'move', 'drag', 'element_action'].includes(action.kind)) {
      await this.refreshInputTarget(session, action, signal)
      this.validateElementBinding(action)
    }
    this.activePhysicalReceipt = null
    this.activePhysicalSubsteps = []
    this.activeActionStartedAt = nowIso()
    this.activeActionBeforeFrameSha256 = session.latestFrame?.sha256 ?? null
    this.activeActionBeforeVisualSample = this.frameVisualSample
    this.activeActionBeforeLocalizedSample = this.frameLocalizedVisualSample
    this.activeActionSideEffectScope = 'selected_window'
    this.beginInteraction(session, action)
    if (action.kind === 'switch_window') {
      const authorized = session.targets.find((entry) => entry.target.windowId === action.targetWindowId)
      if (!authorized) throw new Error('The proposed window is not in this session’s authorized set')
      this.commitActionToLedger(session, action)
      session.status = 'acting'
      this.note(session, `Switching to the authorized ${authorized.authority === 'observe' ? 'read-only ' : ''}window: ${authorized.target.application}.`)
      this.assertInputAdmission()
      this.physicalInputsInFlight++
      try { await this.backend.activate?.(authorized.target, signal) }
      finally { this.physicalInputsInFlight-- }
      session.target = structuredClone(authorized.target)
      this.activePhysicalReceipt = physicalActionReceipt(action, session.target, this.activeActionStartedAt ?? nowIso())
      this.recordInteractionDelivery(session)
      const switched = await this.backend.capture(session.target, `${session.id}-switch-${session.actionCount + 2}-${Date.now()}`)
      this.preActionElements = this.frameElements
      this.applyFrame(session, switched)
      this.observeInteraction(session)
      session.actionCount += 1
      session.pendingAction = null
      session.pendingApproval = null
      const transfer = [...session.contextTransfers].reverse().find((candidate) => candidate.actionId === action.id && ['approved', 'automatic'].includes(candidate.status))
      if (transfer) {
        transfer.status = 'consumed'
        transfer.consumedAt = nowIso()
      }
      this.recordTransition(session, action, switched)
      session.status = 'verifying'
      this.note(session, `Reading ${authorized.target.application}. A goal criterion still has to confirm this is the right window for the active objective.`)
      return this.snapshot()
    }

    const resumingInputReconciliation = ['type_into', 'apply_artifact'].includes(action.kind)
      && session.pendingInputTransaction?.actionId === action.id
    if (!resumingInputReconciliation) this.commitActionToLedger(session, action)
    session.status = 'acting'
    const beforeFrame = session.latestFrame
    const beforeVisualSample = this.frameVisualSample
    this.preActionElements = this.frameElements
    this.note(session, action.kind === 'wait'
      ? 'Waiting for the selected window to settle.'
      : action.kind === 'conclude'
        ? `Stating the composed result for verification: ${action.summary}`
        : `Executing the approved action: ${action.summary}`)
    if (action.kind === 'scroll' && (action.scrollIntent === 'bottom' || action.scrollIntent === 'top')) {
      session.status = 'verifying'
      this.note(session, `Treating “${action.scrollIntent}” as one bounded navigation objective; each wheel event gets a fresh saturation check.`)
      let previousFrame = beforeFrame
      let previousVisualSample = beforeVisualSample
      let frame: LiveComputerCapturedFrame | null = null
      let saturated = false
      let unchanged = 0
      let inputEvents = 0
      const maxInputEvents = 10
      while (inputEvents < maxInputEvents && !saturated) {
        if (signal.aborted) throw new Error('Live computer action was stopped')
        await this.executePhysical(session.target, action, signal)
        inputEvents += 1
        await delay(inputEvents === 1 ? 300 : 180, signal)
        frame = await this.backend.capture(session.target, `${session.id}-${session.actionCount + 2}-${inputEvents}-${Date.now()}`)
        const changed = visiblyChanged(previousFrame?.sha256 ?? null, previousVisualSample, frame)
        if (!changed) unchanged += 1
        else unchanged = 0
        // Two unchanged observations distinguish a true boundary from a wheel
        // event that was lost while the selected window received focus.
        saturated = unchanged >= 2
        previousFrame = frame
        previousVisualSample = frame.visualSample
      }
      if (!frame) throw new Error('Goal-directed scrolling produced no verification frame')
      this.recordInteractionDelivery(session)
      this.applyFrame(session, frame)
      this.observeInteraction(session)
      session.actionCount += 1
      session.pendingAction = null
      session.pendingApproval = null
      this.recordTransition(session, action, frame)
      session.status = 'verifying'
      this.note(session, saturated
        ? `The ${action.scrollIntent} navigation saturated after ${inputEvents} local scroll events. A goal criterion still has to verify the requested boundary.`
        : `Completed the bounded ${action.scrollIntent} segment after ${inputEvents} local scroll events. A goal criterion will inspect the terminal state.`)
      return this.snapshot()
    }
    // A click can have its whole effect OUTSIDE the selected window (a link
    // opening a new window); the bound frame then looks unchanged and a blind
    // retry would multiply the side effect. Snapshot the in-scope window set
    // so that outcome is detectable.
    const scopeBundles = new Set(session.targets.map((entry) => entry.target.bundleIdentifier))
    const scopeWindowsBefore = actionActivatesControl(action) ? await this.snapshotScopeWindows(scopeBundles) : null
    if (action.kind === 'wait') await delay(700, signal)
    else if (action.kind === 'conclude') { /* No input: the deliverable is judged against a fresh frame, never typed anywhere. */ }
    else if (action.kind === 'type_into') {
      const completed = await this.executeTypeInto(session, action, signal)
      if (!completed) {
        this.recordInteractionDelivery(session)
        this.observeInteraction(session)
        this.resolveInteraction(session, 'uncertain')
        return this.snapshot()
      }
    }
    else if (action.kind === 'enter_sequence') await this.executeEnterSequence(session, action, signal)
    else if (action.kind === 'apply_artifact') await this.executeArtifact(session, action, signal)
    else if (action.kind === 'new_tab' || action.kind === 'cycle_tab') await this.executePhysical(session.target, tabPhysicalAction(action), signal)
    else if (action.operationAuthorization) await this.executeApplicationOperation(session, action, signal)
    else await this.executePhysical(session.target, action, signal)
    if (signal.aborted) throw new Error('Live computer action was stopped')
    this.recordInteractionDelivery(session)
    session.status = 'verifying'
    this.note(session, 'Checking the visible result in a fresh frame.')
    if (action.kind !== 'wait') await delay(action.kind === 'scroll' ? 300 : 120, signal)
    let frame = await this.backend.capture(session.target, `${session.id}-${session.actionCount + 2}-${Date.now()}`)
    let changed = visiblyChanged(beforeFrame?.sha256 ?? null, beforeVisualSample, frame)
    if (action.kind === 'scroll' && !changed && liveComputerInteractionRetryPolicy(action) === 'observe_then_once') {
      this.note(session, 'No visible movement yet; retrying the same approved scroll after focus settled.')
      await delay(250, signal)
      await this.executePhysical(session.target, action, signal)
      await delay(350, signal)
      frame = await this.backend.capture(session.target, `${session.id}-${session.actionCount + 3}-${Date.now()}`)
      changed = visiblyChanged(beforeFrame?.sha256 ?? null, beforeVisualSample, frame)
    }
    if (actionActivatesControl(action)
      && action.risk === 'read_only'
      && liveComputerInteractionRetryPolicy(action) === 'observe_then_once'
      && !changed) {
      this.emitPointerCheckpoint(session, action, 'initial_click_result', frame, 'unchanged')
      const newScopeWindows = scopeWindowsBefore ? await this.detectNewScopeWindows(scopeBundles, scopeWindowsBefore) : []
      if (newScopeWindows.length > 0) {
        // Unchanged-in-frame is NOT no-effect: the click's result landed in a
        // window this session is not authorized to read or control. Never
        // blind-retry (each retry spawned another window) —
        // hold on a decision point instead.
        this.emitPointerCheckpoint(session, action, 'out_of_window_effect', frame, 'changed')
        this.activeActionSideEffectScope = 'out_of_scope'
        this.applyFrame(session, frame)
        this.observeInteraction(session)
        session.actionCount += 1
        session.pendingAction = null
        session.pendingApproval = null
        this.recordTransition(session, action, frame)
        this.resolveInteraction(session, 'failed', 'The effect appeared in a window outside the authorized interaction boundary')
        const transition = session.ledger.transitions.at(-1)
        if (transition) {
          transition.status = 'failed'
          transition.observedState = `The click left the selected window unchanged, but ${newScopeWindows.length} new ${session.target.application} window(s) appeared outside the session boundary.`
          transition.failureCause = 'environment_lost'
          transition.semanticProgress = false
          recordLiveComputerAttempt(session.ledger, transition)
          refreshLiveComputerExecutive(session.ledger, session.maxActions, session.actionCount)
        }
        session.pendingGuidance = { id: id('question'),
          question: 'The last click opened a new window outside this session’s boundary. How should Carve proceed?',
          context: `${newScopeWindows.length} new ${session.target.application} window(s) appeared while the selected window stayed unchanged. Carve reads and controls only the window you selected; it will not follow the click into the new one.`,
          options: [
            {
              id: 'retry_in_window',
              label: 'Reach it inside this window',
              consequence: 'Carve re-plans a different way to the target without repeating that click.',
              mode: 'agent_continues',
            },
            {
              id: 'take_over',
              label: 'I’ll use the new window myself',
              consequence: 'Control returns to you; Carve stops sending input.',
              mode: 'person_takes_over',
            },
          ],
          askedAt: nowIso(),
        }
        session.status = 'awaiting_guidance'
        this.note(session, `Carve is asking for your direction: the click's effect opened ${newScopeWindows.length} new window(s) outside the session boundary.`)
        return this.snapshot()
      }
      this.note(session, 'The read-only click produced no visible change; waiting briefly for navigation or focus to settle.')
      await delay(300, signal)
      frame = await this.backend.capture(session.target, `${session.id}-${session.actionCount + 3}-settle-${Date.now()}`)
      changed = visiblyChanged(beforeFrame?.sha256 ?? null, beforeVisualSample, frame)
      this.emitPointerCheckpoint(session, action, 'delayed_click_result', frame, changed ? 'changed' : 'unchanged')
      if (!changed) {
        this.note(session, 'The selected window is settled but unchanged; retrying the same bounded read-only click once.')
        await this.runPointerSubaction(session, action, 'retry_read_only_click', async () => {
          await this.executePhysical(session.target, action, signal)
        })
        await delay(450, signal)
        frame = await this.backend.capture(session.target, `${session.id}-${session.actionCount + 3}-retry-${Date.now()}`)
        changed = visiblyChanged(beforeFrame?.sha256 ?? null, beforeVisualSample, frame)
        this.emitPointerCheckpoint(session, action, 'retry_click_result', frame, changed ? 'changed' : 'unchanged')
      }
    }
    if (changed && actionMayNavigateOrMountUi(action) && frame.visualSample) {
      frame = await this.settleReversibleNavigation(session, action, frame, signal)
      changed = visiblyChanged(beforeFrame?.sha256 ?? null, beforeVisualSample, frame)
    }
    if (actionMayNavigateOrMountUi(action)) await this.checkNavigationOrigin(session, action, frame)
    this.applyFrame(session, frame)
    this.observeInteraction(session)
    session.actionCount += 1
    session.pendingAction = null
    session.pendingApproval = null
    this.recordTransition(session, action, frame)
    session.status = 'verifying'
    this.note(session, changed
      ? 'A fresh frame was captured. Carve is checking the expected outcome criterion.'
      : 'The frame was visually unchanged. Carve is checking whether that proves a boundary or means the action made no progress.')
    return this.snapshot()
  }

  /** A failed pre-commit adapter phase may be retried once only after a fresh
   * input-free observation proves that the application state changed. The
   * approved action and transaction id are reused; no provider call or whole
   * transaction replan occurs. Post-commit receipts can never enter here. */
  private async executeApplicationOperation(
    session: LiveComputerSession,
    action: LiveComputerAction,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.executePhysical(session.target, action, signal)
      return
    } catch (error) {
      if (!(error instanceof LiveComputerActionError)
        || error.operationTransaction?.failure?.retryEligibility !== 'safe_phase_retry'
        || error.operationTransaction.commit.attempted
        || error.operationTransaction.commit.effectMayHaveOccurred) throw error
      const failedFingerprint = error.operationTransaction.failure.fingerprint
      const priorFrameSha256 = session.latestFrame?.sha256 ?? null
      const observation = await this.backend.capture(session.target, `${session.id}-operation-retry-${action.id}-${Date.now()}`)
      if (observation.sha256 === priorFrameSha256) {
        throw new LiveComputerActionError(
          error.failureCause,
          `${error.message} The same pre-commit failure had no new application evidence, so Carve stopped instead of repeating it.`,
          undefined,
          error.operationTransaction,
        )
      }
      this.applyFrame(session, observation)
      this.emitRuntime({
        kind: 'operation_phase_retry', sessionId: session.id, runId: session.runId,
        actionId: action.id, objectiveId: action.objectiveId,
        phase: error.operationTransaction.failure.phase, status: 'started',
        delivery: null, textLength: null, textSha256: null, frameSha256: observation.sha256, error: null,
        operationId: error.operationTransaction.operationId,
        failureCode: error.operationTransaction.failure.code,
        failureFingerprint: error.operationTransaction.failure.fingerprint,
      })
      this.note(session, `The pre-commit ${error.operationTransaction.failure.phase.replaceAll('_', ' ')} state changed. Carve is retrying only that transaction under the same controller authorization.`)
      try {
        await this.executePhysical(session.target, action, signal)
      } catch (retryError) {
        if (retryError instanceof LiveComputerActionError
          && retryError.operationTransaction?.failure?.fingerprint === failedFingerprint) {
          throw new LiveComputerActionError(
            retryError.failureCause,
            `${retryError.message} The identical pre-commit failure repeated, so Carve stopped safely.`,
            undefined,
            retryError.operationTransaction,
          )
        }
        throw retryError
      }
    }
  }

  /**
   * A local, model-free judgment for routine mid-objective steps, derived from
   * the accessibility elements captured before and after the action.
   *
   * It is deliberately one-directional: it can only report that an action was
   * applied, never that semantic progress, a criterion, an objective, or a
   * goal is complete. Completion and progress still require criterion-bound
   * evidence; accessibility churn is execution telemetry only.
   *
   * Returns null whenever the step is consequential — a claimed objective
   * completion, a write, an active recovery, the final verification objective,
   * or a frame without accessibility data — so those still reach the verifier.
   */
  deterministicCriterion(): LiveComputerCriterionResult | null {
    const session = this.sessionValue
    if (!session || session.status !== 'verifying') return null
    const transition = [...session.ledger.transitions].reverse().find((candidate) => candidate.status === 'awaiting_verification')
    if (!transition) return null
    if (process.env.STEWARD_LIVE_EARLY_PROSE_VERIFY === '1' && shouldVerifyReadAnswerNow(session, transition)) return null
    const active = activeLiveComputerObjective(session.ledger)
    if (!active || active.id !== transition.objectiveId) return null
    if (active.kind === 'verify_outcome' || active.kind === 'extract_information' || active.kind === 'perform_commit') return null
    if (transition.completesObjective) return null
    if (transition.risk !== 'read_only' && transition.risk !== 'safe') return null
    if (session.ledger.recovery.stalledAttempts > 0) return null
    if (this.preActionElements.length === 0 || this.frameElements.length === 0) return null

    const before = new Set(this.preActionElements.map(elementIdentity))
    const after = new Set(this.frameElements.map(elementIdentity))
    const union = new Set([...before, ...after])
    if (union.size === 0) return null
    let changed = 0
    for (const key of union) {
      if (!before.has(key) || !after.has(key)) changed += 1
    }
    const ratio = changed / union.size
    if (ratio < liveVerificationPolicy.elementChangeRatio) return null
    return {
      criterionMet: false,
      objectiveComplete: false,
      goalComplete: false,
      observedState: `Local observation: ${changed} of ${union.size} accessibility elements changed after the ${transition.kind} on the selected window.`,
      progress: 'unchanged',
      confidence: liveVerificationPolicy.deterministicConfidence,
      actionApplied: true,
      failureCause: null,
      riskSignal: 'none',
      evidence: [`Element identities changed: ${Math.round(ratio * 100)}% of the observed control set`],
      resultSummary: null,
    }
  }

  /** Routine navigation is assessed with the next action decision. This
   * releases only the input lane: it creates no facts or completion claims. */
  continueAfterRoutineObservation(): LiveComputerSession | null {
    const session = this.sessionValue
    if (!session?.ledger.taskState || session.status !== 'verifying') return null
    const transition = session.ledger.transitions.at(-1)
    const active = activeLiveComputerObjective(session.ledger)
    if (transition && process.env.STEWARD_LIVE_EARLY_PROSE_VERIFY === '1' && shouldVerifyReadAnswerNow(session, transition)) return null
    if (!transition || transition.status !== 'awaiting_verification' || !active
      || transition.completesObjective || session.ledger.recovery.stalledAttempts > 0
      || ['extract_information', 'verify_outcome', 'perform_commit', 'perform_outcome'].includes(active.kind)
      || !['move', 'click', 'scroll', 'element_action'].includes(transition.kind)
      || !['read_only', 'safe'].includes(transition.risk)
      || transition.actionReceipt?.deliveryProgress !== 'complete'
      || transition.actionReceipt.sideEffectScope !== 'selected_window') return null
    transition.status = 'progressed'
    transition.progress = 'uncertain'
    transition.actionApplied = null
    transition.semanticProgress = false
    transition.observedState = 'Input was delivered; assess its actual effect in this fresh frame before choosing the next action.'
    transition.verifiedBy = 'local_observation'
    this.emitInteractionEvent('control_lane_released', session, 'completed')
    this.activeInteractionTransaction = null
    session.status = 'ready'
    this.note(session, 'Assessing this navigation result with the next action decision. Objective completion still requires evidence.')
    return this.snapshot()
  }

  applyVerification(result: LiveComputerCriterionResult, verifiedBy: LiveComputerTransition['verifiedBy'] = 'model_criterion'): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'verifying') throw new Error('No live action is awaiting criterion verification')
    validateCriterion(result)
    if (verifiedBy === 'local_observation' && (result.criterionMet || result.objectiveComplete || result.goalComplete)) {
      throw new Error('A local observation can report progress but can never establish criterion, objective, or goal completion')
    }
    const transition = [...session.ledger.transitions].reverse().find((candidate) => candidate.status === 'awaiting_verification')
    if (!transition) throw new Error('The live action ledger has no transition awaiting verification')
    if (session.latestFrame?.sha256 !== transition.frameSha256) throw new Error('The verification result is not bound to the latest selected-window frame')
    if (session.pendingInputTransaction?.actionId === transition.actionId) {
      session.pendingInputTransaction = null
      this.pendingInputBaseline = null
    }
    const active = activeLiveComputerObjective(session.ledger)
    if (active?.id !== transition.objectiveId) throw new Error('The verification result does not match the active objective')
    transition.observedState = result.observedState.trim().slice(0, 500)
    transition.verifiedBy = verifiedBy
    const reportedBlockingMismatch = result.blockingMismatch ?? (result.criterionMet ? 'none' : 'missing_evidence')
    const reportedPresentationMatch = result.presentationMatch ?? (result.criterionMet ? 'exact' : 'insufficient')
    const reportedSemanticCriterionMet = result.semanticCriterionMet ?? result.criterionMet
    const receiptAllowsSemanticAcceptance = transition.actionReceipt?.delivery !== 'rejected'
      && transition.actionReceipt?.sideEffectScope !== 'out_of_scope'
    const readOnlyRedirectEquivalent = verifiedBy === 'model_criterion'
      && liveComputerSameSiteRedirectEquivalent(session, active, transition, result)
    const expectedControllerEffect = verifiedEffectForCommand(transition.command ?? null)
    const controllerVerifiedEffect = expectedControllerEffect !== null
      && expectedControllerEffect === transition.actionReceipt?.verifiedEffect
      && transition.actionReceipt?.delivery === 'accepted'
      && transition.actionReceipt?.deliveryProgress === 'complete'
      && transition.actionReceipt?.sideEffectScope === 'selected_window'
      && !['wrong_resource', 'stale_observation', 'authority_violation', 'ambiguous_entity'].includes(reportedBlockingMismatch)
    const blockingMismatch = readOnlyRedirectEquivalent
      ? 'none'
      : controllerVerifiedEffect && reportedBlockingMismatch === 'missing_evidence'
      ? 'none'
      : reportedBlockingMismatch
    const presentationMatch = readOnlyRedirectEquivalent
      ? 'equivalent'
      : controllerVerifiedEffect && reportedPresentationMatch === 'insufficient'
      ? 'equivalent'
      : reportedPresentationMatch
    const semanticCriterionMet = reportedSemanticCriterionMet || controllerVerifiedEffect || readOnlyRedirectEquivalent
    const readOnlyEquivalent = verifiedBy === 'model_criterion'
      && semanticCriterionMet
      && presentationMatch !== 'insufficient'
      && result.stateTransitionRequired !== true
      && blockingMismatch === 'none'
      && receiptAllowsSemanticAcceptance
      && (transition.risk === 'read_only' || transition.risk === 'safe')
      && active !== null
      && !['perform_outcome', 'perform_commit'].includes(active.kind)
    const evidenceCurrent = !['stale_observation', 'ambiguous_entity', 'wrong_resource', 'authority_violation'].includes(blockingMismatch)
    const criterionMet = evidenceCurrent && (controllerVerifiedEffect || readOnlyRedirectEquivalent
      || (result.criterionMet || readOnlyEquivalent) && result.confidence >= liveVerificationPolicy.criterionConfidence)
    const progressAccepted = evidenceCurrent && verifiedBy === 'model_criterion'
      && (result.progress === 'advanced' || controllerVerifiedEffect)
      && result.confidence >= liveVerificationPolicy.progressConfidence
    const actionApplied = result.actionApplied ?? (criterionMet || progressAccepted)
    const safetyCause = result.failureCause === 'policy_violation' || result.failureCause === 'prompt_injection' ? result.failureCause : null
    const locallyApplied = verifiedBy === 'local_observation' && actionApplied
    const failureCause = criterionMet || progressAccepted || locallyApplied ? null : result.failureCause ?? inferCriterionFailureCause(result)
    // A successfully delivered mutation can have a real but deliberately
    // hidden effect (for example, a Save/Add operation whose result is shown
    // only after opening a separate view). An unchanged screenshot plus
    // missing evidence cannot prove that mutation did not apply. Preserve the
    // replay barrier and make the next action inspect the result instead of
    // repeating a potentially duplicated write.
    const hiddenWriteStillPossible = verifiedBy === 'model_criterion'
      && (active?.kind === 'perform_commit' || !['read_only', 'safe'].includes(transition.risk))
      && transition.actionReceipt?.delivery === 'accepted'
      && transition.actionReceipt.deliveryProgress === 'complete'
      && transition.actionReceipt.sideEffectScope === 'selected_window'
      && transition.actionReceipt.observedDelta === 'unchanged'
      && blockingMismatch === 'missing_evidence'
      && result.effectState === 'not_applied'
      && !safetyCause
      && result.riskSignal !== 'authority_violation'
    const assessedEffectState = hiddenWriteStillPossible ? 'unknown' : result.effectState
    const assessment = outcomeAssessment({ ...result, effectState: assessedEffectState,
      ...(readOnlyRedirectEquivalent || controllerVerifiedEffect ? { blockingMismatch, presentationMatch } : {}) }, criterionMet, progressAccepted || locallyApplied)
    transition.assessment = { state: assessment, observationId: session.latestFrame!.id,
      decisionDigest: decisionContext(session.ledger).digest,
      evidenceGap: assessment === 'unresolved' ? result.observedState.trim().slice(0, 500) : null }
    transition.status = assessment === 'unresolved' ? 'unresolved' : criterionMet ? 'verified' : progressAccepted || locallyApplied ? 'progressed' : 'failed'
    transition.progress = controllerVerifiedEffect ? 'advanced' : result.progress
    transition.failureCause = assessment === 'unresolved' ? null : failureCause
    transition.actionApplied = actionApplied
    transition.semanticCriterionMet = semanticCriterionMet
    transition.presentationMatch = presentationMatch
    transition.blockingMismatch = blockingMismatch
    transition.evidence = (result.evidence ?? []).slice(0, 5).map((value) => value.trim().slice(0, 240)).filter(Boolean)
    const effectTransition = result.effectOperationId
      ? [...session.ledger.transitions].reverse().find(candidate => candidate.effect?.operationId === result.effectOperationId
        && candidate.objectiveId === transition.objectiveId && candidate.actionReceipt?.targetWindowId === session.target.windowId)
      : transition
    if (effectTransition?.effect && verifiedBy === 'model_criterion') {
      // Only explicit, fresh evidence can release a possibly delivered write
      // for replay. A failed criterion alone says nothing about side effects.
      const reliable = result.confidence >= liveVerificationPolicy.criterionConfidence
        && !['wrong_resource', 'stale_observation', 'authority_violation', 'ambiguous_entity'].includes(blockingMismatch)
        && !safetyCause && result.riskSignal !== 'authority_violation'
      effectTransition.effect = {
        ...effectTransition.effect,
        state: reliable && assessedEffectState ? assessedEffectState
          : effectTransition === transition && criterionMet && receiptAllowsSemanticAcceptance ? 'applied' : effectTransition.effect.state === 'not_applied' ? 'not_applied' : 'unknown',
        persistence: reliable ? result.persistence ?? 'unknown' : 'unknown',
        observationId: session.latestFrame!.id,
        assessedBy: 'model_criterion',
      }
    }
    this.resolveInteraction(session, transition.status === 'unresolved' ? 'uncertain' : transition.status === 'failed' ? 'failed' : 'verified', transition.observedState)
    if (transition.status === 'unresolved' && this.activeInteractionTransaction) {
      if (transition.actionReceipt?.pressedInputsReleased !== true) {
        return this.block('The effect is unresolved and input release could not be confirmed. Carve stopped before another interaction.', 'environment_error')
      }
      // The physical delivery is over; uncertainty belongs to the durable
      // operation, not the input lane. Observation may now use that lane.
      this.emitInteractionEvent('control_lane_released', session, 'completed')
      this.activeInteractionTransaction = null
    }
    if (actionApplied) applyVerifiedTabTransition(session, transition)

    // The frame-bound verifier may already have supplied the complete prose
    // answer. Preserve that exact verified text instead of requiring another
    // actor/conclude/verifier cycle just to create its local artifact envelope.
    // This introduces no new completion verdict, input, or record-set synthesis.
    const answerContract = session.ledger.outcomeContract
    const verifiedAnswer = result.resultSummary?.trim() ?? ''
    if (process.env.STEWARD_LIVE_VERIFIED_ANSWER !== '0'
      && verifiedBy === 'model_criterion' && criterionMet && result.criterionMet
      && result.semanticCriterionMet === true && result.objectiveComplete && result.goalComplete
      && blockingMismatch === 'none' && presentationMatch !== 'insufficient'
      && result.confidence >= liveVerificationPolicy.criterionConfidence && result.stateTransitionRequired === false
      && result.riskSignal === 'none' && !result.failureCause && !safetyCause
      && result.evidence?.some(entry => entry.trim())
      && ['click', 'element_action', 'scroll', 'wait'].includes(transition.kind)
      && ['read_only', 'safe'].includes(transition.risk)
      && transition.actionReceipt?.delivery === 'accepted'
      && transition.actionReceipt.deliveryProgress === 'complete'
      && transition.actionReceipt.sideEffectScope === 'selected_window'
      && session.ledger.recovery.stalledAttempts === 0
      && !session.ledger.objectives.some(objective => ['perform_outcome', 'perform_commit'].includes(objective.kind))
      && answerContract?.deliverable.kind === 'prose'
      && (!answerContract.requirements || (answerContract.requirements.products.length === 1
        && answerContract.requirements.products[0]?.kind === 'prose'))
      && answerContract.deliverable.fields.length === 0 && answerContract.deliverable.minimumRecords <= 1
      && answerContract.effects.every(effect => effect.kind === 'open')
      && !transition.artifactDraft && !session.ledger.artifacts.some(artifact => artifact.coverage.complete)
      && verifiedAnswer && verifiedAnswer.length <= 2_000 && !looksSensitive(verifiedAnswer)) {
      const draft: LiveComputerArtifactDraft = {
        ...(answerContract.requirements ? { requirementId: answerContract.requirements.products[0]!.id } : {}),
        kind: 'prose', title: answerContract.deliverable.description.trim().replace(/\s+/gu, ' ').slice(0, 160) || 'Carve result',
        columns: [], rows: [], content: verifiedAnswer,
        provenance: ['Complete prose answer supplied by the frame-bound model verifier.'],
      }
      assertArtifactDraftValid(draft)
      transition.artifactDraft = draft
      this.note(session, 'Preserving the complete answer already supported by the verified evidence.')
    }

    const proposedArtifactCoverage = transition.artifactDraft
      ? liveComputerArtifactCoverage(transition.artifactDraft, session.ledger.outcomeContract, session.ledger)
      : null
    const finalProductReady = !liveComputerContractNeedsArtifact(session.ledger.outcomeContract)
      || (session.ledger.outcomeContract?.requirements ? requirementsContentReady({ ...session.ledger, artifacts: [...session.ledger.artifacts, ...(transition.artifactDraft && proposedArtifactCoverage?.complete ? [{ ...transition.artifactDraft, id: 'pending-verification', sourceObjectiveId: active?.id ?? '', verifiedAtSequence: transition.sequence, coverage: proposedArtifactCoverage }] : [])] }) : session.ledger.artifacts.some((artifact) => artifact.coverage.complete) || proposedArtifactCoverage?.complete === true)
    const controllerCompletesObjective = controllerVerifiedEffect
      && transition.actionReceipt?.verifiedEffect === 'text_document.saved_new_file'
      && active?.kind === 'perform_commit'
    const unmetAcquisition = active ? acquisitionRequirements(session.ledger, active.id, transition.artifactDraft) : []
    const acquisitionCaptured = unmetAcquisition.length === 0
    if (result.objectiveComplete && !acquisitionCaptured) this.note(session, `Unmet source obligations: ${JSON.stringify(unmetAcquisition)}. Preserve the required source product in this phase; do not repeat an already verified precondition.`)
    const objectiveComplete = (result.objectiveComplete || controllerCompletesObjective || readOnlyRedirectEquivalent)
      && acquisitionCaptured
      && (active?.kind !== 'verify_outcome' || finalProductReady)
    const previousSha = session.ledger.transitions.at(-2)?.frameSha256 ?? null
    const unchangedWait = transition.kind === 'wait'
      && transition.frameSha256 !== null
      && transition.frameSha256 === previousSha
      && !(criterionMet && objectiveComplete)
      && !result.goalComplete
    const workspaceMovementOnly = ['new_tab', 'cycle_tab', 'switch_window'].includes(transition.kind)
      && !criterionMet
      && !objectiveComplete
    const semanticProgress = ((criterionMet && !unchangedWait)
      || (progressAccepted && !unchangedWait && !workspaceMovementOnly))
      && !(result.objectiveComplete && !objectiveComplete)
    transition.semanticProgress = semanticProgress

    // Keep only evidence that actually moved an objective. Accessibility
    // churn and tab movement are execution telemetry, not reusable facts.
    if (semanticProgress && !safetyCause && result.riskSignal !== 'authority_violation'
      && (transition.kind !== 'conclude' || criterionMet && blockingMismatch === 'none' && receiptAllowsSemanticAcceptance)) {
      const fact = transition.kind === 'conclude' && transition.conclusion
        ? transition.conclusion
        : controllerVerifiedEffect
          ? verifiedEffectFact(transition.actionReceipt?.verifiedEffect ?? null)
          : transition.observedState
      session.ledger.facts = [...session.ledger.facts, fact].filter(Boolean).slice(-12)
    }

    if (result.riskSignal === 'authority_violation' || safetyCause) {
      transition.status = 'failed'
      transition.failureCause = safetyCause ?? 'policy_violation'
      transition.semanticProgress = false
      recordLiveComputerAttempt(session.ledger, transition)
      refreshLiveComputerExecutive(session.ledger, session.maxActions, session.actionCount)
      session.ledger.disposition = 'handoff'
      session.ledger.recovery.cause = transition.failureCause
      session.ledger.recovery.disposition = 'handoff'
      return this.block(`A real authority or safety boundary was detected. Expected “${transition.expectedState}”; observed “${transition.observedState}”.`, 'safety_block')
    }

    const priorAssessment = result.priorOperationAssessment
    if (priorAssessment && verifiedBy === 'model_criterion' && result.confidence >= liveVerificationPolicy.criterionConfidence
      && evidenceCurrent && !['wrong_resource', 'authority_violation'].includes(blockingMismatch)) {
      const prior = session.ledger.transitions.find(t => t.sequence < transition.sequence
        && t.status === 'unresolved' && (t.effect?.operationId ?? t.actionId) === priorAssessment.operationId
        && t.objectiveId === transition.objectiveId && t.actionReceipt?.targetWindowId === session.target.windowId
        && t.assessment?.decisionDigest === decisionContext(session.ledger).digest)
      if (prior && priorAssessment.state !== 'unresolved') {
        prior.assessment = { state: priorAssessment.state, observationId: session.latestFrame!.id,
          decisionDigest: decisionContext(session.ledger).digest, evidenceGap: null }
        prior.status = priorAssessment.state === 'supported' ? 'verified' : 'failed'
        prior.resolvedByActionId = transition.actionId
        if (priorAssessment.state === 'contradicted') {
          prior.failureCause = 'unknown'
          const recovery = session.ledger.recovery
          if (!recovery.activeEpisodeId) {
            recovery.activeEpisodeId = `${session.id}:recovery:${prior.actionId}`
            recovery.recoveryEpisodes += 1
          }
          prior.recoveryEpisodeId = recovery.activeEpisodeId
        }
        prior.observedState = priorAssessment.evidence
        prior.evidence = [priorAssessment.evidence]
        prior.semanticProgress = priorAssessment.state === 'supported'
        // Resolution establishes the postcondition, not transport history or
        // permission to repeat a non-idempotent effect.
        recordLiveComputerAttempt(session.ledger, prior)
        recordLiveComputerEvidence(session.ledger, { ...prior, frameSha256: session.latestFrame!.sha256 }, session.target.windowId, priorAssessment.state === 'supported')
      }
    }

    recordLiveComputerEvidence(session.ledger, transition, session.target.windowId,
      criterionMet && blockingMismatch === 'none' && receiptAllowsSemanticAcceptance)

    // Evidence checkpoints may complete one observation without completing a
    // broad research objective. Keep each verified partial artifact so later
    // observations can build on it without navigating back to old pages.
    if (criterionMet && blockingMismatch === 'none' && receiptAllowsSemanticAcceptance && active) {
      if (transition.artifactDraft) {
        const draft = transition.artifactDraft
        const artifactId = `artifact_${transition.sequence}`
        const provenance = [...new Set([...draft.provenance, ...(result.evidence ?? [])])].slice(0, 10)
        const coverage = proposedArtifactCoverage!
        session.ledger.artifacts = [
          ...session.ledger.artifacts,
          {
            id: artifactId,
            requirementId: draft.requirementId ?? coverage.requirementId ?? null,
            kind: draft.kind,
            title: draft.title,
            columns: [...draft.columns],
            rows: draft.rows.map((row) => [...row]),
            content: draft.content,
            sourceObjectiveId: active.id,
            provenance,
            verifiedAtSequence: transition.sequence,
            sourceScopeComplete: verifiedBy === 'model_criterion' && result.objectiveComplete === true && evidenceCurrent && !safetyCause,
            coverage,
          },
        ]
        const bound = bindVerifiedSourceRequirements(session.ledger, session.ledger.artifacts.at(-1)!,
          session.latestFrame!.id, verifiedBy === 'model_criterion' && result.objectiveComplete === true && evidenceCurrent && !safetyCause)
        refreshRequirementCoverage(session.ledger)
        for (const id of bound) {
          const resolution = session.ledger.requirementResolutions!.find(r => r.requirementId === id)!
          this.emitRuntime({ kind: resolution.status === 'resolved' ? 'requirement_resolved' : 'requirement_conflicted',
            sessionId: session.id, runId: session.runId, actionId: transition.actionId, objectiveId: active.id, phase: 'source_binding',
            status: resolution.status === 'resolved' ? 'completed' : 'uncertain', delivery: null, textLength: null, textSha256: null,
            frameSha256: session.latestFrame!.sha256, error: null,
            requirement: { id, revision: resolution.revision, status: resolution.status, artifactId: resolution.artifactId, sourceDigest: resolution.sourceDigest } })
        }
        if (bound.length) this.note(session, `Source requirements resolved from verified evidence: ${bound.join(', ')}.`)
        // Prompt context is a view over durable work, not the storage limit.
        // Legacy sessions keep their original representation for rollback.
        if (!session.ledger.taskState) session.ledger.artifacts = session.ledger.artifacts.slice(-8)
        const currentCoverage = session.ledger.artifacts.at(-1)!.coverage
        this.note(session, currentCoverage.complete
          ? `Verified final-ready work product: ${draft.title}.`
          : `Verified working artifact: ${draft.title}. Missing final coverage: ${artifactCoverageGap(currentCoverage)}.`)
      }
    }
    if (criterionMet && objectiveComplete && active) {
      active.status = 'verified'
      transition.satisfiedObjectiveIds = [active.id]
      for (const entityId of active.entityRefs) {
        const entity = session.ledger.entities.find((candidate) => candidate.id === entityId)
        if (entity) {
          entity.status = 'resolved'
          entity.resolvedLabel ??= transition.observedState.slice(0, 240)
        }
      }
      const additionallySatisfied = this.advanceAdditionalReadOnlyObjectives(session, active, transition, result)
      transition.satisfiedObjectiveIds.push(...additionallySatisfied)
      const next = session.ledger.objectives.find((objective) => objective.status === 'pending') ?? null
      if (next) next.status = 'active'
      session.ledger.currentObjectiveId = next?.id ?? null
    }

    // Task-level experience is append-only across objective advancement and
    // short-term recovery resets. Upserting here includes any artifact the
    // verifier just accepted, so coverage deltas describe real work product.
    recordLiveComputerAttempt(session.ledger, transition)
    refreshLiveComputerExecutive(session.ledger, session.maxActions, session.actionCount)

    const completeNonStateProduct = !liveComputerContractNeedsArtifact(session.ledger.outcomeContract)
      || (session.ledger.outcomeContract?.requirements ? requirementsContentReady(session.ledger) : session.ledger.artifacts.some((artifact) => artifact.coverage.complete))
    const pendingCommit = session.ledger.objectives.some(o => o.kind === 'perform_commit' && o.status !== 'verified')
    if (result.goalComplete && criterionMet && completeNonStateProduct && !pendingCommit) {
      for (const objective of session.ledger.objectives) {
        objective.status = 'verified'
      }
      session.ledger.currentObjectiveId = null
      session.ledger.noProgressCount = 0
      session.ledger.disposition = 'done'
      resetRecovery(session, transition.sequence)
      session.status = 'completed'
      session.terminalCategory = null
      session.resultSummary = (transition.kind === 'conclude' ? transition.conclusion?.trim() : null) || result.resultSummary?.trim() || transition.observedState
      this.note(session, `Outcome verified: ${transition.observedState}`)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    if (result.goalComplete && criterionMet && !completeNonStateProduct) {
      this.note(session, 'The verifier found the visible criterion, but the immutable outcome contract is still incomplete. Carve will continue from the verified working artifacts.')
    }

    // Favorable model verdicts cannot reset a controller-owned unmet obligation.
    // The signature excludes frame/action/objective IDs and artifact counts so
    // a replan, new screenshot or repeated prose artifact cannot buy more retries.
    if (criterionMet && result.objectiveComplete && (!acquisitionCaptured || result.goalComplete && !completeNonStateProduct)) {
      const key = sha256(stableJson({ products: unmetAcquisition.map(g => [g.requirementId, g.code, g.sourceEntityId]).sort(),
        finalProducts: result.goalComplete && !completeNonStateProduct ? unmetProductRequirements(session.ledger).map(p => p.requirementId).sort() : [] }))
      const previous = session.ledger.requirementStall
      const attempts = previous?.key === key ? previous.attempts + 1 : 1
      session.ledger.requirementStall = { key, attempts }
      session.ledger.recovery.cause = 'plan_invalid'
      session.ledger.recovery.stalledAttempts = attempts
      session.ledger.noProgressCount = attempts
      if (attempts >= 3) return this.block('The required evidence is still missing after capture and bounded repair. Carve preserved the verified work and stopped the repeated checks.', 'execution_limit')
      session.ledger.disposition = attempts >= 2 ? 'replan' : 'continue'
      session.ledger.recovery.disposition = session.ledger.disposition
      session.status = 'ready'
      return this.snapshot()
    }
    if (objectiveComplete && criterionMet) delete session.ledger.requirementStall

    if (criterionMet || progressAccepted || (verifiedBy === 'local_observation' && actionApplied)) {
      if (!semanticProgress && active?.kind !== 'verify_outcome') {
        const recovery = session.ledger.recovery
        const semanticSignature = sha256(stableJson({
          objectiveId: transition.objectiveId,
          routeKey: transition.routeKey,
          mechanism: transition.kind,
          activeWorkspace: session.tabWorkspace.activeTab,
          artifacts: session.ledger.artifacts.map((artifact) => ({
            kind: artifact.kind,
            fields: artifact.coverage.presentFields,
            items: artifact.coverage.itemCount,
            complete: artifact.coverage.complete,
          })),
        }))
        const repeatedSemanticState = recovery.strategiesTried.includes(`semantic:${semanticSignature}`)
        recovery.strategiesTried = [...new Set([...recovery.strategiesTried, `semantic:${semanticSignature}`])].slice(-8)
        recovery.failureSignature = `semantic_stall:${semanticSignature}`
        recovery.cause = 'plan_invalid'
        recovery.stalledAttempts += 1
        session.ledger.noProgressCount = recovery.stalledAttempts
        if (repeatedSemanticState || recovery.stalledAttempts >= 2) {
          recovery.disposition = 'replan'
          session.ledger.disposition = 'replan'
        }
        session.status = 'ready'
        this.note(session, `${transition.kind.replaceAll('_', ' ')} was applied but produced no semantic objective progress. Carve will preserve the evidence, avoid repeating this workspace state, and replan after another non-progress action.`)
        return this.snapshot()
      }
      resetRecovery(session, transition.sequence)
      session.status = 'ready'
      this.note(session, criterionMet
        ? `Objective evidence accepted: ${transition.observedState}`
        : `Verified semantic progress toward the active objective: ${transition.observedState}`)
      return this.snapshot()
    }

    if (transition.status === 'unresolved') {
      // Pending is not a contradiction, but repeated observations without
      // objective progress still consume the shared recovery allowance.
      // New action IDs, frame hashes and proposal wording cannot reset it.
      const recovery = session.ledger.recovery
      recovery.stalledAttempts += 1
      session.ledger.noProgressCount = recovery.stalledAttempts
      if (recovery.stalledAttempts >= 4) {
        recovery.disposition = 'handoff'
        session.ledger.disposition = 'handoff'
        return this.block('The outcome remains unresolved after bounded inspection and repair. Carve stopped without repeating an unverified effect.', 'execution_limit')
      }
      session.status = 'ready'
      session.ledger.disposition = recovery.stalledAttempts >= 2 ? 'replan' : 'continue'
      recovery.disposition = session.ledger.disposition
      this.note(session, transition.inputTransaction?.submission === 'withheld'
        ? 'Text entry did not reach submission. Inspect the recorded field evidence and repair the unmet precondition; do not repeat the complete entry or assume navigation is loading.'
        : 'Checking whether the change took effect. Choose a useful observation or a materially different repair; do not repeat an uncertain effect.')
      return this.snapshot()
    }
    return this.applyRecoverableFailure(session, transition, failureCause ?? 'unknown', transition.observedState)
  }

  failVerification(reason: string, category: Exclude<LiveComputerTerminalCategory, null> = 'planning_error'): LiveComputerSession {
    const session = this.requireSession()
    const transition = [...session.ledger.transitions].reverse().find((candidate) => candidate.status === 'awaiting_verification')
    if (transition) {
      transition.status = 'failed'
      transition.observedState = reason.slice(0, 500)
      transition.progress = 'uncertain'
      transition.actionApplied = null
      transition.failureCause = category === 'environment_error' ? 'environment_lost' : category === 'safety_block' ? 'policy_violation' : 'plan_invalid'
      transition.semanticProgress = false
      recordLiveComputerAttempt(session.ledger, transition)
      refreshLiveComputerExecutive(session.ledger, session.maxActions, session.actionCount)
    }
    session.ledger.disposition = 'handoff'
    session.ledger.recovery.cause = transition?.failureCause ?? (category === 'environment_error' ? 'environment_lost' : category === 'safety_block' ? 'policy_violation' : 'plan_invalid')
    session.ledger.recovery.disposition = 'handoff'
    return this.block(`The action could not be checked against its outcome criterion: ${reason}`, category)
  }

  failPlanning(reason: string): LiveComputerSession {
    const session = this.requireSession()
    session.ledger.disposition = 'handoff'
    session.ledger.recovery.cause = 'plan_invalid'
    session.ledger.recovery.disposition = 'handoff'
    return this.block(`Carve could not produce a valid next decision: ${reason}`, 'planning_error')
  }

  pauseForResourceBudget(checkpoint: Omit<NonNullable<LiveComputerSession['pendingResourceBudget']>, 'resumeStatus'>): LiveComputerSession {
    const session = this.requireSession()
    if (session.pendingResourceBudget || ['stopped', 'completed', 'blocked', 'handoff'].includes(session.status)) return this.snapshot()
    const resumeStatus = session.status === 'verifying' ? 'verifying'
      : session.pendingAction ? 'awaiting_approval'
        : session.actionCount === 0 && session.ledger.strategy === null ? 'initializing' : 'ready'
    session.pendingResourceBudget = { ...structuredClone(checkpoint), resumeStatus }
    const delta = checkpoint.delta
    session.pendingGuidance = { id: id('question'),
      question: 'Carve needs more room to finish. Keep going?',
      context: `The current task limit has been reached. Extra work: up to ${delta.modelCalls ?? 0} AI requests, ${(delta.totalTokens ?? 0).toLocaleString()} tokens of text processing, ${delta.visionFrames ?? 0} screen checks and ${delta.recoveryEpisodes ?? 0} retries. Carve keeps the work already done. Usage charges may apply through your AI service.`.slice(0, 500),
      options: [{ id: `grant_resources:${checkpoint.id}`, label: 'Give Carve more room',
        consequence: 'Allow the extra AI work listed above, for the same task and windows. Your permissions stay the same.', mode: 'agent_continues' },
      { id: 'take_over', label: 'I’ll take it from here', consequence: 'Stop here without allowing more AI work.', mode: 'person_takes_over' }],
      askedAt: nowIso(),
    }
    session.status = 'awaiting_guidance'
    session.terminalCategory = null
    session.blockedReason = null
    this.note(session, 'Inference budget reached. The task is paused for an explicit extension.')
    return this.snapshot()
  }

  failResourceBudget(reason: string): LiveComputerSession {
    const session = this.requireSession()
    session.ledger.disposition = 'handoff'
    session.ledger.recovery.cause = 'budget_exhausted'
    session.ledger.recovery.disposition = 'handoff'
    return this.block(`The approved Work Budget stopped additional planning or recovery: ${reason}`, 'execution_limit')
  }

  /** The semantic screen state: element identities, not pixels, so an
   * autoplaying page still has one state and a real page change has another. */
  private semanticStateHash(): string {
    return sha256(stableJson(this.frameElements.map(element => element.fingerprint ?? elementIdentity(element)).sort())).slice(0, 16)
  }

  /** A rejected proposal sent no input and therefore supplies feedback, not
   * task failure. A leaderboard run stopped after two schema
   * denials even though a different decomposition remained possible. One
   * bounded strategy revision now gets that evidence; a second failed episode
   * still ends so provider mistakes cannot loop indefinitely. */
  recoverPlanningFailure(reason: string | LiveComputerProposalRejection | LiveComputerProposalRejectionError, deniedProposals?: number): LiveComputerSession {
    const session = this.requireSession()
    const recovery = session.ledger.recovery
    const rejection = reason instanceof LiveComputerProposalRejectionError
      ? reason.rejection
      : typeof reason === 'string'
        ? liveComputerProposalRejection(reason, 'unknown', { proposalAttempts: deniedProposals ?? 1 }).rejection
        : structuredClone(reason)
    const actualDenials = Math.max(1, Math.floor(deniedProposals ?? rejection.proposalAttempts))
    if (rejection.repair !== 'fresh_observation' && !recovery.activeEpisodeId) {
      recovery.activeEpisodeId = `${session.id}:proposal:${session.actionCount}:${recovery.proposalDenials}`
      recovery.recoveryEpisodes += 1
    }
    recovery.proposalDenials += actualDenials
    recovery.lastPlanningFailure = rejection.reason
    recovery.lastProposalRejection = { ...rejection, proposalAttempts: actualDenials }
    recovery.proposalRejectionHistory = [
      ...(recovery.proposalRejectionHistory ?? []),
      recovery.lastProposalRejection,
    ].slice(-12)
    recovery.cause = rejection.cause
    recovery.failureSignature = `proposal:${rejection.stage}:${rejection.cause}:${normalizeEvidence(rejection.reason)}`
    const objectiveId = activeLiveComputerObjective(session.ledger)?.id ?? 'none'
    const evidenceKey = session.ledger.outcomeContract?.requirements ? `:${sha256(stableJson({ resolutions: session.ledger.requirementResolutions, artifact: rejection.diagnostics?.artifactId, target: session.target.windowId })).slice(0, 16)}` : ''
    const signature = `${objectiveId}:${rejection.stage}:${rejection.cause}:${this.semanticStateHash()}${evidenceKey}`
    recovery.signatureCounts = Object.fromEntries(Object.entries({ ...(recovery.signatureCounts ?? {}), [signature]: (recovery.signatureCounts?.[signature] ?? 0) + 1 }).slice(-32))
    recovery.lastSignature = signature
    if (rejection.cause === 'artifact_not_ready' && recovery.planningReplans < 1) {
      const unresolved = session.ledger.requirementResolutions?.find(r => r.status === 'unresolved')
      const product = session.ledger.outcomeContract?.requirements?.products.find(p => p.id === unresolved?.requirementId)
      const source = product?.sourceEntityId && session.ledger.objectives.find(o => o.kind === 'extract_information' && o.entityRefs.includes(product.sourceEntityId!))
      if (source) {
        const active = activeLiveComputerObjective(session.ledger)
        if (active && active !== source) active.status = 'pending'
        source.status = 'active'; session.ledger.currentObjectiveId = source.id
        recovery.planningReplans += 1; recovery.disposition = 'reground'; session.ledger.disposition = 'reground'
        session.pendingAction = null; session.pendingApproval = null; session.status = 'ready'
        this.note(session, 'Returning to the missing source evidence. The destination and requested result are preserved; no full-task strategy retry is needed.')
        return this.snapshot()
      }
    }
    if (rejection.cause === 'requirement_conflict') {
      session.pendingAction = null; session.pendingApproval = null
      session.status = 'awaiting_guidance'
      session.pendingGuidance = { id: id('question'), channel: 'control',
        question: 'The verified source conflicts with the requested result. Which source or requirement should change?',
        context: rejection.reason.slice(0, 500), options: [{ id: 'take_over', label: 'I’ll review it', consequence: 'Keep the captured data and destination; no further input is sent.', mode: 'person_takes_over' }], askedAt: nowIso() }
      this.note(session, 'Requirement conflict preserved. Another strategy call cannot change an explicit requirement or replay an uncertain write.')
      return this.snapshot()
    }
    if (recovery.planningReplans >= 1) {
      const needsObservation = rejection.repair === 'fresh_observation'
      recovery.disposition = needsObservation ? 'reground' : 'replan'
      session.ledger.disposition = recovery.disposition
      session.pendingAction = null
      session.pendingApproval = null
      session.pendingGuidance = { id: id('question'), channel: 'control',
        question: 'Couldn’t work out the next step',
        context: `No computer input was sent. ${rejection.stage.replaceAll('_', ' ')} validation reported: ${rejection.reason}`.slice(0, 500),
        displayContext: 'That step didn’t run. Carve is paused; earlier changes may remain. Try another approach, or take over from here.',
        options: [{
          id: needsObservation ? 'inspect_again' : 'retry_action_planning',
          label: needsObservation ? 'Recheck this control' : 'Try another approach',
          consequence: needsObservation
            ? 'Carve looks at this window again and retries this step.'
            : 'Carve looks at this window again and tries another way to follow your approved plan.',
          mode: 'agent_continues',
        }, { id: 'take_over', label: 'I’ll take it from here', consequence: 'Control returns to you; Carve stops sending input.', mode: 'person_takes_over' }],
        askedAt: nowIso(),
      }
      session.status = 'awaiting_guidance'
      session.terminalCategory = null
      session.blockedReason = null
      this.note(session, `Bounded ${rejection.stage.replaceAll('_', ' ')} repair is exhausted. The session is paused at a resumable input-free checkpoint.`)
      return this.snapshot()
    }
    recovery.planningReplans += 1
    // A stale target or surface needs a new observation, not a whole-task
    // strategy call. Mechanical defects have already exhausted their local
    // same-frame repair ladder, so they and semantic disagreements receive one
    // bounded tactic revision.
    const regroundOnly = rejection.repair === 'fresh_observation'
    recovery.disposition = regroundOnly ? 'reground' : 'replan'
    session.ledger.disposition = recovery.disposition
    session.pendingAction = null
    session.pendingApproval = null
    session.status = 'ready'
    session.terminalCategory = null
    session.blockedReason = null
    this.note(session, regroundOnly
      ? `The proposed action could not be grounded. Carve is taking a fresh observation before trying the current objective again: ${recovery.lastPlanningFailure}`
      : `The proposed action was rejected before input. Carve is revising its tactic from typed ${rejection.stage} feedback: ${recovery.lastPlanningFailure}`)
    return this.snapshot()
  }

  /** A proposal-time ambiguity is not evidence that the approved task failed.
   * Hold the same session on a resumable decision point. The default path is
   * still proactive: another input-free observation is offered first, while
   * free-form direction remains available when the distinction belongs to the
   * person. */
  pauseForPlanningGuidance(reason: string): LiveComputerSession {
    const session = this.requireSession()
    session.pendingAction = null
    session.pendingApproval = null
    session.ledger.recovery.cause = 'control_ambiguous'
    session.ledger.recovery.disposition = 'reground'
    session.ledger.recovery.lastPlanningFailure = reason.trim().slice(0, 500)
    session.ledger.disposition = 'reground'
    session.pendingGuidance = { id: id('question'), channel: 'control',
      question: 'Carve found more than one materially plausible control. How should it proceed?',
      context: `${session.ledger.recovery.lastPlanningFailure} Choose Inspect again for another input-free observation, or describe the intended control in your own words.`.slice(0, 500),
      options: [
        {
          id: 'inspect_again',
          label: 'Inspect again',
          consequence: 'Carve re-grounds the visible controls and continues only when one safe target is clear.',
          mode: 'agent_continues',
        },
        {
          id: 'take_over',
          label: 'I’ll take it from here',
          consequence: 'Control returns to you; Carve stops sending input.',
          mode: 'person_takes_over',
        },
      ],
      askedAt: nowIso(),
    }
    session.status = 'awaiting_guidance'
    session.terminalCategory = null
    session.blockedReason = null
    this.note(session, `Carve is asking for your direction: ${session.pendingGuidance.question}`)
    return this.snapshot()
  }

  failPlanningBoundary(reason: string, deniedProposals = 1): LiveComputerSession {
    const session = this.requireSession()
    session.ledger.recovery.proposalDenials += Math.max(1, Math.floor(deniedProposals))
    session.ledger.disposition = 'handoff'
    session.ledger.recovery.cause = 'policy_violation'
    session.ledger.recovery.disposition = 'handoff'
    session.ledger.recovery.lastPlanningFailure = reason.trim().slice(0, 500)
    return this.block(`Repeated proposed decisions crossed a standing authority or safety boundary: ${reason}`, 'safety_block')
  }

  /**
   * A provider outage occurs before a proposal exists, so it must not be
   * treated as evidence that the agent chose an invalid action. Keep the
   * selected-window session intact and require an explicit retry instead of
   * silently looping requests or sending any input.
   */
  pauseForProviderFailure(reason: string): LiveComputerSession {
    const session = this.requireSession()
    session.pendingAction = null
    session.pendingApproval = null
    session.ledger.disposition = 'retry_same_objective'
    session.ledger.recovery.cause = 'provider_unavailable'
    session.ledger.recovery.disposition = 'retry_same_objective'
    session.ledger.recovery.failureSignature = null
    session.ledger.recovery.repeatedFailureCount = 0
    session.status = 'paused'
    session.terminalCategory = 'provider_error'
    session.blockedReason = `The planning service was unavailable before Carve could propose the next action. No input was sent for this decision. ${reason}`.slice(0, 700)
    this.note(session, session.blockedReason)
    return this.snapshot()
  }

  async recoverExecutionFailure(reason: string, explicitCause?: LiveComputerFailureCause): Promise<LiveComputerSession> {
    const session = this.requireSession()
    const action = session.pendingAction
    const operationTransaction = this.activePhysicalReceipt?.operationTransaction ?? null
    const operationClassification = operationTransaction?.failure
      ? classifyApplicationOperationFailure(operationTransaction.failure, operationTransaction.commit)
      : null
    const cause = operationClassification?.failureCause ?? explicitCause ?? liveComputerFailureCause(reason)
    if (cause === 'policy_violation' || cause === 'prompt_injection') {
      session.ledger.disposition = 'handoff'
      return this.block(`A real authority or safety boundary prevented execution: ${reason}`, 'safety_block')
    }
    if (cause === 'environment_lost' || cause === 'authentication_required') {
      this.resolveInteraction(session, 'cancelled', reason)
      session.pendingAction = null
      session.pendingApproval = null
      session.ledger.disposition = 'handoff'
      session.status = 'handoff'
      session.terminalCategory = cause === 'environment_lost' ? 'environment_error' : 'needs_user'
      session.blockedReason = cause === 'environment_lost'
        ? `The selected environment is no longer controllable: ${reason}`
        : `This step needs user participation: ${reason}`
      this.note(session, session.blockedReason)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    if (cause === 'operation_postcondition_failed' || cause === 'operation_effect_uncertain') {
      this.resolveInteraction(session, cause === 'operation_effect_uncertain' ? 'uncertain' : 'failed', reason)
      session.pendingAction = null
      session.pendingApproval = null
      session.operationBindings = (session.operationBindings ?? []).map((binding) => binding.authorityImpact === 'external_effect'
        ? { ...binding, status: 'stale', authorized: false, updatedAt: nowIso() }
        : binding)
      session.ledger.disposition = 'handoff'
      session.ledger.recovery.cause = cause
      session.ledger.recovery.disposition = 'handoff'
      session.status = 'handoff'
      session.terminalCategory = 'environment_error'
      session.blockedReason = (cause === 'operation_effect_uncertain'
        ? `The application operation crossed its commit point, but the exact authorized effect could not be verified. Carve will not repeat the commit. ${reason}`
        : `The application operation failed its exact deterministic postcondition. Carve will not repeat the commit. ${reason}`).slice(0, 700)
      this.note(session, session.blockedReason)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    if (operationTransaction?.failure) {
      this.resolveInteraction(session, 'failed', reason)
      session.pendingAction = null
      session.pendingApproval = null
      if (operationClassification?.staleExternalBindings) {
        session.operationBindings = (session.operationBindings ?? []).map((binding) => binding.authorityImpact === 'external_effect'
          ? { ...binding, status: 'stale', authorized: false, updatedAt: nowIso() }
          : binding)
      }
      session.ledger.disposition = 'handoff'
      session.ledger.recovery.cause = cause
      session.ledger.recovery.disposition = 'handoff'
      session.status = 'handoff'
      session.terminalCategory = operationClassification?.terminalCategory ?? 'environment_error'
      session.blockedReason = `The ${operationTransaction.failure.phase.replaceAll('_', ' ')} phase failed before a commit could be proved safe. Deterministic recovery is exhausted; no further input was sent. ${reason}`.slice(0, 700)
      this.note(session, session.blockedReason)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    if (!action) return this.block(`Execution failed without a recoverable pending action: ${reason}`, 'environment_error')

    let frame: LiveComputerCapturedFrame
    try {
      frame = await this.backend.capture(session.target, `${session.id}-recovery-${session.actionCount + 2}-${Date.now()}`)
    } catch (captureError) {
      this.resolveInteraction(session, 'cancelled', `Recovery observation failed: ${String(captureError).slice(0, 300)}`)
      session.pendingAction = null
      session.pendingApproval = null
      session.ledger.disposition = 'handoff'
      session.status = 'handoff'
      session.terminalCategory = 'environment_error'
      session.blockedReason = `Execution and recovery observation both failed: ${String(captureError).slice(0, 500)}`
      this.note(session, session.blockedReason)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }
    this.applyFrame(session, frame)
    if (!this.activeInteractionTransaction && this.activePhysicalSubsteps.length === 0
      && this.activeContentDelivery === 'none' && ['target_moved', 'control_ambiguous', 'target_covered'].includes(cause)) {
      // A rejected precondition is still a proposal failure, even if it is
      // discovered immediately before delivery. Use the same bounded repair
      // epoch as compilation/freshness failures; never invent a delivered
      // action, but never allow input-free retries to evade the repair limit.
      return this.recoverPlanningFailure(liveComputerProposalRejection(
        reason, 'grounding', { cause, repair: cause === 'target_covered' ? 'new_tactic' : 'fresh_observation' },
      ))
    }
    this.observeInteraction(session)
    session.actionCount += 1
    session.pendingAction = null
    session.pendingApproval = null
    this.activePhysicalReceipt ??= {
      ...physicalActionReceipt(action, session.target, this.activeActionStartedAt ?? nowIso()),
      delivery: this.activeContentDelivery === 'none' ? 'rejected' : 'uncertain',
      deliveryProgress: this.activeContentDelivery === 'none' ? 'none' : 'partial',
      contentDelivery: this.activeContentDelivery,
    }
    this.recordTransition(session, action, frame)
    const transition = session.ledger.transitions.at(-1)!
    transition.status = 'failed'
    transition.observedState = reason.slice(0, 500)
    transition.failureCause = cause
    transition.progress = 'unchanged'
    transition.actionApplied = false
    transition.semanticProgress = false
    transition.evidence = []
    if (['type_into', 'apply_artifact', 'enter_sequence'].includes(action.kind) && this.activeContentDelivery !== 'none'
      || transition.actionReceipt?.deliveryProgress === 'partial' && transition.actionReceipt.pressedInputsReleased === true) {
      transition.status = 'awaiting_verification'
      transition.actionApplied = null
      session.status = 'verifying'
      this.note(session, 'Input may have partially applied. Inspecting its current effect before any further delivery.')
      return this.snapshot()
    }
    if (session.pendingInputTransaction?.actionId === action.id) {
      session.pendingInputTransaction = null
      this.pendingInputBaseline = null
    }
    this.resolveInteraction(session, 'failed', reason)
    recordLiveComputerAttempt(session.ledger, transition)
    refreshLiveComputerExecutive(session.ledger, session.maxActions, session.actionCount)
    return this.applyRecoverableFailure(session, transition, cause, transition.observedState)
  }

  approveObjective(objectiveId: string): LiveComputerSession {
    const session = this.requireSession()
    if (session.pendingAction?.objectiveId !== objectiveId || session.pendingApproval?.kind !== 'group') throw new Error('No live objective group is awaiting approval')
    session.approvedObjectiveIds = [...new Set([...session.approvedObjectiveIds, objectiveId])]
    this.note(session, `Approved the bounded objective group: ${objectiveId}`)
    return this.snapshot()
  }

  /** Reject a pixel-only proposal before input after the grounding channel has
   * degraded across several pointer decisions. This creates one bounded
   * reground episode instead of merely logging an alarm and continuing. */
  recoverGroundingChannel(reason: string): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'awaiting_approval' || !session.pendingAction?.point) throw new Error('No pointer proposal is available for grounding-channel recovery')
    session.ledger.recovery.cause = 'target_moved'
    session.ledger.recovery.disposition = 'reground'
    session.ledger.recovery.recoveryEpisodes += 1
    session.ledger.disposition = 'reground'
    this.note(session, `Grounding-channel recovery: ${reason.slice(0, 300)} This proposal remains under semantic verification; the next decision must prefer a positively grounded control or a non-pointer route.`)
    return this.snapshot()
  }

  pause(): LiveComputerSession {
    const session = this.requireSession()
    if (!terminal(session.status)) {
      this.assistanceInputHeld = true
      if (session.pendingContextTransfer) {
        const stored = session.contextTransfers.find((transfer) => transfer.id === session.pendingContextTransfer?.id)
        if (stored && stored.status === 'pending_review') stored.status = 'declined'
        session.pendingContextTransfer = null
      }
      session.status = 'paused'
      const interactionPending = Boolean(
        this.activeInteractionTransaction
        && !liveComputerInteractionIsTerminal(this.activeInteractionTransaction)
        && session.pendingAction?.id === this.activeInteractionTransaction.actionId,
      )
      // Preserve an in-flight action identity. Throwing it away here would
      // allow the planner to mint a second operation while delivery of the
      // first is still unknown. Resume returns to this exact transaction.
      if (!interactionPending) {
        session.pendingAction = null
        session.pendingApproval = null
      }
      this.note(session, interactionPending
        ? 'Paused with the current interaction preserved. No new operation or input will be proposed until this exact transaction is reconciled or cancelled.'
        : 'Paused. No input will be sent until you resume.')
    }
    return this.snapshot()
  }

  resume(): LiveComputerSession {
    const session = this.requireSession()
    if (session.status !== 'paused') throw new Error('Live computer session is not paused')
    if (!this.inputQuiescent()) throw new Error('Wait for the current input to return before resuming.')
    this.assistanceInputHeld = false
    const interactionPending = Boolean(
      this.activeInteractionTransaction
      && !liveComputerInteractionIsTerminal(this.activeInteractionTransaction)
      && session.pendingAction?.id === this.activeInteractionTransaction.actionId,
    )
    session.status = interactionPending
      ? 'awaiting_approval'
      : requiresMissionPlanReview(session.supervision, session.autonomy) && !session.missionPlan.approvedAt ? 'awaiting_plan_approval' : 'ready'
    session.terminalCategory = null
    session.blockedReason = null
    this.note(session, interactionPending
      ? 'Resumed at the preserved interaction. Carve will reconcile that exact transaction before any different operation can enter the control lane.'
      : session.status === 'awaiting_plan_approval'
      ? 'Resumed at the mission-plan review. No input will be sent before approval.'
      : 'Resumed. Carve will inspect before proposing another action.')
    return this.snapshot()
  }

  stop(reason = 'Stopped by user'): LiveComputerSession | null {
    this.assistanceInputHeld = true
    if (!this.sessionValue) return null
    if (!terminal(this.sessionValue.status)) {
      this.resolveInteraction(this.sessionValue, 'cancelled', reason)
      this.sessionValue.status = 'stopped'
      this.sessionValue.pendingAction = null
      this.sessionValue.pendingApproval = null
      this.sessionValue.pendingInputTransaction = null
      this.sessionValue.pendingContextTransfer = null
      this.pendingInputBaseline = null
      this.sessionValue.terminalCategory = null
      this.note(this.sessionValue, reason)
    }
    this.scheduleFrameCleanup(this.sessionValue)
    return this.snapshot()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.stop('Live computer session ended')
    this.frameDataUrl = null
    this.frameVisualSample = null
    this.frameLocalizedVisualSample = null
    this.frameElements = []
    this.frameElementCaptureStatus = 'unknown'
    this.frameElementMatchDiagnostics = null
    await this.backend.dispose?.()
  }

  /**
   * A proposal that names an element from the captured digest must actually
   * be grounded on it: the element has to exist in the latest frame, must not
   * be sensitive, and must contain the proposed point. This turns pixel
   * guessing into a checkable claim whenever Accessibility data is available.
   */
  private validateBrowserNavigation(action: LiveComputerAction, session: LiveComputerSession): void {
    if (!liveComputerTargetSupportsTabs(session.target)) return
    const objective = activeLiveComputerObjective(session.ledger)
    if (!objective) return
    const named = this.frameElements.find(element => element.id === action.targetElementId)
    const focusedLocation = this.frameElements.find(element => element.focused === true && isBrowserLocationField(element))
    const pointsAtLocation = action.groundingSource !== 'provider_visual' && action.point && this.frameElements.some(element => isBrowserLocationField(element)
      && element.bounds && pointInsideBounds(action.point!, element.bounds, 0))
    const activatesLocation = action.kind === 'enter_sequence' && action.sequence?.some(item => item.kind === 'activate'
      && isBrowserLocationField(resolveSequenceActivator(this.frameElements, item.value)))
    const atLocation = liveComputerActionSurface(action) === 'browser_chrome'
      || Boolean(named && isBrowserLocationField(named)) || Boolean(pointsAtLocation) || Boolean(activatesLocation)
      || Boolean(focusedLocation && (action.kind === 'keypress' || (action.kind === 'enter_sequence' && !action.point && !named)))
    if (!atLocation) return
    if (action.surface === 'web_page') throw new LiveComputerActionError('plan_invalid', 'The current target is browser chrome, not the declared page surface. Reground the intended control before input.')
    const grounded = (value: string) => fieldEntryGroundingProvenance(session, objective, value.trim(), { ...action, surface: 'browser_chrome' })
    if (action.kind === 'type_into') {
      if (!action.replaceExisting) throw new LiveComputerActionError('plan_invalid', 'Browser navigation must replace the address field so the approved text is the exact destination.')
      grounded(action.text ?? '')
    }
    if (action.kind === 'enter_sequence') {
      throw new LiveComputerActionError('plan_invalid', 'Use a single replacement field-entry transaction for browser navigation; mixed text and key sequences do not establish an exact destination.')
    }
    if (action.kind === 'keypress' && ['ENTER', 'RETURN'].includes(action.key?.trim().toUpperCase() ?? '')) {
      const receiver = named && isBrowserLocationField(named) && named.focused === true ? named : focusedLocation
      if (!receiver || receiver.sensitive || !receiver.value?.trim()) {
        throw new LiveComputerActionError('plan_invalid', 'Before submitting browser navigation, observe the focused address field and its exact current value; use a combined, verified field-entry transaction if focus is uncertain.')
      }
      grounded(receiver.value)
    }
  }

  private validateElementBinding(action: LiveComputerAction): void {
    if (action.submitTargetElementId) {
      if (action.kind !== 'type_into' || !action.submitPoint) throw new Error('Only a field-entry transaction may bind a submit control')
      const submit = this.frameElements.find((candidate) => candidate.id === action.submitTargetElementId)
      if (!submit) throw new Error('The proposed submit element is not present in the latest captured frame')
      if (submit.sensitive) throw new Error('Carve will not target a sensitive submit element during live computer use')
      if (submit.enabled === false) throw new Error('The proposed submit element is disabled in the latest captured frame')
      if (!submit.bounds || !pointInsideBounds(action.submitPoint, submit.bounds, 2)) {
        throw new Error('The proposed submit point lies outside the bounds of the named submit element')
      }
    }
    if (action.kind === 'enter_sequence') {
      for (const item of action.sequence ?? []) if (item.kind === 'activate') resolveSequenceActivator(this.frameElements, item.value)
    }
    if (!action.targetElementId) return
    if (!liveComputerActionMayBindElement(action.kind)) throw new Error('Only pointer actions and targeted field or element actions may bind a target element')
    const element = this.frameElements.find((candidate) => candidate.id === action.targetElementId)
    if (!element) throw new Error('The proposed target element is not present in the latest captured frame')
    if (element.sensitive) throw new Error('Carve will not target a sensitive element during live computer use')
    if (element.enabled === false) throw new Error('The proposed target element is disabled in the latest captured frame')
    if (action.kind === 'type_into' && !liveComputerElementSupportsTextEntry(element)) {
      throw new LiveComputerActionError('target_moved', 'The proposed target element is not an editable text control in the latest frame')
    }
    if (action.kind === 'element_action' && !elementSupportsElementAction(element, action.elementAction)) {
      throw new LiveComputerActionError(
        'control_ambiguous',
        `The proposed element does not expose the requested ${action.elementAction ?? 'unknown'} capability. Current capabilities: ${liveComputerElementCapabilities(element).join(', ') || 'none'}`,
      )
    }
    if (!element.bounds || !action.point) throw new Error('Element-grounded actions require element bounds and a target point')
    const tolerance = 2
    const inside = action.point.x >= element.bounds.x - tolerance
      && action.point.y >= element.bounds.y - tolerance
      && action.point.x <= element.bounds.x + element.bounds.width + tolerance
      && action.point.y <= element.bounds.y + element.bounds.height + tolerance
    if (!inside) {
      throw new Error(`The proposed point lies outside the bounds of the named target element ${element.role} “${element.name || element.identifier || element.id}”`)
    }
    // A grounded point proves where the model will click, not that the element
    // is the product or destination claimed in its prose. Browser tabs are a
    // particularly costly confusion surface, so require the observed label to
    // support any named product identity before input can be approved.
    const observed = `${element.name} ${element.identifier ?? ''} ${element.value ?? ''}`.toLocaleLowerCase()
    // Chrome exposes tabs as AXRadioButton; other browsers expose AXTab.
    // An address field stays a field even when the expected state mentions
    // navigating the current tab. Future state is not current identity.
    const tabLike = liveComputerTargetSupportsTabs(this.requireSession().target)
      && !liveComputerElementSupportsTextEntry(element)
      && /^(?:AX)?(?:Tab|RadioButton)$/iu.test(element.subrole ?? element.role)
      && element.bounds.y < 120
    if (tabLike) {
      const genericControlTerms = new Set(['tab', 'browser', 'current', 'existing', 'open', 'switch', 'select', 'click', 'page', 'window'])
      // A destination repeated independently in both route and summary is a
      // strong identity claim. Require the observed tab label to support it.
      // This catches any product/page confusion without a catalog of app
      // names. Target-label prose is excluded because it may merely echo the
      // misidentified observed label.
      const routeTerms = new Set(taskTerms(action.route).filter((term) => !genericControlTerms.has(term)))
      const claimedTerms = taskTerms(action.summary)
        .filter((term) => !genericControlTerms.has(term) && routeTerms.has(term))
      const observedTerms = new Set(taskTerms(observed))
      const observedSupports = (claim: string): boolean => [...observedTerms].some((term) => term === claim || term.startsWith(claim) || claim.startsWith(term))
      if (claimedTerms.length > 0 && claimedTerms.some((term) => !observedSupports(term))) {
        throw new LiveComputerActionError('control_ambiguous', `The proposed tab identity “${action.targetLabel}” is not supported by its observed label “${element.name || element.value || element.id}”. Use a positively identified destination or a Carve-managed new tab.`)
      }
    }
  }

  /** Accessibility/DOM controls are stronger than model coordinates. When a
   * point lands in one unique compatible control, bind it and derive the
   * physical point from that control. Text entry fails closed when semantic
   * capture is available but no editable target can be established. */
  private bindSemanticTarget(action: LiveComputerAction): LiveComputerAction {
    if (!liveComputerActionMayBindElement(action.kind)) return action
    // An activation-only sequence has no field to bind; each activator is
    // resolved by label against the latest frame instead.
    if (action.kind === 'enter_sequence' && !action.point && !action.targetElementId) return action
    // Either semantic or visual targeting is available for any approved
    // operation. An explicit visual target is never silently replaced by AX.
    if (action.groundingSource === 'provider_visual' && action.point && !action.targetElementId) return action
    // A valid frame-scoped semantic identity is stronger than an independently
    // guessed coordinate. Derive its center locally when the model supplied
    // the element but omitted the redundant point; the old ordering rejected
    // this safe, fully grounded proposal as a schema failure.
    const currentFrame = this.requireSession().latestFrame
    const visibleBounds = (element: LiveComputerElement) => element.bounds && currentFrame
      ? visibleElementBounds(element.bounds, currentFrame)
      : element.bounds
    if (action.targetElementId && !action.point) {
      const named = this.frameElements.find((element) => element.id === action.targetElementId)
      const bounds = named ? visibleBounds(named) : null
      if (!bounds) {
        throw new LiveComputerActionError('target_moved', 'The named target element has no visible bounds in the latest captured frame')
      }
      return {
        ...action,
        point: {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        },
      }
    }
    if (action.targetElementId) return action
    const compatibleElements = this.frameElements.filter((element) => visibleBounds(element)
      && !element.sensitive
      && element.enabled !== false
      && (action.kind === 'type_into'
        ? liveComputerElementSupportsTextEntry(element)
        : action.kind === 'element_action'
          ? elementSupportsElementAction(element, action.elementAction)
          : action.kind === 'click' || action.kind === 'move' || action.kind === 'drag'
            ? elementSupportsPointerAction(element)
            : element.focusable !== false))
    const targetTerms = discriminativeTargetTerms(action.targetLabel ?? null)
    const bind = (element: LiveComputerElement): LiveComputerAction => {
      const bounds = visibleBounds(element)
      if (!bounds) throw new LiveComputerActionError('target_moved', 'The selected semantic target is no longer visible in the latest captured frame')
      return {
        ...action,
        targetElementId: element.id,
        point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      }
    }
    const candidates = (elements: LiveComputerElement[]): string => elements.slice(0, 8).map((element) => {
      const label = element.name || element.placeholder || element.description || element.identifier || 'unlabelled'
      return `${element.id}:${element.role}:${label.slice(0, 60)}:[${liveComputerElementCapabilities(element).join(',') || 'pointer'}]`
    }).join('; ')

    // Semantic state wins over prose or a guessed point. A single focused
    // editable control is the generic equivalent of a person observing the
    // caret; a single compatible control is unambiguous even when it has no
    // text, placeholder, or application-specific identity.
    if (!action.point) {
      const focused = compatibleElements.filter((element) => element.focused === true)
      if (action.kind === 'type_into' && focused.length === 1) return bind(focused[0]!)
      if (compatibleElements.length === 1) {
        const only = compatibleElements[0]!
        const labelScore = elementTargetMatchScore(only, targetTerms)
        if (targetTerms.length === 0 || labelScore > 0 || !elementHasObservedIdentity(only)) return bind(only)
      }
      const labelled = compatibleElements
        .map((element) => ({ element, labelScore: elementTargetMatchScore(element, targetTerms) }))
        .sort((left, right) => right.labelScore - left.labelScore || elementArea(left.element) - elementArea(right.element))
      if (labelled[0] && labelled[0].labelScore > 0 && labelled[0].labelScore > (labelled[1]?.labelScore ?? 0)) return bind(labelled[0].element)
      if (compatibleElements.length > 1 && this.frameElementCaptureStatus === 'available') {
        throw new LiveComputerActionError(
          'control_ambiguous',
          `Choose one current semantic targetElementId instead of guessing a point. Compatible controls: ${candidates(compatibleElements)}`.slice(0, 500),
        )
      }
      return action
    }

    const containing = compatibleElements.filter((element) => pointInsideBounds(action.point!, element.bounds!))
    const scored = containing.map((element) => ({ element, labelScore: elementTargetMatchScore(element, targetTerms) }))
    scored.sort((left, right) => right.labelScore - left.labelScore || elementArea(left.element) - elementArea(right.element))
    // Coordinates may safely fall back to pixels for ordinary pointer work,
    // but type_into needs both geometry and semantic identity when the
    // platform exposes controls. This prevents a nearby field from becoming
    // the target merely because it overlaps a generous bounding box.
    let target = action.kind === 'type_into' && scored.length === 1
      ? scored[0]!.element
      : scored[0] && (targetTerms.length === 0 || scored[0].labelScore > 0)
        ? scored[0].element
        : null
    // Vision coordinates can land a few pixels outside a thin control. Snap
    // only when one compatible candidate is both close and materially closer
    // than the runner-up; arbitrary distant points never get redirected.
    if (!target && compatibleElements.length > 0) {
      const distance = (element: LiveComputerElement): number => {
        const bounds = element.bounds!
        const dx = Math.max(bounds.x - action.point!.x, 0, action.point!.x - (bounds.x + bounds.width))
        const dy = Math.max(bounds.y - action.point!.y, 0, action.point!.y - (bounds.y + bounds.height))
        return Math.hypot(dx, dy)
      }
      const nearest = compatibleElements
        .filter((element) => action.kind === 'type_into'
          || action.kind === 'element_action'
          || targetTerms.length === 0
          || elementTargetMatchScore(element, targetTerms) > 0
          || !elementHasObservedIdentity(element))
        .map((element) => ({ element, distance: distance(element) }))
        .sort((left, right) => left.distance - right.distance)
      const frame = this.requireSession().latestFrame
      const snapLimit = Math.max(18, Math.min(72, Math.min(
        frame?.width ?? this.requireSession().target.bounds.width,
        frame?.height ?? this.requireSession().target.bounds.height,
      ) * 0.06))
      if (nearest[0] && nearest[0].distance <= snapLimit && nearest[0].distance + 10 < (nearest[1]?.distance ?? Number.POSITIVE_INFINITY)) target = nearest[0].element
    }
    if (!target) {
      if ((action.kind === 'type_into' || action.kind === 'element_action') && this.frameElementCaptureStatus === 'available') {
        if (action.kind === 'type_into' && action.point) return { ...action, groundingSource: 'provider_visual' }
        throw new LiveComputerActionError(
          compatibleElements.length > 1 ? 'control_ambiguous' : 'target_moved',
          `The proposed point does not identify a compatible control. Choose a targetElementId from: ${candidates(compatibleElements) || 'no compatible controls were captured'}`.slice(0, 500),
        )
      }
      return action
    }
    return bind(target)
  }

  private applyRecoverableFailure(session: LiveComputerSession, transition: LiveComputerTransition, cause: LiveComputerFailureCause, observed: string): LiveComputerSession {
    const strategy = `${transition.routeKey}:${transition.kind}:${normalizeEvidence(transition.targetLabel ?? 'untargeted')}`
    const signature = failureSignature(transition, cause)
    const recovery = session.ledger.recovery
    if (!recovery.activeEpisodeId) {
      recovery.activeEpisodeId = `${session.id}:recovery:${transition.actionId}`
      recovery.recoveryEpisodes += 1
    }
    transition.recoveryEpisodeId = recovery.activeEpisodeId
    recovery.repeatedFailureCount = recovery.failureSignature === signature ? recovery.repeatedFailureCount + 1 : 1
    recovery.failureSignature = signature
    recovery.cause = cause
    recovery.stalledAttempts += 1
    recovery.strategiesTried = [...new Set([...recovery.strategiesTried, strategy])].slice(-8)
    session.ledger.noProgressCount = recovery.stalledAttempts

    if (cause === 'authentication_required') {
      recovery.disposition = 'handoff'
      session.ledger.disposition = 'handoff'
      session.status = 'handoff'
      session.terminalCategory = 'needs_user'
      session.pendingAction = null
      session.pendingApproval = null
      session.blockedReason = `Carve needs user participation before continuing. Observed: ${observed}`
      this.note(session, session.blockedReason)
      this.scheduleFrameCleanup(session)
      return this.snapshot()
    }

    if (recovery.repeatedFailureCount >= 2) {
      recovery.disposition = 'handoff'
      session.ledger.disposition = 'handoff'
      return this.block(`The same grounded strategy failed twice without new evidence. Expected “${transition.expectedState}”; observed “${observed}”.`, 'execution_limit')
    }
    if (recovery.stalledAttempts >= 4) {
      recovery.disposition = 'handoff'
      session.ledger.disposition = 'handoff'
      return this.block(`The active objective exhausted its bounded recovery strategies. Expected “${transition.expectedState}”; observed “${observed}”.`, 'execution_limit')
    }

    // A strategy that has already failed once is not worth repeating on the
    // same route. Escalate to a route change instead: a live session that kept
    // retrying an obstructed control burned its whole recovery budget on one
    // objective without ever trying another way in.
    const escalate = recovery.stalledAttempts >= 2
    recovery.disposition = escalate ? 'replan' : recoveryDispositionFor(cause)
    session.ledger.disposition = recovery.disposition
    session.status = 'ready'
    session.terminalCategory = null
    const guidance = recovery.disposition === 'reground'
      ? 'Re-ground the semantic target before choosing another input.'
      : recovery.disposition === 'replan'
        ? 'This approach has already failed here. Choose a materially different route to the same objective rather than repeating it.'
        : 'Retry only with fresh state evidence or a materially different mechanism.'
    this.note(session, `Recoverable ${cause.replaceAll('_', ' ')}. ${guidance} Expected “${transition.expectedState}”; observed “${observed}”.`)
    return this.snapshot()
  }

  /** Reuse one verifier-bound frame only for consecutive, dependency-ready,
   * read-only objectives about the same approved clause or entity. Cognitive
   * deliverables, final verification, and every write remain explicit. */
  private advanceAdditionalReadOnlyObjectives(
    session: LiveComputerSession,
    primary: LiveComputerObjective,
    transition: LiveComputerTransition,
    result: LiveComputerCriterionResult,
  ): string[] {
    if (transition.risk !== 'read_only' && transition.risk !== 'safe') return []
    if (result.confidence < liveVerificationPolicy.criterionConfidence || result.blockingMismatch && result.blockingMismatch !== 'none') return []
    const claims = new Map((result.additionalSatisfiedObjectives ?? []).map((claim) => [claim.objectiveId, claim.evidence.trim().slice(0, 240)]))
    if (claims.size === 0) return []
    const reusableKinds = new Set<LiveComputerObjective['kind']>([
      'establish_route', 'enter_query', 'open_matching_resource', 'choose_resource',
      'open_related_content', 'scroll_to_target', 'scroll_to_boundary',
    ])
    const ordered = session.ledger.objectives
    const primaryIndex = ordered.findIndex((objective) => objective.id === primary.id)
    const satisfied: string[] = []
    let previous = primary
    for (const candidate of ordered.slice(primaryIndex + 1)) {
      const evidence = claims.get(candidate.id)
      if (!evidence) break
      if (satisfied.length >= 3 || candidate.status !== 'pending' || !reusableKinds.has(candidate.kind)) break
      if (candidate.dependsOn.some((dependency) => session.ledger.objectives.find((objective) => objective.id === dependency)?.status !== 'verified')) break
      const sameClause = candidate.clauseIds.some((clauseId) => previous.clauseIds.includes(clauseId))
      const sameEntity = candidate.entityRefs.some((entityId) => previous.entityRefs.includes(entityId))
      if (!sameClause && !sameEntity) break
      candidate.status = 'verified'
      for (const entityId of candidate.entityRefs) {
        const entity = session.ledger.entities.find((entry) => entry.id === entityId)
        if (entity) {
          entity.status = 'resolved'
          entity.resolvedLabel ??= evidence
        }
      }
      session.ledger.facts = [...session.ledger.facts, evidence].slice(-12)
      satisfied.push(candidate.id)
      previous = candidate
      this.note(session, `The same fresh frame also proved read-only objective ${candidate.id}; no additional input or model call was needed.`)
    }
    return satisfied
  }

  /**
   * Budget exhaustion holds the session on a decision point instead of ending
   * it: the person grants more actions with one tap or takes over. Only the
   * policy ceiling — which no grant may exceed — remains terminal.
   */
  private raiseBudgetCheckpoint(session: LiveComputerSession, scope: 'objective' | 'session' | 'time', objective: LiveComputerObjective | null): LiveComputerSession {
    const recovery = session.ledger.recovery
    recovery.cause = 'budget_exhausted'
    if (scope === 'session' && session.maxActions >= liveBudgetPolicy.maxSessionActions) {
      session.ledger.disposition = 'handoff'
      recovery.disposition = 'handoff'
      return this.block('The live action budget reached the policy ceiling; review a fresh plan to continue', 'execution_limit')
    }
    if (scope === 'time' && (session.maxDurationMinutes ?? 15) >= liveBudgetPolicy.maxActiveDurationMinutes) {
      session.ledger.disposition = 'handoff'
      recovery.disposition = 'handoff'
      return this.block('The live active-time budget reached the policy ceiling; review a fresh plan to continue', 'execution_limit')
    }
    const grant = scope === 'objective'
      ? liveBudgetPolicy.objectiveExtensionActions
      : scope === 'session'
        ? Math.min(liveBudgetPolicy.sessionExtensionActions, liveBudgetPolicy.maxSessionActions - session.maxActions)
        : 0
    const durationMinutes = scope === 'time'
      ? Math.min(liveBudgetPolicy.durationExtensionMinutes, liveBudgetPolicy.maxActiveDurationMinutes - (session.maxDurationMinutes ?? 15))
      : undefined
    if (!session.pendingInputTransaction) {
      session.pendingAction = null
      session.pendingApproval = null
    }
    session.pendingBudgetGrant = { scope, objectiveId: objective?.id ?? null, actions: grant, ...(durationMinutes === undefined ? {} : { durationMinutes }) }
    const lastObserved = session.ledger.facts.at(-1) ?? null
    session.pendingGuidance = { id: id('question'),
      question: (scope === 'objective' && objective
        ? `This part is not finished after ${objective.actionBudget} steps. Allow up to ${grant} more steps?`
        : scope === 'time'
          ? `Carve has worked for ${(session.maxDurationMinutes ?? 15)} minutes and has not confirmed the result yet. Allow ${durationMinutes} more minutes?`
          : `Carve used the ${session.maxActions} steps allowed for this task and has not confirmed the result yet. Allow ${grant} more steps?`).slice(0, 300),
      context: [
        scope === 'objective' && objective ? `Target: ${objective.targetState}` : `Outcome: ${session.goal}`,
        lastObserved ? `Last confirmed: ${lastObserved}` : null,
      ].filter(Boolean).join(' ').slice(0, 500),
      options: [
        {
          id: scope === 'time' ? 'grant_more_time' : 'grant_more_actions',
          label: scope === 'time' ? `Allow ${durationMinutes} more minutes` : `Allow ${grant} more steps`,
          consequence: 'Carve continues on the same task with the extra steps or time shown. Your permissions stay the same.',
          mode: 'agent_continues',
        },
        {
          id: 'take_over',
          label: 'I’ll take it from here',
          consequence: 'Control returns to you; Carve stops sending input.',
          mode: 'person_takes_over',
        },
      ],
      askedAt: nowIso(),
    }
    session.status = 'awaiting_guidance'
    this.note(session, `Carve is asking for your direction: ${session.pendingGuidance.question}`)
    return this.snapshot()
  }

  private block(reason: string, category: Exclude<LiveComputerTerminalCategory, null> = 'planning_error'): LiveComputerSession {
    const session = this.requireSession()
    this.resolveInteraction(session, 'cancelled', reason)
    session.status = 'blocked'
    session.pendingAction = null
    session.pendingApproval = null
    session.blockedReason = reason
    session.terminalCategory = category
    this.note(session, reason)
    this.scheduleFrameCleanup(session)
    return this.snapshot()
  }

  private scheduleFrameCleanup(session: LiveComputerSession): void {
    if (!this.backend.cleanupFrames || this.cleanupScheduled.has(session.id)) return
    this.cleanupScheduled.add(session.id)
    const common = {
      kind: 'frame_cleanup' as const, sessionId: session.id, runId: session.runId,
      actionId: null, objectiveId: null, phase: 'terminal_session_frames', delivery: null,
      textLength: null, textSha256: null, frameSha256: session.latestFrame?.sha256 ?? null,
    }
    this.emitRuntime({ ...common, status: 'started', error: null })
    void this.backend.cleanupFrames(session.id).then(() => {
      this.emitRuntime({ ...common, status: 'completed', error: null })
    }).catch((error: unknown) => {
      this.emitRuntime({ ...common, status: 'failed', error: String(error).slice(0, 500) })
    })
  }

  private applyFrame(session: LiveComputerSession, frame: LiveComputerCapturedFrame): void {
    // Identity across frames: an element whose fingerprint was absent from the
    // previous digest is new to this frame. Frame ids alone cannot say that.
    const previous = new Set(this.frameElements.flatMap(element => element.fingerprint ? [element.fingerprint] : []))
    if (previous.size > 0) for (const element of frame.elements) if (element.fingerprint) element.appeared = !previous.has(element.fingerprint)
    session.latestFrame = frameInfo(frame)
    session.updatedAt = nowIso()
    this.frameDataUrl = frame.dataUrl
    this.frameVisualSample = frame.visualSample
    this.frameLocalizedVisualSample = frame.localizedVisualSample ?? null
    this.frameElements = frame.elements
    this.frameElementCaptureStatus = normalizedFrameElementCaptureStatus(frame)
    this.frameElementMatchDiagnostics = structuredClone(frame.elementMatchDiagnostics ?? null)
  }

  /** Did the target's own neighborhood change? On a self-changing page a
   * whole-frame difference proves nothing; a crop around the control does. */
  private actionRegionChange(action: LiveComputerAction, frame: LiveComputerCapturedFrame): { changed: boolean; ratio: number } | null {
    const before = this.activeActionBeforeLocalizedSample
    const anchor = action.targetBounds ?? (action.point ? pointRegion(action.point, frame) : null)
    if (!before || !frame.localizedVisualSample || !anchor) return null
    const masks = frame.elements.flatMap(element => element.media && element.bounds ? [element.bounds] : [])
    const change = regionChange(before, frame.localizedVisualSample, { width: 96, height: 64 }, frame, anchor, masks)
    return change.comparable ? { changed: change.changed, ratio: Number(change.ratio.toFixed(3)) } : null
  }

  private recordTransition(session: LiveComputerSession, action: LiveComputerAction, frame: LiveComputerCapturedFrame): void {
    const receipt = this.completeActionReceipt(action, frame)
    session.ledger.transitions.push({
      replayKey: operationReplayKey(action, session.target.windowId),
      sequence: session.ledger.transitions.length + 1,
      actionId: action.id,
      objectiveId: action.objectiveId,
      kind: action.kind,
      route: action.route,
      targetLabel: action.targetLabel,
      expectedState: action.expectedState,
      risk: action.risk,
      completesObjective: action.completesObjective,
      conclusion: action.kind === 'conclude' ? action.conclusion ?? null : null,
      artifactDraft: action.kind === 'conclude' && action.artifact ? structuredClone(action.artifact) : null,
      artifactId: action.kind === 'apply_artifact' ? action.artifactId ?? null : null,
      artifactLayout: action.artifactLayout ?? null,
      artifactUnit: action.artifactUnit ?? null,
      ...(action.artifactDestination ? { artifactDestination: structuredClone(action.artifactDestination) } : {}),
      targetingMode: action.targetingMode ?? null,
      regionChange: this.actionRegionChange(action, frame),
      command: action.kind === 'invoke_safe_command' ? action.command ?? null : null,
      key: action.kind === 'cycle_tab' ? action.key ?? null : null,
      observedState: null,
      status: 'awaiting_verification',
      verifiedBy: null,
      frameSha256: frame.sha256,
      routeKey: canonicalLiveComputerRoute(action.route),
      progress: null,
      failureCause: null,
      actionApplied: null,
      actionReceipt: receipt,
      inputTransaction: session.pendingInputTransaction?.actionId === action.id
        ? structuredClone(session.pendingInputTransaction) : null,
      effect: initialOperationEffect(action, session.target.windowId, frame.id, receipt.contentDelivery),
      observationKey: this.observationKey(session, action.objectiveId, frame.sha256, frame.visualSample),
      semanticCriterionMet: null,
      presentationMatch: null,
      blockingMismatch: null,
      satisfiedObjectiveIds: [],
      semanticProgress: null,
      evidence: [],
      coverageBefore: liveComputerCoverageSnapshot(session.ledger),
    })
  }

  private recordContentDelivery(progress: NonNullable<LiveComputerPhysicalActionReceipt['contentDelivery']>): void {
    this.activeContentDelivery = progress === 'none' && this.activeContentDelivery !== 'none'
      ? 'partial' : progress
    const pending = this.sessionValue?.pendingInputTransaction
    if (pending) pending.contentDelivery = this.activeContentDelivery
  }

  private async executePhysical(target: LiveComputerTarget, action: LiveComputerAction, signal: AbortSignal): Promise<void> {
    const startedAt = this.activeActionStartedAt ?? nowIso()
    signal.throwIfAborted()
    this.assertInputAdmission()
    this.physicalInputsInFlight++
    let returned: LiveComputerPhysicalActionReceipt | void
    try {
      returned = await this.backend.execute(target, this.degradeToSupportedInput(action), signal)
    } catch (error) {
      if (action.kind === 'type') this.recordContentDelivery('unknown')
      throw error
    } finally { this.physicalInputsInFlight-- }
    if (action.kind === 'type') this.recordContentDelivery(returned?.contentDelivery ?? returned?.deliveryProgress ?? 'complete')
    this.activePhysicalReceipt = returned ?? physicalActionReceipt(action, target, startedAt)
    this.activePhysicalSubsteps.push(structuredClone(this.activePhysicalReceipt))
    this.validateOperationReceipt(action, target, this.activePhysicalReceipt)
    this.assertApplicationOperationSucceeded(this.activePhysicalReceipt)
    if (this.activePhysicalReceipt.pressedInputsReleased === false) {
      throw new LiveComputerActionError('environment_lost', 'The native input bridge could not prove that every pressed input was released')
    }
    if (this.activePhysicalReceipt.deliveryProgress === 'none' || this.activePhysicalReceipt.delivery === 'rejected') {
      throw new LiveComputerActionError('input_not_accepted', this.nativeDeliveryFailureReason('The native input bridge posted no input for the approved interaction'))
    }
    if (action.kind === 'type' && this.activePhysicalReceipt.deliveryProgress === 'partial') {
      throw new LiveComputerActionError('input_not_accepted', this.nativeDeliveryFailureReason('Text delivery is incomplete or uncertain. Reconcile the current content before repairing it.'))
    }
  }

  private async executePhysicalTransaction(target: LiveComputerTarget, action: LiveComputerAction, steps: LiveComputerAction[], signal: AbortSignal): Promise<void> {
    if (!this.backend.executeTransaction) throw new LiveComputerActionError('environment_lost', 'The atomic live input transaction bridge is unavailable')
    const startedAt = this.activeActionStartedAt ?? nowIso()
    const physicalSteps = steps.map((step) => this.degradeToSupportedInput(step))
    signal.throwIfAborted()
    this.assertInputAdmission()
    this.physicalInputsInFlight++
    let returned: LiveComputerPhysicalActionReceipt | void
    try {
      returned = await this.backend.executeTransaction(target, action, physicalSteps, signal)
    } catch (error) {
      if (steps.some(step => step.kind === 'type')) this.recordContentDelivery('unknown')
      throw error
    } finally { this.physicalInputsInFlight-- }
    if (steps.some(step => step.kind === 'type')) this.recordContentDelivery(returned?.contentDelivery ?? returned?.deliveryProgress ?? 'complete')
    this.activePhysicalReceipt = returned ?? physicalActionReceipt(action, target, startedAt)
    this.activePhysicalSubsteps.push(structuredClone(this.activePhysicalReceipt))
    this.validateOperationReceipt(action, target, this.activePhysicalReceipt)
    this.assertApplicationOperationSucceeded(this.activePhysicalReceipt)
    if (this.activePhysicalReceipt.pressedInputsReleased === false) {
      throw new LiveComputerActionError('environment_lost', 'The native input bridge could not prove that every pressed input was released')
    }
    if (this.activePhysicalReceipt.deliveryProgress === 'none' || this.activePhysicalReceipt.delivery === 'rejected') {
      throw new LiveComputerActionError('input_not_accepted', 'The native input bridge posted no input for the approved transaction')
    }
    if (this.activePhysicalReceipt.deliveryProgress === 'partial') {
      throw new LiveComputerActionError('input_not_accepted', 'The input sequence stopped before completion. Reconcile its effect before continuing.')
    }
  }

  private nativeDeliveryFailureReason(fallback: string): string {
    const failure = this.activePhysicalReceipt?.failure
    return failure ? `${fallback} Native ${failure.method}: ${failure.code} at ${failure.stage}; content mutation ${failure.mutation}${failure.nativeCode === undefined ? '' : ` (platform ${failure.nativeCode})`}.` : fallback
  }

  private assertApplicationOperationSucceeded(receipt: LiveComputerPhysicalActionReceipt): void {
    const transaction = receipt.operationTransaction
    if (!transaction || transaction.status === 'completed') return
    const failure = transaction.failure
    if (!failure) throw new LiveComputerActionError('environment_lost', 'The application adapter returned an incomplete failure receipt')
    const classification = classifyApplicationOperationFailure(failure, transaction.commit)
    throw new LiveComputerActionError(classification.failureCause, failure.message, undefined, transaction)
  }

  private validateOperationReceipt(
    action: LiveComputerAction,
    target: LiveComputerTarget,
    receipt: LiveComputerPhysicalActionReceipt,
  ): void {
    const transaction = receipt.operationTransaction
    if (!transaction) return
    const authorization = action.operationAuthorization
    if (!authorization) throw new LiveComputerActionError('policy_violation', 'The application adapter returned a transaction without controller authorization')
    validateApplicationOperationReceipt(transaction, {
      transactionId: authorization.transactionId,
      operationId: authorization.operationId,
      targetSha256: authorization.targetSha256,
      parameterBindingsSha256: authorization.parameterBindingsSha256,
      windowId: target.windowId,
    })
    if (receipt.verifiedEffect === 'text_document.saved_new_file' && transaction.status !== 'completed') {
      throw new LiveComputerActionError('policy_violation', 'The application adapter claimed a saved file without a completed transaction receipt')
    }
  }

  /**
   * A backend advertises the physical inputs it can inject. A semantic
   * element_action whose surface the backend lacks (an older helper, a window
   * without a semantic input surface, a fixture) degrades to the pointer
   * primitive at the already-grounded point instead of being rejected after
   * approval — a rejection there burned a recovery episode with cause
   * "unknown" on every first grounded action (in a test battery).
   */
  private degradeToSupportedInput(action: LiveComputerAction): LiveComputerAction {
    const supported = this.backend.summary().supportedActions
    if (supported.length === 0 || action.kind !== 'element_action' || supported.includes('element_action')) return action
    if (!action.point) throw new LiveComputerActionError('plan_invalid', 'The input backend has no semantic element surface and the element action names no grounded point')
    const session = this.sessionValue
    if (session) this.note(session, `The input backend exposes no semantic element surface; ${action.elementAction ?? 'element'} on ${action.targetLabel ?? 'the target'} is delivered as a pointer click at its grounded point.`)
    return { ...action, kind: 'click', elementAction: null }
  }

  private completeActionReceipt(action: LiveComputerAction, frame: LiveComputerCapturedFrame): LiveComputerObservedActionReceipt {
    const latestPhysical = this.activePhysicalReceipt ?? physicalActionReceipt(action, this.requireSession().target, this.activeActionStartedAt ?? nowIso())
    const substeps = this.activePhysicalSubsteps
    const prefixApplied = substeps.slice(0, -1).some(step => step.deliveryProgress !== 'none') || this.activeContentDelivery !== 'none'
    const physical: LiveComputerPhysicalActionReceipt = substeps.length > 1 ? {
      ...latestPhysical,
      startedAt: substeps[0]!.startedAt,
      eventCount: substeps.reduce((count, step) => count + (step.eventCount ?? 0), 0),
      pressedInputsReleased: substeps.every(step => step.pressedInputsReleased === true),
      delivery: latestPhysical.delivery === 'rejected' && prefixApplied ? 'uncertain' as const : latestPhysical.delivery,
      ...(latestPhysical.deliveryProgress === 'none' && prefixApplied ? { deliveryProgress: 'partial' as const } : {}),
    } : latestPhysical
    if (substeps.length > 1 && !substeps.some(step => step.pressedInputsReleased === false)
      && substeps.some(step => step.pressedInputsReleased === undefined)) delete physical.pressedInputsReleased
    const channels: LiveComputerObservedActionReceipt['evidenceChannels'] = []
    const beforeElements = new Set(this.preActionElements.map(elementIdentity))
    const afterElements = new Set(frame.elements.map(elementIdentity))
    const accessibilityChanged = beforeElements.size !== afterElements.size
      || [...beforeElements].some((identity) => !afterElements.has(identity))
    if (accessibilityChanged) channels.push('accessibility_diff')
    const visuallyChanged = visiblyChanged(this.activeActionBeforeFrameSha256, this.activeActionBeforeVisualSample, frame)
    if (this.activeActionBeforeVisualSample && frame.visualSample && visuallyChanged) channels.push('coarse_visual_diff')
    // A 12x12 coarse sample misses an inline disclosure of a few text rows; the
    // 96x64 sample around the action point catches it (in an A/B test the
    // receipt reported "unchanged" for a revealed report and the verifier
    // cited that telemetry to reject the visible answer).
    const localizedChanged = localizedSampleRegionChanged(this.activeActionBeforeLocalizedSample, frame, action.point)
    if (localizedChanged) channels.push('localized_visual_diff')
    const hashChanged = Boolean(this.activeActionBeforeFrameSha256 && this.activeActionBeforeFrameSha256 !== frame.sha256)
    if (hashChanged) channels.push('frame_hash')
    if (this.activeActionSideEffectScope === 'out_of_scope') channels.push('window_set_diff')
    return {
      ...physical,
      substeps: structuredClone(substeps),
      transactionId: action.id,
      actionId: action.id,
      actionKind: action.kind,
      contentDelivery: ['type_into', 'enter_sequence', 'apply_artifact'].includes(action.kind) ? this.activeContentDelivery : undefined,
      targetWindowId: this.requireSession().target.windowId,
      targetElementId: action.targetElementId ?? null,
      sideEffectScope: this.activeActionSideEffectScope,
      beforeFrameSha256: this.activeActionBeforeFrameSha256,
      afterFrameSha256: frame.sha256,
      observedDelta: visuallyChanged || localizedChanged || accessibilityChanged || this.activeActionSideEffectScope !== 'selected_window' ? 'changed' : hashChanged ? 'subtle' : 'unchanged',
      evidenceChannels: [...new Set(channels)],
    }
  }

  private observationKey(session: LiveComputerSession, objectiveId: string, frameSha256: string | null, visualSample: string | null): string {
    const objective = session.ledger.objectives.find((candidate) => candidate.id === objectiveId)
    return sha256(stableJson({
      objectiveId,
      observation: visualSample ? sha256(visualSample) : frameSha256,
      routeKey: session.ledger.routeKey,
      semanticPostcondition: objective?.targetState ?? null,
      decisionDigest: decisionContext(session.ledger).digest,
      executionGraphVersion: session.ledger.executionGraphVersion,
    }))
  }

  /**
   * One governed transaction for a run of inputs into one control set: text
   * items are typed, key items press one safe navigation key, activate items
   * press the control whose visible label matches in the frame captured just
   * before that item. Every activator was already resolved at proposal time;
   * it is resolved again here against fresh state so a control that moved
   * or vanished stops the run before input instead of hitting a neighbor.
   * One fresh frame and one criterion verification follow the whole run,
   * which is what makes a seven-key calculation one decision rather than
   * seven (a Calculator drive: ~9.5 s per key).
   */
  private async executeEnterSequence(session: LiveComputerSession, action: LiveComputerAction, signal: AbortSignal): Promise<void> {
    const items = action.sequence ?? []
    const base: LiveComputerAction = {
      ...action, kind: 'click', sequence: null, scrollY: null, scrollIntent: null, textDelivery: null,
      text: null, key: null, replaceExisting: false, elementAction: null, endPoint: null, submitPoint: null, submitTargetElementId: null,
    }
    const physical = (overrides: Partial<LiveComputerAction>): LiveComputerAction => ({ ...base, ...overrides })
    const refresh = async (phase: string): Promise<void> => {
      const frame = await this.backend.capture(session.target, `${session.id}-sequence-${action.id}-${phase}-${Date.now()}`)
      this.applyFrame(session, frame)
    }
    if (items[0]?.kind === 'text' && (action.point || action.targetElementId)) {
      await this.establishInputFocus(session, action, signal)
      Object.assign(base, { point: action.point, targetElementId: action.targetElementId,
        targetIdentity: action.targetIdentity, targetObservationId: action.targetObservationId, inputReceiver: action.inputReceiver })
    }
    const atomicFieldEntry = Boolean(
      this.backend.executeTransaction
      && items[0]?.kind === 'text'
      && (action.point || action.targetElementId)
      && items.every((item) => item.kind === 'text' || item.kind === 'key'),
    )
    if (atomicFieldEntry) {
      const steps: LiveComputerAction[] = []
      if (action.replaceExisting) steps.push(physical({ kind: 'keypress', point: null, key: 'SELECT_ALL' }))
      for (const item of items) {
        steps.push(item.kind === 'text'
          ? physical({ kind: 'type', point: null, text: item.value, textDelivery: 'keycodes' })
          : physical({ kind: 'keypress', point: null, key: item.value.trim().toUpperCase() }))
      }
      if (action.key) steps.push(physical({ kind: 'keypress', point: null, key: action.key }))
      const typed = items.filter((item) => item.kind === 'text').map((item) => item.value).join('\n')
      await this.runInputSubaction(session, { ...action, text: typed }, 'type_text', 'keycodes', async () => {
        await this.executePhysicalTransaction(session.target, action, steps, signal)
      })
      this.note(session, `Delivered ${items.length} of ${items.length} inputs through one exact-window transaction; one fresh frame now verifies the whole run.`)
      return
    }
    if (items[0]?.kind === 'text' && action.replaceExisting) {
      await this.executePhysical(session.target, physical({ kind: 'keypress', point: null, key: 'SELECT_ALL' }), signal)
    }
    let delivered = 0
    for (const [index, item] of items.entries()) {
      if (signal.aborted) throw new Error('Live computer action was stopped')
      if (item.kind === 'text') {
        await this.runInputSubaction(session, { ...action, text: item.value }, 'type_text', 'keycodes', async () => {
          await this.executePhysical(session.target, physical({ kind: 'type', point: null, text: item.value, textDelivery: 'keycodes' }), signal)
        })
      } else if (item.kind === 'key') {
        await this.runInputSubaction(session, action, 'sequence_key', null, async () => {
          await this.executePhysical(session.target, physical({ kind: 'keypress', point: null, key: item.value.trim().toUpperCase() }), signal)
        })
      } else {
        const element = resolveSequenceActivator(this.frameElements, item.value)
        const frame = session.latestFrame
        const bounds = frame && element.bounds ? visibleElementBounds(element.bounds, frame) : element.bounds
        if (!bounds) throw new LiveComputerActionError('target_moved', `The sequence target “${item.value}” is no longer visible in the selected window`)
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        await this.runInputSubaction(session, action, 'sequence_activate', null, async () => {
          await this.executePhysical(session.target, physical({ kind: 'element_action', elementAction: 'activate', targetElementId: element.id, targetLabel: item.value, point }), signal)
        })
      }
      delivered += 1
      if (index < items.length - 1) {
        await delay(item.kind === 'text' ? 60 : 120, signal)
        // A fresh digest before the next activator: labels are re-resolved
        // against what the application shows now, never against the frame
        // the model proposed from.
        if (items[index + 1]?.kind === 'activate') await refresh(`item-${index + 1}`)
      }
    }
    if (action.key) {
      await delay(80, signal)
      await this.runInputSubaction(session, action, 'submit_field', null, async () => {
        await this.executePhysical(session.target, physical({ kind: 'keypress', point: null, key: action.key }), signal)
      })
    }
    this.note(session, `Delivered ${delivered} of ${items.length} inputs as one governed transaction; one fresh frame now verifies the whole run.`)
  }

  /** Rebind semantic identity to the current observation before every input
   * transaction. Frame-local ids never survive a capture by themselves.
   *
   * Three facts decide, the way a locator library decides: the target is
   * present (it re-resolves, with duplicates narrowed before any refusal),
   * nothing is in front of it (a native hit test at the point, and the
   * frame's dialog inventory), and its own neighborhood is stable (a
   * bounded crop, never the whole page: an autoplaying video elsewhere is
   * not evidence about this control). A covered target is cleared first;
   * only a target that is gone, ambiguous, or still covered is refused. */
  private async refreshInputTarget(session: LiveComputerSession, action: LiveComputerAction, signal: AbortSignal): Promise<LiveComputerElement | null> {
    const expected = action.targetIdentity ?? (action.groundingSource === 'provider_visual' ? null : inputTargetElement(this.frameElements, action))
    const prior = session.latestFrame
    const priorLocalized = this.frameLocalizedVisualSample
    const priorVisual = this.frameVisualSample
    let frame = await this.backend.capture(session.target, `${session.id}-target-${action.id}-${Date.now()}`)
    signal.throwIfAborted()
    this.applyFrame(session, frame)
    let current: LiveComputerElement | null = null
    if (expected) {
      const resolution = resolveInputTarget(expected, frame.elements)
      if (!resolution.element?.bounds) {
        throw new LiveComputerActionError('target_moved', resolution.candidateCount > 1
          ? `The intended target no longer resolves uniquely: ${resolution.candidateCount} controls match. Inspect this fresh observation and name the one you mean by its element id.`
          : 'The intended target no longer resolves uniquely because it is no longer present. Inspect this fresh observation and choose a current target.',
          undefined, undefined, { resolution: { candidateCount: resolution.candidateCount, narrowedBy: resolution.narrowedBy, candidates: resolution.candidates.slice(0, 6) } })
      }
      current = resolution.element
      if (action.point && expected.bounds) {
        const relativeX = (action.point.x - expected.bounds.x) / expected.bounds.width
        const relativeY = (action.point.y - expected.bounds.y) / expected.bounds.height
        action.point = { x: current.bounds!.x + relativeX * current.bounds!.width, y: current.bounds!.y + relativeY * current.bounds!.height }
      }
      action.targetElementId = current.id
      action.targetIdentity = elementIdentityForInput(current)
      action.targetBounds = current.bounds
    } else {
      if (prior && (prior.width !== frame.width || prior.height !== frame.height)) {
        throw new LiveComputerActionError('target_moved', 'The window coordinate transform changed. Resolve the visual target in the current frame.')
      }
      if (prior && action.point && priorLocalized && frame.localizedVisualSample) {
        const region = action.targetBounds ?? pointRegion(action.point, frame)
        const change = regionChange(priorLocalized, frame.localizedVisualSample, { width: 96, height: 64 }, frame, region)
        if (change.comparable && change.changed) {
          throw new LiveComputerActionError('target_moved', 'The area around the visual target changed materially before input. Choose a target from the fresh frame.',
            undefined, undefined, { regionChange: { ratio: Number(change.ratio.toFixed(3)), pixels: change.pixels, wholeFrameChanged: visiblyChanged(prior.sha256, priorVisual, frame) } })
        }
      } else if (prior && priorVisual && frame.visualSample && visiblyChanged(prior.sha256, priorVisual, frame)) {
        // Older helpers lack regional samples; retain their existing freshness check.
        throw new LiveComputerActionError('target_moved', 'The visual target observation materially changed before input. Choose a target from the fresh frame.')
      }
      // A visual target is not relabeled with whichever element inherited an id.
      action.targetElementId = null
    }
    // A positive hit test outranks the inventory's geometric coverage hint.
    // Only a named, unambiguous dismissal is attempted locally.
    const point = action.point ?? (current?.bounds ? { x: current.bounds.x + current.bounds.width / 2, y: current.bounds.y + current.bounds.height / 2 } : null)
    if (point && action.kind !== 'scroll') {
      let hit = this.backend.hitTest ? await this.backend.hitTest(session.target, point, current ? elementIdentityForInput(current) : null).catch(() => null) : null
      // Chrome can return a provisional group on its first hit query. Recheck
      // once without input; a missing response retains the original rejection.
      if (current && this.backend.hitTest && hit?.available && hit.stable && hit.relation === 'other') {
        await delay(50, signal)
        const rechecked = await this.backend.hitTest(session.target, point, elementIdentityForInput(current)).catch(() => null)
        if (rechecked?.available) hit = rechecked
      }
      signal.throwIfAborted()
      const reachesTarget = hit?.available && (hit.relation === 'target' || hit.relation === 'descendant')
      if (hit?.available && hit.relation === 'none') throw new LiveComputerActionError('target_moved', 'The click point no longer resolves to a visible control. Re-ground it from the fresh frame.')
      if (hit?.available && !hit.stable) throw new LiveComputerActionError('target_moved', 'The control is still moving. Re-ground it after it settles.')
      const fromInventory = reachesTarget ? null : obstructionCovering(frame, point, current)
      const covered = fromInventory ?? (hit?.obstruction ? { id: -1, role: hit.obstruction.role, subrole: hit.obstruction.subrole, name: hit.obstruction.name, bounds: hit.obstruction.bounds ?? { x: point.x, y: point.y, width: 1, height: 1 }, evidence: 'dialog' as const } : null)
      const interceptedByOther = Boolean(hit && hit.available && current && hit.relation === 'other' && !fromInventory)
      if (covered || interceptedByOther) {
        const cleared = covered && expected ? await this.clearObstruction(session, action, covered, signal) : null
        if (!cleared) {
          throw new LiveComputerActionError('target_covered', covered
            ? `The target is covered by a ${covered.evidence === 'banner' ? 'banner' : 'dialog'}${covered.name ? ` (“${covered.name.slice(0, 60)}”)` : ''} that Carve could not clear without accepting anything. Scroll the target away from it, use another route, or ask the person to dismiss it.`
            : `Another control (${hit?.hit?.role ?? 'unknown'}${hit?.hit?.name ? ` “${hit.hit.name.slice(0, 60)}”` : ''}) would receive the click at that point. Choose the control itself from the fresh observation.`,
            undefined, undefined, { covered: covered ? { evidence: covered.evidence, role: covered.role, nameSha256: sha256(covered.name) } : null, hit: hit ? { relation: hit.relation, role: hit.hit?.role ?? null } : null })
        }
        frame = cleared
        if (expected) {
          const again = resolveInputTarget(expected, frame.elements)
          if (!again.element?.bounds) throw new LiveComputerActionError('target_moved', 'The target moved while the obstruction was being cleared. Inspect the fresh observation.')
          current = again.element
          action.targetElementId = current.id
          action.targetIdentity = elementIdentityForInput(current)
          action.targetBounds = current.bounds
          if (action.point) action.point = { x: current.bounds!.x + current.bounds!.width / 2, y: current.bounds!.y + current.bounds!.height / 2 }
        }
      }
    }
    action.targetObservationId = frame.id
    return current
  }

  /** One local dismissal, bound to the dialog's own current control. Scrolling
   * or keyboard alternatives remain explicit planner actions; no blind fallback
   * clicks or replay of controls from a stale capture. */
  private async clearObstruction(session: LiveComputerSession, action: LiveComputerAction, obstruction: NonNullable<LiveComputerFrame['obstructions']>[number], signal: AbortSignal): Promise<LiveComputerCapturedFrame | null> {
    if (!action.targetIdentity || !this.backend.hitTest) return null
    const controls = obstructionControls(this.frameElements, obstruction).filter(({ element, kind }) =>
      (kind === 'close' || kind === 'reject') && element.bounds && element.actions?.includes('AXPress'))
    const candidate = controls.find(control => control.kind === 'reject') ?? controls[0]
    if (!candidate) return null
    const { element, kind } = candidate
    const bounds = element.bounds!
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const hit = await this.backend.hitTest(session.target, point, elementIdentityForInput(element))
    signal.throwIfAborted()
    if (!hit?.available || !hit.stable || !['target', 'descendant'].includes(hit.relation)) return null
    await this.executePhysical(session.target, { ...action,
      kind: 'element_action', elementAction: 'activate', point,
      targetElementId: element.id, targetIdentity: elementIdentityForInput(element), targetBounds: bounds,
      targetObservationId: session.latestFrame?.id ?? null, targetLabel: element.name,
      text: null, key: null, artifactId: null, replaceExisting: false, inputReceiver: null,
      scrollY: null, scrollIntent: null,
    }, signal)
    const frame = await this.backend.capture(session.target, `${session.id}-clear-${action.id}-${Date.now()}`)
    signal.throwIfAborted()
    this.applyFrame(session, frame)
    const target = resolveInputTarget(action.targetIdentity, frame.elements).element
    let cleared = false
    if (target?.bounds) {
      const center = { x: target.bounds.x + target.bounds.width / 2, y: target.bounds.y + target.bounds.height / 2 }
      const after = await this.backend.hitTest(session.target, center, elementIdentityForInput(target))
      signal.throwIfAborted()
      cleared = Boolean(after?.available && after.stable && ['target', 'descendant'].includes(after.relation))
    }
    this.emitRuntime({ kind: cleared ? 'obstruction_cleared' : 'obstruction_persisted',
      sessionId: session.id, runId: session.runId, actionId: action.id, objectiveId: action.objectiveId,
      phase: 'clear_obstruction', status: cleared ? 'completed' : 'failed', delivery: null, textLength: null, textSha256: null,
      frameSha256: frame.sha256, error: null, obstruction: { id: obstruction.id, evidence: obstruction.evidence, control: kind, method: 'press' } })
    return cleared ? frame : null
  }

  /** Shared by text fields and artifact rendering. Uncertainty requests fresh
   * evidence; only an observed different receiver is a negative focus proof. */
  private async establishInputFocus(session: LiveComputerSession, action: LiveComputerAction, signal: AbortSignal): Promise<LiveComputerElement | null> {
    const expected = await this.refreshInputTarget(session, action, signal)
    let evidence: LiveComputerInputEvidence = { acceptance: 'uncertain', channels: [], reason: 'Focus has not been observed.' }
    let latest: LiveComputerCapturedFrame | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal.throwIfAborted()
      const current = expected ? resolveCurrentInputTarget(expected, this.frameElements) : null
      if (expected && !current) throw new LiveComputerActionError('target_moved', 'The target changed during focus acquisition; choose a target from the new observation.')
      if (current) {
        const priorBounds = action.targetIdentity?.bounds
        if (action.point && priorBounds && current.bounds && priorBounds.width > 0 && priorBounds.height > 0) {
          action.point = {
            x: current.bounds.x + (action.point.x - priorBounds.x) / priorBounds.width * current.bounds.width,
            y: current.bounds.y + (action.point.y - priorBounds.y) / priorBounds.height * current.bounds.height,
          }
        }
        action.targetElementId = current.id
        action.targetIdentity = elementIdentityForInput(current)
      }
      const semantic = attempt === 0 && current?.settableAttributes?.includes('AXFocused')
      const focus: LiveComputerAction = { ...action, kind: semantic ? 'element_action' : 'click',
        elementAction: semantic ? 'focus' : null, text: null, key: null, artifactId: null, replaceExisting: false, inputReceiver: null }
      await this.runInputSubaction(session, action, attempt === 0 ? 'focus_field' : 'refocus_field', null, async () => {
        try { await this.executePhysical(session.target, focus, signal) }
        catch (error) {
          signal.throwIfAborted()
          if (!semantic || this.activePhysicalReceipt?.pressedInputsReleased === false) throw error
          await this.executePhysical(session.target, { ...focus, kind: 'click', elementAction: null }, signal)
        }
      })
      await delay(attempt === 0 ? 70 : 90, signal)
      latest = await this.backend.capture(session.target, `${session.id}-focus-${action.id}-${attempt}-${Date.now()}`)
      signal.throwIfAborted()
      evidence = evaluateInputFocusAcceptance(expected, latest, action)
      this.applyFrame(session, latest)
      this.emitRuntime({ kind: 'input_checkpoint', sessionId: session.id, runId: session.runId, actionId: action.id,
        objectiveId: action.objectiveId, phase: attempt === 0 ? 'focus' : 'focus_retry', status: evidence.acceptance === 'accepted' ? 'accepted' : evidence.acceptance === 'rejected' ? 'rejected' : 'uncertain',
        delivery: null, textLength: null, textSha256: null, frameSha256: latest.sha256, error: null,
        acceptance: evidence.acceptance, evidenceChannels: evidence.channels, observationId: latest.id })
      if (evidence.acceptance === 'accepted') break
    }
    if (evidence.acceptance === 'uncertain' && latest && this.semanticInputVerifier
      && action.risk !== 'sensitive' && action.risk !== 'irreversible') {
      const visual = await this.semanticInputVerifier({ phase: 'focus', session: this.snapshot(), action: structuredClone(action), before: latest, after: latest })
      signal.throwIfAborted()
      evidence = visual.acceptance === 'accepted' && visual.channels.includes('semantic_visual')
        ? visual : { acceptance: 'uncertain', channels: visual.channels, reason: visual.reason }
    }
    if (evidence.acceptance !== 'accepted') throw new LiveComputerActionError('focus_miss', `No text or submit key was sent. ${evidence.reason} Reobserve and choose another targeting tactic.`)
    const resolved = expected ? resolveCurrentInputTarget(expected, this.frameElements) : null
    action.targetElementId = resolved?.id ?? null
    action.targetIdentity = resolved ? elementIdentityForInput(resolved) : null
    action.targetObservationId = latest?.id ?? session.latestFrame?.id ?? null
    const receiver = this.frameElements.find(element => element.focused === true && !element.sensitive)
    action.inputReceiver = receiver ? elementIdentityForInput(receiver) : null
    if (session.pendingInputTransaction) session.pendingInputTransaction.focusObservationId = action.targetObservationId ?? undefined
    return resolved
  }

  private async executeTypeInto(session: LiveComputerSession, action: LiveComputerAction, signal: AbortSignal): Promise<boolean> {
    const base = { ...action, scrollY: null, scrollIntent: null, textDelivery: null, artifactId: null }
    let transaction = session.pendingInputTransaction
    let capabilityTextVisuallyVerified = false
    const reviewedFieldEffect = hasActionScopeAssessment(session, action, 'authorized_field_effect')
    let expectedTarget = inputTargetElement(this.frameElements, action)
    if (transaction && transaction.actionId !== action.id) throw new Error('A different input transaction is already pending reconciliation')
    if (!transaction || transaction.phase === 'focus') {
      transaction = session.pendingInputTransaction = {
        actionId: action.id, objectiveId: action.objectiveId, phase: 'focus', deliveryState: 'not_started',
        delivery: null, attemptedDeliveries: [], reconciliationObservations: 0, contentDelivery: 'none',
        intendedTextSha256: sha256(action.text ?? ''), baselineFrameSha256: null,
        submission: action.key || action.submitPoint ? 'withheld' : 'not_requested',
        textProvenance: action.textProvenance ? structuredClone(action.textProvenance) : null,
      }
      expectedTarget = await this.establishInputFocus(session, action, signal)
      Object.assign(base, { point: action.point, targetElementId: action.targetElementId, targetIdentity: action.targetIdentity,
        targetObservationId: action.targetObservationId, inputReceiver: action.inputReceiver })
      transaction.phase = 'replace'
      if (!this.backend.executeTransaction && action.replaceExisting) {
        // SELECT_ALL is generated only by this local compiler. It is deliberately
        // absent from the model-facing keypress vocabulary.
        await this.runInputSubaction(session, action, 'select_existing_text', null, async () => {
          await this.executePhysical(session.target, { ...base, kind: 'keypress', point: null, text: null, key: 'SELECT_ALL', replaceExisting: false }, signal)
        })
        await delay(70, signal)
      }
      this.pendingInputBaseline = await this.captureInputCheckpoint(session, action, 'before_text_delivery', null)
      transaction.baselineFrameSha256 = this.pendingInputBaseline.sha256
    }

    const canAssignAccessibilityValue = Boolean(
      action.point
      && expectedTarget?.editable === true
      && (action.replaceExisting || expectedTarget.value === '')
      && (action.text?.length ?? 0) <= 1_000
      && expectedTarget.settableAttributes?.some((attribute) => attribute.toLocaleLowerCase() === 'axvalue'),
    )
    // Prefer the platform's semantic text capability when the exact approved
    // target advertises a settable value. The native bridge verifies the
    // selected window, target process, control role, set operation, and exact
    // read-back before reporting delivery. Physical keyboard methods remain
    // bounded fallbacks for controls that do not expose that capability.
    const strategies: LiveComputerTextDelivery[] = action.tablePayload ? ['clipboard_table'] : [
      ...(canAssignAccessibilityValue ? ['accessibility_value' as const] : []),
      'keycodes',
      'unicode_graphemes',
    ]
    while (transaction.deliveryState !== 'accepted') {
      if (transaction.deliveryState === 'not_started' || transaction.deliveryState === 'rejected') {
        const strategy = strategies.find((candidate) => !transaction!.attemptedDeliveries.includes(candidate))
        if (!strategy) throw new LiveComputerActionError('input_not_accepted', 'The selected application rejected both governed text-delivery methods')
        if (transaction.deliveryState === 'rejected') {
          if (!action.replaceExisting && this.activeContentDelivery !== 'none') throw new LiveComputerActionError('input_not_accepted', 'The field is wrong, but replacement was not authorized; retrying could duplicate text')
          const repairFrame = await this.captureInputCheckpoint(session, action, 'before_alternate_delivery', strategy)
          this.applyFrame(session, repairFrame)
          const repairEvidence = evaluateTextInputAcceptance(this.pendingInputBaseline!, repairFrame, action)
          transaction.readback = inputReadbackSnapshot(repairFrame,
            expectedTarget ? resolveCurrentInputTarget(expectedTarget, repairFrame.elements) : null, action.text, false)
          if (repairEvidence.acceptance === 'accepted') {
            transaction.deliveryState = 'accepted'
            break
          }
          if (repairEvidence.acceptance !== 'rejected'
            || evaluateInputFocusAcceptance(expectedTarget, repairFrame, action).acceptance !== 'accepted') {
            transaction.deliveryState = 'unknown'
            transaction.phase = 'verify'
            this.note(session, 'The field or focus changed before repair. Inspect the current state; no replacement or submit was sent.')
            return true
          }
          this.pendingInputBaseline = repairFrame
          transaction.baselineFrameSha256 = repairFrame.sha256
          transaction.phase = 'replace'
          if (action.replaceExisting && !this.backend.executeTransaction) {
            await this.runInputSubaction(session, action, 'reselect_before_alternate_delivery', null, async () => {
              await this.executePhysical(session.target, { ...base, kind: 'keypress', point: null, text: null, key: 'SELECT_ALL', replaceExisting: false }, signal)
            })
            await delay(70, signal)
          }
        }
        transaction.phase = 'deliver'
        if (action.artifactDestination && !action.tablePayload) {
          const destination = await this.backend.tableDestination?.(session.target)
          signal.throwIfAborted()
          if (destination?.fingerprint !== action.artifactDestination.fingerprint) throw new LiveComputerActionError('evidence_stale', 'The repair destination changed after focusing; no content was sent.')
        }
        try {
          await this.runInputSubaction(session, action, 'type_text', strategy, async () => {
            const typeAction: LiveComputerAction = {
              ...base,
              kind: 'type',
              point: strategy === 'accessibility_value' ? action.point : null,
              key: null,
              replaceExisting: strategy === 'accessibility_value' ? action.replaceExisting : false,
              textDelivery: strategy,
            }
            if (strategy === 'accessibility_value') {
              await this.executePhysical(session.target, typeAction, signal)
            } else if (this.backend.executeTransaction) {
              // Focus was proved from a fresh semantic frame. Reassert that
              // same grounded field and keep replacement plus delivery under
              // one exact-window helper resolution, so a transient sibling
              // surface cannot interleave between Select All and the text.
              const steps: LiveComputerAction[] = []
              if (action.replaceExisting) steps.push({
                ...base, kind: 'keypress', point: null, elementAction: null,
                endPoint: null, text: null, key: 'SELECT_ALL', replaceExisting: false,
              })
              steps.push(typeAction)
              await this.executePhysicalTransaction(session.target, action, steps, signal)
            } else {
              await this.executePhysical(session.target, typeAction, signal)
            }
          })
        } catch (error) {
          transaction.attemptedDeliveries.push(strategy)
          transaction.delivery = strategy
          signal.throwIfAborted()
          if (this.activePhysicalReceipt?.pressedInputsReleased === false) throw error
          transaction.deliveryState = this.activeContentDelivery === 'none' ? 'rejected' : 'unknown'
          if (transaction.deliveryState === 'rejected') {
            if (strategy === 'unicode_graphemes') throw error
            continue
          }
          // An exception after input may hide a partial or complete effect.
          // Reconcile it below; do not switch methods and type the text again.

        }
        if (!transaction.attemptedDeliveries.includes(strategy)) transaction.attemptedDeliveries.push(strategy)
        transaction.delivery = strategy
        transaction.deliveryState = 'unknown'
      }
      if (action.tablePayload) {
        // A native table has no scalar text-field readback or submit boundary.
        // The ordinary post-action verifier owns shape, values and persistence.
        // Retain uncertainty here instead of paying to verify the same table twice.
        transaction.phase = 'verify'
        return true
      }

      transaction.phase = 'reconcile'
      session.status = 'reconciling_input'
      const baseline = this.pendingInputBaseline
      if (!baseline) throw new Error('The pending input transaction lost its pre-delivery checkpoint')
      let evidence: LiveComputerInputEvidence = { acceptance: 'uncertain', channels: [], reason: 'No reconciliation observation has run.' }
      let latestReconciliationFrame: LiveComputerCapturedFrame | null = null
      let previousReadback: LiveComputerElement | null = null
      let stableReadback = false
      for (let observation = 0; observation < 2 && evidence.acceptance !== 'accepted'; observation += 1) {
        await delay(observation === 0 ? 140 : 260, signal)
        const after = await this.backend.capture(session.target, `${session.id}-reconcile-${action.id}-${transaction.reconciliationObservations + 1}-${Date.now()}`)
        latestReconciliationFrame = after
        transaction.reconciliationObservations += 1
        const localEvidence = evaluateTextInputAcceptance(baseline, after, action)
        evidence = localEvidence
        const field = expectedTarget ? resolveCurrentInputTarget(expectedTarget, after.elements) : null
        stableReadback = Boolean(previousReadback && field && field.value !== null
          && previousReadback.value === field.value && previousReadback.valueComplete !== false && field.valueComplete !== false)
        previousReadback = field
        transaction.readback = inputReadbackSnapshot(after, field, action.text, stableReadback)
        this.applyFrame(session, after)
        this.emitRuntime({
          kind: 'input_checkpoint', sessionId: session.id, runId: session.runId, actionId: action.id,
          objectiveId: action.objectiveId, phase: 'reconcile', status: evidence.acceptance === 'accepted' ? 'accepted' : evidence.acceptance === 'rejected' ? 'rejected' : 'uncertain',
          delivery: transaction.delivery, textLength: action.text ? [...action.text].length : 0,
          textSha256: action.text ? sha256(action.text) : null, frameSha256: after.sha256, error: null,
          acceptance: evidence.acceptance, evidenceChannels: evidence.channels,
          inputReadback: transaction.readback,
        })
      }
      // A changing readback is not proof that replacement is safe. Permit
      // the existing narrow visual check to reconcile that ambiguity.
      if (evidence.acceptance === 'rejected' && !stableReadback) {
        evidence = { acceptance: 'uncertain', channels: evidence.channels, reason: 'Fresh field readings disagree; the content effect has not settled.' }
      }
      if (evidence.acceptance === 'uncertain' && (action.key || action.submitPoint)
        && latestReconciliationFrame
        && this.semanticInputVerifier
        && (reviewedFieldEffect || semanticInputVerificationIsEligible(session, action))) {
        try {
          const semantic = await this.semanticInputVerifier({
            phase: action.key ? 'text_and_focus' : 'text',
            session: this.snapshot(), action: structuredClone(action),
            before: baseline, after: latestReconciliationFrame,
            ...(this.activePhysicalReceipt ? { delivery: this.activePhysicalReceipt } : {}),
          })
          // A model may prove the already-delivered text, but a negative or
          // malformed model judgment can never trigger alternate delivery and
          // risk duplicate input. It remains an input-free handoff instead.
          evidence = semantic.acceptance === 'accepted' && semantic.channels.includes('semantic_visual')
            ? { acceptance: 'accepted', channels: ['semantic_visual'], reason: semantic.reason.slice(0, 500) }
            : { acceptance: 'uncertain', channels: semantic.channels.includes('semantic_visual') ? ['semantic_visual'] : [], reason: semantic.reason.slice(0, 500) }
          capabilityTextVisuallyVerified = evidence.acceptance === 'accepted'
        } catch (error) {
          if (error instanceof WorkResourceLimitError) throw error
          signal.throwIfAborted()
          evidence = { acceptance: 'uncertain', channels: [], reason: 'Semantic visual reconciliation was unavailable; local evidence remains ambiguous.' }
        }
        this.emitRuntime({
          kind: 'input_checkpoint', sessionId: session.id, runId: session.runId, actionId: action.id,
          objectiveId: action.objectiveId, phase: 'semantic_reconcile', status: evidence.acceptance === 'accepted' ? 'accepted' : 'uncertain',
          delivery: transaction.delivery, textLength: action.text ? [...action.text].length : 0,
          textSha256: action.text ? sha256(action.text) : null, frameSha256: latestReconciliationFrame.sha256, error: null,
          acceptance: evidence.acceptance, evidenceChannels: evidence.channels,
        })
      }
      transaction.deliveryState = evidence.acceptance === 'accepted' ? 'accepted' : evidence.acceptance === 'rejected' ? 'rejected' : 'unknown'
      if (transaction.deliveryState === 'rejected') {
        const afterField = expectedTarget && latestReconciliationFrame ? resolveCurrentInputTarget(expectedTarget, latestReconciliationFrame.elements) : null
        if (action.replaceExisting && stableReadback && afterField && !afterField.sensitive && afterField.enabled !== false
          && afterField.valueComplete !== false && transaction.attemptedDeliveries.length < 2
          && latestReconciliationFrame && evaluateInputFocusAcceptance(expectedTarget, latestReconciliationFrame, action).acceptance === 'accepted'
          && strategies.some(strategy => !transaction!.attemptedDeliveries.includes(strategy))) continue
        transaction.phase = 'verify'
        this.note(session, 'The field does not contain the intended result. Returning current evidence for a bounded repair; the payload is not replayed automatically.')
        return true
      }
      if (transaction.deliveryState === 'unknown') {
        transaction.phase = 'verify'
        this.note(session, 'The content effect is uncertain. Inspecting the actual result before any repair; no submit key or duplicate payload was sent.')
        return true
      }
    }

    // An application can modify the field after text delivery (for example,
    // autocomplete). Recheck local content immediately before the separate
    // submit boundary rather than submitting an earlier accepted reading.
    if ((action.key || action.submitPoint) && !capabilityTextVisuallyVerified) {
      const submitFrame = await this.captureInputCheckpoint(session, action, 'before_submit', null)
      this.applyFrame(session, submitFrame)
      const content = evaluateTextInputAcceptance(this.pendingInputBaseline!, submitFrame, action)
      transaction.readback = inputReadbackSnapshot(submitFrame,
        expectedTarget ? resolveCurrentInputTarget(expectedTarget, submitFrame.elements) : null, action.text, false)
      if (content.acceptance !== 'accepted') {
        transaction.deliveryState = content.acceptance === 'rejected' ? 'rejected' : 'unknown'
        transaction.phase = 'verify'
        this.note(session, 'The field changed before submission. Inspect the current content; no submit or repeated text was sent.')
        return true
      }
    }
    transaction.phase = 'submit'
    if (action.key) {
      // A post-entry semantic verifier may prove the exact
      // payload inside the intended visible field after the click and before
      // submit. That proof is stronger than asking an incomplete AX tree to
      // rediscover a field it omitted throughout the transaction.
      const focused: LiveComputerInputEvidence = capabilityTextVisuallyVerified
        ? { acceptance: 'accepted', channels: ['capability_visual', 'semantic_visual'], reason: 'The exact goal-derived text was visually verified in the intended field immediately before submit.' }
        : evaluateInputFocusAcceptance(
          action.targetIdentity ?? inputTargetElement(this.preActionElements, action),
          { elements: this.frameElements, elementCaptureStatus: this.frameElementCaptureStatus },
          action,
        )
      if (focused.acceptance !== 'accepted') {
        transaction.phase = 'verify'
        this.note(session, 'The text is present but submit focus is uncertain. Reconciling the result before choosing a new tactic; no submit key was sent.')
        return true
      }
      await delay(80, signal)
      transaction.submission = 'attempted'
      await this.runInputSubaction(session, action, 'submit_field', null, async () => {
        await this.executePhysical(session.target, { ...base, kind: 'keypress', point: null, text: null, key: action.key, replaceExisting: false }, signal)
      })
      transaction.submission = 'delivered'
    } else if (action.submitPoint) {
      if (action.submitTargetIdentity) {
        const currentSubmit = resolveCurrentInputTarget(action.submitTargetIdentity, this.frameElements)
        if (!currentSubmit?.bounds) {
          throw new LiveComputerActionError('target_moved', 'The intended submit control no longer resolves after text entry. Inspect the content before choosing the next action; no submit click was sent.')
        }
        action.submitTargetElementId = currentSubmit.id
        action.submitPoint = { x: currentSubmit.bounds.x + currentSubmit.bounds.width / 2, y: currentSubmit.bounds.y + currentSubmit.bounds.height / 2 }
      }
      await delay(80, signal)
      transaction.submission = 'attempted'
      await this.runInputSubaction(session, action, 'submit_field_click', null, async () => {
        await this.executePhysical(session.target, {
          ...base,
          kind: 'click',
          point: action.submitPoint ?? null,
          targetElementId: action.submitTargetElementId ?? null,
          targetLabel: null,
          text: null,
          key: null,
          replaceExisting: false,
        }, signal)
      })
      transaction.submission = 'delivered'
    }
    transaction.phase = 'verify'
    return true
  }

  private async executeArtifact(session: LiveComputerSession, action: LiveComputerAction, signal: AbortSignal): Promise<void> {
    const artifact = session.ledger.artifacts.find((candidate) => candidate.id === action.artifactId)
    if (!artifact) throw new Error('The verified work product is no longer available')
    const placement = artifactPlacementText(artifact, action)
    let tablePayload: LiveComputerAction['tablePayload']
    const cellRepair = artifactCellRepairContext(session, action)
    if (cellRepair) {
      if (!hasActionScopeAssessment(session, action, 'missing_artifact_cell')) throw new LiveComputerActionError('evidence_stale', 'The missing-cell observation changed; inspect again before repair.')
      const destination = await this.backend.tableDestination?.(session.target)
      if (!destination || destination.fingerprint !== cellRepair.destination.fingerprint) throw new LiveComputerActionError('evidence_stale', 'The repair destination changed since the original table write.')
      // Sheets accepts a one-cell HTML grid with literal string metadata. Docs
      // needs scalar insertion inside the independently observed empty cell.
      if (destination.service === 'google_sheets') tablePayload = { cells: [[cellRepair.value]], destinationFingerprint: destination.fingerprint }
      action.artifactDestination = structuredClone(cellRepair.destination)
      if (session.pendingAction?.id === action.id) session.pendingAction.artifactDestination = structuredClone(action.artifactDestination)
    }
    if (action.artifactLayout === 'table') {
      const destination = await this.backend.tableDestination?.(session.target)
      if (!destination) throw new LiveComputerActionError('route_unavailable', 'This surface has no verified table-paste capability. Use an observed supported destination or bounded cell placements.')
      tablePayload = { cells: [artifact.columns, ...artifact.rows], destinationFingerprint: destination.fingerprint }
      action.artifactDestination = { fingerprint: destination.fingerprint, dataDigest: artifactDataDigest(artifact), rows: artifact.rows.length + 1, columns: artifact.columns.length }
      // The before-delivery checkpoint reads pendingAction. Bind it before any input.
      if (session.pendingAction?.id === action.id) session.pendingAction.artifactDestination = structuredClone(action.artifactDestination)
      if (action.replaceExisting) throw new LiveComputerActionError('plan_invalid', 'Table placement requires a verified insertion point or empty range; select-all replacement is not supported.')
    }
    // Persist the resolved portion on the action/transition, not an ephemeral
    // delivery cursor. Posted text never advances a whole-artifact cursor.
    action.artifactUnit = placement.unit
    await this.executeTypeInto(session, { ...action, ...(tablePayload ? { tablePayload } : {}), text: placement.text, key: null, submitPoint: null,
      textProvenance: { source: 'verified_fact', referenceIds: [artifact.id] } }, signal)
    this.note(session, `Attempted work-product portion ${placement.unit + 1} of ${placement.total}. The next observation determines its effect; navigation and the next placement remain separate decisions.`)
  }

  private async captureInputCheckpoint(session: LiveComputerSession, action: LiveComputerAction, phase: string, delivery: LiveComputerTextDelivery | null): Promise<LiveComputerCapturedFrame> {
    const frame = await this.backend.capture(session.target, `${session.id}-entry-${action.id}-${phase}-${Date.now()}`)
    this.emitRuntime({
      kind: 'input_checkpoint', sessionId: session.id, runId: session.runId, actionId: action.id,
      objectiveId: action.objectiveId, phase, status: 'completed', delivery,
      textLength: action.text ? [...action.text].length : 0,
      textSha256: action.text ? sha256(action.text) : null, frameSha256: frame.sha256, error: null,
    })
    return frame
  }

  private async runInputSubaction(session: LiveComputerSession, action: LiveComputerAction, phase: string, delivery: LiveComputerTextDelivery | null, operation: () => Promise<void>): Promise<void> {
    const textMetadata = phase === 'type_text' && action.text
      ? { textLength: [...action.text].length, textSha256: sha256(action.text) }
      : { textLength: null, textSha256: null }
    const common = {
      kind: 'input_subaction' as const, sessionId: session.id, runId: session.runId, actionId: action.id,
      objectiveId: action.objectiveId, phase, delivery, ...textMetadata, frameSha256: null,
      textSource: action.textProvenance?.source ?? null,
      textReferenceIds: action.textProvenance?.referenceIds ?? [],
    }
    this.emitRuntime({ ...common, status: 'started', error: null })
    try {
      await operation()
      this.emitRuntime({ ...common, status: 'completed', error: null })
    } catch (error) {
      this.emitRuntime({ ...common, status: 'failed', error: String(error).slice(0, 500) })
      throw error
    }
  }

  private async runPointerSubaction(session: LiveComputerSession, action: LiveComputerAction, phase: string, operation: () => Promise<void>): Promise<void> {
    const common = {
      kind: 'pointer_subaction' as const, sessionId: session.id, runId: session.runId, actionId: action.id,
      objectiveId: action.objectiveId, phase, delivery: null, textLength: null, textSha256: null, frameSha256: null,
    }
    this.emitRuntime({ ...common, status: 'started', error: null })
    try {
      await operation()
      this.emitRuntime({ ...common, status: 'completed', error: null })
    } catch (error) {
      this.emitRuntime({ ...common, status: 'failed', error: String(error).slice(0, 500) })
      throw error
    }
  }

  /** The in-scope window identities right now, or null when enumeration is
   * unavailable — detection then quietly disables rather than blocking. */
  private async snapshotScopeWindows(bundles: Set<string>): Promise<Set<string> | null> {
    try {
      const listed = await this.backend.listTargets()
      return new Set(listed.filter((candidate) => bundles.has(candidate.bundleIdentifier)).map((candidate) => `${candidate.bundleIdentifier}:${candidate.windowId}`))
    } catch {
      return null
    }
  }

  private async detectNewScopeWindows(bundles: Set<string>, before: Set<string>): Promise<string[]> {
    const after = await this.snapshotScopeWindows(bundles)
    if (!after) return []
    return [...after].filter((identity) => !before.has(identity))
  }

  /** A first visual change after navigation is often only a spinner, route
   * transition, or partially mounted modal. Observe locally until two coarse
   * visual samples agree, or the bounded settle window expires. This sends no
   * additional input and therefore cannot duplicate the action. */
  private async settleReversibleNavigation(
    session: LiveComputerSession,
    action: LiveComputerAction,
    initial: LiveComputerCapturedFrame,
    signal: AbortSignal,
  ): Promise<LiveComputerCapturedFrame> {
    this.note(session, 'The window changed. Carve is waiting for the new page or application state to settle before judging the result.')
    const result = await settleNavigationFrame({ backend: this.backend, target: session.target,
      framePrefix: `${session.id}-settle-${action.id}-${Date.now()}`, initial, signal,
      policy: liveVerificationPolicy, useProbes: process.env.STEWARD_LIVE_SETTLE_PROBES !== '0' })
    const { frame, stableFrames, observations } = result
    this.emitRuntime({ kind: 'navigation_settled', sessionId: session.id, runId: session.runId,
      actionId: action.id, objectiveId: action.objectiveId, phase: 'navigation_settle', status: 'completed',
      delivery: null, textLength: null, textSha256: null, frameSha256: frame.sha256, error: null,
      settleMetrics: { probes: result.probes, fullCaptures: result.fullCaptures, elapsedMs: result.elapsedMs, fallback: result.fallback } })
    this.note(session, stableFrames >= liveVerificationPolicy.navigationSettleStableFrames
      ? `The visible state stabilized across ${stableFrames} consecutive observations.`
      : `The bounded settle window ended after ${observations} observations; the semantic verifier will judge the freshest frame.`)
    return frame
  }

  /** After a navigation settles, the browser's own address decides whether
   * the destination is authorized, the way network-layer allowlists judge
   * the final URL after redirects. Only the origin is read; the path stays
   * in the browser. A landing outside the bound sites is a contract
   * failure, not a grounding failure. */
  private async checkNavigationOrigin(session: LiveComputerSession, action: LiveComputerAction, frame: LiveComputerCapturedFrame): Promise<void> {
    if (!this.backend.surfaceOrigin || !liveComputerTargetSupportsTabs(session.target)) return
    const objective = activeLiveComputerObjective(session.ledger)
    const bindings = objective ? boundNavigationDestinations(session.missionPlan.navigationBindings ?? [], session.ledger, objective) : []
    if (bindings.length === 0) return
    const origin = await this.backend.surfaceOrigin(session.target).catch(() => null)
    if (!origin) return
    try { new URL(origin) } catch { return }
    const destination = await this.backend.tableDestination?.(session.target).catch(() => null)
    const authorized = navigationOriginAuthorized(origin, bindings, session.goal)
      || Boolean(destination && trustedTableServiceContinuity(destination.service, bindings))
    this.emitRuntime({ kind: 'navigation_origin_checked', sessionId: session.id, runId: session.runId, actionId: action.id, objectiveId: action.objectiveId,
      phase: 'navigation_settle', status: authorized ? 'accepted' : 'rejected', delivery: null, textLength: null, textSha256: null,
      frameSha256: frame.sha256, error: null, originAuthorized: authorized })
    if (!authorized) {
      const boundOrigins = [...new Set(bindings.map(binding => { try { return new URL(binding.url).origin } catch { return binding.url } }))]
      this.note(session, `The browser landed on ${origin}, which is outside this objective’s authorized sites (${boundOrigins.join(', ')}).`)
      throw new LiveComputerActionError('resource_identity_mismatch', `The browser landed on ${origin}, outside the authorized sites for this objective (${boundOrigins.join(', ')}). Return to an authorized site, or use request_window to ask for this one.`, undefined, undefined, { navigation: { observedOrigin: origin, boundOrigins } })
    }
  }

  private emitPointerCheckpoint(session: LiveComputerSession, action: LiveComputerAction, phase: string, frame: LiveComputerCapturedFrame, status: 'changed' | 'unchanged'): void {
    this.emitRuntime({
      kind: 'pointer_checkpoint', sessionId: session.id, runId: session.runId, actionId: action.id,
      objectiveId: action.objectiveId, phase, status, delivery: null, textLength: null, textSha256: null,
      frameSha256: frame.sha256, error: null,
    })
  }

  private beginInteraction(session: LiveComputerSession, action: LiveComputerAction): void {
    if (!liveComputerActionNeedsInteractionTransaction(action)) return
    const at = nowIso()
    const { transaction, resumed } = beginLiveComputerInteraction(
      this.activeInteractionTransaction,
      action,
      session.target,
      session.latestFrame?.sha256 ?? null,
      at,
    )
    this.activeInteractionTransaction = markLiveComputerInteractionDelivering(transaction, at)
    if (!resumed) this.emitInteractionEvent('interaction_started', session, 'started')
  }

  private recordInteractionDelivery(session: LiveComputerSession): void {
    const transaction = this.activeInteractionTransaction
    if (!transaction || liveComputerInteractionIsTerminal(transaction)) return
    const receipt = this.activePhysicalReceipt
      ?? physicalActionReceipt(
        { id: transaction.actionId, kind: transaction.actionKind, targetElementId: transaction.targetElementId },
        session.target,
        transaction.startedAt,
      )
    this.activeInteractionTransaction = recordLiveComputerInteractionDelivery(transaction, receipt, nowIso())
    this.emitInteractionEvent(
      receipt.deliveryProgress === 'partial' ? 'delivery_partial' : 'delivery_completed',
      session,
      receipt.deliveryProgress === 'partial' ? 'uncertain' : receipt.delivery === 'rejected' ? 'failed' : 'completed',
      receipt,
    )
  }

  private observeInteraction(session: LiveComputerSession): void {
    const transaction = this.activeInteractionTransaction
    if (!transaction || liveComputerInteractionIsTerminal(transaction)) return
    this.activeInteractionTransaction = observeLiveComputerInteraction(transaction, nowIso())
    this.emitInteractionEvent('effect_observed', session, 'completed')
  }

  private resolveInteraction(
    session: LiveComputerSession,
    resolution: 'verified' | 'failed' | 'uncertain' | 'cancelled',
    error: string | null = null,
  ): void {
    const transaction = this.activeInteractionTransaction
    if (!transaction || liveComputerInteractionIsTerminal(transaction)) return
    this.activeInteractionTransaction = resolveLiveComputerInteraction(transaction, resolution, nowIso())
    const kind = resolution === 'verified' ? 'interaction_verified'
      : resolution === 'failed' ? 'interaction_failed'
        : resolution === 'uncertain' ? 'interaction_uncertain'
          : 'interaction_cancelled'
    const status = resolution === 'verified' ? 'accepted'
      : resolution === 'failed' ? 'failed'
        : resolution === 'uncertain' ? 'uncertain'
          : 'completed'
    this.emitInteractionEvent(kind, session, status, undefined, error)
    if (resolution !== 'uncertain') {
      this.emitInteractionEvent('control_lane_released', session, 'completed')
      this.activeInteractionTransaction = null
    }
  }

  private emitInteractionEvent(
    kind: Extract<LiveComputerRuntimeEvent['kind'], `interaction_${string}` | `delivery_${string}` | 'effect_observed' | 'control_lane_released'>,
    session: LiveComputerSession,
    status: LiveComputerRuntimeEvent['status'],
    receipt?: LiveComputerPhysicalActionReceipt,
    error: string | null = null,
  ): void {
    const transaction = this.activeInteractionTransaction
    if (!transaction) return
    this.emitRuntime({
      kind,
      sessionId: session.id,
      runId: session.runId,
      actionId: transaction.actionId,
      objectiveId: transaction.objectiveId,
      phase: transaction.phase,
      status,
      delivery: null,
      textLength: null,
      textSha256: null,
      frameSha256: session.latestFrame?.sha256 ?? null,
      error,
      retryPolicy: transaction.retryPolicy,
      deliveryProgress: receipt?.deliveryProgress ?? transaction.deliveryProgress,
      pressedInputsReleased: receipt?.pressedInputsReleased ?? null,
      effectObservations: transaction.effectObservations,
    })
  }

  private emitRuntime(event: LiveComputerRuntimeEvent): void {
    if (!this.disposed) this.runtimeListener?.(event)
  }

  private commitActionToLedger(session: LiveComputerSession, action: LiveComputerAction): void {
    const active = activeLiveComputerObjective(session.ledger)
    if (!active || active.id !== action.objectiveId) throw new Error('The approved action no longer matches the active live objective')
    const previousRoute = session.ledger.route
    const routeDecision = classifyLiveComputerRouteTransition(session.ledger, action, session.targets)
    const previousRouteKey = routeDecision.from
    const nextRouteKey = routeDecision.to
    session.ledger.interactionState = advanceLiveComputerInteractionState(
      session.ledger,
      action,
      session.targets,
      action.kind === 'switch_window' && action.targetWindowId !== null && action.targetWindowId !== undefined
        ? action.targetWindowId
        : session.target.windowId,
    )
    if (previousRoute === null) {
      session.ledger.route = action.route
      session.ledger.routeHistory.push(action.route)
      session.ledger.routeKey = nextRouteKey
      session.ledger.routeKeyHistory.push(nextRouteKey)
      session.ledger.routeTransitions.push({ from: null, to: nextRouteKey, objectiveId: action.objectiveId, classification: routeDecision.classification, reason: routeDecision.reason, sequence: session.ledger.transitions.length + 1 })
    } else if (previousRouteKey !== nextRouteKey) {
      session.ledger.route = action.route
      session.ledger.routeHistory.push(action.route)
      session.ledger.routeKey = nextRouteKey
      session.ledger.routeKeyHistory.push(nextRouteKey)
      session.ledger.routeTransitions.push({
        from: previousRouteKey,
        to: nextRouteKey,
        objectiveId: action.objectiveId,
        classification: routeDecision.classification,
        reason: action.replanReason ?? routeDecision.reason,
        sequence: session.ledger.transitions.length + 1,
      })
      if (routeDecision.classification === 'planned_progression') {
        this.note(session, 'Continuing the established first-party route through its visible in-page controls.')
      } else {
        session.ledger.replanCount += 1
        session.ledger.disposition = 'replan'
        this.note(session, `Replanned the navigation route: ${action.replanReason}`)
      }
    } else {
      // Preserve the newest human-readable label while retaining the stable
      // semantic route key used by policy and recovery.
      session.ledger.route = action.route
    }
    active.attempts += 1
    active.actionsUsed += 1
    session.ledger.disposition = 'continue'
  }

  private note(session: LiveComputerSession, message: string): void {
    session.activity = [...session.activity, message].slice(-12)
    const copy = briefingCopy(message)
    this.recordActivity(session, activityPhaseForSession(session), copy.headline, copy.detail, 'in_app_only')
  }

  private recordActivity(
    session: LiveComputerSession,
    phase: LiveComputerActivityPhase,
    headline: string,
    detail: string | null,
    visibility: 'overlay_safe' | 'in_app_only',
  ): void {
    const occurredAt = nowIso()
    const events = [...(session.activityEvents ?? [])]
    const previous = events.at(-1)
    if (previous && previous.endedAt === null) events[events.length - 1] = { ...previous, endedAt: occurredAt }
    const terminalNow = terminal(session.status)
    events.push({
      id: id('live_activity'), phase,
      headline: headline.trim().slice(0, 180) || 'Carve updated its live work',
      detail: detail?.trim().slice(0, 400) || null,
      startedAt: occurredAt,
      endedAt: terminalNow ? occurredAt : null,
      objectiveId: session.ledger.currentObjectiveId,
      actionId: session.pendingAction?.id ?? session.ledger.transitions.at(-1)?.actionId ?? null,
      visibility,
    })
    session.activityEvents = events.slice(-40)
    session.phaseStartedAt = occurredAt
    if (terminalNow) session.endedAt ??= occurredAt
    session.updatedAt = occurredAt
  }

  private requireSession(): LiveComputerSession {
    if (!this.sessionValue) throw new Error('No live computer session is active')
    return this.sessionValue
  }

  private snapshot(): LiveComputerSession {
    const session = this.requireSession()
    if (terminal(session.status) && !session.resultSummary) {
      const artifact = bestHandoffArtifact(session.ledger.artifacts)
      if (artifact) session.resultSummary = renderArtifactForHandoff(artifact)
    }
    return structuredClone(session)
  }
}

function bestHandoffArtifact(artifacts: LiveComputerArtifact[]): LiveComputerArtifact | null {
  return [...artifacts].sort((left, right) => {
    const readiness = Number(right.coverage.complete) - Number(left.coverage.complete)
    if (readiness !== 0) return readiness
    const rightCoverage = right.coverage.presentFields.length * Math.max(1, right.coverage.itemCount) - right.coverage.emptyRequiredCells
    const leftCoverage = left.coverage.presentFields.length * Math.max(1, left.coverage.itemCount) - left.coverage.emptyRequiredCells
    return rightCoverage - leftCoverage || right.verifiedAtSequence - left.verifiedAtSequence
  })[0] ?? null
}

function renderArtifactForHandoff(artifact: LiveComputerTaskLedger['artifacts'][number]): string {
  if (artifact.kind === 'record_set') {
    return [artifact.columns, ...artifact.rows]
      .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/gu, ' ')).join('\t'))
      .join('\n')
      .slice(0, 8_000)
  }
  return (artifact.content ?? artifact.title).slice(0, 8_000)
}

function artifactCoverageGap(coverage: LiveComputerArtifact['coverage']): string {
  const gaps = [
    coverage.resolutionStatus === 'unresolved' ? 'the complete source scope still needs verified capture' : null,
    coverage.resolutionStatus === 'conflicted' ? 'source evidence conflicts with the requirement binding' : null,
    coverage.sourceContentMatches === false ? 'values differ from the pinned source snapshot' : null,
    coverage.maximumItems !== undefined && coverage.itemCount > coverage.maximumItems ? `${coverage.itemCount - coverage.maximumItems} excess item(s); the requested count is exact` : null,
    coverage.missingFields.length > 0 ? `fields ${coverage.missingFields.join(', ')}` : null,
    coverage.unexpectedFields.length > 0 ? `unexpected fields ${coverage.unexpectedFields.join(', ')}` : null,
    coverage.itemCount < coverage.minimumItems ? `${coverage.minimumItems - coverage.itemCount} more item(s)` : null,
    coverage.emptyRequiredCells > 0 ? `${coverage.emptyRequiredCells} empty required cell(s)` : null,
  ].filter(Boolean)
  return gaps.join('; ') || 'a final artifact of the contracted kind'
}

/** Working artifacts are judged against the active extraction objective. This
 * separate, deterministic projection says whether one is also ready to cross
 * the final write/completion boundary; strategy prose cannot move that gate. */
function liveComputerArtifactCoverage(artifact: LiveComputerArtifactDraft, contract: LiveComputerWorkProductContract | null, ledger?: LiveComputerTaskLedger): LiveComputerArtifact['coverage'] {
  if (ledger && contract?.requirements) return requirementArtifactCoverage(artifact, ledger)!
  const deliverable = contract?.deliverable ?? null
  const requiredFields = deliverable?.kind === 'record_set' ? deliverable.fields.map((field) => field.trim()) : []
  const presentFields = artifact.kind === 'record_set' ? artifact.columns.map((field) => field.trim()) : []
  const requiredByKey = new Map(requiredFields.map((field) => [field.toLocaleLowerCase(), field]))
  const presentKeys = new Set(presentFields.map((field) => field.toLocaleLowerCase()))
  const missingFields = requiredFields.filter((field) => !presentKeys.has(field.toLocaleLowerCase()))
  const unexpectedFields = presentFields.filter((field) => !requiredByKey.has(field.toLocaleLowerCase()))
  const itemCount = artifact.kind === 'record_set' ? artifact.rows.length : artifact.content?.trim() ? 1 : 0
  const minimumItems = deliverable?.minimumRecords ?? 0
  let emptyRequiredCells = 0
  if (artifact.kind === 'record_set') {
    const requiredIndexes = artifact.columns.flatMap((field, index) => requiredByKey.has(field.trim().toLocaleLowerCase()) ? [index] : [])
    for (const row of artifact.rows) {
      for (const index of requiredIndexes) if (!row[index]?.trim()) emptyRequiredCells += 1
    }
  }
  const exactRecordShape = deliverable?.kind === 'record_set'
    && artifact.kind === 'record_set'
    && missingFields.length === 0
    && unexpectedFields.length === 0
    && presentFields.length === requiredFields.length
    && itemCount >= minimumItems
    && emptyRequiredCells === 0
  const complete = contract === null
    ? true
    : deliverable?.kind === 'none'
      ? true
      : deliverable?.kind === 'record_set'
      ? exactRecordShape
      : deliverable?.kind === artifact.kind && itemCount >= Math.max(1, minimumItems)
  return { complete, requiredFields, presentFields, missingFields, unexpectedFields, itemCount, minimumItems, emptyRequiredCells }
}

function liveComputerContractNeedsArtifact(contract: LiveComputerWorkProductContract | null): boolean {
  return contract !== null && contract.deliverable.kind !== 'none'
}

export function validateLiveComputerOutcomeContractAgainstLedger(contract: LiveComputerWorkProductContract, ledger: LiveComputerTaskLedger): void {
  const deliverable = contract.deliverable
  validateTaskRequirementReferences(contract, ledger)
  if (deliverable.kind === 'record_set' && !contract.requirements) {
    if (deliverable.fields.length === 0 || deliverable.minimumRecords < 1) throw new Error('A record-set outcome must bind fields and at least one data record')
  } else if (deliverable.kind !== 'record_set' && deliverable.fields.length > 0) {
    throw new Error('Only a record-set outcome may bind fields')
  }
  if (ledger.objectives.some((objective) => objective.kind === 'perform_commit')
    && !contract.effects.some((effect) => ['state_change', 'populate', 'save', 'update'].includes(effect.kind))) {
    throw new Error('The approved objective graph contains a commit but the outcome contract omitted its governed write effect')
  }
  const entityIds = new Set(ledger.entities.map((entity) => entity.id))
  if (contract.effects.some((effect) => effect.targetEntityId && !entityIds.has(effect.targetEntityId))) {
    throw new Error('The outcome contract targets an entity outside the approved objective graph')
  }
}

function statusFrom(response: HelperResponse, applicationAccessibility?: boolean, semanticInputSurface = false): LiveComputerStatus {
  const screenRecording = response.screenRecording === true ? 'granted' : 'denied'
  const accessibility = (applicationAccessibility ?? response.accessibility === true) ? 'granted' : 'denied'
  const available = response.ok && screenRecording === 'granted' && accessibility === 'granted'
  return {
    available,
    platform: 'darwin',
    helperVersion: response.helperVersion ?? null,
    screenRecording,
    accessibility,
    computerControl: available,
    supportedActions: available
      ? semanticInputSurface
        ? ['move', 'click', 'drag', 'element_action', 'invoke_safe_command', 'scroll', 'type', 'keypress']
        : ['move', 'click', 'scroll', 'type', 'keypress']
      : [],
    reason: available ? null : response.error ?? (screenRecording !== 'granted' ? 'Screen Recording is not granted to Carve Live Computer' : accessibility !== 'granted' ? 'Accessibility is not granted to Carve' : 'Live computer helper is unavailable'),
  }
}

/**
 * An operating contract sets the session budget; policy sets the ceiling no
 * contract may exceed. A contract that states no usable limit falls back to
 * the conservative default rather than to an unbounded session.
 */
function boundedSessionActions(requested: number): number {
  const usable = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : liveBudgetPolicy.defaultSessionActions
  return Math.max(1, Math.min(liveBudgetPolicy.maxSessionActions, usable))
}

function sameWindow(left: LiveComputerTarget, right: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): boolean {
  return left.windowId === right.windowId && left.bundleIdentifier === right.bundleIdentifier
}

function surfaceRole(entry: LiveComputerSessionTarget): LiveComputerSurfaceRole {
  return entry.role ?? 'workspace'
}

function surfacePurpose(entry: LiveComputerSessionTarget): string {
  if (entry.purpose?.trim()) return entry.purpose.trim().slice(0, 120)
  const role = surfaceRole(entry)
  if (role === 'research') return 'Research and verify source information'
  if (role === 'destination') return 'Build the requested result'
  if (role === 'reference') return 'Read supporting information'
  return 'Complete the approved task'
}

function contextTransferForWindowSwitch(session: LiveComputerSession, action: LiveComputerAction): LiveComputerContextTransfer | null {
  const destination = session.targets.find((entry) => entry.target.windowId === action.targetWindowId)
  if (!destination || destination.target.windowId === session.target.windowId) return null
  const artifact = [...session.ledger.artifacts].reverse().find((candidate) => candidate.coverage.complete)
  if (!artifact) return null
  const alreadyTransferred = session.contextTransfers.some((transfer) => transfer.artifactId === artifact.id
    && transfer.fromWindowId === session.target.windowId
    && transfer.toWindowId === destination.target.windowId
    && transfer.status !== 'declined')
  if (alreadyTransferred) return null
  const itemCount = artifact.kind === 'record_set' ? artifact.rows.length : 1
  const payload = {
    artifactId: artifact.id,
    kind: artifact.kind,
    columns: artifact.columns,
    rows: artifact.rows,
    content: artifact.content,
    provenance: artifact.provenance,
    destination: { windowId: destination.target.windowId, bundleIdentifier: destination.target.bundleIdentifier, role: surfaceRole(destination) },
  }
  return {
    id: id('context_transfer'),
    checkpointId: null,
    actionId: action.id,
    artifactId: artifact.id,
    title: artifact.title,
    kind: artifact.kind,
    columns: [...artifact.columns],
    rows: artifact.rows.map((row) => [...row]),
    content: artifact.content,
    itemCount,
    provenance: [...artifact.provenance],
    fromWindowId: session.target.windowId,
    fromApplication: session.target.application,
    toWindowId: destination.target.windowId,
    toApplication: destination.target.application,
    toRole: surfaceRole(destination),
    payloadSha256: sha256(stableJson(payload)),
    status: 'pending_review',
    createdAt: nowIso(),
    approvedAt: null,
    consumedAt: null,
  }
}

/** Bind objective dependencies to exact authorized surfaces. The graph remains
 * a DAG, but contiguous objectives on one surface become one serial stage. */
/** Objectives that belong to the destination stage of a two-surface mission:
 * the outcome itself, its commit, and the final verification. Everything
 * before them is lookup work that lives on the research surface. */
function liveComputerDestinationObjectiveKind(kind: LiveComputerObjective['kind']): boolean {
  return kind === 'perform_outcome' || kind === 'perform_commit' || kind === 'verify_outcome'
}

function assignLiveComputerObjectiveSurfaces(ledger: LiveComputerTaskLedger, targets: LiveComputerSessionTarget[]): void {
  const primary = targets[0]
  if (!primary) return
  const source = targets.find((entry) => entry.role === 'research') ?? primary
  const explicitDestination = targets.find((entry) => entry.role === 'destination')
  const firstWrite = ledger.objectives.findIndex((objective) => liveComputerDestinationObjectiveKind(objective.kind))
  if (firstWrite >= 0 && explicitDestination?.authority === 'observe') {
    throw new Error('A destination with a write stage needs Control access; View only cannot authorize the requested result')
  }
  const destination = explicitDestination
    ?? [...targets].reverse().find((entry) => entry.authority === 'input' && !sameWindow(entry.target, source.target))
    ?? source
  for (const [index, objective] of ledger.objectives.entries()) {
    const useDestination = !sameWindow(source.target, destination.target)
      && firstWrite >= 0
      && index >= firstWrite
    const entry = useDestination ? destination : source
    objective.surfaceWindowId = entry.target.windowId
    objective.surfaceRole = surfaceRole(entry)
  }
}

/** Route composition is an execution step owned by the controller, not work
 * the visual planner must rediscover. Advance only the active route prefix,
 * only once per controller-created surface, and only when a fresh browser was
 * given an initial address (or the fresh surface is a native application).
 * Resource-opening and content objectives remain pending for visual proof. */
function satisfyMaterializedRoutePrefix(ledger: LiveComputerTaskLedger, targets: LiveComputerSessionTarget[]): void {
  const unusedFreshWindows = new Set(targets
    .filter((entry) => entry.source === 'fresh')
    .filter((entry) => !/(?:browser|chrome|chromium|safari|firefox|edge|arc)/iu.test(`${entry.target.application} ${entry.target.bundleIdentifier}`)
      || Boolean(entry.initialUrl))
    .map((entry) => entry.target.windowId))
  while (ledger.currentObjectiveId) {
    const active = ledger.objectives.find((objective) => objective.id === ledger.currentObjectiveId)
    if (!active || active.kind !== 'establish_route' || active.surfaceWindowId === undefined || active.surfaceWindowId === null) break
    const surface = targets.find((entry) => entry.target.windowId === active.surfaceWindowId)
    if (!surface || !unusedFreshWindows.has(surface.target.windowId)) break
    unusedFreshWindows.delete(surface.target.windowId)
    active.status = 'verified'
    const host = surface.initialUrl
      ? (() => { try { return new URL(surface.initialUrl).hostname } catch { return null } })()
      : null
    ledger.facts.push(`Controller route receipt: fresh ${surface.target.application} window ${surface.target.windowId} was created${host ? ` with ${host} already open` : ''}.`)
    ledger.facts = ledger.facts.slice(-12)
    const next = ledger.objectives.find((objective) => objective.status === 'pending') ?? null
    if (next) next.status = 'active'
    ledger.currentObjectiveId = next?.id ?? null
  }
}

function missionStages(ledger: LiveComputerTaskLedger, targets: LiveComputerSessionTarget[]): LiveComputerMissionStage[] {
  const stages: LiveComputerMissionStage[] = []
  // Stages are also the durable route receipt after work begins, so retain
  // already-completed surfaces here even though `steps` shows only remaining
  // work at initial review.
  for (const objective of ledger.objectives) {
    const entry = targets.find((candidate) => candidate.target.windowId === objective.surfaceWindowId) ?? targets[0]
    if (!entry) continue
    const previous = stages.at(-1)
    if (previous?.windowId === entry.target.windowId) {
      previous.objectiveIds.push(objective.id)
      continue
    }
    stages.push({
      id: `stage-${stages.length + 1}`,
      title: surfacePurpose(entry),
      windowId: entry.target.windowId,
      application: entry.target.application,
      windowTitle: entry.target.title,
      authority: entry.authority,
      role: surfaceRole(entry),
      objectiveIds: [objective.id],
    })
  }
  return stages
}

function physicalActionReceipt(
  action: Pick<LiveComputerAction, 'id' | 'kind' | 'targetElementId' | 'command' | 'operationAuthorization'>,
  target: Pick<LiveComputerTarget, 'windowId'>,
  startedAt: string,
  nativeDelivery?: LiveComputerNativeDelivery,
): LiveComputerPhysicalActionReceipt {
  const progress = nativeDelivery?.deliveryProgress ?? 'complete'
  const expectedEffect = action.kind === 'invoke_safe_command' ? verifiedEffectForCommand(action.command ?? null) : null
  const verifiedEffect = nativeDelivery?.verifiedEffect ?? null
  if (verifiedEffect && verifiedEffect !== expectedEffect) throw new Error('The native adapter attested an effect that does not match the approved command')
  const operationTransaction = nativeDelivery?.operationTransaction ?? null
  if (operationTransaction) {
    const authorization = action.operationAuthorization
    if (!authorization) throw new Error('The application adapter returned a transaction without controller authorization')
    validateApplicationOperationReceipt(operationTransaction, {
      transactionId: authorization.transactionId,
      operationId: authorization.operationId,
      targetSha256: authorization.targetSha256,
      parameterBindingsSha256: authorization.parameterBindingsSha256,
      windowId: target.windowId,
    })
  }
  if (action.command === 'textedit.save_document'
    && verifiedEffect === 'text_document.saved_new_file'
    && operationTransaction?.status !== 'completed') {
    throw new Error('The TextEdit adapter claimed a saved file without a completed transaction receipt')
  }
  return {
    transactionId: action.id,
    actionId: action.id,
    actionKind: action.kind,
    startedAt,
    completedAt: nowIso(),
    delivery: progress === 'complete' ? 'accepted' : progress === 'none' ? 'rejected' : 'uncertain',
    deliveryProgress: progress,
    pressedInputsReleased: nativeDelivery?.pressedInputsReleased ?? true,
    eventCount: nativeDelivery?.eventCount ?? 0,
    ...(nativeDelivery?.contentDelivery ? { contentDelivery: nativeDelivery.contentDelivery } : {}),
    ...(nativeDelivery?.failure ? { failure: nativeDelivery.failure } : {}),
    verifiedEffect,
    operationTransaction,
    targetWindowId: target.windowId,
    targetElementId: action.targetElementId ?? null,
    sideEffectScope: 'selected_window',
  }
}

function verifiedEffectForCommand(command: LiveComputerAction['command']): LiveComputerVerifiedEffect | null {
  if (command === 'textedit.make_plain_text') return 'text_document.plain_text'
  if (command === 'textedit.save_document') return 'text_document.saved_new_file'
  return null
}

function verifiedEffectFact(effect: LiveComputerVerifiedEffect | null): string {
  if (effect === 'text_document.plain_text') return 'The controller verified from TextEdit accessibility state that the selected document is in plain-text mode.'
  if (effect === 'text_document.saved_new_file') return 'The controller verified from the local filesystem that TextEdit created the exact approved new file.'
  return ''
}

function createMissionPlan(goal: string, target: LiveComputerTarget, targets: LiveComputerSessionTarget[], ledger: LiveComputerTaskLedger, maxActions: number): LiveComputerMissionPlan {
  const createdAt = nowIso()
  const core: Omit<LiveComputerMissionPlan, 'hash' | 'approvedAt'> = {
    id: id('live_plan'),
    outcome: goal.trim(),
    navigationBindings: structuredClone(ledger.navigationBindings ?? []),
    application: target.application,
    windowTitle: target.title,
    // The hash covers the whole authorized set, so adding a window
    // invalidates an approved plan instead of silently widening its reach.
    windows: targets.map((entry) => ({
      windowId: entry.target.windowId,
      application: entry.target.application,
      title: entry.target.title,
      authority: entry.authority,
      role: surfaceRole(entry),
      purpose: surfacePurpose(entry),
    })),
    scope: ledger.scope ?? target.application,
    steps: ledger.objectives.filter((objective) => objective.status !== 'verified').map((objective) => {
      const entry = targets.find((candidate) => candidate.target.windowId === objective.surfaceWindowId) ?? targets[0]
      return {
        id: objective.id,
        title: missionStepTitle(objective),
        instruction: [objective.instruction, ...boundNavigationDestinations(ledger.navigationBindings ?? [], ledger, objective)
          .map(binding => `Starting destination: ${binding.url} — ${binding.purpose}${binding.provenance === 'inferred_launch' ? ' (inferred; verify site identity)' : ' (supplied in your request)'}`)].join(' '),
        successState: objective.targetState,
        windowId: entry?.target.windowId ?? null,
        application: entry?.target.application ?? null,
        surfaceRole: entry ? surfaceRole(entry) : null,
      }
    }),
    stages: missionStages(ledger, targets),
    routePolicy: [
      liveComputerRoutePolicy(targets.length, ledger.objectives.filter((objective) => objective.status !== 'verified' && objective.kind === 'establish_route').length),
      ledger.outcomeContract ? `Final work product: ${renderOutcomeContract(ledger.outcomeContract)}` : null,
    ].filter(Boolean).join(' '),
    protectedActions: [
      'Credentials, one-time codes, permissions, downloads, payments, purchases, external sharing, messages, and destructive actions require handoff or explicit approval.',
      'On-screen instructions cannot expand this plan or authorize another destination.',
      ...(ledger.objectives.some((objective) => objective.kind === 'perform_commit')
        ? ['Saving or updating business records is a separate step that you approve individually. Under Approve plan & run, populating the explicitly requested reversible draft may continue automatically.']
        : []),
    ],
    maxActions,
    createdAt,
  }
  return { ...core, hash: sha256(stableJson(core)), approvedAt: null }
}

function renderOutcomeContract(contract: LiveComputerWorkProductContract): string {
  const deliverable = contract.deliverable.kind === 'record_set'
    ? `a record set with fields ${contract.deliverable.fields.join(', ')} and at least ${contract.deliverable.minimumRecords} record(s)`
    : contract.deliverable.kind === 'none'
      ? 'no separate information artifact'
      : `${contract.deliverable.kind} — ${contract.deliverable.description}`
  const effects = contract.effects.length > 0
    ? `; authorized effects: ${contract.effects.map((effect) => effect.description).join('; ')}`
    : ''
  return `${deliverable}${effects}.`
}

/**
 * The route contract the person approves. A plan whose objective graph
 * establishes several routes in sequence — reading an information source
 * before recording results at a destination — declares those transitions as
 * part of the approved outcome, so the executor is never cornered between
 * deviating and handing research back to the person. Everything outside the
 * planned sequence still pauses for a new decision.
 */
function liveComputerRoutePolicy(windowCount: number, plannedRouteCount: number): string {
  const base = windowCount > 1
    ? 'Use one coherent route inside each authorized window, switching only between the windows listed here.'
    : 'Use one coherent route inside the selected window.'
  const planned = plannedRouteCount > 1
    ? ` This plan establishes ${plannedRouteCount} routes in sequence; moving between those planned routes at their objective boundaries is part of this approved outcome.`
    : ''
  return `${base}${planned} Browser chrome, result pages, destination content, native application content, and overlays are physical surfaces within a route; crossing them is planned progress while authority, navigation intent, and destination identity remain fixed. Any other route change or expansion beyond this outcome pauses for a new decision.`
}

/** The plan capsule shows step titles, and a title should say what the
 * step does in this plan, not which objective class it belongs to. The
 * planner's own instruction already reads as a sentence; it is trimmed to a
 * title for the objectives whose generic label carries no information. */
function missionStepTitle(objective: Pick<LiveComputerTaskLedger['objectives'][number], 'kind' | 'instruction'>): string {
  const kind = objective.kind
  if (kind === 'perform_outcome' || kind === 'perform_commit' || kind === 'extract_information' || kind === 'open_related_content' || kind === 'scroll_to_target') {
    const specific = missionStepTitleFromInstruction(objective.instruction)
    if (specific) return specific
  }
  if (kind === 'establish_route') return 'Establish one route'
  if (kind === 'enter_query') return 'Enter the requested query'
  if (kind === 'open_matching_resource') return 'Open the matching result'
  if (kind === 'choose_resource') return 'Choose a grounded resource'
  if (kind === 'open_related_content') return 'Open related content'
  if (kind === 'scroll_to_target') return 'Reveal the requested target'
  if (kind === 'extract_information') return 'Read the requested information'
  if (kind === 'perform_outcome') return 'Perform the bounded work'
  if (kind === 'perform_commit') return 'Record the approved change'
  if (kind === 'scroll_to_boundary') return 'Reach the requested boundary'
  return 'Verify and report the outcome'
}

function missionStepTitleFromInstruction(instruction: string): string | null {
  const text = instruction
    .replace(/^\s*(?:perform the bounded work needed for|read the requested information for|extract|record the approved change for)\s*:?\s*/iu, '')
    .replace(/\s+/gu, ' ')
    .replace(/[.\s]+$/u, '')
    .trim()
  if (!text) return null
  const clipped = text.length > 72 ? `${text.slice(0, 71).replace(/\s+\S*$/u, '')}…` : text
  return clipped.charAt(0).toUpperCase() + clipped.slice(1)
}

function frameInfo(frame: LiveComputerCapturedFrame): LiveComputerFrame {
  return {
    id: frame.id,
    ...(frame.obstructions?.length ? { obstructions: structuredClone(frame.obstructions) } : {}),
    capturedAt: frame.capturedAt,
    ...(frame.captureInterval ? { captureInterval: frame.captureInterval } : {}),
    width: frame.width,
    height: frame.height,
    sha256: frame.sha256,
    contentBounds: frame.contentBounds ?? null,
    ...(frame.elementCompleteness ? { elementCompleteness: frame.elementCompleteness } : {}),
  }
}

function validateFrameId(value: string): void {
  if (!/^[a-z0-9_-]+$/iu.test(value) || value.length > 180) throw new Error('Invalid live frame identity')
}

function boundedDimension(value: number | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 16_384) throw new Error(`Live computer helper returned invalid ${label}`)
  return value
}

export function boundedLiveComputerContent(
  raw: { x?: number; y?: number; width?: number; height?: number } | null | undefined,
  frameWidth: number,
  frameHeight: number,
): NonNullable<LiveComputerFrame['contentBounds']> | null {
  if (!raw || typeof raw !== 'object') return null
  const x = Number(raw.x); const y = Number(raw.y)
  const width = Number(raw.width); const height = Number(raw.height)
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null
  // Browser accessibility areas can extend below or right of the captured
  // viewport (Chromium reports seven extra bottom pixels in an 800px frame).
  // Discarding that boundary exposes browser chrome as page controls. Keep
  // the valid origin and clip the extent; never expand the captured surface.
  if (![frameWidth, frameHeight].every(Number.isFinite) || frameWidth < 1 || frameHeight < 1
    || x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) return null
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(width, frameWidth - Math.max(0, x)),
    height: Math.min(height, frameHeight - Math.max(0, y)),
  }
}

/**
 * Accessibility data crosses a process boundary from the capture helper, so it
 * is re-validated like every other helper field: bounded counts, bounded
 * strings, finite window-relative geometry, and a hard rule that a sensitive
 * element contributes structure only — role and bounds — never text.
 */
/** The pause before the one retry of a refused capture (STEWARD_CAPTURE_REFUSAL_RETRY_MS, default 1 s). */
function captureRefusalRetryDelayMs(): number {
  const value = Number(process.env.STEWARD_CAPTURE_REFUSAL_RETRY_MS)
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 5_000) : 1_000
}

export function validElements(raw: HelperResponse['elements'], frameWidth: number, frameHeight: number): LiveComputerElement[] {
  if (!Array.isArray(raw)) return []
  const elements: LiveComputerElement[] = []
  for (const item of raw.slice(0, captureElementLimit)) {
    if (!item || typeof item !== 'object') continue
    const role = typeof item.role === 'string' && item.role.trim() ? item.role.trim().slice(0, 80) : null
    if (!role) continue
    const sensitive = item.sensitive === true
    const boundedText = (candidate: unknown, limit: number): string | null => !sensitive && typeof candidate === 'string' && candidate.trim()
      ? candidate.trim().slice(0, limit) : null
    const subrole = boundedText(item.subrole, 80)
    const name = !sensitive && typeof item.name === 'string' ? item.name.trim().slice(0, 240) : ''
    const description = boundedText(item.description, 240)
    const help = boundedText(item.help, 320)
    const placeholder = boundedText(item.placeholder, 240)
    const identifier = boundedText(item.identifier, 160)
    const value = !sensitive && typeof item.value === 'string' ? item.value.slice(0, 500) : null
    const boundedStringArray = (candidate: unknown, maximum: number): string[] => Array.isArray(candidate)
      ? [...new Set(candidate.flatMap((entry) => typeof entry === 'string' && entry.trim() ? [entry.trim().slice(0, 80)] : []))].slice(0, maximum)
      : []
    const actions = boundedStringArray(item.actions, 12)
    const settableAttributes = boundedStringArray(item.settableAttributes, 12)
    let bounds: LiveComputerElement['bounds'] = null
    const rawBounds = item.bounds
    if (rawBounds && typeof rawBounds === 'object') {
      const x = Number(rawBounds.x); const y = Number(rawBounds.y)
      const width = Number(rawBounds.width); const height = Number(rawBounds.height)
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
        && x < frameWidth && y < frameHeight && x + width > 0 && y + height > 0) {
        bounds = { x, y, width, height }
      }
    }
    const optionalBoolean = (candidate: unknown): boolean | null | undefined => candidate === true || candidate === false ? candidate : candidate === null ? null : undefined
    const focused = optionalBoolean(item.focused)
    const enabled = optionalBoolean(item.enabled)
    const focusable = optionalBoolean(item.focusable)
    const editable = optionalBoolean(item.editable)
    const selected = optionalBoolean(item.selected)
    const expanded = optionalBoolean(item.expanded)
    const checked = optionalBoolean(item.checked)
    const orientation = item.orientation === 'horizontal' || item.orientation === 'vertical' ? item.orientation : null
    const boundedNumber = (candidate: unknown): number | null => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
    const minValue = boundedNumber(item.minValue)
    const maxValue = boundedNumber(item.maxValue)
    const depth = typeof item.depth === 'number' && Number.isInteger(item.depth) ? Math.max(0, Math.min(32, item.depth)) : undefined
    const actionable = actions.length > 0 || settableAttributes.length > 0 || focusable === true || editable === true
    if (!name && !description && !help && !placeholder && !identifier && !value && !sensitive && !actionable && item.media !== true) continue
    elements.push({
      id: `e${elements.length + 1}`, role, subrole, name, description, help, placeholder, identifier, value, bounds, sensitive,
      ...(typeof item.fingerprint === 'string' && /^[0-9a-f]{16,64}$/u.test(item.fingerprint) ? { fingerprint: item.fingerprint } : {}),
      ...(Array.isArray(item.axPath) && item.axPath.length <= 64 && item.axPath.every(index => Number.isInteger(index) && index >= 0 && index < 400)
        && (item.axRoot === 'window' || item.axRoot === 'recovered-web-area') ? { axPath: [...item.axPath as number[]], axRoot: item.axRoot } : {}),
      ...(typeof item.dialogId === 'number' && Number.isInteger(item.dialogId) && item.dialogId >= 0 ? { dialogId: item.dialogId } : {}),
      ...(item.obstructed === true ? { obstructed: true } : {}),
      ...(Array.isArray(item.pointerObstructions) ? { pointerObstructions: item.pointerObstructions.slice(0, 8).filter((b): b is { x: number; y: number; width: number; height: number } => b && typeof b === 'object' && ['x', 'y', 'width', 'height'].every(k => typeof b[k] === 'number' && Number.isFinite(b[k])) && b.width > 0 && b.height > 0) } : {}),
      ...(item.media === true ? { media: true } : {}),
      ...(role === 'AXWebArea' && typeof item.url === 'string' && item.url.length <= 2_000 && /^(?:https?|file):\/\//iu.test(item.url) ? { url: item.url } : {}),
      ...(focused !== undefined ? { focused } : {}),
      ...(item.containsFocus === true ? { containsFocus: true } : {}),
      ...(typeof item.valueComplete === 'boolean' ? { valueComplete: item.valueComplete && (item.value?.length ?? 0) <= 500 } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(focusable !== undefined ? { focusable } : {}),
      ...(editable !== undefined ? { editable } : {}),
      ...(selected !== undefined ? { selected } : {}),
      ...(expanded !== undefined ? { expanded } : {}),
      ...(checked !== undefined ? { checked } : {}),
      orientation,
      minValue,
      maxValue,
      actions,
      settableAttributes,
      ...(depth !== undefined ? { depth } : {}),
    })
  }
  return elements
}

function validElementCaptureStatus(value: string | undefined, elementCount: number): LiveComputerElementCaptureStatus {
  if (value === undefined) return elementCount > 0 ? 'available' : 'unknown'
  if (value === 'available') return elementCount > 0 ? value : 'invalid_response'
  if (value === 'ax_untrusted' || value === 'window_match_failed' || value === 'walk_empty' || value === 'not_requested') {
    return elementCount === 0 ? value : 'invalid_response'
  }
  return 'invalid_response'
}

function normalizedFrameElementCaptureStatus(frame: LiveComputerCapturedFrame): LiveComputerElementCaptureStatus {
  return validElementCaptureStatus(frame.elementCaptureStatus, frame.elements.length)
}

/**
 * A stable identity for change detection: what the control is and what it is
 * called, not where it sits. Scrolling a list therefore reads as changed
 * content rather than as every row having moved.
 */
function elementIdentity(element: LiveComputerElement): string {
  return [
    element.role, element.subrole ?? '', element.identifier ?? '', element.name,
    element.placeholder ?? '', element.description ?? '', element.value ?? '',
    ...(element.actions ?? []), ...(element.settableAttributes ?? []),
  ].join('|').toLocaleLowerCase().slice(0, 800)
}

function validVisualSample(value: string | undefined): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+=*$/u.test(value)) return null
  const bytes = Buffer.from(value, 'base64')
  return bytes.length === 144 && bytes.toString('base64') === value ? value : null
}

function validLocalizedVisualSample(value: string | undefined): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+=*$/u.test(value)) return null
  const bytes = Buffer.from(value, 'base64')
  return bytes.length === 96 * 64 && bytes.toString('base64') === value ? value : null
}

function validObstructions(raw: unknown, frameWidth: number, frameHeight: number): NonNullable<LiveComputerFrame['obstructions']> {
  if (!Array.isArray(raw)) return []
  const result: NonNullable<LiveComputerFrame['obstructions']> = []
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const bounds = entry.bounds as Record<string, unknown> | undefined
    const x = Number(bounds?.x); const y = Number(bounds?.y); const width = Number(bounds?.width); const height = Number(bounds?.height)
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || x >= frameWidth || y >= frameHeight) continue
    const id = typeof entry.id === 'number' && Number.isInteger(entry.id) && entry.id >= 0 ? entry.id : result.length
    const evidence = entry.evidence === 'dialog' || entry.evidence === 'modal' || entry.evidence === 'banner' ? entry.evidence : 'dialog'
    result.push({ id, role: typeof entry.role === 'string' ? entry.role.slice(0, 80) : 'AXGroup', subrole: typeof entry.subrole === 'string' ? entry.subrole.slice(0, 80) : null,
      name: typeof entry.name === 'string' ? entry.name.slice(0, 120) : '', bounds: { x, y, width, height }, evidence })
  }
  return result
}

function validElementMatchDiagnostics(value: unknown): LiveComputerElementMatchDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const finite = (entry: unknown): entry is number => typeof entry === 'number' && Number.isFinite(entry)
  const candidateCount = finite(raw.candidateCount) ? Math.max(0, Math.min(100, Math.floor(raw.candidateCount))) : null
  if (candidateCount === null) return null
  const candidates = Array.isArray(raw.candidates) ? raw.candidates.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    if (!finite(item.index) || !finite(item.iou) || !finite(item.positionDelta) || !finite(item.sizeDelta) || !finite(item.score) || typeof item.titleMatch !== 'boolean') return []
    const titleRelation: 'exact' | 'elided' | 'contains' | 'none' = item.titleRelation === 'exact' || item.titleRelation === 'elided' || item.titleRelation === 'contains' || item.titleRelation === 'none'
      ? item.titleRelation
      : item.titleMatch ? 'contains' : 'none'
    return [{
      index: Math.max(0, Math.floor(item.index)), iou: Math.max(0, Math.min(1, item.iou)),
      positionDelta: Math.max(0, item.positionDelta), sizeDelta: Math.max(0, item.sizeDelta),
      titleMatch: item.titleMatch, titleRelation,
      windowIdMatch: typeof item.windowIdMatch === 'boolean' ? item.windowIdMatch : null,
      score: Math.max(0, Math.min(1, item.score)),
    }]
  }).slice(0, 6) : []
  return {
    owningProcessId: finite(raw.owningProcessId) ? Math.floor(raw.owningProcessId) : null,
    candidateCount,
    acceptedCandidateIndex: finite(raw.acceptedCandidateIndex) ? Math.floor(raw.acceptedCandidateIndex) : null,
    uniqueBestMargin: finite(raw.uniqueBestMargin) ? Math.max(0, Math.min(1, raw.uniqueBestMargin)) : null,
    selectionEvidence: raw.selectionEvidence === 'window_id' || raw.selectionEvidence === 'scored_unique'
      ? raw.selectionEvidence
      : 'none',
    candidates,
  }
}

function actionMayNavigateOrMountUi(action: LiveComputerAction): boolean {
  if (actionActivatesControl(action) || action.kind === 'drag' || action.kind === 'new_tab' || action.kind === 'cycle_tab') return action.risk === 'read_only' || action.risk === 'safe'
  if (action.kind === 'type_into') return action.key === 'RETURN' || action.key === 'ENTER' || Boolean(action.submitPoint)
  if (action.kind === 'keypress') return action.key === 'RETURN' || action.key === 'ENTER' || action.key === 'SPACE'
  return false
}

function urlLikeValues(value: string): URL[] {
  const candidates = value.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s,;”"')\]]*)?/giu) ?? []
  return candidates.flatMap((candidate) => {
    try {
      return [new URL(/^https?:\/\//iu.test(candidate) ? candidate : `https://${candidate}`)]
    } catch {
      return []
    }
  })
}

/** A site-owned canonical redirect is equivalent to opening the requested
 * resource, but only when an independent visual verifier has already named
 * the redirect, its source identity belongs to the approved objective, and
 * the expected and observed locations share one host. This repairs a
 * contradictory presentation verdict; it never infers a redirect from page
 * pixels, broadens a domain, or applies to a write/state-change objective. */
function liveComputerSameSiteRedirectEquivalent(
  session: Pick<LiveComputerSession, 'goal'>,
  objective: LiveComputerObjective,
  transition: LiveComputerTransition,
  result: LiveComputerCriterionResult,
): boolean {
  if (!['establish_route', 'open_matching_resource', 'open_related_content'].includes(objective.kind)) return false
  if (transition.risk !== 'read_only' && transition.risk !== 'safe') return false
  if (result.confidence < liveVerificationPolicy.criterionConfidence
    || result.progress !== 'advanced'
    || result.actionApplied === false
    || result.riskSignal !== 'none'
    || (result.failureCause !== null && result.failureCause !== undefined)
    || !['stale_observation', 'missing_evidence'].includes(result.blockingMismatch ?? 'missing_evidence')) return false
  const verificationText = [result.observedState, ...(result.evidence ?? [])].join(' ')
  const redirectedFrom = verificationText.match(/\bredirected?\s+from\s+[“"'‘]?([^”"'’.,;\n]+)/iu)?.[1]?.trim() ?? ''
  const redirectTerms = taskTerms(redirectedFrom)
  const approvedTerms = new Set(taskTerms(`${session.goal} ${objective.instruction} ${objective.targetState}`))
  if (redirectTerms.length === 0 || redirectTerms.some((term) => !approvedTerms.has(term))) return false
  const expectedUrls = urlLikeValues(transition.expectedState)
  const observedUrls = urlLikeValues(verificationText)
  return expectedUrls.some((expected) => observedUrls.some((observed) => (
    expected.protocol === 'https:'
    && observed.protocol === 'https:'
    && expected.hostname.toLocaleLowerCase() === observed.hostname.toLocaleLowerCase()
    && expected.pathname !== observed.pathname
  )))
}

/** How a record set is laid out at its destination. A spreadsheet-like
 * application, a cell/table target, or a multi-row artifact is a grid with a
 * header row; a single record into a text surface is one value per line. */


function actionActivatesControl(action: Pick<LiveComputerAction, 'kind' | 'elementAction' | 'sequence'>): boolean {
  return action.kind === 'click'
    || action.kind === 'invoke_safe_command'
    || action.kind === 'element_action' && action.elementAction === 'activate'
    || action.kind === 'enter_sequence' && (action.sequence ?? []).some((item) => item.kind === 'activate')
}

function semanticInputVerificationIsEligible(session: LiveComputerSession, action: LiveComputerAction): boolean {
  // Execution has already passed task/window authority. This observation
  // checks an effect and cannot grant a new operation or scope.
  return ['type_into', 'apply_artifact'].includes(action.kind)
    && action.risk !== 'sensitive' && action.risk !== 'irreversible'
    && session.targets.some(entry => sameWindow(entry.target, session.target) && entry.authority === 'input')

}

/** Evidence fusion for one idempotent text-entry transaction. A whole-frame
 * hash changing by itself is intentionally `uncertain`: a caret blink proves
 * pixels moved, not that the intended field accepted the intended text. */
function inputReadbackSnapshot(frame: LiveComputerCapturedFrame, field: LiveComputerElement | null, text: string | null, stable: boolean): NonNullable<NonNullable<LiveComputerTransition['inputTransaction']>['readback']> {
  const value = field?.sensitive ? null : field?.value ?? null
  return {
    match: value === null ? 'unavailable' : field?.valueComplete === false ? 'truncated'
      : value === text ? 'exact' : value === '' ? 'empty'
      : text && value.startsWith(text) ? 'extended'
      : text?.startsWith(value) ? 'partial' : 'different',
    observedLength: value?.length ?? null, observationId: frame.id, stable,
  }
}

export function evaluateTextInputAcceptance(before: LiveComputerCapturedFrame, after: LiveComputerCapturedFrame, action: Pick<LiveComputerAction, 'targetElementId' | 'point' | 'text' | 'replaceExisting' | 'groundingSource' | 'targetIdentity'>): LiveComputerInputEvidence {
  const beforeElement = action.groundingSource === 'provider_visual' ? null
    : action.targetIdentity ? resolveCurrentInputTarget(action.targetIdentity, before.elements) : inputTargetElement(before.elements, action)
  const afterElement = matchingInputTargetElement(beforeElement, after.elements, action)
  if (beforeElement && !beforeElement.sensitive && afterElement && !afterElement.sensitive && afterElement.value !== null && action.text) {
    const expected = action.text
    const valueMatches = action.replaceExisting ? afterElement.value === expected : afterElement.value.endsWith(expected)
      && (beforeElement?.value === null || beforeElement?.value !== afterElement.value)
    if (afterElement.valueComplete === false) {
      return { acceptance: 'uncertain', channels: ['accessibility_value'], reason: 'The accessibility value is truncated; absence or completeness cannot be inferred.' }
    }
    if (valueMatches) {
      return { acceptance: 'accepted', channels: ['accessibility_value'], reason: 'The target control value changed consistently with the intended text.' }
    }
    return {
      acceptance: 'rejected', channels: ['accessibility_value'],
      reason: afterElement.value.length === 0
        ? 'Accessibility proves the intended control is empty.'
        : 'Accessibility proves the intended control contains a different value.',
    }
  }
  if (localizedInputRegionChanged(before, after, action.point)) {
    return {
      acceptance: 'uncertain', channels: ['localized_visual'],
      reason: 'The bounded region changed, but pixels alone cannot prove that the intended field owns focus or contains the exact intended text.',
    }
  }
  if (visiblyChanged(null, before.visualSample, after)) {
    return { acceptance: 'uncertain', channels: ['coarse_visual'], reason: 'The window changed, but the intended control region did not independently prove text acceptance.' }
  }
  if (before.sha256 !== after.sha256) {
    return { acceptance: 'uncertain', channels: ['frame_hash'], reason: 'Only the full frame hash changed; localized field acceptance was not proven.' }
  }
  return { acceptance: 'uncertain', channels: [], reason: 'No channel proved whether the field accepted or rejected the delivery.' }
}

/** Focus is an input precondition, not an inference from a successful click.
 * Platform semantic state is the only local acceptance channel; a caret,
 * selection highlight, or nearby animation cannot authorize keyboard input. */
export function evaluateInputFocusAcceptance(
  expectedElement: NonNullable<LiveComputerAction['targetIdentity']> | null,
  observation: Pick<LiveComputerCapturedFrame, 'elements' | 'elementCaptureStatus'>,
  action: Pick<LiveComputerAction, 'targetElementId' | 'point'>,
): LiveComputerInputEvidence {
  const element = expectedElement ? matchingInputTargetElement(expectedElement, observation.elements, action) : null
  const owners = observation.elements.filter(candidate => candidate.focused === true)
  if (element && (element.sensitive || element.enabled === false)) {
    return { acceptance: 'rejected', channels: ['accessibility_focus'], reason: 'The intended receiver is sensitive or disabled.' }
  }
  if (element?.focused === true || element?.containsFocus === true) {
    return { acceptance: 'accepted', channels: ['accessibility_focus'], reason: 'The intended control or its platform-proven descendant owns keyboard focus.' }
  }
  // A negative flag on a container is not a negative flag on every related
  // receiver. Only a known different receiver with disjoint geometry proves
  // misdirected input. Missing or bounded AX evidence stays uncertain.
  const targetBounds = element?.bounds ?? expectedElement?.bounds
    ?? (action.point ? { ...action.point, width: 1, height: 1 } : null)
  // Canvas editors can place a focused input proxy outside their visible body.
  // Degenerate proxy geometry cannot prove a different visible receiver. It
  // remains uncertain and needs the existing fresh visual focus verifier.
  const different = owners.find(owner => owner.sensitive || (targetBounds && owner.bounds
    && owner.bounds.width > 2 && owner.bounds.height > 2
    && !boundsOverlap(targetBounds, owner.bounds)))
  if (different) return { acceptance: 'rejected', channels: ['accessibility_focus'], reason: `A different control (${different.role}, ${different.bounds?.width ?? 0}×${different.bounds?.height ?? 0}) owns keyboard focus outside the intended editing surface.` }
  return { acceptance: 'uncertain', channels: [], reason: 'The platform does not establish the intended receiver relationship; current visual evidence can resolve it.' }

}

function localizedInputRegionChanged(
  before: LiveComputerCapturedFrame,
  after: LiveComputerCapturedFrame,
  point: LiveComputerAction['point'],
): boolean {
  return localizedSampleRegionChanged(before.localizedVisualSample ?? null, after, point)
}

/** Whether the 96x64 grayscale neighborhood around the action point differs
 * between the pre-action sample and the fresh frame. */
function localizedSampleRegionChanged(
  beforeSample: string | null,
  after: LiveComputerCapturedFrame,
  point: LiveComputerAction['point'],
): boolean {
  if (!point || !beforeSample || !after.localizedVisualSample) return false
  const left = Buffer.from(beforeSample, 'base64')
  const right = Buffer.from(after.localizedVisualSample, 'base64')
  const width = 96; const height = 64
  if (left.length !== width * height || right.length !== left.length) return false
  const centerX = Math.max(0, Math.min(width - 1, Math.round(point.x / Math.max(1, after.width) * (width - 1))))
  const centerY = Math.max(0, Math.min(height - 1, Math.round(point.y / Math.max(1, after.height) * (height - 1))))
  const radiusX = 12; const radiusY = 5
  let difference = 0; let changed = 0; let samples = 0
  for (let y = Math.max(0, centerY - radiusY); y <= Math.min(height - 1, centerY + radiusY); y += 1) {
    for (let x = Math.max(0, centerX - radiusX); x <= Math.min(width - 1, centerX + radiusX); x += 1) {
      const delta = Math.abs(left[y * width + x]! - right[y * width + x]!)
      difference += delta
      if (delta >= 5) changed += 1
      samples += 1
    }
  }
  return samples > 0 && (difference / samples >= 1.1 || changed / samples >= 0.035)
}

function inputTargetElement(elements: LiveComputerElement[], action: Pick<LiveComputerAction, 'targetElementId' | 'point'>): LiveComputerElement | null {
  const eligible = (candidate: LiveComputerElement): boolean => !candidate.sensitive
    && candidate.enabled !== false
    && liveComputerElementSupportsTextEntry(candidate)
  const named = action.targetElementId
    ? elements.find((candidate) => candidate.id === action.targetElementId) ?? null
    : null
  if (!action.point) return named && eligible(named) ? named : null
  // Element ids are scoped to one frame's priority ordering. Focusing a
  // browser field can promote it from e2 to e1, leaving e2 attached to a
  // different text field in the reconciliation frame. Preserve the id only
  // while its observed geometry still agrees with the approved point.
  if (named?.bounds && eligible(named) && pointInsideBounds(action.point, named.bounds, 2)) return named
  return elements
    .filter((candidate) => candidate.bounds && eligible(candidate) && pointInsideBounds(action.point!, candidate.bounds, 2))
    .sort((left, right) => Number(right.focused === true) - Number(left.focused === true) || elementArea(left) - elementArea(right))[0]
    ?? null
}

function matchingInputTargetElement(
  beforeElement: NonNullable<LiveComputerAction['targetIdentity']> | null,
  afterElements: LiveComputerElement[],
  action: Pick<LiveComputerAction, 'targetElementId' | 'point'>,
): LiveComputerElement | null {
  if (!beforeElement) return inputTargetElement(afterElements, action)
  return resolveCurrentInputTarget(beforeElement, afterElements)
}

/** The frame's aim brackets come from the validated element in the latest
 * captured frame, never from a provider: whatever a proposal carried is
 * replaced here, and an action without a validated element carries null. */
function liveComputerTargetBounds(
  action: Pick<LiveComputerAction, 'targetElementId'>,
  elements: LiveComputerElement[],
  frame: Pick<LiveComputerFrame, 'width' | 'height'> | null,
): NonNullable<LiveComputerAction['targetBounds']> | null {
  if (!action.targetElementId) return null
  const element = elements.find((candidate) => candidate.id === action.targetElementId)
  if (!element?.bounds) return null
  return frame ? visibleElementBounds(element.bounds, frame) : { ...element.bounds }
}

/** Accessibility rectangles describe semantic objects, not necessarily their
 * currently visible viewport. A document canvas can extend far beyond the
 * selected window while still intersecting it. Pointer grounding therefore
 * uses only the frame-visible intersection; the full AX rectangle remains
 * available for semantic matching and scroll continuity. */
function visibleElementBounds(
  bounds: NonNullable<LiveComputerElement['bounds']>,
  frame: Pick<LiveComputerFrame, 'width' | 'height'>,
): NonNullable<LiveComputerElement['bounds']> | null {
  const left = Math.max(0, bounds.x)
  const top = Math.max(0, bounds.y)
  const right = Math.min(frame.width, bounds.x + bounds.width)
  const bottom = Math.min(frame.height, bounds.y + bounds.height)
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function pointInsideBounds(
  point: NonNullable<LiveComputerAction['point']>,
  bounds: NonNullable<LiveComputerElement['bounds']>,
  tolerance = 0,
): boolean {
  return point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance
    && point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance
}

function elementArea(element: LiveComputerElement): number {
  return element.bounds ? element.bounds.width * element.bounds.height : Number.POSITIVE_INFINITY
}

const genericControlTerms = new Set([
  'bar', 'box', 'button', 'control', 'field', 'item', 'menu', 'option', 'popup',
  'row', 'tab', 'text', 'toolbar', 'view',
])

/** Model labels naturally include affordance nouns ("Chrome menu", "Search
 * field"). Those words describe how to use a control, not which control it
 * is. Prefer the distinctive remainder when one exists, while retaining the
 * original terms for legitimately generic labels such as "Search field". */
function discriminativeTargetTerms(label: string | null): string[] {
  const terms = taskTerms(label ?? '')
  const distinctive = terms.filter((term) => !genericControlTerms.has(term))
  return distinctive.length > 0 ? distinctive : terms
}

function elementTargetMatchScore(element: LiveComputerElement, targetTerms: string[]): number {
  if (targetTerms.length === 0) return 0
  const primary = taskTerms([element.name, element.identifier ?? '', element.placeholder ?? ''].join(' '))
  const secondary = taskTerms([element.description ?? '', element.help ?? '', element.value ?? ''].join(' '))
  const matches = (terms: string[], target: string): boolean => terms.some((term) => term === target || term.startsWith(target) || target.startsWith(term))
  const primaryMatches = targetTerms.filter((target) => matches(primary, target)).length
  const secondaryMatches = targetTerms.filter((target) => !matches(primary, target) && matches(secondary, target)).length
  // Identity-bearing labels and identifiers outrank incidental help/value
  // text. Full primary coverage receives a small deterministic tie-breaker.
  return primaryMatches * 4 + secondaryMatches + (primaryMatches === targetTerms.length ? 2 : 0)
}

function elementHasObservedIdentity(element: LiveComputerElement): boolean {
  return taskTerms([
    element.name, element.identifier ?? '', element.placeholder ?? '',
    element.description ?? '', element.help ?? '', element.value ?? '',
  ].join(' ')).length > 0
}

export type LiveComputerElementCapability = 'activate' | 'focus' | 'set_text' | 'increment' | 'decrement' | 'show_menu'

/** Normalize platform affordances into a small application-independent
 * vocabulary. Platform action names are evidence, not model instructions; a
 * custom app with an icon-only control is still actionable when it exposes
 * AXPress, even when every label string is empty. */
export function liveComputerElementCapabilities(element: LiveComputerElement): LiveComputerElementCapability[] {
  const actions = new Set((element.actions ?? []).map((entry) => entry.toLocaleLowerCase()))
  const settable = new Set((element.settableAttributes ?? []).map((entry) => entry.toLocaleLowerCase()))
  const capabilities: LiveComputerElementCapability[] = []
  const add = (capability: LiveComputerElementCapability) => { if (!capabilities.includes(capability)) capabilities.push(capability) }
  if (actions.has('axpress') || actions.has('axpick') || actions.has('axconfirm')) add('activate')
  if (actions.has('axshowmenu')) add('show_menu')
  if (actions.has('axincrement')) add('increment')
  if (actions.has('axdecrement')) add('decrement')
  if (settable.has('axfocused') || element.focusable === true) add('focus')
  if (element.editable === true || settable.has('axvalue') && /(?:text\s*field|text\s*area|search\s*field|combo\s*box|editable)/iu.test(element.role)) add('set_text')
  // Legacy/synthetic captures may predate action enumeration. Roles are used
  // only as a capability fallback, never to identify an application or label.
  if (capabilities.length === 0 && /(?:button|link|check\s*box|menu\s*item|radio|tab|cell|row)/iu.test(element.role)) add('activate')
  return capabilities
}

function elementSupportsPointerAction(element: LiveComputerElement): boolean {
  return liveComputerElementCapabilities(element).length > 0
    || element.focusable === true
    || /(?:button|link|check\s*box|menu\s*item|radio|tab|text\s*field|text\s*area|search\s*field|combo\s*box|cell|row)/iu.test(element.role)
}

function elementSupportsElementAction(element: LiveComputerElement, action: LiveComputerAction['elementAction']): boolean {
  return Boolean(action && liveComputerElementCapabilities(element).includes(action))
}

function boundsOverlap(left: LiveComputerElement['bounds'], right: LiveComputerElement['bounds']): boolean {
  if (!left || !right) return false
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y
}

function assertArtifactDraftValid(artifact: LiveComputerArtifactDraft, sourceAware = false): void {
  if (!['prose', 'record_set', 'selection'].includes(artifact.kind) || !artifact.title?.trim() || artifact.title.length > 160) {
    throw new Error('The proposed work product has an invalid identity')
  }
  if (!Array.isArray(artifact.provenance) || artifact.provenance.length > 10
    || artifact.provenance.some((item) => !item.trim() || item.length > 240)) {
    throw new Error('The proposed work product has invalid provenance')
  }
  if (artifact.kind === 'record_set') {
    if (!Array.isArray(artifact.columns) || artifact.columns.length < 1 || artifact.columns.length > 20
      || artifact.columns.some((column) => typeof column !== 'string' || (!sourceAware && !column.trim()) || column.length > 80)
      || (!sourceAware && new Set(artifact.columns.map((column) => column.trim().toLocaleLowerCase())).size !== artifact.columns.length)) {
      throw new Error('A record-set work product needs one to twenty distinct named fields')
    }
    if (!Array.isArray(artifact.rows) || artifact.rows.length < (sourceAware ? 0 : 1) || artifact.rows.length > 100
      || artifact.rows.some((row) => !Array.isArray(row) || row.length !== artifact.columns.length
        || row.some((cell) => typeof cell !== 'string' || cell.length > 240))) {
      throw new Error('Every record-set row must contain one bounded value for each named field')
    }
    const cells = artifact.columns.length * (artifact.rows.length + 1)
    const characters = artifact.rows.flat().reduce((total, cell) => total + cell.length, 0)
      + artifact.columns.reduce((total, column) => total + column.length, 0)
    if (cells > 200 || characters > 12_000) throw new Error('The record set is too large for one governed live transaction')
    if (artifact.content !== null) throw new Error('A record set carries rows and columns, not flattened prose content')
    if (looksSensitive([...artifact.columns, ...artifact.rows.flat()].join(' '))) throw new Error('A work product must not carry credential-like content')
    return
  }
  if (artifact.columns.length > 0 || artifact.rows.length > 0 || !artifact.content?.trim() || artifact.content.length > 4_000) {
    throw new Error('A prose or selection work product carries bounded content, not record rows')
  }
  if (looksSensitive(artifact.content)) throw new Error('A work product must not carry credential-like content')
}

function validateNewTextDocumentPath(filePath: string | null | undefined, session: LiveComputerSession): void {
  const candidate = filePath?.trim() ?? ''
  const invalid = validateNewTextFilePath(candidate)
  if (invalid) throw new Error(invalid)
  const boundPath = (session.operationBindings ?? []).some((binding) => (
    binding.operationId === 'text_document.save_new'
    && binding.parameterId === 'destination_path'
    && binding.status === 'resolved'
    && binding.authorized
    && binding.value === candidate
  ))
  if (!session.goal.includes(candidate) && !boundPath) {
    throw new Error('The save path is neither present in the approved outcome nor authorized by a resolved operation binding')
  }
  const active = session.targets.find((entry) => sameWindow(entry.target, session.target))
  if (active?.source !== 'fresh') throw new Error('The governed save command is available only in a fresh document Carve opened for this task')
  if (activeLiveComputerObjective(session.ledger)?.kind !== 'perform_commit') {
    throw new Error('A document may be saved only during the approved commit objective')
  }
}

function operationAuthorizationForAction(
  action: Pick<LiveComputerAction, 'id' | 'kind' | 'command' | 'filePath'>,
  session: LiveComputerSession,
): NonNullable<LiveComputerAction['operationAuthorization']> | null {
  if (action.kind !== 'invoke_safe_command' || action.command !== 'textedit.save_document' || !action.filePath) return null
  const bindings = (session.operationBindings ?? [])
    .filter((binding) => binding.operationId === 'text_document.save_new' && binding.status === 'resolved')
    .map((binding) => ({
      id: binding.id,
      parameterId: binding.parameterId,
      type: binding.type,
      source: binding.source,
      value: binding.value,
      authorized: binding.authorized,
      authorityImpact: binding.authorityImpact,
    }))
    .sort((left, right) => left.parameterId.localeCompare(right.parameterId))
  // An exact path stated in the initial user goal predates the generalized
  // resolver in persisted sessions. Preserve compatibility by projecting the
  // same controller-validated values into the hash; no new authority appears.
  const authoritative = bindings.length > 0 ? bindings : [
    { parameterId: 'destination_path', type: 'absolute_path', source: 'approved_goal', value: action.filePath, authorized: true, authorityImpact: 'external_effect' },
    { parameterId: 'overwrite', type: 'boolean', source: 'controller_default', value: false, authorized: true, authorityImpact: 'none' },
    { parameterId: 'target_document', type: 'resource', source: 'application_state', value: `window:${session.target.windowId}`, authorized: true, authorityImpact: 'selects_target' },
  ]
  const overwrite = authoritative.find((binding) => binding.parameterId === 'overwrite')?.value
  if (overwrite !== false) throw new Error('The governed save operation has no controller-owned no-overwrite binding')
  return {
    transactionId: action.id,
    operationId: 'text_document.save_new',
    parameterBindingsSha256: sha256(stableJson(authoritative)),
    targetSha256: sha256(action.filePath),
    overwriteAuthorized: false,
  }
}

function validateAction(action: LiveComputerAction, session: LiveComputerSession): void {
  // Raw typing is an internal physical subaction only. A planned field edit
  // must carry its own target so approval UI cannot split focus from typing.
  if (!['move', 'click', 'drag', 'element_action', 'invoke_safe_command', 'scroll', 'type_into', 'enter_sequence', 'apply_artifact', 'keypress', 'new_tab', 'cycle_tab', 'wait', 'conclude', 'switch_window', 'request_window', 'ask_user', 'done', 'handoff'].includes(action.kind)) throw new Error('Live computer action kind is not allowed')
  if (action.kind === 'request_window' && !(action.targetLabel ?? '').trim()) throw new Error('A window request must name the application it needs')
  const takeoverOnly = action.kind === 'ask_user'
    && (action.options ?? []).length > 0
    && !(action.options ?? []).some((option) => option.mode === 'agent_continues')
  if (action.kind === 'handoff' || takeoverOnly) {
    if (!action.handoffCause) throw new Error('A takeover proposal needs a typed authority-boundary cause; model prose cannot establish one')
    if (!liveComputerHandoffCauseSupported(session, action.handoffCause)) {
      throw new Error(`The proposed ${action.handoffCause.replaceAll('_', ' ')} handoff is not supported by controller-owned state or verified evidence`)
    }
  } else if (action.handoffCause) {
    throw new Error('A handoff cause is valid only on a terminal handoff or takeover-only decision point')
  }
  if (action.kind === 'conclude') {
    // A conclude injects no input: it submits the composed deliverable for a
    // cognitive objective, whose target state ("the facts have been stated")
    // can never appear on screen. The verifier still judges the text against
    // the frame and ledger facts before the objective advances.
    const activeKind = activeLiveComputerObjective(session.ledger)?.kind
    if (activeKind !== 'extract_information' && activeKind !== 'verify_outcome') {
      throw new Error('Conclude submits a deliverable for an extraction or final-verification objective; environmental objectives complete through visible state')
    }
    const conclusion = action.conclusion?.trim() ?? ''
    if (!conclusion || conclusion.length > 2_000) throw new Error('A conclude action needs the full deliverable text, up to 2,000 characters')
    if (looksSensitive(conclusion)) throw new Error('A conclude deliverable must not carry credential-like content')
    if (action.risk !== 'read_only' && action.risk !== 'safe') throw new Error('Stating a conclusion is not a state change and cannot carry write risk')
    const contract = session.ledger.outcomeContract
    if (liveComputerContractNeedsArtifact(contract)) {
      const existingComplete = contract?.requirements ? requirementsContentReady(session.ledger) : session.ledger.artifacts.some((artifact) => artifact.coverage.complete)
      if (!action.artifact && !existingComplete) throw new Error(`The outcome requires a ${contract!.deliverable.kind} work product; conclude must preserve grounded evidence as an artifact`)
      if (action.artifact) {
        if (contract?.requirements && action.artifact.requirementId && !contract.requirements.products.some(p => p.id === action.artifact!.requirementId && p.kind === action.artifact!.kind)) throw liveComputerProposalRejection('Choose a declared product requirementId, or null for an intermediate observation that is not a requested output product.', 'schema')
        assertArtifactDraftValid(action.artifact, Boolean(session.ledger.outcomeContract?.requirements))
        // The final contract is enforced only at the final boundary. Earlier
        // extraction objectives may verify a narrower working artifact: the
        // leaderboard audit failed because Rank/Model acquisition was forced
        // to invent later Interesting fact/Source cells before enrichment.
        if (activeKind === 'verify_outcome' && !liveComputerArtifactCoverage(action.artifact, contract, session.ledger).complete) {
          throw new Error(`The final work product is not ready: ${artifactCoverageGap(liveComputerArtifactCoverage(action.artifact, contract, session.ledger))}`)
        }
      }
    } else if (action.artifact) {
      assertArtifactDraftValid(action.artifact, Boolean(session.ledger.outcomeContract?.requirements))
    }
  }
  if (action.kind !== 'conclude' && action.artifact) throw liveComputerProposalRejection('Only a conclude action may propose a new work product; set artifact=null for other actions.', 'schema')
  if (action.kind === 'apply_artifact') {
    if (action.artifactBinding && action.artifactBinding !== artifactActionBinding(session, action)) throw new LiveComputerActionError('evidence_stale', 'The work product, requirements or destination changed after proposal. Reobserve before any input.')
    if (action.artifactLayout === 'table' && !session.ledger.outcomeContract?.requirements) throw liveComputerProposalRejection('Bulk table delivery is enabled only for version-2 task contracts; use the existing per-unit layout for this compatibility session.', 'schema')
    if (action.artifactLayout && !['grid', 'lines', 'table'].includes(action.artifactLayout)) throw new Error('Artifact layout must be grid, lines or table')
    const replayIssue = artifactReplayIssue(session.ledger.transitions, action.artifactId, session.target.windowId, action.artifactUnit, action.artifactLayout)
    if (replayIssue) {
      if (!artifactCellRepairContext(session, action)) throw new LiveComputerActionError('plan_invalid', replayIssue)
      if (!hasActionScopeAssessment(session, action, 'missing_artifact_cell')) throw new ActionScopeReviewRequired('Inspect the exact missing cell against the pinned source and prior destination before a bounded repair.', 'missing_artifact_cell')
    }
    const active = activeLiveComputerObjective(session.ledger)
    if (active?.kind !== 'perform_commit') throw new Error('A verified work product may be applied only during its approved commit objective')
    const artifact = session.ledger.artifacts.find((candidate) => candidate.id === action.artifactId)
    if (!artifact) throw new Error('The proposed work product identity is not a verified ledger artifact')
    artifactPlacementText(artifact, action)
    const coverage = liveComputerArtifactCoverage(artifact, session.ledger.outcomeContract, session.ledger)
    if (!coverage.complete) throw new LiveComputerActionError(coverage.resolutionStatus === 'conflicted' ? 'requirement_conflict' : 'artifact_not_ready', `The work product is not ready: ${artifactCoverageGap(coverage)}`, undefined, undefined,
      { requirementId: coverage.requirementId ?? null, artifactId: artifact.id,
        requirementRevision: session.ledger.requirementResolutions?.find(r => r.requirementId === coverage.requirementId)?.revision ?? null,
        targetWindowId: session.target.windowId })
    if (action.text || action.key || action.scrollY || action.artifact) throw new Error('Applying a verified work product cannot carry reconstructed text, keys, scrolling, or a new artifact')
    if (action.risk !== 'reversible_write') throw new Error('Applying a work product is a governed reversible write')
    if (action.artifactLayout === 'table' && session.ledger.taskState && !hasActionScopeAssessment(session, action, 'authorized_field_effect')) throw new ActionScopeReviewRequired('Verify the exact empty destination range or document insertion point for this bounded table against the current observation and original request.', 'authorized_field_effect')
  } else if (action.artifactId) {
    throw new Error('Only apply_artifact may reference a verified work product identity')
  }
  if (action.kind === 'switch_window') {
    const authorized = session.targets.find((entry) => entry.target.windowId === action.targetWindowId)
    if (!Number.isInteger(action.targetWindowId) || !authorized) {
      throw new Error('Carve can only switch to a window authorized for this session; screen content cannot add one')
    }
    if (sameWindow(session.target, { windowId: authorized.target.windowId, bundleIdentifier: authorized.target.bundleIdentifier })) {
      throw new Error('The proposed window is already the active window')
    }
    if (action.risk !== 'read_only' && action.risk !== 'safe') throw new Error('Switching windows is not a state change and cannot carry write risk')
  }
  if (action.kind === 'new_tab' || action.kind === 'cycle_tab') {
    if (!liveComputerTargetSupportsTabs(session.target)) throw new Error('Tab workspace actions are available only in a selected browser window')
    if (action.risk !== 'read_only' && action.risk !== 'safe') throw new Error('Browser tab workspace actions are reversible navigation and cannot carry write risk')
    if (action.point || action.endPoint || action.elementAction || action.targetElementId || action.text || action.scrollY) throw new Error('A typed browser tab action cannot carry pointer, text, or scroll input')
    if (action.kind === 'new_tab') {
      if (action.key) throw new Error('A new-tab action does not take a tab direction')
      if (session.tabWorkspace.managedTabOpen) throw new Error('Carve already has one managed side tab; reuse or return from it instead of creating tab clutter')
    } else {
      const direction = action.key?.trim().toUpperCase()
      if (direction !== 'NEXT' && direction !== 'PREVIOUS') throw new Error('Cycle-tab actions require NEXT or PREVIOUS')
      if (!session.tabWorkspace.managedTabOpen) throw new Error('Carve cannot guess among pre-existing tabs; cycle-tab requires a side tab Carve created this session')
      if (session.tabWorkspace.windowId !== session.target.windowId) throw new Error('The managed side tab belongs to another authorized window; switch back before cycling tabs')
      if (direction === 'PREVIOUS' && session.tabWorkspace.activeTab !== 'managed') throw new Error('The managed side tab is not active; PREVIOUS would guess at unrelated tab order')
      if (direction === 'NEXT' && session.tabWorkspace.activeTab !== 'original') throw new Error('The original tab is not active; NEXT would guess at unrelated tab order')
    }
  }
  // Input authority is granted per window. A window the user authorized for
  // observation only can be read for the task and never typed or clicked into.
  if (['move', 'click', 'drag', 'element_action', 'invoke_safe_command', 'scroll', 'type_into', 'apply_artifact', 'keypress', 'new_tab', 'cycle_tab'].includes(action.kind)) {
    const active = session.targets.find((entry) => sameWindow(entry.target, session.target))
    if (!active || active.authority !== 'input') {
      throw new Error(`${session.target.application} is authorized for observation only in this session; Carve cannot send input to it`)
    }
  }
  if (!Number.isFinite(action.confidence) || action.confidence < 0 || action.confidence > 1) throw new Error('Live computer action confidence is invalid')
  if (!['read_only', 'safe', 'reversible_write', 'sensitive', 'irreversible'].includes(action.risk as ActionRisk)) throw new Error('Live computer action risk is invalid')
  if (!action.objectiveId || action.objectiveId.length > 80 || action.objectiveId !== session.ledger.currentObjectiveId) throw new Error('The proposed action does not advance the active live objective')
  if (!action.route?.trim() || action.route.length > 240) throw new Error('The proposed action must name one bounded navigation route')
  if (!action.expectedState?.trim() || action.expectedState.length > 500) throw new Error('The proposed action must name the visible state it expects to produce')
  const activeObjective = activeLiveComputerObjective(session.ledger)
  // A query objective ends in one grounded field-entry transaction, but real
  // pages need read-only preparation first — scrolling the field into view,
  // clicking away or pressing Escape to dismiss an autocomplete overlay.
  // Banning preparation outright killed a live session whose next step was
  // dismissing Google's suggestion dropdown; only preparation that could
  // change state is refused.
  if (activeObjective?.kind === 'enter_query'
    && !['type_into', 'new_tab', 'cycle_tab', 'wait', 'switch_window', 'ask_user', 'handoff'].includes(action.kind)
    && !(['click', 'move', 'drag', 'element_action', 'scroll', 'keypress'].includes(action.kind) && ['read_only', 'safe'].includes(action.risk))) {
    throw new Error('During a query objective, only read-only preparation or the single grounded field-entry transaction is allowed')
  }
  if (action.replanReason !== null && (!action.replanReason.trim() || action.replanReason.length > 500)) throw new Error('The route-change reason is invalid')
  if (action.kind === 'ask_user') {
    validateDecisionOptions(action.question ?? '', action.guidanceContext ?? '', action.options ?? [])
  }
  if ((action.kind === 'click' || action.kind === 'move' || action.kind === 'drag') && action.confidence < liveVerificationPolicy.pointerGroundingConfidence) {
    throw new Error(`Pointer grounding confidence is below ${liveVerificationPolicy.pointerGroundingConfidence.toFixed(2)}; re-ground the target or hand off`)
  }
  if (liveComputerActionMayBindElement(action.kind) && !(action.kind === 'enter_sequence' && !action.point && action.sequence?.[0]?.kind !== 'text')) {
    if (!action.point || !Number.isFinite(action.point.x) || !Number.isFinite(action.point.y)) throw new Error('Pointer actions require a target point')
    const width = session.latestFrame?.width ?? session.target.bounds.width
    const height = session.latestFrame?.height ?? session.target.bounds.height
    if (action.point.x < 0 || action.point.y < 0 || action.point.x > width || action.point.y > height) {
      throw new LiveComputerActionError('target_moved', "The proposed target lies outside the selected window's latest captured frame")
    }
  }
  if (action.kind === 'drag') {
    if (!action.endPoint || !Number.isFinite(action.endPoint.x) || !Number.isFinite(action.endPoint.y)) throw new Error('Drag actions require a destination point')
    const width = session.latestFrame?.width ?? session.target.bounds.width
    const height = session.latestFrame?.height ?? session.target.bounds.height
    if (action.endPoint.x < 0 || action.endPoint.y < 0 || action.endPoint.x > width || action.endPoint.y > height) {
      throw new LiveComputerActionError('target_moved', 'The drag destination lies outside the latest captured window frame')
    }
  } else if (action.endPoint) {
    throw new Error('Only a drag action may carry a destination point')
  }
  if (action.kind === 'element_action') {
    if (!action.targetElementId) throw new Error('A semantic element action requires a current targetElementId')
    if (!action.elementAction || !['activate', 'focus', 'increment', 'decrement', 'show_menu'].includes(action.elementAction)) {
      throw new Error('A semantic element action requires one supported generic capability')
    }
    if (action.text || action.key || action.scrollY) throw new Error('A semantic element action cannot carry text, keys, or scrolling')
  } else if (action.elementAction) {
    throw new Error('Only element_action may request a semantic element capability')
  }
  if (action.kind === 'invoke_safe_command') {
    if ((action.command !== 'textedit.make_plain_text' && action.command !== 'textedit.save_document')
      || session.target.bundleIdentifier !== 'com.apple.TextEdit') {
      throw new Error('That semantic application command is unavailable on the selected surface')
    }
    if (action.point || action.targetElementId || action.text || action.key || action.scrollY || action.sequence || action.artifact) {
      throw new Error('A semantic application command cannot carry pointer, text, key, scroll, sequence, or artifact input')
    }
    if (action.command === 'textedit.make_plain_text') {
      if (action.filePath) throw new Error('Changing document format cannot carry a file path')
      if (action.risk !== 'safe' && action.risk !== 'reversible_write') throw new Error('A semantic format command must use safe or reversible-write risk')
    } else {
      validateNewTextDocumentPath(action.filePath, session)
      if (action.risk !== 'reversible_write') throw new Error('Saving a document is a governed reversible write')
    }
  } else if (action.command) {
    throw new Error('Only invoke_safe_command may select a semantic application command')
  } else if (action.filePath) {
    throw new Error('Only the governed save command may carry a file path')
  }
  if (action.kind === 'scroll' && (!Number.isFinite(action.scrollY) || Math.abs(action.scrollY ?? 0) < 1 || Math.abs(action.scrollY ?? 0) > 2_000)) throw new Error('Scroll amount is outside the safe range')
  if (action.kind === 'scroll' && action.scrollIntent !== undefined && action.scrollIntent !== null && !['viewport', 'top', 'bottom', 'reveal'].includes(action.scrollIntent)) throw new Error('Scroll intent is outside the safe navigation vocabulary')
  if (action.kind === 'scroll' && action.scrollIntent === 'bottom' && (action.scrollY ?? 0) < 0) throw new Error('Bottom scroll intent requires a downward scroll amount')
  if (action.kind === 'scroll' && action.scrollIntent === 'top' && (action.scrollY ?? 0) > 0) throw new Error('Top scroll intent requires an upward scroll amount')
  if (action.kind === 'type_into') {
    if (!action.text || action.text.length > 1_000) throw new Error('Typing actions require at most 1,000 characters')
    if (looksSensitive(action.text)) throw new Error('Carve will not type password-like or credential-like text during live computer use')
    if (activeObjective?.kind === 'perform_commit'
      && session.ledger.outcomeContract?.deliverable.kind === 'record_set'
      && session.ledger.artifacts.some((artifact) => artifact.coverage.complete)) {
      if (session.ledger.taskState) {
        if (!hasActionScopeAssessment(session, action, 'authorized_field_effect')) {
          throw new ActionScopeReviewRequired('Assess the actual field effect against the requested outcome and verified work product; a record-set task does not make every field edit a bulk data write.', 'authorized_field_effect')
        }
      } else throw new Error('This approved work product is a verified record set; apply its artifact so rows and fields cannot collapse into one text entry')
    }
  }
  if (action.kind === 'type_into') {
    const active = activeObjective
    const terminator = action.key?.trim().toUpperCase() ?? null
    const clickSubmit = Boolean(action.submitPoint)
    if (terminator && clickSubmit) throw new Error('A field-entry transaction may use either a submit key or a submit click, not both')
    if (terminator && !['RETURN', 'ENTER'].includes(terminator)) throw new Error('Field-entry transactions may end only with Return or Enter')
    // Submitting a field entry is how the agent searches and navigates, and
    // navigation and lookup objectives can submit grounded queries. Other
    // adaptive field transactions need assessment of the actual submission
    // effect; that assessment does not replace the normal write approval.
    if ((terminator || clickSubmit) && (!active || !liveComputerObjectiveSupportsFieldSubmit(active.kind))) {
      if (session.ledger.taskState) {
        if (!hasActionScopeAssessment(session, action, 'authorized_field_effect')) {
          throw new ActionScopeReviewRequired('Assess the effect of this field edit and its submission against the original request; an objective label does not establish submission authority.', 'authorized_field_effect')
        }
      } else throw new Error('Submitting a field-entry transaction is allowed only for a navigation or lookup objective')
    }
    // Instruction-shaped text can be either a legitimate question/requested
    // edit or relayed page instructions. Resolve that ambiguity in context.
    if ((terminator || clickSubmit || active?.kind === 'enter_query') && looksLikeInstructionText(action.text ?? '') && !hasActionScopeAssessment(session, action) && !hasActionScopeAssessment(session, action, 'authorized_field_effect')) {
      const message = 'The proposed field text needs a search scope assessment: distinguish a task-relevant question from relayed instructions.'
      if (session.ledger.taskState) throw new ActionScopeReviewRequired(message)
      throw new Error('The proposed field text reads as instructions rather than a search query; type only the short resource identity being searched for')
    }
    // One grounding invariant covers every submit-capable field entry —
    // enter_query typing always, other navigation/lookup kinds when they
    // submit. A bare domain typed toward a location bar is its own
    // destination form.
    if (active && (active.kind === 'enter_query' || ((terminator || clickSubmit) && liveComputerObjectiveSupportsFieldSubmit(active.kind)))) {
      const text = (action.text ?? '').trim()
      assertFieldEntryGrounded(session, active, text, action)
    }
  }
  if (action.submitPoint) {
    if (action.kind !== 'type_into') throw new Error('Only a field-entry transaction may carry a submit point')
    if (!Number.isFinite(action.submitPoint.x) || !Number.isFinite(action.submitPoint.y)
      || action.submitPoint.x < 0 || action.submitPoint.y < 0
      || action.submitPoint.x > (session.latestFrame?.width ?? session.target.bounds.width)
      || action.submitPoint.y > (session.latestFrame?.height ?? session.target.bounds.height)) {
      throw new LiveComputerActionError('target_moved', 'The field-entry submit point lies outside the latest captured window frame')
    }
  } else if (action.submitTargetElementId) {
    throw new Error('A submit element identity requires a submit point')
  }
  if (action.kind === 'keypress') {
    const key = action.key?.trim().toUpperCase()
    if (!liveComputerKeypressIsSafe(key)) {
      throw new Error('Live computer keypresses are limited to safe navigation keys')
    }
  }
  if (action.kind === 'enter_sequence') {
    const items = action.sequence ?? []
    if (items.length < 1 || items.length > 24) throw new Error('An input sequence carries one to twenty-four items')
    if (action.text) throw new Error('An input sequence carries its text inside its items')
    if (action.elementAction || action.endPoint || action.submitPoint) throw new Error('An input sequence cannot carry a semantic capability, drag destination, or submit point')
    let typedCharacters = 0
    for (const item of items) {
      if (item.kind === 'text') {
        if (!item.value || item.value.length > 500) throw new Error('Each typed sequence item carries one to five hundred characters')
        typedCharacters += item.value.length
        if (looksSensitive(item.value)) throw new Error('Carve will not type password-like or credential-like text during live computer use')
      } else if (item.kind === 'key') {
        if (!liveComputerKeypressIsSafe(item.value.trim().toUpperCase())) throw new Error('Sequence key items are limited to safe navigation keys')
      } else if (item.kind === 'activate') {
        const label = item.value.trim()
        if (!label || label.length > 80) throw new Error('Each activate item names one visible control label of at most eighty characters')
        if (prohibitedActivatorLabel.test(label)) throw new Error(`Carve will not activate “${label}”: sending, posting, purchasing, deleting, installing, sharing, and sign-in stay prohibited in live computer use`)
      } else {
        throw new Error('Sequence items are text, key, or activate')
      }
    }
    if (typedCharacters > 1_000) throw new Error('An input sequence types at most 1,000 characters in total')
    if (items[0]?.kind === 'text' && !action.point && !action.targetElementId) throw new Error('A sequence that starts by typing must name the field it types into')
    const terminator = action.key?.trim().toUpperCase() ?? null
    if (terminator && !['RETURN', 'ENTER'].includes(terminator)) throw new Error('An input sequence may end only with Return or Enter')
    const submits = Boolean(terminator) || items.at(-1)?.kind === 'key' && ['RETURN', 'ENTER'].includes(items.at(-1)!.value.trim().toUpperCase())
    const typed = items.filter((item) => item.kind === 'text').map((item) => item.value).join(' ').trim()
    // The same grounding invariant as a field entry: a typed search that
    // submits, or any typing during a lookup, must carry the plan's own words.
    if (activeObjective && typed && (activeObjective.kind === 'enter_query' || (submits && liveComputerObjectiveSupportsFieldSubmit(activeObjective.kind)))) {
      if (looksLikeInstructionText(typed)) throw new Error('The proposed sequence text reads as instructions rather than a search query; type only the short resource identity being searched for')
      assertFieldEntryGrounded(session, activeObjective, typed, action)
    }
  }
}

/** Controls whose activation is a prohibited effect regardless of how the
 * model classifies the action. Matched against the visible label only. */
const prohibitedActivatorLabel = /\b(?:send|post|publish|pay|purchase|buy|checkout|order|delete|remove|empty|erase|install|share|sign\s?in|log\s?in|sign\s?up)\b/iu

/** Exactly one enabled, non-sensitive control in the digest whose visible
 * label is `label`; zero or several is a typed refusal, never a guess. */
function resolveSequenceActivator(elements: LiveComputerElement[], label: string): LiveComputerElement {
  const wanted = label.trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
  const candidates = elements.filter((element) => element.bounds
    && !element.sensitive
    && element.enabled !== false
    && (element.name ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase() === wanted
    && (liveComputerElementCapabilities(element).includes('activate') || elementSupportsPointerAction(element)))
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length === 0) {
    throw new LiveComputerActionError('target_moved', `No enabled control labeled “${label}” is present in the latest frame; the sequence was not started`)
  }
  throw new LiveComputerActionError('control_ambiguous', `${candidates.length} controls labeled “${label}” are visible; the sequence was not started`)
}

export function liveComputerHandoffCauseSupported(session: LiveComputerSession, cause: NonNullable<LiveComputerAction['handoffCause']>): boolean {
  const recoveryCause = session.ledger.recovery.cause
  const verifiedText = [
    ...session.ledger.facts,
    ...session.ledger.transitions
      .filter((transition) => transition.verifiedBy === 'model_criterion' || transition.status === 'verified')
      .flatMap((transition) => [transition.observedState ?? '', ...transition.evidence]),
  ].join(' ').toLocaleLowerCase()
  if (cause === 'authentication_required') {
    return recoveryCause === 'authentication_required'
      || /\b(?:sign\s?in|log\s?in|password|credential|two.?factor|2fa|verification\s+code|captcha|authentication)\b/iu.test(verifiedText)
  }
  if (cause === 'permission_required') {
    return recoveryCause === 'policy_violation'
      || /\b(?:permission|consent|access\s+(?:request|required|denied)|not\s+authorized|authorization\s+required)\b/iu.test(verifiedText)
  }
  if (cause === 'personal_information_required') {
    return /\b(?:personal\s+(?:information|details)|address|phone\s+number|legal\s+name|date\s+of\s+birth|tax\s+id)\b/iu.test(verifiedText)
  }
  if (cause === 'environment_lost') {
    return recoveryCause === 'environment_lost'
      || /\b(?:window|environment|application)\s+(?:closed|gone|lost|unavailable|no\s+longer\s+available)\b/iu.test(verifiedText)
  }
  return recoveryCause === 'policy_violation' || recoveryCause === 'prompt_injection'
}

function controllerHandoffMessage(cause: NonNullable<LiveComputerAction['handoffCause']>, modelSummary: string): string {
  const reason: Record<NonNullable<LiveComputerAction['handoffCause']>, string> = {
    authentication_required: 'Authentication requires your participation.',
    permission_required: 'A permission boundary requires your decision.',
    personal_information_required: 'Required personal information is not available to Carve.',
    environment_lost: 'The authorized working environment is no longer available.',
    policy_boundary: 'The next step crosses Carve’s standing policy boundary.',
  }
  return `${reason[cause]} ${modelSummary}`.trim().slice(0, 500)
}

/** A proposal rejection is control-plane evidence, not task or safety evidence.
 * Carry its origin and appropriate repair as data so the orchestration layer
 * never has to infer all semantics from an arbitrary Error string. */
export class LiveComputerProposalRejectionError extends Error {
  readonly rejection: LiveComputerProposalRejection

  constructor(rejection: LiveComputerProposalRejection) {
    super(rejection.reason)
    this.name = 'LiveComputerProposalRejectionError'
    this.rejection = structuredClone(rejection)
  }
}

function proposalRepairFor(stage: LiveComputerProposalRejectionStage, cause: LiveComputerFailureCause): LiveComputerProposalRepair {
  if (stage === 'policy' || cause === 'policy_violation' || cause === 'prompt_injection' || cause === 'authentication_required') return 'human'
  if (stage === 'schema') return 'same_frame'
  if (stage === 'critic' || stage === 'executive') return 'new_tactic'
  if (cause === 'evidence_stale') return 'fresh_observation'
  if (cause === 'requirement_conflict') return 'human'
  if (cause === 'artifact_not_ready') return 'new_tactic'
  if (cause === 'focus_miss' || cause === 'target_moved' || cause === 'surface_mismatch' || cause === 'control_ambiguous') return 'fresh_observation'
  if (cause === 'target_covered') return 'new_tactic'
  if (cause === 'resource_identity_mismatch' || cause === 'route_unavailable') return 'new_tactic'
  if (cause === 'plan_invalid') return 'new_objectives'
  return 'new_tactic'
}

/** Convert legacy validator errors at one explicit stage boundary. New code
 * should throw this type directly; the fallback keeps older adapters readable
 * while the typed contract propagates through recovery and audit. */
export function liveComputerProposalRejection(
  reason: unknown,
  stage: LiveComputerProposalRejectionStage = 'unknown',
  overrides: Partial<Omit<LiveComputerProposalRejection, 'reason' | 'stage'>> = {},
): LiveComputerProposalRejectionError {
  const existing = reason instanceof LiveComputerProposalRejectionError ? reason.rejection : null
  const boundedReason = (existing?.reason ?? String(reason)).replace(/^Error:\s*/u, '').trim().slice(0, 500)
    || 'The proposed action was rejected before execution.'
  const effectiveStage = existing?.stage ?? stage
  const explicitCause = overrides.cause ?? existing?.cause ?? null
  const inferredCause = explicitCause
    ?? (effectiveStage === 'schema' ? 'plan_invalid' : liveComputerFailureCause(boundedReason))
  // Typed origin wins over words in a diagnostic. “Outside the selected
  // window” can describe a harmless, input-free geometry rejection; it is an
  // authority boundary only when the policy layer or a policy-typed cause
  // says so. String inference remains a legacy fallback for untyped errors.
  const safetyBoundary = effectiveStage !== 'capability' && (existing?.safetyImpact === 'authority_boundary'
    || effectiveStage === 'policy'
    || inferredCause === 'policy_violation'
    || inferredCause === 'prompt_injection'
    || explicitCause === null && liveComputerPlanningFailureCrossesBoundary(boundedReason))
  const cause: LiveComputerFailureCause = safetyBoundary && inferredCause === 'unknown' ? 'policy_violation' : inferredCause
  const repair = overrides.repair ?? existing?.repair ?? proposalRepairFor(effectiveStage, cause)
  const countsToward = overrides.countsToward ?? existing?.countsToward
    ?? (safetyBoundary ? 'safety'
      : repair === 'same_frame' ? 'serialization'
        : repair === 'fresh_observation' ? 'grounding'
          : 'strategy')
  const diagnostics = overrides.diagnostics ?? existing?.diagnostics
    ?? (reason instanceof LiveComputerActionError && reason.diagnostics ? reason.diagnostics : undefined)
  return new LiveComputerProposalRejectionError({
    stage: effectiveStage,
    cause,
    repair,
    safetyImpact: safetyBoundary ? 'authority_boundary' : 'none',
    countsToward,
    reason: boundedReason,
    proposalAttempts: Math.max(1, Math.floor(overrides.proposalAttempts ?? existing?.proposalAttempts ?? 1)),
    ...(diagnostics ? { diagnostics } : {}),
  })
}

/** Repeated syntax or tactical mistakes may be re-planned. Repeated attempts
 * to cross a standing boundary may not: this classification is over messages
 * emitted by Carve's own validators, never over untrusted screen text. */
export function liveComputerPlanningFailureCrossesBoundary(reason: unknown): boolean {
  const message = String(reason)
  return /\b(?:unauthori[sz]ed|authority|observation only|sensitive element|credential|password|one-time code|payment|purchase|permission|delete|install|may never perform|outside this (?:authorized )?session|prohibited outside the selected window|safe navigation keys|instructions rather than a search query)\b/iu.test(message)
}

/** Proposal failures with this shape represent a genuine unresolved fork,
 * not a schema typo and not an authority boundary. They become a resumable
 * decision point only after the planner explicitly reports materially
 * plausible alternatives; generic uncertainty keeps using bounded repair. */
export function liveComputerPlanningFailureNeedsGuidance(reason: unknown): boolean {
  const message = String(reason)
  return /\b(?:two|multiple|several)\s+(?:materially\s+)?(?:plausible|equally plausible|matching)\s+(?:\w+\s+){0,3}(?:controls?|targets?|options?)\b|\bcannot distinguish between\b/iu.test(message)
}

/** Mechanical proposal defects can receive one extra local, input-free repair
 * on the same fresh frame. They do not justify a new task strategy and must
 * not consume the semantic-replan allowance by themselves. */
export function liveComputerProposalFailureIsMechanical(reason: unknown): boolean {
  const message = String(reason)
  return /\b(?:schema|grounding|target element|element bounds|point lies|pointer actions require a target point|typing actions require|scroll amount is outside|visual provider did not return|unsupported live action|action (?:needs|has invalid|does not identify)|route\/target mismatch|interaction surface mismatch|browser_location|browser location while|modal search field|visible site\/application interaction channel)\b/iu.test(message)
}

/** `route` describes the stable interaction channel, while the point and
 * target label describe the immediate surface. A browser-location route may
 * never silently target an on-page modal or form. Detect that contradiction
 * deterministically before spending executive or critic calls. */
export function liveComputerActionSurfaceMismatch(
  action: LiveComputerAction,
  frame: number | Pick<LiveComputerFrame, 'height' | 'contentBounds'>,
): string | null {
  if (!['move', 'click', 'type_into'].includes(action.kind)) return null
  const target = `${action.targetLabel ?? ''} ${action.summary}`.toLocaleLowerCase()
  const explicitlyBrowserChrome = /\b(?:browser|chrome)\s+(?:address|location|url)\s*(?:bar|field)?\b|\b(?:address|location|url)\s+bar\b|\bomnibox\b/iu.test(target)
  const windowHeight = typeof frame === 'number' ? frame : frame.height
  const content = typeof frame === 'number' ? null : frame.contentBounds
  const chromeBand = Math.max(72, Math.min(150, Math.round(windowHeight * 0.16)))
  const pointIsInPage = action.point !== null && (content
    ? action.point.x >= content.x && action.point.y >= content.y
      && action.point.x < content.x + content.width && action.point.y < content.y + content.height
    : action.point.y > chromeBand)
  const explicitlyInPage = /\b(?:modal|dialog|site|page|form|project|screen(?:ing)?|search)\b[\s\S]*\b(?:field|input|box|control)\b|\baddress,?\s+place\b/iu.test(target)
  const surface = liveComputerActionSurface(action)
  if (action.surface) {
    if (surface === 'browser_chrome') {
      if (!pointIsInPage && !explicitlyInPage) return null
      return 'Interaction surface mismatch: surface browser_chrome targets the browser frame, but the proposed point or control is in page content. Keep the approved navigation intent and declare the physical surface actually receiving input.'
    }
    if (['web_page', 'native_app', 'overlay'].includes(surface)) {
      if (!pointIsInPage && explicitlyBrowserChrome) {
        return `Interaction surface mismatch: surface ${surface} targets application content, but the proposed control is browser chrome.`
      }
      // A strategic browser-location route may legitimately continue through
      // a results webpage. The typed surface, not the legacy route label,
      // determines where this individual action lands.
      return null
    }
  }
  if (canonicalLiveComputerRoute(action.route) !== 'browser_location') return null
  if (explicitlyBrowserChrome && !pointIsInPage) return null
  if (!pointIsInPage && !explicitlyInPage) return null
  return 'Interaction surface mismatch: route browser_location is browser chrome, but the proposed target is an in-page control. Keep the same objective and query, set route to the visible site/application interaction channel, and use replanReason only if the source or destination itself changes.'
}

function tabPhysicalAction(action: LiveComputerAction): LiveComputerAction {
  const key = action.kind === 'new_tab'
    ? 'CMD+T'
    : action.key?.trim().toUpperCase() === 'NEXT'
      ? 'CTRL+TAB'
      : 'CTRL+SHIFT+TAB'
  return { ...action, kind: 'keypress', key, point: null, targetElementId: null, text: null, scrollY: null }
}

function applyVerifiedTabTransition(session: LiveComputerSession, transition: LiveComputerTransition): void {
  if (transition.kind === 'new_tab') {
    session.tabWorkspace = { managedTabOpen: true, activeTab: 'managed', windowId: session.target.windowId }
    return
  }
  if (transition.kind !== 'cycle_tab') return
  const direction = transition.key?.trim().toUpperCase()
  if (direction === 'PREVIOUS') session.tabWorkspace.activeTab = 'original'
  if (direction === 'NEXT') session.tabWorkspace.activeTab = 'managed'
}

/**
 * The single grounding invariant for typed field text on a navigation or
 * lookup objective. A query's authority comes from exactly two places,
 * mirroring the mission contract:
 *
 * 1. The approved plan — the person's own goal words, the ledger subject,
 *    the active objective's text, and the bound entity labels (followed
 *    through relatedTo). A query drawn mostly (≥60% of its terms) from this
 *    vocabulary is on-task by construction. For enter_query it must also
 *    carry at least one grounded term that is not merely a site name, so a
 *    site's own name never becomes a query into its own search box — while
 *    a route objective may still search FOR a site by name to reach it.
 * 2. Verified evidence — the fact log and runtime entity resolutions. A
 *    mid-run discovery ("Spain is the winner") mints an anchor no plan-time
 *    label could predict, and a query carrying such an anchor may add a few
 *    novel qualifier terms ("national football team") within the novelty
 *    budget.
 *
 * Everything else is refused, and the refusal names the vocabulary that
 * WOULD be accepted, so the single repair attempt can converge instead of
 * failing blind against an opaque error. Screen content can influence this
 * check only by first passing criterion verification into the fact log, and
 * even then it contributes typeable terms, never directives.
 */
const fieldEntryNoveltyBudget = 3
// A discovered identity is short — "a national team", "a city club
// Wikipedia". The evidence-anchored branch exists only for that shape,
// so it caps the typed length: without this, a poisoned frame whose whole
// observedState (an injected directive sentence) lands in the fact log would
// make every word of that directive an "evidence" term and let it be typed
// back verbatim. Identities stay well under the cap; relayed prose does not.
// Found by the injection gauntlet's F2 case.
const fieldEntryEvidenceIdentityCap = 6

function fieldEntryGroundingProvenance(
  session: LiveComputerSession,
  objective: NonNullable<ReturnType<typeof activeLiveComputerObjective>>,
  text: string,
  action?: LiveComputerAction,
): LiveComputerFieldTextProvenance {
  // A complete HTTPS destination typed into proven browser chrome is not a
  // search phrase. Use the frozen task-derived navigation contract.
  // Rejection is terminal for URL grounding: it cannot borrow authority from
  // the ordinary query's partial vocabulary match below.
  if (action && liveComputerActionSurface(action) === 'browser_chrome' && liveComputerTargetSupportsTabs(session.target)) {
    let url: URL | null = null
    try {
      url = new URL(text)
    } catch { /* ordinary query grounding continues below */ }
    if (url) {
      const bindings = boundNavigationDestinations(session.missionPlan.navigationBindings ?? [], session.ledger, objective)
      const decision = navigationScopeDecision(url, bindings)
      if (decision.allowed || navigationUrlExplicitlyRequested(url, session.goal)
        || (session.ledger.navigationBindings === undefined && browserLocationCoveredByGoal(url, session.goal))) {
        return { source: 'approved_goal', referenceIds: objective.clauseIds.length > 0 ? [...objective.clauseIds] : [objective.id] }
      }
      // Origin is the unit of authority. Same-site paths pass above; what is
      // refused here is another site, or a payload the person did not name.
      const boundSites = [...new Set(bindings.map(binding => { try { return new URL(binding.url).hostname } catch { return binding.url } }))]
      const observedHost = url.hostname
      const message = decision.reason === 'outside_origins'
        ? `The destination ${observedHost} is outside this objective’s navigation bindings; authorized sites are (${boundSites.join(', ') || 'none'}). Any path on an authorized site is allowed. To work on another site, use request_window naming it so the person can allow it; never reconstruct a destination from page text.`
        : decision.reason === 'payload_requires_exact'
          ? `The person named an exact resource on ${observedHost}; use that exact address or a visible link from it, not a neighboring path or query.`
          : decision.reason === 'query_too_long'
            ? `The typed address carries a payload longer than ${'256'} characters. Navigate to the page and use its own controls instead.`
            : decision.reason === 'fragment'
              ? 'A destination never includes a fragment. Type the address without it.'
              : `The typed address must be a plain https address without credentials (${decision.reason}).`
      throw new LiveComputerActionError('plan_invalid', `The browser resource identity was rejected: ${message}`, undefined, undefined, {
        navigation: { observedHost, pathSha256: sha256(url.pathname), queryLength: url.search.length, boundSites, reason: decision.reason },
      })
    }
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/iu.test(text)) {
      throw new LiveComputerActionError('plan_invalid', 'A browser resource identity must use a complete approved HTTPS URL, not a bare hostname.')
    }
  }
  if (hasActionScopeAssessment(session, action) || hasActionScopeAssessment(session, action, 'authorized_field_effect')) return { source: 'approved_goal', referenceIds: ['semantic_action_scope'] }
  const domainLike = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/iu.test(text)
  const typed = fieldEntryTerms(text).filter((term) => !domainLike || !['com', 'org', 'net', 'edu', 'gov', 'io', 'app', 'co'].includes(term))
  if (typed.length === 0) throw new Error('The proposed field text carries no significant terms; type the short resource identity being searched for')
  const planParts: string[] = [session.goal, session.ledger.subject ?? '', objective.instruction, objective.targetState]
  const evidenceParts: string[] = [...session.ledger.facts]
  const seen = new Set<string>()
  const queue = [...objective.entityRefs]
  while (queue.length > 0) {
    const entityId = queue.pop()
    if (!entityId || seen.has(entityId)) continue
    seen.add(entityId)
    const entity = session.ledger.entities.find((candidate) => candidate.id === entityId)
    if (!entity) continue
    planParts.push(entity.label)
    if (entity.resolvedLabel) evidenceParts.push(entity.resolvedLabel)
    if (entity.relatedTo) queue.push(entity.relatedTo)
  }
  const planCorpus = new Set(taskTerms(planParts.join(' ')))
  const evidenceCorpus = new Set(taskTerms(evidenceParts.join(' ')))
  const siteTerms = new Set(session.ledger.entities.filter((entity) => entity.kind === 'site').flatMap((entity) => taskTerms(`${entity.label} ${entity.resolvedLabel ?? ''}`)))
  const grounded = typed.filter((term) => planCorpus.has(term) || evidenceCorpus.has(term))
  // "Drawn from the plan" must count ONLY the plan vocabulary — the person's
  // own words. Counting evidence terms here (as this once did) let a phrase
  // echoed wholesale from a poisoned frame reach the 60% bar on its own,
  // because every word was "grounded" as evidence. Evidence now earns a field
  // entry only through the narrow anchored branch below, which caps length so
  // a relayed sentence cannot masquerade as a discovered identity. (Injection
  // gauntlet F2/F4.)
  const planGrounded = typed.filter((term) => planCorpus.has(term))
  const drawnFromPlan = planGrounded.length / typed.length >= 0.6
    && (objective.kind !== 'enter_query' || planGrounded.some((term) => !siteTerms.has(term)))
  const anchoredInEvidence = typed.some((term) => evidenceCorpus.has(term) && !siteTerms.has(term))
    && typed.length - grounded.length <= fieldEntryNoveltyBudget
    && typed.length <= fieldEntryEvidenceIdentityCap
  if (drawnFromPlan) {
    const matchingEntities = session.ledger.entities
      .filter((entity) => objective.entityRefs.includes(entity.id))
      .filter((entity) => taskTerms(entity.label).some((term) => typed.includes(term)))
      .map((entity) => entity.id)
    return matchingEntities.length > 0
      ? { source: 'planned_entity', referenceIds: matchingEntities }
      : { source: 'approved_goal', referenceIds: objective.clauseIds.length > 0 ? [...objective.clauseIds] : [objective.id] }
  }
  if (anchoredInEvidence) {
    const matchingEntities = session.ledger.entities
      .filter((entity) => entity.resolvedLabel && taskTerms(entity.resolvedLabel).some((term) => typed.includes(term)))
      .map((entity) => entity.id)
    if (matchingEntities.length > 0) return { source: 'verified_entity', referenceIds: matchingEntities }
    const matchingFacts = session.ledger.facts
      .filter((fact) => taskTerms(fact).some((term) => typed.includes(term)))
      .map((fact) => `fact:${sha256(fact).slice(0, 16)}`)
    return { source: 'verified_fact', referenceIds: matchingFacts }
  }
  if (session.ledger.taskState) throw new ActionScopeReviewRequired('Assess this search semantically against the original task and current receiver; vocabulary overlap cannot decide its relevance or disclosure scope.')
  throw new Error(fieldEntryGroundingFailure(session, objective))
}

function assertFieldEntryGrounded(session: LiveComputerSession, objective: NonNullable<ReturnType<typeof activeLiveComputerObjective>>, text: string, action?: LiveComputerAction): void {
  fieldEntryGroundingProvenance(session, objective, text, action)
}

/** The refusal teaches: it flows verbatim into the repair prompt, so it
 * names the vocabulary an acceptable query would draw from. */
function fieldEntryGroundingFailure(session: LiveComputerSession, objective: NonNullable<ReturnType<typeof activeLiveComputerObjective>>): string {
  const bound = objective.entityRefs
    .map((entityId) => session.ledger.entities.find((candidate) => candidate.id === entityId))
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
  const identities = [...new Set([
    ...bound.filter((entity) => entity.kind === 'resource' || entity.kind === 'content').map((entity) => (entity.resolvedLabel ?? entity.label).trim()),
    ...(session.ledger.subject?.trim() ? [session.ledger.subject.trim()] : []),
  ].filter((identity) => identity))]
  const examples = identities.slice(0, 3).map((identity) => `"${identity.slice(0, 60)}"`).join(', ')
  return 'The proposed field text is not grounded in the approved mission plan or this session\'s verified evidence. '
    + 'Type the short resource identity being searched for, composed from the plan\'s own words'
    + (examples ? ` (e.g. ${examples})` : '')
    + ' or from a name already verified on screen this session.'
}

function inferCriterionFailureCause(result: LiveComputerCriterionResult): LiveComputerFailureCause {
  const observed = result.observedState.toLocaleLowerCase()
  if (/\b(?:loading|spinner|still opening|not settled)\b/iu.test(observed)) return 'transient_loading'
  if (/\b(?:not focused|focus|caret)\b/iu.test(observed)) return 'focus_miss'
  if (/\b(?:ambiguous|multiple|two plausible|cannot identify)\b/iu.test(observed)) return 'control_ambiguous'
  if (/\b(?:moved|no longer visible|layout changed|target changed)\b/iu.test(observed)) return 'target_moved'
  if (/\b(?:sign in|log in|authentication|captcha)\b/iu.test(observed)) return 'authentication_required'
  if (/\b(?:route unavailable|page unavailable|not found)\b/iu.test(observed)) return 'route_unavailable'
  return 'unknown'
}

/** Map free-form provider, validator, and backend errors into the same causal
 * vocabulary used by recovery and aggregate evaluation. The raw message is
 * never needed outside the individual audit event. */
export function liveComputerFailureCause(reason: unknown): LiveComputerFailureCause {
  const normalized = String(reason).toLocaleLowerCase()
  if (/is covered by a|would receive the click at that point/iu.test(normalized)) return 'target_covered'
  if (/effect (?:may have occurred|could not be verified)|crossed its commit point/iu.test(normalized)) return 'operation_effect_uncertain'
  if (/exact output file did not appear|operation postcondition|accepted the operation.*could not be proved/iu.test(normalized)) return 'operation_postcondition_failed'
  if (/\b(?:proposed target|pointer action|scroll point|drag destination|field-entry submit point)\b.*\boutside\b/iu.test(normalized)) return 'target_moved'
  if (/credential|password|one-time|otp|sensitive|irreversible|prohibited|permission change|unauthorized window|outside this (?:authorized )?session/iu.test(normalized)) return 'policy_violation'
  if (/prompt injection|untrusted instruction/iu.test(normalized)) return 'prompt_injection'
  if (/interaction surface mismatch|surface (?:browser_chrome|web_page|native_app|overlay)/iu.test(normalized)) return 'surface_mismatch'
  if (/field text is not grounded|resource identity|approved mission plan.*verified evidence/iu.test(normalized)) return 'resource_identity_mismatch'
  if (/localized field acceptance|field state is still ambiguous|no channel proved|delivery remains unknown/iu.test(normalized)) return 'field_acceptance_unknown'
  if (/exact selected window|window.*(?:gone|unavailable|raise|verified)|selected window.*(?:closed|missing)/iu.test(normalized)) return 'environment_lost'
  if (/sign.?in|log.?in|authentication|captcha/iu.test(normalized)) return 'authentication_required'
  if (/ambiguous|multiple matches/iu.test(normalized)) return 'control_ambiguous'
  if (/focus|caret/iu.test(normalized)) return 'focus_miss'
  if (/text-delivery|accept either|typing|input/iu.test(normalized)) return 'input_not_accepted'
  if (/target|coordinate|layout|moved/iu.test(normalized)) return 'target_moved'
  if (/route|navigation/iu.test(normalized)) return 'route_unavailable'
  if (/timeout|timed out|loading/iu.test(normalized)) return 'transient_loading'
  return 'unknown'
}

function recoveryDispositionFor(cause: LiveComputerFailureCause): LiveComputerTaskLedger['disposition'] {
  if (cause === 'focus_miss' || cause === 'target_moved' || cause === 'control_ambiguous' || cause === 'surface_mismatch' || cause === 'resource_identity_mismatch') return 'reground'
  if (cause === 'field_acceptance_unknown') return 'reconcile_input'
  if (cause === 'operation_postcondition_failed' || cause === 'operation_effect_uncertain') return 'handoff'
  if (cause === 'route_unavailable' || cause === 'plan_invalid') return 'replan'
  return 'retry_same_objective'
}

function failureSignature(transition: LiveComputerTransition, cause: LiveComputerFailureCause): string {
  return sha256(stableJson({
    objectiveId: transition.objectiveId,
    routeKey: transition.routeKey,
    target: normalizeEvidence(transition.targetLabel ?? 'untargeted'),
    mechanism: transition.kind,
    cause,
  }))
}

function normalizeEvidence(value: string): string {
  return value.toLocaleLowerCase().replace(/\b\d+(?:\.\d+)?\b/gu, '#').replace(/[^a-z#]+/gu, ' ').trim().slice(0, 180)
}

function resetRecovery(session: LiveComputerSession, progressSequence: number): void {
  const recoveryEpisodes = session.ledger.recovery.recoveryEpisodes ?? 0
  const proposalRejectionHistory = session.ledger.recovery.proposalRejectionHistory ?? []
  const activeEpisodeId = session.ledger.recovery.activeEpisodeId
  const episodeAttempt = activeEpisodeId ? session.ledger.transitions.find(t => t.recoveryEpisodeId === activeEpisodeId) : null
  const episodeUnfinished = episodeAttempt && session.ledger.objectives.some(o => o.id === episodeAttempt.objectiveId && o.status !== 'verified')
  session.ledger.noProgressCount = 0
  session.ledger.disposition = 'continue'
  session.ledger.recovery = {
    cause: null,
    disposition: 'continue',
    failureSignature: null,
    repeatedFailureCount: 0,
    stalledAttempts: 0,
    recoveryEpisodes,
    ...(episodeUnfinished && activeEpisodeId ? { activeEpisodeId } : {}),
    strategiesTried: [],
    lastProgressSequence: progressSequence,
    proposalDenials: 0,
    planningReplans: 0,
    lastPlanningFailure: null,
    lastProposalRejection: null,
    proposalRejectionHistory: proposalRejectionHistory.slice(-12),
    graphReplans: 0,
  }
}

function validateCriterion(result: LiveComputerCriterionResult): void {
  const prior = result.priorOperationAssessment
  if (prior && (typeof prior.operationId !== 'string' || !prior.operationId || prior.operationId.length > 240
    || !['supported', 'contradicted', 'unresolved'].includes(prior.state)
    || typeof prior.evidence !== 'string' || !prior.evidence.trim() || prior.evidence.length > 500)) {
    throw new Error('The prior operation assessment is invalid')
  }
  if (typeof result.criterionMet !== 'boolean' || typeof result.objectiveComplete !== 'boolean' || typeof result.goalComplete !== 'boolean') throw new Error('The live criterion result is invalid')
  if (result.semanticCriterionMet !== undefined && typeof result.semanticCriterionMet !== 'boolean') throw new Error('The live semantic criterion result is invalid')
  if (result.presentationMatch !== undefined && !['exact', 'equivalent', 'insufficient'].includes(result.presentationMatch)) throw new Error('The live criterion presentation match is invalid')
  if (result.stateTransitionRequired !== undefined && typeof result.stateTransitionRequired !== 'boolean') throw new Error('The live criterion state-transition judgment is invalid')
  if (result.blockingMismatch !== undefined && !['none', 'wrong_resource', 'missing_evidence', 'stale_observation', 'authority_violation', 'ambiguous_entity'].includes(result.blockingMismatch)) {
    throw new Error('The live criterion blocking mismatch is invalid')
  }
  if (!result.observedState?.trim() || result.observedState.length > 500) throw new Error('The live criterion result needs a bounded observed state')
  if (!['advanced', 'unchanged', 'regressed', 'uncertain'].includes(result.progress)) throw new Error('The live criterion progress value is invalid')
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new Error('The live criterion confidence is invalid')
  if (result.actionApplied !== undefined && typeof result.actionApplied !== 'boolean') throw new Error('The live criterion action-applied judgment is invalid')
  if (result.failureCause !== undefined && result.failureCause !== null && ![
    'transient_loading', 'focus_miss', 'target_moved', 'control_ambiguous', 'route_unavailable', 'input_not_accepted',
    'surface_mismatch', 'resource_identity_mismatch', 'field_acceptance_unknown', 'environment_lost', 'authentication_required',
    'policy_violation', 'prompt_injection', 'budget_exhausted', 'plan_invalid', 'provider_unavailable', 'unknown',
  ].includes(result.failureCause)) throw new Error('The live criterion failure cause is invalid')
  if (result.riskSignal !== undefined && !['none', 'suspicious', 'authority_violation'].includes(result.riskSignal)) throw new Error('The live criterion risk signal is invalid')
  if (result.evidence !== undefined && (!Array.isArray(result.evidence) || result.evidence.length > 5 || result.evidence.some((value) => typeof value !== 'string'))) {
    throw new Error('The live criterion evidence is invalid')
  }
  if (result.additionalSatisfiedObjectives !== undefined
    && (!Array.isArray(result.additionalSatisfiedObjectives)
      || result.additionalSatisfiedObjectives.length > 3
      || result.additionalSatisfiedObjectives.some((value) => !value
        || typeof value.objectiveId !== 'string' || !value.objectiveId.trim() || value.objectiveId.length > 80
        || typeof value.evidence !== 'string' || !value.evidence.trim() || value.evidence.length > 240))) {
    throw new Error('The additional satisfied-objective evidence is invalid')
  }
}

function validateApproval(approval: LiveComputerApproval): void {
  if (!['immediate', 'group', 'countdown', 'automatic'].includes(approval.kind)) throw new Error('The live supervision checkpoint is invalid')
  if (approval.kind === 'countdown') {
    if (!approval.expiresAt || !Number.isFinite(new Date(approval.expiresAt).getTime())) throw new Error('A live countdown requires a valid expiry')
  } else if (approval.expiresAt !== null) throw new Error('Only a live countdown may carry an expiry')
}

function looksSensitive(text: string): boolean {
  return /\b(password|passcode|one[- ]?time|otp|api[_ -]?key|secret|private key|cvv|security code)\b/iu.test(text)
}

function activityPhaseForSession(session: LiveComputerSession): LiveComputerActivityPhase {
  switch (session.status) {
    case 'initializing': return 'preparing'
    case 'ready': return session.ledger.recovery.cause ? 'recovering' : 'deciding'
    case 'acting':
    case 'reconciling_input': return 'acting'
    case 'verifying': return 'verifying'
    case 'paused': return 'paused'
    case 'awaiting_plan_approval':
    case 'awaiting_context_transfer':
    case 'awaiting_guidance': return 'waiting'
    case 'awaiting_approval': return session.pendingApproval?.kind === 'immediate' || session.pendingApproval?.kind === 'group' ? 'waiting' : 'deciding'
    case 'handoff':
    case 'completed':
    case 'blocked':
    case 'stopped': return 'ended'
  }
}

/** Turn controller-owned operational notes into a compact live briefing. This
 * does not consume provider scratch text: it only restructures the same
 * bounded summaries already shown in the existing activity feed. */
function briefingCopy(message: string): { headline: string; detail: string | null } {
  const normalized = message.replace(/\s+/gu, ' ').trim()
  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/u)
  if (sentenceEnd < 0 || sentenceEnd >= 176) {
    return { headline: normalized.slice(0, 180), detail: normalized.length > 180 ? normalized.slice(180, 580).trim() : null }
  }
  return {
    headline: normalized.slice(0, sentenceEnd + 1),
    detail: normalized.slice(sentenceEnd + 1).trim().slice(0, 400) || null,
  }
}

function terminal(status: LiveComputerSession['status']): boolean {
  return ['handoff', 'completed', 'blocked', 'stopped'].includes(status)
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('Live computer action was stopped')) }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolvePromise()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function artifactActionBinding(session: LiveComputerSession, action: LiveComputerAction): string {
  return sha256(stableJson({ session: session.id, mission: session.missionPlan, target: session.target,
    requirements: session.ledger.outcomeContract?.requirements, resolutions: session.ledger.requirementResolutions,
    artifact: session.ledger.artifacts.find(a => a.id === action.artifactId), layout: action.artifactLayout, unit: action.artifactUnit }))
}

function validateDecisionOptions(questionText: string, context: string, choices: NonNullable<LiveComputerAction['options']>): void {
  const question = questionText.trim()
  if (!question || question.length > 300) throw new Error('A decision point needs one clear question under 300 characters')
  if (context.length > 500) throw new Error('Decision context must stay under 500 characters')
  const options = choices
  if (options.length > 4) throw new Error('A decision point offers up to four options; the person can always answer in their own words')
  const ids = new Set<string>()
  for (const option of options) {
    if (!option.id?.trim() || option.id.length > 40 || ids.has(option.id)) throw new Error('Each decision option needs a unique short id')
    ids.add(option.id)
    if (!option.label?.trim() || option.label.length > 80) throw new Error('Each decision option needs a label under 80 characters')
    if (!option.consequence?.trim() || option.consequence.length > 160) throw new Error('Each decision option must state its consequence under 160 characters')
    if (option.mode !== 'agent_continues' && option.mode !== 'person_takes_over') throw new Error('Each decision option is agent_continues or person_takes_over')
    // A chip can never launder authority the contract forbids: an option
    // naming a prohibited capability is only offerable as the person's own
    // step.
    if (option.mode === 'agent_continues'
      && /\b(?:account|sign\s?up|register|log\s?in|sign\s?in|password|credential|pay(?:ment)?|purchase|buy|subscribe|checkout|billing|card|delete|install|permission)\b/iu.test(`${option.label} ${option.consequence}`)) {
      throw new Error(`Option "${option.label.slice(0, 40)}" names a capability Carve may never perform; offer it as person_takes_over`)
    }
  }
  if (looksSensitive(`${question} ${options.map((option) => `${option.label} ${option.consequence}`).join(' ')}`)) {
    throw new Error('A decision point must not carry credential-like content')
  }
}
