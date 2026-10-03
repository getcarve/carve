/** Qualification uses every attempt, including failures. A quick refusal must
 * never look like a speedup. This report does not change production routing. */
export interface PerformanceTrial {
  scenario: string
  arm: 'baseline' | 'candidate'
  completed: boolean
  correct: boolean
  durationMs: number
  costUsd: number | null
  modelCalls: number
  safetyViolations: number | null
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
const quantile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? null

export function comparePerformance(trials: PerformanceTrial[], minimumPerScenario = 20) {
  if (!Number.isSafeInteger(minimumPerScenario) || minimumPerScenario < 2) throw new Error('At least two trials per scenario and arm are required')
  for (const trial of trials) {
    if (!trial.scenario.trim() || !['baseline', 'candidate'].includes(trial.arm)
      || typeof trial.completed !== 'boolean' || typeof trial.correct !== 'boolean'
      || !Number.isFinite(trial.durationMs) || trial.durationMs <= 0
      || trial.costUsd !== null && (!Number.isFinite(trial.costUsd) || trial.costUsd < 0)
      || !Number.isSafeInteger(trial.modelCalls) || trial.modelCalls < 0
      || trial.safetyViolations !== null && (!Number.isSafeInteger(trial.safetyViolations) || trial.safetyViolations < 0)) throw new Error('Invalid performance trial')
  }
  const summarize = (rows: PerformanceTrial[]) => {
    const successes = rows.filter(row => row.completed && row.correct)
    const totalCost = rows.some(row => row.costUsd === null) ? null : rows.reduce((sum, row) => sum + row.costUsd!, 0)
    return { attempts: rows.length, successes: successes.length, successRate: rows.length ? successes.length / rows.length : null,
      medianMs: quantile(rows.map(row => row.durationMs), 0.5), p95Ms: quantile(rows.map(row => row.durationMs), 0.95),
      meanMs: rows.length ? mean(rows.map(row => row.durationMs)) : null,
      totalCostUsd: totalCost,
      costPerSuccessUsd: successes.length && totalCost !== null ? totalCost / successes.length : null,
      elapsedMsPerSuccess: successes.length ? rows.reduce((sum, row) => sum + row.durationMs, 0) / successes.length : null,
      modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0),
      safetyViolations: rows.some(row => row.safetyViolations === null) ? null : rows.reduce((sum, row) => sum + row.safetyViolations!, 0) }
  }
  const reasons: string[] = []
  const byScenario = [...new Set(trials.map(trial => trial.scenario))].sort().map(scenario => {
    const baseline = summarize(trials.filter(row => row.scenario === scenario && row.arm === 'baseline'))
    const candidate = summarize(trials.filter(row => row.scenario === scenario && row.arm === 'candidate'))
    if (!baseline.attempts || baseline.attempts !== candidate.attempts) reasons.push(`${scenario}: unmatched attempt counts`)
    if (Math.min(baseline.attempts, candidate.attempts) < minimumPerScenario) reasons.push(`${scenario}: insufficient repetitions`)
    if (candidate.successRate !== null && baseline.successRate !== null && candidate.successRate < baseline.successRate) reasons.push(`${scenario}: correctness regression`)
    if (baseline.successRate !== 1 || candidate.successRate !== 1) reasons.push(`${scenario}: incomplete or incorrect attempts require review`)
    if (baseline.totalCostUsd === null || candidate.totalCostUsd === null) reasons.push(`${scenario}: unknown cost`)
    if (baseline.safetyViolations === null || candidate.safetyViolations === null) reasons.push(`${scenario}: unknown safety evidence`)
    if (baseline.safetyViolations || candidate.safetyViolations) reasons.push(`${scenario}: safety violation`)
    if (candidate.meanMs !== null && baseline.meanMs !== null && candidate.meanMs > baseline.meanMs) reasons.push(`${scenario}: mean latency regression`)
    if (candidate.p95Ms !== null && baseline.p95Ms !== null && candidate.p95Ms > baseline.p95Ms) reasons.push(`${scenario}: tail latency regression`)
    if (candidate.costPerSuccessUsd !== null && baseline.costPerSuccessUsd !== null && candidate.costPerSuccessUsd > baseline.costPerSuccessUsd) reasons.push(`${scenario}: cost regression`)
    return { scenario, baseline, candidate }
  })
  const baseline = summarize(trials.filter(row => row.arm === 'baseline'))
  const candidate = summarize(trials.filter(row => row.arm === 'candidate'))
  if (!trials.length) reasons.push('No trials')
  if (baseline.meanMs !== null && candidate.meanMs !== null && candidate.meanMs >= baseline.meanMs) reasons.push('No measured mean latency improvement')
  if (baseline.costPerSuccessUsd !== null && candidate.costPerSuccessUsd !== null && candidate.costPerSuccessUsd >= baseline.costPerSuccessUsd) reasons.push('No measured cost improvement')
  return { version: 1, verdict: reasons.length ? 'not_qualified' : 'eligible_for_larger_validation',
    minimumPerScenario, reasons, baseline, candidate, byScenario,
    limitation: 'Empirical fixture comparison, not statistical proof or permission to deploy. Use fresh held-out tasks and randomized order before promotion.' }
}
