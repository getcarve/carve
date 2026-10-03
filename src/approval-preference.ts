import type { SupervisionPreset } from './types.js'
export type ApprovalPreset = Extract<SupervisionPreset, 'fast' | 'smart_checkpoints' | 'step_by_step'>
export const approvalPreferenceKey = 'computer.approvals.v1'
export const approvalOptions: ReadonlyArray<{ value: ApprovalPreset; label: string; description: string }> = [
  { value: 'fast', label: 'Act directly', description: 'Start right away. Pause when an action needs approval.' },
  { value: 'smart_checkpoints', label: 'Review plan first', description: 'Approve the approach once. Carve asks again for new scope or protected actions.' },
  { value: 'step_by_step', label: 'Approve each change', description: 'Review the plan, then approve each change with its preparation included.' },
]
export function isApprovalPreset(value: unknown): value is ApprovalPreset { return approvalOptions.some(option => option.value === value) }
export function approvalPreference(value: unknown): ApprovalPreset { return isApprovalPreset(value) ? value : 'fast' }
