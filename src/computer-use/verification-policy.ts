import type { ActionEffectClass } from '../types.js'
import { contextualPrefixLength, interpretationIndices, type ActionInterpretationInput } from './action-interpretation.js'
import type { UniversalComputerBatchPreflight } from './universal.js'
import { isBrowserBundleIdentifier, isBrowserFindField, popupControl, popupValueItem, typedValueReceiver } from './effects.js'

/**
 * Which checks a task pays for is decided once, from evidence the controller
 * already holds, instead of by every rule inspecting every batch. `legacy`
 * reproduces the pre-September-16 behaviour (every semantic action reviewed
 * by a model, every completion reviewed by the completion model, prohibitions
 * judged from screenshots). `tiered` scales the checks to the task's risk.
 */
/** `legacy`: a model reviews every semantic action. `tiered`: only actions the mechanical classifier cannot name.
 * `actor`: ordinary controls use the actor's proposal; address-bar destinations
 * without mechanical task coverage still receive contextual navigation review,
 * while named protected controls, sensitive controls, obstructions and unproven receivers keep their mechanical checks. */
export type VerificationPolicyMode = 'legacy' | 'tiered' | 'actor'

export function verificationPolicyMode(env: NodeJS.ProcessEnv = process.env): VerificationPolicyMode {
  const configured = env.STEWARD_VERIFICATION_POLICY?.trim()
  return configured === 'legacy' ? 'legacy' : configured === 'actor' ? 'actor' : 'tiered'
}

/** `STEWARD_COMPLETION_REVIEW=off` removes the independent final check: a completed report is delivered as the model
 * reported it, marked as not independently verified, with no answer repair and no verifier-driven challenge. */
export function completionReviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_COMPLETION_REVIEW?.trim() !== 'off'
}

/** `STEWARD_REVIEW_LOCAL_WRITES=on` restores the model review of typing into a proven editable field and of
 * clicks on toggle controls. Off by default: across the benchmark suite the action
 * reviewer took 32% of the wall time of every correct write and more uncached input than the actor, and
 * most of those calls judged a value typed into the field the binder had already proved focused, or a
 * checkbox toggle. Both are reversible by construction and the completion review still judges the result. */
export function reviewLocalWrites(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_REVIEW_LOCAL_WRITES?.trim() === 'on'
}

/** Risk of what the session has actually done or must produce, not of what the goal text sounds like. */
export type TaskRiskProfile = 'read_only' | 'local_edit' | 'consequential'

const localWriteClasses = new Set<ActionEffectClass>(['reversible_local_write'])
const harmlessClasses = new Set<ActionEffectClass>(['read_only', 'safe_local'])

export function classifyTaskRisk(input: { requestedValues: number; executedEffects: Iterable<ActionEffectClass> }): TaskRiskProfile {
  let profile: TaskRiskProfile = 'read_only'
  for (const effect of input.executedEffects) {
    if (harmlessClasses.has(effect)) continue
    if (localWriteClasses.has(effect)) { if (profile === 'read_only') profile = 'local_edit'; continue }
    return 'consequential'
  }
  // Exact requested values are a correctness contract even before they are typed.
  if (input.requestedValues > 0 && profile === 'read_only') return 'local_edit'
  return profile
}

export interface VerificationPolicy {
  /** `unclassified_only`: a model reviews an action only when the mechanical preflight could not name its control and effect. */
  /** `none`: ordinary action review is off; unresolved browser navigation is still reviewed. */
  actionReview: 'unclassified_only' | 'every_semantic_action' | 'none'
  /** `light` routes the final review to the frequent execution model; `full` uses the dedicated completion model. */
  completionReview: 'light' | 'full'
  /** How "do not touch X" requirements are judged: the controller's own input ledger, or screenshots. */
  prohibitionEvidence: 'input_ledger' | 'screen'
}

export function verificationPolicyFor(profile: TaskRiskProfile, mode: VerificationPolicyMode = verificationPolicyMode()): VerificationPolicy {
  if (mode === 'legacy') return { actionReview: 'every_semantic_action', completionReview: 'full', prohibitionEvidence: 'screen' }
  return {
    actionReview: mode === 'actor' ? 'none' : 'unclassified_only',
    completionReview: profile === 'read_only' ? 'light' : 'full',
    prohibitionEvidence: 'input_ledger',
  }
}

/** A click the compiler already bound to a labeled, non-sensitive control with a harmless effect needs no second opinion. */
function mechanicallyClassified(input: ActionInterpretationInput, index: number): boolean {
  const action = input.actions[index], binding = input.baseline.semanticBindings[index], effect = input.baseline.effects[index]
  if (!action || !binding || !effect) return false
  if (action.kind === 'type' || action.kind === 'keypress') {
    if (!binding.resolved || !binding.elementId || !effect.targetResolved) return false
    if (!['read_only', 'safe_local', 'reversible_local_write'].includes(effect.class)) return false
    const element = input.frame.elements.find(e => e.id === binding.elementId)
    if (!element || element.sensitive || element.obstructed || element.enabled === false) return false
    // Text typed into the browser's own find-in-page field stays inside the
    // window: the compiler binds it to that focused field and classifies the
    // Enter that follows as a read-only lookup, so a second opinion adds only
    // latency (five seconds per search).
    if (isBrowserBundleIdentifier(input.target.bundleIdentifier) && element.focused === true && isBrowserFindField(element)) return true
    // Text typed into a labelled editable field the binder proved as the
    // receiver — focused in the frame, or clicked earlier in this batch — is
    // a reversible local edit the completion review will judge; a model
    // review of the value adds three seconds and five thousand tokens.
    // Type-ahead and Return on the focused item of an open value pop-up choose
    // an option: the same reversible local edit as clicking it, bound by the
    // compiler to the one focused item of a list the frame shows open.
    if (!reviewLocalWrites() && element.focused === true && popupValueItem(element, input.frame.elements)
      && (action.kind === 'type' || action.kind === 'keypress' && action.keys.length === 1 && ['ENTER', 'RETURN'].includes(action.keys[0]!.toUpperCase()))) return true
    // Type-ahead on a focused, closed value pop-up (a web <select>) selects the
    // matching option: a reversible local edit of that control alone.
    if (!reviewLocalWrites() && action.kind === 'type' && element.focused === true && element.expanded !== true && popupControl(element)
      && typeof element.value === 'string' && effect.class === 'reversible_local_write' && Boolean(binding.label)) return true
    if (action.kind !== 'type' || reviewLocalWrites() || effect.class !== 'reversible_local_write' || !binding.label) return false
    const proven = element.focused === true || element.containsFocus === true
      || input.actions.slice(0, index).some(prior => (prior.kind === 'click' || prior.kind === 'double_click') && element.bounds && containsPoint(element.bounds, prior.point))
    // A number input or a date/time segment takes typed characters as its own
    // value, like a text field; the same proof of focus applies.
    return proven && (element.editable === true || typedValueReceiver(element))
  }
  if (action.kind !== 'click' && action.kind !== 'double_click') return false
  // A results-page click the compiler proved has nothing consequential around it (effects.ts).
  if (binding.visualListing === true && binding.resolved && effect.targetResolved && effect.class === 'read_only') return true
  if (!binding.resolved || !binding.elementId || binding.role === 'browser_location') return false
  if (!effect.targetResolved) return false
  const element = input.frame.elements.find(e => e.id === binding.elementId)
  if (!element || element.sensitive || element.obstructed || element.enabled === false) return false
  // A native document body often has no label. Focusing a proven editable
  // receiver has the same mechanical effect whether it is named or not.
  // This does not exempt typing, submission, or an unnamed ordinary button.
  if (!binding.label && !(element.editable === true && effect.class === 'safe_local')) return false
  if (harmlessClasses.has(effect.class)) return true
  // The compact provider selected an exact advertised ref and the backend
  // uniquely rebound that identity in the current frame. Narrow selector
  // controls may therefore carry their mechanically proven reversible effect
  // without asking a second model to rediscover the same receiver.
  if (!reviewLocalWrites() && binding.interpretationSource === 'compact_ref' && effect.class === 'reversible_local_write') return true
  // A toggle the compiler named by its role is reversible by construction.
  return !reviewLocalWrites() && effect.class === 'reversible_local_write' && /(checkbox|radio|switch|stepper|incrementor)/iu.test(element.role)
}

/** Context can name an unfamiliar visible pointer target, but it cannot make
 * an unproven keyboard receiver safe. Those proposals must go straight to a
 * fresh observation/recovery instead of paying for a verdict that the
 * mechanical binder will (correctly) refuse anyway. */
function contextCanResolve(input: ActionInterpretationInput, index: number): boolean {
  const action = input.actions[index], binding = input.baseline.semanticBindings[index]
  if (!action || !binding) return false
  if (binding.browserDestination || binding.browserSearchQuery) return true
  if (action.kind === 'type' || action.kind === 'keypress') return Boolean(binding.elementId && binding.target)
  if (action.kind !== 'click' && action.kind !== 'double_click') return true
  const point = action.point
  const blocked = input.frame.elements.some(element => element.bounds
    && containsPoint(element.bounds, point)
    && (element.sensitive || element.obstructed || element.enabled === false
      || element.pointerObstructions?.some(bounds => containsPoint(bounds, point))))
  return !blocked
}

function containsPoint(bounds: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): boolean {
  return point.x >= bounds.x && point.y >= bounds.y && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height
}

export function actionReviewIndices(input: ActionInterpretationInput, policy: Pick<VerificationPolicy, 'actionReview'>): number[] {
  // Always derive from the mechanical rule, never from a previously stored override.
  const { reviewIndices: _override, ...mechanical } = input
  void _override
  const indices = interpretationIndices(mechanical)
  if (policy.actionReview === 'none') return []
  if (policy.actionReview === 'every_semantic_action') return indices
  return indices.filter(index => !mechanicallyClassified(input, index) && contextCanResolve(input, index))
}

/** When no action needs review, the mechanical result still stops before a
 * click that can change what later coordinates mean. */
export function mechanicalObservationBoundary(input: ActionInterpretationInput, baseline: UniversalComputerBatchPreflight): UniversalComputerBatchPreflight {
  const boundary = Math.min(baseline.observationBoundary ?? input.actions.length, contextualPrefixLength(input, baseline))
  return boundary < input.actions.length ? { ...baseline, observationBoundary: boundary } : baseline
}

/** Prohibitions are checked against what the controller actually delivered, not against a screenshot's silence. */
export const inputLedgerEvidenceRule = 'inputLedger records confirmed physical inputs and explicitly uncertain attempts in this session: the kind of input and the label and role of the control it was bound to (typed text and key contents are omitted). An entry with delivery="uncertain" proves neither success nor inaction: inspect its outcome from independent current evidence, never assume it did nothing or blindly repeat it. A prohibition or "leave X unchanged" requirement is satisfied when the ledger shows no input or uncertain attempt bound to that control and the current state shows no change to it; never demand screen evidence of inaction. A requirement that only the ledger can establish uses evidence "ledger".'


/**
 * Fixed per-task overheads that do not depend on the task's risk: how hard
 * the router thinks, how long the
 * runtime waits after harmless input, how much history the reviewers read,
 * and whether a handoff source stage may act on its reviewer's verdict once.
 * Action-review history is deliberately not capped: a fact observed pages ago
 * must still be able to validate a later action. Attaching the first frame to
 * every session start was tried and removed: the model still
 * opened with a screenshot request in 14 of 14 trials, so it only added an image.
 * `legacy` is the earlier behaviour.
 */
export type OverheadPolicyMode = 'legacy' | 'lean'

export function overheadPolicyMode(env: NodeJS.ProcessEnv = process.env): OverheadPolicyMode {
  return env.STEWARD_OVERHEAD_POLICY?.trim() === 'legacy' ? 'legacy' : 'lean'
}

export interface OverheadPolicy {
  /** Reasoning effort for surface routing when the window is already selected. */
  routeIntentEffort: 'low' | 'medium'
  /** Unchanged probes required after a batch whose effects are all read-only or safe-local. */
  harmlessSettleStableFrames: number
  /** Completion review: drop unnamed controls and geometry, cap history characters, ask for concise requirements. */
  trimCompletionReview: boolean
  completionReviewHistoryCharacters: number
  completionReviewControlLimit: number
  /** Completion challenges a handoff source stage may receive. */
  handoffCompletionChallenges: number
  /** Start the approval-plan draft alongside surface routing instead of after it. */
  overlapPlanDraft: boolean
  /** Reasoning effort for interpreting a conversation turn; `provider_default` sends none. */
  interpretationEffort: 'low' | 'medium' | 'provider_default'
  /** Whether a capture waits for the requested-field-values extraction. `blocking`: always. `reading`: a goal with reading intent lets it finish alongside the next turn, a goal that may write waits so its first write already carries the extracted values. `background`: never waits. The final review always waits for it. */
  fieldRequirementsPrewarm: 'blocking' | 'reading' | 'background'
  /** Before an authorized batch runs, a pixel-only capture whose hash equals the authorized frame's stands in for the full recapture. */
  revalidationFingerprint: boolean
  /** The field-value proof capture after typing: `always`, or only for goals that may write (`write_goals`). */
  fieldProofs: 'always' | 'write_goals'
  /** Attach the first frame to the session start for reading goals only, or for every goal. */
  firstFrame: 'reading' | 'always'
  /** When the model's first turn only asks for a screenshot, answer it with the frame captured at start instead of a new capture. */
  reuseInitialObservation: boolean
  /** Reasoning effort for a chain's first turn when no frame is attached, where the only possible output is a screenshot request; `inherit` keeps the session's effort. */
  firstTurnEffort: 'low' | 'inherit'
  /** Controls named to the actor with each frame, so a proposal can pick a
   * known receiver instead of guessing a coordinate the controller will
   * refuse. 0 sends no brief, and that is the default: the paired arms of
   * a measured comparison found no
   * correctness or rejection gain and a slower median, so the mechanism stays
   * available behind `STEWARD_CONTROL_BRIEF` instead of shipping on. */
  controlBrief: number
  /** Repair, with no model call, a click that lands just outside exactly one
   * labelled control: the tolerance in frame pixels, or 0 for off. The
   * An earlier research note ranked this and tolerant revalidation above the
   * control brief, which measured no gain; unlike the brief this cannot make
   * the model wander, because it only ever moves a point onto the one control
   * already next to it. Off until a paired run says otherwise. */
  clickSnap: number
}

export function overheadPolicyFor(mode: OverheadPolicyMode = overheadPolicyMode()): OverheadPolicy {
  if (mode === 'legacy') return { routeIntentEffort: 'medium', harmlessSettleStableFrames: 2, trimCompletionReview: false, completionReviewHistoryCharacters: 16_000, completionReviewControlLimit: 150, handoffCompletionChallenges: 0, overlapPlanDraft: false, interpretationEffort: 'provider_default', fieldRequirementsPrewarm: 'blocking', revalidationFingerprint: false, fieldProofs: 'always', firstFrame: 'reading', reuseInitialObservation: false, firstTurnEffort: 'inherit', controlBrief: 0, clickSnap: 0 }
  return { routeIntentEffort: 'low', harmlessSettleStableFrames: 1, trimCompletionReview: true, completionReviewHistoryCharacters: 8_000, completionReviewControlLimit: 80, handoffCompletionChallenges: 1, overlapPlanDraft: true, interpretationEffort: 'low', fieldRequirementsPrewarm: 'reading', revalidationFingerprint: true, fieldProofs: 'write_goals', firstFrame: 'reading', reuseInitialObservation: true, firstTurnEffort: 'low', controlBrief: 0, clickSnap: 0 }
}

/** The interpretation call's effort: an explicit environment override, else the overhead policy. */
export function interpretationEffort(env: NodeJS.ProcessEnv = process.env): 'low' | 'medium' | undefined {
  const configured = env.STEWARD_OPENAI_INTERPRET_EFFORT?.trim()
  if (configured === 'low' || configured === 'medium') return configured
  if (configured === 'default') return undefined
  const policy = overheadPolicyFor(overheadPolicyMode(env)).interpretationEffort
  return policy === 'provider_default' ? undefined : policy
}

/** How a capture treats the requested-values extraction: an explicit environment override, else the overhead policy. */
export function fieldRequirementsPrewarm(env: NodeJS.ProcessEnv = process.env): OverheadPolicy['fieldRequirementsPrewarm'] {
  const configured = env.STEWARD_FIELD_REQUIREMENTS_PREWARM?.trim()
  if (configured === 'blocking' || configured === 'reading' || configured === 'background') return configured
  return overheadPolicyFor(overheadPolicyMode(env)).fieldRequirementsPrewarm
}

/** Round-five levers, each with an environment override so a paired run can hold one at the previous behaviour. */
export function overheadLevers(env: NodeJS.ProcessEnv = process.env): Pick<OverheadPolicy, 'revalidationFingerprint' | 'fieldProofs' | 'firstFrame' | 'reuseInitialObservation' | 'firstTurnEffort' | 'controlBrief' | 'clickSnap'> {
  const policy = overheadPolicyFor(overheadPolicyMode(env))
  const flag = (value: string | undefined, fallback: boolean) => value === '1' ? true : value === '0' ? false : fallback
  const proofs = env.STEWARD_FIELD_PROOFS?.trim(), frame = env.STEWARD_FIRST_FRAME?.trim(), firstTurn = env.STEWARD_FIRST_TURN_EFFORT?.trim()
  return {
    revalidationFingerprint: flag(env.STEWARD_REVALIDATION_FINGERPRINT?.trim(), policy.revalidationFingerprint),
    fieldProofs: proofs === 'always' || proofs === 'write_goals' ? proofs : policy.fieldProofs,
    firstFrame: frame === 'reading' || frame === 'always' ? frame : policy.firstFrame,
    reuseInitialObservation: flag(env.STEWARD_REUSE_INITIAL_OBSERVATION?.trim(), policy.reuseInitialObservation),
    firstTurnEffort: firstTurn === 'low' || firstTurn === 'inherit' ? firstTurn : policy.firstTurnEffort,
    controlBrief: briefLimit(env.STEWARD_CONTROL_BRIEF?.trim(), policy.controlBrief),
    clickSnap: snapTolerance(env.STEWARD_CLICK_SNAP?.trim(), policy.clickSnap),
  }
}

/** `0`/`off` sends no brief, a positive integer caps it, anything else keeps the policy default. */
/** `0`/`off` never snaps; otherwise a tolerance in frame pixels. Capped well
 * below the size of an ordinary control so a "snap" can never cross one. */
function snapTolerance(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  if (value === 'off') return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 16 ? parsed : fallback
}

function briefLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  if (value === 'off') return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 24 ? parsed : fallback
}

/** Whether this goal's captures may return before the extraction finishes. */
export function fieldRequirementsPrewarmInBackground(readingIntent: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = fieldRequirementsPrewarm(env)
  return mode === 'background' || (mode === 'reading' && readingIntent)
}

/** The completion reviewer answers faster when it is not asked to narrate. Applied only under the lean policy. */
export const conciseCompletionReviewRule = 'Be concise: at most twelve requirements, each expected/observed under thirty words, feedback under eighty words. Do not restate the claim.'
