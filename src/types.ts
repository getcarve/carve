import type { FreshDocumentReceipt } from './fresh-document.js'
import type { BrowserResearchScope } from './browser-destinations.js'
import type { UniversalPlanReview } from './universal-plan-review.js'
import type { TaskRequirements, TaskRequirementResolution } from './task-requirements.js'
import type { ElementCaptureCompleteness } from './live-computer-protocol.js'
import type { ModelResponseTelemetry } from './providers/types.js'
import type { PublicLookupEvidence } from './public-web.js'
import type { PublicReadScope, LivePublicLookup } from './task-method.js'

export type Id = string

export type CaptureStatus = 'active' | 'paused' | 'stopped'
export type ObservationSource = 'fixture' | 'screen' | 'accessibility' | 'event'
export type TrustLevel = 'trusted_user' | 'untrusted_screen' | 'system'

export interface RegionExclusion {
  x: number
  y: number
  width: number
  height: number
}

export type CaptureTiming =
  | { mode: 'adaptive'; profile: 'balanced-v1' }
  | { mode: 'fixed'; intervalSeconds: number }
  | { mode: 'manual' }

export interface CapturePolicy {
  screenshots: boolean
  activeWindow: boolean
  accessibilityTree: boolean
  inputMetadata: boolean
  /** Read on-screen text locally with Vision OCR. Never enables input or control. */
  screenText: boolean
  /** How unattended observation decides when to save a frame. */
  captureTiming: CaptureTiming
  /** Legacy mirror retained while older stored sessions are migrated. */
  captureIntervalSeconds: number
  excludedApplications: string[]
  excludedWindows: string[]
  excludedDomains: string[]
  excludedRegions: RegionExclusion[]
  retentionDays: number
}

export interface LearningSession {
  id: Id
  name: string
  fixtureId: string
  goalHint: string
  status: CaptureStatus
  startedAt: string
  endedAt: string | null
  nextFixtureIndex: number
  capturePolicy: CapturePolicy
}

export interface AccessibilityElement {
  role: string
  name: string
  identifier?: string
  value?: string
  bounds?: RegionExclusion
  sensitive?: boolean
}

export interface CapturedFacts {
  app: string
  windowTitle: string
  url?: string
  screenshotRef?: string
  text: string
  accessibility?: AccessibilityElement[]
  inputEvent?: { kind: 'click' | 'keypress' | 'scroll'; target?: string }
  state: Record<string, string | number | boolean>
}

export interface ObservationRecord {
  id: Id
  sessionId: Id
  sequence: number
  observedAt: string
  source: ObservationSource
  trust: TrustLevel
  facts: CapturedFacts
  redactions: string[]
  excluded: boolean
  exclusionReason: string | null
  injectionSignals: string[]
  evidenceHash: string
}

export type ObservationReviewDisposition = 'approved' | 'excluded'
export type ObservationAnnotationKind = 'state' | 'input' | 'decision' | 'outcome' | 'interruption' | 'irrelevant'
export type TaskBoundary = 'none' | 'start' | 'end' | 'start_end'

export interface ObservationReview {
  id: Id
  observationId: Id
  sessionId: Id
  version: number
  disposition: ObservationReviewDisposition
  annotationKind: ObservationAnnotationKind
  taskBoundary: TaskBoundary
  label: string
  notes: string
  /** Human-authored visual facts used for local/embedding retrieval. */
  visualDescription: string
  crop: RegionExclusion | null
  masks: RegionExclusion[]
  sourceScreenshotRef: string | null
  sanitizedScreenshotRef: string | null
  sourceEvidenceHash: string
  originalDeleted: boolean
  createdAt: string
  createdBy: 'user'
}

export interface ObservationReviewInput {
  disposition: ObservationReviewDisposition
  annotationKind: ObservationAnnotationKind
  taskBoundary: TaskBoundary
  label: string
  notes: string
  visualDescription?: string
  crop?: RegionExclusion | null
  masks?: RegionExclusion[]
  createSanitizedCopy?: boolean
  discardSourceScreenshot?: boolean
}

/** Exact reviewed pixels prepared for a hosted recall-vision request. */
export interface RecallImageEgress {
  id: Id
  occurredAt: string
  observationId: Id
  momentId: Id
  reviewId: Id
  reviewVersion: number
  sanitizedScreenshotRef: string
  sourceEvidenceHash: string
  imageSha256: string
  providerId: string
  model: string
}

export interface ReviewedEpisodeSegment {
  id: Id
  name: string
  observationIds: Id[]
  decisions: string[]
  inputs: string[]
  outcomes: string[]
}

export interface ReviewedEpisode {
  sessionId: Id
  executable: false
  approvedObservationIds: Id[]
  excludedObservationIds: Id[]
  pendingObservationIds: Id[]
  segments: ReviewedEpisodeSegment[]
  readyForSegmentation: boolean
  blockers: string[]
}

export type AiDraftStatus = 'proposed' | 'accepted' | 'rejected'
export type AiDraftStepKind = 'state' | 'input' | 'decision' | 'outcome' | 'exception'

export interface AiDraftStep {
  id: Id
  name: string
  description: string
  kind: AiDraftStepKind
  preconditions: string[]
  postconditions: string[]
  confidence: number
  evidenceObservationIds: Id[]
  factBasis: string[]
  interpretation: string[]
}

export interface AiDraftEdge {
  from: Id
  to: Id
  condition: string | null
}

export interface AiWorkflowProposal {
  goal: string
  summary: string
  preconditions: string[]
  requiredInputs: string[]
  expectedOutputs: string[]
  startStepId: Id
  steps: AiDraftStep[]
  edges: AiDraftEdge[]
}

export interface AiInductionEvidenceDisclosure {
  observationId: Id
  reviewId: Id
  sequence: number
  annotationKind: ObservationAnnotationKind
  label: string
  hasSanitizedImage: boolean
  sourceEvidenceHash: string
}

export interface AiInductionDisclosure {
  sessionId: Id
  providerId: string
  providerName: string
  providerKind: ModelProviderSummary['kind']
  model: string
  privacyNote: string
  manifestHash: string
  requiresExternalTransmission: boolean
  confirmationPhrase: 'SEND APPROVED EVIDENCE' | null
  evidence: AiInductionEvidenceDisclosure[]
  imageCount: number
  omittedExcludedCount: number
  omittedPendingCount: number
  sentFields: string[]
  blockedReasons: string[]
  ready: boolean
  executableOutput: false
}

export interface AiDraftValidation {
  valid: boolean
  errors: string[]
  approvedEvidenceOnly: boolean
  executableFieldsRejected: boolean
}

export interface AiWorkflowDraft {
  id: Id
  sessionId: Id
  version: number
  status: AiDraftStatus
  providerId: string
  providerKind: ModelProviderSummary['kind']
  model: string
  proposal: AiWorkflowProposal
  disclosure: {
    manifestHash: string
    evidenceObservationIds: Id[]
    reviewIds: Id[]
    imageObservationIds: Id[]
    sourceEvidenceHashes: string[]
    sentFields: string[]
    requiresExternalTransmission: boolean
  }
  validation: AiDraftValidation
  usage: { inputTokens: number | null; outputTokens: number | null }
  correctionSummary: string | null
  executable: false
  createdAt: string
  decidedAt: string | null
}

export type AiDraftCorrection =
  | { operation: 'rename'; goal?: string; summary?: string }
  | { operation: 'update_step'; stepId: Id; name?: string; description?: string }

export type MemoryEntityKind = 'task' | 'application' | 'document' | 'customer' | 'organization' | 'concept' | 'artifact'

export interface MemoryEntity {
  id: Id
  kind: MemoryEntityKind
  name: string
  attributes: Record<string, string | number | boolean>
  provenanceObservationIds: Id[]
  confidence: number
}

export interface MemoryEdge {
  id: Id
  fromId: Id
  relation: 'uses_application' | 'handles_document' | 'serves_customer' | 'involves_organization' | 'uses_concept' | 'produces_artifact'
  toId: Id
  provenanceObservationIds: Id[]
  confidence: number
}

export type ActionRisk = 'read_only' | 'safe' | 'reversible_write' | 'sensitive' | 'irreversible'
export type SensitiveActionClass =
  | 'communication'
  | 'financial'
  | 'authentication'
  | 'destructive'
  | 'installation'
  | 'privilege_escalation'
  | 'confidential_disclosure'
  | 'legal'
  | 'high_impact_decision'

export interface VerificationSpec {
  method: 'state_equals' | 'artifact_exists' | 'none'
  target: string
  expected: string | number | boolean | null
}

export interface ActionSpec {
  id: Id
  tool: string
  input: Record<string, unknown>
  risk: ActionRisk
  sensitiveClass: SensitiveActionClass | null
  stateChanging: boolean
  preview: string
  expectedStateChange: string
  verification: VerificationSpec
  group: string
  /** Required for version-2 plans; omitted on stored version-1 actions. */
  effects?: ActionEffect[]
  /** The stable phase this action belongs to in a version-2 plan. */
  phaseId?: string
}

export type ActionEffectClass =
  | 'read_only'
  | 'safe_local'
  | 'reversible_local_write'
  | 'external_write'
  | 'communication'
  | 'submission'
  | 'financial'
  | 'destructive'
  | 'authentication'
  | 'installation'
  | 'privilege_escalation'
  | 'confidential_disclosure'
  | 'legal_acceptance'
  | 'high_impact_decision'
  /** A named, ordinary control ("Overview", "Load status") whose consequence
   * no rule can classify. Resolved as a control, so it is not an unknown
   * coordinate click; protected, so a person approves it at ordinary paces. */
  | 'unclassified_control'
  | 'unknown'

export interface ActionEffect {
  class: ActionEffectClass
  location: 'local' | 'external' | 'unknown'
  reversibility: 'none' | 'reversible' | 'irreversible' | 'unknown'
  target: string | null
  payloadDigest: string | null
  targetResolved: boolean
  payloadResolved: boolean
}

export interface WorkPhase {
  id: string
  title: string
  actionIds: string[]
  effectClasses: ActionEffectClass[]
  targets: string[]
  checkpointSummary: string
  hash: string
}

export interface WorkflowEdge {
  from: Id
  to: Id
  condition: string | null
}

export interface WorkflowStep {
  id: Id
  name: string
  description: string
  kind: 'action' | 'decision' | 'terminal'
  preconditions: string[]
  postconditions: string[]
  confidence: number
  action: ActionSpec | null
  evidenceObservationIds: Id[]
  factBasis: string[]
  interpretation: string[]
}

export interface ProcedureGraph {
  startStepId: Id
  steps: WorkflowStep[]
  edges: WorkflowEdge[]
}

export interface ProcedureEvidenceSummary {
  inductionMethod: 'deterministic_fixture_rules' | 'semantic_transition_alignment'
  completedSessionIds: Id[]
  interruptedSessionIds: Id[]
  quarantinedSessionIds: Id[]
  observedBranchValues: Record<string, string[]>
}

export interface ProcedureParameter {
  id: string
  label: string
  type: 'safe_text'
  required: boolean
  sensitive: false
  constraints: { minLength: number; maxLength: number }
  examples: string[]
  evidenceObservationIds: Id[]
  confidence: number
}

export interface ProcedureVersion {
  procedureId: Id
  version: number
  learningKey: string
  name: string
  goal: string
  confidence: number
  inputs: string[]
  parameters: ProcedureParameter[]
  outputs: string[]
  graph: ProcedureGraph
  provenanceObservationIds: Id[]
  evidenceSummary: ProcedureEvidenceSummary
  correctionSummary: string | null
  createdAt: string
}

export type AutonomyLevel =
  | 'observe_only'
  | 'preview'
  | 'approve_each'
  | 'approve_plan'
  | 'approve_group'
  | 'timed_approval'
  | 'constrained_autonomous'

/** What the person wants Carve to produce. Only execute creates input authority. */
export type WorkIntent = 'context_only' | 'plan_only' | 'execute'

/** Human-facing supervision choices. Custom is reserved for advanced controls. */
/** `autopilot` is the bypass pace: Carve acts on its own inside the selected
 * window, including resolved submissions, and resolves unknown effects before
 * input. It still stops for the hard floor (payments, deletions, sign-ins, installs, permissions,
 * legal terms, confidential data, messages, high-impact decisions). */
export type SupervisionPreset = 'fast' | 'smart_checkpoints' | 'step_by_step' | 'autopilot' | 'custom'

/** Versioned controller policy. The last three boundaries are hard invariants. */
export interface SupervisionPolicyV2 {
  version: 2
  preset: SupervisionPreset
  planReview: 'when_effects_require_it' | 'always'
  phaseBoundary: 'protected_only' | 'consequential_phases' | 'none'
  stateChangeBoundary: 'covered_by_plan' | 'each_state_change'
  physicalInputBoundary: 'policy_decides' | 'each_input'
  eligibleCountdownMs: number | null
  deviationBoundary: 'fresh_plan'
  unknownEffectBoundary: 'resolve_or_handoff'
  protectedEffectBoundary: 'immediate_or_handoff'
}

/** A human-scale control for the amount of computer work Carve may spend. */
export type WorkBudgetPreset = 'quick' | 'balanced' | 'thorough'

/** The exact, policy-bounded resource envelope attached to one plan. */
export interface WorkBudgetEnvelope {
  preset: WorkBudgetPreset
  maxActions: number
  /** Active work only. Time spent waiting for a person's approval is excluded. */
  maxDurationMinutes: number
  /** Technical ceilings stay behind the human-facing tier, but are frozen in
   * the contract so planning, vision, and recovery cannot become unbounded. */
  maxModelCalls?: number
  maxModelCallsPerAction?: number
  maxTotalTokens?: number
  maxVisionFrames?: number
  maxRecoveryEpisodes?: number
}

/** Durable receipt of resources actually consumed by a run. */
export interface WorkBudgetUsage {
  actionsUsed: number
  activeDurationMs: number
  /** Inference is work too. These fields are optional only for legacy runs. */
  modelCalls?: number
  inputTokens?: number
  outputTokens?: number
  visionFrames?: number
  recoveryEpisodes?: number
  /** Compact-loop accounting the outer recovery counter never saw: local
   * zero-token continuations, rejected final checks and repair turns. */
  localContinuations?: number
  verificationRejections?: number
  repairTurns?: number
  /** Failed requests (metered, usage often unknown) and same-turn retries. */
  failedModelRequests?: number
  providerRetries?: number
  unknownUsageRequests?: number
  /** False when a request's token usage was not returned: the token fields
   * above are then a known subtotal, not the total. */
  usageComplete?: boolean
}

export type WorkBudgetProgressAssessment = 'credible' | 'unclear' | 'stalled' | 'off_course'
export type WorkBudgetRecommendation = 'finish' | 'current_milestone' | 'change_approach' | 'policy_ceiling'

/** Controller-owned, privacy-safe estimate used at a resource checkpoint.
 * Universal has no independent semantic verifier, so these are explicitly
 * estimates rather than claims that a milestone is complete. */
export interface WorkBudgetFinishForecast {
  id: string
  version: string
  recommendedPreset: WorkBudgetPreset
  progress: WorkBudgetProgressAssessment
  recommendation: WorkBudgetRecommendation
  confidence: 'high' | 'medium' | 'low'
  estimatedTotalInputs: number
  estimatedRemainingInputs: number
  bufferInputs: number
  estimatedAdditionalTokens: number
  estimatedAdditionalMinutes: number
  remainingSteps: string[]
  reasonCodes: string[]
  rationale: string
}

/** Controller-owned continuation offer. It changes resources only. */
export interface LiveComputerResourceCheckpoint {
  id: string
  previous: WorkBudgetEnvelope
  delta: WorkBudgetAmendment['delta']
  reason: string
  resumeStatus: 'ready' | 'initializing' | 'awaiting_approval' | 'verifying'
}

/** Append-only resource authority added after the original plan approval.
 * The plan hash and every non-budget permission remain unchanged. */
export interface WorkBudgetAmendment {
  /** Optional only for receipts written before multi-resource amendments. */
  version?: 2
  id: Id
  runId: Id
  sessionId: Id
  checkpointId: string
  basePlanHash: string
  previous: { maxActions: number; maxDurationMinutes: number; maxModelCalls?: number; maxTotalTokens?: number; maxVisionFrames?: number; maxRecoveryEpisodes?: number }
  delta: { actions: number; durationMinutes: number; modelCalls?: number; totalTokens?: number; visionFrames?: number; recoveryEpisodes?: number }
  effective: { maxActions: number; maxDurationMinutes: number; maxModelCalls?: number; maxTotalTokens?: number; maxVisionFrames?: number; maxRecoveryEpisodes?: number }
  reason: 'productive_unfinished' | 'adaptive_finish' | 'current_milestone' | 'user_selected_custom'
  forecastId?: string
  choice?: 'recommended_finish' | 'current_milestone' | 'custom'
  approvedBy: 'user'
  approvalSurface: 'capsule' | 'main_app'
  approvedAt: string
  nonBudgetAuthorityExpanded?: false
  hash: string
}

export type RunStatus =
  | 'planned'
  | 'previewed'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_guidance'
  | 'completed'
  | 'cancelled'
  | 'blocked'
  | 'failed'

export type ActionStatus = 'proposed' | 'awaiting_approval' | 'approved' | 'executing' | 'verified' | 'blocked' | 'failed' | 'cancelled'

export interface PlannedAction extends ActionSpec {
  status: ActionStatus
  sourceStepId: Id
}

export interface WorkContextProcedure {
  procedureId: Id
  version: number
  name: string
  goal: string
  confidence: number
  retrievalScore: number
  components: { metadata: number; fullText: number; embedding: number; graph: number }
  evidenceObservationCount: number
}

export interface WorkContextSession {
  id: Id
  name: string
  startedAt: string
  endedAt: string | null
  relation: 'procedure_evidence' | 'history_match' | 'procedure_and_history'
  matchingMomentCount: number
  matchesTimeWindow: boolean
}

export interface WorkContextMoment {
  id: Id
  app: string
  title: string
  occurredAt: string
  score: number
  sessionId: Id | null
}

/** A stable, normalized thing recovered from one or more captured moments. */
export type MemoryResourceType = 'web_page' | 'document' | 'message' | 'application_state'

export interface MemoryResourceRecord {
  id: Id
  type: MemoryResourceType
  canonicalKey: string
  title: string
  canonicalUrl: string | null
  domain: string | null
  aliases: string[]
  firstSeenAt: string
  lastSeenAt: string
  occurrenceCount: number
}

export interface MemoryResourceOccurrence {
  resourceId: Id
  momentId: Id
  sessionId: Id | null
  occurredAt: string
  extractionMethod: 'structured_url' | 'recognized_url' | 'title_identity'
  confidence: number
}

export interface WorkContextResource extends MemoryResourceRecord {
  score: number
  provenanceMomentIds: Id[]
  sessionIds: Id[]
  retrievalSignals: {
    lexicalRank: number | null
    semanticRank: number | null
    semanticScore: number | null
    episodeRank: number | null
    recencyRank: number | null
    /**
     * Work uses a stricter second-stage resource check than broad Recall.
     * These fields make the acceptance decision inspectable instead of
     * presenting a shared host, such as "Wikipedia", as topical evidence.
     */
    topicTerms: string[]
    matchedTopicTerms: string[]
    topicCoverage: number
    titleCoverage: number
    rerankScore: number
  }
}

export interface WorkContextConstraint {
  id: Id
  kind: 'time' | 'resource_type' | 'application' | 'domain' | 'session' | 'reference'
  label: string
  value: string
  source: 'explicit' | 'inferred'
  required: boolean
}

export interface WorkContextRelaxation {
  constraintId: Id
  reason: 'no_exact_matches' | 'referential_continuity' | 'adjacent_time_window'
  originalValue: string
  relaxedValue: string
}

export interface WorkContextInterpretation {
  id: Id
  label: string
  summary: string
  confidence: number
  exact: boolean
  timeWindow: { fromIso: string | null; toIso: string | null; label: string | null }
  resourceIds: Id[]
  sessionIds: Id[]
  relaxations: WorkContextRelaxation[]
}

export interface WorkContextResolution {
  status: 'resolved' | 'needs_clarification' | 'empty'
  intent: 'revisit_resources' | 'operate' | 'unknown'
  referential: boolean
  constraints: WorkContextConstraint[]
  exactMatchCount: number
  selectedInterpretationId: Id | null
  interpretations: WorkContextInterpretation[]
  diagnostics: {
    searchedMoments: number
    lexicalAvailable: boolean
    semanticAvailable: boolean
    relaxedSearchUsed: boolean
    /** Topic-bearing terms after removing action, reference, and source words. */
    topicTerms: string[]
    /** Candidate resources seen before the strict execution-context filter. */
    candidateResourceCount: number
    /** Candidates deliberately withheld because they did not meet the topic bar. */
    rejectedResourceCount: number
  }
}

export interface WorkContextSelection {
  interpretationId: Id
}

/**
 * How much recorded business memory a single work request may draw on.
 *
 * `auto` searches everything but includes memory in the receipt only when the
 * request actually needs it (it references prior context, names a time window,
 * or a resource passes the strict topic gate). `all` always includes the best
 * matches, even weak ones. `selected` restricts every history search to the
 * chosen learning sessions. `none` never touches recorded history; the plan is
 * built from reviewed procedures and connected capabilities alone.
 */
export type WorkMemoryScopeMode = 'auto' | 'all' | 'selected' | 'none'

export interface WorkMemoryScope {
  mode: WorkMemoryScopeMode
  /** Only meaningful for `selected`; ignored for every other mode. */
  sessionIds: Id[]
}

/** The disclosed record of what memory a preparation was allowed to touch. */
export interface WorkContextMemoryReceipt {
  mode: WorkMemoryScopeMode
  requestedSessionIds: Id[]
  /** Requested ids that matched a recorded session; the search scope actually used. */
  resolvedSessionIds: Id[]
  /** Whether any history search ran at all. */
  searched: boolean
  /** Whether memory context was included in this receipt. */
  used: boolean
  reason: 'memory_off' | 'auto_used' | 'auto_not_needed' | 'selected_sessions' | 'all_memory'
}

/** The completed exchange a follow-up request continues. Carried in the
 * context receipt so the planner can resolve references ("the article", "it")
 * against the earlier request and its result. Context only: it informs
 * interpretation and never widens what the new contract may do. */
export interface WorkContextFollowUp {
  /** Snapshot-bound source references; content remains reported, untrusted data. */
  sourceIds?: string[]
  runId: Id
  goal: string
  result: string | null
  status: RunStatus
  completedAt: string
}

export interface WorkContextSummary {
  /** Model-written hint only; originalGoal and plan.goal retain user authority. */
  referenceResolution?: string
  /** Three to six words naming what the person will have when the request is done; display only. */
  title?: string
  /** The interpretation's reading of whether the request means the attached window; routing only, never authority. */
  attachedWindowReference?: 'yes' | 'no' | 'unclear'
  /** The interpretation said the answer is not in the window's visible part (a set to open or compare): its answer is
   * reviewed in full, never by the text-only read check. */
  answerNotInView?: true
  originalGoal: string
  normalizedGoal: string
  assembledAt: string
  timeWindow: { fromIso: string | null; toIso: string | null; label: string | null }
  /** `needs_procedure` is retained for plans persisted before capability planning. */
  readiness: 'ready' | 'adaptive' | 'needs_clarification' | 'needs_capability' | 'needs_procedure'
  procedure: WorkContextProcedure | null
  sessions: WorkContextSession[]
  moments: WorkContextMoment[]
  /** Resource-level context and disclosed interpretation, added in receipt v2. */
  resources?: WorkContextResource[]
  resolution?: WorkContextResolution
  /** Memory-scope disclosure, added in receipt v3; absent on earlier plans. */
  memory?: WorkContextMemoryReceipt
  /** The earlier exchange this request follows up on; absent for fresh work. */
  followUp?: WorkContextFollowUp
  /** Set on a run that executes one stage of an application hand-off. Its goal is
   * controller-written stage text; the person's request is `taskGoal`. */
  handoffStage?: { taskId: string; stageId: string; taskGoal: string }
  boundary: 'history_is_context_only_procedure_authorizes_actions' | 'history_is_context_only_contract_authorizes_capabilities'
}

export interface WorkflowContractResource {
  tool: string
  resource: string
}

/**
 * The human-readable and machine-bound scope approved before a run starts.
 *
 * A procedure is useful evidence for how to perform work, but this contract is
 * the authority envelope for one exact run. The model cannot expand it during
 * execution; a broader tool, resource, or budget requires a fresh plan.
 */
interface WorkflowContractBase {
  browserResearchScope?: BrowserResearchScope
  publicReadScope?: PublicReadScope
  purpose: string
  basis: 'reviewed_procedure' | 'adapted_procedure' | 'capability_plan'
  affectedSystems: string[]
  allowedTools: string[]
  allowedResources: WorkflowContractResource[]
  expectedOutputs: string[]
  successCriteria: string[]
  /** Optional only for plans stored before Work Budget existed. */
  budget?: WorkBudgetEnvelope
  limits: { maxActions: number; maxDurationMinutes: number }
  escalationTriggers: string[]
  prohibitedActions: string[]
  dataBoundary: string
  verificationRequired: true
}

export interface WorkflowContractV1 extends WorkflowContractBase {
  version: 1
}

export interface WorkflowContractV2 extends WorkflowContractBase {
  version: 2
  intent: WorkIntent
  supervision: SupervisionPolicyV2
  effects: ActionEffect[]
  phases: WorkPhase[]
}

export type WorkflowContract = WorkflowContractV1 | WorkflowContractV2

export interface PlanApproval {
  planHash: string
  contextHash: string
  approvedAt: string
  approvedBy: 'user'
}

export interface PlanAuthorization {
  version: 2
  planHash: string
  contextHash: string
  supervisionPolicyHash: string
  source: 'explicit_plan_review' | 'explicit_run_request' | 'legacy_plan_approval'
  scope: 'read_only_plan' | 'exact_plan'
  authorizedAt: string
  authorizedBy: 'user'
}

export interface TargetAuthorization {
  version: 1
  runId: string
  sessionId: string
  targetHash: string
  windows: Array<{
    windowId: number
    bundleIdentifier: string
    authority: 'observe' | 'input'
    /** Optional only for authorizations created before multi-surface plans. */
    role?: LiveComputerSurfaceRole
  }>
  remoteVisualsAllowed: boolean
  authorizedAt: string
  authorizedBy: 'user'
}

export interface ExecutionPlan {
  id: Id
  goal: string
  procedureId: Id
  procedureVersion: number
  retrievalScore: number
  rationale: string
  /** How Carve obtained the proposed actions; optional for legacy plans. */
  planningMode?: 'reviewed_replay' | 'adapted_replay' | 'capability_plan'
  autonomy: AutonomyLevel
  /** New plans separate outcome intent from supervision pace. */
  intent?: WorkIntent
  supervision?: SupervisionPolicyV2
  hashVersion?: 2
  phases?: WorkPhase[]
  parameterValues: Record<string, string>
  /** Optional for plans stored before context assembly was introduced. */
  context?: WorkContextSummary
  /** Optional only for runs persisted before operating contracts existed. */
  contract?: WorkflowContract
  /** Hash of the exact context receipt used to create this plan. */
  contextHash?: string
  /** Hash of every immutable, authority-relevant field in this plan. */
  planHash?: string
  /** Controller-compiled window requirements for selected-window work. The
   * hash freezes freshness and exact application identity before routing. */
  /** Explicit source for route review only; Start still authorizes and validates the route. */
  routeSourceTarget?: LiveComputerTarget
  surfaceIntent?: WorkSurfaceIntent
  surfaceIntentHash?: string
  /** Explanatory provenance. The normalized intent and its hash remain the
   * controller-owned authority. */
  surfaceIntentSelection?: WorkSurfaceIntentSelection
  /** Exact local application choice and preference/default provenance. */
  surfaceResolution?: WorkSurfaceResolution
  surfaceResolutionHash?: string
  actions: PlannedAction[]
  createdAt: string
}

/** Historical work evidence, never restored window authority or an input queue. */
export interface LiveComputerContinuationCheckpoint {
  version: 1 | 2
  sessionId: string
  recordedAt: string
  status: LiveComputerSession['status']
  authority: 'historical_evidence_only'
  ledger: LiveComputerTaskLedger
  pendingInput: LiveComputerInputTransaction | null
  /** Non-executable history of an in-flight operation, including non-text input. */
  pendingOperation?: { actionId: string; objectiveId: string; kind: LiveComputerActionKind;
    expectedState: string; targetLabel: string | null; effect: 'unknown'; replayKey: string | null } | null
  pendingArtifact: { artifactId: string; unit: number | null; layout: LiveComputerAction['artifactLayout']; destination?: LiveComputerAction['artifactDestination'] } | null
  resource: Pick<LiveComputerTarget, 'application' | 'bundleIdentifier' | 'title' | 'windowId'>
}

export interface WorkRun {
  id: Id
  plan: ExecutionPlan
  status: RunStatus
  currentActionIndex: number
  stopRequested: boolean
  result: string | null
  publicLookup?: PublicLookupEvidence
  recoveryProposal: RecoveryProposal | null
  /** Durable user approval for this exact plan version. */
  planApproval?: PlanApproval | null
  /** Version-2 authorization is distinct from the legacy plan approval receipt. */
  planAuthorization?: PlanAuthorization | null
  supervisionAmendments?: SupervisionAmendment[]
  /** Optional only for runs stored before Work Budget existed. */
  liveComputerCheckpoint?: LiveComputerContinuationCheckpoint | null
  budgetUsage?: WorkBudgetUsage
  /** Explicit resource grants layered over, never folded into, planHash. */
  budgetAmendments?: WorkBudgetAmendment[]
  /** The latest terminal live-computer attempt. Persisted separately from the
   * answer so a failed attempt never masquerades as an unstarted plan. */
  outcome?: {
    sessionId: Id
    status: 'completed' | 'blocked' | 'cancelled' | 'failed'
    terminalCategory: LiveComputerTerminalCategory
    reason: string | null
    canResume: boolean
    recordedAt: string
  } | null
  createdAt: string
  updatedAt: string
}

/**
 * A live, user-selected computer surface. This is deliberately separate from
 * a learning/observation session: it carries execution authority for one
 * bounded Work contract, not durable behavioural evidence.
 */
export interface LiveComputerTarget {
  /** Native creation receipt; only populated by the fresh-window operation. */
  freshDocument?: FreshDocumentReceipt
  windowId: number
  application: string
  bundleIdentifier: string
  title: string
  /** A small icon read from the installed macOS application bundle. It is
   * presentation-only and is deliberately dropped at the IPC execution boundary. */
  iconDataUrl?: string | null
  bounds: { x: number; y: number; width: number; height: number }
}

/** Read-only LaunchServices identity. It contains no document/window data and
 * exists only so an exact named safe application can be routed while closed. */
export interface LiveComputerApplicationIdentity {
  application: string
  bundleIdentifier: string
}

/** A model's judgment that one visible window is a likely fit for the stated
 * goal. Advisory only: it changes what is highlighted in the picker, never
 * what is selectable or what runs. */
export interface LiveComputerTargetRecommendation {
  windowId: number
  bundleIdentifier: string
  confidence: number
  reason: string
}

export type WorkSurfaceFreshness = 'required' | 'preferred' | 'existing' | 'either'
export type WorkSurfaceApplicationBinding = 'required' | 'preferred' | 'recommended' | 'interchangeable'
export type WorkSurfaceCapability = 'web_browser' | 'text_document' | 'spreadsheet' | 'presentation' | 'file_manager' | 'calculator' | 'document_viewer' | 'general_application'
export type WorkSurfaceOperation = 'open_https' | 'create_text_document' | 'edit_plain_text' | 'create_docx' | 'edit_docx' | 'create_spreadsheet' | 'create_xlsx' | 'edit_xlsx' | 'create_presentation' | 'create_pptx' | 'edit_pptx' | 'manage_files' | 'calculate' | 'view_pdf'

export interface WorkSurfaceOperationConstraint {
  operation: WorkSurfaceOperation
  required: boolean
  artifactType: string | null
}

export interface WorkSurfaceResource {
  id: string
  /** Open-ended destination identity, not an installed application category. */
  destination: string
  binding: 'required' | 'preferred' | 'open'
  sourceText: string
  outcome: string
  /** A proposed locator is navigation advice, never a permission grant. */
  url: string | null
  /** 'request' when the person's words give the address or name its site; 'inferred' when only the router proposed it. */
  urlSource?: 'request' | 'inferred'
}

export interface WorkSurfaceRequirement {
  id?: string
  resourceIds?: string[]

  application: { requestedName: string; bundleIdentifier: string | null }
  /** `required` is an explicit instruction such as "use Arc". `preferred`
   * is an explicit soft preference. `recommended` is the model's installed-
   * app choice and permits a same-capability fallback. `interchangeable` asks
   * for a capability such as web research without naming the tool that must
   * supply it. Optional for compatibility with older plans. */
  applicationBinding?: WorkSurfaceApplicationBinding
  /** Narrower than the controller's browser/document/utility implementation
   * kind, so a spreadsheet cannot be substituted with a text editor. */
  capability?: WorkSurfaceCapability
  /** Declarative application operations this route must preserve. Optional
   * for plans persisted before preference-aware application resolution. */
  operationConstraints?: WorkSurfaceOperationConstraint[]
  freshness: WorkSurfaceFreshness
  role: LiveComputerSurfaceRole
  initialResource: { kind: 'https_url'; value: string } | null
}

/** Versioned interpretation of the request. Concrete execution grants remain
 * controller-owned; inferred resources and locators do not mint authority. */
export interface WorkSurfaceIntent {
  version?: 3
  originalRequest?: string
  resources?: WorkSurfaceResource[]

  requirements: WorkSurfaceRequirement[]
  existingWindowsProhibited: boolean
  /** Ordered web destinations share the browser window; they are not native
   * applications and never imply permission to edit unrelated artifacts. */
  browserDestinations?: Array<{ name: string; url: string }>
  /** Sites the request names, resolved at plan time to their site label
   * (computer-use/named-destinations.ts). Read-only navigation to that site's
   * own origin is in the plan; nothing else is granted. */
  namedSites?: Array<{ resourceId: string; name: string; label: string }>
}

export interface WorkSurfaceIntentSelection {
  /** Identifies the inference instructions and schema used for this interpretation. */
  inferencePolicyHash?: string
  selectedApplicationBundleIdentifier?: string

  version: 1 | 2 | 3
  source: 'model' | 'deterministic_fallback'
  providerId: string
  model: string | null
  confidence: number | null
  summary: string
  selectedAt: string
  /** Version 2 binds model advice to the metadata-only installed catalog. */
  installedCatalogHash?: string
}

export type SurfacePreferenceMode = 'automatic' | 'specific_application' | 'ask_each_time'

export interface SurfaceApplicationPreference {
  capability: WorkSurfaceCapability
  mode: SurfacePreferenceMode
  bundleIdentifier: string | null
  application: string | null
  source: 'settings' | 'confirmed_override'
  chosenAt: string
}

export interface SurfacePreferenceProfile {
  version: 1
  updatedAt: string
  entries: SurfaceApplicationPreference[]
}

export interface SurfaceDefaultApplication {
  capability: WorkSurfaceCapability
  application: string
  bundleIdentifier: string
  basis: 'https_url' | 'plain_text' | 'spreadsheet' | 'presentation' | 'pdf'
}

export interface SurfaceContinuityEvidence {
  capability: WorkSurfaceCapability
  bundleIdentifier: string
  strength: 'exact_artifact' | 'same_task'
}

export type SurfaceResolutionSignal = 'explicit_required' | 'required_compatibility' | 'explicit_preferred' | 'saved_preference' | 'task_continuity' | 'os_default' | 'model_recommendation' | 'product_fallback' | 'ask_each_time' | 'unresolved'

export interface SurfaceCandidateDecision {
  bundleIdentifier: string
  application: string
  eligible: boolean
  rejectionCodes: string[]
  signals: SurfaceResolutionSignal[]
}

export interface ResolvedWorkSurfaceRequirement {
  requirementIndex: number
  capability: WorkSurfaceCapability
  selectedApplication: { application: string; bundleIdentifier: string } | null
  signal: SurfaceResolutionSignal
  reasonCode: string
  needsChoice: boolean
  alternatives: Array<{ application: string; bundleIdentifier: string }>
  candidates: SurfaceCandidateDecision[]
}

export interface WorkSurfaceResolution {
  version: 1
  resolvedAt: string
  installedCatalogHash: string
  preferenceProfileHash: string
  osDefaultsHash: string
  requirements: ResolvedWorkSurfaceRequirement[]
}

export type LiveComputerElementAction = 'activate' | 'focus' | 'increment' | 'decrement' | 'show_menu'
export type LiveComputerSafeCommand = 'textedit.make_plain_text' | 'textedit.save_document'

/**
 * The model-facing vocabulary stays intentionally small and application
 * independent. `element_action` invokes a capability exposed by the platform
 * accessibility tree; `drag` remains the universal visual fallback for
 * canvases and custom controls that expose no semantic action.
 */
export type LiveComputerActionKind = 'move' | 'click' | 'drag' | 'element_action' | 'invoke_safe_command' | 'scroll' | 'type' | 'type_into' | 'enter_sequence' | 'apply_artifact' | 'keypress' | 'new_tab' | 'cycle_tab' | 'wait' | 'conclude' | 'switch_window'
  | 'request_window' | 'ask_user' | 'done' | 'handoff'

/** The job a window performs inside one multi-surface mission. Roles are
 * semantic plan data; exact window ids remain separately authorized runtime
 * bindings and may never be inferred from screen content. */
export type LiveComputerSurfaceRole = 'workspace' | 'research' | 'destination' | 'reference'

/**
 * One window inside a live session's authorized set, with the authority the
 * user granted for it. `observe` windows can be read but never receive input,
 * which is what lets a cross-application task read a record in one place and
 * write it in another without widening input authority to both.
 */
export interface LiveComputerSessionTarget {
  target: LiveComputerTarget
  authority: 'observe' | 'input'
  /** Where the surface came from: a window the person picked, a window
   * Carve opened for this task, or one Carve must ask for when reached. */
  source?: 'existing' | 'fresh' | 'ask'
  /** Address the controller opened while materializing a fresh browser
   * surface. This is trusted route state, not a claim inferred from pixels or
   * page content, and lets later planners avoid opening the same route twice. */
  initialUrl?: string | null
  /** Optional only for sessions created before multi-surface mission planning. */
  role?: LiveComputerSurfaceRole
  /** Short person-visible reason this surface is part of the mission. */
  purpose?: string
}

/** Local-only physical text delivery. Models never select this strategy. */
/** 'clipboard_text' pastes the text literally through the person's saved and
 * restored clipboard (code editors, which rewrite typed brackets and quotes). */
export type LiveComputerTextDelivery = 'accessibility_value' | 'keycodes' | 'unicode_graphemes' | 'clipboard_table' | 'clipboard_text'

/** A narrow postcondition that a controller-owned application adapter proved
 * by reading authoritative local state after the operation. Unlike ordinary
 * input delivery, this is semantic evidence for only the named effect. */
export type LiveComputerVerifiedEffect =
  | 'text_document.plain_text'
  | 'text_document.saved_new_file'

/**
 * The live executor is selected once when a session starts. `legacy` preserves
 * the existing deterministic action compiler. `capability_vm_v1` is an
 * additive experiment that may compile one approved, goal-derived query into
 * a locally verified visual field-entry transaction when semantic capture is
 * incomplete. Persisted sessions from before this field remain legacy.
 */
export type LiveComputerExecutionMode = 'legacy' | 'capability_vm_v1'

/**
 * The planner that proposes the next live UI action. This is deliberately
 * independent from `LiveComputerExecutionMode`, which controls how Carve
 * carries out an already-governed action. The selection is frozen when a
 * session starts so changing Settings cannot mutate an in-flight contract.
 */
export type LiveComputerActionEngine = 'structured_v1' | 'openai_computer_v1' | 'openai_universal_v1' | 'openai_thin_v1' | 'compact_v1' | 'router_v1'

/**
 * The OpenAI model policy used by live-computer work. It is intentionally
 * separate from the provider's general-purpose model: changing computer-use
 * intelligence must not silently change Recall, induction, or embeddings.
 * The selection is frozen into each live session.
 */
export type LiveComputerModelProfile = 'adaptive_5_6' | 'astra'

export type LiveComputerApprovalKind = 'immediate' | 'group' | 'countdown' | 'automatic'

export interface LiveComputerApproval {
  kind: LiveComputerApprovalKind
  expiresAt: string | null
}

export interface LiveComputerMissionStep {
  id: string
  title: string
  instruction: string
  successState: string
  /** Controller-assigned surface. Null only for legacy single-window plans. */
  windowId?: number | null
  application?: string | null
  surfaceRole?: LiveComputerSurfaceRole | null
}

/** A contiguous, serial segment of a mission executed in one exact window. */
export interface LiveComputerMissionStage {
  id: string
  title: string
  windowId: number
  application: string
  windowTitle: string
  authority: 'observe' | 'input'
  role: LiveComputerSurfaceRole
  objectiveIds: string[]
}

/** The plan-level authority shown after window selection and before input. */
export interface LiveComputerMissionPlan {
  navigationBindings?: LiveComputerNavigationBinding[]
  id: Id
  hash: string
  outcome: string
  application: string
  windowTitle: string
  /** Every authorized window and the authority granted for it, so the review
   * shows the full reach of the plan rather than only its starting window. */
  windows: Array<{ windowId: number; application: string; title: string; authority: 'observe' | 'input'; role: LiveComputerSurfaceRole; purpose: string }>
  scope: string
  steps: LiveComputerMissionStep[]
  /** Ordered by dependency and always executed through one foreground lane. */
  stages: LiveComputerMissionStage[]
  routePolicy: string
  protectedActions: string[]
  maxActions: number
  createdAt: string
  approvedAt: string | null
}

export type LiveComputerObjectiveKind =
  | 'establish_route'
  | 'enter_query'
  | 'open_matching_resource'
  | 'choose_resource'
  | 'open_related_content'
  | 'scroll_to_target'
  | 'extract_information'
  | 'perform_outcome'
  /** A deliberate, named write: saving, submitting, recording, or routing
   * business data. Commit objectives can never be automatically approved
   * under any supervision mode and are always verified by a criterion call. */
  | 'perform_commit'
  | 'scroll_to_boundary'
  | 'verify_outcome'

export type LiveComputerObjectiveStatus = 'pending' | 'active' | 'verified' | 'failed'

export interface LiveComputerObjective {
  id: string
  kind: LiveComputerObjectiveKind
  instruction: string
  targetState: string
  status: LiveComputerObjectiveStatus
  attempts: number
  /** Actions this objective may consume before it must hand off, so one
   * stubborn objective cannot starve the rest of the approved outcome. */
  actionBudget: number
  actionsUsed: number
  /** Every executable objective is traceable to one or more clauses in the
   * approved request. This prevents a compound request from silently losing a
   * navigation, selection, or verification step during planning. */
  clauseIds: string[]
  dependsOn: string[]
  entityRefs: string[]
  /** Source products acquired by this phase, never by every step sharing an entity. */
  producesRequirementIds?: string[]
  /** Assigned by the controller after exact windows are bound. */
  surfaceWindowId?: number | null
  surfaceRole?: LiveComputerSurfaceRole | null
}

/** A compact, inspectable replacement for the active/pending suffix of the
 * execution graph. Verified objectives are never supplied to or rewritten by
 * a revision. */
export interface LiveComputerObjectiveGraphRevision {
  reason: string
  expectedBenefit: string
  objectives: Array<Pick<LiveComputerObjective, 'kind' | 'instruction' | 'targetState' | 'clauseIds' | 'entityRefs' | 'producesRequirementIds'>>
}

export type LiveComputerGoalClauseKind = 'navigate' | 'lookup' | 'choose' | 'open' | 'scroll_boundary' | 'scroll_target' | 'extract' | 'commit' | 'act'

export interface LiveComputerGoalClause {
  id: string
  text: string
  kind: LiveComputerGoalClauseKind
  objectiveIds: string[]
}

export interface LiveComputerNavigationBinding {
  entityId: string
  clauseId: string
  url: string
  purpose: string
  provenance: 'user_url' | 'inferred_launch'
  /** The exact HTTPS origin, including a non-default port when explicitly
   * requested. Subdomains do not inherit authority. Absent on older bindings. */
  origin?: string
}

export interface LiveComputerEntityBinding {
  id: string
  kind: 'application' | 'site' | 'resource' | 'content' | 'target'
  label: string
  sourceClauseId: string
  /** Coreference is represented explicitly: for example an article may be
   * relatedTo the stock selected by a previous objective. */
  relatedTo: string | null
  status: 'planned' | 'resolved'
  resolvedLabel: string | null
}

export type LiveComputerWorkProductKind = 'state_change' | 'prose' | 'record_set' | 'selection'

export type LiveComputerDeliverableKind = Exclude<LiveComputerWorkProductKind, 'state_change'> | 'none'

/** The information shape that must exist at completion. Headers are schema,
 * not records: a top-ten table therefore has minimumRecords=10 regardless of
 * whether its destination renders an additional header row. */
export interface LiveComputerDeliverableContract {
  kind: LiveComputerDeliverableKind
  description: string
  fields: string[]
  minimumRecords: number
}

/** An effect is orthogonal to the information it consumes. This lets a task
 * require a complete record set *and* a governed spreadsheet write instead of
 * collapsing both requirements into the old mutually-exclusive state_change
 * work-product kind. */
export interface LiveComputerEffectContract {
  kind: 'state_change' | 'populate' | 'save' | 'update' | 'open'
  description: string
  targetEntityId: string | null
}

/** The result bound before execution. Strategy and objective decomposition may
 * change as evidence arrives; this deliverable/effect contract may not. */
export interface LiveComputerWorkProductContract {
  requirements?: TaskRequirements
  deliverable: LiveComputerDeliverableContract
  effects: LiveComputerEffectContract[]
}

/** A compact decision record, not hidden chain-of-thought. The strategist
 * compares approaches here so the one-step visual actor inherits a global
 * plan instead of rediscovering strategy from each screenshot. */
export interface LiveComputerStrategyMemo {
  summary: string
  informationNeeds: string[]
  alternatives: Array<{
    approach: string
    fit: string
    costs: string
    failureModes: string[]
  }>
  chosenApproach: string
  workProduct: LiveComputerWorkProductContract
  assumptions: string[]
  replanTriggers: string[]
  verificationPlan: string
  generatedBy: 'single_strategist' | 'strategy_arbiter' | 'bounded_fallback' | 'adaptive_contract'
  revision: number
}

export interface LiveComputerArtifact {
  requirementId?: string | null
  id: string
  kind: Exclude<LiveComputerWorkProductKind, 'state_change'>
  title: string
  /** Record-set headers. Empty for prose and selections. */
  columns: string[]
  /** Rectangular data rows for a record set. Empty for prose and selections. */
  rows: string[][]
  /** Prose or a stated selection. Empty for a record set. */
  content: string | null
  sourceObjectiveId: string
  provenance: string[]
  verifiedAtSequence: number
  /** Controller verdict on acquisition scope, separate from final-product coverage. */
  sourceScopeComplete?: boolean
  /** Controller-derived coverage against the immutable outcome contract.
   * Working artifacts remain useful evidence, but only complete artifacts may
   * cross a write boundary or satisfy a non-state-change outcome. */
  coverage: {
    complete: boolean
    requiredFields: string[]
    presentFields: string[]
    missingFields: string[]
    unexpectedFields: string[]
    itemCount: number
    minimumItems: number
    maximumItems?: number
    sourceContentMatches?: boolean
    emptyRequiredCells: number
    requirementId?: string | null
    resolutionStatus?: TaskRequirementResolution['status']
  }
}

export type LiveComputerArtifactDraft = Omit<LiveComputerArtifact, 'id' | 'sourceObjectiveId' | 'verifiedAtSequence' | 'sourceScopeComplete' | 'coverage'>

export type LiveComputerFailureCause =
  | 'transient_loading'
  | 'focus_miss'
  | 'target_moved'
  /** The target is present and resolved, but another surface (a dialog,
   * banner, or overlay) would receive the click. Distinct from `target_moved`
   * so recovery can clear the obstruction instead of re-observing. */
  | 'target_covered'
  | 'control_ambiguous'
  | 'route_unavailable'
  | 'input_not_accepted'
  | 'surface_mismatch'
  | 'resource_identity_mismatch'
  | 'field_acceptance_unknown'
  | 'operation_effect_uncertain'
  | 'operation_postcondition_failed'
  | 'environment_lost'
  | 'authentication_required'
  | 'policy_violation'
  | 'prompt_injection'
  | 'budget_exhausted'
  | 'plan_invalid'
  | 'requirement_conflict'
  | 'artifact_not_ready'
  | 'evidence_stale'
  | 'provider_unavailable'
  | 'unknown'

export type LiveComputerRecoveryDisposition = 'continue' | 'retry_same_objective' | 'reground' | 'reconcile_input' | 'replan' | 'handoff' | 'done'

/** Where a proposed action was rejected before any computer input was sent.
 * Keeping this typed prevents schema, grounding, reviewer, and policy failures
 * from collapsing into one misleading "unsafe" bucket. */
export type LiveComputerProposalRejectionStage =
  | 'schema'
  | 'grounding'
  | 'contract'
  | 'critic'
  | 'executive'
  | 'policy'
  /** The engine cannot drive this surface or objective. A capability limit
   * is a route problem, never a standing authority boundary. */
  | 'capability'
  | 'unknown'

/** The smallest causally appropriate recovery after a proposal rejection. */
export type LiveComputerProposalRepair = 'same_frame' | 'fresh_observation' | 'new_tactic' | 'new_objectives' | 'human'

export interface LiveComputerProposalRejection {
  stage: LiveComputerProposalRejectionStage
  cause: LiveComputerFailureCause
  repair: LiveComputerProposalRepair
  safetyImpact: 'none' | 'authority_boundary'
  countsToward: 'serialization' | 'grounding' | 'strategy' | 'safety'
  /** Controller/provider diagnostic only; bounded before it enters durable
   * recovery state or audit. It is never treated as screen evidence. */
  reason: string
  /** Actual model proposals rejected in this episode, rather than a fixed
   * synthetic increment. */
  proposalAttempts: number
  /** Sanitized controller diagnostics for the audit trail: candidate counts,
   * origins, diff ratios. Never screen text. */
  diagnostics?: Record<string, unknown>
}

export interface LiveComputerRecoveryState {
  cause: LiveComputerFailureCause | null
  disposition: LiveComputerRecoveryDisposition
  failureSignature: string | null
  repeatedFailureCount: number
  stalledAttempts: number
  /** Cumulative recovery episodes for the whole session. Unlike
   * `stalledAttempts`, verified progress never resets this receipt counter. */
  recoveryEpisodes: number
  activeEpisodeId?: string
  strategiesTried: string[]
  lastProgressSequence: number
  /** Proposal denials consume no input budget. They are counted from actual
   * rejected model responses and routed by their typed repair class. */
  proposalDenials: number
  planningReplans: number
  lastPlanningFailure: string | null
  lastProposalRejection: LiveComputerProposalRejection | null
  /** Short typed history survives ordinary recovery resets, allowing the
   * controller and evaluations to distinguish repeated mechanics from a new
   * strategic failure. */
  proposalRejectionHistory: LiveComputerProposalRejection[]
  /** Objective-graph revisions are bounded per semantic-progress epoch. */
  graphReplans: number
  /** Bounded diagnostic counts; the existing shared repair budget controls retries. */
  signatureCounts?: Record<string, number>
  lastSignature?: string | null

}

/** A compact, task-level description of how an action tried to make progress.
 * These families are deliberately application-agnostic: they support useful
 * analogies without accumulating a rule for every site or control. */
export type LiveComputerStrategyFamily =
  | 'direct_navigation'
  | 'search_discovery'
  | 'in_page_navigation'
  | 'workspace_navigation'
  | 'content_extraction'
  | 'artifact_commit'
  | 'verification'
  | 'wait_observe'
  | 'other'

/** Controller-derived progress toward the immutable work-product contract. */
export interface LiveComputerCoverageSnapshot {
  complete: boolean
  presentFields: string[]
  itemCount: number
  filledCells: number
  requiredCells: number
  /** Normalized 0..1 coverage used only for comparison, never completion. */
  score: number
}

/** Durable episodic memory for one executed tactic. Unlike short-term
 * recovery counters, this survives semantic progress and objective changes. */
export interface LiveComputerAttempt {
  id: string
  sequence: number
  objectiveId: string
  objectiveKind: LiveComputerObjectiveKind
  actionKind: LiveComputerActionKind
  routeKey: string
  family: LiveComputerStrategyFamily
  target: string | null
  expectedState: string
  observedState: string
  status: 'succeeded' | 'progressed' | 'pending' | 'failed'
  semanticProgress: boolean
  failureCause: LiveComputerFailureCause | null
  evidence: string[]
  beforeCoverage: LiveComputerCoverageSnapshot
  afterCoverage: LiveComputerCoverageSnapshot
  coverageDelta: number
  actionCost: number
  /** The exact post-action frame this experience was judged against. A newer
   * frame is material evidence that an otherwise identical tactic may now be
   * operating in a different application state. */
  frameSha256?: string | null
  /** Exact tactic identity plus the evidence epoch in which it was tried. */
  similarityKey: string
  decisionDigest?: string
  evidenceEpoch: string
}

export interface LiveComputerBudgetForecast {
  remainingSessionActions: number
  estimatedFinishActions: number
  protectedActions: number
  discretionaryActions: number
  atRisk: boolean
  reason: string | null
}

export type LiveComputerExecutiveDecisionKind =
  | 'continue'
  | 'repair_action'
  | 'switch_tactic'
  | 'replan_objectives'
  | 'finalize_artifact'
  | 'request_budget'
  | 'ask_user'
  | 'stop_for_safety'

export type LiveComputerExecutiveTriggerReason =
  | 'verification_failure'
  | 'analogous_failed_attempt'
  | 'exact_failed_repeat'
  | 'work_product_stall'
  | 'finish_budget_at_risk'
  | 'write_boundary'

export interface LiveComputerExecutiveDecision {
  /** Answers to the question in instruction; empty for open-ended questions. */
  options?: LiveComputerGuidanceOption[]
  kind: LiveComputerExecutiveDecisionKind
  diagnosis: string
  instruction: string
  analogousAttemptIds: string[]
  retryJustification: string | null
  budgetRationale: string
}

export interface LiveComputerExecutiveState {
  attempts: LiveComputerAttempt[]
  coverage: LiveComputerCoverageSnapshot
  coverageStallCount: number
  interventions: number
  lastTriggerKey: string | null
  lastDecision: (LiveComputerExecutiveDecision & {
    trigger: LiveComputerExecutiveTriggerReason
    atSequence: number
    /** Similarity key of the proposal the captain reviewed, so a steering
     * rejection binds to that tactic rather than to every proposal raised by
     * the same trigger in the same evidence epoch. */
    rejectedTactic?: string | null
  }) | null
  budget: LiveComputerBudgetForecast
}

export interface LiveComputerRouteTransition {
  from: string | null
  to: string
  objectiveId: string
  classification?: LiveComputerRouteTransitionClassification
  reason: string | null
  sequence: number
}

export type LiveComputerRouteTransitionClassification =
  | 'planned_progression'
  | 'same_route_repair'
  | 'unplanned_deviation'
  | 'authority_change'

/** Physical interaction state is independent from the strategic route. A
 * browser-location search can legitimately lead to a results webpage while
 * the destination objective remains unchanged. */
export type LiveComputerInteractionSurface = 'browser_chrome' | 'web_page' | 'native_app' | 'overlay' | 'unknown'

export type LiveComputerSemanticOperation =
  | 'navigate'
  | 'query'
  | 'select'
  | 'inspect'
  | 'edit'
  | 'submit'
  | 'scroll'
  | 'wait'
  | 'conclude'
  | 'switch_context'
  | 'request_guidance'
  | 'unknown'

export type LiveComputerResourcePhase = 'launcher' | 'transit' | 'results' | 'destination' | 'content' | 'form' | 'dialog' | 'unknown'

export interface LiveComputerInteractionState {
  /** Controller-owned authority for the active selected window. */
  authority: 'observe' | 'input'
  activeWindowId: number | null
  /** Approved destination/information intent, never page-authored text. */
  navigationIntent: string | null
  surface: LiveComputerInteractionSurface
  operation: LiveComputerSemanticOperation
  resourcePhase: LiveComputerResourcePhase
  revision: number
  history: Array<{
    sequence: number
    surface: LiveComputerInteractionSurface
    operation: LiveComputerSemanticOperation
    resourcePhase: LiveComputerResourcePhase
    objectiveId: string
  }>
}

export type LiveComputerInputTransactionPhase = 'focus' | 'replace' | 'deliver' | 'reconcile' | 'submit' | 'verify'

/** Controller-derived authority for navigational field text. The model never
 * supplies this receipt: preflight resolves the payload back to immutable
 * goal/plan identities or independently verified runtime evidence. */
export interface LiveComputerFieldTextProvenance {
  source: 'approved_goal' | 'planned_entity' | 'verified_entity' | 'verified_fact'
  referenceIds: string[]
}

/** Ephemeral, inspectable receipt for an exactly-once field-entry transaction.
 * It deliberately stores a text digest rather than another plaintext copy. */
export interface LiveComputerInputTransaction {
  actionId: string
  objectiveId: string
  phase: LiveComputerInputTransactionPhase
  deliveryState: 'not_started' | 'unknown' | 'accepted' | 'rejected'
  delivery: LiveComputerTextDelivery | null
  attemptedDeliveries: LiveComputerTextDelivery[]
  reconciliationObservations: number
  intendedTextSha256: string
  baselineFrameSha256: string | null
  textProvenance: LiveComputerFieldTextProvenance | null
  /** Content delivery is separate from focus/click delivery. */
  contentDelivery?: 'none' | 'partial' | 'complete' | 'unknown' | undefined
  focusObservationId?: string | undefined
  /** A posted text event does not mean that the submit boundary was crossed. */
  submission?: 'not_requested' | 'withheld' | 'attempted' | 'delivered'
  /** Privacy-safe readback diagnostics; never another copy of field contents. */
  readback?: {
    match: 'exact' | 'empty' | 'extended' | 'partial' | 'different' | 'truncated' | 'unavailable'
    observedLength: number | null
    observationId: string
    stable: boolean
  }
}

export type LiveComputerEffectState = 'not_applied' | 'partial' | 'applied' | 'unknown'

/** One logical change can have several attempts. An observation of a failed
 * criterion is not proof that the attempt had no effects. */
export interface LiveComputerOperationEffect {
  operationId: string
  attemptId: string
  state: LiveComputerEffectState
  persistence: 'confirmed' | 'pending' | 'unknown'
  observationId: string
  assessedBy: 'controller' | 'model_criterion'
}

/** A privacy-preserving receipt that input delivery returned without an
 * execution error. It proves only physical delivery to the selected window;
 * semantic success is established separately from a fresh observation. */
/** Sanitized native diagnostics; never contain typed text or screen contents. */
export interface LiveComputerDeliveryFailure {
  code: string
  stage: 'preflight' | 'focus' | 'assignment' | 'readback' | 'transport'
  method: LiveComputerTextDelivery | 'input'
  mutation: 'none' | 'possible'
  nativeCode?: number
  /** Identity-only reason the native guard gave (for example the focus
   * check's `selected_window_behind_sibling` with window ids). Diagnostic
   * text for the actor and the audit; never page content or titles. */
  detail?: string
}

export interface LiveComputerPhysicalActionReceipt {
  transactionId: string
  actionId: string
  actionKind: LiveComputerActionKind
  startedAt: string
  completedAt: string
  /** Where the delivery's wall clock went, for the latency audit: the helper's window preparation and the input bridge's delivery. */
  timings?: { prepareMs: number; deliverMs: number; dispatch?: { presentMs: number; aimMs: number; personTurnMs: number; focusWindowMs: number; dispatchMs: number } }
  delivery: 'accepted' | 'rejected' | 'uncertain'
  /** Whether no event, an incomplete sequence, or the complete physical
   * gesture was posted. Semantic success is still established separately. */
  deliveryProgress?: 'none' | 'partial' | 'complete'
  /** False means a synthesized key or mouse button may still be depressed;
   * the controller must stop rather than attempt another operation. */
  pressedInputsReleased?: boolean
  /** Bounded delivery telemetry only; it never describes typed content. */
  eventCount?: number
  failure?: LiveComputerDeliveryFailure
  contentDelivery?: 'none' | 'partial' | 'complete' | 'unknown' | undefined
  /** Present only when a dedicated adapter read back its narrow postcondition
   * (for example, an application state or exact new-file existence). */
  verifiedEffect?: LiveComputerVerifiedEffect | null
  /** Present for application-level adapters. It is validated against the
   * controller authorization before its semantic effect can be trusted. */
  operationTransaction?: ApplicationOperationTransactionReceipt | null
  targetWindowId: number | null
  targetElementId: string | null
  sideEffectScope: 'selected_window' | 'authorized_new_window' | 'out_of_scope' | 'unknown'
}

export type LiveComputerActionEvidenceChannel =
  | 'accessibility_diff'
  | 'localized_visual_diff'
  | 'coarse_visual_diff'
  | 'frame_hash'
  | 'window_set_diff'

/** The controller completes the physical receipt after a fresh capture. The
 * record contains hashes and channel names, never typed or screen plaintext. */
export interface LiveComputerObservedActionReceipt extends LiveComputerPhysicalActionReceipt {
  substeps?: LiveComputerPhysicalActionReceipt[]
  beforeFrameSha256: string | null
  afterFrameSha256: string
  /** `changed`: a coarse or action-local visual sample moved, or the effect
   * left the selected window. `subtle`: the exact frame hash changed but no
   * sampled region did — an inline text disclosure, caret, or focus ring looks
   * like this, so it is weak evidence of application and never evidence of
   * rejection. `unchanged`: the frame is byte-identical. */
  observedDelta: 'changed' | 'subtle' | 'unchanged' | 'unknown'
  evidenceChannels: LiveComputerActionEvidenceChannel[]
}

export interface LiveComputerTransition {
  sequence: number
  actionId: string
  objectiveId: string
  kind: LiveComputerActionKind
  route: string
  targetLabel: string | null
  expectedState: string
  /** The risk the executed action was approved under. */
  risk: ActionRisk
  /** Whether the proposal claimed this action completes the active objective. */
  completesObjective: boolean
  /** For `conclude` transitions: the deliverable text the verifier judged. */
  conclusion?: string | null
  /** A proposed work product exists here only until the independent verifier
   * accepts it; verified drafts then move into `ledger.artifacts`. */
  artifactDraft?: LiveComputerArtifactDraft | null
  artifactDestination?: LiveComputerAction['artifactDestination']
  /** For `apply_artifact`, the verified work product being rendered. */
  artifactId?: string | null
  artifactLayout?: 'grid' | 'lines' | 'table' | null
  /** Zero-based bounded portion: grid cell in row-major order including headers, or text paragraph/record. */
  artifactUnit?: number | null
  targetingMode?: 'semantic' | 'visual' | null
  /** Opaque controller command retained so a narrow adapter attestation can
   * be matched to the exact approved operation during verification. */
  command?: LiveComputerSafeCommand | null
  /** Direction carried by typed tab cycling; physical shortcut details remain
   * local to the controller and never enter the model-facing transition. */
  key?: string | null
  observedState: string | null
  status: 'awaiting_verification' | 'unresolved' | 'verified' | 'progressed' | 'failed'
  assessment?: {
    state: 'supported' | 'contradicted' | 'unresolved'
    observationId: string
    decisionDigest: string
    evidenceGap: string | null
  }
  /** A later observation may settle this operation without repeating it. */
  resolvedByActionId?: string
  recoveryEpisodeId?: string
  replayKey?: string | null
  /** Which layer produced the judgment: a local observation or the verifier. */
  verifiedBy: 'local_observation' | 'model_criterion' | null
  frameSha256: string | null
  routeKey: string
  progress: LiveComputerCriterionResult['progress'] | null
  failureCause: LiveComputerFailureCause | null
  actionApplied: boolean | null
  /** Execution telemetry is deliberately independent of semantic success. */
  actionReceipt?: LiveComputerObservedActionReceipt | null
  /** Durable input-stage evidence survives release of the foreground lane. */
  inputTransaction?: LiveComputerInputTransaction | null
  effect?: LiveComputerOperationEffect
  /** A stable no-input identity that omits sequence numbers and model prose. */
  observationKey?: string | null
  /** Semantic verification v2 keeps presentation equivalence inspectable. */
  semanticCriterionMet?: boolean | null
  presentationMatch?: 'exact' | 'equivalent' | 'insufficient' | null
  blockingMismatch?: LiveComputerCriterionBlockingMismatch | null
  /** One frame may independently satisfy several consecutive read-only
   * objectives. The primary objective remains `objectiveId`. */
  satisfiedObjectiveIds?: string[]
  /** Controller-derived movement toward the active objective. Visual or
   * accessibility change alone never sets this true. */
  semanticProgress: boolean | null
  evidence: string[]
  /** Coverage before execution lets the controller attribute later work-
   * product progress to this exact tactic. Optional for persisted sessions. */
  coverageBefore?: LiveComputerCoverageSnapshot
  /** Whether the target's own neighborhood changed after the action, judged
   * on a bounded crop rather than the whole frame. Self-changing pages make
   * whole-frame change meaningless as evidence. */
  regionChange?: { changed: boolean; ratio: number } | null
}

export interface LiveComputerTaskLedger {
  /** Replanning and cosmetic frame changes cannot erase an unmet result obligation. */
  requirementStall?: { key: string; attempts: number }
  requirementResolutions?: TaskRequirementResolution[]
  publicReadScope?: PublicReadScope
  publicLookups?: LivePublicLookup[]
  /** Accepted human decisions; never populated from page or model content. */
  userDecisions?: LiveComputerUserDecision[]
  /** Controller-created state; model-authored plans never provide authority here. */
  taskState?: {
    version: 1
    originalRequest: string
    planningNotes: string[]
    evidence: Array<{
      id: string
      source: 'setup' | 'observation' | 'verified_observation'
      windowId: number
      frameSha256: string | null
      sequence: number
      text: string
    }>
  }
  /** Frozen for the session; absent on pre-adaptive persisted ledgers. */
  planningArchitecture?: 'adaptive_v1' | 'legacy'
  navigationBindings?: LiveComputerNavigationBinding[]
  intent: 'lookup' | 'boundary_navigation' | 'compound' | 'general'
  subject: string | null
  scope: string | null
  route: string | null
  routeHistory: string[]
  routeKey: string | null
  routeKeyHistory: string[]
  routeTransitions: LiveComputerRouteTransition[]
  /** Typed state used for authority and progress decisions. `route*` remains
   * as a compatibility/audit projection for sessions created before v2. */
  interactionState: LiveComputerInteractionState
  clauses: LiveComputerGoalClause[]
  entities: LiveComputerEntityBinding[]
  coverage: { complete: boolean; uncoveredClauseIds: string[] }
  objectives: LiveComputerObjective[]
  currentObjectiveId: string | null
  /** Bound from the initial reviewed strategy and preserved across revisions. */
  outcomeContract: LiveComputerWorkProductContract | null
  /** The approved envelope is immutable; this version identifies the mutable
   * execution graph currently operating inside it. */
  executionGraphVersion: number
  executionGraphHistory: Array<{
    version: number
    reason: string
    atSequence: number
    supersededObjectiveIds: string[]
    replacementObjectiveIds: string[]
  }>
  strategy: LiveComputerStrategyMemo | null
  artifacts: LiveComputerArtifact[]
  facts: string[]
  transitions: LiveComputerTransition[]
  noProgressCount: number
  replanCount: number
  disposition: LiveComputerRecoveryDisposition
  recovery: LiveComputerRecoveryState
  /** Durable task-level experience and finish-aware supervisory state. */
  executive: LiveComputerExecutiveState
}

export interface LiveComputerCriterionResult {
  /** Separate from this observation action's own postcondition. */
  priorOperationAssessment?: {
    operationId: string
    state: 'supported' | 'contradicted' | 'unresolved'
    evidence: string
  } | null
  criterionMet: boolean
  /** Whether the requested meaning is visibly established even when the UI
   * presents it inline, in a disclosure, or in another equivalent layout. */
  semanticCriterionMet?: boolean
  presentationMatch?: 'exact' | 'equivalent' | 'insufficient'
  stateTransitionRequired?: boolean
  blockingMismatch?: LiveComputerCriterionBlockingMismatch
  objectiveComplete: boolean
  goalComplete: boolean
  observedState: string
  progress: 'advanced' | 'unchanged' | 'regressed' | 'uncertain'
  confidence: number
  /** These fields separate evidence about execution competence from safety.
   * Older/local providers may omit them; the controller derives conservative
   * defaults before making a recovery decision. */
  actionApplied?: boolean
  /** Effect of the attempted operation in its intended destination, not
   * whether events were posted. Legacy verifiers omit these fields. */
  effectState?: LiveComputerEffectState | undefined
  persistence?: 'confirmed' | 'pending' | 'unknown' | undefined
  effectOperationId?: string | null
  failureCause?: LiveComputerFailureCause | null
  riskSignal?: 'none' | 'suspicious' | 'authority_violation'
  evidence?: string[]
  /** Additional consecutive read-only objectives directly proven by the same
   * fresh frame. The controller validates dependency, entity, and effect
   * boundaries before accepting any of them. */
  additionalSatisfiedObjectives?: Array<{ objectiveId: string; evidence: string }>
  /** A concise user-facing answer or completion report when goalComplete is true. */
  resultSummary?: string | null
}

export type LiveComputerCriterionBlockingMismatch =
  | 'none'
  | 'wrong_resource'
  | 'missing_evidence'
  | 'stale_observation'
  | 'authority_violation'
  | 'ambiguous_entity'

/** A model may suggest this shape; Carve validates and executes it itself. */
/**
 * A bounded, read-only accessibility element captured with a live frame.
 * Coordinates are window-relative so they share the frame image's frame of
 * reference. Sensitive elements carry structure only: role and bounds, never
 * a name or value.
 */
export interface LiveComputerElement {
  /** Frame-scoped identity (`e1`, `e2`, …) assigned in capture order. */
  id: string
  role: string
  subrole?: string | null
  name: string
  /** Additional non-secret semantics exposed by the platform. A control need
   * not contain visible text to be useful: placeholder/help and supported AX
   * actions are generic affordance evidence for arbitrary applications. */
  description?: string | null
  help?: string | null
  placeholder?: string | null
  identifier: string | null
  value: string | null
  bounds: { x: number; y: number; width: number; height: number } | null
  sensitive: boolean
  /** Best-effort semantic state reported by the platform accessibility
   * adapter. Optional for legacy and visual-only backends. These fields let
   * the controller prove an input precondition without teaching the model
   * application-specific focus behavior. */
  focused?: boolean | null
  /** Derived from the platform focus owner's ancestor chain, never geometry. */
  containsFocus?: boolean | null
  /** False when the captured value was truncated; absence is unknown. */
  valueComplete?: boolean
  enabled?: boolean | null
  focusable?: boolean | null
  editable?: boolean | null
  selected?: boolean | null
  expanded?: boolean | null
  checked?: boolean | null
  orientation?: 'horizontal' | 'vertical' | null
  minValue?: number | null
  maxValue?: number | null
  /** Raw bounded platform action and settable-attribute names. The controller
   * maps these into its small semantic action vocabulary; models never invent
   * arbitrary native action names. */
  actions?: string[]
  settableAttributes?: string[]
  depth?: number
  /** Identity that survives a capture: role, subrole, identifier, name, and
   * the ancestor role path. Frame ids are recycled; fingerprints are not. */
  fingerprint?: string | null
  /** Child indices from the capture walk's root to this element, the sibling
   * indices the fingerprint chain hashes. With `axRoot` 'window', the native
   * bridge can act on exactly this element by identity (never by geometry). */
  axPath?: number[]
  axRoot?: 'window' | 'recovered-web-area'
  /** Index into the frame's `obstructions` when the element belongs to a
   * dialog, sheet, or banner subtree. */
  dialogId?: number | null
  /** The element lies under an obstruction's bounds without being part of it. */
  /** Owned surfaces may cover a pointer location without taking keyboard focus. */
  pointerObstructions?: Array<{ x: number; y: number; width: number; height: number }>
  obstructed?: boolean
  /** Video, canvas, or other self-changing media; excluded from visual diffs. */
  media?: boolean
  /** A web area's loaded address (AXURL), scheme included. The address bar's
   * text elides http:// and https://; this is the address that was loaded. */
  url?: string
  /** Not present in the previous frame (by fingerprint). Controller-derived. */
  appeared?: boolean
}

/** A dialog, sheet, or banner subtree the platform exposed. Its controls are
 * the elements whose `dialogId` names it. */
export interface LiveComputerObstruction {
  id: number
  role: string
  subrole: string | null
  name: string
  bounds: { x: number; y: number; width: number; height: number }
  /** How it was recognized: a dialog subrole, a modal attribute, or the
   * banner heuristic (wide, edge-anchored, with consent-style controls). */
  evidence: 'dialog' | 'modal' | 'banner'
}

export interface LiveComputerAction {
  id: Id
  kind: LiveComputerActionKind
  objectiveId: string
  route: string
  /** New proposals must state the physical surface independently from their
   * strategic route. Optional only for legacy persisted/scripted actions. */
  surface?: LiveComputerInteractionSurface
  operation?: LiveComputerSemanticOperation
  resourcePhase?: LiveComputerResourcePhase
  replanReason: string | null
  summary: string
  targetLabel: string | null
  /** The frame-scoped element id this pointer action is grounded on, when the
   * target appears in the captured element digest. Validated against the
   * latest frame: the element must exist, must not be sensitive, and must
   * contain the proposed point. */
  targetElementId?: string | null
  /** Window-relative bounds of the validated target element, stamped by the
   * controller from the latest captured frame after `targetElementId` passes
   * validation. Never model-provided: proposal preflight overwrites whatever a
   * provider supplied. Exists only so the desktop frame can show the grounded
   * control before input is sent. */
  targetBounds?: { x: number; y: number; width: number; height: number } | null
  /** Controller-owned snapshot binding and semantic continuity. */
  targetObservationId?: string | null
  targetIdentity?: Pick<LiveComputerElement, 'role' | 'name' | 'identifier' | 'bounds' | 'fingerprint' | 'axPath' | 'axRoot'> | null
  /** Current actual keyboard receiver, rechecked by the native bridge for
   * every chunk. Omitted when the platform exposes no receiver. */
  inputReceiver?: Pick<LiveComputerElement, 'role' | 'name' | 'identifier' | 'bounds'> | null
  /** For `switch_window`, the window in the authorized set to make active.
   * A window that is not already in the set can never be selected. */
  targetWindowId?: number | null
  /** A model may identify a boundary candidate, but this typed cause is only
   * advisory. The controller validates it against system-owned state and
   * verified evidence before any terminal handoff is accepted. Budget is
   * deliberately absent: only the controller can establish exhaustion. */
  handoffCause?: 'authentication_required' | 'permission_required' | 'personal_information_required' | 'environment_lost' | 'policy_boundary' | null
  expectedState: string
  completesObjective: boolean
  point: { x: number; y: number } | null
  /** Optional physical details used by the experimental Universal adapter.
   * Existing governed actions omit them and retain left-click/no-modifier
   * behavior. They are interpreted only by the local selected-window bridge. */
  mouseButton?: 'left' | 'right' | 'wheel' | 'back' | 'forward'
  modifiers?: Array<'ALT' | 'CTRL' | 'META' | 'SHIFT'>
  clickCount?: 1 | 2
  /** Optional submit control for one controller-owned field transaction.
   * Native computer-use providers may return click → type → click as one
   * ordered batch. Carve validates both points up front, proves the text
   * was accepted exactly once, and only then releases this final click. */
  submitPoint?: { x: number; y: number } | null
  /** Frame-scoped semantic identity for `submitPoint`, when the provider's
   * final click lands on a captured non-sensitive control. */
  submitTargetElementId?: string | null
  /** Controller-owned continuity for the final submit control across captures. */
  submitTargetIdentity?: LiveComputerAction['targetIdentity']
  /** Human-review label for the final submit control. It is derived from the
   * captured element digest, never trusted as execution authority. */
  submitTargetLabel?: string | null
  /** Destination for the generic visual drag fallback. */
  endPoint?: { x: number; y: number } | null
  /** Capability requested by `element_action`; validated against the current
   * accessibility node before the native bridge receives it. */
  elementAction?: LiveComputerElementAction | null
  /** Controller-defined native command. The model selects an opaque semantic
   * identity; it never supplies a shortcut, process, or arbitrary menu path. */
  command?: LiveComputerSafeCommand | null
  /** Added by controller preflight for a transactional adapter. Providers and
   * persisted model proposals cannot self-assert this authority. */
  operationAuthorization?: ApplicationOperationExecutionAuthorization | null
  /** For the controller-defined save command only: an exact absolute path
   * already present in the approved goal. The controller accepts only a new
   * file from a fresh document and never overwrites an existing path. */
  filePath?: string | null
  scrollY: number | null
  scrollX?: number | null
  /** A read-only navigation objective. `top` and `bottom` are compiled into a
   * bounded series of wheel events and saturation checks while consuming one
   * planning-budget action. */
  scrollIntent?: 'viewport' | 'top' | 'bottom' | 'reveal' | null
  text: string | null
  /** Added by controller preflight after deterministic grounding. It is not
   * part of the model action schema and cannot be self-asserted by a model. */
  textProvenance?: LiveComputerFieldTextProvenance | null
  /** For `conclude`: the composed deliverable for the active objective — the
   * extracted facts, assessment, or answer, in full sentences, grounded only
   * in visible evidence and previously verified ledger facts. A cognitive
   * objective's target state ("the facts have been produced") never appears
   * on screen, so this is the action that produces it; the verifier judges
   * the text against the frame and the ledger before the objective advances. */
  conclusion?: string | null
  /** For `conclude`, a structured work product proposed from visible evidence.
   * It becomes reusable only after independent criterion verification. */
  artifact?: LiveComputerArtifactDraft | null
  /** For `apply_artifact`, the verified ledger work product to render. The
   * model selects an identity; the controller supplies all actual contents. */
  artifactId?: string | null
  /** Inferred from the current destination, not its application brand. */
  artifactLayout?: 'grid' | 'lines' | 'table' | null
  /** Zero-based bounded portion: grid cell in row-major order including headers, or text paragraph/record. */
  artifactUnit?: number | null
  /** For `enter_sequence`: an ordered run of inputs into one control set that
   * the local compiler delivers as one governed transaction with one
   * verification at the end. Text items are typed; key items press one safe
   * navigation key; activate items press the control whose visible label is
   * exactly `value` in the current accessibility digest. Every activator is
   * resolved against the latest frame before any input is sent. */
  sequence?: LiveComputerEntrySequenceItem[] | null
  /** Set only by the local field-entry compiler on its internal `type` event. */
  /** Controller-only: never parsed from a model proposal. */
  artifactBinding?: string
  /** Controller-bound destination and artifact version; never supplied by the actor. */
  artifactDestination?: { fingerprint: string; dataDigest: string; rows: number; columns: number }
  tablePayload?: { cells: string[][]; destinationFingerprint: string }
  textDelivery?: LiveComputerTextDelivery | null
  key: string | null
  /** For `type_into`, select the existing field contents inside the same
   * approved interaction transaction before typing. */
  replaceExisting: boolean
  confidence: number
  risk: ActionRisk
  requiresConfirmation: boolean
  /** Controller-owned provenance. Model schemas never accept these fields;
   * they are added only after a provider proposal passes the compiler. */
  proposalSource?: 'structured_model' | 'openai_computer' | 'controller'
  /** A strategy preference, never authority or evidence. Visual targeting deliberately bypasses AX rebinding. */
  targetingMode?: 'semantic' | 'visual' | null
  groundingSource?: 'semantic_element' | 'provider_visual' | 'not_applicable'
  proposalFrameId?: string | null
  proposalFrameSha256?: string | null
  /** Controller-only screenshot geometry; native input refuses stale bounds. */
  captureBounds?: LiveComputerTarget['bounds']
  /** Controller-owned surfaces visible in the decision frame. */
  captureWindows?: Array<{ windowId: number; bounds: LiveComputerTarget['bounds'] }>
  providerCallId?: string | null
  /** For `ask_user`: the decision the person is being asked to make. */
  question?: string | null
  /** For `ask_user`: why the fork or boundary was reached. */
  guidanceContext?: string | null
  /** For `ask_user`: up to four concrete answers; empty for open-ended questions. Options naming capabilities the
   * contract prohibits for the agent must be `person_takes_over`. */
  options?: LiveComputerGuidanceOption[] | null
}

/** One step of an `enter_sequence` transaction. */
export interface LiveComputerEntrySequenceItem {
  kind: 'text' | 'key' | 'activate'
  value: string
}

/** One selectable choice at a mid-execution decision point. */
export interface LiveComputerGuidanceOption {
  id: string
  label: string
  consequence: string
  /** agent_continues: Carve executes the chosen branch under all standing
   * boundaries. person_takes_over: choosing it converts to a structured
   * handoff — a chip can never launder authority the contract forbids. */
  mode: 'agent_continues' | 'person_takes_over'
}

/** A decision point the session is holding on. */
export interface LiveComputerGuidance {
  id?: string
  channel?: LiveComputerUserDecision['channel']
  question: string
  context: string
  /** Controller-authored explanation for the capsule; context may contain diagnostics. */
  displayContext?: string
  options: LiveComputerGuidanceOption[]
  askedAt: string
}

/** A human answer at a decision point — quoted to the model as direction with
 * the highest authority for the rest of the session. */
export interface LiveComputerGuidanceEntry {
  question: string
  chosenOptionId: string | null
  chosenLabel: string | null
  directive: string | null
  atAction: number
  providedAt: string
}

export interface LiveComputerUserDecision extends LiveComputerGuidanceEntry {
  id: string
  questionId: string
  runId: string
  sequence: number
  context: string
  consequence: string | null
  channel: 'task' | 'operation' | 'resource' | 'budget' | 'control'
  objectiveId: string | null
  operationId: string | null
  surface: 'main_app' | 'capsule' | 'internal'
  answerDigest: string
}

/** The semantic shape of a parameter required by an application operation.
 * These types are intentionally application-neutral: adapters may expose a
 * TextEdit save path, an Excel range, or a calendar account without teaching
 * the planner a new authority model for every application. */
export type LiveComputerOperationParameterType =
  | 'text'
  | 'filename'
  | 'absolute_path'
  | 'url'
  | 'application'
  | 'account'
  | 'recipient'
  | 'resource'
  | 'boolean'
  | 'enumerated'

/** Resolution is deliberately richer than present/missing. In particular,
 * a value may be mechanically derivable while still requiring the person to
 * authorize it because it changes where an external effect will land. */
export type LiveComputerOperationBindingStatus =
  | 'resolved'
  | 'resolvable'
  | 'needs_observation'
  | 'needs_user_choice'
  | 'needs_authority'
  | 'ambiguous'
  | 'unavailable'
  | 'stale'

export type LiveComputerOperationParameterSource =
  | 'approved_goal'
  | 'user_guidance'
  | 'saved_preference'
  | 'os_default'
  | 'application_state'
  | 'controller_default'
  | 'derived'

/** One controller-owned, typed value used by an operation. Values remain
 * ephemeral session state. Audit projections hash sensitive values such as
 * paths, recipients, accounts, and resource identifiers. */
export interface LiveComputerOperationBinding {
  id: string
  operationId: string
  parameterId: string
  type: LiveComputerOperationParameterType
  status: LiveComputerOperationBindingStatus
  source: LiveComputerOperationParameterSource
  value: string | number | boolean | null
  safeLabel: string
  /** A value can be known without being authorized. External-effect
   * parameters become executable only after this bit is true. */
  authorized: boolean
  authorityImpact: 'none' | 'selects_target' | 'external_effect'
  updatedAt: string
}

export interface LiveComputerOperationBlocker {
  parameterId: string
  status: Exclude<LiveComputerOperationBindingStatus, 'resolved' | 'resolvable'>
  reason: string
  /** Stable privacy-safe identity used to suppress repeated decision loops. */
  fingerprint: string
}

export interface LiveComputerOperationFeasibility {
  operationId: string
  objectiveId: string | null
  status: 'ready' | 'needs_observation' | 'needs_user' | 'needs_contract_revision' | 'unavailable'
  bindings: LiveComputerOperationBinding[]
  blockers: LiveComputerOperationBlocker[]
  allowedNextSteps: Array<'execute' | 'observe' | 'ask_user' | 'revise_contract' | 'handoff'>
  evaluatedAt: string
}

export interface LiveComputerOperationResolutionChoice {
  optionId: string
  operationId: string
  parameterId: string
  type: LiveComputerOperationParameterType
  value: string | number | boolean
  source: LiveComputerOperationParameterSource
  safeLabel: string
  authorityImpact: LiveComputerOperationBinding['authorityImpact']
}

/** Controller/native shared lifecycle for one application operation. The
 * vocabulary describes interaction semantics rather than any one app's UI,
 * so document editors, spreadsheets, browsers, mail, calendars, file
 * managers, and export panels can use the same commit discipline. */
export type ApplicationOperationTransactionPhase =
  | 'prepared'
  | 'preconditions_established'
  | 'effect_ui_requested'
  | 'effect_ui_identified'
  | 'primary_field_identified'
  | 'primary_field_verified'
  | 'destination_ui_requested'
  | 'destination_ui_identified'
  | 'destination_field_verified'
  | 'effect_ui_restored'
  | 'commit_revalidated'
  | 'commit_attempted'
  | 'commit_observed'
  | 'postcondition_verified'
  | 'completed'
  | 'failed'

/** Mechanical and authority failures remain distinct all the way from an
 * application adapter to recovery and audit. In particular, a post-commit
 * uncertainty is not relabeled as a provider outage or an input rejection. */
export type ApplicationOperationFailureCode =
  | 'precondition_not_established'
  | 'authorized_window_lost'
  | 'dialog_not_found'
  | 'dialog_identity_ambiguous'
  | 'element_identity_ambiguous'
  | 'field_mutation_rejected'
  | 'field_readback_mismatch'
  | 'commit_not_attempted'
  | 'commit_rejected'
  | 'effect_may_have_occurred_unverified'
  | 'exact_postcondition_failed'
  | 'environment_unavailable'
  | 'authority_safety_violation'
  | 'provider_failure'

export type ApplicationOperationRetryEligibility =
  | 'safe_phase_retry'
  | 'observe_only'
  | 'handoff'
  | 'none'

/** Stable identity evidence is hash-only. App-specific adapters may combine
 * application PID, immutable selected-window id, sheet ancestry, role,
 * labels/descriptions, and geometry without persisting those raw strings. */
export interface ApplicationOperationIdentityEvidence {
  applicationSha256: string
  windowSha256: string
  containerSha256: string | null
  elementSha256: string | null
}

export interface ApplicationOperationPhaseReceipt {
  phase: ApplicationOperationTransactionPhase
  observation: number
  mutation: 'none' | 'pre_commit' | 'commit' | 'post_commit_observe'
  state: 'established' | 'changed' | 'matched' | 'absent' | 'rejected' | 'ambiguous' | 'timed_out'
  identity: ApplicationOperationIdentityEvidence
  /** Digests bind read-back to controller-owned data without copying file
   * paths, recipients, cell contents, or other sensitive values into audit. */
  readbackSha256: string | null
}

export interface ApplicationOperationFailure {
  code: ApplicationOperationFailureCode
  phase: ApplicationOperationTransactionPhase
  message: string
  fingerprint: string
  retryEligibility: ApplicationOperationRetryEligibility
}

/** A complete adapter receipt is the authority boundary for semantic effects.
 * `commit.attemptCount` may never exceed one. Once `effectMayHaveOccurred` is
 * true, recovery is observation-only and the operation is never replayed. */
export interface ApplicationOperationTransactionReceipt {
  version: 1
  transactionId: string
  operationId: string
  adapterId: string
  adapterVersion: number
  capability: string
  status: 'completed' | 'failed' | 'uncertain'
  phase: ApplicationOperationTransactionPhase
  parameterBindingsSha256: string
  authorizedEffect: {
    kind: 'read' | 'local_write' | 'external_write'
    targetSha256: string
    overwriteAuthorized: boolean
  }
  target: {
    bundleIdentifierSha256: string
    windowId: number | null
    identity: ApplicationOperationIdentityEvidence
  }
  preconditions: {
    established: boolean
    outputPriorState: 'absent' | 'present' | 'directory' | 'unknown'
    expectedContentSha256: string | null
    startedAtMs: number
  }
  phases: ApplicationOperationPhaseReceipt[]
  commit: {
    attempted: boolean
    accepted: boolean
    attemptCount: number
    effectMayHaveOccurred: boolean
  }
  idempotency: {
    keySha256: string
    duplicateEffectRisk: 'none' | 'possible' | 'certain'
    replayAllowed: boolean
  }
  postcondition: {
    kind: 'exact_new_file' | 'adapter_defined'
    satisfied: boolean
    observations: number
    targetSha256: string
    outputKind: 'absent' | 'regular_file' | 'directory' | 'other' | 'unknown'
    contentSha256: string | null
    byteLength: number | null
    metadataAfterStart: boolean | null
  }
  failure: ApplicationOperationFailure | null
}

/** Ephemeral controller authorization attached after proposal validation. It
 * contains only binding/effect digests; the model cannot supply this field. */
export interface ApplicationOperationExecutionAuthorization {
  transactionId: string
  operationId: string
  parameterBindingsSha256: string
  targetSha256: string
  overwriteAuthorized: boolean
}

/** The exact controller-generated question backing an operational choice.
 * It is kept separately from generic model guidance so answering it can bind
 * a typed value without turning human prose into implicit authority. */
export interface LiveComputerPendingOperationResolution {
  feasibility: LiveComputerOperationFeasibility
  choices: LiveComputerOperationResolutionChoice[]
}

export interface LiveComputerFrame {
  elementCompleteness?: ElementCaptureCompleteness
  captureInterval?: { startedAt: string; completedAt: string; channelsAtomic: false }
  id: Id
  capturedAt: string
  width: number
  height: number
  sha256: string
  /** Platform-observed application content inside the selected-window frame,
   * in the same window-relative coordinate system. Optional when AX cannot
   * distinguish browser chrome from page content. */
  contentBounds?: { x: number; y: number; width: number; height: number } | null
  /** Whether the frame carried a control digest. Anything but `available`
   * means clicks and typing inside this window could not be named. */
  elementCaptureStatus?: 'available' | 'ax_untrusted' | 'window_match_failed' | 'walk_empty' | 'not_requested' | 'invalid_response' | 'unknown'
  /** Dialogs, sheets, and banners visible in this frame. */
  obstructions?: LiveComputerObstruction[]
}

/** A typed, inspectable transfer of one verified work product between two
 * authorized mission surfaces. It contains only task data and provenance,
 * never screenshots, hidden reasoning, cookies, or arbitrary page text. */
export interface LiveComputerContextTransfer {
  id: Id
  /** Durable checkpoint backing a reviewed transfer. Autopilot transfers do
   * not mint a checkpoint because the frozen supervision policy authorizes
   * the handoff automatically. */
  checkpointId: Id | null
  actionId: Id
  artifactId: Id
  title: string
  kind: LiveComputerArtifact['kind']
  columns: string[]
  /** Complete bounded record set. Artifacts cap this at 200 cells / 12,000
   * characters so a person can inspect every transferred value. */
  rows: string[][]
  /** Prose and selection payload. Record sets use columns + rows. */
  content: string | null
  itemCount: number
  provenance: string[]
  fromWindowId: number
  fromApplication: string
  toWindowId: number
  toApplication: string
  toRole: LiveComputerSurfaceRole
  payloadSha256: string
  status: 'pending_review' | 'approved' | 'automatic' | 'consumed' | 'declined'
  createdAt: string
  approvedAt: string | null
  consumedAt: string | null
}

export type LiveComputerSessionStatus = 'initializing' | 'awaiting_plan_approval' | 'ready' | 'awaiting_approval' | 'awaiting_context_transfer' | 'awaiting_guidance' | 'reconciling_input' | 'acting' | 'verifying' | 'paused' | 'handoff' | 'completed' | 'blocked' | 'stopped'

export type LiveComputerTerminalCategory = 'safety_block' | 'needs_user' | 'execution_limit' | 'environment_error' | 'provider_error' | 'planning_error' | null

/** A customer-facing account of the control loop. These phases describe what
 * Carve is doing without exposing provider scratch work or chain-of-thought. */
export type LiveComputerActivityPhase =
  | 'preparing'
  | 'observing'
  | 'deciding'
  | 'acting'
  | 'verifying'
  | 'recovering'
  /** Automatic interface loading; no user response is required. */
  | 'settling'
  /** Waiting for a response from the person. */
  | 'waiting'
  | 'paused'
  | 'ended'
  /** Legacy persisted activity events only. New terminal events use ended;
   * verified completion is represented by the session outcome/health. */
  | 'complete'

/** One inspectable phase in a live session. `headline` and `detail` are
 * operational summaries, never raw provider responses. Overlay-safe events
 * may be projected through the stricter closed-vocabulary overlay presenter;
 * the overlay still never renders these strings directly. */
export interface LiveComputerActivityEvent {
  id: Id
  phase: LiveComputerActivityPhase
  headline: string
  detail: string | null
  startedAt: string
  endedAt: string | null
  objectiveId: string | null
  actionId: string | null
  visibility: 'overlay_safe' | 'in_app_only'
}

/** Ephemeral live-control state. Frames are intentionally not persisted here. */
export interface LiveComputerSession {
  surfaceIntent?: WorkSurfaceIntent

  /** No inferred contract exists yet; input and mission approval stay disabled. */
  pendingInitialContract?: boolean
  id: Id
  runId: Id
  goal: string
  providerId: string
  /** Provider used for criterion verification. Configuring one distinct from
   * the acting provider keeps the verifier from grading its own proposals. */
  verifierProviderId: string | null
  autonomy: AutonomyLevel
  /** Version-2 policy frozen when the live session starts. */
  supervision?: SupervisionPolicyV2
  targetAuthorization?: TargetAuthorization
  /** Frozen at session start so changing the experimental setting never
   * mutates an action contract already under review or in flight. */
  executionMode?: LiveComputerExecutionMode
  /** Frozen next-action planner. Sessions created before the field existed
   * retain the structured planner for compatibility and immediate rollback. */
  actionEngine?: LiveComputerActionEngine
  /** Frozen computer-use model policy. Older sessions retain the adaptive
   * Sol/Terra route when this field is absent. */
  modelProfile?: LiveComputerModelProfile
  remoteVisualsAllowed: boolean
  /** The window Carve is currently reading and controlling. Always a member
   * of `targets`. */
  target: LiveComputerTarget
  /** Every window this session may touch, fixed at start and covered by the
   * mission-plan hash. On-screen content can never extend it. */
  targets: LiveComputerSessionTarget[]
  status: LiveComputerSessionStatus
  actionCount: number
  maxActions: number
  /** Active session time; approval and guidance waits are deliberately excluded. */
  activeDurationMs?: number
  maxDurationMinutes?: number
  startedAt: string
  updatedAt: string
  latestFrame: LiveComputerFrame | null
  pendingAction: LiveComputerAction | null
  pendingApproval: LiveComputerApproval | null
  pendingInputTransaction: LiveComputerInputTransaction | null
  /** Verified artifacts proposed or delivered across a window boundary. */
  contextTransfers: LiveComputerContextTransfer[]
  pendingContextTransfer: LiveComputerContextTransfer | null
  missionPlan: LiveComputerMissionPlan
  /** The completed exchange this session follows up on. Quoted to the live
   * planner and verifier as context for resolving references — never as new
   * authority, and never as proof of the current outcome. */
  priorExchange: { goal: string; result: string | null } | null
  /** The decision point the session is holding on, when awaiting_guidance. */
  pendingGuidance: LiveComputerGuidance | null
  /** Typed operation state is optional only for sessions created before the
   * generalized operation-binding contract existed. */
  operationBindings?: LiveComputerOperationBinding[]
  pendingOperationResolution?: LiveComputerPendingOperationResolution | null
  /** A window in another application the model asked for; the controller
   * turns it into a decision point whose chips grant, open fresh, or stop.
   * Only ever populated by the controller, never by the model. */
  pendingWindowRequest?: {
    application: string
    bundleIdentifier: string | null
    /** For browsers, the https address a fresh window opens at. */
    url: string | null
    reason: string
    candidates: LiveComputerTarget[]
  } | null
  /** A budget extension waiting on the person's answer at a decision point.
   * Set only by the budget checkpoint; an explicit grant selection applies it. */
  pendingResourceBudget?: LiveComputerResourceCheckpoint | null
  pendingBudgetGrant: { scope: 'objective' | 'session' | 'time'; objectiveId: string | null; actions: number; durationMinutes?: number } | null
  /** Every human answer given at a decision point this session. */
  guidanceLog: LiveComputerGuidanceEntry[]
  resultSummary: string | null
  /** Objective groups explicitly approved during this ephemeral session. */
  approvedObjectiveIds: string[]
  /** One bounded browser side-tab workspace created by Carve. Tab cycling
   * is accepted only while this state proves which adjacent tab Carve
   * created, so pre-existing tab order is never guessed from pixels. */
  tabWorkspace: { managedTabOpen: boolean; activeTab: 'original' | 'managed'; windowId: number | null }
  ledger: LiveComputerTaskLedger
  /** Typed live briefing events. Optional only for sessions created before the
   * briefing contract; `activity` remains as a compatibility/audit summary. */
  activityEvents?: LiveComputerActivityEvent[]
  /** Stable timer anchor for the current activity, avoiding inference from a
   * generic session update timestamp. */
  phaseStartedAt?: string
  /** Freezes the elapsed wall clock when a session reaches a terminal state. */
  endedAt?: string | null
  activity: string[]
  blockedReason: string | null
  terminalCategory: LiveComputerTerminalCategory
}

/**
 * Ephemeral state for the deliberately thin, provider-owned computer loop.
 * It is kept separate from `LiveComputerSession`: Universal mode does not
 * pretend to have Carve's objective ledger, per-action approvals, or
 * independent verification. Frames remain memory-only and are exposed here
 * as metadata, just like the governed session.
 */
export interface UniversalComputerSession {
  pendingPlanReview?: UniversalPlanReview | null
  approvedPlanSteps?: string[]
  reportedOutcome?: 'completed' | 'partial' | 'blocked' | 'unclassified'
  actionEngine?: LiveComputerActionEngine
  /** The engine the person selected when a router chose `actionEngine` for this window. */
  routedFrom?: 'router_v1'
  /** A routed compact attempt that stopped for a recoverable reason hands the
   * same task to the Thin loop once. `pending` while the fresh contract is
   * prepared; `started` names the session that took over. */
  engineFallback?: { status: 'pending' | 'started' | 'declined'; fromSessionId?: Id; toSessionId?: Id; reason?: string }
  id: Id
  runId: Id
  goal: string
  /** Display title derived from the request at interpretation time; never authority. */
  title?: string
  providerId: string
  model: string
  /** Frozen policy that selected `model` for this session. */
  modelProfile?: LiveComputerModelProfile
  target: LiveComputerTarget
  supervision?: SupervisionPolicyV2
  targetAuthorization?: TargetAuthorization
  pendingCheckpointId?: string | null
  /** The hosted-frame consent inherited by a follow-up. Universal cannot
   * start without it; keeping it explicit prevents a follow-up from inventing
   * a new disclosure choice. */
  remoteVisualsAllowed: boolean
  /** Completed exchange carried into a follow-up for reference resolution.
   * It is context only, never proof or expanded window authority. */
  priorExchange: { goal: string; result: string | null } | null
  status: 'starting' | 'running' | 'pausing' | 'paused' | 'awaiting_checkpoint' | 'awaiting_steering_review' | 'awaiting_budget' | 'replanning' | 'completed' | 'safety_check' | 'stopped' | 'blocked'
  startedAt: string
  updatedAt: string
  endedAt: string | null
  phaseStartedAt: string
  latestFrame: LiveComputerFrame | null
  providerTurns: number
  batches: number
  /** Privacy-safe physical-action projection for the selected-window frame.
   * It contains coordinates and a fixed controller label, never typed text,
   * key contents, provider reasoning, or screen content. */
  latestActionCue: {
    sequence: number
    batch: number
    action: number
    kind: 'pointer' | 'click' | 'scroll' | 'typing' | 'key' | 'wait'
    label: string
    direction: 'up' | 'down' | null
    point: { x: number; y: number } | null
    /** Window-relative bounds of the semantically bound control, when the
     * batch preflight resolved one. Null means the frame shows a point only. */
    bounds?: { x: number; y: number; width: number; height: number } | null
    occurredAt: string
  } | null
  /** When the most recent post-batch observation was captured. Drives the
   * frame's read cue; local settle probes deliberately do not update it. */
  lastObservationAt?: string | null
  /** The compact actor's declared next step for the current turn (perceived
   * speed lever, off by default). Intent, not a fact: shown as "Next", never
   * used to authorize or describe delivered input. Cleared at each new turn. */
  narration?: { text: string; turn: number; at: string; source: 'stream' | 'response' } | null
  /** A proposed answer awaiting the final check, shown as being checked; cleared when the check rejects it or the
   * session ends. Display only: the terminal answer is what the check accepted. */
  draftAnswer?: { text: string; at: string } | null
  /** Effective person-approved physical-input ceiling, including explicit
   * amendments. Unlike the former atomic headroom, this is a hard boundary. */
  maxInputActions: number
  /** Effective multi-resource contract used by the running coordinator. */
  effectiveBudget: WorkBudgetEnvelope
  actionsCompleted: number
  inputActionsCompleted: number
  waitsCompleted: number
  providerWaitsAbsorbed: number
  settleCycles: number
  settleProbes: number
  settleDurationMs: number
  noProgressBatches: number
  repeatedBatchesDetected: number
  batchesSuppressed: number
  observationsCaptured: number
  actionFailures: number
  semanticRecoveryEpisodes: number
  /** Semantic recovery episodes that were followed by visible progress (not charged under the tiered policy). */
  recoveredSemanticRecoveryEpisodes?: number
  /** Effect classes of every batch this session was authorized to execute; the completion review is scaled to them. */
  executedEffectClasses?: ActionEffectClass[]
  /** An independent final review accepted the observed result. */
  completionVerified?: boolean
  /** Provider turns that were actual paid model requests; `providerTurns`
   * also counts controller-compiled local continuations. */
  paidModelCalls?: number
  /** Requests that failed after dispatch (metered in the ledger, usage often
   * unknown) and provider retries of the same turn. Neither is in
   * `paidModelCalls`, which counts completed paid turns. */
  failedModelRequests?: number
  providerRetries?: number
  /** Requests (failed or not) whose token usage was not returned; token
   * totals are then a known subtotal. */
  unknownUsageRequests?: number
  /** Turns the controller compiled locally (zero tokens): bounded Find
   * continuations, local transactions and similar. */
  localContinuations?: number
  /** Independent final-check turns, how many rejected the proposed answer,
   * and strategic repair turns the rejections or stalls caused. */
  verificationTurns?: number
  verificationRejections?: number
  repairTurns?: number
  /** Final reports the controller sent back because they admitted unmet
   * work, named no authority boundary, and left budget unused. */
  completionChallenges: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  terminalText: string | null
  reason: string | null
  /** Exact coordinator status and customer-facing category are carried
   * independently from the coarse blocked session state. */
  terminalSourceStatus: 'completed' | 'safety_check' | 'provider_turn_limit' | 'action_limit' | 'token_limit' | 'time_limit' | 'stalled' | 'replan_required' | 'cancelled' | 'failed' | 'verification_rejected' | null
  terminalKind: 'completed' | 'partial' | 'safety_hold' | 'execution_limit' | 'stalled' | 'user_stopped' | 'planning_failure' | 'provider_failure' | 'environment_failure' | 'verification_rejected' | null
  /** Request clauses the model's own report admits were not done. Set only
   * when a model-reported completion was downgraded to a partial outcome. */
  remainingClauses?: string[]
  /** The last person step (a human-verification check or a sign-in) this run handed to the person and that was left
   * undone when the pause ended (declined or the wait ran out). Cleared when a later one is resolved. */
  personStepLeft?: { kind: 'human_verification' | 'sign_in'; site: string | null } | null
  terminalCategory: LiveComputerTerminalCategory
  canResume: boolean
  pendingBudgetCheckpoint: {
    cloudUnit?: boolean
    fundingStatus?: 'pending' | 'failed' | 'funded'
    fundingError?: string | null
    id: string
    reason: 'next_batch_does_not_fit' | 'next_provider_turn_does_not_fit' | 'unfinished_at_limit'
    usedInputs: number
    approvedInputs: number
    remainingInputs: number
    requestedBatchInputs: number
    extensionInputs: number
    extensionTokens: number
    extensionMinutes: number
    extensionModelCalls: number
    extensionVisionFrames: number
    extensionRecoveryEpisodes: number
    forecast: WorkBudgetFinishForecast
    canGrant: boolean
    createdAt: string
  } | null
  /** A high-confidence question about the result can be answered locally from
   * the recorded terminal text without starting another computer loop. */
  completionAnswer: { question: string; answer: string; answeredAt: string } | null
  pendingSafetyChecks: Array<{ id: string; code: string; message: string }>
  /** Provider-neutral, controller-authored activity. No chain-of-thought,
   * screenshots, typed field content, or steering transcript is retained. */
  activityEvents: LiveComputerActivityEvent[]
  steeringCount: number
  /** Safe metadata for a direction that cannot resume under the current
   * authority. The correction text is discarded before this is created. */
  pendingSteeringReview: {
    id: string
    source: 'text' | 'voice'
    characters: number
    receivedAt: string
    reasonCodes: Array<'protected_action' | 'new_application' | 'new_destination' | 'new_recipient' | 'new_sensitive_data' | 'new_task'>
    summary: string
  } | null
  lastSteeringReceipt: {
    id: string
    source: 'text' | 'voice'
    characters: number
    receivedAt: string
    appliedAt: string
    intent: 'stop' | 'pause' | 'resume' | 'status_question' | 'redirect' | 'scope_change' | 'take_over' | 'unclear'
    disposition: 'applied' | 'held_for_review' | 'paused' | 'resumed' | 'stopped' | 'answered' | 'needs_clarity'
    summary: string
  } | null
  activity: string[]
}

export interface WorkPreparation {
  context: WorkContextSummary
  run: WorkRun | null
  blocker: string | null
}

export interface RecoveryProposal {
  id: Id
  status: 'proposed' | 'accepted' | 'dismissed'
  reason: string
  failedActionId: Id
  observedState: Record<string, string | number | boolean | null>
  suggestedGoal: string
  autonomy: AutonomyLevel
  requiresExplicitPlan: true
  replacementRunId: Id | null
  createdAt: string
  decidedAt: string | null
}

export type ApprovalKind = 'immediate' | 'group' | 'countdown'
export type ApprovalStatus = 'pending' | 'approved' | 'cancelled' | 'expired'

export interface ApprovalRecord {
  id: Id
  runId: Id
  actionId: Id
  actionHash: string
  kind: ApprovalKind
  status: ApprovalStatus
  preview: string
  expiresAt: string | null
  decidedAt: string | null
}

export type CheckpointSubject =
  | 'plan'
  | 'phase'
  | 'action'
  | 'computer_batch'
  | 'deviation'
  | 'budget'
  | 'data_transfer'
  | 'provider_safety'
  | 'supervision_change'

export interface CheckpointPreview {
  what: string
  where: string | null
  data: string | null
  whyNow: string
  verification: string | null
}

/** What the person sees while a checkpoint is pending: sentences that may quote the text Carve is about to type.
 * Held in memory for the life of the decision and never written to the checkpoint record. */
export interface CheckpointLivePreview {
  actions: string[]
}

export type CheckpointGrantScope =
  | { kind: 'once' }
  | { kind: 'phase'; phaseHash: string }
  | { kind: 'plan'; effectClasses: ActionEffectClass[]; targets: string[] }
  | { kind: 'countdown_once'; delayMs: number }

export interface CheckpointDecision {
  version: 2
  id: string
  runId: string
  sessionId: string | null
  subject: CheckpointSubject
  subjectId: string
  subjectHash: string
  planHash: string
  supervisionPolicyHash: string
  boundary: 'immediate' | 'phase' | 'plan' | 'countdown'
  effectClasses: ActionEffectClass[]
  reasonCodes: string[]
  preview: CheckpointPreview
  scope: CheckpointGrantScope
  status: 'pending' | 'approved' | 'declined' | 'cancelled' | 'expired' | 'consumed'
  createdAt: string
  expiresAt: string | null
  decidedAt: string | null
  decidedBy: 'user' | null
}

export interface SupervisionAmendment {
  id: string
  runId: string
  basePlanHash: string
  previousPolicyHash: string
  nextPolicy: SupervisionPolicyV2
  nextPolicyHash: string
  direction: 'tighten' | 'loosen'
  approvedBy: 'user' | 'system'
  approvedAt: string
}

export interface AuditEvent {
  id: Id
  sequence: number
  occurredAt: string
  category: string
  actor: 'user' | 'system' | 'model' | 'policy' | 'tool'
  subjectId: Id | null
  details: Record<string, unknown>
  previousHash: string
  hash: string
}

/** One attempted model request, recorded so spend and failures are not guessed. */
export interface ModelCall {
  telemetry?: Partial<ModelResponseTelemetry>
  runtimeBuildId?: string | null
  id: Id
  occurredAt: string
  providerId: string
  providerKind: 'mock' | 'hosted' | 'local'
  model: string
  /** Which part of Carve asked, so cost can be attributed to a purpose. */
  job: 'work.method_select' | 'web.search' | 'web.source_support' | 'computer.guide' | 'computer.guide_review' | 'conversation.interpret' | 'recall.answer' | 'ai.induction' | 'recall.embedding' | 'session.naming' | 'computer.live' | 'computer.route_intent' | 'computer.live.goal_plan' | 'computer.live.strategy' | 'computer.live.strategy_arbiter' | 'computer.live.objective_replan' | 'computer.live.decision_critic' | 'computer.live.query_scope' | 'computer.live.action_scope' | 'computer.live.executive' | 'computer.live.plan' | 'computer.live.native_plan' | 'computer.live.plan_revision' | 'computer.live.verify' | 'computer.live.input_acceptance' | 'computer.target_recommendation'
  inputTokens: number | null
  outputTokens: number | null
  totalTokens?: number | null
  cachedInputTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
  /** Older rows predate this field and are treated as completed. */
  status?: 'completed' | 'failed'
  /** Correlation and elapsed work are optional only for legacy/non-Work calls. */
  runId?: Id | null
  sessionId?: Id | null
  phase?: string | null
  durationMs?: number | null
  visionFrames?: number
  turnIndex?: number | null
  responseChainId?: string | null
}

export type ModelCapability = 'text' | 'vision' | 'embeddings' | 'structured_output' | 'tool_calling'

export interface ModelCapabilities {
  text: boolean
  vision: boolean
  embeddings: boolean
  structuredOutput: boolean
  toolCalling: boolean
}

export interface ModelProviderSummary {
  /** Whether this configured model accepts original-resolution image detail. */
  originalImageDetail?: boolean
  id: string
  name: string
  kind: 'mock' | 'hosted' | 'local'
  model: string
  /** Embeddings come from a different model than chat; null when unsupported. */
  embeddingModel: string | null
  baseUrl: string | null
  configured: boolean
  capabilities: ModelCapabilities
  /** Specialized screenshot-to-action proposal support. Generic tool calling
   * does not imply this surface exists. */
  computerActionProposals?: boolean
  /** Stateful provider-owned computer loop support used by Universal mode. */
  computerUseSessions?: boolean
  privacyNote: string
}

export interface FixtureObservation {
  offsetMs: number
  facts: CapturedFacts
}

export interface EvaluationFixture {
  id: string
  name: string
  goal: string
  expectedProcedure: 'linear' | 'branched' | 'interrupted' | 'blocked'
  observations: FixtureObservation[]
  expectedSignals: string[]
}

/** One frontmost-window sample. Metadata only: this path never touches pixels. */
export interface AmbientSample {
  app: string
  windowTitle: string
  bundleIdentifier: string
  excluded: boolean
  /** Locally recognised on-screen text, when ambient text is enabled. */
  text?: string
}

/** One recorded transition between frontmost windows, with how long it was held. */
export interface AmbientEvent {
  id: Id
  app: string
  windowTitle: string
  signature: string
  startedAt: string
  endedAt: string
  durationMs: number
  /** Recognised on-screen text, when ambient text is enabled. Never a screenshot. */
  text?: string
}

/**
 * A repeated sequence of window transitions, offered to the user as something
 * worth observing properly. It is a prompt, never evidence: it carries no
 * screenshot, cannot enter induction, and produces no executable step.
 */
export interface WorkflowCandidate {
  id: Id
  signatures: string[]
  occurrences: number
  distinctDays: number
  lastSeenAt: string
  medianDurationMs: number
}
