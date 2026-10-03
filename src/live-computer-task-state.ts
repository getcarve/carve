import { createHash } from 'node:crypto'
import type { LiveComputerTaskLedger, LiveComputerSessionTarget, LiveComputerTransition } from './types.js'

/** Persisted inside the existing session journal, independently of the short
 * prompt fact window. These records are evidence, never permission grants. */
export function createLiveComputerTaskState(originalRequest: string): NonNullable<LiveComputerTaskLedger['taskState']> {
  return { version: 1, originalRequest, planningNotes: [], evidence: [] }
}

export function recordLiveComputerSetup(ledger: LiveComputerTaskLedger, targets: LiveComputerSessionTarget[]): void {
  const state = ledger.taskState
  if (!state) return
  for (const entry of targets) {
    const id = `setup:${entry.target.windowId}`
    if (state.evidence.some(item => item.id === id)) continue
    state.evidence.push({ id, source: 'setup', windowId: entry.target.windowId, frameSha256: null, sequence: 0,
      text: `${entry.target.application}: ${entry.source === 'fresh' ? 'a fresh window was created' : 'an existing window was selected'}.${entry.initialUrl ? ` Requested launch: ${entry.initialUrl}. Verify the current destination from observation before relying on its identity.` : ''}` })
  }
}

export function recordLiveComputerEvidence(ledger: LiveComputerTaskLedger, transition: LiveComputerTransition, windowId: number, accepted: boolean): void {
  const state = ledger.taskState
  if (!state) return
  const id = `observation:${transition.sequence}`
  // A rejected model assertion is not remembered as evidence. Raw frame and
  // delivery metadata remain in transitions for diagnosis, not trusted facts.
  if (!accepted || !transition.observedState || state.evidence.some(item => item.id === id)) return
  state.evidence.push({ id, source: 'verified_observation', windowId, frameSha256: transition.frameSha256,
    sequence: transition.sequence, text: [transition.observedState, ...transition.evidence].join('\n').slice(0, 2_000) })
}

/** Bound prompt size without deleting the journal. Retrieve older evidence
 * relevant to the active task, then include recent observations. */
export function liveComputerEvidenceContext(ledger: LiveComputerTaskLedger) {
  const state = ledger.taskState
  if (!state) return undefined
  const active = ledger.objectives.find(o => o.id === ledger.currentObjectiveId)
  const terms = new Set((`${active?.instruction ?? ''} ${active?.targetState ?? ''}`).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  const recent = state.evidence.slice(-6)
  const recentIds = new Set(recent.map(e => e.id))
  const older = state.evidence.filter(e => !recentIds.has(e.id)).map(e => ({ e, score: [...terms].filter(t => e.text.toLowerCase().includes(t)).length }))
    .filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map(e => e.e)
  return { originalRequest: state.originalRequest, planningNotes: state.planningNotes.slice(-3), evidence: [...older, ...recent] }
}

/** Retain every accepted artifact in the ledger. Send a bounded selection of
 * bodies plus an index; older work remains addressable by its original id. */
export function liveComputerArtifactContext(ledger: LiveComputerTaskLedger) {
  if (!ledger.taskState || ledger.artifacts.length <= 8) return { artifacts: ledger.artifacts, artifactIndex: undefined }
  const active = ledger.objectives.find(o => o.id === ledger.currentObjectiveId)
  const terms = new Set((`${active?.instruction ?? ''} ${active?.targetState ?? ''}`).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  const recent = ledger.artifacts.slice(-6)
  const recentIds = new Set(recent.map(a => a.id))
  // Always include the last applied artifact so verification sees the exact
  // payload, even when its wording differs from the current milestone.
  const appliedId = ledger.transitions.at(-1)?.artifactId
  const older = ledger.artifacts.filter(a => !recentIds.has(a.id)).map(a => {
    const text = `${a.title} ${a.columns.join(' ')} ${a.content ?? ''} ${a.rows.flat().join(' ')}`.toLowerCase()
    return { a, score: (a.id === appliedId ? 100_000 : 0) + (a.coverage.complete ? 1_000 : 0)
      + [...terms].filter(term => text.includes(term)).length }
  }).sort((a, b) => b.score - a.score || b.a.verifiedAtSequence - a.a.verifiedAtSequence).slice(0, 2).map(a => a.a)
  const selectedIds = new Set([...older, ...recent].map(a => a.id))
  return {
    artifacts: ledger.artifacts.filter(a => selectedIds.has(a.id)),
    artifactIndex: ledger.artifacts.filter(a => !selectedIds.has(a.id)).map(a => ({
      id: a.id, kind: a.kind, title: a.title, sourceObjectiveId: a.sourceObjectiveId,
      verifiedAtSequence: a.verifiedAtSequence, itemCount: a.coverage.itemCount, complete: a.coverage.complete,
    })),
  }
}

/** Lossless request projection. Bodies stay immutable in the authoritative ledger.
 * A verifier reference is allowed only when its caller supplies that exact body
 * elsewhere in the same request. Acquisition and synthesis keep their bodies. */
export function liveComputerArtifactRequestContext(ledger: LiveComputerTaskLedger, options: {
  referenceCompletedWrites?: boolean
  bodiesProvidedInRequest?: readonly string[]
} = {}) {
  const context = liveComputerArtifactContext(ledger)
  const active = ledger.objectives.find(o => o.id === ledger.currentObjectiveId)
  return { ...context, artifacts: context.artifacts.map(artifact => {
    const provided = options.bodiesProvidedInRequest?.includes(artifact.id)
    if (!provided && !(options.referenceCompletedWrites && active?.kind === 'perform_commit' && artifact.coverage.complete)) return artifact
    const { rows, content, ...metadata } = artifact
    return { ...metadata, bodyRef: { artifactId: artifact.id,
      sha256: createHash('sha256').update(JSON.stringify({ columns: artifact.columns, rows, content })).digest('hex'),
      rowCount: rows.length, providedInThisRequest: Boolean(provided),
      access: provided ? 'Exact body supplied above; do not treat the reference as readback.' : 'Use apply_artifact with this ID; the executor retrieves the exact body. This reference does not prove delivery.',
    } }
  }) }
}
