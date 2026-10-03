const ui = {
  page: 'learn',
  state: null,
  sessionName: 'Priority triage lesson',
  fixtureId: 'branched-triage',
  excludedApps: '1Password, Keychain Access',
  excludedWindows: 'Private Browsing, Incognito',
  excludedDomains: '',
  excludedRegions: '',
  screenshots: false,
  accessibilityTree: true,
  activeWindow: true,
  inputMetadata: false,
  goal: '',
  autonomy: 'approve_each',
  providerId: 'mock',
  toastTimer: null,
}

const pages = [
  ['learn', 'Learn', ''],
  ['procedures', 'Procedures', 'procedures'],
  ['work', 'Work', 'runs'],
  ['audit', 'Audit', 'audit'],
  ['settings', 'Settings', ''],
]

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'checked') node.checked = Boolean(value)
    else if (key === 'disabled') node.disabled = Boolean(value)
    else if (key === 'selected') node.selected = Boolean(value)
    else if (key === 'value') node.value = value
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value))
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function button(label, className, onClick, disabled = false) {
  return el('button', { type: 'button', className, onClick, disabled }, label)
}

let browserSession = null

async function ensureBrowserSession() {
  if (!browserSession) {
    browserSession = fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: { 'x-carve-bootstrap': '1' },
      referrerPolicy: 'same-origin',
    }).then(async (response) => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
    }).catch((error) => {
      browserSession = null
      throw error
    })
  }
  return browserSession
}

async function api(path, options = {}) {
  await ensureBrowserSession()
  const send = () => fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-carve-csrf': '1', ...(options.headers ?? {}) },
  })
  let response = await send()
  if (response.status === 401) {
    browserSession = null
    await ensureBrowserSession()
    response = await send()
  }
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
  return result
}

function toast(message) {
  const target = document.querySelector('#toast')
  target.textContent = message
  target.classList.add('show')
  clearTimeout(ui.toastTimer)
  ui.toastTimer = setTimeout(() => target.classList.remove('show'), 2800)
}

async function refresh(render = true) {
  ui.state = await api('/api/state')
  const active = ui.state.providers.find((provider) => provider.active)
  if (active) ui.providerId = active.id
  if (render) renderApp()
}

function renderApp() {
  renderNav()
  renderHeader()
  const main = document.querySelector('#main')
  main.replaceChildren(
    ui.page === 'learn' ? renderLearn()
      : ui.page === 'procedures' ? renderProcedures()
        : ui.page === 'work' ? renderWork()
          : ui.page === 'audit' ? renderAudit()
            : renderSettings(),
  )
}

function renderNav() {
  const nav = document.querySelector('#nav')
  nav.replaceChildren(...pages.map(([id, label, countKey]) => {
    const count = countKey ? ui.state?.[countKey]?.length ?? 0 : null
    return el('button', {
      type: 'button',
      className: `nav-button${ui.page === id ? ' active' : ''}`,
      onClick: () => { ui.page = id; renderApp(); document.querySelector('#main').focus() },
    }, el('span', {}, label), count === null ? null : el('span', { className: 'nav-count' }, count))
  }))
}

function renderHeader() {
  const holder = document.querySelector('#system-status')
  const session = ui.state?.selectedSession
  const activeProvider = ui.state?.providers.find((provider) => provider.active)
  const chain = ui.state?.auditChain
  holder.replaceChildren(
    statusChip(session?.status === 'active' ? 'Recording fixture evidence' : session?.status === 'paused' ? 'Capture paused' : 'Not recording', session?.status === 'active' ? 'recording' : 'good'),
    statusChip(`${activeProvider?.name ?? 'No provider'} · ${activeProvider?.model ?? ''}`, 'good'),
    statusChip(chain?.valid ? `Audit chain verified · ${chain.checked}` : 'Audit chain invalid', chain?.valid ? 'good' : 'warning'),
  )
}

function statusChip(text, tone) {
  return el('span', { className: `status-chip ${tone}` }, el('span', { className: 'pulse-dot' }), text)
}

function heading(eyebrow, title, copy, aside = null) {
  return el('div', { className: 'page-heading' },
    el('div', {}, el('p', { className: 'eyebrow' }, eyebrow), el('h2', {}, title), el('p', {}, copy)),
    aside,
  )
}

function renderLearn() {
  const session = ui.state.selectedSession
  const activeSession = session && session.status !== 'stopped' ? session : null
  return el('section', { className: 'page' },
    heading('Learn mode', 'Teach by showing, not surrendering control.', 'Capture is explicit, visible, pausable, and filtered before persistence. This vertical slice uses repeatable mock observations; real macOS capture is intentionally deferred.'),
    el('div', { className: 'grid' },
      el('section', { className: 'card hero-card span-7' },
        el('div', { className: 'card-title-row' },
          el('div', {}, el('h3', {}, activeSession ? activeSession.name : 'Start a named learning session'), el('div', { className: 'small muted' }, activeSession ? `Session ${activeSession.id.slice(0, 18)}…` : 'One bounded workflow at a time.')),
          activeSession ? statusChip(activeSession.status === 'active' ? 'Capture active' : 'Blackout paused', activeSession.status === 'active' ? 'recording' : 'warning') : null,
        ),
        activeSession ? sessionControls(activeSession) : startSessionForm(),
      ),
      el('section', { className: 'card span-5' },
        el('div', { className: 'card-title-row' }, el('h3', {}, 'Capture manifest'), el('span', { className: 'chip fact' }, 'Observed facts')),
        renderManifest(activeSession?.capturePolicy),
        el('div', { className: 'notice', style: 'margin-top:16px' }, 'Passwords and secret-like values are redacted before persistence. Screen text is always stored as untrusted evidence, never as agent instruction.'),
      ),
      el('section', { className: 'card span-12' },
        el('div', { className: 'card-title-row' },
          el('div', {}, el('h3', {}, 'Observation timeline'), el('div', { className: 'small muted' }, `${ui.state.observations.length} append-only observation${ui.state.observations.length === 1 ? '' : 's'}`)),
          el('span', { className: 'chip' }, 'Evidence hashes recorded'),
        ),
        renderTimeline(ui.state.observations),
      ),
    ),
  )
}

function startSessionForm() {
  const fixture = ui.state.fixtures.find((candidate) => candidate.id === ui.fixtureId)
  return el('div', {},
    el('div', { className: 'form-grid' },
      field('Session name', el('input', { value: ui.sessionName, onInput: (event) => { ui.sessionName = event.target.value } })),
      field('Evaluation fixture', select(ui.state.fixtures.map((item) => [item.id, item.name]), ui.fixtureId, (value) => {
        ui.fixtureId = value
        const next = ui.state.fixtures.find((item) => item.id === value)
        if (next) { ui.sessionName = next.name; ui.goal = next.goal }
        renderApp()
      })),
      field('Excluded applications', el('input', { value: ui.excludedApps, onInput: (event) => { ui.excludedApps = event.target.value }, placeholder: '1Password, Keychain Access' }), true),
      field('Excluded windows', el('input', { value: ui.excludedWindows, onInput: (event) => { ui.excludedWindows = event.target.value }, placeholder: 'Private Browsing, Payroll' })),
      field('Excluded domains', el('input', { value: ui.excludedDomains, onInput: (event) => { ui.excludedDomains = event.target.value }, placeholder: 'bank.example, health.example' })),
      field('Excluded regions', el('input', { value: ui.excludedRegions, onInput: (event) => { ui.excludedRegions = event.target.value }, placeholder: 'x,y,width,height; …' }), true),
      el('div', { className: 'field full' }, el('label', {}, 'Signals to capture'),
        el('div', { className: 'toggle-row' },
          toggle('Screenshots', 'screenshots'),
          toggle('Active window', 'activeWindow'),
          toggle('Accessibility tree', 'accessibilityTree'),
          toggle('Mouse/key metadata', 'inputMetadata'),
        ),
      ),
    ),
    el('div', { className: 'small muted', style: 'margin-top:12px' }, fixture ? `Scenario: ${fixture.goal} · expected ${fixture.expectedProcedure} workflow.` : ''),
    el('div', { className: 'button-row' }, button('● Start learning', 'primary-button', startSession)),
  )
}

function field(label, control, full = false) {
  return el('div', { className: `field${full ? ' full' : ''}` }, el('label', {}, label), control)
}

function select(options, value, onChange) {
  return el('select', { value, onChange: (event) => onChange(event.target.value) }, ...options.map(([optionValue, label]) => el('option', { value: optionValue, selected: optionValue === value }, label)))
}

function toggle(label, key) {
  return el('label', { className: 'toggle' }, el('input', { type: 'checkbox', checked: ui[key], onChange: (event) => { ui[key] = event.target.checked } }), label)
}

function parseList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseRegions(value) {
  return value.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [x, y, width, height] = item.split(',').map(Number)
    if (![x, y, width, height].every(Number.isFinite)) throw new Error(`Invalid region: ${item}`)
    return { x, y, width, height }
  })
}

async function startSession() {
  try {
    await api('/api/sessions', { method: 'POST', body: JSON.stringify({
      name: ui.sessionName,
      fixtureId: ui.fixtureId,
      capturePolicy: {
        screenshots: ui.screenshots,
        activeWindow: ui.activeWindow,
        accessibilityTree: ui.accessibilityTree,
        inputMetadata: ui.inputMetadata,
        excludedApplications: parseList(ui.excludedApps),
        excludedWindows: parseList(ui.excludedWindows),
        excludedDomains: parseList(ui.excludedDomains),
        excludedRegions: parseRegions(ui.excludedRegions),
      },
    }) })
    toast('Learning session started')
    await refresh()
  } catch (error) { toast(error.message) }
}

function sessionControls(session) {
  const fixture = ui.state.fixtures.find((candidate) => candidate.id === session.fixtureId)
  return el('div', {},
    el('p', { className: 'muted', style: 'line-height:1.55' }, `Goal evidence: ${session.goalHint}`),
    el('div', { className: 'grid', style: 'margin-top:18px' },
      el('div', { className: 'span-4' }, el('p', { className: 'eyebrow' }, 'Captured'), el('div', { className: 'metric' }, session.nextFixtureIndex), el('span', { className: 'small muted' }, `of ${fixture ? 'fixture events' : 'events'}`)),
      el('div', { className: 'span-8' }, el('p', { className: 'eyebrow' }, 'Current boundary'), el('div', { className: 'small', style: 'margin-top:8px;line-height:1.55' }, session.status === 'paused' ? 'Capture API inactive. No fixture observation can enter memory.' : 'Only the next named fixture observation will be accepted, redacted, and hashed.')),
    ),
    el('div', { className: 'button-row' },
      session.status === 'active' ? button('＋ Capture next observation', 'primary-button', () => sessionAction(session.id, 'capture')) : null,
      session.status === 'active' ? button('Ⅱ Pause capture', 'secondary-button', () => sessionAction(session.id, 'pause')) : button('▶ Resume capture', 'primary-button', () => sessionAction(session.id, 'resume')),
      button('Stop & infer procedure', 'quiet-button', () => sessionAction(session.id, 'stop')),
    ),
  )
}

async function sessionAction(sessionId, action) {
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(sessionId)}/${action}`, { method: 'POST' })
    toast(action === 'capture' ? result ? 'Observation stored after privacy checks' : 'Fixture is complete' : action === 'stop' ? 'Session stopped and procedure inferred' : `Capture ${action}d`)
    if (action === 'stop') ui.page = 'procedures'
    await refresh()
  } catch (error) { toast(error.message) }
}

function renderManifest(policy) {
  const effective = policy ?? { screenshots: ui.screenshots, activeWindow: ui.activeWindow, accessibilityTree: ui.accessibilityTree, inputMetadata: ui.inputMetadata, excludedApplications: parseList(ui.excludedApps), excludedWindows: parseList(ui.excludedWindows), excludedDomains: parseList(ui.excludedDomains), excludedRegions: [] }
  const rows = [
    [true, 'Fixture text + structured state', 'Normalized mock facts used by the deterministic workflow inducer.'],
    [effective.screenshots, 'Screenshots', effective.screenshots ? 'Pixels may contain sensitive information; mock references only in this demo.' : 'Off by default for the mock vertical slice.'],
    [effective.activeWindow, 'Active app, window + URL', 'Application/window identity and page URL when available; URL is checked for exclusions before minimization.'],
    [effective.accessibilityTree, 'Semantic UI elements', 'Roles, labels, and values; sensitive fields are redacted.'],
    [effective.inputMetadata, 'Input metadata', 'Click targets and event kinds; never raw password keystrokes.'],
  ]
  return el('div', { className: 'manifest' },
    ...rows.map(([on, title, copy]) => el('div', { className: 'manifest-row' }, el('span', { className: `manifest-icon${on ? '' : ' off'}` }, on ? '✓' : '—'), el('div', {}, el('strong', {}, title), el('div', { className: 'small muted' }, copy)))),
    el('div', { className: 'manifest-row' }, el('span', { className: 'manifest-icon' }, '×'), el('div', {}, el('strong', {}, 'Exclusions before storage'), el('div', { className: 'small muted' }, `${effective.excludedApplications.length} apps · ${effective.excludedWindows.length} windows · ${effective.excludedDomains.length} domains · ${effective.excludedRegions.length} regions`))),
  )
}

function renderTimeline(observations) {
  if (!observations.length) return el('div', { className: 'empty-state' }, el('strong', {}, 'No evidence yet'), 'Start a session and capture the first observation. Nothing is inferred before evidence exists.')
  return el('div', { className: 'timeline' }, ...observations.map((observation) => {
    const time = new Date(observation.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return el('article', { className: 'timeline-item' },
      el('time', { className: 'timeline-time' }, time),
      el('div', { className: 'timeline-rail' }, el('div', { className: 'timeline-node' })),
      el('div', { className: 'timeline-body' },
        el('h4', {}, `${observation.facts.app} · ${observation.facts.windowTitle}`),
        el('p', {}, observation.facts.text),
        el('div', { className: 'chip-row' },
          el('span', { className: 'chip fact' }, `Observed · ${observation.source}`),
          el('span', { className: 'chip' }, `#${observation.sequence}`),
          observation.redactions.map((item) => el('span', { className: 'chip redacted' }, `Redacted · ${item}`)),
          observation.injectionSignals.map((item) => el('span', { className: 'chip redacted' }, `Untrusted · ${item}`)),
          el('span', { className: 'chip' }, `sha256 ${observation.evidenceHash.slice(0, 10)}…`),
        ),
      ),
    )
  }))
}

function renderProcedures() {
  const procedures = ui.state.procedures
  return el('section', { className: 'page' },
    heading('Procedural memory', 'Inspect what Carve thinks it learned.', 'Facts remain linked to immutable observations. Interpretations, confidence, graph structure, and user corrections are shown separately and versioned.'),
    procedures.length ? el('div', { className: 'grid' },
      ...procedures.map((procedure) => renderProcedure(procedure)),
      renderSemanticMemory(ui.state.semanticMemory),
    ) : el('div', { className: 'empty-state' }, el('strong', {}, 'No learned procedures'), 'Complete a learning session to infer the first editable workflow.'),
  )
}

function renderSemanticMemory(memory) {
  return el('section', { className: 'card span-12' },
    el('div', { className: 'card-title-row' },
      el('div', {}, el('h3', {}, 'Semantic memory'), el('div', { className: 'small muted' }, 'Entities and relationships derived from sanitized evidence.')),
      el('span', { className: 'chip fact' }, `${memory.edges.length} relationships`),
    ),
    el('div', { className: 'semantic-list' }, ...memory.entities.map((entity) => el('div', { className: 'semantic-entity' },
      el('span', { className: 'chip inference' }, entity.kind),
      el('strong', {}, entity.name),
      el('span', { className: 'small muted' }, `${entity.provenanceObservationIds.length} evidence · ${Math.round(entity.confidence * 100)}%`),
    ))),
  )
}

function renderProcedure(procedure) {
  return el('article', { className: 'card span-12' },
    el('div', { className: 'procedure-header' },
      el('div', {}, el('div', { className: 'chip-row' }, el('span', { className: 'chip inference' }, 'Deterministic inference'), el('span', { className: 'chip' }, `Version ${procedure.version}`), procedure.correctionSummary ? el('span', { className: 'chip fact' }, `User-corrected · ${procedure.correctionSummary}`) : null), el('h3', { style: 'font-size:20px;margin-top:10px' }, procedure.name), el('p', { className: 'muted small' }, procedure.goal)),
      el('div', { className: 'confidence' }, el('span', { className: 'eyebrow' }, 'Confidence'), el('strong', {}, `${Math.round(procedure.confidence * 100)}%`), el('div', { className: 'confidence-track' }, el('div', { className: 'confidence-fill', style: `width:${Math.round(procedure.confidence * 100)}%` }))),
    ),
    el('div', { className: 'button-row' },
      button('Rename procedure', 'secondary-button', () => renameProcedure(procedure)),
      button('Use in Work mode', 'primary-button', () => { ui.goal = procedure.goal; ui.page = 'work'; renderApp() }, procedure.confidence < .5),
      el('span', { className: 'chip' }, `${procedure.provenanceObservationIds.length} evidence records`),
    ),
    renderWorkflow(procedure),
  )
}

function renderWorkflow(procedure) {
  const edgeByTarget = new Map(procedure.graph.edges.map((edge) => [edge.to, edge]))
  return el('div', { className: 'workflow' }, ...procedure.graph.steps.map((step, index) => {
    const outgoing = procedure.graph.edges.find((edge) => edge.from === step.id)
    return el('div', { className: 'workflow-step' },
      el('div', { className: 'step-number' }, step.kind === 'decision' ? '?' : index + 1),
      el('div', { className: 'step-copy' },
        el('div', { className: 'chip-row', style: 'margin-bottom:6px' }, el('span', { className: 'chip inference' }, step.kind), el('span', { className: 'chip' }, `${Math.round(step.confidence * 100)}%`)),
        el('h4', {}, step.name),
        el('p', {}, step.description),
        el('div', { className: 'evidence-box' }, `OBSERVED: ${step.factBasis.join(' · ')}\nINFERRED: ${step.interpretation.join(' · ')}`),
      ),
      el('div', { className: 'step-actions' },
        button('Edit', 'tiny-button', () => editStep(procedure, step)),
        button('Split', 'tiny-button', () => splitStep(procedure, step)),
        outgoing ? button('Merge next', 'tiny-button', () => mergeStep(procedure, step, outgoing.to)) : null,
        procedure.graph.steps.length > 1 ? button('Delete', 'tiny-button', () => deleteStep(procedure, step)) : null,
      ),
      edgeByTarget.get(step.id)?.condition ? el('span', { className: 'branch-label' }, `when ${edgeByTarget.get(step.id).condition}`) : null,
    )
  }))
}

async function correction(procedureId, payload, message) {
  try {
    await api(`/api/procedures/${encodeURIComponent(procedureId)}/corrections`, { method: 'POST', body: JSON.stringify(payload) })
    toast(message)
    await refresh()
  } catch (error) { toast(error.message) }
}

function renameProcedure(procedure) {
  const name = window.prompt('New procedure name', procedure.name)
  if (name) void correction(procedure.procedureId, { operation: 'rename', name }, 'Procedure renamed in a new version')
}

function editStep(procedure, step) {
  const name = window.prompt('Step name', step.name)
  if (!name) return
  const description = window.prompt('Step description', step.description)
  if (description !== null) void correction(procedure.procedureId, { operation: 'update_step', stepId: step.id, name, description }, 'Step corrected in a new version')
}

function splitStep(procedure, step) {
  const firstName = window.prompt('Name the first part', `${step.name} · prepare`)
  if (!firstName) return
  const secondName = window.prompt('Name the second part', `${step.name} · complete`)
  if (secondName) void correction(procedure.procedureId, { operation: 'split_step', stepId: step.id, firstName, secondName }, 'Step split in a new version')
}

function mergeStep(procedure, step, nextId) {
  const name = window.prompt('Name the merged step', step.name)
  if (name) void correction(procedure.procedureId, { operation: 'merge_steps', firstStepId: step.id, secondStepId: nextId, name }, 'Steps merged in a new version')
}

function deleteStep(procedure, step) {
  if (window.confirm(`Delete “${step.name}” from a new procedure version? Original evidence and prior versions remain.`)) {
    void correction(procedure.procedureId, { operation: 'delete_step', stepId: step.id }, 'Step deleted from a new version')
  }
}

function renderWork() {
  const run = ui.state.runs[0]
  const pending = ui.state.approvals.find((approval) => approval.status === 'pending')
  return el('section', { className: 'page' },
    heading('Work mode', 'Propose. Approve. Verify.', 'Carve retrieves a versioned procedure, explains the plan, evaluates every action against policy, and stops when observed state differs from expectation.'),
    el('div', { className: 'grid' },
      el('section', { className: 'card span-5' },
        el('div', { className: 'card-title-row' }, el('h3', {}, '1 · Goal and supervision'), el('span', { className: 'chip fact' }, 'User intent')),
        el('div', { className: 'form-grid' },
          field('Goal', el('textarea', { value: ui.goal, onInput: (event) => { ui.goal = event.target.value } }), true),
          field('Autonomy level', select([
            ['observe_only', 'Observe only'], ['preview', 'Preview'], ['approve_each', 'Approve each'], ['approve_plan', 'Approve plan & run'], ['approve_group', 'Approve by group'], ['timed_approval', 'Timed approval'], ['constrained_autonomous', 'Constrained autonomous'],
          ], ui.autonomy, (value) => { ui.autonomy = value })),
          field('Provider capability profile', select(ui.state.providers.map((provider) => [provider.id, `${provider.name}${provider.configured ? '' : ' · not configured'}`]), ui.providerId, (value) => { ui.providerId = value })),
        ),
        el('div', { className: 'button-row' }, button('Retrieve & build plan', 'primary-button', createPlan)),
        el('div', { className: 'notice', style: 'margin-top:16px' }, 'Timed approval never applies to communication, money, authentication, deletion, installation, privilege, disclosure, legal, or high-impact decisions.'),
      ),
      el('section', { className: 'card span-7' },
        el('div', { className: 'card-title-row' }, el('h3', {}, '2 · Proposed plan'), run ? statusChip(run.status.replaceAll('_', ' '), ['failed', 'blocked', 'cancelled'].includes(run.status) ? 'warning' : 'good') : null),
        run ? renderRun(run) : el('div', { className: 'empty-state' }, el('strong', {}, 'No plan yet'), 'Describe a goal. Low-confidence retrieval fails closed instead of inventing a workflow.'),
      ),
      pending ? el('section', { className: 'span-12' }, renderApproval(pending)) : null,
    ),
  )
}

async function createPlan() {
  try {
    await api('/api/plans', { method: 'POST', body: JSON.stringify({ goal: ui.goal, autonomy: ui.autonomy, providerId: ui.providerId }) })
    toast('Plan proposed from learned memory')
    await refresh()
  } catch (error) { toast(error.message) }
}

function renderRun(run) {
  return el('div', {},
    el('p', { className: 'muted small' }, run.plan.rationale),
    el('div', { className: 'chip-row' }, el('span', { className: 'chip fact' }, `Retrieval ${Math.round(run.plan.retrievalScore * 100)}%`), el('span', { className: 'chip' }, `Procedure v${run.plan.procedureVersion}`), el('span', { className: 'chip inference' }, run.plan.autonomy.replaceAll('_', ' '))),
    el('div', { className: 'plan-actions' }, ...run.plan.actions.map((action, index) => el('div', { className: 'plan-action' },
      el('strong', {}, `${index + 1}. ${action.preview}`),
      el('span', { className: `risk ${action.risk}` }, `${action.risk} · ${action.status}`),
      el('p', {}, `Expected: ${action.expectedStateChange} · Verify: ${action.verification.method}`),
    ))),
    run.result ? el('div', { className: 'notice', style: 'margin-top:13px' }, run.result) : null,
    el('div', { className: 'button-row' },
      run.status === 'planned' ? button(run.plan.autonomy === 'preview' ? 'Render preview' : 'Start supervised run', 'primary-button', () => runAction(run.id, 'start')) : null,
      ['running', 'awaiting_approval'].includes(run.status) ? button('■ Cancel execution', 'danger-button', () => runAction(run.id, 'stop')) : null,
    ),
  )
}

async function runAction(runId, action) {
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}/${action}`, { method: 'POST' })
    toast(action === 'start' ? 'Run started under the selected policy' : 'Execution cancelled')
    await new Promise((resolve) => setTimeout(resolve, 80))
    await refresh()
  } catch (error) { toast(error.message) }
}

function renderApproval(approval) {
  const seconds = approval.expiresAt ? Math.max(0, Math.ceil((new Date(approval.expiresAt).getTime() - Date.now()) / 1000)) : null
  return el('div', { className: 'approval-card' },
    el('p', { className: 'eyebrow' }, approval.kind === 'countdown' ? 'Cancellable timed approval' : approval.kind === 'group' ? 'Bounded group approval' : 'Immediate explicit approval'),
    seconds === null ? null : el('div', { className: 'countdown' }, `${seconds}s`),
    el('h4', {}, approval.preview),
    el('p', {}, `Approval is cryptographically bound to action ${approval.actionId.slice(0, 17)}… and expires with this request.`),
    el('div', { className: 'button-row' },
      button('Approve exact action', 'primary-button', () => approvalAction(approval.id, 'approve')),
      button('Cancel', 'danger-button', () => approvalAction(approval.id, 'cancel')),
    ),
  )
}

async function approvalAction(approvalId, action) {
  try {
    await api(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, { method: 'POST' })
    toast(action === 'approve' ? 'Exact action approved' : 'Approval cancelled; run stopping')
    await new Promise((resolve) => setTimeout(resolve, 80))
    await refresh()
  } catch (error) { toast(error.message) }
}

function renderAudit() {
  const chain = ui.state.auditChain
  return el('section', { className: 'page' },
    heading('Audit trail', 'Receipts for every boundary crossing.', 'Captured evidence, inferred memory, proposed plans, policy decisions, approvals, tool executions, verification results, and produced artifacts are distinct event types.', statusChip(chain.valid ? `Chain valid · ${chain.checked} events` : `Chain invalid at ${chain.errorAt}`, chain.valid ? 'good' : 'warning')),
    el('section', { className: 'card' },
      ui.state.audit.length ? el('div', { className: 'audit-list' }, ...ui.state.audit.map((event) => el('div', { className: 'audit-event' },
        el('code', {}, `#${event.sequence}`),
        el('strong', {}, event.category),
        el('span', { className: 'muted' }, summarizeDetails(event.details)),
        el('span', { className: 'actor' }, event.actor),
      ))) : el('div', { className: 'empty-state' }, el('strong', {}, 'No events'), 'Start a learning session to create the audit chain.'),
    ),
  )
}

function summarizeDetails(details) {
  const entries = Object.entries(details).slice(0, 3).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value).slice(0, 70) : String(value)}`)
  return entries.join(' · ')
}

function renderSettings() {
  return el('section', { className: 'page' },
    heading('Local settings', 'Models are capabilities, not authority.', 'Switch adapters without changing memory, tools, policy, or execution code. Capability mismatches return understandable errors before a model call.'),
    el('div', { className: 'grid' },
      ...ui.state.providers.map((provider) => el('article', { className: 'card span-4 provider-card' },
        el('div', { className: 'provider-head' }, el('div', {}, el('h3', {}, provider.name), el('div', { className: 'small muted' }, provider.model)), provider.active ? el('span', { className: 'chip fact' }, 'Active') : null),
        el('div', { className: 'capabilities' }, ...Object.entries(provider.capabilities).map(([name, available]) => el('span', { className: `capability${available ? '' : ' missing'}` }, name))),
        el('p', { className: 'small muted' }, provider.privacyNote),
        el('div', { className: 'button-row' }, button('Select', 'secondary-button', () => selectProvider(provider.id), provider.active), button('Check endpoint', 'quiet-button', () => healthProvider(provider.id))),
      )),
      el('section', { className: 'card span-6' },
        el('div', { className: 'card-title-row' }, el('h3', {}, 'Storage & retention'), el('span', { className: 'chip fact' }, 'Local-first')),
        el('p', { className: 'small muted' }, `Database: ${ui.state.dataBoundary.database}`),
        el('p', { className: 'small muted' }, `Artifacts: ${ui.state.dataBoundary.artifacts}`),
        el('div', { className: 'notice' }, ui.state.dataBoundary.encryptionAtRest),
        el('div', { className: 'notice export-protection' }, ui.state.dataBoundary.exportProtection),
        el('div', { className: 'button-row' }, button('Export encrypted data', 'secondary-button', exportData), button('Permanently delete data', 'danger-button', purgeData)),
      ),
      el('section', { className: 'card span-6' },
        el('div', { className: 'card-title-row' }, el('h3', {}, 'Stable tool surface'), el('span', { className: 'chip' }, `${ui.state.tools.filter((tool) => tool.available).length} available`)),
        el('div', { className: 'manifest' }, ...ui.state.tools.map((tool) => el('div', { className: 'manifest-row' }, el('span', { className: `manifest-icon${tool.available ? '' : ' off'}` }, tool.available ? '✓' : '—'), el('div', {}, el('strong', {}, tool.name), el('div', { className: 'small muted' }, `${tool.family} · ${tool.location} · ${tool.defaultRisk}`))))),
      ),
    ),
  )
}

async function selectProvider(providerId) {
  try {
    await api(`/api/providers/${encodeURIComponent(providerId)}/select`, { method: 'POST' })
    ui.providerId = providerId
    toast('Model adapter switched')
    await refresh()
  } catch (error) { toast(error.message) }
}

async function healthProvider(providerId) {
  try {
    const result = await api(`/api/providers/${encodeURIComponent(providerId)}/health`, { method: 'POST' })
    toast(result.message)
  } catch (error) { toast(error.message) }
}

async function exportData() {
  const passphrase = await requestExportPassphrase()
  if (passphrase === null) return
  try {
    const data = await api('/api/export', { method: 'POST', body: JSON.stringify({ passphrase }) })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `steward-export-${new Date().toISOString().slice(0, 10)}.steward`
    link.click()
    URL.revokeObjectURL(link.href)
    toast('Encrypted export created; keep the passphrase separately')
  } catch (error) { toast(error.message) }
}

function requestExportPassphrase() {
  return new Promise((resolvePromise) => {
    const first = el('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false' })
    const second = el('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false' })
    const error = el('div', { className: 'export-error' })
    const close = (value) => { backdrop.remove(); resolvePromise(value) }
    const submit = (event) => {
      event.preventDefault()
      if ([...first.value].length < 12) { error.textContent = 'Use at least 12 characters.'; return }
      if (first.value !== second.value) { error.textContent = 'The passphrases do not match.'; return }
      close(first.value)
    }
    const form = el('form', { className: 'export-dialog', onSubmit: submit },
      el('strong', {}, 'Protect this export'),
      el('p', {}, 'Carve encrypts the complete export before it leaves the local process. The passphrase is never stored and cannot be recovered.'),
      field('Passphrase · at least 12 characters', first),
      field('Confirm passphrase', second),
      error,
      el('div', { className: 'button-row' }, button('Encrypt and download', 'primary-button', submit), button('Cancel', 'secondary-button', () => close(null))),
      el('small', {}, 'Uses scrypt and authenticated AES-256-GCM. Keep the passphrase separately from the .steward file.'),
    )
    const backdrop = el('div', { className: 'export-backdrop', onMouseDown: (event) => { if (event.target === backdrop) close(null) } }, form)
    document.body.append(backdrop)
    first.focus()
  })
}

async function purgeData() {
  const phrase = window.prompt('This permanently deletes sessions, observations, procedures, runs, audit history, and artifacts. Type DELETE ALL STEWARD DATA to continue.')
  if (phrase !== 'DELETE ALL STEWARD DATA') return
  try {
    await api('/api/purge', { method: 'POST', body: JSON.stringify({ confirm: phrase }) })
    toast('All Carve data permanently deleted')
    ui.page = 'learn'
    await refresh()
  } catch (error) { toast(error.message) }
}

document.querySelector('#global-stop').addEventListener('click', async () => {
  try {
    await api('/api/global-stop', { method: 'POST' })
    toast('Capture paused and active execution stopped')
    await refresh()
  } catch (error) { toast(error.message) }
})

setInterval(async () => {
  if (!ui.state) return
  const active = ui.state.runs.some((run) => ['running', 'awaiting_approval'].includes(run.status))
  if (!active) return
  try { await refresh() } catch { /* transient polling failures surface on the next user action */ }
}, 750)

refresh().catch((error) => toast(`Could not load Carve: ${error.message}`))
