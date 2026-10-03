import { sha256, stableJson } from './util.js'
import type { UniversalComputerBatchAuthorizationInput } from './computer-use/universal.js'
import type { ComputerActionProposal } from './providers/types.js'
import { redactSecretPatterns } from './privacy.js'

function controlTarget(batch: UniversalComputerBatchAuthorizationInput, index: number): string {
  const label = batch.semanticBindings.find(binding => binding.actionIndex === index)?.label
  return label ? `“${label}”` : 'the selected control'
}

function describeAction(action: ComputerActionProposal, target: string, typed: (text: string) => string, keys: (keys: string[]) => string): string {
  switch (action.kind) {
    case 'click': return `Click ${target}`
    case 'double_click': return `Double-click ${target}`
    case 'type': return `Enter ${typed(action.text)} into ${target}`
    case 'keypress': return `Press ${keys(action.keys)} in ${target}`
    case 'scroll': return `Scroll ${Math.abs(action.deltaY) >= Math.abs(action.deltaX) ? action.deltaY >= 0 ? 'down' : 'up' : action.deltaX >= 0 ? 'right' : 'left'}`
    case 'drag': return `Drag ${target}`
    case 'move': return `Move the pointer to ${target}`
    case 'screenshot': return 'Check the window'
    case 'wait': return 'Wait for the window'
  }
}

/** Describes the actual held batch without copying typed data into audit storage. */
export function approvalActionSummary(batch: UniversalComputerBatchAuthorizationInput): string {
  return batch.actions.map((action, index) => describeAction(action, controlTarget(batch, index), text => `${Array.from(text).length} characters`, keys => keys.join(' + '))).join('\n')
}

const keyNames: Record<string, string> = { ENTER: 'Enter', RETURN: 'Enter', ESC: 'Esc', ESCAPE: 'Esc', TAB: 'Tab', SPACE: 'Space', CMD: '⌘', COMMAND: '⌘', META: '⌘', SHIFT: '⇧', ALT: '⌥', OPTION: '⌥', CTRL: '⌃', CONTROL: '⌃' }
function keyName(key: string): string {
  const compact = key.trim().toUpperCase()
  return keyNames[compact] ?? (compact.length > 1 ? compact[0] + compact.slice(1).toLowerCase() : compact)
}
function isEnter(keys: string[]): boolean {
  return keys.length === 1 && ['ENTER', 'RETURN'].includes(keys[0]!.trim().toUpperCase())
}

/** How much typed text a sentence can quote inline before the text moves to its own line. */
const inlineQuoteLimit = 80

/** Sentences for the person deciding, composed from the held batch with no model call. Unlike
 * `approvalActionSummary`, these quote the text Carve is about to type: they live in memory only for the life
 * of the checkpoint and are never written to the checkpoint record. Secret-looking text is redacted first.
 * A focus click, the typing and an Enter on the same control read as one sentence; long or multi-line text
 * follows its sentence on its own line so the card can fold it without hiding the control it goes into. */
export function approvalActionSentences(batch: UniversalComputerBatchAuthorizationInput): string[] {
  const label = (index: number) => batch.semanticBindings.find(binding => binding.actionIndex === index)?.label ?? null
  const lines: string[] = []
  for (let index = 0; index < batch.actions.length; index++) {
    const action = batch.actions[index]!
    const target = controlTarget(batch, index)
    if (action.kind !== 'type') { lines.push(describeAction(action, target, () => '', keys => keys.map(keyName).join(' + '))); continue }
    // A click on the same labelled control right before typing is the focus click, not a separate decision.
    if (batch.actions[index - 1]?.kind === 'click' && label(index - 1) !== null && label(index - 1) === label(index)) lines.pop()
    const next = batch.actions[index + 1]
    const submits = next?.kind === 'keypress' && isEnter(next.keys) && (label(index + 1) === null || label(index + 1) === label(index))
    const text = redactSecretPatterns(action.text).value
    const inline = text.length <= inlineQuoteLimit && !text.includes('\n')
    lines.push(`Enter ${inline ? `“${text}”` : 'the text below'} into ${target}${submits ? ', then press Enter' : ''}`)
    if (!inline) lines.push(text)
    if (submits) index++
  }
  return lines
}

/** The primary review describes a user-visible change, not a provider batch. */
export function approvalChangeTitle(batch: UniversalComputerBatchAuthorizationInput): string {
  const index = batch.effects.findIndex(effect => !['read_only', 'safe_local'].includes(effect.class))
  const action = batch.actions[index]
  const label = batch.semanticBindings[index]?.label
  if (batch.effects[index]?.class === 'unclassified_control') return label ? `Check before clicking “${label}”` : 'Check this control before continuing'
  if (action?.kind === 'type') return label ? `Update “${label}”` : 'Review this text change'
  if (label) return `Review the change to “${label}”`
  return 'Review the next change'
}

export interface UniversalPlanReview {
  hash: string
  steps: string[]
  checkpointId: string
  revisionFeedback?: string
}
export const approvalPlanSchema = {
  type: 'object', additionalProperties: false, required: ['steps'],
  properties: { steps: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } } },
}
export function parseApprovalPlan(text: string): string[] {
  const parsed = JSON.parse(text) as { steps?: unknown }
  if (!Array.isArray(parsed.steps) || !parsed.steps.length || parsed.steps.length > 5 || parsed.steps.some(step => typeof step !== 'string' || !step.trim() || step.length > 300)) throw new Error('Carve could not prepare a concise plan. Try again.')
  return parsed.steps.map(step => (step as string).trim())
}
export function approvalPlanHash(runHash: string, policyHash: string, targetHash: string, steps: string[]): string {
  return sha256(stableJson({ runHash, policyHash, targetHash, steps }))
}
