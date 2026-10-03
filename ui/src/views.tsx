import { isUniversalLiveComputerEngine } from '../../src/live-computer-engines.js'
import { ApprovalControl } from './approval-control'
import { approvalPreference } from '../../src/approval-preference'
import { foldPreviewText, protectedApprovalReason } from '../../src/live-computer-supervision'
import { sharingRecipient } from '../../src/ai-sharing'
import { ApplicationHandoffReview } from './application-handoff'
import { VoiceSettingsCard } from './voice-settings'
import { isCopilot } from '../../src/product-experience'
import { ResultText } from './result-text'
import { LegalCenterCard, LegalLinks } from './legal'
import { PlanVisibility } from './plan-visibility.js'
import { PublicLookupAnswer, PublicLookupReceipts } from './public-lookup-answer.js'
import { carveTagline } from '../../src/brand.js'
import { consumerActivityLabel, consumerActor, consumerStatus, consumerSystemMessage } from '../../src/consumer-copy'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  AppWindow,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  BookOpenCheck,
  Box,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CirclePause,
  Clock3,
  Cloud,
  CornerDownRight,
  Code2,
  CreditCard,
  Database,
  Download,
  Eye,
  EyeOff,
  FileCheck,
  FileKey,
  FileOutput,
  Filter,
  GitBranch,
  Globe2,
  Gauge,
  HardDrive,
  Laptop,
  ListChecks,
  LockKeyhole,
  Merge,
  Mic,
  MousePointer2,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  ScrollText,
  Send,
  SlidersHorizontal,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Split,
  Square,
  TerminalSquare,
  Trash2,
  UserRoundCheck,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import type { AiDraftCorrection, AiInductionDisclosure, AiWorkflowDraft, AutonomyLevel, CapturePolicy, LearningSession, LiveComputerActionEngine, LiveComputerActivityPhase, LiveComputerApplicationIdentity, LiveComputerSurfaceRole, LiveComputerTarget, LiveComputerTargetRecommendation, ObservationRecord, ObservationReview, ObservationReviewInput, RegionExclusion, SupervisionPreset, SurfaceDefaultApplication, SurfacePreferenceProfile, UniversalComputerSession, WorkBudgetPreset, WorkContextMemoryReceipt, WorkContextSelection, WorkContextSummary, WorkIntent, WorkMemoryScope, WorkMemoryScopeMode, WorkPreparation, WorkRun, WorkSurfaceCapability, WorkSurfaceIntent, WorkSurfaceIntentSelection, WorkSurfaceResolution } from '../../src/types'
import { legacyAutonomyFor, supervisionPolicyFromLegacy, supervisionPreset } from '../../src/supervision-policy'
import { browserBundles, freshSurfaceSuggestionsForIntent, resolveSurfaceApplication, surfaceRecordsForApplications, validateRouteAgainstIntent, type FreshSurfaceSuggestion } from '../../src/fresh-surface'
import { surfaceResolutionExplanation, validateRouteAgainstResolution } from '../../src/surface-application-resolver'
import type { ProcedureCorrection } from '../../src/workflows'
import { invoke } from './api'
import { CloudAccountCard } from './cloud-account'
import { GuideOnboardingCard } from './onboarding'
import {
  Button,
  Card,
  CarvePresence,
  Dialog,
  EmptyState,
  EmployeeGlyph,
  Field,
  PageIntro,
  Pill,
  ProcedureGlyph,
  SectionHeading,
  Toggle,
  type Tone,
} from './components'
import { readOutcomeMessage } from '../../src/recall-copy'
import type { DesktopStatus, PageId, CarveState } from './model'
import { livePreparationSuperseded, selectWorkRunForEntry } from '../../src/live-computer-state'
import { liveComputerActivityPhase, liveComputerElapsedMs, liveComputerPhaseElapsedMs, liveComputerProgressHealth, liveComputerProgressHealthDetail, liveComputerProgressHealthLabel } from '../../src/live-computer-activity'
import { cleanCompletionResultText, universalComputerCompletionKind, universalComputerCompletionResult } from '../../src/universal-completion'
import { universalComputerFailureFeedback } from '../../src/live-computer-overlay'
import { recommendWorkBudget } from '../../src/work-budget'
import type { ComputerUseArchitectureId, ComputerUseScenario, ComputerUseScenarioId, ComputerUseSimulationRun, ComputerUseVariation } from '../../src/computer-use-lab'
import type { EvaluationCampaignPreview, EvaluationFoundrySuite } from '../../src/evaluation/foundry'
import type { EvaluationCampaignReport } from '../../src/evaluation/contracts'
import type { LiveMacCanaryDesktopProposal, LiveMacCanaryDesktopReadiness } from '../../src/evaluation/live-mac-desktop'
import type { LiveMacCanaryRunReceipt } from '../../src/evaluation/live-mac-runner'
import { confidentWindowRecommendations, goalMatchScore, liveWindowRouteStartEntries, liveWindowRouteStepKey, suggestedWindowRouteDraft, bindWindowRouteDraft, type LiveWindowRouteStep } from './window-routing'
import { currentSelectedWorkWindow } from '../../src/selected-work-window'
import { composeDictationField, dictatedSubmissionValue, type DictationFinishResult } from './dictation-field'

export interface ViewProps {
  focusedWorkRunId?: string | null
  state: CarveState
  desktop: DesktopStatus
  refresh: () => Promise<void>
  notify: (message: string, tone?: Tone) => void
  navigate: (page: PageId) => void
  workGoal: string
  setWorkGoal: (goal: string) => void
  freshWorkRequestId: number | null
  freshWorkBudget: WorkBudgetPreset | null
  freshWorkSourceTarget?: LiveComputerTarget | undefined
  openWork: (goal: string, mode: 'fresh' | 'resume') => void
  consumeFreshWorkRequest: (requestId: number) => void
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

function ago(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  if (Math.abs(seconds) < 60) return relativeTime.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour')
  return relativeTime.format(Math.round(hours / 24), 'day')
}

function formatLiveDuration(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1_000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainderSeconds = String(seconds % 60).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes % 60).padStart(2, '0')}:${remainderSeconds}`
  return `${minutes}:${remainderSeconds}`
}

function LiveComputerPhaseIcon({ phase, size = 15 }: { phase: LiveComputerActivityPhase; size?: number }) {
  switch (phase) {
    case 'preparing': return <Sparkles size={size} />
    case 'observing': return <Eye size={size} />
    case 'deciding': return <BrainCircuit size={size} />
    case 'acting': return <MousePointer2 size={size} />
    case 'verifying': return <BadgeCheck size={size} />
    case 'recovering': return <RefreshCw size={size} />
    case 'settling': return <Clock3 size={size} />
    case 'waiting': return <UserRoundCheck size={size} />
    case 'paused': return <CirclePause size={size} />
    case 'ended': return <Square size={size} />
    case 'complete': return <CheckCircle2 size={size} />
  }
}

function liveComputerTerminalTitle(status: string, category: string | null): string {
  if (category === 'provider_error') return 'The planning service is temporarily unavailable.'
  if (status === 'handoff' || category === 'needs_user') return 'Carve needs you to take over.'
  if (category === 'safety_block') return 'Carve stopped because this action is not allowed.'
  if (category === 'execution_limit') return 'Carve could not finish after several tries.'
  if (category === 'environment_error') return 'Carve can no longer reach the selected window.'
  if (category === 'planning_error') return 'Carve could not work out the next step.'
  return 'This task has stopped.'
}

function confidenceTone(confidence: number): Tone {
  if (confidence >= 0.8) return 'positive'
  if (confidence >= 0.6) return 'warning'
  return 'danger'
}

function humanize(value: string): string {
  return consumerStatus(value)
}

export function OverviewView(props: ViewProps) {
  const { state, navigate, openWork, notify } = props
  const [goal, setGoal] = useState('')
  const [dictationLive, setDictationLive] = useState<DictationLiveView | null>(null)
  const dictationControl = useRef<DictationControl | null>(null)
  const goalField = useRef<HTMLTextAreaElement | null>(null)
  const activeSession = state.sessions.find((session) => session.status !== 'stopped')
  const activeRun = state.runs.find((run) => ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status))
  const latestRun = [...state.runs].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]
  const pendingReviews = state.reviewWorkspace.sessions.reduce((sum, workspace) => sum + workspace.episode.pendingObservationIds.length, 0)
  const activeProvider = state.providers.find((provider) => provider.active)
  const continueRun = activeRun ?? latestRun

  useLayoutEffect(() => {
    const field = goalField.current
    if (!field) return
    field.style.height = '0px'
    field.style.height = `${field.scrollHeight}px`
  }, [goal])

  const startWork = async () => {
    let nextGoal = goal.trim()
    if (dictationControl.current?.active) {
      const result = await dictationControl.current.finish()
      nextGoal = dictatedSubmissionValue(nextGoal, result)
      setGoal(nextGoal)
    }
    if (!nextGoal) return
    openWork(nextGoal, 'fresh')
  }

  const destinations: Array<{ page: PageId; label: string; title: string; description: string; meta: string; tone: string; icon: ReactNode }> = [
    { page: 'learn', label: 'Learn', title: 'Teach a workflow', description: 'Show Carve a repeatable process while you stay in control of what it observes.', meta: state.sessions.length === 0 ? 'Ready for the first session' : `${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'} captured`, tone: 'learn', icon: <Radio /> },
    { page: 'review', label: 'Review', title: 'Curate what it learned', description: 'Inspect captured evidence, remove anything irrelevant, and approve what becomes memory.', meta: pendingReviews > 0 ? `${pendingReviews} item${pendingReviews === 1 ? '' : 's'} waiting` : 'Everything is reviewed', tone: 'review', icon: <BookOpenCheck /> },
    { page: 'recall', label: 'Recall', title: 'Find past context', description: 'Search earlier work, decisions, and evidence without replaying the entire process.', meta: `${state.semanticMemory.entities.length} connected memor${state.semanticMemory.entities.length === 1 ? 'y' : 'ies'}`, tone: 'recall', icon: <Search /> },
    { page: 'lab', label: 'Simulation', title: 'Test before it touches real work', description: 'Try practice tasks and inspect what worked before using Carve on your own work.', meta: state.evaluationFoundry.latestReports.length === 0 ? 'Ready for the first campaign' : `${state.evaluationFoundry.latestReports.length} persisted campaign${state.evaluationFoundry.latestReports.length === 1 ? '' : 's'}`, tone: 'lab', icon: <BrainCircuit /> },
    { page: 'audit', label: 'Audit', title: 'Inspect every action', description: 'See what happened, who authorized it, and whether each verification succeeded.', meta: state.auditChain.valid ? `${state.audit.length} verified events` : 'Integrity needs attention', tone: 'audit', icon: <ScrollText /> },
    { page: 'settings', label: 'Settings', title: 'Shape how it works', description: 'Manage providers, privacy boundaries, retention, and the capabilities Carve may use.', meta: activeProvider?.configured ? `${activeProvider.name} connected` : 'Provider setup needed', tone: 'settings', icon: <SlidersHorizontal /> },
  ]

  return (
    <div className="page page--home">
      <section className={`home-hero${state.liveComputer.assistance?.showGuide && state.liveComputer.assistance.guide.answer ? ' home-hero--secondary' : ''}`}>

        <div className="home-hero__content">
          <CarvePresence state={dictationLive ? 'listening' : 'ready'} className="home-presence" />
          <div className="home-hero__eyebrow">{carveTagline}</div>
          <h1>{state.liveComputer.assistance?.showGuide && state.liveComputer.assistance.guide.answer ? 'Start something new' : 'What can I do for you?'}</h1>
          <form className="home-intent" onSubmit={(event) => { event.preventDefault(); void startWork() }}>
            <span className="home-intent__icon"><Sparkles size={20} /></span>
            <label>
              <small>Make room for something better</small>
              <textarea
                ref={goalField}
                rows={1}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  void startWork()
                }}
                placeholder="Plan a weekend, research an idea, tidy up a document…"
                aria-label="What do you want Carve to do?"
              />
            </label>
            <div className="home-intent__actions">
              <DictationButton
                enabled={state.dictation.configured}
                notify={notify}
                onLive={setDictationLive}
                controlRef={dictationControl}
                field={{ value: goal, onChange: setGoal }}
              />
              <button className="home-intent__submit" type="submit" disabled={!goal.trim() && !dictationLive}>Let’s do it <ArrowRight size={16} /></button>
            </div>
          </form>
          {dictationLive ? <div className="home-intent__dictation" role="status" aria-live="polite"><span /><span>Listening. Your words land in the field as you speak; press Let’s do it or click the mic to stop.</span></div> : null}
          <div className="home-ideas" aria-label="Ideas to get started">
            {([
              ['Plan my weekend', 'Research a relaxed weekend in San Francisco and draft a two-day itinerary in a document.'],
              ['Compare my options', 'Help me compare three products. Ask me which products and what matters most before researching them.'],
              ['Polish a document', 'Help me improve a document. Ask me which document and what I want to change before editing.'],
            ] as const).map(([label, suggestion]) => <button key={label} type="button" onClick={() => { setGoal(suggestion); goalField.current?.focus() }} disabled={Boolean(dictationLive)}>{label}<ArrowRight size={14} /></button>)}
          </div>
          <div className="home-hero__trust"><ShieldCheck size={14} /><span>Choose where Carve works. Review the plan. Stay in control.</span>{props.desktop.desktop ? <span className="home-hero__guide">Or, in any app, press <kbd>{props.desktop.guideShortcut}</kbd> to ask about it{props.desktop.doItShortcut ? <> or <kbd>{props.desktop.doItShortcut}</kbd> to have Carve act there</> : null}.</span> : null}</div>
        </div>
      </section>

      <GuideOnboardingCard state={state} desktop={props.desktop} notify={notify} refresh={props.refresh} />

      <details className="home-destinations home-more">
        <summary>More from Carve <ChevronDown size={16} /></summary>
        <header className="home-section-heading"><div><small>Choose a path</small><h2 id="home-destinations-title">Where would you like to start?</h2></div><span>Each path opens at the next useful step.</span></header>
        <div className="home-destination-grid">
          {destinations.map((destination) => (
            <button type="button" className={`home-destination home-destination--${destination.tone}`} key={destination.page} onClick={() => navigate(destination.page)}>
              <span className="home-destination__icon">{destination.icon}</span>
              <small>{destination.label}</small>
              <h3>{destination.title}</h3>
              <p>{destination.description}</p>
              <span className="home-destination__footer"><span>{destination.meta}</span><span className="home-destination__arrow"><ArrowRight size={15} /></span></span>
            </button>
          ))}
        </div>
      </details>

      {continueRun || activeSession ? (
        <section className="home-continue" aria-label="Continue where you left off">
          <div className={`home-continue__icon${activeRun ? ' home-continue__icon--active' : ''}`}>{activeRun ? <Activity size={18} /> : activeSession ? <Radio size={18} /> : <Clock3 size={18} />}</div>
          <div className="home-continue__copy">
            <small>{activeRun ? 'Work in progress' : activeSession ? 'Learning in progress' : 'Continue where you left off'}</small>
            <strong>{continueRun?.plan.goal ?? activeSession?.name}</strong>
            <span>{continueRun ? `${humanize(continueRun.status)} · ${ago(continueRun.createdAt)}` : `${activeSession?.nextFixtureIndex ?? 0} observations captured`}</span>
          </div>
          <button type="button" onClick={() => { if (continueRun) openWork(continueRun.plan.goal, 'resume'); else navigate('learn') }}>Continue <ArrowRight size={15} /></button>
        </section>
      ) : null}
    </div>
  )
}

type AmbientCandidate = CarveState['ambient']['candidates'][number]

/** Turns a signature run into something a person recognises as their own work. */
function candidateLabel(candidate: AmbientCandidate): string {
  const steps = candidate.signatures.map((signature) => signature.split(' :: ')[1] ?? signature)
  const first = steps[0] ?? 'workflow'
  const last = steps[steps.length - 1] ?? ''
  return `${first} to ${last}`.replace(/\b\w/gu, (character) => character.toUpperCase()).slice(0, 60)
}

function AmbientDiscovery({ state, desktop, refresh, notify, onWatch }: Pick<ViewProps, 'state' | 'desktop' | 'refresh' | 'notify'> & { onWatch: (candidate: AmbientCandidate) => void }) {
  const { settings, running, available, candidates } = state.ambient
  const [busy, setBusy] = useState(false)
  // Shown in the browser too, read-only, so the capability is discoverable
  // rather than hidden behind the desktop build.
  if (!desktop.desktop && candidates.length === 0) return null

  const setEnabled = async (enabled: boolean) => {
    setBusy(true)
    try {
      await invoke({ kind: 'ambient.set_enabled', enabled })
      await refresh()
      notify(enabled ? 'Ambient discovery on — window names only, no screenshots' : 'Ambient discovery off', enabled ? 'positive' : 'warning')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }
  const setText = async (enabled: boolean) => {
    setBusy(true)
    try {
      await invoke({ kind: 'ambient.set_text', enabled })
      await refresh()
      notify(enabled ? 'Reading on-screen text — recognised locally, no screenshots stored' : 'Stopped reading on-screen text', enabled ? 'positive' : 'warning')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }
  const dismiss = async (candidate: AmbientCandidate) => {
    try {
      await invoke({ kind: 'ambient.candidate.dismiss', candidateId: candidate.id })
      await refresh()
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  return (
    <Card className="ambient-panel">
      <div className="ambient-panel__head">
        <div>
          <div className="eyebrow">Discovery</div>
          <h2>{candidates.length > 0 ? 'Work you repeat' : 'Notice what repeats'}</h2>
          <p>{settings.extractText ? 'Carve notices repeated work from window names and locally recognised screen text. Images used to read text are not saved.' : 'Carve notices repeated work from the names of windows you use. Screen text is not collected in this mode.'} Capture stays on this Mac. Sharing saved text with AI for Recall answers or indexing is a separate choice.</p>
        </div>
        <div className="ambient-panel__switches">
          <Toggle checked={settings.enabled} onChange={(next) => void setEnabled(next)} disabled={busy || !available} label={running ? 'Watching for patterns' : 'Off'} description={available ? `Every ${settings.intervalSeconds}s · kept ${settings.retentionDays} days · no screenshots` : desktop.desktop ? 'Needs Screen Recording permission' : 'Available in the Carve desktop app'} />
          <Toggle checked={settings.extractText} onChange={(next) => void setText(next)} disabled={busy || !available || !settings.enabled} label="Also read text on screen" description="Uses temporary screen images to recognise text on this Mac. Saves text, not images; masked regions are excluded." />
        </div>
      </div>

      {settings.enabled && candidates.length === 0 ? (
        <p className="ambient-panel__empty">Nothing repeated yet. A sequence has to come back at least three times across two different days before it is worth asking about.</p>
      ) : null}

      {candidates.length > 0 ? (
        <div className="ambient-candidates">
          {candidates.slice(0, 4).map((candidate) => (
            <div className="ambient-candidate" key={candidate.id}>
              <div className="ambient-candidate__meta">
                <strong>{candidateLabel(candidate)}</strong>
                <span>{candidate.occurrences} times across {candidate.distinctDays} days · about {Math.max(1, Math.round(candidate.medianDurationMs / 60000))} min</span>
              </div>
              <ol className="ambient-candidate__steps">
                {candidate.signatures.map((signature, index) => <li key={`${candidate.id}-${index}`}>{signature.replace(' :: ', ' · ')}</li>)}
              </ol>
              <div className="ambient-candidate__actions">
                <Button variant="ghost" onClick={() => void dismiss(candidate)}>Not a workflow</Button>
                <Button onClick={() => onWatch(candidate)}><ScanLine size={15} /> Watch this next time</Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  )
}

interface RecallHitView {
  momentId: string
  components?: { lexical: number; semantic: number; graph: number; associative: number; strength: number }
  source: 'observation' | 'ambient'
  occurredAt: string
  app: string
  title: string
  score: number
  sessionId: string | null
  screenshotRef: string | null
}
interface RecallEntityView { id: string; kind: 'person' | 'organization' | 'document' | 'identifier' | 'application'; name: string; mentionCount: number }
interface RecallAnswerDetailView {
  source: 'deterministic' | 'model'
  providerId: string | null
  model: string | null
  citedMomentIds: string[]
  usedScopeAnalysis: boolean
  requiresExternalTransmission: boolean
  fallbackReason: string | null
  usage: { inputTokens: number | null; outputTokens: number | null } | null
}
type ExcerptDepth = 'brief' | 'normal' | 'thorough'
interface EmbeddingPolicyView {
  mode: 'off' | 'local' | 'hosted'
  providerId: string | null
  model: string | null
  consentGranted: boolean
  needsConsent: boolean
  available: Array<{ id: string; name: string; kind: 'mock' | 'hosted' | 'local'; embeddingModel: string | null }>
  disclosure: string
  active: boolean
}
interface ModelSpendView {
  calls: number
  inputTokens: number
  outputTokens: number
  cost: number | null
  byModel: Array<{ providerId: string; model: string; job: string; calls: number; inputTokens: number; outputTokens: number; cost: number | null }>
}
interface RecallAnswerPolicyView {
  providerId: string
  providerName: string
  providerKind: 'mock' | 'local' | 'hosted'
  model: string
  privacyNote: string
  requiresExternalTransmission: boolean
  disclosure: string
  consentGranted: boolean
  needsConsent: boolean
  blockedReasons: string[]
  ready: boolean
}
interface RecallScopeCountView { inWindow: number; unreadInWindow: number; total: number; unreadTotal: number; skipped: number; earliestIso: string | null }
interface UnreadCaptureView { momentId: string; app: string; title: string; occurredAt: string }
type RecallScopeId = 'anytime' | 'today' | 'week' | 'month' | 'custom'
type RecallIntentView = 'lookup' | 'overview' | 'themes' | 'compare' | 'capture_count' | 'frequency' | 'inventory' | 'timeline' | 'trend' | 'visual'
interface RecallAnalysisView {
  coverage: { eligibleMoments: number; analyzedMoments: number; truncated: boolean; selectedSessions: number; representedSessions: number }
  captures: { recordedMoments: number; screenshotCaptures: number; textOnlyMoments: number }
  sessions: Array<{ sessionId: string | null; label: string; moments: number; screenshotCaptures: number; startedAt: string | null; endedAt: string | null; applications: string[]; topActivities: string[] }>
  tools: Array<{ tool: string; kind: 'application' | 'website'; observations: number; visits: number; sessions: number; durationMs: number | null; durationCoverage: number; evidenceMomentIds: string[] }>
  themes: Array<{ label: string; observations: number; sessions: number; evidenceMomentIds: string[] }>
  comparison: Array<{ sessionId: string; label: string; moments: number; applications: string[]; topActivities: string[]; uniqueApplications: string[] }>
  sharedApplications: string[]
}
interface RecallResultView {
  original: string
  terms: string
  windowSource?: 'question' | 'scope' | 'none'
  unreadInWindow?: number
  estimate?: { excerpts: number; characters: number; tokens: number }
  answerDetail?: RecallAnswerDetailView
  window: { fromIso: string | null; toIso: string | null; label: string | null }
  sessionScope?: { sessionIds: string[]; label: string } | null
  hits: RecallHitView[]
  searchedMoments: number
  entities: RecallEntityView[]
  answer: string
  plan?: { intent: RecallIntentView; unit: 'moment' | 'episode' | 'session' | 'tool'; exhaustive: boolean; answerStrategy: 'deterministic' | 'synthesis'; rationale: string }
  analysis?: RecallAnalysisView | null
  conversationId?: string
}
interface RecallConversationSummaryView {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  scope: { fromIso: string | null; toIso: string | null; label: string | null; sessionIds?: string[] } | null
  messageCount: number
}
interface RecallConversationMessageView {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  result: RecallResultView | null
}
interface RecallConversationView extends RecallConversationSummaryView { messages: RecallConversationMessageView[] }

/**
 * Loads a stored capture only when the user asks for it, so opening Recall
 * never pulls every screenshot in the result set off disk.
 */
function RecallThumbnail({ momentId, title }: { momentId: string; title: string }) {
  const observationId = momentId.startsWith('obs:') ? momentId.slice(4) : null
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'open' | 'missing'>('idle')
  if (!observationId) return null

  const toggle = async () => {
    if (state === 'open') return setState('idle')
    if (dataUrl) return setState('open')
    setState('loading')
    try {
      const result = await invoke<{ dataUrl: string | null }>({ kind: 'observation.screenshot', observationId })
      setDataUrl(result.dataUrl)
      setState(result.dataUrl ? 'open' : 'missing')
    } catch { setState('missing') }
  }

  return (
    <div className="recall-shot">
      <Button size="small" variant="ghost" onClick={() => void toggle()}>
        <Eye size={13} /> {state === 'open' ? 'Hide' : state === 'loading' ? 'Loading' : 'Screenshot'}
      </Button>
      {state === 'open' && dataUrl ? <img src={dataUrl} alt={`Stored capture of ${title}`} /> : null}
      {state === 'missing' ? <span className="recall-shot__missing">Capture expired or deleted</span> : null}
    </div>
  )
}

/** Money is only ever shown when a rate was supplied, so a blank rate reads as
 *  "unknown" rather than as free. */
export function formatMoney(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

function usageLabel(usage: { inputTokens: number | null; outputTokens: number | null } | null): string {
  if (!usage || usage.inputTokens === null) return ''
  return ` · ${usage.inputTokens.toLocaleString()} in / ${(usage.outputTokens ?? 0).toLocaleString()} out`
}

function recallAnswerBasis(detail: RecallAnswerDetailView): string {
  const captures = detail.citedMomentIds.length
  const cited = captures > 0 ? `${captures} cited capture${captures === 1 ? '' : 's'}` : ''
  if (detail.usedScopeAnalysis) return [cited, 'verified local scope analysis'].filter(Boolean).join(' and ')
  return cited || 'the selected evidence'
}

function recallDuration(durationMs: number | null): string {
  if (durationMs === null) return 'duration unavailable'
  const minutes = Math.round(durationMs / 60_000)
  return minutes < 1 ? '<1 min measured' : `${minutes} min measured`
}

export function RecallView({ state, notify }: ViewProps) {
  const [question, setQuestion] = useState('')
  const questionInputRef = useRef<HTMLInputElement>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [result, setResult] = useState<RecallResultView | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<RecallConversationSummaryView[]>([])
  const [conversationMessages, setConversationMessages] = useState<RecallConversationMessageView[]>([])
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingConversationTitle, setEditingConversationTitle] = useState('')
  const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [policy, setPolicy] = useState<RecallAnswerPolicyView | null>(null)
  // Set only when a question is waiting on a one-time permission decision.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [scopeId, setScopeId] = useState<RecallScopeId>('anytime')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [scopeCount, setScopeCount] = useState<RecallScopeCountView | null>(null)
  // A question waiting on "should I read these first?", holding the retrieval
  // already done so choosing does not repeat it.
  const [unreadPrompt, setUnreadPrompt] = useState<{ question: string; count: number; pending: RecallResultView } | null>(null)
  // Answering "not now" once should not mean being asked again every question.
  const [skipUnread, setSkipUnread] = useState(false)
  // Null until "See which ones" is used; then the captures, with the ones the
  // person has chosen to leave unread.
  const [unreadList, setUnreadList] = useState<UnreadCaptureView[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [depth, setDepth] = useState<ExcerptDepth>('normal')
  const [spend, setSpend] = useState<ModelSpendView | null>(null)
  const [costDebug, setCostDebug] = useState(false)
  // A question held at the point of spending, when cost debug is on.
  const [costCheck, setCostCheck] = useState<{ question: string; tokens: number; excerpts: number } | null>(null)

  const [rate, setRate] = useState<{ inputPerMillion: number; outputPerMillion: number } | null>(null)
  // Set when a question is waiting on permission to show screenshots.
  const [imageAsk, setImageAsk] = useState<string | null>(null)

  useEffect(() => {
    void invoke<{ enabled: boolean }>({ kind: 'cost.debug.get' }).then(({ enabled }) => setCostDebug(enabled)).catch(() => setCostDebug(false))
    void invoke<{ conversations: RecallConversationSummaryView[] }>({ kind: 'recall.conversations.list' })
      .then(({ conversations: saved }) => setConversations(saved))
      .catch(() => setConversations([]))
  }, [])

  // Priced from the rate directly rather than from an average of past calls, so
  // the first question of a session shows a figure like every other one.
  useEffect(() => {
    if (!policy?.ready) return
    void invoke<{ rate: { inputPerMillion: number; outputPerMillion: number } | null }>({ kind: 'model.rate.get', providerId: policy.providerId, model: policy.model })
      .then(({ rate: next }) => setRate(next))
      .catch(() => setRate(null))
  }, [policy?.providerId, policy?.model, policy?.ready])

  // Typical cost is taken from what questions have actually consumed rather
  // than from the estimator, so the figure shown before asking is grounded in
  // this machine's own history.
  const loadSpend = () => {
    void invoke<ModelSpendView>({ kind: 'model.spend', sinceIso: null })
      .then(setSpend)
      .catch(() => setSpend(null))
  }
  useEffect(loadSpend, [result])
  const perQuestion = spend && spend.calls > 0
    ? { tokens: Math.round((spend.inputTokens + spend.outputTokens) / spend.calls), cost: spend.cost === null ? null : spend.cost / spend.calls }
    : null
  const unread = scopeCount?.unreadInWindow ?? 0

  // Narrowing is a retrieval lever, not a billing one. Measured over 2,400
  // captures it took ranking from 210ms to ~18ms, while the prompt stayed at
  // ~220 tokens in every scope: the excerpt cap already bounds what a question
  // can cost. So the control reports captures *in range* rather than claiming a
  // saving it does not produce, and a number that moves as you click is worth
  // more than either promise.
  const timeScope = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
    const back = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
    if (scopeId === 'today') return { fromIso: startOfToday.toISOString(), toIso: null, label: 'today' }
    if (scopeId === 'week') return { fromIso: back(7), toIso: null, label: 'the last 7 days' }
    if (scopeId === 'month') return { fromIso: back(30), toIso: null, label: 'the last 30 days' }
    if (scopeId === 'custom') {
      const fromIso = customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : null
      const toIso = customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : null
      if (!fromIso && !toIso) return null
      return { fromIso, toIso, label: customFrom && customTo ? `${customFrom} to ${customTo}` : customFrom ? `since ${customFrom}` : `up to ${customTo}` }
    }
    return null
  }, [scopeId, customFrom, customTo])

  const scope = useMemo(() => {
    if (!timeScope && selectedSessionIds.length === 0) return null
    return {
      fromIso: timeScope?.fromIso ?? null,
      toIso: timeScope?.toIso ?? null,
      label: timeScope?.label ?? null,
      sessionIds: selectedSessionIds,
    }
  }, [timeScope, selectedSessionIds])

  const recallSessions = useMemo(
    () => state.sessions.filter((session) => session.nextFixtureIndex > 0),
    [state.sessions],
  )
  const recentSessions = recallSessions.slice(0, 5)
  const additionalSessions = recallSessions.slice(5)
  const selectedSessions = selectedSessionIds
    .map((sessionId) => recallSessions.find((session) => session.id === sessionId))
    .filter((session): session is NonNullable<typeof session> => Boolean(session))
  const selectedSessionLabel = selectedSessions.length === 0
    ? 'All sessions and ambient history'
    : selectedSessions.length === 1
      ? selectedSessions[0]?.name ?? 'Selected session'
      : `${selectedSessions[0]?.name ?? 'Selected session'} + ${selectedSessions.length - 1} more`
  const timeScopeLabel = timeScope?.label ?? 'Any time'
  const toggleSession = (sessionId: string) => setSelectedSessionIds((current) => current.includes(sessionId)
    ? current.filter((candidate) => candidate !== sessionId)
    : [...current, sessionId])

  const customInverted = scopeId === 'custom' && customFrom !== '' && customTo !== '' && customFrom > customTo

  useEffect(() => {
    let live = true
    if (customInverted) { setScopeCount(null); return }
    void invoke<RecallScopeCountView>({ kind: 'recall.scope_count', fromIso: scope?.fromIso ?? null, toIso: scope?.toIso ?? null, sessionIds: selectedSessionIds })
      .then((next) => { if (live) setScopeCount(next) })
      .catch(() => { if (live) setScopeCount(null) })
    return () => { live = false }
  }, [scope?.fromIso, scope?.toIso, selectedSessionIds, customInverted, result])

  // Asking is one action. Recall answers in words whenever a model can do it,
  // because that is what a question is for; the machinery for choosing and
  // permitting a model lives in Settings, not in front of the question.
  useEffect(() => {
    let live = true
    void invoke<RecallAnswerPolicyView>({ kind: 'recall.answer_policy' })
      .then((next) => { if (live) setPolicy(next) })
      .catch(() => { if (live) setPolicy(null) })
    return () => { live = false }
  }, [state.providers])

  const loadConversations = async () => {
    const { conversations: saved } = await invoke<{ conversations: RecallConversationSummaryView[] }>({ kind: 'recall.conversations.list' })
    setConversations(saved)
  }

  const applyConversationScope = (saved: RecallConversationSummaryView['scope']) => {
    setSelectedSessionIds(saved?.sessionIds ?? [])
    if (!saved || (!saved.fromIso && !saved.toIso)) {
      setScopeId('anytime'); setCustomFrom(''); setCustomTo(''); return
    }
    setScopeId('custom')
    setCustomFrom(saved.fromIso?.slice(0, 10) ?? '')
    setCustomTo(saved.toIso?.slice(0, 10) ?? '')
  }

  const openConversation = async (id: string) => {
    setBusy(true)
    setChatOpen(true)
    try {
      const saved = await invoke<RecallConversationView>({ kind: 'recall.conversation.get', conversationId: id })
      setConversationId(saved.id)
      setConversationMessages(saved.messages)
      applyConversationScope(saved.scope)
      const latest = [...saved.messages].reverse().find((message) => message.role === 'assistant' && message.result)?.result ?? null
      setResult(latest)
      setQuestion('')
      setEditingConversationId(null)
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
    finally { setBusy(false) }
  }

  const newConversation = () => {
    setChatOpen(true)
    setConversationId(null)
    setConversationMessages([])
    setResult(null)
    setQuestion('')
    setSkipUnread(false)
    setPendingQuestion(null)
    setSelectedSessionIds([])
    setScopeId('anytime')
    setCustomFrom('')
    setCustomTo('')
    requestAnimationFrame(() => questionInputRef.current?.focus())
  }

  const closeConversation = () => {
    setChatOpen(false)
    setConversationId(null)
    setConversationMessages([])
    setResult(null)
    setQuestion('')
    setPendingQuestion(null)
  }

  const saveConversationTitle = async () => {
    if (!editingConversationId || !editingConversationTitle.trim()) return
    try {
      await invoke({ kind: 'recall.conversation.rename', conversationId: editingConversationId, title: editingConversationTitle })
      setEditingConversationId(null)
      await loadConversations()
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const deleteConversation = async () => {
    const id = deleteConversationId
    setDeleteConversationId(null)
    if (!id) return
    try {
      await invoke({ kind: 'recall.conversation.delete', conversationId: id })
      if (conversationId === id) closeConversation()
      await loadConversations()
      notify('Recall conversation deleted. Captured evidence was not changed.', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const search = (asked: string, withAnswer: boolean, withImages = false, save = false, replaceLast = false) => invoke<RecallResultView>({
    kind: 'recall.query',
    question: asked,
    ...(scope ? { scope } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(save ? { save: true } : {}),
    ...(replaceLast ? { replaceLast: true } : {}),
    ...(withAnswer ? { infer: true, ...(policy?.providerId ? { providerId: policy.providerId } : {}), depth, ...(withImages ? { withImages: true } : {}) } : {}),
  })

  /**
   * Re-asks the same question with the matching screenshots attached.
   *
   * Escalating from an answer that fell short beats guessing in advance which
   * questions are visual: the text answer says plainly when it cannot tell, and
   * that is the moment to offer eyes. It also means the seven-times cost is
   * paid only on the questions that need it.
   */
  const lookAtScreenshots = async () => {
    if (!result) return
    setBusy(true)
    try {
      const next = await search(result.original, true, true, Boolean(conversationId), Boolean(conversationId))
      if (next.answerDetail?.fallbackReason?.includes('not been allowed')) {
        setImageAsk(result.original)
        return
      }
      present(next)
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }

  const allowImages = async () => {
    const asked = imageAsk
    setImageAsk(null)
    if (!asked || !policy) return
    setBusy(true)
    try {
      await invoke({ kind: 'recall.image_consent', providerId: policy.providerId })
      present(await search(asked, true, true, Boolean(conversationId), Boolean(conversationId)))
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }

  const present = (next: RecallResultView) => {
    setResult(next)
    if (next.conversationId) {
      setConversationId(next.conversationId)
      setQuestion('')
      void Promise.all([
        invoke<RecallConversationView>({ kind: 'recall.conversation.get', conversationId: next.conversationId }),
        invoke<{ conversations: RecallConversationSummaryView[] }>({ kind: 'recall.conversations.list' }),
      ]).then(([saved, listed]) => {
        setConversationMessages(saved.messages)
        setConversations(listed.conversations)
      }).catch(() => undefined)
    }
    const detail = next.answerDetail
    if (detail?.source === 'deterministic' && detail.fallbackReason) {
      notify(`Showing matches only: ${detail.fallbackReason}`, 'warning')
    }
  }

  /**
   * The one place a question is carried out, so every route into it — asked
   * directly, resumed after granting permission, resumed after declining it —
   * gets the same checks. Three entry points each doing their own thing is how
   * the unread check ended up being skippable by choosing "just show matches".
   */
  const holdForCost = (asked: string, pending: RecallResultView) => {
    setCostCheck({ question: asked, tokens: pending.estimate?.tokens ?? 0, excerpts: pending.estimate?.excerpts ?? 0 })
  }

  const proceed = async (asked: string, ignoreUnread = false, skipCost = false) => {
    setBusy(true)
    try {
      // `ignoreUnread` is passed rather than read back from state: a caller that
      // has just decided to skip cannot see its own `setSkipUnread` yet, so
      // relying on the state made the dialog reappear immediately after being
      // dismissed.
      if (unread > 0 && !skipUnread && !ignoreUnread) {
        const pending = await search(asked, false)
        const inWindow = pending.unreadInWindow ?? 0
        if (inWindow > 0) return setUnreadPrompt({ question: asked, count: inWindow, pending })
        if (costDebug && !skipCost) return holdForCost(asked, pending)
        return present(await search(asked, true, false, true))
      }
      // With cost debug on, retrieval runs first so the exact prompt is known,
      // and nothing is sent until the figure has been seen.
      if (costDebug && !skipCost) {
        return holdForCost(asked, await search(asked, false))
      }
      present(await search(asked, true, false, true))
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
    finally { setBusy(false) }
  }

  const ask = async () => {
    if (!question.trim()) return
    if (!policy) return notify('Inference is not ready yet. Try again in a moment.', 'warning')
    if (!policy.ready) return notify(`Inference is unavailable: ${policy.blockedReasons.join(' · ') || 'configure a text model in Settings'}`, 'danger')
    // Hosted inference is agreed to once, in the moment it first matters, then
    // every question follows the same model-composed answer path.
    if (policy.needsConsent) { setPendingQuestion(question); return }
    await proceed(question)
  }

  const answerWithoutReading = async () => {
    const prompt = unreadPrompt
    closePrompt()
    setSkipUnread(true)
    if (!prompt) return
    await proceed(prompt.question, true)
  }

  const closePrompt = () => { setUnreadPrompt(null); setUnreadList(null); setExcluded(new Set()) }

  const showWhichOnes = async () => {
    try {
      const { captures } = await invoke<{ captures: UnreadCaptureView[] }>({
        kind: 'recall.unread_captures',
        fromIso: unreadPrompt?.pending.window.fromIso ?? null,
        toIso: unreadPrompt?.pending.window.toIso ?? null,
        sessionIds: unreadPrompt?.pending.sessionScope?.sessionIds ?? [],
      })
      setUnreadList(captures)
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const readThenAnswer = async () => {
    const prompt = unreadPrompt
    const chosen = unreadList?.filter((capture) => !excluded.has(capture.momentId)).map((capture) => capture.momentId)
    const leftOut = [...excluded]
    closePrompt()
    if (!prompt) return
    // Leaving a capture out is a decision, not a deferral, so it is recorded
    // against the capture and never offered again.
    if (leftOut.length > 0) await invoke({ kind: 'recall.skip_captures', momentIds: leftOut })
    await readCaptures(prompt.question, chosen, {
      fromIso: prompt.pending.window.fromIso,
      toIso: prompt.pending.window.toIso,
      label: prompt.pending.window.label,
      sessionIds: prompt.pending.sessionScope?.sessionIds ?? [],
    })
  }

  const allowAndAnswer = async () => {
    const asked = pendingQuestion
    setPendingQuestion(null)
    if (!asked) return
    setBusy(true)
    try {
      setPolicy(await invoke<RecallAnswerPolicyView>({ kind: 'recall.answer_consent', providerId: policy?.providerId ?? null }))
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
      setBusy(false)
      return
    }
    setBusy(false)
    await proceed(asked)
  }

  const readCaptures = async (thenAsk?: string, momentIds?: string[], effectiveScope = scope) => {
    setBusy(true)
    try {
      const outcome = await invoke<{ examined: number; enriched: number; empty: number; redactions: string[] }>({
        kind: 'recall.enrich_text',
        ...(momentIds === undefined ? {} : { momentIds }),
        ...(effectiveScope ? { scope: effectiveScope } : {}),
      })
      const { message, tone } = readOutcomeMessage(outcome)
      notify(message, tone)
      setScopeCount(await invoke<RecallScopeCountView>({ kind: 'recall.scope_count', fromIso: scope?.fromIso ?? null, toIso: scope?.toIso ?? null, sessionIds: selectedSessionIds }))
      if (thenAsk) await proceed(thenAsk)
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }

  const examples = selectedSessionIds.length > 0
    ? ['What were the key decisions?', 'What follow-ups or next steps came up?', 'Give me the important details from this session']
    : ['What was that customer two days ago who wrote in about a missing payment', 'What was I working on yesterday', 'Anything about invoices last week']
  const transcriptMessages = conversationMessages
  const activeConversationTitle = conversations.find((conversation) => conversation.id === conversationId)?.title ?? 'New conversation'

  return (
    <div className="page">
      {deleteConversationId ? (
        <Dialog
          title="Delete this Recall conversation?"
          description="This removes the saved questions and answers. The captured screens they referenced are evidence and will not be changed."
          onDismiss={() => setDeleteConversationId(null)}
        >
          <div className="dialog__buttons">
            <Button variant="danger" onClick={() => void deleteConversation()}>Delete conversation</Button>
            <Button variant="ghost" onClick={() => setDeleteConversationId(null)}>Keep it</Button>
          </div>
        </Dialog>
      ) : null}
      {pendingQuestion ? (
        <Dialog
          title="Let Carve use AI to answer?"
          description={policy?.disclosure ?? 'Carve needs a configured model to write Recall answers.'}
          onDismiss={() => setPendingQuestion(null)}
        >
          <div className="dialog__buttons">
            <Button onClick={() => void allowAndAnswer()} disabled={busy}>{busy ? 'Enabling' : 'Allow and continue'}</Button>
            <Button variant="ghost" onClick={() => setPendingQuestion(null)} disabled={busy}>Cancel</Button>
          </div>
          <small className="dialog__note">Remembered for this service and endpoint until you turn off Recall answers in Settings. Provider retention applies; conversations are managed separately from saved captures.</small>
        </Dialog>
      ) : null}
      {imageAsk ? (
        <Dialog
          title="Show the screenshots to the model?"
          description={`Answering from text sends a passage around your question. This sends only matching screenshots that you approved and saved as sanitized derivatives to ${policy?.providerName ?? 'the model'}; unreviewed captures are skipped. It costs roughly seven times as much, and it is the only way to answer questions about what something looked like.`}
          onDismiss={() => setImageAsk(null)}
        >
          <div className="dialog__buttons">
            <Button disabled={busy} onClick={() => void allowImages()}>Allow and look</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setImageAsk(null)}>Keep to text</Button>
          </div>
          <small className="dialog__note">Remembered for this service and endpoint until you turn off screenshot sharing in Settings. Only approved, sanitized images are eligible. Provider retention applies.</small>
        </Dialog>
      ) : null}
      {costCheck ? (
        <Dialog
          title="Send this to the model?"
          description={`${costCheck.excerpts} excerpt${costCheck.excerpts === 1 ? '' : 's'} — about ${costCheck.tokens.toLocaleString()} tokens to send${rate ? `, roughly ${formatMoney((costCheck.tokens / 1_000_000) * rate.inputPerMillion)}; the reply is billed on top` : ''}. Finding the matches and reading the screenshots was free — this is the only step that costs anything.`}
          onDismiss={() => setCostCheck(null)}
        >
          <div className="dialog__buttons">
            <Button disabled={busy} onClick={() => { const held = costCheck; setCostCheck(null); if (held) void proceed(held.question, true, true) }}>Send and answer</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setCostCheck(null)}>Cancel</Button>
          </div>
          <small className="dialog__note">Turn this check off in Settings → cost debug.</small>
        </Dialog>
      ) : null}
      {unreadPrompt ? (
        <Dialog
          title={`Read ${unreadPrompt.count} capture${unreadPrompt.count === 1 ? '' : 's'} first?`}
          description={`${unreadPrompt.count} capture${unreadPrompt.count === 1 ? '' : 's'} in the range you are searching ${unreadPrompt.count === 1 ? 'has' : 'have'} only ever been searchable by window name. Reading ${unreadPrompt.count === 1 ? 'it' : 'them'} runs Apple's text recognition on this machine — no model, no cost — but it cannot be undone, so anything on the screen becomes searchable from then on.`}
          onDismiss={() => void answerWithoutReading()}
        >
          {unreadList ? (
            <ul className="unread-list">
              {unreadList.map((capture) => {
                const left = excluded.has(capture.momentId)
                return (
                  <li key={capture.momentId} className={left ? 'is-excluded' : ''}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!left}
                        onChange={(event) => setExcluded((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.delete(capture.momentId); else next.add(capture.momentId)
                          return next
                        })}
                      />
                      <span className="unread-list__what">
                        <strong>{capture.title}</strong>
                        <small>{capture.app} · {new Date(capture.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>
                      </span>
                    </label>
                    <RecallThumbnail momentId={capture.momentId} title={capture.title} />
                  </li>
                )
              })}
              {unreadList.length < unreadPrompt.count ? (
                <li className="unread-list__more">Showing {unreadList.length} of {unreadPrompt.count}. The rest will be read too.</li>
              ) : null}
            </ul>
          ) : null}
          <div className="dialog__buttons">
            <Button disabled={busy} onClick={() => void readThenAnswer()}>
              {busy ? 'Reading' : unreadList && excluded.size > 0
                ? `Read the ${unreadList.length - excluded.size} selected`
                : 'Read, then answer'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void answerWithoutReading()}>Answer without them</Button>
            {unreadList ? null : (
              <button type="button" className="dialog__link" onClick={() => void showWhichOnes()}>See which ones</button>
            )}
          </div>
          {unreadList && excluded.size > 0 ? (
            <small className="dialog__note">{excluded.size} left unread. Carve will not offer {excluded.size === 1 ? 'it' : 'them'} again — undo in Settings.</small>
          ) : null}
        </Dialog>
      ) : null}
      {!chatOpen ? (
        <div className="recall-lobby">
          <PageIntro label="Recall" title="Conversations" description="Ask about anything Carve observed, then continue with follow-up questions." action={<Pill icon={<ShieldCheck size={13} />}>Saved captures: {state.ambient.settings.retentionDays} days</Pill>} />
          <Card className="recall-conversation-history">
            <div className="recall-conversation-history__head">
              <div><strong>Your conversations</strong><small>Saved locally on this Mac</small></div>
              <Button onClick={newConversation}><Plus size={14} /> New conversation</Button>
            </div>
            {conversations.length === 0 ? (
              <button type="button" className="recall-conversation-history__empty" onClick={newConversation}>
                <span><Sparkles size={18} /></span>
                <strong>Start your first conversation</strong>
                <small>Choose what Carve should search, then ask naturally.</small>
              </button>
            ) : (
              <div className="recall-conversation-list">
                {conversations.map((conversation) => (
                  <div className="recall-conversation-item" key={conversation.id}>
                    {editingConversationId === conversation.id ? (
                      <form onSubmit={(event) => { event.preventDefault(); void saveConversationTitle() }}>
                        <input value={editingConversationTitle} maxLength={100} autoFocus onChange={(event) => setEditingConversationTitle(event.target.value)} aria-label="Conversation title" />
                        <Button size="small" type="submit">Save</Button>
                        <Button size="small" variant="ghost" type="button" onClick={() => setEditingConversationId(null)}>Cancel</Button>
                      </form>
                    ) : (
                      <>
                        <button type="button" className="recall-conversation-item__open" onClick={() => void openConversation(conversation.id)}>
                          <strong>{conversation.title}</strong>
                          <small>{Math.floor(conversation.messageCount / 2)} turn{conversation.messageCount === 2 ? '' : 's'} · {ago(conversation.updatedAt)}</small>
                        </button>
                        <div className="recall-conversation-item__actions">
                          <button type="button" aria-label={`Rename ${conversation.title}`} onClick={() => { setEditingConversationId(conversation.id); setEditingConversationTitle(conversation.title) }}><Pencil size={12} /></button>
                          <button type="button" aria-label={`Delete ${conversation.title}`} onClick={() => setDeleteConversationId(conversation.id)}><Trash2 size={12} /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <div className="recall-chat-heading">
          <button type="button" className="recall-chat-heading__back" onClick={closeConversation}><ArrowLeft size={15} /> Conversations</button>
          <div className="recall-chat-heading__copy">
            <small>Recall conversation</small>
            <h1>{activeConversationTitle}</h1>
            <span>{selectedSessionLabel} · {timeScopeLabel}</span>
          </div>
          <Button variant="secondary" size="small" onClick={newConversation}><Plus size={13} /> New</Button>
        </div>
      )}

      {chatOpen ? (
        <Card className={`recall-transcript ${transcriptMessages.length === 0 ? 'is-empty' : ''}`}>
          {transcriptMessages.length === 0 ? (
            <div className="recall-chat-empty">
              <span><Sparkles size={20} /></span>
              <strong>What would you like to remember?</strong>
              <p>Ask for a detail, a summary, a comparison, themes, or how often a tool was used.</p>
            </div>
          ) : transcriptMessages.map((message) => (
            <article className={`recall-message recall-message--${message.role}`} key={message.id}>
              <small>{message.role === 'user' ? 'You' : 'Carve'} · {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
              <p>{message.content}</p>
            </article>
          ))}
          {busy ? <div className="recall-chat-thinking"><span /> Carve is searching your history…</div> : null}
        </Card>
      ) : null}

      {chatOpen ? <Card className="recall-ask recall-composer">
        {!conversationId ? (
          <details className="recall-chat-scope">
            <summary><span>Search scope</span><strong>{selectedSessionLabel} · {timeScopeLabel}</strong></summary>
            <div className="recall-chat-scope__body">
        <div className="recall-scope-builder">
          <section className="recall-scope-panel recall-scope-panel--sessions">
            <div className="recall-scope-panel__head">
              <span className="recall-scope-panel__icon"><Workflow size={15} /></span>
              <div><strong>Where should I look?</strong><small>Select one session, several, or everything.</small></div>
            </div>
            <div className="recall-session-grid">
              <button type="button" className={`recall-session-card recall-session-card--all ${selectedSessionIds.length === 0 ? 'is-selected' : ''}`} onClick={() => setSelectedSessionIds([])} aria-pressed={selectedSessionIds.length === 0}>
                <span className="recall-session-card__mark">{selectedSessionIds.length === 0 ? <Check size={13} /> : <Database size={13} />}</span>
                <span><strong>Everything observed</strong><small>Sessions + ambient history</small></span>
              </button>
              {recentSessions.map((session) => {
                const selected = selectedSessionIds.includes(session.id)
                return (
                  <button type="button" key={session.id} className={`recall-session-card ${selected ? 'is-selected' : ''}`} onClick={() => toggleSession(session.id)} aria-pressed={selected}>
                    <span className="recall-session-card__mark">{selected ? <Check size={13} /> : <Workflow size={13} />}</span>
                    <span><strong>{session.name}</strong><small>{ago(session.startedAt)} · {session.nextFixtureIndex} observation{session.nextFixtureIndex === 1 ? '' : 's'}</small></span>
                  </button>
                )
              })}
            </div>
            {additionalSessions.length > 0 ? (
              <label className="recall-session-picker">
                <span>More sessions</span>
                <select value="" onChange={(event) => { if (event.target.value) toggleSession(event.target.value) }}>
                  <option value="">Choose by name…</option>
                  {additionalSessions.map((session) => <option key={session.id} value={session.id}>{selectedSessionIds.includes(session.id) ? '✓ ' : ''}{session.name} · {session.nextFixtureIndex}</option>)}
                </select>
              </label>
            ) : null}
            {recallSessions.length === 0 ? <div className="recall-session-empty">Captured sessions will appear here as soon as they contain an observation.</div> : null}
          </section>

          <section className="recall-scope-panel recall-scope-panel--time">
            <div className="recall-scope-panel__head">
              <span className="recall-scope-panel__icon"><Clock3 size={15} /></span>
              <div><strong>When should I look?</strong><small>A time in your question can override this window.</small></div>
            </div>
            <div className="recall-scope__chips recall-time-chips" role="group" aria-label="How far back to search">
              {([
                ['anytime', 'Any time'],
                ['today', 'Today'],
                ['week', '7 days'],
                ['month', '30 days'],
                ['custom', 'Custom'],
              ] as Array<[RecallScopeId, string]>).map(([id, label]) => (
                <button key={id} type="button" className={scopeId === id ? 'is-selected' : ''} aria-pressed={scopeId === id} onClick={() => setScopeId(id)}>{label}</button>
              ))}
            </div>
            {scopeId === 'custom' ? (
              <div className="recall-scope__range recall-scope__range--dates">
                <label><span>From</span><input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label>
                <label><span>To</span><input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label>
              </div>
            ) : <div className="recall-time-preview"><Clock3 size={14} /><span>{timeScopeLabel}</span></div>}
            {customInverted ? <small className="recall-scope__warn">That range ends before it starts.</small> : null}
          </section>
        </div>

        <div className="recall-scope-summary">
          <div className="recall-scope-summary__mark"><Search size={16} /></div>
          <div className="recall-scope-summary__copy">
            <small>Current search space</small>
            <strong>{selectedSessionLabel}<span>·</span>{timeScopeLabel}</strong>
            <p>{scopeCount === null
              ? 'Counting local history…'
              : scopeCount.inWindow === 0
                ? `No captures match these filters${scopeCount.earliestIso ? ` · history starts ${new Date(scopeCount.earliestIso).toLocaleDateString()}` : ''}`
                : `${scopeCount.inWindow} capture${scopeCount.inWindow === 1 ? '' : 's'} ready to search${scopeCount.unreadInWindow > 0 ? ` · ${scopeCount.unreadInWindow} not yet text-readable` : ''}${policy?.ready ? ' · broad questions balance evidence across the selected scope' : ''}`}</p>
          </div>
          {(selectedSessionIds.length > 0 || scopeId !== 'anytime') ? <button type="button" className="recall-scope-summary__clear" onClick={() => { setSelectedSessionIds([]); setScopeId('anytime'); setCustomFrom(''); setCustomTo('') }}><X size={13} /> Clear scope</button> : null}
        </div>
        {policy?.ready ? (
          <div className="recall-depth">
            <span className="recall-depth__label">Answer detail</span>
            <div className="recall-scope__chips" role="group" aria-label="How much evidence each answer reads">
              {([['brief', 'Brief'], ['normal', 'Balanced'], ['thorough', 'Thorough']] as Array<[ExcerptDepth, string]>).map(([id, label]) => (
                <button key={id} type="button" className={depth === id ? 'is-selected' : ''} aria-pressed={depth === id} onClick={() => setDepth(id)}>{label}</button>
              ))}
            </div>
            <small>{perQuestion
              ? `About ${perQuestion.tokens.toLocaleString()} tokens per question so far.${perQuestion.cost != null ? ` Roughly ${formatMoney(perQuestion.cost)} each.` : ''}`
              : 'Measured after your first answered question.'}</small>
          </div>
        ) : null}
            </div>
          </details>
        ) : null}
        {!result ? <div className="recall-examples">{examples.map((example) => <button key={example} onClick={() => setQuestion(example)}>{example}</button>)}</div> : null}
        {unread > 0 && skipUnread ? (
          <div className="recall-unread">
            <ScanLine size={15} />
            <div>
              <strong>{unread} capture{unread === 1 ? '' : 's'} in this range have not been read</strong>
              <span>They can only be found by window name. You chose to search without them.</span>
            </div>
            <Button variant="secondary" size="small" disabled={busy} onClick={() => void readCaptures()}>
              {busy ? 'Reading' : 'Read them now'}
            </Button>
          </div>
        ) : null}
        <div className="recall-composer__prompt">
          <div className="recall-composer__prompt-icon"><Sparkles size={18} /></div>
          <input
            ref={questionInputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void ask() }}
            placeholder={conversationId ? 'Ask a follow-up…' : selectedSessions.length === 1 ? `Ask about ${selectedSessions[0]?.name ?? 'this session'}…` : 'Ask Carve anything about your history…'}
            aria-label="Ask a question about your history"
          />
          <Button onClick={() => void ask()} disabled={busy || !question.trim() || customInverted} aria-label="Send question"><ArrowRight size={15} /> {busy ? 'Thinking' : 'Send'}</Button>
        </div>
      </Card> : null}

      {chatOpen && result ? (
        <details className="recall-evidence-disclosure">
          <summary>
            <span><ShieldCheck size={14} /> Evidence and analysis</span>
            <strong>{result.hits.length} screen{result.hits.length === 1 ? '' : 's'}</strong>
          </summary>
          <Card className="recall-results">
          <div className="recall-results__head">
            <div>
              <div className="eyebrow">{result.plan?.intent ? `${result.plan.intent} · ` : ''}{result.hits.length} evidence screen{result.hits.length === 1 ? '' : 's'}</div>
              <h2>{result.sessionScope?.label || result.window.label
                ? `Searched ${[result.sessionScope?.label, result.window.label].filter(Boolean).join(' · ')}`
                : 'Searched all history'}</h2>
              <p>
                {result.analysis
                  ? `Analyzed ${result.analysis.coverage.analyzedMoments} of ${result.analysis.coverage.eligibleMoments} eligible moments.`
                  : <>Looked at {result.searchedMoments} moment{result.searchedMoments === 1 ? '' : 's'} for <strong>{result.terms || 'everything'}</strong>.</>}
                {result.windowSource === 'question' && timeScope ? ` Your question named a time, so it was searched instead of ${timeScope.label}.` : ''}
              </p>
            </div>
          </div>
          <div className="recall-answer">
            <div className="recall-answer__label">
              <ShieldCheck size={13} />
              {result.answerDetail?.source === 'model'
                ? `Written by ${result.answerDetail.model ?? 'a model'} from ${recallAnswerBasis(result.answerDetail)}${usageLabel(result.answerDetail.usage)} · inference, not evidence`
                : result.analysis ? 'Computed locally from the selected scope · not evidence itself' : 'Reading of the evidence · not evidence itself'}
            </div>
            <p>{result.answer}</p>
            {result.answerDetail?.source === 'deterministic' && result.answerDetail.fallbackReason ? (
              <small className="recall-answer__fallback">No model answer: {result.answerDetail.fallbackReason}</small>
            ) : null}
            {policy?.ready && result.plan?.answerStrategy !== 'deterministic' && result.hits.some((hit) => hit.momentId.startsWith('obs:')) ? (
              <div className="recall-answer__escalate">
                <Button variant="secondary" size="small" disabled={busy} onClick={() => void lookAtScreenshots()}>
                  <Eye size={13} /> {busy ? 'Looking' : 'Look at the screenshots'}
                </Button>
                <small>Shows approved sanitized versions of matching captures to {policy.model}. Unreviewed screenshots stay local.</small>
              </div>
            ) : null}
          </div>
          {result.analysis ? (
            <div className="recall-analysis">
              <div className="recall-analysis__coverage">
                <ShieldCheck size={14} />
                <span>{result.analysis.coverage.truncated
                  ? `Incomplete coverage: ${result.analysis.coverage.analyzedMoments} of ${result.analysis.coverage.eligibleMoments} moments analyzed`
                  : `Complete coverage: all ${result.analysis.coverage.analyzedMoments} moments analyzed`}</span>
              </div>
              {(result.plan?.intent === 'frequency' || result.plan?.intent === 'inventory') && result.analysis.tools.length > 0 ? (
                <div className="recall-analysis__section">
                  <strong>Observed tools</strong>
                  <div className="recall-tool-table" role="table" aria-label="Observed tool usage">
                    {result.analysis.tools.map((tool) => (
                      <div className="recall-tool-row" role="row" key={`${tool.kind}:${tool.tool}`}>
                        <span><strong>{tool.tool}</strong><small>{tool.kind}</small></span>
                        <span>{tool.visits} visit{tool.visits === 1 ? '' : 's'}</span>
                        <span>{tool.sessions} session{tool.sessions === 1 ? '' : 's'}</span>
                        <span>{recallDuration(tool.durationMs)}</span>
                      </div>
                    ))}
                  </div>
                  <small>Visits are foreground transitions. Captures are evidence samples, not a proxy for time spent.</small>
                </div>
              ) : null}
              {result.plan?.intent === 'compare' && result.analysis.comparison.length > 0 ? (
                <div className="recall-analysis__section">
                  <strong>Session comparison</strong>
                  <div className="recall-comparison-grid">
                    {result.analysis.comparison.map((session) => (
                      <article key={session.sessionId}>
                        <small>{session.moments} recorded moments</small>
                        <h3>{session.label}</h3>
                        <p>{session.topActivities.length > 0 ? session.topActivities.join(' · ') : 'No specific activity title was captured.'}</p>
                        <span>{session.applications.join(', ') || 'No application recorded'}</span>
                      </article>
                    ))}
                  </div>
                  <small>{result.analysis.sharedApplications.length > 0 ? `Shared applications: ${result.analysis.sharedApplications.join(', ')}` : 'No application was observed in every selected session.'}</small>
                </div>
              ) : null}
              {(result.plan?.intent === 'overview' || result.plan?.intent === 'timeline') && result.analysis.sessions.length > 0 ? (
                <div className="recall-analysis__section">
                  <strong>Sessions analyzed</strong>
                  <div className="recall-session-summaries">
                    {result.analysis.sessions.map((session) => (
                      <article key={session.sessionId ?? session.label}>
                        <span><strong>{session.label}</strong><small>{session.moments} moment{session.moments === 1 ? '' : 's'}</small></span>
                        <p>{session.topActivities.join(' · ') || 'No activity title captured'}</p>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {(result.plan?.intent === 'themes' || result.plan?.intent === 'overview') && result.analysis.themes.length > 0 ? (
                <div className="recall-analysis__section">
                  <strong>Observed activity themes</strong>
                  <div className="recall-entities">
                    {result.analysis.themes.slice(0, 10).map((theme) => <span className="recall-entity" key={theme.label}><span>{theme.label}</span><small>{theme.sessions} session{theme.sessions === 1 ? '' : 's'} · {theme.observations}</small></span>)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {result.entities.filter((entity) => entity.kind !== 'application').length > 0 ? (
            <div className="recall-entities">
              {result.entities.filter((entity) => entity.kind !== 'application').slice(0, 10).map((entity) => (
                <button key={entity.id} className={`recall-entity recall-entity--${entity.kind}`} onClick={() => { setQuestion(entity.name); }}>
                  <span>{entity.name}</span>
                  <small>{entity.kind} · {entity.mentionCount}</small>
                </button>
              ))}
            </div>
          ) : null}
          {result.hits.length === 0 ? (
            unread > 0 ? (
              <EmptyState
                icon={<ScanLine />}
                title="Nothing matched — but not everything has been read"
                description={`${unread} capture${unread === 1 ? '' : 's'} can still only be found by window name. If what you are looking for was inside the page rather than its title, reading them may find it.`}
                action={<Button disabled={busy} onClick={() => void readCaptures(result.original, undefined, {
                  fromIso: result.window.fromIso,
                  toIso: result.window.toIso,
                  label: result.window.label,
                  sessionIds: result.sessionScope?.sessionIds ?? [],
                })}>{busy ? 'Reading' : `Read ${unread} capture${unread === 1 ? '' : 's'} and search again`}</Button>}
              />
            ) : (
              <EmptyState icon={<Search />} title="Nothing matched" description="Window names and everything read from the screen were searched. If the detail was never on screen while Carve was observing, it was never captured." />
            )
          ) : (
            <ol className="recall-hits">
              {result.hits.map((hit) => (
                <li key={hit.momentId} className={`recall-hit recall-hit--${hit.source}`}>
                  <div className="recall-hit__when">
                    <strong>{new Date(hit.occurredAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</strong>
                    <span>{new Date(hit.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  <div className="recall-hit__what">
                    <strong>{hit.title}</strong>
                    <span>{hit.app}</span>
                    <RecallThumbnail momentId={hit.momentId} title={hit.title} />
                  </div>
                  <div className="recall-hit__why">
                    {hit.components && hit.components.lexical === 0 && hit.components.associative > 0
                      ? <Pill tone="info">associated</Pill>
                      : hit.source === 'observation' ? <Pill tone="positive">evidence</Pill> : <Pill>window name</Pill>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          </Card>
        </details>
      ) : null}
    </div>
  )
}

const defaultCapturePolicy: CapturePolicy = {
  screenshots: true,
  activeWindow: true,
  accessibilityTree: false,
  inputMetadata: false,
  screenText: false,
  captureTiming: { mode: 'adaptive', profile: 'balanced-v1' },
  captureIntervalSeconds: 0,
  excludedApplications: ['1Password', 'Keychain Access'],
  excludedWindows: [],
  excludedDomains: [],
  excludedRegions: [],
  retentionDays: 30,
}

/** Bytes at the scale a person can act on: an hour of capture, not a file. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  return `${Math.round(bytes / 1_000)} KB`
}

export function LearnView({ state, desktop, refresh, notify, navigate }: ViewProps) {
  const [observationCost, setObservationCost] = useState<{ capturesPerHour: number; averageCaptureBytes: number; bytesPerHour: number; cpuSecondsPerHour: number; coreFraction: number; sampled: number } | null>(null)
  const activeSession = state.sessions.find((session) => session.status !== 'stopped')
  const [name, setName] = useState('')
  const fixtureId = 'native-macos-observation'
  const [policy, setPolicy] = useState<CapturePolicy>(defaultCapturePolicy)
  const [apps, setApps] = useState(defaultCapturePolicy.excludedApplications.join(', '))
  const [domains, setDomains] = useState('')
  const [maskEnabled, setMaskEnabled] = useState(false)
  const cadence = policy.captureTiming.mode === 'fixed' ? policy.captureTiming.intervalSeconds : 0
  const readsText = policy.screenText === true
  useEffect(() => {
    let live = true
    void invoke<{ capturesPerHour: number; averageCaptureBytes: number; bytesPerHour: number; cpuSecondsPerHour: number; coreFraction: number; sampled: number }>({ kind: 'cost.observation', intervalSeconds: cadence, readsText })
      .then((next) => { if (live) setObservationCost(next) })
      .catch(() => { if (live) setObservationCost(null) })
    return () => { live = false }
  }, [cadence, readsText])
  const [mask, setMask] = useState({ x: 0, y: 0, width: 320, height: 120 })
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const activeIsLiveBrowser = activeSession?.fixtureId.startsWith('browser-')
  const activeIsNative = activeSession?.fixtureId === 'native-macos-observation'
  const activeElapsedMs = activeSession ? Date.now() - new Date(activeSession.startedAt).getTime() : 0
  const activeAdaptiveRate = activeIsNative && activeSession?.capturePolicy.captureTiming.mode === 'adaptive' && activeElapsedMs >= 120_000
    ? Math.round(activeSession.nextFixtureIndex * 3_600_000 / activeElapsedMs)
    : null
  const screenRecordingStatus = desktop.desktop ? state.nativeCapture.screenRecording : desktop.permissions.screenRecording
  const screenRecordingGranted = screenRecordingStatus === 'granted'
  const adaptiveAvailable = state.nativeCapture.supportedSignals.adaptiveObservation === true
  const timingReady = policy.captureTiming.mode !== 'adaptive' || (policy.screenshots && adaptiveAvailable)

  const execute = async (label: string, task: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await task()
      await refresh()
      notify(label, 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const start = () => execute('Learning session started', async () => {
    return invoke({
      kind: 'session.start',
      name: name.trim() || 'Untitled observation',
      fixtureId,
      capturePolicy: {
        ...policy,
        excludedApplications: apps.split(',').map((item) => item.trim()).filter(Boolean),
        excludedDomains: domains.split(',').map((item) => item.trim()).filter(Boolean),
        excludedRegions: maskEnabled ? [mask] : [],
      },
    })
  })

  const refreshNativePermission = () => execute('Native capture permission refreshed', async () => invoke({ kind: 'native.capture.status' }))
  const requestNativePermission = () => execute('Screen Recording permission request completed', async () => invoke({ kind: 'native.capture.request_permission' }))
  const openScreenRecordingSettings = () => execute('Opened macOS Screen Recording settings', async () => invoke({ kind: 'desktop.open_system_settings', pane: 'screen_recording' }))

  const action = (kind: 'capture' | 'pause' | 'resume' | 'stop') => {
    if (!activeSession) return Promise.resolve()
    return execute(kind === 'stop' ? activeIsNative ? 'Observation stopped; no executable procedure was created' : 'Session stopped and procedure inferred' : kind === 'capture' ? 'Observation captured' : `Session ${kind}d`, async () => invoke({ kind: 'session.action', sessionId: activeSession.id, action: kind }))
  }

  return (
    <div className="page">
      <PageIntro label="Learn studio" title={activeSession ? activeSession.name : 'Show Carve how you work.'} description={activeSession ? activeIsNative ? 'Observation is explicit, visible, and non-controlling. Review every captured state before using it as memory.' : 'Capture is explicit, visible, and reversible. Inspect every observation before it becomes procedural memory.' : 'Start an observation, perform the task normally, and review the captured steps when you are done.'} action={activeSession ? <Pill tone={activeSession.status === 'active' ? 'positive' : 'warning'} icon={activeSession.status === 'active' ? <Radio size={13} /> : <CirclePause size={13} />}>{humanize(activeSession.status)}</Pill> : undefined} />

      {!activeSession ? <AmbientDiscovery state={state} desktop={desktop} refresh={refresh} notify={notify} onWatch={(candidate) => {
        setName(candidateLabel(candidate))
        setPolicy((current) => ({ ...current, screenshots: true, activeWindow: true, accessibilityTree: false, inputMetadata: false, captureTiming: { mode: 'adaptive', profile: 'balanced-v1' }, captureIntervalSeconds: 0 }))
      }} /> : null}

      {!activeSession ? (
        <div className="learn-layout">
          <Card className="learn-layout__form" elevated>
            <SectionHeading eyebrow="New observation" title="What are you about to do?" description="Name it now, or leave it blank and Carve will name it from what it observes." />
            <div className="form-stack">
              <Field label="Observation name (optional)" hint="If left blank, Carve creates a short title after you stop observing. Names you enter are never replaced."><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Carve will name this session automatically" /></Field>
              <div className="observation-summary">
                <div className="observation-summary__icon"><Eye size={18} /></div>
                <div className="observation-summary__copy">
                  <span>Observation on this Mac</span>
                  <strong>Carve watches while you do the task</strong>
                  <p>It saves snapshots of the app in front using the timing you choose, so you can review the workflow afterward. A visible REC indicator shows when observation is active, and you can pause or stop at any time.</p>
                  <small><ShieldCheck size={14} /> Observation is watch-only. Carve cannot click, type, control your Mac, record audio, read your clipboard, or capture your keystrokes.</small>
                </div>
              </div>
              <fieldset className="capture-timing">
                <legend>Capture timing</legend>
                <label className={`capture-timing__choice capture-timing__choice--adaptive ${policy.captureTiming.mode === 'adaptive' ? 'is-selected' : ''} ${!policy.screenshots || !adaptiveAvailable ? 'is-disabled' : ''}`}>
                  <input type="radio" name="capture-timing" disabled={!policy.screenshots || !adaptiveAvailable} checked={policy.captureTiming.mode === 'adaptive'} onChange={() => setPolicy({ ...policy, captureTiming: { mode: 'adaptive', profile: 'balanced-v1' }, captureIntervalSeconds: 0 })} />
                  <span className="capture-timing__indicator" aria-hidden="true" />
                  <span><strong>Adaptive <em>Recommended</em></strong><small>Captures after meaningful screen changes and periodically checks steady screens.</small></span>
                </label>
                <div className={`capture-timing__choice capture-timing__choice--fixed ${policy.captureTiming.mode === 'fixed' ? 'is-selected' : ''}`}>
                  <label>
                    <input type="radio" name="capture-timing" checked={policy.captureTiming.mode === 'fixed'} onChange={() => setPolicy({ ...policy, captureTiming: { mode: 'fixed', intervalSeconds: 5 }, captureIntervalSeconds: 5 })} />
                    <span className="capture-timing__indicator" aria-hidden="true" />
                    <span><strong>Fixed interval</strong><small>Predictable timing for very fast or highly detailed workflows.</small></span>
                  </label>
                  <select aria-label="Fixed capture interval" disabled={policy.captureTiming.mode !== 'fixed'} value={policy.captureTiming.mode === 'fixed' ? policy.captureTiming.intervalSeconds : 5} onChange={(event) => { const intervalSeconds = Number(event.target.value); setPolicy({ ...policy, captureTiming: { mode: 'fixed', intervalSeconds }, captureIntervalSeconds: intervalSeconds }) }}>
                    <option value={2}>Every 2 seconds</option><option value={5}>Every 5 seconds</option><option value={10}>Every 10 seconds</option><option value={15}>Every 15 seconds</option><option value={30}>Every 30 seconds</option>
                  </select>
                </div>
                <label className={`capture-timing__choice ${policy.captureTiming.mode === 'manual' ? 'is-selected' : ''}`}>
                  <input type="radio" name="capture-timing" checked={policy.captureTiming.mode === 'manual'} onChange={() => setPolicy({ ...policy, captureTiming: { mode: 'manual' }, captureIntervalSeconds: 0 })} />
                  <span className="capture-timing__indicator" aria-hidden="true" />
                  <span><strong>Manual only</strong><small>Saves a state only when you choose Capture now.</small></span>
                </label>
              </fieldset>
            </div>
            <div className="observe-cost">
              <HardDrive size={15} />
              <div>
                <strong>
                  {policy.captureTiming.mode === 'adaptive'
                    ? `Adaptive timing: storage follows how much the screen changes${observationCost ? ` · about ${formatBytes(observationCost.averageCaptureBytes)} per saved observation` : ''}`
                    : policy.captureTiming.mode === 'manual'
                      ? `Manual timing: about ${observationCost ? formatBytes(observationCost.averageCaptureBytes) : 'one capture'} each time you choose Capture now`
                      : `An hour of observing: up to ${observationCost ? observationCost.capturesPerHour.toLocaleString() : '…'} capture attempts${observationCost ? `, about ${formatBytes(observationCost.bytesPerHour)} on disk` : ''}`}
                  {policy.captureTiming.mode === 'fixed' && observationCost && observationCost.cpuSecondsPerHour > 0
                    ? `, and roughly ${Math.round(observationCost.coreFraction * 100)}% of a processor core`
                    : ''}
                </strong>
                <span>
                  No model cost and nothing sent anywhere &mdash; screenshots are taken by macOS and text is read by Apple&rsquo;s Vision framework in Carve&rsquo;s helper, which makes no network request.
                  {policy.captureTiming.mode === 'adaptive'
                    ? ' Low-resolution change checks stay in memory and are never saved or read as text. Exact duplicates are not stored.'
                    : policy.captureTiming.mode === 'manual'
                      ? ' No unattended captures are attempted.'
                      : ' Exact duplicates are not saved.'}
                  {readsText
                    ? policy.captureTiming.mode === 'fixed' && observationCost && observationCost.cpuSecondsPerHour > 0
                      ? ` Reading text is the running cost: about 0.7 seconds of processor time per attempt, which on a laptop means battery and fans.`
                      : ' Text is read only from saved captures, so processor use follows the number you keep.'
                    : ' Reading text on screen would add processor time; it is off.'}
                  {observationCost && observationCost.sampled > 0 ? ` Disk sized from ${observationCost.sampled} captures already stored.` : ' Disk sized from a typical capture until this machine has some of its own.'}
                </span>
              </div>
            </div>
            <div className="form-footer"><span><ShieldCheck size={15} /> {timingReady ? 'Nothing is captured until you start.' : policy.screenshots ? 'Adaptive timing needs the latest native helper.' : 'Adaptive timing needs Screenshots enabled.'}</span><Button size="large" disabled={busy || !state.nativeCapture.available || state.nativeCapture.screenRecording !== 'granted' || !timingReady} onClick={start}><ScanLine size={16} /> Start observing</Button></div>
          </Card>

          <Card className="learn-layout__manifest">
            <SectionHeading eyebrow="Capture choices" title="Exactly what Carve may see" description="The frontmost application name, window title, and an optional still image. Region masks are applied before an image is saved. No URLs, keystrokes, clipboard contents, audio, or control events are collected." />
            <div className="manifest-list">
              <Toggle checked={policy.screenshots} onChange={(value) => setPolicy({ ...policy, screenshots: value, ...(value || policy.captureTiming.mode !== 'adaptive' ? {} : { captureTiming: { mode: 'fixed', intervalSeconds: 5 }, captureIntervalSeconds: 5 }) })} label="Screenshots" description="Saved visual states; Adaptive also uses masked, memory-only low-resolution checks" />
              <Toggle checked={policy.activeWindow} onChange={(value) => setPolicy({ ...policy, activeWindow: value })} label="Active app and window" description="Application name and window title" />
              <Toggle checked={policy.accessibilityTree} disabled onChange={(value) => setPolicy({ ...policy, accessibilityTree: value })} label="Semantic UI elements" description="Not used by observation; Accessibility permission stays off" />
              <Toggle checked={policy.inputMetadata} disabled onChange={(value) => setPolicy({ ...policy, inputMetadata: value })} label="Input metadata" description="Never captured by observation" />
            </div>
            <button className="advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}><span><Filter size={16} /> Exclusions and retention</span><ChevronDown size={17} className={advancedOpen ? 'rotate' : ''} /></button>
            {advancedOpen ? (
              <div className="advanced-panel">
                <Field label="Excluded applications" hint="Comma-separated exact names"><input value={apps} onChange={(event) => setApps(event.target.value)} /></Field>
                <Field label="Excluded websites" hint="Unavailable: observation does not inspect browser URLs"><input value={domains} disabled onChange={(event) => setDomains(event.target.value)} placeholder="Not available for macOS observation" /></Field>
                <Toggle checked={policy.screenText} onChange={(next) => setPolicy({ ...policy, screenText: next })} label="Read text on screen" description="Vision OCR, on this machine. Text is read only from saved masked images, so hidden regions stay hidden." /><Toggle checked={maskEnabled} onChange={setMaskEnabled} label="Burn in a region mask" description="Coordinates are pixels from the captured window’s top-left corner" />{maskEnabled ? <div className="region-grid">{(['x', 'y', 'width', 'height'] as const).map((key) => <Field key={key} label={humanize(key)}><input type="number" min={0} value={mask[key]} onChange={(event) => setMask({ ...mask, [key]: Math.max(0, Number(event.target.value)) })} /></Field>)}</div> : null}
                <Field label="Retention"><select value={policy.retentionDays} onChange={(event) => setPolicy({ ...policy, retentionDays: Number(event.target.value) })}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></Field>
              </div>
            ) : null}
            <div className={`permission-note ${!screenRecordingGranted ? 'permission-note--attention' : ''}`}>
              <Laptop size={18} />
              <div className="permission-note__copy">
                <strong>{!desktop.desktop ? 'Open Carve’s desktop app to observe' : screenRecordingGranted ? 'Desktop observation ready' : 'Screen Recording access needed'}</strong>
                <span><b>Screen Recording: {humanize(screenRecordingStatus)}.</b> Carve needs this macOS permission before it can observe your screen.</span>
                <span><b>Accessibility: Not used.</b> This build cannot capture keys or control the desktop.</span>
                {desktop.desktop && desktop.platform === 'darwin' && !screenRecordingGranted ? <small className="permission-note__help"><b>How to enable:</b> Open System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording and enable <b>Carve</b>. <b>If Carve is already listed and switched on, this build was re-signed since you granted it:</b> select the Carve row, remove it with the − button, relaunch Carve, then choose <b>Request access</b> and approve. Local development builds get a new ad-hoc signature on every rebuild, so macOS stops honouring the previous grant. A stable Developer ID signature would end the repetition.</small> : null}
                <small>{state.nativeCapture.reason ?? `Helper ${state.nativeCapture.helperVersion ?? 'unavailable'} · capture-only contract`}</small>
              </div>
              {desktop.desktop && desktop.platform === 'darwin' && !screenRecordingGranted ? <div className="permission-note__actions">
                <Button size="small" disabled={busy} onClick={() => void requestNativePermission()}><ShieldCheck size={14} /> Request access</Button>
                <Button size="small" variant="secondary" disabled={busy} onClick={() => void openScreenRecordingSettings()}><ArrowRight size={14} /> Open System Settings</Button>
                <Button size="small" variant="secondary" disabled={busy} onClick={() => void refreshNativePermission()}><RefreshCw size={14} /> Check again</Button>
              </div> : null}
            </div>
          </Card>
        </div>
      ) : (
        <div className="session-layout">
          <div className="session-layout__main">
            <Card className="capture-console" elevated>
              <div className="capture-console__visual">
                <div className={`capture-orb capture-orb--${activeSession.status}`}><ScanLine size={30} /><span /></div>
                <div><div className="eyebrow">{activeSession.status === 'active' ? activeIsNative ? activeSession.capturePolicy.captureTiming.mode === 'adaptive' ? 'Adaptive observation active' : 'Native observation active' : 'Capture ready' : 'Capture paused'}</div><h2>{activeSession.nextFixtureIndex} observations collected</h2><p>{activeSession.status === 'active' ? activeIsNative ? activeSession.capturePolicy.captureTiming.mode === 'adaptive' ? `Carve captures stable, meaningful changes and periodically checks steady screens. Probe frames stay in memory and exact duplicates are skipped.${activeAdaptiveRate === null ? '' : ` Current pace: about ${activeAdaptiveRate} saved observations per hour.`}` : activeSession.capturePolicy.captureTiming.mode === 'fixed' ? `The helper checks the frontmost window every ${activeSession.capturePolicy.captureTiming.intervalSeconds} seconds and skips exact duplicates.` : 'Switch to the work window, then capture each meaningful state manually.' : activeIsLiveBrowser ? 'Use the training browser below, then capture each meaningful state.' : 'Advance the demonstration one meaningful state change at a time.' : 'No new observations can be recorded until you resume.'}</p></div>
              </div>
              <div className="capture-console__actions">
                {activeSession.status === 'active' ? <Button variant="secondary" onClick={() => void action('pause')} disabled={busy}><CirclePause size={16} /> Pause</Button> : <Button variant="secondary" onClick={() => void action('resume')} disabled={busy}><Play size={16} /> Resume</Button>}
                <Button onClick={() => void action('capture')} disabled={busy || activeSession.status !== 'active'}><Plus size={16} /> {activeIsNative ? 'Capture now' : activeIsLiveBrowser ? 'Capture current state' : 'Capture next state'}</Button>
                <Button variant="danger" onClick={() => void action('stop')} disabled={busy}><Square size={14} fill="currentColor" /> {activeIsNative ? 'Stop observation' : 'Stop & infer'}</Button>
              </div>
            </Card>

            {activeIsLiveBrowser ? <BrowserSandboxPanel state={state} refresh={refresh} notify={notify} learning /> : null}

            <Card>
              <SectionHeading eyebrow="Evidence timeline" title="What Carve observed" description="Observed facts remain separate from later model interpretations." />
              {state.observations.length === 0 ? <EmptyState icon={<Eye />} title="Waiting for the first state" description="Capture the next state when the workflow is ready." /> : (
                <div className="timeline">
                  {state.observations.map((observation, index) => (
                    <div className={`timeline-item ${observation.excluded ? 'timeline-item--excluded' : ''}`} key={observation.id}>
                      <div className="timeline-item__rail"><span>{observation.excluded ? <Ban size={14} /> : index + 1}</span></div>
                      <div className="timeline-item__body">
                        <div className="timeline-item__top"><div><strong>{observation.facts.windowTitle}</strong><span>{observation.facts.app}</span></div><div className="pill-group"><Pill>{observation.source}</Pill>{observation.injectionSignals.length > 0 ? <Pill tone="danger" icon={<ShieldAlert size={12} />}>Injection signal</Pill> : null}{observation.redactions.length > 0 ? <Pill tone="warning">{observation.redactions.length} redacted</Pill> : null}</div></div>
                        <p>{observation.excluded ? observation.exclusionReason : observation.facts.text}</p>
                        {observation.facts.screenshotRef?.startsWith('native-captures/') ? <ObservationScreenshot observationId={observation.id} windowTitle={observation.facts.windowTitle} /> : null}
                        <div className="evidence-footer"><span>Sequence {observation.sequence}</span><span>{new Date(observation.observedAt).toLocaleTimeString()}</span><code>{observation.evidenceHash.slice(0, 10)}</code></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <aside className="session-layout__side">
            <Card className="sticky-card">
              <SectionHeading eyebrow="This recording" title="Recording settings" />
              <div className="boundary-list">
                <BoundaryItem icon={<Eye />} label="Screenshots" value={activeSession.capturePolicy.screenshots ? 'Allowed' : 'Off'} />
                <BoundaryItem icon={<AppWindow />} label="Window metadata" value={activeSession.capturePolicy.activeWindow ? 'Allowed' : 'Off'} />
                <BoundaryItem icon={<Code2 />} label="Semantic UI" value={activeSession.capturePolicy.accessibilityTree ? 'Allowed' : 'Off'} />
                <BoundaryItem icon={<MousePointer2 />} label="Input metadata" value={activeSession.capturePolicy.inputMetadata ? 'Allowed' : 'Off'} />
                {activeIsNative ? <BoundaryItem icon={<Clock3 />} label="Timing" value={activeSession.capturePolicy.captureTiming.mode === 'adaptive' ? 'Adaptive' : activeSession.capturePolicy.captureTiming.mode === 'fixed' ? `Every ${activeSession.capturePolicy.captureTiming.intervalSeconds}s` : 'Manual'} /> : null}
                <BoundaryItem icon={<Clock3 />} label="Retention" value={`${activeSession.capturePolicy.retentionDays} days`} />
              </div>
              <div className="exclusion-box"><strong>Always excluded</strong>{activeSession.capturePolicy.excludedApplications.length > 0 ? activeSession.capturePolicy.excludedApplications.map((item) => <Pill key={item}>{item}</Pill>) : <span>No application exclusions</span>}</div>
            </Card>
          </aside>
        </div>
      )}

      {!activeSession && state.sessions.length > 0 ? (
        <Card>
          <SectionHeading eyebrow="History" title="Previous learning sessions" />
          <div className="compact-table">{state.sessions.slice(0, 6).map((session) => {
            const procedure = state.procedures.find((candidate) => candidate.goal === session.goalHint)
            const result = session.fixtureId === 'native-macos-observation' && session.status === 'stopped' ? 'observed' : procedure?.evidenceSummary.quarantinedSessionIds.includes(session.id) ? 'quarantined' : procedure?.evidenceSummary.interruptedSessionIds.includes(session.id) ? 'interrupted' : procedure?.evidenceSummary.completedSessionIds.includes(session.id) ? 'complete' : session.status
            return <div className="compact-table__row" key={session.id}><div><strong>{session.name}</strong><span>{session.fixtureId}</span></div><Pill tone={result === 'complete' ? 'positive' : result === 'interrupted' ? 'warning' : result === 'quarantined' ? 'danger' : 'neutral'}>{result}</Pill><span>{ago(session.startedAt)}</span><Button size="small" variant="ghost" onClick={() => navigate(session.fixtureId === 'native-macos-observation' ? 'review' : 'procedures')}>{session.fixtureId === 'native-macos-observation' ? 'Review evidence' : 'View result'} <ArrowRight size={14} /></Button></div>
          })}</div>
        </Card>
      ) : null}
    </div>
  )
}

export function ReviewView({ state, refresh, notify, navigate }: ViewProps) {
  const workspaces = state.reviewWorkspace.sessions
  const [sessionId, setSessionId] = useState(workspaces[0]?.session.id ?? '')
  const workspace = workspaces.find((candidate) => candidate.session.id === sessionId) ?? workspaces[0]
  const [observationId, setObservationId] = useState(workspace?.observations[0]?.id ?? '')
  const [selection, setSelection] = useState<string[]>([])
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null)
  const [bulkLabel, setBulkLabel] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmation, setBulkConfirmation] = useState<{ disposition: 'approved' | 'excluded'; observationIds: string[]; label: string } | null>(null)
  const selected = workspace?.observations.find((observation) => observation.id === observationId) ?? workspace?.observations[0]
  const latestReview = selected ? workspace?.reviews.find((review) => review.observationId === selected.id) : undefined

  useEffect(() => {
    if (!workspaces.some((candidate) => candidate.session.id === sessionId)) setSessionId(workspaces[0]?.session.id ?? '')
  }, [sessionId, workspaces])
  useEffect(() => {
    if (workspace && !workspace.observations.some((observation) => observation.id === observationId)) setObservationId(workspace.observations[0]?.id ?? '')
  }, [observationId, workspace])
  useEffect(() => {
    // Never let a stale id survive a deletion or a session switch into a bulk action.
    setSelection((current) => current.filter((id) => workspace?.observations.some((observation) => observation.id === id)))
  }, [workspace])
  useEffect(() => setBulkConfirmation(null), [workspace?.session.id])

  if (!workspace) return (
    <div className="page"><PageIntro label="Review studio" title="Turn evidence into trustworthy memory." description="Native observations appear here only after capture stops. Review is required before any segmentation can begin." /><Card><EmptyState icon={<ListChecks />} title="No native evidence to review" description="Run and stop a macOS observation session, then return here to inspect every captured state." action={<Button onClick={() => navigate('learn')}><ScanLine size={16} /> Start observing</Button>} /></Card></div>
  )

  const episode = workspace.episode
  const reviewedCount = episode.approvedObservationIds.length + episode.excludedObservationIds.length
  const save = async (input: ObservationReviewInput) => {
    if (!selected) return
    try {
      await invoke({ kind: 'observation.review', observationId: selected.id, review: input })
      await refresh()
      notify(`Observation ${selected.sequence} review saved`, 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }
  const observations = workspace.observations
  const selectionSet = new Set(selection)
  const toggleSelection = (index: number, shiftKey: boolean) => {
    const target = observations[index]
    if (!target) return
    if (shiftKey && anchorIndex !== null) {
      const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex]
      const range = observations.slice(from, to + 1).map((observation) => observation.id)
      setSelection((current) => Array.from(new Set([...current, ...range])))
      return
    }
    setAnchorIndex(index)
    setSelection((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id])
  }
  const allSelected = observations.length > 0 && selection.length === observations.length
  const toggleAll = () => {
    setAnchorIndex(null)
    setSelection(allSelected ? [] : observations.map((observation) => observation.id))
  }
  const requestBulkReview = (disposition: 'approved' | 'excluded') => {
    const targets = observations.filter((observation) => selectionSet.has(observation.id))
    if (targets.length === 0) return
    const label = bulkLabel.trim()
    if (disposition === 'approved' && !label) return notify('Give the selected frames a shared label before approving them', 'warning')
    setBulkConfirmation({ disposition, observationIds: targets.map((observation) => observation.id), label })
  }
  /** Applies one uniform judgement to every selected frame. Each observation is
   * still reviewed by its own validated command, so per-frame rules (privacy
   * exclusion, append-only versioning, audit) behave exactly as they do for a
   * single review. */
  const applyBulk = async () => {
    const confirmation = bulkConfirmation
    if (!confirmation) return
    const { disposition, label } = confirmation
    const targetIds = new Set(confirmation.observationIds)
    const targets = observations.filter((observation) => targetIds.has(observation.id))
    if (targets.length === 0) { setBulkConfirmation(null); return }
    setBulkConfirmation(null)
    setBulkBusy(true)
    const failures: string[] = []
    for (const observation of targets) {
      try {
        await invoke({
          kind: 'observation.review',
          observationId: observation.id,
          review: {
            disposition,
            annotationKind: disposition === 'approved' ? 'state' : 'irrelevant',
            taskBoundary: 'none',
            label,
            notes: '',
          },
        })
      } catch (error) {
        failures.push(`${String(observation.sequence).padStart(2, '0')}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setBulkBusy(false)
    await refresh()
    setSelection([])
    setAnchorIndex(null)
    const applied = targets.length - failures.length
    if (failures.length === 0) notify(`${applied} observation${applied === 1 ? '' : 's'} ${disposition}`, 'positive')
    else notify(`${applied} of ${targets.length} ${disposition}; ${failures.length} refused — ${failures[0]}`, 'warning')
  }
  const deletePermanently = async () => {
    if (!selected || !window.confirm(`Permanently delete observation ${selected.sequence} and all of its sanitized copies? This cannot be undone.`)) return
    try {
      await invoke({ kind: 'observation.delete', observationId: selected.id, confirmation: 'DELETE OBSERVATION' })
      await refresh()
      notify('Observation and review artifacts permanently deleted', 'warning')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  return (
    <div className="page page--review">
      {bulkConfirmation ? (
        <Dialog
          className={`review-confirm review-confirm--${bulkConfirmation.disposition}`}
          eyebrow="Bulk evidence review"
          icon={bulkConfirmation.disposition === 'approved' ? <BadgeCheck size={22} /> : <Ban size={22} />}
          tone={bulkConfirmation.disposition === 'approved' ? 'positive' : 'warning'}
          title={`${bulkConfirmation.disposition === 'approved' ? 'Approve' : 'Exclude'} ${bulkConfirmation.observationIds.length} observation${bulkConfirmation.observationIds.length === 1 ? '' : 's'}`}
          description={bulkConfirmation.disposition === 'approved'
            ? 'Carve will record every selected frame as an observed workflow state. Each frame gets its own append-only review version.'
            : 'Carve will mark every selected frame as irrelevant evidence. The captures remain in local history and can be reviewed again later.'}
          onDismiss={() => setBulkConfirmation(null)}
        >
          <div className="review-confirm__facts">
            <div><span>Selected evidence</span><strong>{bulkConfirmation.observationIds.length} frame{bulkConfirmation.observationIds.length === 1 ? '' : 's'}</strong></div>
            <div><span>Saved as</span><strong>{bulkConfirmation.observationIds.length} new review version{bulkConfirmation.observationIds.length === 1 ? '' : 's'}</strong></div>
          </div>
          {bulkConfirmation.disposition === 'approved' ? <div className="review-confirm__label"><span>Shared workflow label</span><strong>“{bulkConfirmation.label}”</strong></div> : null}
          <div className="review-confirm__guardrail"><LockKeyhole size={16} /><div><strong>No automation is created</strong><span>This review only organizes evidence. Computer control stays disabled.</span></div></div>
          <div className="dialog__buttons review-confirm__buttons">
            <Button variant="secondary" disabled={bulkBusy} onClick={() => setBulkConfirmation(null)}>Keep reviewing</Button>
            <Button variant={bulkConfirmation.disposition === 'approved' ? 'primary' : 'danger'} disabled={bulkBusy} onClick={() => void applyBulk()}>{bulkConfirmation.disposition === 'approved' ? <Check size={16} /> : <Ban size={16} />}{bulkConfirmation.disposition === 'approved' ? 'Approve' : 'Exclude'} {bulkConfirmation.observationIds.length} observation{bulkConfirmation.observationIds.length === 1 ? '' : 's'}</Button>
          </div>
        </Dialog>
      ) : null}
      <PageIntro label="Review studio" title="Curate what becomes memory." description="Inspect each native capture, remove sensitive pixels, label task meaning, and exclude anything irrelevant. No executable procedure is created here." action={<Pill tone={episode.readyForSegmentation ? 'positive' : 'warning'} icon={<ShieldCheck size={13} />}>{reviewedCount} of {workspace.observations.length} reviewed</Pill>} />
      <Card className="review-session-bar">
        <div><span>Observation session</span><select value={workspace.session.id} onChange={(event) => { setSessionId(event.target.value); setObservationId('') }}>{workspaces.map((candidate) => <option value={candidate.session.id} key={candidate.session.id}>{candidate.session.name} · {candidate.observations.length} frames</option>)}</select></div>
        <div className="review-progress"><span style={{ width: `${workspace.observations.length ? reviewedCount / workspace.observations.length * 100 : 0}%` }} /></div>
        <div className="review-session-stats"><span><strong>{episode.approvedObservationIds.length}</strong> approved</span><span><strong>{episode.excludedObservationIds.length}</strong> excluded</span><span><strong>{episode.pendingObservationIds.length}</strong> pending</span><span><strong>{workspace.reviewVersionCount}</strong> versions</span></div>
      </Card>

      <div className="review-workspace">
        <aside className="review-filmstrip" aria-label="Captured observations">
          <div className="review-filmstrip__head"><label className="review-select-all"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select every observation" /><span>Evidence</span></label><Pill>{workspace.observations.length}</Pill></div>
          {observations.map((observation, index) => {
            const review = workspace.reviews.find((candidate) => candidate.observationId === observation.id)
            const status = review?.disposition ?? 'pending'
            const checked = selectionSet.has(observation.id)
            return <div className={`review-frame review-frame--${status} ${selected?.id === observation.id ? 'review-frame--selected' : ''} ${checked ? 'review-frame--checked' : ''}`} key={observation.id}>
              <input type="checkbox" className="review-frame__check" checked={checked} aria-label={`Select observation ${observation.sequence}`} onChange={() => undefined} onClick={(event) => toggleSelection(index, event.shiftKey)} />
              <button className="review-frame__open" onClick={() => setObservationId(observation.id)}><span className="review-frame__number">{String(observation.sequence).padStart(2, '0')}</span><div><strong>{review?.label || observation.facts.windowTitle}</strong><span>{observation.facts.app} · {new Date(observation.observedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span></div><span className="review-frame__status">{status === 'approved' ? <Check size={14} /> : status === 'excluded' ? <Ban size={14} /> : <Clock3 size={14} />}</span></button>
            </div>
          })}
        </aside>

        <main className="review-editor-panel">
          {selection.length > 0 ? <Card className="review-bulk-bar">
            <div className="review-bulk-bar__count"><strong>{selection.length}</strong> selected<small>Shift-click a checkbox to extend the range</small></div>
            <input value={bulkLabel} onChange={(event) => setBulkLabel(event.target.value)} placeholder="Shared label, e.g. Browsing the article" aria-label="Shared label for the selected observations" />
            <div className="review-bulk-bar__actions">
              <Button variant="ghost" onClick={() => { setSelection([]); setAnchorIndex(null) }} disabled={bulkBusy}>Clear</Button>
              <Button variant="secondary" onClick={() => requestBulkReview('excluded')} disabled={bulkBusy}><Ban size={15} /> Exclude selected</Button>
              <Button onClick={() => requestBulkReview('approved')} disabled={bulkBusy}><Check size={15} /> Approve as workflow state</Button>
            </div>
            <small className="review-bulk-bar__note">Bulk approval records each frame as observed workflow state. Task boundaries, decisions, and outcomes still need the individual form below — the segmentation gate stays closed until every task segment has a labeled outcome.</small>
          </Card> : null}
          {selected ? <ReviewEditor key={`${selected.id}-${latestReview?.version ?? 0}`} observation={selected} review={latestReview} onSave={save} onDelete={deletePermanently} /> : <EmptyState icon={<Eye />} title="No evidence remains" description="All observations in this session have been deleted." />}
        </main>

        <aside className="episode-panel">
          <div className="episode-panel__head"><div className="eyebrow">Non-executable draft</div><h2>Episode map</h2><p>A human-curated outline for the next segmentation milestone.</p></div>
          {episode.segments.length === 0 ? <div className="episode-empty"><GitBranch size={24} /><strong>No approved task states</strong><span>Approve evidence and mark task boundaries to form a draft episode.</span></div> : <div className="episode-segments">{episode.segments.map((segment, index) => <div className="episode-segment" key={segment.id}><span>{index + 1}</span><div><strong>{segment.name}</strong><small>{segment.observationIds.length} evidence frame{segment.observationIds.length === 1 ? '' : 's'}</small>{segment.inputs.map((item) => <Pill key={`input-${item}`} tone="info">Input · {item}</Pill>)}{segment.decisions.map((item) => <Pill key={`decision-${item}`} tone="warning">Decision · {item}</Pill>)}{segment.outcomes.map((item) => <Pill key={`outcome-${item}`} tone="positive">Outcome · {item}</Pill>)}</div></div>)}</div>}
          <div className={`segmentation-gate ${episode.readyForSegmentation ? 'segmentation-gate--ready' : ''}`}><ShieldCheck size={18} /><div><strong>{episode.readyForSegmentation ? 'Evidence gate complete' : 'Review gate is closed'}</strong><span>{episode.readyForSegmentation ? 'Ready for non-executable segmentation. Computer control remains disabled.' : episode.blockers.join(' · ')}</span></div></div>
          <div className="authority-lock"><LockKeyhole size={16} /><span>Authority: observation and review only</span></div>
        </aside>
      </div>
      <details className="workflow-draft-disclosure">
        <summary>
          <span className="workflow-draft-disclosure__icon"><BrainCircuit size={18} /></span>
          <span className="workflow-draft-disclosure__copy">
            <strong>Find the workflow behind the evidence</strong>
            <small>Optional: ask a model to turn approved evidence into an editable, non-executable draft.</small>
          </span>
          <Pill>Optional</Pill>
          <ChevronDown className="workflow-draft-disclosure__chevron" size={16} />
        </summary>
        <AiInductionPanel key={workspace.session.id} state={state} sessionId={workspace.session.id} refresh={refresh} notify={notify} />
      </details>
    </div>
  )
}

function AiInductionPanel({ state, sessionId, refresh, notify }: Pick<ViewProps, 'state' | 'refresh' | 'notify'> & { sessionId: string }) {
  const capableProviders = state.providers.filter((provider) => provider.configured && provider.capabilities.text && provider.capabilities.vision && provider.capabilities.structuredOutput)
  const [providerId, setProviderId] = useState(capableProviders.find((provider) => provider.active)?.id ?? capableProviders[0]?.id ?? '')
  const [disclosure, setDisclosure] = useState<AiInductionDisclosure | null>(null)
  const [cost, setCost] = useState<{ textTokens: number; images: number; observedTokensPerRun: number | null; estimatedCost: number | null; rateSet: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const drafts = state.aiWorkflowDrafts.filter((draft) => draft.sessionId === sessionId)
  const draft = drafts[0]
  const provider = state.providers.find((candidate) => candidate.id === providerId)

  const disclose = async () => {
    if (!providerId) return
    setBusy(true)
    try {
      const result = await invoke<AiInductionDisclosure>({ kind: 'ai.induction.disclosure', sessionId, providerId })
      setDisclosure(result)
      // This is the path that really sends frames to a model, so what it will
      // consume is shown before the button that sends them.
      setCost(await invoke({ kind: 'cost.induction', sessionId, providerId }))
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }
  const analyze = async () => {
    if (!disclosure) return
    setBusy(true)
    try {
      await invoke<AiWorkflowDraft>({
        kind: 'ai.induction.analyze',
        sessionId,
        providerId,
        manifestHash: disclosure.manifestHash,
        ...(disclosure.confirmationPhrase ? { confirmation: disclosure.confirmationPhrase } : {}),
      })
      setDisclosure(null)
      await refresh()
      notify('AI workflow draft created from approved evidence', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }
  const correct = async (correction: AiDraftCorrection) => {
    if (!draft) return
    setBusy(true)
    try {
      await invoke({ kind: 'ai.draft.correct', draftId: draft.id, correction })
      await refresh()
      notify('A new AI draft version was saved', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }
  const decide = async (decision: 'accept' | 'reject') => {
    if (!draft) return
    setBusy(true)
    try {
      await invoke({ kind: 'ai.draft.decide', draftId: draft.id, decision })
      await refresh()
      notify(decision === 'accept' ? 'Draft accepted as non-executable memory' : 'Draft rejected and retained in the audit trail', decision === 'accept' ? 'positive' : 'warning')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }

  return (
    <Card className="ai-induction" elevated>
      <div className="ai-induction__hero">
        <div className="ai-induction__mark"><BrainCircuit size={24} /></div>
        <div><div className="eyebrow">AI-assisted induction · explicit send only</div><h2>Find the workflow behind the evidence.</h2><p>Carve can ask a vision model to propose steps, decisions, inputs, outcomes, and exceptions. The result stays editable and cannot control the computer.</p></div>
        <div className="ai-induction__authority"><LockKeyhole size={15} /><span>Draft authority</span><strong>Non-executable</strong></div>
      </div>

      <div className="ai-induction__grid">
        <section className="ai-induction__control">
          <div className="ai-section-title"><span>01</span><div><strong>Choose an analyst</strong><small>Vision and strict structured output are required.</small></div></div>
          {capableProviders.length ? <Field label="Model provider"><select value={providerId} onChange={(event) => { setProviderId(event.target.value); setDisclosure(null) }}>{capableProviders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.model}</option>)}</select></Field> : <div className="ai-warning"><ShieldAlert size={17} /><span>No configured provider declares both vision and structured output.</span></div>}
          {provider ? <div className={`provider-boundary provider-boundary--${provider.kind}`}><div>{provider.kind === 'hosted' ? <Cloud size={16} /> : <HardDrive size={16} />}<strong>{provider.kind === 'hosted' ? 'External data boundary' : 'Local data boundary'}</strong></div><span>{provider.privacyNote}</span></div> : null}
          {!disclosure ? <Button disabled={!providerId || busy} onClick={() => void disclose()}><ShieldCheck size={16} /> Review send manifest</Button> : null}
        </section>

        <section className="ai-induction__manifest">
          <div className="ai-section-title"><span>02</span><div><strong>Consent to this exact scope</strong><small>A manifest hash binds the evidence and provider.</small></div></div>
          {!disclosure ? <div className="manifest-empty"><Eye size={22} /><strong>Nothing is sent by default</strong><span>Open the manifest to see every evidence item and field first.</span></div> : <>
            <div className="manifest-metrics"><div><strong>{disclosure.evidence.length}</strong><span>approved records</span></div><div><strong>{disclosure.imageCount}</strong><span>sanitized images</span></div><div><strong>{disclosure.omittedExcludedCount + disclosure.omittedPendingCount}</strong><span>omitted records</span></div></div>
            {cost ? (
              <div className="induction-cost">
                <strong>
                  {cost.observedTokensPerRun !== null
                    ? `About ${cost.observedTokensPerRun.toLocaleString()} tokens${cost.estimatedCost !== null ? `, roughly ${formatMoney(cost.estimatedCost)}` : ''}`
                    : `${cost.textTokens.toLocaleString()} tokens of text, plus ${cost.images} image${cost.images === 1 ? '' : 's'}`}
                </strong>
                <span>
                  {cost.observedTokensPerRun !== null
                    ? `Averaged from previous runs on this model. ${cost.images} image${cost.images === 1 ? '' : 's'} at high detail.`
                    : 'Images are billed by how the provider tiles them, which is not a formula worth guessing, so the figure above counts text only. The first run records what it actually consumed and the estimate becomes real after that.'}
                  {cost.rateSet ? '' : ' Set a rate in Settings to see this in currency.'}
                </span>
              </div>
            ) : null}
            <div className="manifest-evidence">{disclosure.evidence.map((item) => <div key={item.observationId}><span>{String(item.sequence).padStart(2, '0')}</span><div><strong>{item.label}</strong><small>{humanize(item.annotationKind)} · {item.hasSanitizedImage ? 'sanitized image attached' : 'metadata only'}</small></div><Check size={14} /></div>)}</div>
            <details className="manifest-fields"><summary>Fields included in the request <ChevronDown size={14} /></summary>{disclosure.sentFields.map((field) => <span key={field}><Check size={12} /> {field}</span>)}</details>
            <div className="manifest-hash"><FileKey size={14} /><span>Consent manifest</span><code>{disclosure.manifestHash.slice(0, 16)}</code></div>
            {disclosure.blockedReasons.length ? <div className="manifest-blockers"><ShieldAlert size={17} /><div><strong>Analysis blocked</strong>{disclosure.blockedReasons.map((reason) => <span key={reason}>{reason}</span>)}</div></div> : <div className="manifest-ready"><ShieldCheck size={17} /><span>Only the approved sanitized evidence above is eligible to send.</span></div>}
            <div className="manifest-actions"><Button variant="ghost" disabled={busy} onClick={() => setDisclosure(null)}>Close manifest</Button><Button disabled={busy || !disclosure.ready} onClick={() => void analyze()}>{disclosure.requiresExternalTransmission ? <Cloud size={16} /> : <Sparkles size={16} />}{busy ? 'Analyzing…' : disclosure.requiresExternalTransmission ? 'Send approved evidence & analyze' : 'Analyze approved evidence'}</Button></div>
          </>}
        </section>

        <section className="ai-induction__draft">
          <div className="ai-section-title"><span>03</span><div><strong>Inspect the proposal</strong><small>Facts, interpretations, confidence, and evidence remain distinct.</small></div></div>
          {!draft ? <div className="draft-empty"><Sparkles size={23} /><strong>No AI proposal yet</strong><span>Complete the consent step to create an evidence-bound draft.</span></div> : <>
            <div className="draft-heading"><div><div><Pill tone={draft.status === 'accepted' ? 'positive' : draft.status === 'rejected' ? 'danger' : 'warning'}>{humanize(draft.status)}</Pill><Pill>v{draft.version}</Pill><Pill>{draft.model}</Pill></div><h3>{draft.proposal.goal}</h3><p>{draft.proposal.summary}</p></div>{draft.status === 'proposed' ? <Button size="small" variant="ghost" disabled={busy} onClick={() => { const goal = window.prompt('Correct the proposed goal', draft.proposal.goal); const summary = window.prompt('Correct the proposed summary', draft.proposal.summary); if (goal?.trim() || summary?.trim()) void correct({ operation: 'rename', ...(goal?.trim() ? { goal } : {}), ...(summary?.trim() ? { summary } : {}) }) }}><Pencil size={14} /> Edit</Button> : null}</div>
            <div className="draft-steps">{draft.proposal.steps.map((step, index) => <div className={`draft-step draft-step--${step.kind}`} key={step.id}><span>{index + 1}</span><div><div><strong>{step.name}</strong><Pill tone={confidenceTone(step.confidence)}>{Math.round(step.confidence * 100)}%</Pill></div><p>{step.description}</p><small>{humanize(step.kind)} · evidence {step.evidenceObservationIds.map((evidenceId) => evidenceId.slice(-6)).join(', ')}</small><details><summary>Evidence & interpretation</summary><div><strong>Observed basis</strong>{step.factBasis.map((fact) => <span key={fact}>{fact}</span>)}</div><div><strong>Interpretation</strong>{step.interpretation.map((item) => <span key={item}>{item}</span>)}</div></details>{draft.status === 'proposed' ? <button disabled={busy} onClick={() => { const name = window.prompt('Correct the step name', step.name); const description = window.prompt('Correct the step description', step.description); if (name?.trim() || description?.trim()) void correct({ operation: 'update_step', stepId: step.id, ...(name?.trim() ? { name } : {}), ...(description?.trim() ? { description } : {}) }) }}><Pencil size={12} /> Correct step</button> : null}</div></div>)}</div>
            <div className="draft-provenance"><ShieldCheck size={15} /><span>{draft.disclosure.evidenceObservationIds.length} approved evidence records · schema validated · {draft.usage.inputTokens ?? 'unmetered'} input tokens · never promoted to computer actions</span></div>
            {draft.status === 'proposed' ? <div className="draft-decisions"><Button variant="danger" disabled={busy} onClick={() => void decide('reject')}><Ban size={15} /> Reject proposal</Button><Button disabled={busy} onClick={() => void decide('accept')}><UserRoundCheck size={15} /> Accept as draft memory</Button></div> : null}
          </>}
        </section>
      </div>
    </Card>
  )
}

function ReviewEditor({ observation, review, onSave, onDelete }: { observation: ObservationRecord; review: ObservationReview | undefined; onSave: (input: ObservationReviewInput) => Promise<void>; onDelete: () => Promise<void> }) {
  const hasScreenshot = Boolean(observation.facts.screenshotRef || review?.sanitizedScreenshotRef)
  const [disposition, setDisposition] = useState<ObservationReviewInput['disposition']>(review?.disposition ?? 'approved')
  const [annotationKind, setAnnotationKind] = useState<ObservationReviewInput['annotationKind']>(review?.annotationKind === 'irrelevant' ? 'state' : review?.annotationKind ?? 'state')
  const [taskBoundary, setTaskBoundary] = useState<ObservationReviewInput['taskBoundary']>(review?.taskBoundary ?? (observation.sequence === 1 ? 'start' : 'none'))
  const [label, setLabel] = useState(review?.label ?? observation.facts.windowTitle)
  const [notes, setNotes] = useState(review?.notes ?? '')
  const [visualDescription, setVisualDescription] = useState(review?.visualDescription ?? '')
  const [masks, setMasks] = useState<RegionExclusion[]>(review?.masks ?? [])
  const [cropEnabled, setCropEnabled] = useState(Boolean(review?.crop))
  const [crop, setCrop] = useState<RegionExclusion>(review?.crop ?? { x: 0, y: 0, width: Number(observation.facts.state.captureWidth ?? 1), height: Number(observation.facts.state.captureHeight ?? 1) })
  const [createSanitizedCopy, setCreateSanitizedCopy] = useState(hasScreenshot && !review?.sanitizedScreenshotRef)
  const [discardSourceScreenshot, setDiscardSourceScreenshot] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (nextDisposition = disposition) => {
    setBusy(true)
    try { await onSave({ disposition: nextDisposition, annotationKind, taskBoundary, label, notes, visualDescription, masks, crop: cropEnabled ? crop : null, createSanitizedCopy: nextDisposition === 'approved' && createSanitizedCopy, discardSourceScreenshot: hasScreenshot && discardSourceScreenshot }) } finally { setBusy(false) }
  }
  return (
    <Card className="review-editor" elevated>
      <div className="review-editor__header">
        <div>
          <div className="eyebrow">Screen {observation.sequence} · {review ? 'Reviewed' : 'Needs review'}</div>
          <h2>{observation.facts.windowTitle}</h2>
          <p>{observation.facts.app} · {new Date(observation.observedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        </div>
        <div className="pill-group">{review ? <Pill tone={review.disposition === 'approved' ? 'positive' : 'warning'}>{review.disposition === 'approved' ? 'Included' : 'Excluded'}</Pill> : <Pill tone="warning">Unreviewed</Pill>}</div>
      </div>
      {hasScreenshot ? <ReviewCanvas observation={observation} masks={masks} onMasksChange={setMasks} /> : <div className="review-no-image"><EyeOff size={23} /><div><strong>No persisted pixels</strong><span>This observation contains window metadata only, or its screenshot has expired.</span></div></div>}
      <section className="review-memory-label">
        <div className="review-memory-label__heading"><CheckCircle2 size={17} /><div><strong>What should Carve remember?</strong><span>Use a short, factual description of what is visible.</span></div></div>
        <input value={label} maxLength={160} placeholder="e.g. Request details are visible" aria-label="What Carve should remember" onChange={(event) => setLabel(event.target.value)} />
      </section>

      <details className="review-detail-controls">
        <summary>
          <span><strong>Optional context</strong><small>Skip this unless the screen has a special role in the task</small></span>
          <ChevronDown size={16} />
        </summary>
        <div className="review-fields">
          <div className="review-fields__help"><strong>Not sure? Leave this alone.</strong><span>Carve will treat the screen as a normal step. These choices only help organize a workflow later.</span></div>
          <Field label="What is this screen?" hint="Choose “A normal step” unless one of the other descriptions clearly fits."><select value={annotationKind} onChange={(event) => setAnnotationKind(event.target.value as ObservationReviewInput['annotationKind'])}><option value="state">A normal step</option><option value="input">Information the task needs</option><option value="decision">A choice or branch</option><option value="outcome">A finished result</option><option value="interruption">An interruption</option></select></Field>
          <Field label="Where is it in the task?" hint="This helps Carve group several screens into one task."><select value={taskBoundary} onChange={(event) => setTaskBoundary(event.target.value as ObservationReviewInput['taskBoundary'])}><option value="none">In the middle</option><option value="start">At the beginning</option><option value="end">At the end</option><option value="start_end">The whole task is on this screen</option></select></Field>
          <Field className="review-fields__wide" label="Anything else Carve should know?"><textarea value={notes} maxLength={2000} placeholder="Optional note or correction…" onChange={(event) => setNotes(event.target.value)} /></Field>
          <Field className="review-fields__wide" label="What might text recognition miss?" hint="Optional: describe an important colour, chart, icon, layout, or other visual detail."><textarea value={visualDescription} maxLength={1000} placeholder="e.g. An orange warning triangle appears beside the account total" onChange={(event) => setVisualDescription(event.target.value)} /></Field>
        </div>
      </details>

      {hasScreenshot ? <details className="review-privacy-controls"><summary><ShieldCheck size={16} /><span className="review-privacy-controls__copy"><strong>Privacy tools</strong><small>Crop, mask, or remove original pixels</small></span><span>{masks.length} mask{masks.length === 1 ? '' : 's'}</span><ChevronDown size={16} /></summary><div className="review-privacy-controls__body"><Toggle checked={cropEnabled} onChange={setCropEnabled} label="Crop retained frame" description="Coordinates use top-left image pixels." /><div className={`crop-grid ${cropEnabled ? '' : 'crop-grid--disabled'}`}>{(['x', 'y', 'width', 'height'] as const).map((key) => <Field label={humanize(key)} key={key}><input type="number" min={0} disabled={!cropEnabled} value={crop[key]} onChange={(event) => setCrop((current) => ({ ...current, [key]: Number(event.target.value) }))} /></Field>)}</div><Toggle checked={createSanitizedCopy} onChange={setCreateSanitizedCopy} label="Create a sanitized derivative" description="Masks and crop are rendered into a new owner-only PNG by the signed local helper." /><Toggle checked={discardSourceScreenshot} onChange={setDiscardSourceScreenshot} disabled={Boolean(review?.originalDeleted)} label="Permanently discard original pixels" description="Deletion occurs only after the sanitized derivative is successfully written." /></div></details> : null}

      <details className="review-evidence-meta">
        <summary>Evidence details <ChevronDown size={14} /></summary>
        <div><span>Source</span><strong>{humanize(observation.source)}</strong><span>Evidence ID</span><code>{observation.evidenceHash.slice(0, 16)}</code>{review ? <><span>Review version</span><strong>v{review.version}</strong></> : null}{review?.sanitizedScreenshotRef ? <><span>Stored copy</span><strong>Sanitized derivative</strong></> : null}{review?.originalDeleted ? <><span>Original</span><strong>Deleted</strong></> : null}</div>
      </details>

      <div className="review-editor__footer">
        <Button className="review-delete-action" variant="ghost" size="small" disabled={busy} onClick={() => void onDelete()}><Trash2 size={14} /> Delete capture…</Button>
        <div><Button variant="secondary" disabled={busy} onClick={() => { setDisposition('excluded'); void submit('excluded') }}><Ban size={15} /> Exclude</Button><Button disabled={busy || annotationKind === 'irrelevant'} onClick={() => { setDisposition('approved'); void submit('approved') }}><Check size={15} /> {review ? 'Save changes' : 'Keep as evidence'}</Button></div>
      </div>
    </Card>
  )
}

function ReviewCanvas({ observation, masks, onMasksChange }: { observation: ObservationRecord; masks: RegionExclusion[]; onMasksChange: (masks: RegionExclusion[]) => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [natural, setNatural] = useState({ width: Number(observation.facts.state.captureWidth ?? 1), height: Number(observation.facts.state.captureHeight ?? 1) })
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<RegionExclusion | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  useEffect(() => { let live = true; void invoke<{ dataUrl: string | null }>({ kind: 'observation.screenshot', observationId: observation.id }).then((result) => { if (live) setDataUrl(result.dataUrl) }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [observation.id])
  const point = (clientX: number, clientY: number) => {
    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: Math.max(0, Math.min(natural.width, (clientX - rect.left) / rect.width * natural.width)), y: Math.max(0, Math.min(natural.height, (clientY - rect.top) / rect.height * natural.height)) }
  }
  const move = (clientX: number, clientY: number) => {
    const end = point(clientX, clientY)
    if (!start || !end) return
    setDraft({ x: Math.round(Math.min(start.x, end.x)), y: Math.round(Math.min(start.y, end.y)), width: Math.round(Math.abs(start.x - end.x)), height: Math.round(Math.abs(start.y - end.y)) })
  }
  const finish = () => { if (draft && draft.width >= 4 && draft.height >= 4) onMasksChange([...masks, draft]); setStart(null); setDraft(null) }
  const overlays = [...masks, ...(draft ? [draft] : [])]
  return <div className="redaction-workbench"><div className="redaction-workbench__toolbar"><div><ShieldAlert size={15} /><span>Drag over sensitive pixels to burn in a mask</span></div><Button variant="ghost" size="small" disabled={masks.length === 0} onClick={() => onMasksChange([])}><X size={14} /> Clear masks</Button></div>{loading ? <div className="screenshot-placeholder">Loading local evidence…</div> : dataUrl ? <div className="redaction-canvas" onPointerDown={(event) => { const next = point(event.clientX, event.clientY); if (next) { event.currentTarget.setPointerCapture(event.pointerId); setStart(next) } }} onPointerMove={(event) => move(event.clientX, event.clientY)} onPointerUp={finish} onPointerCancel={finish}><img ref={imageRef} draggable={false} src={dataUrl} alt={`Captured evidence from ${observation.facts.windowTitle}`} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />{overlays.map((mask, index) => <span className="redaction-mask" key={`${mask.x}-${mask.y}-${index}`} style={{ left: `${mask.x / natural.width * 100}%`, top: `${mask.y / natural.height * 100}%`, width: `${mask.width / natural.width * 100}%`, height: `${mask.height / natural.height * 100}%` }}><span>{index < masks.length ? `Mask ${index + 1}` : 'New mask'}</span></span>)}</div> : <div className="screenshot-placeholder">The screenshot is unavailable or has expired.</div>}<div className="redaction-workbench__meta"><span>{natural.width} × {natural.height} pixels</span><span>{masks.length} permanent review mask{masks.length === 1 ? '' : 's'} proposed</span></div></div>
}

function BoundaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="boundary-item"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>
}

function ObservationScreenshot({ observationId, windowTitle }: { observationId: string; windowTitle: string }) {
  const [open, setOpen] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (dataUrl) return
    setLoading(true)
    try {
      const result = await invoke<{ dataUrl: string | null }>({ kind: 'observation.screenshot', observationId })
      setDataUrl(result.dataUrl)
    } finally { setLoading(false) }
  }
  return <div className="observation-screenshot"><Button size="small" variant="secondary" onClick={() => void load()}><Eye size={14} /> {open ? 'Hide redacted screenshot' : 'Review redacted screenshot'}</Button>{open ? loading ? <div className="screenshot-placeholder">Loading local capture…</div> : dataUrl ? <img src={dataUrl} alt={`Privacy-processed capture of ${windowTitle}`} /> : <div className="screenshot-placeholder">Capture file is unavailable or has expired.</div> : null}</div>
}

function BrowserSandboxPanel({ state, refresh, notify, learning = false }: Pick<ViewProps, 'state' | 'refresh' | 'notify'> & { learning?: boolean }) {
  const [resetting, setResetting] = useState(false)
  const sandbox = state.browserSandbox
  const reset = async (priority: 'urgent' | 'standard', application: 'triage' | 'handoff' | 'document' | 'insurance' | 'research' | 'data' | 'hr' | 'logistics' | 'legal' | 'inventory' | 'quality' = 'triage', layout: 'baseline' | 'changed' | 'ambiguous' = 'baseline') => {
    setResetting(true)
    try {
      await invoke({ kind: 'browser.sandbox.reset', priority, application, layout })
      await refresh()
      notify(`${application === 'handoff' ? `${humanize(layout)} customer handoff` : humanize(priority)} browser case ready`, 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally { setResetting(false) }
  }
  return (
    <Card className="browser-sandbox-card">
      <SectionHeading
        eyebrow={learning ? 'Live demonstration' : 'Current browser state'}
        title={sandbox.state.scenarioTitle || (sandbox.state.application === 'handoff' ? 'Northstar customer handoff' : 'Northstar priority triage')}
        description={learning ? sandbox.state.application === 'handoff' ? 'Capture the form, enter a safe follow-up note, capture the filled state, save the handoff, then capture the verified outcome.' : 'Capture the current state, perform the bounded task, then capture the verified outcome.' : sandbox.state.goal || 'Reset to the authored workflow you want Carve to inspect before creating a new plan.'}
        action={<Pill tone={sandbox.status === 'ready' ? 'positive' : sandbox.status === 'error' ? 'danger' : 'neutral'} icon={<Globe2 size={13} />}>{humanize(sandbox.status)}</Pill>}
      />
      <div className="browser-sandbox-toolbar">
        <div><span>{sandbox.state.industry || (sandbox.state.application === 'handoff' ? `Contact ${sandbox.state.contactId}` : `Request ${sandbox.state.requestId}`)}</span>{sandbox.state.application === 'handoff' ? <Pill tone="info">{sandbox.state.accountTier}</Pill> : sandbox.state.application === 'triage' ? <Pill tone={sandbox.state.priority === 'urgent' ? 'warning' : 'info'}>{sandbox.state.priority}</Pill> : <Pill tone="info">{sandbox.state.maxActions} step limit</Pill>}<Pill>{sandbox.state.view}</Pill><Pill tone={sandbox.state.layout === 'ambiguous' ? 'warning' : 'neutral'}>{sandbox.state.layout} layout</Pill></div>
        <div>{!learning || sandbox.state.application === 'triage' ? <><Button size="small" variant="secondary" disabled={resetting} onClick={() => void reset('urgent')}><RefreshCw size={14} /> Urgent case</Button><Button size="small" variant="secondary" disabled={resetting} onClick={() => void reset('standard')}><RefreshCw size={14} /> Standard case</Button></> : null}{!learning || sandbox.state.application === 'handoff' ? <><Button size="small" variant="secondary" disabled={resetting} onClick={() => void reset('standard', 'handoff')}><RefreshCw size={14} /> Original handoff</Button><Button size="small" variant="secondary" disabled={resetting} onClick={() => void reset('standard', 'handoff', 'changed')}><RefreshCw size={14} /> Changed layout</Button>{!learning ? <Button size="small" variant="secondary" disabled={resetting} onClick={() => void reset('standard', 'handoff', 'ambiguous')}><AlertTriangle size={14} /> Ambiguous field</Button> : null}</> : null}</div>
      </div>
      {sandbox.url ? <iframe className="browser-sandbox-frame" title="Northstar training browser" src={sandbox.url} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" /> : <div className="browser-sandbox-placeholder">{sandbox.error ? <><ShieldAlert /><strong>Browser unavailable</strong><span>{sandbox.error}</span></> : <><Globe2 /><strong>Sandbox is dormant</strong><span>Choose an urgent or standard case to launch the isolated browser.</span></>}</div>}
      <div className="browser-sandbox-boundary"><ShieldCheck size={15} /><span>{sandbox.isolation} · {sandbox.traceCount} retained traces</span></div>
    </Card>
  )
}

function LiveMacCanaryPilot({ state, desktop, notify }: Pick<ViewProps, 'state' | 'desktop' | 'notify'>) {
  const compatibleProviders = state.providers.filter((provider) => provider.kind === 'hosted' && provider.capabilities.vision && provider.capabilities.structuredOutput)
  const regressionCaseIds = ['C01', 'C02', 'C06', 'C13', 'C15']
  const [planHash, setPlanHash] = useState('')
  const [providerId, setProviderId] = useState('openai-hosted')
  const [readiness, setReadiness] = useState<LiveMacCanaryDesktopReadiness | null>(null)
  const [proposal, setProposal] = useState<LiveMacCanaryDesktopProposal | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [receipt, setReceipt] = useState<LiveMacCanaryRunReceipt | null>(null)
  const [checking, setChecking] = useState(false)
  const [running, setRunning] = useState(false)
  const selectedProviderId = compatibleProviders.some((provider) => provider.id === providerId)
    ? providerId
    : compatibleProviders[0]?.id ?? providerId
  const hashReady = /^[a-f0-9]{64}$/u.test(planHash)

  const resetDownstream = () => {
    setReadiness(null)
    setProposal(null)
    setConfirmation('')
    setReceipt(null)
  }

  const preflight = async () => {
    setChecking(true)
    try {
      const result = await invoke<LiveMacCanaryDesktopReadiness>({
        kind: 'evaluation.live_mac.preflight', planHash, caseIds: regressionCaseIds, providerId: selectedProviderId,
      })
      setReadiness(result)
      setProposal(null)
      setConfirmation('')
      notify(result.canPropose ? 'Five-case desktop preflight passed; no application was opened' : 'The regression gate remains blocked; review the readiness checks', result.canPropose ? 'positive' : 'warning')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally { setChecking(false) }
  }

  const propose = async () => {
    setChecking(true)
    try {
      const result = await invoke<LiveMacCanaryDesktopProposal>({
        kind: 'evaluation.live_mac.propose', planHash, caseIds: regressionCaseIds, providerId: selectedProviderId,
      })
      setProposal(result)
      setConfirmation('')
      notify('Exact five-case run created for review; execution is still locked', 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally { setChecking(false) }
  }

  const authorizeAndRun = async () => {
    if (!proposal) return
    setRunning(true)
    setReceipt(null)
    try {
      const result = await invoke<LiveMacCanaryRunReceipt>({
        kind: 'evaluation.live_mac.authorize_and_run', runHash: proposal.runHash, confirmation,
      })
      setReceipt(result)
      notify(`Live-Mac regression gate ${result.status}`, result.status === 'completed' ? 'positive' : 'warning')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally { setRunning(false) }
  }

  const stop = async () => {
    try {
      await invoke({ kind: 'evaluation.live_mac.stop' })
      notify('Live-Mac canary stop requested', 'warning')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    }
  }

  return (
    <Card className="live-mac-pilot" elevated>
      <SectionHeading
        eyebrow="Real Mac regression gate · five cases"
        title="Cross the desktop boundary one reviewed run at a time."
        description="The gate uses Carve’s structured selected-window controller in fresh TextEdit, Calculator, and Chrome windows. Preflight and proposal are non-launching; execution needs the exact run phrase plus macOS user-presence verification."
        action={<Pill tone={running ? 'warning' : 'neutral'} icon={running ? <Activity size={13} /> : <LockKeyhole size={13} />}>{running ? 'Running' : 'Waiting for approval'}</Pill>}
      />
      {desktop.desktop && desktop.platform === 'darwin' ? <>
        <div className="live-mac-pilot__inputs">
          <Field label="Prepared plan hash"><input value={planHash} spellCheck={false} maxLength={64} placeholder="64-character SHA-256" onChange={(event) => { setPlanHash(event.target.value.trim().toLowerCase()); resetDownstream() }} /></Field>
          <Field label="Structured visual provider"><select value={selectedProviderId} onChange={(event) => { setProviderId(event.target.value); resetDownstream() }}>{compatibleProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}</select></Field>
          <Button variant="secondary" disabled={checking || running || !hashReady || compatibleProviders.length === 0} onClick={() => void preflight()}><ScanLine size={14} /> Read-only preflight</Button>
        </div>
        {readiness ? <div className="live-mac-pilot__readiness">
          <div className="foundry-envelope">
            <div><span>Cases</span><strong>C01 · C02 · C06 · C13 · C15</strong><small>foreground serial · fresh windows only</small></div>
            <div><span>Assured controller</span><strong>{readiness.model.actionEngine === 'structured_v1' ? 'Selected' : 'Not selected'}</strong><small>{readiness.model.providerId} · {readiness.model.model}</small></div>
            <div><span>Desktop bridge</span><strong>{readiness.preflight.status}</strong><small>Stop and permissions checked in process</small></div>
            <div><span>Price</span><strong>{readiness.model.pricing ? `$${readiness.model.pricing.inputPerMillion}/M · $${readiness.model.pricing.outputPerMillion}/M` : 'Not configured'}</strong><small>input · output</small></div>
            <div><span>Screens shared with AI</span><strong>Selected window only</strong><small>screenshots are not retained</small></div>
            <div><span>Execution</span><strong>{readiness.canPropose ? 'Ready to propose' : 'Blocked'}</strong><small>no app opened by this check</small></div>
          </div>
          {readiness.blockers.length > 0 ? <div className="foundry-findings">{readiness.blockers.map((blocker) => <p key={blocker}><ShieldAlert size={14} /><span>{blocker}</span></p>)}</div> : <div className="foundry-ready"><BadgeCheck size={15} /><span>Every desktop prerequisite is currently healthy. The next step only creates an inert, expiring run hash.</span></div>}
          <div className="foundry-approval"><Button disabled={checking || running || !readiness.canPropose} onClick={() => void propose()}><ShieldCheck size={15} /> Create exact gate proposal</Button></div>
        </div> : <div className="foundry-empty"><LockKeyhole size={16} /><span>Paste a freshly generated and prepared plan hash, then run the desktop preflight. Nothing opens during this step.</span></div>}
        {proposal ? <div className="live-mac-pilot__authorization">
          <div className="foundry-hash"><span>Exact run hash · expires {new Date(proposal.proposal.expiresAt).toLocaleTimeString()}</span><code>{proposal.runHash}</code></div>
          <div className="live-mac-pilot__phrase"><span>To authorize this one run, enter the complete phrase</span><code>{proposal.confirmation}</code><input value={confirmation} spellCheck={false} placeholder="Type or paste the exact authorization phrase" onChange={(event) => setConfirmation(event.target.value)} /></div>
          <div className="live-mac-pilot__run-actions">{running ? <Button variant="danger" onClick={() => void stop()}><Square size={14} /> Stop gate</Button> : <Button disabled={confirmation !== proposal.confirmation} onClick={() => void authorizeAndRun()}><Play size={14} /> Verify owner and run gate</Button>}</div>
        </div> : null}
        {receipt ? <div className="foundry-report">
          <div className="foundry-report__head"><div><span>Latest gate receipt</span><strong>{receipt.cases.filter((entry) => entry.status === 'passed').length}/{receipt.caseIds.length} passed</strong></div><Pill tone={receipt.status === 'completed' ? 'positive' : 'warning'}>{receipt.status}</Pill></div>
          {receipt.cases.map((entry) => <div className="lab-metrics" key={entry.caseId}><div><span>Case</span><strong>{entry.caseId} · {entry.status}</strong></div><div><span>First action</span><strong>{entry.metrics.timeToFirstActionMs ?? '—'} ms</strong></div><div><span>Actions / clause</span><strong>{entry.metrics.actionsPerClause.toFixed(2)}</strong></div><div><span>Model calls</span><strong>{entry.metrics.modelCalls}</strong></div><div><span>Cost</span><strong>${entry.metrics.costUsd.toFixed(4)}</strong></div></div>)}
        </div> : null}
      </> : <div className="foundry-empty"><Laptop size={16} /><span>The real-Mac pilot is available only in the Carve desktop app on macOS.</span></div>}
    </Card>
  )
}

export function ComputerUseLabView({ state, desktop, refresh, notify }: ViewProps) {
  const lab = state.computerUseLab
  const foundry = state.evaluationFoundry
  const [scenarioId, setScenarioId] = useState<ComputerUseScenarioId>((state.browserSandbox.state.scenarioId || lab.scenarios[0]?.id || 'document_end') as ComputerUseScenarioId)
  const [architectureId, setArchitectureId] = useState<ComputerUseArchitectureId>('hierarchical_governed')
  const [variation, setVariation] = useState<ComputerUseVariation>('baseline')
  const [busy, setBusy] = useState(false)
  const [campaignPreview, setCampaignPreview] = useState<EvaluationCampaignPreview | null>(null)
  const [completedCampaign, setCompletedCampaign] = useState<EvaluationCampaignReport | null>(null)
  const scenario = lab.scenarios.find((candidate) => candidate.id === scenarioId) ?? lab.scenarios[0]
  const latest = lab.runs.find((run) => run.scenarioId === scenarioId && run.architectureId === architectureId && run.variation === variation) ?? lab.runs[0]
  const latestCampaign = completedCampaign ?? foundry.latestReports[0] ?? null

  const task = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await work()
      await refresh()
      notify(message, 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally { setBusy(false) }
  }

  const loadScenario = (selected: ComputerUseScenario) => task(
    () => invoke({ kind: 'browser.sandbox.reset', priority: selected.id === 'support_triage' ? 'urgent' : 'standard', application: selected.application, layout: variation }),
    `${selected.title} is ready in the disposable app`,
  )
  const runOne = () => task(
    () => invoke({ kind: 'computer.lab.run', scenarioId, architectureId, variation }),
    'Simulation trace completed',
  )
  const runMatrix = () => task(
    () => invoke({ kind: 'computer.lab.run_suite' }),
    `${lab.scenarios.length * lab.architectures.length} architecture runs completed`,
  )
  const clear = () => task(() => invoke({ kind: 'computer.lab.clear' }), 'Simulation results cleared')
  const openWindow = () => task(() => invoke({ kind: 'browser.sandbox.open_external' }), 'Scenario opened in a separate browser window')

  const previewCampaign = async (suite: EvaluationFoundrySuite) => {
    setBusy(true)
    try {
      const preview = await invoke<EvaluationCampaignPreview>({ kind: 'evaluation.campaign.preview', suite })
      setCampaignPreview(preview)
      notify(`${suite === 'dictation' ? 'Dictation editing' : 'Computer-use'} campaign is ready for review`, preview.findings.length === 0 ? 'positive' : 'danger')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally { setBusy(false) }
  }

  const runCampaign = async () => {
    if (!campaignPreview) return
    setBusy(true)
    try {
      const report = await invoke<EvaluationCampaignReport>({ kind: 'evaluation.campaign.run', suite: campaignPreview.suite, manifestHash: campaignPreview.manifestHash })
      setCompletedCampaign(report)
      setCampaignPreview(null)
      await refresh()
      notify(`Foundry campaign ${report.status}: ${report.totals.passed}/${report.totals.executed} trials passed`, report.promotionEligible ? 'positive' : 'warning')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally { setBusy(false) }
  }

  if (!scenario) return <div className="page"><EmptyState icon={<TerminalSquare />} title="No simulation scenarios" description="The local scenario catalog is empty." /></div>

  return (
    <div className="page page--lab">
      <PageIntro
        label="Computer-use simulation lab"
        title="Try Carve on practice tasks."
        description="Run practice tasks in test apps and compare how well Carve finishes them."
        action={<div className="lab-page-actions"><Button variant="secondary" disabled={busy} onClick={() => void clear()}><Trash2 size={15} /> Clear results</Button><Button disabled={busy} onClick={() => void runMatrix()}><Play size={15} /> Run architecture matrix</Button></div>}
      />

      <Card className="foundry-card" elevated>
        <SectionHeading
          eyebrow="Evaluation Foundry"
          title="Approve the experiment, then let Carve do the testing."
          description="Campaigns run deterministic regressions in ephemeral local environments. No personal account, live site, credential, purchase, message, deletion, model call, or network access is authorized by these built-in suites."
          action={<Pill tone="positive" icon={<ShieldCheck size={13} />}>Work with permission checks</Pill>}
        />
        <div className="foundry-actions">
          <Button variant="secondary" disabled={busy} onClick={() => void previewCampaign('dictation')}><Mic size={14} /> Preview dictation editing</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void previewCampaign('computer')}><MousePointer2 size={14} /> Preview computer regression</Button>
        </div>
        {campaignPreview ? <div className="foundry-preview">
          <div className="foundry-envelope">
            <div><span>Trials</span><strong>{campaignPreview.manifest.suite.scenarioIds.length} × {campaignPreview.manifest.suite.repetitions}</strong><small>{campaignPreview.manifest.budget.maxTrials} maximum</small></div>
            <div><span>Environment</span><strong>{humanize(campaignPreview.manifest.environment.tier)}</strong><small>{campaignPreview.manifest.environment.ephemeral ? 'ephemeral' : 'persistent'} · {campaignPreview.manifest.environment.accountClass} account</small></div>
            <div><span>Network</span><strong>{humanize(campaignPreview.manifest.environment.network.mode)}</strong><small>{campaignPreview.manifest.environment.network.allowedDomains.length} allowed domains</small></div>
            <div><span>Effects</span><strong>{campaignPreview.manifest.effects.allowed.map(humanize).join(', ')}</strong><small>{campaignPreview.manifest.effects.prohibited.length} classes prohibited</small></div>
            <div><span>AI budget</span><strong>{campaignPreview.manifest.budget.maxModelCalls} calls · ${campaignPreview.manifest.budget.maxCostUsd}</strong><small>{campaignPreview.manifest.budget.maxTokens} token maximum</small></div>
            <div><span>Retention</span><strong>{campaignPreview.manifest.retention.artifactDays} days</strong><small>raw audio {campaignPreview.manifest.retention.retainRawAudio ? 'retained' : 'never retained'}</small></div>
          </div>
          <div className="foundry-hash"><span>Exact approved plan</span><code>{campaignPreview.manifestHash}</code></div>
          {campaignPreview.findings.length > 0
            ? <div className="foundry-findings">{campaignPreview.findings.map((finding) => <p key={`${finding.code}:${finding.message}`}><ShieldAlert size={14} /><span><strong>{finding.code}</strong>{finding.message}</span></p>)}</div>
            : <div className="foundry-ready"><BadgeCheck size={15} /><span>The safety governor accepts this envelope. Approval applies only to this hash and current source version.</span></div>}
          <div className="foundry-approval"><Button disabled={busy || campaignPreview.findings.length > 0} onClick={() => void runCampaign()}><ShieldCheck size={15} /> Approve exact plan and run</Button></div>
        </div> : <div className="foundry-empty"><LockKeyhole size={16} /><span>Choose a suite to generate an immutable campaign plan. Nothing runs during preview.</span></div>}
        {latestCampaign ? <div className="foundry-report">
          <div className="foundry-report__head"><div><span>Latest persisted campaign</span><strong>{latestCampaign.totals.passed}/{latestCampaign.totals.executed} trials passed</strong></div><Pill tone={latestCampaign.promotionEligible ? 'positive' : latestCampaign.status === 'stopped' ? 'danger' : 'warning'}>{humanize(latestCampaign.status)}</Pill></div>
          <div className="lab-metrics"><div><span>Outcome rate</span><strong>{Math.round(latestCampaign.metrics.outcomeRate * 100)}%</strong></div><div><span>Answer accuracy</span><strong>{Math.round((latestCampaign.metrics.completionAccuracy ?? latestCampaign.metrics.outcomeRate) * 100)}%</strong></div><div><span>Pass^k</span><strong>{Math.round(latestCampaign.metrics.passPowK * 100)}%</strong></div><div><span>Safety violations</span><strong>{latestCampaign.totals.safetyViolations}</strong></div><div><span>Liveness failures</span><strong>{latestCampaign.totals.verificationLivenessFailures ?? 0}</strong></div><div><span>Budget-truncated</span><strong>{latestCampaign.totals.budgetTruncated ?? 0}</strong></div><div><span>Model calls</span><strong>{latestCampaign.metrics.totalModelCalls}</strong></div><div><span>Promotion</span><strong>{latestCampaign.promotionEligible ? 'Eligible' : 'Blocked'}</strong></div></div>
          {latestCampaign.promotionBlockers.length > 0 ? <div className="lab-findings">{latestCampaign.promotionBlockers.map((blocker) => <p key={blocker}><AlertTriangle size={14} />{blocker}</p>)}</div> : null}
          {latestCampaign.clusters.length > 0 ? <div className="lab-findings">{latestCampaign.clusters.slice(0, 3).map((cluster) => <p key={cluster.id}><BrainCircuit size={14} />{cluster.title} · {cluster.count} trials · priority {cluster.priority}</p>)}</div> : null}
        </div> : null}
        {foundry.commonAuditFailures.length > 0 ? <div className="foundry-audit"><span>Common live failure classes</span>{foundry.commonAuditFailures.slice(0, 4).map((failure) => <Pill key={failure.signature}>{humanize(failure.cause)} · {failure.count}</Pill>)}</div> : null}
      </Card>

      <LiveMacCanaryPilot state={state} desktop={desktop} notify={notify} />

      <div className="lab-summary-strip">
        <div><span>Scenarios</span><strong>{lab.scenarios.length}</strong><small>business-shaped fixtures</small></div>
        <div><span>Architectures</span><strong>{lab.architectures.length}</strong><small>control-loop profiles</small></div>
        <div><span>Runs</span><strong>{lab.runs.length}</strong><small>retained in this process</small></div>
        <div><span>Verified passes</span><strong>{lab.runs.filter((run) => run.status === 'passed').length}</strong><small>criterion-level outcomes</small></div>
      </div>

      <div className="lab-workspace">
        <aside className="lab-scenario-list">
          <div className="lab-scenario-list__head"><span>Scenario catalog</span><Pill>{lab.scenarios.length}</Pill></div>
          {lab.scenarios.map((candidate) => (
            <button type="button" key={candidate.id} className={candidate.id === scenario.id ? 'selected' : ''} onClick={() => setScenarioId(candidate.id)}>
              <span className="lab-scenario-list__icon">{scenarioIcon(candidate.application)}</span>
              <span><small>{candidate.industry} · {humanize(candidate.difficulty)}</small><strong>{candidate.title}</strong><em>{candidate.maxActions} step limit</em></span>
              <ChevronDown size={15} />
            </button>
          ))}
        </aside>

        <main className="lab-main">
          <Card className="lab-scenario-brief" elevated>
            <div className="lab-scenario-brief__top">
              <div><div className="eyebrow">{scenario.role}</div><h2>{scenario.title}</h2><p>{scenario.description}</p></div>
              <div><Pill tone={scenario.difficulty === 'advanced' ? 'warning' : 'info'}>{scenario.difficulty}</Pill><Pill>{scenario.maxActions} actions</Pill></div>
            </div>
            <div className="lab-goal"><Sparkles size={17} /><div><span>Assigned outcome</span><strong>{scenario.goal}</strong></div></div>
            <div className="lab-contract-grid">
              <div><span>Success criteria</span>{scenario.successCriteria.map((criterion) => <small key={criterion}><Check size={13} /> {criterion}</small>)}</div>
              <div><span>Hard boundaries</span>{scenario.riskChecks.map((check) => <small key={check}><ShieldCheck size={13} /> {check}</small>)}</div>
            </div>
          </Card>

          <Card className="lab-runner">
            <SectionHeading eyebrow="Repeatable experiment" title="Run one control architecture" description="The deterministic harness makes architecture regressions comparable. The disposable app below is the visual target for live model runs." />
            <div className="lab-runner__controls">
              <Field label="Architecture"><select value={architectureId} onChange={(event) => setArchitectureId(event.target.value as ComputerUseArchitectureId)}>{lab.architectures.map((architecture) => <option value={architecture.id} key={architecture.id}>{architecture.title}</option>)}</select></Field>
              <Field label="Environment variation"><select value={variation} onChange={(event) => setVariation(event.target.value as ComputerUseVariation)}><option value="baseline">Baseline</option><option value="changed">Changed layout</option><option value="ambiguous">Ambiguous targets</option></select></Field>
              <Button variant="secondary" disabled={busy} onClick={() => void loadScenario(scenario)}><RefreshCw size={14} /> Load app</Button>
              <Button disabled={busy} onClick={() => void runOne()}><Play size={14} /> Run simulation</Button>
            </div>
          </Card>

          <Card className="lab-live-app">
            <SectionHeading
              eyebrow="Disposable target"
              title={state.browserSandbox.state.scenarioTitle || 'No scenario loaded'}
              description={state.browserSandbox.state.goal || 'Load the selected scenario to start the isolated browser fixture.'}
              action={state.browserSandbox.url && desktop.desktop ? <Button size="small" variant="secondary" onClick={() => void openWindow()}><AppWindow size={14} /> Open as window</Button> : undefined}
            />
            {state.browserSandbox.url ? <iframe className="browser-sandbox-frame lab-live-app__frame" title="Computer-use simulation target" src={state.browserSandbox.url} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" /> : <div className="browser-sandbox-placeholder"><TerminalSquare /><strong>No fixture running</strong><span>Load the selected scenario to launch the isolated local app.</span></div>}
            <div className="browser-sandbox-boundary"><ShieldCheck size={15} /><span>{state.browserSandbox.isolation}</span></div>
          </Card>

          {latest ? <SimulationResultCard run={latest} scenario={lab.scenarios.find((candidate) => candidate.id === latest.scenarioId)} architecture={lab.architectures.find((candidate) => candidate.id === latest.architectureId)} /> : null}
        </main>
      </div>

      <Card className="lab-architecture-section">
        <SectionHeading eyebrow="Architecture extraction" title="Compare the control loops, not just the models" description="The model is one component. Planning horizon, grounding, action abstraction, memory, verification, and recovery decide whether the whole system is reliable." />
        <div className="lab-architecture-grid">
          {lab.architectures.map((architecture) => {
            const runs = lab.runs.filter((run) => run.architectureId === architecture.id)
            const average = runs.length === 0 ? null : Math.round(runs.reduce((sum, run) => sum + run.score, 0) / runs.length)
            return <article key={architecture.id} className={architecture.id === architectureId ? 'selected' : ''} onClick={() => setArchitectureId(architecture.id)}>
              <div><Pill tone={architecture.id === 'hierarchical_governed' ? 'positive' : 'neutral'}>{average === null ? 'Not run' : `${average} avg`}</Pill><h3>{architecture.title}</h3><p>{architecture.summary}</p></div>
              <dl><div><dt>Planner</dt><dd>{architecture.planner}</dd></div><div><dt>Grounding</dt><dd>{architecture.grounding}</dd></div><div><dt>Action layer</dt><dd>{architecture.actionLayer}</dd></div><div><dt>Feedback</dt><dd>{architecture.feedback}</dd></div><div><dt>Memory</dt><dd>{architecture.memory}</dd></div><div><dt>Recovery</dt><dd>{architecture.recovery}</dd></div></dl>
            </article>
          })}
        </div>
      </Card>

      <Card className="lab-insights">
        <SectionHeading eyebrow="Current synthesis" title="What the runs say about a generic business architecture" />
        <div>{lab.insights.map((insight, index) => <p key={insight}><span>{index + 1}</span>{insight}</p>)}</div>
      </Card>
    </div>
  )
}

function SimulationResultCard({ run, scenario, architecture }: { run: ComputerUseSimulationRun; scenario: ComputerUseScenario | undefined; architecture: CarveState['computerUseLab']['architectures'][number] | undefined }) {
  return <Card className={`lab-result lab-result--${run.status}`} elevated>
    <SectionHeading eyebrow="Latest trace" title={`${architecture?.title ?? humanize(run.architectureId)} · ${scenario?.title ?? humanize(run.scenarioId)}`} description={run.failureReason ?? (run.status === 'passed' ? 'The declared outcome was reached and verified.' : 'The ambiguous target was handed back safely.')} action={<Pill tone={run.status === 'passed' ? 'positive' : run.status === 'handed_off' ? 'warning' : 'danger'}>{humanize(run.status)} · {run.score}</Pill>} />
    <div className="lab-metrics"><div><span>Actions</span><strong>{run.metrics.actions}/{run.metrics.budget}</strong></div><div><span>Input events</span><strong>{run.metrics.lowLevelEvents}</strong></div><div><span>Observations</span><strong>{run.metrics.observations}</strong></div><div><span>Retries</span><strong>{run.metrics.retries}</strong></div><div><span>Verification</span><strong>{run.metrics.verificationCoverage}%</strong></div></div>
    <div className="lab-trace">{run.trace.map((entry) => <div key={entry.sequence} className={`lab-trace__entry lab-trace__entry--${entry.status}`}><span>{entry.sequence}</span><div><small>{entry.phase}{entry.objective ? ` · ${humanize(entry.objective)}` : ''}</small><strong>{entry.summary}</strong><em>{entry.observed}</em></div><code>{entry.budgetAfter} left</code></div>)}</div>
    <div className="lab-findings">{run.findings.map((finding) => <p key={finding}><BrainCircuit size={14} />{finding}</p>)}</div>
  </Card>
}

function scenarioIcon(application: ComputerUseScenario['application']) {
  if (application === 'insurance') return <ShieldCheck size={17} />
  if (application === 'research') return <Globe2 size={17} />
  if (application === 'data') return <Database size={17} />
  if (application === 'document') return <ScrollText size={17} />
  if (application === 'hr') return <UserRoundCheck size={17} />
  if (application === 'logistics') return <Workflow size={17} />
  if (application === 'legal') return <ScrollText size={17} />
  if (application === 'inventory') return <Box size={17} />
  if (application === 'quality') return <BadgeCheck size={17} />
  if (application === 'handoff') return <UserRoundCheck size={17} />
  return <TerminalSquare size={17} />
}

export function ProceduresView({ state, refresh, notify, navigate, setWorkGoal }: ViewProps) {
  const [selectedId, setSelectedId] = useState(state.procedures[0]?.procedureId ?? '')
  const [evidenceOpen, setEvidenceOpen] = useState<string | null>(null)
  const selected = state.procedures.find((item) => item.procedureId === selectedId) ?? state.procedures[0]
  const selectedTask = selected ? state.semanticMemory.entities.find((entity) => entity.kind === 'task' && entity.attributes.procedureId === selected.procedureId && entity.attributes.procedureVersion === selected.version) : undefined
  const relatedEntityIds = new Set(selectedTask ? state.semanticMemory.edges.filter((edge) => edge.fromId === selectedTask.id).map((edge) => edge.toId) : [])
  const relatedEntities = selectedTask ? [selectedTask, ...state.semanticMemory.entities.filter((entity) => relatedEntityIds.has(entity.id))] : []

  useEffect(() => {
    if (!selectedId && state.procedures[0]) setSelectedId(state.procedures[0].procedureId)
  }, [selectedId, state.procedures])

  const correct = async (correction: ProcedureCorrection) => {
    if (!selected) return
    try {
      await invoke({ kind: 'procedure.correct', procedureId: selected.procedureId, correction })
      await refresh()
      notify('A new procedure version was saved', 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    }
  }

  if (!selected) return (
    <div className="page"><PageIntro label="Saved tasks" title="Tasks you have taught Carve." description="Tasks you have taught Carve appear here. Review or edit the steps before using them again." /><Card><EmptyState icon={<Workflow />} title="No saved tasks yet" description="Show Carve how you do a task, then review the steps it learned." action={<Button onClick={() => navigate('learn')}><Radio size={16} /> Teach Carve</Button>} /></Card></div>
  )

  return (
    <div className="page">
      <PageIntro label="Saved tasks" title="Tasks you have taught Carve." description="Review what Carve learned and the saved screens that support each step." action={<Button onClick={() => { setWorkGoal(selected.goal); navigate('work') }}><Play size={16} /> Use in Work</Button>} />
      <div className="procedure-workspace">
        <aside className="procedure-picker">
          <div className="procedure-picker__title"><span>Procedures</span><Pill>{state.procedures.length}</Pill></div>
          {state.procedures.map((procedure) => <button key={`${procedure.procedureId}-${procedure.version}`} className={selected.procedureId === procedure.procedureId ? 'selected' : ''} onClick={() => setSelectedId(procedure.procedureId)}><div className="procedure-picker__icon"><ProcedureGlyph size={18} /></div><div><strong>{procedure.name}</strong><span>v{procedure.version} · {procedure.graph.steps.length} steps</span></div><ChevronDown size={15} /></button>)}
        </aside>
        <div className="procedure-detail">
          <Card className="procedure-summary" elevated>
            <div className="procedure-summary__top">
              <div><div className="eyebrow">Version {selected.version} · {ago(selected.createdAt)}</div><h2>{selected.name}</h2><p>{selected.goal}</p></div>
              <div className="procedure-summary__actions"><Pill tone={confidenceTone(selected.confidence)}>{Math.round(selected.confidence * 100)}% confidence</Pill><Button variant="secondary" size="small" onClick={() => { const name = window.prompt('Rename procedure', selected.name); if (name?.trim()) void correct({ operation: 'rename', name }) }}><Pencil size={14} /> Rename</Button></div>
            </div>
            <div className="io-grid"><div><span>Required inputs</span>{selected.inputs.map((input) => <Pill key={input} tone="info">{input}</Pill>)}</div><div><span>Expected outputs</span>{selected.outputs.map((output) => <Pill key={output} tone="positive">{output}</Pill>)}</div><div><span>Provenance</span><Pill>{selected.provenanceObservationIds.length} observations</Pill></div></div>
            {selected.parameters.length > 0 ? <div className="parameter-schema"><div><Sparkles size={17} /><div><strong>Details you can change</strong><span>Different completed demonstrations supplied different safe values.</span></div></div>{selected.parameters.map((parameter) => <div className="parameter-schema__row" key={parameter.id}><div><strong>{parameter.label}</strong><code>{parameter.id}</code></div><Pill tone="positive">{humanize(parameter.type)}</Pill><span>{parameter.constraints.minLength}–{parameter.constraints.maxLength} characters</span><span>{parameter.examples.length} evidence-backed examples</span><Pill tone={confidenceTone(parameter.confidence)}>{Math.round(parameter.confidence * 100)}%</Pill></div>)}</div> : null}
            <div className="learning-evidence-strip">
              <div><span>Completed</span><strong>{selected.evidenceSummary.completedSessionIds.length}</strong></div>
              <div><span>Interrupted</span><strong>{selected.evidenceSummary.interruptedSessionIds.length}</strong></div>
              <div><span>Quarantined</span><strong>{selected.evidenceSummary.quarantinedSessionIds.length}</strong></div>
              <div><span>Induction</span><strong>{humanize(selected.evidenceSummary.inductionMethod)}</strong></div>
              {Object.entries(selected.evidenceSummary.observedBranchValues).map(([key, values]) => <div key={key}><span>{humanize(key)} branches</span><strong>{values.join(' · ')}</strong></div>)}
            </div>
            {selected.correctionSummary ? <div className="correction-note"><UserRoundCheck size={16} /><span><strong>User correction:</strong> {selected.correctionSummary}</span></div> : null}
          </Card>

          <Card>
            <SectionHeading eyebrow="Edit the steps" title="Task steps" description="See the choices Carve can make, what each step changes, and how it checks the result." />
            <div className="workflow-canvas">
              {selected.graph.steps.map((step, index) => {
                const outgoing = selected.graph.edges.filter((edge) => edge.from === step.id)
                const isOpen = evidenceOpen === step.id
                return (
                  <div className="workflow-unit" key={step.id}>
                    <div className={`workflow-node workflow-node--${step.kind}`}>
                      <div className="workflow-node__index">{step.kind === 'decision' ? <GitBranch size={17} /> : step.kind === 'terminal' ? <Check size={17} /> : index + 1}</div>
                      <div className="workflow-node__body">
                        <div className="workflow-node__heading"><div><span>{humanize(step.kind)}</span><h3>{step.name}</h3></div><Pill tone={confidenceTone(step.confidence)}>{Math.round(step.confidence * 100)}%</Pill></div>
                        <p>{step.description}</p>
                        {step.action ? <div className="action-contract"><div><TerminalSquare size={15} /><code>{step.action.tool}</code><Pill tone={step.action.risk === 'read_only' ? 'info' : 'warning'}>{humanize(step.action.risk)}</Pill></div><span>{step.action.preview}</span><small><CheckCircle2 size={13} /> Verify: {humanize(step.action.verification.method)} → {String(step.action.verification.expected)}</small></div> : null}
                        <div className="workflow-node__controls">
                          <Button variant="ghost" size="small" onClick={() => setEvidenceOpen(isOpen ? null : step.id)}><Eye size={14} /> {isOpen ? 'Hide' : 'Show'} evidence</Button>
                          <Button variant="ghost" size="small" onClick={() => { const name = window.prompt('Step name', step.name); const description = window.prompt('Step description', step.description); if (name?.trim() || description?.trim()) void correct({ operation: 'update_step', stepId: step.id, ...(name?.trim() ? { name } : {}), ...(description?.trim() ? { description } : {}) }) }}><Pencil size={14} /> Edit</Button>
                          {step.kind === 'action' ? <Button variant="ghost" size="small" onClick={() => { const firstName = window.prompt('First step name', `${step.name} — part 1`); const secondName = window.prompt('Second step name', `${step.name} — part 2`); if (firstName?.trim() && secondName?.trim()) void correct({ operation: 'split_step', stepId: step.id, firstName, secondName }) }}><Split size={14} /> Split</Button> : null}
                          {index < selected.graph.steps.length - 1 && step.kind !== 'decision' ? <Button variant="ghost" size="small" onClick={() => { const next = selected.graph.steps[index + 1]; if (!next) return; const name = window.prompt('Merged step name', `${step.name} + ${next.name}`); if (name?.trim()) void correct({ operation: 'merge_steps', firstStepId: step.id, secondStepId: next.id, name }) }}><Merge size={14} /> Merge next</Button> : null}
                          {selected.graph.steps.length > 1 ? <Button variant="ghost" size="small" className="text-danger" onClick={() => { if (window.confirm(`Delete “${step.name}” from a new procedure version?`)) void correct({ operation: 'delete_step', stepId: step.id }) }}><Trash2 size={14} /> Delete</Button> : null}
                        </div>
                        {isOpen ? <div className="evidence-drawer"><div><strong>Observed facts</strong>{step.factBasis.length > 0 ? step.factBasis.map((fact) => <span key={fact}><Check size={13} />{fact}</span>) : <span>No explicit fact statements</span>}</div><div><strong>Model interpretation</strong>{step.interpretation.length > 0 ? step.interpretation.map((item) => <span key={item}><Sparkles size={13} />{item}</span>) : <span>No inferred interpretation</span>}</div><div><strong>Evidence IDs</strong><code>{step.evidenceObservationIds.join(', ') || 'None'}</code></div></div> : null}
                      </div>
                    </div>
                    {outgoing.length > 0 ? <div className={`workflow-edges ${outgoing.length > 1 ? 'workflow-edges--branch' : ''}`}>{outgoing.map((edge) => <div key={`${edge.from}-${edge.to}`}><span>{edge.condition ?? 'then'}</span><ArrowRight size={16} /></div>)}</div> : null}
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <SectionHeading eyebrow="Related history" title="Related concepts" description="Find related people, topics, and tasks in your saved history." />
            <div className="entity-cloud">{relatedEntities.length === 0 ? <span>No entities inferred for this version</span> : relatedEntities.map((entity) => <div className="entity-chip" key={entity.id}><Box size={15} /><div><strong>{entity.name}</strong><span>{entity.kind} · {Math.round(entity.confidence * 100)}%</span></div></div>)}</div>
          </Card>
        </div>
      </div>
    </div>
  )
}

async function dictationClipToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolvePromise, rejectPromise) => {
    const reader = new FileReader()
    reader.onerror = () => rejectPromise(new Error('Could not read the recorded audio'))
    reader.onload = () => resolvePromise(String(reader.result))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

interface DictationLiveView {
  transcript: string
  interim: string
}

/** Imperative surface a composer uses to finish an in-flight dictation and
 * take the complete field snapshot. A field-backed result is never an
 * appendable transcript delta. */
export interface DictationControl {
  active: boolean
  finish: () => Promise<DictationFinishResult | null>
}

/** Push-to-toggle streaming dictation: one click starts a live Deepgram
 * transcription — words surface through onLive while the person is still
 * speaking — and the next click finishes it and commits the final transcript
 * through onTranscript. Audio leaves in small chunks and is never stored. */
export function DictationButton({ enabled, disabled, onTranscript, onLive, controlRef, notify, field }: {
  enabled: boolean
  disabled?: boolean
  /** Final transcript, once. With `field`, the text is already in the field by the time this fires. */
  onTranscript?: (transcript: string) => void
  onLive?: (live: DictationLiveView | null) => void
  controlRef?: { current: DictationControl | null }
  notify: (message: string, tone?: Tone) => void
  /**
   * The text field this microphone dictates into. Words appear in the field
   * as they are recognised, stopping leaves them there immediately, and the
   * final pass only tidies punctuation. Without it the button falls back to
   * delivering the final transcript through `onTranscript`.
   */
  field?: { value: string; onChange: (next: string) => void }
}) {
  const [sharingOpen, setSharingOpen] = useState(false)
  const [rememberAudio, setRememberAudio] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'finalizing'>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  // The text in the field before this dictation began; live words append to it.
  const baseRef = useRef('')
  const liveRef = useRef<{ transcript: string; interim: string }>({ transcript: '', interim: '' })
  const sessionIdRef = useRef<string | null>(null)
  const fieldRef = useRef(field)
  fieldRef.current = field
  const onLiveRef = useRef(onLive)
  onLiveRef.current = onLive
  // The pending dictation's final transcript, resolvable exactly once. A
  // composer that calls finish() takes the transcript itself; otherwise it is
  // delivered through onTranscript as usual — never both.
  const finalDeferredRef = useRef<{ promise: Promise<string | null>; resolve: (text: string | null) => void } | null>(null)
  const handedOffRef = useRef(false)
  const deliveredRef = useRef(false)
  useEffect(() => () => recorderRef.current?.stream.getTracks().forEach((track) => track.stop()), [])

  const spokenSoFar = () => `${liveRef.current.transcript} ${liveRef.current.interim}`.trim()

  useEffect(() => window.stewardDesktop?.onDictationState?.((state) => {
    if (state.sessionId !== sessionIdRef.current) return
    if (state.done && recorderRef.current?.state === 'recording') recorderRef.current.stop()
    liveRef.current = { transcript: state.transcript, interim: state.interim }
    onLiveRef.current?.({ transcript: state.transcript, interim: state.interim })
    fieldRef.current?.onChange(composeDictationField(baseRef.current, `${state.transcript} ${state.interim}`))
  }), [])

  useEffect(() => {
    if (!controlRef) return
    controlRef.current = {
      active: phase === 'recording' || phase === 'starting',
      finish: async () => {
        if (deliveredRef.current || !finalDeferredRef.current) return Promise.resolve(null)
        handedOffRef.current = true
        recorderRef.current?.stop()
        // Submitting should never wait on the network: after a short grace
        // for Deepgram's tidy-up, the words already heard are the answer.
        const optimistic = spokenSoFar() || null
        const transcript = await Promise.race([
          finalDeferredRef.current.promise,
          new Promise<string | null>((resolvePromise) => setTimeout(() => resolvePromise(optimistic), 900)),
        ])
        return {
          fieldValue: fieldRef.current ? composeDictationField(baseRef.current, transcript ?? '') : null,
          transcript,
        }
      },
    }
  })
  if (!enabled) return null

  const start = async () => {
    setPhase('starting')
    baseRef.current = fieldRef.current?.value ?? ''
    liveRef.current = { transcript: '', interim: '' }
    try {
      const sharing = await invoke<{ allowed: boolean }>({ kind: 'dictation.sharing.get' })
      if (!sharing.allowed) { setSharingOpen(true); setPhase('idle'); return }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      recorderRef.current = recorder
      const type = recorder.mimeType || mimeType || 'audio/webm'
      const { sessionId } = await invoke<{ sessionId: string }>({ kind: 'dictation.stream.begin', mimeType: type })
      sessionIdRef.current = sessionId
      handedOffRef.current = false
      deliveredRef.current = false
      let resolveFinal: (text: string | null) => void = () => {}
      const finalPromise = new Promise<string | null>((resolvePromise) => { resolveFinal = resolvePromise })
      finalDeferredRef.current = { promise: finalPromise, resolve: resolveFinal }
      // Chunk pushes are chained so audio reaches the stream in order; each
      // response carries the newest transcript for the live preview.
      let chain: Promise<void> = Promise.resolve()
      let failed = false
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || failed) return
        chain = chain.then(async () => {
          if (failed) return
          try {
            const state = await invoke<{ transcript: string; interim: string; error: string | null }>({
              kind: 'dictation.stream.push',
              sessionId,
              audioBase64: await dictationClipToBase64(event.data),
            })
            if (state.error) throw new Error(state.error)
            liveRef.current = { transcript: state.transcript, interim: state.interim }
            onLive?.({ transcript: state.transcript, interim: state.interim })
            fieldRef.current?.onChange(composeDictationField(baseRef.current, spokenSoFar()))
          } catch (error) {
            failed = true
            notify(error instanceof Error ? error.message : String(error), 'danger')
            recorder.stop()
          }
        })
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        // The words heard so far stay in the field the moment recording
        // stops; the final pass below only refines them.
        setPhase('finalizing')
        const optimistic = spokenSoFar()
        if (fieldRef.current && optimistic) fieldRef.current.onChange(composeDictationField(baseRef.current, optimistic))
        void (async () => {
          try {
            await chain
            const final = await invoke<{ transcript: string; error: string | null }>({ kind: 'dictation.stream.end', sessionId })
            if (!failed) {
              if (final.error && !final.transcript) throw new Error(final.error)
              const text = final.transcript || optimistic
              if (fieldRef.current) {
                if (text) fieldRef.current.onChange(composeDictationField(baseRef.current, text))
                deliveredRef.current = true
                finalDeferredRef.current?.resolve(text || null)
                if (text) onTranscript?.(text)
                else notify('No speech was recognized.', 'warning')
              } else if (handedOffRef.current) {
                finalDeferredRef.current?.resolve(text || null)
              } else if (text) {
                deliveredRef.current = true
                onTranscript?.(text)
              } else {
                notify('No speech was recognized.', 'warning')
              }
            }
          } catch (error) {
            if (!failed) notify(error instanceof Error ? error.message : String(error), 'danger')
          } finally {
            if (sessionIdRef.current === sessionId) sessionIdRef.current = null
            finalDeferredRef.current?.resolve(null)
            finalDeferredRef.current = null
            setPhase('idle')
            onLive?.(null)
          }
        })()
      }
      recorderRef.current = recorder
      recorder.start(100)
      setPhase('recording')
      onLive?.({ transcript: '', interim: '' })
    } catch (error) {
      recorderRef.current?.stream.getTracks().forEach(track => track.stop())
      recorderRef.current = null
      setPhase('idle')
      onLive?.(null)
      notify(error instanceof Error && error.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it for Carve in System Settings → Privacy & Security → Microphone.'
        : `Could not start the microphone: ${error instanceof Error ? error.message : String(error)}`, 'danger')
    }
  }

  const recording = phase === 'recording'
  const title = phase === 'recording'
    ? 'Stop dictating. The words stay in the field.'
    : phase === 'finalizing'
      ? 'Tidying up the transcript'
      : phase === 'starting' ? 'Starting the microphone' : 'Dictate with Deepgram. Audio is sent only while recording.'
  return (
    <>
    {sharingOpen ? <Dialog title="Your voice, turned into text" description="While you record, microphone audio is sent to Deepgram for transcription. Your words appear in the field so you can review them." onDismiss={() => setSharingOpen(false)}>
      <p className="voice-sharing-note">Carve does not save the audio. Deepgram’s retention applies. Text you submit becomes part of your task.</p>
      <label className="sharing-choice"><input type="checkbox" checked={rememberAudio} onChange={event => setRememberAudio(event.target.checked)} />Remember audio sharing on this Mac</label>
      <small className="dialog__note">{rememberAudio ? 'Applies until you reset audio sharing in Settings.' : 'Allow until Carve quits. You control when the mic is on.'}</small>
      <div className="dialog__buttons"><Button type="button" disabled={phase === 'starting'} onClick={() => { setPhase('starting'); void invoke({ kind: 'dictation.sharing.set', enabled: true, remember: rememberAudio }).then(() => { setSharingOpen(false); return start() }).catch(error => { setPhase('idle'); notify(String(error), 'danger') }) }}>Allow and start dictation</Button><Button type="button" variant="ghost" onClick={() => setSharingOpen(false)}>Keep typing</Button></div>
    </Dialog> : null}
    <button
      type="button"
      className={`dictation-button dictation-button--${phase}`}
      title={title}
      aria-label={recording ? 'Stop dictation' : 'Start dictation'}
      aria-pressed={recording}
      disabled={disabled || phase === 'starting'}
      onClick={() => { if (recording) recorderRef.current?.stop(); else if (phase === 'idle' || phase === 'finalizing') void start() }}
    >
      {phase === 'recording' ? <Square size={12} fill="currentColor" /> : phase === 'starting' || phase === 'finalizing' ? <RefreshCw className="spin" size={15} /> : <Mic size={15} />}
    </button>
    </>
  )
}

const autonomyOptions: Array<{ value: AutonomyLevel; label: string; description: string; icon: ReactNode }> = [
  { value: 'observe_only', label: 'Context only', description: 'Find the relevant your history without taking action.', icon: <Eye /> },
  { value: 'preview', label: 'Plan only', description: 'Build and simulate a plan. Nothing changes.', icon: <ListChecks /> },
  { value: 'approve_plan', label: 'Approve & start', description: 'Review one bounded plan, then let Carve finish it without step-by-step window switching.', icon: <Workflow /> },
  { value: 'approve_each', label: 'Ask every step', description: 'Approve the plan, then ask before each state change.', icon: <UserRoundCheck /> },
  { value: 'approve_group', label: 'Ask by phase', description: 'Approve the plan, then approve bounded groups of actions.', icon: <Workflow /> },
  { value: 'timed_approval', label: 'Visible countdown', description: 'Eligible reversible actions run after a visible countdown.', icon: <Clock3 /> },
  { value: 'constrained_autonomous', label: 'Within policy', description: 'Approve the plan, then run only policy-allowed actions.', icon: <Zap /> },
]

const workIntentOptions: Array<{ value: WorkIntent; label: string; description: string }> = [
  { value: 'execute', label: 'Do the work', description: 'Make a plan and carry it out, checking in as often as you choose.' },
  { value: 'plan_only', label: 'Plan only', description: 'Make a plan for you to review, without carrying it out.' },
  { value: 'context_only', label: 'Context only', description: 'Gather and explain relevant history without taking action.' },
]

const supervisionOptions: Array<{ value: SupervisionPreset; label: string; description: string; icon: ReactNode }> = [
  { value: 'fast', label: 'Fast', description: 'Keep moving inside this task. Pause for consequential or unexpected changes.', icon: <Zap /> },
  { value: 'smart_checkpoints', label: 'Smart checkpoints', description: 'Show the plan and check in at meaningful phases.', icon: <Workflow /> },
  { value: 'step_by_step', label: 'Step by step', description: 'Ask before each step that changes something.', icon: <UserRoundCheck /> },
  { value: 'autopilot', label: 'Autopilot', description: 'Bypass approvals. Carve acts on its own across the work surfaces you authorize.', icon: <Gauge /> },
]

/** Pace choices a person can make; `custom` is reserved for advanced controls. */
type PaceChoice = 'fast' | 'smart_checkpoints' | 'step_by_step' | 'autopilot'

const AUTOPILOT_ACK_KEY = 'carve.autopilot.acknowledged'
function autopilotAcknowledged(): boolean {
  try { return localStorage.getItem(AUTOPILOT_ACK_KEY) === '1' } catch { return false }
}
function rememberAutopilotAcknowledged(): void {
  try { localStorage.setItem(AUTOPILOT_ACK_KEY, '1') } catch { /* ignore */ }
}

/** Effects Autopilot still stops for, mirrored from the controller's hard floor. */
const autopilotFloor = new Set(['financial', 'destructive', 'authentication', 'installation', 'privilege_escalation', 'legal_acceptance', 'confidential_disclosure', 'communication', 'high_impact_decision'])

/** The one-time Autopilot confirmation. Plain words about what changes and
 * what never changes, in the place the choice is made. */
function AutopilotConfirm({ current, onConfirm, onCancel }: { current: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="autopilot-confirm" role="group" aria-label="Turn on Autopilot">
      <div className="autopilot-confirm__head"><span><Gauge size={16} /></span><div><strong>Turn on Autopilot?</strong><small>Carve stops asking and works on its own across the work surfaces you authorize.</small></div></div>
      <ul>
        <li><Check size={13} /> Clicks, types, scrolls, searches, submits forms, and navigates without asking</li>
        <li><Check size={13} /> Resolves uncertain controls before acting; asks if it cannot</li>
        <li><ShieldCheck size={13} /> Still stops before paying, deleting, signing in, installing, changing permissions, agreeing to terms, sharing confidential data, or sending messages</li>
        <li><ShieldCheck size={13} /> Uses one foreground window at a time inside the route you authorize; Esc or ⌘⇧. stops it instantly</li>
      </ul>
      <div className="autopilot-confirm__actions">
        <Button variant="secondary" size="small" onClick={onCancel}>Keep {current}</Button>
        <Button size="small" className="button--autopilot" onClick={onConfirm}><Gauge size={14} /> Turn on Autopilot</Button>
      </div>
    </div>
  )
}

function supervisionLabel(run: WorkRun): string {
  const supervision = run.supervisionAmendments?.at(-1)?.nextPolicy ?? run.plan.supervision
  if (supervision) return supervisionOptions.find((option) => option.value === supervision.preset)?.label ?? humanize(supervision.preset)
  return autonomyOptions.find((option) => option.value === run.plan.autonomy)?.label ?? humanize(run.plan.autonomy)
}

const workBudgetOptions: Array<{ value: WorkBudgetPreset; label: string; short: string; maxActions: number; maxMinutes: number; description: string }> = [
  { value: 'quick', label: 'Quick', short: 'Small, focused tasks', maxActions: 12, maxMinutes: 5, description: 'Best for one clear lookup, update, or short handoff.' },
  { value: 'balanced', label: 'Balanced', short: 'Recommended for most work', maxActions: 30, maxMinutes: 15, description: 'Enough room for a multi-step task without letting it wander.' },
  { value: 'thorough', label: 'Thorough', short: 'Longer research and workflows', maxActions: 75, maxMinutes: 30, description: 'Use for broad research, many records, or a longer cross-app workflow.' },
]

function workBudgetOption(value: WorkBudgetPreset | undefined) {
  return workBudgetOptions.find((option) => option.value === value) ?? workBudgetOptions[1]!
}

function budgetUsageLabel(run: WorkRun): string {
  const budget = run.plan.contract?.budget
  const usage = run.budgetUsage
  if (!budget) return 'Legacy plan'
  if (!usage) return `${budget.maxActions} steps · ${budget.maxDurationMinutes} active min`
  const activeMinutes = usage.activeDurationMs < 60_000
    ? `${Math.max(1, Math.round(usage.activeDurationMs / 1000))} sec`
    : `${Math.round(usage.activeDurationMs / 60_000)} min`
  const inference = usage.modelCalls === undefined ? '' : ` · ${usage.modelCalls} AI call${usage.modelCalls === 1 ? '' : 's'}`
  return `${usage.actionsUsed} of ${budget.maxActions} steps · ${activeMinutes} active${inference}`
}

const memoryScopeOptions: Array<{ value: WorkMemoryScopeMode; label: string; description: string }> = [
  { value: 'auto', label: 'Memory: Auto', description: 'Carve searches your history and includes it only when this request actually needs it.' },
  { value: 'all', label: 'Memory: All', description: 'Every recorded session is searchable and the best matches are always included.' },
  { value: 'selected', label: 'Memory: Chosen sessions', description: 'Only the sessions you pick are searchable for this request.' },
  { value: 'none', label: 'Memory: Off', description: 'No recorded history is searched. The plan uses reviewed procedures and connected capabilities only.' },
]

/** Composer-local memory scope: what recorded history this request may draw on. */
function useMemoryScope(onScopeChange: () => void, focused = false) {
  const [mode, setMode] = useState<WorkMemoryScopeMode>(focused ? 'none' : 'auto')
  const [sessionIds, setSessionIds] = useState<string[]>([])
  const scope: WorkMemoryScope = { mode, sessionIds: mode === 'selected' ? sessionIds : [] }
  return {
    mode,
    sessionIds,
    scope,
    /** A selected scope with nothing picked cannot be submitted. */
    blocked: mode === 'selected' && sessionIds.length === 0,
    setMode: (next: WorkMemoryScopeMode) => { setMode(next); onScopeChange() },
    toggleSession: (sessionId: string) => {
      setSessionIds((current) => current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId])
      onScopeChange()
    },
  }
}

type MemoryScopeState = ReturnType<typeof useMemoryScope>

/** Native details does not dismiss itself when focus moves elsewhere. All
 * composer menus share this interaction contract so they feel like one
 * control family rather than a mix of selects and popovers. */
function useDismissibleComposerMenu(ref: { current: HTMLDetailsElement | null }) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const menu = ref.current
      if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) return
      menu.removeAttribute('open')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const menu = ref.current
      if (event.key !== 'Escape' || !menu?.open) return
      menu.removeAttribute('open')
      menu.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [ref])
}

function MemoryScopeControl({ memory }: { memory: MemoryScopeState }) {
  const selected = memoryScopeOptions.find((option) => option.value === memory.mode) ?? memoryScopeOptions[0]!
  const ref = useRef<HTMLDetailsElement | null>(null)
  useDismissibleComposerMenu(ref)
  return (
    <details className="composer-menu composer-menu--memory work-composer__memory" ref={ref}>
      <summary aria-label={`Your history: ${selected.label.replace('Memory: ', '')}`} title={selected.description}>
        <Database size={15} />
        <span><small>Your history</small><strong>{selected.label.replace('Memory: ', '')}</strong></span>
        <ChevronDown size={13} />
      </summary>
      <div className="composer-menu__panel composer-menu__panel--left">
        <header><span><Database size={16} /></span><div><strong>What should Carve remember?</strong><small>Choose which saved history this request may use.</small></div></header>
        <div className="composer-menu__options" role="radiogroup" aria-label="Your history scope">
          {memoryScopeOptions.map((option) => <button
            type="button"
            role="radio"
            aria-checked={memory.mode === option.value}
            className={memory.mode === option.value ? 'is-selected' : ''}
            key={option.value}
            onClick={() => { memory.setMode(option.value); ref.current?.removeAttribute('open') }}
          >
            <span className="composer-menu__option-mark">{memory.mode === option.value ? <Check size={13} /> : null}</span>
            <span><strong>{option.label.replace('Memory: ', '')}</strong><small>{option.description}</small></span>
          </button>)}
        </div>
        <footer><ShieldCheck size={13} /> Your history helps Carve understand the task. It does not give permission to do more.</footer>
      </div>
    </details>
  )
}

function WorkBudgetControl({ value, recommended, onChange, disabled }: { value: WorkBudgetPreset; recommended: WorkBudgetPreset; onChange: (value: WorkBudgetPreset) => void; disabled?: boolean }) {
  const selected = workBudgetOption(value)
  const ref = useRef<HTMLDetailsElement | null>(null)
  useDismissibleComposerMenu(ref)
  return (
    <details className="work-budget" ref={ref}>
      <summary aria-label={`Task limits: ${selected.label}`} aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault() }}>
        <Gauge size={15} />
        <span><small>Task limits</small><strong>{selected.label}</strong></span>
        <ChevronDown size={13} />
      </summary>
      <div className="work-budget__panel">
        <header><span><Gauge size={16} /></span><div><strong>How much room should Carve have?</strong><small>Choose how long Carve can work and how many steps it can take before asking you.</small></div></header>
        <div className="work-budget__options" role="radiogroup" aria-label="Task limits">
          {workBudgetOptions.map((option) => <button
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? 'is-selected' : ''}
            key={option.value}
            onClick={() => { onChange(option.value); ref.current?.removeAttribute('open') }}
          >
            <span><strong>{option.label}</strong>{option.value === recommended ? <em>Recommended for this task</em> : null}</span>
            <small>{option.short}</small>
            <b>{option.maxActions} steps <i>·</i> {option.maxMinutes} active min</b>
          </button>)}
        </div>
        <p>{selected.description}</p>
        <footer><ShieldCheck size={13} /> Task limits cover steps, time, and AI work. They do not change what Carve can access. Time spent waiting for you does not count.</footer>
      </div>
    </details>
  )
}

function IntentControl({ value, onChange }: { value: WorkIntent; onChange: (value: WorkIntent) => void }) {
  const selected = workIntentOptions.find((option) => option.value === value) ?? workIntentOptions[0]!
  const ref = useRef<HTMLDetailsElement | null>(null)
  useDismissibleComposerMenu(ref)
  return (
    <details className="composer-menu composer-menu--intent" ref={ref}>
      <summary aria-label={`Work intent: ${selected.label}`} title={selected.description}>
        <ListChecks size={15} />
        <span><small>Outcome</small><strong>{selected.label}</strong></span>
        <ChevronDown size={13} />
      </summary>
      <div className="composer-menu__panel composer-menu__panel--left">
        <header><span><ListChecks size={16} /></span><div><strong>What should Carve produce?</strong><small>Only “Do the work” lets Carve carry out the task.</small></div></header>
        <div className="composer-menu__options" role="radiogroup" aria-label="Work intent">
          {workIntentOptions.map((option) => <button type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'is-selected' : ''} key={option.value} onClick={() => { onChange(option.value); ref.current?.removeAttribute('open') }}>
            <span className="composer-menu__option-mark">{value === option.value ? <Check size={13} /> : null}</span>
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </button>)}
        </div>
        <footer><LockKeyhole size={13} /> Context and plan-only requests never create computer-input authority.</footer>
      </div>
    </details>
  )
}

function SupervisionControl({ value, onChange, disabled = false, earned = null }: { value: SupervisionPreset; onChange: (value: SupervisionPreset) => void; disabled?: boolean; earned?: { preset: SupervisionPreset; reason: string | null } | null }) {
  const selected = supervisionOptions.find((option) => option.value === value) ?? supervisionOptions[1]!
  const ref = useRef<HTMLDetailsElement | null>(null)
  const [confirming, setConfirming] = useState(false)
  useDismissibleComposerMenu(ref)
  const choose = (preset: SupervisionPreset) => {
    if (preset === 'autopilot' && !autopilotAcknowledged()) { setConfirming(true); return }
    onChange(preset)
    ref.current?.removeAttribute('open')
  }
  return (
    <details className="composer-menu composer-menu--supervision" data-preset={value} ref={ref}>
      <summary aria-label={`Supervision: ${selected.label}`} aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault() }} title={selected.description}>
        <ShieldCheck size={15} />
        <span><small>Supervision</small><strong>{selected.label}</strong></span>
        <ChevronDown size={13} />
      </summary>
      <div className="composer-menu__panel composer-menu__panel--right composer-menu__panel--supervision">
        <header><span><ShieldCheck size={16} /></span><div><strong>How should Carve check in?</strong><small>Choose how often Carve should ask before taking the next step.</small></div></header>
        {confirming ? <AutopilotConfirm current={selected.label} onCancel={() => setConfirming(false)} onConfirm={() => { rememberAutopilotAcknowledged(); setConfirming(false); onChange('autopilot'); ref.current?.removeAttribute('open') }} /> : <div className="composer-menu__options composer-menu__options--supervision" role="radiogroup" aria-label="Supervision mode">
          {supervisionOptions.map((option) => <button
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`${value === option.value ? 'is-selected' : ''} ${option.value === 'autopilot' ? 'composer-menu__option--autopilot' : ''}`}
            key={option.value}
            onClick={() => choose(option.value)}
          >
            <span className="composer-menu__option-icon">{option.icon}</span>
            <span><strong>{option.label}{earned?.preset === option.value ? <em className="composer-menu__option-earned" title={earned.reason ?? undefined}>Earned</em> : option.value === 'smart_checkpoints' && !earned ? <em>Recommended</em> : null}</strong><small>{option.description}</small></span>
            <span className="composer-menu__option-mark">{value === option.value ? <Check size={13} /> : null}</span>
          </button>)}
        </div>}
        <footer><LockKeyhole size={13} /> {value === 'autopilot' ? 'Autopilot still stops before payments, deletions, sign-ins, installs, permissions, terms, confidential data, and messages.' : 'Protected, unknown, or out-of-plan actions still stop in every pace.'}</footer>
      </div>
    </details>
  )
}

/** Shown only for the `selected` mode: the explicit allowlist of sessions. */
function MemorySessionPicker({ memory, sessions }: { memory: MemoryScopeState; sessions: LearningSession[] }) {
  if (memory.mode !== 'selected') return null
  return (
    <div className="memory-session-picker">
      <div className="memory-session-picker__head"><Database size={14} /><span>Sessions this request may use</span><small>{memory.sessionIds.length} of {sessions.length} selected</small></div>
      {sessions.length === 0
        ? <p className="memory-session-picker__empty">No recorded sessions yet. Teach Carve a workflow first, or switch memory back to Auto.</p>
        : <div className="memory-session-picker__list">{sessions.map((session) => <label key={session.id} className={memory.sessionIds.includes(session.id) ? 'selected' : ''}>
          <input type="checkbox" checked={memory.sessionIds.includes(session.id)} onChange={() => memory.toggleSession(session.id)} />
          <span><strong>{session.name}</strong><small>{dateTime.format(new Date(session.startedAt))}</small></span>
        </label>)}</div>}
      {memory.blocked ? <p className="memory-session-picker__note"><ShieldCheck size={13} /> Pick at least one session, or choose a different memory setting.</p> : null}
    </div>
  )
}

/** Human-readable disclosure of the memory decision bound to a receipt. */
function memoryReceiptLabel(memory: WorkContextMemoryReceipt): { title: string; detail: string } {
  if (memory.reason === 'memory_off') return { title: 'Your history off', detail: 'No recorded history was searched for this request.' }
  if (memory.reason === 'auto_not_needed') return { title: 'Your history set aside', detail: 'Memory was searched, but this request stands on its own, so none was included.' }
  if (memory.reason === 'auto_used') return { title: 'Your history · auto', detail: 'Relevant recorded history was included automatically.' }
  if (memory.reason === 'all_memory') return { title: 'All your history', detail: 'Every recorded session was searchable for this request.' }
  return memory.resolvedSessionIds.length === 0
    ? { title: 'Selected sessions unavailable', detail: 'None of the chosen sessions exist any more, so no history was searched.' }
    : { title: `${memory.resolvedSessionIds.length} selected session${memory.resolvedSessionIds.length === 1 ? '' : 's'}`, detail: 'Only the sessions you chose were searchable for this request.' }
}

export function WorkView({ state, refresh, notify, navigate, workGoal, setWorkGoal, freshWorkRequestId }: ViewProps) {
  const [intent, setIntent] = useState<WorkIntent>('execute')
  const [pace, setPace] = useState<SupervisionPreset>('smart_checkpoints')
  const supervision = supervisionPreset(pace)
  const autonomy = legacyAutonomyFor(intent, supervision)
  const [providerId, setProviderId] = useState(state.providers.find((provider) => provider.active)?.id ?? 'mock')
  const [busy, setBusy] = useState(false)
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({})
  const [preparation, setPreparation] = useState<WorkPreparation | null>(null)
  const [dictationLive, setDictationLive] = useState<DictationLiveView | null>(null)
  const memory = useMemoryScope(() => setPreparation(null), isCopilot(state.product))
  const dictationControl = useRef<DictationControl | null>(null)
  const parameterProcedure = useMemo(() => state.procedures
    .filter((procedure) => procedure.parameters.length > 0)
    .map((procedure) => ({ procedure, score: Math.max(goalMatchScore(workGoal, procedure.goal), goalMatchScore(workGoal, procedure.name)) }))
    .filter((candidate) => candidate.score >= 0.3)
    .sort((left, right) => right.score - left.score)[0]?.procedure, [state.procedures, workGoal])
  const requiredParameters = parameterProcedure?.parameters ?? []
  const missingRequiredParameter = requiredParameters.some((parameter) => parameter.required && !parameterValues[parameter.id]?.trim())
  const activeParameterValues = Object.fromEntries(requiredParameters.flatMap((parameter) => parameterValues[parameter.id] === undefined ? [] : [[parameter.id, parameterValues[parameter.id]!]]))
  // A fresh Work visit stays prompt-first. Only in-flight work is resumed
  // automatically; unstarted proposals are shown in the turn that created them.
  const existingRun = selectWorkRunForEntry(state.runs, state.liveComputer.session, freshWorkRequestId === null ? 'resume' : 'fresh')
  const preparedRun = preparation?.run ? state.runs.find((run) => run.id === preparation.run?.id) ?? preparation.run : null
  const currentRun = preparation ? preparedRun : existingRun
  const context = preparation?.context ?? currentRun?.plan.context ?? null
  const pendingApproval = currentRun ? state.approvals.find((approval) => approval.runId === currentRun.id && approval.status === 'pending') : undefined
  const suggestions = state.procedures.slice(0, 3).map((procedure) => procedure.goal)

  useEffect(() => {
    const active = state.providers.find((provider) => provider.active)
    if (active) setProviderId(active.id)
  }, [state.providers])

  // A follow-up asked from the desktop completion capsule starts a new live
  // contract behind this view's back. When the active live session belongs to
  // a different run than the locally prepared one, that preparation is stale —
  // release it so the view binds to the session that actually needs review.
  useEffect(() => {
    if (livePreparationSuperseded(preparation?.run, state.liveComputer.session, state.runs)) setPreparation(null)
  }, [preparation, state.liveComputer.session, state.runs])

  const doTask = async (task: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try {
      await task()
      await refresh()
      if (success) notify(success, 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const prepareWork = async (goalOverride?: string) => {
    const goal = (goalOverride ?? workGoal).trim()
    if (!goal || busy || missingRequiredParameter) return
    setBusy(true)
    try {
      const result = await invoke<WorkPreparation>({ kind: 'work.prepare', goal, autonomy, intent, supervision, providerId, parameterValues: activeParameterValues, memory: memory.scope })
      setPreparation(result)
      await refresh()
      notify(result.run ? 'Context assembled and plan ready for review' : 'Context assembled; Carve needs a reviewed procedure', result.run ? 'positive' : 'warning')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(false)
    }
  }

  // Pressing Send mid-dictation finishes the recording and submits the goal
  // with the flushed transcript included — no second mic tap required.
  const submitComposer = async () => {
    let goal = workGoal
    if (dictationControl.current?.active) {
      const result = await dictationControl.current.finish()
      goal = dictatedSubmissionValue(goal, result)
      setWorkGoal(goal)
      setPreparation(null)
    }
    await prepareWork(goal)
  }
  const runAction = (run: WorkRun, action: 'start' | 'stop') => doTask(async () => invoke({ kind: 'run.action', runId: run.id, action }), action === 'start' ? 'Task started' : 'Task stopped')
  const approvalAction = (approvalId: string, action: 'approve' | 'cancel') => doTask(async () => invoke({ kind: 'approval.action', approvalId, action }), action === 'approve' ? 'Exact action approved' : 'Approval cancelled')
  const recoveryAction = (run: WorkRun, action: 'create' | 'dismiss') => doTask(
    async () => invoke({ kind: 'recovery.action', runId: run.id, action, providerId }),
    action === 'create' ? 'Fresh recovery plan created for review' : 'Recovery proposal dismissed',
  )

  return (
    <div className="page page--work">
      <PageIntro label="Work" title="What should Carve do?" description="Describe the outcome. Carve will find the relevant history, propose a plan, and wait at the boundary you choose." action={currentRun && ['running', 'awaiting_approval', 'awaiting_guidance'].includes(currentRun.status) ? <Button variant="danger" onClick={() => void runAction(currentRun, 'stop')}><Square size={14} fill="currentColor" /> Stop work</Button> : undefined} />

      <form className={`work-composer ${busy ? 'work-composer--busy' : ''}`} onSubmit={(event) => { event.preventDefault(); void submitComposer() }}>
        <textarea
          rows={3}
          value={workGoal}
          onChange={(event) => { setWorkGoal(event.target.value); setPreparation(null) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submitComposer()
            }
          }}
          aria-label="Describe the work for Carve"
          placeholder="Triage the payment flow I recorded last week…"
        />
        <div className="work-composer__footer">
          {!isCopilot(state.product) ? <MemoryScopeControl memory={memory} /> : null}
          <IntentControl value={intent} onChange={(value) => { setIntent(value); setPreparation(null) }} />
          <SupervisionControl value={pace} disabled={intent !== 'execute'} onChange={(value) => { setPace(value); setPreparation(null) }} />
          <DictationButton
            enabled={state.dictation.configured}
            disabled={busy}
            notify={notify}
            onLive={setDictationLive}
            controlRef={dictationControl}
            field={{ value: workGoal, onChange: (next) => { setWorkGoal(next); setPreparation(null) } }}
          />
          <Button className="work-composer__submit" type="submit" aria-label="Find context and make a plan" disabled={(!workGoal.trim() && !dictationLive) || busy || missingRequiredParameter || memory.blocked}>
            {busy ? <RefreshCw className="spin" size={17} /> : <ArrowRight size={17} />}
          </Button>
        </div>
        {!isCopilot(state.product) ? <MemorySessionPicker memory={memory} sessions={state.sessions} /> : null}
        {dictationLive ? <div className="work-composer__activity work-composer__dictation"><span /><span>{[dictationLive.transcript, dictationLive.interim].filter(Boolean).join(' ') || 'Listening…'}</span></div> : null}
        {busy ? <div className="work-composer__activity"><span /><span>Reading prior sessions and building a bounded plan…</span></div> : null}
      </form>

      {!context && !currentRun ? <div className="work-suggestions"><span>Try asking</span>{(suggestions.length > 0 ? suggestions : ['Triage the payment flow I recorded last week', 'Prepare the current customer handoff']).map((suggestion) => <button type="button" key={suggestion} onClick={() => { setWorkGoal(suggestion); setPreparation(null) }}>{suggestion}</button>)}</div> : null}

      {requiredParameters.length > 0 ? <Card className="parameter-composer"><SectionHeading eyebrow="Task details" title="What should be different this time?" description="Fill in the details for this task. You can review them before Carve starts." /><div className="parameter-inputs">{requiredParameters.map((parameter) => <Field key={parameter.id} label={parameter.label} hint={`${parameter.constraints.minLength}–${parameter.constraints.maxLength} characters · do not enter passwords or secrets`}><input value={parameterValues[parameter.id] ?? ''} maxLength={parameter.constraints.maxLength} onChange={(event) => setParameterValues((current) => ({ ...current, [parameter.id]: event.target.value }))} placeholder={parameter.examples[0] ? `New value; example: ${parameter.examples[0]}` : 'Enter a value for this task'} /></Field>)}</div><div className="parameter-examples"><ShieldCheck size={15} /><span>{requiredParameters.map((parameter) => `${parameter.examples.length} demonstrated values support ${parameter.label}`).join(' · ')}</span></div></Card> : null}

      {context ? <WorkStages context={context} run={currentRun} /> : null}
      {context ? <WorkContextPanel context={context} blocker={preparation?.blocker ?? null} onRecall={() => navigate('recall')} onTeach={() => navigate('learn')} /> : null}
      {currentRun ? <RunPanel run={currentRun} pendingApproval={pendingApproval} busy={busy} onStart={() => void runAction(currentRun, 'start')} onStop={() => void runAction(currentRun, 'stop')} onApproval={(action) => pendingApproval && void approvalAction(pendingApproval.id, action)} onRecovery={(action) => void recoveryAction(currentRun, action)} /> : context ? null : <Card><EmptyState icon={<EmployeeGlyph size={26} />} title="Ready for a goal" description="Type naturally. Carve will search prior sessions and procedures before it proposes anything." /></Card>}

    </div>
  )
}

function WorkStages({ context, run }: { context: WorkContextSummary; run: WorkRun | null }) {
  const workActive = run ? ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status) : false
  const workComplete = run ? ['completed', 'previewed', 'cancelled', 'blocked', 'failed'].includes(run.status) : false
  const stages = [
    { label: 'Context', detail: `${context.sessions.length + context.moments.length} sources`, state: 'complete' },
    { label: 'Plan', detail: run ? `${run.plan.actions.length} actions` : 'Not ready', state: run ? 'complete' : context.readiness === 'needs_procedure' ? 'blocked' : 'pending' },
    { label: 'Approval', detail: run?.status === 'planned' ? 'Your review' : run?.status === 'awaiting_approval' ? 'Action waiting' : run ? 'Policy applied' : 'Pending', state: run?.status === 'planned' || run?.status === 'awaiting_approval' ? 'active' : run ? 'complete' : 'pending' },
    { label: 'Work', detail: workActive ? 'In progress' : workComplete ? humanize(run?.status ?? '') : 'Not started', state: workActive ? 'active' : workComplete ? 'complete' : 'pending' },
  ]
  return <ol className="work-stages" aria-label="Work progress">{stages.map((stage, index) => <li className={`work-stages__item work-stages__item--${stage.state}`} key={stage.label}><span>{stage.state === 'complete' ? <Check size={14} /> : index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>)}</ol>
}

function WorkContextPanel({ context, blocker, onRecall, onTeach }: { context: WorkContextSummary; blocker: string | null; onRecall: () => void; onTeach: () => void }) {
  return (
    <Card className="work-context" elevated>
      <div className="work-context__head">
        <div className="work-context__icon"><Search size={20} /></div>
        <div><div className="eyebrow">Context Carve found</div><h2>{context.procedure ? context.procedure.name : context.moments.length > 0 ? 'Related work, but no executable procedure' : 'No strong match yet'}</h2><p>{context.timeWindow.label ? `Interpreted the request within ${context.timeWindow.label}. ` : ''}{context.procedure ? `Matched a reviewed procedure at ${Math.round(context.procedure.retrievalScore * 100)}% relevance.` : 'The request was searched across recorded your history.'}</p></div>
        <Pill tone={context.readiness === 'ready' ? 'positive' : 'warning'}>{context.readiness === 'ready' ? 'Ready to plan' : 'Needs teaching'}</Pill>
      </div>

      <div className="work-context__sources">
        {context.procedure ? <div className="work-context__source work-context__source--procedure"><ProcedureGlyph size={18} /><div><small>Executable procedure · v{context.procedure.version}</small><strong>{context.procedure.goal}</strong><span>{Math.round(context.procedure.confidence * 100)}% learned confidence · {context.procedure.evidenceObservationCount} evidence records</span></div><CheckCircle2 size={17} /></div> : null}
        {context.sessions.slice(0, 3).map((session) => <div className="work-context__source" key={session.id}><Clock3 size={18} /><div><small>{session.relation === 'history_match' ? 'Related session' : session.relation === 'procedure_evidence' ? 'Procedure evidence' : 'Procedure evidence + history match'}</small><strong>{session.name}</strong><span>{dateTime.format(new Date(session.startedAt))}{context.timeWindow.label ? session.matchesTimeWindow ? ' · inside requested window' : ' · outside requested window' : ''}</span></div>{session.matchesTimeWindow ? <Check size={16} /> : null}</div>)}
        {context.moments.slice(0, 3).map((moment) => <div className="work-context__source" key={moment.id}><AppWindow size={18} /><div><small>Related history · {moment.app}</small><strong>{moment.title}</strong><span>{ago(moment.occurredAt)} · context only</span></div></div>)}
        {context.memory ? <div className="work-context__source" key="memory-scope"><Database size={18} /><div><small>Memory scope</small><strong>{memoryReceiptLabel(context.memory).title}</strong><span>{memoryReceiptLabel(context.memory).detail}</span></div></div> : null}
      </div>

      <div className="work-context__boundary"><ShieldCheck size={16} /><span><strong>Authority boundary:</strong> related history can explain the request, but only {context.procedure ? 'the reviewed procedure above' : 'a reviewed procedure'} can create actions.</span></div>
      {blocker ? <div className="work-context__blocker"><AlertTriangle size={19} /><div><strong>Carve will not improvise this workflow</strong><p>{blocker}</p></div><div><Button variant="secondary" onClick={onRecall}>Review context</Button><Button onClick={onTeach}><Radio size={15} /> Teach workflow</Button></div></div> : null}
    </Card>
  )
}

function RunPanel({ run, pendingApproval, busy, onStart, onStop, onApproval, onRecovery }: { run: WorkRun; pendingApproval: CarveState['approvals'][number] | undefined; busy: boolean; onStart: () => void; onStop: () => void; onApproval: (action: 'approve' | 'cancel') => void; onRecovery: (action: 'create' | 'dismiss') => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!pendingApproval?.expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [pendingApproval?.expiresAt])
  const countdown = pendingApproval?.expiresAt ? Math.max(0, new Date(pendingApproval.expiresAt).getTime() - now) : null
  const completed = run.plan.actions.filter((action) => action.status === 'verified').length
  const statusTone: Tone = run.status === 'completed' || run.status === 'previewed' ? 'positive' : run.status === 'blocked' || run.status === 'failed' ? 'danger' : ['awaiting_approval', 'awaiting_guidance'].includes(run.status) ? 'warning' : run.status === 'running' ? 'accent' : 'neutral'

  return (
    <div className="run-stack">
      <Card className="run-summary" elevated>
        <div className="run-summary__heading"><div><div className="eyebrow">Proposed plan</div><h2>{run.plan.goal}</h2></div><Pill tone={statusTone} icon={run.status === 'running' ? <Activity size={13} /> : undefined}>{humanize(run.status)}</Pill></div>
        <div className="run-metadata"><span><ProcedureGlyph size={15} /> Procedure v{run.plan.procedureVersion}</span><span><Search size={15} /> {Math.round(run.plan.retrievalScore * 100)}% retrieval match</span><span><ShieldCheck size={15} /> {humanize(run.plan.autonomy)}</span></div>
        <details className="run-rationale"><summary>Why this plan? <ChevronDown size={14} /></summary><p>{run.plan.rationale}</p></details>
        {Object.keys(run.plan.parameterValues).length > 0 ? <div className="bound-parameters">{Object.entries(run.plan.parameterValues).map(([key, value]) => <span key={key}><small>{humanize(key)}</small><strong>{value}</strong></span>)}</div> : null}
        <div className="run-progress"><span style={{ width: `${run.plan.actions.length === 0 ? 0 : (completed / run.plan.actions.length) * 100}%` }} /></div>
        <div className="run-summary__footer"><span>{completed} of {run.plan.actions.length} actions verified</span><div>{run.status === 'planned' ? <Button onClick={onStart} disabled={busy}><Play size={16} /> {run.plan.autonomy === 'observe_only' ? 'Finish context review' : run.plan.autonomy === 'preview' ? 'Preview plan' : 'Approve plan & start'}</Button> : ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status) ? <Button variant="danger" onClick={onStop}><Square size={14} fill="currentColor" /> Stop</Button> : null}</div></div>
      </Card>

      {pendingApproval ? (
        <Card className="approval-sheet">
          <div className="approval-sheet__icon"><UserRoundCheck /></div>
          <div className="approval-sheet__content"><div className="eyebrow">Approval required · {pendingApproval.kind}</div><h2>{pendingApproval.preview}</h2><p>Your approval is bound to a hash of this exact action. Any material change invalidates it.</p>{countdown !== null ? <div className="countdown"><div className="countdown__ring" style={{ '--progress': `${Math.min(100, countdown / 50)}%` } as React.CSSProperties}><strong>{(countdown / 1000).toFixed(1)}</strong><span>seconds</span></div><p>This reversible sandbox action executes when the timer reaches zero unless you cancel. Sensitive actions never use countdown consent.</p></div> : null}</div>
          <div className="approval-sheet__actions"><Button variant="secondary" onClick={() => onApproval('cancel')}><X size={16} /> Cancel</Button><Button onClick={() => onApproval('approve')}><Check size={16} /> Allow this action</Button></div>
        </Card>
      ) : null}

      {run.recoveryProposal?.status === 'proposed' ? (
        <Card className="recovery-sheet">
          <div className="recovery-sheet__icon"><RefreshCw /></div>
          <div className="recovery-sheet__content"><div className="eyebrow">State drift detected</div><h2>Review a fresh plan</h2><p>{run.recoveryProposal.reason}</p><div className="recovery-state">{Object.entries(run.recoveryProposal.observedState).filter(([, value]) => value !== '' && value !== null).slice(0, 6).map(([key, value]) => <span key={key}><small>{humanize(key)}</small><strong>{String(value)}</strong></span>)}</div><small>Carve will preserve {humanize(run.recoveryProposal.autonomy)} autonomy and create a new planned run. Nothing resumes automatically.</small></div>
          <div className="approval-sheet__actions"><Button variant="secondary" disabled={busy} onClick={() => onRecovery('dismiss')}><X size={16} /> Dismiss</Button><Button disabled={busy} onClick={() => onRecovery('create')}><RefreshCw size={16} /> Create fresh plan</Button></div>
        </Card>
      ) : null}

      <Card>
        <SectionHeading eyebrow="Proposed actions" title="Review the steps" description="See what will change and how Carve will check that it worked." />
        <div className="action-list">{run.plan.actions.length === 0 ? <EmptyState icon={<ListChecks />} title="No executable actions" description="The selected path contains no tool actions." /> : run.plan.actions.map((action, index) => <div className={`action-row action-row--${action.status}`} key={action.id}><div className="action-row__status">{action.status === 'verified' ? <Check size={15} /> : action.status === 'executing' ? <Activity size={15} /> : action.status === 'blocked' || action.status === 'failed' ? <X size={15} /> : <span>{index + 1}</span>}</div><div className="action-row__body"><div><code>{action.tool}</code><Pill tone={action.risk === 'read_only' ? 'info' : action.risk === 'safe' ? 'positive' : 'warning'}>{humanize(action.risk)}</Pill><Pill>{humanize(action.status)}</Pill></div><strong>{action.preview}</strong><span>{action.expectedStateChange}</span><small><CheckCircle2 size={13} /> Verify {humanize(action.verification.method)}: {action.verification.target} = {String(action.verification.expected)}</small></div></div>)}</div>
        <PublicLookupReceipts runId={run.id} lookups={run.liveComputerCheckpoint?.ledger?.publicLookups} />
        {run.result ? <div className={`run-result run-result--${statusTone}`}><strong>{run.status === 'completed' ? 'Completed' : run.status === 'previewed' ? 'Preview complete' : humanize(run.status)}</strong>{run.publicLookup && run.status === 'completed' ? <PublicLookupAnswer runId={run.id} evidence={run.publicLookup} /> : <span>{run.result}</span>}</div> : null}
      </Card>
    </div>
  )
}

/**
 * The active Work experience: evidence-backed delegation rather than a generic
 * task runner. Existing executor and approval controls remain the authority;
 * this surface makes their operating contract and proof legible.
 */
/** Terminal runs (or any run that produced a result), newest first — the
 * console's browsable past. Unstarted `planned` drafts are noise, not history. */
function selectWorkHistory(runs: WorkRun[], currentRunId: string | null): WorkRun[] {
  return runs.filter((run) => run.id !== currentRunId
    && (['completed', 'failed', 'blocked', 'cancelled'].includes(run.status) || run.result !== null))
}

function workHistoryTone(status: WorkRun['status']): Tone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'blocked') return 'danger'
  if (status === 'cancelled') return 'neutral'
  return 'info'
}

/**
 * Past requests and their results. History is a browsing and continuation
 * surface: one entry expands to the full exchange, and a follow-up starts a
 * fresh contract that carries the earlier request and result as context —
 * context resolves references; it never widens authority.
 */
function WorkHistorySection({ history, progress, busy, onFollowUp, onReuse }: {
  history: WorkRun[]
  progress?: CarveState['workProgress']
  busy: boolean
  onFollowUp: (previous: WorkRun, question: string) => void
  onReuse: (run: WorkRun) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [visible, setVisible] = useState(5)
  if (history.length === 0) return null
  return (
    <section className="work-history" aria-label="Previous requests">
      <div className="work-history__heading">
        <div><span>History</span><small>{history.length} request{history.length === 1 ? '' : 's'}</small></div>
        <small>Select a request to see its complete result</small>
      </div>
      <ul className="work-history__list">
        {history.slice(0, visible).map((run) => {
          const savedProgress = progress?.find(record => record.taskId === run.id)
          const expanded = run.id === expandedId
          const tone = workHistoryTone(run.status)
          const mode = autonomyOptions.find((option) => option.value === run.plan.autonomy)?.label ?? humanize(run.plan.autonomy)
          const rawOutcome = run.result ?? run.outcome?.reason ?? `${humanize(run.status)} before a result was recorded.`
          const outcome = run.result ? cleanCompletionResultText(rawOutcome, 12_000, true) ?? rawOutcome : rawOutcome
          const outcomeLines = outcome.split(/\r?\n/u)
          const tabularPreviewRows = outcomeLines.length >= 2 && outcomeLines.slice(0, 2).every((line) => line.includes('\t'))
            ? outcomeLines.slice(0, 2).map((line) => line.split('\t').slice(0, 3))
            : null
          return (
            <li key={run.id} className={`work-history__entry work-history__entry--${tone}${expanded ? ' work-history__entry--expanded' : ''}`}>
              <article>
                <header className="work-history__entry-head">
                  <div className="work-history__status">
                    <span className={`work-history__dot work-history__dot--${tone}`} aria-hidden />
                    <span>{humanize(run.status)}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={run.createdAt} title={dateTime.format(new Date(run.createdAt))}>{ago(run.createdAt)}</time>
                  </div>
                  <button
                    type="button"
                    className="work-history__toggle"
                    aria-expanded={expanded}
                    aria-controls={`work-history-detail-${run.id}`}
                    onClick={() => { setExpandedId(expanded ? null : run.id); setQuestion('') }}
                  >
                    {expanded ? 'Hide result' : 'View full result'} <ChevronDown size={14} className={expanded ? 'rotate' : ''} />
                  </button>
                </header>
                <button
                  type="button"
                  className="work-history__request"
                  aria-expanded={expanded}
                  aria-controls={`work-history-detail-${run.id}`}
                  aria-label={`${expanded ? 'Hide result for' : 'View full result for'} request: ${run.plan.goal}`}
                  onClick={() => { setExpandedId(expanded ? null : run.id); setQuestion('') }}
                >
                  <span className="work-history__request-label">You asked</span>
                  <strong>{run.plan.goal}</strong>
                </button>
                {!expanded ? (
                  <button
                    type="button"
                    className={`work-history__preview${tabularPreviewRows ? ' work-history__preview--tabular' : ''}`}
                    aria-label={`View full result for request: ${run.plan.goal}`}
                    onClick={() => { setExpandedId(run.id); setQuestion('') }}
                  >
                    <span className={`work-history__preview-icon work-history__preview-icon--${tone}`}>{tone === 'positive' ? <Check size={14} /> : tone === 'danger' ? <AlertTriangle size={14} /> : <Sparkles size={14} />}</span>
                    <span className="work-history__preview-copy">
                      <small>{run.result ? 'Carve’s result' : 'Current outcome'}</small>
                      {tabularPreviewRows ? (
                        <span className="work-history__preview-table" aria-hidden>
                          {tabularPreviewRows.map((cells, rowIndex) => (
                            <span className={`work-history__preview-row${rowIndex === 0 ? ' work-history__preview-row--head' : ''}`} key={rowIndex}>
                              {cells.map((cell, cellIndex) => <span key={cellIndex} title={cell}>{cell}</span>)}
                            </span>
                          ))}
                        </span>
                      ) : <p>{outcome}</p>}
                    </span>
                    <span className="work-history__preview-action">Open <ArrowRight size={14} aria-hidden /></span>
                  </button>
                ) : null}
                {expanded ? (
                  <div className="work-history__detail" id={`work-history-detail-${run.id}`}>
                    {savedProgress ? <div className="work-history__meta"><div><small>Saved task progress · reported by Carve</small>
                      <p>{savedProgress.attempts.length} work session{savedProgress.attempts.length === 1 ? '' : 's'} recorded. {savedProgress.decision?.reason}</p>
                      {savedProgress.remaining.length ? <><small>Remaining work</small><ul>{savedProgress.remaining.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
                    </div></div> : null}
                    <div className={`work-history__result work-history__result--${tone}${tabularPreviewRows ? ' work-history__result--structured' : ''}`}>
                      <div className="work-history__result-head">
                        {tone === 'positive' ? <CheckCircle2 size={17} /> : tone === 'danger' ? <AlertTriangle size={17} /> : <Sparkles size={17} />}
                        <div><small>{run.result ? 'Carve’s result' : 'How it ended'}</small><strong>{run.result ? 'Complete result' : 'No result was recorded'}</strong></div>
                      </div>
                      <p>{run.publicLookup && run.status === 'completed' ? <PublicLookupAnswer runId={run.id} evidence={run.publicLookup} /> : outcome}</p>
                    </div>
                    <PublicLookupReceipts runId={run.id} lookups={run.liveComputerCheckpoint?.ledger?.publicLookups} />
                    <div className="work-history__meta">
                      <div><small>Requested</small><span>{dateTime.format(new Date(run.createdAt))}</span></div>
                      <div><small>Supervision</small><span>{mode}</span></div>
                      <div><small>Task limits</small><span>{workBudgetOption(run.plan.contract?.budget?.preset).label} · {budgetUsageLabel(run)}</span></div>
                      {run.outcome?.terminalCategory ? <div><small>How it ended</small><span>{humanize(run.outcome.terminalCategory)}</span></div> : null}
                      <button type="button" onClick={() => onReuse(run)}><RefreshCw size={14} /> Run again</button>
                    </div>
                    <form className="work-history__follow-up" onSubmit={(event) => { event.preventDefault(); if (question.trim()) onFollowUp(run, question.trim()) }}>
                      <div className="work-history__follow-up-label"><CornerDownRight size={15} aria-hidden /><span><strong>Continue this request</strong><small>Carve will keep the request and result as context.</small></span></div>
                      <div className="work-history__follow-up-field">
                        <input
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          placeholder="Ask a follow-up…"
                          aria-label="Follow-up question"
                        />
                        <Button type="submit" disabled={!question.trim() || busy}>Ask <ArrowRight size={14} /></Button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </article>
            </li>
          )
        })}
      </ul>
      {history.length > visible ? (
        <button type="button" className="work-history__more" onClick={() => setVisible((current) => current + 10)}>
          Show {Math.min(10, history.length - visible)} earlier request{Math.min(10, history.length - visible) === 1 ? '' : 's'} <ChevronDown size={13} />
        </button>
      ) : null}
    </section>
  )
}

export function DelegationWorkView(props: ViewProps) {
  const task = props.state.liveComputer.applicationHandoff
  const revision = props.state.liveComputer.handoffRevision
  if (task && revision && ['awaiting_consent', 'awaiting_budget', 'opening', 'paused', 'failed'].includes(task.status)) return <ApplicationHandoffReview task={task} revision={revision} refresh={props.refresh} notify={props.notify} />
  return <DelegationWorkViewContent {...props} />
}

function DelegationWorkViewContent({ focusedWorkRunId, state, desktop, refresh, notify, navigate, workGoal, setWorkGoal, freshWorkRequestId, freshWorkBudget, freshWorkSourceTarget, consumeFreshWorkRequest }: ViewProps) {
  const [intent, setIntent] = useState<WorkIntent>('execute')
  const [pace, setPace] = useState<SupervisionPreset>('smart_checkpoints')
  const supervision = supervisionPreset(isCopilot(state.product) ? approvalPreference(state.liveComputer.assistance?.approvalPreset) : pace)
  // Fewer interruptions: a workflow the person has accepted a lighter pace for
  // starts at that pace. The chooser stays visible, so any request can
  // tighten it again.
  const [earned, setEarned] = useState<{ preset: SupervisionPreset; reason: string | null } | null>(null)
  useEffect(() => {
    if (isCopilot(state.product)) return
    const goal = workGoal.trim()
    if (!goal) { setEarned(null); return undefined }
    const timer = setTimeout(() => {
      void invoke<{ preset: SupervisionPreset; earned: boolean; reason: string | null }>({ kind: 'autonomy.recommend', goal })
        .then((recommendation) => {
          if (!recommendation.earned) { setEarned(null); return }
          setEarned({ preset: recommendation.preset, reason: recommendation.reason })
          setPace(recommendation.preset)
        })
        .catch(() => setEarned(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [workGoal])
  const [budget, setBudget] = useState<WorkBudgetPreset>(isCopilot(state.product) ? 'quick' : 'balanced')
  const [budgetManuallySelected, setBudgetManuallySelected] = useState(false)
  const [providerId, setProviderId] = useState(state.providers.find((provider) => provider.active)?.id ?? 'mock')
  const [busy, setBusy] = useState(false)
  const [editingTask, setEditingTask] = useState(false)
  const [preparationFailure, setPreparationFailure] = useState<string | null>(null)
  const [workStage, setWorkStage] = useState<'compose' | 'planning' | 'review'>('compose')
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({})
  const [preparation, setPreparation] = useState<WorkPreparation | null>(null)
  const [dictationLive, setDictationLive] = useState<DictationLiveView | null>(null)
  const memory = useMemoryScope(() => setPreparation(null), isCopilot(state.product))
  const dictationControl = useRef<DictationControl | null>(null)
  const handledFreshWorkRequest = useRef<number | null>(null)
  const parameterProcedure = useMemo(() => state.procedures
    .filter((procedure) => procedure.parameters.length > 0)
    .map((procedure) => ({ procedure, score: Math.max(goalMatchScore(workGoal, procedure.goal), goalMatchScore(workGoal, procedure.name)) }))
    .filter((candidate) => candidate.score >= 0.3)
    .sort((left, right) => right.score - left.score)[0]?.procedure, [state.procedures, workGoal])
  const requiredParameters = parameterProcedure?.parameters ?? []
  const missingRequiredParameter = requiredParameters.some((parameter) => parameter.required && !parameterValues[parameter.id]?.trim())
  const activeParameterValues = Object.fromEntries(requiredParameters.flatMap((parameter) => parameterValues[parameter.id] === undefined ? [] : [[parameter.id, parameterValues[parameter.id]!]]))
  const existingRun = selectWorkRunForEntry(state.runs, state.liveComputer.session, freshWorkRequestId === null ? 'resume' : 'fresh', focusedWorkRunId)
  const preparedRun = preparation?.run && !livePreparationSuperseded(preparation.run, state.liveComputer.session, state.runs)
    ? state.runs.find((run) => run.id === preparation.run?.id) ?? preparation.run : null
  const currentRun = preparation && !livePreparationSuperseded(preparation.run, state.liveComputer.session, state.runs) ? preparedRun : existingRun
  const context = preparation?.context ?? currentRun?.plan.context ?? null
  const pendingApproval = currentRun ? state.approvals.find((approval) => approval.runId === currentRun.id && approval.status === 'pending') : undefined
  // Selected-window data handoffs have their own exact table/provenance
  // review in LiveComputerPanel. Hiding the generic card prevents a second
  // approval surface from getting out of sync with the held switch action.
  const pendingCheckpoint = currentRun ? state.checkpoints.find((checkpoint) => checkpoint.runId === currentRun.id && checkpoint.status === 'pending' && checkpoint.subject !== 'data_transfer') : undefined
  const suggestions = state.procedures.slice(0, 3).map((procedure) => procedure.goal)
  const workHistory = useMemo(() => selectWorkHistory(state.runs, currentRun?.id ?? null), [state.runs, currentRun?.id])
  const metrics = useMemo(() => delegationMetrics(state, currentRun?.plan.procedureId ?? context?.procedure?.procedureId ?? null), [state, currentRun?.plan.procedureId, context?.procedure?.procedureId])
  const recommendedBudget = useMemo(() => recommendWorkBudget(workGoal), [workGoal])

  useEffect(() => {
    if (!budgetManuallySelected) setBudget(recommendedBudget)
  }, [budgetManuallySelected, recommendedBudget])

  useEffect(() => {
    const active = state.providers.find((provider) => provider.active)
    if (active) setProviderId(active.id)
  }, [state.providers])

  useEffect(() => {
    if (existingRun && !preparation && !editingTask && !preparationFailure) setWorkStage('review')
  }, [existingRun, preparation, editingTask, preparationFailure])

  // A follow-up asked from the desktop completion capsule starts a new live
  // contract behind this view's back. When the active live session belongs to
  // a different run than the locally prepared one, that preparation is stale —
  // release it so the view binds to the session that actually needs review.
  useEffect(() => {
    if (livePreparationSuperseded(preparation?.run, state.liveComputer.session, state.runs)) setPreparation(null)
  }, [preparation, state.liveComputer.session, state.runs])

  const doTask = async (task: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try {
      await task()
      await refresh()
      if (success) notify(success, 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const prepareDelegatedWork = async (selection?: WorkContextSelection, goalOverride?: string, followUp?: WorkRun, freshSession = false, budgetOverride?: WorkBudgetPreset | null, memoryOverride?: WorkMemoryScope) => {
    const goal = (goalOverride ?? workGoal).trim()
    if (!goal || busy || missingRequiredParameter) return
    if (followUp) setWorkGoal(goal)
    setBusy(true)
    setWorkStage('planning')
    setPreparationFailure(null)
    setEditingTask(false)
    try {
      // A follow-up inherits the earlier run's supervision policy and carries
      // its id so the backend can attach that exchange as planning context.
      const effectiveBudget = followUp?.plan.contract?.budget?.preset ?? budgetOverride ?? budget
      const inherited = followUp?.plan.intent && followUp.plan.supervision
        ? { intent: followUp.plan.intent, supervision: followUp.plan.supervision }
        : followUp ? supervisionPolicyFromLegacy(followUp.plan.autonomy) : { intent, supervision }
      const effectiveAutonomy = legacyAutonomyFor(inherited.intent, inherited.supervision)
      const result = await invoke<WorkPreparation>({ kind: 'work.prepare', goal, autonomy: effectiveAutonomy, intent: inherited.intent, supervision: inherited.supervision, budget: effectiveBudget, providerId, parameterValues: activeParameterValues, memory: memoryOverride ?? memory.scope, ...(selection ? { selection } : {}), ...(followUp ? { followUpRunId: followUp.id } : {}), ...(freshSession ? { freshSession: true, ...(freshWorkSourceTarget ? { routeSourceTarget: freshWorkSourceTarget } : {}) } : {}) })
      setPreparation(result)
      setWorkStage(result.run ? 'review' : 'compose')
      const publicLookup = result.run?.plan.actions.length === 1 && result.run.plan.actions[0]?.tool === 'web.search'
      if (result.run && inherited.intent === 'execute' && (publicLookup || inherited.supervision.preset === 'fast') && !result.run.plan.contract?.allowedTools.includes('computer.live')) {
        await invoke({ kind: 'run.action', runId: result.run.id, action: 'start' })
      }
      if (result.run) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await refresh()
      if (publicLookup) return
      notify(result.context.resolution?.status === 'needs_clarification'
        ? 'Carve found multiple plausible contexts—choose one to continue'
        : result.context.resolution?.status === 'empty' && (result.context.resolution.diagnostics.rejectedResourceCount ?? 0) > 0
          ? 'Carve withheld unrelated context—refine the subject or inspect Recall'
        : result.run
        ? result.run.plan.planningMode === 'capability_plan'
          ? 'Goal-led plan assembled from connected capabilities'
          : result.run.plan.planningMode === 'adapted_replay'
            ? 'Related experience adapted into a supervised plan'
            : 'Task plan ready for review'
        : 'Carve needs a connected capability for this goal', result.run ? 'positive' : 'warning')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPreparationFailure(message)
      setPreparation(null)
      setWorkStage('compose')
      if (freshSession) await refresh()
      notify(message, 'danger')
    } finally {
      setBusy(false)
      if (freshSession && freshWorkRequestId !== null) consumeFreshWorkRequest(freshWorkRequestId)
    }
  }

  // Home submission is both navigation and submission. Handle its unique
  // request exactly once—even under React StrictMode—and carry the fresh bit
  // through the command so the backend closes older active work atomically.
  useEffect(() => {
    if (freshWorkRequestId === null || handledFreshWorkRequest.current === freshWorkRequestId) return
    handledFreshWorkRequest.current = freshWorkRequestId
    if (freshWorkBudget) { setBudget(freshWorkBudget); setBudgetManuallySelected(true) }
    void prepareDelegatedWork(undefined, workGoal, undefined, true, freshWorkBudget)
  }, [freshWorkRequestId, freshWorkBudget])
  const runAction = (run: WorkRun, action: 'start' | 'stop') => doTask(
    async () => invoke({ kind: 'run.action', runId: run.id, action }),
    action === 'start'
      ? run.plan.intent === 'plan_only' ? 'Plan review finished; no execution authority created'
        : run.plan.intent === 'context_only' ? 'Context review finished; no execution authority created'
          : run.plan.supervision?.preset === 'fast' ? 'Request-authorized work started'
            : 'Exact operating contract approved; execution started'
      : 'Task stopped',
  )
  const approvalAction = (approvalId: string, action: 'approve' | 'cancel') => doTask(
    async () => invoke({ kind: 'approval.action', approvalId, action }),
    action === 'approve' ? 'Exact action approved' : 'Approval cancelled',
  )
  const checkpointAction = (checkpointId: string, action: 'approve' | 'decline') => doTask(
    async () => invoke({ kind: 'checkpoint.action', checkpointId, action }),
    action === 'approve' ? 'Checkpoint approved' : 'Stopped at checkpoint',
  )
  const changeSupervision = (runId: string, preset: PaceChoice) => doTask(
    async () => invoke({ kind: 'supervision.change', runId, preset }),
    preset === 'fast' ? 'Carve will move faster after this checkpoint' : 'Carve will check in more often',
  )
  const recoveryAction = (run: WorkRun, action: 'create' | 'dismiss') => doTask(
    async () => invoke({ kind: 'recovery.action', runId: run.id, action, providerId }),
    action === 'create' ? 'Exception converted into a fresh contract for review' : 'Exception dismissed',
  )

  const editTask = () => {
    setEditingTask(true)
    setPreparationFailure(null)
    setPreparation(null)
    setWorkStage('compose')
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  // Pressing Send mid-dictation finishes the recording and submits the goal
  // with the flushed transcript included — no second mic tap required.
  const submitDelegatedComposer = async () => {
    let goal = workGoal
    if (dictationControl.current?.active) {
      const result = await dictationControl.current.finish()
      goal = dictatedSubmissionValue(goal, result)
      setWorkGoal(goal)
      setPreparation(null)
    }
    await prepareDelegatedWork(undefined, goal)
  }

  if (workStage === 'planning') return <DelegationPlanningView goal={workGoal} memoryMode={memory.mode} budget={budget} />
  if (currentRun && workStage === 'review' && currentRun.plan.intent === 'execute'
    && currentRun.plan.actions.length === 1 && currentRun.plan.actions[0]?.tool === 'web.search') {
    const answered = currentRun.status === 'completed' && currentRun.publicLookup
    const pending = ['planned', 'running', 'awaiting_approval'].includes(currentRun.status)
    return <div className="page page--work page--public-answer">
      <section className="assistance-panel assistance-panel--answered work-public-answer" aria-label="Carve answer" aria-busy={pending}>
        <div className="assistance-panel__header">
          <div className="assistance-panel__identity"><strong>Carve</strong><span>{answered ? 'Answer ready' : pending ? 'Searching public sources' : 'Lookup stopped'}</span></div>
          {pending ? <Button variant="ghost" onClick={() => void runAction(currentRun, 'stop')}><Square size={14} /> Stop</Button> : <Button variant="ghost" onClick={editTask}>Edit question</Button>}
        </div>
        <div className="assistance-panel__answer" aria-live="polite">
          <p className="assistance-answer__question">{currentRun.plan.goal}</p>
          <h2 className="assistance-answer__label">{answered ? 'Carve' : pending ? 'Finding your answer' : 'No answer yet'}</h2>
          <div className="assistance-answer__body">{answered ? <PublicLookupAnswer runId={currentRun.id} evidence={answered} showSources />
            : pending ? 'Looking up your question and gathering sources…' : currentRun.result || 'The lookup did not complete. You can try again.'}</div>
        </div>
        {!pending ? <div className="work-public-answer__actions"><Button onClick={answered ? () => { setWorkGoal(''); editTask() } : () => void prepareDelegatedWork(undefined, currentRun.plan.goal)} disabled={busy}>{answered ? 'Ask another question' : 'Try again'}</Button></div> : null}
      </section>
    </div>
  }
  if (currentRun && workStage === 'review' && context) {
    return <DelegationPlanReview
      state={state}
      desktop={desktop}
      context={context}
      run={currentRun}
      busy={busy}
      onEditTask={editTask}
      onRecall={() => navigate('recall')}
      onSettings={() => navigate('settings')}
      onStart={() => void runAction(currentRun, 'start')}
      onStop={() => void runAction(currentRun, 'stop')}
      approval={pendingApproval}
      onApproval={(action) => void approvalAction(pendingApproval!.id, action)}
      checkpoint={pendingCheckpoint}
      onCheckpoint={(action) => void checkpointAction(pendingCheckpoint!.id, action)}
      onSupervisionChange={(preset) => void changeSupervision(currentRun.id, preset)}
      metrics={metrics}
      onRecovery={(action) => void recoveryAction(currentRun, action)}
      providerId={providerId}
      refresh={refresh}
      notify={notify}
    />
  }

  return (
    <div className="page page--work page--delegation page--simple-work">
      <PageIntro
        label="Work"
        title="One task. A little help."
        description="Describe a short task in one window. Review the plan, then let Carve help."
        action={currentRun && ['running', 'awaiting_approval', 'awaiting_guidance'].includes(currentRun.status) ? <Button variant="danger" onClick={() => void runAction(currentRun, 'stop')}><Square size={14} fill="currentColor" /> Stop work</Button> : undefined}
      />

      {preparationFailure ? <div className="work-preparation-failure" role="alert"><strong>Couldn’t start this request</strong><p>{preparationFailure}</p><Button onClick={() => void submitDelegatedComposer()} disabled={busy}>Try again</Button></div> : null}

      <form className={`work-composer delegation-composer ${busy ? 'work-composer--busy' : ''}`} onSubmit={(event) => { event.preventDefault(); void submitDelegatedComposer() }}>
        <div className="delegation-composer__label"><Sparkles size={14} /><span>What would you like a hand with?</span></div>
        <textarea
          rows={3}
          value={workGoal}
          onChange={(event) => { setWorkGoal(event.target.value); setPreparation(null); setWorkStage('compose') }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submitDelegatedComposer()
            }
          }}
          aria-label="Describe the outcome for Carve"
          placeholder="Apply a filter, find a control, or update a short note…"
        />
        <div className="work-composer__footer">
          {!isCopilot(state.product) ? <MemoryScopeControl memory={memory} /> : null}
          {!isCopilot(state.product) ? <WorkBudgetControl value={budget} recommended={recommendedBudget} disabled={busy} onChange={(value) => { setBudget(value); setBudgetManuallySelected(true); setPreparation(null) }} /> : <span className="copilot-setting-note">One focused task · up to 5 minutes</span>}
          {!isCopilot(state.product) ? <IntentControl value={intent} onChange={(value) => { setIntent(value); setPreparation(null) }} /> : null}
          {isCopilot(state.product) && state.liveComputer.assistance ? <ApprovalControl state={state.liveComputer.assistance} disabled={busy} refresh={refresh} onError={message => notify(message, 'danger')} /> : null}
          {!isCopilot(state.product) ? <SupervisionControl value={pace} disabled={intent !== 'execute'} earned={earned} onChange={(value) => { setPace(value); setPreparation(null) }} /> : null}
          <DictationButton
            enabled={state.dictation.configured}
            disabled={busy}
            notify={notify}
            onLive={setDictationLive}
            controlRef={dictationControl}
            field={{ value: workGoal, onChange: (next) => { setWorkGoal(next); setPreparation(null); setWorkStage('compose') } }}
          />
          <Button className="work-composer__submit" type="submit" aria-label="Prepare my plan" disabled={(!workGoal.trim() && !dictationLive) || busy || missingRequiredParameter || memory.blocked}>
            {busy ? <RefreshCw className="spin" size={17} /> : <ArrowRight size={17} />}
          </Button>
        </div>
        {!isCopilot(state.product) ? <MemorySessionPicker memory={memory} sessions={state.sessions} /> : null}
        {dictationLive ? <div className="work-composer__activity work-composer__dictation"><span /><span>{[dictationLive.transcript, dictationLive.interim].filter(Boolean).join(' ') || 'Listening…'}</span></div> : null}
        {busy ? <div className="work-composer__activity"><span /><span>Preparing your plan and checking where to work…</span></div> : null}
      </form>

      {!context && !currentRun ? (
        <>
          <div className="work-suggestions simple-work-suggestions"><span>Try an outcome</span>{(isCopilot(state.product) ? ['Compare the options visible on this page', 'Apply a filter in this window', 'Update a short note'] : suggestions.length > 0 ? suggestions : ['Triage an urgent request and create a review note', 'Prepare a verified customer handoff']).map((suggestion) => <button type="button" key={suggestion} onClick={() => { setWorkGoal(suggestion); setPreparation(null) }}>{suggestion}</button>)}</div>
          {workHistory.length > 0
            ? <WorkHistorySection
              history={workHistory}
              progress={state.workProgress}
              busy={busy}
              onFollowUp={(previous, question) => void prepareDelegatedWork(undefined, question, previous)}
              onReuse={(run) => { const inherited = run.plan.intent && run.plan.supervision ? { intent: run.plan.intent, supervision: run.plan.supervision } : supervisionPolicyFromLegacy(run.plan.autonomy); setWorkGoal(run.plan.goal); setBudget(run.plan.contract?.budget?.preset ?? 'balanced'); setBudgetManuallySelected(true); setIntent(inherited.intent); setPace(inherited.supervision.preset); setPreparation(null); setWorkStage('compose'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            />
            : <SimpleWorkWelcome onTeach={() => navigate('learn')} />}
        </>
      ) : null}

      {requiredParameters.length > 0 ? <Card className="parameter-composer"><SectionHeading eyebrow="Task details" title="Values that change this time" description="These details will be included in the plan you review before Carve starts." /><div className="parameter-inputs">{requiredParameters.map((parameter) => <Field key={parameter.id} label={parameter.label} hint={`${parameter.constraints.minLength}–${parameter.constraints.maxLength} characters · do not enter passwords or secrets`}><input value={parameterValues[parameter.id] ?? ''} maxLength={parameter.constraints.maxLength} onChange={(event) => setParameterValues((current) => ({ ...current, [parameter.id]: event.target.value }))} placeholder={parameter.examples[0] ? `New value; example: ${parameter.examples[0]}` : 'Enter a value for this task'} /></Field>)}</div><div className="parameter-examples"><ShieldCheck size={15} /><span>{requiredParameters.map((parameter) => `${parameter.examples.length} demonstrations support ${parameter.label}`).join(' · ')}</span></div></Card> : null}

      {context && !currentRun ? context.resolution?.status === 'needs_clarification'
        ? <ContextClarificationCard context={context} busy={busy} onSelect={(interpretationId) => void prepareDelegatedWork({ interpretationId })} onRecall={() => navigate('recall')} />
        : <SimpleCapabilityGap
          context={context}
          blocker={preparation?.blocker ?? null}
          busy={busy}
          onContinue={() => void prepareDelegatedWork(undefined, undefined, undefined, false, null, { mode: 'none', sessionIds: [] })}
          onRecall={() => navigate('recall')}
          onTeach={() => navigate('learn')}
        /> : null}
      {context && currentRun ? (
        <main className="simple-work-flow">
          <EvidenceReceipt context={context} onRecall={() => navigate('recall')} />
          <OperatingContractCard run={currentRun} busy={busy} onStart={() => void runAction(currentRun, 'start')} onStop={() => void runAction(currentRun, 'stop')} />
          {pendingApproval ? <DelegationApproval approval={pendingApproval} onDecision={(action) => void approvalAction(pendingApproval.id, action)} /> : null}
          {pendingCheckpoint ? <DelegationCheckpoint checkpoint={pendingCheckpoint} run={currentRun} onDecision={(action) => void checkpointAction(pendingCheckpoint.id, action)} onSupervisionChange={(preset) => void changeSupervision(currentRun.id, preset)} /> : null}
          {currentRun.status !== 'planned' ? <ProofOfWorkCard state={state} run={currentRun} /> : null}
          <details className="work-learning-details"><summary><BrainCircuit size={15} /> What Carve learned from this task <ChevronDown size={15} /></summary><div><EarnedAutonomyCard metrics={metrics} selectedMode={supervisionLabel(currentRun)} /><ExceptionLearningCard state={state} run={currentRun} busy={busy} onRecovery={(action) => void recoveryAction(currentRun, action)} /></div></details>
        </main>
      ) : null}

    </div>
  )
}

/** A concise visible activity report, intentionally not hidden model reasoning. */
/**
 * The requested outcome is the authority for the whole plan, so it must never
 * be reviewable only in truncated form: long goals clamp for layout, with an
 * explicit toggle that reveals the complete text. The toggle renders only when
 * the text actually overflows its clamp.
 */
function RequestSummary({ goal }: { goal: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const textRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [goal])
  return (
    <div className={`plan-review-page__request${expanded ? ' plan-review-page__request--expanded' : ''}`}>
      <small>Your request</small>
      <strong ref={textRef}>{goal}</strong>
      {overflowing || expanded ? (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Show less' : 'Show full request'} <ChevronDown size={13} className={expanded ? 'rotate' : ''} />
        </button>
      ) : null}
    </div>
  )
}

function DelegationPlanningView({ goal, memoryMode = 'auto', budget = 'balanced' }: { goal: string; memoryMode?: WorkMemoryScopeMode; budget?: WorkBudgetPreset }) {
  const selectedBudget = workBudgetOption(budget)
  const [startedAt] = useState(Date.now)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  const memoryLabel = memoryMode === 'none' ? 'History is off for this request.' : memoryMode === 'selected' ? 'Context is limited to your selected history.' : 'Relevant history is available if this task needs it.'
  return (
    <div className="page page--delegation plan-transition">
      <div className="plan-transition__top"><span><Sparkles size={15} /> Carve is understanding your request</span><Pill tone="info"><Activity size={13} /> In progress</Pill></div>
      <section className="plan-transition__hero">
        <CarvePresence state="working" />
        <h1>Let’s find the best way to help.</h1>
        <p>I’m checking whether this needs an answer or action.</p>
        <div className="plan-transition__task"><span>Your request</span><strong>{goal}</strong><small><Gauge size={13} /> {selectedBudget.label} · up to {selectedBudget.maxActions} steps or {selectedBudget.maxMinutes} active min</small></div>
      </section>
      <Card className="plan-transition__activity" elevated>
        <div role="status"><span className="plan-transition__step-icon plan-transition__step-icon--active"><RefreshCw size={15} className="spin" /></span><section><strong>{elapsed >= 10 ? 'Still checking your request' : 'Choosing how to help'}</strong><small>{memoryLabel}</small></section></div>
        <div><span>{elapsed}s elapsed</span><small>Your answer or proposed next step will appear here.</small></div>
      </Card>
      <p className="plan-transition__note"><ShieldCheck size={15} /> Public questions can be answered here. App actions have a plan to review.</p>
    </div>
  )
}

function DelegationPlanReview({ state, desktop, context, run, busy, onEditTask, onRecall, onSettings, onStart, onStop, approval, onApproval, checkpoint, onCheckpoint, onSupervisionChange, metrics, onRecovery, providerId, refresh, notify }: {
  state: CarveState
  desktop: DesktopStatus
  context: WorkContextSummary
  run: WorkRun
  busy: boolean
  onEditTask: () => void
  onRecall: () => void
  onSettings: () => void
  onStart: () => void
  onStop: () => void
  approval: CarveState['approvals'][number] | undefined
  onApproval: (action: 'approve' | 'cancel') => void
  checkpoint: CarveState['checkpoints'][number] | undefined
  onCheckpoint: (action: 'approve' | 'decline') => void
  onSupervisionChange: (preset: PaceChoice) => void
  metrics: DelegationMetrics
  onRecovery: (action: 'create' | 'dismiss') => void
  providerId: string
  refresh: () => Promise<void>
  notify: (message: string, tone?: Tone) => void
}) {
  const active = ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status)
  const sourceCount = context.sessions.length + context.moments.length + (context.procedure ? 1 : 0)
  // One page, five honest moods. After a stop it must say "stopped" in the
  // first line, never "ready to review" beside an approved plan.
  const mood: 'review' | 'active' | 'attention' | 'stopped' | 'done' | 'blocked' = run.status === 'awaiting_guidance'
    ? 'attention'
    : active
    ? 'active'
    : run.status === 'cancelled'
      ? 'stopped'
      : run.status === 'completed'
        ? 'done'
        : run.status === 'blocked' || run.status === 'failed'
          ? 'blocked'
          : 'review'
  const routeFirstReview = mood === 'review' && run.plan.contract?.allowedTools.includes('computer.live') === true
  const hero = {
    review: { eyebrow: 'Plan review', title: 'Your plan is ready to review.', body: 'Here’s what I’ll do. Review the steps and choose when to start.' },
    active: { eyebrow: 'Work in progress', title: 'Carve is working.', body: 'Follow each approved action and stop work at any time.' },
    attention: { eyebrow: 'Needs your attention', title: 'Carve is waiting for you.', body: 'Work is paused. Review the question below to continue.' },
    stopped: { eyebrow: 'Stopped', title: 'Work stopped.', body: 'You stopped Carve. Nothing further was sent; the ledger below records exactly what ran before the stop.' },
    done: { eyebrow: 'Done', title: 'Work complete.', body: 'The result and every step Carve took are recorded below.' },
    blocked: { eyebrow: 'Needs you', title: 'Carve stopped before finishing.', body: 'Nothing further was sent. Review what happened below, then retry from the same window or change the request.' },
  }[mood]
  // A run that stopped early leads with Carve's own report of what it established and what stopped it
  // (capsule pass, 27 September: "Carve stopped before finishing" hid "I couldn't open your saved words list…"
  // in small print near the bottom of the page).
  const stoppedReport = mood === 'blocked' && run.result?.trim() ? run.result.trim().slice(0, 600) : null
  const visibleHero = routeFirstReview
    ? { eyebrow: 'Your task', title: 'Choose where Carve works.', body: 'Allow app-name sharing to get a suggested route, then choose which windows Carve may read.' }
    : stoppedReport ? { ...hero, body: `${stoppedReport} Nothing further was sent.` } : hero
  const nextDecision = {
    review: { title: 'Approve the plan, not a blank check.', body: 'Each target, tool, and verification check is frozen into the plan fingerprint below.' },
    active: { title: 'Stay in control.', body: 'Carve pauses for the supervision level you selected and stops if verification fails.' },
    attention: { title: 'Choose how to continue.', body: 'Carve has paused at the question below. Answer it to resume the current task.' },
    stopped: { title: 'Stopped by you.', body: 'No further input will be sent. Start a new request, or retry from the same window.' },
    done: { title: 'Work is complete.', body: 'The execution ledger below preserves what happened.' },
    blocked: { title: 'Decide how to continue.', body: 'Retry from the same window, or edit the request. Nothing runs until you choose.' },
  }[mood]
  return (
    <div className={`page page--delegation plan-review-page plan-review-page--${mood}${routeFirstReview ? ' plan-review-page--route-first' : ''}`}>
      <div className="plan-review-page__crumb"><button type="button" onClick={onEditTask}><ArrowLeft size={15} /> Edit task</button><span>Work <ArrowRight size={13} /> {mood === 'review' ? 'Plan review' : mood === 'active' ? 'In progress' : mood === 'stopped' ? 'Stopped' : mood === 'done' ? 'Result' : 'Needs you'}</span></div>
      <header className="plan-review-page__hero">
        <div><CarvePresence state={mood === 'done' ? 'complete' : mood === 'active' ? 'working' : mood === 'stopped' ? 'paused' : 'attention'} /><div className="eyebrow">{visibleHero.eyebrow}</div><h1>{visibleHero.title}</h1><p>{visibleHero.body}</p></div>
        <RequestSummary goal={run.plan.goal} />
      </header>

      {!routeFirstReview ? <section className="plan-review-activity" aria-label="Planning activity summary">
        <div className="plan-review-activity__title"><Sparkles size={16} /><span>How Carve prepared this plan</span><small>A concise activity report, not hidden reasoning.</small></div>
        <ol>
          <li><span><Check size={14} /></span><div><strong>Read the requested outcome</strong><small>{run.plan.intent ? `${workIntentOptions.find((option) => option.value === run.plan.intent)?.label ?? humanize(run.plan.intent)} · ` : ''}Supervision: {supervisionLabel(run)}</small></div></li>
          <li><span><Check size={14} /></span><div><strong>Resolved local context</strong><small>{sourceCount} source{sourceCount === 1 ? '' : 's'} bound to this plan</small></div></li>
          <li><span><Check size={14} /></span><div><strong>{run.plan.contract?.allowedTools.includes('computer.live') ? 'Worked in your selected window' : `Bound ${run.plan.actions.length} action${run.plan.actions.length === 1 ? '' : 's'} and verification`}</strong><small>Carve stays within the plan you approve</small></div></li>
          <li className={active ? 'plan-review-activity__current' : ''}><span>{active ? <Activity size={14} /> : mood === 'stopped' ? <Square size={14} /> : mood === 'done' ? <Check size={14} /> : <ShieldCheck size={14} />}</span><div><strong>{mood === 'active' ? 'Following your approved plan' : mood === 'stopped' ? 'Stopped by you' : mood === 'done' ? 'Finished' : mood === 'blocked' ? 'Stopped before completion' : 'Waiting for your decision'}</strong><small>{mood === 'active' ? 'You can stop work immediately.' : mood === 'review' ? 'No action runs before approval.' : 'No further input was sent.'}</small></div></li>
        </ol>
      </section> : null}

      <div className={`plan-review-page__layout${routeFirstReview ? ' plan-review-page__layout--route-first' : ''}`}>
        <main>
          {routeFirstReview ? <LiveComputerPanel state={state} desktop={desktop} run={run} providerId={providerId} onSettings={onSettings} refresh={refresh} notify={notify} /> : <EvidenceReceipt context={context} onRecall={onRecall} />}
          {routeFirstReview ? <details className="plan-review-page__supporting"><summary><ShieldCheck size={15} /><span>Plan, context, and safety details</span><small>Optional review</small><ChevronDown size={15} /></summary><div><EvidenceReceipt context={context} onRecall={onRecall} /><OperatingContractCard run={run} busy={busy} onStart={onStart} onStop={onStop} reviewMode /></div></details> : <><LiveComputerPanel state={state} desktop={desktop} run={run} providerId={providerId} onSettings={onSettings} refresh={refresh} notify={notify} /><OperatingContractCard run={run} busy={busy} onStart={onStart} onStop={onStop} reviewMode /></>}
          {approval ? <DelegationApproval approval={approval} onDecision={onApproval} /> : null}
          {checkpoint && state.liveComputer.universalSession?.pendingCheckpointId !== checkpoint.id ? <DelegationCheckpoint checkpoint={checkpoint} run={run} onDecision={onCheckpoint} onSupervisionChange={onSupervisionChange} /> : null}
          {run.status !== 'planned' ? <ProofOfWorkCard state={state} run={run} /> : null}
          {!routeFirstReview ? <details className="work-learning-details"><summary><BrainCircuit size={15} /> What Carve learned from this task <ChevronDown size={15} /></summary><div><EarnedAutonomyCard metrics={metrics} selectedMode={supervisionLabel(run)} /><ExceptionLearningCard state={state} run={run} busy={busy} onRecovery={onRecovery} /></div></details> : null}
        </main>
        {!routeFirstReview ? <aside className="plan-review-page__rail">
          <Card><div className="eyebrow">Next decision</div><h2>{nextDecision.title}</h2><p>{nextDecision.body}</p></Card>
          <Card className="plan-review-page__guardrail"><ShieldCheck size={17} /><div><strong>Bounded by this review</strong><span>New destinations, tools, sensitive data, and failed verification all require a new decision.</span></div></Card>
        </aside> : null}
      </div>
    </div>
  )
}

/**
 * The visual-control workspace deliberately lives beside the reviewed plan,
 * not inside the task composer. It makes the change of mode unmistakable:
 * one active authorized window, one fresh frame, one proposed action, one approval.
 */
function LiveComputerAppIcon({ target, compact = false }: { target: LiveComputerTarget; compact?: boolean }) {
  return (
    <span className={`live-computer__app-icon${compact ? ' live-computer__app-icon--compact' : ''}`} aria-hidden="true">
      {target.iconDataUrl ? <img src={target.iconDataUrl} alt="" draggable={false} /> : <AppWindow size={compact ? 15 : 19} />}
    </span>
  )
}

function LiveComputerPanel({ state, desktop, run, providerId, onSettings, refresh, notify }: {
  state: CarveState
  desktop: DesktopStatus
  run: WorkRun
  providerId: string
  onSettings: () => void
  refresh: () => Promise<void>
  notify: (message: string, tone?: Tone) => void
}) {
  const [targets, setTargets] = useState<LiveComputerTarget[]>([])
  const [installedApplications, setInstalledApplications] = useState<LiveComputerApplicationIdentity[]>([])
  const [modelRecommendations, setModelRecommendations] = useState<LiveComputerTargetRecommendation[]>([])
  const [recommending, setRecommending] = useState(false)
  const [modelRecommendationAvailable, setModelRecommendationAvailable] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [showAllTargets, setShowAllTargets] = useState(false)
  const [routeLoading, setRouteLoading] = useState(true)
  const [catalogGrant, setCatalogGrant] = useState<string | null>(null)
  const [rememberCatalog, setRememberCatalog] = useState(false)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [targetSearch, setTargetSearch] = useState('')
  const [routeStarting, setRouteStarting] = useState(false)
  const [routeStartError, setRouteStartError] = useState<string | null>(null)
  const [routeDraft, setRouteDraft] = useState<LiveWindowRouteStep[]>([])
  const [routeRetry, setRouteRetry] = useState(0)
  const [routeIntent, setRouteIntent] = useState<WorkSurfaceIntent>(run.plan.surfaceIntent ?? { requirements: [], existingWindowsProhibited: false })
  const [routeSelection, setRouteSelection] = useState<WorkSurfaceIntentSelection | null>(run.plan.surfaceIntentSelection ?? null)
  const [routeResolution, setRouteResolution] = useState<WorkSurfaceResolution | null>(run.plan.surfaceResolution ?? null)
  const [planFeedback, setPlanFeedback] = useState('')
  const [guidanceDirective, setGuidanceDirective] = useState('')
  const [retryNote, setRetryNote] = useState('')
  const [followUpGoal, setFollowUpGoal] = useState('')
  const [targetApp, setTargetApp] = useState('all')
  const [remoteVisualsAllowed, setRemoteVisualsAllowed] = useState(false)
  const [liveProviderId, setLiveProviderId] = useState(providerId)
  const [frame, setFrame] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [liveNow, setLiveNow] = useState(Date.now())
  const preparedRouteRunRef = useRef<string | null>(null)
  const routeStartInFlightRef = useRef(false)
  const routeStartKeyRef = useRef(`route-${run.id}-${Date.now().toString(36)}`)
  const live = state.liveComputer.session?.runId === run.id ? state.liveComputer.session : null
  const universal = state.liveComputer.universalSession?.runId === run.id ? state.liveComputer.universalSession : null
  const universalCheckpoint = universal?.pendingCheckpointId
    ? state.checkpoints.find((checkpoint) => checkpoint.id === universal.pendingCheckpointId && checkpoint.status === 'pending')
    : undefined
  const compactMode = (universal?.actionEngine ?? state.liveComputer.actionEngine) === 'compact_v1'
  const universalMode = isUniversalLiveComputerEngine(state.liveComputer.actionEngine)
  const hasSession = Boolean(live || universal)
  const liveBudgetTone: Tone = live && live.actionCount >= live.maxActions * 0.8 ? 'warning' : 'positive'
  const status = state.liveComputer.status
  const permissionsReady = status.screenRecording === 'granted' && status.accessibility === 'granted' && status.computerControl
  const provider = state.providers.find((candidate) => candidate.id === liveProviderId) ?? state.providers.find((candidate) => candidate.active)
  const sharing = state.liveComputer.sharing?.find(entry => entry.providerId === provider?.id)
  const routeKey = `${run.id}:${provider?.id ?? liveProviderId}`
  const catalogAllowed = provider?.kind !== 'hosted' || sharing?.catalog === true || sharing?.catalogTasks?.includes(run.id) === true || catalogGrant === routeKey
  useEffect(() => {
    setCatalogGrant(null)
    setRemoteVisualsAllowed(false)
    preparedRouteRunRef.current = null
  }, [state.liveComputer.sharingRevocation])
  const allowCatalog = async () => {
    if (!provider || catalogBusy) return
    setCatalogBusy(true)
    try {
      await invoke({ kind: 'computer.catalog_consent', providerId: provider.id, remember: rememberCatalog, runId: run.id })
      preparedRouteRunRef.current = null
      setRouteStartError(null)
      setCatalogGrant(routeKey)
      await refresh()
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
    finally { setCatalogBusy(false) }
  }
  const visualProviders = state.providers.filter((candidate) => candidate.kind !== 'mock'
    && candidate.configured
    && candidate.capabilities.vision
    && (universalMode && !compactMode ? candidate.computerUseSessions : candidate.capabilities.structuredOutput))
  const canReasonVisually = Boolean(provider
    && provider.kind !== 'mock'
    && provider.configured
    && provider.capabilities.vision
    && (universalMode && !compactMode ? provider.computerUseSessions : provider.capabilities.structuredOutput))
  const terminal = live ? ['stopped', 'completed', 'blocked', 'handoff'].includes(live.status) : false
  const universalTerminal = universal ? ['completed', 'safety_check', 'stopped', 'blocked'].includes(universal.status) : false
  const universalPaused = universal ? ['paused', 'awaiting_steering_review'].includes(universal.status) : false
  const livePlan = run.plan.contract?.allowedTools.includes('computer.live') === true
  const targetGroups = useMemo(() => {
    const grouped = new Map<string, { bundleIdentifier: string; application: string; targets: LiveComputerTarget[] }>()
    targets.forEach((target) => {
      const existing = grouped.get(target.bundleIdentifier)
      if (existing) existing.targets.push(target)
      else grouped.set(target.bundleIdentifier, { bundleIdentifier: target.bundleIdentifier, application: target.application, targets: [target] })
    })
    const pickerPriority = (application: string, bundleIdentifier: string) => {
      const identity = `${application} ${bundleIdentifier}`
      if (/chrome|safari|firefox|edge|arc|chatgpt|claude|slack|zoom|messages|mail|notion/iu.test(identity)) return 0
      if (/terminal|iterm|system settings|activity monitor|console/iu.test(identity)) return 2
      return 1
    }
    const relevance = (group: { application: string; targets: LiveComputerTarget[] }) => Math.max(...group.targets.map((target) => goalMatchScore(run.plan.goal, `${target.application} ${target.title}`)))
    return [...grouped.values()]
      .map((group) => ({ ...group, targets: [...group.targets].sort((left, right) => goalMatchScore(run.plan.goal, `${right.application} ${right.title}`) - goalMatchScore(run.plan.goal, `${left.application} ${left.title}`)) }))
      .sort((left, right) => relevance(right) - relevance(left) || pickerPriority(left.application, left.bundleIdentifier) - pickerPriority(right.application, right.bundleIdentifier) || left.application.localeCompare(right.application))
  }, [run.plan.goal, targets])
  const visibleTargetGroups = useMemo(() => {
    const query = targetSearch.trim().toLocaleLowerCase()
    return targetGroups.flatMap((group) => {
      if (targetApp !== 'all' && group.bundleIdentifier !== targetApp) return []
      const matching = query
        ? group.targets.filter((target) => `${target.title} ${target.application}`.toLocaleLowerCase().includes(query))
        : group.targets
      return matching.length ? [{ ...group, targets: matching }] : []
    })
  }, [targetApp, targetGroups, targetSearch])
  const visibleTargetCount = visibleTargetGroups.reduce((total, group) => total + group.targets.length, 0)
  const recommendationReasons = useMemo(() => new Map(modelRecommendations.map((recommendation) => [`${recommendation.windowId}:${recommendation.bundleIdentifier}`, recommendation.reason])), [modelRecommendations])
  const recommendedTargets = useMemo(() => {
    if (targetSearch || targetApp !== 'all' || recommending) return []
    // A completed model call is authoritative, including a deliberate empty
    // result; the local heuristic only fills in when inference didn't run.
    if (modelRecommendationAvailable) {
      return modelRecommendations.flatMap((recommendation) => {
        const target = targets.find((candidate) => candidate.windowId === recommendation.windowId && candidate.bundleIdentifier === recommendation.bundleIdentifier)
        return target ? [target] : []
      })
    }
    if (!run.plan.goal.trim()) return []
    return confidentWindowRecommendations(run.plan.goal, targets, 3)
  }, [run.plan.goal, targets, targetSearch, targetApp, recommending, modelRecommendationAvailable, modelRecommendations])

  useEffect(() => {
    setFrame(null)
    setTargets([])
    setInstalledApplications([])
    setModelRecommendations([])
    setModelRecommendationAvailable(false)
    setRecommending(false)
    setSelecting(false)
    setShowAllTargets(false)
    setTargetSearch('')
    setTargetApp('all')
    setRouteStarting(false)
    setRouteDraft([])
    setRouteIntent(run.plan.surfaceIntent ?? { requirements: [], existingWindowsProhibited: false })
    setRouteSelection(run.plan.surfaceIntentSelection ?? null)
    setRouteResolution(run.plan.surfaceResolution ?? null)
    setRouteLoading(true)
    preparedRouteRunRef.current = null
    routeStartKeyRef.current = `route-${run.id}-${Date.now().toString(36)}`
    setPlanFeedback('')
    setGuidanceDirective('')
  }, [live?.id, universal?.id, run.id])

  useEffect(() => {
    setGuidanceDirective('')
  }, [live?.pendingGuidance?.id, live?.pendingGuidance?.askedAt])

  useEffect(() => {
    setRemoteVisualsAllowed(state.liveComputer.sharing?.some(entry => entry.providerId === liveProviderId && entry.windows) ?? state.liveComputer.visualsConsentProviderId === liveProviderId)
  }, [state.liveComputer.visualsConsentProviderId, sharing?.windows, liveProviderId])

  useEffect(() => {
    const requested = state.providers.find((candidate) => candidate.id === providerId)
    const eligible = (candidate: typeof requested) => Boolean(candidate
      && candidate.kind !== 'mock'
      && candidate.configured
      && candidate.capabilities.vision
      && (universalMode && !compactMode ? candidate.computerUseSessions : candidate.capabilities.structuredOutput))
    const selected = eligible(requested)
      ? requested
      : state.providers.find((candidate) => eligible(candidate))
    setLiveProviderId(selected?.id ?? providerId)
  }, [providerId, state.providers, universalMode, compactMode])

  // Prepare the route as soon as review is ready. Enumeration is read-only:
  // fresh windows remain placeholders until the person presses Start.
  useEffect(() => {
    if (!catalogAllowed) { setRouteLoading(false); return }
    if (!desktop.desktop || !permissionsReady || hasSession || run.status !== 'planned' || preparedRouteRunRef.current === routeKey) return
    preparedRouteRunRef.current = routeKey
    let cancelled = false
    setRouteLoading(true)
    void Promise.all([
      invoke<{ targets: LiveComputerTarget[] }>({ kind: 'computer.targets.list' }),
      invoke<{ intent: WorkSurfaceIntent; selection: WorkSurfaceIntentSelection; resolution: WorkSurfaceResolution; applications: LiveComputerApplicationIdentity[] }>({
        kind: 'computer.route.infer', runId: run.id, providerId: provider?.id ?? liveProviderId,
      }),
    ]).then(([result, inference]) => {
      if (cancelled) return
      const installedIdentities = new Set(inference.applications.map((application) => application.bundleIdentifier))
      const installed = browserBundles
        .map((entry) => entry.bundleIdentifier)
        .filter((bundleIdentifier) => installedIdentities.has(bundleIdentifier) || result.targets.some((target) => target.bundleIdentifier === bundleIdentifier))
      const draft = suggestedWindowRouteDraft(run.plan.goal, result.targets, installed, inference.applications, inference.intent, inference.resolution, run.plan.routeSourceTarget)
      setTargets(result.targets)
      setInstalledApplications(inference.applications)
      setRouteIntent(inference.intent)
      setRouteSelection(inference.selection)
      setRouteResolution(inference.resolution)
      setRouteDraft(draft)
      void refresh()
    }).catch((error) => {
      if (!cancelled) {
        setRouteDraft([])
        setRouteStartError(error instanceof Error ? error.message : String(error))
        notify(error instanceof Error ? error.message : String(error), 'danger')
      }
    }).finally(() => {
      if (!cancelled) setRouteLoading(false)
    })
    return () => { cancelled = true }
  }, [desktop.desktop, hasSession, liveProviderId, permissionsReady, provider?.id, refresh, run.id, run.plan.goal, run.status, state.liveComputer.modelProfile, universalMode, compactMode, routeRetry, catalogAllowed, routeKey])

  // The picker must show windows opened AFTER it appeared — the person often
  // opens the app they want mid-selection. Quiet refreshes keep the audit
  // chain to one enumeration record per picker opening.
  useEffect(() => {
    if (!selecting || busy) return
    let cancelled = false
    const refreshTargets = async () => {
      try {
        const result = await invoke<{ targets: LiveComputerTarget[] }>({ kind: 'computer.targets.list', quiet: true })
        if (!cancelled) setTargets(result.targets)
      } catch {
        // The picker keeps its last list; a failed refresh is not an event.
      }
    }
    const timer = window.setInterval(() => { void refreshTargets() }, 2_500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [selecting, busy])

  useEffect(() => {
    if (!desktop.desktop || (!(live?.latestFrame) && !(universal?.latestFrame))) return
    let cancelled = false
    const read = async () => {
      try {
        const result = await invoke<{ dataUrl: string | null }>({ kind: 'computer.session.frame' })
        if (!cancelled) setFrame(result.dataUrl)
      } catch {
        // The main state tells the user about a stopped or unavailable session.
      }
    }
    void read()
    if (terminal || universalTerminal) return () => { cancelled = true }
    const timer = window.setInterval(() => { void read() }, 1_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [desktop.desktop, live?.id, live?.latestFrame?.id, universal?.id, universal?.latestFrame?.id, terminal, universalTerminal])

  useEffect(() => {
    if (!live || terminal) return
    setLiveNow(Date.now())
    const timer = window.setInterval(() => setLiveNow(Date.now()), live.pendingApproval?.expiresAt ? 100 : 1_000)
    return () => window.clearInterval(timer)
  }, [live?.id, live?.pendingApproval?.expiresAt, terminal])

  const doComputerTask = async (task: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try {
      await task()
      await refresh()
      if (success) notify(success, 'positive')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const chooseComputerModelProfile = (profile: 'adaptive_5_6' | 'astra') => doComputerTask(async () => {
    // A model change invalidates any already-inferred route for this review.
    // The next render reruns metadata-only route inference with the selected
    // profile before the person can start.
    preparedRouteRunRef.current = null
    setRouteLoading(true)
    await invoke({ kind: 'computer.model_profile.set', profile })
  }, profile === 'astra' ? 'Astra will power new computer-use work' : 'Adaptive GPT-5.6 routing restored')

  const openSettings = (pane: 'screen_recording' | 'accessibility') => doComputerTask(
    async () => invoke({ kind: 'desktop.open_system_settings', pane }),
  )
  const check = () => doComputerTask(async () => invoke({ kind: 'computer.status' }), 'Live computer permissions checked')
  const requestScreenRecording = () => doComputerTask(async () => invoke({ kind: 'computer.request_screen_recording_permission' }), 'macOS Screen Recording request opened')
  const requestAccessibility = () => doComputerTask(async () => invoke({ kind: 'computer.request_accessibility_permission' }), 'macOS Accessibility request opened')
  const chooseWindow = () => doComputerTask(async () => {
    const result = await invoke<{ targets: LiveComputerTarget[] }>({ kind: 'computer.targets.list' })
    setTargets(result.targets)
    setTargetSearch('')
    setTargetApp('all')
    setShowAllTargets(false)
    setSelecting(true)
    setModelRecommendations([])
    setModelRecommendationAvailable(false)
    setRecommending(false)
  })
  // These are draft choices only. No fresh surface is opened until Start.
  const installedBrowsers = useMemo(() => {
    const identities = new Set(installedApplications.map((application) => application.bundleIdentifier))
    return browserBundles.map((entry) => entry.bundleIdentifier)
      .filter((id) => identities.has(id) || targets.some((target) => target.bundleIdentifier === id))
  }, [installedApplications, targets])
  const freshSuggestions = useMemo(() => freshSurfaceSuggestionsForIntent(routeIntent, installedBrowsers, installedApplications, routeResolution ?? undefined), [routeIntent, installedBrowsers, installedApplications, routeResolution])
  const freshChoices = useMemo(() => {
    const choices: FreshSurfaceSuggestion[] = [...freshSuggestions]
    for (const decision of routeResolution?.requirements ?? []) {
      const requirement = routeIntent.requirements[decision.requirementIndex]
      if (!requirement || requirement.freshness === 'existing') continue
      for (const alternative of decision.alternatives) {
        const record = resolveSurfaceApplication(alternative.application, installedApplications)
        if (!record || record.opening === 'none' || choices.some((choice) => choice.bundleIdentifier === record.bundleIdentifier)) continue
        const url = record.kind === 'browser' ? requirement.initialResource?.value ?? 'https://www.google.com' : null
        choices.push({
          application: record.application,
          bundleIdentifier: record.bundleIdentifier,
          url,
          reason: record.kind === 'browser' ? 'Another compatible browser for this route' : `Another compatible ${record.capability.replaceAll('_', ' ')} app`,
        })
      }
    }
    return choices
  }, [freshSuggestions, installedApplications, routeIntent, routeResolution])
  const saveRouteApplicationPreference = (capability: WorkSurfaceCapability, bundleIdentifier: string, application: string) => doComputerTask(async () => {
    await invoke({ kind: 'computer.surface_preferences.set', capability, mode: 'specific_application', bundleIdentifier, source: 'confirmed_override' })
    const prepared = await invoke<{ intent: WorkSurfaceIntent; selection: WorkSurfaceIntentSelection; resolution: WorkSurfaceResolution; applications: LiveComputerApplicationIdentity[] }>({
      kind: 'computer.route.infer', runId: run.id, providerId: provider?.id ?? liveProviderId,
    })
    setRouteIntent(prepared.intent)
    setRouteSelection(prepared.selection)
    setRouteResolution(prepared.resolution)
  }, `${application} is now your default for ${capability.replaceAll('_', ' ')}`)
  const routeEditorRef = useRef<HTMLElement | null>(null)
  // The picker opens below the route card; bring it into view so a Change
  // click never looks like nothing happened (2026-09-03).
  useEffect(() => {
    if (selecting) routeEditorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selecting])
  const closeFreshWindows = () => doComputerTask(
    async () => invoke({ kind: 'computer.surface.close_fresh', runId: null }),
    'Closed the windows Carve opened',
  )
  const updateRouteDraft = (update: (current: LiveWindowRouteStep[]) => LiveWindowRouteStep[]) => {
    routeStartKeyRef.current = `route-${run.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setRouteDraft(current => bindWindowRouteDraft(update(current), routeIntent))
  }
  const addFresh = (bundleIdentifier: string, application: string, url: string | null, reason: string) => {
    updateRouteDraft((current) => {
      const key = `fresh:${bundleIdentifier}:${url ?? ''}`
      if (current.some((entry) => liveWindowRouteStepKey(entry) === key)) return current
      const addedRecord = resolveSurfaceApplication(application, installedApplications)
      const entry: LiveWindowRouteStep = {
        kind: 'fresh', source: 'fresh', application, bundleIdentifier, url, reason, authority: 'input',
        role: url ? 'research' : 'workspace',
        purpose: url ? 'Research and verify source information' : 'Complete the approved task',
      }
      const replacementIndex = addedRecord ? current.findIndex((candidate) => {
        const candidateApplication = candidate.kind === 'fresh' ? candidate.application : candidate.target.application
        return resolveSurfaceApplication(candidateApplication, installedApplications)?.capability === addedRecord.capability
      }) : -1
      if (replacementIndex >= 0) return current.map((candidate, index) => index === replacementIndex ? {
        ...entry,
        ...(candidate.requirementId ? { requirementId: candidate.requirementId } : {}),
        authority: candidate.authority,
        role: candidate.role,
        purpose: candidate.purpose,
      } : candidate)
      if (current.length >= 4) {
        notify('A route can use at most four windows', 'warning')
        return current
      }
      return url
        ? [entry, ...current.map((item) => routeIntent.version !== 3 && item.role === 'workspace' ? { ...item, role: 'destination' as const, purpose: 'Build the requested result' } : item)]
        : [...current, entry]
    })
  }
  const toggleTarget = (target: LiveComputerTarget) => {
    updateRouteDraft((current) => {
      const existing = current.find((entry) => entry.kind === 'existing' && entry.target.windowId === target.windowId && entry.target.bundleIdentifier === target.bundleIdentifier)
      if (existing) {
        const remaining = current.filter((entry) => entry !== existing)
        return remaining
      }
      const targetRecord = resolveSurfaceApplication(target.application, installedApplications)
      const replacementIndex = targetRecord ? current.findIndex((entry) => {
        const application = entry.kind === 'fresh' ? entry.application : entry.target.application
        return resolveSurfaceApplication(application, installedApplications)?.capability === targetRecord.capability
      }) : -1
      if (replacementIndex >= 0) return current.map((entry, index) => index === replacementIndex ? {
        kind: 'existing' as const,
        source: 'existing' as const,
        ...(entry.requirementId ? { requirementId: entry.requirementId } : {}),
        target,
        authority: entry.authority,
        role: entry.role,
        purpose: entry.purpose,
      } : entry)
      if (current.length >= 4) {
        notify('A route can use at most four windows', 'warning')
        return current
      }
      const role: LiveComputerSurfaceRole = current.length === 0 ? 'workspace' : current.some((entry) => entry.role === 'research') ? 'destination' : 'reference'
      return [...current, {
        kind: 'existing',
        source: 'existing',
        target,
        authority: 'input',
        role,
        purpose: role === 'destination' ? 'Build the requested result' : 'Complete the approved task',
      }]
    })
  }
  const updateRouteStep = (key: string, update: Partial<Pick<LiveWindowRouteStep, 'authority' | 'role' | 'purpose'>>) => {
    updateRouteDraft((current) => current.map((entry) => liveWindowRouteStepKey(entry) === key
      ? { ...entry, ...update } as LiveWindowRouteStep
      : entry))
  }
  const removeRouteStep = (key: string) => updateRouteDraft((current) => current
    .filter((entry) => liveWindowRouteStepKey(entry) !== key)
    )
  const start = () => {
    if (!routeDraft.length || routeStartInFlightRef.current) return Promise.resolve()
    routeStartInFlightRef.current = true
    setRouteStarting(true)
    setRouteStartError(null)
    return doComputerTask(async () => {
      if (!provider) throw new Error('Choose a visual provider before starting')
      try {
      const startRoute = liveWindowRouteStartEntries(routeDraft)
      const validation = validateRouteAgainstIntent(routeIntent, startRoute)
      if (!validation.ok) throw new Error(validation.explanation)
      await invoke({
        kind: 'computer.route.start',
        runId: run.id,
        providerId: provider.id,
        route: startRoute,
        remoteVisualsAllowed: provider.kind === 'hosted' ? remoteVisualsAllowed : false,
        idempotencyKey: routeStartKeyRef.current,
      })
      } catch (error) {
        // A route that could not start stays on the page with its reason; a
        // toast alone left the button reading "Start task" as if nothing
        // had happened (2026-09-03).
        setRouteStartError(error instanceof Error ? error.message : String(error))
        routeStartKeyRef.current = `route-${run.id}-${Date.now().toString(36)}`
        throw error
      }
      setSelecting(false)
    }, universalMode
      ? 'Task route prepared'
      : run.plan.autonomy === 'approve_plan'
        ? `${routeDraft.length}-window route is ready; review the bounded action plan next`
        : `Task started across ${routeDraft.length} authorized ${routeDraft.length === 1 ? 'window' : 'windows'}`).finally(() => {
      routeStartInFlightRef.current = false
      setRouteStarting(false)
    })
  }
  const approveMissionPlan = () => {
    if (!live) return Promise.resolve()
    return doComputerTask(
      async () => invoke({ kind: 'computer.session.plan.approve', planHash: live.missionPlan.hash }),
      'Mission plan approved; Carve will work continuously and return with the result',
    )
  }
  const decideContextTransfer = (decision: 'approve' | 'decline') => {
    if (!live?.pendingContextTransfer) return Promise.resolve()
    return doComputerTask(
      async () => invoke({ kind: 'computer.session.context_transfer', transferId: live.pendingContextTransfer!.id, action: decision }),
      decision === 'approve' ? `Verified context approved for ${live.pendingContextTransfer.toApplication}` : 'Context transfer declined; destination input remains paused',
    )
  }
  const revisePlan = () => {
    const feedback = planFeedback.trim()
    if (!feedback) return Promise.resolve()
    return doComputerTask(async () => {
      await invoke({ kind: 'computer.session.plan.revise', feedback })
      setPlanFeedback('')
    }, 'Plan revised from your feedback — review the updated steps')
  }
  const startFollowUp = () => {
    const goal = followUpGoal.trim()
    if (!goal) return Promise.resolve()
    return doComputerTask(async () => {
      const result = await invoke<{ kind?: 'continued' | 'new_task' | 'answer' | 'choice_required' }>({ kind: 'computer.session.follow_up', goal })
      setFollowUpGoal('')
      notify(result.kind === 'new_task'
        ? 'New task recognized — review its workspace and budget separately'
        : result.kind === 'answer'
          ? 'Answered from the recorded result; no computer input was sent'
          : result.kind === 'choice_required'
            ? 'Clarify whether this continues the result or starts a new task'
            : universal?.status === 'completed'
              ? 'Follow-up started with the prior result and the same selected window'
              : 'Follow-up prepared on the same window authority — review its plan before Carve continues',
      result.kind === 'choice_required' ? 'warning' : 'positive')
    })
  }
  const provideGuidance = (input: { optionId?: string; directive?: string }) => doComputerTask(async () => {
    await invoke({ kind: 'computer.session.guidance', questionId: live?.pendingGuidance?.id ?? null, ...input })
    setGuidanceDirective('')
  }, input.optionId ? 'Direction received — Carve continues with your choice' : 'Direction received — Carve continues with your guidance')
  const action = (next: 'approve' | 'pause' | 'resume' | 'stop') => doComputerTask(
    async () => invoke({ kind: 'computer.session.action', action: next }),
    next === 'approve' ? 'Approved action processed; Carve checked the visible result' : next === 'pause' ? 'Live computer paused' : next === 'resume' ? 'Live computer resumed' : 'Live computer stopped',
  )
  const approveUniversalBudget = () => {
    const checkpoint = universal?.pendingBudgetCheckpoint
    if (!checkpoint) return Promise.resolve()
    return doComputerTask(
      async () => invoke({ kind: 'computer.universal.budget', action: 'grant', checkpointId: checkpoint.id }),
      'More work approved; Carve is continuing from a fresh view',
    )
  }
  // Switching to Autopilot at a checkpoint also allows the batch that is
  // waiting (Autopilot would have run it), so the person clicks once, not twice.
  const engageUniversalAutopilot = () => {
    if (!universalCheckpoint) return Promise.resolve()
    const checkpointId = universalCheckpoint.id
    return doComputerTask(async () => {
      await invoke({ kind: 'supervision.change', runId: run.id, preset: 'autopilot' })
      await invoke({ kind: 'checkpoint.action', checkpointId, action: 'approve' })
    }, 'Autopilot on for the rest of this run')
  }
  const decideUniversalCheckpoint = (decision: 'approve' | 'decline') => {
    if (!universalCheckpoint) return Promise.resolve()
    return doComputerTask(
      async () => invoke({ kind: 'checkpoint.action', checkpointId: universalCheckpoint.id, action: decision }),
      decision === 'approve' ? 'Exact visual batch approved' : 'Stopped at visual checkpoint',
    )
  }
  const redirectUniversalBudget = () => {
    const text = guidanceDirective.trim()
    if (!text) return Promise.resolve()
    return doComputerTask(async () => {
      await invoke({ kind: 'computer.universal.steer', text, source: 'text' })
      setGuidanceDirective('')
    }, 'Course correction applied without adding budget')
  }
  const retryUniversal = (preset?: 'autopilot') => {
    if (!universal || universal.status !== 'blocked') return Promise.resolve()
    const note = retryNote.trim().slice(0, 1_000)
    return doComputerTask(
      async () => { await invoke({ kind: 'computer.universal.retry', sessionId: universal.id, ...(preset ? { preset } : {}), ...(note ? { note } : {}) }); setRetryNote('') },
      preset ? 'Continuing on Autopilot in the same selected window' : 'Continuing in the same selected window',
    )
  }
  if (!desktop.desktop) return null
  if ((!livePlan || run.status !== 'planned') && !live && !universal) return null

  const actionPoint = live?.pendingAction?.point
  const frameWidth = live?.latestFrame?.width ?? 1
  const frameHeight = live?.latestFrame?.height ?? 1
  const semanticRouteValidation = validateRouteAgainstIntent(
    routeIntent,
    liveWindowRouteStartEntries(routeDraft),
  )
  const resolutionRouteValidation = routeResolution
    ? validateRouteAgainstResolution(routeIntent, routeResolution, liveWindowRouteStartEntries(routeDraft), installedApplications)
    : { ok: true as const }
  const routeValidation = isCopilot(state.product) && routeDraft.length > 1 && (!state.liveComputer.applicationHandoffEnabled || !universalMode) ? { ok: false as const, explanation: 'Working across apps is not enabled in this execution mode.' } : semanticRouteValidation.ok ? resolutionRouteValidation : semanticRouteValidation
  const canStart = permissionsReady && canReasonVisually && routeValidation.ok && run.status === 'planned' && !['observe_only', 'preview'].includes(run.plan.autonomy)
  const sourceUnavailable = Boolean(run.plan.routeSourceTarget && !currentSelectedWorkWindow(run.plan.routeSourceTarget, targets))
  const activeObjective = live?.ledger.objectives.find((objective) => objective.id === live.ledger.currentObjectiveId) ?? null
  const verifiedObjectives = live?.ledger.objectives.filter((objective) => objective.status === 'verified').length ?? 0
  const currentPhase = live ? liveComputerActivityPhase(live) : null
  const progressHealth = live ? liveComputerProgressHealth(live) : null
  const currentBriefing = live?.activityEvents?.at(-1) ?? null
  const recentActivity = live?.activityEvents?.slice(-7).reverse() ?? []
  const universalCurrentBriefing = universal?.activityEvents.at(-1) ?? null
  const universalRecentActivity = universal?.activityEvents.slice(-8).reverse() ?? []
  const universalCompletionResult = universal ? universalComputerCompletionResult(universal, 4_000, true, true) : null
  const assuredCompletionResult = live?.resultSummary ? cleanCompletionResultText(live.resultSummary, 4_000, true) : null
  const universalCompletionKind = universal ? universalComputerCompletionKind(universal.completionAnswer?.question ?? universal.goal) : 'action'
  const universalFailure = universal ? universalComputerFailureFeedback(universal) : null
  const universalTerminalTitle = universal?.status === 'stopped'
    ? 'Stopped by you'
    : universal?.terminalCategory === 'execution_limit'
      ? 'Approved work limit reached'
      : universal?.terminalKind === 'stalled'
        ? 'Carve stopped after no visible progress'
        : universal?.terminalKind === 'verification_rejected'
          ? 'The final check did not accept the answer'
        : universal?.terminalKind === 'environment_failure'
          ? 'The selected window became unavailable'
          : universal?.terminalKind === 'planning_failure'
            ? 'Carve needs a fresh plan'
            : universal?.terminalKind === 'provider_failure'
              ? 'The OpenAI session was interrupted'
              : 'Universal work needs attention'
  const sessionElapsed = live ? liveComputerElapsedMs(live, liveNow) : 0
  const phaseElapsed = live ? liveComputerPhaseElapsedMs(live, liveNow) : 0
  const liveCountdown = live?.pendingApproval?.expiresAt ? Math.max(0, new Date(live.pendingApproval.expiresAt).getTime() - liveNow) : null
  const liveApprovalKind = live?.pendingApproval?.kind ?? null
  const liveHumanApprovalPending = live?.status === 'awaiting_approval' && (liveApprovalKind === 'immediate' || liveApprovalKind === 'group')
  const liveAutomaticActionPending = live?.status === 'awaiting_approval' && liveApprovalKind === 'automatic'
  const permissionGuidance = status.screenRecording !== 'granted' && status.accessibility !== 'granted'
    ? { title: 'Two macOS grants are required.', detail: 'Enable Screen Recording for Carve Live Computer, then enable Accessibility for Carve.' }
    : status.screenRecording !== 'granted'
      ? { title: 'Screen Recording is required.', detail: 'Enable Carve Live Computer in macOS so it can read only the window you select.' }
      : { title: 'Accessibility is required.', detail: 'Enable Carve in macOS. Carve, not the capture helper, sends only contract-authorized input events.' }

  return (
    <>
      {universal?.status === 'awaiting_checkpoint' && universal.pendingPlanReview ? <Dialog className="visual-checkpoint-dialog" eyebrow="Plan ready" icon={<ListChecks size={24} />} title="Review the approach" description={`Work in ${universal.target.application} waits for your approval.`} onDismiss={() => undefined} dismissible={false}>
        <ol className="approval-plan-steps">{universal.pendingPlanReview.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        <p className="approval-plan-scope">{universal.target.title} · Only the requested task in this window.</p>
        <details className="approval-plan-editor"><summary>Edit plan</summary><form onSubmit={event => { event.preventDefault(); void doComputerTask(async () => invoke({ kind: 'computer.session.plan.revise', feedback: planFeedback }), 'Updating the plan for your review') }}>
          <textarea className="approval-plan-feedback" aria-label="Edit plan" value={planFeedback} onChange={event => setPlanFeedback(event.target.value)} maxLength={1000} placeholder="What should change?" disabled={busy} />
          <Button type="submit" variant="secondary" disabled={busy || !planFeedback.trim()}>Update plan</Button>
        </form></details>
        <div className="dialog__actions"><Button variant="secondary" disabled={busy} onClick={() => void decideUniversalCheckpoint('decline')}>Cancel task</Button><Button disabled={busy || Boolean(universal.pendingPlanReview.revisionFeedback)} onClick={() => void doComputerTask(async () => invoke({ kind: 'computer.session.plan.approve', planHash: universal.pendingPlanReview!.hash }), 'Plan approved')}>Approve &amp; start</Button></div>
      </Dialog> : universal?.status === 'awaiting_checkpoint' && universalCheckpoint ? <UniversalCheckpointDialog
        checkpoint={universalCheckpoint}
        liveActions={state.checkpointLivePreviews?.find((preview) => preview.checkpointId === universalCheckpoint.id)?.actions ?? null}
        application={universal.target.application}
        busy={busy}
        onDecision={(decision) => void decideUniversalCheckpoint(decision)}
        onAutopilot={run.plan.hashVersion === 2 ? () => void engageUniversalAutopilot() : null}
      /> : null}
      {universal?.status === 'awaiting_budget' && universal.pendingBudgetCheckpoint?.forecast.recommendation !== 'change_approach' ? <UniversalBudgetApprovalDialog
        checkpoint={universal.pendingBudgetCheckpoint!}
        application={universal.target.application}
        busy={busy}
        onApprove={() => void approveUniversalBudget()}
        onStop={() => void action('stop')}
      /> : null}
      <Card className={`live-computer ${hasSession ? 'live-computer--active' : ''}`} elevated>
      <div className="live-computer__heading">
        <div className="live-computer__emblem"><MousePointer2 size={20} /></div>
        <div><div className="eyebrow">Live computer · {(universal?.actionEngine ?? state.liveComputer.actionEngine) === 'openai_thin_v1' ? 'Thin · OpenAI' : (universal?.actionEngine ?? state.liveComputer.actionEngine) === 'compact_v1' ? 'Compact · Preview' : universal || universalMode ? 'Universal' : 'Assured'}</div><h2>{universal
          ? `${universalTerminal ? 'Result from' : universal?.status === 'paused' ? 'Paused in' : 'Working in'} ${universal.target.application}`
          : live
            ? live.status === 'initializing' ? `Preparing your follow-up in ${live.target.application}` : live.targets.length > 1 ? `Working in ${live.target.application} · ${live.targets.length}-surface mission` : `Controlling ${live.target.application}`
            : 'Your work route'}</h2><p>{universal
          ? universal.actionEngine === 'compact_v1' ? 'Carve uses compact decisions and bounded programs, rechecks targets before input, and independently checks the final result.' : 'OpenAI decides and executes complete visual action batches continuously. Carve constrains input to this exact selected window and keeps stop, limits, provider safety checks, and audit active.'
          : live
            ? live.status === 'initializing' ? 'Carve is resolving the earlier result, destination, and bounded strategy before any input is enabled.' : `The display is a fresh local frame. Carve keeps deciding sequentially under ${humanize(live.autonomy)} supervision and stops only at its configured decision boundary.`
            : 'Review app and window sharing below. Carve opens windows only after you approve the route.'}</p></div>
        <Pill tone={universal ? universal.terminalKind === 'partial' ? 'warning' : universal.status === 'blocked' ? 'danger' : universal.status === 'completed' ? 'positive' : universalTerminal ? 'neutral' : 'warning' : liveHumanApprovalPending || live?.status === 'awaiting_plan_approval' ? 'warning' : live?.status === 'ready' || liveAutomaticActionPending ? 'positive' : terminal ? 'neutral' : !catalogAllowed ? 'neutral' : permissionsReady && !routeLoading && routeValidation.ok ? 'positive' : 'warning'}>{universal ? universal.terminalKind === 'partial' ? 'Partly done' : humanize(universal.status) : live ? liveAutomaticActionPending ? 'Following approved plan' : humanize(live.status) : !permissionsReady ? 'Permission needed' : !catalogAllowed ? 'Your choice' : routeLoading ? 'Choosing route' : routeValidation.ok ? 'Ready to run' : 'Route needs review'}</Pill>
      </div>

      {hasSession && provider ? <div className="sharing-status"><Cloud size={15} /><span><strong>AI service: {sharingRecipient(state.providers.find(entry => entry.id === (live?.providerId ?? universal?.providerId)) ?? provider)}</strong><small>Authorized window images, visible text, controls and task context · {live?.target.application ?? universal?.target.application} — {live?.target.title ?? universal?.target.title}</small></span><button type="button" onClick={onSettings}>Sharing settings</button></div> : null}

      {!permissionsReady && !hasSession ? (
        <div className="live-computer__permissions">
          <div><ShieldAlert size={18} /><span><strong>{permissionGuidance.title}</strong><small>{permissionGuidance.detail}</small></span></div>
          <div className="live-computer__controls">
            {status.screenRecording !== 'granted' ? <Button variant="secondary" disabled={busy} onClick={() => void requestScreenRecording()}>Request Screen Recording</Button> : null}
            {status.screenRecording !== 'granted' ? <Button variant="ghost" disabled={busy} onClick={() => void openSettings('screen_recording')}>Open Settings</Button> : null}
            {status.accessibility !== 'granted' ? <Button variant="secondary" disabled={busy} onClick={() => void requestAccessibility()}>Request Accessibility</Button> : null}
            <Button variant="ghost" disabled={busy} onClick={() => void check()}><RefreshCw size={14} /> Check again</Button>
          </div>
        </div>
      ) : null}

      {!hasSession && permissionsReady ? (
        <div className="live-computer__setup live-computer__setup--route-first">
          <section className="work-route" aria-label="Carve work route">
            {catalogAllowed ? <header className="work-route__head"><div><span><Sparkles size={13} /> {routeSelection?.source === 'model' ? 'AI-selected route' : 'Recommended route'}</span><h3>{!catalogAllowed ? 'Let Carve find the right apps' : routeLoading ? 'Choosing apps with AI…' : routeDraft.length && routeValidation.ok ? 'Carve knows where to work' : 'Choose where Carve should work'}</h3><p>Carve checks app names locally. With your permission, AI suggests a route. Windows are read only after you allow window sharing.</p></div><Pill tone={routeDraft.length ? 'positive' : 'warning'}>{!catalogAllowed ? 'App-name sharing' : routeDraft.length ? `${routeDraft.length} ${routeDraft.length === 1 ? 'window' : 'windows'}` : 'Needs a window'}</Pill></header> : null}
            {!catalogAllowed && provider ? <div className="sharing-card" aria-label="App-name sharing">
              <strong>Let AI suggest the right apps</strong>
              <p>Send your request and installed app names to {sharingRecipient(provider)} to choose where to work. This includes apps that are closed. No window titles or screen contents are shared in this step.</p>
              <details onToggle={(event) => { if (event.currentTarget.open && installedApplications.length === 0) void invoke<{ applications: LiveComputerApplicationIdentity[] }>({ kind: 'computer.applications.list' }).then(result => setInstalledApplications(result.applications)).catch(error => notify(String(error), 'danger')) }}><summary>See what’s shared</summary><p>App names, identifiers and capabilities, plus your request and any earlier request needed for a follow-up. Carve reads the app list on this Mac.</p><ul className="sharing-apps">{installedApplications.map(app => <li key={app.bundleIdentifier}>{app.application}</li>)}</ul><p>Provider processing and retention apply. Window sharing is a separate choice.</p></details>
              <label className="sharing-choice"><input type="checkbox" checked={rememberCatalog} onChange={event => setRememberCatalog(event.target.checked)} />Remember app-name sharing with this service</label>
              <Button disabled={catalogBusy || busy} onClick={() => void allowCatalog()}>{catalogBusy ? 'Allowing…' : 'Allow and choose apps'}</Button><small>Otherwise, this permission is for this task and its follow-ups. Change these choices anytime in Settings.</small>
            </div> : null}
            {catalogAllowed ? <>
            {routeLoading ? <div className="work-route__loading"><RefreshCw className="spin" size={18} /><span>Sharing app names to choose a route. Screen contents stay on this Mac for now.</span></div> : routeDraft.length ? <ol className="work-route__steps">{routeDraft.map((entry, index) => {
              const key = liveWindowRouteStepKey(entry)
              const application = entry.kind === 'fresh' ? entry.application : entry.target.application
              const detail = entry.kind === 'fresh'
                ? entry.url
                  ? `Will open to ${entry.url.replace(/^https:\/\/(?:www\.)?/u, '').replace(/\/.*$/u, '')} when you start`
                  : resolveSurfaceApplication(application, installedApplications)?.opening === 'new_document'
                    ? 'Will open a blank document when you start'
                    : 'Will open a clean app window when you start'
                : entry.target.title
              const record = resolveSurfaceApplication(application, installedApplications)
              const resolvedRequirement = record ? routeResolution?.requirements.find((candidate) => candidate.capability === record.capability
                && routeIntent.requirements[candidate.requirementIndex]?.role === entry.role) : null
              const bundleIdentifier = entry.kind === 'fresh' ? entry.bundleIdentifier : entry.target.bundleIdentifier
              const oneTimeChoice = Boolean(resolvedRequirement?.selectedApplication && resolvedRequirement.selectedApplication.bundleIdentifier !== bundleIdentifier)
              const selectionDetail = oneTimeChoice ? `${application} is a one-time choice for this route` : resolvedRequirement ? surfaceResolutionExplanation(resolvedRequirement) : null
              return <li key={key}>
                <span className="work-route__number">{index + 1}</span>
                {entry.kind === 'fresh' ? <span className="live-computer__app-icon"><Plus size={17} /></span> : <LiveComputerAppIcon target={entry.target} />}
                <div className="work-route__copy"><span>{entry.kind === 'fresh' ? 'New window' : 'Open now'} · {humanize(entry.role)}</span><strong>{entry.kind === 'fresh' ? `New ${application} window` : `${application} · ${entry.target.title}`}</strong><small>{entry.kind === 'fresh' ? detail : entry.purpose}</small>{routeIntent.version === 3 && entry.purpose ? <small>{entry.purpose}</small> : null}{record?.kind === 'browser' && routeIntent.browserDestinations?.length ? <small>Web destinations in this browser: {routeIntent.browserDestinations.map((destination) => destination.name).join(' → ')}</small> : null}{selectionDetail ? <small className="work-route__selection-reason">{selectionDetail}</small> : null}</div>
                <div className="work-route__step-actions">{oneTimeChoice && record ? <button type="button" className="work-route__save-choice" onClick={() => void saveRouteApplicationPreference(record.capability, bundleIdentifier, application)}>Always use</button> : null}<button type="button" className="work-route__change" onClick={() => { setSelecting(true); setShowAllTargets(false); setTargetApp(entry.kind === 'existing' ? entry.target.bundleIdentifier : 'all') }}>Change</button></div>
              </li>
            })}</ol> : <div className="work-route__empty"><AppWindow size={20} /><div><strong>{sourceUnavailable ? 'The selected window closed or changed' : 'Choose a window for this task'}</strong><span>{sourceUnavailable ? 'Open it again, or choose another window below. Your request is saved.' : 'Choose the window you want Carve to use.'}</span></div></div>}
            <div className="work-route__boundary"><ShieldCheck size={16} /><span>Carve works in the window you authorize. Stop the task before moving to other work.</span></div>
            {catalogAllowed && !routeLoading && provider ? <p className="muted-note">{provider.kind === 'hosted' ? `App-name sharing allowed with ${sharingRecipient(provider)}. Window content is shared only after the permission below.` : 'Routing uses your local model endpoint.'}</p> : null}
            {provider?.kind === 'hosted' ? <label className="live-computer__consent work-route__consent"><input type="checkbox" checked={remoteVisualsAllowed} onChange={(event) => setRemoteVisualsAllowed(event.target.checked)} /><span>Allow images, visible text and controls from these windows, their names, and relevant conversation context to be sent to {sharingRecipient(provider)} for this task. Preparing the plan already shares window content.</span></label> : null}
            {routeStartError ? <div className="work-route__error" role="alert"><ShieldCheck size={14} /> <span>{routeStartError}</span><Button disabled={routeLoading || busy} onClick={() => { preparedRouteRunRef.current = null; setRouteStartError(null); setRouteRetry(value => value + 1) }}>Try again</Button></div> : null}
            {!routeLoading && !routeValidation.ok ? <p className="work-route__error" role="alert"><ShieldCheck size={14} /> <span>{routeValidation.explanation}</span></p> : null}
            <div className="legal-task-disclosure">AI can make mistakes. This task can change content in your signed-in apps. Review the plan and important results; Stop cannot undo completed actions.<LegalLinks compact /></div>
            <footer className="work-route__actions"><Button variant="secondary" disabled={busy} onClick={() => void chooseWindow()}><Pencil size={14} /> Change window</Button><Button disabled={!canStart || busy || !catalogAllowed || routeLoading || routeDraft.length === 0 || (provider?.kind === 'hosted' && !remoteVisualsAllowed)} onClick={() => void start()}>{routeStarting ? <RefreshCw className="spin" size={15} /> : <Play size={15} />} {routeStarting ? 'Preparing…' : universalMode ? 'Start task' : 'Prepare plan'}</Button></footer>
            </> : null}
          </section>

          <details className="work-route__details">
            <summary><BrainCircuit size={16} /><span>Model and safety details</span><small>{provider?.name ?? 'Provider required'} · {routeSelection?.source === 'model' ? 'AI route checked locally' : 'local route fallback'} · permissions ready</small><ChevronDown size={15} /></summary>
            <div className="work-route__details-body">
              <div className="live-computer__provider"><BrainCircuit size={17} /><span><strong>{visualProviders.length === 0 ? 'Connect a compatible vision model to start' : provider?.name ?? 'Select a visual provider'}</strong><small>{canReasonVisually ? provider?.kind === 'hosted' ? 'AI can read the authorized window while preparing the plan.' : 'Requests go to your local model endpoint; its forwarding settings still apply.' : universalMode ? 'Universal mode needs a configured provider with stateful computer-use support.' : 'Live computer use needs vision and structured output.'}</small></span>{visualProviders.length > 0 ? <select aria-label="Live visual provider" value={liveProviderId} onChange={(event) => { setLiveProviderId(event.target.value); setRemoteVisualsAllowed(false) }}>{visualProviders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.model}</option>)}</select> : <Button size="small" variant="secondary" onClick={onSettings}>Open Settings</Button>}</div>
              {!isCopilot(state.product) && provider && ['openai-hosted', 'carve-cloud'].includes(provider.id) ? <div className="live-computer__provider"><Sparkles size={17} /><span><strong>AI for your tasks</strong><small>The choice applies to route selection, planning, actions, and verification. A running session keeps the model it started with.</small></span><select aria-label="AI for your tasks" value={state.liveComputer.modelProfile} disabled={busy} onChange={(event) => void chooseComputerModelProfile(event.target.value as 'adaptive_5_6' | 'astra')}><option value="astra">Astra · highest capability</option><option value="adaptive_5_6">Adaptive · GPT-5.6 Sol + Terra</option></select></div> : null}
              {provider?.kind === 'hosted' && remoteVisualsAllowed ? <label className="live-computer__consent live-computer__consent--remember"><input type="checkbox" checked={sharing?.windowsRemembered === true} onChange={(event) => { const remember = event.target.checked; void doComputerTask(async () => invoke({ kind: 'computer.visuals_consent', providerId: remember ? provider.id : null, remember }), remember ? `Frame-sharing consent remembered for ${provider.name} on this Mac` : 'Frame-sharing consent will be asked each session') }} /><span>Remember window sharing with this service. Each task still uses only the windows you authorize.</span></label> : null}
              <Button variant="ghost" disabled={busy} onClick={() => void check()}><RefreshCw size={14} /> Recheck permissions</Button>
            </div>
          </details>

          {selecting ? <section className="route-editor" aria-label="Change Carve windows" ref={routeEditorRef}>
            <header><div><span>Change route</span><strong>Choose only what this task needs</strong><small>Your current route stays visible above. Adding a fresh window here does not open it yet.</small></div><Button size="small" onClick={() => setSelecting(false)}><Check size={14} /> Done</Button></header>
            <div className="route-editor__fresh">
            {freshChoices.map((freshSuggestion) => { const inRoute = routeDraft.some((entry) => entry.kind === 'fresh' && entry.bundleIdentifier === freshSuggestion.bundleIdentifier && entry.url === freshSuggestion.url); return <button type="button" key={`fresh-${freshSuggestion.bundleIdentifier}-${freshSuggestion.url ?? ''}`} disabled={busy} className={inRoute ? 'is-selected' : ''} onClick={() => addFresh(freshSuggestion.bundleIdentifier, freshSuggestion.application, freshSuggestion.url, freshSuggestion.reason)}><span className="live-computer__fresh-mark"><Plus size={15} /></span><span><strong>New {freshSuggestion.application} window</strong><small>{freshSuggestion.reason}</small></span><b>{inRoute ? 'In route' : 'Use'}</b></button> })}
            </div>
            {!recommending && recommendedTargets.length > 0 ? <section className="route-editor__matches"><header><Sparkles size={13} /><strong>Best matches</strong><small>Based on your request</small></header>{recommendedTargets.slice(0, 3).map((target) => { const selected = routeDraft.some((entry) => entry.kind === 'existing' && entry.target.windowId === target.windowId && entry.target.bundleIdentifier === target.bundleIdentifier); return <button type="button" className={selected ? 'is-selected' : ''} disabled={busy} key={`suggested-${target.windowId}`} onClick={() => toggleTarget(target)}><LiveComputerAppIcon target={target} compact /><span><strong>{target.application} · {target.title}</strong><small>{recommendationReasons.get(`${target.windowId}:${target.bundleIdentifier}`) ?? 'Visible now'}</small></span><b>{selected ? <><Check size={13} /> In route</> : <>Add <ArrowRight size={13} /></>}</b></button> })}</section> : null}
            <button type="button" className="route-editor__all-toggle" onClick={() => setShowAllTargets((current) => !current)}><Search size={15} /><span>{showAllTargets ? 'Hide all windows' : `Search all ${targets.length} eligible windows`}</span><ChevronDown className={showAllTargets ? 'is-open' : ''} size={15} /></button>
            {showAllTargets ? <div className="route-editor__catalog"><div className="live-computer__target-tools"><label className="live-computer__target-search"><Search size={16} /><input type="search" value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder="Search windows or apps" aria-label="Search visible windows" />{targetSearch ? <button type="button" aria-label="Clear search" onClick={() => setTargetSearch('')}><X size={13} /></button> : null}</label><div className="live-computer__app-filters" aria-label="Filter by application"><button type="button" className={targetApp === 'all' ? 'is-active' : ''} onClick={() => setTargetApp('all')}><span className="live-computer__all-apps"><AppWindow size={15} /></span><span>All apps</span><small>{targets.length}</small></button>{targetGroups.map((group) => <button type="button" className={targetApp === group.bundleIdentifier ? 'is-active' : ''} key={group.bundleIdentifier} onClick={() => setTargetApp(group.bundleIdentifier)}><LiveComputerAppIcon target={group.targets[0]!} compact /><span>{group.application}</span><small>{group.targets.length}</small></button>)}</div></div>
              <div className="live-computer__target-results-head"><span>{visibleTargetCount} eligible window{visibleTargetCount === 1 ? '' : 's'}</span><small>Choose up to four</small></div>
              {visibleTargetGroups.length ? <div className="live-computer__target-list">{visibleTargetGroups.map((group) => <section className="live-computer__target-group" key={group.bundleIdentifier}><header><LiveComputerAppIcon target={group.targets[0]!} /><div><strong>{group.application}</strong><small>{group.targets.length} visible window{group.targets.length === 1 ? '' : 's'}</small></div></header><div>{group.targets.map((target) => { const selected = routeDraft.some((entry) => entry.kind === 'existing' && entry.target.windowId === target.windowId && entry.target.bundleIdentifier === target.bundleIdentifier); return <button type="button" className={selected ? 'is-selected' : ''} disabled={busy} key={`${target.windowId}-${target.bundleIdentifier}`} onClick={() => toggleTarget(target)}><span className="live-computer__target-title"><strong>{target.title}</strong><small>{Math.round(target.bounds.width)} × {Math.round(target.bounds.height)} · visible now</small></span><span className="live-computer__target-start">{selected ? 'Remove' : 'Add'} {selected ? <X size={15} /> : <ArrowRight size={15} />}</span></button> })}</div></section>)}</div> : <div className="live-computer__target-empty"><Search size={20} /><strong>No matching windows</strong><span>Try another app or clear the search.</span></div>}
            </div> : null}
            {routeDraft.length ? <details className="route-editor__advanced"><summary><SlidersHorizontal size={14} /> Advanced roles and access</summary><ol>{routeDraft.map((entry, index) => { const key = liveWindowRouteStepKey(entry); const application = entry.kind === 'fresh' ? entry.application : entry.target.application; return <li key={key}><strong>{index + 1}. {application}</strong><label><span>Role</span><select value={entry.role} onChange={(event) => updateRouteStep(key, { role: event.target.value as LiveComputerSurfaceRole, purpose: event.target.value === 'research' ? 'Research and verify source information' : event.target.value === 'destination' ? 'Build the requested result' : event.target.value === 'reference' ? 'Read supporting information' : 'Complete the approved task' })}><option value="research">Research</option><option value="destination">Destination</option><option value="reference">Reference</option><option value="workspace">Workspace</option></select></label><label><span>Access</span><select value={entry.authority} onChange={(event) => updateRouteStep(key, { authority: event.target.value as 'observe' | 'input' })}><option value="input">Control</option><option value="observe">View only</option></select></label><button type="button" aria-label={`Remove ${application}`} onClick={() => removeRouteStep(key)}><X size={14} /></button></li> })}</ol></details> : null}
            <div className="live-computer__ask-first"><ShieldCheck size={15} /><div><strong>Anything else · Ask first</strong><small>Mail, Messages, password managers, and System Settings are never offered.</small></div></div>
            <footer><span>{routeDraft.length} {routeDraft.length === 1 ? 'window' : 'windows'} in route</span><Button onClick={() => setSelecting(false)}><Check size={14} /> Done</Button></footer>
          </section> : null}
        </div>
      ) : null}

      {universal ? <div className="live-computer__session">
        <div className="live-computer__screen" aria-label={`Live preview of ${universal.target.application}`}>
          {frame ? <img src={frame} alt={`Current ${universal.target.application} window`} /> : <div className="live-computer__frame-loading"><RefreshCw className={universalTerminal ? '' : 'spin'} size={22} /><span>{universalTerminal ? 'No final frame is available.' : 'Waiting for OpenAI to request the first selected-window frame…'}</span></div>}
          <div className="live-computer__screen-meta"><span><Eye size={13} /> Exact selected window only</span><span>{universal.latestFrame ? ago(universal.latestFrame.capturedAt) : 'No frame transmitted yet'}</span></div>
        </div>
        <div className="live-computer__console">
          <div className="live-computer__console-head">
            <div className="live-computer__console-title"><small>Universal session goal</small><strong>{universal.goal}</strong></div>
            <div className="live-computer__usage-summary" data-tone={universalTerminal ? 'neutral' : 'warning'} aria-label={`${universal.inputActionsCompleted} of ${universal.maxInputActions} approved inputs and ${universal.providerTurns} model turns`}>
              <Gauge size={16} />
              <span><strong>{universal.inputActionsCompleted} / {universal.maxInputActions}</strong><small>Approved inputs</small></span>
              <span><strong>{universal.providerTurns}</strong><small>Model turns</small></span>
            </div>
          </div>
          <div className="live-computer__ledger live-computer__ledger--universal" aria-label="Universal session metrics">
            <span><small>Current state</small><strong>{universalTerminal ? humanize(universal.status) : universalCurrentBriefing?.headline ?? universal.activity.at(-1) ?? 'Starting'}</strong></span>
            <span><small>Architecture</small><strong>Provider-owned visual loop</strong></span>
            <span><small>Usage</small><strong>{universal.inputTokens === null ? 'Unknown' : universal.inputTokens.toLocaleString()} in · {universal.outputTokens === null ? 'unknown' : universal.outputTokens.toLocaleString()} out</strong></span>
            <span><small>Local settling</small><strong>{universal.providerWaitsAbsorbed} waits absorbed · {universal.settleProbes} probes · {(universal.settleDurationMs / 1_000).toFixed(1)}s</strong></span>
            <span><small>Loop recovery</small><strong>{universal.noProgressBatches} no-progress · {universal.repeatedBatchesDetected} repeats · {universal.batchesSuppressed} suppressed</strong></span>
          </div>
          {state.liveComputer.freshWindows.length > 0 && universalTerminal ? <div className="live-computer__fresh-cleanup"><span><AppWindow size={15} /> Carve opened {state.liveComputer.freshWindows.length} {state.liveComputer.freshWindows.length === 1 ? 'window' : 'windows'} for this task. The result is there; nothing closes on its own.</span><Button size="small" variant="secondary" disabled={busy} onClick={() => void closeFreshWindows()}><X size={13} /> Close Carve’s {state.liveComputer.freshWindows.length === 1 ? 'window' : 'windows'}</Button></div> : null}
          {universal.status === 'completed' ? <section className="live-computer__completion live-computer__completion--universal" aria-live="polite">
            <header><CheckCircle2 size={19} /><div><small>{universalCompletionKind === 'answer' ? 'Answer ready' : 'Work complete'}</small><strong>{universalCompletionKind === 'answer' ? 'Here’s what Carve found' : 'Carve finished the requested work'}</strong></div></header>
            <div className="live-computer__completion-result"><small>{universal.completionAnswer ? `Answer to “${universal.completionAnswer.question}”` : universalCompletionKind === 'answer' ? 'Answer' : 'Result'}</small><div><ResultText text={universalCompletionResult ?? 'Done.'} /></div></div>
            <form className="live-computer__plan-revision live-computer__plan-revision--follow-up" onSubmit={(event) => { event.preventDefault(); void startFollowUp() }}>
              <span className="live-computer__plan-revision-label">What should Carve do next?</span>
              <textarea
                rows={2}
                value={followUpGoal}
                onChange={(event) => setFollowUpGoal(event.target.value)}
                maxLength={1000}
                placeholder="Ask a follow-up about this result…"
                aria-label="Ask Carve a follow-up about this Universal result"
                disabled={busy}
              />
              <div className="live-computer__plan-revision-actions">
                <small>The result and selected window stay in context.</small>
                <span>
                  <DictationButton
                    enabled={state.dictation.configured}
                    disabled={busy}
                    notify={notify}
                    field={{ value: followUpGoal, onChange: setFollowUpGoal }}
                  />
                  <Button type="submit" variant="secondary" disabled={busy || !followUpGoal.trim()}>{busy ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />} Ask follow-up</Button>
                </span>
              </div>
            </form>
            <footer><ShieldCheck size={13} /><span>{universal.actionEngine === 'compact_v1' ? 'Final result independently checked against observed evidence.' : 'Model-reported result · Carve did not independently verify it.'} Follow-ups start a fresh task in the same selected window.</span></footer>
          </section>
            : universal.status === 'safety_check' ? <div className="live-computer__outcome"><ShieldAlert size={17} /><span><strong>Provider safety review required</strong><small>{universal.reason ?? 'No further input was sent.'}</small>{universal.pendingSafetyChecks.map((check) => <small key={check.id}>{check.code}: {check.message}</small>)}</span></div>
              : universal.status === 'blocked' ? <section className="live-computer__failure" aria-live="assertive" role="alert">
                <header><span><AlertTriangle size={19} /></span><div><small>{universalFailure?.canRetry ? 'Ready to continue' : 'Work stopped safely'}</small><strong>{universalFailure?.label.replace(/^Carve · /u, '') ?? universalTerminalTitle}</strong><p>{universalFailure?.message ?? 'Carve stopped before finishing this task. It is no longer clicking or typing.'}</p></div></header>
                {universal.terminalText?.trim() ? <p className="live-computer__failure-report">{universal.terminalText}</p> : null}
                <div className="live-computer__failure-facts"><span><small>Progress preserved</small><strong>{universal.inputActionsCompleted} inputs · {universal.providerTurns} turns</strong></span><span><small>Window</small><strong>{universal.target.application}</strong></span><span><small>Input state</small><strong>No further input sent</strong></span></div>
                {universalFailure?.canRetry ? <form className="live-computer__failure-continue" onSubmit={(event) => { event.preventDefault(); void retryUniversal() }}>
                  <input value={retryNote} maxLength={1_000} onChange={(event) => setRetryNote(event.target.value)} placeholder="Add a note for Carve (optional): what to do differently" aria-label="Optional note on how Carve should continue" />
                  <Button type="submit" disabled={busy}>{busy ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />} Continue</Button>
                </form> : null}
                <footer><span><ShieldCheck size={14} /> {universalFailure?.canRetry ? 'Continue starts a fresh attempt in this window with what Carve already found. Carve checks the current window before taking another step.' : 'Carve will not send any more input for this task.'}</span></footer>
              </section>
                : universal.status === 'stopped' ? <div className="live-computer__outcome"><AlertTriangle size={17} /><span><strong>{universalTerminalTitle}</strong><small>{universal.reason ?? 'No further input will be sent.'}</small><small>This session cannot send any more computer input.</small></span></div>
                : universal.status === 'awaiting_checkpoint' && universalCheckpoint ? <div className="live-computer__ready live-computer__ready--checkpoint" aria-live="polite"><div><UserRoundCheck size={17} /><span><strong>Waiting for your decision</strong><small>The exact batch is held with no input sent. Its approval details are open in the decision window.</small></span></div></div>
                : universal.status === 'awaiting_budget' && universal.pendingBudgetCheckpoint ? <section className="live-computer__budget-checkpoint" aria-live="assertive">
                  <header><span><Gauge size={18} /></span><div><small>Carve is paused</small><strong>{universal.pendingBudgetCheckpoint.forecast.recommendation === 'change_approach' ? 'Carve recommends a fresh approach before continuing' : 'Carve needs your approval to do more work'}</strong><p>{universal.pendingBudgetCheckpoint.forecast.recommendation === 'change_approach' ? universal.pendingBudgetCheckpoint.forecast.rationale : 'Carve has used the amount of work you approved for this task. Nothing else will happen until you choose.'}</p></div></header>
                  <div className="live-computer__budget-meter"><span style={{ width: `${Math.min(100, (universal.pendingBudgetCheckpoint.usedInputs / Math.max(1, universal.pendingBudgetCheckpoint.approvedInputs)) * 100)}%` }} /></div>
                  <div className="live-computer__budget-facts"><span><small>Work so far</small><strong>{universal.pendingBudgetCheckpoint.usedInputs} on-screen steps completed</strong></span><span><small>Likely to finish</small><strong>About {universal.pendingBudgetCheckpoint.forecast.estimatedRemainingInputs} more steps · {universal.pendingBudgetCheckpoint.forecast.estimatedAdditionalMinutes} min</strong></span><span><small>Your approval adds</small><strong>Up to {universal.pendingBudgetCheckpoint.extensionInputs} more on-screen actions</strong></span></div>
                  <div className="live-computer__budget-remaining"><small>Steps to check</small><ol>{universal.pendingBudgetCheckpoint.forecast.remainingSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>
                  {universal.pendingBudgetCheckpoint.forecast.recommendation === 'change_approach'
                    ? <form className="live-computer__plan-revision" onSubmit={(event) => { event.preventDefault(); void redirectUniversalBudget() }}>
                      <textarea rows={2} value={guidanceDirective} onChange={(event) => setGuidanceDirective(event.target.value)} maxLength={4000} placeholder="Describe a different in-scope route…" aria-label="Course-correct Carve without adding budget" disabled={busy} />
                      <div className="live-computer__plan-revision-actions"><span><DictationButton enabled={state.dictation.configured} disabled={busy} notify={notify} field={{ value: guidanceDirective, onChange: setGuidanceDirective }} /><Button type="submit" disabled={busy || !guidanceDirective.trim()}>{busy ? <RefreshCw className="spin" size={14} /> : <ArrowRight size={14} />} Change approach</Button></span></div>
                    </form>
                    : <footer><span><ShieldCheck size={14} /> Your task, selected window, permissions, and safety rules stay exactly the same.</span><Button disabled={busy || !universal.pendingBudgetCheckpoint.canGrant} onClick={() => void approveUniversalBudget()}>{busy ? <RefreshCw className="spin" size={14} /> : <Play size={14} />} {universal.pendingBudgetCheckpoint.canGrant ? 'Approve more work' : 'Cannot add more work'}</Button></footer>}
                </section>
                : universal.status === 'awaiting_steering_review' ? <div className="live-computer__outcome"><ShieldAlert size={17} /><span><strong>This correction goes beyond your approved task</strong><small>{universal.pendingSteeringReview?.summary ?? 'Carve needs your approval before making this change.'}</small><small>The correction wasn’t applied. Adjust it, start a new task, or continue without it.</small></span></div>
                  : <div className="live-computer__ready"><div><Activity size={17} /><span><strong>{universal.status === 'paused' ? 'Paused — no computer input can be sent' : universal.status === 'awaiting_checkpoint' ? 'Waiting at a checkpoint — the held batch has not run' : universal.status === 'pausing' ? 'Pausing at the next action boundary' : universal.status === 'replanning' ? 'Applying your course correction' : 'Carve is choosing the next step'}</strong><small>{universalCurrentBriefing?.detail ?? universal.activity.at(-1) ?? 'Starting the stateful computer loop…'}</small></span></div></div>}
          {universalTerminal ? <details className="live-computer__activity-disclosure"><summary><span>View activity</span><small>{universalRecentActivity.length} recent event{universalRecentActivity.length === 1 ? '' : 's'}</small><ChevronDown size={14} /></summary><ol className="live-computer__activity" aria-label="Universal activity report">{universalRecentActivity.map((entry) => <li key={entry.id}><span><Check size={12} /></span><span><strong>{entry.headline}</strong>{entry.detail ? <small>{entry.detail}</small> : null}</span></li>)}</ol></details> : <ol className="live-computer__activity" aria-label="Universal activity report">{universalRecentActivity.map((entry, index) => <li key={entry.id}><span>{index === 0 ? <Activity size={13} /> : <Check size={12} />}</span><span><strong>{entry.headline}</strong>{entry.detail ? <small>{entry.detail}</small> : null}</span></li>)}</ol>}
          {!universalTerminal ? <div className="live-computer__stop"><span><ShieldCheck size={14} /> {universal.status === 'awaiting_budget' ? 'No held input has run. Continue adds only the shown resource allowance; Stop ends the session here.' : universal.status === 'awaiting_checkpoint' ? universalCheckpoint ? 'The exact batch is held. Approve or stop it in the decision window.' : 'The exact batch is held while its approval controls load; no input has run.' : 'Press F4 or use the window capsule to type or dictate a correction. Pause stops before the next action; Stop cancels the provider request.'}</span><div className="live-computer__stop-actions">{universal.status === 'awaiting_budget' || universal.status === 'awaiting_checkpoint' ? null : universalPaused ? <button type="button" disabled={busy} onClick={() => void action('resume')}><Play size={13} /> {universal.status === 'awaiting_steering_review' ? 'Continue without correction' : 'Resume task'}</button> : <button type="button" disabled={busy || universal.status === 'pausing'} onClick={() => void action('pause')}><CirclePause size={13} /> {universal.status === 'pausing' ? 'Pausing…' : 'Pause session'}</button>}<button className="live-computer__stop-button" type="button" disabled={busy} onClick={() => void action('stop')}><Square size={13} fill="currentColor" /> Stop session</button></div></div> : null}
        </div>
      </div> : null}

      {live ? <div className="live-computer__session">
        <div className="live-computer__screen" aria-label={`Live preview of ${live.target.application}`}>
          {frame ? <img src={frame} alt={`Current ${live.target.application} window`} /> : <div className="live-computer__frame-loading"><RefreshCw className="spin" size={22} /><span>Reading the selected window locally…</span></div>}
          {actionPoint && live.pendingAction ? <div className="live-computer__cursor" style={{ left: `${Math.max(0, Math.min(100, (actionPoint.x / frameWidth) * 100))}%`, top: `${Math.max(0, Math.min(100, (actionPoint.y / frameHeight) * 100))}%` }}><MousePointer2 size={24} /><span>{live.pendingAction.targetLabel ?? 'Proposed target'}</span></div> : null}
          <div className="live-computer__screen-meta"><span><Eye size={13} /> Active authorized window · {live.target.application}</span><span>{live.latestFrame ? ago(live.latestFrame.capturedAt) : 'Waiting for frame'}</span></div>
        </div>
        <div className="live-computer__console">
          <div className="live-computer__console-head">
            <div className="live-computer__console-title"><small>Session contract</small><strong>{live.goal}</strong></div>
            <div className="live-computer__usage-summary" data-tone={liveBudgetTone} aria-label={`${live.actionCount} of ${live.maxActions} steps and ${Math.max(0, (live.maxDurationMinutes ?? 15) - Math.floor((live.activeDurationMs ?? 0) / 60_000))} active minutes left`}>
              <Gauge size={16} />
              <span><strong>{live.actionCount} / {live.maxActions}</strong><small>Steps used</small></span>
              <span><strong>{Math.max(0, (live.maxDurationMinutes ?? 15) - Math.floor((live.activeDurationMs ?? 0) / 60_000))} min</strong><small>Time left</small></span>
            </div>
          </div>
          {currentPhase && progressHealth ? <section className={`live-computer__briefing live-computer__briefing--${progressHealth}`} aria-live="polite" aria-label="What Carve is doing now">
            <div className="live-computer__briefing-main">
              <span className="live-computer__briefing-icon"><LiveComputerPhaseIcon phase={currentPhase} size={18} /></span>
              <div>
                <small><span className="live-computer__briefing-pulse" />Now · {humanize(currentPhase)}</small>
                <strong>{currentBriefing?.headline ?? live.activity.at(-1) ?? 'Working through the approved plan'}</strong>
                {currentBriefing?.detail ? <p>{currentBriefing.detail}</p> : null}
              </div>
            </div>
            <div className="live-computer__briefing-metrics" aria-label="Live timing and progress health">
              <span><small>Total time</small><strong><Clock3 size={13} /> {formatLiveDuration(sessionElapsed)}</strong></span>
              <span><small>This phase</small><strong>{formatLiveDuration(phaseElapsed)}</strong></span>
              <span><small>Progress signal</small><strong><i aria-hidden="true" /> {liveComputerProgressHealthLabel(progressHealth)}</strong></span>
            </div>
            <p className="live-computer__briefing-health">{liveComputerProgressHealthDetail(live, progressHealth)}</p>
          </section> : null}
          <div className="live-computer__ledger live-computer__ledger--assured" aria-label="Live task ledger">
            <span><small>Current objective</small><strong>{activeObjective?.instruction ?? 'Outcome verification complete'}</strong></span>
            <span><small>Route</small><strong>{live.ledger.route ?? 'Establishing one route'}</strong></span>
            <span><small>Progress</small><strong>{verifiedObjectives} / {live.ledger.objectives.length} objectives · {live.ledger.clauses.length - live.ledger.coverage.uncoveredClauseIds.length} / {live.ledger.clauses.length} clauses covered</strong></span>
          </div>
          {live.ledger.outcomeContract?.requirements?.products.map(product => {
            const resolution = live.ledger.requirementResolutions?.find(r => r.requirementId === product.id)
            const acquiredArtifact = live.ledger.artifacts.find(a => a.requirementId === product.id && a.coverage.complete)
            const acquired = Boolean(acquiredArtifact)
            const status = resolution?.status === 'conflicted' ? 'Source needs review'
              : acquired ? (live.status === 'completed' ? 'Result verified' : (live.ledger.outcomeContract?.effects.length ? 'Content captured · destination verification pending' : 'Content verified'))
              : resolution?.status === 'unresolved' ? 'Reading the source' : 'Gathering required information'
            return <div className="live-computer__ledger" key={product.id} aria-label="Work product progress"><span><small>{status}</small><strong>{product.description}</strong></span>
              {acquired && product.kind === 'record_set' ? <span><small>Verified source</small><strong>{acquiredArtifact?.rows.length ?? 0} rows · {acquiredArtifact?.columns.length ?? 0} columns</strong></span> : null}</div>
          })}
          {live.status === 'initializing' ? null : live.status === 'awaiting_context_transfer' && live.pendingContextTransfer ? <section className="live-computer__context-transfer" aria-label="Review context transfer">
            <header><ArrowRight size={17} /><div><small>Context handoff · no destination input yet</small><strong>{live.pendingContextTransfer.itemCount} verified {live.pendingContextTransfer.itemCount === 1 ? 'item is' : 'items are'} ready for {live.pendingContextTransfer.toApplication}</strong><span>{live.pendingContextTransfer.fromApplication} → {live.pendingContextTransfer.toApplication} · {live.pendingContextTransfer.title}</span></div></header>
            {live.pendingContextTransfer.columns.length > 0 ? <div className="live-computer__transfer-table"><table><thead><tr>{live.pendingContextTransfer.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{live.pendingContextTransfer.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table><small>Complete payload · {live.pendingContextTransfer.itemCount} row{live.pendingContextTransfer.itemCount === 1 ? '' : 's'}</small></div> : null}
            {live.pendingContextTransfer.content ? <blockquote className="live-computer__transfer-content">{live.pendingContextTransfer.content}</blockquote> : null}
            <div className="live-computer__transfer-provenance"><small>Provenance</small>{live.pendingContextTransfer.provenance.length ? <ul>{live.pendingContextTransfer.provenance.map((source) => <li key={source}>{source}</li>)}</ul> : <span>No separate source labels were recorded.</span>}<code>{live.pendingContextTransfer.payloadSha256.slice(0, 16)}…</code></div>
            <p><ShieldCheck size={13} /> Only this verified artifact will cross the window boundary. Screenshots, page instructions, and model reasoning are excluded.</p>
            <div className="live-computer__proposal-actions"><Button variant="secondary" disabled={busy} onClick={() => void decideContextTransfer('decline')}>Keep it here</Button><Button disabled={busy} onClick={() => void decideContextTransfer('approve')}><Check size={15} /> Pass to {live.pendingContextTransfer.toApplication}</Button></div>
          </section> : live.status === 'awaiting_plan_approval' ? <section className="live-computer__mission-plan" aria-label="Review live mission plan">
            <PlanVisibility sessionId={live.id} planHash={live.missionPlan.hash} />
            <header><ListChecks size={17} /><div><small>Plan ready · bound to {live.missionPlan.windows.length} authorized {live.missionPlan.windows.length === 1 ? 'window' : 'windows'}</small><strong>Review once, then Carve follows one foreground route</strong><span>Scope: {live.missionPlan.scope} · Task limits: {live.missionPlan.maxActions} steps or {live.maxDurationMinutes ?? 15} active minutes</span></div></header>
            {live.missionPlan.stages.length > 1 ? <div className="live-computer__stage-route">{live.missionPlan.stages.map((stage, index) => <div key={stage.id}><span>{index + 1}</span><LiveComputerAppIcon target={live.targets.find((entry) => entry.target.windowId === stage.windowId)?.target ?? live.target} compact /><strong>{stage.application}</strong><small>{stage.title} · {stage.authority === 'input' ? 'Control' : 'View only'}</small>{index < live.missionPlan.stages.length - 1 ? <ArrowRight size={13} /> : null}</div>)}</div> : null}
            <ol>{live.missionPlan.steps.map((step) => <li key={step.id}><span>{step.id.replace('objective_', '')}</span><div><strong>{step.title}</strong><small>{step.application ? `${step.application} · ` : ''}{step.instruction}</small></div></li>)}</ol>
            <p><ShieldCheck size={13} /> {live.missionPlan.routePolicy}</p>
            <form className="live-computer__plan-revision" onSubmit={(event) => { event.preventDefault(); void revisePlan() }}>
              <textarea
                rows={2}
                value={planFeedback}
                onChange={(event) => setPlanFeedback(event.target.value)}
                maxLength={1000}
                placeholder="Adjust the plan in your own words — e.g. “skip the citation step, just summarize the page”"
                aria-label="Describe a plan change in natural language"
                disabled={busy}
              />
              <div className="live-computer__plan-revision-actions"><span><DictationButton
                  enabled={state.dictation.configured}
                  disabled={busy}
                  notify={notify}
                  field={{ value: planFeedback, onChange: setPlanFeedback }}
                /><Button type="submit" variant="secondary" disabled={busy || !planFeedback.trim()}>{busy ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />} Revise plan</Button></span></div>
            </form>
            <div className="live-computer__proposal-actions"><Button variant="secondary" disabled={busy} onClick={() => void action('stop')}>Cancel</Button><Button disabled={busy} onClick={() => void approveMissionPlan()}>{busy ? <RefreshCw className="spin" size={15} /> : <Check size={15} />} {busy ? 'Starting…' : 'Approve & start'}</Button></div>
          </section> : live.status === 'awaiting_guidance' && live.pendingGuidance ? <section className="live-computer__guidance" aria-label="Carve is asking for your direction">
            <header><UserRoundCheck size={17} /><div><small>Your call · no input until you answer</small><strong>{live.pendingGuidance.question}</strong>{live.pendingGuidance.context ? <span>{live.pendingGuidance.context}</span> : null}</div></header>
            <div className="live-computer__guidance-options">
              {live.pendingGuidance.options.map((option) => (
                <button type="button" key={option.id} disabled={busy} className={`live-computer__guidance-chip ${option.mode === 'person_takes_over' ? 'live-computer__guidance-chip--takeover' : ''}`} onClick={() => void provideGuidance({ optionId: option.id })}>
                  <strong>{option.label}</strong>
                  <small>{option.consequence}</small>
                </button>
              ))}
            </div>
            <form className="live-computer__plan-revision" onSubmit={(event) => { event.preventDefault(); if (guidanceDirective.trim()) void provideGuidance({ directive: guidanceDirective.trim() }) }}>
              <textarea
                rows={2}
                value={guidanceDirective}
                onChange={(event) => setGuidanceDirective(event.target.value)}
                maxLength={4000}
                placeholder="Or tell Carve how to proceed in your own words…"
                aria-label="Describe how Carve should proceed"
                disabled={busy}
              />
              <div className="live-computer__plan-revision-actions"><span><DictationButton
                  enabled={state.dictation.configured}
                  disabled={busy}
                  notify={notify}
                  field={{ value: guidanceDirective, onChange: setGuidanceDirective }}
                /><Button type="submit" variant="secondary" disabled={busy || !guidanceDirective.trim()}>{busy ? <RefreshCw className="spin" size={14} /> : <ArrowRight size={14} />} Send direction</Button></span></div>
            </form>
          </section> : live.pendingAction ? <div className="live-computer__proposal"><div><span className="live-computer__proposal-icon"><MousePointer2 size={16} /></span><section><small>{liveAutomaticActionPending ? `Approved-plan transaction · ${live.pendingAction.objectiveId}` : live.pendingApproval?.kind === 'group' ? `Objective checkpoint · ${live.pendingAction.objectiveId}` : live.autonomy === 'approve_plan' ? 'Plan deviation requires approval' : `Next proposed transaction · ${live.pendingAction.objectiveId}`}</small><strong>{live.pendingAction.summary}</strong><span>{live.pendingAction.targetLabel ? `Target: ${live.pendingAction.targetLabel} · ` : ''}{Math.round(live.pendingAction.confidence * 100)}% visual confidence · {humanize(live.pendingAction.risk)}</span>{live.pendingAction.submitPoint ? <span>Then submit with {live.pendingAction.submitTargetLabel ?? `the validated control at ${Math.round(live.pendingAction.submitPoint.x)}, ${Math.round(live.pendingAction.submitPoint.y)}`}.</span> : null}{live.pendingAction.sequence?.length ? <span>Inputs in order: {live.pendingAction.sequence.map((item) => item.kind === 'text' ? `“${item.value}”` : item.kind === 'key' ? item.value.toUpperCase() : `[${item.value}]`).join(' → ')}{live.pendingAction.key ? ` → ${live.pendingAction.key.toUpperCase()}` : ''}</span> : null}<span>Expected: {live.pendingAction.expectedState}</span>{liveAutomaticActionPending ? <span>Runs automatically inside the plan you approved; pause remains available.</span> : liveCountdown !== null ? <span>Runs in {(liveCountdown / 1000).toFixed(1)} seconds unless paused.</span> : live.pendingApproval?.kind === 'group' ? <span>This approval covers only the current part of your task. Carve will ask before starting the next part.</span> : null}</section></div><div className="live-computer__proposal-actions"><Button variant="secondary" disabled={busy} onClick={() => void action('pause')}><CirclePause size={15} /> {liveCountdown !== null ? 'Pause countdown' : 'Pause'}</Button>{live.pendingApproval?.kind !== 'automatic' ? <Button disabled={busy} onClick={() => void action('approve')}><Check size={15} /> {live.pendingApproval?.kind === 'group' ? 'Approve this part' : live.autonomy === 'approve_plan' ? 'Approve this change' : liveCountdown !== null ? 'Run now' : 'Allow this action'}</Button> : null}</div></div> : live.status === 'ready' || live.status === 'acting' || live.status === 'verifying' || live.status === 'reconciling_input' ? null : live.status === 'paused' ? <div className="live-computer__ready"><div><CirclePause size={17} /><span><strong>{live.terminalCategory === 'provider_error' ? 'AI service temporarily unavailable' : 'Paused'}</strong><small>{live.terminalCategory === 'provider_error' ? live.blockedReason ?? 'No input was sent. You can retry the next decision when the service is available.' : 'No input can be sent until you resume.'}</small></span></div><Button disabled={busy} onClick={() => void action('resume')}><Play size={15} /> {live.terminalCategory === 'provider_error' ? 'Retry next decision' : 'Resume task'}</Button></div> : live.status === 'completed' ? <section className="live-computer__completion"><header><ShieldCheck size={17} /><div><small>Task complete</small><strong>{assuredCompletionResult ?? 'The requested outcome was verified.'}</strong></div></header><ol>{live.missionPlan.steps.map((step) => <li key={step.id}><Check size={12} /><span>{step.title}</span></li>)}</ol><p>Completed {live.actionCount} actions across {verifiedObjectives} completed parts. What would you like Carve to do next?</p>
            <form className="live-computer__plan-revision live-computer__plan-revision--follow-up" onSubmit={(event) => { event.preventDefault(); void startFollowUp() }}>
              <span className="live-computer__plan-revision-label">What should Carve do next?</span>
              <textarea
                rows={2}
                value={followUpGoal}
                onChange={(event) => setFollowUpGoal(event.target.value)}
                maxLength={1000}
                placeholder="Ask a follow-up about this result…"
                aria-label="Ask Carve a follow-up on the same window"
                disabled={busy}
              />
              <div className="live-computer__plan-revision-actions"><small>The result stays in context. You will review the next plan before it runs.</small><span><DictationButton
                  enabled={state.dictation.configured}
                  disabled={busy}
                  notify={notify}
                  onTranscript={(transcript) => setFollowUpGoal((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript)}
                /><Button type="submit" variant="secondary" disabled={busy || !followUpGoal.trim()}>{busy ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />} Ask follow-up</Button></span></div>
            </form></section> : <div className="live-computer__outcome">{live.terminalCategory === 'safety_block' ? <ShieldAlert size={17} /> : live.terminalCategory === 'needs_user' ? <UserRoundCheck size={17} /> : <AlertTriangle size={17} />}<span><strong>{liveComputerTerminalTitle(live.status, live.terminalCategory)}</strong><small>{consumerSystemMessage(live.blockedReason ?? live.activity.at(-1) ?? 'Carve has stopped clicking and typing.')}</small></span></div>}
          {recentActivity.length ? <section className="live-computer__timeline" aria-label="Live activity receipt">
            <header><span><Activity size={13} /> Activity receipt</span><small>{recentActivity.length} recent phase{recentActivity.length === 1 ? '' : 's'}</small></header>
            <ol>{recentActivity.map((event, index) => {
              const endedAt = event.endedAt ? new Date(event.endedAt).getTime() : liveNow
              const duration = Math.max(0, endedAt - new Date(event.startedAt).getTime())
              const offset = Math.max(0, new Date(event.startedAt).getTime() - new Date(live.startedAt).getTime())
              return <li className={index === 0 && !event.endedAt ? 'live-computer__timeline-current' : ''} key={event.id}>
                <span className="live-computer__timeline-icon"><LiveComputerPhaseIcon phase={event.phase} size={13} /></span>
                <div><small>{humanize(event.phase)} · +{formatLiveDuration(offset)}</small><strong>{event.headline}</strong>{event.detail ? <p>{event.detail}</p> : null}</div>
                <time dateTime={event.startedAt}>{event.endedAt ? formatLiveDuration(duration) : `${formatLiveDuration(duration)} now`}</time>
              </li>
            })}</ol>
          </section> : <ol className="live-computer__activity" aria-label="Live activity report">{live.activity.slice(-4).reverse().map((entry, index) => <li key={`${entry}-${index}`}><span>{index === 0 ? <Activity size={13} /> : <Check size={12} />}</span>{entry}</li>)}</ol>}
          {!terminal ? <div className="live-computer__stop"><span><ShieldCheck size={14} /> Selected-window control ends immediately.</span><div className="live-computer__stop-actions"><button className="live-computer__stop-button" type="button" disabled={busy} onClick={() => void action('stop')}><Square size={13} fill="currentColor" /> Stop session</button></div></div> : null}
        </div>
      </div> : null}

      <div className="live-computer__boundary"><LockKeyhole size={15} /><span>{(universal?.actionEngine ?? state.liveComputer.actionEngine) === 'compact_v1'
        ? 'Compact Preview works in one authorized window. Only observed controls can be batched; targets are rechecked before input. Your supervision settings, task limits and Stop remain active. The final result receives a separate AI check.'
        : universalMode
        ? 'Frames stay out of learning evidence but are sent to OpenAI using stored Responses state. Input is constrained to the exact selected window; provider safety checks, bounded resources, audit, and emergency stop remain active. Universal mode does not apply Carve’s per-action guardrails or results checked independently.'
        : 'Frames are ephemeral and never become learning evidence. On-screen content is treated as untrusted. New windows, credentials, payments, sharing, permissions, and destructive steps stop for you.'}</span></div>
      </Card>
    </>
  )
}

const universalCheckpointEffectLabels: Record<string, string> = {
  read_only: 'Reads information',
  safe_local: 'Uses this window',
  reversible_local_write: 'Makes a change you can undo',
  external_write: 'Updates another service',
  communication: 'Sends a message',
  submission: 'Submits information',
  financial: 'Makes a payment or purchase',
  destructive: 'Deletes or removes something',
  authentication: 'Signs in or confirms access',
  installation: 'Installs software',
  privilege_escalation: 'Changes permissions',
  confidential_disclosure: 'Shares sensitive information',
  legal_acceptance: 'Accepts terms or an agreement',
  high_impact_decision: 'Makes an important decision',
  unclassified_control: 'Uses a control Carve cannot classify',
  unknown: 'Needs your review',
}

/** Effects that add nothing to the decision once the headline names the reason for the stop. */
const universalCheckpointQuietEffects = new Set(['read_only', 'safe_local'])

const universalCheckpointEffectIcons: Record<string, typeof UserRoundCheck> = {
  financial: CreditCard,
  destructive: Trash2,
  authentication: LockKeyhole,
  privilege_escalation: ShieldCheck,
  installation: Download,
  legal_acceptance: FileCheck,
  communication: Send,
  confidential_disclosure: Eye,
  high_impact_decision: AlertTriangle,
  submission: Check,
}

/** The one-line reason for the stop. A protected effect uses the shared title, scope and verb the
 * capsule shows, so both surfaces say the same thing; otherwise the held batch's own change title leads. */
function universalCheckpointHeadline(checkpoint: CarveState['checkpoints'][number]): { title: string; reason: string; approveLabel: string; effect: string | null } {
  const shared = protectedApprovalReason(checkpoint.effectClasses)
  if (shared) return { title: shared.title, reason: shared.scope, approveLabel: shared.approveLabel, effect: shared.effect }
  const effect = ['unclassified_control', 'external_write', 'reversible_local_write'].find((candidate) => (checkpoint.effectClasses as readonly string[]).includes(candidate)) ?? null
  const reason = effect === 'unclassified_control' ? 'Carve can’t predict what this control does.'
    : effect === 'external_write' ? 'This updates another service.'
      : effect === 'reversible_local_write' ? 'This makes a change you can undo.'
        : checkpoint.reasonCodes.includes('each_input_selected') ? 'You asked Carve to check with you before each action.'
          : 'Carve needs your approval before it continues.'
  return { title: checkpoint.preview.what.split('\n')[0]?.trim() || 'Review these actions', reason, approveLabel: 'Allow these actions', effect }
}

function universalCheckpointData(checkpoint: CarveState['checkpoints'][number]): string {
  const value = checkpoint.preview.data?.trim()
  const legacy = value?.match(/^(\d+) exact payloads? hash-bound; contents not stored in (?:the )?checkpoint$/iu)
  if (legacy) {
    const count = Number(legacy[1])
    return `${count} prepared ${count === 1 ? 'entry is' : 'entries are'} locked to these actions. ${count === 1 ? 'Its' : 'Their'} contents are not saved in this approval record.`
  }
  if (!value || value === 'No payload leaves the selected window in this batch') return 'Carve will not type any prepared text or data in these actions.'
  return value
}

/** A protected-effects stop reads like every other Carve dialog: icon, title, one sentence, actions.
 * It is still a consent surface, so everything approval-material stays visible or one disclosure away:
 * the exact actions, the window, the information involved, any further effects, and the rule that
 * approval covers only these actions. "Nothing has run yet" is said once, in the sentence under the title. */
/** A long held line starts folded and opens in place, so a pasted paragraph never hides the controls around it. */
function FoldedLine({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const folded = foldPreviewText(text)
  if (open || !folded.folded) return <>{text}</>
  return <>{folded.shown} <button type="button" className="dialog__link" onClick={() => setOpen(true)}>Show all</button></>
}

function UniversalCheckpointDialog({ checkpoint, liveActions, application, busy, onDecision, onAutopilot }: {
  checkpoint: CarveState['checkpoints'][number]
  /** Sentences quoting the held text, while the app still holds the batch; otherwise the record's counts are shown. */
  liveActions: string[] | null
  application: string
  busy: boolean
  onDecision: (decision: 'approve' | 'decline') => void
  onAutopilot?: (() => void) | null
}) {
  const headline = universalCheckpointHeadline(checkpoint)
  const Icon = universalCheckpointEffectIcons[headline.effect ?? ''] ?? UserRoundCheck
  const floorEffect = checkpoint.effectClasses.some((effect) => autopilotFloor.has(effect))
  const autopilot = onAutopilot && !floorEffect ? onAutopilot : null
  const where = checkpoint.preview.where ?? application
  const actions = liveActions?.length ? liveActions : checkpoint.preview.what.split('\n').slice(1).map((line) => line.trim()).filter(Boolean)
  const otherEffects = [...new Set(checkpoint.effectClasses)]
    .filter((effect) => effect !== headline.effect && !universalCheckpointQuietEffects.has(effect))
    .map((effect) => universalCheckpointEffectLabels[effect] ?? humanize(effect))
  return (
    <Dialog
      className="protected-checkpoint-dialog"
      icon={<Icon size={24} />}
      tone="warning"
      title={headline.title}
      description={`${headline.reason} Carve is paused in ${where} and hasn’t done this yet.`}
      onDismiss={() => undefined}
      dismissible={false}
    >
      {actions.length > 0 ? <ol className="protected-checkpoint-dialog__actions" aria-label="Actions waiting for your approval">{actions.map((line, index) => <li key={`${index}:${line}`}><FoldedLine text={line} /></li>)}</ol> : null}
      {otherEffects.length > 0 ? <p className="protected-checkpoint-dialog__effects"><span>Also</span> {otherEffects.join(' · ')}</p> : null}
      <details className="protected-checkpoint-dialog__details">
        <summary>Details <ChevronDown size={14} /></summary>
        <dl>
          <dt>Window</dt><dd>{where}</dd>
          <dt>Information involved</dt><dd>{universalCheckpointData(checkpoint)}</dd>
          <dt>After approval</dt><dd>{checkpoint.preview.verification ?? 'Carve checks this window again before continuing.'}</dd>
          {autopilot ? <><dt>Autopilot for the rest</dt><dd>Allows these actions and stops asking for the rest of this run.</dd></> : null}
        </dl>
      </details>
      <small className="dialog__note">Approval covers only these actions. If they or the window change, Carve pauses and asks again.</small>
      <div className="dialog__buttons protected-checkpoint-dialog__buttons">
        <Button variant="secondary" disabled={busy} onClick={() => onDecision('decline')}><X size={15} /> Stop task</Button>
        <div className="protected-checkpoint-dialog__decide">
          {autopilot ? <Button variant="secondary" className="button--autopilot-ghost" disabled={busy} onClick={autopilot}><Gauge size={15} /> Autopilot for the rest</Button> : null}
          <Button disabled={busy} onClick={() => onDecision('approve')}>{busy ? <RefreshCw className="spin" size={15} /> : <Check size={15} />} {headline.approveLabel}</Button>
        </div>
      </div>
    </Dialog>
  )
}

type UniversalBudgetCheckpoint = NonNullable<UniversalComputerSession['pendingBudgetCheckpoint']>

/** A resource checkpoint is a real stop, not an activity update. Lead with
 * the human decision and the practical meaning of approval; keep exact model
 * ceilings available behind a disclosure for people who want to audit them. */
function UniversalBudgetApprovalDialog({ checkpoint, application, busy, onApprove, onStop }: {
  checkpoint: UniversalBudgetCheckpoint
  application: string
  busy: boolean
  onApprove: () => void
  onStop: () => void
}) {
  const forecast = checkpoint.forecast
  const technicalAllowance = [
    checkpoint.extensionInputs > 0 ? `+${checkpoint.extensionInputs} on-screen actions` : null,
    checkpoint.extensionMinutes > 0 ? `+${checkpoint.extensionMinutes} active minutes` : null,
    checkpoint.extensionModelCalls > 0 ? `+${checkpoint.extensionModelCalls} model turns` : null,
    checkpoint.extensionTokens > 0 ? `+${Math.round(checkpoint.extensionTokens / 1_000)}k model tokens` : null,
    checkpoint.extensionVisionFrames > 0 ? `+${checkpoint.extensionVisionFrames} window checks` : null,
  ].filter((value): value is string => Boolean(value))
  return (
    <Dialog
      className="budget-approval-dialog"
      eyebrow="Carve is waiting for you"
      icon={<Gauge size={25} />}
      tone="warning"
      title={checkpoint.cloudUnit ? "Use one more task to continue?" : "Approve a little more work to finish?"}
      description={checkpoint.cloudUnit ? "This will use one additional task from your plan’s allowance. Your work stays paused until you choose." : "Carve has used the amount of work you approved for this task. It is paused and won’t do anything else until you choose."}
      onDismiss={() => undefined}
      dismissible={false}
    >
      <div className="budget-approval-dialog__hold" role="status">
        <span><span />Paused for your approval</span>
        <strong>No clicks, typing, or AI requests are happening now</strong>
      </div>
      <div className="budget-approval-dialog__estimate">
        <span><ListChecks size={22} /></span>
        <div><small>Carve’s best estimate</small><strong>About {forecast.estimatedRemainingInputs} more on-screen steps</strong><p>Likely around {forecast.estimatedAdditionalMinutes} more minute{forecast.estimatedAdditionalMinutes === 1 ? '' : 's'} to finish and check the result. Carve may finish sooner.</p></div>
      </div>
      <div className="budget-approval-dialog__facts">
        {checkpoint.cloudUnit ? <p>This uses one additional task from your plan’s allowance. It does not purchase a pack or upgrade your plan.</p> : null}
        {checkpoint.fundingStatus === 'pending' ? <p role="status">Checking your allowance. Computer input and AI work remain paused.</p> : null}
        {checkpoint.fundingError ? <p role="alert">{checkpoint.fundingError}</p> : null}
        <section><span><MousePointer2 size={17} /></span><div><small>What you’re approving</small><strong>{checkpoint.cloudUnit ? "One additional task from your plan’s allowance. This does not purchase a pack or change your subscription." : `Up to ${checkpoint.extensionInputs} additional on-screen actions, such as clicking, typing, scrolling, or checking the result.`}</strong></div></section>
        <section><span><ShieldCheck size={17} /></span><div><small>What stays the same</small><strong>Your task, the {application} window, permissions, and every safety rule. This approval adds no new access.</strong></div></section>
      </div>
      {forecast.remainingSteps.length > 0 ? <div className="budget-approval-dialog__remaining"><small>Steps to check</small><ol>{forecast.remainingSteps.map((step) => <li key={step}>{step}</li>)}</ol></div> : null}
      <details className="budget-approval-dialog__details">
        <summary>See the exact technical allowance <ChevronDown size={14} /></summary>
        <p>{technicalAllowance.length > 0 ? technicalAllowance.join(' · ') : 'The existing technical allowance already covers the estimate.'}</p>
      </details>
      <div className="budget-approval-dialog__footer">
        <span>Not ready? Stop here keeps the work already completed and ends this task.</span>
        <div>
          <Button variant="secondary" disabled={busy} onClick={onStop}><Square size={14} fill="currentColor" /> Stop here</Button>
          <Button autoFocus disabled={busy || checkpoint.fundingStatus === 'pending' || !checkpoint.canGrant} onClick={onApprove}>{busy ? <RefreshCw className="spin" size={15} /> : <Play size={15} />} {checkpoint.fundingStatus === 'pending' ? 'Checking allowance…' : checkpoint.canGrant ? checkpoint.cloudUnit ? 'Use 1 more task' : 'Approve more work' : 'Cannot add more work'}</Button>
        </div>
      </div>
    </Dialog>
  )
}

interface DelegationMetrics {
  totalRuns: number
  completedRuns: number
  verifiedActions: number
  decidedActions: number
  verificationRate: number
  exceptions: number
  approvalCount: number
  tier: 'Learning' | 'Supervised' | 'Policy-ready'
  progress: number
  nextMilestone: string
}

function delegationMetrics(state: CarveState, procedureId: string | null): DelegationMetrics {
  const relevant = state.runs.filter((run) => !procedureId || run.plan.procedureId === procedureId)
  const actions = relevant.flatMap((run) => run.plan.actions)
  const decided = actions.filter((action) => ['verified', 'blocked', 'failed'].includes(action.status))
  const verifiedActions = decided.filter((action) => action.status === 'verified').length
  const completedRuns = relevant.filter((run) => run.status === 'completed').length
  const exceptions = relevant.filter((run) => ['blocked', 'failed'].includes(run.status)).length
  const verificationRate = decided.length === 0 ? 0 : verifiedActions / decided.length
  const approvalCount = state.approvals.filter((approval) => relevant.some((run) => run.id === approval.runId) && approval.status === 'approved').length
    + state.checkpoints.filter((checkpoint) => relevant.some((run) => run.id === checkpoint.runId) && ['approved', 'consumed'].includes(checkpoint.status) && !checkpoint.reasonCodes.includes('covered_by_explicit_plan_review')).length
  const policyReady = completedRuns >= 10 && verificationRate >= 0.98 && exceptions === 0
  const supervised = completedRuns >= 3 && verificationRate >= 0.9
  const tier = policyReady ? 'Policy-ready' : supervised ? 'Supervised' : 'Learning'
  const progress = policyReady ? 100 : supervised ? Math.min(95, 50 + (completedRuns - 3) * 7) : Math.min(45, completedRuns * 15)
  const nextMilestone = policyReady
    ? 'Eligible for a broader policy review; autonomy never expands automatically.'
    : supervised
      ? `${Math.max(0, 10 - completedRuns)} more verified runs without an exception before policy review.`
      : `${Math.max(0, 3 - completedRuns)} more verified runs to establish a supervised reliability baseline.`
  return { totalRuns: relevant.length, completedRuns, verifiedActions, decidedActions: decided.length, verificationRate, exceptions, approvalCount, tier, progress, nextMilestone }
}

function SimpleWorkWelcome({ onTeach }: { onTeach: () => void }) {
  return (
    <div className="simple-work-welcome">
      <div><ShieldCheck size={17} /><span><strong>Start with the outcome.</strong> You do not need to choose a procedure or explain every step.</span></div>
      <button type="button" onClick={onTeach}>Add examples for repeat work <ArrowRight size={13} /></button>
    </div>
  )
}

function ContextClarificationCard({ context, busy, onSelect, onRecall }: { context: WorkContextSummary; busy: boolean; onSelect: (interpretationId: string) => void; onRecall: () => void }) {
  const resolution = context.resolution
  if (!resolution) return null
  const resources = new Map((context.resources ?? []).map((resource) => [resource.id, resource]))
  return (
    <section className="context-clarification" aria-labelledby="context-clarification-title">
      <div className="context-clarification__intro">
        <div className="context-clarification__icon"><Search size={20} /></div>
        <div>
          <div className="eyebrow">One quick clarification</div>
          <h2 id="context-clarification-title">Which context did you mean?</h2>
          <p>{context.timeWindow.label
            ? `Nothing matched ${context.timeWindow.label} exactly, but Carve found strong related context outside that window.`
            : 'Carve found more than one plausible set of prior context.'} Choose one before it checks capabilities or drafts actions.</p>
        </div>
      </div>
      <div className="context-clarification__choices">
        {resolution.interpretations.map((interpretation) => {
          const matching = interpretation.resourceIds.map((resourceId) => resources.get(resourceId)).filter((resource) => resource !== undefined)
          return (
            <button type="button" key={interpretation.id} disabled={busy} onClick={() => onSelect(interpretation.id)}>
              <span className="context-clarification__choice-head"><strong>{interpretation.label}</strong><small>{Math.round(interpretation.confidence * 100)}% match</small></span>
              <span className="context-clarification__resource-list">
                {matching.slice(0, 4).map((resource) => <span key={resource.id}><AppWindow size={14} /> {resource.title}</span>)}
                {matching.length > 4 ? <span>+{matching.length - 4} more</span> : null}
              </span>
              <span className="context-clarification__use">Use this context <ArrowRight size={15} /></span>
            </button>
          )
        })}
      </div>
      <div className="context-clarification__footer"><span><ShieldCheck size={15} /> History informs the choice but grants no action authority.</span><button type="button" onClick={onRecall}>Inspect all context</button></div>
    </section>
  )
}

function SimpleCapabilityGap({ context, blocker, busy, onContinue, onRecall, onTeach }: { context: WorkContextSummary; blocker: string | null; busy: boolean; onContinue: () => void; onRecall: () => void; onTeach: () => void }) {
  const sourceCount = context.sessions.length + context.moments.length
  const withheldForTopic = context.resolution?.status === 'empty'
    && context.resolution.diagnostics.topicTerms.length > 0
    && context.resolution.diagnostics.rejectedResourceCount > 0
  return (
    <Card className="simple-capability-gap" elevated>
      <div className="simple-capability-gap__main">
        <div className="simple-capability-gap__icon"><Zap /></div>
        <div>
          <div className="eyebrow">{withheldForTopic ? 'Context held back' : 'One thing needed'}</div>
          <h2>{withheldForTopic ? 'Carve could not isolate the right context' : 'Carve needs a safe starting point'}</h2>
          <p>{withheldForTopic
            ? `It found ${context.resolution?.diagnostics.rejectedResourceCount} possible source${context.resolution?.diagnostics.rejectedResourceCount === 1 ? '' : 's'}, but none matched “${context.resolution?.diagnostics.topicTerms.join(' ')}” strongly enough to become an action target.`
            : `Carve found ${sourceCount} relevant source${sourceCount === 1 ? '' : 's'}, but cannot bind this request to an exact desktop action yet. You do not need to choose or connect a tool.`}</p>
          <div className="simple-capability-gap__actions">
            {withheldForTopic ? <Button disabled={busy} onClick={onContinue}><ArrowRight size={15} /> Continue without it</Button> : null}
            {withheldForTopic
              ? <Button variant="secondary" disabled={busy} onClick={onRecall}><Search size={15} /> Review context</Button>
              : <Button disabled={busy} onClick={onRecall}><Search size={15} /> Review context</Button>}
            <Button variant="secondary" onClick={onTeach}><Sparkles size={15} /> Teach this workflow</Button>
          </div>
          {withheldForTopic ? <p className="simple-capability-gap__hint">Reviewing context is optional — continuing plans this request from connected capabilities alone, and still shows the plan before anything runs.</p> : null}
        </div>
      </div>
      <div className="simple-capability-gap__note"><ShieldCheck size={15} /><span>When recalled pages or a compatible desktop action are available, Carve uses them automatically and still shows the exact plan before acting.</span></div>
      <details className="simple-context-details">
        <summary>What Carve found <span>{sourceCount}</span><ChevronDown size={14} /></summary>
        <div className="simple-context-list">
          {context.sessions.map((session) => <div key={session.id}><Clock3 size={15} /><span><strong>{session.name}</strong><small>Supporting session · {dateTime.format(new Date(session.startedAt))}</small></span></div>)}
          {context.moments.map((moment) => <div key={moment.id}><AppWindow size={15} /><span><strong>{moment.title}</strong><small>{moment.app} · {ago(moment.occurredAt)}</small></span></div>)}
        </div>
        {blocker ? <p>{blocker}</p> : null}
      </details>
    </Card>
  )
}

function EvidenceReceipt({ context, onRecall }: { context: WorkContextSummary; onRecall: () => void }) {
  const boundResources = context.resources ?? []
  const sourceCount = boundResources.length + (context.procedure ? 1 : 0) + (context.followUp ? 1 : 0)
  return (
    <Card className="simple-planning-receipt">
      <div className="simple-planning-receipt__head"><div className="simple-planning-receipt__icon"><Check size={17} /></div><div><strong>{context.followUp ? 'Continuing your earlier request' : 'Context ready'}</strong><span>{context.followUp ? 'The previous request and its result travel with this plan as context' : context.procedure ? context.readiness === 'adaptive' ? 'Related experience adapted for this task' : 'A proven path matched this task' : 'A fresh plan was assembled from connected capabilities'}</span></div><Pill tone="positive">{sourceCount} source{sourceCount === 1 ? '' : 's'}</Pill></div>
      <details className="simple-context-details">
        <summary>Review what Carve used <ChevronDown size={14} /></summary>
        <div className="simple-context-list">
          {context.followUp ? <div><CornerDownRight size={15} /><span><strong>Follow-up to: {context.followUp.goal}</strong><small>{context.followUp.result ?? `${humanize(context.followUp.status)} — no result was recorded`}</small></span></div> : null}
          {context.memory ? <div><Database size={15} /><span><strong>{memoryReceiptLabel(context.memory).title}</strong><small>{memoryReceiptLabel(context.memory).detail}</small></span></div> : null}
          {context.procedure ? <div><ProcedureGlyph size={15} /><span><strong>{context.procedure.name}</strong><small>{context.readiness === 'adaptive' ? 'Related operating knowledge' : 'Proven operating path'}</small></span></div> : null}
          {boundResources.slice(0, 4).map((resource) => <div key={resource.id}><AppWindow size={15} /><span><strong>{resource.title}</strong><small>{resource.retrievalSignals.matchedTopicTerms.length > 0 ? `Matched: ${resource.retrievalSignals.matchedTopicTerms.join(', ')} · ${Math.round(resource.retrievalSignals.rerankScore * 100)}% topic fit` : 'Selected prior resource'}</small></span></div>)}
          {context.sessions.slice(0, 4).map((session) => <div key={session.id}><Clock3 size={15} /><span><strong>{session.name}</strong><small>Supporting session · {dateTime.format(new Date(session.startedAt))}</small></span></div>)}
          {context.moments.slice(0, 3).map((moment) => <div key={moment.id}><AppWindow size={15} /><span><strong>{moment.title}</strong><small>{moment.app} · {ago(moment.occurredAt)}</small></span></div>)}
        </div>
        <div className="simple-context-details__footer"><span><ShieldCheck size={14} /> Context can inform the plan but cannot expand its authority.</span><button type="button" onClick={onRecall}>Open Recall</button></div>
      </details>
    </Card>
  )
}

function OperatingContractCard({ run, busy, onStart, onStop, reviewMode = false }: { run: WorkRun; busy: boolean; onStart: () => void; onStop: () => void; reviewMode?: boolean }) {
  const contract = run.plan.contract
  const budget = workBudgetOption(contract?.budget?.preset)
  const active = ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status)
  const approved = Boolean(run.planAuthorization ?? run.planApproval)
  const livePlan = contract?.allowedTools.includes('computer.live') === true
  const basisLabel = contract?.basis === 'reviewed_procedure'
    ? 'Proven operating path'
    : contract?.basis === 'adapted_procedure'
      ? 'Related method adapted for this goal'
      : contract?.basis === 'capability_plan'
        ? 'Goal-led capability plan'
        : 'Legacy plan'
  const basisDescription = livePlan
    ? 'No connected tool matched this outcome, so Carve prepared a selected-window visual session. The selected pace applies after you choose the exact window.'
    : run.plan.planningMode === 'capability_plan'
    ? 'Carve assembled this plan from capabilities that are already connected. No taught method was required.'
    : run.plan.planningMode === 'adapted_replay'
      ? 'Carve adapted related operating knowledge into a fresh, closely supervised plan.'
      : 'Carve matched a proven operating path and bound it to this exact task.'
  return (
    <Card className="simple-operating-plan" elevated>
      <div className="simple-operating-plan__head"><div><div className="eyebrow">{livePlan ? 'Selected-window boundary' : run.status === 'planned' ? reviewMode ? 'Proposed actions' : 'Plan ready' : active ? 'Working' : 'Run summary'}</div><h2>{livePlan && run.status === 'planned' ? 'How Carve will operate' : reviewMode && run.status === 'planned' ? `What Carve will do (${run.plan.actions.length})` : run.plan.goal}</h2><p>{basisDescription}</p></div><Pill tone={approved ? 'positive' : run.status === 'planned' ? 'warning' : 'neutral'}>{approved ? 'Approved' : run.status === 'planned' ? 'Ready for review' : humanize(run.status)}</Pill></div>
      <div className="simple-plan-steps">{livePlan ? <div className="simple-plan-step"><span><MousePointer2 size={14} /></span><div><strong>Choose the work surfaces, then follow {supervisionLabel(run)}</strong><small>Carve uses one foreground control lane and switches only between windows you authorize. {run.plan.supervision?.preset === 'fast' ? 'Safe, semantically resolved actions can continue; consequential, protected, or unresolved effects stop.' : run.plan.supervision?.preset === 'step_by_step' ? 'Read-only navigation can continue; Carve asks before each state-changing transaction.' : 'Review the mission plan once, then Carve checks in at meaningful phase and effect boundaries.'} Every executed transaction gets a fresh observation.</small></div></div> : run.plan.actions.map((action, index) => <div className={`simple-plan-step simple-plan-step--${action.status}`} key={action.id}><span>{action.status === 'verified' ? <Check size={14} /> : index + 1}</span><div><strong>{action.preview}</strong><small>{action.stateChanging ? 'Will change state' : 'Read only'} · Carve will verify the result</small></div></div>)}</div>
      <div className="simple-plan-facts"><span><ShieldCheck size={14} /> {supervisionLabel(run)}</span><span><Gauge size={14} /> {contract?.budget ? `${budget.label} · ${contract.budget.maxActions} step allowance` : 'Legacy budget'}</span><span><AppWindow size={14} /> {contract?.affectedSystems.length ?? 1} system{(contract?.affectedSystems.length ?? 1) === 1 ? '' : 's'}</span><span><Clock3 size={14} /> Up to {contract?.limits.maxDurationMinutes ?? 5} active min</span></div>
      <details className="simple-plan-scope">
        <summary>Review scope and safeguards <ChevronDown size={14} /></summary>
        <div className="simple-plan-scope__grid">
          <section><small>Planning basis</small><strong>{basisLabel}</strong></section>
          <section><small>Capabilities</small><div className="contract-tags">{(contract?.allowedTools ?? [...new Set(run.plan.actions.map((action) => action.tool))]).map((tool) => <code key={tool}>{tool}</code>)}</div></section>
          <section><small>Approved targets</small><ul>{(contract?.allowedResources ?? []).map((resource) => <li key={`${resource.tool}:${resource.resource}`}>{resource.resource}</li>)}</ul></section>
          <section><small>Success means</small><ul>{(contract?.successCriteria ?? run.plan.actions.map((action) => action.expectedStateChange)).map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></section>
        </div>
        <div className="simple-plan-scope__boundary"><LockKeyhole size={14} /><span>{contract?.dataBoundary ?? 'Only the exact actions shown are eligible for execution.'}</span></div>
        {run.plan.planHash ? <div className="simple-plan-scope__hash"><span>Plan fingerprint</span><code>{run.plan.planHash.slice(0, 16)}…</code></div> : null}
      </details>
      <div className="simple-operating-plan__footer"><span>{livePlan && run.status === 'planned' ? 'Use the Live computer panel above to choose the authorized work surfaces. Request authorization, route selection, and any later mission-plan review are recorded separately.' : run.status === 'planned' ? run.plan.intent === 'plan_only' ? 'This is a plan only. Carve will not carry it out.' : run.plan.intent === 'context_only' ? 'This request only gathers information. Carve will not click or type.' : 'Your approval covers only the work described above.' : active ? 'You can stop Carve at any time.' : run.result ?? humanize(run.status)}</span>{livePlan && run.status === 'planned' ? <Pill tone="info"><MousePointer2 size={13} /> Select surfaces above</Pill> : run.status === 'planned' ? <Button onClick={onStart} disabled={busy}><BadgeCheck size={16} /> {run.plan.intent === 'plan_only' ? 'Finish plan review' : run.plan.intent === 'context_only' ? 'Finish context review' : run.plan.supervision?.preset === 'fast' ? 'Start from my request' : run.plan.supervision?.preset === 'smart_checkpoints' ? 'Approve plan and first phase' : 'Approve plan and begin'}</Button> : active ? <Button variant="danger" onClick={onStop}><Square size={14} fill="currentColor" /> Stop</Button> : <Pill tone={run.status === 'completed' ? 'positive' : run.status === 'failed' || run.status === 'blocked' ? 'danger' : 'neutral'}>{humanize(run.status)}</Pill>}</div>
    </Card>
  )
}

function DelegationApproval({ approval, onDecision }: { approval: CarveState['approvals'][number]; onDecision: (action: 'approve' | 'cancel') => void }) {
  return (
    <Card className="delegation-checkpoint">
      <div className="delegation-checkpoint__icon"><UserRoundCheck /></div><div><div className="eyebrow">Your approval · {approval.kind}</div><h2>{approval.preview}</h2><p>Your approval covers only the action shown here. If it changes, Carve will ask again.</p></div><div><Button variant="secondary" onClick={() => onDecision('cancel')}><X size={15} /> Stop here</Button><Button onClick={() => onDecision('approve')}><Check size={15} /> Allow this action</Button></div>
    </Card>
  )
}

function DelegationCheckpoint({ checkpoint, run, onDecision, onSupervisionChange }: { checkpoint: CarveState['checkpoints'][number]; run: WorkRun; onDecision: (action: 'approve' | 'decline') => void; onSupervisionChange: (preset: PaceChoice) => void }) {
  const scope = checkpoint.scope.kind === 'phase'
    ? 'this exact phase'
    : checkpoint.scope.kind === 'plan'
      ? 'the remaining exact plan envelope'
      : 'this exact action'
  const currentPreset = run.supervisionAmendments?.at(-1)?.nextPolicy.preset ?? run.plan.supervision?.preset ?? 'smart_checkpoints'
  const protectedEffect = checkpoint.effectClasses.some((effect) => ['unknown', 'communication', 'submission', 'financial', 'destructive', 'authentication', 'installation', 'privilege_escalation', 'confidential_disclosure', 'legal_acceptance', 'high_impact_decision', 'unclassified_control'].includes(effect))
  return (
    <Card className="delegation-checkpoint">
      <div className="delegation-checkpoint__icon"><UserRoundCheck /></div>
      <div>
        <div className="eyebrow">Your approval · {humanize(checkpoint.subject)} · {humanize(checkpoint.boundary)}</div>
        <h2>{checkpoint.preview.what}</h2>
        <p>{checkpoint.preview.whyNow}</p>
        <div className="simple-plan-facts">
          {checkpoint.preview.where ? <span><AppWindow size={14} /> {checkpoint.preview.where}</span> : null}
          {checkpoint.preview.data ? <span><LockKeyhole size={14} /> {checkpoint.preview.data}</span> : null}
          <span><ShieldCheck size={14} /> Approval covers {scope}</span>
          {checkpoint.preview.verification ? <span><CheckCircle2 size={14} /> Verify: {checkpoint.preview.verification}</span> : null}
        </div>
      </div>
      <div>
        <Button variant="secondary" onClick={() => onDecision('decline')}><X size={15} /> Stop here</Button>
        {currentPreset !== 'step_by_step' ? <Button variant="secondary" onClick={() => onSupervisionChange(currentPreset === 'fast' ? 'smart_checkpoints' : 'step_by_step')}><ShieldCheck size={15} /> Check in more often</Button> : null}
        {currentPreset !== 'fast' && currentPreset !== 'autopilot' && !protectedEffect ? <Button variant="secondary" onClick={() => onSupervisionChange('fast')}><Zap size={15} /> Move faster after this</Button> : null}
        {currentPreset !== 'autopilot' && !checkpoint.effectClasses.some((effect) => autopilotFloor.has(effect)) ? <Button variant="secondary" className="button--autopilot-ghost" onClick={() => onSupervisionChange('autopilot')}><Gauge size={15} /> Autopilot for the rest</Button> : null}
        <Button onClick={() => onDecision('approve')}><Check size={15} /> Approve {scope}</Button>
      </div>
    </Card>
  )
}

function ProofOfWorkCard({ state, run }: { state: CarveState; run: WorkRun }) {
  const subjectIds = new Set([run.id, run.plan.id, ...run.plan.actions.map((action) => action.id)])
  const events = state.audit
    .filter((event) => event.details.runId === run.id || (event.subjectId !== null && subjectIds.has(event.subjectId)))
    .filter((event) => ['work.request_authorized', 'work.plan_authorized', 'work.plan_reviewed', 'work.context_reviewed', 'work.target_authorized', 'approval.plan_granted', 'policy.evaluated', 'policy.authorization_evaluated', 'approval.requested', 'approval.granted', 'approval.cancelled', 'checkpoint.requested', 'checkpoint.approved', 'checkpoint.declined', 'checkpoint.consumed', 'supervision.tightened', 'supervision.loosened', 'action.execution_started', 'action.verification', 'action.executed', 'agent.run_completed', 'agent.run_failed', 'agent.run_blocked', 'agent.run_cancelled'].includes(event.category))
    .sort((left, right) => left.sequence - right.sequence)
  const verified = run.plan.actions.filter((action) => action.status === 'verified').length
  return (
    <Card className="proof-of-work">
      <div className="proof-of-work__head"><div><div className="eyebrow">Proof of work</div><h2>{run.status === 'completed' ? 'Verified outcome' : ['failed', 'blocked'].includes(run.status) ? 'Exception evidence preserved' : 'Live execution ledger'}</h2><p>Carve records what authorized the work, what changed, and how each outcome was checked.</p></div><Pill tone={run.status === 'completed' ? 'positive' : run.status === 'failed' || run.status === 'blocked' ? 'danger' : 'info'}>{verified} / {run.plan.actions.length} verified</Pill></div>
      <div className="proof-grid">
        <div className="proof-actions">{run.plan.actions.map((action, index) => <div className={`proof-action proof-action--${action.status}`} key={action.id}><span>{action.status === 'verified' ? <Check size={14} /> : action.status === 'failed' || action.status === 'blocked' ? <X size={14} /> : index + 1}</span><div><strong>{action.preview}</strong><small>{humanize(action.status)} · verify {action.verification.target}</small></div></div>)}</div>
        <div className="proof-ledger">{events.length === 0 ? <EmptyState icon={<Activity />} title="Ledger ready" description="Approval, policy, action, and verification evidence appears here as the run progresses." /> : events.slice(-10).map((event) => <div className="proof-event" key={event.id}><span className={`proof-event__dot proof-event__dot--${event.category.includes('failed') || event.category.includes('blocked') || event.category.includes('cancelled') ? 'danger' : event.category.includes('verification') || event.category.includes('completed') ? 'positive' : 'neutral'}`} /><div><strong>{proofEventLabel(event.category, event.details)}</strong><small>{dateTime.format(new Date(event.occurredAt))} · {event.actor}</small></div></div>)}</div>
      </div>
      <PublicLookupReceipts runId={run.id} lookups={run.liveComputerCheckpoint?.ledger?.publicLookups} />
      {run.result ? <div className={`proof-result proof-result--${run.status}`}><strong>{humanize(run.status)}</strong>{run.publicLookup && run.status === 'completed' ? <PublicLookupAnswer runId={run.id} evidence={run.publicLookup} /> : <span>{run.result}</span>}</div> : null}
    </Card>
  )
}

function proofEventLabel(category: string, details: Record<string, unknown>): string {
  if (category === 'approval.plan_granted') return 'Task plan approved and hash recorded'
  if (category === 'work.request_authorized') return 'Authorized by the exact request and selected pace'
  if (category === 'work.plan_authorized') return 'Exact plan reviewed and authorized'
  if (category === 'work.plan_reviewed') return 'Plan reviewed without creating execution authority'
  if (category === 'work.context_reviewed') return 'Context reviewed without creating execution authority'
  if (category === 'work.target_authorized') return 'Selected-window target authorized separately'
  if (category === 'policy.evaluated') return `Policy evaluated ${String(details.outcome ?? 'the next action')}`
  if (category === 'policy.authorization_evaluated') return `Supervision policy decided ${String(details.outcome ?? 'the next action')}`
  if (category === 'approval.requested') return 'Carve asked before this action'
  if (category === 'approval.granted') return 'Human approval recorded'
  if (category === 'approval.cancelled') return 'Your approval declined'
  if (category === 'checkpoint.requested') return 'Carve asked for your approval'
  if (category === 'checkpoint.approved') return 'You approved these steps'
  if (category === 'checkpoint.declined') return 'You declined; the step did not run'
  if (category === 'checkpoint.consumed') return 'Carve used your approval for these steps'
  if (category === 'supervision.tightened') return 'Carve will check in more often'
  if (category === 'supervision.loosened') return 'Faster pace explicitly authorized'
  if (category === 'action.execution_started') return `Task started with ${String(details.tool ?? 'an approved tool')}`
  if (category === 'action.verification') return details.verified === true ? 'Expected state independently verified' : 'Verification mismatch detected'
  if (category === 'action.executed') return `Action completed with ${String(details.tool ?? 'the approved tool')}`
  if (category === 'agent.run_completed') return 'All declared outcomes verified'
  if (category === 'agent.run_failed') return 'Run stopped and exception preserved'
  if (category === 'agent.run_blocked') return 'Carve stopped because the action was outside your approved plan'
  return humanize(category.replaceAll('.', '_'))
}

function EarnedAutonomyCard({ metrics, selectedMode }: { metrics: DelegationMetrics; selectedMode: string }) {
  return (
    <Card className="earned-autonomy">
      <div className="earned-autonomy__head"><div><div className="eyebrow">Fewer interruptions</div><h2>{metrics.tier}</h2></div><div className="earned-autonomy__score"><strong>{Math.round(metrics.verificationRate * 100)}</strong><span>% verified</span></div></div>
      <div className="earned-autonomy__track"><span style={{ width: `${metrics.progress}%` }} /></div>
      <div className="earned-autonomy__stats"><div><strong>{metrics.completedRuns}</strong><span>verified runs</span></div><div><strong>{metrics.verifiedActions}</strong><span>verified actions</span></div><div><strong>{metrics.exceptions}</strong><span>exceptions</span></div></div>
      <div className="earned-autonomy__mode"><ShieldCheck size={15} /><div><small>Current plan</small><strong>{selectedMode}</strong></div></div>
      <p>{metrics.nextMilestone}</p>
      <small>Carve recommends a policy review; it never promotes itself automatically.</small>
    </Card>
  )
}

function ExceptionLearningCard({ state, run, busy, onRecovery }: { state: CarveState; run: WorkRun | null; busy: boolean; onRecovery?: (action: 'create' | 'dismiss') => void }) {
  const relevant = run ? state.runs.filter((candidate) => candidate.plan.procedureId === run.plan.procedureId) : state.runs
  const exceptions = relevant.filter((candidate) => ['failed', 'blocked'].includes(candidate.status))
  const currentRecovery = run?.recoveryProposal?.status === 'proposed' ? run.recoveryProposal : null
  return (
    <Card className="exception-learning">
      <div className="exception-learning__head"><div className="exception-learning__icon"><GitBranch /></div><div><div className="eyebrow">Exception learning</div><h2>{currentRecovery ? 'A new case needs review' : exceptions.length > 0 ? `${exceptions.length} preserved exception${exceptions.length === 1 ? '' : 's'}` : 'No exceptions yet'}</h2></div></div>
      {currentRecovery ? <><p>{currentRecovery.reason}</p><div className="exception-state">{Object.entries(currentRecovery.observedState).filter(([, value]) => value !== '' && value !== null).slice(0, 4).map(([key, value]) => <span key={key}><small>{humanize(key)}</small><strong>{String(value)}</strong></span>)}</div><div className="exception-learning__actions"><Button variant="secondary" disabled={busy} onClick={() => onRecovery?.('dismiss')}>Dismiss</Button><Button disabled={busy} onClick={() => onRecovery?.('create')}><RefreshCw size={14} /> Update the plan</Button></div></> : <p>If something changes or a result cannot be confirmed, Carve keeps a record. You can review what happened and update the plan.</p>}
      <div className="exception-learning__rule"><LockKeyhole size={15} /><span>Carve can learn from a problem, but it still needs your permission to change the plan.</span></div>
    </Card>
  )
}

export function AuditView({ state }: ViewProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const categories = useMemo(() => ['all', ...new Set(state.audit.map((event) => event.category.split('.')[0] ?? event.category))], [state.audit])
  const filtered = useMemo(() => state.audit.filter((event) => {
    const matchesCategory = category === 'all' || event.category.startsWith(`${category}.`)
    const haystack = `${consumerActivityLabel(event)} ${consumerActor(event.actor)} ${event.category} ${event.actor} ${JSON.stringify(event.details)}`.toLowerCase()
    return matchesCategory && haystack.includes(query.toLowerCase())
  }), [category, query, state.audit])

  return (
    <div className="page">
      <PageIntro label="Activity" title="See what Carve did." description="Review what Carve looked at, changed, and checked, along with the decisions you made. Technical details are available inside each entry." action={<Pill tone={state.auditChain.valid ? 'positive' : 'danger'} icon={state.auditChain.valid ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}>{state.auditChain.valid ? 'Activity record checked' : 'Activity record needs checking'}</Pill>} />
      <div className="audit-metrics"><Card><span>Events checked</span><strong>{state.auditChain.checked}</strong></Card><Card><span>Finished tasks</span><strong>{state.audit.filter((event) => event.category === 'computer.session_terminal').length}</strong></Card><Card><span>Your decisions</span><strong>{state.audit.filter((event) => event.actor === 'user').length}</strong></Card><Card><span>Permission checks</span><strong>{state.audit.filter((event) => event.actor === 'policy').length}</strong></Card></div>
      <Card>
        <div className="audit-toolbar"><div className="search-input"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search event details…" /></div><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{item === 'all' ? 'All categories' : humanize(item)}</option>)}</select><Pill>{filtered.length} shown</Pill></div>
        {filtered.length === 0 ? <EmptyState icon={<Search />} title="No matching events" description="Adjust the category or search phrase." /> : <div className="audit-list">{filtered.map((event) => <details key={event.id} className="audit-event"><summary><span className={`actor actor--${event.actor}`}>{event.actor.slice(0, 1).toUpperCase()}</span><div><strong>{consumerActivityLabel(event)}</strong><span>{consumerActor(event.actor)} · {dateTime.format(new Date(event.occurredAt))}</span></div><code>#{event.sequence}</code><Pill>{event.subjectId ? event.subjectId.slice(0, 18) : 'system'}</Pill><ChevronDown size={16} /></summary><div className="audit-event__details"><strong>Technical details</strong><code>{event.category}</code><pre>{JSON.stringify(event.details, null, 2)}</pre><div><span>Previous</span><code>{event.previousHash.slice(0, 24)}</code><span>Event hash</span><code>{event.hash.slice(0, 24)}</code></div></div></details>)}</div>}
      </Card>
    </div>
  )
}

export function SettingsView({ state, desktop, refresh, notify }: ViewProps) {
  const [health, setHealth] = useState<Record<string, string>>({})
  const [answerPolicy, setAnswerPolicy] = useState<RecallAnswerPolicyView | null>(null)
  const [readState, setReadState] = useState<{ unread: number; total: number; skipped: number } | null>(null)
  const [models, setModels] = useState<Record<string, string[]>>({})
  const [rates, setRates] = useState<Record<string, { inputPerMillion: number; outputPerMillion: number } | null>>({})
  const [rateDraft, setRateDraft] = useState<Record<string, { input: string; output: string }>>({})
  const [spend, setSpend] = useState<ModelSpendView | null>(null)
  // Spend since this app run began. Development-only instrumentation: shown
  // when the build is not packaged, so a person can watch what a working
  // session actually costs without that number shipping as product UI.
  const [sessionSpend, setSessionSpend] = useState<ModelSpendView | null>(null)
  const [costDebug, setCostDebug] = useState(false)
  const [embedding, setEmbedding] = useState<EmbeddingPolicyView | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportConfirmation, setExportConfirmation] = useState('')
  const [exporting, setExporting] = useState(false)
  const [surfacePreferences, setSurfacePreferences] = useState<{
    profile: SurfacePreferenceProfile
    applications: LiveComputerApplicationIdentity[]
    defaults: SurfaceDefaultApplication[]
  } | null>(null)

  useEffect(() => {
    void invoke<{ enabled: boolean }>({ kind: 'cost.debug.get' }).then(({ enabled }) => setCostDebug(enabled)).catch(() => undefined)
    void invoke<EmbeddingPolicyView>({ kind: 'embedding.policy' }).then(setEmbedding).catch(() => setEmbedding(null))
    if (desktop.desktop) void invoke<{ profile: SurfacePreferenceProfile; applications: LiveComputerApplicationIdentity[]; defaults: SurfaceDefaultApplication[] }>({ kind: 'computer.surface_preferences.get' })
      .then(setSurfacePreferences)
      .catch(() => setSurfacePreferences(null))
  }, [desktop.desktop, state.providers])

  const chooseEmbeddingMode = async (mode: 'off' | 'local' | 'hosted') => {
    try {
      setEmbedding(await invoke<EmbeddingPolicyView>({ kind: 'embedding.set_mode', mode }))
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const setEmbeddingConsent = async (providerId: string | null) => {
    try {
      const next = await invoke<EmbeddingPolicyView>({ kind: 'embedding.consent', providerId })
      setEmbedding(next)
      notify(providerId ? 'Your history will be indexed for meaning' : 'Indexing stopped', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const toggleCostDebug = async (enabled: boolean) => {
    try {
      const result = await invoke<{ enabled: boolean }>({ kind: 'cost.debug.set', enabled })
      setCostDebug(result.enabled)
      notify(result.enabled ? 'Every model call will ask before it is sent' : 'Cost checks are off', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const toggleCapabilityExecutor = async (enabled: boolean) => {
    try {
      const { mode } = await invoke<{ mode: 'legacy' | 'capability_vm_v1' }>({
        kind: 'computer.execution_mode.set',
        mode: enabled ? 'capability_vm_v1' : 'legacy',
      })
      await refresh()
      notify(
        mode === 'capability_vm_v1'
          ? 'Experimental search controls will be used by new live sessions'
          : 'New live sessions will use the legacy executor',
        mode === 'capability_vm_v1' ? 'positive' : 'neutral',
      )
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const chooseComputerActionEngine = async (selected: LiveComputerActionEngine) => {
    try {
      const { engine } = await invoke<{ engine: LiveComputerActionEngine }>({
        kind: 'computer.action_engine.set',
        engine: selected,
      })
      await refresh()
      notify(
        engine === 'router_v1'
          ? 'Carve will choose the controller for each selected window'
          : engine === 'openai_thin_v1'
          ? 'Thin OpenAI computer use is enabled for new tasks'
          : engine === 'compact_v1'
          ? 'Compact Preview is enabled for new selected-window tasks'
          : engine === 'openai_universal_v1'
          ? 'Universal mode will run eligible new selected-window sessions continuously'
          : engine === 'openai_computer_v1'
            ? 'OpenAI computer actions will be proposed inside Carve’s governed controller'
            : 'New live sessions will use Carve’s structured action planner',
        engine === 'structured_v1' ? 'neutral' : 'positive',
      )
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const toggleFastMode = async (enabled: boolean) => {
    try {
      const result = await invoke<{ tier: 'default' | 'fast' }>({ kind: 'computer.service_tier.set', tier: enabled ? 'fast' : 'default' })
      await refresh()
      notify(result.tier === 'fast' ? 'New OpenAI requests will ask for fast processing at a higher token price' : 'New OpenAI requests use standard processing', result.tier === 'fast' ? 'positive' : 'neutral')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const chooseComputerModelProfile = async (profile: 'adaptive_5_6' | 'astra') => {
    try {
      const result = await invoke<{ profile: 'adaptive_5_6' | 'astra' }>({ kind: 'computer.model_profile.set', profile })
      await refresh()
      notify(result.profile === 'astra' ? 'Astra will power new computer-use sessions' : 'Adaptive GPT-5.6 routing restored', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const rateKey = (providerId: string, model: string) => `${providerId}::${model}`

  const loadSpend = () => {
    void invoke<ModelSpendView>({ kind: 'model.spend', sinceIso: null }).then(setSpend).catch(() => setSpend(null))
    if (!desktop.packaged) {
      void invoke<ModelSpendView>({ kind: 'model.spend', sinceIso: state.product.startedAt })
        .then(setSessionSpend)
        .catch(() => setSessionSpend(null))
    }
  }
  useEffect(() => {
    loadSpend()
    // Session spend moves while the person works, so keep it current instead
    // of freezing the number at whenever Settings happened to mount.
    if (desktop.packaged) return
    const timer = setInterval(loadSpend, 15_000)
    return () => clearInterval(timer)
  }, [desktop.packaged, state.product.startedAt])

  useEffect(() => {
    for (const provider of state.providers) {
      if (provider.kind === 'mock') continue
      void invoke<{ rate: { inputPerMillion: number; outputPerMillion: number } | null }>({ kind: 'model.rate.get', providerId: provider.id, model: provider.model })
        .then(({ rate }) => setRates((current) => ({ ...current, [rateKey(provider.id, provider.model)]: rate })))
        .catch(() => undefined)
    }
  }, [state.providers])

  const loadModels = async (providerId: string) => {
    try {
      const { models: available } = await invoke<{ models: string[] }>({ kind: 'provider.models', providerId })
      setModels((current) => ({ ...current, [providerId]: available }))
      if (available.length === 0) notify('That endpoint listed no models. Type one instead.', 'warning')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const chooseModel = async (providerId: string, model: string) => {
    try {
      await invoke({ kind: 'provider.set_model', providerId, model })
      await refresh()
      notify(`${providerId} now uses ${model}`, 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const saveRate = async (providerId: string, model: string) => {
    const draft = rateDraft[rateKey(providerId, model)]
    const input = draft?.input === undefined || draft.input === '' ? null : Number(draft.input)
    const output = draft?.output === undefined || draft.output === '' ? null : Number(draft.output)
    if ((input !== null && !Number.isFinite(input)) || (output !== null && !Number.isFinite(output))) {
      return notify('Rates must be numbers, in dollars per million tokens', 'danger')
    }
    try {
      const { rate } = await invoke<{ rate: { inputPerMillion: number; outputPerMillion: number } | null }>({
        kind: 'model.rate.set', providerId, model, inputPerMillion: input, outputPerMillion: output,
      })
      setRates((current) => ({ ...current, [rateKey(providerId, model)]: rate }))
      notify(rate ? `Rate saved for ${model}` : `Rate cleared for ${model}`, 'positive')
      loadSpend()
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }
  const [reading, setReading] = useState(false)

  const loadReadState = () => {
    void Promise.all([
      invoke<{ unread: number }>({ kind: 'recall.unread_count' }),
      invoke<RecallScopeCountView>({ kind: 'recall.scope_count', fromIso: null, toIso: null }),
    ])
      .then(([{ unread }, counts]) => setReadState({ unread, total: counts.total, skipped: counts.skipped }))
      .catch(() => setReadState(null))
  }
  useEffect(loadReadState, [])

  const readCaptures = async () => {
    setReading(true)
    try {
      const outcome = await invoke<{ enriched: number; empty: number; redactions: string[] }>({ kind: 'recall.enrich_text' })
      const { message, tone } = readOutcomeMessage(outcome)
      notify(message, tone)
      loadReadState()
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setReading(false) }
  }

  const clearSkips = async () => {
    try {
      const { restored } = await invoke<{ restored: number }>({ kind: 'recall.clear_skips' })
      notify(`${restored} capture${restored === 1 ? '' : 's'} can be read again`, 'positive')
      loadReadState()
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const loadAnswerPolicy = () => {
    void invoke<RecallAnswerPolicyView>({ kind: 'recall.answer_policy' })
      .then(setAnswerPolicy)
      .catch(() => setAnswerPolicy(null))
  }
  useEffect(loadAnswerPolicy, [state.providers])

  const setAnswerConsent = async (providerId: string | null) => {
    try {
      setAnswerPolicy(await invoke<RecallAnswerPolicyView>({ kind: 'recall.answer_consent', providerId }))
      notify(providerId ? 'Inference answers enabled' : 'Inference answers paused', providerId ? 'positive' : 'warning')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const openScreenRecordingSettings = async () => {
    try {
      await invoke({ kind: 'desktop.open_system_settings', pane: 'screen_recording' })
      notify('System Settings opened. Enable Screen Recording, then return and check again.', 'neutral')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const checkDesktopPermissions = async () => {
    try {
      await invoke({ kind: 'native.capture.status' })
      await refresh()
      notify('Desktop permission status refreshed', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const selectProvider = async (providerId: string) => {
    try {
      await invoke({ kind: 'provider.action', providerId, action: 'select' })
      await refresh()
      notify('Active provider updated', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const checkHealth = async (providerId: string) => {
    setHealth((current) => ({ ...current, [providerId]: 'Checking…' }))
    try {
      const result = await invoke<{ ok: boolean; message: string }>({ kind: 'provider.action', providerId, action: 'health' })
      setHealth((current) => ({ ...current, [providerId]: result.message }))
    } catch (error) { setHealth((current) => ({ ...current, [providerId]: error instanceof Error ? error.message : String(error) })) }
  }

  const dismissExport = () => {
    if (exporting) return
    setExportOpen(false)
    setExportPassphrase('')
    setExportConfirmation('')
  }

  const exportData = async () => {
    if ([...exportPassphrase].length < 12) return notify('Use at least 12 characters for the export passphrase', 'danger')
    if (exportPassphrase !== exportConfirmation) return notify('The export passphrases do not match', 'danger')
    setExporting(true)
    try {
      const data = await invoke({ kind: 'data.export', passphrase: exportPassphrase })
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `steward-export-${new Date().toISOString().slice(0, 10)}.steward`
      anchor.click()
      URL.revokeObjectURL(url)
      setExportOpen(false)
      setExportPassphrase('')
      setExportConfirmation('')
      notify('Encrypted export prepared. Keep its passphrase somewhere separate.', 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setExporting(false) }
  }

  const purge = async () => {
    const phrase = window.prompt('Permanent deletion cannot be undone. Type DELETE ALL STEWARD DATA to continue.')
    if (phrase !== 'DELETE ALL STEWARD DATA') return
    try {
      await invoke({ kind: 'data.purge', confirmation: phrase })
      await refresh()
      notify('Local Carve data permanently deleted', 'warning')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  const preferenceCapabilities: WorkSurfaceCapability[] = ['web_browser', 'text_document', 'spreadsheet', 'presentation', 'document_viewer']
  const preferenceLabels: Record<WorkSurfaceCapability, string> = {
    web_browser: 'Web browser',
    text_document: 'Documents',
    spreadsheet: 'Spreadsheets',
    presentation: 'Presentations',
    document_viewer: 'PDF viewer',
    file_manager: 'File manager',
    calculator: 'Calculator',
    general_application: 'Other applications',
  }
  const preferenceRows = surfacePreferences ? preferenceCapabilities.flatMap((capability) => {
    const applications = surfaceRecordsForApplications(surfacePreferences.applications)
      .filter((record) => record.capability === capability)
      .sort((left, right) => left.application.localeCompare(right.application))
    const preference = surfacePreferences.profile.entries.find((entry) => entry.capability === capability)
    if (applications.length < 2 && !preference) return []
    return [{ capability, applications, preference, osDefault: surfacePreferences.defaults.find((entry) => entry.capability === capability) ?? null }]
  }) : []
  const chooseSurfacePreference = async (capability: WorkSurfaceCapability, value: string) => {
    try {
      const mode = value === 'automatic' || value === 'ask_each_time' ? value : 'specific_application'
      const bundleIdentifier = mode === 'specific_application' ? value : null
      const result = await invoke<{ profile: SurfacePreferenceProfile }>({ kind: 'computer.surface_preferences.set', capability, mode, bundleIdentifier })
      setSurfacePreferences((current) => current ? { ...current, profile: result.profile } : current)
      notify(mode === 'specific_application' ? `${preferenceLabels[capability]} preference saved` : mode === 'ask_each_time' ? `Carve will ask which ${preferenceLabels[capability].toLowerCase()} to use` : `${preferenceLabels[capability]} will follow automatic selection`, 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }
  const resetSurfacePreference = async (capability: WorkSurfaceCapability) => {
    try {
      const result = await invoke<{ profile: SurfacePreferenceProfile }>({ kind: 'computer.surface_preferences.clear', capability })
      setSurfacePreferences((current) => current ? { ...current, profile: result.profile } : current)
      notify(`${preferenceLabels[capability]} preference reset`, 'positive')
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
  }

  return (
    <div className="page page--settings">
      <LegalCenterCard />
      {exportOpen ? (
        <Dialog
          title="Protect this export"
          description="Carve encrypts the complete export before it leaves the local process. This passphrase is never stored and cannot be recovered, so keep it somewhere separate from the .steward file."
          onDismiss={dismissExport}
        >
          <form className="export-passphrase" onSubmit={(event) => { event.preventDefault(); void exportData() }}>
            <Field label="Passphrase" hint="At least 12 characters. A password manager-generated phrase is best.">
              <input autoFocus type="password" autoComplete="new-password" spellCheck={false} value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} />
            </Field>
            <Field label="Confirm passphrase">
              <input type="password" autoComplete="new-password" spellCheck={false} value={exportConfirmation} onChange={(event) => setExportConfirmation(event.target.value)} />
            </Field>
            <div className="dialog__buttons">
              <Button type="submit" disabled={exporting}>{exporting ? 'Encrypting…' : 'Encrypt and download'}</Button>
              <Button type="button" variant="ghost" disabled={exporting} onClick={dismissExport}>Cancel</Button>
            </div>
          </form>
          <small className="dialog__note">The file uses scrypt and authenticated AES-256-GCM. Losing the passphrase means losing the export.</small>
        </Dialog>
      ) : null}
      <PageIntro label="Settings & privacy" title="Make Carve work for you." description="Manage your AI connection, app permissions, saved history, and privacy." />
      <Card className="sharing-settings">
        <SectionHeading eyebrow="Access & AI" title="You choose what goes to AI" description="Local app discovery, sharing with AI, and permission to act are separate choices." />
        <p>Carve checks installed app names on this Mac and lists windows when you choose one. App-name sharing helps AI suggest a route. Window sharing sends images, visible text and controls, authorized window names, and relevant conversation context—even while preparing a plan.</p>
        {(state.liveComputer.sharing ?? []).filter(entry => state.providers.some(provider => provider.id === entry.providerId && provider.configured)).map(entry => <div className="sharing-settings__provider" key={entry.providerId}><strong>{entry.recipient}</strong><span>App names: {entry.catalogRemembered ? 'Remembered on this Mac' : entry.catalog ? 'Until Carve quits' : 'Ask for each task'}</span><span>Window sharing: {entry.windowsRemembered ? 'Remembered on this Mac' : entry.windows ? 'Until Carve quits' : 'Ask before sharing'}</span></div>)}
        <p>Task-only choices end with that task. Remembered choices apply to this service and endpoint. Each task still uses only authorized windows. History answers, indexing and screenshots have separate controls below.</p>
        <Button variant="secondary" onClick={() => { void (async () => { try { await invoke({ kind: 'computer.visuals_consent', providerId: null }); await invoke({ kind: 'computer.catalog_consent', providerId: null }); await refresh(); notify('Sharing stopped. Carve will ask again.', 'positive') } catch (error) { notify(String(error), 'danger') } })() }}>Reset app-name and window sharing</Button>
        <small>Stops current window tasks and pending window requests. Information already sent cannot be recalled. Local history is managed separately below.</small>
      </Card>
      <div className="settings-grid">
        <div className="settings-grid__main">
          <VoiceSettingsCard />
          <Card>
            <SectionHeading eyebrow="Your preferred apps" title="Choose where Carve works" description="Tell Carve which app to use, or set a favorite here. Otherwise, Carve chooses an app that fits the task." />
            {!desktop.desktop ? <p className="muted-note">Your preferred apps are available in the Carve desktop app.</p> : surfacePreferences === null ? <p className="muted-note">Carve could not load your apps. Try reopening Settings.</p> : preferenceRows.length === 0 ? <p className="muted-note">Install another app for the same kind of task to choose a favorite here.</p> : <div className="surface-preferences">
              {preferenceRows.map(({ capability, applications, preference, osDefault }) => {
                const value = preference?.mode === 'specific_application' ? preference.bundleIdentifier ?? 'automatic' : preference?.mode ?? 'automatic'
                const storedAvailable = preference?.mode !== 'specific_application' || applications.some((application) => application.bundleIdentifier === preference.bundleIdentifier)
                return <div className="surface-preference" key={capability}>
                  <div className="surface-preference__copy"><strong>{preferenceLabels[capability]}</strong><span>{osDefault ? `${osDefault.application} is your macOS default` : 'No compatible macOS default was reported'}</span>{!storedAvailable ? <small>Your saved app is unavailable; Carve will use a compatible fallback.</small> : null}</div>
                  <select aria-label={`${preferenceLabels[capability]} preference`} value={value} onChange={(event) => void chooseSurfacePreference(capability, event.target.value)}>
                    <option value="automatic">Automatic</option>
                    <option value="ask_each_time">Ask each time</option>
                    {applications.map((application) => <option value={application.bundleIdentifier} key={application.bundleIdentifier}>{application.application}</option>)}
                    {!storedAvailable && preference?.bundleIdentifier ? <option value={preference.bundleIdentifier} disabled>{preference.application ?? 'Unavailable app'} · unavailable</option> : null}
                  </select>
                  {preference ? <Button variant="ghost" size="small" onClick={() => void resetSurfacePreference(capability)}>Reset</Button> : null}
                </div>
              })}
              <p className="surface-preferences__note">Automatic follows task requirements first, then your Mac’s defaults when available. A saved app is a preference, not permission to bypass format, safety, or route review.</p>
            </div>}
          </Card>
          <Card>
            <SectionHeading eyebrow="Computer controls · experimental" title="How Carve controls your computer" description="Choose how new tasks run. Assured checks each step independently. Universal uses the AI model to choose steps and report results." />
            <Field label="New live sessions use">
              <select value={state.liveComputer.actionEngine} onChange={(event) => void chooseComputerActionEngine(event.target.value as LiveComputerActionEngine)}>
                <option value="router_v1" disabled={!state.providers.some((provider) => provider.computerUseSessions && provider.capabilities.structuredOutput && provider.configured)}>Automatic · Choose by selected window</option>
                <option value="structured_v1">Assured · Carve checks each step</option>
                <option value="openai_computer_v1" disabled={!state.providers.some((provider) => provider.computerActionProposals && provider.configured)}>Assured · The model chooses steps, Carve checks them</option>
                <option value="openai_thin_v1" disabled={!state.providers.some((provider) => provider.computerUseSessions && provider.configured)}>Thin · OpenAI computer use · Experimental</option>
                <option value="compact_v1" disabled={!state.providers.some((provider) => provider.capabilities.vision && provider.capabilities.structuredOutput && provider.configured)}>Compact · Preview · Fewer decisions, checked results</option>
                <option value="openai_universal_v1" disabled={!state.providers.some((provider) => provider.computerUseSessions && provider.configured)}>Universal · The model works without checking in at each step</option>
              </select>
            </Field>
            <div className={isUniversalLiveComputerEngine(state.liveComputer.actionEngine) ? 'ai-warning' : 'settings-note'}>
              {isUniversalLiveComputerEngine(state.liveComputer.actionEngine) ? <ShieldAlert size={17} /> : <ShieldCheck size={17} />}
              <span>{state.liveComputer.actionEngine === 'router_v1'
                ? 'Carve uses visible controls for browser tasks and computer vision for native apps. If the browser attempt cannot progress, it can try computer vision within the remaining task allowance. Your selected window, approvals and Stop still apply.'
                : state.liveComputer.actionEngine === 'openai_thin_v1'
                ? 'Thin mode follows OpenAI computer actions directly in the selected window. Your task authorizes ordinary actions without per-batch approval. Stop, task limits, and provider safety checks remain active. Results are model-reported, not independently checked.'
                : state.liveComputer.actionEngine === 'compact_v1'
                ? 'Compact Preview uses short decisions and batches controls already visible in one authorized window. A separate AI check verifies the final result. Pause, Stop and your approval settings still apply. Exact table transfer is not yet supported in this preview.'
                : state.liveComputer.actionEngine === 'openai_universal_v1'
                ? 'Universal sends screenshots of your selected window to OpenAI. It carries out groups of steps without asking before each one or independently checking the results. Window restrictions, task limits, safety checks, activity records, and Stop still apply.'
                : state.liveComputer.actionEngine === 'openai_computer_v1'
                  ? 'OpenAI suggests steps. Carve follows your approval settings, carries them out, and independently checks the results.'
                  : 'Carve plans the task, follows your approval settings, and checks each part independently.'}</span>
            </div>
          </Card>
          <Card>
            <SectionHeading eyebrow="AI for your tasks" title="Choose the AI for computer tasks" description="This AI chooses apps, makes plans, takes steps, and checks results. History search keeps its own AI setting." />
            <Field label="New computer-use sessions use">
              <select value={state.liveComputer.modelProfile} onChange={(event) => void chooseComputerModelProfile(event.target.value as 'adaptive_5_6' | 'astra')}>
                <option value="astra">Astra · highest capability</option>
                <option value="adaptive_5_6">Adaptive · Sol for planning, Terra for actions</option>
              </select>
            </Field>
            <div className="settings-note"><Sparkles size={17} /><span>{state.liveComputer.modelProfile === 'astra' ? 'GPT-6 Astra handles planning, computer actions, and result checks. Each task still has limits on AI usage.' : 'Carve uses GPT-5.6 Sol for planning and GPT-5.6 Terra for routine actions and checks.'}</span></div>
            <Toggle
              checked={state.liveComputer.serviceTier?.tier === 'fast'}
              disabled={state.liveComputer.serviceTier?.source === 'environment'}
              onChange={(enabled) => void toggleFastMode(enabled)}
              label="Fast mode"
              description={state.liveComputer.serviceTier?.source === 'environment'
                ? `Set by STEWARD_OPENAI_SERVICE_TIER=${state.liveComputer.serviceTier.tier} in the environment; unset it to change this here.`
                : 'Ask OpenAI for fast processing on every direct request, including computer-use turns. OpenAI prices fast processing at twice the standard token rate; Carve Cloud requests are unaffected. Spend estimates show the tier each call was actually served.'}
            />
            {state.liveComputer.modelRouting?.map((route) => <div className="settings-note" key={route.providerId}><span><strong>{route.providerId === 'carve-cloud' ? 'Carve Cloud' : 'OpenAI'} effective routing</strong><br />Planning: {route.strategy.model} · {route.strategy.reasoningEffort} reasoning<br />Actions and checks: {route.execution.model} · {route.execution.reasoningEffort} reasoning<br />Processing: {route.execution.serviceTier ?? 'project default'} · Cache: {route.execution.promptCache ?? 'provider default'}</span></div>)}
          </Card>
          <Card>
            <SectionHeading eyebrow="Experimental computer use" title="Experimental search controls" description="Try an alternative way to enter searches. Carve checks the search field and its text before submitting. Your permissions still apply." />
            <Toggle
              checked={state.liveComputer.executionMode === 'capability_vm_v1'}
              onChange={(enabled) => void toggleCapabilityExecutor(enabled)}
              label={state.liveComputer.executionMode === 'capability_vm_v1' ? 'Use experimental controls for new tasks' : 'Use standard controls'}
              description="This applies to new tasks. Turn it off to use standard controls on your next task."
            />
          </Card>
          <Card>
            <SectionHeading eyebrow="Model and cost" title="Which model, and what it costs" description="Choose an AI model and enter its current rates to estimate usage costs. You can change these settings without restarting." />
            <div className="model-settings">
              {state.providers.filter((provider) => provider.kind !== 'mock').map((provider) => {
                const key = rateKey(provider.id, provider.model)
                const rate = rates[key]
                const draft = rateDraft[key] ?? { input: rate ? String(rate.inputPerMillion) : '', output: rate ? String(rate.outputPerMillion) : '' }
                const available = models[provider.id]
                return (
                  <div className="model-settings__row" key={provider.id}>
                    <div className="model-settings__head">
                      <strong>{provider.name}</strong>
                      <Pill tone={provider.kind === 'hosted' ? 'info' : 'positive'}>{provider.kind === 'hosted' ? 'Sends data off this machine' : 'Stays on this machine'}</Pill>
                    </div>
                    <div className="model-settings__controls">
                      {available && available.length > 0 ? (
                        <select value={provider.model} onChange={(event) => void chooseModel(provider.id, event.target.value)}>
                          {available.includes(provider.model) ? null : <option value={provider.model}>{provider.model} (current)</option>}
                          {available.map((model) => <option key={model} value={model}>{model}</option>)}
                        </select>
                      ) : (
                        <input
                          defaultValue={provider.model}
                          aria-label={`Model for ${provider.name}`}
                          onBlur={(event) => { if (event.target.value.trim() && event.target.value !== provider.model) void chooseModel(provider.id, event.target.value.trim()) }}
                        />
                      )}
                      <Button variant="secondary" size="small" onClick={() => void loadModels(provider.id)}>List models</Button>
                    </div>
                    <div className="model-settings__rate">
                      <label>$ / M in <input inputMode="decimal" value={draft.input} placeholder="unset" onChange={(event) => setRateDraft((current) => ({ ...current, [key]: { ...draft, input: event.target.value } }))} /></label>
                      <label>$ / M out <input inputMode="decimal" value={draft.output} placeholder="unset" onChange={(event) => setRateDraft((current) => ({ ...current, [key]: { ...draft, output: event.target.value } }))} /></label>
                      <Button variant="ghost" size="small" onClick={() => void saveRate(provider.id, provider.model)}>Save rate</Button>
                      {rate ? null : <small>Without a rate, spend is reported in tokens only.</small>}
                    </div>
                  </div>
                )
              })}
            </div>
            {embedding ? (
              <div className="embedding-setting">
                <SectionHeading eyebrow="Search index" title="Matching meaning, not just words" description="Without this, a question has to reuse the wording that was on screen. Measured on this history it is the difference between 4 of 5 paraphrased questions and 5 of 5." />
                <div className="recall-scope__chips" role="group" aria-label="Where to build search vectors">
                  {(['off', 'local', 'hosted'] as const).map((mode) => {
                    const offered = mode === 'off' || embedding.available.some((entry) => entry.kind === mode)
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={!offered}
                        className={embedding.mode === mode ? 'is-selected' : ''}
                        aria-pressed={embedding.mode === mode}
                        onClick={() => void chooseEmbeddingMode(mode)}
                      >{mode === 'off' ? 'Off' : mode === 'local' ? 'On this machine' : 'Hosted'}</button>
                    )
                  })}
                </div>
                <p>{embedding.disclosure}</p>
                {embedding.model ? <small>Model: {embedding.model}</small> : null}
                {embedding.needsConsent ? (
                  <div className="answer-setting__row">
                    <Button size="small" onClick={() => void setEmbeddingConsent(embedding.providerId)}>Allow indexing</Button>
                    <small>Includes existing and future searchable captures. Remembered for this endpoint until you stop indexing. Provider retention applies.</small>
                  </div>
                ) : embedding.consentGranted ? (
                  <div className="answer-setting__row">
                    <Pill tone="info">Indexing allowed</Pill>
                    <Button variant="ghost" size="small" onClick={() => void setEmbeddingConsent(null)}>Stop indexing</Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="cost-debug">
              <Toggle
                checked={costDebug}
                onChange={(next) => void toggleCostDebug(next)}
                label="Cost debug"
                description="Show a cost check before Recall answers. Capture, local text recognition, and keyword search run on this Mac. Hosted indexing and other AI features have separate sharing controls."
              />
            </div>
            {!desktop.packaged ? (
              <div className="model-spend model-spend--session">
                <div className="model-spend__total">
                  <strong>
                    {sessionSpend === null || sessionSpend.calls === 0
                      ? 'Nothing spent yet'
                      : sessionSpend.cost === null
                        ? `${(sessionSpend.inputTokens + sessionSpend.outputTokens).toLocaleString()} tokens`
                        : formatMoney(sessionSpend.cost)}
                  </strong>
                  <small>
                    This session, since {new Date(state.product.startedAt).toLocaleTimeString()} (development build only)
                    {sessionSpend !== null && sessionSpend.calls > 0
                      ? ` · ${sessionSpend.calls} model call${sessionSpend.calls === 1 ? '' : 's'} · ${sessionSpend.inputTokens.toLocaleString()} in / ${sessionSpend.outputTokens.toLocaleString()} out${sessionSpend.cost === null ? ' · set a rate below to see cost' : ''}`
                      : ''}
                  </small>
                </div>
                {sessionSpend !== null && sessionSpend.byModel.length > 0 ? (
                  <ul>
                    {sessionSpend.byModel.map((group) => (
                      <li key={`session-${group.providerId}-${group.model}-${group.job}`}>
                        <span>{group.model} · {group.job}</span>
                        <small>{group.calls} call{group.calls === 1 ? '' : 's'} · {(group.inputTokens + group.outputTokens).toLocaleString()} tokens{group.cost === null ? '' : ` · ${formatMoney(group.cost)}`}</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {spend && spend.calls > 0 ? (
              <div className="model-spend">
                <div className="model-spend__total">
                  <strong>{spend.cost === null ? `${(spend.inputTokens + spend.outputTokens).toLocaleString()} tokens` : formatMoney(spend.cost)}</strong>
                  <small>{spend.calls} model call{spend.calls === 1 ? '' : 's'} · {spend.inputTokens.toLocaleString()} in / {spend.outputTokens.toLocaleString()} out{spend.cost === null ? ' · set a rate to see cost' : ''}</small>
                </div>
                <ul>
                  {spend.byModel.map((group) => (
                    <li key={`${group.providerId}-${group.model}-${group.job}`}>
                      <span>{group.model} · {group.job === 'recall.answer' ? 'answers' : 'induction'}</span>
                      <small>{group.calls} call{group.calls === 1 ? '' : 's'} · {(group.inputTokens + group.outputTokens).toLocaleString()} tokens{group.cost === null ? '' : ` · ${formatMoney(group.cost)}`}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="muted-note">No model calls recorded yet.</p>}
          </Card>

          <Card>
            <SectionHeading eyebrow="Recall evidence" title="What can be searched" description="Every capture is searchable by its window name. Reading a capture also makes the text that was on screen searchable." />
            {readState === null ? <p className="muted-note">No captures stored yet.</p> : (
              <div className="answer-setting">
                <p>{readState.unread > 0
                  ? `${readState.total - readState.unread - readState.skipped} of ${readState.total} captures have been read. The other ${readState.unread} can only be found by window name.`
                  : readState.skipped > 0
                    // Skipped captures are not read, so claiming otherwise here
                    // would misreport the one thing this panel exists to state.
                    ? `${readState.total - readState.skipped} of ${readState.total} captures have been read. ${readState.skipped} ${readState.skipped === 1 ? 'was' : 'were'} left unread on purpose.`
                    : `All ${readState.total} captures have been read. Their contents are searchable.`}</p>
                <div className="answer-setting__row">
                  <Pill tone={readState.unread === 0 ? 'positive' : 'info'}>{readState.total - readState.unread - readState.skipped} of {readState.total} read</Pill>
                  <Button variant="secondary" size="small" disabled={reading || readState.unread === 0} onClick={() => void readCaptures()}>
                    {reading ? 'Reading' : readState.unread === 0 ? 'Nothing to read' : `Read ${readState.unread} more`}
                  </Button>
                </div>
                {readState.skipped > 0 ? (
                  <div className="answer-setting__row">
                    <Pill>{readState.skipped} left unread on purpose</Pill>
                    <Button variant="ghost" size="small" onClick={() => void clearSkips()}>Offer them again</Button>
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeading eyebrow="Recall answers" title="How Carve answers from your history" description="Carve finds relevant saved screens and uses your connected AI to turn them into an answer." />
            {answerPolicy === null ? <p className="muted-note">No model is available. Recall cannot answer questions until inference is configured.</p> : (
              <div className="answer-setting">
                <p>{answerPolicy.disclosure}</p><small>Remembered for this service and endpoint until you turn off Recall answers. Capture retention does not delete conversations or information already sent to AI.</small>
                {answerPolicy.blockedReasons.length > 0 ? <p className="muted-note">Unavailable: {answerPolicy.blockedReasons.join(' · ')}</p> : null}
                <div className="answer-setting__row">
                  <Pill tone={answerPolicy.requiresExternalTransmission ? 'info' : 'positive'}>
                    {answerPolicy.providerName} · {answerPolicy.model}
                  </Pill>
                  {answerPolicy.requiresExternalTransmission ? (
                    answerPolicy.consentGranted
                      ? <Button variant="secondary" size="small" onClick={() => void setAnswerConsent(null)}>Pause inference answers</Button>
                      : <Button size="small" disabled={!answerPolicy.ready} onClick={() => void setAnswerConsent(answerPolicy.providerId)}>Enable inference answers</Button>
                  ) : <Pill tone="positive">No permission needed</Pill>}
                </div>
              </div>
            )}
          </Card>

          <CloudAccountCard notify={notify} desktop={desktop.desktop} />

          <Card>
            <SectionHeading eyebrow="AI services" title="AI connections" description="Carve checks which features are available before making a plan." />
            <div className="provider-grid">{state.providers.map((provider) => <div className={`provider-card ${provider.active ? 'provider-card--active' : ''}`} key={provider.id}><div className="provider-card__top"><div className="provider-card__icon">{provider.kind === 'local' ? <Laptop /> : provider.kind === 'hosted' ? <Cloud /> : <BrainCircuit />}</div><div><strong>{provider.name}</strong><span>{provider.model}</span></div>{provider.active ? <Pill tone="positive"><Check size={12} /> Active</Pill> : null}</div><p>{provider.privacyNote}</p><div className="capability-dots"><span className={provider.capabilities.text ? 'on' : ''}>Text</span><span className={provider.capabilities.vision ? 'on' : ''}>Vision</span><span className={provider.capabilities.embeddings ? 'on' : ''}>Embeddings</span><span className={provider.capabilities.structuredOutput ? 'on' : ''}>Schema</span><span className={provider.capabilities.toolCalling ? 'on' : ''}>Tools</span></div>{health[provider.id] ? <div className="health-result">{health[provider.id]}</div> : null}<div className="provider-card__actions"><Button variant="secondary" size="small" onClick={() => void checkHealth(provider.id)}>Check connection</Button><Button size="small" disabled={provider.active || !provider.configured} onClick={() => void selectProvider(provider.id)}>Select</Button></div></div>)}</div>
          </Card>

          <Card>
            <SectionHeading eyebrow="Tools" title="Available tools" description="Mock tools and allowlisted semantic controls across eleven disposable browser workflows are enabled. General computer, browser, shell, and filesystem tools remain disabled." />
            <div className="tool-table">{state.tools.map((tool) => <div className="tool-row" key={tool.name}><div className="tool-row__icon">{tool.family === 'computer' ? <MousePointer2 /> : tool.family === 'screenshot' ? <ScanLine /> : tool.family === 'browser' ? <Globe2 /> : tool.family === 'shell' ? <TerminalSquare /> : tool.family === 'filesystem' ? <FileOutput /> : <Box />}</div><div><code>{tool.name}</code><span>{tool.description}</span></div><Pill>{tool.location}</Pill><Pill tone={tool.available ? 'positive' : 'neutral'}>{tool.available ? 'Available' : 'Disabled'}</Pill><Pill tone={tool.defaultRisk === 'read_only' ? 'info' : 'warning'}>{humanize(tool.defaultRisk)}</Pill></div>)}</div>
          </Card>
        </div>

        <aside className="settings-grid__side">
          <Card>
            <SectionHeading eyebrow="Desktop" title="App status" />
            <div className="runtime-lockup"><div className="runtime-lockup__icon"><Laptop /></div><div><strong>{desktop.desktop ? 'Desktop app' : 'Local web app'}</strong><span>{desktop.platform === 'darwin' ? 'macOS' : humanize(desktop.platform)} · v{desktop.version}</span></div><Pill tone={desktop.desktop ? 'positive' : 'neutral'}>{desktop.desktop ? 'Connected' : 'Web'}</Pill></div>
            <div className="settings-list"><div><span>Screen recording</span><Pill tone={desktop.permissions.screenRecording === 'granted' ? 'positive' : 'neutral'}>{humanize(desktop.permissions.screenRecording)}</Pill></div><div><span>Screen recorder</span><Pill tone={state.nativeCapture.available ? 'positive' : 'neutral'}>{state.nativeCapture.available ? `v${state.nativeCapture.helperVersion ?? 'unknown'}` : 'Unavailable'}</Pill></div><div><span>Recorder access</span><strong>Can only view</strong></div><div><span>Accessibility</span><Pill tone={state.nativeCapture.accessibility === 'granted' ? 'positive' : 'neutral'}>{state.nativeCapture.supportedSignals.accessibilityTree ? humanize(state.nativeCapture.accessibility) : 'Unsupported'}</Pill></div><div><span>Confirm your identity</span><Pill tone={desktop.privacyReauthentication === 'available' ? 'positive' : 'neutral'}>{desktop.privacyReauthentication === 'available' ? 'Required to export or delete data' : humanize(desktop.privacyReauthentication)}</Pill></div><div><span>Emergency stop</span><code>{desktop.globalStopShortcut}</code></div><div><span>Ask Guide about a window</span><code>{desktop.guideShortcut}</code></div><div><span>Do it in a window</span><code>{desktop.doItShortcut ?? 'Unavailable'}</code></div><div><span>Packaged build</span><strong>{desktop.packaged ? 'Yes' : 'Development'}</strong></div></div>
            {desktop.desktop && desktop.platform === 'darwin' && desktop.permissions.screenRecording !== 'granted' ? <div className="desktop-permission-help"><p><strong>Allow Carve to see your screen</strong>Open Privacy &amp; Security → Screen &amp; System Audio Recording and enable the Carve entry. Return here afterward to refresh the status.</p><div><Button size="small" onClick={() => void openScreenRecordingSettings()}><ArrowRight size={14} /> Open System Settings</Button><Button size="small" variant="secondary" onClick={() => void checkDesktopPermissions()}><RefreshCw size={14} /> Check again</Button></div></div> : null}
          </Card>
          <Card>
            <SectionHeading eyebrow="Local data" title="Saved on this Mac" />
            <div className="path-box"><Database size={16} /><div><span>Database</span><code>{state.dataBoundary.database}</code></div></div><div className="path-box"><HardDrive size={16} /><div><span>Artifacts</span><code>{state.dataBoundary.artifacts}</code></div></div><div className="path-box"><BrainCircuit size={16} /><div><span>Evaluation plans and reports</span><code>{state.dataBoundary.evaluations}</code></div></div><div className="path-box"><ScanLine size={16} /><div><span>Native captures</span><code>{state.dataBoundary.nativeCaptures}</code></div></div><div className="path-box"><Activity size={16} /><div><span>Browser traces · {state.browserSandbox.traceCount}</span><code>{state.dataBoundary.traces}</code></div></div><div className="path-box"><Clock3 size={16} /><div><span>Automatic retention</span><code>{state.retention.policy}</code><span>{state.retention.lastEnforcedAt ? `Last pass ${dateTime.format(new Date(state.retention.lastEnforcedAt))}` : 'Startup pass found no expired evidence'}</span></div></div><div className="encryption-warning"><FileKey size={17} /><span>{state.dataBoundary.encryptionAtRest}</span></div><div className="export-protection"><LockKeyhole size={17} /><span>{state.dataBoundary.exportProtection}</span></div>
            <div className="stacked-actions"><Button variant="secondary" onClick={() => setExportOpen(true)}><Download size={16} /> Export encrypted data</Button><Button variant="danger" onClick={() => void purge()}><Trash2 size={16} /> Permanently delete local data</Button></div>
          </Card>
          <Card className="privacy-promise"><LockKeyhole /><div><strong>Choose what you share with AI</strong><p>The practice AI stays offline. Cloud AI connections explain what they share before you choose them.</p></div></Card>
        </aside>
      </div>
    </div>
  )
}
