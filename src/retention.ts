import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { AuditLog } from './audit.js'
import type { CarveDatabase } from './db.js'

export interface RetentionResult {
  enforcedAt: string
  expiredSessionIds: string[]
  deletedObservationCount: number
  deletedProcedureIds: string[]
  deletedCaptureCount: number
  deletedTraceCount: number
  deletedEvaluationCampaignIds: string[]
  deletedEvaluationPlanHashes: string[]
}

interface AdditionalRetentionResult {
  deletedCampaignIds: string[]
  deletedPlanHashes: string[]
}

export class RetentionService {
  private timer: NodeJS.Timeout | null = null
  private lastResult: RetentionResult | null = null

  constructor(
    private readonly database: CarveDatabase,
    private readonly audit: AuditLog,
    private readonly dataDir: string,
    intervalMs = 60 * 60 * 1_000,
    private readonly enforceAdditional: ((now: Date) => AdditionalRetentionResult) | null = null,
  ) {
    this.enforce()
    this.timer = setInterval(() => this.enforce(), intervalMs)
    this.timer.unref()
  }

  summary(): { lastEnforcedAt: string | null; policy: string } {
    return { lastEnforcedAt: this.lastResult?.enforcedAt ?? null, policy: 'Expired stopped-session evidence, browser/native captures, derived procedures, evaluation plans, and evaluation reports are deleted; browser traces use the shortest configured retention.' }
  }

  enforce(now = new Date()): RetentionResult {
    const expiredSessionIds: string[] = []
    const deletedProcedureIds = new Set<string>()
    let deletedObservationCount = 0
    let deletedCaptureCount = 0
    const sessions = this.database.listSessions()
    for (const session of sessions) {
      if (session.status !== 'stopped' || !session.endedAt) continue
      const expiresAt = new Date(session.endedAt).getTime() + session.capturePolicy.retentionDays * 86_400_000
      if (now.getTime() < expiresAt) continue
      const observations = this.database.listObservations(session.id)
      if (observations.length === 0) continue
      const captureReferences = new Set<string>()
      for (const observation of observations) {
        if (observation.facts.screenshotRef) captureReferences.add(observation.facts.screenshotRef)
      }
      for (const review of this.database.listObservationReviews(session.id)) {
        if (review.sanitizedScreenshotRef) captureReferences.add(review.sanitizedScreenshotRef)
      }
      for (const reference of captureReferences) if (this.deleteRelativeFile(reference)) deletedCaptureCount += 1
      const expired = this.database.expireSessionEvidence(session.id)
      expiredSessionIds.push(session.id)
      deletedObservationCount += expired.observationIds.length
      for (const procedureId of expired.procedureIds) deletedProcedureIds.add(procedureId)
    }

    const traceDays = Math.max(1, Math.min(30, ...sessions.map((session) => session.capturePolicy.retentionDays)))
    const traceRoot = resolve(this.dataDir, 'browser-traces')
    let deletedTraceCount = 0
    if (existsSync(traceRoot)) {
      const cutoff = now.getTime() - traceDays * 86_400_000
      for (const name of readdirSync(traceRoot)) {
        const path = join(traceRoot, name)
        if (name.endsWith('.zip') && statSync(path).isFile() && statSync(path).mtimeMs < cutoff) {
          rmSync(path, { force: true })
          deletedTraceCount += 1
        }
      }
    }
    const additional = this.enforceAdditional?.(now) ?? { deletedCampaignIds: [], deletedPlanHashes: [] }
    const result: RetentionResult = {
      enforcedAt: now.toISOString(), expiredSessionIds, deletedObservationCount,
      deletedProcedureIds: [...deletedProcedureIds], deletedCaptureCount, deletedTraceCount,
      deletedEvaluationCampaignIds: additional.deletedCampaignIds,
      deletedEvaluationPlanHashes: additional.deletedPlanHashes,
    }
    this.lastResult = result
    if (expiredSessionIds.length > 0 || deletedTraceCount > 0 || additional.deletedCampaignIds.length > 0 || additional.deletedPlanHashes.length > 0) this.audit.append('privacy.retention_enforced', 'system', null, { ...result })
    return result
  }

  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private deleteRelativeFile(relativePath: string): boolean {
    const path = resolve(this.dataDir, relativePath)
    const root = resolve(this.dataDir)
    if (path !== root && !path.startsWith(`${root}${sep}`)) return false
    if (!existsSync(path) || !statSync(path).isFile()) return false
    rmSync(path, { force: true })
    return true
  }
}
