import type { LiveComputerAction, LiveComputerDeliveryFailure } from './types.js'
import type { LiveComputerNativeDelivery } from './live-computer.js'

/** Shared chunk transport for fields, artifacts and compiled sequences.
 * Bookkeeping counts content separately from focus and navigation gestures. */
export async function deliverBoundedInput(
  steps: LiveComputerAction[],
  send: (action: LiveComputerAction) => LiveComputerNativeDelivery | Promise<LiveComputerNativeDelivery>,
  signal?: AbortSignal,
): Promise<LiveComputerNativeDelivery> {
  const units = steps.flatMap(step => {
    if (step.kind !== 'type' || !step.text || (step.textDelivery === 'accessibility_value' || step.textDelivery === 'clipboard_table' || step.textDelivery === 'clipboard_text' || step.textDelivery === 'unicode_graphemes' && (step.text.length > 1_000 || /[\r\n]/u.test(step.text)))) return [step]
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(step.text)].map(segment => segment.segment)
    return Array.from({ length: Math.ceil(graphemes.length / 24) }, (_, index) => ({ ...step, text: graphemes.slice(index * 24, (index + 1) * 24).join('') }))
  })
  const totalContentUnits = units.filter(unit => unit.kind === 'type').length
  let deliveredUnits = 0
  let deliveredContentUnits = 0
  let eventCount = 0
  const contentProgress = (): NonNullable<LiveComputerNativeDelivery['contentDelivery']> => deliveredContentUnits === 0
    ? 'none' : deliveredContentUnits === totalContentUnits ? 'complete' : 'partial'
  for (const unit of units) {
    if (signal?.aborted) return { deliveryProgress: deliveredUnits ? 'partial' : 'none', contentDelivery: contentProgress(), pressedInputsReleased: true, eventCount }
    let delivery: LiveComputerNativeDelivery
    try { delivery = await send(unit) }
    catch {
      // A lost acknowledgement is not a rejection. The native call may have
      // mutated content. AX assignment synthesizes no held keys; for physical
      // input, an exception provides no release proof and execution must stop.
      return { deliveryProgress: 'partial', contentDelivery: unit.kind === 'type' ? 'unknown' : contentProgress(),
        pressedInputsReleased: unit.textDelivery === 'accessibility_value', eventCount,
        failure: { code: 'acknowledgement_lost', stage: 'transport', method: unit.textDelivery === 'clipboard_text' ? 'unicode_graphemes' : unit.textDelivery ?? 'input', mutation: 'possible' } }
    }
    eventCount += delivery.eventCount
    if (delivery.deliveryProgress !== 'complete' || !delivery.pressedInputsReleased) {
      return {
        deliveryProgress: deliveredUnits === 0 && delivery.deliveryProgress === 'none' ? 'none' : 'partial',
        contentDelivery: unit.kind === 'type'
          ? delivery.contentDelivery === 'unknown' ? 'unknown'
            : delivery.contentDelivery === 'none' || delivery.deliveryProgress === 'none' ? contentProgress() : 'partial'
          : contentProgress(),
        pressedInputsReleased: delivery.pressedInputsReleased, eventCount,
        ...(delivery.failure ? { failure: delivery.failure } : {}),
      }
    }
    deliveredUnits++
    if (unit.kind === 'type') deliveredContentUnits++
    // Permit Stop to land between chunks; every next send revalidates the
    // selected window and the known receiver in the native bridge.
    if (deliveredUnits < units.length) await new Promise<void>(resolve => setImmediate(resolve))
  }
  return { deliveryProgress: 'complete', contentDelivery: contentProgress(), pressedInputsReleased: true, eventCount }
}

/** This decoder is shared with Electron and tested without loading Electron.
 * Missing or malformed receipts never manufacture successful delivery. */
export function parseNativeDelivery(raw: string | undefined): LiveComputerNativeDelivery {
  if (raw === undefined) throw new Error('The native input bridge returned no delivery receipt')
  const parsed = JSON.parse(raw) as Partial<LiveComputerNativeDelivery> | null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !['none', 'partial', 'complete'].includes(parsed.deliveryProgress ?? '')
    || typeof parsed.pressedInputsReleased !== 'boolean'
    || !Number.isInteger(parsed.eventCount) || (parsed.eventCount ?? -1) < 0 || (parsed.eventCount ?? 0) > 10_000
    || (parsed.contentDelivery !== undefined && !['none', 'partial', 'complete', 'unknown'].includes(parsed.contentDelivery))
    || (parsed.verifiedEffect !== undefined && parsed.verifiedEffect !== null
      && !['text_document.plain_text', 'text_document.saved_new_file'].includes(parsed.verifiedEffect))
    || (parsed.operationTransaction !== undefined && parsed.operationTransaction !== null
      && (typeof parsed.operationTransaction !== 'object' || Array.isArray(parsed.operationTransaction)))) {
    throw new Error('The native input bridge returned an invalid delivery receipt')
  }
  let failure: LiveComputerDeliveryFailure | undefined
  if (parsed.failure !== undefined) {
    const f = parsed.failure
    if (!f || typeof f !== 'object' || typeof f.code !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(f.code)
      || !['preflight', 'focus', 'assignment', 'readback', 'transport'].includes(f.stage)
      || !['accessibility_value', 'keycodes', 'unicode_graphemes', 'clipboard_table', 'input'].includes(f.method)
      || !['none', 'possible'].includes(f.mutation)
      || (f.nativeCode !== undefined && !Number.isSafeInteger(f.nativeCode))
      || parsed.deliveryProgress === 'complete'
      || (f.mutation === 'possible' && parsed.contentDelivery === 'none')) throw new Error('The native input bridge returned an invalid failure receipt')
    failure = { code: f.code, stage: f.stage, method: f.method, mutation: f.mutation,
      ...(f.nativeCode === undefined ? {} : { nativeCode: f.nativeCode }) }
  }
  return { deliveryProgress: parsed.deliveryProgress!, pressedInputsReleased: parsed.pressedInputsReleased,
    eventCount: parsed.eventCount!, ...(parsed.contentDelivery ? { contentDelivery: parsed.contentDelivery } : {}),
    ...(failure ? { failure } : {}), verifiedEffect: parsed.verifiedEffect ?? null, operationTransaction: parsed.operationTransaction ?? null }
}
