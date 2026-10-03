import type { LiveComputerSession, WorkRun } from './types.js'

const terminalLiveComputerStatuses = new Set<LiveComputerSession['status']>(['handoff', 'completed', 'blocked', 'stopped'])

/** Renderer reloads must recover the durable Work contract that owns an
 * in-memory live-computer session. Live contracts intentionally remain in the
 * planned run state because every visual action has its own approval, so run
 * status alone is not enough to find resumable work. */
export function isLiveComputerSessionActive(session: LiveComputerSession | null): boolean {
  return Boolean(session && !terminalLiveComputerStatuses.has(session.status))
}

export function selectResumableWorkRun(runs: WorkRun[], liveSession: LiveComputerSession | null): WorkRun | null {
  if (isLiveComputerSessionActive(liveSession)) {
    const liveRun = runs.find((run) => run.id === liveSession?.runId)
    if (liveRun) return liveRun
  }
  return runs.find((run) => ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status)) ?? null
}

/** Home-page submission is a new-work gesture. It must never be visually
 * replaced by renderer restoration of an older active run; explicit Continue
 * remains the sole entry that opts into restoration. */
export function selectWorkRunForEntry(
  runs: WorkRun[],
  liveSession: LiveComputerSession | null,
  entry: 'fresh' | 'resume',
  focusedRunId?: string | null,
): WorkRun | null {
  if (entry === 'fresh') return null
  const focused = focusedRunId ? runs.find(run => run.id === focusedRunId) : null
  // A completed result must not pin the Work view after a capsule follow-up
  // starts a newer live contract. Use the same supersession rule as local
  // preparation, rather than giving each UI entry point its own priority.
  if (focused && !livePreparationSuperseded(focused, liveSession, runs)) return focused
  return selectResumableWorkRun(runs, liveSession)
}

/**
 * A follow-up asked from the desktop completion capsule starts a new live
 * contract behind the Work view's back. A view holding a locally prepared run
 * must release it when the active live session belongs to a newer contract,
 * or the person lands on the finished task with no way to review the new one.
 * Only a newer contract supersedes: a plan prepared while an older live
 * session still runs is kept.
 */
export function livePreparationSuperseded(preparedRun: WorkRun | null | undefined, session: LiveComputerSession | null, runs: WorkRun[]): boolean {
  if (!preparedRun || !isLiveComputerSessionActive(session) || session?.runId === preparedRun.id) return false
  const sessionRun = runs.find((run) => run.id === session?.runId)
  return Boolean(sessionRun && sessionRun.createdAt > preparedRun.createdAt)
}
