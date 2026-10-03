import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const reserveUsd = 0.003 // 64K maximum accepted input at $0.042/M = $0.002688.
interface Entry { id: string; at: string; status: 'pending' | 'complete' | 'unknown'; inputTokens?: number; outputTokens?: number; estimatedUsd?: number; durationMs?: number; outcome?: string }
interface Ledger { version: 1; capUsd: number; reservedUsd: number; estimatedUsd: number; entries: Entry[] }

/** Separate, explicit allowance for the opt-in Jev trial. Never stores payloads or credentials. */
export class JevBudget {
  constructor(readonly path: string, readonly capUsd: number) {
    if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 20) throw new Error('Jev trial allowance must be within $20')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  }
  private update<T>(fn: (ledger: Ledger) => T): T {
    const lock = this.path + '.lock'
    mkdirSync(lock) // Another process or an interrupted update fails closed.
    try {
      const ledger = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) as Ledger : { version: 1 as const, capUsd: this.capUsd, reservedUsd: 0, estimatedUsd: 0, entries: [] }
      if (ledger.version !== 1 || ledger.capUsd !== this.capUsd || !Array.isArray(ledger.entries)
        || !Number.isFinite(ledger.reservedUsd) || ledger.reservedUsd < 0 || !Number.isFinite(ledger.estimatedUsd) || ledger.estimatedUsd < 0) throw new Error('Jev trial ledger is invalid or allowance changed')
      const value = fn(ledger)
      writeFileSync(this.path + '.tmp', JSON.stringify(ledger, null, 2), { mode: 0o600 })
      renameSync(this.path + '.tmp', this.path)
      return value
    } finally { rmdirSync(lock) }
  }
  reserve(): string {
    return this.update(l => {
      if (l.entries.some(e => e.status !== 'complete') || l.estimatedUsd > l.reservedUsd) throw new Error('Jev trial has unresolved usage')
      const next = Math.round((l.reservedUsd + reserveUsd) * 1e6) / 1e6
      if (next > l.capUsd) throw new Error('Jev trial allowance exhausted')
      const id = randomUUID(); l.reservedUsd = next
      l.entries.push({ id, at: new Date().toISOString(), status: 'pending' }); return id
    })
  }
  finish(id: string, usage: { inputTokens: number; outputTokens: number } | null, durationMs: number, outcome: string): void {
    this.update(l => {
      const e = l.entries.find(e => e.id === id)
      if (!e || e.status !== 'pending') throw new Error('Jev trial dispatch cannot be settled twice')
      e.durationMs = durationMs; e.outcome = outcome
      if (!usage || ![usage.inputTokens, usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) { e.status = 'unknown'; return }
      e.status = 'complete'; e.inputTokens = usage.inputTokens; e.outputTokens = usage.outputTokens
      e.estimatedUsd = usage.inputTokens * .042 / 1e6; l.estimatedUsd += e.estimatedUsd
      if (usage.inputTokens > 64_000 || e.estimatedUsd > reserveUsd) e.status = 'unknown'
    })
  }
}
