import type { AuditEvent } from './types.js'
import type { CarveDatabase } from './db.js'
import { id, nowIso, sha256, stableJson } from './util.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface AuditVerificationCache {
  dataVersion: number
  latestSequence: number
  latestHash: string
  result: { valid: boolean; checked: number; errorAt: number | null }
  /** When the whole chain was last walked. Between full walks, verification
   * extends from the cached head over the new tail only. */
  fullyVerifiedAt: number
}

/** A full walk of the chain is O(rows) of hashing. It is repeated this often
 * at most; in between, only rows appended since the cached head are hashed. */
const fullVerificationIntervalMs = 5 * 60_000

export class AuditLog {
  private verificationCache: AuditVerificationCache | null = null

  constructor(private readonly database: CarveDatabase, private readonly localDiagnosticDir?: string) {}

  /** Desktop development only. Raw prompts, responses and evidence stay in
   * private local files, outside database exports and hosted telemetry. */
  appendLocalDiagnostic(subjectId: string, details: Record<string, unknown>): void {
    if (!this.localDiagnosticDir) return
    const diagnosticId = id('diagnostic')
    try {
      mkdirSync(this.localDiagnosticDir, { recursive: true, mode: 0o700 })
      const body = JSON.stringify({ occurredAt: nowIso(), subjectId, ...details })
      writeFileSync(join(this.localDiagnosticDir, `${diagnosticId}.json`), body, { mode: 0o600, flag: 'wx' })
      this.append('computer.local_diagnostic', 'system', subjectId, {
        diagnosticId, sha256: sha256(body), stage: details.stage,
        turn: details.turn, runId: details.runId, localOnly: true,
      })
    } catch {
      // A full disk must not silently erase the diagnostic or change execution.
      this.append('computer.local_diagnostic_failed', 'system', subjectId, { diagnosticId, stage: details.stage, runId: details.runId })
    }
  }

  append(
    category: string,
    actor: AuditEvent['actor'],
    subjectId: string | null,
    details: Record<string, unknown>,
  ): AuditEvent {
    const previous = this.database.latestAudit()
    const previousHash = previous?.hash ?? 'GENESIS'
    const dataVersion = this.database.dataVersion()
    const base = {
      id: id('audit'),
      occurredAt: nowIso(),
      category,
      actor,
      subjectId,
      details,
      previousHash,
    }
    const appended = this.database.appendAudit({ ...base, hash: sha256(stableJson(base)) })

    // Appends made through this log are already linked to the verified tail.
    // Advance a valid cache in O(1), or retain an earlier invalid verdict. If
    // another connection changed the database, discard the cache and let the
    // next read perform a complete verification.
    const cached = this.verificationCache
    if (
      cached
      && cached.dataVersion === dataVersion
      && this.database.dataVersion() === dataVersion
      && cached.latestSequence === (previous?.sequence ?? 0)
      && cached.latestHash === previousHash
    ) {
      this.verificationCache = {
        ...cached,
        dataVersion,
        latestSequence: appended.sequence,
        latestHash: appended.hash,
        result: cached.result.valid
          ? { valid: true, checked: cached.result.checked + 1, errorAt: null }
          : cached.result,
      }
    } else {
      this.verificationCache = null
    }
    return appended
  }

  verifyChain(): { valid: boolean; checked: number; errorAt: number | null } {
    const dataVersion = this.database.dataVersion()
    const latest = this.database.latestAudit()
    const latestSequence = latest?.sequence ?? 0
    const latestHash = latest?.hash ?? 'GENESIS'
    const cached = this.verificationCache
    if (
      cached
      && cached.dataVersion === dataVersion
      && cached.latestSequence === latestSequence
      && cached.latestHash === latestHash
    ) return { ...cached.result }

    // Incremental path: the cached head row still stands (same sequence and
    // hash), so only the rows appended after it need hashing. Every write
    // from another connection used to force a full walk of the whole chain
    // — tens of thousands of hashes on the main thread, twice a second during
    // a live run. A full walk still happens periodically to catch edits
    // behind the head.
    if (
      cached
      && cached.result.valid
      && cached.latestSequence > 0
      && cached.latestSequence < latestSequence
      && Date.now() - cached.fullyVerifiedAt < fullVerificationIntervalMs
    ) {
      const head = this.database.auditAt(cached.latestSequence)
      if (head && head.hash === cached.latestHash) {
        const tail = this.database.listAuditAfter(cached.latestSequence)
        const result = verifyRows(tail, cached.latestHash, cached.result.checked)
        this.verificationCache = { ...cached, dataVersion, latestSequence, latestHash, result }
        return { ...result }
      }
    }

    const events = this.database.listAudit(Number.MAX_SAFE_INTEGER).sort((left, right) => left.sequence - right.sequence)
    const result = verifyRows(events, 'GENESIS', 0)

    // Cache only a stable snapshot. If another connection wrote while the
    // scan was running, the next caller verifies the new database state.
    const currentLatest = this.database.latestAudit()
    if (
      this.database.dataVersion() === dataVersion
      && (currentLatest?.sequence ?? 0) === latestSequence
      && (currentLatest?.hash ?? 'GENESIS') === latestHash
    ) {
      this.verificationCache = { dataVersion, latestSequence, latestHash, result, fullyVerifiedAt: Date.now() }
    } else {
      this.verificationCache = null
    }
    return { ...result }
  }
}

/** Walks rows in sequence order from a known previous hash. `checkedBefore`
 * counts rows already verified ahead of this walk. */
function verifyRows(events: AuditEvent[], startHash: string, checkedBefore: number): AuditVerificationCache['result'] {
  let previousHash = startHash
  for (const event of events) {
    const base = {
      id: event.id,
      occurredAt: event.occurredAt,
      category: event.category,
      actor: event.actor,
      subjectId: event.subjectId,
      details: event.details,
      previousHash,
    }
    if (event.previousHash !== previousHash || event.hash !== sha256(stableJson(base))) {
      return { valid: false, checked: event.sequence, errorAt: event.sequence }
    }
    previousHash = event.hash
  }
  return { valid: true, checked: checkedBefore + events.length, errorAt: null }
}
