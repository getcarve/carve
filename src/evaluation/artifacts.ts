import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { EvaluationApproval, EvaluationCampaignManifest, EvaluationCampaignReport, EvaluationTrialArtifact } from './contracts.js'
import { evaluationManifestHash } from './contracts.js'

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u.test(value) || basename(value) !== value) throw new Error(`Unsafe evaluation artifact id: ${value}`)
  return value
}

function writePrivateJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export class EvaluationArtifactStore {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    chmodSync(this.root, 0o700)
  }

  beginCampaign(manifest: EvaluationCampaignManifest, approval: EvaluationApproval): string {
    const directory = this.campaignDirectory(manifest.id)
    if (existsSync(directory)) throw new Error(`Evaluation campaign artifacts already exist: ${manifest.id}`)
    mkdirSync(resolve(directory, 'trials'), { recursive: true, mode: 0o700 })
    writePrivateJson(resolve(directory, 'manifest.json'), manifest)
    writePrivateJson(resolve(directory, 'approval.json'), approval)
    return directory
  }

  savePlan(manifest: EvaluationCampaignManifest): string {
    const hash = evaluationManifestHash(manifest)
    const directory = resolve(this.root, 'plans')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const path = resolve(directory, `${safeSegment(hash)}.json`)
    if (!existsSync(path)) writePrivateJson(path, manifest)
    return hash
  }

  readPlan(manifestHash: string): EvaluationCampaignManifest {
    if (!/^[a-f0-9]{64}$/u.test(manifestHash)) throw new Error('Evaluation plan hash must be a lowercase SHA-256 digest')
    const path = resolve(this.root, 'plans', `${safeSegment(manifestHash)}.json`)
    if (!existsSync(path)) throw new Error(`Approved evaluation plan was not found: ${manifestHash}`)
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as EvaluationCampaignManifest
    if (evaluationManifestHash(manifest) !== manifestHash) throw new Error('Stored evaluation plan does not match its filename hash')
    return manifest
  }

  appendTrial(trial: EvaluationTrialArtifact): void {
    const directory = this.campaignDirectory(trial.campaignId)
    if (!existsSync(resolve(directory, 'manifest.json'))) throw new Error(`Evaluation campaign has not been initialized: ${trial.campaignId}`)
    writePrivateJson(resolve(directory, 'trials', `${safeSegment(trial.id)}.json`), trial)
    appendFileSync(resolve(directory, 'trials.jsonl'), `${JSON.stringify(trial)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  completeCampaign(report: EvaluationCampaignReport): void {
    writePrivateJson(resolve(this.campaignDirectory(report.campaignId), 'report.json'), report)
  }

  readManifest(campaignId: string): EvaluationCampaignManifest {
    return JSON.parse(readFileSync(resolve(this.campaignDirectory(campaignId), 'manifest.json'), 'utf8')) as EvaluationCampaignManifest
  }

  readReport(campaignId: string): EvaluationCampaignReport | null {
    const path = resolve(this.campaignDirectory(campaignId), 'report.json')
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as EvaluationCampaignReport : null
  }

  listReports(limit = 20): EvaluationCampaignReport[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'plans')
      .map((entry) => this.readReport(entry.name))
      .filter((report): report is EvaluationCampaignReport => report !== null)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .slice(0, Math.max(0, Math.min(100, limit)))
  }

  enforceRetention(now = new Date()): { deletedCampaignIds: string[]; deletedPlanHashes: string[] } {
    const deletedCampaignIds: string[] = []
    const deletedPlanHashes: string[] = []
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'plans') continue
      const directory = this.campaignDirectory(entry.name)
      const manifestPath = resolve(directory, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as EvaluationCampaignManifest
      const report = this.readReport(entry.name)
      const retainedFrom = Date.parse(report?.completedAt ?? manifest.createdAt)
      if (!Number.isFinite(retainedFrom) || now.getTime() < retainedFrom + manifest.retention.artifactDays * 86_400_000) continue
      rmSync(directory, { recursive: true, force: true })
      deletedCampaignIds.push(entry.name)
    }
    const plans = resolve(this.root, 'plans')
    if (existsSync(plans)) {
      for (const entry of readdirSync(plans, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const path = resolve(plans, entry.name)
        const manifest = JSON.parse(readFileSync(path, 'utf8')) as EvaluationCampaignManifest
        const createdAt = Date.parse(manifest.createdAt)
        if (!Number.isFinite(createdAt) || now.getTime() < createdAt + manifest.retention.artifactDays * 86_400_000) continue
        rmSync(path, { force: true })
        deletedPlanHashes.push(entry.name.slice(0, -'.json'.length))
      }
    }
    return { deletedCampaignIds, deletedPlanHashes }
  }

  campaignDirectory(campaignId: string): string {
    return resolve(this.root, safeSegment(campaignId))
  }
}
