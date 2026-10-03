/** Evidence from the native creation operation, never from a model or window title. */
export interface FreshDocumentReceipt {
  version: 1
  windowId: number
  inventoryScope: 'all'
  excludedWindowIds: number[]
  creationMethod: 'explicit_new_document'
  blankBodyVerified: true
}

export function verifiedFreshTextDocument(value: unknown, windowId: number): FreshDocumentReceipt {
  const evidence = value as Partial<FreshDocumentReceipt> | null
  if (!Number.isInteger(windowId) || windowId <= 0 || !evidence || evidence.version !== 1 || evidence.windowId !== windowId || evidence.inventoryScope !== 'all'
      || evidence.creationMethod !== 'explicit_new_document' || evidence.blankBodyVerified !== true
      || !Array.isArray(evidence.excludedWindowIds) || evidence.excludedWindowIds.length > 100_000
      || evidence.excludedWindowIds.some(id => !Number.isInteger(id) || id <= 0)
      || evidence.excludedWindowIds.includes(windowId)) {
    throw new Error('A new, empty TextEdit document could not be verified. No document was authorized for editing.')
  }
  return structuredClone(evidence as FreshDocumentReceipt)
}
