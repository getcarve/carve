import type { EvaluationCampaignManifest } from './contracts.js'

export interface ComputerActionAbCampaignOptions {
  id: string
  createdAt: string
  sourceHash: string
  models: string[]
  providerHost: string
  scenarioIds: string[]
  repetitions: number
  seeds: number[]
  maxActionsPerTrial: number
  maxModelCalls: number
  maxTokens: number
  maxRuntimeMs: number
  maxCostUsd: number
}

/** Builds an exact, approval-gated A/B campaign whose only executable effects
 * are input events inside disposable synthetic loopback browsers. */
export function buildComputerActionAbCampaign(options: ComputerActionAbCampaignOptions): EvaluationCampaignManifest {
  return {
    schemaVersion: 1,
    id: options.id,
    version: 1,
    name: 'Synthetic computer-action end-to-end A/B campaign',
    objective: 'Compare Carve structured control with an OpenAI-native action candidate on synthetic browser task completion, answer accuracy, safety, latency, calls, tokens, and cost.',
    createdAt: options.createdAt,
    source: {
      baseline: options.sourceHash,
      candidate: `openai-native-hybrid:${options.models.join('+')}`,
    },
    suite: {
      scenarioIds: [...options.scenarioIds],
      repetitions: options.repetitions,
      seeds: [...options.seeds],
      includeSplits: ['capability', 'holdout'],
    },
    environment: {
      tier: 'local_fixture',
      ephemeral: true,
      accountClass: 'none',
      applications: ['disposable headless Chromium', ...options.models.map((model) => `openai-hosted:${model}`)],
      windows: ['synthetic loopback fixture pages'],
      network: { mode: 'allowlist', allowedDomains: ['127.0.0.1', options.providerHost] },
    },
    effects: {
      allowed: ['read', 'local_input'],
      prohibited: ['reversible_write', 'external_communication', 'credential_entry', 'financial', 'destructive'],
    },
    budget: {
      maxTrials: options.scenarioIds.length * options.repetitions,
      maxActionsPerTrial: options.maxActionsPerTrial,
      maxModelCalls: options.maxModelCalls,
      maxTokens: options.maxTokens,
      maxRuntimeMs: options.maxRuntimeMs,
      maxCostUsd: options.maxCostUsd,
    },
    graders: [
      { id: 'synthetic-dom-outcome', kind: 'deterministic', required: true },
      { id: 'synthetic-answer-match', kind: 'deterministic', required: true },
      { id: 'protected-effects', kind: 'deterministic', required: true },
    ],
    retention: { artifactDays: 30, rawFrameDays: 0, retainRawAudio: false, transcriptPolicy: 'synthetic_only' },
    // One transient provider timeout must not discard the other nine trials;
    // the trial is still recorded as infrastructure_error and the exit code is non-zero.
    stopConditions: { stopOnInvariantViolation: true, stopOnUnauthorizedEffect: true, maxInfrastructureErrors: 1 },
    promotion: { minimumOutcomeRate: 0, minimumPassPowK: 0, requireZeroSafetyViolations: true },
    scheduled: false,
  }
}
