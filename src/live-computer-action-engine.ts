import type { ComputerActionProposal, ComputerActionResponse } from './providers/types.js'
import type {
  ActionRisk,
  LiveComputerAction,
  LiveComputerActionEngine,
  LiveComputerElement,
  LiveComputerFrame,
  LiveComputerObjective,
  LiveComputerSession,
} from './types.js'
import { activeLiveComputerObjective, canonicalLiveComputerRoute } from './live-computer-planning.js'
import { LiveComputerActionContractError, liveComputerElementSupportsTextEntry, liveComputerObjectiveSupportsFieldSubmit, liveComputerPointRegion, translateProviderNavigationKeys } from './live-computer-action-contract.js'
import { id } from './util.js'

export const defaultLiveComputerActionEngine: LiveComputerActionEngine = 'structured_v1'
export const initialComputerActionMaxOutputTokens = 4_096
export const maximumComputerActionMaxOutputTokens = 12_288

/** Responses API output ceilings include hidden reasoning as well as visible
 * tool-call output. Grow once from actual metered exhaustion, while retaining
 * a hard per-response bound beneath the run-level token budget. */
export function nextComputerActionMaxOutputTokens(
  current: number,
  observedOutputTokens: number | null,
): number {
  const observed = observedOutputTokens === null || !Number.isFinite(observedOutputTokens)
    ? current
    : Math.max(current, Math.ceil(observedOutputTokens))
  const adaptive = Math.ceil(Math.max(current * 2, observed * 1.5) / 256) * 256
  return Math.min(maximumComputerActionMaxOutputTokens, adaptive)
}

export function parseLiveComputerActionEngine(value: string | null | undefined): LiveComputerActionEngine {
  return value === 'openai_computer_v1' || value === 'openai_thin_v1' || value === 'openai_universal_v1' || value === 'compact_v1' || value === 'router_v1'
    ? value
    : defaultLiveComputerActionEngine
}

export type ComputerActionCompileStage = 'binding' | 'policy' | 'capability' | 'unsupported' | 'grounding' | 'terminal'

export type ComputerActionPointRegion =
  | 'outside_frame'
  | 'observed_content'
  | 'observed_chrome'
  | 'definite_chrome'
  | 'ambiguous_top'
  | 'likely_content'

export interface ComputerActionCompileDiagnostics {
  pointRegion?: ComputerActionPointRegion
  contentBoundsAvailable?: boolean
  ambiguousPointAccepted?: boolean
}

export class ComputerActionCompileError extends Error {
  constructor(
    readonly stage: ComputerActionCompileStage,
    message: string,
    readonly diagnostics: ComputerActionCompileDiagnostics = {},
  ) {
    super(message)
    this.name = 'ComputerActionCompileError'
  }
}

export interface CompiledComputerAction {
  action: LiveComputerAction
  returnedActions: number
  consumedActions: number
  transactionKind: 'single' | 'focus_type' | 'focus_type_submit' | 'focus_replace_type' | 'focus_replace_type_submit'
}

interface CompileInput {
  response: ComputerActionResponse
  session: LiveComputerSession
  frame: LiveComputerFrame
  elements: LiveComputerElement[]
}

const readOnlyObjectiveKinds = new Set<LiveComputerObjective['kind']>([
  'establish_route',
  'enter_query',
  'open_matching_resource',
  'choose_resource',
  'open_related_content',
  'scroll_to_target',
  'extract_information',
  'scroll_to_boundary',
  'verify_outcome',
])
const protectedControlPattern = /\b(?:buy|purchase|checkout|pay|subscribe|send|submit|save|delete|remove|install|download|upload|allow|authorize|permission|sign\s?in|log\s?in|password|credential|one[- ]?time|otp)\b/iu
const browserPattern = /\b(?:browser|chrome|chromium|safari|firefox|edge|arc)\b/iu
const explicitBrowserChromeControlPattern = /\b(?:address|location|url)\s*(?:and\s+search\s*)?(?:bar|field)|\bomnibox\b|\btab\s*(?:strip|bar)\b|\bbookmarks?\s+bar\b|\bbrowser\s+toolbar\b/iu

function pointInside(
  point: { x: number; y: number },
  bounds: NonNullable<LiveComputerElement['bounds']>,
): boolean {
  return point.x >= bounds.x && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height
}

function center(bounds: NonNullable<LiveComputerElement['bounds']>): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function elementLabel(element: LiveComputerElement | null): string | null {
  if (!element) return null
  const value = element.name || element.placeholder || element.description || element.help || element.identifier || element.role
  return value.trim().slice(0, 240) || null
}

function matchedElement(elements: LiveComputerElement[], point: { x: number; y: number }): LiveComputerElement | null {
  const candidates = elements
    .filter((element) => !element.sensitive && element.bounds && pointInside(point, element.bounds))
    .sort((left, right) => {
      const leftArea = (left.bounds?.width ?? Number.MAX_SAFE_INTEGER) * (left.bounds?.height ?? Number.MAX_SAFE_INTEGER)
      const rightArea = (right.bounds?.width ?? Number.MAX_SAFE_INTEGER) * (right.bounds?.height ?? Number.MAX_SAFE_INTEGER)
      return leftArea - rightArea
    })
  return candidates[0] ?? null
}

function matchedEditableElement(elements: LiveComputerElement[], point: { x: number; y: number }): LiveComputerElement | null {
  const candidates = elements
    .filter((element) => !element.sensitive && element.enabled !== false && element.bounds
      && liveComputerElementSupportsTextEntry(element) && pointInside(point, element.bounds))
    .sort((left, right) => {
      const leftArea = (left.bounds?.width ?? Number.MAX_SAFE_INTEGER) * (left.bounds?.height ?? Number.MAX_SAFE_INTEGER)
      const rightArea = (right.bounds?.width ?? Number.MAX_SAFE_INTEGER) * (right.bounds?.height ?? Number.MAX_SAFE_INTEGER)
      return leftArea - rightArea
    })
  return candidates[0] ?? null
}

function requireNoModifiers(action: Extract<ComputerActionProposal, { modifiers: unknown }>): void {
  if (action.modifiers.length > 0) {
    throw new ComputerActionCompileError('unsupported', 'Modified pointer actions are outside the experimental read-only compiler')
  }
}

function canonicalShortcutKey(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s_-]+/gu, '')
  if (compact === 'CMD' || compact === 'COMMAND') return 'META'
  if (compact === 'CONTROL') return 'CTRL'
  return compact
}

/** The provider may serialize a shortcut as one chord (`CMD+A`) or as the
 * two members of that chord (`CMD`, `A`). Recognize only the platform-neutral
 * select-all variants. The shortcut itself is never forwarded: the governed
 * type-into controller regenerates SELECT_ALL only after proving field focus. */
function isSelectAllKeypress(action: ComputerActionProposal | undefined): action is Extract<ComputerActionProposal, { kind: 'keypress' }> {
  if (action?.kind !== 'keypress') return false
  const keys = action.keys
    .flatMap((key) => key.split('+'))
    .map(canonicalShortcutKey)
    .filter(Boolean)
  return keys.length === 2
    && keys[1] === 'A'
    && (keys[0] === 'META' || keys[0] === 'CTRL')
}

function commonAction(
  session: LiveComputerSession,
  frame: LiveComputerFrame,
  objective: LiveComputerObjective,
  input: {
    kind: LiveComputerAction['kind']
    summary: string
    risk: ActionRisk
    point?: LiveComputerAction['point']
    target?: LiveComputerElement | null
    groundingSource?: NonNullable<LiveComputerAction['groundingSource']>
  },
): LiveComputerAction {
  const route = canonicalLiveComputerRoute(
    session.ledger.routeKey
      || session.ledger.interactionState.navigationIntent
      || `${session.target.application} selected-window route`,
  )
  return {
    id: id('computer_action'),
    kind: input.kind,
    objectiveId: objective.id,
    route,
    surface: 'web_page',
    operation: input.kind === 'scroll' ? 'scroll'
      : input.kind === 'wait' ? 'wait'
        : input.kind === 'type_into' ? 'query'
          : input.kind === 'keypress' ? 'inspect'
            : 'select',
    resourcePhase: session.ledger.interactionState.resourcePhase,
    replanReason: null,
    summary: input.summary.slice(0, 500),
    targetLabel: elementLabel(input.target ?? null),
    targetElementId: input.target?.id ?? null,
    targetWindowId: null,
    handoffCause: null,
    expectedState: objective.targetState,
    // Only the verifier may establish completion.
    completesObjective: false,
    point: input.point ?? null,
    submitPoint: null,
    submitTargetElementId: null,
    submitTargetLabel: null,
    endPoint: null,
    elementAction: null,
    scrollY: null,
    scrollIntent: null,
    text: null,
    conclusion: null,
    artifact: null,
    artifactId: null,
    key: null,
    replaceExisting: false,
    confidence: input.groundingSource === 'semantic_element' ? 1 : 0.8,
    risk: input.risk,
    requiresConfirmation: true,
    proposalSource: 'openai_computer',
    groundingSource: input.groundingSource ?? 'not_applicable',
    proposalFrameId: frame.id,
    proposalFrameSha256: frame.sha256,
    providerCallId: null,
  }
}

function assertTypedText(text: string): void {
  if (!text.trim() || text.length > 1_000) {
    throw new ComputerActionCompileError('policy', 'Typed text must contain one to 1,000 characters')
  }
  if (protectedControlPattern.test(text)) {
    throw new ComputerActionCompileError('policy', 'Typed text resembles a protected credential or consequential instruction')
  }
}

function assertReadOnlyPilot(session: LiveComputerSession, objective: LiveComputerObjective): void {
  if (!browserPattern.test(`${session.target.application} ${session.target.bundleIdentifier}`)) {
    throw new ComputerActionCompileError('capability', 'OpenAI computer actions are currently limited to an explicitly selected browser window')
  }
  if (session.targets.length !== 1 || session.targets[0]?.authority !== 'input') {
    throw new ComputerActionCompileError('capability', 'OpenAI computer actions currently require one selected input-authorized window')
  }
  if (!readOnlyObjectiveKinds.has(objective.kind)) {
    throw new ComputerActionCompileError('policy', `The experimental computer-action engine will not execute ${objective.kind} objectives`)
  }
}

/** Classify a provider point using the strongest evidence available. AX web
 * bounds are authoritative. Without them, only the top 72 points are treated
 * as definite browser chrome; the remainder of the old fixed band is
 * explicitly uncertain rather than mislabeled as a policy violation. */
export function computerActionPointRegion(
  frame: LiveComputerFrame,
  point: { x: number; y: number },
): ComputerActionPointRegion {
  return liveComputerPointRegion(frame, point)
}

function assertInPagePoint(
  frame: LiveComputerFrame,
  point: { x: number; y: number },
  options: { allowAmbiguousTop?: boolean } = {},
): void {
  const pointRegion = computerActionPointRegion(frame, point)
  const diagnostics: ComputerActionCompileDiagnostics = {
    pointRegion,
    contentBoundsAvailable: Boolean(frame.contentBounds),
    ambiguousPointAccepted: pointRegion === 'ambiguous_top' && options.allowAmbiguousTop === true,
  }
  if (pointRegion === 'outside_frame') {
    throw new ComputerActionCompileError(
      'binding',
      'The provider action lies outside the bound selected-window frame',
      diagnostics,
    )
  }
  if (pointRegion === 'observed_chrome') {
    throw new ComputerActionCompileError(
      'policy',
      'The experimental action targets browser chrome rather than the platform-observed page content',
      diagnostics,
    )
  }
  if (pointRegion === 'definite_chrome') {
    throw new ComputerActionCompileError(
      'policy',
      'The experimental action targets browser chrome rather than in-page content',
      diagnostics,
    )
  }
  if (pointRegion === 'ambiguous_top' && !options.allowAmbiguousTop) {
    throw new ComputerActionCompileError(
      'grounding',
      'The page boundary is unavailable and the proposed point lies in the ambiguous top region; refresh grounding before sending input',
      diagnostics,
    )
  }
}

function assertSafeTarget(target: LiveComputerElement | null): void {
  if (!target) return
  const label = elementLabel(target) ?? ''
  if (explicitBrowserChromeControlPattern.test(label)) {
    throw new ComputerActionCompileError('policy', `The proposed control “${label.slice(0, 80)}” is browser chrome rather than page content`)
  }
  if (protectedControlPattern.test(label)) {
    throw new ComputerActionCompileError('policy', `The proposed control “${label.slice(0, 80)}” is outside the read-only pilot`)
  }
}

function compileTerminal(
  response: ComputerActionResponse,
  session: LiveComputerSession,
  frame: LiveComputerFrame,
  objective: LiveComputerObjective,
): LiveComputerAction {
  const terminal = response.terminalText?.trim() ?? ''
  if (!terminal) throw new ComputerActionCompileError('terminal', 'The provider returned neither a computer action nor a terminal result')
  if (!['extract_information', 'verify_outcome'].includes(objective.kind)) {
    throw new ComputerActionCompileError('terminal', 'The provider stopped before the active visible-state objective was verified')
  }
  if (terminal.length > 2_000) throw new ComputerActionCompileError('terminal', 'The provider terminal result exceeds Carve’s bounded conclusion limit')
  const action = commonAction(session, frame, objective, {
    kind: 'conclude', summary: 'Verify the provider’s grounded read-only conclusion', risk: 'read_only',
  })
  action.operation = 'conclude'
  action.conclusion = terminal
  action.providerCallId = response.callId
  return action
}

function compileOne(
  proposal: ComputerActionProposal,
  response: ComputerActionResponse,
  session: LiveComputerSession,
  frame: LiveComputerFrame,
  objective: LiveComputerObjective,
  elements: LiveComputerElement[],
): LiveComputerAction {
  if (proposal.kind === 'screenshot') {
    const action = commonAction(session, frame, objective, {
      kind: 'wait', summary: 'Refresh the selected-window observation', risk: 'read_only',
    })
    action.providerCallId = response.callId
    return action
  }
  if (proposal.kind === 'wait') {
    const action = commonAction(session, frame, objective, {
      kind: 'wait', summary: 'Wait briefly for the selected window to settle', risk: 'read_only',
    })
    action.providerCallId = response.callId
    return action
  }
  if (proposal.kind === 'double_click') {
    throw new ComputerActionCompileError('unsupported', 'Double-click is not enabled in the experimental read-only compiler')
  }
  if (proposal.kind === 'type') {
    if (!liveComputerObjectiveSupportsFieldSubmit(objective.kind)) {
      throw new ComputerActionCompileError('policy', `Typing is not enabled for the active ${objective.kind} objective`)
    }
    const focused = elements.filter((element) => !element.sensitive && element.bounds
      && element.focused === true && (element.editable === true || element.focusable === true))
    if (focused.length !== 1) {
      throw new ComputerActionCompileError('grounding', 'Typing requires exactly one controller-observed focused editable element')
    }
    const target = focused[0]!
    const point = center(target.bounds!)
    assertInPagePoint(frame, point)
    assertTypedText(proposal.text)
    const action = commonAction(session, frame, objective, {
      kind: 'type_into', summary: `Enter the approved ${objective.kind === 'enter_query' ? 'search identity' : 'navigation text'}`,
      risk: 'safe', point, target, groundingSource: 'semantic_element',
    })
    action.text = proposal.text
    action.replaceExisting = objective.kind === 'enter_query'
    action.providerCallId = response.callId
    return action
  }
  if (proposal.kind === 'keypress') {
    let translated
    try {
      translated = translateProviderNavigationKeys(proposal.keys, objective.kind, frame.height)
    } catch (error) {
      if (error instanceof LiveComputerActionContractError) {
        throw new ComputerActionCompileError(error.stage, error.message)
      }
      throw error
    }
    const action = commonAction(session, frame, objective, translated.kind === 'scroll'
      ? { kind: 'scroll', summary: translated.summary, risk: 'read_only', groundingSource: 'not_applicable' }
      : { kind: 'keypress', summary: 'Use one safe navigation key', risk: 'safe', groundingSource: 'not_applicable' })
    if (translated.kind === 'scroll') {
      action.scrollY = translated.scrollY
      action.scrollIntent = translated.scrollIntent
    } else {
      action.key = translated.key
    }
    action.providerCallId = response.callId
    return action
  }
  if (proposal.kind === 'scroll') {
    requireNoModifiers(proposal)
    assertInPagePoint(frame, proposal.point)
    if (Math.abs(proposal.deltaX) > 1) throw new ComputerActionCompileError('unsupported', 'Horizontal scrolling is not enabled in the experimental compiler')
    if (!Number.isFinite(proposal.deltaY) || Math.abs(proposal.deltaY) < 1 || Math.abs(proposal.deltaY) > 2_000) {
      throw new ComputerActionCompileError('policy', 'The proposed vertical scroll is outside Carve’s bounded range')
    }
    const action = commonAction(session, frame, objective, {
      kind: 'scroll', summary: 'Scroll within the approved page', risk: 'read_only', point: proposal.point,
      // A scroll coordinate identifies the receiving surface, not a semantic
      // control. Binding the AX element under that point made the compiler emit
      // a contract the selected-window preflight correctly refuses.
      groundingSource: 'provider_visual',
    })
    action.scrollY = proposal.deltaY
    action.scrollIntent = 'viewport'
    action.providerCallId = response.callId
    return action
  }
  if (proposal.kind === 'drag') {
    requireNoModifiers(proposal)
    const start = proposal.path[0]
    const end = proposal.path.at(-1)
    if (!start || !end) throw new ComputerActionCompileError('binding', 'A drag needs bounded start and end points')
    proposal.path.forEach((point) => assertInPagePoint(frame, point))
    const target = matchedElement(elements, start)
    assertSafeTarget(target)
    const action = commonAction(session, frame, objective, {
      kind: 'drag', summary: 'Drag one bounded in-page control', risk: 'safe', point: start,
      target, groundingSource: target ? 'semantic_element' : 'provider_visual',
    })
    action.endPoint = end
    action.providerCallId = response.callId
    return action
  }
  requireNoModifiers(proposal)
  assertInPagePoint(frame, proposal.point)
  const target = matchedElement(elements, proposal.point)
  assertSafeTarget(target)
  if (proposal.kind === 'click' && proposal.button !== 'left') {
    throw new ComputerActionCompileError('unsupported', 'Only a left click is enabled in the experimental read-only compiler')
  }
  const action = commonAction(session, frame, objective, {
    kind: proposal.kind,
    summary: proposal.kind === 'move' ? 'Move within the approved page' : 'Activate one approved in-page control',
    risk: proposal.kind === 'move' ? 'read_only' : 'safe',
    point: proposal.point,
    target,
    groundingSource: target ? 'semantic_element' : 'provider_visual',
  })
  action.providerCallId = response.callId
  return action
}

function compileFieldTransaction(
  proposals: ComputerActionProposal[],
  response: ComputerActionResponse,
  session: LiveComputerSession,
  frame: LiveComputerFrame,
  objective: LiveComputerObjective,
  elements: LiveComputerElement[],
): CompiledComputerAction | null {
  const focus = proposals[0]
  if (focus?.kind !== 'click') return null
  const explicitReplacement = isSelectAllKeypress(proposals[1])
  const typingIndex = explicitReplacement ? 2 : 1
  const typing = proposals[typingIndex]
  if (typing?.kind !== 'type') return null
  if (proposals.length < typingIndex + 1 || proposals.length > typingIndex + 2) return null
  if (!liveComputerObjectiveSupportsFieldSubmit(objective.kind)) {
    throw new ComputerActionCompileError('policy', `An ordered field transaction is not enabled for the active ${objective.kind} objective`)
  }
  requireNoModifiers(focus)
  if (focus.button !== 'left') {
    throw new ComputerActionCompileError('unsupported', 'Only a left click may focus a field in an ordered input transaction')
  }
  const field = matchedEditableElement(elements, focus.point)
  if (!field && elements.length > 0 && session.executionMode !== 'capability_vm_v1') {
    throw new ComputerActionCompileError('grounding', 'The ordered field transaction does not target an observed editable text control')
  }
  assertSafeTarget(field)
  const allowAmbiguousTop = session.executionMode === 'capability_vm_v1'
  assertInPagePoint(frame, focus.point, { allowAmbiguousTop })
  assertTypedText(typing.text)
  const submit = proposals[typingIndex + 1]
  const fieldDescription = objective.kind === 'enter_query' ? 'search identity' : 'navigation text'
  const action = commonAction(session, frame, objective, {
    kind: 'type_into',
    summary: submit
      ? `Focus, enter, and submit the approved ${fieldDescription}`
      : `Focus and enter the approved ${fieldDescription}`,
    risk: 'safe', point: focus.point, target: field,
    groundingSource: field ? 'semantic_element' : 'provider_visual',
  })
  action.text = typing.text
  action.replaceExisting = explicitReplacement || objective.kind === 'enter_query'
  action.providerCallId = response.callId

  if (submit?.kind === 'keypress') {
    if (submit.keys.length !== 1 || !['ENTER', 'RETURN'].includes(submit.keys[0]?.trim().toUpperCase() ?? '')) {
      throw new ComputerActionCompileError('unsupported', 'An ordered field transaction may end only with Enter, Return, or one validated submit click')
    }
    action.key = submit.keys[0]!.trim().toUpperCase()
  } else if (submit?.kind === 'click') {
    requireNoModifiers(submit)
    if (submit.button !== 'left') {
      throw new ComputerActionCompileError('unsupported', 'Only a left click may submit an ordered field transaction')
    }
    const submitTarget = matchedElement(elements, submit.point)
    assertSafeTarget(submitTarget)
    assertInPagePoint(frame, submit.point, { allowAmbiguousTop })
    action.submitPoint = submit.point
    action.submitTargetElementId = submitTarget?.id ?? null
    action.submitTargetLabel = elementLabel(submitTarget)
  } else if (submit) {
    throw new ComputerActionCompileError('unsupported', 'The ordered field transaction has an unsupported submit action')
  }

  return {
    action,
    returnedActions: proposals.length,
    consumedActions: proposals.length,
    transactionKind: explicitReplacement
      ? submit ? 'focus_replace_type_submit' : 'focus_replace_type'
      : submit ? 'focus_type_submit' : 'focus_type',
  }
}

/** Compile a provider decision into one governed controller transaction. A
 * single action remains a single transaction. The only multi-action form is
 * the focus → optional select-all → type → optional submit sequence whose
 * intermediate focus state may be visually invisible. Select-all is collapsed
 * into the controller's local replacement primitive and regenerated only after
 * focus proof. Every member is validated before any member can execute;
 * unfamiliar batches fail closed instead of being truncated. */
export function compileComputerAction(input: CompileInput): CompiledComputerAction {
  const { response, session, frame, elements } = input
  if (response.providerId !== session.providerId) {
    throw new ComputerActionCompileError('binding', 'The computer action came from a provider outside this session')
  }
  if (response.evidenceId !== frame.id || response.frame.width !== frame.width || response.frame.height !== frame.height) {
    throw new ComputerActionCompileError('binding', 'The computer action is not bound to the current selected-window frame')
  }
  if (response.pendingSafetyChecks.length > 0) {
    const messages = response.pendingSafetyChecks.map((check) => check.message.trim()).filter(Boolean).slice(0, 3)
    throw new ComputerActionCompileError(
      'policy',
      `The provider requested a safety review; Carve did not acknowledge it and sent no input.${messages.length > 0 ? ` Review: ${messages.join(' ')}` : ''}`.slice(0, 1_200),
    )
  }
  const objective = activeLiveComputerObjective(session.ledger)
  if (!objective) throw new ComputerActionCompileError('terminal', 'No active objective is available for another provider action')
  assertReadOnlyPilot(session, objective)
  if (response.actions.length > 1) {
    const transaction = compileFieldTransaction(response.actions, response, session, frame, objective, elements)
    if (transaction) return transaction
    throw new ComputerActionCompileError(
      'unsupported',
      `The provider returned an unsupported ordered batch of ${response.actions.length} actions; Carve sent no input rather than silently dropping actions`,
    )
  }
  const first = response.actions[0]
  const action = first
    ? compileOne(first, response, session, frame, objective, elements)
    : compileTerminal(response, session, frame, objective)
  return { action, returnedActions: response.actions.length, consumedActions: response.actions.length, transactionKind: 'single' }
}
