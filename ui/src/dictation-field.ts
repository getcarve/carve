export interface DictationFinishResult {
  /** Complete controlled-field value after this dictation session. Callers
   * submit this value directly; it is never an appendable transcript delta. */
  fieldValue: string | null
  /** Recognized speech for non-field consumers and privacy-safe metadata. */
  transcript: string | null
}

/** Compose one dictation session from its immutable starting value and the
 * latest recognized speech. Recomputing from the same base makes interim and
 * final updates idempotent instead of cumulatively appending them. */
export function composeDictationField(base: string, spoken: string): string {
  const trimmedBase = base.trim()
  const trimmedSpoken = spoken.trim()
  if (!trimmedBase) return trimmedSpoken
  if (!trimmedSpoken) return trimmedBase
  return `${trimmedBase} ${trimmedSpoken}`
}

/** Resolve the value a composer should submit after finishing dictation. A
 * field-backed result is already complete and therefore replaces—rather than
 * extends—the render-time value. */
export function dictatedSubmissionValue(current: string, result: DictationFinishResult | null): string {
  return (result?.fieldValue ?? current).trim()
}
