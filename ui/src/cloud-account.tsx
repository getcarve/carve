import { useEffect, useRef, useState } from 'react'
import { completeBrowserVerification, type BrowserVerification } from './cloud-onboarding'
import { Cloud, LogOut, RefreshCw, ShieldAlert } from 'lucide-react'
import { invoke } from './api'
import { LEGAL_VERSION, LegalAcceptance } from './legal'
import { Button, Card, Field, Pill, SectionHeading } from './components'
import type { BrowserSignInStart, CloudStatus, SignInStart } from '../../src/cloud/client'

type Notify = (message: string, tone?: 'accent' | 'positive' | 'danger' | 'neutral') => void

/**
 * Settings → Account. Sign in with an email code, see the plan and this
 * period's usage, upgrade or buy tasks (opens the browser), manage billing,
 * sign out, or delete the account.
 */
export function CloudAccountCard({ notify, desktop, focused = false }: { notify: Notify; desktop: boolean; focused?: boolean }) {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [email, setEmail] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [legalSaved, setLegalSaved] = useState(false)
  const [browserSignIn, setBrowserSignIn] = useState<BrowserSignInStart | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [browserVerification, setBrowserVerification] = useState<BrowserVerification | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteChallengeId, setDeleteChallengeId] = useState<string | null>(null)
  const [deleteCode, setDeleteCode] = useState('')
  const [unreachable, setUnreachable] = useState<string | null>(null)

  const load = async (refresh: boolean, announce = true) => {
    try {
      const legal = await invoke<{ receipt: unknown }>({ kind: 'legal.status' })
      if (legal.receipt) { setTermsAccepted(true); setLegalSaved(true) }
      setStatus(await invoke<CloudStatus>({ kind: refresh && legal.receipt ? 'cloud.refresh' : 'cloud.status' }))
      setUnreachable(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Opening Settings is not a request to reach the network: a build that
      // cannot reach Carve Cloud shows the local status and a quiet note
      // instead of a raw error toast. Explicit refreshes still announce.
      setUnreachable(message)
      if (announce) notify(message, 'danger')
      try {
        const local = await invoke<CloudStatus>({ kind: 'cloud.status' })
        setStatus(local)
        if (local.credentialStorage === 'unavailable') setUnreachable(null)
      } catch { /* local status unavailable too */ }
    }
  }

  useEffect(() => { void load(true, false) }, [])
  useEffect(() => { if (status) window.dispatchEvent(new Event('carve:account-changed')) }, [status])

  useEffect(() => {
    if (!browserVerification || !termsAccepted) return
    const controller = new AbortController()
    void completeBrowserVerification(browserVerification, {
      signal: controller.signal,
      status: ticket => invoke<{ verified: boolean }>({ kind: 'cloud.signin.status', ticket }),
      start: address => invoke<SignInStart>({ kind: 'cloud.signin.start', email: address }),
    }).then(started => {
      if (controller.signal.aborted) return
      setBrowserVerification(null)
      setChallengeId(started.challengeId)
      setVerificationError(null)
    }).catch(error => {
      if (controller.signal.aborted) return
      setBrowserVerification(null)
      setVerificationError(error instanceof Error ? error.message : 'Please try the browser check again.')
    })
    return () => controller.abort()
  }, [browserVerification, termsAccepted])

  useEffect(() => {
    if (!browserSignIn) return
    let stopped = false, completed = false, failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        if (Date.now() >= Date.parse(browserSignIn.expiresAt)) throw new Error('Browser sign-in expired. Try again or use an email code.')
        const result = await invoke<{ pending: boolean; status?: CloudStatus }>({ kind: 'cloud.browser.finish', id: browserSignIn.id, termsVersion: LEGAL_VERSION })
        failures = 0
        if (stopped) return
        if (!result.pending && result.status) {
          completed = true
          setStatus(result.status)
          setBrowserSignIn(null)
          notify('Signed in. Let’s set up your first task.', 'positive')
          return
        }
      } catch (error) {
        if (stopped) return
        if (++failures >= 3 || Date.now() >= Date.parse(browserSignIn.expiresAt)) {
          setVerificationError(error instanceof Error ? error.message : 'Use an email code to sign in.')
          setBrowserSignIn(null)
          return
        }
      }
      if (!stopped) timer = setTimeout(() => { void poll() }, 2000)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      if (!completed) void invoke({ kind: 'cloud.browser.cancel', id: browserSignIn.id }).catch(() => {})
    }
  }, [browserSignIn])

  const acceptTerms = async () => {
    if (!termsAccepted) throw new Error('Review and accept the terms before continuing.')
    if (!legalSaved) {
      await invoke({ kind: 'legal.accept', version: LEGAL_VERSION })
      setLegalSaved(true)
    }
  }

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setVerificationError(message)
      notify(message, 'danger')
    } finally {
      setBusy(null)
    }
  }

  const openUrl = async (command: { kind: 'cloud.checkout'; plan?: 'pro' | 'max' | 'own_key'; interval?: 'month' | 'year' | 'lifetime'; pack?: 'tasks_20' | 'tasks_100' } | { kind: 'cloud.portal' }) => {
    const result = await invoke<{ url: string; opened?: boolean }>(command)
    if (!result.opened && !desktop) window.open(result.url, '_blank', 'noopener')
    notify('Opened in your browser. Come back here when you are done.', 'accent')
  }

  if (!status) return <Card><SectionHeading eyebrow="Account" title="Carve Cloud" description="Loading…" /></Card>
  if (!status.configured) {
    return (
      <Card>
        <SectionHeading eyebrow="Account" title="Carve Cloud" description={focused ? "Carve Cloud is not connected in this local preview. Your existing AI connection is shown below." : "This build is not connected to Carve Cloud. Configure a provider below with your own key."} />
      </Card>
    )
  }
  const entitlement = status.entitlement
  const plan = entitlement?.plan
  const trial = entitlement?.trial

  return (
    <Card>
      <SectionHeading
        eyebrow="Account"
        title={focused ? "Start with your invited email" : "Carve Cloud"}
        description={focused ? "Already verified your invitation? Continue in that browser to sign in without another email code." : "Questions and tasks run through Carve Cloud. Local history stays on this Mac; relevant task context may be shared with AI."}
        action={!focused ? <Button variant="secondary" size="small" onClick={() => void run('refresh', () => load(true))} disabled={busy !== null}><RefreshCw size={14} /> Refresh</Button> : undefined}
      />
      {unreachable ? <div className="settings-note"><ShieldAlert size={17} /><span>Carve Cloud is unreachable right now. Your saved history is available. Cloud answers, tasks, sign-in, and plan changes need a connection.</span></div> : null}
      {status.lastError ? <div className="ai-warning"><ShieldAlert size={17} /><span>{status.lastError}</span></div> : null}
      <div className="cloud-plan">
        <div className="cloud-plan__head">
          <Cloud size={18} />
          <strong>{plan?.name ?? 'Beta trial'}</strong>
          {plan?.basis === 'grace' ? <Pill tone="warning">Payment needs attention</Pill> : null}
          {entitlement?.account ? <Pill tone="neutral">{entitlement.account.email}</Pill> : <Pill tone="neutral">Not signed in</Pill>}
        </div>
        {entitlement && (!focused || entitlement.account) ? (
          <dl className="cloud-usage">
            <div><dt>Questions</dt><dd>{entitlement.guide.limit === null ? `${entitlement.guide.used} of ${entitlement.guide.fairUse} this period` : `${entitlement.guide.used} of ${entitlement.guide.limit} ${plan?.basis === 'free' ? 'during your trial' : 'this month'}`}</dd></div>
            <div><dt>Tasks</dt><dd>{!entitlement.account ? 'Sign in to start your trial' : entitlement.tasks.included > 0 ? `${entitlement.tasks.used} of ${entitlement.tasks.included} this period` : trial ? (!trial.endsAt ? 'Trial not started' : trial.state === 'expired' ? 'Trial ended' : `${trial.tasksUsed} of ${trial.tasksTotal} trial credits used`) : entitlement.relayInference ? '—' : 'Unlimited on your key'}{entitlement.tasks.credits > 0 ? ` · ${entitlement.tasks.credits} prepaid` : ''}</dd></div>
            <div><dt>Per task</dt><dd>{entitlement.tasks.actionBudget} steps before Carve asks · {entitlement.tasks.assuredAllowed ? 'Independent result checks available' : 'AI-reported results'}</dd></div>
            {entitlement.period.end ? <div><dt>{plan?.basis === 'free' ? 'Trial ends' : 'Allowance resets'}</dt><dd>{new Date(entitlement.period.end).toLocaleDateString()}</dd></div> : null}
          </dl>
        ) : null}
      </div>

      {!entitlement?.account ? <p>Your beta trial includes five short task credits and 50 Guide questions over seven days. No card required. Your trial starts with your first task.</p> : null}
      {trial && entitlement?.account && trial.state !== 'expired' ? <p>{trial.endsAt ? `Trial ends ${new Date(trial.endsAt).toLocaleDateString()}.` : 'Your seven-day trial starts with your first task.'} No card required. Longer tasks may use more of your trial allowance.</p> : null}
      {!entitlement?.account ? (
        <div className="cloud-signin">
          {!browserSignIn && !challengeId ? (
              <Field label="Your invited email" hint="Use the email you verified on the invitation page. No password.">
                <input disabled={browserVerification !== null} value={email} type="email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              </Field>
          ) : null}
          {!legalSaved ? <LegalAcceptance checked={termsAccepted} onChange={value => { setTermsAccepted(value); if (!value) setBrowserVerification(null) }} /> : <p className="cloud-agreement-saved">Your agreement is saved on this Mac. Screen sharing is a separate choice.</p>}
          {browserSignIn ? <div className="cloud-browser-pending" role="status">
            <strong>Finish signing in in your browser</strong>
            <p>Check that it shows <b>{browserSignIn.confirmation}</b>, then approve this Mac. Only approve a request you started.</p>
            <p>This request expires in five minutes. Keep this screen open.</p>
            {!desktop ? <a href={browserSignIn.url} target="_blank" rel="noopener noreferrer">Open sign-in page</a> : null}
            <Button variant="secondary" size="small" onClick={() => { setBrowserSignIn(null); setVerificationError(null) }}>Cancel and use an email code</Button>
          </div> : challengeId ? (
            <>
              <Field label="Enter the 6-digit code we emailed" hint="Check your email. Codes expire after ten minutes.">
                <input autoFocus value={code} inputMode="numeric" autoComplete="one-time-code" onChange={(event) => setCode(event.target.value)} placeholder="123456" />
              </Field>
              <div className="cloud-actions">
                <Button size="small" disabled={!termsAccepted || busy !== null || code.replace(/\D/gu, '').length !== 6} onClick={() => void run('verify', async () => {
                  setStatus(await invoke<CloudStatus>({ kind: 'cloud.signin.verify', challengeId, code, termsVersion: LEGAL_VERSION }))
                  setChallengeId(null)
                  setCode('')
                  notify('Signed in.', 'positive')
                })}>Verify</Button>
                <Button variant="secondary" size="small" disabled={busy !== null} onClick={() => { setChallengeId(null); setCode('') }}>Change email or request a new code</Button>
              </div>
            </>
          ) : (
            <>

              <div className="cloud-actions">
                <Button size="small" disabled={!termsAccepted || busy !== null || browserVerification !== null || !email.includes('@')} onClick={() => void run('browser', async () => {
                  await acceptTerms()
                  setVerificationError(null)
                  const started = await invoke<BrowserSignInStart & { opened?: boolean }>({ kind: 'cloud.browser.start', email: email.trim(), termsVersion: LEGAL_VERSION })
                  if (!mounted.current) { await invoke({ kind: 'cloud.browser.cancel', id: started.id }); return }
                  setBrowserSignIn(started)
                  if (!started.opened && !desktop) window.open(started.url, '_blank', 'noopener')
                })}>{busy === 'browser' ? 'Opening browser…' : 'Continue in browser'}</Button>
                <Button variant="secondary" size="small" disabled={!termsAccepted || busy !== null || browserVerification !== null || !email.includes('@')} onClick={() => void run('start', async () => {
                  await acceptTerms()
                  setVerificationError(null)
                  const started = await invoke<SignInStart & { opened?: boolean }>({ kind: 'cloud.signin.start', email })
                  if (started.verificationUrl) {
                    setBrowserVerification({ url: started.verificationUrl, expiresAt: started.expiresAt, email })
                    if (!started.opened && !desktop) window.open(started.verificationUrl, '_blank', 'noopener')
                    notify('Complete the browser check. Your email code will be sent automatically.', 'accent')
                  } else {
                    setBrowserVerification(null)
                    setChallengeId(started.challengeId ?? null)
                    notify('Check your email for the code.', 'accent')
                  }
                })}>{browserVerification ? 'Waiting for browser check…' : busy === 'start' ? 'Sending…' : 'Use an email code'}</Button>
                {browserVerification && !desktop ? <a href={browserVerification.url} target="_blank" rel="noopener noreferrer">Open browser check</a> : null}
                {browserVerification ? <Button variant="secondary" size="small" onClick={() => setBrowserVerification(null)}>Cancel</Button> : null}
              </div>
              {browserVerification ? <p role="status">Complete the check in your browser. We’ll send your email code automatically.</p> : null}
            </>
          )}
          {verificationError ? <p role="alert">{verificationError}</p> : null}
        </div>
      ) : null}

      {entitlement?.account ? (
        <div className="cloud-billing">
          {!entitlement.billing?.checkoutEnabled ? <p>Paid plans are not open yet. {trial?.state === 'expired' || trial?.state === 'exhausted' ? 'Need more time or credits? ' : 'For beta help or an extension, '}<a href="mailto:support@getcarve.app?subject=Carve%20beta%20extension&body=I%20would%20like%20more%20time%20or%20credits%20to%20try%20Carve.%0AWhat%20I%20want%20to%20try%20next%3A%20">Request more beta time or credits</a>. Your history stays available.</p> : null}
          <div className="cloud-actions">
            {entitlement.billing?.checkoutEnabled && plan?.id !== 'pro' && plan?.id !== 'max' && plan?.id !== 'own_key' ? <Button size="small" disabled={busy !== null} onClick={() => void run('checkout', () => openUrl({ kind: 'cloud.checkout', plan: 'pro', interval: 'month' }))}>Upgrade to Pro</Button> : null}
            {entitlement.billing?.checkoutEnabled && !focused && (plan?.id === 'pro' || plan?.id === 'max') ? <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('pack', () => openUrl({ kind: 'cloud.checkout', pack: 'tasks_20' }))}>Buy 20 tasks · $10</Button> : null}
            {entitlement.billing?.portalEnabled ? <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('portal', () => openUrl({ kind: 'cloud.portal' }))}>Manage billing</Button> : null}
            <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('signout', async () => { setStatus(await invoke<CloudStatus>({ kind: 'cloud.signout' })); notify('Signed out.', 'neutral') })}><LogOut size={14} /> Sign out this Mac</Button>
            <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('signout-all', async () => {
              try {
                setStatus(await invoke<CloudStatus>({ kind: 'cloud.signout_all' }))
                notify('Signed out on all devices, including this Mac.', 'neutral')
              } finally {
                // Reflect local revocation even if Keychain cleanup fails after
                // the gateway has already revoked every session.
                await load(false, false)
              }
            })}>Sign out all devices</Button>
          </div>
          <details className="cloud-danger">
            <summary>Delete account</summary>
            <p>Disables your account immediately, then cancels your subscription and anonymises cloud usage records. We email you when cleanup finishes. Data on this Mac is not affected. Type <code>DELETE</code> and verify a fresh email code to continue.</p>
            <div className="cloud-actions">
              <input aria-label="Confirm account deletion" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="DELETE" />
              <Button size="small" variant="secondary" disabled={busy !== null || deleting || deleteConfirmation !== 'DELETE'} onClick={() => void run('delete-code', async () => {
                const started = await invoke<{ challengeId: string }>({ kind: 'cloud.signin.start', email: entitlement.account!.email })
                setDeleteChallengeId(started.challengeId)
                setDeleteCode('')
                notify('Check your email for a fresh verification code.', 'accent')
              })}>{deleteChallengeId ? 'Send a new code' : 'Email a verification code'}</Button>
            </div>
            {deleteChallengeId ? (
              <div className="cloud-actions">
                <input aria-label="Account deletion verification code" value={deleteCode} inputMode="numeric" autoComplete="one-time-code" onChange={(event) => setDeleteCode(event.target.value)} placeholder="6-digit code" />
                <Button size="small" variant="danger" disabled={busy !== null || deleting || deleteConfirmation !== 'DELETE' || !/^\d{6}$/u.test(deleteCode.trim())} onClick={() => {
                  setDeleting(true)
                  void run('delete', async () => {
                    setStatus(await invoke<CloudStatus>({ kind: 'cloud.signin.verify', challengeId: deleteChallengeId, code: deleteCode }))
                    setDeleteChallengeId(null)
                    setDeleteCode('')
                    setStatus(await invoke<CloudStatus>({ kind: 'cloud.delete_account', confirmation: deleteConfirmation }))
                    setDeleteConfirmation('')
                    notify('Account access is disabled. We will email you when cancellation and cleanup finish.', 'neutral')
                  }).finally(() => setDeleting(false))
                }}>Verify and delete my account</Button>
              </div>
            ) : null}
          </details>
        </div>
      ) : null}
    </Card>
  )
}
