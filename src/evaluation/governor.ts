import type { EvaluationApproval, EvaluationCampaignManifest, EvaluationEffect } from './contracts.js'
import { evaluationManifestHash } from './contracts.js'

export interface EvaluationPolicyFinding {
  code: string
  message: string
}

const effects: EvaluationEffect[] = [
  'none', 'read', 'local_input', 'reversible_write', 'external_communication', 'credential_entry', 'financial', 'destructive',
]
const alwaysProhibited = new Set<EvaluationEffect>(['credential_entry', 'financial', 'destructive'])
const environmentTiers = new Set(['pure', 'local_fixture', 'shadow_replay', 'disposable_staging', 'controlled_canary', 'personal_production'])
const accountClasses = new Set(['none', 'synthetic', 'disposable', 'personal'])
const networkModes = new Set(['deny', 'loopback', 'allowlist'])
const scenarioSplits = new Set(['regression', 'capability', 'holdout'])
const graderKinds = new Set(['deterministic', 'model', 'human'])

export class EvaluationGovernor {
  inspect(manifest: EvaluationCampaignManifest): EvaluationPolicyFinding[] {
    const findings: EvaluationPolicyFinding[] = []
    const fail = (code: string, message: string) => findings.push({ code, message })

    if (manifest.schemaVersion !== 1) fail('schema', 'Only evaluation manifest schema version 1 is supported')
    if (!manifest.id.trim() || !manifest.name.trim() || !manifest.objective.trim()) fail('identity', 'Campaign identity and objective are required')
    if (!manifest.source.baseline.trim() || (manifest.source.candidate !== null && !manifest.source.candidate.trim())) fail('source', 'Campaign source versions must be non-empty exact identities')
    if (manifest.version < 1 || !Number.isInteger(manifest.version)) fail('version', 'Campaign version must be a positive integer')
    if (manifest.suite.scenarioIds.length === 0) fail('scenarios', 'At least one scenario is required')
    if (new Set(manifest.suite.scenarioIds).size !== manifest.suite.scenarioIds.length) fail('scenarios.duplicate', 'Scenario ids must be unique')
    if (manifest.suite.repetitions < 1 || !Number.isInteger(manifest.suite.repetitions)) fail('repetitions', 'Repetitions must be a positive integer')
    if (manifest.suite.seeds.length !== manifest.suite.repetitions) fail('seeds', 'One deterministic seed is required for every repetition')
    if (new Set(manifest.suite.seeds).size !== manifest.suite.seeds.length) fail('seeds.duplicate', 'Repetition seeds must be unique')
    if (manifest.suite.seeds.some((seed) => !Number.isInteger(seed))) fail('seeds.integer', 'Repetition seeds must be integers')
    if (manifest.suite.includeSplits.length === 0 || manifest.suite.includeSplits.some((split) => !scenarioSplits.has(split))) fail('splits', 'Campaign dataset splits must use the supported controlled vocabulary')

    const plannedTrials = manifest.suite.scenarioIds.length * manifest.suite.repetitions
    if (plannedTrials > manifest.budget.maxTrials) fail('budget.trials', `The ${plannedTrials}-trial plan exceeds the ${manifest.budget.maxTrials}-trial budget`)
    for (const [name, value] of Object.entries(manifest.budget)) {
      if (!Number.isFinite(value) || value < 0) fail(`budget.${name}`, `${name} must be a finite non-negative number`)
    }
    if (manifest.budget.maxActionsPerTrial < 1) fail('budget.actions', 'At least one action per trial is required')
    if (manifest.budget.maxRuntimeMs < 1) fail('budget.runtime', 'A positive runtime budget is required')
    for (const name of ['maxTrials', 'maxActionsPerTrial', 'maxModelCalls', 'maxTokens', 'maxRuntimeMs'] as const) {
      if (!Number.isInteger(manifest.budget[name])) fail(`budget.${name}.integer`, `${name} must be a whole number`)
    }

    if (!environmentTiers.has(manifest.environment.tier)) fail('environment.tier', 'The environment tier is unknown')
    if (!accountClasses.has(manifest.environment.accountClass)) fail('account.class', 'The account class is unknown')
    if (!networkModes.has(manifest.environment.network.mode)) fail('network.mode', 'The network mode is unknown')
    if (!manifest.environment.ephemeral && !['shadow_replay'].includes(manifest.environment.tier)) {
      fail('environment.ephemeral', 'Executable evaluation environments must be ephemeral')
    }
    if (manifest.environment.tier === 'personal_production') fail('environment.personal', 'Foundry never automates a personal production environment')
    if (manifest.environment.accountClass === 'personal') fail('account.personal', 'Personal accounts are outside Foundry automation')
    if (manifest.environment.tier === 'pure' && manifest.environment.accountClass !== 'none') fail('account.pure', 'Pure simulations cannot use accounts')
    if (manifest.environment.tier === 'controlled_canary' && manifest.scheduled) fail('canary.scheduled', 'Controlled canaries require a fresh one-off approval and cannot be scheduled')
    if (manifest.environment.network.mode === 'deny' && manifest.environment.network.allowedDomains.length > 0) fail('network.deny', 'A denied network cannot declare allowed domains')
    if (manifest.environment.network.mode === 'allowlist' && manifest.environment.network.allowedDomains.length === 0) fail('network.allowlist', 'An allowlisted network requires at least one exact domain')
    if (manifest.environment.network.allowedDomains.some((domain) => domain.includes('*') || domain.includes('/') || domain.trim() !== domain || !domain.includes('.'))) {
      fail('network.domain', 'Allowed domains must be exact hostnames without wildcards, paths, or surrounding whitespace')
    }

    const allowed = new Set(manifest.effects.allowed)
    const prohibited = new Set(manifest.effects.prohibited)
    if (manifest.effects.allowed.some((effect) => !effects.includes(effect)) || manifest.effects.prohibited.some((effect) => !effects.includes(effect))) fail('effects.unknown', 'Effect declarations must use the supported controlled vocabulary')
    for (const effect of effects) {
      if (allowed.has(effect) && prohibited.has(effect)) fail('effects.conflict', `${effect} cannot be both allowed and prohibited`)
    }
    for (const effect of alwaysProhibited) {
      if (!prohibited.has(effect) || allowed.has(effect)) fail('effects.protected', `${effect} must remain prohibited in Foundry`) 
    }
    if (manifest.environment.tier !== 'disposable_staging' && allowed.has('external_communication')) {
      fail('effects.communication', 'External communication is allowed only in disposable staging')
    }
    if (manifest.environment.tier === 'pure' && [...allowed].some((effect) => effect !== 'none')) {
      fail('effects.pure', 'Pure simulations may allow only the none effect')
    }

    if (manifest.graders.length === 0) fail('graders', 'At least one grader is required')
    if (new Set(manifest.graders.map((grader) => grader.id)).size !== manifest.graders.length) fail('graders.duplicate', 'Grader ids must be unique')
    if (manifest.graders.some((grader) => !grader.id.trim() || !graderKinds.has(grader.kind))) fail('graders.schema', 'Graders require an id and supported kind')
    if (!manifest.graders.some((grader) => grader.required && grader.kind === 'deterministic')) {
      fail('graders.deterministic', 'At least one deterministic grader must be required')
    }
    if (manifest.retention.retainRawAudio) fail('retention.audio', 'Foundry never retains raw dictation audio')
    if (!Number.isInteger(manifest.retention.artifactDays) || manifest.retention.artifactDays < 1) fail('retention.artifacts', 'Campaign artifacts need a positive whole-day retention period')
    if (!Number.isInteger(manifest.retention.rawFrameDays) || manifest.retention.rawFrameDays < 0) fail('retention.frames', 'Raw-frame retention must be a non-negative whole number of days')
    if (manifest.retention.rawFrameDays > manifest.retention.artifactDays) fail('retention.frames', 'Raw frames cannot outlive campaign artifacts')
    if (!['none', 'synthetic_only', 'redacted'].includes(manifest.retention.transcriptPolicy)) fail('retention.transcript', 'Transcript retention uses an unknown policy')
    if (!Number.isInteger(manifest.stopConditions.maxInfrastructureErrors) || manifest.stopConditions.maxInfrastructureErrors < 0) fail('stop.infrastructure', 'Infrastructure error allowance must be a non-negative whole number')
    if (!Number.isFinite(manifest.promotion.minimumOutcomeRate) || manifest.promotion.minimumOutcomeRate < 0 || manifest.promotion.minimumOutcomeRate > 1) fail('promotion.outcome', 'Minimum outcome rate must be between zero and one')
    if (!Number.isFinite(manifest.promotion.minimumPassPowK) || manifest.promotion.minimumPassPowK < 0 || manifest.promotion.minimumPassPowK > 1) fail('promotion.consistency', 'Minimum pass^k must be between zero and one')
    return findings
  }

  authorize(manifest: EvaluationCampaignManifest, approval: EvaluationApproval): void {
    const findings = this.inspect(manifest)
    if (findings.length > 0) throw new Error(`Evaluation campaign is not safe to run: ${findings.map((finding) => `${finding.code}: ${finding.message}`).join('; ')}`)
    const expectedHash = evaluationManifestHash(manifest)
    if (approval.approvedBy !== 'user') throw new Error('Evaluation campaigns require user approval')
    if (approval.manifestHash !== expectedHash) throw new Error('Evaluation approval does not match this exact campaign manifest')
    if (approval.expiresAt !== null) {
      const expiresAt = Date.parse(approval.expiresAt)
      if (!Number.isFinite(expiresAt)) throw new Error('Evaluation campaign approval has an invalid expiry')
      if (expiresAt <= Date.now()) throw new Error('Evaluation campaign approval has expired')
    }
  }
}
