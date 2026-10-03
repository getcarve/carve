import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ComputerUseLab } from '../computer-use-lab.js'
import type { AuditEvent } from '../types.js'
import { sha256, stableJson } from '../util.js'
import { EvaluationArtifactStore } from './artifacts.js'
import { summarizeAuditFailures, type EvaluationAuditFailureSummary } from './audit-miner.js'
import { buildComputerUseRegressionCampaign } from './campaigns/computer-use-regression.js'
import { buildDictationEditingCampaign, loadCompactDictationDraftFactory } from './campaigns/dictation-editing.js'
import type { EvaluationCampaignManifest, EvaluationCampaignReport } from './contracts.js'
import { approveEvaluationCampaign, evaluationManifestHash } from './contracts.js'
import { invariantGrader, outcomeStateGrader } from './graders.js'
import { EvaluationGovernor, type EvaluationPolicyFinding } from './governor.js'
import { EvaluationRunner, type RegisteredEvaluationScenario } from './runner.js'

export type EvaluationFoundrySuite = 'dictation' | 'computer'

export interface EvaluationCampaignPreview {
  suite: EvaluationFoundrySuite
  manifest: EvaluationCampaignManifest
  manifestHash: string
  findings: EvaluationPolicyFinding[]
}

export interface EvaluationFoundrySummary {
  latestReports: EvaluationCampaignReport[]
  commonAuditFailures: EvaluationAuditFailureSummary[]
}

interface BuiltCampaign {
  manifest: EvaluationCampaignManifest
  registrations: RegisteredEvaluationScenario[]
}

function compactOverlayPath(): string {
  return fileURLToPath(new URL('../../desktop/live-computer-overlay.html', import.meta.url))
}

export class EvaluationFoundry {
  readonly artifacts: EvaluationArtifactStore
  private readonly governor = new EvaluationGovernor()

  constructor(root: string, private readonly auditEvents: () => AuditEvent[] = () => []) {
    this.artifacts = new EvaluationArtifactStore(root)
  }

  preview(suite: EvaluationFoundrySuite): EvaluationCampaignPreview {
    const built = this.build(suite)
    const manifestHash = this.artifacts.savePlan(built.manifest)
    return { suite, manifest: built.manifest, manifestHash, findings: this.governor.inspect(built.manifest) }
  }

  async run(suite: EvaluationFoundrySuite, manifestHash: string): Promise<EvaluationCampaignReport> {
    const manifest = this.artifacts.readPlan(manifestHash)
    const current = this.build(suite)
    if (manifest.source.baseline !== current.manifest.source.baseline) throw new Error('The approved Foundry plan targets an older Carve source; preview a new campaign')
    if (stableJson(manifest.suite.scenarioIds) !== stableJson(current.manifest.suite.scenarioIds)) throw new Error('The approved Foundry plan belongs to a different suite')
    const runner = new EvaluationRunner({
      governor: this.governor,
      artifactStore: this.artifacts,
      graders: [outcomeStateGrader(), invariantGrader()],
    })
    return runner.run(manifest, approveEvaluationCampaign(manifest), current.registrations)
  }

  /** The audit-failure summary maps thousands of audit rows; the desktop reuses it (see CarveApp.cachedAuditViews). */
  auditFailureSummary(): EvaluationFoundrySummary['commonAuditFailures'] {
    return summarizeAuditFailures(this.auditEvents()).slice(0, 10)
  }

  summary(commonAuditFailures = this.auditFailureSummary()): EvaluationFoundrySummary {
    return {
      latestReports: this.artifacts.listReports(10),
      commonAuditFailures,
    }
  }

  enforceRetention(now = new Date()): { deletedCampaignIds: string[]; deletedPlanHashes: string[] } {
    return this.artifacts.enforceRetention(now)
  }

  private build(suite: EvaluationFoundrySuite): BuiltCampaign {
    if (suite === 'dictation') {
      const path = compactOverlayPath()
      const source = readFileSync(path, 'utf8')
      return buildDictationEditingCampaign({ sourceHash: sha256(source), factory: loadCompactDictationDraftFactory(path) })
    }
    if (suite === 'computer') {
      const lab = new ComputerUseLab().summary()
      return buildComputerUseRegressionCampaign({
        sourceHash: sha256(stableJson({ implementation: ComputerUseLab.toString(), scenarios: lab.scenarios, architectures: lab.architectures })),
      })
    }
    throw new Error(`Unknown Foundry suite: ${String(suite)}`)
  }
}

export function foundryPlanHash(preview: EvaluationCampaignPreview): string {
  return evaluationManifestHash(preview.manifest)
}
