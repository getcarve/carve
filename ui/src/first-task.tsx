import { useEffect, useRef, useState } from 'react'
import { Button } from './components'
import { invoke } from './api'
import { practicePrompt, practiceUrl } from '../../src/first-task'
import type { AssistanceState } from '../../src/conversation-interaction'
import type { LiveComputerTarget } from '../../src/types'
import { canReviewPractice, practicePhase, practiceRun, type PracticeAttempt, type PreparedPractice } from './first-task-state'
import type { CarveState, DesktopStatus } from './model'
import { CopilotTutorial } from './copilot-tutorial'

const key = 'carve.first-task'
const attemptKey = 'carve.first-task.attempt'
const tutorialKey = 'carve.copilot-tutorial.seen'
function tutorialSeen(): boolean { try { return localStorage.getItem(tutorialKey) === 'true' } catch { return false } }
function saved(): string { try { return localStorage.getItem(key) ?? '' } catch { return '' } }
function savedAttempt(): PracticeAttempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(attemptKey) ?? 'null') as PracticeAttempt | null
    return value && typeof value.conversationId === 'string' && Array.isArray(value.previousRunIds)
      && (value.runId === null || typeof value.runId === 'string') && [null, 'worked', 'partial', 'stuck'].includes(value.feedback) ? value : null
  } catch { return null }
}

export function FirstTaskCard({ state, desktop, refresh, onPrepared, selection, onOwnTask, replay = false, onCloseTutorial }: {
  state: CarveState; desktop: DesktopStatus; refresh: () => Promise<void>
  onPrepared: (request: PreparedPractice) => void
  selection: { id: string; conversationId: string } | null
  onOwnTask: () => void
  replay?: boolean
  onCloseTutorial?: () => void
}) {
  const [stage, setStage] = useState(saved)
  const [seen, setSeen] = useState(tutorialSeen)
  const [attempt, setAttempt] = useState(savedAttempt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prepared, setPrepared] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const set = (value: string) => { setStage(value); try { localStorage.setItem(key, value) } catch { /* optional preference */ } }
  const saveAttempt = (value: PracticeAttempt | null) => {
    setAttempt(value)
    try { if (value) localStorage.setItem(attemptKey, JSON.stringify(value)); else localStorage.removeItem(attemptKey) } catch { /* optional preference */ }
  }
  useEffect(() => {
    if (selection) { setPrepared(true); setError(null); saveAttempt({ conversationId: selection.conversationId, previousRunIds: state.runs.map(r => r.id), runId: null, feedback: null }) }
  }, [selection?.id])
  const assistance = state.liveComputer.assistance
  const run = practiceRun(attempt, state.runs, assistance)
  useEffect(() => {
    if (attempt && !attempt.runId && run) saveAttempt({ ...attempt, runId: run.id })
  }, [attempt, run?.id])
  const provider = state.providers.find(p => p.active && p.configured && p.capabilities.vision)
  const sharing = provider && (provider.kind !== 'hosted' || state.liveComputer.sharing?.some(s => s.providerId === provider.id && s.windows) || state.liveComputer.visualsConsentProviderId === provider.id)
  const permissions = [desktop.permissions.screenRecording, desktop.permissions.accessibility].every(p => p === 'granted' || p === 'not_applicable')
  if (!desktop.desktop || ((!permissions || !sharing) && !replay) || (seen && !replay && (stage === 'dismissed' || (!stage && state.runs.length > 0)))) return null
  const working = Boolean(assistance?.active || assistance?.preparing)
  const prepare = async () => {
    if (busy || working) return
    setBusy(true); setPrepared(false); setError(null)
    try {
      const { target } = await invoke<{ target: LiveComputerTarget | null }>({ kind: 'desktop.practice.prepare' })
      if (!mounted.current) return
      if (!target) {
        saveAttempt(null)
        setError('Practice is open, but Carve could not identify its window. Choose the browser window showing “Carve practice notes” below. Your request is ready to review.')
        set('started')
        // Do not prefill against a previously selected personal window.
        // The composer explicitly opens its picker before accepting this draft.
        onPrepared({ id: crypto.randomUUID(), conversationId: null, question: practicePrompt })
        return
      }
      const opened = await invoke<AssistanceState>({ kind: 'computer.assistance.open', target, mode: 'do' })
      if (!mounted.current) return
      saveAttempt({ conversationId: opened.conversationId, previousRunIds: state.runs.map(r => r.id), runId: null, feedback: null })
      set('started')
      setPrepared(true)
      onPrepared({ id: crypto.randomUUID(), conversationId: opened.conversationId, question: practicePrompt })
      await refresh()
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not open practice. Try again.') }
    finally { if (mounted.current) setBusy(false) }
  }
  const review = canReviewPractice(run)
  const phase = practicePhase({ busy, prepared, worked: stage === 'worked', run, assistance, conversationId: attempt?.conversationId })
  const finishTutorial = () => { setSeen(true); try { localStorage.setItem(tutorialKey, 'true') } catch { /* optional preference */ } onCloseTutorial?.() }
  const ownTask = () => { finishTutorial(); set('dismissed'); onOwnTask() }
  const feedback = (value: PracticeAttempt['feedback']) => { if (attempt && review) { saveAttempt({ ...attempt, feedback: value }); if (value === 'worked') set('worked') } }
  if (replay || phase === 'intro' || phase === 'opening' || stage === 'dismissed' || (!seen && stage === 'worked')) return <>
    <CopilotTutorial desktop={desktop} busy={busy} working={working} setupReady={Boolean(permissions && sharing)}
      onPractice={() => { set('started'); finishTutorial(); void prepare() }}
      onOwnWindow={ownTask} onDismiss={() => { finishTutorial(); set('dismissed') }} />
    {error ? <p className="first-task__error" role="alert">{error} <a href={practiceUrl} target="_blank" rel="noopener noreferrer">Open practice notes</a></p> : null}
  </>
  return <section className="first-task" aria-label="Your first task">
    <span className="eyebrow">{phase === 'own' ? 'Make it yours' : 'Your first task'}</span>
    <h2>{{ intro: 'Watch Carve edit a page.', opening: 'Opening your practice page…', ready: 'Review your request, then send.', watch: 'Watch the notes change.', check: 'Check what changed.', retry: 'Let’s try that again.', own: 'Now try a window you actually need help with.' }[phase]}</h2>
    {phase === 'own' ? <>
      <p>Choose a window and ask for one small change you can check. For example: “Shorten this paragraph and keep the main points.”</p>
      <Button disabled={working} onClick={ownTask}>Choose my own window</Button>
      <p className="first-task__allowance">Next time, bring your app forward and press <kbd>{desktop.doItShortcut ?? desktop.guideShortcut}</kbd>{desktop.doItShortcut ? '.' : ', then choose Take action.'}</p>
    </> : <>
      {phase === 'ready' ? <p role="status">Check that the selected window is “Carve practice notes,” then press Send below. Keep the practice page visible while Carve works.</p> : null}
      {phase === 'watch' ? <p role="status">Keep the practice page visible. Review any plan or approval request below. You can use Stop at any time.</p> : null}
      {phase === 'retry' ? <p role="status">Practice ended before an edit was recorded. Check the message below to retry, or open a fresh practice page.</p> : null}
      {['intro', 'opening', 'ready'].includes(phase) ? <p className="first-task__allowance">Opening practice uses no credits. Sending uses your normal trial allowance and shares the selected window with your AI service.</p> : null}
      {error ? <p role="alert">{error} <a href={practiceUrl} target="_blank" rel="noopener noreferrer">Open practice notes</a></p> : null}
      {phase === 'check' ? <div className="first-task__result"><p>Look at the notes: are there three checklist items, with Maya due Tuesday, Leo Wednesday, and Nina Friday?</p>
        <Button size="small" onClick={() => feedback('worked')}>Worked</Button>{' '}
        <Button size="small" variant="secondary" onClick={() => feedback('partial')}>Partly worked</Button>{' '}
        <Button size="small" variant="secondary" onClick={() => feedback('stuck')}>Got stuck</Button>
        {attempt?.feedback === 'partial' || attempt?.feedback === 'stuck' ? <p>Tell Carve what to fix in the request box, or prepare a fresh practice attempt. <a href="mailto:support@getcarve.app?subject=Carve%20first%20task%20help">Contact beta support</a>.</p> : null}
      </div> : null}
      {['ready', 'retry', 'check'].includes(phase) ? <Button variant="ghost" size="small" disabled={busy || working} onClick={() => void prepare()}>Start practice over</Button> : null}
      <button type="button" className="home-setup__dismiss" disabled={busy || working} onClick={ownTask}>I’ll use my own window</button>
    </>}
  </section>
}
