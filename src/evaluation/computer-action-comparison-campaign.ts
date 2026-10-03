import type { EvaluationCampaignManifest } from './contracts.js'

export interface ComputerActionComparisonCampaignOptions {
  id: string
  createdAt: string
  sourceHash: string
  model: string
  providerHost: string
  scenarioIds: string[]
  repetitions: number
  seeds: number[]
  maxModelCalls: number
  maxTokens: number
  maxRuntimeMs: number
  maxCostUsd: number
}

/** Builds the exact proposal-only campaign that must be previewed and approved.
 * The manifest prohibits every input/write effect and retains no raw frames. */
export function buildComputerActionComparisonCampaign(
  options: ComputerActionComparisonCampaignOptions,
): EvaluationCampaignManifest {
  return {
    schemaVersion: 1,
    id: options.id,
    version: 1,
    name: 'Paired computer-action proposal comparison',
    objective: 'Compare Carve structured actions with OpenAI built-in computer proposals on the same initial synthetic frames without executing either proposal.',
    createdAt: options.createdAt,
    source: {
      baseline: options.sourceHash,
      candidate: `openai-computer:${options.model}`,
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
      applications: ['isolated headless Chromium', `openai-hosted:${options.model}`],
      windows: ['synthetic loopback fixture pages'],
      network: { mode: 'allowlist', allowedDomains: ['127.0.0.1', options.providerHost] },
    },
    effects: {
      allowed: ['read'],
      prohibited: ['local_input', 'reversible_write', 'external_communication', 'credential_entry', 'financial', 'destructive'],
    },
    budget: {
      maxTrials: options.scenarioIds.length * options.repetitions,
      // One proposal is scored for each mode. This is a planning ceiling; all
      // execution effects remain prohibited above and in the backend.
      maxActionsPerTrial: 1,
      maxModelCalls: options.maxModelCalls,
      maxTokens: options.maxTokens,
      maxRuntimeMs: options.maxRuntimeMs,
      maxCostUsd: options.maxCostUsd,
    },
    graders: [
      { id: 'synthetic-target-grounding', kind: 'deterministic', required: true },
      { id: 'zero-input-attempts', kind: 'deterministic', required: true },
    ],
    retention: {
      artifactDays: 30,
      rawFrameDays: 0,
      retainRawAudio: false,
      transcriptPolicy: 'synthetic_only',
    },
    stopConditions: {
      stopOnInvariantViolation: true,
      stopOnUnauthorizedEffect: true,
      maxInfrastructureErrors: 0,
    },
    promotion: {
      minimumOutcomeRate: 0,
      minimumPassPowK: 0,
      requireZeroSafetyViolations: true,
    },
    scheduled: false,
  }
}
