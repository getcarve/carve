import { sharingRecipient } from '../../src/ai-sharing'
import { useEffect, useState } from 'react'
import { Check, Cloud, Eye, MousePointer2 } from 'lucide-react'
import { invoke } from './api'
import { Button } from './components'
import { LegalLinks } from './legal'
import type { DesktopStatus, CarveState } from './model'

const DISMISS_KEY = 'steward.onboarding.dismissed'

function dismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/**
 * Guide-first onboarding. Three grants and one keypress: Screen Recording so
 * Guide can read the window you point at, Accessibility so it can validate
 * the control and, later, act, and permission to send that one window's
 * picture to Carve Cloud. The card leaves once everything is done.
 */
export function GuideOnboardingCard({ state, desktop, notify, refresh, onSettings }: { onSettings?: () => void; state: CarveState; desktop: DesktopStatus; notify: (message: string, tone?: 'accent' | 'positive' | 'danger' | 'neutral' | 'warning' | 'info') => void; refresh: () => Promise<void> }) {
  const [hidden, setHidden] = useState(dismissed())
  const [rememberSharing, setRememberSharing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const cloudProvider = state.providers.find((provider) => provider.id === 'carve-cloud')
  const cloudConfigured = Boolean(cloudProvider?.configured)
  const visionProvider = state.providers.find((provider) => provider.active && provider.kind !== 'mock' && provider.configured && provider.capabilities.vision) ?? (cloudConfigured ? cloudProvider : undefined)
  const consented = visionProvider ? (visionProvider.kind !== 'hosted' || (state.liveComputer.sharing?.some(entry => entry.providerId === visionProvider.id && entry.windows) ?? state.liveComputer.visualsConsentProviderId === visionProvider.id)) : false
  const screen = desktop.permissions.screenRecording
  const accessibility = desktop.permissions.accessibility
  const screenDone = screen === 'granted' || screen === 'not_applicable'
  const accessibilityDone = accessibility === 'granted' || accessibility === 'not_applicable'
  const allDone = screenDone && accessibilityDone && consented
  useEffect(() => {
    if (allDone) return
    const check = () => { if (document.visibilityState === 'visible') void refresh().catch(() => {}) }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [allDone, refresh])

  const hasStarted = Boolean(state.runs.length || state.liveComputer.assistance?.question || state.liveComputer.assistance?.active || state.liveComputer.assistance?.preparing)
  if (((hidden || hasStarted) && allDone) || !desktop.desktop) return null

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    try {
      await action()
      await refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(null)
    }
  }

  const steps = [
    {
      id: 'screen',
      icon: <Eye size={16} />,
      title: 'See the window you ask about',
      detail: 'Screen Recording lets Carve capture the window you select for a question or task.',
      done: screenDone,
      action: <Button size="small" disabled={busy !== null} onClick={() => void run('screen', async () => { await invoke({ kind: 'computer.request_screen_recording_permission' }) })}>{screen === 'denied' ? 'System Settings' : 'Allow'}</Button>,
    },
    {
      id: 'accessibility',
      icon: <MousePointer2 size={16} />,
      title: 'Point, click, and type',
      detail: 'Accessibility permission lets Carve click and type in the window you choose.',
      done: accessibilityDone,
      action: <Button size="small" disabled={busy !== null} onClick={() => void run('accessibility', async () => { await invoke({ kind: 'computer.request_accessibility_permission' }) })}>{accessibility === 'denied' ? 'System Settings' : 'Allow'}</Button>,
    },
    {
      id: 'consent',
      icon: <Cloud size={16} />,
      title: visionProvider?.kind === 'hosted' ? `Answer with ${visionProvider.name}` : 'Connect an AI service',
      detail: visionProvider?.kind === 'hosted'
        ? `When you ask, images, visible text and controls from your selected windows and relevant conversation context go to ${sharingRecipient(visionProvider)}. Allow until Carve quits; remembering is optional. Provider retention and local history apply.`
        : visionProvider ? 'Requests go to your local model endpoint. Its forwarding settings still apply.' : 'Connect an AI service in Settings to get started.',
      done: consented,
      action: visionProvider ? <Button size="small" disabled={busy !== null} onClick={() => void run('consent', async () => { await invoke({ kind: 'computer.visuals_consent', providerId: visionProvider.id, remember: rememberSharing }) })}>{rememberSharing ? 'Allow and remember' : 'Allow this session'}</Button> : onSettings ? <Button size="small" onClick={onSettings}>Connect</Button> : null,
    },
  ]

  const currentStep = steps.findIndex(step => !step.done)
  return (
    <section className="home-setup" aria-label="Set up Carve">
      <div className="home-setup__lead">
        <strong>{allDone ? 'Ready for your first task' : `Set up your Mac · ${steps.filter(step => step.done).length} of 3 complete`}</strong>
        <span>{allDone ? 'Try the sample task below, or choose a window of your own.' : cloudConfigured ? 'Let Carve help in the window you choose. We’ll take this one step at a time.' : 'Connect an AI service and allow access to the window you choose.'}</span>
      </div>
      <ol className="home-setup__steps">
        {steps.map((step, index) => (
          <li key={step.id} aria-current={index === currentStep ? 'step' : undefined} className={step.done ? 'is-done' : index !== currentStep ? 'is-upcoming' : ''}>
            <span className="home-setup__icon">{step.done ? <Check size={14} /> : step.icon}</span>
            <div><strong>{step.title}</strong>{index === currentStep ? <small>{step.detail}</small> : null}{index === currentStep && step.id === 'consent' && visionProvider?.kind === 'hosted' && !consented ? <label className="sharing-choice"><input type="checkbox" checked={rememberSharing} onChange={event => setRememberSharing(event.target.checked)} />Remember window sharing on this Mac</label> : null}</div>
            {step.done ? <span className="home-setup__done">Done</span> : index === currentStep ? step.action : <span className="home-setup__done">Next</span>}
          </li>
        ))}
      </ol>
      {!allDone && currentStep < 2 ? <p className="home-setup__return">In System Settings → Privacy &amp; Security → {currentStep === 0 ? 'Screen Recording (or Screen & System Audio Recording)' : 'Accessibility'}, enable <strong>Carve Live Computer</strong>, the helper included with Carve, then return here. If macOS asks you to quit and reopen Carve, do so; your setup is saved. <Button variant="ghost" size="small" disabled={busy !== null} onClick={() => void run('check', refresh)}>Check again</Button></p> : null}
      <details className="home-setup__disclosure"><summary>About access and AI</summary>
      <p>Carve reads app names locally to help choose where to work. Before sending that list to AI, it asks separately. Screen Recording and Accessibility allow access on this Mac; they do not grant cloud sharing.</p>
      <p className="legal-task-disclosure">Carve uses AI and can make mistakes. Computer control can change files and act through your signed-in apps. Review important work, keep sensitive content out of captures, and use Stop if anything looks wrong.</p>
      <LegalLinks compact />
      </details>
      {allDone ? <button type="button" className="home-setup__dismiss" onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ } setHidden(true) }}>Got it</button> : null}
    </section>
  )
}
