import { TaskPreparationError } from '../task-preparation-error.js'
import { CloudError, cloudAllowanceCodes, cloudErrorMessage } from './client.js'

/** Keep actionable cloud failures intact through route planning and the capsule. */
export function cloudTaskPreparationFailure(error: unknown): TaskPreparationError | null {
  if (!(error instanceof CloudError)) return null
  const retryable = error.status === 0 || error.status === 429
    || error.code === 'upstream_timeout' || error.code === 'upstream_unreachable'
  return new TaskPreparationError(error.message, cloudErrorMessage(error), error.code,
    cloudAllowanceCodes.has(error.code) ? 'allowance' : 'cloud', retryable)
}
