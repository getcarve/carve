import type { ComputerActionProposal, ComputerActionScreenshot } from '../providers/types.js'

/** A local proposal failed mechanical validation before any of its input ran. */
export class ComputerActionValidationError extends Error {
  override name = 'ComputerActionValidationError'
}

/** Also recognizes persisted failures from builds predating the typed error. */
export function isComputerActionValidationFailure(reason: string | null): boolean {
  return /^Universal computer-use (?:action \d+\b|batches must contain|frame dimensions are invalid)/u.test(reason ?? '')
}

export interface ComputerActionBatchLimits {
  maxActions: number
  maxTextCharacters: number
  maxKeyCount: number
  maxDragPoints: number
  maxScrollMagnitude: number
}

export const defaultComputerActionBatchLimits: ComputerActionBatchLimits = {
  maxActions: 32,
  maxTextCharacters: 20_000,
  maxKeyCount: 20,
  maxDragPoints: 100,
  maxScrollMagnitude: 100_000,
}

/**
 * Validate only mechanical invariants. Universal mode intentionally does not
 * recognize application-specific transactions such as click → type → Enter.
 */
export function validateComputerActionBatch(
  actions: ComputerActionProposal[],
  frame: Pick<ComputerActionScreenshot, 'width' | 'height'>,
  limits: ComputerActionBatchLimits = defaultComputerActionBatchLimits,
): void {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1) {
    throw new ComputerActionValidationError('Universal computer-use frame dimensions are invalid')
  }
  if (actions.length < 1 || actions.length > limits.maxActions) {
    throw new ComputerActionValidationError(`Universal computer-use batches must contain 1 to ${limits.maxActions} actions`)
  }
  for (let index = 0; index < actions.length; index += 1) {
    validateAction(actions[index]!, frame, limits, index)
  }
}

export function describeComputerAction(action: ComputerActionProposal): string {
  switch (action.kind) {
    case 'click':
    case 'double_click':
      return `${action.kind}(${Math.round(action.point.x)},${Math.round(action.point.y)},${action.button})`
    case 'move':
      return `move(${Math.round(action.point.x)},${Math.round(action.point.y)})`
    case 'scroll':
      return `scroll(${Math.round(action.deltaX)},${Math.round(action.deltaY)})`
    case 'type':
      return `type(${action.text.length} characters)`
    case 'keypress':
      return `keypress(${action.keys.join('+').slice(0, 160)})`
    case 'drag':
      return `drag(${action.path.length} points)`
    case 'wait':
      return 'wait'
    case 'screenshot':
      return 'screenshot'
  }
}

function validateAction(
  action: ComputerActionProposal,
  frame: Pick<ComputerActionScreenshot, 'width' | 'height'>,
  limits: ComputerActionBatchLimits,
  index: number,
): void {
  const label = `Universal computer-use action ${index + 1}`
  switch (action.kind) {
    case 'click':
    case 'double_click':
      validatePoint(action.point, frame, label)
      validateModifiers(action.modifiers, label)
      return
    case 'move':
      validatePoint(action.point, frame, label)
      validateModifiers(action.modifiers, label)
      return
    case 'scroll':
      validatePoint(action.point, frame, label)
      validateModifiers(action.modifiers, label)
      if (!Number.isFinite(action.deltaX) || !Number.isFinite(action.deltaY)
        || Math.abs(action.deltaX) > limits.maxScrollMagnitude
        || Math.abs(action.deltaY) > limits.maxScrollMagnitude) {
        throw new ComputerActionValidationError(`${label} scroll values are invalid`)
      }
      return
    case 'type':
      if (action.text.length > limits.maxTextCharacters) throw new ComputerActionValidationError(`${label} text exceeds the ${limits.maxTextCharacters}-character limit`)
      return
    case 'keypress':
      if (action.keys.length < 1 || action.keys.length > limits.maxKeyCount
        || action.keys.some((key) => !key || key.length > 50)) {
        throw new ComputerActionValidationError(`${label} contains an invalid key sequence`)
      }
      return
    case 'drag':
      if (action.path.length < 2 || action.path.length > limits.maxDragPoints) throw new ComputerActionValidationError(`${label} drag path is invalid`)
      action.path.forEach((point) => { validatePoint(point, frame, label) })
      validateModifiers(action.modifiers, label)
      return
    case 'wait':
    case 'screenshot':
      return
  }
}

function validatePoint(
  point: { x: number; y: number },
  frame: Pick<ComputerActionScreenshot, 'width' | 'height'>,
  label: string,
): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.y < 0 || point.x >= frame.width || point.y >= frame.height) {
    throw new ComputerActionValidationError(`${label} contains a point outside the current frame`)
  }
}

function validateModifiers(modifiers: string[], label: string): void {
  if (modifiers.length > 4 || new Set(modifiers).size !== modifiers.length) throw new ComputerActionValidationError(`${label} contains invalid modifier keys`)
}
