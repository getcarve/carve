/** Translate unstructured legacy errors at the presentation boundary.
 * Original diagnostics remain on the task; never echo them into the capsule.
 * This copy makes no claim that work stopped or that nothing changed. */
export function capsuleFailureMessage(reason: string | null | undefined, fallback: string): string {
  const text = reason ?? ''
  if (/screen recording|screen capture permission/iu.test(text)) return 'Allow Screen Recording for Carve in System Settings, then try again.'
  if (/accessibility.*(?:denied|permission|required|grant)|(?:allow|enable).*accessibility/iu.test(text)) return 'Allow Accessibility for Carve in System Settings, then try again.'
  if (/microphone.*(?:denied|permission|blocked)/iu.test(text)) return 'Allow Microphone access for Carve in System Settings, then try again.'
  if (/insufficient[_\s-]*quota|no credits remaining|credit_balance_exhausted|billing quota/iu.test(text)) return 'Your AI account needs more credits. Check your AI account’s billing before trying again.'
  if (/invalid.?api.?key|unauthorized|authentication|\b401\b/iu.test(text)) return 'The AI connection needs attention. Check your connection settings in Carve, then try again.'
  if (/rate.?limit|too many requests|\b429\b/iu.test(text)) return 'The AI service is busy. Wait a little, then try again.'
  if (/public search returned no usable cited answer|public search returned no web tool calls/iu.test(text)) return 'The web search found nothing it could cite for that question. Add the event, site or date, or ask about the window you have open.'
  if (/timed?\s*out|timeout/iu.test(text)) return 'Carve didn’t get a response in time. Try again when you’re ready.'
  if (/fetch failed|network|\bconnect(?:ion)?\b|socket|ENOTFOUND|ECONN|EAI_AGAIN|DNS/iu.test(text)) return 'Carve couldn’t connect to the AI service. Check your connection, then try again.'
  if (/bounded plan|plan it can supervise|compiled plan|couldn’t plan|couldn’t work out the steps/iu.test(text)) return 'Carve couldn’t plan this task. Try describing the result you want in one or two short sentences.'
  return fallback
}

/** A task that could not start shows its own reason (Carve's copy) in the capsule instead of a generic "Couldn't
 * answer" (assess-0929 D01/D03). `STEWARD_TASK_START_FAILURE_SHOWN=off` restores the generic copy. */
export function taskStartFailureShownEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEWARD_TASK_START_FAILURE_SHOWN?.trim().toLowerCase() !== 'off'
}
