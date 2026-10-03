import { receiverIdentityDigest, receiverStateDigest } from './receiver-state.js'
import { browserHistoryBack, browserNewTab, focusedTextReceiver, inputContextBoundary, opensFindControl } from './action-interpretation.js'
import type { ComputerActionProposal } from '../providers/types.js'
import type { ActionEffect, ActionEffectClass, LiveComputerElement, LiveComputerTarget } from '../types.js'
import { sha256, stableJson } from '../util.js'
import { browserDestinationCoveredByGoal, browserResearchDestinationCovered, browserLaunchDestinationCovered, type BrowserLaunch, type BrowserResearchScope } from '../browser-destinations.js'
import type { UniversalComputerActionBinding, UniversalComputerBatchPreflight } from './universal.js'
import { hasDirectionalNavigationLabel, isNavigationControl } from './navigation-control.js'
import { verificationPolicyMode } from './verification-policy.js'
import { classifyObstructionControl, consentNoticeChoice, consentNoticeHasAlternative, consentTieBreakEnabled, privacyPreservingConsentChoice } from './obstructions.js'

interface BoundElement {
  element: LiveComputerElement
  target: string
}

/**
 * Convert a provider-owned visual batch into controller-owned effects. The
 * compiler is deliberately conservative: a coordinate is useful for input,
 * but it is not authority unless the current Accessibility frame identifies a
 * single non-sensitive semantic receiver with a known generic effect.
 */
export function compileUniversalComputerBatchPreflight(
  actions: ComputerActionProposal[],
  elements: LiveComputerElement[],
  target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>,
  approvedGoal?: string,
  researchScope?: BrowserResearchScope,
  launchUrls: BrowserLaunch = [],
): UniversalComputerBatchPreflight {
  const windowTarget = `window:${target.bundleIdentifier}:${target.windowId}`
  const browserLocation = compileBrowserLocationTransaction(actions, windowTarget, target.bundleIdentifier, approvedGoal, researchScope, launchUrls)
  if (browserLocation) return browserLocation
  // A single editable field does not prove keyboard focus: browser chrome
  // often exposes only its address bar while focus is on a page button.
  let currentElement = focusedEditable(elements, windowTarget)
  let currentPayloadDigest: string | null = null
  let currentText: string | null = (currentElement?.element.focused === true || currentElement?.element.containsFocus === true)
    && currentElement.element.valueComplete === true && !currentElement.element.sensitive
    && isBrowserLocationField(currentElement.element) ? currentElement.element.value : null
  if (currentText !== null) currentPayloadDigest = sha256(stableJson(currentText))
  let replaceNextText = false
  const semanticBindings: UniversalComputerActionBinding[] = []
  const effects: ActionEffect[] = []

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex]!
    const nextAction = actions[actionIndex + 1]
    let bound: BoundElement | null = null
    // Scrolling and pointer movement target the selected surface, not the
    // incidental text beneath the pointer. Binding that text made scrolling
    // fail whenever layout or content changed between observations.
    if (action.kind === 'click' || action.kind === 'double_click') bound = bindPoint(action.point, elements, windowTarget)
    if (action.kind === 'click' || action.kind === 'double_click') {
      currentElement = bound && (isEditable(bound.element) || typedValueReceiver(bound.element)) ? bound : null
    }
    if (action.kind === 'type' || action.kind === 'keypress') bound = currentElement
    // A scroll key with no editable receiver scrolls the focused document. That
    // is a named, harmless receiver; refusing it for lack of a text field cost
    // a recovery episode on nearly every long web page.
    if (!bound && action.kind === 'keypress' && verificationPolicyMode() !== 'legacy') {
      const container = scrollReceiver(action, elements, isBrowserBundleIdentifier(target.bundleIdentifier))
      if (container) bound = { element: container, target: elementTarget(container, elements, windowTarget) }
    }
    if (!bound && (action.kind === 'keypress' || action.kind === 'type') && verificationPolicyMode() !== 'legacy') {
      const menu = menuReceiver(action, elements)
      if (menu) bound = { element: menu, target: elementTarget(menu, elements, windowTarget) }
    }
    // Browser Find opens a new receiver. The shortcut belongs to the window;
    // subsequent text must wait for a fresh observation of its actual field.
    const opensFind = isBrowserBundleIdentifier(target.bundleIdentifier) && opensFindControl(action)
    if (opensFind) { bound = null; currentElement = null }
    // Back one page belongs to the window, like Find; it never types into a field.
    const historyBack = isBrowserBundleIdentifier(target.bundleIdentifier) && (browserHistoryBack(action) || browserNewTab(action))
    if (historyBack) { bound = null; currentElement = null }

    const locationField = bound && isBrowserBundleIdentifier(target.bundleIdentifier)
      && isBrowserLocationField(bound.element)
    const locationPayload = currentText === null ? null : browserLocationPayload(currentText)
    const searchQuery = bound && locationField && !bound.element.sensitive && bound.element.enabled !== false && !bound.element.obstructed
      ? browserLocationSearchQuery(action.kind === 'type' ? action.text : isEnterKeypress(action) ? currentText : null) : null
    // Clicking the address field must use the same destination policy as
    // Cmd+L. Its label containing "search" is not a navigation grant.
    const coveredReplacement = locationField && action.kind === 'type' && replaceNextText
      && approvedGoal !== undefined && browserLocationPayload(action.text)
      && browserLocationCoveredByGoal(browserLocationPayload(action.text)!.url, approvedGoal, researchScope, launchUrls)
    // Forward Delete right after typing into the address field removes the
    // browser's selected inline completion and nothing typed (the caret sits
    // at the end). Without it, Enter went to an autocompleted address the
    // policy never saw: "docs.google.com/document/u/0/" became
    // ".../create?usp=dot_new" and a new Doc was created.
    const dismissesCompletion = Boolean(locationField) && action.kind === 'keypress' && isInlineCompletionDismissal(action)
      && actions[actionIndex - 1]?.kind === 'type'
    const visualListing = !bound && action.kind === 'click' && action.button === 'left' && action.modifiers.length === 0
      && isBrowserBundleIdentifier(target.bundleIdentifier) && visualListingClickReadOnly(action.point, elements)
    const effect: ActionEffect = visualListing ? knownEffect('read_only', `${windowTarget}/results_page`, null)
      : searchQuery ? { ...unknownEffect(), payloadDigest: sha256(stableJson(searchQuery)), payloadResolved: true }
      : dismissesCompletion && bound ? knownEffect('safe_local', bound.target, currentPayloadDigest)
      : opensFind ? knownEffect('safe_local', windowTarget, null) : historyBack ? knownEffect('read_only', windowTarget, null) : coveredReplacement && bound && action.kind === 'type'
      ? knownEffect('safe_local', bound.target, sha256(stableJson(action.text)))
      : bound && isGoToFolderField(bound.element) && isEnterKeypress(action) && goToFolderEnterEnabled() ? knownEffect('safe_local', bound.target, currentPayloadDigest)
      : bound && locationField && isEnterKeypress(action)
      ? locationPayload && approvedGoal !== undefined && browserLocationCoveredByGoal(locationPayload.url, approvedGoal, researchScope, launchUrls)
        ? knownEffect('read_only', bound.target, currentPayloadDigest)
        : { ...unknownEffect(), ...(locationPayload ? { payloadDigest: currentPayloadDigest, payloadResolved: currentPayloadDigest !== null } : {}) }
      : effectForAction(action, nextAction, bound, elements, windowTarget, currentPayloadDigest
        ?? (action.kind === 'click' && bound
          ? observedSavePayload(bound.element, elements, approvedGoal) ?? observedProtectedPayload(bound.element, elements, semanticClickEffect(bound.element, elements))
          : action.kind === 'keypress' && bound && isSaveChord(action) && !isBrowserBundleIdentifier(target.bundleIdentifier)
            ? observedDocumentPayload(bound.element)
            : null), !isBrowserBundleIdentifier(target.bundleIdentifier))
    if (action.kind === 'type') {
      currentPayloadDigest = effect.payloadDigest
      currentText = replaceNextText ? action.text : null
      if (locationField && currentText !== null) currentPayloadDigest = sha256(stableJson(currentText))
      replaceNextText = false
    } else if (dismissesCompletion) {
      // The typed address, and so its payload, is unchanged.
    } else if (action.kind === 'click' || action.kind === 'double_click' || action.kind === 'keypress' && !isEnterKeypress(action)) {
      // A changed receiver or intervening edit invalidates the typed URL.
      currentText = null
      currentPayloadDigest = null
      replaceNextText = action.kind === 'keypress' && isSelectAllReplacement(action, nextAction)
    }
    effects.push(effect)
    semanticBindings.push({
      actionIndex,
      actionKind: action.kind,
      elementId: bound?.element.id ?? null,
      role: opensFind || historyBack ? 'window_command' : locationField ? 'browser_location' : bound?.element.role ?? null,
      ...(locationField && isEnterKeypress(action) && locationPayload ? { browserDestination: locationPayload.url.href } : {}),
      ...(searchQuery ? { browserSearchQuery: searchQuery } : {}),
      ...(visualListing ? { visualListing: true } : {}),
      label: visualListing ? 'A click on the results page' : opensFind ? 'Find in selected window' : historyBack ? (browserNewTab(action) ? 'Open a new tab' : 'Back to the previous page') : bound && !bound.element.sensitive ? labelOf(bound.element).slice(0, 120) || null : null,
      stateDigest: bound && !bound.element.sensitive && bound.element.valueComplete !== false ? receiverStateDigest(bound.element, 'point' in action) : null,
      identityDigest: bound ? receiverIdentityDigest(bound.element, elements) : null,
      contentDigest: bound && !bound.element.sensitive ? sha256(stableJson({ value: bound.element.value ?? null, complete: bound.element.valueComplete ?? null })) : null,
      target: bound?.target ?? (effect.targetResolved ? effect.target : null),
      resolved: effect.targetResolved,
      ...(bound && 'point' in action && consentNoticeChoice(bound.element, elements) ? { consentNotice: true } : {}),
      ...(!effect.targetResolved ? { resolutionIssue: bindingResolutionIssue(action, bound, elements) } : {}),
      ...(locationField && isEnterKeypress(action) && !effect.targetResolved ? {
        resolutionIssue: locationPayload || searchQuery ? 'browser_destination_outside_plan' as const : 'browser_address_incomplete' as const,
      } : {}),
    })
  }
  // Observe text entered into the omnibox before Enter when selection/replacement
  // was not proven. A later unknown receiver must not discard safe preparation.
  const unresolved = effects.findIndex((effect, index) => !effect.targetResolved && !semanticBindings[index]?.browserDestination && !semanticBindings[index]?.browserSearchQuery)
  const observationBoundary = unresolved > 0 && semanticBindings.slice(0, unresolved).every(binding => binding.role === 'browser_location') && effects.slice(0, unresolved).every(effect => ['safe_local', 'read_only', 'reversible_local_write'].includes(effect.class)) ? unresolved : undefined
  const boundary = Math.min(observationBoundary ?? actions.length, inputContextBoundary(actions))
  return { semanticBindings, effects, ...(boundary < actions.length || observationBoundary !== undefined ? { observationBoundary: boundary } : {}) }
}

/** An accept inside a consent notice that also offers to decline, close or
 * choose privacy settings. */
export function consentAcceptWithheld(element: LiveComputerElement, elements: readonly LiveComputerElement[]): boolean {
  return consentNoticeChoice(element, elements) === 'accept' && consentNoticeHasAlternative(element.dialogId, elements)
}

/** Diagnose evidence gaps without recording the user's labels or content. */
function bindingResolutionIssue(action: ComputerActionProposal, bound: BoundElement | null, elements: LiveComputerElement[]): NonNullable<UniversalComputerBatchPreflight['semanticBindings'][number]['resolutionIssue']> {
  if (bound) return bound.element.sensitive ? 'sensitive_control' : consentAcceptWithheld(bound.element, elements) ? 'consent_accept_withheld' : 'control_effect_unknown'
  if (!('point' in action)) return 'receiver_unresolved'
  const hits = elements.filter(element => element.bounds && element.enabled !== false && pointInside(action.point, element.bounds))
    .sort((a, b) => area(a) - area(b) || (b.depth ?? 0) - (a.depth ?? 0))
  if (!hits.length) return 'no_control_at_point'
  if (hits[0]!.sensitive) return 'sensitive_control'
  return 'ambiguous_control_at_point'
}

/** A separate Save turn has no immediately preceding type action. Bind its
 * payload to the freshly observed editable values instead of asking the
 * model to retype them. This remains a protected submission, not a local
 * write exemption. Ambiguous save controls, incomplete/secret values and
 * other kinds of submission retain semantic recovery. */
function observedSavePayload(control: LiveComputerElement, elements: LiveComputerElement[], goal: string | undefined): string | null {
  const isSave = (e: LiveComputerElement) => /^save\b/iu.test(labelOf(e))
    && /button/u.test(normalizeRole(e.role)) && e.enabled !== false
  if (!goal || !/\bsav(?:e|ing)\b/iu.test(goal) || !isSave(control) || semanticClickEffect(control) !== 'submission') return null
  // Familiar generic Save labels need no literal button name in the task.
  // Other named Save controls bind only when the task names that entire label.
  // This establishes observed data, not authority: semantic coverage and the
  // protected submission policy still decide whether the click may run.
  const words = (text: string) => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? ''
  const namedInTask = ` ${words(goal)} `.includes(` ${words(labelOf(control))} `)
  // "Save location" when the task says "set this delivery location … and save it": every word the label adds to Save
  // is in the task. Short labels only; a word the task never used ("Save itinerary" for "save the changes") still fails.
  const taskWords = new Set(words(goal).split(' '))
  const labelExtra = words(labelOf(control)).split(' ').slice(1)
  const wordsInTask = labelExtra.length > 0 && labelExtra.length <= 3 && labelExtra.every(word => taskWords.has(word))
  if (!/^save(?: (?:changes|settings|document|draft))?$/iu.test(labelOf(control)) && !namedInTask && !wordsInTask) return null
  if (elements.filter(isSave).length !== 1 || elements.some(e => e.sensitive)) return null
  const fields = elements.filter(e => isEditable(e) && !isBrowserLocationField(e))
  // A form built from choosers (country, region, city as pop-up lists) has no text fields at all, so its Save never
  // resolved and every such task stalled at "Partly done" without an approval card (e2e C13, 3 Oct). Each labelled
  // chooser is part of what Save commits; its value is bound when Accessibility exposes one. The click stays a protected
  // submission, and the approval it reaches is for the observed frame.
  const choosers = elements.filter(e => !fields.includes(e) && /(popupbutton|combobox)/u.test(normalizeRole(e.role)) && Boolean(labelOf(e)) && e.bounds && e.enabled !== false)
  if (!fields.length && !choosers.length) return null
  if (fields.length + choosers.length > 20 || fields.some(e => e.sensitive || !labelOf(e) || !e.bounds || e.enabled === false || e.valueComplete !== true || typeof e.value !== 'string')) return null
  return sha256(stableJson({ kind: 'observed_save_values', control: control.fingerprint ?? control.id,
    fields: fields.map(e => ({ ref: e.fingerprint ?? e.id, name: labelOf(e), value: e.value })),
    ...(choosers.length ? { choosers: choosers.map(e => ({ ref: e.fingerprint ?? e.id, name: labelOf(e), value: typeof e.value === 'string' ? e.value : null })) } : {}) }))
}

/** The path field of a macOS Save/Open panel's Go to Folder sheet. Enter there only moves the panel to that folder; it saves nothing.
 * Off: STEWARD_GO_TO_FOLDER_ENTER=off. */
export function goToFolderEnterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_GO_TO_FOLDER_ENTER?.trim().toLowerCase() !== 'off'
}
export function isGoToFolderField(element: LiveComputerElement): boolean {
  return element.identifier === 'PathTextField' && element.dialogId != null && element.editable !== false && !element.sensitive
}

/** Cmd+S alone: no Shift (Save As), no Option (Save All). */
function isSaveChord(action: ComputerActionProposal): boolean {
  if (action.kind !== 'keypress') return false
  const chord = canonicalChord(action.keys)
  return chord.length === 2 && chord[0] === 'CMD' && chord[1] === 'S'
}

/** The document a save chord would commit: the focused editor's complete,
 * non-secret contents. An incomplete accessibility value cannot name what
 * would be saved, so the chord stays unresolved. */
function observedDocumentPayload(editor: LiveComputerElement): string | null {
  if (!isMultilineEditor(editor) || editor.sensitive || editor.valueComplete !== true || typeof editor.value !== 'string') return null
  return sha256(stableJson({ kind: 'observed_save_document', control: editor.fingerprint ?? editor.id, name: labelOf(editor), value: editor.value }))
}

/** Bind what a protected control would commit to fresh observed values.
 * This establishes evidence, never permission. Intent belongs to contextual
 * action review and the supervision policy, not a keyword test on the goal.
 * A request such as "play two riddles with ChatGPT" authorizes a conversation
 * without literally saying "send"; a request to inspect a draft does not.
 * Both have the same observable payload and retain the protected boundary.
 */
function observedProtectedPayload(control: LiveComputerElement, elements: LiveComputerElement[], effectClass: ActionEffectClass): string | null {
  if (!clickEffectNeedsPayload(effectClass) || !labeledInteractiveControl(control)) return null
  // Save has a separate, stricter document/field-set binding above. Do not
  // bypass its unique-control and nonempty-field checks through this fallback.
  if (effectClass === 'submission' && /^save\b/iu.test(labelOf(control))) return null
  // A sensitive element anywhere on screen — a password, a card number, masked
  // or not — keeps the click unresolved, whether or not it counts as a field.
  if (elements.some(e => e.sensitive)) return null
  const fields = elements.filter(e => isEditable(e) && !isBrowserLocationField(e))
  // The same completeness bar as the Save rule: every visible field labelled,
  // enabled, and holding a value the observation read in full.
  if (fields.length > 20 || fields.some(e => !labelOf(e) || e.enabled === false || e.valueComplete !== true || typeof e.value !== 'string')) return null
  return sha256(stableJson({ kind: 'observed_protected_control', effect: effectClass, control: control.fingerprint ?? control.id, label: labelOf(control),
    fields: fields.map(e => ({ ref: e.fingerprint ?? e.id, name: labelOf(e), value: typeof e.value === 'string' ? e.value : null })) }))
}

/** `STEWARD_NATIVE_COMMAND_KEYS=off` removes the native-app command chords below. */
export const nativeCommandKeysEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.STEWARD_NATIVE_COMMAND_KEYS?.trim().toLowerCase() !== 'off'
/**
 * Standard macOS command chords a person uses to work files and documents in a native (non-browser) app, each with the
 * effect it has everywhere it exists. Without them a Finder task could not open a file to read its status, move files,
 * or reach a folder in a Save panel (in testing, ⌘O was refused as "unsupported navigation", the task stopped).
 * Anything that deletes, sends, closes or quits is absent and stays unknown.
 */
/** Off: STEWARD_PLAIN_TEXT_CHORD=off. */
export function plainTextChordEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_PLAIN_TEXT_CHORD?.trim().toLowerCase() !== 'off'
}
/** Off: STEWARD_FINDER_COLUMN_PREVIEW=off. */
export function finderColumnPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_FINDER_COLUMN_PREVIEW?.trim().toLowerCase() !== 'off'
}
const nativeCommandChordEffects: Record<string, ActionEffect['class']> = {
  'CMD+O': 'safe_local',
  'CMD+SHIFT+G': 'safe_local', 'CMD+SHIFT+S': 'safe_local', 'CMD+N': 'safe_local', 'CMD+C': 'safe_local',
  'ALT+CMD+V': 'reversible_local_write', 'CMD+Z': 'reversible_local_write',
  // View switches (Finder: icons, list, columns, gallery). Column view previews a selected file's first lines inside
  // the same window, where ⌘O would open it in another app Carve cannot read (0/6 in testing).
  // TextEdit's Make Plain Text: a new document is rich text, and a requested .txt file cannot be saved as one
  // without it (in testing, the Save panel stayed on Rich Text Document). Undoable with ⌘Z.
  ...(plainTextChordEnabled() ? { 'CMD+SHIFT+T': 'reversible_local_write' } as const : {}),
  ...(finderColumnPreviewEnabled() ? { 'CMD+1': 'read_only', 'CMD+2': 'read_only', 'CMD+3': 'read_only', 'CMD+4': 'read_only' } as const : {}),
}
export function nativeCommandChordEffect(keys: string[]): ActionEffect['class'] | null {
  const chord = canonicalChord(keys)
  const terminal = chord.at(-1) ?? ''
  const modifiers = [...new Set(chord.slice(0, -1))].sort()
  return nativeCommandChordEffects[[...modifiers, terminal].join('+')] ?? null
}

function effectForAction(
  action: ComputerActionProposal,
  nextAction: ComputerActionProposal | undefined,
  bound: BoundElement | null,
  elements: LiveComputerElement[],
  windowTarget: string,
  currentPayloadDigest: string | null,
  native = false,
): ActionEffect {
  if (action.kind === 'wait' || action.kind === 'screenshot' || action.kind === 'move' || action.kind === 'scroll') {
    return knownEffect('read_only', windowTarget, null)
  }
  if (action.kind === 'type') {
    // Type-ahead in a focused popup or menu moves its highlight, or sets a
    // closed popup's value; it commits nothing outside that control.
    if (bound && !bound.element.sensitive && menuControl(bound.element) && !isEditable(bound.element)) {
      return knownEffect(popupControl(bound.element) ? 'reversible_local_write' : 'safe_local', bound.target, sha256(stableJson(action.text)))
    }
    if (!bound || bound.element.sensitive || !(isEditable(bound.element) || typedValueReceiver(bound.element))) return unknownEffect()
    return knownEffect('reversible_local_write', bound.target, sha256(stableJson(action.text)))
  }
  if (action.kind === 'keypress') {
    const chord = canonicalChord(action.keys)
    const keys = new Set(chord)
    const terminalKey = chord.at(-1) ?? ''
    if (bound && isScrollContainer(bound.element) && (safeNavigationKey(terminalKey, keys) || browserScrollChord(chord))) return knownEffect('safe_local', bound.target, null)
    if (safeNavigationKey(terminalKey, keys)) return knownEffect('safe_local', windowTarget, null)
    if (bound && isSelectAllReplacement(action, nextAction)) return knownEffect('safe_local', bound.target, null)
    if (bound?.element.focused === true && isEditable(bound.element) && isSelectAllKeypress(action)) return knownEffect('safe_local', bound.target, null)
    if (bound && !bound.element.sensitive && menuControl(bound.element) && !isEditable(bound.element) && ['ENTER', 'RETURN', 'SPACE'].includes(terminalKey)) {
      // Enter or Space on a focused popup opens its list; on a focused item it
      // chooses that item, which is the same decision as clicking it. A value
      // item of an open popup is a local edit; anything else keeps the click
      // vocabulary, so a named command item still checkpoints and a
      // destructive one stays protected.
      if (popupControl(bound.element)) return knownEffect('safe_local', bound.target, null)
      if (popupValueItem(bound.element, elements)) return knownEffect('reversible_local_write', bound.target, null)
      const chosen = semanticClickEffect(bound.element, elements)
      if (chosen === 'unknown' && labeledInteractiveControl(bound.element)) return { ...knownEffect('unclassified_control', bound.target, null), payloadResolved: true }
      if (chosen === 'unknown') return unknownEffect()
      return { ...knownEffect(chosen, bound.target, null), payloadResolved: !clickEffectNeedsPayload(chosen) }
    }
    if (terminalKey === 'ENTER' || terminalKey === 'RETURN') {
      // Enter in a search, filter, or address field runs a lookup: it reads
      // and navigates, it commits nothing.
      if (bound && isLookupField(bound.element)) return knownEffect('read_only', bound.target, currentPayloadDigest)
      // Enter in a multi-line text editor (a document, note or slide body) inserts a
      // line; it commits nothing, so it is a reversible local edit, not a submission.
      if (bound && isMultilineEditor(bound.element)) return knownEffect('reversible_local_write', bound.target, currentPayloadDigest)
      // Everywhere else, chiefly a single-line form field, Enter submits the payload
      // typed in this batch and stays a protected submission for the person to approve.
      if (!currentPayloadDigest) return unknownEffect()
      return knownEffect('submission', bound?.target ?? windowTarget, currentPayloadDigest)
    }
    // Inside one proven editable receiver, caret movement and selection are
    // free, and the ordinary editing chords change only that field's own
    // reversible contents. Outside a field the same chords can open, move,
    // or trash things, so they remain unknown and fail closed.
    if (bound && isEditable(bound.element)) {
      // Cmd+S in a native document editor commits the document the person can
      // see: the same protected submission as its Save button, bound to the
      // observed contents, so a separate save turn reaches a checkpoint instead
      // of semantic recovery. In a browser the chord opens a file dialog and
      // stays unknown (the call site passes no payload there).
      if (isSaveChord(action) && isMultilineEditor(bound.element)) {
        return currentPayloadDigest ? knownEffect('submission', bound.target, currentPayloadDigest) : unknownEffect()
      }
      if (editableCaretKey(terminalKey, keys)) return knownEffect('safe_local', bound.target, null)
      if (editableFormattingChord(chord)) return knownEffect('reversible_local_write', bound.target, null)
      if (terminalKey === 'BACKSPACE' || terminalKey === 'DELETE') return knownEffect('reversible_local_write', bound.target, null)
    }
    if (native && nativeCommandKeysEnabled()) {
      const known = nativeCommandChordEffect(action.keys)
      if (known) return knownEffect(known, windowTarget, null)
    }
    return unknownEffect()
  }
  if (action.kind === 'drag') return unknownEffect()
  if (!bound || bound.element.sensitive) return unknownEffect()
  // A click that puts a number field or date/time segment in focus for the
  // typing that immediately follows only takes focus; a lone stepper click
  // keeps its reversible value-changing class below.
  if (typedValueReceiver(bound.element) && nextAction && (nextAction.kind === 'type' || isSelectAllKeypress(nextAction))) return knownEffect('safe_local', bound.target, null)
  // Carve never accepts a consent notice that offers another way through;
  // the controller withholds the click and names the alternatives.
  if (consentAcceptWithheld(bound.element, elements)) return unknownEffect()
  const effectClass = semanticClickEffect(bound.element, elements)
  // A named ordinary control is resolved even when no rule can say what it
  // does. That is a decision for the person at a checkpoint, not a semantic
  // recovery: recovery exists for clicks nothing on the page can name, and
  // for a named control it can only repeat the same refusal.
  if (effectClass === 'unknown' && labeledInteractiveControl(bound.element)) {
    return { ...knownEffect('unclassified_control', bound.target, null), payloadResolved: true }
  }
  if (effectClass === 'unknown') return unknownEffect()
  const payloadDigest = clickEffectNeedsPayload(effectClass) ? currentPayloadDigest : null
  return {
    ...knownEffect(effectClass, bound.target, payloadDigest),
    payloadResolved: !clickEffectNeedsPayload(effectClass) || payloadDigest !== null,
  }
}

function elementTarget(element: LiveComputerElement, elements: LiveComputerElement[], windowTarget: string): string {
  return element.fingerprint && elements.filter(candidate => candidate.fingerprint === element.fingerprint).length === 1
    ? `${windowTarget}/control:${element.fingerprint}`
    : `${windowTarget}/element:${element.id}:${normalizeRole(element.role)}`
}

/** Off: STEWARD_MENU_CONTAINER_NOT_OBSTRUCTION=off. */
const menuContainerNotObstruction = (): boolean => process.env.STEWARD_MENU_CONTAINER_NOT_OBSTRUCTION?.trim().toLowerCase() !== 'off'
/** Off: STEWARD_DIALOG_CONTAINER_NOT_OBSTRUCTION=off. */
const dialogContainerNotObstruction = (): boolean => process.env.STEWARD_DIALOG_CONTAINER_NOT_OBSTRUCTION?.trim().toLowerCase() !== 'off'

/** A control inside a sheet or dialog is reported obstructed by the sheet that contains it (the hit test returns the container).
 * In testing, every click on the Save panel's Name field was withheld as an ambiguous control. What only encloses the control,
 * inside the control's own dialog, is its parent and not a cover; anything else over the point still is. */
function obstructedAtPoint(element: LiveComputerElement, point: { x: number; y: number }, elements: readonly LiveComputerElement[] = []): boolean {
  // An open select's option is hit-tested as its popup menu, the same container effect as a sheet below (A-V1, 1 October:
  // "Oakland office" refused on every click). A cover that encloses a menu or list item and is exactly the bounds of an
  // enclosing menu or list in this frame is that item's own container. `STEWARD_MENU_CONTAINER_NOT_OBSTRUCTION=off`.
  const ownMenu = (b: { x: number; y: number; width: number; height: number }) => menuContainerNotObstruction() && element.bounds
    && /^ax(menuitem|menubaritem|row|cell|statictext)$/u.test(normalizeRole(element.role))
    && b.x <= element.bounds.x && b.y <= element.bounds.y && b.x + b.width >= element.bounds.x + element.bounds.width && b.y + b.height >= element.bounds.y + element.bounds.height
    && elements.some(e => e !== element && e.bounds && /^ax(menu|list|outline|table)$/u.test(normalizeRole(e.role))
      && e.bounds.x === b.x && e.bounds.y === b.y && e.bounds.width === b.width && e.bounds.height === b.height)
  const covers = element.pointerObstructions?.filter(b => pointInside(point, b) && !ownMenu(b)) ?? []
  if (dialogContainerNotObstruction() && element.dialogId != null && element.bounds) {
    const own = element.bounds
    const encloses = (b: { x: number; y: number; width: number; height: number }) => b.x <= own.x && b.y <= own.y && b.x + b.width >= own.x + own.width && b.y + b.height >= own.y + own.height
    const real = covers.filter(b => !encloses(b))
    return element.obstructed === true && !(element.pointerObstructions ?? []).every(encloses) ? true : real.length > 0
  }
  return element.obstructed === true || covers.length > 0
}

function bindPoint(
  point: { x: number; y: number },
  elements: LiveComputerElement[],
  windowTarget: string,
): BoundElement | null {
  const candidates = elements
    .filter((element) => element.bounds && element.enabled !== false && pointInside(point, element.bounds))
    .sort((left, right) => area(left) - area(right) || (right.depth ?? 0) - (left.depth ?? 0) || left.id.localeCompare(right.id))
  const innermost = candidates[0]
  if (!innermost) return null
  // A control's own label text sits inside it with the same geometry. The
  // click reaches the control, so the control is the receiver: binding the
  // text node instead turned every link click into an unclassified control.
  // The same holds for a control's unlabelled icon: a lodging site's "Dismiss
  // sign-in info." button is reached through its X image, and binding the
  // nameless image refused the dismissal as an unknown effect.
  const innermostRole = normalizeRole(innermost.role)
  const decoration = ['aximage', 'axgroup', 'axgenericelement', 'axunknown'].includes(innermostRole) && !labelOf(innermost).trim()
  const labelText = innermostRole === 'axstatictext' || decoration
  // Geometry is not ancestry: an icon binds only to a control close to its own
  // size, never to a page-sized link that merely lies beneath a popup.
  const labelControl = labelText ? candidates.find(candidate => candidate !== innermost && interactiveControlRoles.test(normalizeRole(candidate.role)) && labelOf(candidate)
    && (!decoration || area(candidate) <= 25 * area(innermost))) : undefined
  // A click inside a document editor or composer lands on a text run, a
  // paragraph or a layout group inside it. The editable is what takes focus,
  // so it is the receiver: binding the passive descendant classified the
  // click as unknown, the batch reviewer stopped there, and the typing behind
  // it was withheld on every attempt (a chat reply, a document edit).
  const passive = !isEditable(innermost) && !interactiveControlRoles.test(normalizeRole(innermost.role))
  const enclosingEditable = passive && !labelControl ? candidates.find(candidate => candidate !== innermost && isEditable(candidate) && !candidate.sensitive) : undefined
  const enclosing = labelControl ?? enclosingEditable
  const first = enclosing ?? innermost
  if (first.sensitive || obstructedAtPoint(first, point, elements)) return null
  const second = enclosingEditable ? undefined : candidates.find(candidate => candidate !== first && candidate !== (enclosing ? innermost : undefined))
  if (second && area(first) === area(second) && (first.depth ?? 0) === (second.depth ?? 0)) {
    // A clothing retailer: "ONLY REQUIRED COOKIES" tied with a same-size element at its point, was withheld as
    // ambiguous, and the listing's second page stayed unreachable. When exactly one of the tied elements is the
    // notice's privacy-preserving answer (reject, necessary only, close), that is the receiver: choosing it widens
    // nothing, and its class is fixed by consentNoticeChoice whichever element the pixels belong to.
    // Only against elements that cannot be a different choice: an unnamed or passive element (a wrapper, the
    // label's own text). A second named control at the same point (an Accept beside it) keeps the tie.
    const tied = candidates.filter(candidate => area(candidate) === area(first) && (candidate.depth ?? 0) === (first.depth ?? 0))
    const privacy = consentTieBreakEnabled() ? tied.filter(candidate => !candidate.sensitive && !candidate.obstructed
      && (privacyPreservingConsentChoice(candidate) || ['reject', 'close'].includes(consentNoticeChoice(candidate, elements) ?? ''))) : []
    const others = tied.filter(candidate => candidate !== privacy[0])
    const passiveOther = (candidate: LiveComputerElement) => !candidate.sensitive && !isEditable(candidate)
      && (!labelOf(candidate).trim() || (!interactiveControlRoles.test(normalizeRole(candidate.role)) && consentNoticeChoice(candidate, elements) === null && classifyObstructionControl(labelOf(candidate)) !== 'accept'))
    return privacy.length === 1 && others.every(passiveOther) ? { element: privacy[0]!, target: elementTarget(privacy[0]!, elements, windowTarget) } : null
  }
  return { element: first, target: elementTarget(first, elements, windowTarget) }
}

function focusedEditable(elements: LiveComputerElement[], windowTarget: string): BoundElement | null {
  const element = focusedTextReceiver(elements)
  if (!element) return null
  return { element, target: elementTarget(element, elements, windowTarget) }
}

/** Whether a click on this element can be classified at all. Planners that
 * offer controls to a model should offer only these; anything else is
 * refused by the effect policy before input, costing a recovery turn. */
export function clickEffectResolvable(element: LiveComputerElement): boolean {
  return !element.sensitive && element.enabled !== false && (semanticClickEffect(element) !== 'unknown' || labeledInteractiveControl(element))
}

/**
 * A compact program names an exact accessibility ref rather than merely a
 * coordinate. Some web controls expose a generic AXButton even though their
 * label proves that they only edit a local search selector. Keep this narrow:
 * the caller must separately prove a unique fresh identity match, and any
 * protected verb continues through the ordinary classifier/reviewer.
 */
export function compactRefSelectorEffect(element: LiveComputerElement): 'read_only' | 'reversible_local_write' | null {
  if (element.sensitive || element.enabled === false || element.obstructed || element.pointerObstructions?.length) return null
  const role = normalizeRole(element.role)
  if (!/(button|stepper|incrementor)/u.test(role)) return null
  const label = labelOf(element).replace(/\s+/gu, ' ').trim()
  if (!label || semanticClickEffect(element) !== 'unknown') return null
  // Calendar cells selected as a check-in/out (or another named date field)
  // change only the visible search/filter state.
  if (/\bselect as (?:an? )?(?:check[- ]?in|check[- ]?out|start|end|arrival|departure)?\s*date\b/iu.test(label)) return 'reversible_local_write'
  // A date-picker cell whose whole label is a date, optionally with the fare the
  // picker shows for it (a flight-search page: "Thursday, March 4, 2027,
  // 300 US dollars, Cheapest price" was a protected checkpoint). Choosing a date
  // pays nothing; any other wording keeps model review.
  if (/^(?:mon|tues|wednes|thurs|fri|satur|sun)day,\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s+\d{4})?(?:,\s+(?:\$\s?[\d,.]+|[\d,.]+\s+(?:US\s+)?dollars))?(?:,\s+(?:cheapest|lowest)\s+(?:price|fare))?(?:,\s+(?:departure|return|check[- ]?in|check[- ]?out)\s+date)?(?:,\s+selected)?$/iu.test(label)) return 'reversible_local_write'
  // Custom web steppers commonly lose their AXStepper role and surface as a
  // button. Restrict the fallback to ordinary count selectors; labels that
  // describe money, permissions, publishing, deletion, or submission never
  // match this grammar and retain model review.
  if (/^(?:increase|decrease|increment|decrement)\s+(?:number of\s+)?(?:adults?|children|infants?|guests?|travell?ers?|passengers?|pets?|rooms?|items?|quantity|count)$/iu.test(label)) return 'reversible_local_write'
  // A collapsed chooser only reveals its local selector. The actual choice is
  // classified independently on the following fresh observation.
  if (/^(?:(?:who|when|check[- ]?in(?:\s*\/\s*check[- ]?out)?)\s+)?(?:add|choose|select)\s+(?:guests?|travell?ers?|passengers?|dates?|rooms?)$/iu.test(label)) return 'read_only'
  return null
}

/**
 * Whether the same freshly rebound control may be clicked again by a bounded
 * controller transaction without asking the model to choose the action again.
 * This is intentionally narrower than ordinary click authorization: standard
 * steppers, directional navigation and the compact selector vocabulary have
 * mechanically repeatable semantics. An arbitrary named button does not.
 */
export function repeatableCompactClickEffect(element: LiveComputerElement): 'read_only' | 'reversible_local_write' | null {
  if (element.sensitive || element.enabled === false || element.obstructed || element.pointerObstructions?.length) return null
  const role = normalizeRole(element.role)
  if (/(stepper|incrementor)/u.test(role)) return semanticClickEffect(element) === 'reversible_local_write' ? 'reversible_local_write' : null
  const selector = compactRefSelectorEffect(element)
  if (selector) return selector
  const effect = semanticClickEffect(element)
  if (effect !== 'read_only') return null
  const label = labelOf(element)
  return /^\s*move (?:forward to switch to the next|backward to switch to the previous) month\.?\s*$/iu.test(label)
    || hasDirectionalNavigationLabel(element) ? 'read_only' : null
}

const interactiveControlRoles = /(button|menuitem|menubutton|popupbutton|disclosure|toggle|tab|link|combobox|checkbox|radio|switch|cell|row|outline)/u
/** Short static text reads as a label a person can name and approve ("Priya
 * Patel", "How do refunds work?"); a paragraph does not. */
const MAX_STATIC_TEXT_LABEL = 80

function labelOf(element: LiveComputerElement): string {
  return [element.name, element.description].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? ''
}

/** A control a person could name when approving it: an interactive role
 * with a visible label, or one short line of static text. Many pages expose
 * their cards, list items and disclosure headers only as static text; the
 * person still decides at a checkpoint whether that text may be clicked.
 * Groups, paragraphs and unnamed buttons are not controls in this sense. */
export function labeledInteractiveControl(element: LiveComputerElement): boolean {
  const role = normalizeRole(element.role)
  if (interactiveControlRoles.test(role)) return labelOf(element).length > 0
  if (role === 'axstatictext') {
    const text = (labelOf(element) || (typeof element.value === 'string' ? element.value.trim() : '')).replace(/\s+/gu, ' ')
    return text.length > 0 && text.length <= MAX_STATIC_TEXT_LABEL
  }
  return false
}

/** Help text that can stand for the control's own label: one line, at most
 * 80 characters, and not an instruction about some other gesture. A music
 * application publishes an Info View paragraph as every element's accessibility
 * help ("Click to select this track; choose Rename from the Edit menu to
 * rename the track; choose Delete to delete the track…"), and
 * the word "Delete" in that paragraph made a plain click on a
 * track's name field a destructive checkpoint, "Confirm a deletion", while
 * the person was renaming the track. Documentation describes what the
 * control can do by other means; only a label describes what a click does. */
/** Off: STEWARD_RECOVERABLE_ITEM_VERBS=off. */
export function recoverableItemVerbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_RECOVERABLE_ITEM_VERBS?.trim().toLowerCase() !== 'off'
}

export function classifiableHelp(element: Pick<LiveComputerElement, 'help'>): string {
  const help = typeof element.help === 'string' ? element.help.trim() : ''
  if (!help || help.length > 80 || /[\r\n]/u.test(help)) return ''
  if (/[.!?;]\s+\S/u.test(help)) return ''
  if (/\b(?:press|choose|use|hold|double[- ]click|right[- ]click|drag|from the .* menu)\b/iu.test(help)) return ''
  return help
}

const toggleRoles = /(checkbox|radio|switch|slider|stepper|incrementor)/u

/** The class a toggle's own words claim when they name an act that needs approval. Narrower than the button
 * vocabulary: nouns that commonly label settings ("Email notifications", "Show message previews", "Show
 * password") do not count; verbs and phrases that commit something do. */
function consequentialToggleEffect(element: LiveComputerElement): ActionEffectClass | null {
  const words = [element.name, element.description, classifiableHelp(element)]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
  if (!words.trim()) return null
  if (/\b(delete|remove|erase|trash|destroy|clear all)\b/u.test(words)) return 'destructive'
  if (/\b(buy|pay|purchase|checkout|check out|place order|order now|donate|transfer funds)\b/u.test(words)) return 'financial'
  if (/\b(send|publish|share|reply)\b/u.test(words) || /^\s*post\b/u.test(words)) return 'communication'
  if (/\b(sign in|log in|authenticate)\b/u.test(words)) return 'authentication'
  if (/\binstall\b/u.test(words)) return 'installation'
  if (/\b(administrator|admin access|elevate|grant (?:permission|access)|allow access|give access)\b/u.test(words)) return 'privilege_escalation'
  if (/\b(accept|agree|consent|authorize)\b/u.test(words)) return 'legal_acceptance'
  return null
}

function semanticClickEffect(element: LiveComputerElement, elements: readonly LiveComputerElement[] = []): ActionEffectClass {
  const normalizedRole = normalizeRole(element.role)
  // A checkbox, radio, switch or slider usually toggles its own value: "Dark
  // mode" or "Bold" is reversible in place. But a web page chooses its own
  // roles, so role=checkbox proves nothing about what a click does. A label
  // that names a purchase, a message, a grant of access, an agreement, a
  // sign-in or a deletion keeps that class and its approval, even on a toggle
  // ("Buy now", "Allow access", "Send confidential report").
  if (toggleRoles.test(normalizedRole)) return consequentialToggleEffect(element) ?? 'reversible_local_write'
  // A web date or time field is a group of numeric segments; clicking it
  // focuses a segment. The typed digits are classified on their own.
  if (/(datefield|timefield)/u.test(normalizedRole) && !element.sensitive) return 'safe_local'
  // Clicking into a text field or editor only focuses it, whatever its label
  // says: "Message #general" is where a reply is typed, not the Send. The
  // label rules below named that click a communication, so the reviewer
  // stopped at it and the typing behind it was withheld every time (a chat
  // reply). Sending is the Enter or the Send control, classified
  // on their own.
  if (isEditable(element) && !element.sensitive && !/combobox|popup/u.test(normalizedRole)) return 'safe_local'
  // A pop-up button that shows a current value is a chooser (a web <select>, a
  // font-size menu): clicking it only opens its list. The item chosen from the
  // list is classified on its own (popupValueItem).
  if (/popupbutton/u.test(normalizedRole) && !element.sensitive && typeof element.value === 'string' && element.value.trim()
    && !/\b(delete|remove|buy|pay|purchase|send|publish|share|submit|sign in|log in)\b/iu.test(labelOf(element))) return 'safe_local'
  const semantics = [element.role, element.subrole, element.name, element.description, classifiableHelp(element), element.placeholder]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
  if (/\b(delete|remove|erase|trash|destroy|clear all)\b/u.test(semantics)) return 'destructive'
  if (/\b(buy|pay|purchase|checkout|place order|donate|transfer funds)\b/u.test(semantics)) return 'financial'
  // Archiving, marking done/read, pinning or starring an item keeps it and can be undone in place. The model reviewer
  // read "Archive Renew membership" as a deletion and the person was asked to confirm that something would be
  // "permanently removed" (0/3 in testing). Delete-like words above still win; a bare "Archive" is
  // often the Archive view, so archiving needs its object.
  if (recoverableItemVerbEnabled() && /^\s*(?:(?:archive|unarchive)\s+\S|(?:mark (?:as )?(?:done|complete|completed|read|unread)|pin|unpin|star|unstar|snooze)\b)/iu.test(labelOf(element))) return 'reversible_local_write'
  // Web date pickers often expose their month arrows as plain buttons whose
  // accessibility label is a complete navigation sentence. This is a narrow,
  // read-only viewport change; without it the compact actor cannot see the
  // arrow as an eligible ref and starts clicking month headings or flexibility
  // popups instead.
  if (/^\s*move (?:forward to switch to the next|backward to switch to the previous) month\.?\s*$/iu.test(labelOf(element))) return 'read_only'
  // A directional browsing label (or a pair such as Newer / Older) describes
  // navigation. In particular, its noun “message” does not mean sending one.
  if (isNavigationControl(element, elements)) return 'read_only'
  // "Dismiss welcome message", "Close notification", "Skip this step": the
  // leading verb says the control puts something away. Judged by their nouns
  // alone these read as sending or publishing, which a click can never
  // resolve, so the batch would loop through recovery instead of running.
  if (/^\s*(?:dismiss|close|hide|skip|got it|no thanks|not now|maybe later|keep shopping|continue shopping|continue to (?:the )?site|return to (?:the )?site)\b/iu.test(labelOf(element))) return 'read_only'
  // The most privacy-preserving answer to a consent prompt never widens what
  // Carve may do (a grocery site's "Reject All Non-Essential": an unknown
  // control on its own, held for review on every attempt).
  if (privacyPreservingConsentChoice(element)) return 'read_only'
  // Inside a consent notice the answer is fixed by what the control does to
  // consent: closing it, declining, or opening its privacy choices widens
  // nothing; accepting is always legal acceptance, never an unclassified
  // control, whichever reviewer looks at it.
  const consent = consentNoticeChoice(element, elements)
  if (consent === 'reject' || consent === 'close' || consent === 'settings') return 'read_only'
  if (consent === 'accept') return 'legal_acceptance'
  // The button that runs the search or filter field beside it ("Go" on
  // a shopping site, an unlabelled magnifier on a classifieds site) is the same lookup as
  // Enter in that field. Judged alone it was an unknown control and a plain
  // search waited for approval (in testing). Only a bare search verb or no
  // label, only on a lookup field's own row; "Submit", "Save" or "Send" keep
  // their classes.
  if (lookupSubmitButton(element, elements)) return 'read_only'
  if (/\b(send|message|email|post|publish|share|reply)\b/u.test(semantics)) return 'communication'
  if (/\b(sign in|log in|password|passcode|one[- ]time|verification code|authenticate)\b/u.test(semantics)) return 'authentication'
  if (/\b(install|administrator|admin access|elevate|grant permission|allow access)\b/u.test(semantics)) {
    return /\binstall\b/u.test(semantics) ? 'installation' : 'privilege_escalation'
  }
  if (/\b(accept|agree|terms|consent|authorize signature|sign agreement)\b/u.test(semantics)) return 'legal_acceptance'
  // A button in a dialog that only chooses where or how to shop (store,
  // delivery or pickup, region, language, currency), its Confirm included,
  // sets a site preference the person can change back; it orders, pays for
  // and sends nothing (a grocery site's "How would you like to shop?",
  // held for approval). Sign-in buttons there, and any other dialog's
  // Confirm, keep their classes.
  // Its options (Delivery, Pickup, In-Store, a store) are the same kind of choice.
  if (/(^|ax)button$/u.test(normalizedRole) && !/\b(?:log ?in|sign ?in|sign ?up|register|create (?:an )?account|password)\b/iu.test(labelOf(element))
    && preferenceChooserDialog(element, elements)) return 'reversible_local_write'
  if (/\b(submit|confirm|finish|apply|save|update)\b/u.test(semantics)) return 'submission'
  // Focusing an ordinary text receiver does not edit its contents. Toggling
  // other form controls does, and still requires the selected change policy.
  if (isEditable(element)) return 'safe_local'
  if (/(checkbox|radio|switch|slider|stepper)/u.test(normalizedRole) || /\b(checkbox|radio|switch|slider|stepper)\b/u.test(semantics)) return 'reversible_local_write'
  // A rejected directional interpretation must not be rescued by a loose
  // keyword such as “next” or “view” (for example, “Next payment”).
  if (hasDirectionalNavigationLabel(element)) return 'unknown'
  if (/(link|tab|menuitem|row|cell|outline)/u.test(normalizedRole) || /\b(search|find|filter|look ?up|view|show|open|back|forward|cancel|close)\b/u.test(semantics)) return 'read_only'
  // A short-labelled button on a results page, outside any dialog or form, changes which items are shown
  // ("Bestsellers", "Linen", "Size M": an eyewear retailer, withheld twice as an unknown control).
  if (listingViewControl(element, elements)) return 'read_only'
  return 'unknown'
}

/** `STEWARD_LISTING_READ_ONLY=off`: results-page view controls and visually grounded clicks keep review. */
export const listingReadOnlyEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_LISTING_READ_ONLY?.trim().toLowerCase() !== 'off'

/** Words that name a consequence a click could have beyond changing the view. Generic, not a site list. */
const consequentialWords = /\b(?:buy|purchase|order|checkout|check out|cart|bag|basket|pay|payment|donate|subscribe|unsubscribe|sign|log|login|logout|register|join|member|account|send|share|post|publish|delete|remove|save|submit|apply|confirm|book|reserve|follow|like|favou?rites?|wish ?list|add|accept|agree|allow|install|download|upload|report|contact|message|e-?mail|call|chat|review|rate|claim|redeem|cancel|return|exchange|track|notify|alert|password|verify|gift|coupon|promo|code)\b/iu
const priceText = /(?:[$£€¥]\s?\d|\d(?:[.,]\d{2})?\s?(?:usd|eur|gbp)\b)/iu

/** A page that lists results: many priced items or many item links, outside dialogs, and no filled form. */
export function listingPage(elements: readonly LiveComputerElement[]): boolean {
  if (!listingReadOnlyEnabled()) return false
  const page = elements.filter(element => element.dialogId === null || element.dialogId === undefined)
  if (page.some(element => element.sensitive)) return false
  const prices = page.filter(element => priceText.test(`${element.name ?? ''} ${typeof element.value === 'string' ? element.value : ''}`)).length
  const links = page.filter(element => /link/iu.test(element.role) && (element.name ?? '').trim().length >= 3).length
  return prices >= 6 || (prices >= 3 && links >= 20)
}

function listingViewControl(element: LiveComputerElement, elements: readonly LiveComputerElement[]): boolean {
  if (element.sensitive || element.obstructed || (element.dialogId !== null && element.dialogId !== undefined)) return false
  if (!/(^|ax)(button|tab|radiobutton|togglebutton)$/u.test(normalizeRole(element.role))) return false
  const label = labelOf(element).replace(/\s+/gu, ' ').trim()
  if (!label || label.length > 40 || label.split(' ').length > 4 || consequentialWords.test(label) || priceText.test(label)) return false
  return listingPage(elements)
}

/**
 * A click where the accessibility tree has no control (a furniture retailer's
 * size filter) on a results page, with nothing consequential near it: no text
 * field, no sensitive element, no dialog, and no control within the hit region
 * whose label names a purchase, account, message or other consequence. Such a
 * click changes which results are shown or opens one; it is read-only. The
 * native hit test still proves where the click lands.
 */
export function visualListingClickReadOnly(point: { x: number; y: number }, elements: readonly LiveComputerElement[]): boolean {
  if (!listingPage(elements)) return false
  const radius = 160
  const near = elements.filter(element => element.bounds && element.bounds.x - radius <= point.x && point.x <= element.bounds.x + element.bounds.width + radius
    && element.bounds.y - radius <= point.y && point.y <= element.bounds.y + element.bounds.height + radius)
  if (!near.length) return false
  return !near.some(element => element.sensitive || isEditable(element) || (element.dialogId !== null && element.dialogId !== undefined)
    || consequentialWords.test(labelOf(element)) || element.pointerObstructions?.some(b => pointInside(point, b)))
}

const caretKeys = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'PAGEUP', 'PAGEDOWN', 'HOME', 'END'])
const scrollContainerRoles = /(webarea|scrollarea|document|scrollview)/u
/** Focused controls whose value the same keys would change instead of scrolling. */
const valueBearingRoles = /(popup|combobox|radio|checkbox|slider|stepper|incrementor|menu|list|table|outline|tab|grid|cell|row|datepicker|timepicker|colorwell)/u

export function isScrollContainer(element: LiveComputerElement): boolean {
  return !isEditable(element) && !element.sensitive && scrollContainerRoles.test(normalizeRole(element.role))
}

/** macOS browsers scroll to the top or bottom with Command plus an up/down arrow; Command with left/right navigates history and stays unknown. */
function browserScrollChord(chord: string[]): boolean {
  return chord.length === 2 && chord[0] === 'CMD' && ['UP', 'DOWN', 'ARROWUP', 'ARROWDOWN'].includes(chord[1] ?? '')
}

/** The document that a scroll key would move when no editable field and no
 * value-bearing control has focus. Returns null whenever the key could change
 * a value instead of a scroll position, so those cases keep their review. */
function scrollReceiver(action: ComputerActionProposal, elements: LiveComputerElement[], browser: boolean): LiveComputerElement | null {
  if (action.kind !== 'keypress') return null
  const chord = canonicalChord(action.keys)
  const keys = new Set(chord)
  const terminalKey = chord.at(-1) ?? ''
  if (!(safeNavigationKey(terminalKey, keys) && (caretKeys.has(terminalKey) || terminalKey === 'TAB' || terminalKey === 'ESC' || terminalKey === 'ESCAPE')) && !(browser && browserScrollChord(chord))) return null
  if (terminalKey === 'TAB' || terminalKey === 'ESC' || terminalKey === 'ESCAPE') return null
  const focused = elements.filter(element => element.focused === true)
  if (focused.some(element => isEditable(element) || element.sensitive || valueBearingRoles.test(normalizeRole(element.role)))) return null
  const containers = elements.filter(element => isScrollContainer(element) && element.enabled !== false && !element.obstructed && element.bounds && (element.focused === true || element.containsFocus === true))
  if (!containers.length) return null
  // The innermost focused container is the one the key moves.
  return containers.toSorted((left, right) => area(left) - area(right))[0] ?? null
}

/** Popup buttons, combo boxes, menus and their items: the controls a native
 * `<select>` and an application menu expose while open or focused. */
const menuRoles = /(popupbutton|combobox|menubutton|menubaritem|menuitem|^axmenu$|listbox|option)/u
const popupRoles = /(popupbutton|combobox|menubutton)/u
function menuControl(element: LiveComputerElement): boolean { return menuRoles.test(normalizeRole(element.role)) }
export function popupControl(element: LiveComputerElement): boolean { return popupRoles.test(normalizeRole(element.role)) }

/** The focused popup, combo box, menu or menu item that a choosing key or
 * type-ahead would act on. A native `<select>` opens a popup menu whose items
 * are not editable fields, so Enter to choose and letters to jump were
 * unnameable and every such batch went to recovery (in testing,
 * two of a web page's own prompts died on one). Returns
 * null unless exactly one such control has focus. */
function menuReceiver(action: ComputerActionProposal, elements: LiveComputerElement[]): LiveComputerElement | null {
  if (action.kind === 'keypress') {
    const chord = canonicalChord(action.keys)
    const keys = new Set(chord)
    const terminalKey = chord.at(-1) ?? ''
    if (keys.has('CMD') || keys.has('CTRL') || keys.has('ALT') || keys.has('SHIFT')) return null
    if (!['ENTER', 'RETURN', 'SPACE', 'ESC', 'ESCAPE'].includes(terminalKey) && !caretKeys.has(terminalKey)) return null
  } else if (action.kind !== 'type' || !action.text || action.text.length > 40 || /[\r\n\t]/u.test(action.text)) return null
  const focused = elements.filter(element => element.focused === true && element.enabled !== false && !element.sensitive && !element.obstructed && menuControl(element))
  return focused.length === 1 ? focused[0]! : null
}

/** A menu item shown by an open popup button or combo box: choosing it sets
 * that control's value, which is a reversible local edit and not a command. */
export function popupValueItem(item: LiveComputerElement, elements: readonly LiveComputerElement[]): boolean {
  return /menuitem|option/u.test(normalizeRole(item.role))
    && elements.some(element => popupControl(element) && (element.expanded === true || element.focused === true || element.containsFocus === true))
}

function safeNavigationKey(terminalKey: string, keys: Set<string>): boolean {
  if (keys.has('CMD') || keys.has('CTRL') || keys.has('ALT')) return false
  return terminalKey === 'TAB' || terminalKey === 'ESC' || terminalKey === 'ESCAPE' || caretKeys.has(terminalKey)
}

/** Caret movement and selection inside a proven editable field: arrows,
 * Home/End, paging, with Shift, Option, or Command. Control-arrows switch
 * macOS Spaces, so they never count as local. */
function editableCaretKey(terminalKey: string, keys: Set<string>): boolean {
  return caretKeys.has(terminalKey) && !keys.has('CTRL')
}

/** The everyday editing chords: bold, italic, underline, undo and redo.
 * Select All has a separate focused-field or immediate-replacement contract;
 * anything else with a modifier stays unknown. */
function editableFormattingChord(chord: string[]): boolean {
  if (chord.length < 2 || chord.length > 3) return false
  const modifiers = chord.slice(0, -1)
  const key = chord.at(-1) ?? ''
  if (!modifiers.includes('CMD') || !modifiers.every((modifier) => modifier === 'CMD' || modifier === 'SHIFT')) return false
  return ['B', 'I', 'U', 'Z'].includes(key)
}

/** A field whose declared job is to look something up (a search field role,
 * or a label that says search, find, or filter). Enter here navigates or
 * filters; it does not send, buy, or save. A generic "Query" field is not
 * enough: its Enter stays a protected submission. */
/** A multi-line text editor: a document, note or slide body where Enter inserts a line rather
 * than submitting. A single-line form field (short, AXTextField) is not one, so its Enter still submits. */
function isMultilineEditor(element: LiveComputerElement): boolean {
  if (!isEditable(element) || element.sensitive) return false
  const role = normalizeRole(element.role)
  if (role.includes('textarea')) return true
  // A tall editable region is a body of text, not a one-line input. A single-line field is ~20-30px.
  return Boolean(element.bounds && element.bounds.height >= 60)
}

const preferenceChooserTitle = /\b(?:how (?:would|do) you (?:like to|want to) (?:shop|receive|get)|(?:choose|select|set|pick|change|confirm) (?:your |a )?(?:store|location|region|country|language|currency|delivery (?:method|option)|shopping (?:method|mode))|delivery or pickup|pickup or delivery|where (?:do|would) you (?:like to )?shop)\b/iu

/** The dialog around a control only picks a shopping or locale preference: its title says so, and it holds no sensitive or payment field. */
function preferenceChooserDialog(element: LiveComputerElement, elements: readonly LiveComputerElement[]): boolean {
  if (!element.bounds || element.sensitive) return false
  const inside = (inner: NonNullable<LiveComputerElement['bounds']>, outer: NonNullable<LiveComputerElement['bounds']>) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
    && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1
  const dialog = elements.filter(e => e.bounds && /dialog|sheet/iu.test(`${e.subrole ?? ''} ${e.role}`) && inside(element.bounds!, e.bounds))
    .sort((left, right) => area(left) - area(right))[0]
  if (!dialog?.bounds || !preferenceChooserTitle.test(labelOf(dialog))) return false
  return !elements.some(e => e.bounds && inside(e.bounds, dialog.bounds!) && (e.sensitive || /\b(pay|payment|card number|cvv|place order|buy|purchase|checkout)\b/iu.test(labelOf(e))))
}

const lookupSubmitLabel = /^(?:go|search|find|filter|button|apply(?: filters?)?|update (?:results|search)|show results|search button|submit search)?$/iu

/** A plain button on the same row as a search or filter field, close to it, with no other text field between. */
function lookupSubmitButton(element: LiveComputerElement, elements: readonly LiveComputerElement[]): boolean {
  if (!/(^|ax)button$/u.test(normalizeRole(element.role)) || element.sensitive || !element.bounds) return false
  if (!lookupSubmitLabel.test(labelOf(element).replace(/\s+/gu, ' ').trim())) return false
  const b = element.bounds
  const sameRow = (other: NonNullable<LiveComputerElement['bounds']>) => {
    const overlap = Math.min(b.y + b.height, other.y + other.height) - Math.max(b.y, other.y)
    return overlap >= 0.5 * Math.min(b.height, other.height)
  }
  const gap = (other: NonNullable<LiveComputerElement['bounds']>) => Math.max(other.x - (b.x + b.width), b.x - (other.x + other.width), 0)
  const fields = elements.filter(e => e !== element && e.bounds && isEditable(e) && !e.sensitive && sameRow(e.bounds))
    .sort((left, right) => gap(left.bounds!) - gap(right.bounds!))
  const nearest = fields[0]
  return Boolean(nearest && isLookupField(nearest) && gap(nearest.bounds!) <= 240)
}

/** A single-line field that runs a search when Enter is pressed in it: a
 * search field by role (type=search, role=searchbox, AXSearchField) or a text
 * field, combobox or one-line text area the page labels as search. Never the
 * browser's address or Find bar, a filter that updates live, a tall text
 * region or a secret. */
export function searchSubmitField(element: LiveComputerElement): boolean {
  if (!isEditable(element) || element.sensitive || element.enabled === false || isBrowserLocationField(element) || isBrowserFindField(element)) return false
  // Google's and Bing's search boxes are one-line text areas: a tall region is a body of text instead.
  if (element.bounds && element.bounds.height >= 60) return false
  const role = `${normalizeRole(element.role)} ${(element.subrole ?? '').toLowerCase()}`
  if (role.includes('search')) return true
  const labels = [element.name, element.placeholder, element.description, element.identifier].filter((value): value is string => typeof value === 'string').join(' ')
  return /\bsearch\b/iu.test(labels)
}

/** The focused search or filter field when it already holds text: Enter in
 * it runs the same lookup a suggestion row or search button would. The
 * browser's own Find bar is not a site search (Bing: with
 * Chrome's Find bar left open, the actor was told to press Enter in "Find" to
 * run its web search), nor is the address bar. */
export function focusedLookupFieldWithText(elements: readonly LiveComputerElement[]): { label: string } | null {
  const field = elements.find(e => (e.focused === true) && isEditable(e) && !e.sensitive && isLookupField(e) && !isBrowserFindField(e) && !isBrowserLocationField(e)
    && typeof e.value === 'string' && e.value.trim().length > 0)
  return field ? { label: labelOf(field).slice(0, 60) || 'search' } : null
}

export function isLookupField(element: LiveComputerElement): boolean {
  if (normalizeRole(element.role).includes('search')) return true
  const semantics = [element.subrole, element.name, element.description, classifiableHelp(element), element.placeholder]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
  return /\b(search|find|filter)\b/u.test(semantics)
}

/** The browser's own find-in-page field: a lookup local to the window that
 * sends nothing to a site. Chrome names it "Find in page"; Safari and Firefox
 * "Find". It sits in the browser chrome above the page like the location field. */
export function isBrowserFindField(element: LiveComputerElement): boolean {
  if (!isEditable(element) || element.sensitive || !element.bounds || element.bounds.y >= 200) return false
  const semantics = [element.identifier, element.name, element.placeholder, element.description]
    .filter((value): value is string => typeof value === 'string').join(' ')
  return [element.name, element.placeholder].some(value => /^find$/iu.test(value?.trim() ?? ''))
    || /\bfind (?:in|on) page\b|\bfind bar\b|find[-_ ]?field|find[-_ ]?text/iu.test(semantics)
}

/** The focused editable that is the browser's address bar, if any: the receiver of typing when Cmd+L has been pressed. */
export function focusedBrowserLocationReceiver(elements: readonly LiveComputerElement[]): LiveComputerElement | undefined {
  return elements.find(element => (element.focused === true || element.containsFocus === true) && isBrowserLocationField(element))
}

export function isBrowserLocationField(element: LiveComputerElement): boolean {
  return isEditable(element) && Boolean(element.bounds && element.bounds.y < 120)
    && /browser[-_ ]location|(?:address|location|url)(?: and search)? (?:bar|field)|omnibox/iu.test(`${element.identifier ?? ''} ${element.name}`)
}

/** Recognize Select All followed by replacement in one controller-held batch.
 * Standalone selection is handled separately for a proven focused field.
 * The current frame must
 * already prove one non-sensitive editable receiver (or the batch must first
 * click one). Other modified shortcuts remain unknown and fail closed; the
 * exact browser-location transaction is compiled separately above. */
function isSelectAllReplacement(
  action: ComputerActionProposal,
  nextAction: ComputerActionProposal | undefined,
): action is Extract<ComputerActionProposal, { kind: 'keypress' }> {
  return nextAction?.kind === 'type' && isSelectAllKeypress(action)
}

function canonicalKey(value: string): string {
  const key = value.trim().toUpperCase().replaceAll(/[\s_-]+/gu, '')
  if (key === 'META' || key === 'COMMAND' || key === 'SUPER') return 'CMD'
  if (key === 'CONTROL') return 'CTRL'
  if (key === 'OPTION') return 'ALT'
  if (key === 'RETURN') return 'ENTER'
  return key
}

/** Browser location focus is deterministic only for a recognized browser in
 * the exact selected window. Keep the contract atomic: focus, optional Select
 * All, one complete HTTPS address or search phrase, and Enter. This prevents a generic modified
 * shortcut or later unrelated text from borrowing the location-bar binding. */
function compileBrowserLocationTransaction(
  actions: ComputerActionProposal[],
  windowTarget: string,
  bundleIdentifier: string,
  approvedGoal: string | undefined,
  researchScope?: BrowserResearchScope,
  launchUrls: BrowserLaunch = [],
): UniversalComputerBatchPreflight | null {
  if (!isBrowserBundleIdentifier(bundleIdentifier) || !isBrowserLocationFocus(actions[0])) return null
  const hasSelectAll = Boolean(actions[1] && isSelectAllKeypress(actions[1]))
  const typedIndex = hasSelectAll ? 2 : 1
  const typed = actions[typedIndex]
  const payload = typed?.kind === 'type' ? browserLocationPayload(typed.text) : null
  const searchQuery = typed?.kind === 'type' ? browserLocationSearchQuery(typed.text) : null
  const digest = payload?.digest ?? (searchQuery ? sha256(stableJson(searchQuery)) : null)
  // An optional forward Delete between typing and Enter drops the browser's
  // inline completion, so Enter opens exactly the typed address.
  const next = actions[typedIndex + 1]
  const dismissal = next?.kind === 'keypress' && isInlineCompletionDismissal(next) ? 1 : 0
  const submit = actions[typedIndex + 1 + dismissal]
  // Cmd+L itself establishes browser focus without guessing which page field
  // is focused. Unrecognized following input gets a fresh observation first.
  const count = payload || searchQuery ? typedIndex + 1 + dismissal + (isEnterKeypress(submit) ? 1 : 0) : 1
  const target = `${windowTarget}/browser_location`
  const coveredByGoal = payload && approvedGoal !== undefined && browserLocationCoveredByGoal(payload.url, approvedGoal, researchScope, launchUrls)
  const effects = actions.map((action, i): ActionEffect => {
    if (i >= count) return unknownEffect()
    if (searchQuery && (action.kind === 'type' || isEnterKeypress(action))) return { ...unknownEffect(), payloadDigest: digest, payloadResolved: true }
    if (action.kind === 'type') return knownEffect('safe_local', target, payload!.digest)
    if (isEnterKeypress(action)) return coveredByGoal ? knownEffect('read_only', target, payload!.digest) : { ...unknownEffect(), payloadDigest: payload!.digest, payloadResolved: true }
    return knownEffect('safe_local', target, null)
  })
  return {
    observationBoundary: count,
    effects,
    semanticBindings: actions.map((action, actionIndex) => ({
      actionIndex, actionKind: action.kind, elementId: null,
      role: actionIndex < count ? 'browser_location' : null,
      target: actionIndex < count ? target : null,
      resolved: effects[actionIndex]!.targetResolved,
      ...(actionIndex < count && payload && isEnterKeypress(action) ? { browserDestination: payload.url.href } : {}),
      ...(actionIndex < count && searchQuery && (action.kind === 'type' || isEnterKeypress(action)) ? { browserSearchQuery: searchQuery } : {}),
      ...(actionIndex < count && !coveredByGoal && isEnterKeypress(action) ? { resolutionIssue: 'browser_destination_outside_plan' as const } : {}),
    })),
  }
}

function isBrowserLocationFocus(action: ComputerActionProposal | undefined): boolean {
  if (action?.kind !== 'keypress') return false
  const keys = canonicalChord(action.keys)
  return keys.length === 2 && keys[0] === 'CMD' && keys[1] === 'L'
}

function isSelectAllKeypress(action: ComputerActionProposal): action is Extract<ComputerActionProposal, { kind: 'keypress' }> {
  if (action.kind !== 'keypress') return false
  const keys = canonicalChord(action.keys)
  return keys.length === 2 && keys[1] === 'A' && (keys[0] === 'CMD' || keys[0] === 'CTRL')
}

function isEnterKeypress(action: ComputerActionProposal | undefined): boolean {
  if (action?.kind !== 'keypress') return false
  const keys = canonicalChord(action.keys)
  return keys.length === 1 && (keys[0] === 'ENTER' || keys[0] === 'RETURN')
}

/** A lone forward delete: removes selected text after the caret and nothing before it. */
function isInlineCompletionDismissal(action: Extract<ComputerActionProposal, { kind: 'keypress' }>): boolean {
  const chord = canonicalChord(action.keys)
  return chord.length === 1 && chord[0] === 'FORWARDDELETE'
}

function canonicalChord(keys: string[]): string[] {
  return keys.flatMap((key) => key.split('+')).map(canonicalKey).filter(Boolean)
}

function browserLocationPayload(text: string): { digest: string; url: URL } | null {
  if (!text || text !== text.trim()) return null
  try {
    // Browsers accept a bare hostname as an address. Never reinterpret a
    // scheme, credentials, whitespace or a search phrase as an HTTPS URL.
    const bareHost = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::[0-9]{1,5})?(?:[/?#][^\s\\]*)?$/iu.test(text)
    const url = new URL(bareHost ? `https://${text}` : text)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return { digest: sha256(stableJson(text)), url }
  } catch {
    return null
  }
}

/** Keep searches as searches rather than inventing a provider URL. Reject URL
 * schemes/credentials masquerading as queries; ordinary search operators are
 * allowed. Scope and disclosure are judged by the contextual reviewer. */
function browserLocationSearchQuery(text: string | null): string | null {
  if (!text?.trim() || /[\p{Cc}\\]/u.test(text) || browserLocationPayload(text)) return null
  const scheme = text.trimStart().match(/^([a-z][a-z0-9+.-]*):/iu)?.[1]?.toLowerCase()
  if (scheme && !['site', 'inurl', 'intitle', 'intext', 'filetype', 'ext', 'before', 'after', 'related', 'allintitle', 'allinurl', 'allintext'].includes(scheme)) return null
  // A padded address must not be recast as a search to evade URL handling.
  if (browserLocationPayload(text.trim())) return null
  return text
}

/** Structured and Universal address entry share one destination contract. */
export function browserLocationCoveredByGoal(url: URL, approvedGoal: string, researchScope?: BrowserResearchScope, launchUrls: BrowserLaunch = []): boolean {
  return browserDestinationCoveredByGoal(url, approvedGoal) || browserResearchDestinationCovered(url, researchScope) || browserLaunchDestinationCovered(url, launchUrls)
}

export function isBrowserBundleIdentifier(bundleIdentifier: string): boolean {
  return /(?:chrome|chromium|brave|edge|firefox|safari|arc)/iu.test(bundleIdentifier)
}

function knownEffect(effectClass: ActionEffectClass, target: string, payloadDigest: string | null): ActionEffect {
  const protectedEffect = ['communication', 'submission', 'financial', 'destructive', 'authentication', 'installation', 'privilege_escalation', 'confidential_disclosure', 'legal_acceptance', 'high_impact_decision'].includes(effectClass)
  return {
    class: effectClass,
    location: effectClass === 'unclassified_control' ? 'unknown' : protectedEffect || effectClass === 'external_write' ? 'external' : 'local',
    reversibility: effectClass === 'unclassified_control'
      ? 'unknown'
      : ['destructive', 'legal_acceptance', 'high_impact_decision'].includes(effectClass)
      ? 'irreversible'
      : effectClass === 'read_only' || effectClass === 'safe_local'
        ? 'none'
        : 'reversible',
    target,
    payloadDigest,
    targetResolved: true,
    payloadResolved: true,
  }
}

function unknownEffect(): ActionEffect {
  return {
    class: 'unknown',
    location: 'unknown',
    reversibility: 'unknown',
    target: null,
    payloadDigest: null,
    targetResolved: false,
    payloadResolved: false,
  }
}

function clickEffectNeedsPayload(effectClass: ActionEffectClass): boolean {
  return ['external_write', 'communication', 'submission', 'financial', 'confidential_disclosure', 'legal_acceptance'].includes(effectClass)
}

/**
 * A control that takes typed characters as its own value without being a
 * text field: a web number input (AXIncrementor carrying a value) and the
 * numeric segments of a web date or time field. Typing changes only that
 * control, like a text field; Enter keeps the text-field rule (a protected
 * submission). Keyboard focus is still proven before any character is sent.
 */
export function typedValueReceiver(element: LiveComputerElement): boolean {
  if (element.sensitive || element.enabled === false) return false
  return /(incrementor|datefield|timefield)/u.test(normalizeRole(element.role))
}

export function isEditable(element: LiveComputerElement): boolean {
  const role = normalizeRole(element.role)
  return element.editable === true || role.includes('textfield') || role.includes('textarea') || role.includes('combobox')
}

function normalizeRole(role: string): string {
  return role.trim().toLocaleLowerCase().replaceAll(/[^a-z0-9]+/gu, '_').replaceAll(/^_|_$/gu, '') || 'unknown'
}

function pointInside(point: { x: number; y: number }, bounds: NonNullable<LiveComputerElement['bounds']>): boolean {
  return point.x >= bounds.x && point.y >= bounds.y && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height
}

function area(element: LiveComputerElement): number {
  return element.bounds ? element.bounds.width * element.bounds.height : Number.POSITIVE_INFINITY
}
