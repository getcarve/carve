import { useId, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, CornerDownLeft, X } from 'lucide-react'
import { Button, CarveLogo } from './components'
import { shortcutLabel } from './shortcut-label'
import type { DesktopStatus } from './model'
// Keyboard illustration used in the Carve announcement video.
import keyboardDrawing from './assets/tutorial/keyboard.png'
import contextDrawing from './assets/tutorial/context.png'
import reviewDrawing from './assets/tutorial/review.png'
import './copilot-tutorial.css'

const chapters = ['Summon', 'Ask or act', 'Stay in control']

/** Display the registered chord, including custom shortcuts and fallbacks. */
export function TutorialShortcut({ chord }: { chord: string }) {
  const label = shortcutLabel(chord)
  return <kbd className="tutorial-shortcut" aria-label={label} title={label}>{label}</kbd>
}

export function CopilotTutorial({ desktop, busy, working, setupReady, onPractice, onOwnWindow, onDismiss }: {
  desktop: DesktopStatus; busy: boolean; working: boolean; setupReady: boolean
  onPractice: () => void; onOwnWindow: () => void; onDismiss: () => void
}) {
  const [chapter, setChapter] = useState(0)
  const [mode, setMode] = useState<'guide' | 'work'>('work')
  const [summoned, setSummoned] = useState(false)
  const titleId = useId()
  const changeChapter = (next: number) => { setChapter(next); setSummoned(false) }
  const shown = chapter > 0 || summoned
  return <section className="copilot-tutorial" aria-labelledby={titleId}>
    <header className="tutorial-topline"><span>THE CARVE FIELD GUIDE <span className="tutorial-duration">/ ABOUT A MINUTE</span></span><button type="button" className="tutorial-dismiss" disabled={busy || working} onClick={onDismiss} aria-label="Close tutorial"><X size={16} /></button></header>
    <nav className="tutorial-chapters" aria-label="Tutorial chapters">
      {chapters.map((label, index) => <button type="button" key={label} aria-current={chapter === index ? 'step' : undefined} onClick={() => changeChapter(index)}><span>0{index + 1}</span>{label}</button>)}
    </nav>
    <div className="tutorial-scene" data-chapter={chapter}>
      <div className="tutorial-copy" aria-live="polite">
        <span className="tutorial-kicker">{['ONE SHORTCUT. RIGHT HERE.', 'A QUESTION. OR A HELPING HAND.', 'YOU’RE STILL AT THE WHEEL.'][chapter]}</span>
        <h2 id={titleId}>{chapter === 0 ? <>Your window.<br /><em>Now with a copilot.</em></> : chapter === 1 ? <>A little clarity.<br /><em>A little less doing.</em></> : <>Let Carve help.<br /><em>Keep the final say.</em></>}</h2>
        {chapter === 0 ? <>
          <p>Bring the window you want help with to the front. Press the shortcut below, and Carve appears right there.</p>
          <div className="tutorial-shortcut-callout"><TutorialShortcut chord={desktop.doItShortcut ?? desktop.guideShortcut} /><span>{desktop.doItShortcut ? 'Bring Carve in to take action' : 'Then choose Take action'}</span></div>
          <p className="tutorial-aside">No copying context. No switching windows.</p>
        </> : chapter === 1 ? <>
          <p>Ask about what’s in front of you, or tell Carve what you’d like changed. Type or dictate into the small copilot.</p>
          <div className="tutorial-modes" aria-label="Preview a way to use Carve">
            <button type="button" aria-pressed={mode === 'work'} onClick={() => setMode('work')}><span><strong>Get it done</strong>{desktop.doItShortcut ? <TutorialShortcut chord={desktop.doItShortcut} /> : <small>Choose Take action</small>}</span><small>“Turn these notes into a checklist.”</small></button>
            <button type="button" aria-pressed={mode === 'guide'} onClick={() => setMode('guide')}><span><strong>Understand it</strong><TutorialShortcut chord={desktop.guideShortcut} /></span><small>“What needs to happen this week?”</small></button>
          </div>
        </> : <>
          <p>Review any plan or approval request. Keep the selected window visible while Carve works, then check the result.</p>
          <ul className="tutorial-control-list"><li><Check size={16} />Hover the small line to see progress.</li><li><Check size={16} />Ask for a correction when you need one.</li></ul>
          <div className="tutorial-stop"><TutorialShortcut chord={desktop.globalStopShortcut} /><span>Stop at any time, from anywhere.</span></div>
        </>}
      </div>
      <div className="tutorial-art" aria-label="Illustration of Carve appearing over the same notes window">
        <div className="tutorial-window">
          <div className="tutorial-window-bar"><span aria-hidden="true">● ● ●</span><span>Project notes</span><span aria-hidden="true">↗</span></div>
          <div className="tutorial-note"><span className="tutorial-note-date">A LITTLE ORGANIZATION</span><h3>A few loose ends.</h3>
            {chapter === 2 ? <ul className="tutorial-checklist"><li><span className="tutorial-checkbox" /><span>Send the draft<small>Maya · Tuesday</small></span></li><li><span className="tutorial-checkbox" /><span>Check the budget<small>Leo · Wednesday</small></span></li><li><span className="tutorial-checkbox" /><span>Schedule the review<small>Nina · Friday</small></span></li></ul> : <><p>Maya needs to send the draft by Tuesday.</p><p>Leo should check the budget by Wednesday.</p><p>Nina will schedule the review by Friday.</p><span className="tutorial-pencil-line" /></>}
          </div>
          <div className={`tutorial-capsule${shown ? ' is-visible' : ''}`} aria-hidden={!shown}>
            <CarveLogo /><div><strong>{chapter === 2 ? 'Checklist ready to review' : chapter === 1 ? mode === 'guide' ? 'What needs to happen this week?' : 'Turn these notes into a checklist.' : 'What would you like done?'}</strong><span>{chapter === 2 ? 'Take a look. Make it yours.' : 'Carve · Project notes'}</span></div>{chapter === 2 ? <Check size={17} /> : <CornerDownLeft size={16} />}
          </div>
        </div>
        {chapter === 0 ? <div className="tutorial-summon-demo"><button type="button" aria-pressed={summoned} onClick={() => setSummoned(value => !value)}>{summoned ? 'Put the preview away' : 'Preview the shortcut'}<ArrowRight size={14} /></button><img src={keyboardDrawing} alt="" /></div> : <div className="tutorial-art-caption tutorial-art-caption--illustrated"><img src={chapter === 1 ? contextDrawing : reviewDrawing} alt="" /><span>{chapter === 1 ? 'Same window. Just say what you need.' : 'Same notes. A little more organized.'}</span></div>}
        <span className="tutorial-illustration-label">ILLUSTRATED EXAMPLE</span>
      </div>
    </div>
    <footer className="tutorial-bottom">
      <div className="tutorial-pagination"><span>0{chapter + 1} <span>/ 03</span></span>{chapter > 0 ? <button type="button" onClick={() => changeChapter(chapter - 1)}><ChevronLeft size={14} />Back</button> : <span className="tutorial-bottom-hint">A small guide to a lighter day.</span>}</div>
      {chapter < 2 ? <Button onClick={() => changeChapter(chapter + 1)}>{chapter === 0 ? 'Next: ask or act' : 'Next: stay in control'}<ArrowRight size={16} /></Button> : <Button disabled={busy || working || !setupReady} onClick={onOwnWindow}>Try my own window<ArrowRight size={16} /></Button>}
    </footer>
    {chapter === 2 ? <div className="tutorial-practice">{!setupReady ? <span>Finish setup above to try Carve in a window.</span> : <><span>Prefer a safe place to start?</span><button type="button" disabled={busy || working} onClick={onPractice}>{busy ? 'Opening sample notes…' : 'Try it with sample notes'}<ArrowRight size={14} /></button><small>Opening the notes is free. Sending a request uses your trial allowance and shares the selected window with your AI service.</small></>}</div> : null}
  </section>
}
