import { assistanceCheckpoint } from './approval-state'
import { isCopilot, isPageAvailable, resolveProductPage } from '../../src/product-experience'
import { CopilotHome } from './copilot-home'
import { CopilotSettings } from './copilot-settings'
import { LegalBoundary } from './legal'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { getDesktopStatus, getState, invoke } from './api'
import { AppShell, Button, CarvePresence, ToastStack, type ToastMessage, type Tone } from './components'
import type { DesktopStatus, PageId, CarveState } from './model'
import { webDesktopStatus } from './model'
import { computerSupervisionStatus } from '../../src/live-computer-supervision'
import { isLiveComputerSessionActive, selectWorkRunForEntry } from '../../src/live-computer-state'
import type { LiveComputerTarget, WorkBudgetPreset } from '../../src/types'
import { AuditView, ComputerUseLabView, DelegationWorkView, LearnView, OverviewView, ProceduresView, RecallView, ReviewView, SettingsView, type ViewProps } from './views'
import { HistoryView } from './history'
import { AssistancePanel } from './assistance'
import { CloudAccountBoundary } from './cloud-account-boundary'
import type { CloudStatus } from '../../src/cloud/client'

function initialPage(): PageId {
  return 'overview'
}

export default function App() {
  const [state, setState] = useState<CarveState | null>(null)
  const [desktop, setDesktop] = useState<DesktopStatus>(webDesktopStatus)
  const [requestedPage, setPage] = useState<PageId>(initialPage)
  const page = resolveProductPage(state?.product ?? {}, requestedPage)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 720)
  const [focusedWorkRunId, setFocusedWorkRunId] = useState<string | null>(null)
  const [workGoal, setWorkGoal] = useState('')
  const [freshWorkRequestId, setFreshWorkRequestId] = useState<number | null>(null)
  const [freshWorkBudget, setFreshWorkBudget] = useState<WorkBudgetPreset | null>(null)
  const [freshWorkSourceTarget, setFreshWorkSourceTarget] = useState<LiveComputerTarget | undefined>()
  const freshWorkSequence = useRef(0)
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const toastId = useRef(0)

  const notify = useCallback((message: string, tone: Tone = 'neutral') => {
    const id = ++toastId.current
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4800)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextDesktop] = await Promise.all([getState(), getDesktopStatus()])
      setState(nextState)
      setDesktop(nextDesktop)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const load = () => { void invoke<CloudStatus>({ kind: 'cloud.status' }).then(setCloudStatus).catch(() => {}) }
    load()
    window.addEventListener('carve:account-changed', load)
    window.addEventListener('focus', load)
    return () => { window.removeEventListener('carve:account-changed', load); window.removeEventListener('focus', load) }
  }, [])

  useEffect(() => {
    const compact = window.matchMedia('(max-width: 720px)')
    const closeNavigation = () => { if (compact.matches) setSidebarOpen(false) }
    compact.addEventListener('change', closeNavigation)
    return () => compact.removeEventListener('change', closeNavigation)
  }, [])


  // Capsule and hotkey follow-ups originate in Electron's main process, not in
  // this React tree. Subscribe to the canonical live-session feed so the Work
  // view reveals them immediately; the interval below remains reconciliation,
  // not the discovery mechanism.
  useEffect(() => window.stewardDesktop?.onStateChanged?.(() => { void refresh() }), [refresh])

  // Latch ownership when a capsule follow-up supersedes the displayed result.
  // Keeping only a derived override would jump back to the old result as
  // soon as the new session finishes and is no longer "active".
  useEffect(() => {
    if (!state || freshWorkRequestId !== null) return
    const selected = selectWorkRunForEntry(state.runs, state.liveComputer.session, 'resume', focusedWorkRunId)
    if (selected && selected.id !== focusedWorkRunId) setFocusedWorkRunId(selected.id)
  }, [state, freshWorkRequestId, focusedWorkRunId])

  useEffect(() => window.stewardDesktop?.onOpenActiveWork?.((request) => { setFocusedWorkRunId(request.runId); setFreshWorkRequestId(null); setPage('work'); void refresh() }), [refresh])
  // The capsule's "See plans" (allowance used up) opens Settings, where plans and packs are.
  useEffect(() => window.stewardDesktop?.onOpenSettings?.(() => { setPage('settings'); void refresh() }), [refresh])

  useEffect(() => window.stewardDesktop?.onNotice?.((notice) => { notify(notice.text, notice.tone) }), [notify])

  useEffect(() => window.stewardDesktop?.onOpenWork?.((request) => {
    setFocusedWorkRunId(null)
    setWorkGoal(request.goal)
    setFreshWorkBudget(request.budget)
    setFreshWorkSourceTarget(request.routeSourceTarget)
    setFreshWorkRequestId(++freshWorkSequence.current)
    setPage('work')
    window.localStorage.setItem('steward.page', 'work')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    void refresh()
  }), [refresh])

  useEffect(() => {
    if (!state) return
    const active = state.sessions.some((session) => session.status !== 'stopped')
      || state.runs.some((run) => ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status))
      || isLiveComputerSessionActive(state.liveComputer.session)
      || Boolean(state.liveComputer.universalSession && ['starting', 'running', 'pausing', 'paused', 'awaiting_checkpoint', 'awaiting_steering_review', 'awaiting_budget', 'replanning'].includes(state.liveComputer.universalSession.status))
    const interval = window.setInterval(() => void refresh(), active ? 500 : 3000)
    return () => window.clearInterval(interval)
  }, [refresh, state])

  useEffect(() => {
    if (state?.procedures[0] && !workGoal.trim()) setWorkGoal(state.procedures[0].goal)
  }, [state, workGoal])

  const navigate = (next: PageId) => {
    if (!isPageAvailable(state?.product ?? {}, next)) return
    if (next === 'work' && state) setFocusedWorkRunId(computerSupervisionStatus(state.liveComputer.session, state.liveComputer.universalSession)?.runId ?? null)
    setPage(next)
    window.localStorage.setItem('steward.page', next)
    if (window.innerWidth < 820) setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openWork = (goal: string, mode: 'fresh' | 'resume') => {
    setWorkGoal(goal)
    setFreshWorkBudget(null)
    setFreshWorkSourceTarget(undefined)
    setFreshWorkRequestId(mode === 'fresh' ? ++freshWorkSequence.current : null)
    navigate('work')
    if (mode === 'fresh') setFocusedWorkRunId(null)
  }

  const consumeFreshWorkRequest = (requestId: number) => {
    setFreshWorkRequestId((current) => current === requestId ? null : current)
  }

  const globalStop = async () => {
    try {
      await invoke({ kind: 'system.global_stop' })
      await refresh()
      notify('All active runs stopped and capture paused', 'warning')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : String(caught), 'danger')
    }
  }

  if (!state) {
    return (
      <div className="launch-state">
        <CarvePresence state={error ? 'attention' : 'working'} />
        {error ? <><AlertTriangle size={22} /><h1>Carve could not open</h1><p>{error}</p><Button onClick={() => void refresh()}><RotateCcw size={16} /> Try again</Button></> : <><div className="launch-state__spinner" /><h1>Getting ready for you</h1><p>Carve is opening…</p></>}
      </div>
    )
  }

  const viewProps: ViewProps = { focusedWorkRunId, state, desktop, refresh, notify, navigate, workGoal, setWorkGoal, freshWorkRequestId, freshWorkBudget, freshWorkSourceTarget, openWork, consumeFreshWorkRequest }
  const copilot = isCopilot(state.product)
  const view = page === 'overview' ? (copilot ? <CopilotHome {...viewProps} /> : <OverviewView {...viewProps} />)
    : page === 'learn' ? <LearnView {...viewProps} />
      : page === 'recall' ? <RecallView {...viewProps} />
      : page === 'review' ? <ReviewView {...viewProps} />
        : page === 'procedures' ? <ProceduresView {...viewProps} />
          : page === 'work' ? <DelegationWorkView {...viewProps} />
          : page === 'history' ? <HistoryView {...viewProps} />
            : page === 'lab' ? <ComputerUseLabView {...viewProps} />
              : page === 'audit' ? <AuditView {...viewProps} />
              : copilot ? <CopilotSettings {...viewProps} /> : <SettingsView {...viewProps} />

  return (
    <>
      <AppShell accountRequired={cloudStatus?.configured === true && !cloudStatus.signedIn} connectionLost={Boolean(error)} page={page} onNavigate={navigate} onGlobalStop={() => void globalStop()} state={state} desktop={desktop} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((open) => !open)}>
        {error ? <div className="connection-warning" role="alert"><AlertTriangle size={18} /><span><strong>Can’t get the latest update.</strong> Showing the last known state. Carve may still be working.</span><Button size="small" onClick={() => void refresh()}>Reconnect</Button></div> : null}
        <CloudAccountBoundary status={cloudStatus} onStatus={setCloudStatus} allowManagement={page === 'settings' || page === 'history'} desktop={desktop.desktop} notify={notify}>
        <LegalBoundary allowManagement={page === 'settings' || page === 'history'} onManageData={() => navigate('settings')}>
        {((page === 'overview' && !copilot) || (page === 'work' && state.liveComputer.assistance?.showGuide) || (page !== 'overview' && state.liveComputer.assistance?.active)) ? <AssistancePanel checkpoint={assistanceCheckpoint(state)} dictationAvailable={state.dictation.configured} state={state.liveComputer.assistance} refresh={refresh} notify={notify} /> : null}
        {view}
        </LegalBoundary>
        </CloudAccountBoundary>
      </AppShell>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </>
  )
}
