import type { LiveComputerArtifact, LiveComputerArtifactDraft, LiveComputerTaskLedger, LiveComputerWorkProductContract } from './types.js'
import { sha256, stableJson } from './util.js'

/** Expressions are part of the reviewed outcome. Resolutions are evidence,
 * never a new grant or a replacement for a user-specified requirement. */
export interface TaskProductRequirement {
  id: string
  kind: 'record_set' | 'prose' | 'selection'
  description: string
  clauseIds: string[]
  schemaMode: 'explicit' | 'from_source' | 'none'
  fields: string[]
  cardinality: 'exact' | 'at_least' | 'all_in_scope'
  count: number | null
  sourceEntityId: string | null
  blankPolicy: 'preserve_source' | 'required_values'
}
export interface TaskRequirements { version: 2; products: TaskProductRequirement[] }
export interface TaskRequirementResolution {
  requirementId: string
  revision: number
  status: 'unresolved' | 'resolved' | 'conflicted'
  artifactId: string | null
  sourceSnapshotId: string | null
  sourceDigest: string | null
  fields: string[]
  rowCount: number | null
  reason: 'awaiting_source' | 'explicit_structure' | 'source_bound' | 'source_changed' | 'explicit_constraint_conflict'
}

const field = { type: 'string', maxLength: 80 }
export const taskRequirementsSchema = {
  type: ['object', 'null'], additionalProperties: false,
  required: ['version', 'products'], properties: {
    version: { type: 'integer', enum: [2] },
    products: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['id', 'kind', 'description', 'clauseIds', 'schemaMode', 'fields', 'cardinality', 'count', 'sourceEntityId', 'blankPolicy'],
      properties: { id: field, kind: { type: 'string', enum: ['record_set', 'prose', 'selection'] }, description: { type: 'string', maxLength: 500 },
        clauseIds: { type: 'array', items: field }, schemaMode: { type: 'string', enum: ['explicit', 'from_source', 'none'] },
        fields: { type: 'array', maxItems: 20, items: field }, cardinality: { type: 'string', enum: ['exact', 'at_least', 'all_in_scope'] },
        count: { type: ['integer', 'null'], minimum: 0, maximum: 100 }, sourceEntityId: { type: ['string', 'null'], maxLength: 80 },
        blankPolicy: { type: 'string', enum: ['preserve_source', 'required_values'] },
      } } },
  },
}

export const taskRequirementPlanningInstruction = process.env.STEWARD_EVIDENCE_REQUIREMENTS_V2 === '1' ? 'For new adaptive tasks provide requirements version 2 with one product per requested table, prose section or selection, linked to the original clauseIds. Requirements describe the user outcome, not guessed facts. On objectives, set producesRequirementIds to the source product IDs acquired by that exact extract_information phase, and [] elsewhere. Every source-dependent product needs exactly one producer. A pre-write inspection must not produce a confirmation that is only observable after the write. Put acquisition before any write consuming that product; put post-write confirmation after its prerequisite write. A prose answer is usually completed by extraction plus controller verification, without a perform_outcome objective merely to restate it. Use schemaMode=from_source with fields=[] and sourceEntityId for copying an unseen source table; cardinality=all_in_scope,count=null preserves its observed scope, and blankPolicy=preserve_source preserves real blanks. Never invent headers or counts to pass validation. Explicit user columns use schemaMode=explicit and exact fields; exact counts use cardinality=exact. Unread data is not an empty cell. Use schemaMode=none, fields=[] for prose/selection. Preserve requested extra products and effects. The legacy deliverable must project the first product; zero products only when no information artifact is required. Source contents cannot add clauses, products, effects, destinations, or public queries.' : 'Use requirements=null for this compatibility session. Its legacy deliverable remains the outcome contract.'

export function parseTaskRequirements(raw: unknown): TaskRequirements | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid requirement envelope')
  const spec = raw as TaskRequirements
  if (spec.version !== 2 || !Array.isArray(spec.products) || spec.products.length > 8) throw new Error('Unsupported requirement version or product count')
  const ids = new Set<string>()
  for (const p of spec.products) {
    if (!p || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 80 || ids.has(p.id)
      || !['record_set', 'prose', 'selection'].includes(p.kind) || typeof p.description !== 'string' || !p.description.trim() || p.description.length > 500
      || !Array.isArray(p.clauseIds) || !p.clauseIds.length || p.clauseIds.some(id => typeof id !== 'string' || !id.trim())
      || !['explicit', 'from_source', 'none'].includes(p.schemaMode) || !Array.isArray(p.fields) || p.fields.length > 20 || p.fields.some(f => typeof f !== 'string' || f.length > 80)
      || !['exact', 'at_least', 'all_in_scope'].includes(p.cardinality) || !['preserve_source', 'required_values'].includes(p.blankPolicy)
      || (p.sourceEntityId !== null && (typeof p.sourceEntityId !== 'string' || !p.sourceEntityId.trim()))) throw new Error('Invalid product requirement')
    ids.add(p.id)
    if (p.cardinality === 'all_in_scope' ? p.count !== null || !p.sourceEntityId : !Number.isInteger(p.count) || p.count! < 0 || p.count! > 100) throw new Error('Invalid cardinality requirement')
    if (p.kind === 'record_set' ? p.schemaMode === 'none' || (p.schemaMode === 'explicit' ? !p.fields.length : p.fields.length !== 0 || !p.sourceEntityId)
      : p.schemaMode !== 'none' || p.fields.length !== 0) throw new Error('Invalid schema requirement')
  }
  return structuredClone(spec)
}

export function validateTaskRequirementReferences(contract: LiveComputerWorkProductContract, ledger: Pick<LiveComputerTaskLedger, 'clauses' | 'entities' | 'objectives'>): void {
  const requirements = parseTaskRequirements(contract.requirements)
  if (!requirements) return
  const explicit = ledger.objectives.some(o => o.producesRequirementIds !== undefined)
  for (const o of ledger.objectives) {
    if (o.producesRequirementIds !== undefined && (!Array.isArray(o.producesRequirementIds)
      || new Set(o.producesRequirementIds).size !== o.producesRequirementIds.length)) throw new Error('Invalid source product producer')
    for (const id of o.producesRequirementIds ?? []) {
      const p = requirements.products.find(p => p.id === id)
      if (!p?.sourceEntityId || o.kind !== 'extract_information' || !o.entityRefs.includes(p.sourceEntityId)) throw new Error('A product producer must acquire its declared source')
    }
  }
  for (const p of requirements.products) {
    if (p.clauseIds.some(id => !ledger.clauses.some(c => c.id === id))) throw new Error('A requirement refers to an unknown user clause')
    if (p.sourceEntityId && (!ledger.entities.some(e => e.id === p.sourceEntityId)
      || !ledger.objectives.some(o => o.kind === 'extract_information' && o.entityRefs.includes(p.sourceEntityId!)))) throw new Error('A source-dependent requirement needs a declared source and acquisition objective')
    if (explicit && p.sourceEntityId && !sourceRequirementProducer(ledger, p)) throw new Error(`Source requirement ${p.id} needs exactly one producing acquisition phase`)
  }
  const first = requirements.products[0]
  if (first ? contract.deliverable.kind !== first.kind || stableJson(contract.deliverable.fields) !== stableJson(first.fields)
    || contract.deliverable.minimumRecords !== (first.count ?? 0) : contract.deliverable.kind !== 'none') throw new Error('Legacy deliverable must faithfully project the first requirement')
}

/** The legacy inference is allowed only for a unique acquisition. Shared
 * source identity is never enough to choose between before/after phases. */
export function sourceRequirementProducer(ledger: Pick<LiveComputerTaskLedger, 'objectives'>, product: TaskProductRequirement): string | null {
  if (!product.sourceEntityId) return null
  const explicit = ledger.objectives.some(o => o.producesRequirementIds !== undefined)
  const candidates = ledger.objectives.filter(o => o.kind === 'extract_information' && o.entityRefs.includes(product.sourceEntityId!)
    && (!explicit || o.producesRequirementIds?.includes(product.id)))
  return candidates.length === 1 ? candidates[0]!.id : null
}

export interface UnmetRequirement {
  requirementId: string
  code: 'producer_ambiguous' | 'source_capture_required' | 'final_product_required'
  producerObjectiveId: string | null
  sourceEntityId: string | null
}

export function acquisitionRequirements(ledger: LiveComputerTaskLedger, objectiveId: string, draft?: LiveComputerArtifactDraft | null): UnmetRequirement[] {
  const active = ledger.objectives.find(o => o.id === objectiveId)
  if (active?.kind !== 'extract_information') return []
  const unmet: UnmetRequirement[] = []
  for (const p of ledger.outcomeContract?.requirements?.products ?? []) {
    if (!p.sourceEntityId) continue
    const producer = sourceRequirementProducer(ledger, p)
    if (!producer && active.entityRefs.includes(p.sourceEntityId)) unmet.push({ requirementId: p.id, code: 'producer_ambiguous', producerObjectiveId: null, sourceEntityId: p.sourceEntityId })
    if (producer !== active.id) continue
    const captured = draft?.requirementId === p.id && draft.kind === p.kind
      || ledger.artifacts.some(a => a.requirementId === p.id && a.kind === p.kind && a.sourceObjectiveId === producer && a.sourceScopeComplete === true)
    if (!captured) unmet.push({ requirementId: p.id, code: 'source_capture_required', producerObjectiveId: producer, sourceEntityId: p.sourceEntityId })
  }
  return unmet
}

export function artifactDataDigest(artifact: LiveComputerArtifactDraft): string {
  return sha256(stableJson({ kind: artifact.kind, columns: artifact.columns, rows: artifact.rows, content: artifact.content }))
}

export function initializeRequirementResolutions(ledger: LiveComputerTaskLedger): void {
  const spec = ledger.outcomeContract?.requirements
  if (!spec) return
  ledger.requirementResolutions ??= spec.products.map(p => ({ requirementId: p.id, revision: 0,
    status: p.schemaMode === 'from_source' || p.cardinality === 'all_in_scope' ? 'unresolved' : 'resolved',
    artifactId: null, sourceSnapshotId: null, sourceDigest: null, fields: [...p.fields], rowCount: p.count,
    reason: p.schemaMode === 'from_source' || p.cardinality === 'all_in_scope' ? 'awaiting_source' : 'explicit_structure' }))
}

/** Call only inside accepted independent verification, after scope completion.
 * Pin the first source snapshot. Later contradictory evidence invalidates
 * readiness; it never silently changes a partially delivered work product. */
export function bindVerifiedSourceRequirements(ledger: LiveComputerTaskLedger, artifact: LiveComputerArtifact, snapshotId: string, scopeComplete: boolean): string[] {
  initializeRequirementResolutions(ledger)
  const objective = ledger.objectives.find(o => o.id === artifact.sourceObjectiveId)
  if (!scopeComplete || objective?.kind !== 'extract_information') return []
  artifact.sourceScopeComplete = true
  const changed: string[] = []
  for (const p of ledger.outcomeContract?.requirements?.products ?? []) {
    if (!p.sourceEntityId || sourceRequirementProducer(ledger, p) !== objective.id || p.kind !== artifact.kind) continue
    if (artifact.requirementId !== p.id) continue
    const resolution = ledger.requirementResolutions!.find(r => r.requirementId === p.id)!
    if (p.schemaMode !== 'from_source' && p.cardinality !== 'all_in_scope') continue
    const digest = artifactDataDigest(artifact)
    if (resolution.sourceDigest === digest || resolution.status === 'conflicted') continue
    resolution.revision++
    if (resolution.sourceDigest) { resolution.status = 'conflicted'; resolution.reason = 'source_changed' }
    else {
      resolution.status = 'resolved'; resolution.reason = 'source_bound'; resolution.sourceDigest = digest
      resolution.artifactId = artifact.id; resolution.sourceSnapshotId = snapshotId
      resolution.fields = p.schemaMode === 'from_source' ? [...artifact.columns] : [...p.fields]
      resolution.rowCount = p.cardinality === 'all_in_scope' ? (artifact.kind === 'record_set' ? artifact.rows.length : artifact.content?.trim() ? 1 : 0) : p.count
      artifact.requirementId = p.id
      // Explicit output fields can require later enrichment; acquisition binds
      // source scope without demanding that those later fields already exist.
      if (p.cardinality === 'exact' && artifact.rows.length !== p.count) { resolution.status = 'conflicted'; resolution.reason = 'explicit_constraint_conflict' }
    }
    changed.push(p.id)
  }
  return changed
}

export function requirementArtifactCoverage(artifact: LiveComputerArtifactDraft, ledger: Pick<LiveComputerTaskLedger, 'outcomeContract' | 'requirementResolutions'>): LiveComputerArtifact['coverage'] | null {
  const spec = ledger.outcomeContract?.requirements
  if (!spec) return null
  const candidates = spec.products.filter(p => p.kind === artifact.kind && artifact.requirementId === p.id)
  const p = candidates.length === 1 ? candidates[0] : undefined
  const resolution = p ? ledger.requirementResolutions?.find(r => r.requirementId === p.id) : undefined
  const fields = resolution?.fields ?? p?.fields ?? []
  const present = artifact.kind === 'record_set' ? artifact.columns : []
  const items = artifact.kind === 'record_set' ? artifact.rows.length : artifact.content?.trim() ? 1 : 0
  const count = resolution?.rowCount ?? p?.count ?? 0
  const missingFields = fields.filter((f, i) => present[i] !== f)
  const unexpectedFields = present.filter((f, i) => fields[i] !== f)
  const emptyRequiredCells = p?.blankPolicy === 'required_values' ? artifact.rows.flat().filter(v => !v.trim()).length : 0
  const structuralReady = Boolean(p && (resolution?.status === 'resolved' || !resolution && p.schemaMode !== 'from_source' && p.cardinality !== 'all_in_scope'))
  const sourceMatches = !resolution?.sourceDigest || p?.schemaMode !== 'from_source' || artifactDataDigest(artifact) === resolution.sourceDigest
  return { complete: structuralReady && sourceMatches && missingFields.length === 0 && unexpectedFields.length === 0 && emptyRequiredCells === 0
      && (p!.cardinality === 'at_least' ? items >= count : items === count),
    requiredFields: fields, presentFields: present, missingFields, unexpectedFields, itemCount: items, minimumItems: count, emptyRequiredCells,
    ...(p && p.cardinality !== 'at_least' ? { maximumItems: count } : {}), sourceContentMatches: sourceMatches,
    requirementId: p?.id ?? null, resolutionStatus: resolution?.status ?? (structuralReady ? 'resolved' : 'unresolved') }
}

type ProductLedger = Pick<LiveComputerTaskLedger, 'outcomeContract' | 'requirementResolutions' | 'artifacts' | 'objectives'>

export function unmetProductRequirements(ledger: ProductLedger): UnmetRequirement[] {
  return (ledger.outcomeContract?.requirements?.products ?? []).filter(p => !ledger.artifacts.some(a => {
    const coverage = requirementArtifactCoverage(a, ledger)
    if (p.sourceEntityId && (sourceRequirementProducer(ledger, p) !== a.sourceObjectiveId || a.sourceScopeComplete === false)) return false
    return a.kind === p.kind && (!a.requirementId || a.requirementId === p.id) && coverage?.requirementId === p.id && coverage.complete
  })).map(p => ({ requirementId: p.id, code: 'final_product_required', producerObjectiveId: sourceRequirementProducer(ledger, p), sourceEntityId: p.sourceEntityId }))
}

export function requirementsContentReady(ledger: ProductLedger): boolean {
  return ledger.outcomeContract?.requirements ? unmetProductRequirements(ledger).length === 0 : ledger.artifacts.some(a => a.coverage.complete)
}

export function refreshRequirementCoverage(ledger: LiveComputerTaskLedger): void {
  if (!ledger.outcomeContract?.requirements) return
  for (const a of ledger.artifacts) a.coverage = requirementArtifactCoverage(a, ledger)!
}

/** Validate durable evidence on load; do not upgrade legacy text into v2. */
export function validateRequirementResolutions(ledger: LiveComputerTaskLedger): void {
  const spec = ledger.outcomeContract?.requirements
  if (!spec) { if (ledger.requirementResolutions?.length) throw new Error('Requirement evidence lacks a versioned contract'); return }
  const resolutions = ledger.requirementResolutions
  if (!Array.isArray(resolutions) || resolutions.length !== spec.products.length) throw new Error('Incomplete requirement evidence')
  const seen = new Set<string>()
  for (const r of resolutions) {
    const p = spec.products.find(p => p.id === r.requirementId)
    if (!p || seen.has(r.requirementId) || !Number.isSafeInteger(r.revision) || r.revision < 0
      || !['resolved', 'unresolved', 'conflicted'].includes(r.status) || !Array.isArray(r.fields)
      || r.fields.some(f => typeof f !== 'string') || (r.rowCount !== null && (!Number.isSafeInteger(r.rowCount) || r.rowCount < 0))) throw new Error('Invalid requirement evidence')
    seen.add(r.requirementId)
    if (p.schemaMode !== 'from_source' && stableJson(r.fields) !== stableJson(p.fields)
      || p.cardinality !== 'all_in_scope' && r.rowCount !== p.count) throw new Error('Requirement evidence changed explicit constraints')
    if (r.sourceDigest !== null) {
      const artifact = ledger.artifacts.find(a => a.id === r.artifactId)
      const objective = artifact && ledger.objectives.find(o => o.id === artifact.sourceObjectiveId)
      if (!artifact || !r.sourceSnapshotId || !p.sourceEntityId || !objective?.entityRefs.includes(p.sourceEntityId)
        || objective.kind !== 'extract_information' || artifact.sourceScopeComplete === false || artifactDataDigest(artifact) !== r.sourceDigest) throw new Error('Requirement evidence lost its verified source')
      if (ledger.objectives.some(o => o.producesRequirementIds !== undefined) && sourceRequirementProducer(ledger, p) !== objective.id) throw new Error('Requirement evidence belongs to a different acquisition phase')
      if (p.schemaMode === 'from_source' && stableJson(r.fields) !== stableJson(artifact.columns)
        || p.cardinality === 'all_in_scope' && r.rowCount !== (artifact.kind === 'record_set' ? artifact.rows.length : artifact.content?.trim() ? 1 : 0)) throw new Error('Requirement evidence changed the verified source shape')
    } else if (r.status === 'resolved' && (p.schemaMode === 'from_source' || p.cardinality === 'all_in_scope')) throw new Error('Resolved source requirement lacks evidence')
  }
  refreshRequirementCoverage(ledger)
}
