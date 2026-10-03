import { createHash } from 'node:crypto'
import type { SupervisionPolicyV2, WorkRun } from './types.js'

/**
 * Earned autonomy, per workflow.
 *
 * Carve never widens its own authority. What it can do is show, per
 * workflow, how many runs finished with verification and propose a lighter
 * supervision pace for the next run of that workflow. The person accepts or
 * declines; both decisions are audited and remembered. Nothing here changes a
 * running session.
 */

export type SupervisionPreset = SupervisionPolicyV2['preset']

export interface WorkflowAutonomy {
  key: string
  /** A representative goal for display; the newest run's wording. */
  label: string
  runs: number
  verifiedCompletions: number
  /** Runs that ended blocked or failed, counted over the whole history. */
  interrupted: number
  /** Whether the most recent runs were all verified completions. */
  recentStreak: number
  lastRunAt: string | null
  /** The pace the person has accepted for this workflow, if any. */
  acceptedPreset: SupervisionPreset | null
  /** The pace the person declined most recently, so it is not proposed again until the streak grows. */
  declinedPreset: SupervisionPreset | null
  proposal: { preset: SupervisionPreset; reason: string } | null
}

export interface AutonomyDecisions {
  accepted: Record<string, SupervisionPreset>
  declined: Record<string, { preset: SupervisionPreset; atStreak: number }>
}

const SMART_THRESHOLD = 3
const FAST_THRESHOLD = 8
const MAX_LABEL = 120

/** A stable identity for "the same job again": the goal with values, numbers, and links stripped. */
export function workflowKey(goal: string): string {
  const normalized = goal
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/gu, ' ')
    .replace(/["“”'‘’][^"“”'‘’]*["“”'‘’]/gu, ' ')
    .replace(/\d+([.,:/-]\d+)*/gu, ' ')
    .replace(/[^a-z\s]/gu, ' ')
    .split(/\s+/u)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .slice(0, 8)
    .join(' ')
  return createHash('sha256').update(normalized || goal.trim().toLowerCase()).digest('hex').slice(0, 16)
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'then', 'into', 'from', 'that', 'this', 'please', 'can', 'you', 'our', 'your', 'them', 'these', 'those', 'onto', 'about'])

function verified(run: WorkRun): boolean {
  return run.status === 'completed' && (run.outcome === undefined || run.outcome === null || run.outcome.status === 'completed')
}

function interrupted(run: WorkRun): boolean {
  return run.status === 'blocked' || run.status === 'failed' || run.outcome?.status === 'blocked' || run.outcome?.status === 'failed'
}

function terminal(run: WorkRun): boolean {
  return ['completed', 'blocked', 'cancelled', 'failed'].includes(run.status)
}

export function autonomyLedger(runs: WorkRun[], decisions: AutonomyDecisions): WorkflowAutonomy[] {
  const groups = new Map<string, WorkRun[]>()
  for (const run of runs) {
    if (!terminal(run)) continue
    if (run.plan.intent === 'context_only' || run.plan.intent === 'plan_only') continue
    const key = workflowKey(run.plan.goal)
    const group = groups.get(key) ?? []
    group.push(run)
    groups.set(key, group)
  }
  const ledger: WorkflowAutonomy[] = []
  for (const [key, group] of groups) {
    const ordered = [...group].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    let streak = 0
    for (const run of ordered) {
      if (verified(run)) streak += 1
      else break
    }
    const accepted = decisions.accepted[key] ?? null
    const declined = decisions.declined[key] ?? null
    const entry: WorkflowAutonomy = {
      key,
      label: (ordered[0]?.plan.goal ?? '').slice(0, MAX_LABEL),
      runs: ordered.length,
      verifiedCompletions: ordered.filter(verified).length,
      interrupted: ordered.filter(interrupted).length,
      recentStreak: streak,
      lastRunAt: ordered[0]?.updatedAt ?? null,
      acceptedPreset: accepted,
      declinedPreset: declined?.preset ?? null,
      proposal: null,
    }
    entry.proposal = proposalFor(entry, declined)
    ledger.push(entry)
  }
  return ledger.sort((left, right) => (right.lastRunAt ?? '').localeCompare(left.lastRunAt ?? ''))
}

function proposalFor(entry: WorkflowAutonomy, declined: { preset: SupervisionPreset; atStreak: number } | null): WorkflowAutonomy['proposal'] {
  const current = entry.acceptedPreset ?? 'step_by_step'
  let candidate: SupervisionPreset | null = null
  if (current === 'step_by_step' && entry.recentStreak >= SMART_THRESHOLD) candidate = 'smart_checkpoints'
  if (current === 'smart_checkpoints' && entry.recentStreak >= FAST_THRESHOLD) candidate = 'fast'
  if (!candidate) return null
  // A declined proposal waits for the streak to grow by the same threshold again.
  if (declined && declined.preset === candidate && entry.recentStreak < declined.atStreak + SMART_THRESHOLD) return null
  const reason = candidate === 'smart_checkpoints'
    ? `The last ${entry.recentStreak} runs of this workflow finished with every step verified and nothing refused. Carve can review the plan once and check in only at meaningful phases.`
    : `${entry.recentStreak} verified runs in a row on smart checkpoints. Carve can start from your request and stop only for consequential or unresolved effects.`
  return { preset: candidate, reason }
}

export interface SupervisionRecommendation {
  preset: SupervisionPreset
  earned: boolean
  workflowKey: string
  reason: string | null
  verifiedCompletions: number
}

/** The default pace for a new request: what the person accepted for this workflow, otherwise the ordinary default. */
export function recommendedSupervision(goal: string, ledger: WorkflowAutonomy[], fallback: SupervisionPreset = 'smart_checkpoints'): SupervisionRecommendation {
  const key = workflowKey(goal)
  const entry = ledger.find((candidate) => candidate.key === key)
  if (entry?.acceptedPreset) {
    return { preset: entry.acceptedPreset, earned: true, workflowKey: key, reason: `You accepted ${presetLabel(entry.acceptedPreset)} for this workflow after ${entry.verifiedCompletions} verified runs.`, verifiedCompletions: entry.verifiedCompletions }
  }
  return { preset: fallback, earned: false, workflowKey: key, reason: null, verifiedCompletions: entry?.verifiedCompletions ?? 0 }
}

export function presetLabel(preset: SupervisionPreset): string {
  return preset === 'fast' ? 'fast' : preset === 'smart_checkpoints' ? 'smart checkpoints' : 'step by step'
}

export function isSupervisionPreset(value: unknown): value is SupervisionPreset {
  return value === 'fast' || value === 'smart_checkpoints' || value === 'step_by_step'
}
