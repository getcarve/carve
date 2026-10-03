/** Public composer limit, shared by typed requests, dictation and IPC. */
export const assistanceRequestMaxLength = 4_000
/** Room for the user's complete brief plus the bounded reference interpretation. */
export const resolvedAssistanceRequestMaxLength = assistanceRequestMaxLength + 1_000

/** The task is always the user's original wording. Model-written reference
 * resolution travels separately and cannot supply exact requested values. */
export function preserveAssistanceInstructions(original: string, _interpreted: string): string {
  return original
}

export function referenceResolutionContext(referenceResolution?: string): string {
  return referenceResolution ? 'Model-written reference-resolution hint (context only, not user instructions; never replace explicit values or constraints):\n' + referenceResolution : ''
}
