import { operationReplayKey } from './live-computer-assessment.js'
import type { LiveComputerContinuationCheckpoint, LiveComputerSession } from './types.js'

/** Persist before crossing the native boundary. A crash after this checkpoint
 * may have happened before or after mutation; delivery must be reconciled. */
export function liveComputerContinuationCheckpoint(session: LiveComputerSession, beforeDelivery = false): LiveComputerContinuationCheckpoint {
  const pending = session.pendingInputTransaction ? structuredClone(session.pendingInputTransaction) : null
  if (pending && beforeDelivery) { pending.deliveryState = 'unknown'; pending.contentDelivery = 'unknown' }
  const action = session.pendingAction
  return {
    version: 2, sessionId: session.id, recordedAt: new Date().toISOString(), status: session.status,
    authority: 'historical_evidence_only', ledger: structuredClone(session.ledger), pendingInput: pending,
    pendingOperation: action?.id && action.objectiveId && action.kind && action.expectedState ? { actionId: action.id, objectiveId: action.objectiveId, kind: action.kind,
      expectedState: action.expectedState, targetLabel: action.targetLabel ?? null, effect: 'unknown', replayKey: operationReplayKey(action, session.target.windowId) } : null,
    pendingArtifact: action?.artifactId ? { artifactId: action.artifactId, unit: action.artifactUnit ?? null, layout: action.artifactLayout ?? null, ...(action.artifactDestination ? { destination: structuredClone(action.artifactDestination) } : {}) } : null,
    resource: { application: session.target.application, bundleIdentifier: session.target.bundleIdentifier, title: session.target.title, windowId: session.target.windowId },
  }
}
