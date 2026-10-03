import { artifactDataDigest } from './task-requirements.js'
import type { LiveComputerAction, LiveComputerElement, LiveComputerOperationEffect, LiveComputerTransition, LiveComputerSession } from './types.js'

type Identity = NonNullable<LiveComputerAction['targetIdentity']>

export function elementIdentityForInput(element: LiveComputerElement): Identity {
  return { role: element.role, name: element.name, identifier: element.identifier, bounds: element.bounds ? { ...element.bounds } : null,
    ...(element.fingerprint ? { fingerprint: element.fingerprint } : {}) }
}

/** The identity an accessibility-delivered action carries: the ordinary
 * input identity plus the capture path, so the bridge resolves this exact
 * element by its child path and fingerprint chain instead of a point. Only a
 * window-rooted path with a full fingerprint qualifies; otherwise null. */
export function elementIdentityForAxDelivery(element: LiveComputerElement): Identity | null {
  if (!element.axPath || element.axRoot !== 'window' || !element.fingerprint || element.fingerprint.length !== 64) return null
  return { ...elementIdentityForInput(element), axPath: [...element.axPath], axRoot: 'window' }
}

function overlaps(left: Identity['bounds'], right: Identity['bounds']): boolean {
  return Boolean(left && right && left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height)
}

function overlapArea(left: Identity['bounds'], right: Identity['bounds']): number {
  if (!left || !right) return 0
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  return width > 0 && height > 0 ? width * height : 0
}

export interface InputTargetResolution {
  element: LiveComputerElement | null
  /** How many candidates shared the identity before narrowing. */
  candidateCount: number
  /** Which narrowing step decided, for the audit trail. */
  narrowedBy: 'identifier' | 'fingerprint' | 'unique' | 'visible' | 'overlap' | 'none'
  candidates: Array<{ id: string; bounds: Identity['bounds']; obstructed: boolean; visible: boolean }>
}

/**
 * Rebind an intended control to the current observation. Identity is
 * stable identifier, then fingerprint, then role and name. Duplicates are
 * narrowed the way a locator library narrows them: drop hidden and covered
 * candidates and prefer overlap with the proposed bounds. Indistinguishable
 * candidates remain ambiguous. Never fall back
 * to a recycled id or an unrelated control at the old point.
 */
export function resolveInputTarget(expected: Identity, elements: LiveComputerElement[]): InputTargetResolution {
  const eligible = elements.filter(element => !element.sensitive && element.enabled !== false && element.role === expected.role)
  const summarize = (list: LiveComputerElement[]) => list.map(element => ({ id: element.id, bounds: element.bounds ? { ...element.bounds } : null, obstructed: element.obstructed === true, visible: Boolean(element.bounds) }))
  const stable = expected.identifier ? eligible.filter(element => element.identifier === expected.identifier) : []
  if (stable.length === 1) return { element: stable[0]!, candidateCount: 1, narrowedBy: 'identifier', candidates: summarize(stable) }
  const printed = expected.fingerprint ? eligible.filter(element => element.fingerprint === expected.fingerprint) : []
  if (printed.length === 1) return { element: printed[0]!, candidateCount: 1, narrowedBy: 'fingerprint', candidates: summarize(printed) }
  const named = (stable.length ? stable : printed.length ? printed : eligible).filter(element => element.name === expected.name
    && Boolean(expected.name || expected.identifier)
    && (!expected.identifier || !element.identifier || element.identifier === expected.identifier))
  if (named.length === 0) return { element: null, candidateCount: 0, narrowedBy: 'none', candidates: [] }
  if (named.length === 1) return { element: named[0]!, candidateCount: 1, narrowedBy: 'unique', candidates: summarize(named) }
  const visible = named.filter(element => element.bounds && element.bounds.width > 0 && element.bounds.height > 0 && element.obstructed !== true)
  if (visible.length === 1) return { element: visible[0]!, candidateCount: named.length, narrowedBy: 'visible', candidates: summarize(named) }
  const pool = visible.length ? visible : named
  const overlapping = pool.filter(element => overlaps(element.bounds, expected.bounds))
  if (overlapping.length === 1) return { element: overlapping[0]!, candidateCount: named.length, narrowedBy: 'overlap', candidates: summarize(named) }
  if (overlapping.length > 1) {
    const best = [...overlapping].sort((left, right) => overlapArea(right.bounds, expected.bounds) - overlapArea(left.bounds, expected.bounds))
    const [first, second] = best
    if (first && second && overlapArea(first.bounds, expected.bounds) > overlapArea(second.bounds, expected.bounds)) {
      return { element: first, candidateCount: named.length, narrowedBy: 'overlap', candidates: summarize(named) }
    }
  }
  return { element: null, candidateCount: named.length, narrowedBy: 'none', candidates: summarize(named) }
}

/** Compatibility wrapper: the resolved element or null when ambiguous. */
export function resolveCurrentInputTarget(expected: Identity, elements: LiveComputerElement[]): LiveComputerElement | null {
  return resolveInputTarget(expected, elements).element
}

export function operationIdentity(action: Pick<LiveComputerAction, 'id' | 'artifactId' | 'artifactUnit' | 'artifactLayout' | 'artifactDestination'>, windowId: number | null): string {
  return action.artifactId ? `artifact:${action.artifactId}:window:${windowId}${action.artifactDestination ? `:data:${action.artifactDestination.dataDigest}:destination:${action.artifactDestination.fingerprint}` : ''}${action.artifactUnit == null ? '' : `:${action.artifactLayout ?? 'text'}:unit:${action.artifactUnit}`}` : action.id
}

export function initialOperationEffect(action: LiveComputerAction, windowId: number | null, observationId: string,
  contentDelivery: 'none' | 'partial' | 'complete' | 'unknown' | undefined): LiveComputerOperationEffect {
  return {
    operationId: operationIdentity(action, windowId), attemptId: action.id,
    state: contentDelivery === 'none' ? 'not_applied' : 'unknown',
    persistence: 'unknown', observationId, assessedBy: 'controller',
  }
}

/** Bulk replay needs affirmative no-effect evidence. Partial and unknown
 * results remain available to inference for observation and bounded repair. */
export function artifactReplayIssue(transitions: LiveComputerTransition[], artifactId: string | null | undefined, windowId: number | null, unit?: number | null, layout?: LiveComputerAction['artifactLayout']): string | null {
  const attempts = transitions.filter(t => t.kind === 'apply_artifact' && t.artifactId === artifactId
    && t.actionReceipt?.targetWindowId === windowId
    // Legacy whole-artifact attempts still block a blind portion replay.
    && (t.artifactLayout === 'table' || layout === 'table' || t.artifactUnit == null || unit == null || (t.artifactUnit === unit && t.artifactLayout === layout)))
  const latest = attempts.findLast(t => t.effect?.state !== 'not_applied' && !(t.effect == null && t.actionReceipt?.contentDelivery === 'none'))
  if (!latest) return null
  if (latest.effect?.state === 'not_applied') return null
  if (!latest.effect && latest.actionReceipt?.contentDelivery === 'none') return null
  const state = latest.effect?.state ?? (latest.status === 'verified' ? 'applied' : 'unknown')
  return state === 'applied'
    ? 'This work-product portion is already present. Verify it or repair only a missing requirement; do not insert it again.'
    : `The prior work-product effect is ${state}. Inspect the current destination and repair only missing content. A complete replay requires fresh evidence that none of the intended content is present.`
}

/** A repair is a single source cell, never a model-authored replacement table.
 * The independent frame-bound scope review must still prove that this exact
 * cell is empty in the original destination. This describes the question; it
 * does not grant permission or claim that the cell is missing. */
export function artifactCellRepairContext(session: LiveComputerSession, action: LiveComputerAction) {
  if (!session.ledger.outcomeContract?.requirements || action.kind !== 'apply_artifact'
    || action.artifactLayout !== 'grid' || !Number.isSafeInteger(action.artifactUnit)
    || action.replaceExisting) return null
  const artifact = session.ledger.artifacts.find(a => a.id === action.artifactId && a.kind === 'record_set' && a.coverage.complete)
  if (!artifact?.columns.length) return null
  const unit = action.artifactUnit!
  const cells = [artifact.columns, ...artifact.rows]
  const row = Math.floor(unit / artifact.columns.length), column = unit % artifact.columns.length
  const value = cells[row]?.[column]
  if (unit < 0 || value === undefined || value === '') return null // a verified blank needs no write
  const attempts = session.ledger.transitions.filter(t => t.kind === 'apply_artifact' && t.artifactId === artifact.id
    && t.actionReceipt?.targetWindowId === session.target.windowId
    && (t.artifactLayout === 'table' || t.artifactLayout === 'grid' && t.artifactUnit === unit))
  if (attempts.some(t => t.effect?.state === 'applied')) return null
  const prior = attempts.findLast(t => t.effect?.state === 'partial' || t.effect?.state === 'unknown')
  if (!prior?.artifactDestination || prior.artifactDestination.dataDigest !== artifactDataDigest(artifact)) return null
  return { artifactId: artifact.id, sourceDigest: prior.artifactDestination.dataDigest,
    destination: prior.artifactDestination, priorOperationId: prior.effect!.operationId,
    priorEffect: prior.effect!.state, row: row + 1, column: column + 1, value,
    headers: artifact.columns, sourceRow: cells[row], observationId: session.latestFrame?.id }
}
