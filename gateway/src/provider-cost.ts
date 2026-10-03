/** Shared by the desktop and gateway. Returned-usage estimates are distinct
 * from quota reservations and invoices. Prices checked 2026-09-09, fast-mode multiplier 2026-09-17:
 * GPT-6 Sol/Luna prices checked 2026-09-23:
 * https://developers.openai.com/api/docs/models/gpt-6-sol
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 * https://developers.openai.com/api/docs/models/gpt-6-astra
 * https://developers.openai.com/api/docs/models/gpt-5.6-sol
 * https://developers.openai.com/api/docs/models/gpt-5.6-terra */
export const providerPriceVersion = 'openai-2026-09-23'
export const openAIPrices = {
  'gpt-6-sol': { input: 2, cached: 0.2, write: 2.5, output: 10 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
  'gpt-6-astra': { input: 10, cached: 1, write: 12.5, output: 50 },
  'gpt-5.6-sol': { input: 4, cached: 0.4, write: 5, output: 20 },
  'gpt-5.6-terra': { input: 2, cached: 0.2, write: 2.5, output: 12 },
} as const

export interface CostUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens?: number | null
  cacheWriteTokens?: number | null
  serviceTier?: string | null
  /** Actual billable search operations, not a guessed count from the answer. */
  searchCalls?: number | null
}
export interface ProviderCost {
  version: string
  status: 'estimated' | 'unknown'
  reason: 'missing_usage' | 'invalid_usage' | 'unsupported_model' | 'unsupported_tier' | 'expired_price' | null
  usd: number | null
  inputUsd: number | null
  outputUsd: number | null
  toolsUsd: number | null
}
export function estimateOpenAICost(model: string, usage: CostUsage, asOf = new Date().toISOString()): ProviderCost {
  const unknown = (reason: ProviderCost['reason']): ProviderCost => ({ version: providerPriceVersion, status: 'unknown', reason, usd: null, inputUsd: null, outputUsd: null, toolsUsd: null })
  const base = model.replace(/-\d{4}-\d{2}-\d{2}$/u, '') as keyof typeof openAIPrices
  const price = openAIPrices[base]
  if (!price) return unknown('unsupported_model')
  if (base === 'gpt-5.6-sol' && asOf.slice(0, 10) > '2026-11-21') return unknown('expired_price')
  const { inputTokens: input, outputTokens: output, cachedInputTokens: cached, cacheWriteTokens: write } = usage
  if ([input, output, cached, write].some(v => v === null || v === undefined) || usage.serviceTier == null || usage.searchCalls === null) return unknown('missing_usage')
  const search = usage.searchCalls ?? 0
  if ([input, output, cached, write, search].some(v => !Number.isSafeInteger(v) || v! < 0) || cached! + write! > input!) return unknown('invalid_usage')
  const tier = usage.serviceTier ?? 'default'
  // Fast mode is 2x the standard token price (pricing page, 2026-09-17; it was
  // named Priority processing until 30 July 2026 and the API still reports it
  // as `priority` on Sol and Terra, `fast` on Astra).
  const multiplier = tier === 'default' ? 1 : tier === 'fast' || tier === 'priority' ? 2 : null
  if (multiplier === null) return unknown('unsupported_tier')
  const long = input! > 272_000
  const inputUsd = ((input! - cached! - write!) * price.input + cached! * price.cached + write! * price.write) / 1e6 * multiplier * (long ? 2 : 1)
  const outputUsd = output! * price.output / 1e6 * multiplier * (long ? 1.5 : 1)
  const toolsUsd = search * 0.01
  return { version: providerPriceVersion, status: 'estimated', reason: null, usd: inputUsd + outputUsd + toolsUsd, inputUsd, outputUsd, toolsUsd }
}

export function usageCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function normalizeOpenAIProviderUsage(raw: unknown) {
  const u = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const inputs = u.input_tokens_details && typeof u.input_tokens_details === 'object' ? u.input_tokens_details as Record<string, unknown> : {}
  const outputs = u.output_tokens_details && typeof u.output_tokens_details === 'object' ? u.output_tokens_details as Record<string, unknown> : {}
  return { inputTokens: usageCount(u.input_tokens), outputTokens: usageCount(u.output_tokens), totalTokens: usageCount(u.total_tokens),
    cachedInputTokens: usageCount(inputs.cached_tokens), cacheWriteTokens: usageCount(inputs.cache_write_tokens), reasoningTokens: usageCount(outputs.reasoning_tokens) }
}
