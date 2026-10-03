import carveMark from '../../brand/carve/mark.svg'
import { isCopilot, isPageAvailable } from '../../src/product-experience'
import { computerSupervisionStatus } from '../../src/live-computer-supervision'
import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  Activity,
  BookOpenCheck,
  Bot,
  ChevronRight,
  CirclePause,
  Command,
  History,
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Radio,
  ScrollText,
  Settings,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react'
import type { DesktopStatus, PageId, CarveState } from './model'

export type Tone = 'neutral' | 'positive' | 'warning' | 'danger' | 'accent' | 'info'

export interface ToastMessage {
  id: number
  message: string
  tone: Tone
}

export function Button({
  className = '',
  variant = 'primary',
  size = 'medium',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'small' | 'medium' | 'large'
}) {
  return <button className={`button button--${variant} button--${size} ${className}`.trim()} {...props}>{children}</button>
}

export function CarveLogo({ className = '' }: { className?: string }) {
  return <img src={carveMark} className={className} alt="" aria-hidden="true" />
}

/** Decorative presence; adjacent text always carries the actual task status. */
export function CarvePresence({ state = 'ready', className = '' }: { state?: 'ready' | 'listening' | 'working' | 'attention' | 'paused' | 'complete'; className?: string }) {
  return <span className={`carve-presence ${className}`} data-state={state} aria-hidden="true"><span /></span>
}

export function Pill({ children, tone = 'neutral', icon }: PropsWithChildren<{ tone?: Tone; icon?: ReactNode }>) {
  return <span className={`pill pill--${tone}`}>{icon}{children}</span>
}

export function Card({ children, className = '', elevated = false }: PropsWithChildren<{ className?: string; elevated?: boolean }>) {
  return <section className={`card ${elevated ? 'card--elevated' : ''} ${className}`.trim()}>{children}</section>
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </div>
  )
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function Field({ label, hint, children, className = '' }: PropsWithChildren<{ label: string; hint?: string; className?: string }>) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  )
}

export function Toggle({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={`toggle-row ${disabled ? 'toggle-row--disabled' : ''}`}>
      <span>
        <span className="toggle-row__label">{label}</span>
        {description ? <span className="toggle-row__description">{description}</span> : null}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle" aria-hidden="true"><span /></span>
    </label>
  )
}

/**
 * The launch surface is Home (ask), Work (do it), and History (the receipt).
 * Learn, Review, and Recall are memory features that only matter once the
 * person has chosen to capture something, so they sit under a quiet group.
 */
const navItems: Array<{ id: PageId; label: string; icon: typeof Search; group: 'primary' | 'memory' | 'system' }> = [
  { id: 'overview', label: 'Home', icon: House, group: 'primary' },
  { id: 'work', label: 'Work', icon: Play, group: 'primary' },
  { id: 'history', label: 'Recent tasks', icon: History, group: 'primary' },
  { id: 'learn', label: 'Learn', icon: Radio, group: 'memory' },
  { id: 'review', label: 'Review', icon: BookOpenCheck, group: 'memory' },
  { id: 'recall', label: 'Recall', icon: Search, group: 'memory' },
  { id: 'audit', label: 'Activity', icon: ScrollText, group: 'system' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'system' },
]

export function AppShell({
  children,
  page,
  onNavigate,
  onGlobalStop,
  state,
  sidebarOpen,
  connectionLost = false,
  accountRequired = false,
  onToggleSidebar,
}: PropsWithChildren<{
  page: PageId
  onNavigate: (page: PageId) => void
  onGlobalStop: () => void
  state: CarveState
  desktop: DesktopStatus
  sidebarOpen: boolean
  connectionLost?: boolean
  accountRequired?: boolean
  onToggleSidebar: () => void
}>) {
  const activeSession = state.sessions.find((session) => session.status !== 'stopped')
  const activeRun = state.runs.find((run) => ['running', 'awaiting_approval', 'awaiting_guidance'].includes(run.status))
  const latestComputer = computerSupervisionStatus(state.liveComputer.session, state.liveComputer.universalSession)
  const computer = latestComputer?.active || !activeRun ? latestComputer : null
  const canGlobalStop = Boolean(connectionLost || computer?.active || activeRun || activeSession?.status === 'active')
  const activePace = activeRun ? (activeRun.supervisionAmendments?.at(-1)?.nextPolicy.preset ?? activeRun.plan.supervision?.preset ?? null) : null
  const safetyLabel = accountRequired ? 'Sign in to get started' : connectionLost ? 'Status unavailable' : computer ? `${computer.label} · ${computer.application}` : activeRun ? (activePace === 'autopilot' ? 'Carve on Autopilot' : 'Carve working') : activeSession?.status === 'active' ? 'Learning active' : activeSession?.status === 'paused' ? 'Learning paused' : 'Ready when you are'
  const safetyTone: Tone = computer?.waiting ? 'warning' : computer?.active ? 'accent' : activeRun ? 'accent' : activeSession?.status === 'active' ? 'positive' : activeSession?.status === 'paused' ? 'warning' : 'neutral'

  const visibleNavigation = navItems.filter(item => isPageAvailable(state.product, item.id))
  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'app-shell--collapsed'} ${isCopilot(state.product) ? 'app-shell--copilot' : ''}`}>
      <aside id="primary-navigation" className="sidebar" aria-label="Primary navigation">
        <div className="desktop-drag-region" />
        <div className="brand">
          <CarveLogo className="brand__presence" />
          <div className="brand__copy">
            <span>Carve</span>
          </div>
          <button className="icon-button sidebar__collapse" onClick={onToggleSidebar} aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} aria-controls="primary-navigation" aria-expanded={sidebarOpen}>
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        <nav className="nav-list">
          {visibleNavigation.map((item, index) => {
            const Icon = item.icon
            const count = item.id === 'review' ? state.reviewWorkspace.sessions.reduce((sum, workspace) => sum + workspace.episode.pendingObservationIds.length, 0) : item.id === 'audit' ? state.audit.length : null
            const groupStart = index > 0 && visibleNavigation[index - 1]?.group !== item.group
            return (
              <div key={item.id} className="nav-entry">
                {groupStart ? <div className="nav-group-label">{item.group === 'memory' ? 'Memory' : ''}</div> : null}
                <button className={`nav-item ${page === item.id ? 'nav-item--active' : ''}`} onClick={() => onNavigate(item.id)} title={item.label}>
                  <Icon size={19} strokeWidth={1.8} />
                  <span>{isCopilot(state.product) && item.id === 'work' ? 'Current task' : item.label}</span>
                  {count !== null ? <small>{count}</small> : null}
                </button>
              </div>
            )
          })}
        </nav>
      </aside>

      <div className="workspace">
        <header className="safety-rail">
          <button className="icon-button mobile-menu" onClick={onToggleSidebar} aria-label={sidebarOpen ? 'Close navigation' : 'Expand sidebar'} aria-controls="primary-navigation" aria-expanded={sidebarOpen}>
            {sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          </button>
          <div className="safety-rail__state">
            <Pill tone={safetyTone} icon={activeRun ? <Activity size={13} /> : activeSession?.status === 'active' ? <Radio size={13} /> : <ShieldCheck size={13} />}>{safetyLabel}</Pill>
            <span className="safety-rail__detail">
              {computer?.goal ?? (activeRun ? activeRun.plan.goal : activeSession ? activeSession.name : 'What would you like a hand with?')}
            </span>
          </div>
          <div className="safety-rail__actions">{computer && window.stewardDesktop?.showCapsule ? <Button size="small" variant="ghost" onClick={() => window.stewardDesktop?.showCapsule?.()}>Compact view</Button> : null}{computer ? <Button size="small" variant="ghost" onClick={() => onNavigate('work')}>{computer.active ? 'View task' : 'View result'}</Button> : null}
            {canGlobalStop ? <span className="shortcut" title="Emergency stop: Esc while Carve works, or ⌘⇧. anywhere">Esc · <Command size={13} />⇧.</span> : null}
            <Button
              className={canGlobalStop ? 'safety-stop safety-stop--active' : 'safety-stop safety-stop--idle'}
              variant={canGlobalStop ? 'danger' : 'secondary'}
              size="small"
              disabled={!canGlobalStop}
              aria-label={canGlobalStop ? 'Stop all tasks and screen recording' : 'All tasks and screen recording are stopped'}
              title={canGlobalStop ? 'Stop all tasks and pause screen recording (Esc or ⌘⇧.)' : 'No tasks or screen recording are active'}
              onClick={onGlobalStop}
            >
              {canGlobalStop ? <Square size={14} fill="currentColor" /> : <ShieldCheck size={14} />}
              {canGlobalStop ? 'Stop all' : 'All stopped'}
            </Button>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  )
}

/**
 * A short, focused interruption. Used where a question is better asked once, in
 * the moment it matters, than answered by a control the person has to find and
 * understand beforehand. Ordinary dialogs dismiss through Escape or the
 * backdrop; explicit decision surfaces may keep focus until a choice is made.
 */
export function Dialog({ title, description, onDismiss, children, className = '', eyebrow, icon, tone = 'accent', dismissible = true }: PropsWithChildren<{ title: string; description?: string; onDismiss: () => void; className?: string; eyebrow?: string; icon?: ReactNode; tone?: Tone; dismissible?: boolean }>) {
  const panel = useRef<HTMLDivElement>(null)
  const dismiss = useRef(onDismiss)
  const canDismiss = useRef(dismissible)
  const titleId = useId()
  const descriptionId = useId()
  dismiss.current = onDismiss
  canDismiss.current = dismissible
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canDismiss.current) dismiss.current()
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onDismiss() }}>
      <div className={`dialog ${icon ? 'dialog--feature' : ''} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} ref={panel}>
        {icon ? (
          <div className="dialog__heading">
            <span className={`dialog__icon dialog__icon--${tone}`}>{icon}</span>
            <div>
              {eyebrow ? <span className="dialog__eyebrow">{eyebrow}</span> : null}
              <strong id={titleId}>{title}</strong>
              {description ? <p id={descriptionId}>{description}</p> : null}
            </div>
          </div>
        ) : <><strong id={titleId}>{title}</strong>{description ? <p id={descriptionId}>{description}</p> : null}</>}
        <div className="dialog__actions">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span>{toast.message}</span>
          <button className="icon-button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification"><X size={16} /></button>
        </div>
      ))}
    </div>
  )
}

export function InlineLink({ children, onClick }: PropsWithChildren<{ onClick: () => void }>) {
  return <button className="inline-link" onClick={onClick}>{children}<ChevronRight size={14} /></button>
}

export function PageIntro({ label, title, description, action }: { label: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="page-intro">
      <div>
        <div className="eyebrow">{label}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="page-intro__action">{action}</div> : null}
    </header>
  )
}

export function ProcedureGlyph({ size = 22 }: { size?: number }) {
  return <BookOpenCheck size={size} />
}

export function EmployeeGlyph({ size = 22 }: { size?: number }) {
  return <Bot size={size} />
}

export function PauseGlyph({ size = 16 }: { size?: number }) {
  return <CirclePause size={size} />
}
