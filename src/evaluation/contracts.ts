import { nowIso, sha256, stableJson } from '../util.js'

export type EvaluationEnvironmentTier =
  | 'pure'
  | 'local_fixture'
  | 'shadow_replay'
  | 'disposable_staging'
  | 'controlled_canary'
  | 'personal_production'

export type EvaluationAccountClass = 'none' | 'synthetic' | 'disposable' | 'personal'
export type EvaluationNetworkMode = 'deny' | 'loopback' | 'allowlist'
export type EvaluationEffect =
  | 'none'
  | 'read'
  | 'local_input'
  | 'reversible_write'
  | 'external_communication'
  | 'credential_entry'
  | 'financial'
  | 'destructive'

export type EvaluationFailureCause =
  | 'goal_decomposition'
  | 'information_provenance'
  | 'grounding'
  | 'focus_or_window'
  | 'input_transaction'
  | 'temporal_race'
  | 'loading_or_stale_state'
  | 'route_selection'
  | 'recovery_loop'
  | 'budget'
  | 'authority_or_policy'
  | 'prompt_injection'
  | 'outcome_verification'
  | 'verification_presentation_mismatch'
  | 'no_input_livelock'
  | 'objective_over_decomposition'
  | 'budget_truncation'
  | 'handoff'
  | 'provider'
  | 'environment'
  | 'grader'
  | 'unknown'

export type EvaluationOutcomeCategory =
  | 'completed_correct'
  | 'completed_incorrect'
  | 'safe_handoff'
  | 'safety_violation'
  | 'verification_liveness_failure'
  | 'budget_truncated'
  | 'infrastructure_error'

export interface EvaluationCampaignManifest {
  schemaVersion: 1
  id: string
  version: number
  name: string
  objective: string
  createdAt: string
  source: {
    baseline: string
    candidate: string | null
  }
  suite: {
    scenarioIds: string[]
    repetitions: number
    seeds: number[]
    includeSplits: Array<EvaluationScenario['split']>
  }
  environment: {
    tier: EvaluationEnvironmentTier
    ephemeral: boolean
    accountClass: EvaluationAccountClass
    applications: string[]
    windows: string[]
    network: {
      mode: EvaluationNetworkMode
      allowedDomains: string[]
    }
  }
  effects: {
    allowed: EvaluationEffect[]
    prohibited: EvaluationEffect[]
  }
  budget: {
    maxTrials: number
    maxActionsPerTrial: number
    maxModelCalls: number
    maxTokens: number
    maxRuntimeMs: number
    maxCostUsd: number
  }
  graders: Array<{
    id: string
    kind: 'deterministic' | 'model' | 'human'
    required: boolean
  }>
  retention: {
    artifactDays: number
    rawFrameDays: number
    retainRawAudio: boolean
    transcriptPolicy: 'none' | 'synthetic_only' | 'redacted'
  }
  stopConditions: {
    stopOnInvariantViolation: boolean
    stopOnUnauthorizedEffect: boolean
    maxInfrastructureErrors: number
  }
  promotion: {
    minimumOutcomeRate: number
    minimumPassPowK: number
    requireZeroSafetyViolations: boolean
  }
  scheduled: boolean
}

export interface EvaluationApproval {
  manifestHash: string
  approvedBy: 'user'
  approvedAt: string
  expiresAt: string | null
}

export interface EvaluationScenario {
  id: string
  title: string
  family: string
  goal: string
  environmentTier: EvaluationEnvironmentTier
  initialStateHash: string
  referenceSolution: string
  expectedOutcome: Record<string, unknown>
  invariants: string[]
  perturbations: string[]
  tags: string[]
  split: 'regression' | 'capability' | 'holdout'
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export interface EvaluationTraceEntry {
  sequence: number
  occurredAt: string
  phase: 'setup' | 'plan' | 'observe' | 'act' | 'verify' | 'recover' | 'stop'
  event: string
  stateHash: string
  /** The environment is responsible for placing only redacted or synthetic
   * values here. Foundry never assumes an arbitrary trace is safe to retain. */
  details: Record<string, string | number | boolean | null>
}

export interface EvaluationFailure {
  cause: EvaluationFailureCause
  objectiveKind: string
  actionKind: string
  applicationClass: string
  routeIdentity: string
  observationDelta: string
  recoveryDisposition: string
  summary: string
}

export interface EvaluationObservation {
  finalState: Record<string, unknown>
  trace: EvaluationTraceEntry[]
  invariantViolations: string[]
  unauthorizedEffects: EvaluationEffect[]
  failure: EvaluationFailure | null
  /** Independent competence and safety axes. Optional only for legacy suites;
   * new model-driven campaigns should populate every field. */
  outcome?: {
    category: EvaluationOutcomeCategory
    safetyHeld: boolean
    actionLanded: boolean | null
    semanticEvidenceCorrect: boolean | null
    objectiveAdvanced: boolean | null
    answerCorrect: boolean | null
    taskComplete: boolean
    budgetTruncated: boolean
    handoffAppropriate: boolean | null
  }
  metrics: {
    actions: number
    modelCalls: number
    tokens: number
    costUsd: number
    latencyMs: number
    /** User-visible responsiveness milestones. Omit only when the harness
     * cannot observe that milestone (for example, a plan-only scenario). */
    timeToPlanReadyMs?: number
    timeToFirstActionMs?: number
    timeToFirstMeaningfulProgressMs?: number
    longestIdleMs?: number
    planningLatencyMs?: number
    executionLatencyMs?: number
    verificationLatencyMs?: number
    recoveryLatencyMs?: number
    /** Orchestration churn. These are counts of actual control-loop events,
     * not judgments inferred by a grader after the run. */
    replans?: number
    proposalRepairs?: number
    providerRetries?: number
    criticCalls?: number
    executiveCalls?: number
    verificationCalls?: number
    userInterruptions?: number
    exactRepeatedActions?: number
    repeatedNoInputChecks?: number
    objectivesAdvancedFromReusedEvidence?: number
  }
}

export interface EvaluationGrade {
  graderId: string
  kind: 'deterministic' | 'model' | 'human'
  verdict: 'passed' | 'failed' | 'unknown'
  score: number
  evidence: string[]
}

export interface EvaluationTrialArtifact {
  id: string
  campaignId: string
  scenarioId: string
  repetition: number
  seed: number
  startedAt: string
  completedAt: string
  durationMs: number
  environmentTier: EvaluationEnvironmentTier
  source: EvaluationCampaignManifest['source']
  status: 'passed' | 'failed' | 'needs_review' | 'infrastructure_error' | 'blocked'
  observation: EvaluationObservation
  grades: EvaluationGrade[]
  failure: EvaluationFailure | null
}

export interface EvaluationFailureCluster {
  id: string
  signature: string
  cause: EvaluationFailureCause
  title: string
  trialIds: string[]
  scenarioIds: string[]
  count: number
  severity: EvaluationScenario['severity']
  priority: number
  representativeSummary: string
}

export interface EvaluationCampaignReport {
  campaignId: string
  manifestHash: string
  startedAt: string
  completedAt: string
  status: 'passed' | 'failed' | 'needs_review' | 'stopped'
  totals: {
    planned: number
    executed: number
    passed: number
    failed: number
    needsReview: number
    infrastructureErrors: number
    safetyViolations: number
    safeHandoffs: number
    verificationLivenessFailures: number
    budgetTruncated: number
    completedIncorrect: number
  }
  metrics: {
    outcomeRate: number
    passAtK: number
    passPowK: number
    averageActions: number
    averageLatencyMs: number
    p50LatencyMs: number | null
    p95LatencyMs: number | null
    p50TimeToPlanReadyMs: number | null
    p95TimeToPlanReadyMs: number | null
    p50TimeToFirstActionMs: number | null
    p95TimeToFirstActionMs: number | null
    p50TimeToFirstMeaningfulProgressMs: number | null
    p95TimeToFirstMeaningfulProgressMs: number | null
    p95LongestIdleMs: number | null
    totalModelCalls: number
    totalTokens: number
    totalCostUsd: number
    totalReplans: number
    totalProposalRepairs: number
    totalProviderRetries: number
    totalCriticCalls: number
    totalExecutiveCalls: number
    totalVerificationCalls: number
    totalUserInterruptions: number
    totalExactRepeatedActions: number
    safetyRate: number
    completionAccuracy: number
  }
  promotionEligible: boolean
  promotionBlockers: string[]
  clusters: EvaluationFailureCluster[]
  trialIds: string[]
}

export function evaluationManifestHash(manifest: EvaluationCampaignManifest): string {
  return sha256(stableJson(manifest))
}

export function approveEvaluationCampaign(manifest: EvaluationCampaignManifest, expiresAt: string | null = null): EvaluationApproval {
  return {
    manifestHash: evaluationManifestHash(manifest),
    approvedBy: 'user',
    approvedAt: nowIso(),
    expiresAt,
  }
}
