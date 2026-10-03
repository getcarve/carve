import { startEventLoopProbe } from '../event-loop-probe.js'
import { preflightEquivalent } from './universal.js'
import { dedupeInContext, sourceDocumentKey, sourceDocumentOf, sourceElementText, sourceElementVisible, type SourceDocument } from './source-observations.js'
import { applyActionInterpretation, containsPoint, focusedTextReceiver, interpretationEffectClasses, interpretationIndices, type ActionInterpretationInput, type InterpretedAction } from './action-interpretation.js'
import { actionReviewIndices, mechanicalObservationBoundary, overheadLevers, overheadPolicyFor, verificationPolicyFor, verificationPolicyMode } from './verification-policy.js'
import type { BrowserResearchScope } from '../browser-destinations.js'
import { windowLifecycleEffect, WindowLifecycleFeedback, type WindowLifecycleEffect } from './window-lifecycle.js'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile, stat } from 'node:fs/promises'
import type { LiveComputerBackend, LiveComputerCapturedFrame, LiveComputerPageText } from '../live-computer.js'
import { readFastOff } from './compact-prompt.js'
import type { ComputerActionProposal, ComputerActionScreenshot } from '../providers/types.js'
import type { LiveComputerAction, LiveComputerPhysicalActionReceipt, LiveComputerTarget } from '../types.js'
import { id, sha256, stableJson } from '../util.js'
import { elementIdentityForAxDelivery, elementIdentityForInput, resolveInputTarget } from '../live-computer-evidence.js'
import { receiverIdentityDigest } from './receiver-state.js'
import { codeEditorInputEnabled, isCodeEditorReceiver } from './code-editor.js'
import { compactAxLadderEnabled, type CompactDelivery } from './compact-provider.js'
import { liveComputerElementSupportsTextEntry } from '../live-computer-action-contract.js'
import type { LiveComputerElement } from '../types.js'
import type { UniversalBriefControl, UniversalComputerActionGrounding, UniversalComputerBatchPreflight, UniversalComputerUseBackend, UniversalComputerUseSettleRequest, UniversalComputerUseSettleResult, UniversalNearbyControl } from './universal.js'
import { clickEffectResolvable, compactRefSelectorEffect, compileUniversalComputerBatchPreflight, focusedBrowserLocationReceiver, isBrowserBundleIdentifier, isBrowserFindField, isBrowserLocationField, isEditable, focusedLookupFieldWithText, popupControl, popupValueItem } from './effects.js'
import { compareVisibleState, visualStateEquivalent } from './visual-stability.js'
import { snapClickPoint, type SnappedClick } from './click-snap.js'
import { ComputerInputDeliveryError, requireDeliveredInput } from './input-delivery.js'
import { GovernedResaveRefusal, checkGovernedResave, confirmGovernedResave, confirmGovernedSaveOnDisk, confirmObservedSave, editSavedDocumentEnabled, governedSaveEnabled, governedSaveLiveAction, governedSaveReceiptEnabled, requireGovernedSave, type GovernedSaveRecord } from './governed-save.js'
import type { BrowserLaunchScope } from '../browser-destinations.js'
import { learnLoadedAddress } from './source-observations.js'
import { boundarySite, detectSignInPage, frameBoundaryTexts, HumanVerificationBoundary, humanVerificationInFrame, humanVerificationInPageText, passwordFieldInFrame, type SiteBoundary } from './site-boundaries.js'
import { classifyObstructionControl, obstructionControls, obstructionCovering } from './obstructions.js'

/** The host of text typed into a location field when it reads as a web address; null for anything else (a search phrase, a partial word). */
export function typedAddressHost(text: string): string | null {
  const value = text.trim()
  if (!value || /\s/u.test(value)) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ? value : `https://${value}`)
    if (!['http:', 'https:'].includes(url.protocol) || !/^[\w.-]+\.[a-z]{2,}$/iu.test(url.hostname) && url.hostname !== 'localhost') return null
    return url.hostname.toLowerCase()
  } catch { return null }
}

/** A pointer input the dispatch-time hit test withheld (no input sent), by
 * the kind of thing in front: `covered` is a page element laid over the
 * control (a retailer's styled "Sort by" group over its <select>), `dialog` a
 * covering dialog, `backdrop` a pop-up's full-page backdrop, `unstable` a hit
 * test that did not settle. Never text; identity and role only. */
export interface SelectedWindowPointerRefusal { id: number; role: string; label: string | null; fingerprint: string | null; reason: 'covered' | 'dialog' | 'backdrop' | 'unstable' }

export interface SelectedWindowInputLedgerEntry { sequence: number; kind: ComputerActionProposal['kind'] | 'element_action'; /** For `element_action` only: the platform action performed on the bound control by identity. */ elementAction?: 'show_menu' | 'activate' | 'focus'; label: string | null; role: string | null; point?: { x: number; y: number }; /** Absent means confirmed; an uncertain attempt is evidence of neither success nor inaction. */ delivery?: 'uncertain'; /** For `type` only: how much was typed, never what. */ characters?: number; /** For `keypress` only: a save chord or a bare Enter, the two persistence keys; other keys are not recorded. */ chord?: 'save' | 'enter' }

/** Controller evidence transferred only between attempts on the same window.
 * A new engine does not make an earlier mutation disappear. */
export interface SelectedWindowHandoffEvidence {
  windowId: number
  bundleIdentifier: string
  inputLedger: SelectedWindowInputLedgerEntry[]
  inputSequence: number
  initialDocumentText: string | null
  initialDocumentRead: boolean
  contentInputAttempted: boolean
  /** Bounded, non-sensitive source text; historical facts, never current controls or authority. */
  observations?: Array<{ frameId: string; text: string; source?: SourceDocument | null }>
}

export interface SelectedWindowComputerUseBackendOptions {
  interpretActions?: (input: ActionInterpretationInput, signal: AbortSignal) => Promise<InterpretedAction[]>
  prepareFieldRequirements?: (labels: string[], signal: AbortSignal) => Promise<void>
  /** Capture field values right after typing so a later click cannot hide the edit from the completion review. Off for goals that may not write. */
  fieldProofs?: boolean
  /** Click-snap tolerance in frame pixels; 0 never snaps. Defaults to the overhead lever. */
  clickSnap?: number
  /** A batch admitted on the actor's own authority because action reviews are off: how many actions the vocabulary could not name. */
  onActorAuthority?: (detail: { actions: number; unclassified: number }) => void
  /** Text was typed into the browser's own location field: its host when it reads as an address, else null for a search phrase. Never the path, query or the phrase. */
  onAddressTyped?: (detail: { host: string | null; characters: number }) => void
  interpretationContext?: () => Pick<ActionInterpretationInput, 'task' | 'referenceResolution' | 'plan' | 'timeContext' | 'outcomeFeedback'>
  readNavigationOnly?: boolean
  /** Called only for known window-management chords, using the user task. */
  authorizeWindowEffect?: (effect: WindowLifecycleEffect, action: ComputerActionProposal, signal: AbortSignal) => Promise<boolean>
  onWindowRecovery?: (effect: string) => void
  ownedWindowGroup?: boolean
  compact?: boolean
  priorAttempt?: SelectedWindowHandoffEvidence
  backend: LiveComputerBackend
  target: LiveComputerTarget
  sessionId: string
  /** Reviewed outcome used only to prove a browser destination is covered by
   * the already-authorized read-only plan. */
  approvedGoal?: string
  /** Injectable only for tests: reads a governed save's file back (governed-save.ts confirmGovernedSaveOnDisk). */
  readSavedFile?: (path: string) => Promise<Uint8Array>
  /** Saves an earlier session of this conversation made from this same window and read back from disk
   * (governed-save.ts editSavedDocumentEnabled). save_as to one of these paths saves that file in place. */
  inheritedSaves?: GovernedSaveRecord[]
  browserResearchScope?: BrowserResearchScope
  browserLaunchUrls?: string[]
  /** Site labels the request names (named-destinations.ts): their own origins are in the plan. */
  browserNamedSites?: string[]
  /** Injectable only to keep platform normalization deterministic in tests. */
  platform?: NodeJS.Platform
  /** Legacy fallback/poll interval override retained for deterministic probes. */
  settleMs?: number
  settlePollMs?: number
  settleStableFrames?: number
  settleMaxMs?: number
  onCapture?: (frame: LiveComputerCapturedFrame) => void
  /** Per-phase wall clock of one delivered action, for the latency audit. Never action content. */
  onActionTiming?: (detail: { kind: string; compact: boolean; totalMs: number; timings: Record<string, number> }) => void
  /** A controller-side judgement about a capture or hit test that changed what was allowed; roles and reasons only. */
  onCaptureDiagnostic?: (detail: Record<string, unknown>) => void
  /** The layout digest of a local capture of this window taken when the
   * request was submitted (never sent anywhere). The first stable-layout wait
   * compares the session's own fresh frame with it instead of waiting and
   * capturing again; any difference falls back to the ordinary wait. */
  stabilityBaseline?: () => Promise<{ digest: string; capturedAt: number } | null>
}

/**
 * Mechanical adapter from the provider-neutral computer vocabulary to
 * Carve's selected-window native bridge. It does not recognize particular
 * applications or workflows. Every physical action still revalidates the
 * exact window identity and bounds in `LiveComputerBackend.execute`.
 */
export class SelectedWindowComputerUseBackend implements UniversalComputerUseBackend {
  private compactHistory: LiveComputerCapturedFrame[] = []
  private compactBindings: Array<{ action: ComputerActionProposal; target: LiveComputerElement | null; decisionDigest: string | null; delivery?: CompactDelivery | null }> | null = null
  private windowRecoveryExpiresAt = 0
  private captureSequence = 0
  private observedFieldLabels = new Set<string>()
  private observedFieldValues = new Map<string, { field: string; value: string; frameId: string }>()
  private observedTexts = new Set<string>()
  /** Lines already retained per source document. A line repeated on another
   * page (a shared medium, a field label) belongs to that page too. */
  private observedTextsBySource = new Map<string, Set<string>>()
  private observationHistory: Array<{ frameId: string; text: string; source?: SourceDocument | null }> = []
  /** The document as first observed, before this session delivered any input; the baseline a write is measured against. */
  private initialDocumentText: string | null = null
  /** The multi-line receiver the last keypress selected all of, for the final-line-break rule; null after anything else. */
  private selectAllOn: string | null = null
  private initialDocumentRead = false
  private contentInputAttempted = false
  private inputSequence = 0
  /** Confirmed deliveries and explicitly uncertain attempts. Never typed text or key contents. */
  private readonly inputLedger: SelectedWindowInputLedgerEntry[] = []
  /** Governed saves the controller read back from disk, by the ledger sequence of their Save chord. */
  private readonly governedSaves: Array<GovernedSaveRecord & { sequence: number; inherited?: boolean }> = []
  private readonly pointerRefusalLog: SelectedWindowPointerRefusal[] = []
  private pointerRefusalSequence = 0
  private lastFrame: LiveComputerCapturedFrame | null = null
  /** A full capture taken for the batch fingerprint that no input has followed.
   * The first compact input reuses it instead of walking the same tree again. */
  private freshCompactCapture: { frameId: string; at: number } | null = null
  /** The control the last input was aimed at, by the actor's own ref: receipts name it, not the policy's point binding. */
  private lastInputTarget: string | null = null

  private stabilityBaselinePending: Promise<{ digest: string; capturedAt: number } | null> | null = null

  constructor(private readonly options: SelectedWindowComputerUseBackendOptions) {
    this.stabilityBaselinePending = options.stabilityBaseline?.() ?? null
    const prior = options.priorAttempt
    if (prior) {
      if (prior.windowId !== options.target.windowId || prior.bundleIdentifier !== options.target.bundleIdentifier) throw new Error('Input evidence belongs to another selected window')
      this.inputLedger.push(...structuredClone(prior.inputLedger).slice(-200))
      this.inputSequence = prior.inputSequence
      this.initialDocumentText = prior.initialDocumentText
      this.initialDocumentRead = prior.initialDocumentRead
      this.contentInputAttempted = prior.contentInputAttempted
      this.observationHistory = (prior.observations ?? []).slice(-128).map(entry => ({ frameId: entry.frameId.slice(0, 160), text: entry.text.slice(0, 12000), ...(entry.source ? { source: { url: entry.source.url?.slice(0, 2000) ?? null, title: entry.source.title?.slice(0, 200) ?? null, ...(entry.source.schemeShown === false ? { schemeShown: false as const } : {}) } } : {}) }))
      while (this.observationHistory.reduce((size, entry) => size + entry.text.length, 0) > 64000) this.observationHistory.shift()
      for (const entry of this.observationHistory) this.rememberSourceLines(entry.source ?? null, entry.text.split('\n'))
    }
  }

  async prepare(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.options.backend.activate?.(this.options.target, signal)
    signal.throwIfAborted()
  }

  historicalEvidence() { return this.observationHistory.map(e => ({ ...e, ...(e.source ? { source: { ...e.source } } : {}) })) }

  private rememberSourceLines(source: SourceDocument | null, lines: string[]): void {
    const key = sourceDocumentKey(source)
    let set = this.observedTextsBySource.get(key)
    if (!set) this.observedTextsBySource.set(key, set = new Set())
    dedupeInContext(lines, set)
    for (const line of lines) this.observedTexts.add(line)
    while (this.observedTexts.size > 2048) this.observedTexts.delete(this.observedTexts.values().next().value!)
    // Bound the per-document sets together: oldest documents give way first.
    let total = [...this.observedTextsBySource.values()].reduce((n, entries) => n + entries.size, 0)
    for (const [oldest, entries] of this.observedTextsBySource) {
      if (total <= 4096 || oldest === key) break
      total -= entries.size
      this.observedTextsBySource.delete(oldest)
    }
  }

  async completionEvidence(signal: AbortSignal) {
    const { frame } = await this.captureFrame(signal)
    this.options.onCapture?.(frame)
    return { frame, fieldLabels: [...this.observedFieldLabels], fieldValues: [...this.observedFieldValues.values()], priorObservations: this.observationHistory.filter(e => e.frameId !== frame.id).map(e => ({ ...e })), inputLedger: this.inputEvidence() }
  }

  inputEvidence(): SelectedWindowInputLedgerEntry[] { return structuredClone(this.inputLedger) }

  deliveredInputs(): SelectedWindowInputLedgerEntry[] { return this.inputEvidence().filter(entry => entry.delivery !== 'uncertain') }

  /** Files this session saved through the governed save and read back from disk, oldest first. `editedAfter`: text was
   * typed or dragged into the window (or such an attempt is uncertain) after that save, so the file may lag the document. */
  savedFiles(): Array<GovernedSaveRecord & { sequence: number; editedAfter: boolean; inherited?: boolean }> {
    if (!this.inheritedSeeded) {
      this.inheritedSeeded = true
      // Sequence 0: every input of this session comes after the earlier save.
      if (editSavedDocumentEnabled()) this.governedSaves.unshift(...(this.options.inheritedSaves ?? []).map(record => ({ ...structuredClone(record), sequence: 0, inherited: true })))
    }
    return this.governedSaves.map(record => ({ ...record,
      editedAfter: this.inputLedger.some(entry => entry.sequence > record.sequence && (entry.kind === 'type' || entry.kind === 'drag')) }))
  }

  private inheritedSeeded = false

  /** Records a save made through the window's own Save dialog when nothing else did (governed-save.ts confirmObservedSave).
   * Runs once at the end of the session; returns whether a record was added. The path is never shown to a model. */
  /** Whether recordObservedSave could add anything: a TextEdit window with a readable document location and no save yet. */
  observedSaveCandidate(): boolean {
    return governedSaveReceiptEnabled() && this.options.target.bundleIdentifier === 'com.apple.TextEdit'
      && !this.governedSaves.some(record => !record.inherited) && Boolean(this.options.backend.documentLocation)
  }

  async recordObservedSave(approvedGoal: string, sinceMs: number, signal: AbortSignal): Promise<boolean> {
    if (!this.observedSaveCandidate() || !this.options.backend.documentLocation) return false
    const documentPath = await this.options.backend.documentLocation(this.options.target).catch(() => null)
    signal.throwIfAborted()
    if (!documentPath) return false
    const file = await stat(documentPath).then(info => ({ isFile: info.isFile(), mtimeMs: info.mtimeMs, size: info.size })).catch(() => null)
    if (!file?.isFile || file.size > 2_000_000) return false
    const read = this.options.readSavedFile ?? (path => readFile(path))
    const bytes = await read(documentPath).catch(() => null)
    signal.throwIfAborted()
    const shown = this.lastFrame ? documentTextOf(this.lastFrame) : null
    const windowText = shown?.complete ? null : await this.options.backend.pageText?.(this.options.target, 120_000).catch(() => null) ?? null
    signal.throwIfAborted()
    const documentText = shown?.complete ? shown.text : windowText && !windowText.truncated ? windowText.text : null
    const record = confirmObservedSave({ documentPath, approvedGoal, documentText, file, bytes, sinceMs })
    this.options.onCaptureDiagnostic?.({ stage: 'observed_save_check', outcome: record ? 'recorded' : 'not_established' })
    if (!record) return false
    this.governedSaves.push({ ...record, sequence: this.inputSequence })
    return true
  }

  /** Pointer inputs withheld by the dispatch-time hit test, newest last (bounded). */
  pointerRefusals(): SelectedWindowPointerRefusal[] { return structuredClone(this.pointerRefusalLog) }

  handoffEvidence(): SelectedWindowHandoffEvidence {
    return { windowId: this.options.target.windowId, bundleIdentifier: this.options.target.bundleIdentifier,
      inputLedger: this.inputEvidence(), inputSequence: this.inputSequence, initialDocumentText: this.initialDocumentText,
      initialDocumentRead: this.initialDocumentRead, contentInputAttempted: this.contentInputAttempted,
      observations: this.historicalEvidence() }
  }

  fieldProofs(): Array<{ field: string; value: string; frameId: string }> { return [...this.observedFieldValues.values()].map(proof => ({ ...proof })) }

  /** The names of every non-sensitive editable field observed so far. */
  fieldLabels(): string[] { return [...this.observedFieldLabels] }

  /** Every line of non-sensitive text observed in the selected window during this session, current frame included. */
  observedTextCorpus(): string[] {
    const current = this.lastFrame ? this.lastFrame.elements.filter(e => !e.sensitive).flatMap(e => [e.name, e.value, e.description].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)) : []
    return [...new Set([...this.observedTexts, ...current])]
  }

  /** The document the window shows, read back for a write proof: its text as
   * the application exposes it, the same document as first observed, and the
   * saved file when the window names a local one. Uses the last captured
   * frame; the caller captures first. The file is read from this process only
   * and its path is never recorded or shown to a model. */
  /** Checks before the in-place save of a file a receipt names (governed-save.ts checkGovernedResave). No input is sent
   * when a check fails; the refusal tells the actor why. */
  private async prepareGovernedResave(filePath: string, signal: AbortSignal): Promise<{ record: GovernedSaveRecord; prior: string }> {
    const record = this.savedFiles().filter(entry => entry.filePath === filePath).at(-1)
    if (!record) throw new GovernedResaveRefusal('No input was sent: no save receipt names that file in this conversation.')
    const read = this.options.readSavedFile ?? (path => readFile(path))
    const onDisk = await read(filePath).catch(() => null)
    signal.throwIfAborted()
    const documentPath = await this.options.backend.documentLocation?.(this.options.target).catch(() => null) ?? null
    signal.throwIfAborted()
    // The document's whole text: the frame's editor value when it is complete, else the window's text read.
    const shown = this.lastFrame ? documentTextOf(this.lastFrame) : null
    const windowText = shown?.complete ? null : await this.options.backend.pageText?.(this.options.target, 120_000).catch(() => null) ?? null
    signal.throwIfAborted()
    const documentText = shown?.complete ? shown.text : windowText && !windowText.truncated ? windowText.text : null
    try {
      const { prior } = checkGovernedResave({ record, onDisk, documentPath, documentText, bundleIdentifier: this.options.target.bundleIdentifier })
      this.options.onCaptureDiagnostic?.({ stage: 'governed_resave_check', outcome: 'allowed' })
      return { record, prior }
    } catch (error) {
      this.options.onCaptureDiagnostic?.({ stage: 'governed_resave_check', outcome: 'refused', reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown' })
      throw error
    }
  }

  /** After the in-place save: poll the file (up to 3 s) until it changes, then require the earlier text to be kept. */
  private async confirmResave(resave: { record: GovernedSaveRecord; prior: string }, signal: AbortSignal) {
    const read = this.options.readSavedFile ?? (path => readFile(path))
    const deadline = performance.now() + 3_000
    let after: Uint8Array | null = null
    for (;;) {
      after = await read(resave.record.filePath).catch(() => null)
      signal.throwIfAborted()
      if ((after && sha256(after) !== resave.record.contentSha256) || performance.now() >= deadline) break
      await delay(150, undefined, { signal })
    }
    return confirmGovernedResave(resave.record, resave.prior, after)
  }

  async documentReadback(signal: AbortSignal, options: { waitForSavedFile?: boolean } = {}): Promise<{
    text: string | null; complete: boolean; initialText: string | null; file: string | null
    fileReadStatus: 'unsupported' | 'location_unavailable' | 'unreadable' | 'not_regular_file' | 'too_large' | 'read'
    fileReadAttempts: number
  }> {
    signal.throwIfAborted()
    const document = this.lastFrame ? documentTextOf(this.lastFrame) : null
    let file: string | null = null
    let fileReadStatus: 'unsupported' | 'location_unavailable' | 'unreadable' | 'not_regular_file' | 'too_large' | 'read' = 'unsupported'
    let fileReadAttempts = 0
    if (this.options.backend.documentLocation) {
      const deadline = performance.now() + 2_000
      for (;;) {
        signal.throwIfAborted()
        // Re-resolve the exact window each time. A previous location or read
        // must not stand in for a document whose current identity is missing.
        file = null
        fileReadAttempts++
        fileReadStatus = 'location_unavailable'
        try {
          const path = await this.options.backend.documentLocation(this.options.target)
          signal.throwIfAborted()
          if (path) {
            fileReadStatus = 'unreadable'
            const info = await stat(path)
            signal.throwIfAborted()
            if (!info.isFile()) fileReadStatus = 'not_regular_file'
            else if (info.size > 4_000_000) fileReadStatus = 'too_large'
            else {
              file = await readFile(path, { encoding: 'utf8', signal })
              fileReadStatus = 'read'
            }
          }
        } catch { signal.throwIfAborted(); file = null }
        const stale = file !== null && document?.text && !fileAgreesWithScreen(file, document.text, document.complete)
        // Missing location/readback is retried only for an actual saved-file
        // requirement. Browser drafts must not pay this wait on every report.
        const transient = options.waitForSavedFile && (fileReadStatus === 'location_unavailable' || fileReadStatus === 'unreadable')
        const remaining = deadline - performance.now()
        if ((!stale && !transient) || remaining <= 0) break
        await delay(Math.min(250, remaining), undefined, { signal })
      }
    }
    signal.throwIfAborted()
    return { text: document?.text ?? null, complete: document?.complete ?? false, initialText: this.initialDocumentText, file, fileReadStatus, fileReadAttempts }
  }

  /** Command-L was delivered earlier in this compact program and no other kind of input has followed. */
  private locationChain = false
  /** The text receiver the native bridge last accepted keys for in this compact
   * program, keyed by the program target it was bound to. Later keys into the
   * same target in the same program carry this receiver to the native guard
   * instead of paying another capture (see sameFieldKeysEnabled). */
  private programKeyReceiver: { target: string; receiver: NonNullable<LiveComputerAction['inputReceiver']> } | null = null
  browserSurface(): boolean { return isBrowserBundleIdentifier(this.options.target.bundleIdentifier) }
  /** The selected window's whole document as text (read-only; no input, no clipboard). */
  async pageText(signal: AbortSignal): Promise<LiveComputerPageText | null> {
    signal.throwIfAborted()
    if (!this.options.backend.pageText) return null
    // One read per captured frame: the controller's challenge check and the decision turn both ask for this frame's text.
    if (this.pageTextCache && this.lastFrame && this.pageTextCache.frameId === this.lastFrame.id) return this.pageTextCache.read
    const read = await this.options.backend.pageText(this.options.target, 120_000).catch(() => null)
    this.pageTextCache = this.lastFrame ? { frameId: this.lastFrame.id, read } : null
    // The page's own address carries the scheme the address bar hides (source-observations.ts).
    learnLoadedAddress(read?.url)
    signal.throwIfAborted()
    // The whole page is observed evidence from this document: the read-answer
    // check grounds against it as it does against on-screen text.
    if (read && this.lastFrame) this.rememberSourceLines(sourceDocumentOf(this.lastFrame), read.text.split('\n').map(line => line.trim()).filter(line => line.length >= 2).slice(0, 1500))
    this.pageTextBoundary = read && this.lastFrame ? { frameId: this.lastFrame.id, url: read.url, boundary: humanVerificationInPageText(read.text) } : null
    this.options.onCaptureDiagnostic?.({ stage: 'page_text', available: Boolean(read), method: read?.method ?? null, characters: read?.text.length ?? 0, truncated: read?.truncated ?? null, elapsedMs: read?.elapsedMs ?? null })
    return read
  }

  compactFrames(): LiveComputerCapturedFrame[] { return structuredClone(this.compactHistory) }

  private browserLaunch(): BrowserLaunchScope { return { urls: this.options.browserLaunchUrls ?? [], namedSites: this.options.browserNamedSites ?? [] } }

  /** A human-verification challenge in the latest capture (no new capture is taken), with the site showing it. */
  humanVerificationShown(): { boundary: SiteBoundary; site: string | null } | null {
    const boundary = this.challengeInLastFrame()
    const pageUrl = this.pageTextBoundary?.frameId === this.lastFrame?.id ? this.pageTextBoundary?.url ?? null : null
    return boundary ? { boundary, site: boundarySite(sourceDocumentOf(this.lastFrame!).url) ?? boundarySite(pageUrl) } : null
  }

  /** A sign-in page in the latest capture (no new capture is taken), with the site showing it. Uses the page
   * text only when it was read for this same frame. See `detectSignInPage`. */
  signInShown(): { boundary: SiteBoundary; site: string | null } | null {
    if (!this.lastFrame) return null
    const document = sourceDocumentOf(this.lastFrame)
    const read = this.pageTextCache?.frameId === this.lastFrame.id ? this.pageTextCache.read : null
    const url = document.url ?? read?.url ?? null
    const boundary = detectSignInPage({ url, title: document.title, pageText: read?.text ?? null,
      passwordField: passwordFieldInFrame(this.lastFrame.elements), controlTexts: frameBoundaryTexts(this.lastFrame.elements) })
    return boundary ? { boundary, site: boundarySite(url) } : null
  }

  /** The page text read for the current frame, reduced to a challenge it shows. Cleared by the next capture's id. */
  private pageTextBoundary: { frameId: string; url: string | null; boundary: SiteBoundary | null } | null = null
  private pageTextCache: { frameId: string; read: LiveComputerPageText | null } | null = null

  /** A challenge in the current frame's controls, or in the page text read for that same frame: a retailer's
   * "Press & hold to confirm you're a human" reached the actor through page text only, never the accessibility tree,
   * so no hand-off ran and three Cmd+L presses went to the challenge page.
   * `STEWARD_CHALLENGE_PAGE_TEXT=off` reads controls only. */
  private challengeInLastFrame(): SiteBoundary | null {
    if (!this.lastFrame) return null
    const shown = humanVerificationInFrame(this.lastFrame.elements)
    if (shown || process.env.STEWARD_CHALLENGE_PAGE_TEXT?.trim().toLowerCase() === 'off') return shown
    return this.pageTextBoundary?.frameId === this.lastFrame.id ? this.pageTextBoundary.boundary : null
  }

  lastInputTargetLabel(): string | null { return this.lastInputTarget }

  /**
   * Focus one control through the platform's accessibility focus, never a
   * pointer: the native bridge acts only on an element matching this identity.
   * Returns the control from a fresh capture when it then reports focus.
   */
  private async focusByIdentity(element: LiveComputerElement, signal: AbortSignal, byPath = false): Promise<LiveComputerElement | null> {
    if (element.focusable === false || !element.settableAttributes?.includes('AXFocused')) return null
    // A late answer is not a refusal: the fresh capture below decides.
    // A window-rooted identity is found by its capture path: the point form
    // resolves whatever lies at the centre, which for a combobox holding a
    // chip or a value is a child that cannot take focus (a flight-search page,
    // error: "no longer exposes the requested semantic capability").
    const viaPath = byPath || (compactAxLadderEnabled() && elementIdentityForAxDelivery(element) !== null)
    try { await this.axActByIdentity(element, 'focus', signal, { byPath: viaPath, summary: 'Focus the intended control', uncertain: 'return' }) } catch (error) {
      signal.throwIfAborted()
      this.options.onCaptureDiagnostic?.({ stage: 'focus_by_identity', outcome: 'refused', role: element.role, byPath: viaPath, error: String(error instanceof Error ? error.message : error).slice(0, 160) })
      return null
    }
    signal.throwIfAborted()
    await this.capture(signal)
    const current = resolveInputTarget(elementIdentityForInput(element), this.lastFrame?.elements ?? []).element
    // Keys follow focus, not the pointer: a control under an overlay that the
    // platform reports focused (by-identity delivery) is a proven receiver.
    const proven = current && current.focused === true && !current.sensitive && current.enabled !== false && (!current.obstructed || byPath) ? current : null
    this.options.onCaptureDiagnostic?.({ stage: 'focus_by_identity', outcome: proven ? 'focused' : 'not_focused', role: element.role })
    return proven
  }

  /**
   * One platform accessibility action on exactly this control, never a
   * pointer event. With `byPath` the native bridge finds the control by its
   * capture path and fingerprint chain in the verified window, so a 1-px
   * select or a control under an overlay is reachable; without it the bridge
   * resolves the identity at the control's centre (the older focus rescue).
   * Window identity and focus are still verified natively before the action.
   * With `ledger`, the action is recorded as an input: confirmed, or
   * uncertain when the platform answered late or not at all (a late answer
   * is decided by the next fresh capture, never assumed). Throws with no
   * input sent when the identity is not found or the action is refused.
   */
  private async axActByIdentity(element: LiveComputerElement, elementAction: 'show_menu' | 'activate' | 'focus', signal: AbortSignal,
    options: { byPath: boolean; summary: string; ledger?: boolean; grounding?: UniversalComputerActionGrounding | undefined; uncertain?: 'throw' | 'return'; point?: { x: number; y: number } }): Promise<'delivered' | 'uncertain'> {
    const frame = this.lastFrame
    const label = element.name?.trim() || element.role
    // By path, a control with no frame (an item of a hidden <select>'s list) is still reachable.
    if (!frame || (!element.bounds && !(options.byPath && options.point)) || element.sensitive || element.enabled === false) throw new Error(`"${label}" is not an available control; no input sent.`)
    const identity = options.byPath ? elementIdentityForAxDelivery(element) : elementIdentityForInput(element)
    if (!identity) throw new Error(`"${label}" has no accessibility identity Carve can act on; no input sent.`)
    const center = element.bounds ? { x: element.bounds.x + element.bounds.width / 2, y: element.bounds.y + element.bounds.height / 2 } : options.point!
    const inside = center.x >= 0 && center.y >= 0 && center.x < frame.width && center.y < frame.height
    // The point-resolved form needs a real point; the path-resolved form
    // carries one only for presentation, clamped into the frame.
    if (!options.byPath && !inside) throw new Error(`"${label}" lies outside the selected window; no input sent.`)
    const point = { x: Math.min(Math.max(center.x, 0), frame.width - 1), y: Math.min(Math.max(center.y, 0), frame.height - 1) }
    const liveAction: LiveComputerAction = { ...this.toLiveAction({ kind: 'move', point, modifiers: [] }, options.grounding), kind: 'element_action', elementAction,
      targetElementId: element.id, targetIdentity: identity, targetLabel: element.sensitive ? null : element.name?.trim() || null, summary: options.summary }
    const viewport = this.options.ownedWindowGroup ? frame.inputViewport : null
    if (this.options.ownedWindowGroup && !viewport) throw new Error('Input requires the screenshot coordinate mapping; no input sent.')
    if (viewport) {
      liveAction.point = { x: point.x + viewport.x, y: point.y + viewport.y }
      if (liveAction.targetIdentity?.bounds) liveAction.targetIdentity = { ...liveAction.targetIdentity, bounds: { ...liveAction.targetIdentity.bounds, x: liveAction.targetIdentity.bounds.x + viewport.x, y: liveAction.targetIdentity.bounds.y + viewport.y } }
    }
    const entry: SelectedWindowInputLedgerEntry | null = options.ledger ? { sequence: ++this.inputSequence, kind: 'element_action', elementAction, label: element.name?.trim() || options.grounding?.label?.trim() || null, role: element.role } : null
    let receipt: Awaited<ReturnType<LiveComputerBackend['execute']>> = undefined
    try {
      receipt = await this.options.backend.execute(this.options.target, liveAction, signal)
      if (receipt?.failure?.code === 'identity_not_found' && receipt.deliveryProgress === 'none') {
        throw new ComputerInputDeliveryError(`Carve could not find "${label}" by its accessibility identity: it changed or disappeared since the observation. No input was sent.`, false)
      }
      if (receipt?.failure?.code === 'ax_action_refused' && receipt.deliveryProgress === 'none') {
        throw new ComputerInputDeliveryError(`"${label}" refused the accessibility ${elementAction.replace('_', ' ')} action. No input was sent.`, false)
      }
      requireDeliveredInput(receipt, false)
    } catch (error) {
      const outcome = !receipt || receipt.deliveryProgress !== 'none' ? 'uncertain' : 'refused'
      this.options.onCaptureDiagnostic?.({ stage: 'ax_delivery', elementAction, role: element.role, byPath: options.byPath, outcome, code: receipt?.failure?.code ?? null, ...(receipt?.failure?.detail ? { detail: receipt.failure.detail } : {}) })
      if (entry && outcome === 'uncertain') {
        this.inputLedger.push({ ...entry, delivery: 'uncertain' })
        if (this.inputLedger.length > 200) this.inputLedger.splice(0, this.inputLedger.length - 200)
      }
      if (outcome === 'uncertain' && options.uncertain === 'return' && !signal.aborted) return 'uncertain'
      throw error
    }
    this.options.onCaptureDiagnostic?.({ stage: 'ax_delivery', elementAction, role: element.role, byPath: options.byPath, outcome: 'delivered' })
    if (entry) {
      this.inputLedger.push(entry)
      if (this.inputLedger.length > 200) this.inputLedger.splice(0, this.inputLedger.length - 200)
    }
    return 'delivered'
  }

  bindCompactActions(actions: ComputerActionProposal[], targets: Array<LiveComputerElement | null>, deliveries?: Array<CompactDelivery | null>): void {
    if (actions.length !== targets.length || (deliveries && deliveries.length !== actions.length)) throw new Error('Compact binding count mismatch')
    this.locationChain = false
    const decisionDigest = this.compactHistory.at(-1) ? compactLayoutDigest(this.compactHistory.at(-1)!) : null
    this.programKeyReceiver = null
    this.compactBindings = actions.map((action, i) => ({ action: this.normalizeAction(action), target: targets[i] ? structuredClone(targets[i]!) : null, decisionDigest,
      // Accessibility delivery is only ever bound to a named target. A governed
      // save binds to the window's own Save chord (governed-save.ts).
      ...(deliveries?.[i] && (targets[i] || (deliveries[i]!.via === 'governed_save' || deliveries[i]!.via === 'governed_resave') && governedSaveEnabled()) ? { delivery: { ...deliveries[i]! } } : {}) }))
  }

  async capture(signal: AbortSignal): Promise<ComputerActionScreenshot> {
    const captured = await this.captureFrame(signal)
    this.options.onCapture?.(captured.frame)
    return captured.screenshot
  }

  private async captureFrame(signal: AbortSignal, options: { elements?: boolean } = {}): Promise<{ frame: LiveComputerCapturedFrame; screenshot: ComputerActionScreenshot }> {
    if (signal.aborted) throw new Error('Selected-window capture was cancelled')
    const preferTerms = options.elements === false ? [] : goalPreferenceTerms(this.options.approvedGoal ?? '')
    const attemptCapture = () => this.options.backend.capture(
      this.options.target,
      `${this.options.sessionId}-${++this.captureSequence}-${Date.now()}`,
      { ...options, signal, ...(preferTerms.length ? { preferTerms } : {}), ...(this.options.ownedWindowGroup ? { ownedWindowGroup: true } : {}) },
    )
    const capture = async (): Promise<LiveComputerCapturedFrame> => {
      // Save-sheet transitions can temporarily remove the AX document while its
      // exact native window still exists. Retry observation only: no input,
      // application-wide fallback, stale pixels, or replacement-window binding.
      for (let attempt = 0; ; attempt++) {
        try { return await attemptCapture() } catch (error) {
          signal.throwIfAborted()
          if (!this.options.ownedWindowGroup || !(error instanceof Error)
            || error.message !== 'Selected accessibility window unavailable' || attempt >= 2) throw error
          await delay(attempt === 0 ? 200 : 400, undefined, { signal })
        }
      }
    }
    let frame: LiveComputerCapturedFrame
    let runtimeNotice: string | undefined
    try { frame = await capture() } catch (error) {
      signal.throwIfAborted()
      if (!await this.restoreMinimizedWindow(signal)) throw error
      // One fresh capture after verified restoration; never reuse old pixels.
      frame = await capture()
      runtimeNotice = 'Carve restored the exact selected window after an earlier action minimized it. This is a fresh screenshot. Do not repeat that minimizing action; choose a different control and preserve already completed edits.'
    }
    this.windowRecoveryExpiresAt = 0
    if (signal.aborted) throw new Error('Selected-window capture was cancelled')
    // A pixel-only probe never replaces the last full digest: preflight binds
    // against controls, and a probe carries none.
    if (options.elements !== false) {
      this.lastFrame = frame
      this.rememberFieldValues(frame)
      if (this.initialDocumentText === null && !this.initialDocumentRead && !this.contentInputAttempted) {
        const document = documentTextOf(frame)
        if (document && document.complete) this.initialDocumentText = document.text
        else if (document && this.options.backend.documentLocation) {
          // The accessibility value is a 500-character prefix; the file the
          // window names, read once before any input, is the whole baseline.
          this.initialDocumentRead = true
          try {
            const path = await this.options.backend.documentLocation(this.options.target)
            if (path) { const info = await stat(path); if (info.isFile() && info.size <= 4_000_000) this.initialDocumentText = await readFile(path, 'utf8') }
          } catch { /* No baseline: preservation stays unestablished and the reviewer judges it. */ }
        }
      }
      await this.options.prepareFieldRequirements?.([...this.observedFieldLabels], signal)
      signal.throwIfAborted()
      // Deduplicate within the document this frame shows, never across pages.
      // A focused address bar hides the address; the same titled page keeps
      // the address it last showed, so one page stays one source.
      const shown = sourceDocumentOf(frame)
      const earlier = shown.url || !shown.title ? null : [...this.observationHistory].reverse().find(entry => entry.source?.title === shown.title && entry.source.url)?.source
      const source: SourceDocument = shown.url || !shown.title ? shown : { title: shown.title, url: earlier?.url ?? null, ...(earlier?.schemeShown === false ? { schemeShown: false as const } : {}) }
      const seenHere = this.observedTextsBySource.get(sourceDocumentKey(source))
      const items = frame.elements.filter(e => sourceElementVisible(e, frame)).flatMap(e => {
        const content: Array<string | null> = sourceElementText(e)
        const state = Object.fromEntries(['checked', 'selected', 'expanded'].flatMap(key => {
          const value = e[key as 'checked' | 'selected' | 'expanded']
          return typeof value === 'boolean' ? [[key, value]] : []
        }))
        if (e.name && Object.keys(state).length) content.push(JSON.stringify({ control: e.name, role: e.role, ...state }))
        return content
      // A one-character value is often the fact itself ("Number of reviews"
      // then "0", a rating, a quantity); only lone punctuation is noise.
      }).filter((value): value is string => typeof value === 'string' && (value.trim().length > 1 || /^[\p{L}\p{N}]$/u.test(value.trim())))
      const text = dedupeInContext(items, new Set(seenHere ?? [])).join('\n').slice(0, 12000)
      if (text && this.observationHistory.at(-1)?.text !== text) {
        this.rememberSourceLines(source, items)
        this.observationHistory.push({ frameId: frame.id, text, source })
        while (this.observationHistory.length > 128 || this.observationHistory.reduce((n, e) => n + e.text.length, 0) > 64000) this.observationHistory.shift()
      }
      if (this.options.compact) {
        this.compactHistory.push(frame)
        if (this.compactHistory.length > 24) this.compactHistory.shift()
      }
    }
    return {
      frame,
      screenshot: {
        ...(runtimeNotice ? { runtimeNotice } : {}),
        dataUrl: frame.dataUrl,
        evidenceId: frame.id,
        width: frame.width,
        height: frame.height,
        sha256: frame.sha256,
        visualSample: frame.visualSample,
        elementDigest: options.elements === false ? null : elementDigest(frame.elements),
        focusedBounds: options.elements === false ? null : frame.elements.find((element) => element.focused === true && element.bounds)?.bounds ?? null,
      },
    }
  }

  private rememberFieldValues(frame: LiveComputerCapturedFrame): void {
    for (const element of frame.elements) {
      if (element.sensitive || !element.name || !(element.editable || /text(field|area)|combobox/iu.test(element.role))) continue
      // The browser's own address bar and Find bar are navigation tools, not
      // document fields: a query typed there is never a requested task value.
      // Remembering them made every research task compile field requirements
      // on the strategy model before its final answer (a public information page:
      // one "requested value" from the Find bar, 3 s and a contradicted proof).
      if (isBrowserLocationField(element) || isBrowserFindField(element)) continue
      this.observedFieldLabels.add(element.name.slice(0, 300))
      const sameName = frame.elements.filter(other => !other.sensitive && other.name === element.name && (other.editable || /text(field|area)|combobox/iu.test(other.role)))
      this.observedFieldValues.delete(element.name)
      if (sameName.length === 1 && element.valueComplete === true && typeof element.value === 'string' && element.bounds && !element.obstructed) {
        this.observedFieldValues.set(element.name, { field: element.name, value: element.value, frameId: frame.id })
      }
    }
    while (this.observedFieldValues.size > 200) this.observedFieldValues.delete(this.observedFieldValues.keys().next().value!)
    while (this.observedFieldLabels.size > 200) this.observedFieldLabels.delete(this.observedFieldLabels.values().next().value!)
  }

  /** Window-relative bounds of a digest element from the current frame, for
   * the desktop frame's aim brackets. Geometry only; preflight never binds a
   * sensitive element, so none can reach here. */
  /** Repair a click that lands just outside exactly one labelled control.
   * Returns null whenever the proposal must stand as the actor made it. */
  snapClick(point: { x: number; y: number }): SnappedClick | null {
    const tolerance = this.options.clickSnap ?? overheadLevers().clickSnap
    const frame = this.lastFrame
    if (!frame) return null
    return snapClickPoint(point, frame.elements, { tolerance, frame: { width: frame.width, height: frame.height } })
  }

  elementBounds(elementId: string): { x: number; y: number; width: number; height: number } | null {
    const element = this.lastFrame?.elements.find((candidate) => candidate.id === elementId)
    return element?.bounds ? { ...element.bounds } : null
  }

  identityBoundInput(): boolean { return this.options.compact === true }

  /** A single already-reviewed field replacement. The native bridge checks
   * exact window/focus and receiver identity before selection and every text
   * chunk. Grouping never includes another field, navigation, or a commit. */
  canExecuteTextReplacement(actions: ComputerActionProposal[], groundings: UniversalComputerActionGrounding[]): boolean {
    const mode = nativeTransactionMode()
    const withClick = actions.length === 3 && mode === '2'
    if (!['1', '2'].includes(mode ?? '') || !this.options.backend.executeTransaction || this.options.readNavigationOnly
      || (!withClick && actions.length !== 2) || !this.compactBindings || this.compactBindings.some(binding => binding.delivery)) return false
    const normalized = actions.map(action => this.normalizeAction(action))
    const [select, type] = normalized.slice(withClick ? 1 : 0)
    if (select?.kind !== 'keypress' || select.keys.join('+') !== 'CMD+A' || type?.kind !== 'type'
      || withClick && (normalized[0]?.kind !== 'click' || normalized[0].button !== 'left' || normalized[0].modifiers.length !== 0)) return false
    const first = this.compactBindings[0]?.target
    if (!first || !liveComputerElementSupportsTextEntry(first) || first.sensitive || isBrowserLocationField(first)
      || !groundings[0]?.elementId) return false
    return normalized.every((action, i) => {
      const binding = this.compactBindings![i]
      return binding?.target && stableJson(binding.action) === stableJson(action)
        && groundings[i]?.elementId === groundings[0]!.elementId
        && stableJson(elementIdentityForInput(binding.target)) === stableJson(elementIdentityForInput(first))
    })
  }

  async executeTextReplacement(actions: ComputerActionProposal[], signal: AbortSignal, groundings: UniversalComputerActionGrounding[]): Promise<void> {
    if (!this.canExecuteTextReplacement(actions, groundings)) throw new Error('Replacement is not a bound compact field transaction')
    await this.executeBoundAction(actions[0]!, signal, groundings[0], actions.at(-1) as Extract<ComputerActionProposal, { kind: 'type' }>,
      actions.length === 3 ? actions[1] as Extract<ComputerActionProposal, { kind: 'keypress' }> : undefined)
  }

  async execute(action: ComputerActionProposal, signal: AbortSignal, grounding?: UniversalComputerActionGrounding): Promise<void> {
    this.lastInputTarget = null
    await this.executeBoundAction(action, signal, grounding)
  }

  private async executeBoundAction(action: ComputerActionProposal, signal: AbortSignal, grounding?: UniversalComputerActionGrounding,
    replacement?: Extract<ComputerActionProposal, { kind: 'type' }>, selection?: Extract<ComputerActionProposal, { kind: 'keypress' }>): Promise<void> {
    if (this.options.readNavigationOnly && !['scroll', 'wait', 'screenshot'].includes(action.kind)) {
      throw new Error('This source stage permits viewing and scrolling only. No input was sent. Return a partial source receipt if more access is needed.')
    }

    action = this.normalizeAction(action)
    if (signal.aborted) throw new Error('Selected-window input was cancelled')
    // Where an action's wall clock goes: a compact fill's three
    // inputs took 2 to 4 s each with no single visible cause. Each phase is
    // timed so the audit can say which one, per action, without guessing.
    const startedAt = Date.now()
    let phaseStartedAt = startedAt
    const timings: Record<string, number> = {}
    const loop = startEventLoopProbe()
    const mark = (phase: string) => { const now = Date.now(); timings[phase] = (timings[phase] ?? 0) + now - phaseStartedAt; phaseStartedAt = now }
    let intendedReceiver = grounding?.elementId ? this.lastFrame?.elements.find(element => element.id === grounding.elementId) : undefined
    let compactInputFrame: LiveComputerCapturedFrame | null = null
    /** The bound input goes through accessibility by identity (compact AX ladder). */
    let axDelivery: CompactDelivery | null = null
    let axTarget: LiveComputerElement | null = null
    /** The bound Cmd+S is the native governed TextEdit save to this path (governed-save.ts). */
    let governedSavePath: string | null = null
    /** The bound Cmd+S saves, in place, the file a receipt of this conversation names (governed-save.ts). */
    let governedResavePath: string | null = null
    let selectionBinding: NonNullable<typeof this.compactBindings>[number] | null = null
    let replacementBinding: NonNullable<typeof this.compactBindings>[number] | null = null
    /** The program target's identity, and a receiver reused for keys into it. */
    let programTarget: string | null = null
    let sameFieldReceiver: NonNullable<LiveComputerAction['inputReceiver']> | null = null
    let bindingTarget: LiveComputerElement | null = null
    const effect = windowLifecycleEffect(action, this.options.platform ?? process.platform, this.lastFrame?.elements)
    if (effect) {
      const authorized = await this.options.authorizeWindowEffect?.(effect, action, signal) ?? false
      signal.throwIfAborted()
      if (!authorized) throw new WindowLifecycleFeedback(`No input was sent: this action would ${effect} the selected window/application, which is not explicitly requested by the task. Choose a visible in-app control or verify the app-specific shortcut. On macOS, Control and Command are different keys; do not substitute one for the other.`, false)
    }
    mark('authorize')
    if (this.compactBindings) {
      const binding = this.compactBindings.shift()
      if (!binding || JSON.stringify(binding.action) !== JSON.stringify(action)) throw new Error('Compact program binding changed before dispatch')
      if (selection) {
        const next = this.compactBindings.shift()
        if (!next || stableJson(next.action) !== stableJson(this.normalizeAction(selection))) throw new Error('Compact selection binding changed')
        selectionBinding = next
      }
      if (replacement) {
        const next = this.compactBindings.shift()
        if (!next || stableJson(next.action) !== stableJson(replacement)) throw new Error('Compact replacement binding changed')
        replacementBinding = next
      }
      const expected = binding.target ?? (grounding?.elementId ? this.lastFrame?.elements.find(e => e.id === grounding.elementId) : null)
      axDelivery = binding.delivery?.via === 'ax' && binding.target ? binding.delivery : null
      governedSavePath = binding.delivery?.via === 'governed_save' && governedSaveEnabled() && isSaveChordProposal(action) ? binding.delivery.filePath ?? null : null
      governedResavePath = binding.delivery?.via === 'governed_resave' && governedSaveEnabled() && editSavedDocumentEnabled() && isSaveChordProposal(action) ? binding.delivery.filePath ?? null : null
      this.lastInputTarget = expected ? (expected.name ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120) || null : null
      programTarget = binding.target ? stableJson(elementIdentityForInput(binding.target)) : null
      bindingTarget = binding.target
      // Keys into the field this program already typed into, whose receiver
      // the native bridge accepted moments ago: the page capture before each
      // one bought nothing (a fill's typing after its select-all, the Enter
      // after a search fill; 0.45 to 1.4 s apiece). The native
      // guard still proves window focus and this exact receiver before any
      // key is posted, and refuses (nothing sent) if focus moved.
      const reused = sameFieldKeysEnabled() && !readFastOff() && !axDelivery && !selection && !replacement && (action.kind === 'type' || action.kind === 'keypress')
        && programTarget !== null && this.programKeyReceiver?.target === programTarget ? this.programKeyReceiver.receiver : null
      if (reused) {
        this.freshCompactCapture = null
        sameFieldReceiver = structuredClone(reused)
        intendedReceiver = undefined
        this.options.onCaptureDiagnostic?.({ stage: 'precapture_skipped_same_field', kind: action.kind })
      }
      if (action.kind !== 'wait' && action.kind !== 'screenshot' && !sameFieldReceiver) {
        const fresh = this.freshCompactCapture !== null && this.lastFrame?.id === this.freshCompactCapture.frameId
          && Date.now() - this.freshCompactCapture.at <= 1_500
        this.freshCompactCapture = null
        // Keystrokes after Command-L in the same program go to the browser's
        // address field, which the page layout cannot move or cover: a page
        // capture before each of them bought nothing and cost 1 to 9 s apiece
        // (one run: 41 s from decision to Enter).
        const locationKeystroke = this.locationChain && (action.kind === 'type' || action.kind === 'keypress') && !readFastOff()
        if (locationKeystroke) this.options.onCaptureDiagnostic?.({ stage: 'precapture_skipped_location_field', kind: action.kind })
        else if (!fresh) await this.capture(signal)
        else this.options.onCaptureDiagnostic?.({ stage: 'precapture_reused_fingerprint', kind: action.kind })
        // A page can still be moving when the program was decided: a
        // fundraising banner injected after load pushed a Wikipedia table of
        // contents down between capture and click, and the click hit the
        // wrong place twice. If the digest differs from the decision frame,
        // wait until two consecutive captures agree before resolving the
        // target against the settled layout.
        // The wait protects where a pointer lands. Keys carry no coordinates
        // (their receiver is proven focused below and again natively), and a
        // target still at its decision position has not moved. A page that
        // never holds still elsewhere (a chat application streaming a reply)
        // otherwise spent the full 2.5 s before every click and keystroke:
        // 112 s of a 383 s run.
        const layoutMoved = !locationKeystroke && binding.decisionDigest && this.lastFrame && compactLayoutDigest(this.lastFrame) !== binding.decisionDigest
        let steady = layoutMoved && !readFastOff() ? steadyInputReason(action, expected ?? null, this.lastFrame!.elements) : null
        // A banner inserted above a target moves it a moment later: an unmoved
        // pointer target must still be in place on one more capture.
        if (steady === 'target_unmoved') {
          await delay(250, undefined, { signal })
          await this.capture(signal)
          steady = steadyInputReason(action, expected ?? null, this.lastFrame!.elements)
        }
        if (steady) this.options.onCaptureDiagnostic?.({ stage: 'stability_wait_skipped', kind: action.kind, reason: steady })
        else if (layoutMoved) await this.awaitStableLayout(signal)
        compactInputFrame = this.lastFrame
        // The remaining inputs still get fresh captures. Compare their layout
        // with the last observed geometry, not an obsolete pre-edit frame.
        if (compactInputFrame) for (const remaining of this.compactBindings) remaining.decisionDigest = compactLayoutDigest(compactInputFrame)
        if (expected) {
          const resolved = resolveInputTarget(elementIdentityForInput(expected), this.lastFrame?.elements ?? []).element
          // A field some sites replace when it takes focus (a video site's search
          // box: the click focused a new input, the fill's
          // select-all found the old one gone, and the same fill ran four
          // times). Keys after a click in this program go to the focused text
          // field lying where the clicked one was, and only to that one.
          const current = resolved ?? (!readFastOff() && (action.kind === 'type' || action.kind === 'keypress') ? focusedReplacementField(expected, this.lastFrame?.elements ?? [], this.inputLedger.at(-1)) : undefined)
          if (current && !resolved) {
            this.options.onCaptureDiagnostic?.({ stage: 'focused_replacement_bound', kind: action.kind, role: current.role })
            // The rest of this program's keys (select-all, then the typing) go to the same replacement.
            const replacedIdentity = stableJson(elementIdentityForInput(expected))
            for (const remaining of this.compactBindings) if (remaining.target && stableJson(elementIdentityForInput(remaining.target)) === replacedIdentity) remaining.target = structuredClone(current)
          }
          // An accessibility delivery never goes through the covering surface,
          // so a control under an overlay stays reachable; identity still must hold.
          // A key needs no geometry when its receiver is not a text field: the
          // items of a hidden <select>'s open list have no frame (widget probe),
          // and the Escape that closes it binds to one of them.
          // Nor does an accessibility action, which is delivered by identity.
          const geometryFree = action.kind === 'keypress' && Boolean(current) && !isEditable(current!) || Boolean(axDelivery?.elementAction && 'point' in action)
          if (!current || (!current.bounds && !geometryFree) || current.sensitive || current.enabled === false || (current.obstructed && !axDelivery)) throw new Error('Compact target changed, became obstructed or ambiguous; remaining program stopped')
          intendedReceiver = current
          if ((action.kind === 'type' || action.kind === 'keypress' && action.keys.includes('A')) && current.focused !== true) {
            // A flight-search page: the click opened the origin box's
            // pop-up but the box never reported focus, and the same fill was
            // refused three times. Ask the platform to focus this exact
            // control (identity-checked natively), then prove focus again from
            // a fresh capture. The typing itself keeps every existing guard.
            const focused = await this.focusByIdentity(current, signal, Boolean(axDelivery))
            if (!focused) throw new Error('Compact text receiver is not proven focused; no text sent. Carve also asked the platform to focus it directly, and it still did not report focus.')
            intendedReceiver = focused
            compactInputFrame = this.lastFrame
          }
          if (axDelivery?.elementAction && 'point' in action) {
            // Hidden (1-px) and covered controls: no pointer event, so no
            // geometry or hit test decides; the native bridge acts on the
            // control found by its identity (see axActByIdentity).
            axTarget = current
          } else if ('point' in action && current.bounds) {
            // Aim at the visible part of the control. A breadcrumb scrolled
            // mostly above the page reports its full bounds, whose center sits
            // on the clip line where the hit test (rightly) sees the content
            // below: the same click was refused three times in one run.
            const content = this.lastFrame?.contentBounds
            const aim = content ? {
              x: Math.max(current.bounds.x, content.x), y: Math.max(current.bounds.y, content.y),
              right: Math.min(current.bounds.x + current.bounds.width, content.x + content.width), bottom: Math.min(current.bounds.y + current.bounds.height, content.y + content.height),
            } : { x: current.bounds.x, y: current.bounds.y, right: current.bounds.x + current.bounds.width, bottom: current.bounds.y + current.bounds.height }
            if (current.bounds.width < 4 || current.bounds.height < 4) throw new Error(`Compact target "${current.name || current.role}" is a hidden or zero-size control (${Math.round(current.bounds.width)}×${Math.round(current.bounds.height)} px) and cannot be clicked; no input sent. Scrolling will not help: reach it another way, such as the keyboard or the visible area it belongs to.`)
            if (aim.right - aim.x < 4 || aim.bottom - aim.y < 4) throw new Error('Compact target is scrolled out of view; no input sent. Scroll it into view first.')
            action = { ...action, point: { x: (aim.x + aim.right) / 2, y: (aim.y + aim.bottom) / 2 } }
            if (this.options.backend.hitTest) {
              let why = ''
              let unstable = false
              let frontBounds: { x: number; y: number; width: number; height: number } | null = null
              const encloses = (outer: { x: number; y: number; width: number; height: number } | null, inner: { x: number; y: number; width: number; height: number }) =>
                Boolean(outer && outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height)
              const probe = async (point: { x: number; y: number }) => {
                const hit = await this.options.backend.hitTest!(this.options.target, point, elementIdentityForInput(current))
                let blocked = Boolean(hit?.available && (!hit.stable || !['target', 'descendant'].includes(hit.relation)))
                // An element whose own bounds do not contain the point cannot
                // be in front of it. Some applications answer a position query
                // with an unrelated element (Numbers: the table's 21 px resize
                // handle for a cell 100 px away), and that is a
                // hit test with nothing to say, not an obstruction. A real
                // obstruction (a sheet, a popup, a dialog) contains the point.
                const contains = (bounds: { x: number; y: number; width: number; height: number } | null | undefined) =>
                  Boolean(bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height)
                if (blocked && hit?.stable && !hit.obstruction && hit.hit?.bounds && !contains(hit.hit.bounds)) {
                  this.options.onCaptureDiagnostic?.({ stage: 'hit_test_unrelated', role: hit.hit.role, relation: hit.relation })
                  blocked = false
                }
                // An editor the application opened over the target and gave
                // focus (Numbers' in-cell editor after Enter, Finder's rename
                // field) is the place the click was meant to land, not a thing
                // in the way: a click into a focused text receiver is safe.
                const focusedEditor = blocked && hit?.stable && !hit.obstruction && hit.hit?.bounds && contains(hit.hit.bounds)
                  ? this.lastFrame?.elements.find(e => e.role === hit.hit!.role && e.bounds && contains(e.bounds) && e.focused === true && !e.sensitive && e.enabled !== false && liveComputerElementSupportsTextEntry(e))
                  : undefined
                if (focusedEditor) {
                  this.options.onCaptureDiagnostic?.({ stage: 'hit_test_focused_editor', role: focusedEditor.role, relation: hit!.relation })
                  blocked = false
                }
                // Chrome answers a hit test on a date or time segment with the
                // enclosing field: the composite control reporting for its own
                // part, not something in front of it (widget probe).
                // The same holds for any interactive control answering for its
                // own label or part (a footwear retailer's "Sort By" pop-up button over its
                // "Relevance" text: refused twice, the sort never
                // ran). The click lands on that owner, as a person's would, only
                // when the owner cannot do more than the target: a selector or
                // toggle role, or a button or link whose own label carries the
                // target's. STEWARD_HIT_TEST_OWNER_CONTROL=off keeps date/time only.
                const ownerRoles = /^(?:AX)?(?:PopUpButton|ComboBox|Tab|CheckBox|RadioButton|DisclosureTriangle|MenuButton|DateField|TimeField)$/u
                const targetLabel = (current.sensitive ? '' : current.name ?? '').replace(/\s+/gu, ' ').trim().toLowerCase()
                const ownerControl = process.env.STEWARD_HIT_TEST_OWNER_CONTROL?.trim().toLowerCase() !== 'off' && hit?.hit != null
                  && (ownerRoles.test(hit.hit.role) || (/^(?:AX)?(?:Button|Link)$/u.test(hit.hit.role) && targetLabel.length >= 2 && hit.hit.name.replace(/\s+/gu, ' ').trim().toLowerCase().includes(targetLabel)))
                const compositeOwner = blocked && hit?.stable === true && !hit.obstruction && hit.hit != null && current.bounds != null && encloses(hit.hit.bounds, current.bounds)
                  && ((/^(?:AX)?(?:DateField|TimeField)$/u.test(hit.hit.role) && /incrementor/iu.test(current.role)) || ownerControl)
                  && !this.coveringDialog(point, current)
                if (compositeOwner) {
                  this.options.onCaptureDiagnostic?.({ stage: 'hit_test_composite_owner', role: hit!.hit!.role, relation: hit!.relation })
                  blocked = false
                }
                // A code editor paints its text on an unnamed layer beside a
                // hidden input receiver (JSONLint's Monaco:
                // view-lines next to the "Editor content" edit context, refused
                // 3/3). The platform shows both under one small, non-dialog
                // widget parent; a click on that layer is how the editor takes
                // focus. Typing still needs proven focus before any key is sent.
                const editorSurface = blocked && action.kind === 'click' && hit?.stable === true && hit.obstruction === null && hit.hit != null && hit.shared != null
                  && editorOwnSurface(current, hit.hit, hit.shared, this.lastFrame?.contentBounds ?? null)
                  && !this.coveringDialog(point, current) && !this.backdropDismissals(hit.hit.bounds)
                if (editorSurface) {
                  this.options.onCaptureDiagnostic?.({ stage: 'hit_test_editor_surface', role: hit!.hit!.role, relation: hit!.relation })
                  blocked = false
                }
                // Roles only, plus a short name of what is in front: enough to
                // tell a popup from a moving layout without retaining the page.
                if (blocked && hit) { frontBounds = hit.hit?.bounds ?? null; unstable = !hit.stable }
                if (blocked && hit) why = ` (relation ${hit.relation}${hit.stable ? '' : ', unstable'}; in front: ${hit.hit ? `${hit.hit.role} "${hit.hit.name.slice(0, 40)}" at ${hit.hit.bounds ? `${Math.round(hit.hit.bounds.x)},${Math.round(hit.hit.bounds.y)} ${Math.round(hit.hit.bounds.width)}x${Math.round(hit.hit.bounds.height)}` : 'no bounds'}` : 'nothing'}${hit.obstruction ? `; obstruction ${hit.obstruction.role} "${hit.obstruction.name.slice(0, 40)}"` : ''})`
                // The page's own container answering for a control it encloses
                // is the browser's accessibility hit test lagging a just-typed
                // edit (the form's <main> group), not something in
                // front of the control: the same click succeeded a second later.
                const lagging = blocked && hit?.hit != null && hit.obstruction === null && hit.stable && encloses(hit.hit.bounds, current.bounds!)
                // A listing card's photo is an unnamed group laid over the
                // centre of the card's own link (a lodging site): the
                // same interior retry applies, still cleared point by point.
                const staticOverlap = blocked && hit?.stable === true && hit.obstruction === null
                  && (/^(?:AX)?(?:Heading|StaticText)$/u.test(hit.hit?.role ?? '')
                    || (/^(?:AX)?(?:Group|Image)$/u.test(hit.hit?.role ?? '') && !hit.hit?.name.trim()))
                // The page's own root answering for a control it encloses: nothing specific is at the point.
                const pageRoot = blocked && hit?.stable === true && hit.obstruction === null && hit.hit != null
                  && /^(?:AX)?WebArea$/u.test(hit.hit.role) && encloses(hit.hit.bounds, current.bounds!)
                return { blocked, lagging, staticOverlap, pageRoot }
              }
              // Chromium keeps answering a position query with the page root for a control whose role admits no
              // children (an ARIA tab, a custom checkbox or switch): its first answer comes from cached bounds and
              // names the control, the renderer's later answer is the root, and that root is then cached for every
              // point on the page. On a three-tab settings page the first tab click landed and each later one was
              // refused as lying under a pop-up backdrop that did not exist. The root says only that nothing in
              // particular is at the point; an element in front, a pop-up's own backdrop included, answers as itself.
              // The click goes ahead when the answer is the page itself (not a smaller embedded document laid over
              // the control), the frame shows no dialog over the point, and the page holds no control that dismisses
              // a pop-up; any of those keeps the refusal. Waiting does not change this answer, so it is settled
              // before the lag retries. STEWARD_HIT_TEST_PAGE_ROOT=off.
              const pageRootClears = (point: { x: number; y: number }) => {
                if (process.env.STEWARD_HIT_TEST_PAGE_ROOT?.trim().toLowerCase() === 'off' || this.coveringDialog(point, current)) return false
                const dismissals = this.backdropDismissals(frontBounds, frontBounds)
                if (dismissals === null || dismissals.length > 0) return false
                this.options.onCaptureDiagnostic?.({ stage: 'hit_test_page_root', role: current.role })
                return true
              }
              let { blocked, lagging, staticOverlap, pageRoot } = await probe(action.point)
              if (blocked && pageRoot && pageRootClears(action.point)) blocked = false
              for (let attempt = 0; blocked && lagging && attempt < 4; attempt++) {
                await delay(300, undefined, { signal })
                ;({ blocked, lagging, staticOverlap, pageRoot } = await probe(action.point))
                if (blocked && pageRoot && pageRootClears(action.point)) blocked = false
              }
              // Browser AX sometimes gives a wide heading or text node a
              // rectangle that crosses only the center of a real button. Do
              // not waive the hit test: try a few well-inset points inside the
              // same freshly rebound control and use one only when the native
              // probe positively clears it. A genuine overlay continues to
              // block every point and therefore still stops before input.
              if (blocked && staticOverlap && current.bounds) {
                const b = current.bounds
                const interior = [[0.5, 0.2], [0.5, 0.8], [0.2, 0.5], [0.8, 0.5], [0.3, 0.92], [0.5, 0.95]] as const
                for (const [xFraction, yFraction] of interior) {
                  const candidate = { x: b.x + b.width * xFraction, y: b.y + b.height * yFraction }
                  const alternative = await probe(candidate)
                  if (!alternative.blocked) {
                    action = { ...action, point: candidate }
                    blocked = false
                    break
                  }
                }
              }
              if (blocked) {
                const cover = this.coveringDialog(action.point, current)
                const backdrop = cover ? null : this.backdropDismissals(frontBounds, pageRoot ? frontBounds : null)
                this.pointerRefusalLog.push({ id: ++this.pointerRefusalSequence, role: current.role, label: current.sensitive ? null : current.name?.trim() || null, fingerprint: current.fingerprint ?? null,
                  reason: cover ? 'dialog' : backdrop ? 'backdrop' : unstable ? 'unstable' : 'covered' })
                if (this.pointerRefusalLog.length > 20) this.pointerRefusalLog.splice(0, this.pointerRefusalLog.length - 20)
                const clear = cover ? `. It is covered by the "${cover.label.slice(0, 60)}" dialog${cover.controls.length ? ` (its controls: ${cover.controls.map(control => `"${control}"`).join(', ')})` : ''}. Clear that dialog first with one of its own controls, preferring close, dismiss or reject; never accept on the person's behalf. Then try this control again.`
                  : backdrop ? `. A pop-up's backdrop covers the page${backdrop.length ? `; its dismiss controls: ${backdrop.map(label => `"${label}"`).join(', ')}` : ''}. Dismiss the pop-up first (close, no thanks, keep shopping); never sign up, subscribe or accept on the person's behalf. Then try this control again.` : ''
                // A control at the top or bottom edge of the page area under a fixed bar or banner (a retailer's brand
                // checkbox under the promo strip: the same click was withheld three times and the
                // run fell back to another engine). Scrolling brings it into the open page. STEWARD_EDGE_SCROLL_HINT=off.
                const edge = !clear && content && process.env.STEWARD_EDGE_SCROLL_HINT?.trim() !== 'off'
                  && (action.point.y > content.y + content.height * 0.85 || action.point.y < content.y + content.height * 0.12)
                const hint = edge ? `. The control sits at the ${action.point.y < content!.y + content!.height / 2 ? 'top' : 'bottom'} edge of the page under a fixed bar or banner: scroll the page ${action.point.y < content!.y + content!.height / 2 ? 'up' : 'down'} about 300 px so it sits mid-window, then try it again. Repeating this click unchanged will be withheld again.` : ''
                throw new Error(`Compact target is obstructed or unstable; no input sent${why}${clear}${hint}`)
              }
            }
          }
        }
      }
    }
    mark('precapture')
    if (action.kind === 'wait') {
      await delay(1_000, undefined, { signal })
      return
    }
    if (action.kind === 'screenshot') return
    if (!this.lastFrame) throw new Error('Universal input requires a current selected-window frame')
    // A human-verification challenge is answered by the person, never by
    // Carve: no click, key, scroll or press-and-hold reaches that window while
    // one shows (a retailer's challenge page). The model's restraint is not the guard.
    const challenge = this.challengeInLastFrame()
    if (challenge) {
      this.options.onCaptureDiagnostic?.({ stage: 'human_verification_input_refused', kind: action.kind, evidence: challenge.evidence })
      throw new HumanVerificationBoundary(challenge, boundarySite(sourceDocumentOf(this.lastFrame).url))
    }

    if (axTarget && axDelivery?.elementAction) {
      this.contentInputAttempted ||= axDelivery.elementAction === 'activate'
      await this.axActByIdentity(axTarget, axDelivery.elementAction, signal, { byPath: true, ledger: true, grounding, ...('point' in action ? { point: action.point } : {}),
        summary: axDelivery.elementAction === 'focus' ? 'Focus the intended control' : axDelivery.elementAction === 'show_menu' ? 'Open the dropdown list' : 'Choose the verified option' })
      mark('deliver')
      if (this.compactBindings && this.compactBindings.length === 0) this.locationChain = false
      if (this.compactBindings && this.compactBindings.length === 0 && process.env.STEWARD_COMPACT_SETTLE_PROBES !== '1') await this.capture(signal)
      mark('postcapture')
      const busy = loop()
      timings.eventLoopUtilizationPermille = Math.round(busy.eventLoopUtilization * 1000); timings.maxEventLoopLagMs = busy.maxEventLoopLagMs
      this.options.onActionTiming?.({ kind: 'element_action', compact: true, totalMs: Date.now() - startedAt, timings })
      return
    }
    const liveAction = this.toLiveAction(action, grounding)
    // Rewriting a whole document (select-all, then the full new text) dropped its final line break: invisible on
    // screen, so the review passed it, and the note was saved and reported as saved without it (e2e A-N1). When the
    // document Carve first read ended with a line break and the replacement does not, the replacement keeps it.
    const receiverKey = intendedReceiver ? intendedReceiver.identifier ?? intendedReceiver.id : null
    const multiline = Boolean(intendedReceiver && /textarea/iu.test(intendedReceiver.role))
    if (action.kind === 'keypress') {
      this.selectAllOn = multiline && action.keys.length === 2 && action.keys.some(key => /^(?:CMD|META|COMMAND)$/iu.test(key)) && action.keys.some(key => key.toUpperCase() === 'A') ? receiverKey : null
    } else if (action.kind === 'type') {
      if (liveAction.kind === 'type' && this.selectAllOn !== null && this.selectAllOn === receiverKey
        && typeof this.initialDocumentText === 'string' && this.initialDocumentText.endsWith('\n') && action.text.length > 0 && !action.text.endsWith('\n')) {
        liveAction.text = `${action.text}\n`
        this.options.onCaptureDiagnostic?.({ stage: 'final_newline_kept', characters: [...action.text].length })
      }
      this.selectAllOn = null
    } else this.selectAllOn = null
    // Text for a code editor is pasted literally: typed, its brackets and
    // quotes are auto-closed and its lines re-indented (see code-editor.ts).
    const codeEditor = codeEditorInputEnabled() && [intendedReceiver, bindingTarget].some(element => element && isCodeEditorReceiver(element))
    if (codeEditor && liveAction.kind === 'type') liveAction.textDelivery = 'clipboard_text'
    if (sameFieldReceiver) liveAction.inputReceiver = sameFieldReceiver
    else if ((action.kind === 'type' || action.kind === 'keypress') && intendedReceiver && isEditable(intendedReceiver)) {
      // A click in the admitted batch predicts focus; it does not prove it.
      // Preserve the batch's frame/IDs while checking the actual receiver,
      // then carry its identity to the native guard for every delivered chunk.
      // Compact just captured and resolved this input's receiver. No input ran
      // since that capture; reuse it instead of walking the same AX tree twice.
      // The native bridge still checks this identity for every delivered chunk.
      const receiverFrame = compactInputFrame ?? await this.options.backend.capture(this.options.target,
        `${this.options.sessionId}-receiver-${++this.captureSequence}-${Date.now()}`, { signal, ...(this.options.ownedWindowGroup ? { ownedWindowGroup: true } : {}) })
      signal.throwIfAborted()
      const current = resolveInputTarget(elementIdentityForInput(intendedReceiver), receiverFrame.elements).element
      // Keys follow focus: a field under an overlay that was focused by
      // identity (accessibility delivery) is a proven receiver while focused.
      if (!current || current.focused !== true || current.sensitive || current.enabled === false || (current.obstructed && !axDelivery)) {
        throw new Error('The intended text field did not receive focus. No keyboard input was sent; inspect the current window and focus the intended field before continuing.')
      }
      liveAction.inputReceiver = receiverIdentity(current)
      const viewport = this.options.ownedWindowGroup ? receiverFrame.inputViewport : null
      if (viewport && liveAction.inputReceiver.bounds) {
        liveAction.inputReceiver.bounds = { ...liveAction.inputReceiver.bounds,
          x: liveAction.inputReceiver.bounds.x + viewport.x, y: liveAction.inputReceiver.bounds.y + viewport.y }
      }
    }
    if (selection) {
      // The click is still freshly resolved/hit-tested above. Do not infer that
      // it focused the field: the native guard must prove the receiver before
      // posting select-all or any text. A rejected guard stops the transaction.
      if (!intendedReceiver?.bounds || !isEditable(intendedReceiver)) throw new Error('Replacement requires a resolved editable receiver')
      liveAction.inputReceiver = receiverIdentity(intendedReceiver)
      const viewport = this.options.ownedWindowGroup ? this.lastFrame.inputViewport : null
      if (viewport && liveAction.inputReceiver.bounds) liveAction.inputReceiver.bounds = { ...liveAction.inputReceiver.bounds,
        x: liveAction.inputReceiver.bounds.x + viewport.x, y: liveAction.inputReceiver.bounds.y + viewport.y }
    }
    // The reviewed Cmd+S becomes the native save transaction: the controller
    // opens the Save panel, sets the name and folder by accessibility with
    // read-back, presses Save once and checks the new file on disk. The
    // window focus check before it runs with the document, not a sheet, in front.
    const governedSave = governedSavePath ? governedSaveLiveAction(liveAction, governedSavePath, this.options.target) : null
    if (governedSave) { Object.assign(liveAction, governedSave); delete liveAction.inputReceiver }
    // The in-place save of the file this conversation saved: checked here, before any key; read back after it.
    const resave = governedResavePath ? await this.prepareGovernedResave(governedResavePath, signal) : null
    if (codeEditor && (action.kind === 'type' || replacement)) this.options.onCaptureDiagnostic?.({ stage: 'code_editor_paste', kind: action.kind })
    const boundElement = intendedReceiver ?? (grounding?.elementId ? this.lastFrame.elements.find(element => element.id === grounding.elementId) : undefined)
    if (action.kind === 'type' && boundElement && isBrowserLocationField(boundElement)) this.options.onAddressTyped?.({ host: typedAddressHost(action.text), characters: [...action.text].length })
    const ledgerEntry: SelectedWindowInputLedgerEntry = { sequence: ++this.inputSequence, kind: action.kind,
      label: boundElement && !boundElement.sensitive ? (boundElement.name?.trim() || grounding?.label?.trim() || null) : grounding?.label?.trim() || null,
      role: boundElement?.role ?? null, ...('point' in action && action.point ? { point: { x: Math.round(action.point.x), y: Math.round(action.point.y) } } : {}),
      ...(action.kind === 'type' ? { characters: [...action.text].length } : {}),
      ...(action.kind === 'keypress' && persistenceChord(action.keys) ? { chord: persistenceChord(action.keys)! } : {}) }
    const selectionEntry: SelectedWindowInputLedgerEntry | null = selection ? { label: ledgerEntry.label, role: ledgerEntry.role, sequence: ++this.inputSequence, kind: 'keypress' } : null
    const replacementEntry: SelectedWindowInputLedgerEntry | null = replacement ? { label: ledgerEntry.label, role: ledgerEntry.role, sequence: ++this.inputSequence, kind: 'type', characters: [...replacement.text].length } : null
    if (this.options.ownedWindowGroup) {
      if ((liveAction.point || liveAction.endPoint) && this.lastFrame.capturedWindows) liveAction.captureWindows = this.lastFrame.capturedWindows
      const viewport = this.lastFrame.inputViewport
      if (!viewport) throw new Error('Input requires the screenshot coordinate mapping')
      const translate = (point: { x: number; y: number }) => {
        if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x >= this.lastFrame!.width || point.y >= this.lastFrame!.height)
          throw new Error('Input point lies outside the screenshot')
        return { x: point.x + viewport.x, y: point.y + viewport.y }
      }
      if (liveAction.point) liveAction.point = translate(liveAction.point)
      if (liveAction.endPoint) liveAction.endPoint = translate(liveAction.endPoint)
      // Keyboard delivery has no pixel coordinates. Window identity/focus is
      // revalidated natively, so a resize need not interrupt typing or Save.
      if (liveAction.point || liveAction.endPoint) liveAction.captureBounds = viewport.parentBounds
    }
    // Observe only immediately around our own input. Never restore a window
    // merely because a later capture failed or the user switched applications.
    if (effect) this.windowRecoveryExpiresAt = 0
    const before = !effect ? await this.options.backend.windowLifecycle?.(this.options.target, false, signal) : null
    signal.throwIfAborted()
    mark('lifecycle')
    const changesField = Boolean(replacement) || action.kind === 'type' || action.kind === 'keypress'
      && this.lastFrame.elements.some(element => (element.id === grounding?.elementId || element.focused || element.containsFocus) && element.editable)
    if (changesField) {
      // These values predate the impending edit. They cannot veto a later
      // completion if the edit or its post-input observation is interrupted.
      for (const element of this.lastFrame.elements) {
        if (element.editable || /text(field|area)|combobox/iu.test(element.role)) this.observedFieldValues.delete(element.name)
      }
    }
    // A failed/partial mutation must never become the document's baseline on
    // the next capture, even when it has no confirmed delivery receipt.
    if (replacement || ['type', 'keypress', 'drag'].includes(action.kind)) this.contentInputAttempted = true
    let receipt: Awaited<ReturnType<LiveComputerBackend['execute']>> = undefined
    let stepwise = false
    try {
      if (replacement) {
        if (!liveAction.inputReceiver) throw new Error('Replacement requires a bound receiver for native focus validation')
        const typing = { ...this.toLiveAction(replacement, grounding), inputReceiver: liveAction.inputReceiver, ...(codeEditor ? { textDelivery: 'clipboard_text' as const } : {}) }
        // The compact fill (click, select-all, text in one transaction) is the usual way a whole document is rewritten;
        // the final-line-break rule above sees only separately delivered keys (e2e A-N1 on the 0.1.10 candidate).
        const fillReceiver = bindingTarget ?? intendedReceiver
        if (typing.kind === 'type' && selection && isSelectAllChord(selection.keys) && fillReceiver && /textarea/iu.test(fillReceiver.role)
          && typeof this.initialDocumentText === 'string' && this.initialDocumentText.endsWith('\n') && replacement.text.length > 0 && !replacement.text.endsWith('\n')) {
          // Spaces the model left after the last word are not part of the document when its last line had none
          // (e2e A-N1 r1, 3 Oct: "…following up with them). " was saved, so the file no longer matched the note).
          const ending = /[ \t]$/u.test(this.initialDocumentText.replace(/\n+$/u, '')) ? replacement.text : replacement.text.replace(/[ \t]+$/u, '')
          typing.text = `${ending}\n`
          this.options.onCaptureDiagnostic?.({ stage: 'final_newline_kept', characters: [...replacement.text].length, via: 'fill', trailingSpacesTrimmed: ending.length !== replacement.text.length })
        }
        const steps = selection ? [liveAction, { ...this.toLiveAction(this.normalizeAction(selection) as Extract<ComputerActionProposal, { kind: 'keypress' }>, grounding), inputReceiver: liveAction.inputReceiver }, typing] : [liveAction, typing]
        receipt = await this.options.backend.executeTransaction!(this.options.target, typing, steps, signal)
        if (!receipt) throw new ComputerInputDeliveryError('Native transaction omitted its delivery receipt; input outcome is unknown', true)
        // The click landed but the field it focused is not the one bound (a
        // site that replaces its search box on focus) or took focus late: no
        // key and no text went out. Finish the same fill one step at a time,
        // where each key gets its own capture, focus-by-identity and
        // replacement-field rebinding, instead of failing the program.
        stepwise = Boolean(selection && selectionBinding && replacementBinding) && fillTransactionFallbackEligible(receipt)
      } else receipt = await this.options.backend.execute(this.options.target, liveAction, signal)
      if (!stepwise) requireDeliveredInput(receipt, Boolean(replacement) || action.kind === 'type')
      if (governedSave) {
        requireGovernedSave(receipt, this.options.onCaptureDiagnostic)
        if (governedSaveReceiptEnabled()) {
          const saved = await confirmGovernedSaveOnDisk(receipt, governedSave.filePath!, this.options.readSavedFile)
          if (saved) this.governedSaves.push({ ...saved, sequence: ledgerEntry.sequence })
          this.options.onCaptureDiagnostic?.({ stage: 'governed_save_receipt', confirmed: Boolean(saved), bytes: saved?.bytes ?? null })
        }
      }
      if (resave) {
        const saved = await this.confirmResave(resave, signal)
        this.governedSaves.push({ filePath: saved.filePath, displayPath: saved.displayPath, bytes: saved.bytes, contentSha256: saved.contentSha256, sequence: ledgerEntry.sequence })
        this.options.onCaptureDiagnostic?.({ stage: 'governed_resave_receipt', confirmed: true, bytes: saved.bytes, appendOnly: saved.appendOnly, addedLines: saved.addedLines, repeatedLines: saved.repeatedLines })
      }
    } catch (error) {
      if (!receipt || receipt.deliveryProgress !== 'none' || receipt.pressedInputsReleased !== true) {
        this.inputLedger.push({ ...ledgerEntry, delivery: 'uncertain' })
        if (selectionEntry) this.inputLedger.push({ ...selectionEntry, delivery: 'uncertain' })
        if (replacementEntry) this.inputLedger.push({ ...replacementEntry, delivery: 'uncertain' })
        if (this.inputLedger.length > 200) this.inputLedger.splice(0, this.inputLedger.length - 200)
      }
      throw error
    }
    this.inputLedger.push(ledgerEntry)
    if (stepwise) {
      if (this.inputLedger.length > 200) this.inputLedger.splice(0, this.inputLedger.length - 200)
      this.options.onCaptureDiagnostic?.({ stage: 'fill_transaction_stepwise', code: receipt?.failure?.code ?? null })
      this.options.onActionTiming?.({ kind: 'click', compact: true, totalMs: Date.now() - startedAt, timings: { ...timings, deliver: Date.now() - phaseStartedAt } })
      this.programKeyReceiver = null
      this.compactBindings?.unshift(selectionBinding!, replacementBinding!)
      await this.executeBoundAction(selection!, signal, grounding)
      await this.executeBoundAction(replacement!, signal, grounding)
      return
    }
    if (selectionEntry) this.inputLedger.push(selectionEntry)
    if (replacementEntry) this.inputLedger.push(replacementEntry)
    if (this.inputLedger.length > 200) this.inputLedger.splice(0, this.inputLedger.length - 200)
    // Keys that keep focus in this field (typing, select-all, a whole fill)
    // leave its accepted receiver for later keys of the same program. A
    // click, Enter, Tab or any other key may move focus: forget it.
    if (this.compactBindings) {
      const keepsFocus = Boolean(replacement) || action.kind === 'type' || action.kind === 'keypress' && isSelectAllChord(action.keys)
      this.programKeyReceiver = keepsFocus && programTarget && liveAction.inputReceiver ? { target: programTarget, receiver: structuredClone(liveAction.inputReceiver) } : null
    }
    mark('deliver')
    if (this.compactBindings) {
      const chord = action.kind === 'keypress' ? action.keys.flatMap(key => key.split('+')).map(key => key.trim().toUpperCase()) : []
      this.locationChain = this.browserSurface() && chord.length === 2 && ['META', 'CMD', 'COMMAND'].includes(chord[0]!) && chord[1] === 'L'
        ? true : this.locationChain && (action.kind === 'type' || (action.kind === 'keypress' && !chord.includes('ENTER') && !chord.includes('RETURN')))
    }
    if (receipt?.timings) {
      timings.deliverPrepare = receipt.timings.prepareMs; timings.deliverInput = receipt.timings.deliverMs
      // Time inside this backend's delivery call but outside the native
      // backend's own window preparation and input: a wrapper around the
      // backend (an evaluation harness's guard, for one) shows up here.
      if (timings.deliver !== undefined) timings.deliverOutsideBackend = Math.max(0, timings.deliver - receipt.timings.prepareMs - receipt.timings.deliverMs)
      // Inside the input controller: overlay present, aim hold, person-turn
      // wait, window-focus handoff and the native dispatch itself.
      const dispatch = receipt.timings.dispatch
      if (dispatch) { timings.dispatchPresent = dispatch.presentMs; timings.dispatchAim = dispatch.aimMs; timings.dispatchPersonTurn = dispatch.personTurnMs; timings.dispatchFocusWindow = dispatch.focusWindowMs; timings.dispatchNative = dispatch.dispatchMs }
    }
    if (changesField && this.options.fieldProofs !== false && !this.compactBindings && !signal.aborted) {
      try {
        // Read the completed edit before a later click/Tab hides its field.
        // Keep lastFrame untouched: remaining batch IDs and pixel coordinates
        // still belong to the originally admitted action frame.
        const fields = await this.options.backend.capture(this.options.target,
          `${this.options.sessionId}-field-proof-${++this.captureSequence}-${Date.now()}`, {signal, ...(this.options.ownedWindowGroup ? {ownedWindowGroup:true} : {})})
        this.rememberFieldValues(fields)
      } catch { /* Missing optional evidence must never make delivered input retryable. */ }
    }
    mark('proof')
    if (!effect && before === 'visible' && this.options.backend.windowLifecycle) {
      this.windowRecoveryExpiresAt = Date.now() + 5_000
      signal.throwIfAborted()
      if (await this.restoreMinimizedWindow(signal)) {
        throw new WindowLifecycleFeedback('The action ran but minimized the selected window. Carve restored that exact window. Remaining batch actions were discarded. Inspect the fresh screenshot and choose a different control; do not replay the minimizing action.', true)
      }
    }
    mark('lifecycle')
    // A fresh frame after the program's last input. Between inputs the next
    // action's own pre-input capture (above) revalidates against the live
    // layout, so a capture here was paid twice per action (measured:
    // two accessibility walks per input, 0.3 to 0.9 s each).
    if (this.compactBindings && this.compactBindings.length === 0) this.locationChain = false
    if (this.compactBindings && this.compactBindings.length === 0 && process.env.STEWARD_COMPACT_SETTLE_PROBES !== '1') await this.capture(signal)
    mark('postcapture')
    const busy = loop()
    timings.eventLoopUtilizationPermille = Math.round(busy.eventLoopUtilization * 1000); timings.maxEventLoopLagMs = busy.maxEventLoopLagMs
    this.options.onActionTiming?.({ kind: action.kind, compact: this.compactBindings !== null, totalMs: Date.now() - startedAt, timings })
  }

  private async restoreMinimizedWindow(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    if (Date.now() > this.windowRecoveryExpiresAt || !this.options.backend.windowLifecycle) return false
    if (await this.options.backend.windowLifecycle(this.options.target, false, signal) !== 'minimized') return false
    this.windowRecoveryExpiresAt = 0 // Only one mutation attempt for this action.
    let restored = await this.options.backend.windowLifecycle(this.options.target, true, signal)
    if (restored === 'restoring') {
      for (let attempt = 0; attempt < 15 && restored !== 'visible'; attempt++) {
        await delay(50, undefined, { signal })
        restored = await this.options.backend.windowLifecycle(this.options.target, false, signal)
      }
    }
    signal.throwIfAborted()
    if (restored !== 'visible') throw new WindowLifecycleFeedback('The action minimized the selected window. Restoration was not permitted or could not be verified; no further input was sent. The window needs attention before work can continue.', true)
    this.options.onWindowRecovery?.('minimize')
    return true
  }

  /** Bounded wait for a layout that is still changing: capture until two
   * consecutive control digests agree, at most `maximumMs`. Returns whether
   * the layout settled; the caller resolves its target either way, and an
   * unsettled page still fails closed at the hit test. */
  async awaitStableLayout(signal: AbortSignal, maximumMs = 2_500): Promise<boolean> {
    const startedAt = Date.now()
    let previous = this.lastFrame ? compactLayoutDigest(this.lastFrame) : null
    // Once per session: a layout identical to the one captured at submit,
    // seconds earlier, has already held still for longer than one probe
    // interval. The frame the model sees is still this session's own capture.
    const baseline = this.stabilityBaselinePending ? await this.stabilityBaselinePending.catch(() => null) : null
    this.stabilityBaselinePending = null
    if (baseline) {
      const matched = previous !== null && previous === baseline.digest && Date.now() - baseline.capturedAt < 60_000
      this.options.onCaptureDiagnostic?.({ kind: 'stability_baseline', matched, baselineAgeMs: Date.now() - baseline.capturedAt })
      if (matched) return true
    }
    while (Date.now() - startedAt < maximumMs) {
      await delay(250, undefined, { signal })
      await this.capture(signal)
      const current = this.lastFrame ? compactLayoutDigest(this.lastFrame) : null
      if (current !== null && current === previous) return true
      previous = current
    }
    return false
  }

  normalizeAction(action: ComputerActionProposal): ComputerActionProposal {
    if (action.kind !== 'keypress') return action
    return {
      ...action,
      keys: normalizeKeyChord(action.keys, this.options.platform ?? process.platform),
    }
  }

  /** Authorizable, labeled controls nearest a frame point. Labels are visible
   * control names only; sensitive, disabled and obstructed controls are excluded. */
  nearbyControls(point: { x: number; y: number }, options: { limit: number; editableOnly?: boolean }): UniversalNearbyControl[] {
    const label = (element: LiveComputerElement) => [element.name, element.description].find(value => typeof value === 'string' && value.trim())?.trim() ?? ''
    const distance = (bounds: NonNullable<LiveComputerElement['bounds']>) => {
      const dx = Math.max(bounds.x - point.x, 0, point.x - (bounds.x + bounds.width))
      const dy = Math.max(bounds.y - point.y, 0, point.y - (bounds.y + bounds.height))
      return Math.hypot(dx, dy)
    }
    const seen = new Set<string>()
    return (this.lastFrame?.elements ?? [])
      .filter(element => element.bounds && !element.sensitive && !element.obstructed && element.enabled !== false && label(element)
        && (options.editableOnly ? isEditable(element) : clickEffectResolvable(element)))
      .map(element => ({ element, distance: distance(element.bounds!) }))
      .sort((left, right) => left.distance - right.distance)
      .filter(({ element }) => { const key = `${element.role}:${label(element)}`; if (seen.has(key)) return false; seen.add(key); return true })
      .slice(0, Math.max(0, options.limit))
      .map(({ element }) => ({ label: label(element), role: describeRole(element), bounds: { ...element.bounds! } }))
  }

  /** The brief the model receives with the frame it is about to act on.
   * Selection is by what the next action plausibly needs, in this order: the
   * proven keyboard receiver, anything covering the window, editable fields,
   * controls the goal names, then the neighbourhood of the last pointer
   * action. Only controls the effect policy could authorize are listed, so the
   * brief cannot point at a sensitive, disabled or obstructed receiver, and
   * values are never included. It is advisory: binding, effect class and
   * supervision still decide every proposal. */
  briefControls(options: { limit: number; near: { x: number; y: number } | null }): UniversalBriefControl[] {
    const elements = this.lastFrame?.elements ?? []
    const limit = Math.max(0, Math.min(24, options.limit))
    if (!limit || !elements.length) return []
    const label = (element: LiveComputerElement) => [element.name, element.description, element.placeholder].find(value => typeof value === 'string' && value.trim())?.trim() ?? ''
    const eligible = elements.filter(element => element.bounds && element.bounds.width > 0 && element.bounds.height > 0
      && !element.sensitive && !element.obstructed && element.enabled !== false && label(element)
      && (isEditable(element) || clickEffectResolvable(element)))
    const picked: UniversalBriefControl[] = []
    const seen = new Set<string>()
    const take = (element: LiveComputerElement, reason: UniversalBriefControl['reason']) => {
      if (picked.length >= limit) return
      const key = `${element.role}:${label(element)}`
      if (seen.has(key)) return
      seen.add(key)
      picked.push({ label: label(element), role: describeRole(element), bounds: { ...element.bounds! }, reason })
    }
    // The receiver typing would reach, named so keys are not sent blind.
    const focused = focusedTextReceiver(elements) ?? eligible.find(element => element.focused === true)
    if (focused && label(focused) && focused.bounds) take(focused, 'focused')
    // Whatever covers the page blocks every other control; name its choices first.
    const dialogs = elements.filter(element => element.bounds && !element.obstructed
      && (element.role === 'AXDialog' || element.role === 'AXSheet' || element.subrole === 'AXDialog'))
    for (const dialog of dialogs.slice(0, 2)) {
      const within = dialog.bounds!
      for (const element of eligible.filter(candidate => candidate !== dialog && candidate.bounds
        && candidate.bounds.x >= within.x - 1 && candidate.bounds.y >= within.y - 1
        && candidate.bounds.x + candidate.bounds.width <= within.x + within.width + 1
        && candidate.bounds.y + candidate.bounds.height <= within.y + within.height + 1).slice(0, 4)) take(element, 'covering')
    }
    for (const element of eligible.filter(candidate => isEditable(candidate)).slice(0, 4)) take(element, 'editable')
    const terms = goalPreferenceTerms(this.options.approvedGoal ?? '')
    if (terms.length) {
      for (const element of eligible.filter(candidate => {
        const text = label(candidate).toLocaleLowerCase()
        return terms.some(term => text.includes(term))
      }).slice(0, 4)) take(element, 'goal')
    }
    const near = options.near
    if (near) {
      const distance = (bounds: NonNullable<LiveComputerElement['bounds']>) =>
        Math.hypot(Math.max(bounds.x - near.x, 0, near.x - (bounds.x + bounds.width)), Math.max(bounds.y - near.y, 0, near.y - (bounds.y + bounds.height)))
      for (const { element } of eligible.map(element => ({ element, d: distance(element.bounds!) })).sort((a, b) => a.d - b.d)) take(element, 'nearby')
    } else {
      // No pointer history yet: the largest labelled controls are the page's landmarks.
      for (const element of [...eligible].sort((a, b) => (b.bounds!.width * b.bounds!.height) - (a.bounds!.width * a.bounds!.height))) take(element, 'nearby')
    }
    return picked
  }

  frameGrounding(): { controlsReadable: boolean; browser: boolean; lookupField?: string | null } {
    return {
      controlsReadable: this.lastFrame?.elementCaptureStatus === 'available' && (this.lastFrame?.elements.length ?? 0) > 0,
      browser: isBrowserBundleIdentifier(this.options.target.bundleIdentifier),
      lookupField: this.lastFrame ? focusedLookupFieldWithText(this.lastFrame.elements)?.label ?? null : null,
    }
  }

  private interpretationCache: { key: string; frameSha256: string; actions: ComputerActionProposal[]; result: UniversalComputerBatchPreflight; contextKey: string; reviewed: InterpretedAction[]; elements: LiveComputerElement[] } | null = null

  /** Owned child-window rectangles are coverage hints: their own controls
   * can also appear in the parent's AX tree. Resolve that ambiguity with a
   * native hit test, never with a model's opinion or a geometry exemption.
   * Evidence is batch-local; execution still captures and hit-tests again. */
  private async frameWithPointerEvidence(actions: ComputerActionProposal[], signal: AbortSignal): Promise<LiveComputerCapturedFrame | null> {
    const frame = this.lastFrame ? structuredClone(this.lastFrame) : null
    if (!frame || !this.options.backend.hitTest) return frame
    // An accessibility-delivered click never lands at its point: nothing to probe.
    const points = actions.flatMap((action, index) => this.compactBindings?.[index]?.delivery ? [] : 'point' in action ? [action.point] : action.kind === 'drag' ? action.path : [])
    let probes = 0
    for (const element of frame.elements) {
      if (!element.bounds || element.sensitive || element.obstructed || element.enabled === false || !element.pointerObstructions?.length) continue
      const coveredPoints = points.filter(point => containsPoint(element.bounds!, point) && element.pointerObstructions!.some(bounds => containsPoint(bounds, point)))
      if (!coveredPoints.length) continue
      let reachable = true
      for (const point of coveredPoints) {
        signal.throwIfAborted()
        if (probes++ >= 8) { reachable = false; break }
        const origin = frame.inputViewport ?? { x: 0, y: 0 }
        const expected = elementIdentityForInput(element)
        if (expected.bounds) expected.bounds = { ...expected.bounds, x: expected.bounds.x + origin.x, y: expected.bounds.y + origin.y }
        const hit = await this.options.backend.hitTest(this.options.target, { x: point.x + origin.x, y: point.y + origin.y }, expected).catch(() => null)
        signal.throwIfAborted()
        if (!hit?.available || !hit.stable || hit.obstruction || !['target', 'descendant'].includes(hit.relation)) { reachable = false; break }
      }
      if (reachable) {
        element.pointerObstructions = []
        this.options.onCaptureDiagnostic?.({ stage: 'pointer_occlusion_resolved', points: coveredPoints.length, role: element.role })
      }
    }
    if (this.lastFrame?.id !== frame.id) throw new Error('Pointer evidence changed during hit testing; no input was sent')
    return frame
  }

  /**
   * Join the compact actor's exact ref to the ordinary batch preflight. The
   * coordinate compiler intentionally knows nothing about compact refs, so a
   * generic AXButton would otherwise buy a second model call even when the
   * fresh tree contains one exact, harmless selector target. This grants only
   * the narrow selector effects defined by `compactRefSelectorEffect`; stale,
   * duplicate, covered, sensitive and protected controls fall through.
   */
  private applyCompactRefEvidence(actions: ComputerActionProposal[], frame: LiveComputerCapturedFrame, baseline: UniversalComputerBatchPreflight): UniversalComputerBatchPreflight {
    if (!this.compactBindings) return baseline
    const result = structuredClone(baseline)
    for (const [index, proposed] of actions.entries()) {
      const compact = this.compactBindings[index]
      const action = this.normalizeAction(proposed)
      if (!compact?.target || stableJson(compact.action) !== stableJson(action)
        || action.kind !== 'click' || action.button !== 'left' || action.modifiers.length) continue
      const resolution = resolveInputTarget(elementIdentityForInput(compact.target), frame.elements)
      const current = resolution.element
      if (compact.delivery?.via === 'ax') {
        // The actor's exact ref, found uniquely and delivered to by identity.
        // A value item of an open pop-up is a reversible local edit of that
        // pop-up (as Enter on it is); any other class stands unchanged.
        const binding = result.semanticBindings[index], effect = result.effects[index]
        if (!current || resolution.candidateCount !== 1 || !binding?.resolved || binding.elementId !== current.id || !effect) continue
        if (effect.class === 'read_only' && popupValueItem(current, frame.elements)) {
          result.effects[index] = { ...effect, class: 'reversible_local_write', reversibility: 'reversible', location: 'local' }
        }
        result.semanticBindings[index] = { ...binding, interpretationSource: 'compact_ref', bounds: { ...current.bounds! } }
        this.options.onCaptureDiagnostic?.({ stage: 'compact_ref_ax', effect: result.effects[index]!.class, role: current.role })
        continue
      }
      // A positional narrowing among duplicate refs is sufficient for guarded
      // dispatch but not for removing an independent semantic review.
      if (!current || resolution.candidateCount !== 1 || !current.bounds
        || current.sensitive || current.enabled === false || current.obstructed || current.pointerObstructions?.length) {
        // A furniture retailer: the actor named a suggestion link by ref, the point bound an unnamed group
        // inside it, and no rebind happened; the saved evidence could not say why. Now it can.
        if (/link|button/iu.test(compact.target.role ?? '') && result.semanticBindings[index]?.resolved === false) {
          this.options.onCaptureDiagnostic?.({ stage: 'compact_ref_rebind_skipped', role: compact.target.role, candidates: resolution.candidateCount,
            reason: !current ? 'not_found' : resolution.candidateCount !== 1 ? 'not_unique' : !current.bounds ? 'no_bounds' : current.sensitive ? 'sensitive' : current.enabled === false ? 'disabled' : current.obstructed ? 'obstructed' : 'pointer_obstructions' })
        }
        continue
      }
      // A card link wraps an image and caption; at its center the point
      // compiler binds the nested image, which has no effect of its own, so
      // every card click paid a contextual review (three per click in one
      // run). The actor named the link by ref and it
      // rebinds uniquely here, so bind the click to it: recompile with only
      // the non-interactive content nested inside that link set aside.
      // Dialogs, sensitive or interactive elements are never set aside, the
      // link's own label decides its class ("Buy tickets" stays financial),
      // and the native hit test must still prove the click reaches the link.
      // The same holds for a button the point compiler found tied with a
      // same-size element (a grocery site's "Reject All Non-Essential":
      // refused twice as ambiguous, and the search behind it never ran).
      // There, an unnamed wrapper with the button's exact geometry is also
      // set aside: it names nothing the person could choose instead.
      // A button's own content counts too: the point under a grocery site's "Delivery"
      // option landed on a named text group inside the button, which was judged
      // an unknown control twice, so the choice never ran.
      // Interactive content inside a button is invalid HTML; what the tree
      // shows there is the button's own label, icon and layout.
      const unresolvedIssue = result.semanticBindings[index]?.resolved === false ? result.semanticBindings[index]?.resolutionIssue : undefined
      // The actor's ref may name the text or image inside a control (a filter's label, a card's caption): the
      // receiver is the smallest labelled control enclosing it. Checkboxes, radios, tabs and menu items tied at
      // their point rebind like buttons. `STEWARD_REF_ENCLOSING_BIND=off` keeps links and tied buttons only.
      const enclosingBind = refEnclosingBindEnabled()
      const anchor = enclosingBind && !actionableRefRole.test(current.role) ? smallestEnclosingActionable(current, frame.elements) ?? current : current
      const tiedButton = /button/iu.test(anchor.role) && (unresolvedIssue === 'ambiguous_control_at_point' || unresolvedIssue === 'control_effect_unknown')
      const tiedControl = enclosingBind && actionableRefRole.test(anchor.role) && (unresolvedIssue === 'ambiguous_control_at_point' || unresolvedIssue === 'control_effect_unknown')
      if ((/link/iu.test(anchor.role) || tiedButton || tiedControl || anchor !== current) && result.semanticBindings[index]?.elementId !== anchor.id) {
        const within = (inner: LiveComputerElement) => Boolean(inner.bounds && anchor.bounds && inner.bounds.x >= anchor.bounds.x - 1 && inner.bounds.y >= anchor.bounds.y - 1
          && inner.bounds.x + inner.bounds.width <= anchor.bounds.x + anchor.bounds.width + 1 && inner.bounds.y + inner.bounds.height <= anchor.bounds.y + anchor.bounds.height + 1)
        const passive = (inner: LiveComputerElement) => inner.id !== anchor.id && within(inner) && !inner.sensitive && inner.obstructed !== true && !inner.pointerObstructions?.length
          && !/dialog|sheet|alert/iu.test(inner.subrole ?? '') && !inner.editable
        const decorative = (inner: LiveComputerElement) => passive(inner)
          && /^(?:AX)?(?:Image|StaticText|Group|GenericElement|Unknown|Heading|Paragraph)$/u.test(inner.role)
          && !(inner.actions ?? []).some(name => ['AXPress', 'AXConfirm', 'AXPick', 'AXIncrement', 'AXDecrement'].includes(name))
        const sameGeometry = (inner: LiveComputerElement) => Boolean(inner.bounds && anchor.bounds) && Math.abs(inner.bounds!.x - anchor.bounds!.x) <= 1 && Math.abs(inner.bounds!.y - anchor.bounds!.y) <= 1
          && Math.abs(inner.bounds!.width - anchor.bounds!.width) <= 1 && Math.abs(inner.bounds!.height - anchor.bounds!.height) <= 1
        const wrapper = (inner: LiveComputerElement) => (tiedButton || tiedControl) && passive(inner) && (sameGeometry(inner) && !(inner.name ?? '').trim() && /^(?:AX)?(?:Group|GenericElement|Unknown)$/u.test(inner.role)
          || !sameGeometry(inner) && /^(?:AX)?(?:Image|StaticText|Group|GenericElement|Unknown|Heading|Paragraph)$/u.test(inner.role))
        const setAside = new Set(frame.elements.filter(inner => decorative(inner) || wrapper(inner)).map(inner => inner.id))
        if (setAside.size) {
          const rebound = compileUniversalComputerBatchPreflight([proposed], frame.elements.filter(inner => !setAside.has(inner.id)), this.options.target, this.options.approvedGoal, this.options.browserResearchScope, this.browserLaunch())
          const binding = rebound.semanticBindings[0], effect = rebound.effects[0]
          if (binding?.elementId === anchor.id && binding.resolved && effect && effect.targetResolved) {
            result.semanticBindings[index] = { ...binding, actionIndex: index, bounds: { ...anchor.bounds! }, interpretationSource: 'compact_ref' }
            result.effects[index] = effect
            this.options.onCaptureDiagnostic?.({ stage: anchor !== current ? 'compact_ref_enclosing_rebound' : tiedButton || tiedControl ? 'compact_ref_tie_rebound' : 'compact_ref_link_rebound', effect: effect.class, role: anchor.role, setAside: setAside.size })
          }
        }
        continue
      }
      const selectorEffect = compactRefSelectorEffect(current)
      const binding = result.semanticBindings[index]
      if (!selectorEffect || !binding || binding.elementId !== current.id || !binding.target || !binding.stateDigest) continue
      result.effects[index] = {
        class: selectorEffect,
        location: 'local',
        reversibility: selectorEffect === 'read_only' ? 'none' : 'reversible',
        target: binding.target,
        payloadDigest: null,
        targetResolved: true,
        payloadResolved: true,
      }
      result.semanticBindings[index] = {
        ...binding,
        resolved: true,
        bounds: { ...current.bounds },
        interpretationSource: 'compact_ref',
      }
      delete result.semanticBindings[index]!.resolutionIssue
      this.options.onCaptureDiagnostic?.({ stage: 'compact_ref_preflight', effect: selectorEffect, role: current.role, narrowedBy: resolution.narrowedBy, candidates: resolution.candidateCount })
    }
    return result
  }

  async resolveBatch(actions: ComputerActionProposal[], signal: AbortSignal): Promise<UniversalComputerBatchPreflight> {
    const observed = await this.frameWithPointerEvidence(actions, signal)
    const ax = observed ? this.axDeliveryFrame(actions, observed) : null
    const frame = ax?.frame ?? observed
    const resolved = await this.resolveBatchInFrame(actions, frame, signal)
    const agreed = frame ? this.enforceCompactRefAgreement(actions, frame, resolved) : resolved
    return ax ? this.requireAxBindings(ax.targets, agreed) : agreed
  }

  /**
   * The policy's view of a program whose inputs go through accessibility.
   * Such an input never passes through the pointer location, so its effect is
   * bound to the ref element itself: the named target, found uniquely in the
   * fresh tree, not sensitive and enabled. In this view (a clone, used only to
   * classify) that target is not treated as covered, other elements that
   * merely overlap its centre are set aside (its own ancestors stay), and a
   * dropdown that is to receive type-ahead is the one focused control; the
   * backend proves that focus natively before any key. The target's own role
   * and label still decide its class: opening a value pop-up stays safe_local,
   * a value item of an open pop-up a reversible local edit, and a protected
   * label such as "Buy now" keeps its protected class.
   */
  private axDeliveryFrame(actions: ComputerActionProposal[], frame: LiveComputerCapturedFrame): { frame: LiveComputerCapturedFrame; targets: Map<number, string | null> } | null {
    if (!this.compactBindings) return null
    const targets = new Map<number, string | null>()
    let view: LiveComputerCapturedFrame | null = null
    const area = (b: NonNullable<LiveComputerElement['bounds']>) => b.width * b.height
    const encloses = (outer: NonNullable<LiveComputerElement['bounds']>, inner: NonNullable<LiveComputerElement['bounds']>) =>
      outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height && area(outer) > area(inner)
    for (const [index, proposed] of actions.entries()) {
      const binding = this.compactBindings[index]
      if (binding?.delivery?.via !== 'ax' || !binding.target || stableJson(binding.action) !== stableJson(this.normalizeAction(proposed))) continue
      const resolution = resolveInputTarget(elementIdentityForInput(binding.target), frame.elements)
      const current = resolution.candidateCount === 1 && resolution.element && !resolution.element.sensitive && resolution.element.enabled !== false
        && (resolution.element.bounds || 'point' in proposed && binding.delivery.elementAction) ? resolution.element : null
      targets.set(index, current?.id ?? null)
      if (!current) continue
      view ??= structuredClone(frame)
      const own = view.elements.find(element => element.id === current.id)
      if (!own) { targets.set(index, null); continue }
      // A frameless item (a hidden <select>'s list) is classified at the
      // program's point, in this policy view only: delivery is by identity.
      if (!own.bounds && 'point' in proposed) own.bounds = { x: proposed.point.x - 0.5, y: proposed.point.y - 0.5, width: 1, height: 1 }
      if (!own.bounds) { targets.set(index, null); continue }
      own.obstructed = false
      own.pointerObstructions = []
      if ('point' in proposed) {
        const point = proposed.point
        view.elements = view.elements.filter(element => element.id === own.id || !element.bounds || !containsPoint(element.bounds, point) || encloses(element.bounds, own.bounds!))
      } else if (popupControl(own) && !isEditable(own)) {
        for (const element of view.elements) if (element.id !== own.id) element.focused = false
        own.focused = true
      }
    }
    return view ? { frame: view, targets } : targets.size ? { frame, targets } : null
  }

  /** An accessibility-delivered input stands only on its own ref element. */
  private requireAxBindings(targets: Map<number, string | null>, preflight: UniversalComputerBatchPreflight): UniversalComputerBatchPreflight {
    const result = structuredClone(preflight)
    for (const [index, elementId] of targets) {
      const binding = result.semanticBindings[index]
      if (!binding) continue
      const keyboard = binding.actionKind === 'type' || binding.actionKind === 'keypress'
      // Keys after a focus rung bind to the focused field or a window key (Escape, select-all).
      if (elementId && (binding.elementId === elementId || keyboard && binding.resolved)) continue
      result.effects[index] = { class: 'unknown', location: 'unknown', reversibility: 'unknown', target: null, targetResolved: false, payloadDigest: null, payloadResolved: false }
      result.semanticBindings[index] = { ...binding, resolved: false, resolutionIssue: 'control_identity_unproven' }
      this.options.onCaptureDiagnostic?.({ stage: 'ax_binding_refused', index, found: Boolean(elementId) })
    }
    return result
  }

  /**
   * Compact dispatch aims at the control the actor named by ref; the batch
   * policy classifies whatever it bound at the click point, mechanically or
   * through review. The two must be one control (or one inside the other,
   * like a label inside its button). Otherwise the policy judged a different
   * control from the one that would receive the input: on a retailer's site,
   * a click on a 1-px Sort select was classified as the cart link.
   * Fail closed: the action goes back unresolved with a named cause.
   */
  private enforceCompactRefAgreement(actions: ComputerActionProposal[], frame: LiveComputerCapturedFrame, preflight: UniversalComputerBatchPreflight): UniversalComputerBatchPreflight {
    if (!this.compactBindings) return preflight
    let result = preflight
    for (const [index, proposed] of actions.entries()) {
      const compact = this.compactBindings[index]
      if (!compact?.target || !('point' in proposed) || stableJson(compact.action) !== stableJson(this.normalizeAction(proposed))) continue
      const binding = result.semanticBindings[index]
      if (!binding?.resolved) continue
      const named = resolveInputTarget(elementIdentityForInput(compact.target), frame.elements).element
      // Dispatch refuses an unresolvable ref on its own; nothing to compare.
      if (!named) continue
      const bound = binding.elementId ? frame.elements.find(element => element.id === binding.elementId) : undefined
      if (bound && (bound.id === named.id || boundsNested(bound.bounds, named.bounds))) continue
      if (result === preflight) result = structuredClone(preflight)
      result.effects[index] = { class: 'unknown', location: 'unknown', reversibility: 'unknown', target: null, targetResolved: false, payloadDigest: null, payloadResolved: false }
      result.semanticBindings[index] = { ...binding, elementId: named.id, role: named.role, label: (named.name ?? '').trim().slice(0, 120) || binding.label || null, resolved: false, resolutionIssue: 'ref_point_mismatch' }
      this.options.onCaptureDiagnostic?.({ stage: 'compact_ref_point_mismatch', namedRole: named.role, boundRole: bound?.role ?? null })
    }
    return result
  }

  private async resolveBatchInFrame(actions: ComputerActionProposal[], frame: LiveComputerCapturedFrame | null, signal: AbortSignal): Promise<UniversalComputerBatchPreflight> {
    const compiled = compileUniversalComputerBatchPreflight(actions, frame?.elements ?? [], this.options.target, this.options.approvedGoal, this.options.browserResearchScope, this.browserLaunch())
    const baseline = frame ? this.applyCompactRefEvidence(actions, frame, compiled) : compiled
    if (frame) this.recordAmbiguousPoints(actions, frame, baseline)
    if (!this.options.interpretActions || !frame) return baseline
    const context = this.options.interpretationContext?.() ?? { task: this.options.approvedGoal ?? '', plan: [] }
    const input: ActionInterpretationInput = { frame, actions: structuredClone(actions), baseline, target: this.options.target, ...context, priorObservations: this.observationHistory.filter(e => e.frameId !== frame.id) }
    const policy = verificationPolicyFor('consequential', verificationPolicyMode())
    let actorReviews: InterpretedAction[] = []
    if (policy.actionReview === 'none') {
      // Ordinary controls use the actor's proposal when the vocabulary cannot
      // name them. Sensitive controls, obstructions, close buttons,
      // point containment and unproven keyboard receivers are still refused
      // mechanically below, and named protected controls keep their class.
      const indices = interpretationIndices(input)
      if (!indices.length) return mechanicalObservationBoundary(input, baseline)
      // A URL absent from the mechanical shortcuts is not outside the task.
      // Judge its exact destination against the task, even when ordinary
      // action review is off. Otherwise actor mode leaves no way to authorize
      // a legitimate search and sends the actor hunting for unrelated fields.
      const navigationIndices = indices.filter(index => Boolean(baseline.semanticBindings[index]?.browserDestination || baseline.semanticBindings[index]?.browserSearchQuery))
      const locationReceiver = focusedBrowserLocationReceiver(frame.elements)
      const synthesized = indices.flatMap(actionIndex => {
        if (navigationIndices.includes(actionIndex)) return []
        const action = actions[actionIndex]!, binding = baseline.semanticBindings[actionIndex], effect = baseline.effects[actionIndex]
        const point = 'point' in action ? action.point : null
        // The browser address bar is a deliberate privacy boundary, not a gap in the vocabulary:
        // typing arbitrary text there and submitting sends it to the default search engine. A type
        // or key whose receiver is the location field, or a click into it, is never granted the
        // actor's authority; it keeps its mechanical class (unknown when the payload is not a covered
        // URL) and goes to the normal review or recovery path.
        const targetsLocation = (action.kind === 'type' || action.kind === 'keypress') ? Boolean(locationReceiver)
          : point ? frame.elements.some(e => e.bounds && containsPoint(e.bounds, point) && isBrowserLocationField(e)) : false
        if (targetsLocation && (effect?.class ?? 'unknown') === 'unknown') return []
        // The compiler binds nothing when the control under the point is sensitive,
        // disabled or covered; name that control so the mechanical checks refuse it
        // instead of treating the point as empty canvas.
        const blocked = point ? frame.elements.filter(e => e.bounds && containsPoint(e.bounds, point) && (e.sensitive || e.obstructed || e.enabled === false || e.pointerObstructions?.some(b => containsPoint(b, point))))
          .sort((a, b) => a.bounds!.width * a.bounds!.height - b.bounds!.width * b.bounds!.height)[0] : undefined
        const element = binding?.elementId ? frame.elements.find(e => e.id === binding.elementId) : blocked
        const bounds = element?.bounds ?? (point ? { x: Math.max(0, point.x - 8), y: Math.max(0, point.y - 8), width: 16, height: 16 } : null)
        const known: InterpretedAction['effect'] = effect && effect.class !== 'unknown' && interpretationEffectClasses.includes(effect.class) ? effect.class as InterpretedAction['effect'] : 'unclassified_control'
        return [{ actionIndex, actionable: true, elementId: element?.id ?? null, label: element?.name?.trim() || binding?.label || 'unnamed control', bounds, effect: known, coverage: 'covered' as const, confidence: 'high' as const, reason: 'Action reviews are off; the proposal stands on the actor\'s authority.' }]
      })
      if (synthesized.length) this.options.onActorAuthority?.({ actions: synthesized.length, unclassified: synthesized.filter(s => s.effect === 'unclassified_control').length })
      if (!navigationIndices.length) return applyActionInterpretation(input, synthesized)
      actorReviews = synthesized
      input.reviewIndices = navigationIndices
    } else input.reviewIndices = actionReviewIndices(input, policy)
    // Returning to an address this window already showed in this run is the
    // same read-only navigation that was authorized when it was first
    // reached; do not pay for the verdict again (six of eleven reviews in the
    // one candidate run re-checked one search address). Only an
    // exact http(s) address, never one that names signing out, deleting,
    // cancelling, paying or confirming, and never any other action.
    const shownAddresses = new Set(this.observationHistory.flatMap(entry => entry.source?.url ? [entry.source.url] : []))
    const revisit = (index: number): boolean => {
      const destination = baseline.semanticBindings[index]?.browserDestination
      if (!destination) return false
      try {
        const url = new URL(destination); url.hash = ''
        return ['http:', 'https:'].includes(url.protocol) && shownAddresses.has(url.toString())
          && !/log-?out|sign-?out|delete|remove|unsubscribe|cancel|checkout|pay|purchase|confirm|order/iu.test(url.pathname + url.search)
      } catch { return false }
    }
    const revisited = input.reviewIndices.filter(revisit)
    if (revisited.length) {
      actorReviews = [...actorReviews, ...revisited.map(actionIndex => ({ actionIndex, actionable: true, elementId: null, label: 'Return to an address this window already showed', bounds: null,
        effect: 'read_only' as const, coverage: 'covered' as const, confidence: 'high' as const, reason: 'Exact address already displayed in this window during this run.' }))]
      input.reviewIndices = input.reviewIndices.filter(index => !revisited.includes(index))
      this.options.onCaptureDiagnostic?.({ stage: 'navigation_revisit_reused', actions: revisited.length })
      if (!input.reviewIndices.length) return applyActionInterpretation(input, actorReviews)
    }
    if (!input.reviewIndices.length) return mechanicalObservationBoundary(input, baseline)
    // Capture-local element ids change on every capture, even of identical
    // pixels and an identical tree; they are not part of the key. A re-capture
    // of the same frame (same hash, same element count) remaps a review's
    // element by position, since ids are assigned in capture order.
    const key = sha256(stableJson({ frame: frame.sha256, elements: frame.elements.map(e => ({ ...e, id: undefined, depth: undefined })).sort((a, b) => stableJson(a).localeCompare(stableJson(b))), context, reviewPolicy: policy.actionReview, reviewIndices: input.reviewIndices }))
    if (this.interpretationCache?.key === key && stableJson(this.interpretationCache.actions.slice(0, actions.length)) === stableJson(actions)) {
      const cached = this.interpretationCache
      const sameCapture = cached.frameSha256 === frame.sha256 && cached.elements.length === frame.elements.length
      const reviews = cached.reviewed.filter(review => review.actionIndex < actions.length).map(review => {
        const previousIndex = cached.elements.findIndex(e => e.id === review.elementId)
        const previous = previousIndex >= 0 ? cached.elements[previousIndex] : undefined
        const matches = previous?.fingerprint ? frame.elements.filter(e => e.fingerprint === previous.fingerprint) : []
        const byPosition = sameCapture && previousIndex >= 0 ? frame.elements[previousIndex] : undefined
        return { ...review, elementId: matches.length === 1 ? matches[0]!.id : byPosition && byPosition.role === previous?.role ? byPosition.id : review.elementId }
      })
      return applyActionInterpretation(input, reviews)
    }
    const reviewed = [...actorReviews, ...await this.options.interpretActions(input, signal)]
    signal.throwIfAborted()
    if (this.lastFrame?.sha256 !== frame.sha256 || stableJson(this.options.interpretationContext?.() ?? context) !== stableJson(context)) throw new Error('Action interpretation evidence changed; no input was sent')
    const result = applyActionInterpretation(input, reviewed)
    this.interpretationCache = { key, frameSha256: frame.sha256, actions: structuredClone(actions), result: structuredClone(result), contextKey: stableJson(context), reviewed: structuredClone(reviewed), elements: frame.elements }
    return result
  }

  /** Revalidate an already authorized interpretation against fresh mechanical
   * evidence. Do not ask a second model to reinvent the decision when its exact
   * receiver and payload are unchanged. Consequential effects still use fresh review. */
  /** Pixels only, never replacing the last full digest: the same hash basis the authorized observation carries. */
  async captureFingerprint(signal: AbortSignal): Promise<{ sha256: string; screenshot?: ComputerActionScreenshot } | null> {
    if (this.options.compact) {
      // Compact dispatch recaptures before every input anyway (measured:
      // a pixel-only fingerprint and then a full precapture 30 ms apart, on
      // every batch). Take the full capture here once; the first input reuses
      // it while it is fresh and nothing has been sent since.
      const captured = await this.captureFrame(signal)
      this.options.onCapture?.(captured.frame)
      this.freshCompactCapture = { frameId: captured.frame.id, at: Date.now() }
      return captured.screenshot.sha256 ? { sha256: captured.screenshot.sha256, screenshot: captured.screenshot } : null
    }
    const { screenshot } = await this.captureFrame(signal, { elements: false })
    return screenshot.sha256 ? { sha256: screenshot.sha256 } : null
  }

  async revalidateBatch(actions: ComputerActionProposal[], authorized: UniversalComputerBatchPreflight, signal: AbortSignal): Promise<UniversalComputerBatchPreflight> {
    signal.throwIfAborted()
    const cache = this.interpretationCache, frame = this.lastFrame
    const context = this.options.interpretationContext?.() ?? { task: this.options.approvedGoal ?? '', plan: [] }
    if (cache && frame && !frame.elements.some(element => element.pointerObstructions?.length) && cache.contextKey === stableJson(context)
      && stableJson(cache.actions.slice(0, actions.length)) === stableJson(actions)
      && authorized.effects.every(e => ['read_only', 'safe_local', 'reversible_local_write'].includes(e.class))) {
      const byIdentity = identityCacheEnabled()
      let contentChanged = false
      const remapped = cache.reviewed.filter(r => r.actionIndex < actions.length).map(review => {
        const old = cache.elements.find(e => e.id === review.elementId)
        const matches = old?.fingerprint ? frame.elements.filter(e => e.fingerprint === old.fingerprint) : []
        // Without stable AX identity, a reused capture-local ID is not proof.
        // The fingerprint hashes sibling indices, so an element inserted above
        // the control renumbers it; the same label, role and identity, unique
        // in both captures, is the same control (see receiverIdentityDigest).
        const same = matches.length !== 1 && byIdentity && old ? sameIdentityElement(old, cache.elements, frame.elements) : undefined
        const now = matches.length === 1 ? matches[0] : same
        // Content someone else changed in the reviewed control is new evidence.
        if (old && now && (old.value !== now.value || old.valueComplete !== now.valueComplete)) contentChanged = true
        return { ...review, elementId: review.elementId === null ? null : now ? now.id : '__unresolved__' }
      })
      const candidate = applyActionInterpretation({ frame, actions, baseline: this.preflightBatch(actions), target: this.options.target, ...context }, remapped)
      const stableReceivers = candidate.semanticBindings.every((binding, i) => {
        const previous = authorized.semanticBindings[i]
        return binding.resolved && previous?.resolved && (binding.elementId !== null
          ? binding.target === previous.target && binding.stateDigest === previous.stateDigest && stableJson(binding.bounds) === stableJson(previous.bounds)
            || byIdentity && Boolean(binding.identityDigest) && binding.identityDigest === previous.identityDigest
          : visualStateEquivalent(binding.visualStateDigest, previous.visualStateDigest) && binding.pointerTarget === previous.pointerTarget)
      })
      // A new modal/obstruction or browser-document identity invalidates the reuse.
      const contextState = (elements: LiveComputerElement[]) => stableJson(elements.filter(e => e.obstructed || e.role === 'AXWebArea' || e.role === 'AXDialog' || e.role === 'AXSheet' || e.subrole === 'AXDialog').map(e => ({ fingerprint: e.fingerprint, name: e.name, value: e.value, bounds: e.bounds, obstructed: e.obstructed })))
      const sameContext = stableReceivers && contextState(cache.elements) === contextState(frame.elements)
      if (sameContext && preflightEquivalent(authorized, candidate)) return this.enforceCompactRefAgreement(actions, frame, candidate)
      // The same actions on the same controls, reviewed for this program a
      // moment ago: a second vision review of an edit whose only change is
      // the text it typed returned a different label for the same button
      // (base64: submission, then reversible_local_write, then
      // read_only) and cost 1.5 to 3.4 s. Return the reused review; the loop
      // decides by heldBatchRebindable whether the change still permits the
      // batch, and discards it otherwise.
      // Never for a navigation or a changed payload: an address or search
      // typed into the location bar is judged on its exact text every time.
      const samePayloads = candidate.effects.every((effect, i) => effect.payloadDigest === authorized.effects[i]?.payloadDigest)
        && [...candidate.semanticBindings, ...authorized.semanticBindings].every(binding => binding.role !== 'browser_location' && !binding.browserDestination && !binding.browserSearchQuery)
      if (sameContext && byIdentity && samePayloads && !contentChanged) {
        this.options.onCaptureDiagnostic?.({ stage: 'interpretation_reused_by_identity', actions: actions.length })
        return this.enforceCompactRefAgreement(actions, frame, candidate)
      }
    }
    return this.resolveBatch(actions, signal)
  }

  /** The dialog or sheet whose bounds cover the point, named with its own controls. */
  obstructionAt(point: { x: number; y: number }): { label: string; role: string; controls: UniversalNearbyControl[] } | null {
    const elements = this.lastFrame?.elements ?? []
    const contains = (bounds: NonNullable<LiveComputerElement['bounds']>) => point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height
    const covered = elements.find(element => element.bounds && contains(element.bounds) && element.obstructed && element.pointerObstructions?.length)
    const overlayBounds = covered?.pointerObstructions?.find(contains) ?? null
    const label = (element: LiveComputerElement) => [element.name, element.description].find(value => typeof value === 'string' && value.trim())?.trim() ?? ''
    const overlay = elements.find(element => element.bounds && !element.obstructed && (dialogLike(element) || (overlayBounds !== null && stableJson(element.bounds) === stableJson(overlayBounds)))
      && (overlayBounds ? stableJson(element.bounds) === stableJson(overlayBounds) || (contains(element.bounds) && element.bounds.width * element.bounds.height <= overlayBounds.width * overlayBounds.height * 1.5) : contains(element.bounds)))
    if (!overlay?.bounds) return null
    return { label: label(overlay) || 'dialog', role: describeRole(overlay), controls: this.controlsWithin(overlay) }
  }

  /** Up to six named, usable controls inside an overlay, one per role and label. */
  private controlsWithin(overlay: LiveComputerElement): UniversalNearbyControl[] {
    const within = overlay.bounds
    if (!within) return []
    const label = (element: LiveComputerElement) => [element.name, element.description].find(value => typeof value === 'string' && value.trim())?.trim() ?? ''
    const seen = new Set<string>()
    return (this.lastFrame?.elements ?? [])
      .filter(element => element !== overlay && element.bounds && !element.sensitive && !element.obstructed && element.enabled !== false && label(element) && clickEffectResolvable(element)
        && element.bounds.x >= within.x - 1 && element.bounds.y >= within.y - 1 && element.bounds.x + element.bounds.width <= within.x + within.width + 1 && element.bounds.y + element.bounds.height <= within.y + within.height + 1)
      .filter(element => { const key = `${element.role}:${label(element)}`; if (seen.has(key)) return false; seen.add(key); return true })
      .slice(0, 6)
      .map(element => ({ label: label(element), role: describeRole(element), bounds: { ...element.bounds! } }))
  }

  /**
   * A pop-up drawn over a full-page backdrop that the platform does not mark
   * as a dialog (a clothing retailer's sign-up pop-up): the
   * element in front covers most of the window. Names the frame's dismiss
   * controls so the next decision clears it instead of retrying the click.
   * Null when the element in front is not window-sized.
   */
  /** `page`, when given, keeps only controls inside the page: the browser's own tab strip carries a "Close" that
   * dismisses nothing on the page and must never be offered as the way past a pop-up. */
  private backdropDismissals(front: { x: number; y: number; width: number; height: number } | null, page: { x: number; y: number; width: number; height: number } | null = null): string[] | null {
    const frame = this.lastFrame
    if (!front || !frame) return null
    const area = (frame.contentBounds?.width ?? frame.width) * (frame.contentBounds?.height ?? frame.height)
    if (!area || front.width * front.height < 0.8 * area) return null
    const seen = new Set<string>()
    const inPage = (bounds: { x: number; y: number; width: number; height: number }) => !page
      || (bounds.x >= page.x && bounds.y >= page.y && bounds.x + bounds.width <= page.x + page.width && bounds.y + bounds.height <= page.y + page.height)
    return frame.elements
      .filter(element => element.bounds && inPage(element.bounds) && !element.sensitive && element.enabled !== false && (element.name ?? '').trim()
        && ['close', 'reject'].includes(classifyObstructionControl(element.name ?? '')))
      .map(element => element.name!.trim().slice(0, 40))
      .filter(label => { const key = label.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true })
      .slice(0, 4)
  }

  /**
   * The dialog or banner over a point that the target does not belong to, by
   * the platform's own subtree membership: a cookie notice laid over a store
   * dialog's Confirm (a grocery site at a laptop window size). The click
   * was rightly withheld three times, but the refusal said only that the page
   * was in front, so the same click was retried. Its controls are listed
   * dismissals and rejections first; acceptance is never suggested.
   */
  private coveringDialog(point: { x: number; y: number }, target: LiveComputerElement): { label: string; controls: string[] } | null {
    const obstruction = obstructionCovering(this.lastFrame, point, target)
    if (!obstruction) return null
    const controls = obstructionControls(this.lastFrame?.elements ?? [], obstruction)
      .filter(control => control.kind !== 'accept' && (control.element.name ?? '').trim())
      .slice(0, 5).map(control => control.element.name!.trim().slice(0, 40))
    return { label: obstruction.name.trim() || 'dialog', controls }
  }

  /** What lay under a click refused as ambiguous: geometry, roles and depth, and whether the candidates' texts match,
   * never the texts themselves. A-V1 (1 October) kept refusing an open select's option and the record could not say
   * which elements tied. */
  private recordAmbiguousPoints(actions: ComputerActionProposal[], frame: LiveComputerCapturedFrame, preflight: UniversalComputerBatchPreflight): void {
    for (const [index, binding] of preflight.semanticBindings.entries()) {
      const action = actions[index]
      if (binding.resolutionIssue !== 'ambiguous_control_at_point' || !action || !('point' in action)) continue
      const point = action.point
      const hits = frame.elements.filter(e => e.bounds && e.enabled !== false && point.x >= e.bounds.x && point.y >= e.bounds.y && point.x < e.bounds.x + e.bounds.width && point.y < e.bounds.y + e.bounds.height)
        .sort((a, b) => a.bounds!.width * a.bounds!.height - b.bounds!.width * b.bounds!.height || (b.depth ?? 0) - (a.depth ?? 0)).slice(0, 6)
      const text = (e: LiveComputerElement) => (e.name?.trim() || (typeof e.value === 'string' ? e.value.trim() : '')).toLocaleLowerCase()
      this.options.onCaptureDiagnostic?.({ stage: 'ambiguous_point', actionIndex: index, candidates: hits.map(e => ({
        role: e.role, subrole: e.subrole ?? null, bounds: e.bounds, depth: e.depth ?? null, named: Boolean(e.name?.trim()), valued: typeof e.value === 'string' && e.value.trim().length > 0,
        sameTextAsFirst: hits[0] ? text(e) === text(hits[0]) : null, obstructed: e.obstructed ?? false, sensitive: e.sensitive ?? false, pointerObstructions: e.pointerObstructions ?? [],
      })) })
    }
  }

  preflightBatch(actions: ComputerActionProposal[]): UniversalComputerBatchPreflight {
    return compileUniversalComputerBatchPreflight(actions, this.lastFrame?.elements ?? [], this.options.target, this.options.approvedGoal, this.options.browserResearchScope, this.browserLaunch())
  }

  async cleanup(): Promise<void> {
    this.observationHistory = []
    this.initialDocumentText = null
    this.initialDocumentRead = false
    this.observedFieldLabels.clear()
    this.observedFieldValues.clear()
    this.observedTexts.clear()
    this.observedTextsBySource.clear()
    this.interpretationCache = null
    await this.options.backend.cleanupFrames?.(this.options.sessionId)
  }

  async settle(request: UniversalComputerUseSettleRequest, signal: AbortSignal): Promise<UniversalComputerUseSettleResult> {
    const startedAt = Date.now()
    const pollMs = boundedTiming(this.options.settlePollMs ?? this.options.settleMs ?? 200, 1, 1_000)
    const maximumMs = boundedTiming(this.options.settleMaxMs ?? 3_000, pollMs, 10_000)
    // Scrolling and focus moves settle in one unchanged probe; writes keep the stricter default.
    const stableTarget = boundedTiming(request.harmless && request.reason === 'post_input' ? Math.min(this.options.settleStableFrames ?? 2, overheadPolicyFor().harmlessSettleStableFrames) : this.options.settleStableFrames ?? 2, 1, 10)
    let previous: Pick<ComputerActionScreenshot, 'sha256' | 'visualSample' | 'width' | 'height'> | null = this.lastFrame
      ? {
          width: this.lastFrame.width, height: this.lastFrame.height,
          sha256: this.lastFrame.sha256,
          visualSample: this.lastFrame.visualSample,
        }
      : null
    let latest: { frame: LiveComputerCapturedFrame; screenshot: ComputerActionScreenshot } | null = null
    let stableFrames = 0
    let latestFull = false
    let probing = process.env.STEWARD_COMPACT_SETTLE_PROBES === '1' && Boolean(this.options.backend.probe) && (!this.options.ownedWindowGroup || this.lastFrame?.capturedWindows?.length === 1 && this.lastFrame.inputViewport?.x === 0 && this.lastFrame.inputViewport.y === 0)
    let probes = 0
    while (Date.now() - startedAt < maximumMs && stableFrames < stableTarget) {
      await delay(pollMs, undefined, { signal })
      // Settle probes compare pixels only; the final observation (captured by
      // the loop after settling) carries the control digest.
      if (probing) {
        let sample = null
        try { sample = await this.options.backend.probe!(this.options.target, signal) }
        catch { signal.throwIfAborted() }
        if (sample) {
          probes += 1
          const unchanged = previous?.width === sample.width && previous.height === sample.height
            && compareVisibleState(null, previous.visualSample, sample) === 'unchanged'
          stableFrames = unchanged ? stableFrames + 1 : 0
          previous = sample
          continue
        }
        probing = false
        stableFrames = 0
      }
      // The probe that would complete the stable run is taken as a full capture (controls included): when it is
      // unchanged it is the settled observation, so no separate closing capture is needed. In one run every
      // post-input settle on a page that was already still cost 3 pixel probes plus 1 full capture (~1.6–2 s).
      // STEWARD_SETTLE_CONFIRM_FULL=off restores the separate closing capture.
      const confirming = process.env.STEWARD_SETTLE_CONFIRM_FULL?.trim() !== 'off' && stableFrames === stableTarget - 1
      latest = await this.captureFrame(signal, confirming ? {} : { elements: false })
      latestFull = confirming
      probes += 1
      const change = previous
        ? compareVisibleState(previous.sha256, previous.visualSample, latest.screenshot)
        : 'unknown'
      stableFrames = change === 'unchanged' ? stableFrames + 1 : 0
      previous = latest.screenshot
    }
    // The observation the model and the next preflight see must carry the control digest of the settled screen, so
    // a full capture closes the settle unless the confirming probe already was one.
    if (latest && latestFull && stableFrames >= stableTarget) this.options.onCapture?.(latest.frame)
    else if (latest || probing) {
      latest = await this.captureFrame(signal)
      this.options.onCapture?.(latest.frame)
      if (probing && (previous?.width !== latest.frame.width || previous.height !== latest.frame.height
        || compareVisibleState(null, previous.visualSample, latest.screenshot) !== 'unchanged')) stableFrames = 0
    }
    const stabilized = stableFrames >= stableTarget
    return {
      observation: latest?.screenshot ?? null,
      durationMs: Math.max(0, Date.now() - startedAt),
      probes,
      stabilized,
      timedOut: !stabilized,
    }
  }

  private toLiveAction(
    action: Exclude<ComputerActionProposal, { kind: 'wait' | 'screenshot' }>,
    grounding?: UniversalComputerActionGrounding,
  ): LiveComputerAction {
    const base: LiveComputerAction = {
      id: id('universal_action'),
      kind: 'move',
      objectiveId: 'universal',
      route: 'provider_owned_loop',
      surface: 'unknown',
      operation: 'navigate',
      resourcePhase: 'unknown',
      replanReason: null,
      summary: 'Execute the next Universal computer action',
      targetLabel: grounding?.label ?? null,
      expectedState: 'The selected window reflects the requested input',
      completesObjective: false,
      point: null,
      submitPoint: null,
      endPoint: null,
      elementAction: null,
      scrollY: null,
      scrollX: null,
      text: null,
      textProvenance: null,
      conclusion: null,
      artifact: null,
      artifactId: null,
      textDelivery: null,
      key: null,
      replaceExisting: false,
      confidence: 1,
      risk: 'safe',
      requiresConfirmation: false,
      proposalSource: 'openai_computer',
      groundingSource: 'provider_visual',
      proposalFrameId: this.lastFrame?.id ?? null,
      proposalFrameSha256: this.lastFrame?.sha256 ?? null,
      // Controller-resolved from the batch preflight binding, so the shared
      // input path shows and holds on the same control the frame brackets.
      targetBounds: grounding?.elementId ? this.elementBounds(grounding.elementId) : grounding?.bounds ?? null,
    }

    switch (action.kind) {
      case 'click':
      case 'double_click':
        return {
          ...base,
          kind: 'click',
          point: action.point,
          mouseButton: action.button,
          modifiers: action.modifiers,
          clickCount: action.kind === 'double_click' ? 2 : 1,
        }
      case 'move':
        return { ...base, kind: 'move', point: action.point, modifiers: action.modifiers }
      case 'scroll':
        return {
          ...base,
          kind: 'scroll',
          point: action.point,
          scrollX: action.deltaX,
          scrollY: action.deltaY,
          modifiers: action.modifiers,
        }
      case 'type':
        return { ...base, kind: 'type', text: action.text, textDelivery: 'unicode_graphemes' }
      case 'keypress':
        return { ...base, kind: 'keypress', key: action.keys.join('+') }
      case 'drag':
        return {
          ...base,
          kind: 'drag',
          point: action.path[0]!,
          endPoint: action.path.at(-1)!,
          modifiers: action.modifiers,
        }
    }
  }
}

/** Which grouped field replacement the compact executor sends natively.
 * `STEWARD_COMPACT_NATIVE_TRANSACTIONS` ('0', '1' select+type, '2' click+select+type)
 * wins when set. Otherwise a whole fill is one transaction (mode '2', measured
 * 13–16% faster with no false completions) unless
 * `STEWARD_FILL_TRANSACTION=off`, which restores three separate inputs. */
export function nativeTransactionMode(env: NodeJS.ProcessEnv = process.env): '0' | '1' | '2' {
  const explicit = env.STEWARD_COMPACT_NATIVE_TRANSACTIONS?.trim()
  if (explicit === '1' || explicit === '2') return explicit
  if (explicit) return '0'
  return env.STEWARD_FILL_TRANSACTION?.trim().toLowerCase() === 'off' ? '0' : '2'
}

/** `STEWARD_SAME_FIELD_KEYS=off` restores a page capture before every key of a
 * program, including keys into the field the program just typed into. */
export function sameFieldKeysEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_SAME_FIELD_KEYS?.trim().toLowerCase() !== 'off'
}

/** A whole-fill transaction whose click was delivered and whose keys the
 * native guard refused before any of them reached the page: the receiver was
 * not (yet) the bound field. Nothing typed, nothing held. */
export function fillTransactionFallbackEligible(receipt: LiveComputerPhysicalActionReceipt | void): boolean {
  return Boolean(receipt && receipt.pressedInputsReleased === true && receipt.deliveryProgress === 'partial'
    && (receipt.contentDelivery === 'none' || receipt.contentDelivery === undefined)
    && receipt.failure?.mutation === 'none' && ['keyboard_receiver_changed', 'keyboard_receiver_unavailable'].includes(receipt.failure.code))
}

function isSelectAllChord(keys: readonly string[]): boolean {
  const parts = keys.flatMap(key => key.split('+')).map(key => key.trim().toUpperCase())
  return parts.length === 2 && ['META', 'CMD', 'COMMAND', 'CTRL', 'CONTROL'].includes(parts[0]!) && parts[1] === 'A'
}

/** `STEWARD_INTERPRETATION_IDENTITY_CACHE=off` restores pixel-and-state keyed
 * revalidation: a held batch whose field changed value re-runs the vision review. */
export function identityCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_INTERPRETATION_IDENTITY_CACHE?.trim().toLowerCase() !== 'off'
}

/** The one element of `now` with the identity `old` had in `before`, when that
 * identity was unique there and is unique here; otherwise undefined. */
export function sameIdentityElement(old: LiveComputerElement, before: readonly LiveComputerElement[], now: readonly LiveComputerElement[]): LiveComputerElement | undefined {
  const digest = receiverIdentityDigest(old, before)
  if (!digest || before.filter(e => e.role === old.role && e.name === old.name && receiverIdentityDigest(e, before) === digest).length !== 1) return undefined
  const found = now.filter(e => e.role === old.role && e.name === old.name && receiverIdentityDigest(e, now) === digest)
  return found.length === 1 ? found[0] : undefined
}

function boundedTiming(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

/** Months, weekdays, numeric dates and the date words people use ("next
 * weekend", "Christmas", "check-in"). Only decides whether to favour a picker's
 * month navigation, never what the dates are. */
function goalMentionsDate(goal: string): boolean {
  return /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:january|february|march|april|june|july|august|september|october|november|december)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:weekend|tonight|tomorrow|next week|this week|christmas|new year'?s?|thanksgiving|easter|valentine'?s|check[- ]?in|check[- ]?out|dates?)\b/iu.test(goal)
}

const goalStopWords = new Set(['next', 'out', 'can', 'could', 'would', 'should', 'will', 'want', 'like', 'need', "i'm", 'im', "i've", "i'd", "i'll", 'really', 'just', 'also', 'very', 'maybe', 'think', 'thinking', 'anything', 'something', 'everything', 'some', 'any', 'take', 'look', 'give', 'let', 'help', 'going', 'able', 'the', 'and', 'for', 'from', 'with', 'this', 'that', 'then', 'tell', 'find', 'open', 'read', 'name', 'what', 'which', 'page', 'section', 'article', 'use', 'into', 'about', 'under', 'one', 'its', 'are', 'was', 'were', 'there', 'here', 'please', 'report', 'list', 'listed', 'me', 'my', 'you', 'your', 'her', 'him', 'his', 'their', 'them', 'not', 'without', 'only', 'after', 'before', 'when', 'where', 'how', 'many', 'much', 'does', 'did', 'do', 'is', 'it', 'in', 'on', 'of', 'to', 'a', 'an', 'as', 'at', 'by', 'or', 'be', 'so', 'if', 'go', 'get', 'show', 'click', 'select', 'choose', 'window', 'current', 'currently', 'visible', 'text', 'value', 'values'])

/** Words from the approved goal a page control might be labeled with. The
 * helper cannot return every element of a large page; these lift the ones
 * the task names ("1890s", "billing", "enumerate") into the digest. Quoted
 * phrases are kept whole as well as split. */
/** A platform role as a short human phrase: `AXTextField` becomes `text field`. */
export function describeRole(element: LiveComputerElement): string {
  return element.role.replace(/^AX/u, '').replaceAll(/([a-z])([A-Z])/gu, '$1 $2').toLocaleLowerCase()
}

/** Reserved helper term: matches visible currency amounts ("$79.50", "€12"), not a word. */
export const priceTerm = '#price'

export function goalPreferenceTerms(goal: string): string[] {
  const terms = new Set<string>()
  // A goal with a date needs the date picker's month navigation, and pickers
  // name it by month ("Next month", "Move forward to switch to the October
  // 2026 month"). In one run a lodging-site calendar opened on September for
  // a December stay; its arrows were outside the 200-element budget, so the
  // actor could see the days but never reach December. First, so the term
  // limit below can never drop it.
  // Words the person ruled out are not controls to favour: "don't book
  // anything" must not lift every Book button above the task's own controls.
  const affirmed = goal.toLowerCase().replace(/\b(?:don['’]?t|do not|never|without|no)\b[^.;:!?\n]*/gu, ' ')
  if (goalMentionsDate(affirmed)) terms.add('month')
  // A goal about price needs the prices. A product grid gives every card a
  // few links (item, favourite, reviews) that outrank its plain price text, so
  // on a clothing retailer's listing the capture kept product names and
  // ratings but dropped prices, and the actor could not tie a price to half the
  // styles it saw. The helper reads this reserved term as "a currency amount".
  if (/\b(?:price[sd]?|pricing|costs?|costing|how much|cheap(?:er|est)?|expensive|afford(?:able)?|budget|fees?|dollars?)\b|\$\s?\d/u.test(affirmed)) terms.add(priceTerm)
  for (const match of goal.matchAll(/["“]([^"”]{3,40})["”]/gu)) if (match[1]) terms.add(match[1].trim().toLowerCase())
  for (const word of affirmed.split(/[^a-z0-9']+/u)) {
    const cleaned = word.replace(/^'+|'+$/gu, '').replace(/'s$/u, '')
    if (cleaned.length >= 3 && cleaned.length <= 40 && !goalStopWords.has(cleaned)) terms.add(cleaned)
  }
  return [...terms].slice(0, 24)
}

/** Content identity of a control digest: what is on screen, not where the
 * pointer is. Hover, focus rings and geometry jitter leave it unchanged;
 * a switched tab, revealed panel or new row changes it. Sensitive values
 * never enter the hash. */
export function elementDigest(elements: readonly LiveComputerElement[]): string {
  return sha256(elements.map((element) => [element.role, element.name ?? '', element.sensitive ? '' : element.value ?? ''].join('')).join('\n'))
}

/** Geometry/readiness for compact input revalidation. Field values and focus
 * change during an ordinary fill without moving anything. Conversely a layout
 * can move while every label stays the same. Keep this separate from the
 * content digest used to recognise progress and completion. */
export function compactLayoutDigest(frame: LiveComputerCapturedFrame): string {
  return sha256(stableJson({ width: frame.width, height: frame.height, viewport: frame.inputViewport ?? null,
    elements: frame.elements.map(element => ({ role: element.role, name: element.sensitive ? '' : element.name,
      identifier: element.identifier ?? null, bounds: element.bounds, enabled: element.enabled ?? null,
      obstructed: element.obstructed ?? false, sensitive: element.sensitive, expanded: element.expanded ?? null })) }))
}

/** Why a compact input may skip the wait for a still layout, or null when it
 * must wait: keys carry no coordinates, and a pointer target found again at
 * exactly its decision bounds has not moved. A raw-coordinate pointer input
 * (no bound target) always waits. */
export function steadyInputReason(action: ComputerActionProposal, decisionTarget: LiveComputerElement | null, elements: readonly LiveComputerElement[]): 'keyboard' | 'target_unmoved' | null {
  // A key still needs its receiver: when the decision's field is not found
  // in the moving layout, wait for it to settle before looking again.
  if (action.kind === 'type' || action.kind === 'keypress') return !decisionTarget || resolveInputTarget(elementIdentityForInput(decisionTarget), [...elements]).element ? 'keyboard' : null
  if (!('point' in action) || !decisionTarget?.bounds) return null
  const now = resolveInputTarget(elementIdentityForInput(decisionTarget), [...elements]).element
  const before = decisionTarget.bounds
  return now?.bounds && !now.obstructed && (['x', 'y', 'width', 'height'] as const).every(k => Math.abs(now.bounds![k] - before[k]) <= 1) ? 'target_unmoved' : null
}

/** The focused, non-sensitive text field overlapping a bound field that the
 * page replaced when it took focus, right after this program clicked it. */
export function focusedReplacementField(expected: LiveComputerElement, elements: readonly LiveComputerElement[], lastInput: { kind: string; point?: { x: number; y: number }; delivery?: string } | undefined): LiveComputerElement | undefined {
  if (!expected.bounds || lastInput?.kind !== 'click' || lastInput.delivery === 'uncertain' || !lastInput.point || !isEditable(expected)) return undefined
  const b = expected.bounds
  // The click that focused it landed inside the field that was replaced.
  if (lastInput.point.x < b.x - 2 || lastInput.point.x > b.x + b.width + 2 || lastInput.point.y < b.y - 2 || lastInput.point.y > b.y + b.height + 2) return undefined
  const overlaps = (e: LiveComputerElement) => Boolean(e.bounds && e.bounds.x < b.x + b.width && e.bounds.x + e.bounds.width > b.x && e.bounds.y < b.y + b.height && e.bounds.y + e.bounds.height > b.y)
  const candidates = elements.filter(e => e.focused === true && !e.sensitive && e.enabled !== false && !e.obstructed && liveComputerElementSupportsTextEntry(e) && overlaps(e))
  return candidates.length === 1 ? candidates[0] : undefined
}

function normalizeKeyChord(keys: string[], platform: NodeJS.Platform): string[] {
  const normalized = keys.map((key) => {
    const normalized = key.trim().toUpperCase()
    if (normalized === 'SUPER' && platform === 'darwin') return 'CMD'
    if (normalized === 'META' || normalized === 'COMMAND') return 'CMD'
    if (normalized === 'CONTROL') return 'CTRL'
    if (normalized === 'OPTION') return 'ALT'
    return normalized
  })
  return normalized
}

/** The two keys that persist work, recorded as a category in the ledger; every other key stays unrecorded. */
function isSaveChordProposal(action: ComputerActionProposal): boolean {
  return action.kind === 'keypress' && persistenceChord(action.keys) === 'save'
}

function persistenceChord(keys: readonly string[]): 'save' | 'enter' | null {
  const normalized = keys.map(key => key.trim().toUpperCase()).map(key => ['COMMAND', 'CMD', 'SUPER'].includes(key) ? 'META' : key).sort()
  if (normalized.length === 2 && normalized[0] === 'META' && normalized[1] === 'S') return 'save'
  if (normalized.length === 1 && (normalized[0] === 'ENTER' || normalized[0] === 'RETURN')) return 'enter'
  return null
}

/** The file is current when it equals the complete screen text, or when the screen's 500-character prefix opens it. */
function fileAgreesWithScreen(file: string, text: string, complete: boolean): boolean {
  const normalizedFile = normalizeDocumentText(file), normalizedText = normalizeDocumentText(text)
  if (complete || normalizedFile === normalizedText) return normalizedFile === normalizedText
  const lastBreak = normalizedText.lastIndexOf('\n')
  const head = lastBreak > 0 ? normalizedText.slice(0, lastBreak) : normalizedText.slice(0, Math.max(0, normalizedText.length - 20))
  return head.length > 0 && normalizedFile.startsWith(head)
}

const normalizeDocumentText = (text: string): string => text.normalize('NFKC').replace(/\r\n?/gu, '\n').split('\n').map(line => line.replace(/[ \t\u00a0]+$/u, '')).join('\n').trim()

/** The document a frame shows: the largest complete editable text when there
 * is one (a TextEdit or Pages body, a web editor), otherwise every text the
 * window exposes joined by lines (a spreadsheet's cells), marked incomplete. */
export function documentTextOf(frame: LiveComputerCapturedFrame): { text: string; complete: boolean } | null {
  const editors = frame.elements.filter(e => !e.sensitive && typeof e.value === 'string' && e.value.trim().length > 0 && (e.editable || /text(?:area|field)/iu.test(e.role)))
    .sort((a, b) => (b.value?.length ?? 0) - (a.value?.length ?? 0))
  const primary = editors[0]
  if (primary && primary.value && (primary.value.includes('\n') || editors.length === 1)) return { text: primary.value, complete: primary.valueComplete === true }
  const texts = frame.elements.filter(e => !e.sensitive).flatMap(e => [e.name, e.value].filter((v): v is string => typeof v === 'string' && v.trim().length > 0))
  return texts.length ? { text: texts.join('\n'), complete: false } : null
}

/** One rectangle inside the other (1 px tolerance): a control and its own label, icon or wrapper. */
function boundsNested(a: LiveComputerElement['bounds'], b: LiveComputerElement['bounds']): boolean {
  if (!a || !b) return false
  const inside = (inner: NonNullable<LiveComputerElement['bounds']>, outer: NonNullable<LiveComputerElement['bounds']>) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
    && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1
  return inside(a, b) || inside(b, a)
}

/** A modal or non-modal dialog as platforms and browsers expose it (Chrome: AXGroup with subrole AXApplicationDialog). */
function dialogLike(element: LiveComputerElement): boolean {
  return element.role === 'AXDialog' || element.role === 'AXSheet' || /dialog|alert/iu.test(element.subrole ?? '')
}

/** The identity the native guard checks before each keystroke chunk. With the
 * AX ladder on it also carries the capture path, so a combobox whose option
 * holds platform focus as its aria-activedescendant is still recognised as
 * the receiver through its own AXOwns link (native keyboardReceiverMatches). */
function receiverIdentity(element: LiveComputerElement): ReturnType<typeof elementIdentityForInput> {
  return (compactAxLadderEnabled() ? elementIdentityForAxDelivery(element) : null) ?? elementIdentityForInput(element)
}

type HitBounds = { x: number; y: number; width: number; height: number }
/** The hit answered with the editor's own painted layer, not something in
 * front of it: an unnamed group that shares a small, non-dialog parent with a
 * text-entry target (see the `hit_test_editor_surface` exemption). Buttons,
 * links and selects never qualify, so a styled group over a "Sort by" control
 * stays an obstruction. `STEWARD_EDITOR_SURFACE_HIT=off` removes the exemption. */
export function editorOwnSurface(target: LiveComputerElement, hit: { role: string; name: string; bounds: HitBounds | null },
  shared: { role: string; subrole: string | null; bounds: HitBounds | null; levelsAboveHit: number; levelsAboveTarget: number },
  content: HitBounds | null): boolean {
  if (process.env.STEWARD_EDITOR_SURFACE_HIT?.trim().toLowerCase() === 'off') return false
  if (!target.bounds || !hit.bounds || !shared.bounds) return false
  if (!liveComputerElementSupportsTextEntry(target) || target.sensitive || target.enabled === false || target.obstructed || (target.pointerObstructions?.length ?? 0) > 0) return false
  if (!/^(?:AX)?Group$/u.test(hit.role) || hit.name.trim()) return false
  if (shared.levelsAboveHit > 3 || shared.levelsAboveTarget > 3) return false
  if (/^(?:AX)?(?:WebArea|Window|Application|Sheet)$/u.test(shared.role) || /Dialog/u.test(shared.subrole ?? '')) return false
  const within = (outer: HitBounds, inner: HitBounds) => outer.x - 2 <= inner.x && outer.y - 2 <= inner.y && outer.x + outer.width + 2 >= inner.x + inner.width && outer.y + outer.height + 2 >= inner.y + inner.height
  if (!within(shared.bounds, target.bounds) || !within(shared.bounds, hit.bounds)) return false
  const area = (bounds: HitBounds) => bounds.width * bounds.height
  if (area(shared.bounds) > 1.5 * area(hit.bounds)) return false
  if (content && area(shared.bounds) > 0.6 * area(content)) return false
  return true
}

/** `STEWARD_REF_ENCLOSING_BIND=off` restores the earlier compact-ref rebinding (links and tied buttons). */
export const refEnclosingBindEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_REF_ENCLOSING_BIND?.trim().toLowerCase() !== 'off'
const actionableRefRole = /^(?:AX)?(?:Button|Link|CheckBox|RadioButton|Tab|MenuItem|MenuButton|PopUpButton|DisclosureTriangle|Switch|Toggle|Cell|Row)$/u

/** The smallest labelled, enabled, unobstructed control whose bounds enclose this passive element, not much larger than it. */
export function smallestEnclosingActionable(inner: LiveComputerElement, elements: readonly LiveComputerElement[]): LiveComputerElement | null {
  const b = inner.bounds
  if (!b) return null
  const area = (e: LiveComputerElement) => e.bounds!.width * e.bounds!.height
  const encloses = (outer: NonNullable<LiveComputerElement['bounds']>) => outer.x <= b.x + 1 && outer.y <= b.y + 1 && outer.x + outer.width >= b.x + b.width - 1 && outer.y + outer.height >= b.y + b.height - 1
  const candidates = elements.filter(e => e !== inner && e.id !== inner.id && e.bounds && actionableRefRole.test(e.role) && (e.name ?? '').trim()
    && !e.sensitive && e.enabled !== false && !e.obstructed && !e.pointerObstructions?.length && encloses(e.bounds) && area(e) <= 40 * Math.max(1, b.width * b.height))
    .sort((left, right) => area(left) - area(right))
  const smallest = candidates[0]
  // Two different controls of the same size enclosing it name no single receiver.
  if (!smallest || (candidates[1] && area(candidates[1]) === area(smallest))) return null
  return smallest
}
