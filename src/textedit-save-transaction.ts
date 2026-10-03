import { Buffer } from 'node:buffer'
import type {
  ApplicationOperationIdentityEvidence,
  ApplicationOperationPhaseReceipt,
  ApplicationOperationTransactionPhase,
  ApplicationOperationTransactionReceipt,
} from './types.js'
import { applicationOperationFailure } from './application-operation-transaction.js'
import { sha256, stableJson } from './util.js'

export interface TextEditSaveReplayElement {
  id: string
  role: string
  label: string
  /** Text from the control's AXTitleUIElement relationship. AppKit save
   * fields often carry “Save As:” here rather than on the field itself. */
  titleElementText?: string | null
  description?: string | null
  identifier?: string | null
  value?: string | null
  settable?: boolean
  /** True when the text node is descended from a selectable collection such
   * as a file-browser row, table, outline, or browser. AppKit exposes those
   * row labels as value-settable AXTextFields even though they are not form
   * inputs. */
  selectableCollectionDescendant?: boolean
  enabled?: boolean
  focused?: boolean | null
  frame: { x: number; y: number; width: number; height: number }
}

export interface TextEditSaveReplayDialog {
  id: string
  stableIdentity: string
  role: 'AXWindow' | 'AXSheet' | 'AXDialog'
  title: string
  parentWindowIdentity: string
  frame: { x: number; y: number; width: number; height: number }
  elements: TextEditSaveReplayElement[]
}

export interface TextEditSaveReplayObservation {
  applicationAvailable: boolean
  bundleIdentifier: string
  windowId: number
  windowIdentity: string
  authorizedWindow: boolean
  documentContent: string | null
  dialogs: TextEditSaveReplayDialog[]
  output: {
    kind: 'absent' | 'regular_file' | 'directory' | 'other'
    content: string | null
    byteLength: number | null
    metadataAfterStart: boolean | null
  }
}

export type TextEditSaveReplayMutation =
  | { kind: 'request_save_dialog' }
  | { kind: 'set_filename'; elementId: string; value: string }
  | { kind: 'request_destination_dialog' }
  | { kind: 'set_destination'; elementId: string; value: string }
  | { kind: 'accept_destination'; dialogId: string }
  | { kind: 'commit_save'; elementId: string }

export interface TextEditSaveReplayDriver {
  observe(): TextEditSaveReplayObservation | null
  mutate(mutation: TextEditSaveReplayMutation): 'accepted' | 'rejected'
}

export interface TextEditSaveReplayRequest {
  transactionId: string
  windowId: number
  bundleIdentifier: 'com.apple.TextEdit'
  filePath: string
  filename: string
  directory: string
  parameterBindingsSha256: string
  maximumObservationsPerWait?: number
}

type Match<T> = { state: 'waiting' } | { state: 'matched'; value: T } | { state: 'ambiguous' }

const text = (element: TextEditSaveReplayElement): string => [
  element.label, element.titleElementText ?? '', element.description ?? '', element.identifier ?? '',
].join(' ').toLocaleLowerCase()

const hasFilenameSemantics = (element: TextEditSaveReplayElement): boolean => (
  /\b(?:save as|file ?name|name)\b|saveasnametextfield|namefieldlabel/iu.test(text(element))
)

const hasDestinationSemantics = (element: TextEditSaveReplayElement): boolean => (
  /\b(?:go to|folder|location|directory|path)\b|pathtextfield/iu.test(text(element))
)

/** Accessibility can return several proxy objects for one AppKit control.
 * Object identity is not durable across those proxies, but their physical hit
 * target is: two candidates are treated as aliases only when role and exact
 * observed geometry agree. Distinct hit targets remain ambiguous. */
const observableControlIdentity = (element: TextEditSaveReplayElement): string => stableJson({
  role: element.role,
  frame: element.frame,
})

function uniqueObservableControl<T extends TextEditSaveReplayElement>(matches: T[]): Match<T> {
  if (matches.length === 0) return { state: 'waiting' }
  const identities = new Map<string, T[]>()
  for (const candidate of matches) {
    const identity = observableControlIdentity(candidate)
    identities.set(identity, [...(identities.get(identity) ?? []), candidate])
  }
  if (identities.size !== 1) return { state: 'ambiguous' }
  return { state: 'matched', value: matches[0]! }
}

const exactButton = (element: TextEditSaveReplayElement, label: string): boolean => (
  element.role === 'AXButton' && element.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase()
)

const priorState = (kind: TextEditSaveReplayObservation['output']['kind']): ApplicationOperationTransactionReceipt['preconditions']['outputPriorState'] => (
  kind === 'absent' || kind === 'directory' ? kind : 'present'
)

function saveDialog(observation: TextEditSaveReplayObservation): Match<TextEditSaveReplayDialog> {
  const matches = observation.dialogs.filter((dialog) => dialog.parentWindowIdentity === observation.windowIdentity
    && dialog.elements.some((element) => exactButton(element, 'Save'))
    && dialog.elements.some((element) => element.role === 'AXTextField' && element.settable === true
      && element.selectableCollectionDescendant !== true
      && hasFilenameSemantics(element)))
  return matches.length === 0 ? { state: 'waiting' }
    : matches.length === 1 ? { state: 'matched', value: matches[0]! }
      : { state: 'ambiguous' }
}

function destinationDialog(observation: TextEditSaveReplayObservation): Match<TextEditSaveReplayDialog> {
  const matches = observation.dialogs.filter((dialog) => dialog.parentWindowIdentity === observation.windowIdentity
    && dialog.elements.some((element) => element.role === 'AXTextField' && element.settable === true
      && element.selectableCollectionDescendant !== true
      && hasDestinationSemantics(element)
      && !hasFilenameSemantics(element)))
  return matches.length === 0 ? { state: 'waiting' }
    : matches.length === 1 ? { state: 'matched', value: matches[0]! }
      : { state: 'ambiguous' }
}

function filenameField(dialog: TextEditSaveReplayDialog): Match<TextEditSaveReplayElement> {
  const matches = dialog.elements.filter((element) => element.role === 'AXTextField'
    && element.settable === true
    && element.selectableCollectionDescendant !== true
    && !/search/iu.test(`${element.role} ${text(element)}`)
    && hasFilenameSemantics(element)
    // The filename field belongs to the upper half of the save panel. This is
    // supporting identity evidence, never a focus-derived role guess.
    && element.frame.y < dialog.frame.y + dialog.frame.height * 0.65)
  return uniqueObservableControl(matches)
}

function filenameFieldAliasesReadBack(
  dialog: TextEditSaveReplayDialog,
  selected: TextEditSaveReplayElement,
  expected: string,
): boolean {
  const identity = observableControlIdentity(selected)
  return dialog.elements.filter((element) => element.role === 'AXTextField'
    && element.settable === true
    && element.selectableCollectionDescendant !== true
    && !/search/iu.test(`${element.role} ${text(element)}`)
    && hasFilenameSemantics(element)
    && element.frame.y < dialog.frame.y + dialog.frame.height * 0.65
    && observableControlIdentity(element) === identity)
    .every((element) => element.value === expected)
}

function destinationField(dialog: TextEditSaveReplayDialog): Match<TextEditSaveReplayElement> {
  const matches = dialog.elements.filter((element) => element.role === 'AXTextField'
    && element.settable === true
    && element.selectableCollectionDescendant !== true
    && hasDestinationSemantics(element)
    && !hasFilenameSemantics(element))
  return uniqueObservableControl(matches)
}

function destinationFieldAliasesReadBack(
  dialog: TextEditSaveReplayDialog,
  selected: TextEditSaveReplayElement,
  expected: string,
): boolean {
  const identity = observableControlIdentity(selected)
  return dialog.elements.filter((element) => element.role === 'AXTextField'
    && element.settable === true
    && element.selectableCollectionDescendant !== true
    && hasDestinationSemantics(element)
    && !hasFilenameSemantics(element)
    && observableControlIdentity(element) === identity)
    .every((element) => element.value === expected)
}

function commitButton(dialog: TextEditSaveReplayDialog): Match<TextEditSaveReplayElement> {
  const matches = dialog.elements.filter((element) => exactButton(element, 'Save') && element.enabled === true)
  return matches.length === 0 ? { state: 'waiting' }
    : matches.length === 1 ? { state: 'matched', value: matches[0]! }
      : { state: 'ambiguous' }
}

class TransactionRecorder {
  readonly phases: ApplicationOperationPhaseReceipt[] = []
  observations = 0
  commitAttempted = false
  commitAccepted = false
  private currentPhase: ApplicationOperationTransactionPhase = 'prepared'

  constructor(readonly request: TextEditSaveReplayRequest, readonly startedAtMs: number, readonly expectedContentSha256: string | null) {}

  identity(observation: TextEditSaveReplayObservation, dialog?: TextEditSaveReplayDialog | null, element?: TextEditSaveReplayElement | null): ApplicationOperationIdentityEvidence {
    return {
      applicationSha256: sha256(observation.bundleIdentifier),
      windowSha256: sha256(`${observation.windowId}:${observation.windowIdentity}`),
      containerSha256: dialog ? sha256(`${dialog.parentWindowIdentity}:${dialog.stableIdentity}:${dialog.role}:${dialog.title}:${stableJson(dialog.frame)}`) : null,
      elementSha256: element ? sha256(`${dialog?.stableIdentity ?? ''}:${element.role}:${element.label}:${element.titleElementText ?? ''}:${element.description ?? ''}:${element.identifier ?? ''}:${stableJson(element.frame)}`) : null,
    }
  }

  record(
    phase: ApplicationOperationTransactionPhase,
    observation: TextEditSaveReplayObservation,
    state: ApplicationOperationPhaseReceipt['state'],
    mutation: ApplicationOperationPhaseReceipt['mutation'] = 'none',
    dialog?: TextEditSaveReplayDialog | null,
    element?: TextEditSaveReplayElement | null,
    readback?: string | null,
  ): void {
    this.currentPhase = phase
    this.phases.push({
      phase,
      observation: this.observations,
      mutation,
      state,
      identity: this.identity(observation, dialog, element),
      readbackSha256: readback === undefined || readback === null ? null : sha256(readback),
    })
  }

  failure(
    code: NonNullable<ApplicationOperationTransactionReceipt['failure']>['code'],
    message: string,
    observation: TextEditSaveReplayObservation,
    outputPriorState: ApplicationOperationTransactionReceipt['preconditions']['outputPriorState'],
    expectedContentSha256: string | null,
  ): ApplicationOperationTransactionReceipt {
    const effectMayHaveOccurred = this.commitAccepted
    const failure = applicationOperationFailure({
      code,
      phase: this.currentPhase,
      message,
      commitAttempted: this.commitAttempted,
      effectMayHaveOccurred,
      evidenceKey: `${this.observations}:${observation.windowIdentity}:${observation.output.kind}`,
    })
    this.record('failed', observation, code.includes('ambiguous') ? 'ambiguous' : 'rejected')
    return this.receipt(
      effectMayHaveOccurred ? 'uncertain' : 'failed',
      'failed',
      observation,
      outputPriorState,
      expectedContentSha256,
      failure,
    )
  }

  success(observation: TextEditSaveReplayObservation): ApplicationOperationTransactionReceipt {
    this.record('postcondition_verified', observation, 'matched', 'post_commit_observe', null, null, observation.output.content)
    this.record('completed', observation, 'established')
    return this.receipt('completed', 'completed', observation, 'absent', this.expectedContentSha256, null)
  }

  private receipt(
    status: ApplicationOperationTransactionReceipt['status'],
    phase: ApplicationOperationTransactionPhase,
    observation: TextEditSaveReplayObservation,
    outputPriorState: ApplicationOperationTransactionReceipt['preconditions']['outputPriorState'],
    expectedContentSha256: string | null,
    failure: ApplicationOperationTransactionReceipt['failure'],
  ): ApplicationOperationTransactionReceipt {
    const targetSha256 = sha256(this.request.filePath)
    const replayAllowed = failure?.retryEligibility === 'safe_phase_retry'
    return {
      version: 1,
      transactionId: this.request.transactionId,
      operationId: 'text_document.save_new',
      adapterId: 'macos.textedit.save_new',
      adapterVersion: 1,
      capability: 'text_document.save_new',
      status,
      phase,
      parameterBindingsSha256: this.request.parameterBindingsSha256,
      authorizedEffect: { kind: 'local_write', targetSha256, overwriteAuthorized: false },
      target: {
        bundleIdentifierSha256: sha256(this.request.bundleIdentifier),
        windowId: this.request.windowId,
        identity: this.identity(observation),
      },
      preconditions: {
        established: outputPriorState === 'absent' && expectedContentSha256 !== null,
        outputPriorState,
        expectedContentSha256,
        startedAtMs: this.startedAtMs,
      },
      phases: this.phases,
      commit: {
        attempted: this.commitAttempted,
        accepted: this.commitAccepted,
        attemptCount: this.commitAttempted ? 1 : 0,
        effectMayHaveOccurred: this.commitAccepted,
      },
      idempotency: {
        keySha256: sha256(`${this.request.transactionId}:${targetSha256}`),
        duplicateEffectRisk: status === 'completed' || !this.commitAccepted ? 'none' : 'possible',
        replayAllowed,
      },
      postcondition: {
        kind: 'exact_new_file',
        satisfied: status === 'completed',
        observations: this.observations,
        targetSha256,
        outputKind: observation.output.kind,
        contentSha256: observation.output.content === null ? null : sha256(observation.output.content),
        byteLength: observation.output.byteLength,
        metadataAfterStart: observation.output.metadataAfterStart,
      },
      failure,
    }
  }
}

/** Deterministic transcript runner for adapter engineering tests. It follows
 * the same transaction phases as the native TextEdit adapter but has no GUI
 * side effects, allowing stale/nil/ambiguous Accessibility states and delayed
 * filesystem visibility to be replayed exactly. */
export function replayTextEditSaveTransaction(
  request: TextEditSaveReplayRequest,
  driver: TextEditSaveReplayDriver,
): ApplicationOperationTransactionReceipt {
  const maximum = request.maximumObservationsPerWait ?? 4
  let current = driver.observe()
  const startedAtMs = Date.now()
  const recorder = new TransactionRecorder(request, startedAtMs, current?.documentContent === null || current?.documentContent === undefined ? null : sha256(current.documentContent))

  const unavailable = (): ApplicationOperationTransactionReceipt => {
    const fallback: TextEditSaveReplayObservation = current ?? {
      applicationAvailable: false, bundleIdentifier: request.bundleIdentifier, windowId: request.windowId,
      windowIdentity: 'unavailable', authorizedWindow: false, documentContent: null, dialogs: [],
      output: { kind: 'absent', content: null, byteLength: null, metadataAfterStart: null },
    }
    return recorder.failure('environment_unavailable', 'The application or Accessibility environment is unavailable.', fallback, 'unknown', recorder.expectedContentSha256)
  }
  if (!current) return unavailable()
  recorder.observations += 1
  recorder.record('prepared', current, 'established')
  if (!current.applicationAvailable) return unavailable()
  if (current.bundleIdentifier !== request.bundleIdentifier || current.windowId !== request.windowId || !current.authorizedWindow) {
    return recorder.failure('authorized_window_lost', 'The authorized TextEdit window could not be reidentified.', current, priorState(current.output.kind), recorder.expectedContentSha256)
  }
  if (current.output.kind !== 'absent') {
    return recorder.failure('authority_safety_violation', 'The exact output path was not absent at transaction start; overwrite is not authorized.', current, priorState(current.output.kind), recorder.expectedContentSha256)
  }
  if (current.documentContent === null) {
    return recorder.failure('precondition_not_established', 'The authorized document content could not be read before save.', current, 'absent', null)
  }
  recorder.record('preconditions_established', current, 'established', 'none', null, null, current.documentContent)

  const observeUntil = <T>(phase: ApplicationOperationTransactionPhase, match: (observation: TextEditSaveReplayObservation) => Match<T>): { observation: TextEditSaveReplayObservation; value: T } | ApplicationOperationTransactionReceipt => {
    for (let index = 0; index < maximum; index += 1) {
      const observation = driver.observe()
      if (!observation) return unavailable()
      current = observation
      recorder.observations += 1
      if (!observation.applicationAvailable) return unavailable()
      if (observation.windowId !== request.windowId || observation.bundleIdentifier !== request.bundleIdentifier || !observation.authorizedWindow) {
        return recorder.failure('authorized_window_lost', 'The authorized TextEdit window changed during the transaction.', observation, 'absent', recorder.expectedContentSha256)
      }
      const result = match(observation)
      if (result.state === 'ambiguous') {
        recorder.record(phase, observation, 'ambiguous')
        return recorder.failure(phase.includes('ui') ? 'dialog_identity_ambiguous' : 'element_identity_ambiguous', 'Accessibility exposed more than one equally valid transaction target.', observation, 'absent', recorder.expectedContentSha256)
      }
      if (result.state === 'matched') return { observation, value: result.value }
    }
    recorder.record(phase, current!, 'timed_out')
    return recorder.failure(phase.includes('ui') ? 'dialog_not_found' : 'precondition_not_established', 'The expected Accessibility transition did not appear within the bounded observation window.', current!, 'absent', recorder.expectedContentSha256)
  }

  if (driver.mutate({ kind: 'request_save_dialog' }) === 'rejected') {
    return recorder.failure('commit_not_attempted', 'TextEdit rejected the request to open its Save dialog.', current, 'absent', recorder.expectedContentSha256)
  }
  recorder.record('effect_ui_requested', current, 'changed', 'pre_commit')
  const initialPanel = observeUntil('effect_ui_identified', saveDialog)
  if ('status' in initialPanel) return initialPanel
  recorder.record('effect_ui_identified', initialPanel.observation, 'established', 'none', initialPanel.value)
  const initialName = filenameField(initialPanel.value)
  if (initialName.state !== 'matched') {
    recorder.record('primary_field_identified', initialPanel.observation, initialName.state === 'ambiguous' ? 'ambiguous' : 'timed_out', 'none', initialPanel.value)
    return recorder.failure(initialName.state === 'ambiguous' ? 'element_identity_ambiguous' : 'precondition_not_established', 'The Save As filename field was not uniquely identified.', initialPanel.observation, 'absent', recorder.expectedContentSha256)
  }
  recorder.record('primary_field_identified', initialPanel.observation, 'established', 'none', initialPanel.value, initialName.value)
  if (driver.mutate({ kind: 'set_filename', elementId: initialName.value.id, value: request.filename }) === 'rejected') {
    return recorder.failure('field_mutation_rejected', 'The filename field rejected mutation.', initialPanel.observation, 'absent', recorder.expectedContentSha256)
  }
  const named = observeUntil('primary_field_verified', (observation) => {
    const panel = saveDialog(observation)
    if (panel.state !== 'matched') return panel.state === 'ambiguous' ? { state: 'ambiguous' } : { state: 'waiting' }
    const field = filenameField(panel.value)
    if (field.state !== 'matched') return field.state === 'ambiguous' ? { state: 'ambiguous' } : { state: 'waiting' }
    return filenameFieldAliasesReadBack(panel.value, field.value, request.filename)
      ? { state: 'matched', value: { panel: panel.value, field: field.value } }
      : { state: 'waiting' }
  })
  if ('status' in named) return named.failure?.code === 'precondition_not_established'
    ? recorder.failure('field_readback_mismatch', 'The filename read-back did not match the controller-owned filename.', current!, 'absent', recorder.expectedContentSha256)
    : named
  recorder.record('primary_field_verified', named.observation, 'matched', 'pre_commit', named.value.panel, named.value.field, named.value.field.value)

  if (driver.mutate({ kind: 'request_destination_dialog' }) === 'rejected') {
    return recorder.failure('commit_not_attempted', 'TextEdit rejected the destination chooser request.', named.observation, 'absent', recorder.expectedContentSha256)
  }
  recorder.record('destination_ui_requested', named.observation, 'changed', 'pre_commit', named.value.panel)
  const destination = observeUntil('destination_ui_identified', destinationDialog)
  if ('status' in destination) return destination
  recorder.record('destination_ui_identified', destination.observation, 'established', 'none', destination.value)
  const folder = destinationField(destination.value)
  if (folder.state !== 'matched') {
    recorder.record('destination_ui_identified', destination.observation, folder.state === 'ambiguous' ? 'ambiguous' : 'timed_out', 'none', destination.value)
    return recorder.failure(folder.state === 'ambiguous' ? 'element_identity_ambiguous' : 'precondition_not_established', 'The destination field was not uniquely identified inside the destination dialog.', destination.observation, 'absent', recorder.expectedContentSha256)
  }
  if (driver.mutate({ kind: 'set_destination', elementId: folder.value.id, value: request.directory }) === 'rejected') {
    return recorder.failure('field_mutation_rejected', 'The destination field rejected mutation.', destination.observation, 'absent', recorder.expectedContentSha256)
  }
  const directorySet = observeUntil('destination_field_verified', (observation) => {
    const dialog = destinationDialog(observation)
    if (dialog.state !== 'matched') return dialog.state === 'ambiguous' ? { state: 'ambiguous' } : { state: 'waiting' }
    const field = destinationField(dialog.value)
    if (field.state !== 'matched') return field.state === 'ambiguous' ? { state: 'ambiguous' } : { state: 'waiting' }
    return destinationFieldAliasesReadBack(dialog.value, field.value, request.directory)
      ? { state: 'matched', value: { dialog: dialog.value, field: field.value } }
      : { state: 'waiting' }
  })
  if ('status' in directorySet) return directorySet.failure?.code === 'precondition_not_established'
    ? recorder.failure('field_readback_mismatch', 'The destination read-back did not match the controller-owned directory.', current!, 'absent', recorder.expectedContentSha256)
    : directorySet
  recorder.record('destination_field_verified', directorySet.observation, 'matched', 'pre_commit', directorySet.value.dialog, directorySet.value.field, directorySet.value.field.value)
  if (driver.mutate({ kind: 'accept_destination', dialogId: directorySet.value.dialog.id }) === 'rejected') {
    return recorder.failure('commit_not_attempted', 'The destination dialog rejected its confirmation.', directorySet.observation, 'absent', recorder.expectedContentSha256)
  }

  const restored = observeUntil('effect_ui_restored', (observation) => {
    if (destinationDialog(observation).state === 'matched') return { state: 'waiting' }
    return saveDialog(observation)
  })
  if ('status' in restored) return restored
  const restoredName = filenameField(restored.value)
  if (restoredName.state !== 'matched') {
    return recorder.failure(restoredName.state === 'ambiguous' ? 'element_identity_ambiguous' : 'precondition_not_established', 'The restored Save dialog did not expose one filename field.', restored.observation, 'absent', recorder.expectedContentSha256)
  }
  if (!filenameFieldAliasesReadBack(restored.value, restoredName.value, request.filename)) {
    return recorder.failure('field_readback_mismatch', 'The exact filename was not preserved after destination navigation.', restored.observation, 'absent', recorder.expectedContentSha256)
  }
  recorder.record('effect_ui_restored', restored.observation, 'matched', 'none', restored.value, restoredName.value, restoredName.value.value)
  const button = commitButton(restored.value)
  if (button.state !== 'matched') {
    return recorder.failure(button.state === 'ambiguous' ? 'element_identity_ambiguous' : 'commit_not_attempted', 'The Save commit control could not be uniquely revalidated.', restored.observation, 'absent', recorder.expectedContentSha256)
  }
  recorder.record('commit_revalidated', restored.observation, 'established', 'none', restored.value, button.value)
  recorder.commitAttempted = true
  const commit = driver.mutate({ kind: 'commit_save', elementId: button.value.id })
  recorder.commitAccepted = commit === 'accepted'
  recorder.record('commit_attempted', restored.observation, commit === 'accepted' ? 'changed' : 'rejected', 'commit', restored.value, button.value)
  if (commit === 'rejected') {
    return recorder.failure('commit_rejected', 'The revalidated Save control rejected activation.', restored.observation, 'absent', recorder.expectedContentSha256)
  }

  for (let index = 0; index < maximum; index += 1) {
    const observation = driver.observe()
    if (!observation) return unavailable()
    current = observation
    recorder.observations += 1
    recorder.record('commit_observed', observation, observation.output.kind === 'absent' ? 'absent' : 'changed', 'post_commit_observe')
    if (observation.output.kind === 'absent') continue
    if (observation.output.kind !== 'regular_file') {
      return recorder.failure('exact_postcondition_failed', 'The exact output path appeared but was not a regular file.', observation, 'absent', recorder.expectedContentSha256)
    }
    if (observation.output.content === null || sha256(observation.output.content) !== recorder.expectedContentSha256
      || observation.output.byteLength !== Buffer.byteLength(observation.output.content, 'utf8')
      || observation.output.metadataAfterStart !== true) {
      return recorder.failure('exact_postcondition_failed', 'The exact output file failed content or transaction-time metadata verification.', observation, 'absent', recorder.expectedContentSha256)
    }
    return recorder.success(observation)
  }
  return recorder.failure('effect_may_have_occurred_unverified', 'Save was committed once, but the exact output file never became verifiable.', current!, 'absent', recorder.expectedContentSha256)
}

export class ArrayTextEditSaveReplayDriver implements TextEditSaveReplayDriver {
  readonly mutations: TextEditSaveReplayMutation[] = []
  private index = 0

  constructor(readonly observations: TextEditSaveReplayObservation[], readonly rejectedMutations = new Set<TextEditSaveReplayMutation['kind']>()) {}

  observe(): TextEditSaveReplayObservation | null {
    const observation = this.observations[this.index]
    if (!observation) return null
    this.index += 1
    return structuredClone(observation)
  }

  mutate(mutation: TextEditSaveReplayMutation): 'accepted' | 'rejected' {
    this.mutations.push(structuredClone(mutation))
    return this.rejectedMutations.has(mutation.kind) ? 'rejected' : 'accepted'
  }
}
