import { useEffect, type PropsWithChildren } from 'react'
import type { CloudStatus } from '../../src/cloud/client'
import { invoke } from './api'
import { CloudAccountCard } from './cloud-account'
import { Card, Button, type Tone } from './components'

/** Sign-in precedes permissions and AI entry points. History and account
 * management remain accessible during outages, after sign-out, and at expiry. */
export function CloudAccountBoundary({ children, status, onStatus, allowManagement, desktop, notify }: PropsWithChildren<{
  status: CloudStatus | null
  onStatus: (status: CloudStatus) => void
  allowManagement: boolean
  desktop: boolean
  notify: (message: string, tone?: Tone) => void
}>) {
  useEffect(() => {
    if (!status?.configured) return
    let stopped = false
    const refresh = () => { void invoke<{ receipt: unknown }>({ kind: 'legal.status' }).then(legal => invoke<CloudStatus>({ kind: legal.receipt ? 'cloud.refresh' : 'cloud.status' })).then(next => { if (!stopped) onStatus(next) }).catch(() => {}) }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [status?.configured, onStatus])
  if (allowManagement || status?.configured === false) return <>{children}</>
  if (!status) return <Card><p role="status">Checking your Carve account…</p><Button onClick={() => void invoke<CloudStatus>({ kind: 'cloud.status' }).then(onStatus)}>Try again</Button></Card>
  if (!status.signedIn) return <section className="cloud-onboarding" aria-label="Welcome to your Carve beta trial">
    <h1>Welcome to your Carve beta.</h1>
    <p>One sign-in, then we’ll help you set up your Mac and try your first task.</p>
    <CloudAccountCard notify={notify} desktop={desktop} focused />
    <p>Use the same email you entered on the beta invitation page. <a href="https://www.getcarve.app/beta" target="_blank" rel="noopener noreferrer">Redeem your invitation</a>.</p>
  </section>
  const trial = status.entitlement?.trial
  return <>
    {trial ? <div className="settings-note" role="status"><span><strong>Beta trial</strong> · {trial.state === 'expired' ? 'Your trial has ended.' : !trial.endsAt ? '5 task credits · 50 Guide questions · 7 days starting with your first task.' : `${Math.max(0, trial.tasksTotal - trial.tasksUsed)} task credits left · ends ${new Date(trial.endsAt).toLocaleString()}.`} No automatic charges. {trial.state === 'expired' || trial.state === 'exhausted' ? <a href="mailto:support@getcarve.app?subject=Carve%20beta%20extension">Request a beta extension</a> : null}</span></div> : null}
    {status.lastError ? <div className="settings-note" role="alert">Carve Cloud is unavailable. Your history is still accessible; AI needs a connection.</div> : null}
    {children}
  </>
}
