import type { PreparedPractice } from './first-task-state'
import { practicePrompt } from '../../src/first-task'
import { ApprovalCheckpoint } from './approval-checkpoint'
import type { CheckpointDecision } from '../../src/types'
import { ApprovalControl } from './approval-control'
import { approvalOptions, approvalPreference } from '../../src/approval-preference'
import { assistanceRequestMaxLength } from '../../src/assistance-request.js'
import { ResultText } from './result-text'
import { Button, type Tone } from './components'
import { DictationButton, type DictationControl } from './views'
import { dictatedSubmissionValue } from './dictation-field'
import { AssistanceWindowPicker } from './assistance-window-picker'
import { PublicLookupAnswer } from './public-lookup-answer'
import { DrawingControls } from './drawing-controls'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, CornerUpRight, Eye, MousePointer2, RefreshCw, Sparkles } from 'lucide-react'
import type { AssistanceMode, AssistanceState } from '../../src/conversation-interaction'
import type { CarveCommand } from '../../src/desktop-contract'
import type { LiveComputerTarget } from '../../src/types'
import { invoke } from './api'

/** Both surfaces render the same controller state. A switch is a request;
 * the selected treatment changes only after the controller acknowledges it. */
export function AssistancePanel({ state, refresh, notify, dictationAvailable = false, checkpoint, practice = null, onPracticeSelected, windowPickerRequest = null }: {
  windowPickerRequest?: string | null
  practice?: PreparedPractice | null
  onPracticeSelected?: (conversationId: string) => void
  checkpoint?: CheckpointDecision | undefined
  dictationAvailable?: boolean
  state: AssistanceState | undefined
  refresh: () => Promise<void>
  notify: (message: string, tone?: Tone) => void
}) {
  const [draft, setDraft] = useState('')
  const [practiceToSelect, setPracticeToSelect] = useState<PreparedPractice | null>(null)
  const [ownWindowSelection, setOwnWindowSelection] = useState(false)
  const handledWindowPicker = useRef<string | null>(null)
  const preparedPracticeId = useRef<string | null>(null)
  const [planFeedback, setPlanFeedback] = useState('')
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [rememberSharing, setRememberSharing] = useState(false)
  const [sharingError, setSharingError] = useState<string | null>(null)
  const latestState = useRef(state)
  latestState.current = state
  useEffect(() => { setRememberSharing(false); setSharingError(null) }, [state?.conversationId, state?.sharingRequest?.category, state?.sharingRequest?.providerId])
  const submitted = useRef<string | null>(null)
  const dictationControl = useRef<DictationControl | null>(null)
  const [listening, setListening] = useState(false)
  const sending = useRef(false)
  const [targets, setTargets] = useState<LiveComputerTarget[]>([])
  const [choosing, setChoosing] = useState(false)
  const [loadingTargets, setLoadingTargets] = useState(false)
  const pickerTrigger = useRef<HTMLButtonElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const closePicker = () => { setChoosing(false); setOwnWindowSelection(false); pickerTrigger.current?.focus() }
  useEffect(() => { setDraft(current => submitted.current && current.trim() === submitted.current ? '' : current); setRequestError(null); submitted.current = null; setChoosing(false); setOwnWindowSelection(false) }, [state?.conversationId])
  useEffect(() => {
    if (!state?.windowRequest || state.target) return
    let cancelled = false
    setChoosing(true)
    setRequestError(null)
    setLoadingTargets(true)
    setDraft(current => current || state.windowRequest || '')
    void invoke<{ targets: LiveComputerTarget[] }>({ kind: 'computer.targets.list', quiet: true })
      .then(response => { if (!cancelled) setTargets(response.targets.filter(target => target.bundleIdentifier !== 'app.carve.desktop')) })
      .catch(error => { if (!cancelled) notify(error instanceof Error ? error.message : String(error), 'danger') })
      .finally(() => { if (!cancelled) setLoadingTargets(false) })
    return () => { cancelled = true }
  }, [state?.windowRequest, state?.windowRequestSequence, state?.target, notify])
  useEffect(() => {
    if (state?.guide.state === 'failed') {
      setDraft(current => current || submitted.current || state.question || '')
    } else if (state?.guide.state === 'answered' || state?.active) {
      const sent = submitted.current
      if (sent) setDraft(current => current.trim() === sent ? '' : current)
      submitted.current = null
    }
  }, [state?.guide.state, state?.active, state?.question])
  useEffect(() => {
    if (!practice || preparedPracticeId.current === practice.id || !state) return
    if (practice.conversationId && practice.conversationId !== state.conversationId) return
    preparedPracticeId.current = practice.id
    if (practice.conversationId) {
      setPracticeToSelect(null)
      setDraft(practice.question)
      composer.current?.focus()
      composer.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } else {
      setPracticeToSelect(practice)
      setChoosing(true)
      setLoadingTargets(true)
      void invoke<{ targets: LiveComputerTarget[] }>({ kind: 'computer.targets.list', quiet: true })
        .then(response => setTargets(response.targets.filter(target => target.bundleIdentifier !== 'app.carve.desktop')))
        .catch(error => setRequestError(error instanceof Error ? error.message : String(error)))
        .finally(() => setLoadingTargets(false))
    }
  }, [practice, state?.conversationId])
  useEffect(() => {
    if (!windowPickerRequest || handledWindowPicker.current === windowPickerRequest || !state || state.active || state.preparing) return
    handledWindowPicker.current = windowPickerRequest
    setPracticeToSelect(null)
    setOwnWindowSelection(true)
    setDraft(current => current === practicePrompt ? '' : current)
    setRequestError(null)
    setChoosing(true)
    setLoadingTargets(true)
    void invoke<{ targets: LiveComputerTarget[] }>({ kind: 'computer.targets.list', quiet: true })
      .then(response => setTargets(response.targets.filter(target => target.bundleIdentifier !== 'app.carve.desktop')))
      .catch(error => setRequestError(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoadingTargets(false))
  }, [windowPickerRequest, state?.active, state?.preparing, state?.conversationId])
  if (!state || !window.stewardDesktop) return null
  const busy = state.preparing || state.guide.state === 'reading' || state.guide.state === 'thinking'
  const working = state.active && !state.showGuide
  const hasAnswer = Boolean(state.showGuide && state.guide.state === 'answered' && state.guide.answer)
  const drawingSetup = hasAnswer && state.guide.answer?.providerId === 'local-drawing'
  const hasMarks = Boolean(state.guide.answer?.scene?.objects.length)
  const publicAnswer = Boolean(hasAnswer && state.guide.answer?.publicLookup)
  const act = async (command: CarveCommand) => {
    setPending(true)
    setRequestError(null)
    try { await invoke(command); return true }
    catch (error) { const message = error instanceof Error ? error.message : String(error); setRequestError(message); return false }
    finally { setPending(false); await refresh() }
  }
  const submit = async () => {
    if (pending || busy || sending.current || practiceToSelect || ownWindowSelection) return
    sending.current = true
    try {
      let question = draft.trim()
      if (dictationControl.current?.active) {
        question = dictatedSubmissionValue(question, await dictationControl.current.finish())
        setDraft(question)
      }
      if (!question) return
      submitted.current = question
      await act({ kind: 'computer.assistance.ask', question })
    } catch (error) { setRequestError(error instanceof Error ? error.message : String(error)) } finally { sending.current = false }
  }
  const select = (mode: AssistanceMode) => void act({ kind: 'computer.assistance.mode', mode,
    conversationId: state.conversationId, revision: state.revision, commandId: crypto.randomUUID() })
  const choose = async () => {
    setChoosing(true)
    setLoadingTargets(true)
    try {
      const response = await invoke<{ targets: LiveComputerTarget[] }>({ kind: 'computer.targets.list', quiet: true })
      setTargets(response.targets.filter(target => target.bundleIdentifier !== 'app.carve.desktop'))
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'danger') }
    finally { setLoadingTargets(false) }
  }
  const switchAction = state.followUps.find(action => action.kind === 'switch_mode')
  const retryAction = state.followUps.find(action => action.kind === 'retry_start')
  const sharingRequest = retryAction && state.guide.state === 'failed' ? state.sharingRequest : null
  const allowAndContinue = async () => {
    if (!sharingRequest || !retryAction || pending || busy || sending.current) return
    sending.current = true
    setPending(true)
    setSharingError(null)
    setRequestError(null)
    try {
      await invoke({ kind: sharingRequest.category === 'catalog' ? 'computer.catalog_consent' : 'computer.visuals_consent', providerId: sharingRequest.providerId, remember: rememberSharing })
      // Stop, a new message or a different window invalidates this retry.
      const latest = latestState.current
      if (latest?.conversationId !== state.conversationId || !latest.followUps.some(action => action.id === retryAction.id)) return
      await invoke({ kind: 'computer.assistance.accept', conversationId: state.conversationId, turnId: retryAction.turnId, candidateId: retryAction.id, commandId: crypto.randomUUID() })
    } catch (error) { setSharingError(error instanceof Error ? error.message : String(error)) }
    finally { sending.current = false; setPending(false); await refresh() }
  }
  return <section className={`assistance-panel${working ? ' assistance-panel--working' : ''}${hasAnswer ? ' assistance-panel--answered' : ''}`} aria-label={hasAnswer ? 'Carve answer' : 'Window assistance'}>
    <div className="assistance-panel__header">
      <span className="assistance-panel__symbol" aria-hidden="true">{hasAnswer ? <Sparkles size={20} /> : state.mode === 'guide' ? <Eye size={20} /> : <MousePointer2 size={20} />}</span>
      <div className="assistance-panel__identity"><strong>{'Carve'}</strong><span role="status" aria-live="polite">{hasAnswer ? publicAnswer ? 'From the public web' : 'Ask about anything on your screen.' : state.status === 'You’re in control' && !state.target ? 'Ask a public question, or choose a window for help.' : state.status}</span></div>
      {!publicAnswer ? <div className="assistance-segments" role="group" aria-label="Assistance mode">
        <button aria-pressed={state.mode === 'guide'} onClick={() => select('guide')}>Explain</button>
        <button aria-pressed={state.mode === 'do'} disabled={pending || state.preparing || Boolean(state.requestedMode)} onClick={() => select('do')}>Take action</button>
      </div> : null}
      {publicAnswer ? <button className="assistance-panel__link" onClick={() => void choose()}><MousePointer2 size={14} /> Window help</button> : null}
      {state.target && window.stewardDesktop.showCapsule ? <button className="assistance-panel__link" onClick={() => window.stewardDesktop?.showCapsule?.()}><CornerUpRight size={15} /> Compact view</button> : null}
    </div>
    {(!publicAnswer || choosing) && (!state.windowRequest || !choosing) && !state.active && !state.preparing ? <div className="assistance-panel__window"><span className="assistance-window__context">{state.target ? `Viewing: ${state.target.title || state.target.application}` : 'Choose a window to ask about your screen'}</span><button ref={pickerTrigger} aria-expanded={choosing} onClick={() => choosing ? closePicker() : void choose()}>{state.target ? 'Change window' : 'Choose window'}</button></div> : null}
    {practiceToSelect ? <p role="status">Choose the browser window showing “Carve practice notes” to prepare your request. <button type="button" onClick={() => { setPracticeToSelect(null); setChoosing(false) }}>Cancel practice setup</button></p> : null}
    {ownWindowSelection ? <p role="status">Choose a window you need help with, then ask for one small change you can check.</p> : null}
    {choosing ? <AssistanceWindowPicker requested={Boolean(state.windowRequest)} targets={targets} current={state.target} loading={loadingTargets} disabled={pending || busy} close={closePicker} reload={() => void choose()} choose={target => {
      if (state.windowRequest) submitted.current = null
      if (practiceToSelect) {
        const request = practiceToSelect
        setPending(true)
        void invoke<AssistanceState>({ kind: 'computer.assistance.open', target, mode: 'do' }).then(opened => {
          setDraft(request.question)
          onPracticeSelected?.(opened.conversationId)
          setPracticeToSelect(null)
          setChoosing(false)
          composer.current?.focus()
        }).catch(error => setRequestError(error instanceof Error ? error.message : String(error)))
          .finally(() => { setPending(false); void refresh() })
      } else void act({ kind: 'computer.assistance.open', target, mode: ownWindowSelection ? 'do' : state.mode }).then(success => {
        if (success) { setChoosing(false); setOwnWindowSelection(false); composer.current?.focus() }
      })
    }} /> : null}
    {state.planReview ? <section className="assistance-plan" aria-label="Review plan"><span className="assistance-plan__eyebrow">Plan ready · Waiting for you</span><h3>Review the approach</h3><ol className="approval-plan-steps">{state.planReview.steps.map((step, index) => <li key={index}>{step}</li>)}</ol><p className="approval-plan-scope">{state.planReview.application} · {state.planReview.title}</p><details className="approval-plan-editor"><summary>Edit plan</summary><form onSubmit={event => { event.preventDefault(); void act({ kind: 'computer.session.plan.revise', feedback: planFeedback }).then(ok => { if (ok) setPlanFeedback('') }) }}><textarea className="approval-plan-feedback" aria-label="Edit plan" placeholder="What should change?" maxLength={1000} value={planFeedback} onChange={event => setPlanFeedback(event.target.value)} disabled={pending} /><Button variant="secondary" type="submit" disabled={pending || !planFeedback.trim()}>Update plan</Button></form></details><div className="assistance-plan__actions"><Button variant="secondary" disabled={pending} onClick={() => void act({ kind: 'computer.session.action', action: 'stop' })}>Cancel task</Button><Button disabled={pending} onClick={() => void act({ kind: 'computer.session.plan.approve', planHash: state.planReview!.hash })}>Approve &amp; start</Button></div></section> : null}
    {checkpoint && !state.planReview ? <ApprovalCheckpoint checkpoint={checkpoint} busy={pending} decide={action => void act({ kind: 'checkpoint.action', checkpointId: checkpoint.id, action })} /> : null}
    {hasAnswer && state.guide.answer ? <article className="assistance-panel__answer" aria-label={drawingSetup ? "Drawing workspace" : "Conversation"}>
      {state.question && !drawingSetup ? <p className="assistance-answer__question"><span>You</span>{state.question}</p> : null}
      <h2 className="assistance-answer__label">{switchAction ? 'Let Carve take action?' : drawingSetup ? 'Mark an area' : 'Carve'}</h2>
      {switchAction ? <p>Explain is on. This request needs Carve to use your selected window.</p> : null}
      <div className={`assistance-answer__body${drawingSetup ? ' assistance-answer__body--drawing' : ''}`}>{switchAction ? <ResultText text={switchAction.request} /> : state.guide.answer.publicLookup ? <PublicLookupAnswer runId={state.runId ?? undefined} evidence={state.guide.answer.publicLookup} showSources /> : <ResultText text={state.guide.answer.answer} />}</div>
      {!publicAnswer && state.guide.answer.resultEvidence ? <small>{state.guide.answer.resultEvidence === 'verified' ? 'Verified result' : 'Reported result'}</small> : null}
      {state.followUps?.length ? <div className="assistance-panel__answer-actions" aria-label="Suggested follow-ups">
        {state.followUps.map(action => <button key={action.id} disabled={pending || busy || state.owner !== 'user'}
          title={action.target ? 'Open ' + action.target.name : action.label}
          onClick={() => void act({ kind: 'computer.assistance.accept', conversationId: state.conversationId,
            turnId: action.turnId, candidateId: action.id, commandId: crypto.randomUUID() })}>{action.label}</button>)}
      </div> : null}
      {state.guide.answer.scene && (drawingSetup || hasMarks) ? <DrawingControls frameSize={state.guide.answer.frameSize} scene={state.guide.answer.scene} visible={Boolean(state.guide.answer.pointer)} disabled={pending || busy || state.owner !== 'user'} edit={edit => void act({ kind: 'computer.assistance.drawing', edit })} /> : null}
      {state.guide.answer.frameSha256 && hasMarks ? <div className="assistance-panel__annotation-options" role="group" aria-label="Annotations">
        {state.guide.answer.pointer ? <button disabled={pending || busy} onClick={() => void act({ kind: 'computer.assistance.clear' })}>Hide marks</button> : null}
        <button disabled={pending || busy} onClick={() => void act({ kind: 'computer.assistance.refresh' })}><RefreshCw size={13} /> {state.guide.answer.pointer ? 'Show again' : 'Update marks'}</button>
      </div> : null}
    </article> : null}
    {sharingRequest ? <div className="assistance-recovery assistance-sharing" role="region" aria-label="Sharing permission">
      <strong>{sharingRequest.category === 'catalog' ? 'Allow Carve to choose the right app?' : 'Allow Carve to read this window?'}</strong>
      <p>{sharingRequest.category === 'catalog'
        ? `To choose where to work, Carve sends your request and installed app names to ${sharingRequest.recipient}, including apps that are closed. This step does not share window titles or screen contents.`
        : `Carve sends images, visible text and controls from your selected windows, their names, and relevant conversation context to ${sharingRequest.recipient}. Preparing the plan already shares window content.`}</p>
      <p>Allow until Carve quits. Your request is saved and will continue when you allow sharing.</p>
      <label className="sharing-choice"><input type="checkbox" checked={rememberSharing} disabled={pending} onChange={event => setRememberSharing(event.target.checked)} />Remember this choice on this Mac</label>
      {sharingError ? <p role="alert">{sharingError}</p> : null}
      <Button disabled={pending || busy} onClick={() => void allowAndContinue()}>{pending ? 'Continuing…' : 'Allow & continue'}</Button>
      <small>You can edit your request below or change sharing permissions in Settings.</small>
    </div> : !state.windowRequest && (requestError || (state.guide.state === 'failed' && state.showGuide)) ? <div className="assistance-recovery" role="alert"><strong>{state.guide.failureKind === 'search_uncited' ? 'Nothing to cite online' : retryAction ? 'Couldn’t start the task' : 'Let’s pick up from here'}</strong><p>{state.guide.failureKind === 'search_uncited' ? 'That question depends on what’s on this page. Carve can check it there.' : requestError || sharingError || state.guide.failure}</p><Button variant="secondary" size="small" disabled={pending || busy || (!retryAction && !draft.trim())} onClick={() => retryAction ? void act({ kind: 'computer.assistance.accept', conversationId: state.conversationId, turnId: retryAction.turnId, candidateId: retryAction.id, commandId: crypto.randomUUID() }) : submit()}>{pending || busy ? 'Trying again…' : retryAction && state.guide.failureKind === 'search_uncited' ? 'Check this page' : 'Try again'}</Button><small>{state.guide.failureKind === 'search_uncited' ? 'Or add the event, site or date and search again.' : retryAction ? 'Try again uses the same request. You can also type a new request below.' : 'Your request is kept below. Edit it before trying again if you like.'}</small></div> : null}
    {!publicAnswer ? <ApprovalControl state={state} disabled={pending || busy} refresh={refresh} onError={setRequestError} /> : null}
    {!state.preparing ? <form className="assistance-composer" onSubmit={event => {
      event.preventDefault()
      submit()
    }}><textarea ref={composer} aria-label="Ask Carve" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
      event.preventDefault()
      // An empty Enter starts the plan that is waiting for review, matching the
      // overlay capsule's Enter default on its Start button. A protected change
      // (a checkpoint) keeps requiring its focused Approve button; a held or
      // repeated Enter never counts.
      if (!draft.trim() && !pending && !busy && !event.repeat && state.planReview) { void act({ kind: 'computer.session.plan.approve', planHash: state.planReview.hash }); return }
      submit()
    }} maxLength={assistanceRequestMaxLength} rows={1} placeholder={working ? 'Ask Carve — the task will pause' : drawingSetup ? 'Ask about the area you marked…' : state.mode === 'do' ? 'What would you like done in this window?' : 'What would you like to understand?'} /><DictationButton enabled={dictationAvailable} disabled={pending || busy} notify={notify} controlRef={dictationControl} onLive={live => setListening(Boolean(live))} field={{ value: draft, onChange: setDraft }} /><button type="submit" disabled={(!draft.trim() && !listening) || busy || pending || Boolean(practiceToSelect) || ownWindowSelection} aria-label={busy ? 'Working on your request' : 'Send request'}>{busy || pending ? <span className="assistance-composer__busy" /> : <ArrowUp size={18} />}</button></form> : null}
    {!state.question && !state.active ? <p className="assistance-composer-note">{state.mode === 'guide' ? 'Explain answers your question. Choose Take action when you want Carve to click or type.' : approvalOptions.find(option => option.value === approvalPreference(state.approvalPreset))!.description}</p> : null}
  </section>
}
