import { useRef, useState } from 'react'
import type { PreparedPractice } from './first-task-state'
import { assistanceCheckpoint } from './approval-state'
import { ArrowUpRight, BookOpen, Clock3, Keyboard } from 'lucide-react'
import { AssistancePanel } from './assistance'
import { shortcutLabel } from './shortcut-label'
import { Button, CarveLogo, CarvePresence } from './components'
import { FirstTaskCard } from './first-task'
import { GuideOnboardingCard } from './onboarding'
import type { ViewProps } from './views'
import contextDrawing from './assets/tutorial/context.png'
import actionDrawing from './assets/tutorial/action.png'

export function CopilotHome({ state, desktop, refresh, notify, navigate, openWork }: ViewProps) {
  const [practice, setPractice] = useState<PreparedPractice | null>(null)
  const [replayTutorial, setReplayTutorial] = useState(false)
  const tutorialAnchor = useRef<HTMLDivElement>(null)
  const [windowPickerRequest, setWindowPickerRequest] = useState<string | null>(null)
  const [practiceSelection, setPracticeSelection] = useState<{ id: string; conversationId: string } | null>(null)
  const assistance = state.liveComputer.assistance
  const inConversation = Boolean(assistance?.question || assistance?.active || assistance?.preparing)
  const latest = [...state.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return <div className="page page--copilot">
    <header className={`copilot-welcome${inConversation ? ' copilot-welcome--compact' : ''}`}>
      {assistance?.active || assistance?.preparing
        ? <CarvePresence className="copilot-welcome__orb" state="working" />
        : <CarveLogo className="copilot-welcome__orb" />}
      <span className="eyebrow">Right where you’re working</span>
      <h1>{inConversation ? 'Right here with you.' : <>A copilot for <span>any window.</span></>}</h1>
      {!inConversation ? <p>Ask about what you see. Get help with what comes next.<br />Bring Carve into the window you’re already using.</p> : null}
    </header>

    <GuideOnboardingCard state={state} desktop={desktop} refresh={refresh} notify={notify} onSettings={() => navigate('settings')} />

    {desktop.desktop && !inConversation ? <CompactViewGuide guideShortcut={desktop.guideShortcut} doItShortcut={desktop.doItShortcut} stopShortcut={desktop.globalStopShortcut} /> : null}
    <div ref={tutorialAnchor}><FirstTaskCard state={state} desktop={desktop} refresh={refresh} onPrepared={setPractice} selection={practiceSelection} replay={replayTutorial} onCloseTutorial={() => setReplayTutorial(false)} onOwnTask={() => { setPractice(null); setWindowPickerRequest(crypto.randomUUID()) }} /></div>

    {desktop.desktop && !inConversation ? <p className="copilot-start-here">Or start from here</p> : null}
    {desktop.desktop ? <AssistancePanel windowPickerRequest={windowPickerRequest} practice={practice} onPracticeSelected={conversationId => setPracticeSelection({ id: crypto.randomUUID(), conversationId })} checkpoint={assistanceCheckpoint(state)} dictationAvailable={state.dictation.configured} state={assistance} refresh={refresh} notify={notify} />
      : <section className="copilot-desktop-note"><strong>Made for your Mac</strong><p>Open the desktop app to choose a window and get help. Your recent tasks and settings are available here.</p></section>}

    {!inConversation ? <div className="copilot-examples" aria-label="Ways Carve can help">
      <div className="copilot-example"><img src={actionDrawing} alt="" /><div><span className="copilot-example__eyebrow">A LITTLE LESS DOING</span><strong>Take the next step.</strong><p>“Turn these notes into a checklist.”</p>{desktop.desktop ? <span className="copilot-example__shortcut">{desktop.doItShortcut ? <><kbd>{shortcutLabel(desktop.doItShortcut)}</kbd> Act in your window</> : 'Choose Take action in Carve'}</span> : null}</div></div>
      <div className="copilot-example"><img src={contextDrawing} alt="" /><div><span className="copilot-example__eyebrow">A LITTLE CLARITY</span><strong>Make sense of it.</strong><p>“Compare the options on this page.”</p>{desktop.desktop ? <span className="copilot-example__shortcut"><kbd>{shortcutLabel(desktop.guideShortcut)}</kbd> Ask in your window</span> : null}</div></div>
    </div> : null}

    {desktop.desktop ? <button type="button" className="copilot-tutorial-reopen" onClick={() => { setReplayTutorial(true); requestAnimationFrame(() => tutorialAnchor.current?.scrollIntoView({ block: 'start' })) }}><BookOpen size={15} />Open the Carve field guide</button> : null}

    {latest && !inConversation ? <section className="copilot-recent">
      <Clock3 size={18} /><div><small>Last task</small><strong>{latest.plan.goal}</strong></div>
      <Button variant="ghost" onClick={() => openWork(latest.plan.goal, 'resume')}>View task <ArrowUpRight size={16} /></Button>
    </section> : null}
    <footer className="copilot-footnote">{desktop.desktop ? <>{desktop.doItShortcut ? <><kbd>{shortcutLabel(desktop.doItShortcut)}</kbd> Take action <span>·</span> </> : null}<kbd>{shortcutLabel(desktop.guideShortcut)}</kbd> Explain <span>·</span> <kbd>{shortcutLabel(desktop.globalStopShortcut)}</kbd> Stop</> : 'A copilot for any window. Available in the Mac app.'}</footer>
  </div>
}

/**
 * The compact view is how most work happens: a small capsule on the window
 * you are already in, summoned by a chord, no trip back to this screen. It
 * also has a first-run field guide; this is the primary Home entry point. Every key
 * shown is the one the desktop actually registered; a chord that could not
 * be registered is simply not promised.
 */
export function CompactViewGuide({ guideShortcut, doItShortcut, stopShortcut }: { guideShortcut: string; doItShortcut: string | null; stopShortcut: string }) {
  return <section className="copilot-guide" aria-label="How to use Carve from any window">
    <header><Keyboard size={18} /><div><strong>Bring Carve into your window</strong><p>Switch to the window you want help with, then press {shortcutLabel(doItShortcut ?? guideShortcut)}{doItShortcut ? '.' : ' and choose Take action.'}</p></div></header>
    <div className="copilot-guide__action">
      <div><strong>Tell Carve what you want done.</strong><p>Try “Turn these notes into a checklist.”</p></div>
      <div className="copilot-guide__keys"><p className="copilot-guide__primary-shortcut">Press <kbd>{shortcutLabel(doItShortcut ?? guideShortcut)}</kbd></p>
        {!doItShortcut ? <p>Then choose Take action.</p> : null}
      </div>
    </div>
    <ul>
      <li>
        <strong>Just have a question?</strong>
        <p className="copilot-guide__shortcut"><kbd>{shortcutLabel(guideShortcut)}</kbd> Explain</p>
        <p>“Summarize this page.”<br />“What does this mean?”</p>
      </li>
      <li>
        <strong>Keep your window in view</strong>
        <p>Carve shrinks to a thin line while it works and opens when you hover. Drag it wherever it suits you.</p>
      </li>
    </ul>
    <p className="copilot-guide__control"><kbd>{shortcutLabel(stopShortcut)}</kbd> stops it instantly, from anywhere. Press the shortcut you used to open Carve again to put it away.</p>
  </section>
}
