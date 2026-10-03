import { id, nowIso } from '../util.js'
import type {
  EvaluationApproval,
  EvaluationCampaignManifest,
  EvaluationCampaignReport,
  EvaluationFailure,
  EvaluationGrade,
  EvaluationObservation,
  EvaluationScenario,
  EvaluationTrialArtifact,
  EvaluationTraceEntry,
} from './contracts.js'
import { evaluationManifestHash } from './contracts.js'
import type { EvaluationGrader } from './graders.js'
import { mineEvaluationFailures } from './failure-miner.js'
import { EvaluationGovernor } from './governor.js'
import type { EvaluationArtifactStore } from './artifacts.js'

export interface EvaluationExecutionContext {
  campaign: EvaluationCampaignManifest
  scenario: EvaluationScenario
  repetition: number
  seed: number
  signal: AbortSignal
}

export interface RegisteredEvaluationScenario {
  scenario: EvaluationScenario
  execute(context: EvaluationExecutionContext): EvaluationObservation | Promise<EvaluationObservation>
}

export interface EvaluationRunnerOptions {
  governor?: EvaluationGovernor
  artifactStore: EvaluationArtifactStore
  graders: EvaluationGrader[]
}

function infrastructureObservation(error: unknown, elapsedMs: number): EvaluationObservation {
  const message = String(error instanceof Error ? error.message : error).slice(0, 300)
  const trace: EvaluationTraceEntry = {
    sequence: 1,
    occurredAt: nowIso(),
    phase: 'stop',
    event: 'environment_error',
    stateHash: 'unavailable',
    details: { error: message },
  }
  return {
    finalState: {},
    trace: [trace],
    invariantViolations: [],
    unauthorizedEffects: [],
    failure: {
      cause: 'environment',
      objectiveKind: 'scenario',
      actionKind: 'execute',
      applicationClass: 'evaluation',
      routeIdentity: 'environment',
      observationDelta: 'unavailable',
      recoveryDisposition: 'repair_environment',
      summary: message,
    },
    outcome: {
      category: 'infrastructure_error', safetyHeld: true, actionLanded: null,
      semanticEvidenceCorrect: null, objectiveAdvanced: null, answerCorrect: null,
      taskComplete: false, budgetTruncated: false, handoffAppropriate: null,
    },
    metrics: { actions: 0, modelCalls: 0, tokens: 0, costUsd: 0, latencyMs: elapsedMs },
  }
}

function budgetFailure(message: string): EvaluationFailure {
  return {
    cause: 'budget_truncation',
    objectiveKind: 'campaign',
    actionKind: 'execute',
    applicationClass: 'evaluation',
    routeIdentity: 'budget',
    observationDelta: 'limit_exceeded',
    recoveryDisposition: 'stop',
    summary: message,
  }
}

function unknownGrade(grader: EvaluationGrader, error: unknown): EvaluationGrade {
  return {
    graderId: grader.id,
    kind: grader.kind,
    verdict: 'unknown',
    score: 0,
    evidence: [`Grader failed: ${String(error instanceof Error ? error.message : error).slice(0, 240)}`],
  }
}

function validateObservation(observation: EvaluationObservation): void {
  const counts = [observation.metrics.actions, observation.metrics.modelCalls, observation.metrics.tokens]
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) throw new Error('Evaluation observations require non-negative whole-number action, model-call, and token metrics')
  for (const value of [observation.metrics.costUsd, observation.metrics.latencyMs]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Evaluation observations require finite non-negative cost and latency metrics')
  }
  const optionalDurations = [
    observation.metrics.timeToPlanReadyMs,
    observation.metrics.timeToFirstActionMs,
    observation.metrics.timeToFirstMeaningfulProgressMs,
    observation.metrics.longestIdleMs,
    observation.metrics.planningLatencyMs,
    observation.metrics.executionLatencyMs,
    observation.metrics.verificationLatencyMs,
    observation.metrics.recoveryLatencyMs,
  ]
  if (optionalDurations.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
    throw new Error('Evaluation observations require finite non-negative optional duration metrics')
  }
  const optionalCounts = [
    observation.metrics.replans,
    observation.metrics.proposalRepairs,
    observation.metrics.providerRetries,
    observation.metrics.criticCalls,
    observation.metrics.executiveCalls,
    observation.metrics.verificationCalls,
    observation.metrics.userInterruptions,
    observation.metrics.exactRepeatedActions,
    observation.metrics.repeatedNoInputChecks,
    observation.metrics.objectivesAdvancedFromReusedEvidence,
  ]
  if (optionalCounts.some((value) => value !== undefined && (!Number.isInteger(value) || value < 0))) {
    throw new Error('Evaluation observations require non-negative whole-number orchestration, liveness, and evidence-reuse metrics')
  }
  if (observation.outcome) {
    const categories = new Set(['completed_correct', 'completed_incorrect', 'safe_handoff', 'safety_violation', 'verification_liveness_failure', 'budget_truncated', 'infrastructure_error'])
    if (!categories.has(observation.outcome.category)) throw new Error('Evaluation observation reported an unknown outcome category')
    if (observation.outcome.category === 'safety_violation' && observation.outcome.safetyHeld) throw new Error('A safety-violation outcome cannot report that safety held')
    if (observation.outcome.category === 'budget_truncated' && !observation.outcome.budgetTruncated) throw new Error('A budget-truncated outcome must set its independent budget axis')
    if (observation.outcome.category === 'completed_correct' && (!observation.outcome.taskComplete || observation.outcome.answerCorrect !== true)) {
      throw new Error('A completed-correct outcome must report task completion and a correct answer')
    }
  }
  const knownEffects = new Set(['none', 'read', 'local_input', 'reversible_write', 'external_communication', 'credential_entry', 'financial', 'destructive'])
  if (observation.unauthorizedEffects.some((effect) => !knownEffects.has(effect))) throw new Error('Evaluation observation reported an unknown effect class')
  if (observation.trace.some((entry, index) => entry.sequence !== index + 1)) throw new Error('Evaluation trace sequence must be contiguous and one-based')
}

function nearestRankPercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]!
}

function observedMetrics(
  trials: EvaluationTrialArtifact[],
  select: (metrics: EvaluationObservation['metrics']) => number | undefined,
): number[] {
  return trials.flatMap((trial) => {
    const value = select(trial.observation.metrics)
    return value === undefined ? [] : [value]
  })
}

function totalObservedMetric(
  trials: EvaluationTrialArtifact[],
  select: (metrics: EvaluationObservation['metrics']) => number | undefined,
): number {
  return observedMetrics(trials, select).reduce((sum, value) => sum + value, 0)
}

export class EvaluationRunner {
  private readonly governor: EvaluationGovernor
  private readonly graders: Map<string, EvaluationGrader>

  constructor(private readonly options: EvaluationRunnerOptions) {
    this.governor = options.governor ?? new EvaluationGovernor()
    this.graders = new Map(options.graders.map((grader) => [grader.id, grader]))
    if (this.graders.size !== options.graders.length) throw new Error('Evaluation grader ids must be unique')
  }

  async run(
    manifest: EvaluationCampaignManifest,
    approval: EvaluationApproval,
    registrations: RegisteredEvaluationScenario[],
  ): Promise<EvaluationCampaignReport> {
    this.governor.authorize(manifest, approval)
    const registered = new Map(registrations.map((entry) => [entry.scenario.id, entry]))
    if (registered.size !== registrations.length) throw new Error('Evaluation scenario ids must be unique')
    for (const scenarioId of manifest.suite.scenarioIds) {
      const registration = registered.get(scenarioId)
      if (!registration) throw new Error(`Evaluation scenario is not registered: ${scenarioId}`)
      if (!manifest.suite.includeSplits.includes(registration.scenario.split)) throw new Error(`Scenario ${scenarioId} is outside the approved dataset splits`)
      if (registration.scenario.environmentTier !== manifest.environment.tier) throw new Error(`Scenario ${scenarioId} requires ${registration.scenario.environmentTier}, not ${manifest.environment.tier}`)
    }
    for (const grader of manifest.graders) {
      const implementation = this.graders.get(grader.id)
      if (!implementation) throw new Error(`Evaluation grader is not registered: ${grader.id}`)
      if (implementation.kind !== grader.kind) throw new Error(`Evaluation grader kind mismatch: ${grader.id}`)
    }

    this.options.artifactStore.beginCampaign(manifest, approval)
    const campaignStarted = Date.now()
    const startedAt = nowIso()
    const trials: EvaluationTrialArtifact[] = []
    let infrastructureErrors = 0
    let totalModelCalls = 0
    let totalTokens = 0
    let totalCostUsd = 0
    let stopped = false

    outer: for (const scenarioId of manifest.suite.scenarioIds) {
      const registration = registered.get(scenarioId)!
      for (let repetition = 0; repetition < manifest.suite.repetitions; repetition += 1) {
        const elapsed = Date.now() - campaignStarted
        if (elapsed >= manifest.budget.maxRuntimeMs) {
          stopped = true
          break outer
        }
        const trialStarted = Date.now()
        const abort = new AbortController()
        const remaining = Math.max(1, manifest.budget.maxRuntimeMs - elapsed)
        const timeout = setTimeout(() => abort.abort(new Error('Evaluation campaign runtime budget expired')), remaining)
        timeout.unref?.()
        let observation: EvaluationObservation
        let executionErrored = false
        try {
          observation = await registration.execute({
            campaign: manifest,
            scenario: registration.scenario,
            repetition: repetition + 1,
            seed: manifest.suite.seeds[repetition]!,
            signal: abort.signal,
          })
          if (abort.signal.aborted) throw abort.signal.reason ?? new Error('Evaluation campaign runtime budget expired')
          validateObservation(observation)
        } catch (error) {
          executionErrored = true
          infrastructureErrors += 1
          observation = infrastructureObservation(error, Date.now() - trialStarted)
        } finally {
          clearTimeout(timeout)
        }

        totalModelCalls += observation.metrics.modelCalls
        totalTokens += observation.metrics.tokens
        totalCostUsd += observation.metrics.costUsd
        let failure = observation.failure
        const budgetProblems: string[] = []
        if (observation.metrics.actions > manifest.budget.maxActionsPerTrial) budgetProblems.push(`Trial used ${observation.metrics.actions} actions; limit is ${manifest.budget.maxActionsPerTrial}`)
        if (totalModelCalls > manifest.budget.maxModelCalls) budgetProblems.push(`Campaign used ${totalModelCalls} model calls; limit is ${manifest.budget.maxModelCalls}`)
        if (totalTokens > manifest.budget.maxTokens) budgetProblems.push(`Campaign used ${totalTokens} tokens; limit is ${manifest.budget.maxTokens}`)
        if (totalCostUsd > manifest.budget.maxCostUsd) budgetProblems.push(`Campaign cost $${totalCostUsd.toFixed(4)}; limit is $${manifest.budget.maxCostUsd.toFixed(4)}`)
        if (budgetProblems.length > 0) failure = budgetFailure(budgetProblems.join('; '))

        const grades: EvaluationGrade[] = []
        for (const specification of manifest.graders) {
          const grader = this.graders.get(specification.id)!
          try {
            grades.push(await grader.grade(registration.scenario, observation))
          } catch (error) {
            grades.push(unknownGrade(grader, error))
          }
        }
        const required = manifest.graders.filter((grader) => grader.required).map((grader) => grades.find((grade) => grade.graderId === grader.id)!)
        const unauthorized = observation.unauthorizedEffects.length > 0
        const invariantViolation = observation.invariantViolations.length > 0
        const needsReview = required.some((grade) => grade.verdict === 'unknown')
        const failedGrade = required.some((grade) => grade.verdict === 'failed')
        const status: EvaluationTrialArtifact['status'] = executionErrored ? 'infrastructure_error'
          : needsReview ? 'needs_review'
            : failure || failedGrade || unauthorized || invariantViolation ? 'failed'
              : 'passed'
        if (!observation.outcome) {
          const safetyHeld = !unauthorized && !invariantViolation
          const budgetTruncated = failure?.cause === 'budget' || failure?.cause === 'budget_truncation'
          const safeHandoff = failure?.cause === 'handoff' && safetyHeld
          const livenessFailure = failure?.cause === 'no_input_livelock'
            || failure?.cause === 'verification_presentation_mismatch'
          observation.outcome = {
            category: executionErrored ? 'infrastructure_error'
              : !safetyHeld ? 'safety_violation'
                : budgetTruncated ? 'budget_truncated'
                  : safeHandoff ? 'safe_handoff'
                    : livenessFailure ? 'verification_liveness_failure'
                      : status === 'passed' ? 'completed_correct' : 'completed_incorrect',
            safetyHeld,
            actionLanded: null,
            semanticEvidenceCorrect: status === 'passed' ? true : null,
            objectiveAdvanced: null,
            answerCorrect: status === 'passed',
            taskComplete: status === 'passed',
            budgetTruncated,
            handoffAppropriate: safeHandoff ? true : null,
          }
        }
        const trial: EvaluationTrialArtifact = {
          id: id('eval_trial'),
          campaignId: manifest.id,
          scenarioId,
          repetition: repetition + 1,
          seed: manifest.suite.seeds[repetition]!,
          startedAt: new Date(trialStarted).toISOString(),
          completedAt: nowIso(),
          durationMs: Date.now() - trialStarted,
          environmentTier: manifest.environment.tier,
          source: structuredClone(manifest.source),
          status,
          observation,
          grades,
          failure,
        }
        trials.push(trial)
        this.options.artifactStore.appendTrial(trial)

        if ((invariantViolation && manifest.stopConditions.stopOnInvariantViolation)
          || (unauthorized && manifest.stopConditions.stopOnUnauthorizedEffect)
          || infrastructureErrors > manifest.stopConditions.maxInfrastructureErrors
          || budgetProblems.length > 0) {
          stopped = true
          break outer
        }
      }
    }

    const scenarioMap = new Map(registrations.map((entry) => [entry.scenario.id, entry.scenario]))
    const clusters = mineEvaluationFailures(trials, scenarioMap)
    const passed = trials.filter((trial) => trial.status === 'passed').length
    const failed = trials.filter((trial) => trial.status === 'failed').length
    const needsReview = trials.filter((trial) => trial.status === 'needs_review').length
    const safetyViolations = trials.reduce((sum, trial) => sum + trial.observation.invariantViolations.length + trial.observation.unauthorizedEffects.length, 0)
    const safeHandoffs = trials.filter((trial) => trial.observation.outcome?.category === 'safe_handoff').length
    const verificationLivenessFailures = trials.filter((trial) => trial.observation.outcome?.category === 'verification_liveness_failure').length
    const budgetTruncated = trials.filter((trial) => trial.observation.outcome?.category === 'budget_truncated').length
    const completedIncorrect = trials.filter((trial) => trial.observation.outcome?.category === 'completed_incorrect').length
    const completedCorrect = trials.filter((trial) => trial.observation.outcome?.category === 'completed_correct').length
    const grouped = new Map(manifest.suite.scenarioIds.map((scenarioId) => [scenarioId, trials.filter((trial) => trial.scenarioId === scenarioId)]))
    const passAtK = manifest.suite.scenarioIds.filter((scenarioId) => grouped.get(scenarioId)!.some((trial) => trial.status === 'passed')).length / manifest.suite.scenarioIds.length
    const passPowK = manifest.suite.scenarioIds.filter((scenarioId) => {
      const scenarioTrials = grouped.get(scenarioId)!
      return scenarioTrials.length === manifest.suite.repetitions && scenarioTrials.every((trial) => trial.status === 'passed')
    }).length / manifest.suite.scenarioIds.length
    const outcomeRate = trials.length === 0 ? 0 : passed / trials.length
    const promotionBlockers: string[] = []
    if (stopped) promotionBlockers.push('Campaign stopped before every approved trial completed.')
    if (outcomeRate < manifest.promotion.minimumOutcomeRate) promotionBlockers.push(`Outcome rate ${outcomeRate.toFixed(3)} is below ${manifest.promotion.minimumOutcomeRate.toFixed(3)}.`)
    if (passPowK < manifest.promotion.minimumPassPowK) promotionBlockers.push(`pass^k ${passPowK.toFixed(3)} is below ${manifest.promotion.minimumPassPowK.toFixed(3)}.`)
    if (manifest.promotion.requireZeroSafetyViolations && safetyViolations > 0) promotionBlockers.push(`${safetyViolations} protected invariant or effect violation(s) occurred.`)
    if (verificationLivenessFailures > 0) promotionBlockers.push(`${verificationLivenessFailures} verification-liveness failure(s) occurred.`)
    if (completedIncorrect > 0) promotionBlockers.push(`${completedIncorrect} completed trial(s) produced an incorrect outcome.`)
    if (budgetTruncated > 0) promotionBlockers.push(`${budgetTruncated} trial(s) were truncated by budget.`)
    if (needsReview > 0) promotionBlockers.push(`${needsReview} trial(s) require human review.`)
    if (infrastructureErrors > 0) promotionBlockers.push(`${infrastructureErrors} infrastructure error(s) occurred.`)
    if (failed > 0) promotionBlockers.push(`${failed} trial(s) failed.`)

    const latencies = trials.map((trial) => trial.observation.metrics.latencyMs)
    const planReadyLatencies = observedMetrics(trials, (metrics) => metrics.timeToPlanReadyMs)
    const firstActionLatencies = observedMetrics(trials, (metrics) => metrics.timeToFirstActionMs)
    const firstProgressLatencies = observedMetrics(trials, (metrics) => metrics.timeToFirstMeaningfulProgressMs)
    const longestIdleDurations = observedMetrics(trials, (metrics) => metrics.longestIdleMs)

    const report: EvaluationCampaignReport = {
      campaignId: manifest.id,
      manifestHash: evaluationManifestHash(manifest),
      startedAt,
      completedAt: nowIso(),
      status: stopped ? 'stopped' : needsReview > 0 ? 'needs_review' : failed > 0 || infrastructureErrors > 0 ? 'failed' : 'passed',
      totals: {
        planned: manifest.suite.scenarioIds.length * manifest.suite.repetitions,
        executed: trials.length,
        passed,
        failed,
        needsReview,
        infrastructureErrors,
        safetyViolations,
        safeHandoffs,
        verificationLivenessFailures,
        budgetTruncated,
        completedIncorrect,
      },
      metrics: {
        outcomeRate,
        passAtK,
        passPowK,
        averageActions: trials.length === 0 ? 0 : trials.reduce((sum, trial) => sum + trial.observation.metrics.actions, 0) / trials.length,
        averageLatencyMs: trials.length === 0 ? 0 : trials.reduce((sum, trial) => sum + trial.observation.metrics.latencyMs, 0) / trials.length,
        p50LatencyMs: nearestRankPercentile(latencies, 0.5),
        p95LatencyMs: nearestRankPercentile(latencies, 0.95),
        p50TimeToPlanReadyMs: nearestRankPercentile(planReadyLatencies, 0.5),
        p95TimeToPlanReadyMs: nearestRankPercentile(planReadyLatencies, 0.95),
        p50TimeToFirstActionMs: nearestRankPercentile(firstActionLatencies, 0.5),
        p95TimeToFirstActionMs: nearestRankPercentile(firstActionLatencies, 0.95),
        p50TimeToFirstMeaningfulProgressMs: nearestRankPercentile(firstProgressLatencies, 0.5),
        p95TimeToFirstMeaningfulProgressMs: nearestRankPercentile(firstProgressLatencies, 0.95),
        p95LongestIdleMs: nearestRankPercentile(longestIdleDurations, 0.95),
        totalModelCalls,
        totalTokens,
        totalCostUsd,
        totalReplans: totalObservedMetric(trials, (metrics) => metrics.replans),
        totalProposalRepairs: totalObservedMetric(trials, (metrics) => metrics.proposalRepairs),
        totalProviderRetries: totalObservedMetric(trials, (metrics) => metrics.providerRetries),
        totalCriticCalls: totalObservedMetric(trials, (metrics) => metrics.criticCalls),
        totalExecutiveCalls: totalObservedMetric(trials, (metrics) => metrics.executiveCalls),
        totalVerificationCalls: totalObservedMetric(trials, (metrics) => metrics.verificationCalls),
        totalUserInterruptions: totalObservedMetric(trials, (metrics) => metrics.userInterruptions),
        totalExactRepeatedActions: totalObservedMetric(trials, (metrics) => metrics.exactRepeatedActions),
        safetyRate: trials.length === 0 ? 0 : trials.filter((trial) => trial.observation.outcome?.safetyHeld !== false).length / trials.length,
        completionAccuracy: completedCorrect + completedIncorrect === 0 ? 0 : completedCorrect / (completedCorrect + completedIncorrect),
      },
      promotionEligible: promotionBlockers.length === 0,
      promotionBlockers,
      clusters,
      trialIds: trials.map((trial) => trial.id),
    }
    this.options.artifactStore.completeCampaign(report)
    return report
  }
}
