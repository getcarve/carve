import type { ActionEffect, ActionEffectClass, ActionSpec, SensitiveActionClass } from './types.js'
import { sha256, stableJson } from './util.js'

export const protectedEffectClasses = new Set<ActionEffectClass>([
  'communication',
  'submission',
  'financial',
  'destructive',
  'authentication',
  'installation',
  'privilege_escalation',
  'confidential_disclosure',
  'legal_acceptance',
  'high_impact_decision',
  'unclassified_control',
])

const sensitiveEffectClass: Record<SensitiveActionClass, ActionEffectClass> = {
  communication: 'communication',
  financial: 'financial',
  authentication: 'authentication',
  destructive: 'destructive',
  installation: 'installation',
  privilege_escalation: 'privilege_escalation',
  confidential_disclosure: 'confidential_disclosure',
  legal: 'legal_acceptance',
  high_impact_decision: 'high_impact_decision',
}

/**
 * Compile legacy action metadata into the version-2 effect envelope. New
 * capabilities may provide effects directly, but they are still normalized by
 * the controller before they become authority-bearing plan data.
 */
export function compileActionEffects(action: ActionSpec): ActionEffect[] {
  const declared = action.effects?.map(normalizeEffect)
  if (declared?.length) return declared

  const target = effectTarget(action)
  const payload = effectPayload(action)
  const effectClass = legacyEffectClass(action)
  const location = effectLocation(action, effectClass)
  return [{
    class: effectClass,
    location,
    reversibility: effectReversibility(action, effectClass),
    target,
    payloadDigest: payload === null ? null : sha256(stableJson(payload)),
    targetResolved: target !== null,
    payloadResolved: !effectNeedsPayload(effectClass) || payload !== null,
  }]
}

export function attachActionEffects<T extends ActionSpec>(action: T): T {
  return { ...action, effects: compileActionEffects(action) }
}

export function effectClasses(action: ActionSpec): ActionEffectClass[] {
  return [...new Set(compileActionEffects(action).map((effect) => effect.class))]
}

/** The floor that no pace can lower. Autopilot bypasses ordinary approvals
 * for resolved submissions and external writes, but never these effects.
 * Unknown effects must be resolved separately before any pace can act. */
/** Autopilot also passes resolved but unclassified ordinary controls: the
 * person granted that trust for the request, and every named control on a
 * page would otherwise interrupt it. Ordinary paces still check them. */
export const hardFloorEffectClasses = new Set<ActionEffectClass>([...protectedEffectClasses].filter((effect) => effect !== 'submission' && effect !== 'unclassified_control'))

export function hasHardFloorEffect(effects: readonly ActionEffect[]): boolean {
  return effects.some((effect) => hardFloorEffectClasses.has(effect.class))
}

export function hasProtectedEffect(effects: readonly ActionEffect[]): boolean {
  return effects.some((effect) => protectedEffectClasses.has(effect.class))
}

export function hasUnknownEffect(effects: readonly ActionEffect[]): boolean {
  return effects.some((effect) => effect.class === 'unknown'
    || !effect.targetResolved
    || (effectNeedsPayload(effect.class) && !effect.payloadResolved))
}

export function highestEffectBoundary(effects: readonly ActionEffect[]): 'automatic' | 'plan' | 'immediate' | 'resolve' {
  if (hasUnknownEffect(effects)) return 'resolve'
  if (hasProtectedEffect(effects)) return 'immediate'
  if (effects.some((effect) => effect.class === 'external_write')) return 'plan'
  return 'automatic'
}

function normalizeEffect(effect: ActionEffect): ActionEffect {
  const known = new Set<ActionEffectClass>([
    'read_only', 'safe_local', 'reversible_local_write', 'external_write', 'communication', 'submission',
    'financial', 'destructive', 'authentication', 'installation', 'privilege_escalation',
    'confidential_disclosure', 'legal_acceptance', 'high_impact_decision', 'unknown',
  ])
  const effectClass = known.has(effect.class) ? effect.class : 'unknown'
  return {
    class: effectClass,
    location: ['local', 'external', 'unknown'].includes(effect.location) ? effect.location : 'unknown',
    reversibility: ['none', 'reversible', 'irreversible', 'unknown'].includes(effect.reversibility) ? effect.reversibility : 'unknown',
    target: cleanString(effect.target),
    payloadDigest: cleanString(effect.payloadDigest),
    targetResolved: effect.targetResolved === true && cleanString(effect.target) !== null,
    payloadResolved: effect.payloadResolved === true,
  }
}

function legacyEffectClass(action: ActionSpec): ActionEffectClass {
  if (action.sensitiveClass) return sensitiveEffectClass[action.sensitiveClass]
  if (!action.stateChanging && action.risk === 'read_only') return 'read_only'
  if (action.risk === 'irreversible') return 'destructive'
  if (action.tool === 'communication.send') return 'communication'
  if (/\b(submit|send|publish|confirm|checkout|purchase|delete)\b/iu.test(`${action.tool} ${action.preview}`)) {
    if (/\bdelete\b/iu.test(`${action.tool} ${action.preview}`)) return 'destructive'
    if (/\b(send|message|email)\b/iu.test(`${action.tool} ${action.preview}`)) return 'communication'
    if (/\b(purchase|checkout|pay)\b/iu.test(`${action.tool} ${action.preview}`)) return 'financial'
    return 'submission'
  }
  if (!action.stateChanging) return 'safe_local'
  if (action.tool.startsWith('application.') || action.tool.startsWith('remote.')) return 'external_write'
  return 'reversible_local_write'
}

function effectLocation(action: ActionSpec, effectClass: ActionEffectClass): ActionEffect['location'] {
  if (effectClass === 'unknown') return 'unknown'
  if (effectClass === 'external_write' || protectedEffectClasses.has(effectClass)) return 'external'
  if (action.tool.startsWith('application.') || action.tool.startsWith('remote.')) return 'external'
  return 'local'
}

function effectReversibility(action: ActionSpec, effectClass: ActionEffectClass): ActionEffect['reversibility'] {
  if (effectClass === 'read_only' || effectClass === 'safe_local') return 'none'
  if (effectClass === 'destructive' || effectClass === 'legal_acceptance' || effectClass === 'high_impact_decision') return 'irreversible'
  if (effectClass === 'unknown') return 'unknown'
  return action.risk === 'irreversible' ? 'irreversible' : 'reversible'
}

function effectTarget(action: ActionSpec): string | null {
  for (const key of ['target', 'path', 'url', 'application', 'recipient', 'destination', 'key']) {
    const value = action.input[key]
    if (typeof value === 'string' && value.trim()) return `${key}:${value.trim()}`
  }
  return action.tool.startsWith('artifact.') || action.tool.startsWith('mock.') ? action.tool : null
}

function effectPayload(action: ActionSpec): unknown | null {
  for (const key of ['body', 'content', 'value', 'text', 'message', 'payload']) {
    if (Object.hasOwn(action.input, key)) return action.input[key]
  }
  return null
}

export function effectNeedsPayload(effectClass: ActionEffectClass): boolean {
  return ['external_write', 'communication', 'submission', 'financial', 'confidential_disclosure', 'legal_acceptance'].includes(effectClass)
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
