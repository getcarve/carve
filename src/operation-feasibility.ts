import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  ApplicationOperationTransactionPhase,
  LiveComputerOperationBinding,
  LiveComputerOperationBlocker,
  LiveComputerOperationFeasibility,
  LiveComputerOperationParameterSource,
  LiveComputerOperationParameterType,
  LiveComputerOperationResolutionChoice,
  LiveComputerSession,
} from './types.js'
import { nowIso, sha256, stableJson } from './util.js'

export interface OperationParameterSpec {
  id: string
  label: string
  type: LiveComputerOperationParameterType
  required: boolean
  authorityImpact: LiveComputerOperationBinding['authorityImpact']
  allowedSources: LiveComputerOperationParameterSource[]
  missingStrategy: 'observe' | 'ask_user' | 'revise_contract' | 'unavailable'
  defaultValue?: string | number | boolean
  validate?: (value: string | number | boolean) => string | null
}

export interface OperationDescriptor {
  id: string
  label: string
  applicationFamily: string
  effect: 'read' | 'local_write' | 'external_write'
  parameters: OperationParameterSpec[]
  transaction: OperationTransactionContract
}

export interface OperationTransactionContract {
  capability: string
  preconditions: string[]
  authorizedEffect: string
  phases: ApplicationOperationTransactionPhase[]
  commitPoint: ApplicationOperationTransactionPhase
  idempotency: 'idempotent' | 'conditionally_idempotent' | 'non_idempotent'
  postcondition: 'exact_new_file' | 'exact_application_state' | 'adapter_defined'
  recoveryAuthority: 'same_bindings_only'
}

const genericTransactionalPhases: ApplicationOperationTransactionPhase[] = [
  'prepared', 'preconditions_established', 'effect_ui_requested', 'effect_ui_identified',
  'commit_revalidated', 'commit_attempted', 'commit_observed', 'postcondition_verified', 'completed',
]

function transactionContract(input: Omit<OperationTransactionContract, 'phases' | 'recoveryAuthority'> & { phases?: ApplicationOperationTransactionPhase[] }): OperationTransactionContract {
  return {
    ...input,
    phases: input.phases ?? genericTransactionalPhases,
    recoveryAuthority: 'same_bindings_only',
  }
}

export interface OperationBindingCandidate {
  operationId: string
  parameterId: string
  type: LiveComputerOperationParameterType
  source: LiveComputerOperationParameterSource
  value: string | number | boolean
  safeLabel: string
  authorized: boolean
  freshness?: 'fresh' | 'stale'
}

export interface OperationResolutionResult {
  feasibility: LiveComputerOperationFeasibility
  choices: LiveComputerOperationResolutionChoice[]
}

const sourcePriority: Record<LiveComputerOperationParameterSource, number> = {
  approved_goal: 70,
  user_guidance: 60,
  saved_preference: 50,
  os_default: 40,
  application_state: 30,
  controller_default: 20,
  derived: 10,
}

function stringValue(value: string | number | boolean): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function bindingId(candidate: OperationBindingCandidate): string {
  return `operation_binding_${sha256(stableJson({
    operationId: candidate.operationId,
    parameterId: candidate.parameterId,
    source: candidate.source,
    value: candidate.value,
  })).slice(0, 16)}`
}

function blocker(
  operationId: string,
  parameterId: string,
  status: LiveComputerOperationBlocker['status'],
  reason: string,
): LiveComputerOperationBlocker {
  return {
    parameterId,
    status,
    reason,
    fingerprint: sha256(stableJson({ operationId, parameterId, status, reason })),
  }
}

function candidateBinding(
  candidate: OperationBindingCandidate,
  spec: OperationParameterSpec,
  status: LiveComputerOperationBinding['status'],
  evaluatedAt: string,
): LiveComputerOperationBinding {
  return {
    id: bindingId(candidate),
    operationId: candidate.operationId,
    parameterId: candidate.parameterId,
    type: spec.type,
    status,
    source: candidate.source,
    value: candidate.value,
    safeLabel: candidate.safeLabel,
    authorized: candidate.authorized,
    authorityImpact: spec.authorityImpact,
    updatedAt: evaluatedAt,
  }
}

/** Resolve all parameters with one deterministic precedence and authority
 * policy. Model inference may propose candidates, but it never decides which
 * source outranks another or whether a known external-effect value is
 * authorized. */
export function resolveOperationFeasibility(input: {
  descriptor: OperationDescriptor
  objectiveId?: string | null
  candidates: OperationBindingCandidate[]
  evaluatedAt?: string
}): OperationResolutionResult {
  const evaluatedAt = input.evaluatedAt ?? nowIso()
  const bindings: LiveComputerOperationBinding[] = []
  const blockers: LiveComputerOperationBlocker[] = []
  const choices: LiveComputerOperationResolutionChoice[] = []
  let needsContractRevision = false

  for (const spec of input.descriptor.parameters) {
    const supplied = input.candidates.filter((candidate) => (
      candidate.operationId === input.descriptor.id
      && candidate.parameterId === spec.id
      && candidate.type === spec.type
      && spec.allowedSources.includes(candidate.source)
    ))
    const stale = supplied.filter((candidate) => candidate.freshness === 'stale')
    const valid = supplied.filter((candidate) => candidate.freshness !== 'stale' && !spec.validate?.(candidate.value))
    const invalid = supplied.filter((candidate) => candidate.freshness !== 'stale' && Boolean(spec.validate?.(candidate.value)))

    if (valid.length === 0 && spec.defaultValue !== undefined) {
      valid.push({
        operationId: input.descriptor.id,
        parameterId: spec.id,
        type: spec.type,
        source: 'controller_default',
        value: spec.defaultValue,
        safeLabel: `${spec.label}: ${stringValue(spec.defaultValue)}`,
        authorized: spec.authorityImpact === 'none',
      })
    }

    if (valid.length === 0) {
      if (!spec.required) continue
      if (stale.length > 0) {
        blockers.push(blocker(input.descriptor.id, spec.id, 'stale', `${spec.label} must be observed or chosen again because the prior value is stale.`))
      } else if (invalid.length > 0) {
        blockers.push(blocker(input.descriptor.id, spec.id, 'unavailable', spec.validate?.(invalid[0]!.value) ?? `${spec.label} is invalid.`))
      } else if (spec.missingStrategy === 'observe') {
        blockers.push(blocker(input.descriptor.id, spec.id, 'needs_observation', `${spec.label} must be observed from current application state.`))
      } else if (spec.missingStrategy === 'ask_user') {
        blockers.push(blocker(input.descriptor.id, spec.id, 'needs_user_choice', `${spec.label} must be chosen by the user before this operation can run.`))
      } else if (spec.missingStrategy === 'revise_contract') {
        needsContractRevision = true
        blockers.push(blocker(input.descriptor.id, spec.id, 'unavailable', `${spec.label} is absent from the approved contract.`))
      } else {
        blockers.push(blocker(input.descriptor.id, spec.id, 'unavailable', `${spec.label} is not available.`))
      }
      continue
    }

    const bestPriority = Math.max(...valid.map((candidate) => sourcePriority[candidate.source]))
    const best = valid.filter((candidate) => sourcePriority[candidate.source] === bestPriority)
    const distinctValues = new Map(best.map((candidate) => [stableJson(candidate.value), candidate]))
    if (distinctValues.size > 1) {
      blockers.push(blocker(input.descriptor.id, spec.id, 'ambiguous', `${spec.label} has multiple equally authoritative choices.`))
      for (const candidate of distinctValues.values()) {
        bindings.push(candidateBinding(candidate, spec, 'ambiguous', evaluatedAt))
        choices.push({
          optionId: `bind:${bindingId(candidate)}`,
          operationId: candidate.operationId,
          parameterId: candidate.parameterId,
          type: candidate.type,
          value: candidate.value,
          source: candidate.source,
          safeLabel: candidate.safeLabel,
          authorityImpact: spec.authorityImpact,
        })
      }
      continue
    }

    const selected = best[0]!
    if (spec.authorityImpact !== 'none' && !selected.authorized) {
      bindings.push(candidateBinding(selected, spec, 'needs_authority', evaluatedAt))
      blockers.push(blocker(input.descriptor.id, spec.id, 'needs_authority', `${spec.label} is known but is not authorized for this external effect.`))
      choices.push({
        optionId: `bind:${bindingId(selected)}`,
        operationId: selected.operationId,
        parameterId: selected.parameterId,
        type: selected.type,
        value: selected.value,
        source: selected.source,
        safeLabel: selected.safeLabel,
        authorityImpact: spec.authorityImpact,
      })
      continue
    }
    bindings.push(candidateBinding(selected, spec, 'resolved', evaluatedAt))
  }

  const statuses = new Set(blockers.map((entry) => entry.status))
  const status: LiveComputerOperationFeasibility['status'] = blockers.length === 0
    ? 'ready'
    : statuses.has('unavailable')
      ? needsContractRevision ? 'needs_contract_revision' : 'unavailable'
      : statuses.has('ambiguous') || statuses.has('needs_authority') || statuses.has('needs_user_choice')
        ? 'needs_user'
        : 'needs_observation'
  const allowedNextSteps: LiveComputerOperationFeasibility['allowedNextSteps'] = status === 'ready'
    ? ['execute']
    : status === 'needs_user'
      ? ['ask_user', 'handoff']
      : status === 'needs_observation'
        ? ['observe', 'handoff']
        : status === 'needs_contract_revision'
          ? ['revise_contract', 'handoff']
          : ['handoff']

  return {
    feasibility: {
      operationId: input.descriptor.id,
      objectiveId: input.objectiveId ?? null,
      status,
      bindings,
      blockers,
      allowedNextSteps,
      evaluatedAt,
    },
    choices,
  }
}

function validNonempty(value: string | number | boolean): string | null {
  return typeof value === 'string' && value.trim() ? null : 'A non-empty value is required.'
}

function validUrl(value: string | number | boolean): string | null {
  if (typeof value !== 'string') return 'A URL is required.'
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? null : 'Only an HTTPS URL is allowed.'
  } catch {
    return 'A valid HTTPS URL is required.'
  }
}

export const operationRegistry: readonly OperationDescriptor[] = [
  {
    id: 'text_document.save_new', label: 'Save a new text document', applicationFamily: 'text_document', effect: 'local_write',
    transaction: transactionContract({
      capability: 'text_document.save_new',
      preconditions: ['authorized_fresh_document', 'exact_output_absent', 'document_content_readable'],
      authorizedEffect: 'create_exact_new_plain_text_file',
      phases: [
        'prepared', 'preconditions_established', 'effect_ui_requested', 'effect_ui_identified',
        'primary_field_identified', 'primary_field_verified', 'destination_ui_requested',
        'destination_ui_identified', 'destination_field_verified', 'effect_ui_restored',
        'commit_revalidated', 'commit_attempted', 'commit_observed', 'postcondition_verified', 'completed',
      ],
      commitPoint: 'commit_attempted', idempotency: 'conditionally_idempotent', postcondition: 'exact_new_file',
    }),
    parameters: [
      { id: 'target_document', label: 'Target document', type: 'resource', required: true, authorityImpact: 'selects_target', allowedSources: ['application_state'], missingStrategy: 'observe', validate: validNonempty },
      { id: 'filename', label: 'Filename', type: 'filename', required: true, authorityImpact: 'none', allowedSources: ['approved_goal', 'user_guidance', 'derived'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'destination_path', label: 'Save location', type: 'absolute_path', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'application_state', 'controller_default', 'derived'], missingStrategy: 'ask_user', validate: (value) => typeof value === 'string' ? validateNewTextFilePath(value) : 'A normalized absolute path is required.' },
      { id: 'overwrite', label: 'Overwrite policy', type: 'boolean', required: true, authorityImpact: 'none', allowedSources: ['approved_goal', 'user_guidance', 'controller_default'], missingStrategy: 'unavailable', defaultValue: false },
    ],
  },
  {
    id: 'browser.navigate', label: 'Navigate a browser', applicationFamily: 'browser', effect: 'read',
    transaction: transactionContract({
      capability: 'browser.navigate', preconditions: ['authorized_browser_window', 'validated_https_url'],
      authorizedEffect: 'navigate_authorized_window', commitPoint: 'commit_attempted',
      idempotency: 'idempotent', postcondition: 'exact_application_state',
    }),
    parameters: [
      { id: 'window', label: 'Browser window', type: 'resource', required: true, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'os_default', 'application_state'], missingStrategy: 'observe', validate: validNonempty },
      { id: 'profile', label: 'Browser profile', type: 'resource', required: false, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'application_state'], missingStrategy: 'ask_user' },
      { id: 'url', label: 'Address', type: 'url', required: true, authorityImpact: 'none', allowedSources: ['approved_goal', 'user_guidance', 'application_state', 'derived'], missingStrategy: 'revise_contract', validate: validUrl },
    ],
  },
  {
    id: 'spreadsheet.write_range', label: 'Write a spreadsheet range', applicationFamily: 'spreadsheet', effect: 'local_write',
    transaction: transactionContract({
      capability: 'spreadsheet.write_range', preconditions: ['authorized_workbook', 'exact_sheet_and_range'],
      authorizedEffect: 'write_exact_bound_range', commitPoint: 'commit_attempted',
      idempotency: 'conditionally_idempotent', postcondition: 'exact_application_state',
    }),
    parameters: [
      { id: 'workbook', label: 'Workbook', type: 'resource', required: true, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'application_state'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'sheet', label: 'Sheet', type: 'resource', required: true, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'application_state'], missingStrategy: 'observe', validate: validNonempty },
      { id: 'range', label: 'Cell range', type: 'resource', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance', 'application_state', 'derived'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'write_mode', label: 'Write mode', type: 'enumerated', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance', 'controller_default'], missingStrategy: 'ask_user', validate: validNonempty },
    ],
  },
  {
    id: 'email.send', label: 'Send email', applicationFamily: 'email', effect: 'external_write',
    transaction: transactionContract({
      capability: 'email.send', preconditions: ['authorized_account', 'exact_recipients_and_content'],
      authorizedEffect: 'send_one_exact_message', commitPoint: 'commit_attempted',
      idempotency: 'non_idempotent', postcondition: 'adapter_defined',
    }),
    parameters: [
      { id: 'account', label: 'Sending account', type: 'account', required: true, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'application_state'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'recipients', label: 'Recipients', type: 'recipient', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance'], missingStrategy: 'revise_contract', validate: validNonempty },
      { id: 'content', label: 'Message content', type: 'text', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance', 'derived'], missingStrategy: 'revise_contract', validate: validNonempty },
    ],
  },
  {
    id: 'calendar.create_event', label: 'Create calendar event', applicationFamily: 'calendar', effect: 'external_write',
    transaction: transactionContract({
      capability: 'calendar.create_event', preconditions: ['authorized_calendar', 'exact_time_and_attendees'],
      authorizedEffect: 'create_one_exact_event', commitPoint: 'commit_attempted',
      idempotency: 'non_idempotent', postcondition: 'adapter_defined',
    }),
    parameters: [
      { id: 'calendar', label: 'Calendar', type: 'resource', required: true, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'application_state'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'timezone', label: 'Time zone', type: 'enumerated', required: true, authorityImpact: 'none', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'os_default', 'application_state'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'start', label: 'Start time', type: 'text', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance'], missingStrategy: 'revise_contract', validate: validNonempty },
      { id: 'end', label: 'End time', type: 'text', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance', 'derived'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'attendees', label: 'Attendees', type: 'recipient', required: false, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance'], missingStrategy: 'ask_user' },
    ],
  },
  {
    id: 'file.move', label: 'Move a file', applicationFamily: 'file_manager', effect: 'local_write',
    transaction: transactionContract({
      capability: 'file.move', preconditions: ['exact_source_identity', 'authorized_destination_and_collision_policy'],
      authorizedEffect: 'move_exact_source_once', commitPoint: 'commit_attempted',
      idempotency: 'conditionally_idempotent', postcondition: 'adapter_defined',
    }),
    parameters: [
      { id: 'source', label: 'Source', type: 'absolute_path', required: true, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'application_state'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'destination', label: 'Destination', type: 'absolute_path', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'application_state'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'collision_policy', label: 'Collision policy', type: 'enumerated', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance'], missingStrategy: 'ask_user', validate: validNonempty },
    ],
  },
  {
    id: 'document.export', label: 'Export a document', applicationFamily: 'document', effect: 'local_write',
    transaction: transactionContract({
      capability: 'document.export', preconditions: ['authorized_source', 'exact_format_and_destination'],
      authorizedEffect: 'create_exact_export', commitPoint: 'commit_attempted',
      idempotency: 'conditionally_idempotent', postcondition: 'exact_new_file',
    }),
    parameters: [
      { id: 'source', label: 'Source document', type: 'resource', required: true, authorityImpact: 'selects_target', allowedSources: ['approved_goal', 'user_guidance', 'application_state'], missingStrategy: 'observe', validate: validNonempty },
      { id: 'format', label: 'Export format', type: 'enumerated', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance'], missingStrategy: 'ask_user', validate: validNonempty },
      { id: 'destination', label: 'Export destination', type: 'absolute_path', required: true, authorityImpact: 'external_effect', allowedSources: ['approved_goal', 'user_guidance', 'saved_preference', 'application_state'], missingStrategy: 'ask_user', validate: validNonempty },
    ],
  },
] as const

export function operationDescriptor(operationId: string): OperationDescriptor {
  const descriptor = operationRegistry.find((candidate) => candidate.id === operationId)
  if (!descriptor) throw new Error(`Unknown operation: ${operationId}`)
  return descriptor
}

/** Validate the physical capability boundary independently from authority.
 * Authorization is evaluated separately by the binding resolver. */
export function validateNewTextFilePath(candidate: string): string | null {
  const trimmed = candidate.trim()
  if (!trimmed || trimmed.length > 1_000 || !isAbsolute(trimmed) || resolve(trimmed) !== trimmed || /[\r\n\0]/u.test(trimmed)) {
    return 'The governed save command requires one normalized absolute file path.'
  }
  if (!/\.txt$/iu.test(trimmed) || basename(trimmed).startsWith('.')) {
    return 'The governed TextEdit save command creates one visible .txt file.'
  }
  if (existsSync(trimmed)) return 'Carve will not overwrite an existing file.'
  const parent = dirname(trimmed)
  if (!existsSync(parent) || !statSync(parent).isDirectory()) return 'The selected save folder does not exist.'
  const realParent = realpathSync(parent)
  if (/^\/(?:System|Library|Applications|usr|bin|sbin|etc)(?:\/|$)|^\/private\/(?:etc|var\/db)(?:\/|$)|\/(?:\.ssh|\.gnupg|\.aws|\.config)(?:\/|$)/u.test(realParent)) {
    return 'The governed save command cannot write in a protected or credential-bearing folder.'
  }
  return null
}

export function extractApprovedAbsoluteTextPath(goal: string): string | null {
  const candidates = goal.match(/\/(?:[^/\r\n]+\/)*[^/\r\n]+?\.txt\b/giu) ?? []
  for (const raw of candidates) {
    const candidate = raw.trim()
    // Extraction establishes only what the person said. Capability validity
    // (folder exists, no collision, no protected path) is a separate resolver
    // concern so an invalid approved path cannot silently fall back elsewhere.
    if (isAbsolute(candidate) && resolve(candidate) === candidate) return candidate
  }
  return null
}

export function extractRequestedTextFilename(goal: string): string | null {
  const quoted = goal.match(/["'`“‘]([^/"'`“”‘’\r\n]+\.txt)["'`”’]/iu)?.[1]
  const named = goal.match(/(?:filename(?:\s+is|\s*:)?|as|named|called)\s+["'`“‘]?([^/"'`“”‘’\r\n]+?\.txt)\b/iu)?.[1]
  const raw = quoted ?? named
  if (!raw) return null
  const filename = basename(raw.trim())
  return filename && !filename.startsWith('.') && /\.txt$/iu.test(filename) ? filename : null
}

export function suggestTextFileDestinations(filename: string): OperationBindingCandidate[] {
  const roots = [
    { folder: join(homedir(), 'Documents'), label: 'Documents' },
    { folder: join(homedir(), 'Desktop'), label: 'Desktop' },
  ]
  return roots.flatMap(({ folder, label }) => {
    const candidate = join(folder, filename)
    if (validateNewTextFilePath(candidate)) return []
    return [{
      operationId: 'text_document.save_new',
      parameterId: 'destination_path',
      type: 'absolute_path' as const,
      source: 'controller_default' as const,
      value: candidate,
      safeLabel: `Save in ${label}`,
      // A safe suggestion is still not authority to create a file there.
      authorized: false,
    }]
  })
}

function currentObjective(session: LiveComputerSession) {
  return session.ledger.objectives.find((objective) => objective.id === session.ledger.currentObjectiveId && objective.status === 'active')
    ?? session.ledger.objectives.find((objective) => objective.status === 'active')
    ?? null
}

/** Build the first concrete adapter integration on top of the generalized
 * resolver. Once TextEdit is the active authorized surface, a pending commit
 * is preflighted before preparatory input. This keeps an unresolved external
 * effect from consuming model calls or modifying the document first. */
export function activeLiveComputerOperationResolution(session: LiveComputerSession): OperationResolutionResult | null {
  const isTextEdit = session.target.bundleIdentifier === 'com.apple.TextEdit' || /textedit/iu.test(session.target.application)
  if (!isTextEdit) return null
  const active = currentObjective(session)
  const objective = active?.kind === 'perform_commit'
    ? active
    : session.ledger.objectives.find((candidate) => (
      candidate.kind === 'perform_commit'
      && candidate.status !== 'verified'
      && candidate.status !== 'failed'
      && (candidate.surfaceWindowId === null || candidate.surfaceWindowId === undefined || candidate.surfaceWindowId === session.target.windowId)
    )) ?? null
  if (!objective) return null
  const saveRequested = /\bsav(?:e|ing|ed)\b|\.txt\b/iu.test(`${objective.instruction} ${objective.targetState} ${session.goal}`)
  if (!saveRequested) return null

  const operationId = 'text_document.save_new'
  const activeTarget = session.targets.find((entry) => entry.target.windowId === session.target.windowId)
  const freshInputDocument = activeTarget?.source === 'fresh' && activeTarget.authority === 'input'
  const candidates: OperationBindingCandidate[] = [{
    operationId,
    parameterId: 'target_document',
    type: 'resource',
    source: 'application_state',
    value: `window:${session.target.windowId}`,
    safeLabel: `Fresh ${session.target.application} document`,
    authorized: freshInputDocument,
  }]
  const approvedPath = extractApprovedAbsoluteTextPath(session.goal)
  const priorDestination = (session.operationBindings ?? []).find((binding) => (
    binding.operationId === operationId
    && binding.parameterId === 'destination_path'
    && binding.status === 'resolved'
    && binding.authorized
    && typeof binding.value === 'string'
  ))
  const requestedFilename = extractRequestedTextFilename(session.goal)
  const filename = requestedFilename
    ?? (approvedPath ? basename(approvedPath) : null)
    ?? (typeof priorDestination?.value === 'string' ? basename(priorDestination.value) : null)
  if (filename) candidates.push({
    operationId, parameterId: 'filename', type: 'filename', source: requestedFilename || approvedPath ? 'approved_goal' : 'derived', value: filename,
    safeLabel: filename, authorized: true,
  })
  if (approvedPath) candidates.push({
    operationId, parameterId: 'destination_path', type: 'absolute_path', source: 'approved_goal', value: approvedPath,
    safeLabel: `Approved path ending in ${basename(approvedPath)}`, authorized: true,
  })
  for (const binding of session.operationBindings ?? []) {
    if (binding.operationId !== operationId || binding.status !== 'resolved' || binding.value === null) continue
    candidates.push({
      operationId,
      parameterId: binding.parameterId,
      type: binding.type,
      source: binding.source,
      value: binding.value,
      safeLabel: binding.safeLabel,
      authorized: binding.authorized,
    })
  }
  if (!approvedPath && !(session.operationBindings ?? []).some((binding) => binding.operationId === operationId && binding.parameterId === 'destination_path' && binding.status === 'resolved')) {
    if (filename) candidates.push(...suggestTextFileDestinations(filename))
  }
  const result = resolveOperationFeasibility({ descriptor: operationDescriptor(operationId), objectiveId: objective.id, candidates })
  if (!freshInputDocument) {
    result.feasibility.status = 'unavailable'
    result.feasibility.blockers = [blocker(
      operationId,
      'target_document',
      'unavailable',
      'The governed save operation is available only in a fresh input-authorized document Carve opened for this task.',
    )]
    result.feasibility.allowedNextSteps = ['handoff']
    result.choices = []
  }
  return result
}

/** A controller-generated question from typed feasibility. No model can
 * reinterpret the choices or manufacture an executable value. */
export function operationResolutionGuidance(result: OperationResolutionResult): {
  question: string
  context: string
  options: Array<{ id: string; label: string; consequence: string; mode: 'agent_continues' | 'person_takes_over' }>
} {
  const filename = result.feasibility.bindings.find((binding) => binding.parameterId === 'filename')?.value
  const boundedChoices = result.choices.slice(0, 3)
  return {
    question: result.feasibility.operationId === 'text_document.save_new'
      ? `Where should Carve save ${typeof filename === 'string' ? filename : 'the new text file'}?`
      : 'Which concrete target should Carve use for this operation?',
    context: result.feasibility.status === 'unavailable'
      ? 'The current application state cannot support this governed operation. Carve has paused before asking another AI model for an action or sending any input.'
      : result.feasibility.status === 'needs_contract_revision'
        ? 'The requested effect needs information that is outside the current approved contract. Carve has paused before asking another AI model for an action or sending any input.'
        : 'The requested effect needs a concrete, authorized target. Carve has paused before asking another AI model for an action or sending any input.',
    options: [
      ...boundedChoices.map((choice) => ({
        id: choice.optionId,
        label: choice.safeLabel,
        consequence: 'Use this exact target for this operation only, then continue under the existing safety boundaries.',
        mode: 'agent_continues' as const,
      })),
      {
        id: 'operation_take_over',
        label: 'I’ll handle this',
        consequence: 'Carve stops and returns control without performing the operation.',
        mode: 'person_takes_over' as const,
      },
    ],
  }
}
