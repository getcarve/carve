import { OpenAIComputerActionResponseError } from './providers/openai-hosted.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { requestTimingOf, type ModelResponse, type ModelResponseTelemetry } from './providers/types.js'

/** Fingerprint the files this process loads, including uncommitted/packaged code. */
export const runtimeBuildId = (() => {
  const hash = createHash('sha256')
  for (const file of ['app', 'live-computer-model-routing', 'providers/openai-hosted', 'model-telemetry', 'live-computer-task-state', 'task-requirements', 'planning-budget', 'navigation-authority', 'live-computer-planning', 'live-computer-intelligence', 'live-computer']) {
    for (const extension of ['js', 'ts']) {
      try {
        hash.update(file).update(readFileSync(new URL(`./${file}.${extension}`, import.meta.url)))
        break
      } catch { /* Source and packaged builds have different extensions. */ }
    }
  }
  return hash.digest('hex').slice(0, 20)
})()

export function modelResponseMetadata(response: Pick<ModelResponse, 'usage' | 'responseId' | 'telemetry'>) {
  return {
    ...response.usage,
    responseChainId: response.responseId,
    ...(response.telemetry ? { telemetry: response.telemetry } : {}),
  }
}

/** A failed attempt can still report billable usage. Absent categories stay unknown. */
export function modelFailureMetadata(error: unknown): { inputTokens: number | null; outputTokens: number | null; responseChainId?: string | null; telemetry?: Partial<ModelResponseTelemetry> } {
  const base: { inputTokens: number | null; outputTokens: number | null; telemetry?: Partial<ModelResponseTelemetry> } = error instanceof OpenAIComputerActionResponseError
    ? modelResponseMetadata({ usage: error.usage, responseId: error.responseId, ...(error.telemetry ? { telemetry: error.telemetry } : {}) })
    : { inputTokens: null, outputTokens: null }
  // Where the request was when it failed, so a stalled call can be told from a dead connection afterwards.
  const failure = requestTimingOf(error)
  return failure ? { ...base, telemetry: { ...(base.telemetry ?? {}), failure } } : base
}
