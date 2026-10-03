/** One task-relative clock shared by acting, authorization review, and verification. */
export interface TaskTimeContext {
  referenceUtc: string
  referenceLocal: string
  referenceEpochSeconds: number
  timeZone: string
}

export function taskTimeContext(reference: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): TaskTimeContext {
  const date = new Date(reference)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid task reference time')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(date)
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)!.value
  const offset = part('timeZoneName').replace('GMT', '') || '+00:00'
  return Object.freeze({ referenceUtc: date.toISOString(), referenceLocal: `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${offset}`,
    referenceEpochSeconds: Math.floor(date.getTime() / 1000), timeZone })
}

export const taskTimeInstruction = 'timeContext is the controller-supplied reference instant and local timezone for the user request, shared across action and result checks. Anchor relative periods such as past N hours to this fixed instant, not to a later retry or a fresh model clock. Compute the exact interval and compare timestamps in one timezone; a calendar-date filter alone may be broader than the requested interval. A broader search is valid intermediate work if its results are then filtered to the requested interval. Interpret unzoned times in the selected desktop application using this local timezone unless the application, source, or user establishes a different zone; explicit source zones take precedence and must be converted. Do not invent timezone uncertainty solely because an ordinary local timestamp omits a zone, or treat this context as evidence that any matching records exist.'
