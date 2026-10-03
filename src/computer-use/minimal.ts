import type { ComputerUseSessionProvider } from '../providers/types.js'
import type { UniversalComputerUseBackend } from './universal.js'
import { validateComputerActionBatch } from './batch.js'

/** Experimental direct loop. No task classifier, goal graph, semantic action
 * compiler, critic, completion verifier, or automatic retry. Callers own the
 * environment boundary and provider spend governor. Not a production mode. */
export async function runMinimalComputerUse(options: {
  provider: ComputerUseSessionProvider
  backend: Pick<UniversalComputerUseBackend, 'capture' | 'execute'>
  prompt: string
  system: string
  model: string
  signal: AbortSignal
  maxTurns: number
  maxActions: number
  onEvent?: (event: Record<string, unknown>) => void
}) {
  if (![options.maxTurns, options.maxActions].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid minimal-loop limits')
  const { provider, backend, signal } = options
  let actions = 0
  let turns = 0
  let failures = 0
  let frame = await backend.capture(signal)
  signal.throwIfAborted()
  let turn = await provider.startComputerUseSession({ system: options.system, prompt: options.prompt, model: options.model,
    maxOutputTokens: 2048, reasoningEffort: 'medium', signal })
  while (true) {
    signal.throwIfAborted()
    turns++
    options.onEvent?.({ type: 'turn', turn: turns, kind: turn.kind, usage: turn.usage, responseId: turn.session.responseId })
    if (turn.kind === 'safety_check') return { status: 'safety_check', text: null, turns, actions, failures }
    if (turn.kind === 'terminal') return { status: 'completed', text: turn.terminalText, turns, actions, failures }
    if (turns >= options.maxTurns) return { status: 'turn_limit', text: null, turns, actions, failures }
    validateComputerActionBatch(turn.actions, frame)
    const inputs = turn.actions.filter(a => a.kind !== 'screenshot' && a.kind !== 'wait').length
    if (actions + inputs > options.maxActions) return { status: 'action_limit', text: null, turns, actions, failures }
    let receipt = 'The requested batch was executed. Use the screenshot to assess its effects.'
    for (let index = 0; index < turn.actions.length; index++) {
      signal.throwIfAborted()
      const action = turn.actions[index]!
      try {
        if (action.kind !== 'wait' && action.kind !== 'screenshot') actions++
        await backend.execute(action, signal)
        options.onEvent?.({ type: 'action', action, index, status: 'executed' })
      } catch (error) {
        signal.throwIfAborted()
        failures++
        receipt = `Action ${index + 1} failed: ${String(error)}. Earlier actions may have taken effect. The failed action may have partially taken effect. Remaining actions were not attempted. Inspect the screenshot before deciding what to do; no input was automatically retried.`
        options.onEvent?.({ type: 'action', action, index, status: 'failed', error: String(error) })
        break
      }
    }
    frame = await backend.capture(signal)
    signal.throwIfAborted()
    turn = await provider.continueComputerUseSession({ session: turn.session, screenshot: frame,
      instructions: options.system + '\nActual execution receipt: ' + receipt,
      maxOutputTokens: 2048, reasoningEffort: 'medium', signal })
  }
}
