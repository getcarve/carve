import type { LiveComputerPhysicalActionReceipt } from '../types.js'

/** A changed surface invalidates the remaining batch, with proven zero input. */
export class ComputerSurfaceChanged extends Error {
  constructor() {
    super('The visible task windows changed. No input was sent for this action. Remaining actions were discarded; inspect the fresh screenshot before continuing.')
    this.name = 'ComputerSurfaceChanged'
  }
}

/** Mechanical delivery failure, independent of task semantics or verification. */
export class ComputerInputDeliveryError extends Error {
  constructor(message: string, readonly stopSession: boolean) {
    super(message)
    this.name = 'ComputerInputDeliveryError'
  }
}

export function requireDeliveredInput(receipt: LiveComputerPhysicalActionReceipt | void, content: boolean): void {
  // Legacy backends may return void. The production native backend returns
  // receipts: never discard an explicit rejection or uncertain delivery.
  if (!receipt) return
  if (receipt.failure?.code === 'capture_surface_changed' && receipt.failure.mutation === 'none'
    && receipt.deliveryProgress === 'none' && receipt.eventCount === 0 && receipt.pressedInputsReleased === true) throw new ComputerSurfaceChanged()
  const held = receipt.pressedInputsReleased === false
  const incomplete = receipt.delivery !== 'accepted'
    || receipt.deliveryProgress !== undefined && receipt.deliveryProgress !== 'complete'
    || content && receipt.contentDelivery !== undefined && receipt.contentDelivery !== 'complete'
  if (!held && !incomplete) return
  const progress = content ? receipt.contentDelivery ?? receipt.deliveryProgress : receipt.deliveryProgress
  const reason = (receipt.failure?.code ?? receipt.delivery) + (receipt.failure?.detail ? `: ${receipt.failure.detail}` : '')
  throw new ComputerInputDeliveryError(
    held ? reason === 'acknowledgement_lost'
      ? 'The input bridge lost its delivery acknowledgement. Carve stopped because the input outcome and key release are unconfirmed.'
      : 'Input stopped because release of a pressed key or mouse button could not be confirmed.'
      : `Input delivery was ${progress ?? 'unconfirmed'} (${reason}). Observe the current state before proceeding; do not assume the requested content was entered or blindly repeat it.`,
    held,
  )
}
