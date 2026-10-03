import { withGuideQuestion } from './guide-metering.js'
import { bindRunToConversation, recordConversationExchange } from './conversation-history.js'
import { namedSourceReference } from './named-source-document.js'
import { savedDocumentFollowUpIntent } from './saved-document-edit.js'
import { capabilityWindowKey } from './capability-awareness.js'
import { isApprovalPreset, type ApprovalPreset } from './approval-preference.js'
import { assistanceRequestMaxLength, preserveAssistanceInstructions } from './assistance-request.js'
import { AISharingRequiredError, type SharingRequest } from './ai-sharing.js'
import { TaskPreparationError } from './task-preparation-error.js'
import { taskStartFailureShownEnabled } from './capsule-feedback.js'
import { explicitPublicLookupQuery, type PublicLookupEvidence } from './public-web.js'
import { unsupportedSpecifics } from './claim-specifics.js'
import { absenceClaimWindowEnabled, claimsAbsence, scheduledCalledLatest, scheduledNotLatestEnabled } from './absence-claim.js'
import type { AnnotationScene, DrawingEdit } from './annotation-scene.js'
import { randomUUID } from 'node:crypto'
import { answerInViewEnabled, attachedWindowSignalEnabled, type AttachedWindowReference, type ConversationDecision, type FollowUpProposal, type Fulfillment } from './conversation-policy.js'
import type { GuideAnswer } from './guide.js'
import type { LiveComputerTarget, WorkContextFollowUp } from './types.js'

/** `STEWARD_STOPPED_RESUME_CONTINUES=off` restores the old rule: resume applies only to a paused task. */
export function stoppedResumeContinuesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_STOPPED_RESUME_CONTINUES?.trim().toLowerCase() !== 'off'
}

/** A follow-up that could also be a web question was interpreted outside the failure
 * handling, so a rejected interpretation left the capsule on "Working out what you need" with only Stop until the
 * person gave up. Every failed turn now shows as failed, and a failed interpretation offers Try again (the same words,
 * interpreted afresh). `STEWARD_FOLLOWUP_FAILURE_SURFACE=off` restores the old handling. */
export function followUpFailureSurfaceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_FOLLOWUP_FAILURE_SURFACE?.trim().toLowerCase() !== 'off'
}

/** Interpretation failures a second attempt cannot change: the content itself is too large or was refused. */
const unretryableInterpretationReasons = new Set(['source_content_too_large', 'context_too_large', 'instruction_rejected'])

export type AssistanceMode = 'guide' | 'do'
export interface AssistanceCommandIdentity { conversationId: string; revision: number; commandId: string }
export interface AssistanceExecution {
  planReview?: { hash: string; steps: string[]; application: string; title: string } | null
  approvalPreset?: ApprovalPreset
  id: string
  runId: string
  target: LiveComputerTarget | null
  kind?: 'public_lookup'
  providerId?: string
  publicLookup?: PublicLookupEvidence
  goal: string
  status: string
  active: boolean
  /** An input gate is closed AND all admitted native input has returned. */
  quiescent: boolean
  resumable: boolean
  result?: string | null
  outcomes?: Array<{ goal: string; status: 'verified' | 'pending' | 'active' | 'failed' | 'reported' }>
}
export interface FollowUpAction extends Omit<FollowUpProposal, 'kind'> {
  kind: FollowUpProposal['kind'] | 'switch_mode' | 'stay_explain' | 'retry_start'
  id: string
  turnId: string
  capabilityContext?: GuideAnswer['capabilityContext']
  target?: { role: string; name: string }
}
export interface FollowUpIdentity { conversationId: string; turnId: string; candidateId: string; commandId: string }
export interface AssistanceState {
  planReview?: { hash: string; steps: string[]; application: string; title: string } | null
  approvalPreset?: ApprovalPreset
  sharingRequest?: SharingRequest | null
  windowRequest?: string | null
  windowRequestSequence?: number
  /** A task handoff is being prepared; no execution session owns the UI yet. */
  preparing: boolean
  /** The request was accepted as a task and is being handed off. `preparing`
   * alone also covers choosing between a public lookup and the window. */
  handingOff?: boolean
  turnId: string
  fulfillment: Fulfillment
  followUps: FollowUpAction[]
  newTask: { goal: string } | null
  conversationId: string
  revision: number
  mode: AssistanceMode
  requestedMode: AssistanceMode | null
  owner: 'user' | 'carve' | 'transitioning'
  target: LiveComputerTarget | null
  executionId: string | null
  runId: string | null
  canResume: boolean
  active: boolean
  dismissed: boolean
  showGuide: boolean
  question: string | null
  goal: string | null
  guide: { state: 'idle' | 'reading' | 'thinking' | 'answered' | 'failed'; answer: GuideAnswer | null; failure: string | null; sequence: number; failureKind?: 'search_uncited' | 'allowance' | 'task_start' }
  status: string
  scope: 'task' | 'step'
}
export interface AssistanceDependencies {
  approvalPreset?(): ApprovalPreset
  saveApprovalPreset?(preset: ApprovalPreset): void
  initialMode?: AssistanceMode
  audit?(category: 'conversation.mode_changed' | 'conversation.decision_recorded' | 'conversation.follow_up_resolved' | 'conversation.message_received' | 'conversation.memory_answer_withheld' | 'conversation.observe_needs_work' | 'conversation.named_source_resolved' | 'conversation.saved_document_follow_up', details: Record<string, unknown>): void
  /** Whether exactly one open document outside the attached window is what "my note" in the request means (named-source-document.ts). */
  namedSourceDocument?(question: string, target: LiveComputerTarget): Promise<boolean>
  /** Whether this conversation has a document it saved and read back from disk (the governed-save receipt ledger). */
  conversationSavedDocument?(): boolean
  optionalFollowUps?: boolean
  openFollowUps?: boolean
  canLookup?(question: string): boolean
  /** `interpretedIntent`: what interpretation already decided for this turn. The
   * lookup only chooses web or window then; it never re-decides that a request
   * interpretation read as work is a question about Carve itself.
   * `pendingIntent`: a fresh request's interpretation, still running in
   * parallel; awaited only when the method choice says "product help". */
  lookup?(question: string, current: () => boolean, target?: LiveComputerTarget | null, options?: { interpretedIntent?: ConversationDecision['intent']; pendingIntent?: () => Promise<ConversationDecision['intent'] | undefined>; onMethod?: (method: 'public_lookup' | 'computer' | 'capabilities' | 'capabilities_here') => void
    /** Whether the interpretation reads the request as about the attached window; awaits a fresh request's interpretation. */
    attachedWindow?: () => Promise<AttachedWindowReference | undefined> }): Promise<AssistanceExecution | GuideAnswer | null>
  capabilities?(question: string, target: LiveComputerTarget | null, contextual: boolean): Promise<GuideAnswer>
  capabilityRevision?(target: LiveComputerTarget | null): string | Promise<string>
  execution(): AssistanceExecution | null
  pause(execution: AssistanceExecution, reason: 'guide_mode' | 'question' | 'follow_up'): void
  resume(execution: AssistanceExecution): void
  ask(question: string, target: LiveComputerTarget, context: string | null): Promise<GuideAnswer>
  delegate(goal: string, target: LiveComputerTarget, current: () => boolean, source?: WorkContextFollowUp, referenceResolution?: string, title?: string, attachedWindowReference?: AttachedWindowReference, answerNotInView?: boolean): Promise<unknown>
  delegationGoal(question: string, answer: GuideAnswer): string
  interpret?(message: string, context: string, signal?: AbortSignal): Promise<ConversationDecision>
  /** Whether a fresh request may be interpreted while its method is chosen
   * (saves a serial wait). Follow-ups never are: their lookup waits for meaning. */
  parallelInterpretation?(): boolean
  /** Start work whose inputs are already known in parallel with
   * interpretation. The result is used only if a later step asks for exactly
   * the same request; it never decides, grants or sends anything itself. */
  speculate?(message: string, target: LiveComputerTarget): void
  /** The request was answered without a task (web answer, reply, clarification): abandon what `speculate` started. */
  abandonSpeculation?(reason: string): void
  steer?(request: string): Promise<unknown>
  continue?(request: string, current: () => boolean, source?: WorkContextFollowUp, referenceResolution?: string, title?: string, attachedWindowReference?: AttachedWindowReference, answerNotInView?: boolean): Promise<unknown>
  startDrawing?(target: LiveComputerTarget, current: () => boolean): Promise<GuideAnswer>
  editDrawing?(target: LiveComputerTarget, edit: DrawingEdit, current: () => boolean): Promise<GuideAnswer>
  cancelObservation?(): void
  cancelStart?(): void
  now?: () => number
}

/** One ephemeral conversation above Guide and both execution engines. It never
 * grants authority: delegation uses the existing plan review and resume uses
 * the existing controller. Generations prevent a late answer/start from
 * surviving a change of intent. Text stays out of persistence and audit. */
export class ConversationInteraction {
  private value: AssistanceState
  private generation = 0
  private lastAuditMode: string | null = null
  private lastUsed = 0
  private executionKey: string | null = null
  private readonly commands = new Set<string>()
  private delegationPending = false
  private publicLookupPending = false
  /** What the web-or-window selector chose for the request in this generation, when it ran. */
  private lookupMethod: { generation: number; method: 'public_lookup' | 'computer' | 'capabilities' | 'capabilities_here' } | null = null
  /** The in-flight interpretation, aborted when the conversation is cancelled or superseded. */
  private interpretationController: AbortController | null = null
  private stepArmed = false
  private returnToGuide = false
  private readonly acceptedActions = new Set<string>()
  private readonly turns: Array<{ user: string; answer: string }> = []
  private pendingSwitch: { decision: ConversationDecision; referenceResolution?: string; acceptId: string; declineId: string } | null = null
  /** The delegation now starting continues the same goal (not a side question): a stopped run may be picked up. */
  private delegatingSameGoal = false
  continuesSameGoal(): boolean { return this.delegatingSameGoal }
  private pendingRetry: { id: string; goal: string; scope: 'step' | 'task'; continuation: boolean; viaWindow?: boolean; source?: WorkContextFollowUp; referenceResolution?: string; title?: string
    /** Try again after a failed interpretation: the person's words are submitted again, not delegated as they stand. */
    resubmit?: boolean } | null = null
  private clarificationInstructions: string[] = []
  private semanticGoal: string | null = null
  private readonly recordedExecutions = new Set<string>()
  /** What was said, oldest first: capsule answers and finished task results. Interpretation context only; sources still come from `turns`. */
  private exchangeLog: Array<{ user: string; answer: string }> = []
  private drawingScene: AnnotationScene | null = null
  private readonly now: () => number

  constructor(private readonly dependencies: AssistanceDependencies) {
    this.value = this.initial()
    this.now = dependencies.now ?? Date.now
    this.lastUsed = this.now()
  }

  private initial(): AssistanceState {
    const mode = this.dependencies.initialMode ?? 'guide'
    return { preparing: false, conversationId: randomUUID(), turnId: randomUUID(), fulfillment: 'unclear', followUps: [], newTask: null, revision: 0, mode, requestedMode: null,
      owner: 'user', target: null, executionId: null, runId: null, canResume: false, active: false, dismissed: false,
      showGuide: mode === 'guide', question: null, goal: null,
      guide: { state: 'idle', answer: null, failure: null, sequence: 0 }, status: 'You’re in control', scope: 'task' }
  }

  annotationContext(): unknown { return this.drawingScene ? structuredClone(this.drawingScene) : null }
  /** A coordinator-authorized transition keeps the conversation but invalidates view-bound marks. */
  retarget(target: LiveComputerTarget): void {
    this.value.target = structuredClone(target)
    this.invalidatePointer()
    this.changed()
  }

  snapshot(): AssistanceState {
    this.reconcile()
    const execution = this.dependencies.execution()
    const preference = this.dependencies.approvalPreset?.() ?? this.value.approvalPreset ?? 'fast'
    return structuredClone({ ...this.value,
      planReview: execution?.planReview ?? null,
      approvalPreset: execution?.active ? execution.approvalPreset ?? preference : preference,
      preparing: (this.delegationPending || this.publicLookupPending) && !this.value.active,
      handingOff: this.delegationPending && !this.value.active,
    })
  }

  selectApprovalPreset(preset: ApprovalPreset, identity: AssistanceCommandIdentity): AssistanceState {
    this.reconcile()
    if (!isApprovalPreset(preset)) throw new Error('Choose a supported approval mode.')
    if (this.delegationPending || this.publicLookupPending || this.dependencies.execution()?.active || ['reading', 'thinking'].includes(this.value.guide.state)) {
      throw new Error('Finish or stop this task before changing approvals.')
    }
    if (!this.accept(identity)) return this.snapshot()
    this.dependencies.saveApprovalPreset?.(preset)
    this.value.approvalPreset = preset
    this.changed()
    return this.snapshot()
  }

  open(target: LiveComputerTarget, mode: AssistanceMode): AssistanceState {
    if (this.delegationPending || this.publicLookupPending) throw new Error('Wait for task preparation to finish, or switch to Guide to cancel.')
    const execution = this.dependencies.execution()
    if (execution?.active) throw new Error('Use the mode control to switch the current task first.')
    const sameWindow = this.value.target?.windowId === target.windowId && this.value.target.bundleIdentifier === target.bundleIdentifier
    if (!sameWindow || this.now() - this.lastUsed > 10 * 60_000) {
      this.generation++
      this.value = this.initial()
      this.commands.clear()
      this.acceptedActions.clear()
      this.turns.length = 0
      this.exchangeLog = []
      this.clarificationInstructions = []
      this.semanticGoal = null
      this.drawingScene = null
    }
    this.value.dismissed = false
    this.value.target = structuredClone(target)
    this.value.mode = mode
    this.value.showGuide = mode === 'guide'
    this.value.requestedMode = null
    this.value.status = 'You’re in control'
    this.changed()
    return this.snapshot()
  }

  private accept(identity?: AssistanceCommandIdentity, reducing = false): boolean {
    if (!identity) return true
    if (this.commands.has(identity.commandId)) return false
    if (identity.conversationId !== this.value.conversationId || (!reducing && identity.revision !== this.value.revision)) {
      throw new Error('The conversation changed. Use the current mode control.')
    }
    this.commands.add(identity.commandId)
    if (this.commands.size > 128) this.commands.delete(this.commands.values().next().value!)
    return true
  }

  async select(mode: AssistanceMode, identity?: AssistanceCommandIdentity, singleStep = false): Promise<AssistanceState> {
    this.reconcile()
    if (!this.accept(identity, mode === 'guide')) return this.snapshot()
    if (mode === 'do' && (this.delegationPending || this.publicLookupPending)) return this.snapshot()
    if (this.pendingSwitch && this.value.followUps.some(action => action.id === this.pendingSwitch?.acceptId)) {
      if (mode === 'do') {
        await this.acceptFollowUp({ conversationId: this.value.conversationId, turnId: this.value.turnId, candidateId: this.pendingSwitch.acceptId, commandId: randomUUID() })
        return this.snapshot()
      }
      this.pendingSwitch = null
      this.value.followUps = []
    }
    // A pending pause cannot be raced by an affirmative command. The user can
    // resume after the controller acknowledges release.
    if (this.value.requestedMode && mode === 'do') throw new Error('Wait for control to return before resuming.')
    this.value.dismissed = false
    this.returnToGuide = false
    if (mode === 'guide') {
      if (this.delegationPending || this.publicLookupPending) {
        this.dependencies.cancelStart?.()
        this.publicLookupPending = false
        this.value.guide = { state: 'idle', answer: null, failure: null, sequence: this.value.guide.sequence + 1 }
        this.value.followUps = []
      }
      const generation = ++this.generation
      this.delegationPending = false
      await this.hold(generation, true)
      return this.snapshot()
    }
    this.stepArmed = singleStep
    this.value.scope = singleStep ? 'step' : 'task'
    const execution = this.dependencies.execution()
    if (execution?.active) {
      if (!execution.quiescent) {
        if (this.value.mode === 'do' && !this.value.showGuide) return this.snapshot()
        throw new Error('This task needs its current decision before it can continue.')
      }
      try { this.dependencies.resume(execution) }
      catch (error) { this.stepArmed = false; throw error }
      this.generation++
      this.value.mode = 'do'
      this.value.showGuide = false
      this.invalidatePointer()
      this.value.status = 'Reading your changes before continuing'
      this.changed()
      return this.snapshot()
    }
    this.generation++
    if (this.value.guide.state === 'reading' || this.value.guide.state === 'thinking') this.value.guide = { ...this.value.guide, state: 'idle' }
    this.value.mode = 'do'
    this.value.showGuide = Boolean(this.value.guide.answer)
    this.value.followUps = []
    this.changed()
    return this.snapshot()
  }

  private async hold(generation: number, guideMode: boolean, reason: 'guide_mode' | 'question' | 'follow_up' = guideMode ? 'guide_mode' : 'question'): Promise<void> {
    let execution = this.dependencies.execution()
    this.value.showGuide = true
    if (execution?.active) {
      this.value.requestedMode = guideMode ? 'guide' : this.value.mode
      this.value.owner = 'transitioning'
      this.value.status = 'Returning control…'
      this.changed()
      this.dependencies.pause(execution, reason)
      const deadline = this.now() + 30_000
      while ((execution = this.dependencies.execution())?.active && !execution.quiescent) {
        if (generation !== this.generation) return
        if (this.now() >= deadline) throw new Error('Carve is still returning control. Stop remains available.')
        await new Promise(resolve => setTimeout(resolve, 40))
      }
    }
    if (generation !== this.generation) return
    if (guideMode) this.value.mode = 'guide'
    this.value.requestedMode = null
    this.value.owner = 'user'
    this.value.status = execution?.status === 'awaiting_plan_approval' ? 'Plan ready · review and approve to start' : execution?.active ? 'You’re in control · task paused' : 'You’re in control'
    this.invalidatePointer()
    this.changed()
  }

  async ask(question: string, target?: LiveComputerTarget, interpretActions = false, lookupChecked = false): Promise<GuideAnswer | null> {
    if (this.delegationPending || this.publicLookupPending) throw new Error('Carve is preparing your task. Wait for it to finish, or switch to Guide to cancel.')
    this.reconcile()
    if (!lookupChecked && this.canLookup(question)) {
      const lookup = await this.tryPublicLookup(question, target)
      if (lookup.handled) return lookup.answer
    }
    const selected = target ?? this.value.target
    if (!selected) return this.requestWindow(question)
    if (!question.trim() || question.length > assistanceRequestMaxLength) throw new Error(`Use ${assistanceRequestMaxLength.toLocaleString('en-US')} characters or fewer.`)
    const generation = ++this.generation
    this.value.dismissed = false
    this.value.target = selected ? structuredClone(selected) : null
    this.value.question = question.trim()
    this.value.turnId = randomUUID()
    this.value.followUps = []
    this.value.fulfillment = 'unresolved'
    this.value.guide = { state: 'reading', answer: null, failure: null, sequence: this.value.guide.sequence }
    this.value.showGuide = true
    this.changed()
    let thinking: ReturnType<typeof setTimeout> | undefined
    try {
      await this.hold(generation, false)
      if (generation !== this.generation) return null
      thinking = setTimeout(() => {
        if (generation !== this.generation) return
        this.value.guide.state = 'thinking'
        this.changed()
      }, 650)
      const answer = await this.dependencies.ask(question.trim(), selected, this.context())
      if (generation !== this.generation) return null
      this.value.guide = { state: 'answered', answer, failure: null, sequence: this.value.guide.sequence + 1 }
      this.publishDecision(question, answer)
      this.changed()
      if (interpretActions && answer.conversation && !answer.injectionSuspected) await this.applyIntent(promoteHollowPromise(answer, this.value.mode, question), generation)
      return answer
    } catch (error) {
      if (generation === this.generation) {
        this.value.guide = { ...this.value.guide, state: 'failed', failure: error instanceof Error ? error.message : 'Carve could not read this window.' }
        this.changed()
      }
      throw error
    } finally { clearTimeout(thinking) }
  }

  async delegate(explicitGoal?: string, scope: 'step' | 'task' = 'task', semantic = false, continuation = false, source?: WorkContextFollowUp, referenceResolution?: string, title?: string, attachedWindowReference?: AttachedWindowReference, answerNotInView = false): Promise<void> {
    this.reconcile()
    if (this.delegationPending || this.publicLookupPending) return
    if (!semantic && explicitGoal && this.canLookup(explicitGoal)) {
      const lookup = await this.tryPublicLookup(explicitGoal)
      if (lookup.handled) return
    }
    if (!semantic && explicitGoal && /^(?:(?:where|what|which|why|how)\b|(?:can you |please )?(?:show me|explain|point|circle)\b)/iu.test(explicitGoal.trim())) {
      await this.ask(explicitGoal, undefined, false, true)
      return
    }
    const execution = this.dependencies.execution()
    if (execution?.active) {
      await this.select('do', undefined, scope === 'step')
      return
    }
    const target = this.value.target
    if (!target) { this.requestWindow(explicitGoal?.trim() || this.value.question || this.value.goal || ''); return }
    let goal = explicitGoal?.trim() || (this.value.question && this.value.guide.answer
      ? this.dependencies.delegationGoal(this.value.question, this.value.guide.answer) : this.value.goal)
    if (!goal) throw new Error('Describe what you want Carve to do first.')
    const requestedGoal = goal
    if (scope === 'step') goal = `Complete only the next single user-visible step toward this request, then finish. Do not carry out the remainder: ${goal}`
    const generation = ++this.generation
    this.pendingRetry = null
    this.pendingSwitch = null
    this.value.sharingRequest = null
    this.value.followUps = []
    this.value.guide = { state: 'idle', answer: null, failure: null, sequence: this.value.guide.sequence + 1 }
    this.value.fulfillment = 'unresolved'
    this.delegationPending = true
    this.value.mode = 'do'
    this.value.showGuide = false
    this.value.goal = goal
    this.semanticGoal = goal
    this.value.scope = scope
    this.stepArmed = scope === 'step'
    this.value.status = 'Preparing your task'
    this.changed()
    try {
      // A continuation with nothing to continue starts fresh work in the window, so it carries the same signals.
      const signal = attachedWindowReference && attachedWindowSignalEnabled() ? attachedWindowReference : undefined
      if (continuation && this.dependencies.continue) {
        if (signal || answerNotInView) await this.dependencies.continue(goal, () => generation === this.generation, source, referenceResolution, title, signal, answerNotInView)
        else await this.dependencies.continue(goal, () => generation === this.generation, source, referenceResolution, title)
      }
      else await this.dependencies.delegate(goal, target, () => generation === this.generation, source, referenceResolution, title, attachedWindowReference && attachedWindowSignalEnabled() ? attachedWindowReference : undefined, ...(answerNotInView ? [true] as const : []))
      this.reconcile()
    } catch (error) {
      if (generation === this.generation) {
        const message = error instanceof TaskPreparationError ? error.userMessage : /timeout|timed out/iu.test(error instanceof Error ? error.message : '')
          ? 'Planning timed out. Try again.' : 'Carve couldn’t prepare this task. Try again.'
        this.value.sharingRequest = error instanceof AISharingRequiredError ? error.request : null
        this.value.status = this.value.sharingRequest ? 'Your permission is needed' : 'Couldn’t start the task'
        this.value.showGuide = true
        const allowance = error instanceof TaskPreparationError && error.phase === 'allowance'
        // The message is Carve's own copy (a TaskPreparationError's userMessage or the fixed fallback above): the capsule shows it.
        this.value.guide = { state: 'failed', answer: null, failure: message, sequence: this.value.guide.sequence + 1, ...(allowance ? { failureKind: 'allowance' as const } : taskStartFailureShownEnabled() ? { failureKind: 'task_start' as const } : {}) }
        if (allowance) this.value.status = 'Your allowance is used up'
        const retryable = !(error instanceof TaskPreparationError) || error.retryable
        if (!this.dependencies.execution()?.active && retryable) {
          const id = randomUUID()
          // Store the resolved request and source separately from display copy.
          // Preserve the original scope without prefixing a single-step goal twice.
          this.pendingRetry = { id, goal: requestedGoal, scope, continuation, ...(source ? { source: structuredClone(source) } : {}), ...(referenceResolution ? { referenceResolution } : {}), ...(title ? { title } : {}) }
          this.value.followUps = [{ id, turnId: this.value.turnId, kind: 'retry_start', label: 'Try again', request: goal, targetId: null }]
        } else if (!retryable) {
          this.pendingRetry = null
          this.value.followUps = []
        }
        this.changed()
      }
      throw error
    } finally { if (generation === this.generation) { this.delegationPending = false; this.changed() } }
  }

  /** Called synchronously at a controller action boundary, before another
   * action can be admitted. A step is one governed operation or Universal
   * input; its internal atomic delivery is never cut in half. */
  completeStepBoundary(): void {
    if (!this.stepArmed) return
    this.stepArmed = false
    void this.select('guide').then(() => {
      if (this.value.mode !== 'guide' || this.value.scope !== 'step') return
      this.value.status = 'Step finished · you’re in control'
      this.changed()
    }).catch(() => { /* The input gate stays held; Stop remains available. */ })
  }

  invalidatePointer(): void {
    if (this.value.guide.answer?.pointer || this.value.guide.answer?.annotations?.length) {
      this.value.guide.answer.pointer = null
      this.value.guide.answer.annotations = []
      this.value.guide.sequence++
      this.changed()
    }
  }

  cancelPublicLookup(): void {
    if (this.publicLookupPending) this.cancel()
  }

  cancel(): void {
    this.clarificationInstructions = []
    this.value.windowRequest = null
    this.value.sharingRequest = null
    this.dependencies.cancelObservation?.()
    this.value.followUps = []
    this.returnToGuide = false
    if (this.delegationPending || this.publicLookupPending) this.dependencies.cancelStart?.()
    this.interpretationController?.abort(new DOMException('Conversation cancelled', 'AbortError'))
    this.generation++
    this.publicLookupPending = false
    this.delegationPending = false
    this.value.requestedMode = null
    this.value.showGuide = true
    this.value.mode = 'guide'
    this.stepArmed = false
    if (this.value.guide.state === 'reading' || this.value.guide.state === 'thinking') this.value.guide = { ...this.value.guide, state: 'idle' }
    this.value.status = 'Task stopped'
    this.invalidatePointer()
    this.changed()
  }

  reveal(): void {
    this.value.dismissed = false
    this.changed()
  }

  dismiss(): void {
    if (this.publicLookupPending) { this.dependencies.cancelStart?.(); this.publicLookupPending = false }
    if (this.value.guide.state === 'reading' || this.value.guide.state === 'thinking') {
      this.generation++
      this.value.guide = { ...this.value.guide, state: 'idle' }
    }
    this.value.dismissed = true
    this.value.followUps = []
    this.invalidatePointer()
    this.changed()
  }

  private reconcile(): void {
    const execution = this.dependencies.execution()
    // A finished task's result is part of what was said in this conversation: a later question ("what was the version you told me
    // earlier?") is answered from the interpretation context, which held only guide answers and the latest run (doc-0929 k-rails).
    if (execution && execution.status === 'completed' && execution.result?.trim() && execution.kind !== 'public_lookup' && !this.recordedExecutions.has(execution.id)) {
      this.recordedExecutions.add(execution.id)
      recordConversationExchange({ at: new Date(this.now()).toISOString(), user: execution.goal, answer: execution.result.trim().slice(0, 1500), conversationId: this.value.conversationId, turnId: this.value.turnId })
      this.exchangeLog.push({ user: execution.goal, answer: execution.result.trim().slice(0, 1500) }); if (this.exchangeLog.length > 12) this.exchangeLog.shift()
    }
    const key = execution ? `${execution.id}:${execution.status}:${execution.quiescent}:${execution.resumable}:${execution.target?.windowId}:${execution.target?.bundleIdentifier}` : 'none'
    if (key === this.executionKey) return
    this.executionKey = key
    this.value.followUps = []
    if (!execution) return
    if (execution.active) this.delegationPending = false
    if (execution.id !== this.value.executionId && (execution.active || !this.value.target || execution.kind === 'public_lookup')) {
      if (this.value.target && execution.target && (execution.target?.windowId !== this.value.target.windowId || execution.target?.bundleIdentifier !== this.value.target.bundleIdentifier)) {
        this.generation++
        this.value = this.initial()
        this.drawingScene = null
        this.commands.clear()
      }
      this.value.dismissed = false
      this.value.followUps = []
      this.value.executionId = execution.id
      this.value.runId = execution.runId
      if (execution.runId) bindRunToConversation(execution.runId, this.value.conversationId)
      if (execution.target) this.value.target = structuredClone(execution.target)
      this.value.goal = execution.goal
      // A lookup is a way to answer, not a change to the user's action mode.
      if (execution.kind !== 'public_lookup') {
        this.value.mode = 'do'
        this.value.showGuide = false
      }
    }
    if (execution.id !== this.value.executionId) return
    if (execution.active && execution.target && this.value.target?.windowId !== execution.target?.windowId) {
      if (execution.target) this.value.target = structuredClone(execution.target)
      this.invalidatePointer()
    }
    this.value.active = execution.active
    this.value.canResume = execution.active && execution.quiescent && execution.resumable
    if (execution.kind !== 'public_lookup' && execution.active && !execution.quiescent && !this.value.requestedMode && this.value.mode === 'guide') {
      this.value.mode = 'do'
      this.value.showGuide = false
    }
    this.value.owner = execution.quiescent ? 'user' : this.value.requestedMode ? 'transitioning' : 'carve'
    if (this.value.requestedMode && execution.quiescent) {
      this.value.mode = this.value.requestedMode
      this.value.requestedMode = null
      this.value.showGuide = true
    }
    if (execution.kind === 'public_lookup') {
      this.value.showGuide = true
      this.value.owner = 'user'
      this.value.canResume = false
      this.value.status = execution.active ? 'Looking up public information' : execution.status === 'completed' ? 'Public answer ready' : execution.status === 'cancelled' ? 'Lookup stopped' : 'Lookup needs attention'
      this.value.guide = execution.active ? { ...this.value.guide, state: 'thinking', answer: null, failure: null }
        : execution.status === 'completed' && execution.publicLookup ? {
          state: 'answered', failure: null, sequence: this.value.guide.sequence + 1,
          answer: { id: execution.id, target: null, answeredAt: execution.publicLookup.retrievedAt, answer: execution.result ?? execution.publicLookup.answer,
            publicLookup: execution.publicLookup, grounding: 'none', pointer: null, pointerElement: null, offerToDo: false, injectionSuspected: false,
            frameSha256: '', frameCapturedAt: '', elementCount: 0, elementCaptureStatus: 'not_requested', latencyMs: 0,
            providerId: execution.providerId ?? 'conversation', resultEvidence: 'reported' },
        } : { state: execution.status === 'cancelled' ? 'idle' : 'failed', answer: null, failure: execution.status === 'cancelled' ? null : execution.result ?? 'No public answer was returned.', sequence: this.value.guide.sequence + 1 }
      this.value.fulfillment = execution.status === 'completed' ? 'satisfied' : 'unresolved'
      this.changed()
      return
    }
    this.value.status = !execution.quiescent ? this.value.requestedMode ? 'Returning control…' : 'Carve is working'
      : execution.status === 'awaiting_plan_approval' ? 'Plan ready · review and approve to start' : execution.active ? 'You’re in control · task paused' : execution.status === 'completed' ? 'Task complete' : 'You’re in control'
    if (!execution.active && (execution.status === 'completed' || execution.status === 'blocked' || execution.status === 'handoff') && (this.value.scope === 'step' || this.returnToGuide)) {
      this.returnToGuide = false
      this.value.mode = 'guide'
      this.value.showGuide = true
      this.value.guide = { state: 'answered', failure: null, sequence: this.value.guide.sequence + 1, answer: {
        id: randomUUID(), target: execution.target, answeredAt: new Date(this.now()).toISOString(),
        answer: execution.result || (execution.status === 'completed' ? 'Finished. You’re in control.' : 'This action could not be completed. You’re in control.'),
        grounding: 'none', pointer: null, pointerElement: null, offerToDo: false, injectionSuspected: false,
        frameSha256: '', frameCapturedAt: '', elementCount: 0, elementCaptureStatus: 'not_requested',
        latencyMs: 0, providerId: 'conversation',
        resultEvidence: execution.outcomes?.length && execution.outcomes.every(outcome => outcome.status === 'verified') ? 'verified' : 'reported',
      } }
      this.value.status = execution.status === 'completed' ? 'You’re in control' : 'Action needs attention · you’re in control'
    }
    if (this.value.guide.state === 'failed') this.value.status = 'Follow-up could not start'
    this.changed()
  }

  private recentExchanges(): Array<{ user: string; answer: string }> {
    // The current execution's own result already reaches the interpretation as `execution.result`, and sources are built from it.
    const current = this.dependencies.execution()?.result?.trim().slice(0, 1500)
    return this.exchangeLog.filter(e => e.answer !== current).slice(-8)
  }

  private context(): string {
    const currentExecution = this.dependencies.execution()
    const execution = currentExecution && (currentExecution.kind === 'public_lookup' || currentExecution.target?.windowId === this.value.target?.windowId
      && currentExecution.target?.bundleIdentifier === this.value.target?.bundleIdentifier) ? currentExecution : null
    const publicContext = execution?.kind === 'public_lookup'
    return JSON.stringify({
      mode: this.value.mode, owner: this.value.owner, window: publicContext ? null : this.value.target,
      goal: publicContext ? execution.goal : this.semanticGoal ?? this.value.goal, fulfillment: this.value.fulfillment,
      execution: execution ? { id: execution.id, goal: execution.goal, status: execution.status,
        outcomes: execution.outcomes,
        active: execution.active, resumable: execution.resumable, result: execution.result,
        evidence: 'Historical execution result, not a current screen observation. The selected window may have changed since this result.' } : null,
      drawingScene: !publicContext && this.drawingScene ? { ...this.drawingScene, geometryCurrent: Boolean(this.value.guide.answer?.pointer) } : null,
      recentExchanges: publicContext ? [] : this.recentExchanges(), currentAnswer: publicContext ? execution.result : this.value.guide.answer?.answer,
      availableActions: (publicContext ? [] : this.value.followUps).map(a => ({ label: a.label, kind: a.kind, target: a.target })),
    })
  }

  private publishDecision(question: string, answer: GuideAnswer): void {
    if (answer.scene) this.drawingScene = structuredClone(answer.scene)
    const decision = answer.injectionSuspected ? null : answer.conversation
    if (decision) this.dependencies.audit?.('conversation.decision_recorded', {
      conversationId: this.value.conversationId, turnId: this.value.turnId,
      runId: this.value.runId, sessionId: this.value.executionId,
      intent: decision.intent, relationship: decision.relationship, fulfillment: decision.fulfillment,
      source: answer.grounding === 'none' ? 'text_context' : 'visual_context', textRetained: false,
    })
    this.value.fulfillment = decision?.fulfillment ?? 'unclear'
    if (decision?.goal && decision.relationship !== 'side_question') this.semanticGoal = decision.goal
    this.value.followUps = (this.dependencies.optionalFollowUps !== false && this.value.owner === 'user' ? decision?.followUps ?? [] : []).flatMap(proposal => {
      const target = proposal.targetId ? answer.followUpTargets?.[proposal.targetId] : undefined
      if (proposal.kind === 'task' && (!answer.capabilityContext || this.value.active)) return []
      if (proposal.kind === 'open' && (!target || this.value.active || this.dependencies.openFollowUps === false)) return []
      return [{ ...proposal, id: randomUUID(), turnId: this.value.turnId, ...(proposal.kind === 'task' ? { capabilityContext: answer.capabilityContext } : {}), ...(target ? { target } : {}) }]
    })
    this.turns.push({ user: question, answer: answer.answer })
    this.exchangeLog.push({ user: question, answer: answer.answer }); if (this.exchangeLog.length > 12) this.exchangeLog.shift()
    if (this.turns.length > 10) this.turns.shift()
    recordConversationExchange({ at: new Date(this.now()).toISOString(), user: question, answer: answer.answer, conversationId: this.value.conversationId, turnId: this.value.turnId })
  }

  /** Same semantic path for typed text, final voice transcripts and result questions. */
  private requestWindow(question: string): null {
    this.value.windowRequest = question
    this.value.windowRequestSequence = (this.value.windowRequestSequence ?? 0) + 1
    this.value.question = question
    this.value.status = 'Which window would you like help with?'
    this.value.guide = { state: 'idle', answer: null, failure: null, sequence: this.value.guide.sequence + 1 }
    this.changed()
    return null
  }

  private canLookup(question: string): boolean {
    return Boolean(this.dependencies.lookup && !this.dependencies.execution()?.active && (this.dependencies.canLookup?.(question) ?? true))
  }

  /** `query` is what the web receives; `question` stays the person's own words for the capsule and the record. */
  private async tryPublicLookup(question: string, target?: LiveComputerTarget, query = question, within?: number, interpretedIntent?: ConversationDecision['intent'], pending?: Promise<ConversationDecision | null> | null, interpreted?: ConversationDecision | null): Promise<{ handled: boolean; answer: GuideAnswer | null }> {
    if (!this.dependencies.lookup || this.dependencies.execution()?.active) return { handled: false, answer: null }
    if (!question.trim() || question.length > 1000 || !query.trim() || query.length > 1000) return { handled: false, answer: null }
    // A lookup that follows an interpretation belongs to that turn: it must not
    // retire the generation the decision it may fall back to was made in.
    const generation = within ?? ++this.generation
    const previous = structuredClone(this.value.guide)
    const previousStatus = this.value.status
    this.value.status = 'Choosing how to help'
    this.publicLookupPending = true
    this.value.guide = { ...previous, state: 'thinking', failure: null }
    this.value.showGuide = true
    this.changed()
    try {
      const pendingIntent = !interpretedIntent && pending ? () => pending.then(decision => decision?.intent, () => undefined) : undefined
      const onMethod = (method: 'public_lookup' | 'computer' | 'capabilities' | 'capabilities_here') => { if (generation === this.generation) this.lookupMethod = { generation, method } }
      // The interpretation's reading of "the attached window", when there is one to wait for.
      const attachedWindow = interpreted ? async () => interpreted.refersToAttachedWindow
        : pending ? () => pending.then(decision => decision?.refersToAttachedWindow, () => undefined) : undefined
      const execution = await this.dependencies.lookup(query.trim(), () => generation === this.generation, target ?? this.value.target,
        { ...(interpretedIntent ? { interpretedIntent } : pendingIntent ? { pendingIntent } : {}), onMethod, ...(attachedWindow ? { attachedWindow } : {}) })
      if (generation !== this.generation) return { handled: true, answer: null }
      if (!execution) { this.value.status = previousStatus; this.value.guide = previous; this.changed(); return { handled: false, answer: null } }
      if ('answeredAt' in execution) {
        if (target) this.value.target = structuredClone(target)
        this.value.question = question.trim(); this.value.turnId = randomUUID(); this.value.showGuide = true
        this.value.guide = { state: 'answered', answer: execution, failure: null, sequence: previous.sequence + 1 }
        this.publishDecision(question, execution); this.changed()
        return { handled: true, answer: execution }
      }
      this.value.question = question.trim()
      this.semanticGoal = question.trim()
      this.value.turnId = randomUUID()
      this.value.followUps = []
      this.reconcile()
      if (this.value.guide.state === 'failed') await this.offerWindowAfterFruitlessSearch(question, target ?? this.value.target, this.value.guide.failure ?? '')
      else if (this.value.guide.state === 'answered' && !explicitPublicLookupQuery(query.trim())) this.offerWindowAfterPublicAnswer(question, target ?? this.value.target)
      return { handled: true, answer: this.value.guide.answer }
    } catch (error) {
      if (generation !== this.generation) return { handled: true, answer: null }
      this.value.status = 'Lookup needs attention'
      const failure = error instanceof Error ? error.message : 'Public lookup failed.'
      this.value.guide = { ...previous, state: 'failed', failure }
      await this.offerWindowAfterFruitlessSearch(question, target ?? this.value.target, failure)
      this.changed()
      throw error
    } finally { if (generation === this.generation) { this.publicLookupPending = false; this.changed() } }
  }

  /** A context-free web search that found nothing citable is not the end of
   * the road when a window is attached: the same question can be answered on
   * that window as a task (a request about "the visitor side" meant
   * the ticketing page the person was looking at). */
  private async offerWindowAfterFruitlessSearch(question: string, window: LiveComputerTarget | null | undefined, failure: string): Promise<'offered' | null> {
    if (!window || !/public search returned no (?:usable cited answer|web tool calls)/iu.test(failure) || this.dependencies.execution()?.active) return null
    const goal = explicitPublicLookupQuery(question.trim()) ?? question.trim()
    // The task runs on the window the question was asked from; the failed search branch never recorded it.
    this.value.target = structuredClone(window)
    this.value.guide = { ...this.value.guide, state: 'failed', failureKind: 'search_uncited' }
    // Whoever chose the web, acting in the person's window is offered, never
    // assumed. Once, a lookup Carve had inferred on its own
    // "carried on in the window" when it found nothing to cite: a follow-up
    // whose "there" no one had resolved was handed, unasked, to a session
    // with input authority on the frontmost Chrome window, which went to the
    // person's account-activity page looking for what "there" meant.
    const id = randomUUID()
    this.pendingRetry = { id, goal, scope: 'task', continuation: false, viaWindow: true }
    this.value.followUps = [{ id, turnId: this.value.turnId, kind: 'retry_start', label: 'Check this page', request: goal, targetId: null }]
    this.changed()
    return 'offered'
  }

  /** Carve chose the web on its own while a window was attached. The choice
   * can be wrong in a way the answer does not reveal: in testing a
   * request for places to stay, asked from an open lodging-site tab, was answered
   * from a general web search. Doing it on the page is one click away. */
  private offerWindowAfterPublicAnswer(question: string, window: LiveComputerTarget | null | undefined): void {
    if (!window || this.dependencies.execution()?.active) return
    this.value.target = structuredClone(window)
    const id = randomUUID()
    this.pendingRetry = { id, goal: question.trim(), scope: 'task', continuation: false, viaWindow: true }
    this.value.followUps = [{ id, turnId: this.value.turnId, kind: 'retry_start', label: 'Use this page instead', request: question.trim(), targetId: null }]
    this.changed()
  }

  async submit(message: string, target?: LiveComputerTarget): Promise<GuideAnswer | null> {
    return withGuideQuestion(() => this.submitQuestion(message, target))
  }

  private async submitQuestion(message: string, target?: LiveComputerTarget): Promise<GuideAnswer | null> {
    try { return await this.submitMessage(message, target) }
    catch (error) {
      // Whatever failed, a turn still showing "thinking" for these words with nothing left running is shown as failed.
      if (followUpFailureSurfaceEnabled() && this.value.question === message.trim() && ['thinking', 'reading'].includes(this.value.guide.state)
        && !this.delegationPending && !this.publicLookupPending && !this.interpretationController) {
        this.interpretationFailed(this.generation, message.trim(), error, false)
      }
      throw error
    }
  }

  /** A turn whose interpretation failed: shown as failed, with Try again when another attempt could succeed. */
  private interpretationFailed(generation: number, question: string, error: unknown, offerRetry: boolean): void {
    if (generation !== this.generation) return
    this.value.guide = { ...this.value.guide, state: 'failed', failure: error instanceof Error ? error.message : 'Could not understand the follow-up.' }
    this.value.status = 'Follow-up could not start'
    const reason = error && typeof error === 'object' && 'reason' in error ? String((error as { reason: unknown }).reason) : null
    if (followUpFailureSurfaceEnabled() && offerRetry && question && !unretryableInterpretationReasons.has(reason ?? '') && !this.dependencies.execution()?.active) {
      const id = randomUUID()
      this.pendingRetry = { id, goal: question, scope: 'task', continuation: false, resubmit: true }
      this.pendingSwitch = null
      this.value.followUps = [{ id, turnId: this.value.turnId, kind: 'retry_start', label: 'Try again', request: question, targetId: null }]
    }
    this.changed()
  }

  private async submitMessage(message: string, target?: LiveComputerTarget): Promise<GuideAnswer | null> {
    if (this.delegationPending || this.publicLookupPending) throw new Error('Carve is preparing your task. Wait for it to finish, or switch to Guide to cancel.')
    this.reconcile()
    const question = message.trim()
    this.value.windowRequest = null
    if (!question || question.length > assistanceRequestMaxLength) throw new Error(`Use ${assistanceRequestMaxLength.toLocaleString('en-US')} characters or fewer.`)
    const execution = this.dependencies.execution()
    const selected = target ?? this.value.target
    // The request-to-answer clock starts here, before interpretation. Text is
    // never retained; the latency report reads this mark, not the message.
    this.dependencies.audit?.('conversation.message_received', {
      conversationId: this.value.conversationId, turnId: this.value.turnId, runId: this.value.runId, sessionId: this.value.executionId,
      characters: question.length, mode: this.value.mode, windowSelected: Boolean(selected), textRetained: false,
    })
    const interpretable = Boolean(this.dependencies.interpret) && !(selected && this.value.mode === 'guide' && !this.value.guide.answer && !execution?.result)
    // A fresh request in Do mode usually becomes a task whose goal is these
    // exact words, so its route can be inferred while the message is read.
    if (interpretable && selected && this.value.mode === 'do' && !execution?.active && !this.hasPriorExchange(execution)) {
      try { this.dependencies.speculate?.(question, selected) } catch { /* Speculation never affects the request. */ }
    }
    // A follow-up that looks like a public question is interpreted before any
    // search, so the web receives the person's question with its references
    // resolved, or the person is asked. The lookup used to run
    // first, on the words as spoken: "what's speculated they'll release
    // there?" went to the web verbatim, found nothing, and fell into a window
    // session that tried to work out "there" from the person's browser.
    let decision: ConversationDecision | null = null
    let generation: number | null = null
    // A fresh request's interpretation reads nothing the method choice
    // produces, and the method choice reads nothing interpretation produces,
    // so both start at once (3.0 s and 3.3 s back to back
    // before every window task). The web still receives only the words as
    // asked; a request that becomes a lookup aborts its interpretation, whose
    // decision is never published or acted on.
    let early: Promise<ConversationDecision | null> | null = null
    if (this.canLookup(question)) {
      let query: string | null = question
      if (interpretable && !execution?.active && !this.hasPriorExchange(execution) && this.dependencies.parallelInterpretation?.()) {
        generation = this.beginInterpretation(question, selected)
        early = this.interpretMessage(question, generation, execution)
        early.catch(() => { /* Observed below, or abandoned with its generation. */ })
      } else if (interpretable && !execution?.active && this.hasPriorExchange(execution)) {
        generation = this.beginInterpretation(question, selected)
        try { decision = await this.interpretMessage(question, generation, execution) }
        catch (error) {
          // This interpretation used to run outside the failure handling below: its rejection left the
          // capsule on "Working out what you need" (six minutes, only Stop).
          if (followUpFailureSurfaceEnabled()) this.interpretationFailed(generation, question, error, true)
          throw error
        }
        if (!decision) return null
        query = this.lookupQueryFor(decision, question, execution)
        this.dependencies.audit?.('conversation.follow_up_resolved', {
          conversationId: this.value.conversationId, turnId: this.value.turnId, runId: this.value.runId, sessionId: this.value.executionId,
          intent: decision.intent, relationship: decision.relationship, publicAntecedent: execution?.kind === 'public_lookup',
          outcome: query === null ? 'no_search' : query === question ? 'search_as_asked' : 'search_resolved', textRetained: false,
        })
      }
      if (query !== null && this.canLookup(query)) {
        let lookup: { handled: boolean; answer: GuideAnswer | null }
        try { lookup = await this.tryPublicLookup(question, target, query, generation ?? undefined, decision?.intent, early, decision) }
        catch (error) { if (early) this.abandonInterpretation(); throw error }
        if (lookup.handled) { if (early) this.abandonInterpretation(); this.dependencies.abandonSpeculation?.('answered_on_web'); return lookup.answer }
        if (generation !== null && generation !== this.generation) { if (early) this.abandonInterpretation(); return null }
      }
    }
    if (!interpretable) return this.ask(question, target, true, true)
    generation ??= this.beginInterpretation(question, selected)
    let interpreting = false
    try {
      if (!decision) {
        interpreting = true
        decision = await (early ?? this.interpretMessage(question, generation, execution))
        interpreting = false
      }
      if (!decision) return null
      // "Also add … to the same document" right after this conversation saved it is work on that document.
      const savedEdit = savedDocumentFollowUpIntent(decision, question, this.dependencies.conversationSavedDocument?.() ?? false)
      if (savedEdit) {
        this.dependencies.audit?.('conversation.saved_document_follow_up', { conversationId: this.value.conversationId, turnId: this.value.turnId, from: decision.intent, textRetained: false })
        decision = { ...savedEdit, fulfillment: 'unresolved', request: (decision.request || question).trim().slice(0, 500), answer: '', followUps: [] }
      }
      // "Which note should I use?" when exactly one open document is the note: the request is a hand-off from that
      // document to the attached window, not a question for the person.
      if (decision.intent === 'clarify' && selected && this.value.mode === 'do' && this.dependencies.namedSourceDocument && namedSourceReference(question)) {
        const found = await this.dependencies.namedSourceDocument(question, selected).catch(() => false)
        if (generation !== this.generation) return null
        if (found) {
          this.dependencies.audit?.('conversation.named_source_resolved', { conversationId: this.value.conversationId, turnId: this.value.turnId, from: 'clarify', textRetained: false })
          decision = { ...decision, intent: 'execute', relationship: decision.relationship === 'side_question' || decision.relationship === 'unclear' ? 'new_goal' : decision.relationship,
            fulfillment: 'unresolved', request: question.trim().slice(0, 500), answer: '', followUps: [] }
        }
      }
      // A factual answer written from memory is withheld below and becomes a
      // window task; the route inference speculated at submit is exactly the
      // one that task needs (in one run it was dropped
      // here, then requested again, 1.6 s). Keep it until the answer is final.
      const deferAbandon = keepRouteSpeculationForAnswers() && decision.intent === 'answer'
      if (decision.intent !== 'execute' && !deferAbandon) this.dependencies.abandonSpeculation?.(`intent_${decision.intent}`)
      if (this.dependencies.capabilities && (decision.intent === 'capabilities' || decision.intent === 'capabilities_here')) {
        if (decision.intent === 'capabilities_here' && !selected) return this.requestWindow(question)
        const answer = await this.dependencies.capabilities(question, selected ?? null, decision.intent === 'capabilities_here')
        if (generation !== this.generation) return null
        this.value.guide = { state: 'answered', answer, failure: null, sequence: this.value.guide.sequence + 1 }
        this.publishDecision(question, answer); this.changed(); return answer
      }
      // A factual answer the policy wrote from memory is never the final
      // answer: it goes to the page (or the person picks one) instead.
      const withheld = decision.intent === 'answer' ? unsourcedAnswer(decision, question, this.context(), this.lookupMethod?.generation === generation ? this.lookupMethod.method : null, this.hasPriorExchange(execution)) : null
      if (withheld) {
        this.dependencies.audit?.('conversation.memory_answer_withheld', {
          conversationId: this.value.conversationId, turnId: this.value.turnId, runId: this.value.runId, sessionId: this.value.executionId,
          reason: withheld.reason, specifics: withheld.specifics, mode: this.value.mode, windowSelected: Boolean(selected), textRetained: false,
        })
        if (!selected) { if (deferAbandon) this.dependencies.abandonSpeculation?.('intent_answer'); return this.requestWindow(question) }
        if (this.value.mode !== 'do') { if (deferAbandon) this.dependencies.abandonSpeculation?.('intent_answer'); return this.ask(question, selected, true, true) }
        decision = { ...decision, intent: 'execute', relationship: decision.relationship === 'side_question' || decision.relationship === 'unclear' ? 'new_goal' : decision.relationship,
          fulfillment: 'unresolved', request: (decision.request || question).trim().slice(0, 500), answer: '', followUps: [] }
      }
      if (deferAbandon && decision.intent !== 'execute') this.dependencies.abandonSpeculation?.('intent_answer')
      if (!selected && execution?.kind !== 'public_lookup') return this.requestWindow(question)
      // Re-evaluate the original user request with fresh visual evidence. The
      // text-only policy may need to see the source before resolving a handoff.
      // Never promote a model-written observation prompt into user authority.
      const staleBlocker = selected && execution && !execution.active && decision.relationship === 'new_goal' && decision.fulfillment === 'blocked'
      // A question about the window whose answer is not in its visible part (the listed ads have to be opened, the table
      // compared past the fold) is read-only work in the window, not an Explain answer from one screenshot (in testing:
      // a question about one attribute of the listed items was answered from the results list alone in one run and worked in another).
      if (decision.intent === 'observe' && decision.answerInView === 'no' && answerInViewEnabled() && selected && this.value.mode === 'do' && !staleBlocker) {
        this.dependencies.audit?.('conversation.observe_needs_work', { reason: 'answer_not_in_view', textRetained: false })
        decision = { ...decision, intent: 'execute', relationship: decision.relationship === 'side_question' || decision.relationship === 'unclear' ? 'new_goal' : decision.relationship,
          fulfillment: 'unresolved', request: (decision.request || question).trim().slice(0, 500), answer: '', followUps: [] }
      }
      if (decision.intent === 'observe' || decision.intent === 'draw' || staleBlocker) return this.ask(question, selected ?? undefined, true, true)
      const answer: GuideAnswer = {
        id: randomUUID(), answeredAt: new Date(this.now()).toISOString(), target: selected,
        answer: decision.answer || (decision.intent === 'execute' ? 'Preparing your request.' : decision.intent === 'close' ? 'You’re welcome.' : 'What would you like to do next?'),
        grounding: 'none', pointer: null, pointerElement: null, offerToDo: false,
        injectionSuspected: false, frameSha256: '', frameCapturedAt: '', elementCount: 0,
        elementCaptureStatus: 'not_requested', latencyMs: 0, providerId: 'conversation',
        conversation: { ...decision, followUps: decision.followUps.filter(p => p.kind !== 'open') },
      }
      this.value.guide = { state: 'answered', answer, failure: null, sequence: this.value.guide.sequence + 1 }
      this.publishDecision(question, answer)
      this.changed()
      await this.applyIntent(decision, generation)
      return answer
    } catch (error) {
      this.interpretationFailed(generation, question, error, interpreting)
      throw error
    }
  }

  /** Anything the policy can resolve a reference against: an earlier answer in this conversation or a completed execution's result. */
  private hasPriorExchange(execution: AssistanceExecution | null): boolean {
    return this.turns.length > 0 || Boolean(this.value.guide.answer) || Boolean(execution?.result)
  }

  /** The capsule shows the person's words being thought about; the turn, target and follow-ups are reset for the new message. */
  private beginInterpretation(question: string, selected: LiveComputerTarget | null | undefined): number {
    const generation = ++this.generation
    this.value.turnId = randomUUID()
    this.value.followUps = []
    this.value.target = selected ? structuredClone(selected) : null
    this.value.question = question
    this.value.newTask = null
    this.value.dismissed = false
    this.value.showGuide = true
    this.value.guide = { ...this.value.guide, state: 'thinking', failure: null }
    this.changed()
    return generation
  }

  /** An interpretation whose request was answered another way is left to
   * finish and ignored: its decision is never published or acted on, and a
   * completed call keeps its usage exact where an aborted one would not
   * (a few hundredths of a cent). Cancelling the conversation still aborts. */
  private abandonInterpretation(): void {
    this.interpretationController = null
  }

  /** One policy call for the message; null when the conversation moved on while it ran. */
  private async interpretMessage(question: string, generation: number, execution: AssistanceExecution | null): Promise<ConversationDecision | null> {
    const context = this.context()
    if (execution?.active) await this.hold(generation, false, 'follow_up')
    if (generation !== this.generation) return null
    this.interpretationController?.abort(new DOMException('Interpretation superseded', 'AbortError'))
    const controller = new AbortController()
    this.interpretationController = controller
    let decision: ConversationDecision
    try { decision = await this.dependencies.interpret!(question, context, controller.signal) }
    catch (error) { if (generation !== this.generation || controller.signal.aborted) return null; throw error }
    finally { if (this.interpretationController === controller) this.interpretationController = null }
    if (generation !== this.generation) return null
    this.reconcile()
    if (this.dependencies.execution()?.id !== execution?.id) throw new Error('The task changed while Carve was interpreting the follow-up. Please try again.')
    return decision
  }

  /** What the web may be asked after interpretation: nothing when the policy
   * answered, asked, or found the request unclear; the resolved request when
   * the antecedent was itself public; otherwise the question as asked, since a
   * request resolved against a window may carry that window's content. */
  private lookupQueryFor(decision: ConversationDecision, question: string, execution: AssistanceExecution | null): string | null {
    if (decision.relationship === 'unclear' || !['execute', 'observe', 'resume'].includes(decision.intent)) return null
    if (execution?.kind === 'public_lookup' && decision.request.trim()) return decision.request.trim()
    return question
  }

  private async applyIntent(decision: ConversationDecision, generation: number, switchApproved = false, referenceResolution?: string): Promise<void> {
    if (generation !== this.generation) return
    // "Continue where you left off" after the person pressed Stop: a stopped task is not resumable (only a paused one
    // is), so the resume path could never run (in testing the request was understood as resume and nothing
    // started). Carry on as a continuation of the same goal, which starts a new run with the stopped run's context.
    if (decision.intent === 'resume' && !this.value.canResume && stoppedResumeContinuesEnabled()) {
      const status = this.dependencies.execution()?.status
      if (status && ['stopped', 'cancelled', 'blocked', 'failed'].includes(status)) decision = { ...decision, intent: 'execute', relationship: 'same_goal' }
    }
    if (!switchApproved && decision.relationship === 'new_goal') this.clarificationInstructions = []
    if (!switchApproved && decision.intent === 'clarify' && this.value.question) {
      this.clarificationInstructions.push(this.value.question)
    }
    if (!switchApproved && decision.intent === 'execute' && this.value.question) {
      referenceResolution = decision.request !== this.value.question ? decision.request : undefined
      decision = { ...decision, request: preserveAssistanceInstructions([...this.clarificationInstructions, this.value.question].join('\n'), decision.request) }
      this.clarificationInstructions = []
    }
    if (!switchApproved && this.value.mode === 'guide' && (decision.intent === 'execute' || decision.intent === 'resume')) {
      const acceptId = randomUUID(), declineId = randomUUID()
      const preset = this.dependencies.approvalPreset?.() ?? this.value.approvalPreset ?? 'fast'
      const label = decision.intent === 'resume' ? 'Resume task' : preset === 'fast' ? 'Start task' : 'Review plan'
      this.pendingSwitch = { decision: structuredClone(decision), ...(referenceResolution ? { referenceResolution } : {}), acceptId, declineId }
      this.value.followUps = [
        { id: acceptId, turnId: this.value.turnId, kind: 'switch_mode', label, request: decision.request, targetId: null },
        { id: declineId, turnId: this.value.turnId, kind: 'stay_explain', label: 'Keep explaining', request: '', targetId: null },
      ]
      if (this.value.guide.answer) {
        this.value.guide.answer.pointer = null
        this.value.guide.answer.annotations = []
        this.value.guide.sequence++
      }
      this.value.fulfillment = 'unresolved'
      this.value.status = 'Explain is on · choose whether to start this task'
      this.changed()
      return
    }
    if (decision.intent === 'guide') {
      await this.select('guide')
    } else if (decision.intent === 'resume') {
      if (!this.value.canResume) throw new Error('There is no paused task ready to resume.')
      await this.select('do')
    } else if (decision.intent === 'execute') {
      // A new goal gets a fresh execution through delegate, while keeping the
      // explicitly attached window and the capsule's normal approval flow.
      // Unattached work still needs composition to choose its workspace.
      if (!this.value.target && !switchApproved && !decision.sources?.length && decision.relationship === 'new_goal' && this.dependencies.execution()?.status === 'completed') {
        this.value.newTask = { goal: decision.request }
        this.changed()
        return
      }
      if (this.value.active) {
        if (decision.sources?.length) throw new Error('Finish or stop the current task before starting a task with referenced content.')
        if (!this.dependencies.steer) throw new Error('Pause or finish the current task before changing its goal.')
        await this.dependencies.steer(decision.request)
        return
      }
      this.returnToGuide = this.value.mode === 'guide'
      const source: WorkContextFollowUp | undefined = decision.sources?.length ? {
        runId: this.value.runId ?? this.value.conversationId,
        goal: this.value.question ?? decision.request,
        result: decision.sources.map(s => s.text).join('\n\n'),
        status: 'completed', completedAt: new Date(this.now()).toISOString(),
        sourceIds: decision.sources.map(s => s.id),
      } : undefined
      this.delegatingSameGoal = decision.relationship === 'same_goal'
      try { await this.delegate(decision.request, 'task', true, decision.relationship !== 'new_goal', source, referenceResolution, decision.title, decision.refersToAttachedWindow, decision.answerInView === 'no' && answerInViewEnabled()) }
      finally { this.delegatingSameGoal = false }
    }
  }

  async acceptFollowUp(identity: FollowUpIdentity): Promise<void> {
    this.reconcile()
    if (this.acceptedActions.has(identity.candidateId)) return
    if (identity.conversationId !== this.value.conversationId || identity.turnId !== this.value.turnId) throw new Error('This answer changed. Use its current actions.')
    const action = this.value.followUps.find(candidate => candidate.id === identity.candidateId)
    if (!action || this.value.owner !== 'user' || (this.value.guide.state !== 'answered' && !(action.kind === 'retry_start' && this.value.guide.state === 'failed'))) throw new Error('This action is no longer available.')
    this.acceptedActions.add(action.id)
    // A Try again after a failed interpretation is the same message again, not an exchange of its own.
    if (action.kind !== 'answer' && !(action.kind === 'retry_start' && this.pendingRetry?.resubmit)) this.turns.push({ user: action.label, answer: 'Requested this follow-up.' })
    if (this.turns.length > 10) this.turns.shift()
    this.value.followUps = []
    this.changed()
    if (action.kind === 'task') {
      const binding = action.capabilityContext
      const target = this.value.target
      const generation = this.generation
      const revision = await this.dependencies.capabilityRevision?.(target)
      this.reconcile()
      const windowKey = capabilityWindowKey(this.value.target)
      if (!binding || generation !== this.generation || identity.turnId !== this.value.turnId || binding.windowKey !== windowKey || binding.revision !== revision || this.value.active) {
        throw new Error('The window or available capabilities changed. Ask for current suggestions again.')
      }
      this.value.question = action.request
      await this.applyIntent({ intent: 'execute', relationship: 'new_goal', fulfillment: 'unresolved', goal: action.request, request: action.request, answer: '', followUps: [] }, this.generation)
      return
    }
    if (action.kind === 'retry_start') {
      const retry = this.pendingRetry
      this.pendingRetry = null
      if (retry?.resubmit && retry.id === action.id) { await this.submit(retry.goal); return }
      if (!retry || retry.id !== action.id || (this.value.mode !== 'do' && !retry.viaWindow)) throw new Error('This retry is no longer available.')
      if (retry.viaWindow && this.value.mode !== 'do') { this.value.mode = 'do'; this.value.showGuide = false }
      // "Check this page" / "Use this page instead": the person chose the attached window.
      await this.delegate(retry.goal, retry.scope, true, retry.continuation, retry.source, retry.referenceResolution, retry.title, retry.viaWindow ? 'yes' : undefined)
      return
    }
    if (action.kind === 'switch_mode' || action.kind === 'stay_explain') {
      const pending = this.pendingSwitch
      this.pendingSwitch = null
      if (!pending || (action.kind === 'switch_mode' ? pending.acceptId : pending.declineId) !== action.id) throw new Error('This mode switch is no longer available.')
      if (action.kind === 'stay_explain') {
        this.value.status = 'You’re in control'
        if (this.value.guide.answer) {
          this.value.guide.answer.answer = 'You’re still in Explain. What would you like me to explain about this request?'
          this.value.guide.sequence++
        }
        this.changed()
        return
      }
      this.value.mode = 'do'
      this.changed()
      await this.applyIntent(pending.decision, this.generation, true, pending.referenceResolution)
      return
    }
    if (action.kind === 'answer') {
      await this.submit(action.label)
      return
    }
    if (action.kind !== 'open') {
      await this.ask(action.kind === 'progress'
        ? ('I have completed the last instruction. Check the current screen and guide the next unmet part of this goal: ' + (this.semanticGoal ?? this.value.goal ?? action.request)).slice(0, 500)
        : action.request)
      return
    }
    if (!action.target || this.value.active) throw new Error('This document action is no longer available.')
    const generation = ++this.generation
    const target = this.value.target!
    const executionId = this.dependencies.execution()?.id
    this.value.guide.state = 'reading'
    this.changed()
    try {
      const fresh = await this.dependencies.ask(
        'Locate the document or link named ' + JSON.stringify(action.target.name) + '. Identify it only; do not open it.', target, this.context())
      if (generation !== this.generation) return
      this.reconcile()
      if (this.dependencies.execution()?.id !== executionId || this.value.active) throw new Error('The task changed. Find the document again before opening it.')
      if (fresh.injectionSuspected || (fresh.pointerMatchCount !== undefined && fresh.pointerMatchCount !== 1) || fresh.grounding !== 'element' || fresh.pointerElement?.name !== action.target.name || fresh.pointerElement?.role !== action.target.role) {
        throw new Error('The document could not be identified again. Ask Carve to find it before opening.')
      }
      this.returnToGuide = this.value.mode === 'guide'
      // A complete outcome uses ordinary planning and verification, never
      // the legacy one-input step limit or a stale coordinate from the chip.
      await this.delegate('Open the document or link named ' + JSON.stringify(action.target.name) + ' in this window. Re-identify the exact item before interacting. Only open it; do not edit, share, send or submit anything. Stop when it is open, or report the blocker.', 'task', true)
    } catch (error) {
      if (generation !== this.generation) return
      this.value.guide = { ...this.value.guide, state: 'failed', failure: error instanceof Error ? error.message : 'Could not open the document.' }
      this.changed()
      throw error
    }
  }

  async startDrawing(): Promise<void> {
    this.reconcile()
    const target = this.value.target
    if (!target || !this.dependencies.startDrawing || this.value.owner !== 'user' || this.delegationPending || this.value.preparing || ['reading', 'thinking'].includes(this.value.guide.state)) throw new Error('Wait for Carve to finish before starting a drawing.')
    const generation = ++this.generation
    const answer = await this.dependencies.startDrawing(target, () => generation === this.generation)
    if (generation !== this.generation) return
    this.value.showGuide = true
    this.value.guide = { state: 'answered', answer, failure: null, sequence: this.value.guide.sequence + 1 }
    this.drawingScene = answer.scene ?? null
    this.value.followUps = []
    this.changed()
  }

  async editDrawing(edit: DrawingEdit): Promise<void> {
    this.reconcile()
    const target = this.value.target, answer = this.value.guide.answer
    if (!target || !answer?.scene || !this.dependencies.editDrawing || this.value.owner !== 'user' || this.delegationPending || this.value.guide.state !== 'answered') throw new Error('Wait for Carve to finish before editing the drawing.')
    if (!answer.pointer && !['undo', 'redo', 'restore'].includes(edit.action) && !(edit.action === 'draw' && !answer.scene.objects.length)) throw new Error('Update the marks before editing them.')
    const generation = ++this.generation
    const updated = await this.dependencies.editDrawing(target, edit, () => generation === this.generation && this.value.guide.answer?.id === answer.id)
    if (generation !== this.generation) return
    this.value.guide = { state: 'answered', answer: updated, failure: null, sequence: this.value.guide.sequence + 1 }
    this.drawingScene = updated.scene ?? null
    this.changed()
  }

  async refreshGuide(): Promise<GuideAnswer | null> {
    if (!this.value.question || this.value.owner !== 'user') return null
    return this.ask(this.value.question)
  }

  private changed(): void {
    this.value.revision++; this.lastUsed = this.now()
    const key = JSON.stringify([this.value.conversationId, this.value.executionId, this.value.mode, this.value.requestedMode, this.value.owner])
    if (key === this.lastAuditMode) return
    this.lastAuditMode = key
    this.dependencies.audit?.('conversation.mode_changed', {
      conversationId: this.value.conversationId, turnId: this.value.turnId,
      runId: this.value.runId, sessionId: this.value.executionId,
      mode: this.value.mode, requestedMode: this.value.requestedMode, owner: this.value.owner,
      textRetained: false,
    })
  }
}

/** An `answer` decision is written by a text-only call that sees the
 * conversation, never the page or the web. It is kept only when it asserts
 * nothing that evidence would have to supply:
 * - `unsourced_specifics`: a date, figure, price, version or year that is in
 *   neither the person's words nor anything Carve showed or found earlier.
 * - `method_needs_evidence`: on a fresh request the web-or-window selector
 *   judged the request to need the page or the web, so an answer from memory
 *   bypasses exactly the reading it asked for.
 * In testing: "When does Node.js 16
 * reach end of life?" was answered "September 11, 2023" in 2–3 s with no
 * source, although the selector had chosen the page. The date happened to be
 * right; the route would have repeated a wrong one just as confidently.
 * - `refers_to_window`: the interpretation itself says a fresh request is about
 *   the attached window, which this text-only call never saw ("what's this?",
 *   "is the price shown the sale price?"). Its answer is from memory by
 *   construction; the window answers instead. `STEWARD_ATTACHED_WINDOW_SIGNAL=off`
 *   removes this reason.
 * `STEWARD_UNSOURCED_ANSWER_GUARD=off` restores publishing them. */
export function unsourcedAnswer(decision: ConversationDecision, question: string, evidence: string, method: 'public_lookup' | 'computer' | 'capabilities' | 'capabilities_here' | null, priorExchange: boolean): { reason: 'unsourced_specifics' | 'method_needs_evidence' | 'unanswered' | 'refers_to_window'; specifics: number } | null {
  if (process.env.STEWARD_UNSOURCED_ANSWER_GUARD?.trim().toLowerCase() === 'off') return null
  if (decision.intent !== 'answer' || decision.sources?.length || !decision.answer.trim()) return null
  const specifics = unsupportedSpecifics(decision.answer, question, evidence)
  if (specifics.length) return { reason: 'unsourced_specifics', specifics: specifics.length }
  if (!priorExchange && decision.refersToAttachedWindow === 'yes' && attachedWindowSignalEnabled() && decision.relationship !== 'unclear') return { reason: 'refers_to_window', specifics: 0 }
  if (!priorExchange && (method === 'computer' || method === 'public_lookup') && decision.relationship !== 'unclear') return { reason: 'method_needs_evidence', specifics: 0 }
  // A fresh request the text-only policy could not answer ("I don't have a current screenshot or page text to verify
  // the version", asked "on this page", so the web-or-window
  // selector never ran) is a request to read the window, not an answer.
  if (!priorExchange && decision.fulfillment !== 'satisfied' && decision.relationship !== 'unclear') return { reason: 'unanswered', specifics: 0 }
  return null
}

/** A read-only answer that only promises to look something up is not an
 * answer. In Do-it mode, with nothing grounded on the window, it becomes the
 * execute handoff the person asked for; the request stays the person's own
 * words, never the model's promise. Guide mode keeps the reply as is. */
export function promoteHollowPromise(answer: GuideAnswer, mode: AssistanceMode, question: string): ConversationDecision {
  const decision = answer.conversation!
  if (mode !== 'do' || answer.pointer) return decision
  if (decision.intent !== 'observe' && decision.intent !== 'answer') return decision
  if (decision.relationship === 'unclear') return decision
  const text = answer.answer.trim()
  const promise = /^(?:(?:sure|okay|ok|of course|absolutely|got it|certainly)[\s,.!—–-]*)?(?:i(?:['’]ll| will| can| am going to|['’]m going to)|let me|i['’]d be happy to|happy to)\s+(?:check|look|find|search|see|pull|get|verify|confirm|open|browse|fetch)/iu.test(text)
  // doc-0929 web sets: "The Homebrew instructions aren't visible in this part of the page ... I'll look further down" and "the macOS
  // instructions start just below" were shown as the answer (3 of 40 cases). An answer that says what was asked is not in view, or
  // that promises to look later in a sentence of its own, is not an answer: the person's question goes to the window.
  const deferred = notInViewAnswerEnabled()
    && /\b(?:isn['’]t|aren['’]t|not|n['’]t) (?:visible|shown|in view|on screen)\b|\b(?:starts?|begins?|is|are) (?:just )?(?:below|further down)\b|\b(?:further|farther) down\b|\bcan['’]?t see\b[^.]{0,80}\b(?:visible|on screen|in view)\b|\b(?:hidden|covered|blocked) (?:by|behind)\b[^.]{0,40}\b(?:banner|popup|dialog|overlay)\b|\bvisible (?:part|portion|section)\b[^.]{0,60}\b(?:doesn['’]?t|does not|isn['’]?t|not)\b|\b(?:page|site|screen|window) (?:does not|doesn['’]?t) (?:show|state|list|give|say|mention|display|include)\b/iu.test(text)
  // In testing: "This page doesn't show a specific latest Scala version", "The page does not show
  // the current stable version", "I can't confirm the current stable version ... because the cookie banner covers the release
  // details" were read from the visible part of pages that list those versions further down. Any claim that the page lacks
  // something (structural detector, src/absence-claim.ts), or a review that found the asked thing shown although the answer
  // says it is not, sends the question to the window route, which reads the whole page. The window route's own answer is
  // never re-checked here, so a true absence is answered once, honestly, from the full page.
  const absent = absenceClaimWindowEnabled()
    && (claimsAbsence(text) || claimsAbsence(decision.answer) || answer.reviewContradictsAbsence === true)
  // A scheduled or prerelease version called "the latest release".
  const scheduled = scheduledNotLatestEnabled() && scheduledCalledLatest(text)
  if (!promise && !deferred && !absent && !scheduled) return decision
  if (!deferred && !absent && !scheduled && (answer.grounding !== 'none' || decision.fulfillment === 'satisfied')) return decision
  const request = (decision.request || decision.goal || question).trim().slice(0, 500)
  if (!request) return decision
  return { ...decision, intent: 'execute', relationship: decision.relationship === 'side_question' ? 'new_goal' : decision.relationship, request, fulfillment: 'unresolved', followUps: [] }
}
/** Off: STEWARD_NOT_IN_VIEW_ANSWER=off. */
export function notInViewAnswerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_NOT_IN_VIEW_ANSWER?.trim().toLowerCase() !== 'off'
}

/** Deliberately narrow. Questions about actions, negations, and quoted text
 * are never interpreted as authority to act. Broader requests use Do it. */
export function assistanceIntent(text: string): 'question' | 'guide' | 'delegate' | 'step' {
  const value = text.trim().toLowerCase().replace(/[.!]+$/u, '')
  if (/^(?:please )?(?:guide me|just show me|show me how instead|let me take over|i(?:’|')?ll take (?:it|over)(?: from here)?)$/u.test(value)) return 'guide'
  if (/^(?:please )?(?:do (?:it|this|the rest)(?: for me)?|take over|continue the task|resume(?: the task)?)$/u.test(value)) return 'delegate'
  if (/^(?:please )?do (?:just )?this step(?: for me)?$/u.test(value)) return 'step'
  return 'question'
}

/** `STEWARD_KEEP_ROUTE_SPECULATION=off` restores dropping the speculated route
 * inference as soon as the conversation decides 'answer', even when that
 * answer is then withheld and the request goes to the window. */
export function keepRouteSpeculationForAnswers(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_KEEP_ROUTE_SPECULATION?.trim().toLowerCase() !== 'off'
}
