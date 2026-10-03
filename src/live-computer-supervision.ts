import { universalComputerActivityPhase } from './universal-interaction-state.js'
import type { ActionEffectClass, CheckpointDecision, CheckpointLivePreview, LiveComputerSession, UniversalComputerSession } from './types.js'
import { liveComputerActivityPhase, liveComputerOverlayPhaseCopy } from './live-computer-activity.js'

export interface CapsuleDecision {
  kind: 'action' | 'checkpoint' | 'review' | 'handoff'
  /** The person's own step (a sign-in or a human check): Carve waits; nothing of Carve's is being approved. */
  personStep?: boolean
  sessionId: string
  id: string
  revision: string
  title: string
  /** Shown on the card. */
  facts: Array<{ label: string; value: string }>
  /** Approval-material facts kept one disclosure away, behind "Details". Never dropped, only tucked. */
  details?: Array<{ label: string; value: string }>
  scope: string
  declineLabel?: string
  approveDisabled?: boolean
  approveLabel: string
  /** The highest-risk protected effect this approval carries, so the capsule can show a fitting icon. */
  effect?: ActionEffectClass
}

/** A protected effect, shown to the person as a plain reason with a fitting verb, ordered highest risk first.
 * The capsule maps `effect` to an icon; `title` and `scope` are the reason; `approveLabel`/`declineLabel` are the verbs. */
const protectedApprovalCopy: Record<string, { title: string; scope: string; approveLabel: string; declineLabel: string }> = {
  financial: { title: 'Confirm a payment', scope: 'This spends money or moves funds, and cannot be undone.', approveLabel: 'Confirm payment', declineLabel: 'Not now' },
  destructive: { title: 'Confirm a deletion', scope: 'This permanently removes something.', approveLabel: 'Delete', declineLabel: 'Keep it' },
  authentication: { title: 'A sign-in step', scope: 'This signs in or enters a credential.', approveLabel: 'Continue', declineLabel: 'Not now' },
  privilege_escalation: { title: 'Grant access', scope: 'This grants elevated or administrator access.', approveLabel: 'Allow', declineLabel: 'Not now' },
  installation: { title: 'Install software', scope: 'This installs software on your Mac.', approveLabel: 'Install', declineLabel: 'Not now' },
  legal_acceptance: { title: 'Accept terms', scope: 'This accepts terms or consent on your behalf.', approveLabel: 'Accept', declineLabel: 'Decline' },
  communication: { title: 'Send a message', scope: 'This sends a message to someone.', approveLabel: 'Send', declineLabel: 'Don’t send' },
  confidential_disclosure: { title: 'Share private information', scope: 'This shares information that may be private.', approveLabel: 'Share', declineLabel: 'Don’t share' },
  high_impact_decision: { title: 'A significant change', scope: 'This is significant and hard to undo.', approveLabel: 'Confirm', declineLabel: 'Not now' },
  submission: { title: 'Submit this', scope: 'This submits what was entered.', approveLabel: 'Submit', declineLabel: 'Not now' },
}
/** The person's own step on a human-verification check (never an approval of input). */
export const humanVerificationCopy = { title: 'Confirm you\u2019re human', scope: 'This site wants you to confirm you\u2019re human. Complete it in the window, then Carve will continue.', approveLabel: 'Continue', declineLabel: 'Not now' }
/** The person's own sign-in: Carve waits and never types a password or code. */
export const signInCopy = { title: 'Sign in to continue', scope: 'This site wants you to sign in. Sign in in the window, then Carve will continue.', approveLabel: 'Continue', declineLabel: 'Not now' }
/** `STEWARD_PERSON_STEP_MAIN_WINDOW=off`: the main window shows a sign-in or human-check pause as an ordinary approval.
 * Read where `process` exists (tests, Node); the renderer has no environment and keeps the default. */
export const personStepMainWindowEnabled = () => typeof process === 'undefined' || process.env?.STEWARD_PERSON_STEP_MAIN_WINDOW?.trim().toLowerCase() !== 'off'

/** The copy for a checkpoint that is the person's own step (a sign-in or a human check), or null for an ordinary approval. */
export function personStepCheckpointCopy(checkpoint: Pick<CheckpointDecision, 'reasonCodes' | 'preview'>): { kind: 'sign_in' | 'human_verification'; title: string; scope: string; approveLabel: string; declineLabel: string } | null {
  if (checkpoint.reasonCodes.includes('sign_in')) return { kind: 'sign_in', ...signInCopy, title: checkpoint.preview.what || signInCopy.title, scope: checkpoint.preview.whyNow || signInCopy.scope }
  if (checkpoint.reasonCodes.includes('human_verification')) return { kind: 'human_verification', ...humanVerificationCopy, scope: checkpoint.preview.whyNow || humanVerificationCopy.scope }
  return null
}
const protectedApprovalOrder = ['financial', 'destructive', 'authentication', 'privilege_escalation', 'installation', 'legal_acceptance', 'communication', 'confidential_disclosure', 'high_impact_decision', 'submission']

/** The plain reason for a protected checkpoint, or null when it carries no protected effect. */
export function protectedApprovalReason(effectClasses: readonly string[]): { effect: ActionEffectClass; title: string; scope: string; approveLabel: string; declineLabel: string } | null {
  const effect = protectedApprovalOrder.find(candidate => effectClasses.includes(candidate))
  if (!effect) return null
  return { effect: effect as ActionEffectClass, ...protectedApprovalCopy[effect]! }
}

/** Long held text stays available in full but starts folded, so a pasted paragraph cannot swallow a card.
 * Mirrored in desktop/live-computer-overlay.html, which cannot import. */
export function foldPreviewText(text: string, limit = 180): { shown: string; folded: boolean } {
  if (text.length <= limit) return { shown: text, folded: false }
  const cut = text.lastIndexOf(' ', limit - 20)
  return { shown: `${text.slice(0, cut > limit / 2 ? cut : limit - 20).trimEnd()}…`, folded: true }
}

const terminal = new Set(['completed', 'stopped', 'blocked', 'handoff', 'safety_check'])
export function computerSupervisionStatus(live: LiveComputerSession | null, universal: UniversalComputerSession | null) {
  const session = universal && !terminal.has(universal.status) ? universal
    : live && !terminal.has(live.status) ? live
      : universal && (!live || universal.updatedAt >= live.updatedAt) ? universal : live
  if (!session) return null
  const active = !terminal.has(session.status)
  const waiting = session.status.startsWith('awaiting_')
  const phase = 'ledger' in session ? liveComputerActivityPhase(session) : universalComputerActivityPhase(session)
  const label = session.status === 'completed' ? 'Result ready'
    : session.status === 'pausing' ? 'Pausing after the current action'
      : session.status === 'paused' ? ('pendingInputTransaction' in session && session.pendingInputTransaction ? 'Paused · Previous input needs checking' : 'Paused · You have control')
        : waiting ? 'Waiting for your decision'
          : !active ? 'Task stopped'
            : liveComputerOverlayPhaseCopy(phase).label.replace(/^Carve · /u, '')
  return { id: session.id, runId: session.runId, goal: session.goal, application: session.target.application, label, active, waiting }
}

/** Compact review is an additional view of the existing decision, never an
 * alternate approval policy. Oversized or consequential previews stay in the
 * full review rather than having important details truncated. */
export function capsuleDecision(live: LiveComputerSession | null, universal: UniversalComputerSession | null, checkpoint?: CheckpointDecision | null, livePreview?: CheckpointLivePreview | null): CapsuleDecision | null {
  if (universal?.status === 'awaiting_checkpoint' && universal.pendingPlanReview) return null
  const compact = compactApprovalDecision(live, universal, checkpoint, livePreview)
  if (compact) return compact
  const owner = computerSupervisionStatus(live, universal)
  const held = owner?.id === universal?.id && universal?.status === 'awaiting_checkpoint' ? universal
    : owner?.id === live?.id && live?.status === 'awaiting_approval' && ['immediate', 'group'].includes(live.pendingApproval?.kind ?? '') ? live : null
  if (!held) return null
  // Unsupported or oversized approvals still need an actionable destination.
  // This is navigation only, never a shortened authorization preview.
  return { kind: 'review', sessionId: held.id, id: 'ledger' in held ? held.pendingAction?.id ?? held.id : held.pendingCheckpointId ?? held.id,
    revision: 'ledger' in held ? held.missionPlan.hash : held.id,
    title: 'Your approval is needed', facts: [],
    scope: 'Open the full decision to review its details and choose how to proceed. Nothing will run from this button.',
    approveLabel: 'Review decision' }
}

function compactApprovalDecision(live: LiveComputerSession | null, universal: UniversalComputerSession | null, checkpoint?: CheckpointDecision | null, livePreview?: CheckpointLivePreview | null): CapsuleDecision | null {
  if (universal && !terminal.has(universal.status) && universal.status !== 'awaiting_checkpoint') return null
  let decision: CapsuleDecision | null = null
  if (universal?.status === 'awaiting_checkpoint') {
    if (!checkpoint || checkpoint.id !== universal.pendingCheckpointId || checkpoint.runId !== universal.runId || checkpoint.status !== 'pending'
      || checkpoint.sessionId !== universal.id || (checkpoint.expiresAt !== null && Date.parse(checkpoint.expiresAt) <= Date.now())
      || checkpoint.subject !== 'computer_batch' || checkpoint.scope.kind !== 'once') return null
    // A site asking whether a person is present is the person's step, like signing in: the card names the site and
    // waits; Carve resumes by itself once the check is gone. No input is attached to this decision.
    const copy = personStepCheckpointCopy(checkpoint)
    if (copy) {
      return { kind: 'checkpoint', personStep: true, sessionId: universal.id, id: checkpoint.id, revision: checkpoint.subjectHash, title: copy.title, facts: [],
        details: checkpoint.preview.data ? [{ label: 'What Carve does', value: checkpoint.preview.data }] : [],
        scope: copy.scope, approveLabel: copy.approveLabel, declineLabel: copy.declineLabel }
    }
    const protectedReason = protectedApprovalReason(checkpoint.effectClasses)
    // The card shows the exact actions and the window. "Why approval is needed" stays on the card when it
    // says something the reason sentence does not: the batch left the approved plan, its coverage is unclear,
    // or it reaches beyond the plan’s destinations. When a protected effect already names the reason under
    // the title, the generic policy sentence moves behind Details with the payload note and the follow-up check.
    const reasonAddsInformation = checkpoint.reasonCodes.some(code => ['scope_change', 'scope_unclear', 'external_effect_not_covered'].includes(code))
    const whyNow = checkpoint.preview.whyNow ? { label: 'Why approval is needed', value: checkpoint.preview.whyNow } : null
    const facts = [
      // While the app still holds the batch, the person sees the text Carve will type; after a restart only the record's counts remain.
      ...(livePreview?.actions.length ? [{ label: 'Actions', value: livePreview.actions.join('\n') }]
        : checkpoint.preview.what.includes('\n') ? [{ label: 'Actions', value: checkpoint.preview.what.split('\n').slice(1).join('\n') }] : []),
      ...(checkpoint.preview.where ? [{ label: 'Window', value: checkpoint.preview.where }] : []),
      ...(whyNow && (!protectedReason || reasonAddsInformation) ? [whyNow] : []),
    ]
    const details = [
      ...(checkpoint.preview.data ? [{ label: 'Information involved', value: checkpoint.preview.data }] : []),
      ...(whyNow && protectedReason && !reasonAddsInformation ? [whyNow] : []),
      ...(checkpoint.preview.verification ? [{ label: 'After approval', value: checkpoint.preview.verification }] : []),
    ]
    // A protected effect (send, buy, delete, sign in, consent) shows a plain reason and a fitting verb in
    // the capsule, with the full actions kept in the details; anything else keeps the neutral change wording.
    // Only an effect the capsule has no plain reason for still opens the full review.
    if (!protectedReason && checkpoint.effectClasses.some(effect => !['read_only', 'safe_local', 'reversible_local_write', 'unclassified_control'].includes(effect))) return null
    decision = protectedReason
      ? { kind: 'checkpoint', sessionId: universal.id, id: checkpoint.id, revision: checkpoint.subjectHash,
          title: protectedReason.title, facts, details, scope: protectedReason.scope, approveLabel: protectedReason.approveLabel, declineLabel: protectedReason.declineLabel, effect: protectedReason.effect }
      : { kind: 'checkpoint', sessionId: universal.id, id: checkpoint.id, revision: checkpoint.subjectHash,
          title: checkpoint.preview.what.split('\n')[0]!, facts, details,
          scope: 'Approves this change and its preparation only.', approveLabel: 'Approve change' }
  } else if (live?.status === 'awaiting_approval' && live.pendingAction && ['immediate', 'group'].includes(live.pendingApproval?.kind ?? '')) {
    const action = live.pendingAction
    // Typed payloads, submits and high-risk actions require the full review.
    if (!['move', 'scroll', 'wait', 'click', 'element_action'].includes(action.kind)
      || !['read_only', 'safe', 'reversible_write'].includes(action.risk)
      || action.submitPoint || action.text || action.key || action.command || action.artifactId || action.filePath) return null
    decision = { kind: 'action', sessionId: live.id, id: action.id, revision: live.missionPlan.hash,
      title: action.summary, facts: [
        { label: 'Window', value: `${live.target.application} — ${live.target.title}` },
        { label: 'Target', value: action.targetLabel ?? action.kind },
        { label: 'Expected result', value: action.expectedState },
      ], scope: live.pendingApproval?.kind === 'group' ? 'Allows the steps for this part of your task. Carve will ask again before starting the next part.' : 'Approves this exact action only.',
      approveLabel: live.pendingApproval?.kind === 'group' ? 'Approve this part' : 'Allow this action' }
  }
  if (!decision) return null
  const copy = [decision.title, decision.scope, ...decision.facts.map(fact => fact.value), ...(decision.details ?? []).map(fact => fact.value)]
  if (decision.kind === 'checkpoint') return decision // Complete facts scroll inside the capsule; approval identity is unchanged.
  return copy.some(value => value.length > 350) || copy.join('').length > 1000 ? null : decision
}

export function matchesCapsuleDecision(decision: CapsuleDecision | null, command: { sessionId: string; id: string; revision: string }): boolean {
  return Boolean(decision && decision.kind !== 'review' && decision.sessionId === command.sessionId && decision.id === command.id && decision.revision === command.revision)
}
