import { preparePracticeWindow } from './first-task.js'
import { isUniversalLiveComputerEngine } from '../src/live-computer-engines.js'
import type { BrowserSignInStart, SignInStart } from '../src/cloud/client.js'
import { handOffApprovedAction } from './approval-handoff.js'
import { sharingRecipient } from '../src/ai-sharing.js'
import { applicationHandoffPresentation, applicationHandoffVoicePresentation } from '../src/application-handoff-presentation.js'
import { handoffResumableAfterStop } from '../src/application-handoff.js'
import { guideGeometryInvalidated } from '../src/guide-annotation-lifecycle.js'
import { productExperience } from '../src/product-experience.js'
import { framePresence, type PresenceFrameState } from './window-presence.cjs'
import { firstRunCleared, mayUseBeforeLegalAcceptance } from '../src/legal-consent.js'
import { MacOSCloudCredentialStore } from '../src/cloud/credential-store.js'
import { ApprovalVisibilityAudit } from '../src/interaction-audit.js'
import { carveTagline } from '../src/brand.js'
import { createNativeInputController } from '../src/native-input-controller.js'
import { PersonTurnGate, type PersonTurnProbe, type PersonTurnState } from '../src/person-turn.js'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { resultLinks } from '../src/result-links.js'
import { readVoicePreference, writeVoicePreference } from '../src/voice-preference.js'
import type { VoiceSettings } from '../src/voice-settings.js'
import { CapsuleVoice } from '../src/capsule-voice.js'
import { CapsuleSilenceTracker, capsuleVisibleState } from '../src/capsule-silence.js'
import { basename, dirname, join, resolve } from 'node:path'
import {
  app as electronApp,
  BrowserWindow,
  autoUpdater,
  powerMonitor,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { CarveApp, type NativeCaptureEvent } from '../src/app.js'
import { capsuleDecision, matchesCapsuleDecision, computerSupervisionStatus } from '../src/live-computer-supervision.js'
import { receiptHtml } from '../src/receipt.js'
import { loadLocalEnv } from '../src/env.js'
import { applyReleaseCloudUrl } from '../src/cloud/release-config.js'
import { nativeComponentPath } from '../src/native-component-paths.js'
import { dispatchCarveCommand, validateCarveCommand } from '../src/desktop-dispatch.js'
import type { DesktopStatus, CarveCommand } from '../src/desktop-contract.js'
import { MacOSCaptureClient } from '../src/native-capture.js'
import { MacOSDesktopComputerBackend } from '../src/tools/desktop-computer.js'
import { MacOSLiveComputerBackend, type LiveComputerInputController } from '../src/live-computer.js'
import { freshSurfaceSuggestion } from '../src/fresh-surface.js'
import { isBrowserBundleIdentifier } from '../src/computer-use/effects.js'
import {
  buildLiveComputerAssistancePresentation,
  buildLiveComputerLaunchPresentation,
  buildLiveComputerOverlayPresentation,
  buildUniversalComputerOverlayPresentation,
  layoutLiveComputerOverlay,
  liveComputerCompactLabel,
  liveComputerCapsuleVisible,
  liveComputerCapsuleNeedsAnswer,
  switchChoiceKeepsCapsuleEnabled,
  liveComputerManualApprovalSurfaceKey,
  liveComputerOverlayBadgeHeight,
  liveComputerOverlayBadgeWidth,
  liveComputerAimHoldMs,
  overlayAction,
  parseLiveComputerOverlayCommand,
  universalComputerShouldSurfaceMain,
  type GuideCapsuleInput,
  type LiveComputerOverlayCue,
  type LiveComputerOverlayInsideDock,
  type LiveComputerOverlayRect,
  type LiveComputerOverlayWindowState,
  capsuleWindowLabel,
  personTurnCopy,
} from '../src/live-computer-overlay.js'
import { MacOSPrivacyReauthentication, verifyPrivacyReauthentication } from '../src/privacy-reauth.js'
import type { LiveComputerAction, LiveComputerTarget, UniversalComputerSession, WorkBudgetPreset } from '../src/types.js'
import { LiveMacCanaryDesktopCoordinator } from '../src/evaluation/live-mac-desktop.js'
import { windowKey, type Attachment, type SurfaceDocument, type SurfaceObservation } from '../src/attachments.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const nativeRequire = createRequire(import.meta.url)
const rendererPath = resolve(moduleDirectory, '../ui/index.html')
const preloadPath = resolve(moduleDirectory, 'preload.cjs')
const observerHudPath = resolve(moduleDirectory, 'observer-hud.html')
const observerHudPreloadPath = resolve(moduleDirectory, 'observer-hud-preload.cjs')
const liveComputerOverlayPath = resolve(moduleDirectory, 'live-computer-overlay.html')
const liveComputerOverlayPreloadPath = resolve(moduleDirectory, 'live-computer-overlay-preload.cjs')
const presenceOverlayPath = resolve(moduleDirectory, 'presence-overlay.html')
const presenceOverlayPreloadPath = resolve(moduleDirectory, 'presence-overlay-preload.cjs')
const stopShortcut = 'CommandOrControl+Shift+.'
/** F3 is the quick "ask about this window" surface. Keep the prior chord as
 * an alternate for keyboards that reserve their function row for media keys. */
const askShortcut = 'F3'
/** F4 pauses active Universal work and focuses its correction field. */
const steeringShortcut = 'F4'
const alternateAskShortcut = process.platform === 'darwin' ? 'Control+Command+A' : 'Control+Alt+A'
/** The Guide summon is two keys: ⌥G, "G for Guide". ⌥Space would read better
 * but the ChatGPT desktop app claims it, and a Carbon hot key registered later
 * silently takes it from the earlier app. If ⌥G cannot be registered, F3 is
 * used. F3 and ⌃⌘A stay registered as alternates either way. A person can put
 * a different chord first with STEWARD_GUIDE_SHORTCUT in Carve's local .env
 * using Electron accelerator syntax; every fallback is recorded in the audit
 * trail. */
const defaultGuideShortcut = 'Alt+G'
const guideShortcutFallbacks = ['F3']
let guideShortcut = defaultGuideShortcut
/** The Do-it summon mirrors the Guide summon: ⌥D, "D for Do it". Pressed while
 * a Guide answer is on screen it takes exactly the handoff the Turn into task
 * chip takes; pressed with nothing on screen it summons the task capsule framed
 * on the frontmost window. Neither path skips an approval: the ordinary
 * supervised Work flow and its hash-bound plan approval still run.
 * STEWARD_DO_IT_SHORTCUT puts a different chord first, in Electron accelerator
 * syntax; every fallback is recorded in the audit trail. */
const defaultDoItShortcut = 'Alt+D'
const doItShortcutFallbacks = ['Control+Command+D', 'F2']
let doItShortcut: string | null = null
let practicePreparationPending = false

function humanAccelerator(accelerator: string): string {
  const mac = process.platform === 'darwin'
  return accelerator
    .split('+')
    .map((part) => {
      switch (part.trim().toLowerCase()) {
        case 'commandorcontrol': case 'cmdorctrl': return mac ? '⌘' : 'Ctrl+'
        case 'command': case 'cmd': case 'super': case 'meta': return mac ? '⌘' : 'Win+'
        case 'control': case 'ctrl': return mac ? '⌃' : 'Ctrl+'
        case 'shift': return mac ? '⇧' : 'Shift+'
        case 'alt': case 'option': return mac ? '⌥' : 'Alt+'
        case 'space': return 'Space'
        default: return part.trim().length === 1 ? part.trim().toUpperCase() : part.trim()
      }
    })
    .join('')
    .replace(/\+$/u, '')
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let controlPlane: CarveApp | null = null
let isQuitting = false
let closed = false
let captureIndicatorLit = false
let captureIndicatorTimer: NodeJS.Timeout | null = null
let observerHud: BrowserWindow | null = null
let liveComputerOverlay: BrowserWindow | null = null
let liveComputerOverlayReady = false
let liveComputerOverlayPresentationSequence = 0
const approvalVisibilityAudit = new ApprovalVisibilityAudit(details => {
  controlPlane?.audit.append('computer.approval_visibility', 'system', String(details.sessionId), details)
})
let liveComputerOverlayDetached = false
let liveComputerOverlayPendingPresentation: { id: number; sessionId: string; target: LiveComputerTarget; detached?: boolean; working?: boolean; needsAnswer?: boolean; approval: { sessionId: string; runId: string; planHash: string } | null } | null = null
let liveComputerCapsulePresentedSessionId: string | null = null
/** The terminal result the desktop last pushed to the person's surface; the
 * request-to-answer latency report ends its clock at that audit mark. */
let liveComputerResultPresentedSessionId: string | null = null
const capsuleSilence = new CapsuleSilenceTracker()
let liveComputerCapsuleTransitionSessionId: string | null = null
let liveComputerDecisionInFlight: string | null = null
let liveComputerOverlayTimer: NodeJS.Timeout | null = null
let liveComputerOverlayCue: LiveComputerOverlayCue | null = null
let liveComputerOverlayCueSequence = 0
let liveComputerOverlaySessionId: string | null = null
let liveComputerOverlayDismissedTerminalSessionId: string | null = null
let liveComputerOverlaySurfacedTerminalSessionId: string | null = null
let liveComputerOverlayApprovalSurfaceKey: string | null = null
let liveComputerOverlayEngaged = false
/** Hover intent: the capsule takes the mouse the instant the pointer reaches
 * it (so Stop is always clickable), but it only grows from the Line to the
 * Card once the pointer has rested on it, and it lingers as the Card briefly
 * after the pointer leaves so a small overshoot does not snap it shut. */
/** 20 September: 120 ms let the Line grow into the Card under a pointer on its
 * way to the × — the Close control then moved to the top of the Card and the
 * click fell on the follow-up row. A pointer resting on a control never
 * expands (see `liveComputerOverlayPointerOnControl`), and crossing is slower. */
const liveComputerOverlayExpandDelayMs = 240
const liveComputerOverlayCollapseLingerMs = 400
let liveComputerOverlayEngagedAt = 0
let liveComputerOverlayReleasedAt = 0
/** The page reports the pointer resting on one of the capsule's buttons: aiming, not reading. */
let liveComputerOverlayPointerOnControl = false
/** The tier last rendered. A pointer resting on a control freezes it: the
 * control must not move under a click, whether by growing into the Card or by
 * the Card settling to the Line (26 September: Continue missed its click when
 * the Card collapsed under the cursor). */
let liveComputerOverlayRenderedTier: 'dot' | 'line' | 'card' | null = null
let liveComputerOverlayBadgeBounds: LiveComputerOverlayRect | null = null
let liveComputerDrawingCapture: { sceneId: string; revision: number; expiresAt: number } | null = null
let liveComputerOverlayDockSessionId: string | null = null
let liveComputerOverlayMinimized = false
let liveComputerOverlayMinimizeAvailable = false
let liveComputerOverlayInsideDock: LiveComputerOverlayInsideDock = 'inside-bottom-right'
let liveComputerCapsulePosition: { x: number; y: number } | null = null
let liveComputerCapsulePositionTarget: string | null = null
let liveComputerCapsuleDrag: { previous: { x: number; y: number } | null; sessionId: string } | null = null
let liveComputerCapsulePositionContext: { sessionId: string; bounds: LiveComputerOverlayRect; attached: boolean } | null = null

/** A Start gesture exists before Assured has published its first captured
 * session. Track that narrow handoff in the desktop shell so a foregrounded
 * work window gets an immediate, truthful status capsule instead of a blank
 * interval. Fresh targets are resolved from the controller's run-scoped
 * window registry as soon as the helper materializes them. */
let liveComputerStopRevision = 0
/** The native Escape count when the current live work began; null while
 * nothing stoppable runs or the monitor is unavailable. */
let liveComputerEscapeBaseline: number | null = null
let liveComputerPendingStart: {
  requestId: string
  runId: string
  startedAt: string
  target: LiveComputerTarget | null
  expectedBundleIdentifiers: string[]
} | null = null
/** Hotkey Guide capsule: the explicitly summoned window and its bounds,
 * present only while no live session owns the overlay. Guide answers and
 * points; it never sends input. `requestSequence` lets a late answer for a
 * superseded question be dropped instead of shown. */
interface LiveComputerAskState {
  target: LiveComputerTarget
  bounds: LiveComputerOverlayRect
  /** Which summon opened the capsule: the Guide hotkey shows the question
   * field and its answer, the Do-it hotkey shows the task field that starts
   * supervised Work bound to this window. */
  intent: 'guide' | 'work'
  guide: GuideCapsuleInput
  question: string | null
  workPending?: boolean
  requestSequence: number
}
let liveComputerAskMode: LiveComputerAskState | null = null
let liveComputerAskFocusPending = false
/** Capsule state of every attachment that is not current, keyed by
 * attachment id, so returning to a window finds its capsule as it was. */
const attachmentCapsules = new Map<string, LiveComputerAskState>()
let currentAttachmentId: string | null = null
/** The last batch surface probe, one per tick, shared by the capsule and the presence overlays. */
let lastSurfaceProbe: SurfaceProbe | null = null
/** Window title per attached window, the cheap signal that a tab switched or a page navigated. */
const surfaceTitles = new Map<string, string | null>()
/** Decorative frames for attachments the capsule is not framing, one window per display. */
const presenceOverlays = new Map<number, { window: BrowserWindow; ready: boolean }>()
/** The attachment whose window the capsule overlay is currently framing. */
let capsuleFrameAttachmentId: string | null = null
let liveComputerSteeringFocusPending = false
/** The capsule's active streaming dictation, one at a time. */
let liveComputerOverlayDictationId: string | null = null
/** The desktop renderer cannot discover a follow-up started from the floating
 * capsule by polling only states it already knows are active. Publish each
 * canonical live-session revision so the main app and capsule converge on the
 * same run immediately. */
let liveComputerStateBroadcastKey: string | null = null
let liveInputBridge: NativeLiveInputBridge | null = null
let privacyReauthentication: MacOSPrivacyReauthentication | null = null
let liveMacCanaryCoordinator: LiveMacCanaryDesktopCoordinator | null = null

electronApp.setName('Carve')
// Test and diagnostic launches need an isolated Chromium/Electron profile as
// well as an isolated Carve database. requestSingleInstanceLock is scoped by
// userData; changing only STEWARD_DATA_DIR would still collide with a person's
// already-running app.
if (process.env.STEWARD_USER_DATA_DIR) electronApp.setPath('userData', resolve(process.env.STEWARD_USER_DATA_DIR))
const singleInstance = electronApp.requestSingleInstanceLock()
if (!singleInstance) electronApp.quit()

electronApp.on('second-instance', () => showMainWindow())

// `carve://billing/...` brings the app forward after Stripe Checkout and
// refreshes the plan. Registration is skipped for unpackaged builds so a
// development binary never claims the scheme system-wide.
if (electronApp.isPackaged) electronApp.setAsDefaultProtocolClient('carve')
electronApp.on('open-url', (event, url) => {
  event.preventDefault()
  if (!url.startsWith('carve://')) return
  if (url.startsWith('carve://billing') && controlPlane) void controlPlane.cloudRefresh().catch(() => undefined)
  showMainWindow()
})

let capsuleVoice: CapsuleVoice | null = null
let previewVoice: CapsuleVoice | null = null
let voiceSaveError: string | undefined
function voiceSettings(): VoiceSettings {
  return { version: 1, available: capsuleVoice?.available ?? false, enabled: capsuleVoice?.enabled ?? false, voiceId: capsuleVoice?.voiceId ?? 'thalia', saveError: voiceSaveError }
}
function saveVoiceSettings(): void {
  voiceSaveError = undefined
  const { version, enabled, voiceId } = voiceSettings()
  try { writeVoicePreference(join(electronApp.getPath('userData'), 'voice-preference.json'), { version, enabled, voiceId }) }
  catch { voiceSaveError = 'Voice changed for this session, but the preference could not be saved.' }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steward:voice-settings', voiceSettings())
  syncLiveComputerOverlay()
}

let presentedResultLinks: { sessionId: string; urls: string[] } | null = null

void electronApp.whenReady().then(async () => {
  if (process.platform === 'darwin') electronApp.dock?.setIcon(join(moduleDirectory, 'brand/app-icon.png'))
  // Without the lock this process is a duplicate launch that is already
  // quitting. Booting a second control plane here would open the same SQLite
  // database and pause the real instance's active session, and its will-quit
  // handler would then global-stop it.
  if (!singleInstance) return
  preserveMacOSDockPresence()
  // The data directory is resolved from the real environment *before* .env is
  // read. A STEWARD_DATA_DIR left in a checked-out .env would otherwise
  // silently repoint an installed app at ./data, and a user whose history
  // stopped appearing would have no way to tell why.
  const dataDir = process.env.STEWARD_DATA_DIR ?? join(electronApp.getPath('userData'), 'data')
  // Prefer a stable per-user configuration path so launching from Finder does
  // not depend on an arbitrary working directory. Local development bundles
  // in release/ also keep honouring the source tree's existing .env without
  // copying a secret into the signed application archive.
  if (electronApp.isPackaged) applyReleaseCloudUrl(process.resourcesPath)
  const managedCloud = process.env.CARVE_MANAGED_CLOUD === 'true'
  if (!managedCloud) loadLocalEnv(join(electronApp.getPath('userData'), '.env'))
  const developmentReleaseRoot = resolve(process.resourcesPath, '../../../..')
  if (!managedCloud && electronApp.isPackaged && basename(developmentReleaseRoot) === 'release') {
    loadLocalEnv(resolve(developmentReleaseRoot, '../.env'))
  }
  if (!managedCloud) loadLocalEnv()
  if (electronApp.isPackaged) applyReleaseCloudUrl(process.resourcesPath)
  capsuleVoice = new CapsuleVoice((packet) => {
    if (packet.kind === 'audio') previewVoice?.stop('spoken_reply')
    if (liveComputerOverlayReady && liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
      liveComputerOverlay.webContents.send('steward:live-overlay-voice', packet)
    }
  }, undefined, undefined, event => {
    if (event.event === 'synthesis_started') previewVoice?.stop('spoken_reply')
    controlPlane?.audit.append('capsule.voice', 'system', typeof event.contextId === 'string' ? event.contextId : null, event)
  })
  const preference = readVoicePreference(join(electronApp.getPath('userData'), 'voice-preference.json'))
  capsuleVoice.voiceId = preference.voiceId
  capsuleVoice.setEnabled(preference.enabled)
  previewVoice = new CapsuleVoice(packet => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steward:voice-preview', packet)
  })
  previewVoice.setEnabled(true)

  const packaged = electronApp.isPackaged
  const nativeComponents = {
    captureHelper: nativeComponentPath('captureHelper', { packaged,
      packagedPath: join(process.resourcesPath, 'native', 'steward-capture-helper'),
      developmentPath: resolve(moduleDirectory, '../native/steward-capture-helper') }),
    authenticationHelper: nativeComponentPath('authenticationHelper', { packaged,
      packagedPath: join(process.resourcesPath, 'native', 'steward-authentication-helper'),
      developmentPath: resolve(moduleDirectory, '../native/steward-authentication-helper') }),
    computerHelper: nativeComponentPath('computerHelper', { packaged,
      packagedPath: join(process.resourcesPath, '..', 'Helpers', 'Carve Live Computer.app', 'Contents', 'MacOS', 'Carve Live Computer'),
      developmentPath: resolve(moduleDirectory, '../native/steward-computer-helper') }),
    liveInputBridge: nativeComponentPath('liveInputBridge', { packaged,
      packagedPath: join(process.resourcesPath, 'native', 'steward-live-input-bridge.node'),
      developmentPath: resolve(moduleDirectory, '../native/steward-live-input-bridge.node') }),
  }
  const ignoredNativeOverrides = Object.values(nativeComponents).flatMap(component => component.ignoredOverride ? [component.ignoredOverride] : [])
  if (ignoredNativeOverrides.length) console.warn(`Carve ignored development overrides in a packaged build: ${ignoredNativeOverrides.join(', ')}`)
  const helperPath = nativeComponents.captureHelper.path
  const authenticationHelperPath = nativeComponents.authenticationHelper.path
  const computerHelperPath = nativeComponents.computerHelper.path
  const inputBridgePath = nativeComponents.liveInputBridge.path
  const nativeCapture = new MacOSCaptureClient(helperPath, dataDir)
  const liveInput = loadLiveInputController(inputBridgePath)
  const liveComputer = new MacOSLiveComputerBackend(computerHelperPath, dataDir, liveInput)
  const staleLiveFrameFilesRemoved = await liveComputer.cleanupStaleFrames()
  privacyReauthentication = new MacOSPrivacyReauthentication(authenticationHelperPath)
  await privacyReauthentication.refreshStatus()
  await nativeCapture.refreshStatus()
  await liveComputer.refreshStatus()
  const cloudCredentialStore = new MacOSCloudCredentialStore(electronApp.isPackaged
    ? join(process.resourcesPath, 'native', 'carve-keychain-helper')
    : resolve(moduleDirectory, '../native/carve-keychain-helper'))
  controlPlane = new CarveApp({ experience: productExperience(process.env.CARVE_EXPERIENCE), localAuditDiagnostics: !electronApp.isPackaged || basename(developmentReleaseRoot) === 'release' || process.env.CARVE_LOCAL_BUILD === '1', cloudCredentialStore, dataDir, nativeCapture, researchBrowser: true, desktopComputer: new MacOSDesktopComputerBackend(), liveComputer })
  configureAutoUpdates(controlPlane)
  controlPlane.setPersonTurnGate(personTurnGate)
  controlPlane.onUniversalComputerActionCue(() => syncLiveComputerOverlay())
  controlPlane.dictation.onLiveState((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steward:dictation-state', state)
    if (state.sessionId === liveComputerOverlayDictationId && liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
      liveComputerOverlay.webContents.send('steward:live-overlay-dictation', {
        op: 'state', transcript: state.transcript, interim: state.interim, done: state.done,
      })
    }
  })
  // Screen Recording is granted to a code identity, and the helper is a child
  // process with its own. Recording both answers makes a mismatch between the
  // shell's grant and the helper's grant diagnosable from the audit trail.
  controlPlane.audit.append('desktop.permission_diagnostics', 'system', null, {
    helperScreenRecording: nativeCapture.summary().screenRecording,
    electronScreenRecording: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'not_applicable',
    packaged: electronApp.isPackaged,
    helperPath,
    privacyReauthentication: privacyReauthentication.status(),
    authenticationHelperPath,
    liveComputer: liveComputer.summary(),
    computerHelperPath,
    liveInputBridgePath: inputBridgePath,
    liveInputBridgeLoaded: Boolean(liveInput),
    applicationHandoffEnabled: controlPlane.applicationHandoffEnabled,
    staleLiveFrameFilesRemoved,
    ignoredNativeOverrides,
  })
  createApplicationMenu()
  createMainWindow()
  createTray()
  // The window is hidden during interval observation, so the menu bar is the
  // only place the user can see that a capture just happened.
  controlPlane.onNativeCapture((event) => {
    if (event.outcome === 'captured') flashCaptureIndicator()
    rebuildTray()
    updateObserverHud(event.outcome)
  })
  rebuildTray()
  registerGlobalStop()
  liveMacCanaryCoordinator = new LiveMacCanaryDesktopCoordinator({
    app: controlPlane,
    artifactRoot: process.env.STEWARD_LIVE_MAC_CANARY_ROOT ?? join(dataDir, 'evaluations', 'live-mac-canaries'),
    globalStopReady: () => globalShortcut.isRegistered(stopShortcut),
    executionAuthorizationReady: () => privacyReauthentication?.status() === 'available',
  })
  registerIpc()
  startLiveComputerOverlayMonitor()
})

interface NativeLiveInputBridge {
  isTrusted(): boolean
  requestTrust(): boolean
  windowState?(request: string): string
  /** One Window Server snapshot for every attached window: presence, focus, visible area, title. */
  surfaceStates?(request: string): string
  /** A window's document as a fingerprint plus display title; raw URLs stay native. */
  surfaceIdentity?(request: string): string
  /** Which element would receive a click at a window-relative point. */
  hitTest?(request: string): string
  focusWindow?(request: string): void
  frontmostApplication?(): string
  /** Arms the listen-only input monitor; reports the person's Escape presses as a count. */
  escapeStopMonitor?(): string
  /** The person's own input only (never Carve's): idle age and a command count. */
  personActivity?(): string
  execute(request: string): string | undefined
}


function loadLiveInputController(path: string): LiveComputerInputController | undefined {
  try {
    const bridge = nativeRequire(path) as NativeLiveInputBridge
    if (typeof bridge.isTrusted !== 'function' || typeof bridge.requestTrust !== 'function' || typeof bridge.execute !== 'function') {
      throw new Error('module exports are incomplete')
    }
    liveInputBridge = bridge
    // Physical input runs synchronously on this thread, so a renderer's
    // "pointer left the capsule" message cannot arrive mid-dispatch. Release
    // the overlay's mouse capture first: an engaged capsule spans the whole
    // frame window, and a synthetic click that reached it instead of the
    // selected window was silently lost on a loaded machine.
    // N-API exports are non-enumerable. Preserve the original bridge instead
    // of spreading away focus, hit testing, and surface identity.
    return createNativeInputController(bridge, {
      beforeDispatch: releaseLiveComputerOverlayForInput,
      // Permission belongs to the exact Electron process macOS displays as Carve.
      isTrusted: () => systemPreferences.isTrustedAccessibilityClient(false),
      requestTrust: () => systemPreferences.isTrustedAccessibilityClient(true),
      present: presentLiveComputerInput,
      aimHoldMs: liveComputerAimHoldMs,
      awaitPersonTurn: (target, signal) => personTurnGate.wait(target, signal),
      afterDelivery: target => personTurnGate.noteCarveInput(target),
    })
  } catch (error) {
    liveInputBridge = null
    console.error(`Carve live input bridge unavailable at ${path}: ${String(error)}`)
    return undefined
  }
}

electronApp.on('activate', handleApplicationActivate)
electronApp.on('before-quit', () => { isQuitting = true; previewVoice?.stop('shutdown'); closeObserverHud(); closeLiveComputerOverlay(); closePresenceOverlays(); stopLiveComputerOverlayMonitor() })
electronApp.on('will-quit', () => {
  globalShortcut.unregisterAll()
  void liveMacCanaryCoordinator?.stop('desktop_quit')
  closeObserverHud()
  closeLiveComputerOverlay()
  stopLiveComputerOverlayMonitor()
  if (controlPlane && !closed) {
    controlPlane.globalStop()
    controlPlane.close()
    closed = true
  }
})
electronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') electronApp.quit()
})

let mainWindowMoveUntil = 0

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'Carve',
    movable: true,
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#f4f2ec',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: process.env.NODE_ENV !== 'production',
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const session = controlPlane?.universalComputerSession()
    const live = controlPlane?.liveComputer.session()
    const urls = resultLinks([session?.completionAnswer?.answer, session?.terminalText, live?.resultSummary].filter(Boolean).join('\n'))
    if (urls.includes(url)) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== mainWindow?.webContents.getURL()) event.preventDefault()
  })
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  // Carve's own window taking focus retires the frame — except while the
  // Guide capsule has just been summoned, when app activation is the capsule's
  // own doing and the capsule is about to take the keyboard.
  mainWindow.on('focus', handleMainWindowFocus)
  mainWindow.on('will-move', () => {
    mainWindowMoveUntil = Date.now() + 500
    hideLiveComputerOverlay()
  })
  // On macOS, moved also fires during the gesture. Keep a short grace
  // period across native focus changes and late renderer acknowledgements.
  mainWindow.on('moved', () => { mainWindowMoveUntil = Date.now() + 500 })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  void mainWindow.loadFile(rendererPath)
}

/** macOS can briefly key the console when a click activates a floating
 * result capsule. Return focus to that engaged capsule instead of retiring it. */
function liveComputerPointerOverCapsule(): boolean {
  if (liveComputerCapsuleDrag) return true
  const badge = liveComputerOverlayBadgeBounds
  if (!badge) return false
  const cursor = screen.getCursorScreenPoint()
  return cursor.x >= badge.x && cursor.x <= badge.x + badge.width && cursor.y >= badge.y && cursor.y <= badge.y + badge.height
}

/** A shortcut activates Carve to give the capsule keyboard focus. That is
 * part of the capsule handoff, not a request to open the main window. */
function handleApplicationActivate(): void {
  if (liveComputerAskFocusPending || liveComputerSteeringFocusPending) return
  showMainWindow()
}

function handleMainWindowFocus(): void {
  if (Date.now() < mainWindowMoveUntil) { hideLiveComputerOverlay(); return }
  if ((liveComputerAskFocusPending || liveComputerSteeringFocusPending || liveComputerOverlayEngaged && liveComputerPointerOverCapsule()) && liveComputerOverlay && !liveComputerOverlay.isDestroyed() && liveComputerOverlay.isVisible()) {
    mainWindow?.hide()
    liveComputerOverlay.focus()
    return
  }
  hideLiveComputerOverlay()
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(moduleDirectory, 'brand/tray.png'))
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip(`Carve · ${carveTagline}`)
  tray.on('click', () => showMainWindow())
}

function rebuildTray(): void {
  if (!tray || !controlPlane) return
  // desktopStatus(), not state(): the tray is rebuilt on every command and capture (26 September slowdown).
  const status0 = controlPlane.desktopStatus()
  const sessionState = status0.activeSession ?? undefined
  const activeRun = status0.activeRun && ['running', 'awaiting_approval'].includes(status0.activeRun.status) ? status0.activeRun : undefined
  const liveSession = status0.liveSession
  const universalSession = status0.universalSession
  const universalActive = Boolean(universalSession && ['starting', 'running', 'pausing', 'paused', 'awaiting_steering_review', 'awaiting_budget', 'replanning'].includes(universalSession.status))
  const universalSteerable = Boolean(universalSession && ['starting', 'running', 'pausing', 'paused', 'awaiting_steering_review', 'replanning'].includes(universalSession.status))
  const status = universalSession && universalActive
    ? `${universalSession.status === 'awaiting_budget' ? 'Universal needs budget' : universalSession.status === 'awaiting_steering_review' ? 'Universal review' : universalSession.status === 'paused' || universalSession.status === 'pausing' ? 'Universal paused' : 'Universal working'} · ${universalSession.target.application}`
    : liveSession && !['stopped', 'completed', 'blocked', 'handoff'].includes(liveSession.status)
    ? `Live computer · ${liveSession.target.application}`
    : sessionState?.status === 'active'
    ? `Learning · ${sessionState.name}`
    : sessionState?.status === 'paused'
      ? `Capture paused · ${sessionState.name}`
      : activeRun
        ? `Working · ${activeRun.plan.goal}`
        : 'Ready when you are'
  const ambient = status0.ambient
  const cadence = sessionState && sessionState.fixtureId === 'native-macos-observation'
    ? sessionState.capturePolicy.captureTiming.mode === 'adaptive'
      ? `${sessionState.nextFixtureIndex} observations · adaptive`
      : sessionState.capturePolicy.captureTiming.mode === 'fixed'
        ? `${sessionState.nextFixtureIndex} observations · every ${sessionState.capturePolicy.captureTiming.intervalSeconds}s`
        : `${sessionState.nextFixtureIndex} observations · manual`
    : null
  const template: MenuItemConstructorOptions[] = [
    { label: 'Carve', enabled: false },
    { label: status, enabled: false },
    ...(cadence ? [{ label: cadence, enabled: false }] : []),
    ...(ambient.running ? [{ label: `Discovery · window names only · ${ambient.candidateCount} found`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Open Carve', click: () => showMainWindow() },
    ...(universalSteerable ? [{ label: `Course-correct Universal work  ${steeringShortcut}`, click: focusUniversalSteering }] : []),
    ...(sessionState ? [sessionState.status === 'active'
      ? { label: 'Pause learning', click: () => { controlPlane?.pauseSession(sessionState.id); rebuildTray() } }
      : sessionState?.status === 'paused'
        ? { label: 'Resume learning', click: () => { controlPlane?.resumeSession(sessionState.id); rebuildTray() } }
        : { label: 'Learning paused', enabled: false }] : []),
    {
      label: `Emergency stop  Esc or ${humanShortcut()}`,
      enabled: Boolean(sessionState || activeRun || universalActive || (liveSession && !['stopped', 'completed', 'blocked', 'handoff'].includes(liveSession.status))),
      click: () => emergencyStop('tray'),
    },
    { type: 'separator' },
    { role: 'quit', label: 'Quit Carve' },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
  applyTrayTitle()
  syncObserverHud()
  syncLiveComputerOverlay()
}

/** Replaces the full window with a small always-on-top status pill while
 * unattended capture runs. `focusable: false` is load-bearing: the pill can
 * never become the frontmost application, so the helper always observes the
 * user's work window rather than Carve's own indicator. */
function showObserverHud(): void {
  if (observerHud && !observerHud.isDestroyed()) return
  const width = 300
  const height = 66
  const { workArea } = screen.getPrimaryDisplay()
  observerHud = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 18,
    y: workArea.y + 18,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // On macOS skipTaskbar changes the activation policy for the whole app to
    // accessory, which removes Carve itself from the Dock even after this
    // auxiliary window closes. Other platforms still need the HUD suppressed.
    skipTaskbar: process.platform !== 'darwin',
    focusable: false,
    acceptFirstMouse: true,
    webPreferences: { preload: observerHudPreloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false },
  })
  preserveMacOSDockPresence()
  observerHud.setAlwaysOnTop(true, 'floating')
  observerHud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  observerHud.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  observerHud.webContents.on('will-navigate', (event) => event.preventDefault())
  observerHud.on('closed', () => { observerHud = null })
  const hud = observerHud
  void hud.loadFile(observerHudPath).then(() => {
    if (hud.isDestroyed()) return
    hud.showInactive()
    updateObserverHud(null)
  })
}

function closeObserverHud(): void {
  if (observerHud && !observerHud.isDestroyed()) observerHud.close()
  observerHud = null
}

/** The pill is painted from here. Its isolated preload exposes only one
 * argument-free action: stop the active native observation. */
function updateObserverHud(outcome: NativeCaptureEvent['outcome'] | null): void {
  if (!observerHud || observerHud.isDestroyed() || !controlPlane) return
  const sessionState = controlPlane.desktopStatus().activeSession
  if (!sessionState) return
  const paused = sessionState.status !== 'active'
  const timing = sessionState.capturePolicy.captureTiming
  const waitingForWorkApp = !paused && outcome === 'self_observation'
  const failed = outcome === 'failed'
  const label = paused ? 'Observation paused' : waitingForWorkApp ? 'Switch to another app' : failed ? 'Observation paused' : 'Carve observing'
  const count = `${sessionState.nextFixtureIndex} observation${sessionState.nextFixtureIndex === 1 ? '' : 's'}`
  const detail = waitingForWorkApp
    ? 'Carve never records its own windows'
    : failed
      ? 'Open Carve to see the capture error'
      : `${count}${timing.mode === 'adaptive' ? ' · Adaptive' : timing.mode === 'fixed' ? ` · every ${timing.intervalSeconds}s` : ''}`
  const script = `(() => {
    document.getElementById('label').textContent = ${JSON.stringify(label)};
    document.getElementById('detail').textContent = ${JSON.stringify(detail)};
    document.body.dataset.paused = ${JSON.stringify(String(paused))};
    document.body.dataset.waiting = ${JSON.stringify(String(waitingForWorkApp))};
    ${outcome === 'captured' ? "document.body.dataset.pulse = '1'; setTimeout(() => { document.body.dataset.pulse = '0' }, 600);" : ''}
  })()`
  void observerHud.webContents.executeJavaScript(script).catch(() => {
    // A dead indicator must never affect capture.
  })
}

/** Single source of truth for the pill, so tray pause/resume, stop, and
 * emergency stop all converge without their own bookkeeping. */
function syncObserverHud(): void {
  const sessionState = controlPlane?.desktopStatus().activeSession
  const unattended = Boolean(
    sessionState
    && sessionState.fixtureId === 'native-macos-observation'
    && sessionState.capturePolicy.captureTiming.mode !== 'manual',
  )
  if (!unattended) return closeObserverHud()
  showObserverHud()
  updateObserverHud(null)
}

/** A frame around the exact selected macOS window. During work the native
 * window ignores every mouse event and cannot take focus, so the presence
 * layer never widens the input surface it describes. Its renderer has one
 * outbound channel — validated user-intent commands (follow-up, expand,
 * pointer engagement) that the main process honors only in the terminal
 * completed state; see the steward:live-overlay-command handler. */
function createLiveComputerOverlay(): BrowserWindow {
  if (liveComputerOverlay && !liveComputerOverlay.isDestroyed()) return liveComputerOverlay
  liveComputerOverlayReady = false
  liveComputerOverlayPendingPresentation = null
  liveComputerOverlay = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // A macOS Dock item belongs to the application rather than one window.
    // Marking this overlay skipTaskbar would hide Carve's main Dock item too.
    skipTaskbar: process.platform !== 'darwin',
    focusable: false,
    // The overlay is shown without activating Carve. Once pointer hover has
    // handed mouse input to the capsule, the first press must reach its field
    // or button instead of being consumed solely to activate this window.
    // Transparent space remains click-through via setIgnoreMouseEvents below.
    acceptFirstMouse: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: liveComputerOverlayPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: false,
      backgroundThrottling: false,
    },
  })
  preserveMacOSDockPresence()
  liveComputerOverlay.setIgnoreMouseEvents(true)
  liveComputerOverlay.setAlwaysOnTop(true, 'floating', 1)
  liveComputerOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  liveComputerOverlay.setHiddenInMissionControl(true)
  liveComputerOverlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  liveComputerOverlay.webContents.on('will-navigate', (event) => event.preventDefault())
  liveComputerOverlay.webContents.once('did-finish-load', () => {
    liveComputerOverlayReady = true
    syncLiveComputerOverlay()
  })
  liveComputerOverlay.on('closed', () => {
    liveComputerOverlay = null
    liveComputerOverlayReady = false
    liveComputerCapsuleDrag = null
    liveComputerCapsulePositionContext = null
  })
  void liveComputerOverlay.loadFile(liveComputerOverlayPath)
  return liveComputerOverlay
}

function hideLiveComputerOverlay(): void {
  liveComputerCapsuleDrag = null
  liveComputerCapsulePositionContext = null
  liveComputerOverlayDetached = false
  liveComputerOverlayBadgeBounds = null
  // Automatic visibility changes must not cut off an already requested reply.
  presentedResultLinks = null
  if (liveComputerDrawingCapture) sendLiveComputerOverlayNotice('Drawing editor closed. Your saved marks are unchanged.')
  liveComputerDrawingCapture = null
  approvalVisibilityAudit.hidden('capsule_hidden')
  liveComputerOverlayPendingPresentation = null
  liveComputerOverlayEngaged = false
  liveComputerOverlayPointerOnControl = false
  liveComputerAskFocusPending = false
  liveComputerSteeringFocusPending = false
  capsuleFrameAttachmentId = null
  liveComputerOverlay?.setIgnoreMouseEvents(true, { forward: true })
  liveComputerOverlay?.hide()
}

function closeLiveComputerOverlay(): void {
  liveComputerOverlayDetached = false
  liveComputerOverlayMinimized = false
  liveComputerOverlayMinimizeAvailable = false
  presentedResultLinks = null
  capsuleVoice?.stop('capsule_closed')
  capsuleVoice?.setListening(false)
  previewVoice?.setListening(false)
  liveComputerDrawingCapture = null
  approvalVisibilityAudit.hidden('capsule_closed')
  liveComputerOverlayPendingPresentation = null
  liveComputerCapsulePresentedSessionId = null
  liveComputerCapsuleTransitionSessionId = null
  // Keep the renderer loaded between summons. Showing still waits for the
  // new presentation's layout acknowledgement, so stale content cannot flash.
  if (liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
    if (isQuitting) liveComputerOverlay.close()
    else {
      liveComputerOverlay.setIgnoreMouseEvents(true, { forward: true })
      liveComputerOverlay.setFocusable(false)
      liveComputerOverlay.hide()
    }
  }
  if (isQuitting || liveComputerOverlay?.isDestroyed()) {
    liveComputerOverlay = null
    liveComputerOverlayReady = false
  }
  liveComputerOverlayBadgeBounds = null
  liveComputerOverlayCue = null
  liveComputerOverlaySessionId = null
  liveComputerOverlayApprovalSurfaceKey = null
  liveComputerOverlayEngaged = false
  liveComputerAskFocusPending = false
  liveComputerSteeringFocusPending = false
  capsuleFrameAttachmentId = null
  if (liveComputerOverlayDictationId) {
    controlPlane?.dictation.cancelLiveTranscription(liveComputerOverlayDictationId)
    liveComputerOverlayDictationId = null
  }
}

function startLiveComputerOverlayMonitor(): void {
  if (process.platform !== 'darwin' || liveComputerOverlayTimer) return
  liveComputerOverlayTimer = setInterval(tickLiveComputerOverlay, 200)
  liveComputerOverlayTimer.unref()
  tickLiveComputerOverlay()
  // Pay renderer startup once, while the capsule is hidden, not on a hotkey.
  createLiveComputerOverlay()
}

/** Carve and the person share one keyboard and mouse. Carve takes a step
 * only when the person is still and its window is theirs to lend; it never
 * pulls them back from a window they chose (docs/multi-window-ux-plan-2026-09-26.md). */
function probePersonTurn(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): PersonTurnProbe | null {
  if (!liveInputBridge?.personActivity) return null
  const activity = JSON.parse(liveInputBridge.personActivity()) as { monitoring?: unknown; commandCount?: unknown; idleMs?: unknown }
  if (activity.monitoring !== true || typeof activity.commandCount !== 'number' || typeof activity.idleMs !== 'number') return null
  const state = readLiveComputerOverlayWindowState(target)
  // Typing into the capsule is working with Carve; the main window is a
  // place the person went, like any other window.
  const capsuleFocused = Boolean(liveComputerOverlay && !liveComputerOverlay.isDestroyed() && liveComputerOverlay.isFocused())
  return { monitoring: true, targetFocused: state.available && state.focused, carveFrontmost: capsuleFocused,
    // A held drag is still the person's turn even if the pointer is briefly
    // stationary. The existing gate resumes naturally after release.
    commandCount: activity.commandCount, idleMs: liveComputerCapsuleDrag || Date.now() < mainWindowMoveUntil ? 0 : activity.idleMs }
}

function personTurnSessionId(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): string | null {
  const universal = controlPlane?.universalComputerSession()
  if (universal && universal.target.windowId === target.windowId && universal.target.bundleIdentifier === target.bundleIdentifier) return universal.id
  const live = controlPlane?.liveComputer.session()
  return live && live.target.windowId === target.windowId && live.target.bundleIdentifier === target.bundleIdentifier ? live.id : null
}

const personTurnGate = new PersonTurnGate(probePersonTurn, {
  onYield: (state: PersonTurnState) => {
    controlPlane?.audit.append('computer.person_turn_yielded', 'system', personTurnSessionId(state.target), {
      reason: state.reason, windowId: state.target.windowId, bundleIdentifier: state.target.bundleIdentifier })
    syncLiveComputerOverlay()
  },
  onRelease: (state: PersonTurnState, waitedMs: number) => {
    controlPlane?.audit.append('computer.person_turn_released', 'system', personTurnSessionId(state.target), {
      reason: state.reason, waitedMs: Math.round(waitedMs), windowId: state.target.windowId, bundleIdentifier: state.target.bundleIdentifier })
    syncLiveComputerOverlay()
  },
})
personTurnGate.subscribe(() => syncLiveComputerOverlay())

/** Keeps the gate's picture of where the person is current between steps,
 * so a window Carve's own click opened is told apart from one they chose. */
function observePersonTurn(): void {
  const universal = controlPlane?.universalComputerSession()
  const live = controlPlane?.liveComputer.session()
  const target = universal && ['starting', 'running', 'replanning', 'pausing'].includes(universal.status) ? universal.target
    : live && ['ready', 'acting', 'verifying', 'reconciling_input'].includes(live.status) ? live.target : null
  if (target) personTurnGate.observe(target)
}

/** One tick: observe every attached window, move the live slot with the
 * current attachment, render the capsule, then the background frames. */
function tickLiveComputerOverlay(): void {
  watchEscapeStop()
  observePersonTurn()
  syncAttachments()
  syncLiveComputerOverlay()
  syncPresenceOverlays()
}

/** Live work a bare Escape stops: anything executing, about to execute, or
 * waiting on the person mid-task. Observation capture and background runs
 * are excluded, so an Escape in another app hours later never ends them. */
function escapeStopsLiveWork(): boolean {
  if (!controlPlane) return false
  if (liveComputerPendingStart) return true
  const live = controlPlane.liveComputer.session()
  if (live && !['stopped', 'completed', 'blocked', 'handoff'].includes(live.status)) return true
  const universal = controlPlane.universalComputerSession()
  if (universal && ['starting', 'running', 'pausing', 'paused', 'awaiting_steering_review', 'awaiting_budget', 'replanning'].includes(universal.status)) return true
  const handoff = controlPlane.applicationHandoff.snapshot()
  if (handoff && ['awaiting_consent', 'awaiting_budget', 'opening', 'paused'].includes(handoff.status)) return true
  return controlPlane.assistance.snapshot().active
}

function readEscapeStopMonitor(): { count: number } | null {
  if (!liveInputBridge?.escapeStopMonitor) return null
  try {
    const parsed = JSON.parse(liveInputBridge.escapeStopMonitor()) as { monitoring?: unknown; count?: unknown }
    return parsed.monitoring === true && typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? { count: parsed.count } : null
  } catch {
    return null
  }
}

/** Escape pressed anywhere outside Carve's own windows while live work is
 * under way is the emergency stop, the same fail-safe as the chord. Carve's
 * windows keep Escape's local meaning (the capsule's stop pill, a console
 * dialog's dismiss), and Carve's own synthesized Escape never counts: the
 * native monitor ignores this process. The count is baselined when work
 * begins, so an Escape pressed before it started cannot end it. */
function watchEscapeStop(): void {
  if (!escapeStopsLiveWork()) { liveComputerEscapeBaseline = null; return }
  const monitor = readEscapeStopMonitor()
  if (!monitor) { liveComputerEscapeBaseline = null; return }
  if (liveComputerEscapeBaseline === null) { liveComputerEscapeBaseline = monitor.count; return }
  if (monitor.count === liveComputerEscapeBaseline) return
  liveComputerEscapeBaseline = monitor.count
  if (BrowserWindow.getFocusedWindow()) return
  emergencyStop('escape_key')
}

function stopLiveComputerOverlayMonitor(): void {
  if (liveComputerOverlayTimer) clearInterval(liveComputerOverlayTimer)
  liveComputerOverlayTimer = null
}

/** The input bridge receives the freshly revalidated bounds immediately before
 * Quartz gets an event. Reuse that same fact for the visual cue, so the gold
 * marker never relies on stale picker geometry. */
function presentLiveComputerInput(
  bounds: LiveComputerTarget['bounds'],
  action: LiveComputerAction,
  target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>,
): void {
  const session = controlPlane?.liveComputer.session()
  if (!session || session.target.windowId !== target.windowId || session.target.bundleIdentifier !== target.bundleIdentifier) return
  const prior = liveComputerOverlayCue?.action ?? null
  const projected = overlayAction(action, prior)
  if (!projected.point && action.kind === 'scroll') projected.point = { x: bounds.width / 2, y: bounds.height / 2 }
  if (projected.point) projected.point = {
    x: Math.max(0, Math.min(bounds.width, projected.point.x)),
    y: Math.max(0, Math.min(bounds.height, projected.point.y)),
  }
  if (projected.targetBounds) {
    // Element bounds come from the last frame; the window may have resized
    // since. Clip to the revalidated window and drop a rectangle that no
    // longer has any visible area rather than drawing brackets off-window.
    const clampX = (value: number) => Math.max(0, Math.min(bounds.width, value))
    const clampY = (value: number) => Math.max(0, Math.min(bounds.height, value))
    const left = clampX(projected.targetBounds.x)
    const top = clampY(projected.targetBounds.y)
    const right = clampX(projected.targetBounds.x + projected.targetBounds.width)
    const bottom = clampY(projected.targetBounds.y + projected.targetBounds.height)
    projected.targetBounds = right - left >= 1 && bottom - top >= 1
      ? { x: left, y: top, width: right - left, height: bottom - top }
      : null
  }
  liveComputerOverlayCue = {
    sequence: ++liveComputerOverlayCueSequence,
    occurredAt: Date.now(),
    action: projected,
  }
  liveComputerOverlaySessionId = session.id
  renderLiveComputerOverlay(session, bounds)
}

type LiveComputerStartCommand = Extract<CarveCommand, { kind: 'computer.session.start' | 'computer.route.start' }>

function beginLiveComputerStartHandoff(command: LiveComputerStartCommand): NonNullable<typeof liveComputerPendingStart> {
  const primary = command.kind === 'computer.route.start' ? command.route[0] : null
  const target = command.kind === 'computer.session.start'
    ? structuredClone(command.target)
    : primary?.source === 'existing'
      ? structuredClone(primary.target)
      : null
  const pending = {
    requestId: `${command.runId}:${Date.now().toString(36)}`,
    runId: command.runId,
    startedAt: new Date().toISOString(),
    target,
    expectedBundleIdentifiers: command.kind === 'computer.session.start'
      ? [command.target.bundleIdentifier]
      : [...new Set(command.route.map((entry) => entry.source === 'existing' ? entry.target.bundleIdentifier : entry.bundleIdentifier))],
  }
  liveComputerPendingStart = pending
  liveComputerOverlayEngaged = false
  syncLiveComputerOverlay()
  return pending
}

function finishLiveComputerStartHandoff(pending: NonNullable<typeof liveComputerPendingStart>): void {
  if (liveComputerPendingStart !== pending) return
  liveComputerPendingStart = null
  syncLiveComputerOverlay()
}

function syncPendingLiveComputerStart(pending: NonNullable<typeof liveComputerPendingStart>): void {
  // Route materialization may open several fresh windows in sequence. Follow
  // whichever authorized run-scoped window is frontmost instead of leaving
  // the status behind on the first one. The route's primary existing target
  // remains the fallback once materialization has finished.
  const freshTargets = (controlPlane?.freshLiveComputerWindowList() ?? [])
    .filter((entry) => entry.runId === pending.runId && pending.expectedBundleIdentifiers.includes(entry.target.bundleIdentifier))
    .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
    .map((entry) => entry.target)
  const candidates = [...freshTargets, ...(pending.target ? [pending.target] : [])]
    .filter((candidate, index, all) => all.findIndex((entry) => entry.windowId === candidate.windowId && entry.bundleIdentifier === candidate.bundleIdentifier) === index)
  const visible = candidates.map((target) => ({ target, state: readLiveComputerOverlayWindowState(target) }))
    .find((entry) => entry.state.available && entry.state.focused && entry.state.bounds)
  // Keep the handoff visible while route materialization changes focus.
  const target = visible?.target ?? candidates[0] ?? controlPlane?.assistance.snapshot().target
  if (!target) return // Before a target exists, progress remains in the main UI.
  presentLiveComputerCapsule(
    buildLiveComputerLaunchPresentation(pending.requestId, target, humanShortcut(), pending.startedAt, controlPlane?.assistance.snapshot().question ?? null),
    visible?.state.bounds ?? target.bounds,
    target,
  )
}

let guideFreshnessPending = false
let guideFreshnessCheckedAt = 0
function checkGuideAnnotationFreshness(): void {
  const state = controlPlane?.assistance.snapshot()
  const answer = state?.guide.answer
  if (!controlPlane || !state?.target || !answer?.pointer || guideFreshnessPending || Date.now() - guideFreshnessCheckedAt < 2000) return
  guideFreshnessPending = true
  guideFreshnessCheckedAt = Date.now()
  void controlPlane.guide.annotationsCurrent(answer.id, state.target).then(current => {
    if (!current && controlPlane?.assistance.snapshot().guide.answer?.id === answer.id && controlPlane.assistance.snapshot().guide.answer?.scene?.revision === answer.scene?.revision) {
      controlPlane.assistance.invalidatePointer()
      syncLiveComputerOverlay()
    }
  }).finally(() => { guideFreshnessPending = false })
}

function syncLiveComputerOverlay(): void {
  if (!controlPlane || process.platform !== 'darwin') return
  const assistance = controlPlane.assistance.snapshot()
  const handoff = controlPlane.applicationHandoff.snapshot()
  if (handoff && (['awaiting_consent', 'awaiting_budget', 'opening', 'paused', 'failed'].includes(handoff.status) || handoffResumableAfterStop(handoff))) {
    const view = applicationHandoffPresentation(handoff, assistance)
    if (view) {
      const stateKey = `${handoff.id}:${handoff.revision}:${handoff.status}`
      if (stateKey !== liveComputerStateBroadcastKey) {
        liveComputerStateBroadcastKey = stateKey
        mainWindow?.webContents.send('steward:state-changed', { runId: handoff.runId })
      }
      liveComputerAskMode = null
      const windowState = readLiveComputerOverlayWindowState(view.target)
      presentLiveComputerCapsule(view.presentation, windowState.bounds ?? view.target.bounds, view.target)
      return
    }
  }
  if (liveComputerDrawingCapture && (Date.now() > liveComputerDrawingCapture.expiresAt || assistance.owner !== 'user' || assistance.guide.state !== 'answered' || assistance.guide.answer?.scene?.id !== liveComputerDrawingCapture.sceneId || assistance.guide.answer?.scene?.revision !== liveComputerDrawingCapture.revision)) {
    liveComputerDrawingCapture = null
    sendLiveComputerOverlayNotice('Drawing editor closed. Select Edit on screen to continue.')
    if (liveComputerOverlay) applyLiveComputerOverlayInteractivity(liveComputerOverlay, assistance.owner === 'user')
  }
  const universal = controlPlane.universalComputerSession()
  const universalTerminal = Boolean(universal && ['completed', 'safety_check', 'blocked', 'stopped'].includes(universal.status))
  if (universal && universalTerminal && liveComputerResultPresentedSessionId !== universal.id) {
    liveComputerResultPresentedSessionId = universal.id
    controlPlane.audit.append('computer.universal_result_presented', 'system', universal.id, {
      runId: universal.runId, status: universal.status, surface: liveComputerCapsulePresentedSessionId === universal.id ? 'capsule' : 'console',
      sessionEndedAt: universal.endedAt ?? null,
    })
  }
  const universalOwnsOverlay = Boolean(universal
    && universal.status !== 'stopped'
    && !(universalTerminal && liveComputerPendingStart)
    && !(universalTerminal && liveComputerOverlayDismissedTerminalSessionId === universal.id))
  const session = universalOwnsOverlay ? null : controlPlane.liveComputer.session()
  const broadcastSession = universalOwnsOverlay ? universal : session
  const broadcastKey = broadcastSession
    ? [broadcastSession.id, broadcastSession.status, broadcastSession.updatedAt, session?.pendingAction?.id ?? '', session?.pendingGuidance?.askedAt ?? ''].join(':')
    : 'none'
  const stateKey = `${broadcastKey}:${assistance.conversationId}:${assistance.revision}`
  if (stateKey !== liveComputerStateBroadcastKey) {
    liveComputerStateBroadcastKey = stateKey
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('steward:state-changed', {
        sessionId: broadcastSession?.id ?? null,
        status: broadcastSession?.status ?? null,
        updatedAt: broadcastSession?.updatedAt ?? null,
      })
    }
  }
  // A new handoff owns the capsule even if the previous engine still exposes
  // a terminal result. Never keep showing that result while preparing its successor.
  if (assistance.preparing && !assistance.dismissed && assistance.target) {
    liveComputerAskMode ??= { target: assistance.target, bounds: assistance.target.bounds, intent: 'work',
      guide: assistance.guide, question: assistance.question, requestSequence: 0 }
    liveComputerAskMode.target = assistance.target
    renderLiveComputerAskCapsule()
    return
  }
  if (!assistance.dismissed && assistance.showGuide && assistance.owner === 'user' && assistance.target
    && (liveComputerAskMode || assistance.executionId)) {
    const windowState = readLiveComputerOverlayWindowState(assistance.target)
    if (windowState.available && windowState.bounds) {
      const answer = assistance.guide.answer
      // Global event age includes clicks on our own dropdowns and composer.
      // Only geometry/focus changes retire marks here; the local frame check
      // below detects scrolling and edits inside the selected window.
      if (answer?.pointer && guideGeometryInvalidated(windowState, liveComputerAskMode?.bounds, liveComputerCapsuleHeld())) {
        controlPlane.assistance.invalidatePointer()
        assistance.guide = controlPlane.assistance.snapshot().guide
      }
      liveComputerAskMode = {
        target: assistance.target, bounds: windowState.bounds, intent: 'guide',
        guide: assistance.guide, question: assistance.question, requestSequence: assistance.revision,
      }
      renderLiveComputerAskCapsule()
      if (canShowLiveComputerCapsule(assistance.target, windowState)) checkGuideAnnotationFreshness()
      return
    }
  }
  if (!assistance.active && !assistance.showGuide && !assistance.dismissed && liveComputerAskMode) {
    liveComputerAskMode.intent = 'work'
    renderLiveComputerAskCapsule()
    return
  }
  if (universalOwnsOverlay && universal) {
    liveComputerAskMode = null
    syncUniversalComputerOverlay(universal)
    return
  }
  const sessionTerminal = Boolean(session && ['completed', 'blocked', 'handoff', 'stopped'].includes(session.status))
  if (liveComputerPendingStart && (!session || sessionTerminal)) {
    liveComputerAskMode = null
    syncPendingLiveComputerStart(liveComputerPendingStart)
    return
  }
  const sessionOwnsOverlay = Boolean(session
    && session.status !== 'stopped'
    && !(session.status === 'completed' && liveComputerOverlayDismissedTerminalSessionId === session.id))
  if (!sessionOwnsOverlay) {
    if (liveComputerAskMode && !assistance.showGuide) liveComputerAskMode.intent = 'work'
    if (liveComputerAskMode) return renderLiveComputerAskCapsule()
    if (liveComputerPendingStart) return syncPendingLiveComputerStart(liveComputerPendingStart)
    return closeLiveComputerOverlay()
  }
  if (!session) return
  // A session render owns the frame; a summoned ask capsule yields to it.
  liveComputerAskMode = null
  if (liveComputerOverlaySessionId !== session.id) {
    liveComputerOverlaySessionId = session.id
    liveComputerOverlayCue = null
    liveComputerOverlayDismissedTerminalSessionId = null
    liveComputerOverlaySurfacedTerminalSessionId = null
    liveComputerOverlayApprovalSurfaceKey = null
  }

  // Carve hides its own window when a live session starts so the selected
  // window stays unobstructed. A terminal state that needs the person must
  // bring the review surface back itself: the overlay banner is not clickable,
  // and a hidden application offers no visible way in. Surface once per
  // session so a person who hides the window again is not fought.
  if ((session.status === 'blocked' || session.status === 'handoff') && liveComputerOverlaySurfacedTerminalSessionId !== session.id) {
    liveComputerOverlaySurfacedTerminalSessionId = session.id
    showMainWindow()
  }

  const approvalSurfaceKey = session.status === 'awaiting_context_transfer' ? `${session.id}:transfer:${session.pendingContextTransfer?.id}` : capsuleDecision(session, null) ? null : liveComputerManualApprovalSurfaceKey(session)
  if (approvalSurfaceKey && approvalSurfaceKey !== liveComputerOverlayApprovalSurfaceKey) {
    // The input helper activates the selected work app immediately before an
    // event. Bring Carve forward once for each new human checkpoint so the
    // approval controls cannot remain hidden behind that app.
    liveComputerOverlayApprovalSurfaceKey = approvalSurfaceKey
    hideLiveComputerOverlay()
    showMainWindow()
    mainWindow?.webContents.send('steward:open-active-work', { runId: session.runId })
    return
  }
  if (!approvalSurfaceKey) liveComputerOverlayApprovalSurfaceKey = null

  // Results remain available until explicitly dismissed, like Universal.

  if (liveComputerOverlayCue && Date.now() - liveComputerOverlayCue.occurredAt > 1_600) liveComputerOverlayCue = null
  const state = readLiveComputerOverlayWindowState(session.target)
  renderLiveComputerOverlay(session, state.bounds ?? session.target.bounds)

}

function syncUniversalComputerOverlay(
  session: NonNullable<ReturnType<CarveApp['universalComputerSession']>>,
): void {
  if (liveComputerOverlaySessionId !== session.id) {
    liveComputerOverlaySessionId = session.id
    liveComputerOverlayCue = null
    liveComputerOverlayDismissedTerminalSessionId = null
    liveComputerOverlaySurfacedTerminalSessionId = null
    liveComputerOverlayApprovalSurfaceKey = null
  }
  const compactDecision = capsuleDecision(null, session, session.pendingCheckpointId ? controlPlane?.database.getCheckpointDecision(session.pendingCheckpointId) : null, session.pendingCheckpointId ? controlPlane?.checkpoints.livePreview(session.pendingCheckpointId) : null)
  const reviewSurfaceKey = session.status === 'awaiting_checkpoint' ? `${session.id}:${session.pendingCheckpointId}` : session.id
  if (!compactDecision && universalComputerShouldSurfaceMain(session) && liveComputerOverlaySurfacedTerminalSessionId !== reviewSurfaceKey) {
    liveComputerOverlaySurfacedTerminalSessionId = reviewSurfaceKey
    showMainWindow()
  }
  // While a checkpoint waits in the main window, the floating frame must not
  // sit over that dialog holding the mouse: it releases capture and hides, so
  // the first click on Allow is the click that counts.
  if (session.status === 'awaiting_checkpoint' && !compactDecision && !session.pendingPlanReview) {
    liveComputerOverlayEngaged = false
    if (liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
      liveComputerOverlay.setIgnoreMouseEvents(true, { forward: true })
      hideLiveComputerOverlay()
    }
    return
  }
  // Universal completion is the result surface, not a transient toast. It
  // remains over the selected window until the person closes it or opens the
  // full Carve result. Recoverable failures do the same; safety, missing
  // windows, and non-resumable policy terminals surface the main window.
  const state = readLiveComputerOverlayWindowState(session.target)
  renderUniversalComputerOverlay(session, state.bounds ?? session.target.bounds)

}

function renderLiveComputerOverlay(session: NonNullable<ReturnType<CarveApp['liveComputer']['session']>>, bounds: LiveComputerOverlayRect, detached = false): void {
  // Windows Carve opened wear a gold corner; a plan awaiting approval whose
  // goal names a site, on a route with no browser yet, offers one.
  const freshWindowKeys = new Set((controlPlane?.freshLiveComputerWindowList() ?? []).map((entry) => `${entry.target.bundleIdentifier}:${entry.target.windowId}`))
  const routeHasBrowser = session.targets.some((entry) => isBrowserBundleIdentifier(entry.target.bundleIdentifier))
  const suggestion = session.status === 'awaiting_plan_approval' && !routeHasBrowser && session.targets.length < 4 ? freshSurfaceSuggestion(session.goal) : null
  const freshSuggestion = suggestion?.url
    ? { bundleIdentifier: suggestion.bundleIdentifier, application: suggestion.application, url: suggestion.url, label: `${suggestion.application} window at ${safeHostLabel(suggestion.url)}` }
    : null
  const presentation = {
    ...buildLiveComputerOverlayPresentation(session, detached ? null : liveComputerOverlayCue, humanShortcut(), { freshWindowKeys, freshSuggestion }),
    frameVisible: !detached,
    dictationAvailable: controlPlane?.dictation.status().configured ?? false,
    dictationSharingAllowed: controlPlane?.dictationSharing().allowed ?? false,
  }
  presentLiveComputerCapsule(presentation, bounds, session.target)
}

function safeHostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./u, '') } catch { return 'the site' }
}

function renderUniversalComputerOverlay(
  session: NonNullable<ReturnType<CarveApp['universalComputerSession']>>,
  bounds: LiveComputerOverlayRect,
  detached = false,
): void {
  const decision = capsuleDecision(null, session, session.pendingCheckpointId ? controlPlane?.database.getCheckpointDecision(session.pendingCheckpointId) : null, session.pendingCheckpointId ? controlPlane?.checkpoints.livePreview(session.pendingCheckpointId) : null)
  const presentation = {
    ...buildUniversalComputerOverlayPresentation(session, humanShortcut()),
    frameVisible: !detached,
    decision,
    ...(decision ? { interactive: true, mode: 'session' as const, ...(decision.personStep
      ? { label: 'Carve · Waiting for you', detail: 'Paused while you finish this step in the window. Carve continues on its own.' }
      : { label: 'Carve · Your approval', detail: 'Paused · These actions have not run. Review and approve here.' }) } : {}),
    dictationAvailable: controlPlane?.dictation.status().configured ?? false,
    dictationSharingAllowed: controlPlane?.dictationSharing().allowed ?? false,
  }
  presentLiveComputerCapsule(presentation, bounds, session.target)
}

/** True while the person is interacting with the capsule itself — hovering
 * it, typing in it, or having focused its panel. */
function liveComputerCapsuleHeld(): boolean {
  return liveComputerOverlayEngaged
    || Boolean(liveComputerOverlay && !liveComputerOverlay.isDestroyed() && liveComputerOverlay.isFocused())
}

function canShowLiveComputerCapsule(target: LiveComputerTarget, state = readLiveComputerOverlayWindowState(target)): boolean {
  // A conversation about a tab that is not showing never frames the window
  // that tab lives in; the person reaches it with the hotkey on that tab.
  const current = controlPlane?.attachments.current()
  if (current && current.presence === 'waiting' && current.key.windowId === target.windowId && current.key.bundleIdentifier === target.bundleIdentifier) return false
  let frontmostBundleIdentifier: string | null = null
  try {
    const frontmost = liveInputBridge?.frontmostApplication?.()
    if (frontmost) frontmostBundleIdentifier = (JSON.parse(frontmost) as { bundleIdentifier?: string }).bundleIdentifier ?? null
  } catch { /* A focused native target remains usable; hover cannot override missing focus evidence. */ }
  return liveComputerCapsuleVisible(state, {
    targetBundleIdentifier: target.bundleIdentifier, frontmostBundleIdentifier,
    capsuleEngaged: liveComputerOverlayEngaged,
    capsuleFocused: Boolean(liveComputerOverlay && !liveComputerOverlay.isDestroyed() && liveComputerOverlay.isFocused()),
    mainWindowFocused: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()),
  })
}

/** Render preparation even during a missing-window probe. The presentation
 * layer keeps busy status visible and gates window-specific decorations. */
function renderLiveComputerAskCapsule(): void {
  const ask = liveComputerAskMode
  if (!ask || !controlPlane) return
  const state = readLiveComputerOverlayWindowState(ask.target)
  if (state.bounds) ask.bounds = state.bounds
  const presentation = {
    ...buildLiveComputerAssistancePresentation(ask.target, humanAccelerator(guideShortcut), controlPlane.assistance.snapshot(), {
      immediate: isUniversalLiveComputerEngine(controlPlane.liveComputerActionEngine()),
      accessibility: process.platform === 'darwin' ? (systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied') : 'unknown',
      consent: guideConsentNeeded(),
    }),
    dictationAvailable: controlPlane.dictation.status().configured,
    dictationSharingAllowed: controlPlane.dictationSharing().allowed,
  }
  presentLiveComputerCapsule(presentation, ask.bounds, ask.target)
}

function focusPresentedLiveComputerCapsule(): void {
  if (liveComputerAskFocusPending || liveComputerSteeringFocusPending) liveComputerOverlayMinimized = false
  if (liveComputerAskFocusPending && liveComputerOverlayReady && liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
    // Keep the focus request live throughout activation: macOS may emit
    // application activation and main-window focus synchronously here.
    // The summon arrives while another application is active. A window of an
    // inactive application cannot become key on macOS, so the keystrokes that
    // follow would land in the person's document instead of the question
    // field. Activating Carve would also raise its main window over the very
    // window the person is asking about, so that window is put away first
    // and brought back, inactive, when the capsule is dismissed.
    if (process.platform === 'darwin') {
      const mainWindowHadFocus = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused())
      tuckMainWindowBehindCapsule()
      electronApp.focus({ steal: true })
      // Activating the app un-hides a window the person put away with ⌘H.
      // The summon is about the window under the capsule, not Carve's own.
      if (!mainWindowHadFocus && mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    }
    liveComputerOverlay.focus()
    liveComputerOverlay.webContents.focus()
    liveComputerAskFocusPending = false
  }
  if (liveComputerSteeringFocusPending && liveComputerOverlayReady && liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
    liveComputerSteeringFocusPending = false
    liveComputerOverlay.focus()
    liveComputerOverlay.webContents.send('steward:live-overlay-focus-steering')
  }
}

/** The main window yields to a summoned capsule: hidden (never closed) so
 * activating Carve cannot cover the target window. It is not brought back on
 * its own afterwards: showing it inactive would stack it over the document
 * the person is working in, which is the very thing this prevents. The Dock
 * icon and any decision point bring it back. */
function tuckMainWindowBehindCapsule(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isFocused()) return
  mainWindow.hide()
}

/** While Carve works and no one is touching the capsule, it is one quiet
 * line. Anything that asks the person for something — a plan, a decision, a
 * pause, an answer, a failure — is always the full card. */
/** True while the person's attention is on the capsule for long enough that
 * it should be the Card: hovered past the intent delay, focused, typing, or
 * just left within the linger window. Mouse capture uses the immediate
 * `liveComputerCapsuleHeld()`; only the tier waits. */
function liveComputerCapsuleExpandHeld(now = Date.now()): boolean {
  if (liveComputerCapsuleDrag) return false
  if (liveComputerOverlay && !liveComputerOverlay.isDestroyed() && liveComputerOverlay.isFocused()) return true
  if (liveComputerOverlayEngaged) return !liveComputerOverlayPointerOnControl && now - liveComputerOverlayEngagedAt >= liveComputerOverlayExpandDelayMs
  return liveComputerOverlayReleasedAt > 0 && now - liveComputerOverlayReleasedAt < liveComputerOverlayCollapseLingerMs
}

/** How long the capsule explains, as the Card, that it is waiting for the person to come back. */
const personTurnExplainMs = 6_000

/** How long a finished session stays the Card before settling to the Line. */
const liveComputerTerminalCardMs = 8_000

/** True when the person has used the keyboard or mouse since `since`. Carve's
 * own input has stopped by the time a session ends, so any later input is
 * theirs. Unknown idle time keeps the old timed behavior. */
function liveComputerPersonActiveSince(since: number): boolean {
  try {
    const idleMs = powerMonitor.getSystemIdleTime() * 1000
    return Date.now() - idleMs > since
  } catch { return true }
}

function shouldCollapseCapsule(presentation: ReturnType<typeof buildLiveComputerOverlayPresentation>): boolean {
  if (liveComputerCapsuleExpandHeld()) return false
  // The first moments of waiting for the person say why, in full, once;
  // then it rests as the Line and the Card is a hover away.
  if (presentation.personTurn?.reason === 'person_elsewhere' && Date.now() - Date.parse(presentation.personTurn.since) < personTurnExplainMs) return false
  // The launch handoff and the first captured frame keep the complete
  // explanation visible; every decision (plan, approval, guidance, budget,
  // failure) and every answer is the Card by itself. A working session, a
  // paused one, and a finished one without an answer rest as the Line; the
  // finished one only after its completion has had its moment as the Card.
  if (presentation.mode === 'launch' || presentation.health === 'starting' || presentation.phase === 'preparing') return false
  if (presentation.decision || presentation.answer || presentation.planApproval || presentation.guidance || presentation.budgetCheckpoint || presentation.failure || presentation.steeringPaused || presentation.phase === 'paused') return false
  if (presentation.mode !== 'session' && presentation.mode !== 'steer') return false
  if (presentation.theme === 'attention' || presentation.phase === 'waiting') return false
  if (presentation.theme === 'complete' || presentation.phase === 'complete' || presentation.phase === 'ended') {
    const endedAt = presentation.endedAt ? Date.parse(presentation.endedAt) : NaN
    if (!Number.isFinite(endedAt) || Date.now() - endedAt < liveComputerTerminalCardMs) return false
    // The ending is what the person remembers. A result that finished while
    // they looked away waits as the Card until they touch the keyboard or
    // mouse again, rather than shrinking before anyone saw it.
    return liveComputerPersonActiveSince(endedAt)
  }
  return true
}

function liveComputerCompactContext(shape: ReturnType<typeof buildLiveComputerOverlayPresentation>): string {
  const since = shape.serviceWaitSince ? Date.parse(shape.serviceWaitSince) : NaN
  if (Number.isFinite(since) && !shape.endedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000))
    return `${shape.application} · waiting on AI ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  return shape.inputsDone && !shape.endedAt ? `${shape.application} · ${shape.inputsDone} action${shape.inputsDone === 1 ? '' : 's'}` : shape.application
}

/** What the person can see change, for the silence measure (shared with the
 * evaluation harness in src/capsule-silence.ts). */
function observeCapsuleSilence(shape: ReturnType<typeof buildLiveComputerOverlayPresentation>): void {
  const summary = capsuleSilence.observe(capsuleVisibleState(shape))
  if (summary) controlPlane?.audit.append('computer.capsule_feedback', 'system', summary.runId ?? summary.sessionId, { ...summary, textRetained: false })
}

/** Opening the full app is an explicit change of surface. Background work
 * may keep running, but its floating window cannot reclaim the mouse over
 * the full app. A fresh summon remains an intentional exception. */
function mainWindowOwnsInteraction(): boolean {
  if (liveComputerAskFocusPending || liveComputerSteeringFocusPending) return false
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    && (Date.now() < mainWindowMoveUntil || mainWindow.isFocused()))
}

function presentLiveComputerCapsule(shape: ReturnType<typeof buildLiveComputerOverlayPresentation>, bounds: LiveComputerOverlayRect, target: LiveComputerTarget): void {
  if (mainWindowOwnsInteraction()) { hideLiveComputerOverlay(); return }
  shape = applicationHandoffVoicePresentation(shape, controlPlane?.applicationHandoff.snapshot() ?? null)
  // The window's own name, from the live attachment title when there is one:
  // two Chrome windows are told apart by their tabs, not the app name.
  const windowLabel = capsuleWindowLabel(controlPlane?.attachments.forWindow(target)[0]?.target.title || target.title)
  const turn = personTurnGate.state()
  if (turn && !shape.endedAt && turn.target.windowId === target.windowId && turn.target.bundleIdentifier === target.bundleIdentifier) {
    // A held step shows no aim: nothing is about to be clicked.
    const copy = personTurnCopy(turn.reason, shape.application, windowLabel)
    shape = { ...shape, label: copy.label, detail: copy.detail, cuePoint: null, cueKind: 'none', cueLabel: null, aimBounds: null,
      personTurn: { reason: turn.reason, since: new Date(turn.since).toISOString(), compactLabel: copy.compactLabel } }
  }
  observeCapsuleSilence(shape)
  if (controlPlane) {
    const live = controlPlane.liveComputer.session()
    const universal = controlPlane.universalComputerSession()
    const bound = live?.id === shape.sessionId ? live : universal?.id === shape.sessionId ? universal : null
    const authority = controlPlane.guideAuthority()
    const providerId = bound?.providerId ?? authority.providerId
    const provider = providerId ? controlPlane.providers.get(providerId).summary : null
    shape = { ...shape, sharingStatus: provider?.kind === 'hosted'
      ? shape.workConsent || shape.guide?.consentProviderId ? 'Your permission is needed before sharing this content.'
        : bound && shape.endedAt ? `Task finished. ${sharingRecipient(provider)} processed the authorized window content for this task.`
        : bound ? `Authorized window content and task context may be shared with ${sharingRecipient(provider)}. Current window: ${target.application} — ${target.title}`
        : `When you ask: selected-window content and conversation context go to ${sharingRecipient(provider)}. App names require separate permission.`
      : provider ? 'Requests go to your local model endpoint. Its forwarding settings apply.' : null }
  }
  const attached = canShowLiveComputerCapsule(target)
  const working = ['preparing', 'observing', 'deciding', 'acting', 'verifying', 'recovering', 'settling'].includes(shape.phase)
    && !shape.endedAt && shape.theme !== 'complete' && shape.theme !== 'paused'
  // A question for the person (budget, guidance, plan, approval) must stay on
  // screen even when its window is behind another; it docks to the display
  // like a working session does instead of vanishing until the window returns.
  // A stop the person can continue is a question too ("Continue?"): it stays reachable instead of vanishing.
  // The Explain-to-action choice counts too (STEWARD_SWITCH_CHOICE_IN_CAPSULE).
  const needsAnswer = liveComputerCapsuleNeedsAnswer(shape)
  // A paused task whose window is behind another still shows where it is
  // and how to resume it, rather than vanishing until that window returns.
  const pausedAway = shape.theme === 'paused' && !shape.endedAt
  if (!attached && !working && !needsAnswer && !pausedAway) { hideLiveComputerOverlay(); return }
  liveComputerOverlayDetached = !attached
  if (!attached) {
    // A screen-docked status can outlive a focus/AX gap; target geometry and
    // input annotations cannot. Native action validation remains unchanged.
    // Away, it waits at the top-right of the display the person is using:
    // one predictable place, never the corner of the window in front of its own.
    bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    shape = { ...shape, frameVisible: false, cuePoint: null, cueKind: 'none', cueLabel: null, aimBounds: null, readKey: null, readAt: null, guide: null }
  }
  // Diagnostic lever (26 September slowdown measurement): STEWARD_OVERLAY_CUES=off draws no click/typing cues or aim frames.
  if (process.env.STEWARD_OVERLAY_CUES?.trim() === 'off') shape = { ...shape, cuePoint: null, cueKind: 'none', cueLabel: null, aimBounds: null, readKey: null, readAt: null }
  const framed = attached ? controlPlane?.attachments.forWindow(target) ?? [] : []
  capsuleFrameAttachmentId = (framed.find((attachment) => attachment.id === currentAttachmentId) ?? framed[0])?.id ?? null
  const minimizeAvailable = !shape.decision && !shape.planApproval && !shape.guidance && !shape.budgetCheckpoint && !shape.failure && !shape.workConsent && shape.theme !== 'attention' && !liveComputerDrawingCapture
  liveComputerOverlayMinimizeAvailable = minimizeAvailable
  if (!minimizeAvailable) liveComputerOverlayMinimized = false
  const minimized = liveComputerOverlayMinimized
  const asksPerson = Boolean(shape.decision || shape.planApproval || shape.guidance || shape.budgetCheckpoint || shape.failure || shape.workConsent)
  const frozen = !asksPerson && liveComputerOverlayEngaged && (liveComputerOverlayPointerOnControl || Boolean(liveComputerCapsuleDrag)) && (liveComputerOverlayRenderedTier === 'line' || liveComputerOverlayRenderedTier === 'card')
  const collapsed = !minimized && (frozen ? liveComputerOverlayRenderedTier === 'line' : shouldCollapseCapsule(shape))
  const tier = minimized ? 'dot' : collapsed ? 'line' : 'card'
  liveComputerOverlayRenderedTier = tier
  const presentation = {
    ...shape,
    minimized,
    minimizeAvailable,
    interactive: shape.interactive || minimized,
    voiceContextId: shape.voiceContextId ?? controlPlane?.assistance.snapshot().runId ?? shape.sessionId,
    voice: { available: capsuleVoice?.available ?? false, enabled: capsuleVoice?.enabled ?? false },
    debugModel: controlPlane?.liveComputerModelDebugTag() ?? null,
    assistance: controlPlane?.assistance.snapshot(),
    collapsed,
    tier,
    compactLabel: tier === 'card' ? undefined : shape.personTurn?.compactLabel ?? liveComputerCompactLabel(shape),
    away: !attached,
    // Each delivered input visibly advances the Line, not only its verb; a
    // slow AI response shows how long it has been waited on. Stamped after
    // the silence measure, so a ticking clock never counts as news.
    compactApplication: attached ? liveComputerCompactContext(shape) : [shape.application, windowLabel ? `“${windowLabel}”` : null].filter(Boolean).join(' · '),
  }
  const positionTarget = `${target.bundleIdentifier}:${target.windowId}`
  if (liveComputerCapsulePositionTarget !== positionTarget) {
    liveComputerCapsulePositionTarget = positionTarget
    liveComputerCapsulePosition = null
    liveComputerCapsuleDrag = null
  }
  if (liveComputerCapsuleDrag && (!attached || liveComputerCapsuleDrag.sessionId !== presentation.sessionId)) liveComputerCapsuleDrag = null
  liveComputerCapsulePositionContext = { sessionId: presentation.sessionId, bounds, attached }
  const display = screen.getDisplayMatching(integerRectangle(bounds))
  const badgeWidth = liveComputerOverlayBadgeWidth(bounds.width, presentation)
  if (liveComputerOverlayDockSessionId !== presentation.sessionId) {
    liveComputerOverlayDockSessionId = presentation.sessionId
    liveComputerOverlayInsideDock = 'inside-bottom-right'
  }
  const layout = layoutLiveComputerOverlay(
    bounds,
    display.workArea,
    liveComputerOverlayBadgeHeight(presentation, badgeWidth),
    badgeWidth,
    {
      // A budget decision docks where the work is, like every other
      // decision; the full ring and one sentence carry it.
      centered: false,
      avoidBounds: liveComputerCapsuleHeld() ? [] : (presentation.guide?.annotations ?? []).map(annotation => ({
        x: annotation.bounds.x * bounds.width / (presentation.guide?.frameSize?.width || bounds.width),
        y: annotation.bounds.y * bounds.height / (presentation.guide?.frameSize?.height || bounds.height),
        width: annotation.bounds.width * bounds.width / (presentation.guide?.frameSize?.width || bounds.width),
        height: annotation.bounds.height * bounds.height / (presentation.guide?.frameSize?.height || bounds.height),
      })).concat(presentation.aimBounds ? [presentation.aimBounds] : []),
      position: liveComputerCapsulePosition,
      // Do not move the control out from under a person who is hovering or
      // typing in it. Otherwise, re-anchor only when it would cover the next
      // physical interaction.
      cuePoint: liveComputerCapsuleHeld() ? null : presentation.guide?.pointer
        ? { x: (presentation.guide.pointer.bounds.x + presentation.guide.pointer.bounds.width / 2) * bounds.width / (presentation.guide.frameSize?.width || bounds.width), y: (presentation.guide.pointer.bounds.y + presentation.guide.pointer.bounds.height / 2) * bounds.height / (presentation.guide.frameSize?.height || bounds.height) }
        : presentation.cuePoint,
      preferredInsideDock: liveComputerOverlayInsideDock,
      away: !attached,
    },
  )
  if (['inside-bottom-left', 'inside-bottom-right', 'inside-top-left', 'inside-top-right'].includes(layout.badge.dock)) {
    liveComputerOverlayInsideDock = layout.badge.dock as LiveComputerOverlayInsideDock
  }
  const overlay = createLiveComputerOverlay()
  liveComputerOverlayBadgeBounds = {
    x: layout.window.x + layout.badge.x, y: layout.window.y + layout.badge.y,
    width: badgeWidth, height: liveComputerOverlayBadgeHeight(presentation, badgeWidth),
  }
  // An interactive capsule takes the mouse the moment the cursor is over it,
  // not only after the page reports a hover: a click that arrives right
  // after the cursor lands must never fall through to the window beneath.
  if (presentation.interactive && !liveComputerOverlayEngaged) {
    const cursor = screen.getCursorScreenPoint()
    const badge = {
      x: layout.window.x + layout.badge.x,
      y: layout.window.y + layout.badge.y,
      width: badgeWidth,
      height: liveComputerOverlayBadgeHeight(presentation, badgeWidth),
    }
    if (cursor.x >= badge.x && cursor.x <= badge.x + badge.width && cursor.y >= badge.y && cursor.y <= badge.y + badge.height) {
      liveComputerOverlayEngaged = true
    }
  }
  applyLiveComputerOverlayInteractivity(overlay, presentation.interactive)
  overlay.setBounds(integerRectangle(layout.window), false)
  if (!liveComputerOverlayReady) return
  const session = controlPlane?.liveComputer.session()
  const presentationId = ++liveComputerOverlayPresentationSequence
  liveComputerOverlayPendingPresentation = { id: presentationId, sessionId: presentation.sessionId, target, detached: !attached, working,
    needsAnswer: needsAnswer && switchChoiceKeepsCapsuleEnabled(),
    approval: presentation.planApproval && session ? { sessionId: session.id, runId: session.runId, planHash: presentation.planApproval.planHash } : null }
  presentedResultLinks = { sessionId: presentation.sessionId, urls: resultLinks(presentation.answer ?? '') }
  overlay.webContents.send('steward:live-overlay-state', { layout, presentation: { ...presentation, escapeStops: liveComputerEscapeBaseline !== null }, presentationId })
  capsuleVoice?.observe({ ...shape, voiceContextId: presentation.voiceContextId, voice: presentation.voice })
}

/** Every state stays click-through by default — the frame must not intercept
 * input meant for the selected window. Mouse moves are always forwarded so
 * the page can see the pointer reach the capsule: only while the person is
 * actually over it (or typing in an interactive capsule) does the window take
 * real mouse input, which is what makes the capsule's Stop control clickable
 * even mid-session. Keyboard focus stays reserved for the interactive
 * terminal capsules, so an executing session can never receive keys. */
/** Called immediately before Carve posts pointer or keyboard input to the
 * selected window. The frame must be click-through at that instant; the
 * capsule re-engages the next time the person's own pointer reaches it. */
function releaseLiveComputerOverlayForInput(): void {
  if (!liveComputerOverlayEngaged || liveComputerDrawingCapture) return
  liveComputerOverlayEngaged = false
  liveComputerOverlayPointerOnControl = false
  if (liveComputerOverlay && !liveComputerOverlay.isDestroyed()) liveComputerOverlay.setIgnoreMouseEvents(true, { forward: true })
}

function applyLiveComputerOverlayInteractivity(overlay: BrowserWindow, interactive: boolean): void {
  overlay.setFocusable(interactive || Boolean(liveComputerDrawingCapture))
  if (liveComputerDrawingCapture || liveComputerOverlayEngaged) overlay.setIgnoreMouseEvents(false)
  else overlay.setIgnoreMouseEvents(true, { forward: true })
}

function readLiveComputerOverlayWindowState(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier'>): LiveComputerOverlayWindowState {
  if (liveInputBridge?.windowState) {
    try {
      const parsed = JSON.parse(liveInputBridge.windowState(JSON.stringify({
        target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier },
      }))) as Partial<LiveComputerOverlayWindowState>
      const bounds = parsed.bounds
      if (parsed.available === true && bounds && validOverlayRect(bounds)) {
        return { available: true, focused: parsed.focused === true, frontmostNormal: parsed.frontmostNormal === true, bounds: { ...bounds }, ...(typeof parsed.inputAgeMs === 'number' && Number.isFinite(parsed.inputAgeMs) ? { inputAgeMs: parsed.inputAgeMs } : {}) }
      }
      return { available: false, focused: false, bounds: null }
    } catch {
      // The overlay is advisory. A failed state probe must never affect the
      // governed action path or make a stale frame remain visible.
      return { available: false, focused: false, bounds: null }
    }
  }
  return { available: false, focused: false, bounds: null }
}

function validOverlayRect(value: unknown): value is LiveComputerOverlayRect {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LiveComputerOverlayRect>
  return [candidate.x, candidate.y, candidate.width, candidate.height].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    && typeof candidate.width === 'number' && candidate.width >= 1
    && typeof candidate.height === 'number' && candidate.height >= 1
}

function integerRectangle(rectangle: LiveComputerOverlayRect): Electron.Rectangle {
  return {
    x: Math.round(rectangle.x),
    y: Math.round(rectangle.y),
    width: Math.max(1, Math.round(rectangle.width)),
    height: Math.max(1, Math.round(rectangle.height)),
  }
}

function hideForUnattendedCapture(sessionId: string | undefined): void {
  if (!sessionId || !controlPlane) return
  const session = controlPlane.database.getSession(sessionId)
  if (session?.status !== 'active') return
  if (session.fixtureId !== 'native-macos-observation') return
  if (session.capturePolicy.captureTiming.mode === 'manual') return
  mainWindow?.hide()
  // BrowserWindow.hide() removes the window but leaves the macOS application
  // active. NSWorkspace then still reports Carve as the frontmost app and
  // every scheduled attempt is correctly (but unhelpfully) rejected as a
  // self-observation. Hiding the application deactivates it and hands focus
  // back to the person's previous work app. The tray remains available.
  if (process.platform === 'darwin') electronApp.hide()
}

/** Move an explicitly selected Universal session out of Carve's full
 * console and into the compact, selected-window capsule. Raising the window
 * is a verified focus-only operation: it posts no mouse or keyboard input and
 * fails closed to the still-visible main window if identity or bounds changed. */
function transitionUniversalWorkToCapsule(session: Pick<UniversalComputerSession, 'id' | 'runId' | 'status' | 'target'>): void {
  if (process.platform !== 'darwin' || !controlPlane) return
  if (!['starting', 'running', 'pausing', 'paused', 'awaiting_steering_review', 'awaiting_budget', 'replanning'].includes(session.status)) return
  const state = readLiveComputerOverlayWindowState(session.target)
  if (!liveInputBridge?.focusWindow || !state.available || !state.bounds) {
    controlPlane.audit.append('computer.universal_capsule_transition_failed', 'system', session.id, {
      runId: session.runId,
      application: session.target.application,
      reason: !liveInputBridge?.focusWindow ? 'focus_bridge_unavailable' : 'selected_window_unavailable',
      mainWindowRetained: true,
    })
    return
  }
  try {
    liveInputBridge.focusWindow(JSON.stringify({
      bounds: state.bounds,
      target: { windowId: session.target.windowId, bundleIdentifier: session.target.bundleIdentifier },
    }))
    liveComputerOverlayEngaged = false
    liveComputerSteeringFocusPending = false
    liveComputerCapsuleTransitionSessionId = session.id
    syncLiveComputerOverlay()
    if (liveComputerCapsulePresentedSessionId === session.id) mainWindow?.hide()
    controlPlane.audit.append('computer.universal_capsule_presented', 'system', session.id, {
      runId: session.runId,
      application: session.target.application,
      windowId: session.target.windowId,
      focusOnly: true,
      inputSent: false,
    })
  } catch (error) {
    controlPlane.audit.append('computer.universal_capsule_transition_failed', 'system', session.id, {
      runId: session.runId,
      application: session.target.application,
      reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      mainWindowRetained: true,
    })
    showMainWindow()
  }
}

function applyTrayTitle(): void {
  if (!tray || process.platform !== 'darwin') return
  const status = controlPlane?.desktopStatus()
  const sessionState = status?.activeSession
  if (sessionState?.status === 'active') return tray.setTitle(captureIndicatorLit ? ' ◉ REC' : ' ◎ REC')
  // Ambient discovery records no pixels, so it must never borrow the REC mark —
  // but it is still observation and stays visible while it runs.
  return tray.setTitle(status?.ambient.running ? ' ◦' : '')
}

/** Briefly fills the menu-bar dot so each stored observation is visible even
 * when the window is hidden. Never fires for skipped duplicates. */
function flashCaptureIndicator(): void {
  if (process.platform !== 'darwin') return
  captureIndicatorLit = true
  applyTrayTitle()
  if (captureIndicatorTimer) clearTimeout(captureIndicatorTimer)
  captureIndicatorTimer = setTimeout(() => {
    captureIndicatorLit = false
    captureIndicatorTimer = null
    applyTrayTitle()
  }, 600)
  captureIndicatorTimer.unref()
}

function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Safety',
      submenu: [
        { label: 'Course-correct Universal work', accelerator: steeringShortcut, click: focusUniversalSteering },
        { label: 'Emergency stop (or Esc while Carve works)', accelerator: stopShortcut, click: () => emergencyStop('menu') },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerGlobalStop(): void {
  globalShortcut.register(stopShortcut, () => emergencyStop('global_shortcut'))
  globalShortcut.register(steeringShortcut, focusUniversalSteering)
  const toggleAsk = () => { void toggleLiveComputerAsk() }
  globalShortcut.register(askShortcut, toggleAsk)
  globalShortcut.register(alternateAskShortcut, toggleAsk)
  const requested = (process.env.STEWARD_GUIDE_SHORTCUT ?? '').trim() || defaultGuideShortcut
  guideShortcut = askShortcut
  for (const candidate of [requested, ...guideShortcutFallbacks]) {
    let registered = false
    try {
      registered = candidate === askShortcut || globalShortcut.register(candidate, toggleAsk)
    } catch {
      registered = false
    }
    if (registered) {
      guideShortcut = candidate
      break
    }
    controlPlane?.audit.append('desktop.shortcut_unavailable', 'system', null, { role: 'guide', requested: candidate })
  }
  const doIt = () => { void toggleLiveComputerDoIt() }
  const requestedDoIt = (process.env.STEWARD_DO_IT_SHORTCUT ?? '').trim() || defaultDoItShortcut
  doItShortcut = null
  for (const candidate of [requestedDoIt, ...doItShortcutFallbacks]) {
    // A chord already claimed by Guide or by a safety shortcut must never be
    // stolen from it: the Do-it summon simply goes without.
    if ([guideShortcut, askShortcut, alternateAskShortcut, steeringShortcut, stopShortcut].includes(candidate)) continue
    let registered = false
    try {
      registered = globalShortcut.register(candidate, doIt)
    } catch {
      registered = false
    }
    if (registered) {
      doItShortcut = candidate
      break
    }
    controlPlane?.audit.append('desktop.shortcut_unavailable', 'system', null, { role: 'do_it', requested: candidate })
  }
}

/** Pauses at the controller's next safe boundary and brings the compact
 * correction field to the keyboard. The selected-window bounds are verified
 * before the overlay takes focus, preserving the window-selection contract. */
function focusUniversalSteering(): void {
  if (!controlPlane) return
  const universal = controlPlane.universalComputerSession()
  if (!universal || !['starting', 'running', 'pausing', 'paused', 'awaiting_steering_review', 'replanning'].includes(universal.status)) return
  try {
    controlPlane.pauseUniversalComputerSession('text', 'steering_shortcut')
  } catch {
    return
  }
  liveComputerSteeringFocusPending = true
  liveComputerOverlayEngaged = true
  syncLiveComputerOverlay()
}

/**
 * The "ask about this window" hotkey. Pressing it while any window is
 * frontmost attaches Carve to that window (or that browser tab) and summons
 * the compact Guide capsule framed on it; pressing it again on the same
 * surface dismisses the capsule. Guide reads one frame, answers, and points;
 * it never sends input.
 */
async function toggleLiveComputerAsk(): Promise<void> {
  if (controlPlane && !firstRunCleared(controlPlane.database, controlPlane.cloud.configured)) { showMainWindow(); return }
  await summonLiveComputerCapsule('guide')
}

/**
 * The "do it here" hotkey, the acting twin of the Guide summon. It always
 * resolves the surface under focus first: a new window or tab gets its own
 * conversation, and a surface Carve already knows gets its conversation back
 * exactly as it was left. On the same surface, with a Guide answer on screen,
 * it takes the Turn into task handoff; with a paused task it resumes it; with
 * the task capsule open it dismisses it. No path skips plan approval.
 */
async function toggleLiveComputerDoIt(): Promise<void> {
  if (controlPlane && !firstRunCleared(controlPlane.database, controlPlane.cloud.configured)) { showMainWindow(); return }
  await summonLiveComputerCapsule('work')
}

/** Submit through the shared conversation policy; explicit handoffs use the existing execution controller. */
function askGuideFromCapsule(ask: NonNullable<typeof liveComputerAskMode>, text: string): void {
  if (!controlPlane) return
  ask.question = text
  // Submission sets the shared busy state synchronously. Rendering a second
  // local Guide state here used to flash the old form and answer during handoff.
  const pending = controlPlane.assistance.submit(text, ask.target)
  syncLiveComputerOverlay()
  void pending.then(() => {
    const nextTask = controlPlane?.assistance.snapshot().newTask
    if (nextTask) { openFreshWorkRequest(nextTask.goal, 'balanced'); return }
    syncLiveComputerOverlay()
  }).catch((error: unknown) => {
    controlPlane?.audit.append('computer.guide_capsule_failed', 'system', null, { error: String(error instanceof Error ? error.message : error).slice(0, 500) })
    syncLiveComputerOverlay()
  })
}

/** Attach to the frontmost surface and open (or re-aim, or dismiss) the
 * capsule on it. This is the only entry point the hotkeys use. */
async function summonLiveComputerCapsule(intent: 'guide' | 'work'): Promise<void> {
  if (process.platform !== 'darwin' || !controlPlane) return
  if (controlPlane.cloud.configured && !controlPlane.cloud.status().signedIn) {
    // An unreachable Carve Cloud used to reject out of this hotkey handler, so the press did nothing and said nothing
    // (1 October: every summon failed while the configured cloud was down). Say why, in the main window.
    let account: Awaited<ReturnType<typeof controlPlane.cloud.refresh>>
    try { account = await controlPlane.cloud.refresh() } catch (error) {
      controlPlane.audit.append('computer.summon_cloud_unreachable', 'system', null, { intent, error: String(error instanceof Error ? error.message : error).slice(0, 300) })
      showMainWindow(); sendMainWindowNotice('Carve couldn’t reach Carve Cloud to check your account. Check your connection and try again.')
      return
    }
    if (!account.signedIn) { showMainWindow(); sendMainWindowNotice(account.lastError ? 'Carve couldn’t reach Carve Cloud to check your account. Check your connection and try again.' : 'Sign in to Carve to get started.'); return }
  }
  const found = await frontmostLiveComputerAskTarget()
  // Every summon is audited with the window it resolved and the branch it
  // took. On 20 September the hotkey "did nothing" on a new window while a
  // task was running in another, and nothing recorded which window the press
  // had resolved to; the working window is re-activated before each input,
  // so a press meant for the new window can land on the old one.
  const universal = controlPlane.universalComputerSession()
  const audit = (outcome: string, extra: Record<string, unknown> = {}) => controlPlane?.audit.append('computer.capsule_summoned', 'user', null, {
    intent, outcome, ...(found ? { via: found.via, windowId: found.target.windowId, bundleIdentifier: found.target.bundleIdentifier, application: found.target.application } : {}),
    ...(universal ? { universalStatus: universal.status, universalWindowId: universal.target.windowId, universalBundleIdentifier: universal.target.bundleIdentifier } : {}),
    capsuleOpen: Boolean(liveComputerAskMode), capsuleHeld: liveComputerCapsuleHeld(), ...extra,
  })
  if (!found) {
    // Carve itself is frontmost (the person is typing in the capsule), or no
    // window could be identified. With a capsule up, the press toggles it.
    const open = liveComputerAskMode
    if (open && liveComputerCapsuleHeld()) {
      audit(open.intent === intent ? 'toggled_off' : 'switched', { resolved: 'carve_or_none' })
      if (open.intent === intent) dismissSummonedCapsule()
      else await switchSummonedIntent(open, intent)
      return
    }
    audit('no_window', { resolved: 'carve_or_none' })
    showMainWindow()
    sendMainWindowNotice(intent === 'guide'
      ? `Switch to the window you have a question about, then press ${humanAccelerator(guideShortcut)}.`
      : `Switch to the window where the work should happen, then press ${humanAccelerator(doItShortcut ?? guideShortcut)}.`, 'info')
    return
  }
  const document = probeSurfaceIdentity(found.target)
  const previous = controlPlane.attachments.current()
  let attachment: Attachment
  try {
    attachment = controlPlane.attachSurface(found.target, document, intent)
  } catch (error) {
    audit('attach_failed', { error: String(error instanceof Error ? error.message : error).slice(0, 300) })
    sendMainWindowNotice(error instanceof Error ? error.message : String(error), 'warning')
    return
  }
  if (attachment.key.windowId === found.target.windowId) surfaceTitles.set(windowKey(attachment.key), found.target.title)
  if (attachment.id !== currentAttachmentId) {
    swapCapsuleState(currentAttachmentId, attachment.id)
    currentAttachmentId = attachment.id
  }
  const sameSurfaceAsBefore = previous?.id === attachment.id
  const interaction = controlPlane.assistance.snapshot()
  const summonDetail = { attachmentId: attachment.id, previousAttachmentId: previous?.id ?? null, sameSurfaceAsBefore }
  if (interaction.active) {
    // This surface's own task: Guide pauses it, Do it resumes it. A Do-it
    // press on a task that is already running changes nothing, so the press
    // is answered by opening the Card: the person pressed a key and sees the
    // task they pressed it on, with its controls, instead of nothing.
    audit('own_task', { ...summonDetail, taskStatus: interaction.status })
    await controlPlane.assistance.select(intent === 'guide' ? 'guide' : 'do').catch(error => sendLiveComputerOverlayNotice(String(error)))
    liveComputerAskFocusPending = intent === 'guide'
    if (intent === 'work') {
      liveComputerOverlayEngaged = true
      liveComputerOverlayPointerOnControl = false
      liveComputerOverlayEngagedAt = Date.now() - liveComputerOverlayExpandDelayMs
    }
    liveComputerOverlayDismissedTerminalSessionId = null
    syncLiveComputerOverlay()
    return
  }
  const open = liveComputerAskMode
  if (open && sameSurfaceAsBefore) {
    audit(open.intent === intent ? 'toggled_off' : 'switched', summonDetail)
    if (open.intent === intent) { dismissSummonedCapsule(); return }
    await switchSummonedIntent(open, intent)
    return
  }
  audit('opened', summonDetail)
  const session = controlPlane.liveComputer.session()
  const ownSession = session && controlPlane.attachments.forSession(session.id)?.id === attachment.id
  // A finished task's capsule yields to an explicit new summon on its surface.
  if (ownSession && session.status === 'completed') liveComputerOverlayDismissedTerminalSessionId = session.id
  liveComputerAskMode = open && sameSurfaceAsBefore
    ? open
    : { ...found, intent, guide: { state: 'idle', answer: null, failure: null, sequence: 0 }, question: null, requestSequence: 0 }
  liveComputerAskMode.intent = intent
  try {
    controlPlane.assistance.open(found.target, intent === 'guide' ? 'guide' : 'do')
  } catch (error) {
    sendLiveComputerOverlayNotice(error instanceof Error ? error.message : String(error))
  }
  liveComputerAskFocusPending = true
  liveComputerOverlayEngaged = true
  syncLiveComputerOverlay()
}

function dismissSummonedCapsule(): void {
  controlPlane?.assistance.dismiss()
  liveComputerAskMode = null
  liveComputerAskFocusPending = false
  syncLiveComputerOverlay()
}

/** The window selection stands; only the question the capsule asks changes,
 * and the conversation remains available across the handoff. Do it over a
 * Guide answer takes the Turn into task path the chip takes. */
async function switchSummonedIntent(open: LiveComputerAskState, intent: 'guide' | 'work'): Promise<void> {
  if (!controlPlane) return
  open.intent = intent
  const snapshot = controlPlane.assistance.snapshot()
  if (intent === 'work' && snapshot.guide.answer) await controlPlane.assistance.select('do').catch(error => sendLiveComputerOverlayNotice(String(error)))
  else controlPlane.assistance.open(open.target, intent === 'guide' ? 'guide' : 'do')
  open.requestSequence += 1
  liveComputerAskFocusPending = true
  liveComputerOverlayEngaged = true
  syncLiveComputerOverlay()
}

/** Once a task has been submitted from the capsule the person is done
 * typing, so keyboard focus goes back to the window the task is about. The
 * frame reads that window as focused again and stays visible through
 * planning instead of hiding until the plan is ready. */
function returnFocusToTarget(target: LiveComputerTarget): void {
  if (!liveInputBridge?.focusWindow) return
  const state = readLiveComputerOverlayWindowState(target)
  if (!state.available || !state.bounds) return
  try {
    liveInputBridge.focusWindow(JSON.stringify({
      bounds: state.bounds,
      target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier },
    }))
    liveComputerOverlayEngaged = false
  } catch {
    // The frame simply waits for the plan capsule, which survives focus loss.
  }
}

/** The hosted provider Guide would use, when its frame-sharing consent is
 * the one thing missing; null when Guide is ready or something else is wrong. */
function guideConsentNeeded(): { providerId: string; providerName: string; catalog?: boolean } | null {
  const authority = controlPlane?.guideAuthority(liveComputerAskMode?.target)
  if (!authority?.providerId) return null
  const assistance = controlPlane?.assistance.snapshot()
  const work = liveComputerAskMode?.intent === 'work' || assistance?.mode === 'do' || /app-name sharing/u.test(assistance?.guide.failure ?? '')
  const catalog = work && !controlPlane?.catalogSharingAllowed(authority.providerId)
  if (authority.ready && !catalog) return null
  return { providerId: authority.providerId, providerName: authority.providerName ?? authority.providerId, catalog }
}

/** Controller-authored copy for the main window's toast rail. */
function sendMainWindowNotice(text: string, tone: 'accent' | 'positive' | 'danger' | 'neutral' | 'warning' | 'info' = 'info'): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steward:notice', { text: text.slice(0, 300), tone })
}

/** Controller-authored copy for the capsule. Silent when no capsule is up. */
function sendLiveComputerOverlayNotice(text: string): void {
  if (liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
    liveComputerOverlay.webContents.send('steward:live-overlay-notice', { text: text.slice(0, 300) })
  }
}

/** The Turn into task handoff, shared by the capsule chip and the Do-it
 * hotkey: the question and its answer become a goal, and the goal enters the
 * ordinary supervised Work flow — in the capsule when a live session has
 * already granted a provider and consent this app run, otherwise in the Work
 * window that collects them, pre-filled. */
function startGuideDelegation(ask: NonNullable<typeof liveComputerAskMode>, notice: (text: string) => void): void {
  if (!controlPlane || ask.guide.state !== 'answered' || !ask.guide.answer || !ask.question) return
  let goal: string
  try {
    goal = controlPlane.guideDelegationGoal(ask.question, ask.guide.answer)
  } catch (error) {
    notice(error instanceof Error ? error.message : String(error))
    return
  }
  // The summon already carries the window selection, so the handoff stays in
  // the capsule: the mission plan is reviewed and approved right here. Only a
  // missing provider or missing frame-sharing consent stops it, and that is
  // reported as capsule copy rather than a trip to the Carve window.
  const target = ask.target
  returnFocusToTarget(target)
  void controlPlane.assistance.delegate(goal)
    .then(() => { if (liveComputerAskMode === ask) ask.workPending = false; syncLiveComputerOverlay() })
    .catch((error: unknown) => {
      controlPlane?.audit.append('computer.hotkey_ask_failed', 'system', null, { error: String(error).slice(0, 500), source: 'guide_do_it' })
      notice(error instanceof Error ? error.message : String(error))
    })
}

async function frontmostLiveComputerAskTarget(): Promise<{ target: LiveComputerTarget; bounds: LiveComputerOverlayRect; via: 'frontmost' | 'scan' } | null> {
  if (!controlPlane || !liveInputBridge?.windowState) return null
  // The Window Server's front-to-back order names the frontmost normal window
  // directly. That beats probing every listed window: a Chrome profile with
  // many windows, or a window the picker's per-app cap left out, no longer
  // makes the summon land on the wrong window.
  const probe = probeSurfaces([])
  const front = probe?.frontmost
  if (front) {
    if (front.bundleIdentifier === 'app.carve.desktop') return null
    const candidate: LiveComputerTarget | null = front.bundleIdentifier
      ? { windowId: front.windowId, bundleIdentifier: front.bundleIdentifier, application: front.application ?? front.bundleIdentifier, title: front.title ?? front.application ?? front.bundleIdentifier, bounds: { ...front.bounds } }
      : null
    if (candidate) {
      try {
        const parsed = JSON.parse(liveInputBridge.windowState(JSON.stringify({
          target: { windowId: candidate.windowId, bundleIdentifier: candidate.bundleIdentifier },
        }))) as Partial<LiveComputerOverlayWindowState>
        if (parsed.available === true && parsed.focused === true && parsed.bounds && validOverlayRect(parsed.bounds)) {
          return { target: { ...structuredClone(candidate), bounds: { ...parsed.bounds } }, bounds: { ...parsed.bounds }, via: 'frontmost' }
        }
      } catch {
        // Fall through to the exhaustive scan.
      }
    }
  }
  let frontmostBundle: string | null = null
  if (liveInputBridge.frontmostApplication) {
    try {
      const parsed = JSON.parse(liveInputBridge.frontmostApplication()) as { bundleIdentifier?: string | null }
      frontmostBundle = typeof parsed.bundleIdentifier === 'string' ? parsed.bundleIdentifier : null
    } catch {
      frontmostBundle = null
    }
  }
  if (frontmostBundle === 'app.carve.desktop') return null
  // The separate picker helper is only needed when the direct native probe
  // could not verify a target. Do not put process startup on every hotkey.
  const targets = await controlPlane.listLiveComputerTargets().catch(() => [] as LiveComputerTarget[])
  const ordered = frontmostBundle
    ? [...targets.filter((entry) => entry.bundleIdentifier === frontmostBundle), ...targets.filter((entry) => entry.bundleIdentifier !== frontmostBundle)]
    : targets
  for (const candidate of ordered) {
    if (candidate.bundleIdentifier === 'app.carve.desktop') continue
    try {
      const parsed = JSON.parse(liveInputBridge.windowState(JSON.stringify({
        target: { windowId: candidate.windowId, bundleIdentifier: candidate.bundleIdentifier },
      }))) as Partial<LiveComputerOverlayWindowState>
      if (parsed.available === true && parsed.focused === true && parsed.bounds && validOverlayRect(parsed.bounds)) {
        return { target: structuredClone(candidate), bounds: { ...parsed.bounds }, via: 'scan' }
      }
    } catch {
      // A single unreadable window must not abort the search.
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Attachments: Carve follows the person across windows and tabs.
//
// Every tick probes all attached windows in one native call, feeds the
// registry an observation per window, lets the control plane move the live
// slot to the current attachment, and keeps the shell's capsule state per
// attachment so returning to a window finds its capsule as it was left.

interface SurfaceStateEntry extends LiveComputerOverlayWindowState {
  onScreen: boolean
  title: string | null
  /** Parts of the window no other normal-level window covers, in screen points. */
  visible: LiveComputerOverlayRect[]
}

interface SurfaceProbe {
  states: Map<string, SurfaceStateEntry>
  /** First normal-level window in the Window Server's front-to-back order. */
  frontmost: { windowId: number; bundleIdentifier: string | null; application: string | null; bounds: LiveComputerOverlayRect; title: string | null } | null
  inputAgeMs: number | null
}

function probeSurfaces(windows: Array<{ windowId: number; bundleIdentifier: string }>): SurfaceProbe | null {
  if (!liveInputBridge?.surfaceStates) return null
  const targets = windows.slice(0, 16)
  try {
    const parsed = JSON.parse(liveInputBridge.surfaceStates(JSON.stringify({ targets: targets.map((entry) => ({ windowId: entry.windowId, bundleIdentifier: entry.bundleIdentifier })) }))) as {
      states?: unknown[]; frontmost?: Record<string, unknown> | null; inputAgeMs?: unknown
    }
    const states = new Map<string, SurfaceStateEntry>()
    targets.forEach((target, index) => {
      const raw = (Array.isArray(parsed.states) ? parsed.states[index] : null) as Partial<SurfaceStateEntry> | null
      const bounds = raw?.bounds
      if (raw?.available === true && bounds && validOverlayRect(bounds)) {
        states.set(windowKey(target), {
          available: true, focused: raw.focused === true, frontmostNormal: raw.frontmostNormal === true, onScreen: raw.onScreen === true,
          bounds: { ...bounds }, title: typeof raw.title === 'string' ? raw.title.slice(0, 240) : null,
          visible: Array.isArray(raw.visible) ? raw.visible.filter(validOverlayRect).map((rect) => ({ ...rect })) : [],
          ...(typeof parsed.inputAgeMs === 'number' && Number.isFinite(parsed.inputAgeMs) ? { inputAgeMs: parsed.inputAgeMs } : {}),
        })
      } else states.set(windowKey(target), { available: false, focused: false, onScreen: false, bounds: null, title: null, visible: [] })
    })
    const front = parsed.frontmost
    const frontmost = front && typeof front.windowId === 'number' && validOverlayRect(front.bounds)
      ? { windowId: front.windowId, bundleIdentifier: typeof front.bundleIdentifier === 'string' ? front.bundleIdentifier : null,
          application: typeof front.application === 'string' ? front.application : null, bounds: { ...front.bounds },
          title: typeof front.title === 'string' ? front.title.slice(0, 240) : null }
      : null
    return { states, frontmost, inputAgeMs: typeof parsed.inputAgeMs === 'number' ? parsed.inputAgeMs : null }
  } catch {
    // Presence is advisory; a failed probe hides frames rather than guessing.
    return null
  }
}

/** The document a window shows, as a fingerprint the native layer computed.
 * Null when the window is gone; `titled` when the app exposes no document. */
function probeSurfaceIdentity(target: Pick<LiveComputerTarget, 'windowId' | 'bundleIdentifier' | 'title'>): SurfaceDocument | null {
  if (!liveInputBridge?.surfaceIdentity) return null
  try {
    const parsed = JSON.parse(liveInputBridge.surfaceIdentity(JSON.stringify({ target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier } }))) as {
      available?: unknown; kind?: unknown; fingerprint?: unknown; displayTitle?: unknown; tab?: { index?: unknown; count?: unknown } | null
    }
    if (parsed.available !== true) return null
    const displayTitle = (typeof parsed.displayTitle === 'string' && parsed.displayTitle ? parsed.displayTitle : target.title).slice(0, 120)
    const fingerprint = typeof parsed.fingerprint === 'string' && /^[0-9a-f]{64}$/u.test(parsed.fingerprint) ? parsed.fingerprint : ''
    const kind = (parsed.kind === 'web' || parsed.kind === 'file') && fingerprint ? parsed.kind : 'titled'
    const tab = parsed.tab && typeof parsed.tab.index === 'number' && typeof parsed.tab.count === 'number' && parsed.tab.count > 0 && parsed.tab.index >= 0
      ? { index: parsed.tab.index, count: parsed.tab.count } : null
    return kind === 'titled' ? { kind, fingerprint: '', displayTitle } : { kind, fingerprint, displayTitle, tab }
  } catch {
    return null
  }
}

function attachedWindows(): Array<{ windowId: number; bundleIdentifier: string }> {
  const seen = new Map<string, { windowId: number; bundleIdentifier: string }>()
  for (const attachment of controlPlane?.attachments.list() ?? []) {
    const key = windowKey(attachment.key)
    if (!seen.has(key)) seen.set(key, { windowId: attachment.key.windowId, bundleIdentifier: attachment.key.bundleIdentifier })
  }
  return [...seen.values()]
}

/** One observation per attached window per tick. The document is re-read only
 * when the window title changed, which is what a tab switch or navigation
 * does, so steady state costs one batch probe and no accessibility calls. */
function syncAttachments(): void {
  if (!controlPlane || process.platform !== 'darwin') return
  const registry = controlPlane.attachments
  const attachments = registry.list()
  const windows = attachedWindows()
  const probe = windows.length > 0 || presenceOverlays.size > 0 ? probeSurfaces(windows) : null
  lastSurfaceProbe = probe
  if (probe) {
    const observations: SurfaceObservation[] = windows.map((window) => {
      const key = windowKey(window)
      const state = probe.states.get(key)
      const present = Boolean(state?.available)
      const title = state?.title ?? null
      let document: SurfaceDocument | null | undefined
      if (!present) surfaceTitles.delete(key)
      else if (title !== null && surfaceTitles.get(key) !== title) {
        surfaceTitles.set(key, title)
        const documented = attachments.some((attachment) => windowKey(attachment.key) === key && attachment.key.document && attachment.key.document.kind !== 'titled')
        if (documented) document = probeSurfaceIdentity({ ...window, title })
      }
      return { ...window, present, focused: Boolean(state?.focused), bounds: state?.bounds ?? null, title, ...(document === undefined ? {} : { document }) }
    })
    registry.observe(observations)
  }
  controlPlane.reconcileAttachments()
  const current = registry.current()?.id ?? null
  if (current !== currentAttachmentId) {
    swapCapsuleState(currentAttachmentId, current)
    currentAttachmentId = current
  }
}

/** The shell's capsule state belongs to one attachment. Leaving it puts the
 * state away; returning restores it, so the capsule reappears as it was. */
function swapCapsuleState(before: string | null, after: string | null): void {
  if (before) {
    if (liveComputerAskMode) attachmentCapsules.set(before, liveComputerAskMode)
    else attachmentCapsules.delete(before)
  }
  liveComputerAskMode = after ? attachmentCapsules.get(after) ?? null : null
  if (after) attachmentCapsules.delete(after)
  const target = after ? controlPlane?.attachments.get(after)?.target : null
  if (liveComputerAskMode && target) liveComputerAskMode.target = structuredClone(target)
  liveComputerOverlayEngaged = false
  liveComputerAskFocusPending = false
  liveComputerOverlayCue = null
  syncLiveComputerOverlay()
}

/** What a background frame says about its attachment. A parked session that
 * Carve paused itself is `waiting`: it wants its window back. */
function presenceForAttachment(attachment: Attachment): PresenceFrameState {
  if (!controlPlane) return 'background'
  const parked = attachment.sessionId ? controlPlane.parkedLiveSessionSummaries().find((entry) => entry.sessionId === attachment.sessionId) : null
  // Use exactly the foreground presentation and classifier for a live
  // session. Universal's running status alone does not mean input is acting.
  const live = controlPlane.liveComputer.session()
  if (attachment.sessionId && live?.id === attachment.sessionId) {
    return framePresence(buildLiveComputerOverlayPresentation(live, null, humanShortcut()))
  }
  const universal = controlPlane.universalComputerSession()
  if (attachment.sessionId && universal?.id === attachment.sessionId) {
    return framePresence(buildUniversalComputerOverlayPresentation(universal, humanShortcut()))
  }
  // Parked sessions have no admitted input; never infer work from an old phase.
  if (parked) {
    if (parked.status === 'paused') return parked.autoResume ? 'waiting' : 'paused'
    if (parked.status === 'completed') return 'complete'
    if (['awaiting_plan_approval', 'awaiting_approval', 'awaiting_context_transfer', 'awaiting_guidance', 'blocked', 'handoff'].includes(parked.status)) return 'attention'
    return parked.autoResume ? 'waiting' : 'background'
  }
  return attachment.presence === 'waiting' ? 'waiting' : 'background'
}

function ensurePresenceOverlay(display: Electron.Display): { window: BrowserWindow; ready: boolean } {
  const existing = presenceOverlays.get(display.id)
  if (existing && !existing.window.isDestroyed()) return existing
  const entry = { window: new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: process.platform !== 'darwin',
    focusable: false, enableLargerThanScreen: true,
    webPreferences: { preload: presenceOverlayPreloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: false, backgroundThrottling: false },
  }), ready: false }
  preserveMacOSDockPresence()
  // Decorative only: every pixel is click-through, always, and the window can
  // never take focus. It has no inbound command channel at all.
  entry.window.setIgnoreMouseEvents(true)
  entry.window.setAlwaysOnTop(true, 'floating', 1)
  entry.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  entry.window.setHiddenInMissionControl(true)
  entry.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  entry.window.webContents.on('will-navigate', (event) => event.preventDefault())
  entry.window.webContents.once('did-finish-load', () => { entry.ready = true; syncPresenceOverlays() })
  entry.window.on('closed', () => { if (presenceOverlays.get(display.id) === entry) presenceOverlays.delete(display.id) })
  void entry.window.loadFile(presenceOverlayPath)
  presenceOverlays.set(display.id, entry)
  return entry
}

function closePresenceOverlays(): void {
  for (const entry of presenceOverlays.values()) if (!entry.window.isDestroyed()) entry.window.close()
  presenceOverlays.clear()
}

/** Frames for every attachment the capsule is not framing, one overlay per
 * display, each frame clipped to the part of its window that is actually
 * visible. A fully covered or off-screen window draws nothing. */
function syncPresenceOverlays(): void {
  if (!controlPlane || process.platform !== 'darwin') return
  const probe = lastSurfaceProbe
  const capsuleVisible = Boolean(liveComputerOverlay && !liveComputerOverlay.isDestroyed() && liveComputerOverlay.isVisible())
  const byDisplay = new Map<number, { display: Electron.Display; frames: Array<{ id: string; rect: LiveComputerOverlayRect; visible: LiveComputerOverlayRect[]; presence: PresenceFrameState }> }>()
  const framedWindows = new Set<string>()
  if (probe) {
    // Several attachments on one window (tabs) share one frame; the one that
    // owns a session, else the most recent, decides its state.
    const ordered = controlPlane.attachments.list().sort((left, right) => Number(Boolean(right.sessionId)) - Number(Boolean(left.sessionId)))
    for (const attachment of ordered) {
      const key = windowKey(attachment.key)
      if (attachment.presence === 'lost' || framedWindows.has(key)) continue
      const state = probe.states.get(key)
      if (!state?.available || !state.onScreen || !state.bounds || state.visible.length === 0) continue
      if (capsuleVisible && capsuleFrameAttachmentId && windowKey(controlPlane.attachments.get(capsuleFrameAttachmentId)?.key ?? { bundleIdentifier: '', windowId: 0 }) === key) continue
      framedWindows.add(key)
      const display = screen.getDisplayMatching(integerRectangle(state.bounds))
      const local = (rect: LiveComputerOverlayRect): LiveComputerOverlayRect => ({ x: rect.x - display.bounds.x, y: rect.y - display.bounds.y, width: rect.width, height: rect.height })
      const entry = byDisplay.get(display.id) ?? { display, frames: [] }
      entry.frames.push({ id: attachment.id, rect: local(state.bounds), visible: state.visible.map(local), presence: presenceForAttachment(attachment) })
      byDisplay.set(display.id, entry)
    }
  }
  for (const [displayId, entry] of byDisplay) {
    const overlay = ensurePresenceOverlay(entry.display)
    if (overlay.window.isDestroyed()) { presenceOverlays.delete(displayId); continue }
    const bounds = overlay.window.getBounds()
    if (bounds.x !== entry.display.bounds.x || bounds.y !== entry.display.bounds.y || bounds.width !== entry.display.bounds.width || bounds.height !== entry.display.bounds.height) {
      overlay.window.setBounds(entry.display.bounds, false)
    }
    if (!overlay.ready) continue
    overlay.window.webContents.send('steward:presence-state', { frames: entry.frames })
    if (!overlay.window.isVisible()) overlay.window.showInactive()
  }
  for (const [displayId, overlay] of presenceOverlays) {
    if (byDisplay.has(displayId) || overlay.window.isDestroyed()) continue
    if (overlay.ready) overlay.window.webContents.send('steward:presence-state', { frames: [] })
    if (overlay.window.isVisible()) overlay.window.hide()
  }
}

function registerIpc(): void {
  ipcMain.on('steward:show-capsule', (event: IpcMainEvent) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !controlPlane) return
    const interaction = controlPlane.assistance.snapshot()
    if (interaction.target && (interaction.showGuide || !interaction.active)) {
      const state = readLiveComputerOverlayWindowState(interaction.target)
      if (!state.available || !state.bounds) return
      controlPlane.assistance.reveal()
      liveComputerAskMode = { target: interaction.target, bounds: state.bounds, intent: interaction.showGuide ? 'guide' : 'work', guide: interaction.guide, question: interaction.question, requestSequence: 0 }
      liveComputerAskFocusPending = true
      returnFocusToTarget(interaction.target)
      syncLiveComputerOverlay()
      return
    }
    const universal = controlPlane.universalComputerSession()
    const live = controlPlane.liveComputer.session()
    const session = universal && (!live || universal.updatedAt >= live.updatedAt) ? universal : live
    if (!session) return
    liveComputerOverlayDismissedTerminalSessionId = null
    liveComputerCapsulePresentedSessionId = null
    liveComputerCapsuleTransitionSessionId = session.id
    returnFocusToTarget(session.target)
    syncLiveComputerOverlay()
    // If no work window can be raised, retain the full app as the status owner.
  })
  ipcMain.on('steward:observer-stop', (event: IpcMainEvent) => {
    if (!isTrustedObserverHudSender(event)) return
    stopObservationFromHud()
  })
  ipcMain.on('steward:live-overlay-command', (event: IpcMainEvent, raw: unknown) => {
    // Only the overlay's own renderer may speak on this channel, every payload
    // is re-validated here, and each command is honored only in the capsule
    // state that offers it. Universal steering is the one executing-state
    // exception and always passes through the controller interruption gate.
    if (!liveComputerOverlay || liveComputerOverlay.isDestroyed() || event.sender !== liveComputerOverlay.webContents) return
    const command = parseLiveComputerOverlayCommand(raw)
    if (!command || !controlPlane) return
    if (command.kind === 'voice_enabled') {
      capsuleVoice?.setEnabled(command.enabled)
      saveVoiceSettings()
      if (voiceSaveError) sendLiveComputerOverlayNotice(voiceSaveError)
      return
    }
    if (command.kind === 'voice_playback') { capsuleVoice?.playback(command.id, command.state); return }
    if (command.kind === 'result_link') {
      if (presentedResultLinks?.sessionId !== command.sessionId || !presentedResultLinks.urls.includes(command.url)) return
      void shell.openExternal(command.url).catch(() => sendLiveComputerOverlayNotice('This link could not open.'))
      return
    }
    if (command.kind === 'voice_listening') { capsuleVoice?.setListening(command.enabled); previewVoice?.setListening(command.enabled); return }
    if (['stop', 'dismiss', 'expand', 'pause', 'guide_ask', 'ask', 'follow_up', 'steer', 'assistance_mode'].includes(command.kind)) capsuleVoice?.stop(command.kind)

    const session = controlPlane.liveComputer.session()
    const universal = controlPlane.universalComputerSession()
    const sessionInteractive = Boolean(session && (session.status === 'completed' || session.status === 'awaiting_plan_approval' || session.status === 'awaiting_guidance' || session.status === 'paused' || capsuleDecision(session, null)))
    const universalSteeringInteractive = Boolean(universal && ['starting', 'running', 'pausing', 'paused', 'awaiting_steering_review', 'awaiting_budget', 'replanning'].includes(universal.status))
    const universalBudgetInteractive = universal?.status === 'awaiting_budget' && Boolean(universal.pendingBudgetCheckpoint)
    const universalFailureInteractive = universal?.status === 'blocked'
    const universalDecisionInteractive = Boolean(universal && capsuleDecision(null, universal, universal.pendingCheckpointId ? controlPlane.database.getCheckpointDecision(universal.pendingCheckpointId) : null, universal.pendingCheckpointId ? controlPlane.checkpoints.livePreview(universal.pendingCheckpointId) : null))
    const universalInteractive = Boolean(universal?.pendingPlanReview) || universalSteeringInteractive || universalBudgetInteractive || universalFailureInteractive || universalDecisionInteractive || universal?.status === 'completed'
    const askActive = Boolean(liveComputerAskMode) || Boolean(controlPlane.applicationHandoff.snapshot() && !['completed', 'cancelled'].includes(controlPlane.applicationHandoff.snapshot()!.status))

    // Pointer engagement and stop are honored in every state: hovering the
    // capsule must reach the page while a session executes so its Stop
    // control is clickable, and stopping is the same fail-safe as the global
    // shortcut — both only ever reduce what Carve does.
    if (command.kind === 'minimize') {
      if (command.minimized && !liveComputerOverlayMinimizeAvailable) return
      liveComputerOverlayMinimized = command.minimized
      // Restoring is a click on the orb, so the pointer is on the capsule: keep it engaged. Clearing engagement here made the
      // visibility rule (liveComputerCapsuleVisible) depend on the page window still being focused, and pressing the orb
      // activates Carve, so the restored capsule of a finished task hid itself (29 September).
      liveComputerOverlayEngaged = !command.minimized
      if (!command.minimized) {
        liveComputerOverlayEngagedAt = Date.now() - liveComputerOverlayExpandDelayMs
        liveComputerOverlayPointerOnControl = false
      }
      if (command.minimized) {
        const target = controlPlane.assistance.snapshot().target ?? liveComputerAskMode?.target ?? universal?.target ?? session?.target
        if (target) returnFocusToTarget(target)
      } else {
        // Recorded so a capsule that still disappears on restore can be explained from the audit.
        const target = controlPlane.assistance.snapshot().target ?? liveComputerAskMode?.target ?? universal?.target ?? session?.target
        controlPlane.audit.append('computer.capsule_restore', 'user', null, { canShow: target ? canShowLiveComputerCapsule(target) : null, sessionStatus: session?.status ?? null, universalStatus: universal?.status ?? null })
      }
      syncLiveComputerOverlay()
      return
    }
    if (command.kind === 'capsule_position') {
      const context = liveComputerCapsulePositionContext
      if (!context || !context.attached || context.sessionId !== command.sessionId || !liveComputerOverlay.isVisible() || liveComputerDrawingCapture) return
      if (command.phase === 'start') {
        if (liveComputerCapsuleDrag) return
        liveComputerCapsuleDrag = { previous: liveComputerCapsulePosition, sessionId: command.sessionId }
        liveComputerOverlayEngaged = true
        liveComputerOverlayPointerOnControl = true
      } else if (command.phase === 'cancel') {
        if (!liveComputerCapsuleDrag || liveComputerCapsuleDrag.sessionId !== command.sessionId) return
        liveComputerCapsulePosition = liveComputerCapsuleDrag.previous
        liveComputerCapsuleDrag = null
      } else if (command.phase === 'reset') {
        liveComputerCapsulePosition = null
        liveComputerCapsuleDrag = null
      }
      if (command.phase === 'start' || command.phase === 'end') {
        // Coordinates only reposition Carve's own chrome. They are never input
        // coordinates for the target, and carry no action authority.
        liveComputerCapsulePosition = { x: command.x - context.bounds.x, y: command.y - context.bounds.y }
        if (command.phase === 'end') liveComputerCapsuleDrag = null
      }
      syncLiveComputerOverlay()
      return
    }
    if (command.kind === 'pointer') {
      if (mainWindowOwnsInteraction()) { hideLiveComputerOverlay(); return }
      const target = controlPlane.assistance.snapshot().target
        ?? liveComputerAskMode?.target ?? liveComputerPendingStart?.target ?? universal?.target ?? session?.target
      if (command.engaged && !liveComputerOverlayDetached && (!target || !canShowLiveComputerCapsule(target))) {
        controlPlane.audit.append('computer.capsule_hidden_on_pointer', 'system', null, { hasTarget: Boolean(target), sessionStatus: session?.status ?? null, universalStatus: universal?.status ?? null })
        hideLiveComputerOverlay()
        return
      }
      const changed = liveComputerOverlayEngaged !== command.engaged
      liveComputerOverlayEngaged = command.engaged || Boolean(liveComputerCapsuleDrag)
      liveComputerOverlayPointerOnControl = command.engaged && command.control === true
      if (changed) {
        if (command.engaged) liveComputerOverlayEngagedAt = Date.now()
        else liveComputerOverlayReleasedAt = Date.now()
      }
      applyLiveComputerOverlayInteractivity(liveComputerOverlay, sessionInteractive || universalInteractive || askActive)
      // The mouse is captured at once; the Line grows into the Card after
      // the intent delay and settles back after the linger, on the next
      // monitor ticks, so a pointer merely crossing the pill never opens it.
      if (changed) syncLiveComputerOverlay()
      return
    }
    if (command.kind === 'stop') {
      // Stop also cancels startup and background work when there is no live
      // session yet, or the capsule still displays an older terminal session.
      emergencyStop('capsule')
      return
    }

    if (command.kind === 'public_source') {
      if (command.runId !== controlPlane.assistance.snapshot().runId) return
      try { void shell.openExternal(controlPlane.publicSourceUrl(command.runId, command.url)).catch(error => sendLiveComputerOverlayNotice(String(error))) }
      catch (error) { sendLiveComputerOverlayNotice(String(error)) }
      return
    }
    if (command.kind === 'drawing_start') {
      void controlPlane.assistance.startDrawing().then(() => syncLiveComputerOverlay()).catch(error => sendLiveComputerOverlayNotice(String(error)))
      return
    }
    if (command.kind === 'drawing_capture') {
      const state = controlPlane.assistance.snapshot(), scene = state.guide.answer?.scene
      if (!command.active) {
        liveComputerDrawingCapture = null
        applyLiveComputerOverlayInteractivity(liveComputerOverlay, state.owner === 'user')
        return
      }
      if (!state.target || state.owner !== 'user' || state.preparing || state.guide.state !== 'answered' || !state.showGuide || !scene || scene.id !== command.sceneId || scene.revision !== command.revision || !canShowLiveComputerCapsule(state.target) || !state.guide.answer?.pointer && scene.objects.length > 0) {
        sendLiveComputerOverlayNotice('Update the marks before opening the drawing editor.')
        return
      }
      liveComputerDrawingCapture = { sceneId: scene.id, revision: scene.revision, expiresAt: Date.now() + 60_000 }
      applyLiveComputerOverlayInteractivity(liveComputerOverlay, true)
      liveComputerOverlay.focus()
      return
    }
    if (command.kind === 'drawing_edit') {
      void controlPlane.assistance.editDrawing(command.edit).then(() => syncLiveComputerOverlay()).catch(error => sendLiveComputerOverlayNotice(String(error)))
      return
    }
    if (command.kind === 'guide_clear') { controlPlane.assistance.invalidatePointer(); syncLiveComputerOverlay(); return }
    if (command.kind === 'assistance_approvals') {
      try { controlPlane.assistance.selectApprovalPreset(command.preset, command) }
      catch (error) { sendLiveComputerOverlayNotice(error instanceof Error ? error.message : String(error)) }
      syncLiveComputerOverlay()
      return
    }
    if (command.kind === 'assistance_mode') {
      void controlPlane.assistance.select(command.mode, command)
        .then(() => {
          liveComputerAskFocusPending = command.mode === 'guide'
          const current = controlPlane?.assistance.snapshot()
          if (command.mode === 'do' && current?.target) returnFocusToTarget(current.target)
          syncLiveComputerOverlay()
        })
        .catch(error => { sendLiveComputerOverlayNotice(error instanceof Error ? error.message : String(error)); syncLiveComputerOverlay() })
      syncLiveComputerOverlay()
      return
    }
    if (command.kind === 'follow_up_accept') {
      void controlPlane.assistance.acceptFollowUp(command)
        .then(() => syncLiveComputerOverlay())
        .catch(error => { sendLiveComputerOverlayNotice(error instanceof Error ? error.message : String(error)); syncLiveComputerOverlay() })
      syncLiveComputerOverlay()
      return
    }
    if (command.kind === 'guide_refresh') {
      void controlPlane.assistance.refreshGuide().then(() => syncLiveComputerOverlay()).catch(error => sendLiveComputerOverlayNotice(String(error)))
      return
    }
    // Deprecated clients cannot invent a step after an arbitrary answer.
    if (command.kind === 'guide_next' || command.kind === 'guide_step') return

    if (command.kind === 'presented') {
      if (mainWindowOwnsInteraction()) { hideLiveComputerOverlay(); return }
      const pending = liveComputerOverlayPendingPresentation
      if (!pending || command.presentationId !== pending.id || command.sessionId !== pending.sessionId) return
      // Focus can change while the renderer lays out an in-flight update.
      if (!pending.detached && !canShowLiveComputerCapsule(pending.target)) {
        // Focus changed after layout. Re-render busy status without a frame
        // instead of hiding it between this acknowledgement and the next tick.
        // A question for the person re-renders docked too (STEWARD_SWITCH_CHOICE_IN_CAPSULE): hiding it here left the
        // Explain-to-action choice unseen and the hidden capsule reading "Status connection lost" (assess-0929 C18 stop-edit).
        if (pending.working || pending.needsAnswer) syncLiveComputerOverlay()
        else hideLiveComputerOverlay()
        return
      }
      liveComputerOverlayPendingPresentation = null
      if (!liveComputerOverlay.isVisible()) liveComputerOverlay.showInactive()
      approvalVisibilityAudit.presented(pending.approval)
      focusPresentedLiveComputerCapsule()
      liveComputerCapsulePresentedSessionId = command.sessionId
      if (liveComputerCapsuleTransitionSessionId === command.sessionId) {
        liveComputerCapsuleTransitionSessionId = null
        mainWindow?.hide()
      }
      return
    }
    if (command.kind === 'pause' || command.kind === 'resume') {
      try {
        if (universal?.id === command.sessionId) {
          if (command.kind === 'pause') controlPlane.pauseUniversalComputerSession('text', 'capsule')
          else if (universal.status === 'paused') { controlPlane.resumeUniversalComputerSession(); returnFocusToTarget(universal.target) }
        } else if (session?.id === command.sessionId) {
          if (command.kind === 'pause') controlPlane.pauseLiveComputerSession('user_pause', 'capsule')
          else if (session.status === 'paused') { controlPlane.resumeLiveComputerSession(); returnFocusToTarget(session.target) }
        }
        syncLiveComputerOverlay()
      } catch (error) { sendLiveComputerOverlayNotice(error instanceof Error ? error.message : String(error)) }
      return
    }
    // Only ever the window this session already works in, and only on the
    // person's click: the turn gate then lets Carve continue once they are still.
    if (command.kind === 'show_window') {
      // The capsule's presentation id is not always the session id (the
      // assistance capsule is `ask:<window>`). The authority is the step the
      // gate is holding: raise that window only if a live session owns it.
      const held = personTurnGate.state()?.target
      const owned = held && [universal?.target, session?.target].some(owned => owned && owned.windowId === held.windowId && owned.bundleIdentifier === held.bundleIdentifier)
        ? (universal?.target.windowId === held.windowId ? universal.target : session!.target) : null
      if (owned) {
        returnFocusToTarget(owned)
        controlPlane.audit.append('computer.person_turn_handed_back', 'user', command.sessionId, { windowId: owned.windowId, bundleIdentifier: owned.bundleIdentifier })
      }
      syncLiveComputerOverlay()
      return
    }
    if (command.kind === 'handoff_decline') {
      void controlPlane.applicationHandoff.decide(command.taskId, command.revision, 'decline')
        .catch(error => sendLiveComputerOverlayNotice(String(error))).finally(() => syncLiveComputerOverlay())
      return
    }
    if (command.kind === 'approve_decision') {
      const handoff = controlPlane.applicationHandoff.snapshot()
      if (handoff?.id === command.sessionId) {
        void controlPlane.applicationHandoff.decide(command.id, command.revision, 'approve')
          .catch(error => sendLiveComputerOverlayNotice(String(error))).finally(() => syncLiveComputerOverlay())
        return
      }

      const checkpoint = universal?.pendingCheckpointId ? controlPlane.database.getCheckpointDecision(universal.pendingCheckpointId) : null
      const decision = capsuleDecision(session, universal, checkpoint, universal?.pendingCheckpointId ? controlPlane.checkpoints.livePreview(universal.pendingCheckpointId) : null)
      if (!matchesCapsuleDecision(decision, command) || liveComputerDecisionInFlight) {
        sendLiveComputerOverlayNotice('This decision changed or is already being processed. Review the current decision.')
        syncLiveComputerOverlay()
        return
      }
      liveComputerDecisionInFlight = command.id
      const target = decision!.kind === 'checkpoint' ? universal!.target : session!.target
      const app = controlPlane
      const work = async () => decision!.kind === 'checkpoint'
        ? dispatchCarveCommand(app, { kind: 'checkpoint.action', checkpointId: command.id, action: 'approve' })
        : app.executeLiveComputerAction('user', { sessionId: command.sessionId, actionId: command.id, planHash: command.revision })
      void handOffApprovedAction({
        release: () => {
          liveComputerOverlayEngaged = false
          liveComputerOverlayPointerOnControl = false
          if (liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
            liveComputerOverlay.setIgnoreMouseEvents(true, { forward: true })
            liveComputerOverlay.setFocusable(false)
            liveComputerOverlay.blur()
          }
        },
        focus: () => {
          const state = readLiveComputerOverlayWindowState(target)
          if (!liveInputBridge?.focusWindow || !state.available || !state.bounds) throw new Error('Carve could not return to the selected window. The approved action has not run. Bring that window forward and try again.')
          liveInputBridge.focusWindow(JSON.stringify({ bounds: state.bounds,
            target: { windowId: target.windowId, bundleIdentifier: target.bundleIdentifier } }))
        },
        approve: work,
      })
        .catch((error: unknown) => sendLiveComputerOverlayNotice(error instanceof Error ? error.message : String(error)))
        .finally(() => { liveComputerDecisionInFlight = null; syncLiveComputerOverlay() })
      return
    }
    if (command.kind === 'expand') {
      const handoff = controlPlane.applicationHandoff.snapshot()
      if (handoff && !['completed', 'cancelled'].includes(handoff.status)) {
        showMainWindow()
        mainWindow?.webContents.send('steward:open-active-work', { runId: handoff.runId })
        return
      }

      controlPlane.assistance.dismiss()
      if (session?.status === 'completed') liveComputerOverlayDismissedTerminalSessionId = session.id
      if (universal?.status === 'completed' || universal?.status === 'blocked') liveComputerOverlayDismissedTerminalSessionId = universal.id
      liveComputerAskMode = null
      closeLiveComputerOverlay()
      showMainWindow()
      mainWindow?.webContents.send('steward:open-active-work', { runId: computerSupervisionStatus(session, universal)?.runId ?? null })
      return
    }
    if (command.kind === 'guide_ask' && !liveComputerAskMode) {
      void controlPlane.assistance.submit(command.text).then(() => {
        const nextTask = controlPlane?.assistance.snapshot().newTask
        if (nextTask) { openFreshWorkRequest(nextTask.goal, 'balanced'); return }
        syncLiveComputerOverlay()
      }).catch(error => sendLiveComputerOverlayNotice(error instanceof Error ? error.message : String(error)))
      return
    }
    // Dictation is composer input, not a session action: the capsule's mic must
    // reach the control plane in the compose state too. Until 22 September these
    // three commands sat behind the active-ask guard, so a fresh capsule recorded
    // audio that never reached Deepgram and then waited forever for an end.
    const dictationCommand = command.kind === 'dictate_begin' || command.kind === 'dictate_push' || command.kind === 'dictate_end'
    if (!sessionInteractive && !universalInteractive && !askActive && !dictationCommand) return
    const overlayNotice = sendLiveComputerOverlayNotice
    if (command.kind === 'dismiss') {
      controlPlane.assistance.dismiss()
      if (session?.status === 'completed') liveComputerOverlayDismissedTerminalSessionId = session.id
      if (universal?.status === 'completed' || universal?.status === 'blocked') liveComputerOverlayDismissedTerminalSessionId = universal.id
      liveComputerAskMode = null
      if (!sessionInteractive || session?.status === 'completed' || universal?.status === 'completed' || universal?.status === 'blocked') closeLiveComputerOverlay()
      return
    }
    const sendDictation = (payload: Record<string, unknown>) => {
      if (liveComputerOverlay && !liveComputerOverlay.isDestroyed()) {
        liveComputerOverlay.webContents.send('steward:live-overlay-dictation', payload)
      }
    }
    if (command.kind === 'steer_pause') {
      if (!universalSteeringInteractive) return
      try {
        controlPlane.pauseUniversalComputerSession(command.source, 'correction')
      } catch (error) {
        overlayNotice(error instanceof Error ? error.message : String(error))
      }
      return
    }
    if (command.kind === 'steer') {
      if (!universalSteeringInteractive) return
      try {
        controlPlane.steerUniversalComputerSession(command.text, command.source)
      } catch (error) {
        overlayNotice(error instanceof Error ? error.message : String(error))
      }
      return
    }
    if (command.kind === 'steer_resume') {
      if (!universal || !['pausing', 'paused', 'awaiting_steering_review'].includes(universal.status)) return
      try {
        controlPlane.resumeUniversalComputerSession()
      } catch (error) {
        overlayNotice(error instanceof Error ? error.message : String(error))
      }
      return
    }
    if (command.kind === 'budget_grant') {
      if (!universalBudgetInteractive || universal?.pendingBudgetCheckpoint?.id !== command.checkpointId) return
      void controlPlane.approveUniversalComputerBudget(command.checkpointId, 'capsule').then(() => {
        // The resumed task is the success feedback; a transient notice here
        // flashes warning-colored text just as the decision card collapses.
        returnFocusToTarget(universal.target)
      }).catch(error => {
        overlayNotice(error instanceof Error ? error.message : String(error))
      })
      return
    }
    if (command.kind === 'budget_finish') {
      if (!universalBudgetInteractive || universal?.pendingBudgetCheckpoint?.id !== command.checkpointId) return
      try { controlPlane.finishUniversalComputerAtBudget(command.checkpointId) } catch (error) { overlayNotice(error instanceof Error ? error.message : String(error)) }
      return
    }
    if (command.kind === 'retry') {
      if (!universalFailureInteractive || universal?.id !== command.sessionId || !universal.canResume) return
      returnFocusToTarget(universal.target)
      void controlPlane.retryUniversalComputerSession(command.sessionId, { ...(command.preset ? { preset: command.preset } : {}), ...(command.note ? { note: command.note } : {}) })
        .catch((error: unknown) => {
          controlPlane?.audit.append('computer.universal_retry_failed', 'system', universal.id, { error: String(error).slice(0, 500) })
          overlayNotice(error instanceof Error ? error.message : String(error))
        })
      return
    }
    if (command.kind === 'dictate_begin') {
      try {
        if (command.sharing) controlPlane.setDictationSharing(true, command.sharing === 'remembered')
        if (liveComputerOverlayDictationId) controlPlane.dictation.cancelLiveTranscription(liveComputerOverlayDictationId)
        const state = controlPlane.beginDictationStream(command.mimeType)
        liveComputerOverlayDictationId = state.sessionId
        sendDictation({ op: 'begin' })
      } catch (error) {
        sendDictation({ op: 'error', error: String(error instanceof Error ? error.message : error).slice(0, 300) })
      }
      return
    }
    if (command.kind === 'dictate_push') {
      if (!liveComputerOverlayDictationId) return
      try {
        const state = controlPlane.pushDictationStream(liveComputerOverlayDictationId, command.audioBase64)
        if (state.error) throw new Error(state.error)
        sendDictation({ op: 'state', transcript: state.transcript, interim: state.interim })
      } catch (error) {
        controlPlane.dictation.cancelLiveTranscription(liveComputerOverlayDictationId)
        liveComputerOverlayDictationId = null
        sendDictation({ op: 'error', error: String(error instanceof Error ? error.message : error).slice(0, 300) })
      }
      return
    }
    if (command.kind === 'dictate_end') {
      const dictationId = liveComputerOverlayDictationId
      liveComputerOverlayDictationId = null
      if (!dictationId) return
      void controlPlane.endDictationStream(dictationId)
        .then((state) => sendDictation({ op: 'end', transcript: state.transcript, error: state.error }))
        .catch((error: unknown) => sendDictation({ op: 'error', error: String(error instanceof Error ? error.message : error).slice(0, 300) }))
      return
    }
    if (command.kind === 'add_fresh_window') {
      // Offered only on the plan capsule: the window opens, joins the route,
      // and the plan re-hashes. Nothing runs until Start approves the route.
      if (session?.status !== 'awaiting_plan_approval') return
      const original = session.target
      void controlPlane.openFreshLiveComputerWindow(command.bundleIdentifier, command.url, session.runId)
        .then((target) => {
          controlPlane?.addLiveComputerSessionTarget({ target, authority: 'input', role: 'research', purpose: 'Research and verify source information', source: 'fresh' })
          syncLiveComputerOverlay()
          // The new window's app finishes activating a beat after it appears;
          // hand focus back to the plan's window once that has settled so the
          // capsule, which follows that window, stays in front of the person.
          setTimeout(() => { returnFocusToTarget(original); syncLiveComputerOverlay() }, 700)
        })
        .catch((error: unknown) => {
          controlPlane?.audit.append('computer.fresh_window_failed', 'system', session.id, { error: String(error).slice(0, 300) })
          overlayNotice(error instanceof Error ? error.message : String(error))
        })
      return
    }
    if (command.kind === 'approve_plan') {
      if (session?.status !== 'awaiting_plan_approval' && !universal?.pendingPlanReview) return
      try {
        controlPlane.approveLiveComputerPlan(command.planHash, 'capsule')
        const owner = universal?.pendingPlanReview ? universal : session
        if (owner) returnFocusToTarget(owner.target)
      } catch (error) {
        overlayNotice(error instanceof Error ? error.message : String(error))
      }
      return
    }
    if (command.kind === 'guidance_option' || command.kind === 'guidance') {
      if (session?.status !== 'awaiting_guidance') return
      if (!command.questionId) { overlayNotice('This question is out of date. Please use the current question.'); return }
      const input = command.kind === 'guidance_option' ? { questionId: command.questionId, optionId: command.optionId } : { questionId: command.questionId, directive: command.text }
      controlPlane.provideLiveComputerGuidance({ ...input, approvalSurface: 'capsule' })
        .then(() => { returnFocusToTarget(session.target) })
        .catch((error: unknown) => { overlayNotice(error instanceof Error ? error.message : String(error)) })
      return
    }
    if (command.kind === 'revise_plan') {
      if (session?.status !== 'awaiting_plan_approval' && !universal?.pendingPlanReview) return
      // The revised outcome arrives as a fresh session; the capsule rebinds to
      // it automatically and shows the new plan for review.
      void controlPlane.reviseLiveComputerPlan(command.text)
        .catch((error: unknown) => {
          controlPlane?.audit.append('computer.plan_revision_failed', 'system', session?.id ?? null, { error: String(error).slice(0, 500) })
          overlayNotice(error instanceof Error ? error.message : String(error))
        })
      return
    }
    if (command.kind === 'ask' || command.kind === 'ask_allow') {
      const ask = liveComputerAskMode
      if (!ask || ask.intent !== 'work' || ask.workPending) return
      if (command.kind === 'ask_allow') {
        const consent = guideConsentNeeded()
        if (!consent || consent.providerId !== command.providerId
          || command.sessionId !== `ask:${ask.target.windowId}:${ask.target.bundleIdentifier}`) {
          overlayNotice('The window or provider changed. Review the current request and try again.')
          syncLiveComputerOverlay()
          return
        }
        try {
          controlPlane.setCatalogSharingConsent(consent.providerId, command.remember)
          controlPlane.setLiveComputerVisualsConsent(consent.providerId, command.remember)
          if (!command.text.trim()) {
            overlayNotice('Sharing allowed. Tell Carve what you would like to do.')
            syncLiveComputerOverlay()
            return
          }
        } catch (error) {
          overlayNotice(error instanceof Error ? error.message : String(error))
          return
        }
      }
      ask.question = command.text
      ask.workPending = true
      liveComputerOverlayEngaged = true
      returnFocusToTarget(ask.target)
      const pending = controlPlane.assistance.submit(command.text)
      syncLiveComputerOverlay()
      void pending
        .then(() => { if (liveComputerAskMode === ask) ask.workPending = false; syncLiveComputerOverlay() })
        .catch((error: unknown) => {
          controlPlane?.audit.append('computer.hotkey_ask_failed', 'system', null, { error: String(error).slice(0, 500) })
          if (liveComputerAskMode === ask) { ask.question = null; ask.workPending = false }
          overlayNotice(error instanceof Error ? error.message : String(error))
          syncLiveComputerOverlay()
        })
      return
    }
    if (command.kind === 'guide_ask') {
      const ask = liveComputerAskMode
      if (ask) askGuideFromCapsule(ask, command.text)
      else void controlPlane.submitComputerCompletionRequest(command.text).then(result => {
        if (result.kind === 'new_task') openFreshWorkRequest(result.goal, result.recommendedBudget)
        syncLiveComputerOverlay()
      }).catch(error => overlayNotice(error instanceof Error ? error.message : String(error)))
      return
    }
    if (command.kind === 'guide_allow') {
      // The displayed window and recipient bind this grant. Remembering is
      // explicit; otherwise it expires when Carve quits. Retry the same request.
      const ask = liveComputerAskMode
      if (!ask || controlPlane.assistance.snapshot().guide.state !== 'failed' || !ask.question) return
      const consent = guideConsentNeeded()
      if (!consent || consent.providerId !== command.providerId || command.sessionId !== `guide:${ask.target.windowId}:${ask.target.bundleIdentifier}`) return
      if (consent.catalog) controlPlane.setCatalogSharingConsent(consent.providerId, command.remember)
      controlPlane.setLiveComputerVisualsConsent(consent.providerId, command.remember)
      askGuideFromCapsule(ask, ask.question)
      return
    }
    if (command.kind === 'guide_do_it') {
      const ask = liveComputerAskMode
      if (!ask) return
      startGuideDelegation(ask, overlayNotice)
      return
    }
    // Plans and task packs live in Settings → Account; the capsule only opens it.
    if (command.kind === 'open_account') {
      controlPlane.audit.append('cloud.plans_opened', 'user', null, { source: 'capsule' })
      showMainWindow()
      mainWindow?.webContents.send('steward:open-settings', { section: 'account' })
      return
    }
    if (universal?.status === 'completed' || session?.status === 'completed') {
      void controlPlane.submitComputerCompletionRequest(command.text)
        .then(result => {
          if (result.kind === 'new_task') openFreshWorkRequest(result.goal, result.recommendedBudget)
          syncLiveComputerOverlay()
        })
        .catch(error => { overlayNotice(error instanceof Error ? error.message : String(error)); syncLiveComputerOverlay() })
    }

  })
  ipcMain.handle('steward:command', async (event: IpcMainInvokeEvent, command: CarveCommand) => {
    assertTrustedSender(event)
    if (!controlPlane) throw new Error('Carve control plane is not ready')
    if (!firstRunCleared(controlPlane.database, controlPlane.cloud.configured) && !mayUseBeforeLegalAcceptance(command?.kind ?? '')) {
      showMainWindow()
      throw new Error(controlPlane.cloud.configured ? 'Review and accept the Terms of Use in Carve before starting new work.' : 'Review the welcome screen in Carve before starting new work.')
    }
    if (command?.kind?.startsWith('voice.')) {
      const validated = validateCarveCommand(command)
      if (validated.kind === 'voice.settings.get') return voiceSettings()
      if (validated.kind === 'voice.settings.set') {
        previewVoice?.stop('settings_changed')
        if (capsuleVoice && validated.voiceId !== undefined) capsuleVoice.voiceId = validated.voiceId
        if (validated.enabled !== undefined) capsuleVoice?.setEnabled(validated.enabled)
        saveVoiceSettings()
        return voiceSettings()
      }
      if (validated.kind === 'voice.preview.stop') { previewVoice?.stop(); return { stopped: true } }
      if (validated.kind === 'voice.preview.playback') { previewVoice?.playback(validated.id, validated.state); return { received: true } }
      if (validated.kind === 'voice.preview') {
        if (!previewVoice?.available) throw new Error('Add a Deepgram API key to preview voices.')
        capsuleVoice?.stop('preview')
        previewVoice.stop('new_preview')
        previewVoice.voiceId = validated.voiceId
        // The IPC call remains pending until playback finishes or is cancelled.
        await previewVoice.preview()
        return { finished: true }
      }
    }
    if (command?.kind === 'dictation.stream.begin' || command?.kind === 'dictation.transcribe' || command?.kind === 'system.global_stop') previewVoice?.stop('microphone_or_stop')
    if (command?.kind === 'desktop.practice.prepare') {
      validateCarveCommand(command)
      if (practicePreparationPending) throw new Error('Practice is already opening.')
      const plane = controlPlane
      const before = plane.assistance.snapshot()
      if (before.active || before.preparing) throw new Error('Finish or stop the current task before opening practice.')
      const revision = liveComputerStopRevision
      const current = () => {
        const state = plane.assistance.snapshot()
        return revision === liveComputerStopRevision && controlPlane === plane
          && state.conversationId === before.conversationId && !state.active && !state.preparing
      }
      practicePreparationPending = true
      try {
        const result = await preparePracticeWindow({
          open: url => shell.openExternal(url), targets: () => plane.listLiveComputerTargets(true),
          wait: () => delay(500), current,
        })
        if (current()) showMainWindow()
        return result
      } finally { practicePreparationPending = false }
    }
    if (command?.kind === 'desktop.status') return desktopStatus()
    if (command?.kind === 'desktop.open_system_settings') return openSystemSettings(command.pane)
    if (command?.kind === 'browser.sandbox.open_external') {
      const url = controlPlane.browserSandbox.summary().url
      if (!url || new URL(url).hostname !== '127.0.0.1') throw new Error('Load a disposable scenario before opening its browser window')
      await shell.openExternal(url)
      controlPlane.audit.append('browser.sandbox_window_opened', 'user', null, { origin: new URL(url).origin })
      return { opened: true }
    }
    if (command?.kind === 'receipt.export_image') {
      const { runId } = validateCarveCommand(command) as { runId: string }
      return exportReceiptImage(controlPlane, runId)
    }
    if (command?.kind === 'cloud.browser.start') {
      const result = await dispatchCarveCommand(controlPlane, validateCarveCommand(command)) as BrowserSignInStart
      const url = new URL(result.url)
      if (url.protocol !== 'https:' || url.origin !== controlPlane.cloud.baseUrl || url.pathname !== '/beta-sign-in') throw new Error('Unexpected sign-in address')
      try { await shell.openExternal(url.href) }
      catch (error) { await controlPlane.cloud.browserSignInCancel(result.id).catch(() => {}); throw error }
      return { ...result, opened: true }
    }
    if (command?.kind === 'cloud.signin.start') {
      const result = await dispatchCarveCommand(controlPlane, validateCarveCommand(command)) as SignInStart
      if (result.verificationUrl) {
        const url = new URL(result.verificationUrl)
        if (url.protocol !== 'https:' || url.origin !== controlPlane.cloud.baseUrl || url.pathname !== '/onboarding/verify') throw new Error('Unexpected verification address')
        await shell.openExternal(url.href)
        return { ...result, opened: true }
      }
      return result
    }
    if (command?.kind === 'cloud.checkout' || command?.kind === 'cloud.portal') {
      // Billing links open in the person's browser, never inside Carve, and
      // only when they point at Stripe or the configured Carve Cloud host.
      const result = await dispatchCarveCommand(controlPlane, validateCarveCommand(command)) as { url: string }
      const url = new URL(result.url)
      const allowedHosts = new Set(['checkout.stripe.com', 'billing.stripe.com', 'pay.stripe.com', ...(controlPlane.cloud.baseUrl ? [new URL(controlPlane.cloud.baseUrl).hostname] : [])])
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('Refusing to open an unexpected billing link')
      await shell.openExternal(url.href)
      controlPlane.audit.append('cloud.billing_link_opened', 'user', null, { host: url.hostname, kind: command.kind })
      return { url: result.url, opened: true }
    }
    // Validate the renderer payload before it can trigger an OS prompt. The
    // dispatcher validates again at the domain boundary, by design.
    const validatedCommand = validateCarveCommand(command)
    if (validatedCommand.kind === 'system.global_stop') {
      liveComputerStopRevision++
      liveComputerPendingStart = null
      liveComputerAskMode = null
      const result = dispatchCarveCommand(controlPlane, validatedCommand)
      closeLiveComputerOverlay()
      void liveMacCanaryCoordinator?.stop('desktop_global_stop')
      return result
    }
    const startRevision = liveComputerStopRevision
    if (!privacyReauthentication) throw new Error('Privacy authentication is unavailable')
    if (validatedCommand.kind === 'evaluation.live_mac.authorize_and_run') {
      if (!liveMacCanaryCoordinator) throw new Error('Live-Mac canary coordinator is unavailable')
      liveMacCanaryCoordinator.validateAuthorizationRequest(validatedCommand.runHash, validatedCommand.confirmation)
    }
    if (await verifyPrivacyReauthentication(validatedCommand, privacyReauthentication)) {
      controlPlane.audit.append('privacy.os_user_presence_verified', 'system', null, {
        operation: validatedCommand.kind,
        mechanism: 'device_owner_authentication',
        approvalCached: false,
      })
    }
    const nativeManualCapture = validatedCommand.kind === 'session.action'
      && validatedCommand.action === 'capture'
      && controlPlane.database.getSession(validatedCommand.sessionId)?.fixtureId === 'native-macos-observation'
    if (nativeManualCapture) {
      mainWindow?.hide()
      if (process.platform === 'darwin') electronApp.hide()
      await delay(650)
    }
    if ((validatedCommand.kind === 'computer.session.start' || validatedCommand.kind === 'computer.route.start') && startRevision !== liveComputerStopRevision) {
      throw new Error('The task was stopped before startup.')
    }
    const pendingStart = validatedCommand.kind === 'computer.session.start' || validatedCommand.kind === 'computer.route.start'
      ? beginLiveComputerStartHandoff(validatedCommand)
      : null
    let result: unknown
    try {
      if (validatedCommand.kind === 'work.public_source.open') {
        await shell.openExternal(controlPlane.publicSourceUrl(validatedCommand.runId, validatedCommand.url))
        result = { opened: true }
      } else if (validatedCommand.kind === 'evaluation.live_mac.preflight') {
        if (!liveMacCanaryCoordinator) throw new Error('Live-Mac canary coordinator is unavailable')
        result = await liveMacCanaryCoordinator.preflight(validatedCommand.planHash, validatedCommand.caseIds, validatedCommand.providerId)
      } else if (validatedCommand.kind === 'evaluation.live_mac.propose') {
        if (!liveMacCanaryCoordinator) throw new Error('Live-Mac canary coordinator is unavailable')
        result = await liveMacCanaryCoordinator.propose(validatedCommand.planHash, validatedCommand.caseIds, validatedCommand.providerId)
      } else if (validatedCommand.kind === 'evaluation.live_mac.authorize_and_run') {
        if (!liveMacCanaryCoordinator) throw new Error('Live-Mac canary coordinator is unavailable')
        result = await liveMacCanaryCoordinator.authorizeAndRun(validatedCommand.runHash, validatedCommand.confirmation)
      } else if (validatedCommand.kind === 'evaluation.live_mac.stop') {
        if (!liveMacCanaryCoordinator) throw new Error('Live-Mac canary coordinator is unavailable')
        result = await liveMacCanaryCoordinator.stop('desktop_command')
      } else {
        result = await dispatchCarveCommand(controlPlane, validatedCommand)
      }
    } catch (error) {
      if (pendingStart) finishLiveComputerStartHandoff(pendingStart)
      throw error
    } finally {
      if (nativeManualCapture) showMainWindow()
    }
    if (validatedCommand.kind === 'computer.attachments.focus') {
      const attachment = controlPlane.attachments.get(validatedCommand.id)
      if (attachment) { syncAttachments(); returnFocusToTarget(attachment.target) }
    }
    if (validatedCommand.kind === 'computer.assistance.open') retainMainAssistanceComposer()
    if (validatedCommand.kind === 'computer.session.start' || validatedCommand.kind === 'computer.route.start') {
      const universal = controlPlane.universalComputerSession()
      if (universal && (result as { id?: string } | null)?.id === universal.id) transitionUniversalWorkToCapsule(universal)
    }
    if (validatedCommand.kind === 'computer.assistance.ask') {
      const nextTask = controlPlane.assistance.snapshot().newTask
      if (nextTask) openFreshWorkRequest(nextTask.goal, 'balanced')
    }
    if (validatedCommand.kind === 'computer.session.follow_up') {
      const universal = controlPlane.universalComputerSession()
      const completion = result as { kind?: string; session?: { id?: string }; goal?: string; recommendedBudget?: WorkBudgetPreset } | null
      if (universal && completion?.kind === 'continued' && completion.session?.id === universal.id) transitionUniversalWorkToCapsule(universal)
      if (completion?.kind === 'new_task' && completion.goal && completion.recommendedBudget) {
        openFreshWorkRequest(completion.goal, completion.recommendedBudget)
      }
    }
    if (pendingStart) finishLiveComputerStartHandoff(pendingStart)
    // Get out of the way whenever unattended capture (re)starts, so Carve
    // never observes its own window. Resume counts, not just a fresh start.
    if (validatedCommand.kind === 'session.start') hideForUnattendedCapture((result as { id?: string } | null)?.id)
    if (validatedCommand.kind === 'session.action' && validatedCommand.action === 'resume') hideForUnattendedCapture(validatedCommand.sessionId)
    // Reading state changes nothing the tray or overlay shows; the renderer polls it every 0.5 s during work.
    if (validatedCommand.kind !== 'state.get') {
      rebuildTray()
      syncLiveComputerOverlay()
    }
    return result
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    // Dictation is the single renderer capability granted beyond the default
    // denial: microphone-only media access, and only for Carve's own main
    // window or live-frame capsule. Camera, screen, and every other permission
    // stay fail-closed.
    if (permission === 'media') {
      const own = [mainWindow, liveComputerOverlay].some((candidate) => candidate && !candidate.isDestroyed() && candidate.webContents === webContents)
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
      const audioOnly = Array.isArray(mediaTypes) && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio')
      if (own && audioOnly) {
        if (process.platform === 'darwin') {
          void systemPreferences.askForMediaAccess('microphone').then((granted) => callback(granted)).catch(() => callback(false))
          return
        }
        return callback(true)
      }
    }
    callback(false)
  })
}

async function openSystemSettings(pane: unknown): Promise<{ opened: true; pane: 'screen_recording' | 'accessibility' }> {
  if (process.platform !== 'darwin') throw new Error('This permission shortcut is currently available only on macOS')
  if (pane !== 'screen_recording' && pane !== 'accessibility') throw new Error('Unknown desktop settings pane')
  const url = pane === 'screen_recording'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  await shell.openExternal(url)
  return { opened: true, pane }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) throw new Error('Desktop command rejected: unknown sender')
  const senderUrl = event.senderFrame?.url ?? ''
  if (!senderUrl.startsWith('file:') || !senderUrl.includes('/dist/ui/')) throw new Error('Desktop command rejected: untrusted origin')
}

function isTrustedObserverHudSender(event: IpcMainEvent): boolean {
  if (!observerHud || observerHud.isDestroyed() || event.sender.id !== observerHud.webContents.id) return false
  const senderUrl = event.senderFrame?.url ?? ''
  return senderUrl.startsWith('file:') && senderUrl.includes('/dist/desktop/observer-hud.html')
}

function desktopStatus(): DesktopStatus {
  const nativeStatus = controlPlane?.nativeCapture.summary()
  const screenStatus = nativeStatus?.screenRecording ?? (process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'not_applicable')
  return {
    desktop: true,
    platform: process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux' ? process.platform : 'linux',
    packaged: electronApp.isPackaged,
    version: electronApp.getVersion(),
    globalStopShortcut: `Esc or ${humanShortcut()}`,
    guideShortcut: humanAccelerator(guideShortcut),
    doItShortcut: doItShortcut ? humanAccelerator(doItShortcut) : null,
    privacyReauthentication: privacyReauthentication?.status() ?? (process.platform === 'darwin' ? 'unavailable' : 'not_applicable'),
    permissions: {
      screenRecording: screenStatus === 'granted' || screenStatus === 'denied' || screenStatus === 'restricted'
        ? screenStatus
        : screenStatus === 'not_applicable'
          ? 'not_applicable'
          : 'unknown',
      accessibility: process.platform === 'darwin'
        ? systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
        : 'not_applicable',
    },
  }
}

function emergencyStop(source: 'tray' | 'menu' | 'global_shortcut' | 'escape_key' | 'capsule'): void {
  if (!controlPlane) return
  liveComputerStopRevision++
  liveComputerPendingStart = null
  liveComputerAskMode = null
  controlPlane.globalStop()
  void liveMacCanaryCoordinator?.stop(`desktop_${source}`)
  controlPlane.audit.append('desktop.emergency_stop', 'user', null, { source, rendererRequired: false })
  closeLiveComputerOverlay()
  rebuildTray()
  showMainWindow()
}

function stopObservationFromHud(): void {
  if (!controlPlane) return
  const session = controlPlane.desktopStatus().activeSession
  if (!session || session.fixtureId !== 'native-macos-observation') return
  controlPlane.stopSession(session.id)
  controlPlane.audit.append('desktop.observer_hud_stop', 'user', session.id, { rendererRequired: false })
  rebuildTray()
  showMainWindow()
}

/**
 * Squirrel.Mac updates from Carve Cloud's release feed. Only packaged,
 * Developer ID-signed builds can apply an update; development builds skip
 * this entirely. A downloaded update is applied only after the person agrees,
 * and any live work is stopped first.
 */
function configureAutoUpdates(app: CarveApp): void {
  if (!electronApp.isPackaged || process.platform !== 'darwin') return
  const base = app.cloud.baseUrl
  if (!base || !base.startsWith('https://')) return
  try {
    autoUpdater.setFeedURL({ url: `${base}/releases/darwin/${process.arch}/latest.json`, serverType: 'json' })
  } catch (error) {
    console.error('[update] feed configuration failed', error instanceof Error ? error.message : error)
    return
  }
  autoUpdater.on('error', (error) => {
    app.audit.append('update.check_failed', 'system', null, { message: String(error instanceof Error ? error.message : error).slice(0, 300) })
  })
  autoUpdater.on('update-available', () => app.audit.append('update.available', 'system', null, {}))
  autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
    app.audit.append('update.downloaded', 'system', null, { releaseName })
    void dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 1,
      cancelId: 1,
      message: `Carve ${releaseName} is ready to install`,
      detail: 'Restart to finish updating. Any live work stops first, and nothing on your Mac is changed by the update itself.',
    }).then(({ response }) => {
      if (response !== 0) return
      app.audit.append('update.install_accepted', 'user', null, { releaseName })
      app.globalStop()
      autoUpdater.quitAndInstall()
    })
  })
  const check = () => {
    try {
      autoUpdater.checkForUpdates()
    } catch (error) {
      console.error('[update] check failed', error instanceof Error ? error.message : error)
    }
  }
  setTimeout(check, 20_000).unref()
  setInterval(check, 6 * 60 * 60_000).unref()
}

/**
 * Renders a receipt in a hidden window and saves it as a PNG where the person
 * chooses. The window is sandboxed, loads only inline HTML, and is destroyed
 * before the save dialog opens.
 */
async function exportReceiptImage(app: CarveApp, runId: string): Promise<{ saved: string | null }> {
  const receipt = app.receipt(runId)
  const html = receiptHtml(receipt)
  const window = new BrowserWindow({
    show: false,
    width: 704,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  let image: Electron.NativeImage
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const height = await window.webContents.executeJavaScript('document.documentElement.scrollHeight').catch(() => 800) as number
    window.setContentSize(704, Math.min(4_000, Math.max(300, Math.ceil(height))))
    await new Promise((resolve) => setTimeout(resolve, 120))
    image = await window.webContents.capturePage()
  } finally {
    window.destroy()
  }
  const stamp = receipt.endedAt ?? receipt.startedAt
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save receipt',
    defaultPath: join(electronApp.getPath('downloads'), `Carve receipt ${stamp.slice(0, 10)}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  })
  if (canceled || !filePath) return { saved: null }
  writeFileSync(filePath, image.toPNG())
  app.audit.append('receipt.exported', 'user', runId, { format: 'png' })
  return { saved: filePath }
}

function showMainWindow(): void {
  if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return
  // Explicit console navigation must not be mistaken for capsule activation.
  hideLiveComputerOverlay()
  preserveMacOSDockPresence()
  if (process.platform === 'darwin') electronApp.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Choosing context in the large app is not a request to summon a capsule. */
function retainMainAssistanceComposer(): void {
  liveComputerAskMode = null
  liveComputerAskFocusPending = false
  liveComputerSteeringFocusPending = false
  liveComputerCapsuleTransitionSessionId = null
  liveComputerOverlayPendingPresentation = null
  showMainWindow()
}

function openFreshWorkRequest(goal: string, budget: WorkBudgetPreset): void {
  // Capture this invocation's explicit attachment before dismissing assistance.
  // It is a review suggestion, never inherited execution authority.
  const routeSourceTarget = controlPlane?.assistance.snapshot().target ?? undefined
  if (controlPlane?.assistance.snapshot().newTask) {
    liveComputerOverlayDismissedTerminalSessionId = controlPlane.assistance.snapshot().executionId
    controlPlane.assistance.dismiss()
    liveComputerAskMode = null
    hideLiveComputerOverlay()
  }
  showMainWindow()
  mainWindow?.webContents.send('steward:open-work', { goal, budget, routeSourceTarget })
}

/** Floating non-focusable windows can make Electron adopt an accessory
 * activation policy on macOS, which removes the entire application from the
 * Dock once the main window hides. Carve remains a regular Dock app by
 * product contract; the menu-bar control is an additional entry point, not a
 * replacement for ordinary app discovery and reopening. */
function preserveMacOSDockPresence(): void {
  if (process.platform === 'darwin') electronApp.setActivationPolicy('regular')
}

function humanShortcut(): string {
  return process.platform === 'darwin' ? '⌘⇧.' : 'Ctrl+Shift+.'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}
