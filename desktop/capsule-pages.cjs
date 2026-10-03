/* Presentation only. Commands and their authority remain in the controller. */
(() => {
  const pageFor = (p, local = {}) => {
    if (local.stale) return 'connection'
    if (local.audio) return 'audio'
    if (p.workConsent || p.guide?.consentProviderId) return 'permission'
    if (p.decision) return 'approval'
    if (p.planApproval) return local.adjusting ? 'edit' : 'plan'
    if (p.guidance) return 'question'
    if (p.budgetCheckpoint) return 'budget'
    if (p.failure || p.mode === 'failure') return 'failure'
    if (p.assistance?.owner === 'user' && p.assistance.followUps?.some(a => a.kind === 'switch_mode')) return 'mode-switch'
    if (p.pausing) return 'pausing'
    if (p.steeringPaused || p.phase === 'paused') return 'paused'
    if (p.mode === 'result') return 'result'
    if (p.guide?.state === 'answered') return 'answer'
    if (p.guide?.state === 'failed') return 'answer'
    if (p.theme === 'complete') return 'result'
    if (p.mode === 'guide') return ['reading', 'thinking'].includes(p.guide?.state) ? 'working' : 'compose'
    if (p.endedAt || p.phase === 'ended') return 'stopped'
    if (p.assistance?.active || ['session', 'steer', 'launch'].includes(p.mode) || ['reading', 'thinking'].includes(p.guide?.state)) return 'working'
    return 'compose'
  }
  const create = ({ document: doc, command, changed }) => {
    const byId = id => doc.getElementById(id)
    const badge = byId('badge')
    badge.classList.add('capsule-v2')
    const make = (tag, id, text) => { const node = doc.createElement(tag); node.id = id; if (text) node.textContent = text; return node }
    const row = badge.querySelector('.row')
    const headerContext = make('span', 'capsule-context')
    row.insertBefore(headerContext, byId('elapsed'))
    const more = make('button', 'capsule-more', '⋯'); more.type = 'button'; more.setAttribute('aria-label', 'More options'); more.setAttribute('aria-expanded', 'false')
    row.insertBefore(more, byId('stop-button'))
    const parking = make('div', 'capsule-parking'); parking.hidden = true
    const main = make('div', 'capsule-body')
    const title = make('h1', 'capsule-title')
    title.setAttribute('aria-live', 'polite')
    const description = make('p', 'capsule-description')
    const chapter = make('div', 'capsule-chapter')
    const chapterLabel = make('span', 'capsule-chapter-label')
    const chapterDetail = make('span', 'capsule-chapter-detail')
    chapter.append(chapterLabel, chapterDetail)
    const originalRequest = make('details', 'capsule-original-request')
    const requestSummary = make('summary', 'capsule-original-summary', 'Your original request')
    const originalText = make('p', 'capsule-original-text')
    originalRequest.append(requestSummary, originalText)
    originalRequest.addEventListener('toggle', () => changed())
    let resultRequestKey = null
    const policyCaption = make('span', 'capsule-policy-caption')
    const actionRequest = make('section', 'capsule-action-request')
    const requestLabel = make('h2', 'capsule-request-label', 'Your request')
    const requestText = make('p', 'capsule-request-text')
    actionRequest.setAttribute('aria-labelledby', 'capsule-request-label')
    actionRequest.append(requestLabel, requestText)
    const actionNext = make('p', 'capsule-action-next')
    // Progress rows are controller facts (see src/live-computer-progress.ts).
    // Rows are keyed so a heartbeat never replays a tick; only a row that
    // actually changes to done gets the tick beat.
    const checklist = make('ol', 'capsule-checklist')
    checklist.setAttribute('aria-label', 'Progress')
    const checklistRows = new Map()
    const renderChecklist = items => {
      const seen = new Set()
      items.forEach((item, index) => {
        seen.add(item.id)
        let li = checklistRows.get(item.id)
        if (!li) {
          li = doc.createElement('li'); li.dataset.id = item.id
          const mark = doc.createElement('span'); mark.className = 'check-mark'; mark.setAttribute('aria-hidden', 'true')
          const text = doc.createElement('span'); text.className = 'check-text'
          const label = doc.createElement('span'); label.className = 'check-label'
          const detail = doc.createElement('span'); detail.className = 'check-detail'
          text.append(label, detail); li.append(mark, text)
          checklistRows.set(item.id, li)
        }
        const previous = li.dataset.state
        if (previous !== item.state) {
          li.dataset.state = item.state
          if (previous && item.state === 'done') { li.classList.remove('ticked'); void li.offsetWidth; li.classList.add('ticked') }
        }
        li.setAttribute('aria-current', item.state === 'now' ? 'step' : 'false')
        const label = li.querySelector('.check-label'), detail = li.querySelector('.check-detail')
        if (label.textContent !== item.label) label.textContent = item.label
        const detailText = item.detail || ''
        if (detail.textContent !== detailText) detail.textContent = detailText
        detail.hidden = !detailText
        if (checklist.children[index] !== li) checklist.insertBefore(li, checklist.children[index] || null)
      })
      for (const [id, li] of checklistRows) if (!seen.has(id)) { li.remove(); checklistRows.delete(id) }
    }
    // While Carve waits on the person, the header shows for how long.
    const waiting = make('span', 'capsule-waiting'); waiting.hidden = true
    row.insertBefore(waiting, more)
    const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
    const tickWaiting = () => {
      const since = snapshot?.waitingSince ? Date.parse(snapshot.waitingSince) : NaN
      const show = Number.isFinite(since) && !snapshot.minimized
      waiting.hidden = !show
      if (show) waiting.textContent = `Waiting for you · ${clock(Date.now() - since)}`
      badge.dataset.waitingLong = String(show && Date.now() - since >= 20_000)
    }
    doc.defaultView.setInterval(tickWaiting, 1000)
    const content = make('div', 'capsule-content')
    const footer = make('div', 'capsule-footer')
    const evidence = badge.querySelector('.answer-evidence')
    const settingsButton = make('button', 'capsule-settings'); settingsButton.type = 'button'; settingsButton.setAttribute('aria-expanded', 'false')
    const composer = byId('follow-up'); composer.prepend(settingsButton)
    const end = make('button', 'capsule-end', 'Stop task'); end.type = 'button'; end.addEventListener('click', () => byId('stop-button').click())
    const back = make('button', 'capsule-back', 'Back'); back.type = 'button'
    const options = make('div', 'capsule-options')
    const open = make('button', 'capsule-open', 'Open in Carve'); open.type = 'button'; open.addEventListener('click', () => command({ kind: 'expand' }))
    const status = make('p', 'capsule-options-note', 'Spoken replies are separate from microphone recording.')
    const sharing = make('p', 'capsule-sharing-status'); sharing.hidden = true
    options.append(sharing, open, byId('details-button'), byId('voice-button'), byId('minimize-carve'), byId('model-info'), status)
    const settings = make('div', 'capsule-preferences')
    const policyNote = make('p', 'capsule-policy-note', 'Explain answers questions without clicking or typing. Take action can work in your selected window. Some actions always need separate approval or review.')
    const policyChoices = make('fieldset', 'capsule-policy-choices')
    policyChoices.append(make('legend', 'capsule-policy-legend', 'When should Carve ask?'))
    const choices = [
      ['fast', 'Act directly', 'Start without a plan review. Some actions still need approval.'],
      ['smart_checkpoints', 'Review plan first', 'Review the plan before Carve starts. Carve asks again if the task changes or an action needs separate approval.'],
      ['step_by_step', 'Approve each change', 'Review the plan, then approve each change before it happens.'],
    ]
    for (const [value, label, detail] of choices) {
      const item = doc.createElement('label')
      const radio = doc.createElement('input'); radio.type = 'radio'; radio.name = 'capsule-policy'; radio.value = value
      const copy = doc.createElement('span'); copy.textContent = label
      const help = doc.createElement('small'); help.textContent = detail; copy.append(help)
      radio.addEventListener('change', () => {
        const select = byId('approval-preset')
        if (select.disabled) return
        select.value = value
        select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
        update(snapshot, local)
      })
      item.append(radio, copy); policyChoices.append(item)
    }
    settings.append(byId('assistance-modes'), byId('approval-setting'), policyChoices, policyNote)
    // Retain every existing node and listener. Only the selected page owns the
    // visible body/footer; inactive capabilities live in an inert warehouse.
    for (const node of [...badge.children]) {
      if (node === row || node.id === 'restore-carve' || node.classList.contains('badge-surface') || node.classList.contains('light-edge')) continue
      parking.append(node)
    }
    main.append(chapter, policyCaption, title, description, content)
    badge.append(main, footer, parking)
    parking.append(options, settings, back, end, evidence, actionRequest, actionNext, checklist)
    const planRow = badge.querySelector('.plan-row')
    const failureRow = badge.querySelector('.failure-row')
    const budgetActions = badge.querySelector('.budget-row__actions')
    const planControls = [byId('plan-start'), byId('plan-adjust'), byId('plan-fresh')]
    // Keep route detail but consolidate the full-app escape hatch in the menu.
    byId('plan-expand').hidden = true
    let snapshot, local = {}, panel = null, key = null, opener = null, panelBottom = null, motionKey = null
    let focusKey = null, primary = null, enterDown = false
    const visible = node => Boolean(node?.isConnected && !node.closest('[hidden]') && node.getClientRects().length)
    const editing = node => node?.matches('input,textarea,select,[contenteditable="true"]')
    // Enter remains native button activation (and composer submission). Never
    // install a global shortcut or turn a held submit key into a new approval.
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return
      const repeated = enterDown || event.repeat
      enterDown = true
      if (repeated && (event.target.closest?.('button') || event.target === byId('follow-up-input'))) {
        event.preventDefault(); event.stopImmediatePropagation()
      }
    }, true)
    doc.addEventListener('keyup', event => { if (event.key === 'Enter') enterDown = false }, true)
    doc.defaultView.addEventListener('blur', () => { enterDown = false })
    const focusPrimary = (p, view, identity, compact) => {
      // Consent to continue in another app is a workflow step like starting a
      // plan, not a protected effect: its primary button takes the Enter
      // default. Protected decisions keep requiring an explicit choice.
      const handoffConsent = view === 'approval' && p.decision?.kind === 'handoff'
      const candidate = ({ plan: byId('plan-start'), failure: byId('failure-retry'),
        'mode-switch': byId('context-actions').querySelector('[data-action-kind="switch_mode"]'),
        budget: byId('budget-grant'), paused: byId('follow-up-send'), connection: open,
        ...(handoffConsent ? { approval: byId('decision-approve') } : {}) })[view]
      const nextFocusKey = `${identity}:${view}:${compact}:${p.assistance?.followUps?.find(a => a.kind === 'switch_mode')?.id || ''}`
      if (nextFocusKey === focusKey) return
      focusKey = nextFocusKey
      const active = doc.activeElement
      const previous = primary
      if (primary) { primary.removeAttribute('data-enter-default'); primary.removeAttribute('aria-keyshortcuts') }
      primary = null
      if (compact) return
      // A new/revised protected decision must not inherit approval focus from
      // its predecessor. The person chooses that button explicitly each time.
      if (view === 'approval' && !handoffConsent && active === byId('decision-approve')) {
        title.tabIndex = -1; title.focus({ preventScroll: true }); return
      }
      if (!visible(candidate) || candidate.disabled) return
      if (visible(active) && (editing(active) || (active !== previous && active !== doc.body && active !== badge))) return
      primary = candidate
      primary.setAttribute('data-enter-default', '')
      primary.setAttribute('aria-keyshortcuts', 'Enter')
      primary.focus({ preventScroll: true })
    }
    const mount = (parent, nodes) => {
      const desired = nodes.filter(Boolean)
      if (desired.length === parent.children.length && desired.every((node, i) => parent.children[i] === node)) return
      for (const node of [...parent.children]) if (!desired.includes(node)) parking.append(node)
      desired.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null) })
    }
    const setPanel = (value, trigger) => {
      if (value && !panel) panelBottom = badge.getBoundingClientRect().bottom
      if (!value) panelBottom = null
      panel = value; opener = trigger || opener
      update(snapshot, local)
      changed()
      if (panel) (content.querySelector('button:not([disabled]),select:not([disabled])') || back).focus()
      else if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus()
    }
    more.addEventListener('click', () => setPanel(panel === 'options' ? null : 'options', more))
    settingsButton.addEventListener('click', () => setPanel(panel === 'settings' ? null : 'settings', settingsButton))
    back.addEventListener('click', () => setPanel(null))
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel) { event.preventDefault(); event.stopImmediatePropagation(); setPanel(null) }
    }, true)
    const update = (p, state = {}) => {
      if (!p) return
      snapshot = p; local = state
      sharing.textContent = p.sharingStatus || ''
      sharing.hidden = !p.sharingStatus
      const page = pageFor(p, state)
      const nextKey = `${p.sessionId}:${page}:${p.decision?.id || p.planApproval?.planHash || p.guidance?.id || p.budgetCheckpoint?.id || ''}:${p.decision?.revision || ''}`
      if (nextKey !== key || p.minimized) { panel = null; panelBottom = null; key = nextKey; main.scrollTop = 0 }
      const view = panel || page
      const drawingSetup = view === 'answer' && p.assistance?.guide?.answer?.providerId === 'local-drawing'
      // These are state labels, not simulated progress or an estimate of completion.
      const chapterCopy = {
        compose: ['RIGHT HERE WITH YOU', 'Your window, your copilot'],
        working: ['IN PROGRESS', p.inputLease === 'act' ? 'Carve is taking action' : ''],
        plan: ['BEFORE WE BEGIN', 'Your review comes first'],
        result: ['READY TO REVIEW', p.application || 'In your window'],
        answer: [drawingSetup ? 'POINT & ASK' : 'A LITTLE CLARITY', drawingSetup ? 'Stay in this window' : ''],
      }[view]
      chapter.hidden = !chapterCopy
      if (chapterCopy) { chapterLabel.textContent = chapterCopy[0]; chapterDetail.textContent = chapterCopy[1] }
      // A task's request is useful context, but is never labeled as a captured
      // before-state, an edit diff, or proof that work succeeded.
      const request = p.taskGoal?.trim() || ''
      const requestKey = `${p.sessionId}:${request}`
      if (requestKey !== resultRequestKey) { originalRequest.open = false; originalText.textContent = request; resultRequestKey = requestKey }
      originalRequest.hidden = !request
      // Ordinary status heartbeats must not replay page-arrival motion.
      // Keep controls stationary and immediately usable while content fades in.
      const nextMotionKey = `${nextKey}:${view}:${p.minimized ? 'dot' : p.collapsed ? 'line' : 'card'}:${p.completionEvidence || ''}`
      if (nextMotionKey !== motionKey) {
        motionKey = nextMotionKey
        main.getAnimations?.().forEach(animation => animation.cancel())
        if (!p.minimized && !p.collapsed && !doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          main.animate?.([{ opacity: 0.65, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
        }
      }
      badge.dataset.page = view
      badge.dataset.decision = p.decision?.kind || ''
      const handoff = view === 'approval' && p.decision?.kind === 'handoff'
      if (handoff) { byId('stop-button').textContent = 'Stop task'; byId('stop-button').setAttribute('aria-label', 'Stop task') }
      doc.body.dataset.capsulePage = view
      const compact = p.minimized || p.collapsed
      headerContext.textContent = p.compactApplication || p.application || 'Carve'
      const switchAction = p.assistance?.followUps?.find(a => a.kind === 'switch_mode')
      requestText.textContent = switchAction?.request || ''
      const mode = p.assistance?.mode === 'guide' ? 'Explain' : 'Take action'
      const policy = { fast: 'Act directly', smart_checkpoints: 'Review plan first', step_by_step: 'Approve each change' }[p.assistance?.approvalPreset] || 'Act directly'
      for (const radio of policyChoices.querySelectorAll('input')) { radio.checked = radio.value === byId('approval-preset').value; radio.disabled = byId('approval-preset').disabled || p.assistance?.mode === 'guide' }
      policyCaption.textContent = policy
      policyCaption.hidden = handoff || !['plan', 'edit', 'approval'].includes(view) || !p.assistance
      settingsButton.textContent = `${mode} · ${policy} ⌄`
      settingsButton.hidden = ['paused', 'pausing'].includes(view) || !p.assistance || Boolean(p.assistance?.guide?.answer?.publicLookup)
      settingsButton.disabled = Boolean(p.assistance?.active || p.assistance?.preparing)
      more.hidden = Boolean(p.minimized)
      more.setAttribute('aria-expanded', String(panel === 'options'))
      settingsButton.setAttribute('aria-expanded', String(panel === 'settings'))
      let nextTitle = ({ compose: 'What can I help with?', 'mode-switch': 'Let Carve take action?', working: 'Working', plan: 'Ready for your review', edit: 'What should change?', approval: p.decision?.title, question: p.guidance?.question, budget: p.budgetCheckpoint?.cloudUnit ? 'Use one more task to continue?' : 'More work to finish', paused: 'Paused', permission: 'Allow window sharing?', audio: 'Speak your request', failure: p.failure?.title || 'Couldn’t finish this task', connection: 'Can’t check the task status', stopped: 'Task stopped', settings: 'How should Carve help?', options: 'Task options', answer: 'Here’s what I found', result: p.resultTitle || (p.completionEvidence === 'verified' ? 'Task complete' : 'Completion reported') })[view] || 'Carve'
      if (view === 'answer' && p.assistance?.guide?.answer?.capabilityContext) nextTitle = 'What I can help with'
      if (drawingSetup) nextTitle = 'Point out what you mean.'
      if (view === 'pausing') nextTitle = 'Pausing…'
      if (view === 'working') nextTitle = (p.label || 'Working').replace(/^Carve\s*·\s*/u, '')
      if (view === 'answer' && p.guide?.state === 'failed') nextTitle = (p.label || 'Couldn’t answer this time').replace(/^Carve\s*·\s*/u, '')
      if (title.textContent !== nextTitle) title.textContent = nextTitle
      description.textContent = ({ 'mode-switch': 'Explain is on. This request needs Carve to use your selected window.', working: p.detail, plan: 'Review these steps before Carve starts.', edit: 'Describe a change. You’ll review the updated plan before it runs.', paused: p.steeringReview ? 'That correction goes beyond your approved task. Adjust it, or continue without it.' : 'Resume when you’re ready, or add a correction.', connection: 'The connection to Carve was lost. The task may still be running. Reconnect before approving any more steps.', stopped: 'Carve is no longer clicking or typing. Earlier changes may remain.' })[view] || ''
      if (view === 'pausing') description.textContent = 'Finishing the current action, then pausing.'
      if (view === 'answer' && p.guide?.state === 'failed') description.textContent = p.detail || 'Try again, or open task details in Carve.'
      if (drawingSetup) description.textContent = 'Mark an area in your window, then ask about it here.'
      description.hidden = !description.textContent
      actionNext.textContent = switchAction?.label === 'Resume task' ? 'Carve will continue the paused task under your existing approval settings.'
        : p.assistance?.approvalPreset === 'smart_checkpoints' ? 'You’ll review the plan before Carve starts.'
        : p.assistance?.approvalPreset === 'step_by_step' ? 'You’ll review the plan, then approve each change.'
        : 'Carve will start the task. Actions that need separate approval will still pause.'
      title.hidden = compact || (view === 'answer' && Boolean(p.assistance?.guide?.answer?.publicLookup))
      // Do not invent an artifact URL or a more specific result than the
      // controller supplied. Rich answers, citations and tables stay intact.
      evidence.textContent = (p.completionEvidence === 'verified' ? '✓ Result checked' : 'Completion hasn’t been independently checked.') + (p.elapsedLabel ? ` · ${p.elapsedLabel}` : '')
      evidence.dataset.verified = String(p.completionEvidence === 'verified')
      const bodies = {
        compose: [], 'mode-switch': [actionRequest, actionNext], working: p.checklist?.length ? [checklist] : [], plan: [byId('route'), byId('plan-steps')], edit: [byId('route')],
        approval: [byId('decision-card')], question: [byId('guidance-row')], budget: [byId('budget-row')],
        paused: [], result: [byId('answer'), evidence, originalRequest, byId('context-actions')], answer: [byId('answer'), byId('context-actions'), byId('guide-row')],
        stopped: [], failure: [failureRow], connection: [], permission: p.workConsent ? [byId('work-consent')] : [byId('guide-consent-row')],
        audio: [byId('audio-sharing')], options: [options], settings: [settings],
      }
      const feet = {
        compose: [composer], 'mode-switch': [byId('context-actions')], working: [], plan: [planRow], edit: [composer], approval: [byId('handoff-decline'), byId('decision-approve')],
        question: [composer], budget: [budgetActions], paused: [composer], result: [composer], answer: [composer], stopped: [composer],
        failure: [], connection: [open], permission: p.workConsent ? [composer] : [], audio: [], options: [back], settings: [back],
      }
      // Mount shared children before their parents to avoid stale nesting when
      // moving from a decision to another state and back.
      if (view === 'plan') planControls.forEach(node => { if (node.parentElement !== planRow) planRow.append(node) })
      if (view === 'options' && open.parentElement !== options) options.prepend(open)
      mount(content, bodies[view] || [])
      const footNodes = [...(feet[view] || [])]
      if (view === 'paused') {
        const input = byId('follow-up-input')
        const send = byId('follow-up-send')
        input.placeholder = p.steeringReview ? 'Adjust your correction…' : 'Add a correction (optional)…'
        input.setAttribute('aria-label', 'Correct the paused task')
        if (!send.disabled) send.textContent = input.value.trim() ? 'Send correction' : p.steeringReview ? 'Keep original' : 'Resume'
        send.title = input.value.trim() ? 'Check whether this correction fits your approved task' : p.steeringReview ? 'Continue without the correction' : 'Resume the paused task'
      }
      if (['approval', 'question'].includes(view) && !handoff) footNodes.push(end)
      footNodes.push(byId('notice'))
      mount(footer, footNodes)
      main.hidden = Boolean(compact)
      footer.hidden = Boolean(compact)
      badge.dataset.verified = String(p.completionEvidence === 'verified')
      // A declared next step is intent: styled as pending until input runs.
      badge.dataset.intent = String(Boolean(p.intent) && view === 'working')
      if (view === 'working' && p.checklist?.length) renderChecklist(p.checklist)
      tickWaiting()
      // The outer renderer reveals the initially hidden window after layout.
      // Defer focus until that render is complete, and discard stale requests.
      queueMicrotask(() => {
        if (snapshot === p && key === nextKey && (panel || pageFor(p, local)) === view) focusPrimary(p, view, nextKey, compact)
      })

      // Body owns overflow, never the safety controls below it.
      badge.style.overflowY = 'hidden'
      // Local pages can grow without a new native state push. Preserve their
      // bottom edge and clamp immediately rather than waiting for a heartbeat.
      const top = panelBottom === null ? state.anchorY || 0 : panelBottom - badge.offsetHeight
      badge.style.top = Math.max(4, Math.min(top, doc.documentElement.clientHeight - badge.offsetHeight - 8)) + 'px'
    }
    return { update, isOpen: () => Boolean(panel) }
  }
  const api = { pageFor, create }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else globalThis.carveCapsulePages = api
})()
