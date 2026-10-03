import type { LiveComputerAction, LiveComputerArtifactDraft } from './types.js'

/** Materialize one meaningful placement. UI structure and navigation are
 * chosen by the actor from observations, never inferred from row count. */
export function artifactPlacementText(artifact: LiveComputerArtifactDraft, action: Pick<LiveComputerAction, 'artifactLayout' | 'artifactUnit'>): { text: string; unit: number; total: number } {
  let units: string[]
  if (artifact.kind === 'record_set') {
    if (action.artifactLayout === 'table') {
      const cells = [artifact.columns, ...artifact.rows]
      if (!artifact.columns.length || cells.length * artifact.columns.length > 200 || cells.some(row => row.length !== artifact.columns.length)) throw new Error('Table placement needs a rectangular verified table of at most 200 cells')
      if (action.artifactUnit != null && action.artifactUnit !== 0) throw new Error('A bounded whole-table placement has artifactUnit 0')
      return { text: cells.map(row => row.join('\t')).join('\n'), unit: 0, total: 1 }
    }
    if (!action.artifactLayout) throw new Error('Choose grid for an existing cell or lines for a text destination. Create any required table through observed UI actions first.')
    units = action.artifactLayout === 'grid' ? [artifact.columns, ...artifact.rows].flat() : artifact.rows.map(row => row.join('\n'))
  } else {
    units = (artifact.content ?? '').split(/\n\s*\n/).filter(Boolean)
  }
  const unit = action.artifactUnit ?? (units.length === 1 ? 0 : null)
  if (unit === null || !Number.isSafeInteger(unit) || unit < 0 || unit >= units.length) {
    throw new Error(`Choose artifactUnit from 0 to ${units.length - 1}. Each action places one cell, record, or paragraph; inspect its effect before navigating or continuing.`)
  }
  return { text: units[unit]!, unit, total: units.length }
}
