import type { UniversalComputerSession } from '../types.js'

/** A task deadline is an observed failure to finish, not a broken fixture.
 * Return a session so the harness can still read saved state and screenshots.
 * Never turn unfinished work into a success or erase earlier input counts. */
export function canaryDeadlineSession(session: UniversalComputerSession, deadlineMs: number): UniversalComputerSession {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error('Invalid task deadline')
  const reason = `Carve did not finish within the ${deadlineMs / 1000}-second evaluation deadline. Earlier steps may already have changed the window.`
  return { ...structuredClone(session), status: 'blocked', reportedOutcome: 'partial', completionVerified: false,
    terminalText: reason, reason, terminalSourceStatus: 'time_limit', terminalKind: 'execution_limit',
    canResume: false, remainingClauses: [session.goal] }
}
