import { sha256 } from '../util.js'
import type { EvaluationFailure, EvaluationFailureCluster, EvaluationScenario, EvaluationTrialArtifact } from './contracts.js'

const severityRank: Record<EvaluationScenario['severity'], number> = { low: 1, medium: 2, high: 4, critical: 8 }

function inferredFailure(trial: EvaluationTrialArtifact): EvaluationFailure | null {
  if (trial.failure) return trial.failure
  const grade = trial.grades.find((candidate) => candidate.verdict === 'failed' || candidate.verdict === 'unknown')
  if (!grade) return null
  return {
    cause: grade.verdict === 'unknown' ? 'grader' : 'outcome_verification',
    objectiveKind: 'scenario_outcome',
    actionKind: 'grade',
    applicationClass: 'evaluation',
    routeIdentity: grade.graderId,
    observationDelta: grade.verdict,
    recoveryDisposition: grade.verdict === 'unknown' ? 'human_review' : 'candidate_fix',
    summary: grade.evidence[0] ?? `${grade.graderId} ${grade.verdict}`,
  }
}

export function evaluationFailureSignature(failure: EvaluationFailure): string {
  return [failure.cause, failure.objectiveKind, failure.actionKind, failure.applicationClass, failure.routeIdentity, failure.observationDelta, failure.recoveryDisposition].join('|')
}

export function mineEvaluationFailures(trials: EvaluationTrialArtifact[], scenarios: Map<string, EvaluationScenario>): EvaluationFailureCluster[] {
  const grouped = new Map<string, Array<{ trial: EvaluationTrialArtifact; failure: EvaluationFailure }>>()
  for (const trial of trials) {
    if (trial.status === 'passed') continue
    const failure = inferredFailure(trial)
    if (!failure) continue
    const signature = evaluationFailureSignature(failure)
    const entries = grouped.get(signature) ?? []
    entries.push({ trial, failure })
    grouped.set(signature, entries)
  }

  return [...grouped.entries()].map(([signature, entries]) => {
    const severities = entries.map(({ trial }) => scenarios.get(trial.scenarioId)?.severity ?? 'medium')
    const severity = severities.sort((left, right) => severityRank[right] - severityRank[left])[0] ?? 'medium'
    const first = entries[0]!
    const scenarioIds = [...new Set(entries.map(({ trial }) => trial.scenarioId))]
    return {
      id: `cluster_${sha256(signature).slice(0, 16)}`,
      signature,
      cause: first.failure.cause,
      title: `${first.failure.cause.replaceAll('_', ' ')} · ${first.failure.actionKind}`,
      trialIds: entries.map(({ trial }) => trial.id),
      scenarioIds,
      count: entries.length,
      severity,
      priority: entries.length * severityRank[severity] * Math.max(1, scenarioIds.length),
      representativeSummary: first.failure.summary,
    }
  }).sort((left, right) => right.priority - left.priority || right.count - left.count || left.signature.localeCompare(right.signature))
}

