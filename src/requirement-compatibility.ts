/** Downgrades must be checked by the launcher: an old binary cannot learn
 * this rule retroactively. A completed v2 run still needs its v2 history reader. */
export function assertRequirementCheckpointCompatible(checkpoint: unknown, supportedVersions: readonly number[]): void {
  if (!checkpoint || typeof checkpoint !== 'object') return
  const requirements = (checkpoint as { ledger?: { outcomeContract?: { requirements?: { version?: unknown } } } }).ledger?.outcomeContract?.requirements
  if (!requirements) return // Version 1 has no requirement envelope.
  if (typeof requirements.version !== 'number' || !supportedVersions.includes(requirements.version)) {
    throw new Error('This build cannot read the stored requirement version. Keep the compatible build and data; do not resume or downgrade this store.')
  }
}
