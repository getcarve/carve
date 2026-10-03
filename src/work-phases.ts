import type { ActionEffectClass, PlannedAction, WorkPhase } from './types.js'
import { compileActionEffects, hasProtectedEffect } from './action-effects.js'
import { sha256, stableJson } from './util.js'

/** Build stable, bounded phases from already-bound actions. */
export function buildWorkPhases(actions: PlannedAction[]): { actions: PlannedAction[]; phases: WorkPhase[] } {
  const enriched = actions.map((action) => ({ ...action, effects: compileActionEffects(action) }))
  const buckets: PlannedAction[][] = []
  for (const action of enriched) {
    const current = buckets.at(-1)
    const split = !current
      || hasProtectedEffect(action.effects ?? [])
      || hasProtectedEffect(current.flatMap((candidate) => candidate.effects ?? []))
      || current.at(-1)?.group !== action.group
      || targetsFor(current.at(-1)!).join('|') !== targetsFor(action).join('|')
    if (split) buckets.push([action])
    else current.push(action)
  }

  const phases = buckets.map((bucket, index) => phaseFor(bucket, index))
  const phaseByAction = new Map(phases.flatMap((phase) => phase.actionIds.map((actionId) => [actionId, phase.id] as const)))
  return {
    actions: enriched.map((action) => {
      const phaseId = phaseByAction.get(action.id)
      if (!phaseId) throw new Error(`Action ${action.id} was not assigned to a work phase`)
      return { ...action, phaseId }
    }),
    phases,
  }
}

export function phaseHash(phase: Omit<WorkPhase, 'hash'>): string {
  return sha256(stableJson(phase))
}

function phaseFor(actions: PlannedAction[], index: number): WorkPhase {
  const effectClasses = [...new Set(actions.flatMap((action) => (action.effects ?? []).map((effect) => effect.class)))] as ActionEffectClass[]
  const targets = [...new Set(actions.flatMap(targetsFor))]
  const base = {
    id: `phase-${index + 1}`,
    title: phaseTitle(actions, effectClasses),
    actionIds: actions.map((action) => action.id),
    effectClasses,
    targets,
    checkpointSummary: checkpointSummary(effectClasses, targets),
  }
  return { ...base, hash: phaseHash(base) }
}

function targetsFor(action: PlannedAction): string[] {
  return [...new Set((action.effects ?? compileActionEffects(action)).flatMap((effect) => effect.target ? [effect.target] : []))]
}

function phaseTitle(actions: PlannedAction[], effects: ActionEffectClass[]): string {
  if (actions.length === 1) return actions[0]!.preview
  if (effects.every((effect) => effect === 'read_only' || effect === 'safe_local')) return `Inspect and prepare ${actions.length} steps`
  return `${actions[0]!.group.replaceAll('_', ' ')} (${actions.length} steps)`
}

function checkpointSummary(effects: ActionEffectClass[], targets: string[]): string {
  const effect = effects.join(', ').replaceAll('_', ' ')
  return `${effect || 'unknown effect'}${targets.length ? ` in ${targets.join(', ')}` : ''}`
}
