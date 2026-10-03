import { consumerSystemMessage } from '../../src/consumer-copy.js'
/** Electron prefixes rejected IPC handlers with transport internals. That
 * wrapper is useful in a developer console but turns an otherwise actionable
 * Carve domain error into "Error invoking remote method 'steward:command'" in
 * the product UI. Remove only the exact leading wrapper; retain the complete
 * underlying message and leave unrelated errors untouched. */
export function commandErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return consumerSystemMessage(message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, '').trim())
}
