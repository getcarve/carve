import type { ApprovalPreset } from './approval-preference.js'
import type { VoiceId, VoiceSettings } from './voice-settings.js'
import type { VoicePacket } from './capsule-voice.js'
import type { DrawingEdit } from './annotation-scene.js'
import type { AiDraftCorrection, AutonomyLevel, CapturePolicy, LiveComputerActionEngine, LiveComputerExecutionMode, LiveComputerModelProfile, LiveComputerSessionTarget, LiveComputerSurfaceRole, LiveComputerTarget, ObservationReviewInput, SupervisionPolicyV2, SurfacePreferenceMode, WorkBudgetPreset, WorkContextSelection, WorkIntent, WorkMemoryScope, WorkSurfaceCapability } from './types.js'
import type { ProcedureCorrection } from './workflows.js'
import type { BrowserSandboxApplication, BrowserSandboxLayout, BrowserSandboxPriority } from './browser-sandbox.js'
import type { ComputerUseArchitectureId, ComputerUseScenarioId, ComputerUseVariation } from './computer-use-lab.js'
import type { EvaluationFoundrySuite } from './evaluation/foundry.js'
import type { AssistanceCommandIdentity, AssistanceMode } from './conversation-interaction.js'

export type SessionCommandAction = 'capture' | 'pause' | 'resume' | 'stop'
export type RunCommandAction = 'start' | 'stop'
export type ApprovalCommandAction = 'approve' | 'cancel'
export type ProviderCommandAction = 'select' | 'health'
export type DesktopSettingsPane = 'screen_recording' | 'accessibility'

export interface RecallScopeInput {
  fromIso: string | null
  toIso: string | null
  label: string | null
  /** Empty or omitted searches every session plus ambient history. */
  sessionIds?: string[]
}

export interface LiveComputerRouteAuditEntry {
  windowId: number
  application: string
  bundleIdentifier: string
  authority: 'observe' | 'input'
  role: LiveComputerSurfaceRole
  source?: 'existing' | 'fresh' | 'ask'
}

/** Semantic requirements and physical work surfaces are not one-to-one. A
 * browser window, document window, or other selected workspace can satisfy
 * several parts of a task without widening the set of authorized windows.
 * `requirementId` remains readable for persisted version-3 routes. */
export interface LiveComputerRouteRequirementIdentity {
  requirementId?: string
  requirementIds?: string[]
}

/** A reviewed work-surface route before any fresh window exists. Fresh
 * entries are materialized only by the atomic route-start command. */
export type LiveComputerRouteStartEntry = LiveComputerRouteRequirementIdentity & (
  | {
      source: 'existing'
      target: LiveComputerTarget
      authority: 'observe' | 'input'
      role: LiveComputerSurfaceRole
      purpose: string
    }
  | {
      source: 'fresh'
      application: string
      bundleIdentifier: string
      url?: string | null
      authority: 'observe' | 'input'
      role: LiveComputerSurfaceRole
      purpose: string
    }
)

export function liveComputerRouteRequirementIds(entry: LiveComputerRouteRequirementIdentity): string[] {
  return entry.requirementIds?.length ? entry.requirementIds : entry.requirementId ? [entry.requirementId] : []
}

export type CarveCommand =
  | { kind: 'computer.handoff.destinations' }
  | { kind: 'computer.handoff.destination'; taskId: string; revision: string; bundleIdentifier: string; windowId?: number; target?: LiveComputerTarget }
  | { kind: 'computer.handoff.decide'; taskId: string; revision: string; action: 'approve' | 'decline' | 'cancel' }
  | { kind: 'voice.settings.get' }
  | { kind: 'voice.settings.set'; enabled?: boolean; voiceId?: VoiceId }
  | { kind: 'voice.preview'; voiceId: VoiceId }
  | { kind: 'voice.preview.stop' }
  | { kind: 'voice.preview.playback'; id: number; state: 'started' | 'ended' | 'error' }
  | { kind: 'state.get' }
  | { kind: 'data.export'; passphrase: string }
  | { kind: 'data.purge'; confirmation: string }
  | { kind: 'system.global_stop' }
  | { kind: 'desktop.status' }
  | { kind: 'desktop.practice.prepare' }
  | { kind: 'desktop.open_system_settings'; pane: DesktopSettingsPane }
  | { kind: 'native.capture.status' }
  | { kind: 'native.capture.request_permission' }
  | { kind: 'computer.status' }
  | { kind: 'computer.request_screen_recording_permission' }
  | { kind: 'computer.request_accessibility_permission' }
  | { kind: 'computer.targets.list'; quiet?: boolean }
  | { kind: 'computer.applications.list'; quiet?: boolean }
  | { kind: 'computer.surface_preferences.get' }
  | { kind: 'computer.surface_preferences.set'; capability: WorkSurfaceCapability; mode: SurfacePreferenceMode; bundleIdentifier: string | null; source?: 'settings' | 'confirmed_override' }
  | { kind: 'computer.surface_preferences.clear'; capability: WorkSurfaceCapability }
  | { kind: 'computer.route.infer'; runId: string; providerId: string }
  | { kind: 'computer.route.preview'; runId: string; route: LiveComputerRouteAuditEntry[] }
  | { kind: 'computer.surface.open'; bundleIdentifier: string; url?: string | null; runId?: string | null }
  | { kind: 'computer.surface.close_fresh'; runId?: string | null }
  | { kind: 'computer.targets.recommend'; goal: string; providerId: string }
  | { kind: 'computer.route.start'; runId: string; providerId: string; verifierProviderId?: string | null; route: LiveComputerRouteStartEntry[]; remoteVisualsAllowed: boolean; idempotencyKey: string }
  | { kind: 'computer.session.start'; runId: string; providerId: string; verifierProviderId?: string | null; target: LiveComputerTarget; targetRole?: LiveComputerSurfaceRole; targetPurpose?: string; additionalTargets?: LiveComputerSessionTarget[]; remoteVisualsAllowed: boolean }
  | { kind: 'computer.session.plan.visibility'; sessionId: string; planHash: string; visible: boolean }
  | { kind: 'computer.session.plan.approve'; planHash: string }
  | { kind: 'computer.session.targets.add'; entry: LiveComputerSessionTarget }
  | { kind: 'computer.session.plan.revise'; feedback: string }
  | { kind: 'computer.session.follow_up'; goal: string }
  | { kind: 'computer.guide.ask'; question: string; target: LiveComputerTarget }
  | { kind: 'computer.guide.authority' }
  | ({ kind: 'computer.assistance.approvals'; preset: ApprovalPreset } & AssistanceCommandIdentity)
  | ({ kind: 'computer.assistance.mode'; mode: AssistanceMode } & AssistanceCommandIdentity)
  | { kind: 'computer.assistance.open'; target: LiveComputerTarget; mode: AssistanceMode }
  | { kind: 'computer.assistance.ask'; question: string }
  | { kind: 'computer.assistance.accept'; conversationId: string; turnId: string; candidateId: string; commandId: string }
  | { kind: 'computer.assistance.refresh' }
  | { kind: 'computer.assistance.clear' }
  | { kind: 'computer.assistance.drawing.start' }
  | { kind: 'computer.assistance.drawing'; edit: DrawingEdit }
  | { kind: 'computer.assistance.delegate'; scope: 'task' | 'step'; goal?: string }
  | { kind: 'computer.attachments.list' }
  | { kind: 'computer.attachments.focus'; id: string }
  | { kind: 'computer.attachments.retire'; id: string }
  | { kind: 'computer.universal.budget'; action: 'grant'; checkpointId: string }
  | { kind: 'computer.universal.steer'; text: string; source: 'text' | 'voice' }
  | { kind: 'computer.universal.retry'; sessionId: string; preset?: 'autopilot'; note?: string }
  | { kind: 'computer.session.guidance'; questionId?: string | null; optionId?: string | null; directive?: string | null }
  | { kind: 'computer.session.context_transfer'; transferId: string; action: 'approve' | 'decline' }
  | { kind: 'computer.visuals_consent'; providerId: string | null; remember?: boolean }
  | { kind: 'computer.catalog_consent'; providerId: string | null; remember?: boolean; runId?: string }
  | { kind: 'computer.execution_mode.set'; mode: LiveComputerExecutionMode }
  | { kind: 'computer.action_engine.set'; engine: LiveComputerActionEngine }
  | { kind: 'computer.model_profile.set'; profile: LiveComputerModelProfile }
  | { kind: 'computer.service_tier.set'; tier: 'default' | 'fast' }
  | { kind: 'computer.session.propose' }
  | { kind: 'computer.session.frame' }
  | { kind: 'computer.session.action'; action: 'approve' | 'pause' | 'resume' | 'stop' }
  | { kind: 'observation.screenshot'; observationId: string }
  | { kind: 'observation.review'; observationId: string; review: ObservationReviewInput }
  | { kind: 'observation.delete'; observationId: string; confirmation: 'DELETE OBSERVATION' }
  | { kind: 'ai.induction.disclosure'; sessionId: string; providerId: string }
  | { kind: 'ai.induction.analyze'; sessionId: string; providerId: string; manifestHash: string; confirmation?: string }
  | { kind: 'ai.draft.correct'; draftId: string; correction: AiDraftCorrection }
  | { kind: 'ai.draft.decide'; draftId: string; decision: 'accept' | 'reject' }
  | { kind: 'recall.query'; question: string; infer?: boolean; providerId?: string; depth?: 'brief' | 'normal' | 'thorough'; withImages?: boolean; scope?: RecallScopeInput; conversationId?: string; save?: boolean; replaceLast?: boolean }
  | { kind: 'recall.conversations.list' }
  | { kind: 'recall.conversation.get'; conversationId: string }
  | { kind: 'recall.conversation.rename'; conversationId: string; title: string }
  | { kind: 'recall.conversation.delete'; conversationId: string }
  | { kind: 'recall.scope_count'; fromIso: string | null; toIso: string | null; sessionIds?: string[] }
  | { kind: 'recall.answer_policy'; providerId?: string }
  | { kind: 'recall.answer_consent'; providerId: string | null }
  | { kind: 'recall.enrich_text'; momentIds?: string[]; scope?: RecallScopeInput }
  | { kind: 'recall.unread_captures'; fromIso: string | null; toIso: string | null; sessionIds?: string[] }
  | { kind: 'recall.skip_captures'; momentIds: string[] }
  | { kind: 'recall.clear_skips' }
  | { kind: 'receipt.list' }
  | { kind: 'receipt.get'; runId: string }
  | { kind: 'receipt.export_image'; runId: string }
  | { kind: 'autonomy.ledger' }
  | { kind: 'autonomy.recommend'; goal: string }
  | { kind: 'autonomy.decide'; workflowKey: string; decision: 'accept' | 'decline' }
  | { kind: 'legal.status' }
  | { kind: 'legal.accept'; version: string }
  | { kind: 'legal.acknowledge'; version: string }
  | { kind: 'cloud.status' }
  | { kind: 'cloud.refresh' }
  | { kind: 'cloud.signin.start'; email: string }
  | { kind: 'cloud.browser.start'; email: string; termsVersion: string }
  | { kind: 'cloud.browser.finish'; id: string; termsVersion: string }
  | { kind: 'cloud.browser.cancel'; id: string }
  | { kind: 'cloud.signin.status'; ticket: string }
  | { kind: 'cloud.signin.verify'; challengeId: string; code: string; termsVersion?: string }
  | { kind: 'cloud.signout' }
  | { kind: 'cloud.signout_all' }
  | { kind: 'cloud.checkout'; plan?: 'pro' | 'max' | 'own_key'; interval?: 'month' | 'year' | 'lifetime'; pack?: 'tasks_20' | 'tasks_100' }
  | { kind: 'cloud.portal' }
  | { kind: 'cloud.delete_account'; confirmation: string }
  | { kind: 'provider.models'; providerId: string }
  | { kind: 'provider.set_model'; providerId: string; model: string }
  | { kind: 'model.rate.set'; providerId: string; model: string; inputPerMillion: number | null; outputPerMillion: number | null }
  | { kind: 'model.rate.get'; providerId: string; model: string }
  | { kind: 'model.spend'; sinceIso: string | null }
  | { kind: 'cost.debug.get' }
  | { kind: 'cost.debug.set'; enabled: boolean }
  | { kind: 'cost.observation'; intervalSeconds: number; readsText?: boolean }
  | { kind: 'cost.induction'; sessionId: string; providerId: string }
  | { kind: 'embedding.policy' }
  | { kind: 'embedding.set_mode'; mode: 'off' | 'local' | 'hosted' }
  | { kind: 'embedding.consent'; providerId: string | null }
  | { kind: 'recall.image_consent'; providerId: string | null }
  | { kind: 'recall.unread_count' }
  | { kind: 'ambient.set_enabled'; enabled: boolean }
  | { kind: 'ambient.set_text'; enabled: boolean }
  | { kind: 'ambient.candidate.dismiss'; candidateId: string }
  | { kind: 'session.start'; name: string; fixtureId: string; capturePolicy: Partial<CapturePolicy> }
  | { kind: 'session.action'; sessionId: string; action: SessionCommandAction }
  | { kind: 'procedure.correct'; procedureId: string; correction: ProcedureCorrection }
  | { kind: 'dictation.sharing.get' }
  | { kind: 'dictation.sharing.set'; enabled: boolean; remember?: boolean }
  | { kind: 'dictation.transcribe'; audioBase64: string; mimeType: string }
  | { kind: 'dictation.stream.begin'; mimeType: string }
  | { kind: 'dictation.stream.push'; sessionId: string; audioBase64: string }
  | { kind: 'dictation.stream.end'; sessionId: string }
  | { kind: 'work.public_source.open'; runId: string; url: string }
  | { kind: 'work.prepare'; goal: string; autonomy: AutonomyLevel; intent?: WorkIntent; supervision?: SupervisionPolicyV2; providerId?: string; parameterValues?: Record<string, string>; selection?: WorkContextSelection; memory?: WorkMemoryScope; followUpRunId?: string; budget?: WorkBudgetPreset; freshSession?: boolean; routeSourceTarget?: LiveComputerTarget }
  | { kind: 'plan.create'; goal: string; autonomy: AutonomyLevel; intent?: WorkIntent; supervision?: SupervisionPolicyV2; providerId?: string; parameterValues?: Record<string, string> }
  | { kind: 'run.action'; runId: string; action: RunCommandAction }
  | { kind: 'recovery.action'; runId: string; action: 'create' | 'dismiss'; providerId?: string }
  | { kind: 'approval.action'; approvalId: string; action: ApprovalCommandAction }
  | { kind: 'checkpoint.action'; checkpointId: string; action: 'approve' | 'decline' }
  | { kind: 'supervision.change'; runId: string; preset: 'fast' | 'smart_checkpoints' | 'step_by_step' | 'autopilot' }
  | { kind: 'provider.action'; providerId: string; action: ProviderCommandAction }
  | { kind: 'browser.sandbox.reset'; priority: BrowserSandboxPriority; application?: BrowserSandboxApplication; layout?: BrowserSandboxLayout }
  | { kind: 'browser.sandbox.open_external' }
  | { kind: 'computer.lab.run'; scenarioId: ComputerUseScenarioId; architectureId: ComputerUseArchitectureId; variation: ComputerUseVariation }
  | { kind: 'computer.lab.run_suite'; architectureId?: ComputerUseArchitectureId }
  | { kind: 'computer.lab.clear' }
  | { kind: 'evaluation.campaign.preview'; suite: EvaluationFoundrySuite }
  | { kind: 'evaluation.campaign.run'; suite: EvaluationFoundrySuite; manifestHash: string }
  | { kind: 'evaluation.live_mac.preflight'; planHash: string; caseIds: string[]; providerId: string }
  | { kind: 'evaluation.live_mac.propose'; planHash: string; caseIds: string[]; providerId: string }
  | { kind: 'evaluation.live_mac.authorize_and_run'; runHash: string; confirmation: string }
  | { kind: 'evaluation.live_mac.stop' }

export interface DesktopStatus {
  desktop: boolean
  platform: 'darwin' | 'win32' | 'linux' | 'web'
  packaged: boolean
  version: string
  globalStopShortcut: string
  /** Human-readable Guide summon (for example ⌘⇧Space). */
  guideShortcut: string
  /** Human-readable Do-it summon (for example ⌥D), or null when no chord
   * could be registered for it. */
  doItShortcut: string | null
  privacyReauthentication: 'available' | 'unavailable' | 'not_applicable'
  permissions: {
    screenRecording: 'granted' | 'denied' | 'restricted' | 'unknown' | 'not_applicable'
    accessibility: 'granted' | 'denied' | 'not_applicable'
  }
}

export interface CarveDesktopBridge {
  onVoiceSettings(listener: (settings: VoiceSettings) => void): () => void
  onVoicePreview(listener: (packet: VoicePacket) => void): () => void
  readonly platform: NodeJS.Platform
  invoke<T>(command: CarveCommand): Promise<T>
  onStateChanged?(listener: (change: { sessionId: string | null; status: string | null; updatedAt: string | null }) => void): () => void
  onDictationState?(listener: (state: { sessionId: string; transcript: string; interim: string; done: boolean; error: string | null }) => void): () => void
  showCapsule?(): void
  onOpenActiveWork?(listener: (request: { runId: string | null }) => void): () => void
  onOpenSettings?(listener: (request: { section: 'account' }) => void): () => void
  onOpenWork?(listener: (request: { goal: string; budget: WorkBudgetPreset; routeSourceTarget?: LiveComputerTarget }) => void): () => void
  /** Controller-authored notices for the main window (for example a hint
   * when a hotkey is pressed while Carve itself is frontmost). */
  onNotice?(listener: (notice: { text: string; tone: 'accent' | 'positive' | 'danger' | 'neutral' | 'warning' | 'info' }) => void): () => void
}
