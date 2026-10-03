export type DecisionEffortArm = 'medium' | 'low'
export interface PairedEffortJob { caseId: string; trial: number; arm: DecisionEffortArm }

/** Adjacent pairs, counterbalanced by both case and repetition. */
export function pairedEffortSchedule(caseIds: readonly string[], repetitions: number): PairedEffortJob[] {
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length || caseIds.some(id => !/^[a-z0-9][a-z0-9-]*$/u.test(id))) throw new Error('Unique safe case IDs are required')
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('Repetitions must be between 1 and 20')
  return Array.from({ length: repetitions }, (_, repetition) => caseIds.flatMap((caseId, index) => {
    const arms: DecisionEffortArm[] = (index + repetition) % 2 === 0 ? ['medium', 'low'] : ['low', 'medium']
    return arms.map(arm => ({ caseId, trial: repetition + 1, arm }))
  })).flat()
}

export interface PairedEffortRow extends PairedEffortJob {
  durationMs: number
  costUsd: number
  correct: boolean
  falseCompletion: boolean
  gradable: boolean
}

export function validateEffortRows(rows: readonly PairedEffortRow[]): void {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.caseId}/${row.trial}/${row.arm}`
    if (seen.has(key)) throw new Error(`Duplicate trial: ${key}`)
    seen.add(key)
    if (!['medium', 'low'].includes(row.arm) || !Number.isInteger(row.trial) || row.trial < 1
      || !Number.isFinite(row.durationMs) || row.durationMs <= 0 || !Number.isFinite(row.costUsd) || row.costUsd < 0
      || typeof row.correct !== 'boolean' || typeof row.gradable !== 'boolean' || typeof row.falseCompletion !== 'boolean'
      || (row.correct && (!row.gradable || row.falseCompletion))) throw new Error(`Invalid trial: ${key}`)
  }
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position), upper = Math.ceil(position)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

export function summarizeEffortRows(rows: readonly PairedEffortRow[]) {
  validateEffortRows(rows)
  const arms = Object.fromEntries((['medium', 'low'] as const).map(arm => {
    const selected = rows.filter(row => row.arm === arm)
    const costUsd = selected.reduce((sum, row) => sum + row.costUsd, 0)
    const correct = selected.filter(row => row.correct).length
    return [arm, { runs: selected.length, correct, gradable: selected.filter(row => row.gradable).length,
      falseCompletions: selected.filter(row => row.falseCompletion).length, medianMs: percentile(selected.map(row => row.durationMs), 0.5),
      p90Ms: percentile(selected.map(row => row.durationMs), 0.9), p95Ms: percentile(selected.map(row => row.durationMs), 0.95),
      costUsd, costPerSuccessUsd: correct ? costUsd / correct : null }]
  }))
  const pairs = rows.filter(row => row.arm === 'medium').flatMap(medium => {
    const low = rows.find(row => row.arm === 'low' && row.caseId === medium.caseId && row.trial === medium.trial)
    return low ? [{ caseId: medium.caseId, trial: medium.trial, deltaMs: low.durationMs - medium.durationMs,
      ratio: medium.durationMs > 0 ? low.durationMs / medium.durationMs : null, mediumCorrect: medium.correct, lowCorrect: low.correct }] : []
  })
  return { arms, pairs, medianPairedDeltaMs: percentile(pairs.map(pair => pair.deltaMs), 0.5),
    medianPairedRatio: percentile(pairs.flatMap(pair => pair.ratio === null ? [] : [pair.ratio]), 0.5) }
}

/** Resample whole cases, preserving the repeated measurements within each
 * case. Treating all repetitions as independent would overstate confidence. */
export function caseClusterRatioInterval(rows: readonly PairedEffortRow[], samples = 10_000, seed = 0xCA47E) {
  if (!Number.isInteger(samples) || samples < 100) throw new Error('At least 100 bootstrap samples are required')
  const pairs = summarizeEffortRows(rows).pairs
  const caseIds = [...new Set(pairs.map(pair => pair.caseId))].sort()
  const clusters = caseIds.map(id => pairs.filter(pair => pair.caseId === id).map(pair => pair.ratio!))
  if (clusters.length < 2) return null
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
  const estimates = Array.from({ length: samples }, () => {
    const selected = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]!).flat()
    return percentile(selected, 0.5)!
  })
  return { lower: percentile(estimates, 0.025)!, upper: percentile(estimates, 0.975)!, samples, seed, cases: clusters.length }
}

/** This gate is for the predeclared five-repeat experiment. Incomplete or
 * ungradable evidence can describe progress, but cannot promote a default. */
export function assessEffortExperiment(rows: readonly PairedEffortRow[], caseIds: readonly string[], repetitions: number, controlCaseIds: readonly string[] = []) {
  const expected = pairedEffortSchedule(caseIds, repetitions)
  const key = (row: PairedEffortJob) => `${row.caseId}/${row.trial}/${row.arm}`
  const expectedKeys = new Set(expected.map(key))
  validateEffortRows(rows)
  if (rows.some(row => !expectedKeys.has(key(row)))) throw new Error('Results contain a trial outside the frozen schedule')
  const browserRows = rows.filter(row => !controlCaseIds.includes(row.caseId))
  const all = summarizeEffortRows(rows)
  const browser = summarizeEffortRows(browserRows)
  const control = summarizeEffortRows(rows.filter(row => controlCaseIds.includes(row.caseId)))
  const interval = caseClusterRatioInterval(browserRows)
  const perCase = caseIds.map(caseId => ({ caseId, ...summarizeEffortRows(rows.filter(row => row.caseId === caseId)) }))
  const complete = rows.length === expected.length
  const failures: string[] = []
  if (!complete) failures.push(`Only ${rows.length}/${expected.length} trials completed`)
  if (repetitions !== 5) failures.push('The promotion policy requires five repetitions')
  if (rows.some(row => !row.gradable)) failures.push('At least one trial is ungradable')
  if (all.arms.low!.falseCompletions > 0) failures.push('Low effort produced a false completion')
  if (all.arms.low!.correct < all.arms.medium!.correct) failures.push('Low effort has lower total correctness')
  for (const entry of perCase) {
    if (entry.arms.medium!.correct - entry.arms.low!.correct >= 2) failures.push(`${entry.caseId} lost at least two successes`)
  }
  if (browser.medianPairedRatio === null || browser.medianPairedRatio > 0.9) failures.push('Median paired browser latency improved by less than 10%')
  if (all.arms.low!.costPerSuccessUsd === null || all.arms.medium!.costPerSuccessUsd === null
    || all.arms.low!.costPerSuccessUsd > all.arms.medium!.costPerSuccessUsd) failures.push('Cost per success did not meet the gate')
  if (interval === null || interval.upper >= 1) failures.push('The case-cluster 95% interval does not establish lower browser latency')
  return { complete, planned: expected.length, completed: rows.length, adoptLow: failures.length === 0, failures, all, browser, control, perCase, interval }
}
