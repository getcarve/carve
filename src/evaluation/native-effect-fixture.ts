import { createRequire } from 'node:module'
import { createNativeInputController, type NativeInputBridge } from '../native-input-controller.js'
import { MacOSLiveComputerBackend, LiveComputerService, LiveComputerActionError } from '../live-computer.js'
import { compileLiveComputerTask } from '../live-computer-planning.js'

/** Invoked only by the owned evaluation process. No production IPC endpoint.
 * All capture, focus, targeting and text delivery use the shipping classes. */
export async function runNativeEffectFixture(options: { bridgePath: string; helperPath: string; dataDir: string; windowTitle: string; payload: string; lostAck?: boolean }) {
  const bridge = createRequire(import.meta.url)(options.bridgePath) as NativeInputBridge
  if (!bridge.isTrusted()) throw new Error('The owned Carve evaluation process does not have Accessibility permission')
  let sends = 0
  const instrumented: NativeInputBridge = { isTrusted: () => bridge.isTrusted(), requestTrust: () => false,
    focusWindow: payload => bridge.focusWindow!(payload),
    execute: payload => {
      const action = JSON.parse(payload).action
      const receipt = bridge.execute(payload)
      if (action.kind === 'type') {
        sends++
        if (options.lostAck && sends === 1) throw new Error('Injected lost native acknowledgement')
      }
      return receipt
    } }
  const backend = new MacOSLiveComputerBackend(options.helperPath, options.dataDir, createNativeInputController(instrumented))
  const status = await backend.refreshStatus()
  if (!status.computerControl || status.screenRecording !== 'granted') throw new Error(`Native fixture unavailable: ${JSON.stringify(status)}`)
  const matches = (await backend.listTargets()).filter(t => t.bundleIdentifier === 'com.google.Chrome' && t.title.includes(options.windowTitle))
  if (matches.length !== 1) throw new Error(`Expected one owned fixture window, found ${matches.length}`)
  const target = matches[0]!
  const goal = `Write this requested text into the fixture editor, preserving existing contents: ${options.payload}`
  const ledger = compileLiveComputerTask(goal)
  const commit = ledger.objectives.find(o => o.kind === 'perform_commit')!
  for (const objective of ledger.objectives) objective.status = objective === commit ? 'active' : objective.kind === 'verify_outcome' ? 'pending' : 'verified'
  ledger.currentObjectiveId = commit.id
  const service = new LiveComputerService(backend)
  try {
    await service.start({ runId: 'native-fixture', goal, ledger, providerId: 'fixture', remoteVisualsAllowed: false, target, maxActions: 8 })
    const elements = service.latestFrame().elements
    const editors = elements.filter(e => e.name === 'Carve fixture editor' && e.editable && e.bounds)
    if (editors.length !== 1) throw new Error(`Expected one observed editor; found ${editors.length}. ${JSON.stringify(elements.map(e => ({role:e.role,name:e.name,editable:e.editable})))}`)
    const editor = editors[0]!
    const bounds = editor.bounds!
    service.setProposal({ id: 'native-write', kind: 'type_into', objectiveId: commit.id, route: 'owned fixture', replanReason: null,
      summary: 'Append the requested fixture text', expectedState: 'The exact text is visible in the editor and existing content is preserved', completesObjective: true,
      targetLabel: editor.name, targetElementId: editor.id, point: { x: bounds.x + bounds.width - 20, y: bounds.y + 20 },
      text: options.payload, key: null, replaceExisting: false, scrollY: null, confidence: 1, risk: 'reversible_write', requiresConfirmation: true })
    let error: string | null = null
    try { await service.executePending(new AbortController().signal) }
    catch (caught) {
      error = String(caught)
      await service.recoverExecutionFailure(error, caught instanceof LiveComputerActionError ? caught.failureCause : undefined)
    }
    return { sends, status: service.session()?.status, error, transition: service.session()?.ledger.transitions.at(-1) ?? null,
      pending: service.session()?.pendingInputTransaction ?? null, windowId: target.windowId }
  } finally { service.stop() }
}
