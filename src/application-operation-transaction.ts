import type {
  ApplicationOperationFailure,
  ApplicationOperationFailureCode,
  ApplicationOperationRetryEligibility,
  ApplicationOperationTransactionPhase,
  ApplicationOperationTransactionReceipt,
  LiveComputerFailureCause,
  LiveComputerOperationBinding,
  LiveComputerTerminalCategory,
} from './types.js'
import { dirname, isAbsolute } from 'node:path'
import { sha256, stableJson } from './util.js'

const phaseOrder: readonly ApplicationOperationTransactionPhase[] = [
  'prepared',
  'preconditions_established',
  'effect_ui_requested',
  'effect_ui_identified',
  'primary_field_identified',
  'primary_field_verified',
  'destination_ui_requested',
  'destination_ui_identified',
  'destination_field_verified',
  'effect_ui_restored',
  'commit_revalidated',
  'commit_attempted',
  'commit_observed',
  'postcondition_verified',
  'completed',
  'failed',
] as const

const preCommitRetryable = new Set<ApplicationOperationFailureCode>([
  'precondition_not_established',
  'authorized_window_lost',
  'dialog_not_found',
  'dialog_identity_ambiguous',
  'element_identity_ambiguous',
  'field_mutation_rejected',
  'field_readback_mismatch',
  'commit_not_attempted',
  'environment_unavailable',
])

const auditSafeBindingTypes = new Set<LiveComputerOperationBinding['type']>([
  'application',
  'boolean',
  'enumerated',
  'filename',
])

/** Model prose can echo an authorized path, recipient, account, URL, or text
 * value even when the structured operation receipt is hash-only. Redact those
 * exact controller-owned values before generic computer events become durable;
 * the unredacted prose remains ephemeral for the bounded repair loop. */
export function privacySafeOperationAuditText(
  value: string | null,
  bindings: readonly LiveComputerOperationBinding[] = [],
  additionalSensitiveValues: readonly (string | null | undefined)[] = [],
): string | null {
  if (value === null) return null
  const sensitive = new Set<string>()
  for (const binding of bindings) {
    if (auditSafeBindingTypes.has(binding.type) || typeof binding.value !== 'string') continue
    const raw = binding.value.trim()
    if (raw.length > 0) sensitive.add(raw)
    if (binding.type === 'absolute_path' && isAbsolute(raw)) {
      const parent = dirname(raw)
      if (parent.length > 1) sensitive.add(parent)
    }
  }
  for (const candidate of additionalSensitiveValues) {
    const raw = candidate?.trim()
    if (!raw) continue
    sensitive.add(raw)
    if (isAbsolute(raw)) {
      const parent = dirname(raw)
      if (parent.length > 1) sensitive.add(parent)
    }
  }
  let safe = value
  for (const raw of [...sensitive].sort((left, right) => right.length - left.length)) {
    safe = safe.replaceAll(raw, `[private operation value:${sha256(raw).slice(0, 12)}]`)
  }
  return safe
}

/** Recursive companion for event payloads whose model-authored prose can sit
 * inside evidence arrays or nested receipts. Keys and non-string telemetry are
 * preserved exactly. */
export function privacySafeOperationAuditDetails(
  details: Record<string, unknown>,
  bindings: readonly LiveComputerOperationBinding[] = [],
  additionalSensitiveValues: readonly (string | null | undefined)[] = [],
): Record<string, unknown> {
  const redact = (candidate: unknown): unknown => {
    if (typeof candidate === 'string') {
      return privacySafeOperationAuditText(candidate, bindings, additionalSensitiveValues)
    }
    if (Array.isArray(candidate)) return candidate.map(redact)
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(Object.entries(candidate).map(([key, nested]) => [key, redact(nested)]))
    }
    return candidate
  }
  return redact(details) as Record<string, unknown>
}

/** Retry policy is computed from physical commit evidence, never an error
 * message. Before commit, only the failed phase may be retried after a fresh
 * observation. At or after commit, input is permanently barred. */
export function applicationOperationRetryEligibility(input: {
  code: ApplicationOperationFailureCode
  commitAttempted: boolean
  effectMayHaveOccurred: boolean
}): ApplicationOperationRetryEligibility {
  if (input.effectMayHaveOccurred || input.commitAttempted) {
    return input.code === 'authority_safety_violation' ? 'none' : 'observe_only'
  }
  if (input.code === 'authority_safety_violation' || input.code === 'provider_failure') return 'none'
  return preCommitRetryable.has(input.code) ? 'safe_phase_retry' : 'handoff'
}

export function applicationOperationFailure(input: {
  code: ApplicationOperationFailureCode
  phase: ApplicationOperationTransactionPhase
  message: string
  commitAttempted: boolean
  effectMayHaveOccurred: boolean
  evidenceKey: string
}): ApplicationOperationFailure {
  const message = input.message.trim().slice(0, 500)
  return {
    code: input.code,
    phase: input.phase,
    message,
    fingerprint: sha256(stableJson({ code: input.code, phase: input.phase, evidenceKey: input.evidenceKey })),
    retryEligibility: applicationOperationRetryEligibility(input),
  }
}

export interface ApplicationOperationRecoveryClassification {
  failureCause: LiveComputerFailureCause
  terminalCategory: LiveComputerTerminalCategory
  disposition: 'retry_same_objective' | 'reground' | 'handoff'
  staleExternalBindings: boolean
  mayRepeatInput: boolean
}

/** Preserve causal truth when projecting adapter failures into the existing
 * live-computer recovery vocabulary. Provider and safety failures never share
 * the application-environment bucket. */
export function classifyApplicationOperationFailure(
  failure: ApplicationOperationFailure,
  commit: ApplicationOperationTransactionReceipt['commit'],
): ApplicationOperationRecoveryClassification {
  if (failure.code === 'provider_failure') {
    return {
      failureCause: 'provider_unavailable', terminalCategory: 'provider_error', disposition: 'handoff',
      staleExternalBindings: false, mayRepeatInput: false,
    }
  }
  if (failure.code === 'authority_safety_violation') {
    return {
      failureCause: 'policy_violation', terminalCategory: 'safety_block', disposition: 'handoff',
      staleExternalBindings: true, mayRepeatInput: false,
    }
  }
  if (commit.effectMayHaveOccurred || failure.code === 'effect_may_have_occurred_unverified') {
    return {
      failureCause: 'operation_effect_uncertain', terminalCategory: 'environment_error', disposition: 'handoff',
      staleExternalBindings: true, mayRepeatInput: false,
    }
  }
  if (failure.code === 'exact_postcondition_failed') {
    return {
      failureCause: 'operation_postcondition_failed', terminalCategory: 'environment_error', disposition: 'handoff',
      staleExternalBindings: true, mayRepeatInput: false,
    }
  }
  if (failure.code === 'authorized_window_lost') {
    return {
      failureCause: 'resource_identity_mismatch', terminalCategory: null, disposition: 'reground',
      staleExternalBindings: false, mayRepeatInput: failure.retryEligibility === 'safe_phase_retry',
    }
  }
  if (failure.code === 'dialog_identity_ambiguous' || failure.code === 'element_identity_ambiguous') {
    return {
      failureCause: 'control_ambiguous', terminalCategory: null, disposition: 'reground',
      staleExternalBindings: false, mayRepeatInput: failure.retryEligibility === 'safe_phase_retry',
    }
  }
  if (failure.code === 'environment_unavailable') {
    return {
      failureCause: 'environment_lost', terminalCategory: 'environment_error', disposition: 'handoff',
      staleExternalBindings: false, mayRepeatInput: false,
    }
  }
  return {
    failureCause: failure.code === 'field_readback_mismatch' ? 'field_acceptance_unknown' : 'input_not_accepted',
    terminalCategory: null,
    disposition: 'retry_same_objective',
    staleExternalBindings: false,
    mayRepeatInput: failure.retryEligibility === 'safe_phase_retry',
  }
}

export function validateApplicationOperationReceipt(
  receipt: ApplicationOperationTransactionReceipt,
  expected: {
    transactionId: string
    operationId: string
    targetSha256: string
    parameterBindingsSha256: string
    windowId: number | null
  },
): void {
  if (receipt.version !== 1 || receipt.adapterVersion < 1 || !receipt.adapterId || !receipt.capability) {
    throw new Error('The application adapter returned an unsupported transaction receipt')
  }
  if (receipt.transactionId !== expected.transactionId || receipt.operationId !== expected.operationId) {
    throw new Error('The application adapter receipt belongs to a different operation transaction')
  }
  if (receipt.parameterBindingsSha256 !== expected.parameterBindingsSha256
    || receipt.authorizedEffect.targetSha256 !== expected.targetSha256
    || receipt.postcondition.targetSha256 !== expected.targetSha256
    || receipt.target.windowId !== expected.windowId) {
    throw new Error('The application adapter receipt does not match the controller-authorized effect')
  }
  if (!Number.isInteger(receipt.commit.attemptCount) || receipt.commit.attemptCount < 0 || receipt.commit.attemptCount > 1) {
    throw new Error('The application adapter violated the single-commit invariant')
  }
  if (receipt.commit.attempted !== (receipt.commit.attemptCount === 1)
    || receipt.commit.accepted && !receipt.commit.attempted
    || receipt.commit.effectMayHaveOccurred && !receipt.commit.attempted) {
    throw new Error('The application adapter returned contradictory commit evidence')
  }
  let previousIndex = -1
  for (const phase of receipt.phases) {
    const index = phaseOrder.indexOf(phase.phase)
    if (index < 0 || index < previousIndex || phase.observation < 0 || !Number.isInteger(phase.observation)) {
      throw new Error('The application adapter returned an invalid phase history')
    }
    if (phase.mutation === 'commit' && phase.phase !== 'commit_attempted') {
      throw new Error('The application adapter recorded a commit outside the commit phase')
    }
    previousIndex = index
  }
  if (receipt.status === 'completed') {
    if (receipt.failure || receipt.phase !== 'completed' || !receipt.preconditions.established
      || !receipt.commit.accepted || !receipt.postcondition.satisfied
      || receipt.postcondition.outputKind !== 'regular_file'
      || receipt.idempotency.replayAllowed || receipt.idempotency.duplicateEffectRisk !== 'none') {
      throw new Error('The application adapter claimed completion without exact committed postcondition evidence')
    }
  } else {
    if (!receipt.failure || receipt.postcondition.satisfied) {
      throw new Error('The application adapter failure receipt is missing its structured failure')
    }
    const expectedEligibility = applicationOperationRetryEligibility({
      code: receipt.failure.code,
      commitAttempted: receipt.commit.attempted,
      effectMayHaveOccurred: receipt.commit.effectMayHaveOccurred,
    })
    if (receipt.failure.retryEligibility !== expectedEligibility
      || receipt.idempotency.replayAllowed !== (expectedEligibility === 'safe_phase_retry')) {
      throw new Error('The application adapter receipt conflicts with controller retry policy')
    }
  }
}

/** Durable projection intentionally excludes messages, raw identities, and
 * parameter values. It is safe for ordinary audit summaries. */
export function applicationOperationAuditSummary(receipt: ApplicationOperationTransactionReceipt) {
  return {
    version: receipt.version,
    transactionId: receipt.transactionId,
    operationId: receipt.operationId,
    adapterId: receipt.adapterId,
    adapterVersion: receipt.adapterVersion,
    capability: receipt.capability,
    status: receipt.status,
    phase: receipt.phase,
    parameterBindingsSha256: receipt.parameterBindingsSha256,
    targetSha256: receipt.authorizedEffect.targetSha256,
    overwriteAuthorized: receipt.authorizedEffect.overwriteAuthorized,
    preconditionsEstablished: receipt.preconditions.established,
    outputPriorState: receipt.preconditions.outputPriorState,
    expectedContentSha256: receipt.preconditions.expectedContentSha256,
    phaseCount: receipt.phases.length,
    commit: receipt.commit,
    idempotency: receipt.idempotency,
    postcondition: receipt.postcondition,
    failure: receipt.failure ? {
      code: receipt.failure.code,
      phase: receipt.failure.phase,
      fingerprint: receipt.failure.fingerprint,
      retryEligibility: receipt.failure.retryEligibility,
    } : null,
  }
}
