import { handoffBudgetCopy } from '../../src/application-handoff-budget'
import { handoffIsSource } from '../../src/application-handoff-semantics'
import { handoffWorkflowScope, handoffConversationCopy } from '../../src/application-handoff-scope'
import { useEffect, useState } from 'react'
import type { ApplicationHandoffTask } from '../../src/application-handoff'
const handoffDestination = (stage: ApplicationHandoffTask['stages'][number]) => stage.route.source === 'fresh' ? stage.route.application : stage.route.target.application
import type { LiveComputerTarget } from '../../src/types'
import { invoke } from './api'

// The revision is computed by the controller and sent in state; the renderer never authors authority.
export function ApplicationHandoffReview({ task, revision, refresh, notify }: {
  task: ApplicationHandoffTask; revision: string; refresh: () => Promise<unknown>; notify: (message: string, tone: 'danger') => void
}) {
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [targets, setTargets] = useState<LiveComputerTarget[]>([])
  const [apps, setApps] = useState<Array<{application: string; bundleIdentifier: string}>>([])
  const copy = handoffConversationCopy(task)
  const budget = task.budgetRequest ? handoffBudgetCopy(task.budgetRequest, task.providerId === 'carve-cloud') : null
  const stage = task.stages[task.stageIndex]!
  const sourceFailed = task.status === 'failed' && handoffIsSource(stage.route)
  const recovering = task.status === 'failed' && stage.route.role === 'destination'
  const pending = ['awaiting_consent', 'awaiting_budget', 'paused', 'failed'].includes(task.status)
  const act = async (action: 'approve' | 'decline' | 'cancel') => {
    if (action === 'cancel') setStopping(true); else setBusy(true)
    try { await invoke({ kind: 'computer.handoff.decide', taskId: task.id, revision, action }); await refresh() }
    catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
    finally { if (action === 'cancel') setStopping(false); else setBusy(false) }
  }
  const choose = async () => {
    setBusy(true)
    try {
      const data = await invoke<{ applications: typeof apps; targets: LiveComputerTarget[] }>({ kind: 'computer.handoff.destinations' })
      setApps(data.applications); setTargets(data.targets); setChoosing(true)
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }
  const select = async (bundleIdentifier: string, target?: LiveComputerTarget) => {
    setBusy(true)
    try { await invoke({ kind: 'computer.handoff.destination', taskId: task.id, revision, bundleIdentifier, ...(target ? { windowId: target.windowId, target } : {}) }); setChoosing(false); await refresh() }
    catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') } finally { setBusy(false) }
  }
  const approveDisabled = busy || stopping || choosing || !pending || Boolean(task.budgetRequest && (!task.budgetRequest.canGrant || task.budgetRequest.fundingStatus === 'pending')) || (recovering && !stage.target)
  // Enter answers the waiting hand-off consent wherever focus is, except inside a
  // text field or on another control. A held or repeated Enter, or one within the
  // first moments after the card appears, never counts as consent.
  useEffect(() => {
    if (approveDisabled) return
    const shownAt = Date.now()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.isComposing || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || Date.now() - shownAt < 400) return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return
      event.preventDefault(); void act('approve')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  return <section className="application-handoff" aria-label="Continue in another app">
    <header><h2>{budget ? budget.title : task.status === 'opening' ? `Opening ${handoffDestination(stage)}…` : sourceFailed ? 'Source work did not finish' : recovering ? 'Choose the document to continue' : copy.question}</h2><p>{budget?.detail ?? copy.summary}</p></header>
    {task.budgetRequest?.fundingError ? <p role="alert">{task.budgetRequest.fundingError}</p> : null}
    {task.reason ? <p role="status" className="application-handoff__notice">{task.reason}</p> : null}
    <details className="application-handoff__details"><summary>Task details</summary>
      <h3>Your request</h3><p>{task.goal}</p>
      <h3>What you’re allowing</h3><p>{handoffWorkflowScope(task)}</p>
      <p>This approval covers these steps. I’ll ask again if the work changes. Content may be sent to {task.providerId}.</p>
      {task.evidence.length ? task.evidence.map(e => <details key={e.id}><summary>{e.source.application} · {e.source.title}</summary><pre>{e.text}</pre><p>{e.coverage} coverage, reported by the model · {e.provenance.join(' · ')}</p></details>) : null}
      {task.prior?.result ? <details><summary>Earlier conversation</summary><pre>{task.prior.result}</pre></details> : null}
      {task.annotations ? <p>Your annotations stay with the original source.</p> : null}
    </details>
    {choosing ? <div className="application-handoff__picker"><h3>{recovering ? 'Review the document already opened, then select it here' : 'Choose a new document or an existing window'}</h3>{recovering ? <p>If the app shows a template chooser, choose a template first. Check any changes already made. Continuing uses the selected document.</p> : null}{!recovering && apps.map(app => <button key={app.bundleIdentifier} disabled={busy} onClick={() => void select(app.bundleIdentifier)}>New {app.application} document</button>)}{targets.map(target => <button key={`${target.bundleIdentifier}:${target.windowId}`} disabled={busy} onClick={() => void select(target.bundleIdentifier, target)}>{target.application} · {target.title}</button>)}</div> : null}
    <footer><button className="application-handoff__secondary" disabled={stopping} onClick={() => void act('cancel')}>Stop task</button>{pending ? <><button disabled={busy} onClick={() => void act('decline')}>{copy.declineLabel}</button>{stage.route.role === 'destination' && !recovering && !stage.target && !stage.sessionId ? <button className="application-handoff__secondary" disabled={busy} onClick={() => void choose()}>{recovering ? 'Select the opened document' : 'Choose destination'}</button> : null}<button className="application-handoff__primary" disabled={busy || Boolean(task.budgetRequest && (!task.budgetRequest.canGrant || task.budgetRequest.fundingStatus === 'pending')) || !recovering && Boolean(stage.sessionId && stage.status === 'failed')} onClick={() => void (recovering ? choose() : act('approve'))}>{budget ? budget.approveLabel : recovering ? 'Select the opened document' : sourceFailed ? 'Retry source' : copy.approveLabel}</button></> : null}</footer>
  </section>
}
