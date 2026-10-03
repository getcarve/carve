// Pure (no Node imports): the capsule copy in the console UI reads this too.
const processEnv = (): Record<string, string | undefined> => typeof process === 'undefined' ? {} : process.env

/** macOS refused Carve a screen capture: ScreenCaptureKit's -3801 ("The user declined TCCs for application, window,
 * display capture") or Carve's own Screen Recording permission check. assess-0929 tip C02: mid-run, right after a
 * helper restart, the raw SCStreamErrorDomain text reached the capsule as "OpenAI interrupted". */
export function screenCaptureRefused(text: string | null | undefined): boolean {
  return /SCStreamErrorDomain|declined TCCs?\b|Code=-3801\b|Screen Recording permission/iu.test(text ?? '')
}

/** The capsule names a refused capture as a capture problem with the step that fixes it, never a model failure.
 * Off: STEWARD_CAPTURE_REFUSAL_LABEL=off. */
export const captureRefusalLabelEnabled = (env: Record<string, string | undefined> = processEnv()) => env.STEWARD_CAPTURE_REFUSAL_LABEL?.trim().toLowerCase() !== 'off'

/** A refused capture is retried once, after a short pause, before the run ends on it. Off: STEWARD_CAPTURE_REFUSAL_RETRY=off. */
export const captureRefusalRetryEnabled = (env: Record<string, string | undefined> = processEnv()) => env.STEWARD_CAPTURE_REFUSAL_RETRY?.trim().toLowerCase() !== 'off'
