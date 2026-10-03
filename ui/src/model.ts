import type { ApplicationHandoffTask } from '../../src/application-handoff'
import type { WorkProgress } from '../../src/work-progress'
import type { AssistanceState } from '../../src/conversation-interaction'
import type { AttachmentSummary } from '../../src/attachments'
import type {
  AiWorkflowDraft,
  ApprovalRecord,
  CheckpointDecision,
  AuditEvent,
  CapturePolicy,
  LearningSession,
  LiveComputerSession,
  UniversalComputerSession,
  MemoryEdge,
  MemoryEntity,
  ModelProviderSummary,
  ObservationRecord,
  ObservationReview,
  ProcedureVersion,
  ReviewedEpisode,
  WorkRun,
} from '../../src/types'
import type { DesktopStatus, CarveCommand, CarveDesktopBridge } from '../../src/desktop-contract'
import type { NativeCaptureStatus } from '../../src/native-capture'
import type { LiveComputerStatus } from '../../src/live-computer'
import type { LiveComputerTarget } from '../../src/types'
import type { ToolDefinition } from '../../src/tools/contracts'
import type { ComputerUseLabSummary } from '../../src/computer-use-lab'
import type { EvaluationFoundrySummary } from '../../src/evaluation/foundry'

export type { ProductPageId as PageId } from '../../src/product-experience'

export interface FixtureSummary {
  id: string
  name: string
  goal: string
  expectedProcedure: 'linear' | 'branched' | 'interrupted' | 'blocked'
}

export interface ProviderView extends ModelProviderSummary {
  active: boolean
}

export interface CarveState {
  workProgress?: WorkProgress[]
  product: { experience?: 'copilot' | 'workbench'; name: string; version: string; mode: string; startedAt: string; localDiagnostics?: boolean }
  sessions: LearningSession[]
  selectedSession: LearningSession | null
  observations: ObservationRecord[]
  ambient: {
    settings: { enabled: boolean; extractText: boolean; intervalSeconds: number; retentionDays: number; excludedApplications: string[]; excludedWindows: string[] }
    running: boolean
    available: boolean
    candidates: Array<{ id: string; signatures: string[]; occurrences: number; distinctDays: number; lastSeenAt: string; medianDurationMs: number }>
  }
  reviewWorkspace: {
    sessions: Array<{
      session: LearningSession
      observations: ObservationRecord[]
      reviews: ObservationReview[]
      reviewVersionCount: number
      episode: ReviewedEpisode
    }>
  }
  aiWorkflowDrafts: AiWorkflowDraft[]
  procedures: ProcedureVersion[]
  semanticMemory: { entities: MemoryEntity[]; edges: MemoryEdge[] }
  runs: WorkRun[]
  approvals: ApprovalRecord[]
  checkpoints: CheckpointDecision[]
  /** Held-batch sentences for pending checkpoints, present only while the app still holds the batch. */
  checkpointLivePreviews?: Array<{ checkpointId: string; actions: string[] }>
  audit: AuditEvent[]
  auditChain: { valid: boolean; checked: number; errorAt: number | null }
  providers: ProviderView[]
  tools: ToolDefinition[]
  fixtures: FixtureSummary[]
  browserSandbox: {
    enabled: boolean
    status: 'dormant' | 'starting' | 'ready' | 'error'
    url: string | null
    error: string | null
    state: {
      application: 'triage' | 'handoff' | 'document' | 'insurance' | 'research' | 'data' | 'hr' | 'logistics' | 'legal' | 'inventory' | 'quality'
      layout: 'baseline' | 'changed' | 'ambiguous'
      requestId: string
      priority: 'urgent' | 'standard'
      contactId: string
      accountTier: string
      'account-tier': string
      'follow-up-note': string
      'search-query': string
      'reconciliation-note': string
      'inventory-note': string
      scenarioId: string
      scenarioTitle: string
      industry: string
      goal: string
      maxActions: number
      view: 'inbox' | 'detail' | 'form' | 'complete' | 'document' | 'search' | 'results' | 'source' | 'table' | 'filtered'
      outcome: 'pending' | 'urgent_reviewed' | 'standard_reviewed' | 'handoff_saved' | 'document_bottom_reached' | 'manual_review' | 'official_source_saved' | 'reconciliation_noted' | 'hr_review' | 'shipment_exception' | 'counsel_review' | 'inventory_noted' | 'qa_hold'
      revision: number
    }
    isolation: string
    traceCount: number
    lastTraceAt: string | null
    authentication: 'rotating_capability_path'
  }
  nativeCapture: NativeCaptureStatus
  liveComputer: {
    applicationHandoffEnabled?: boolean
    applicationHandoff?: ApplicationHandoffTask | null
    handoffRevision?: string | null
    assistance?: AssistanceState
    /** Every window or tab Carve holds a conversation with; text-free. */
    attachments?: AttachmentSummary[]
    parkedSessions?: Array<{ sessionId: string; runId: string; attachmentId: string; status: LiveComputerSession['status']; target: LiveComputerTarget; autoResume: boolean; parkedAt: string }>
    status: LiveComputerStatus
    session: LiveComputerSession | null
    universalSession: UniversalComputerSession | null
    visualsConsentProviderId: string | null
    sharingRevocation?: number
    sharing?: Array<{ providerId: string; recipient: string; catalogTasks?: string[]; catalog: boolean; windows: boolean; catalogRemembered: boolean; windowsRemembered: boolean }>
    /** Windows Carve opened itself, closable in one go from the Work page. */
    freshWindows: Array<{ target: LiveComputerTarget; runId: string | null; openedAt: string }>
    executionMode: 'legacy' | 'capability_vm_v1'
    actionEngine: 'structured_v1' | 'openai_computer_v1' | 'openai_universal_v1' | 'openai_thin_v1' | 'compact_v1' | 'router_v1'
    modelProfile: 'adaptive_5_6' | 'astra'
    modelPolicy?: { profile: 'adaptive_5_6' | 'astra'; strategyModel: string; executionModel: string; source: 'environment' | 'cloud' | 'setting' | 'default' }
    /** Fast mode for direct OpenAI requests; the environment wins over the local setting. */
    serviceTier?: { tier: 'default' | 'fast'; source: 'environment' | 'setting' | 'default' }
    modelDebugTag?: string | null
    runtimeBuildId?: string
    modelRouting?: Array<{ providerId: string; strategy: { model?: string; reasoningEffort?: string; promptCache?: string; serviceTier?: string }; execution: { model?: string; reasoningEffort?: string; promptCache?: string; serviceTier?: string } }>
  }
  dictation: { configured: boolean; vendor: 'deepgram'; model: string }
  computerUseLab: ComputerUseLabSummary
  evaluationFoundry: EvaluationFoundrySummary
  retention: { lastEnforcedAt: string | null; policy: string }
  dataBoundary: { database: string; artifacts: string; traces: string; nativeCaptures: string; evaluations: string; encryptionAtRest: string; exportProtection: string }
}

export const webDesktopStatus: DesktopStatus = {
  desktop: false,
  platform: 'web',
  packaged: false,
  version: 'web',
  globalStopShortcut: 'Emergency stop is available during active work',
  guideShortcut: 'Guide is available in the Carve desktop app',
  doItShortcut: null,
  privacyReauthentication: 'not_applicable',
  permissions: { screenRecording: 'not_applicable', accessibility: 'not_applicable' },
}

declare global {
  interface Window {
    stewardDesktop?: CarveDesktopBridge
  }
}

export type { CapturePolicy, DesktopStatus, CarveCommand }
