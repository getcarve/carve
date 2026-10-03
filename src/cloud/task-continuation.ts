import { randomUUID } from 'node:crypto'
import { CloudError, type CarveCloudClient } from './client.js'

interface Settings { getSetting(key: string): string | null; setSetting(key: string, value: string): void }
/** Funding at an existing budget boundary, without adding model calls or
 * approval stages to the thin execution loop. */
export async function fundTaskContinuation(store: Settings, cloud: Pick<CarveCloudClient, 'continueTask' | 'baseUrl'>, taskId: string, checkpointId: string): Promise<void> {
  const key = `cloud.continuation.v1.${cloud.baseUrl}.${taskId}.${checkpointId}`
  const prior = store.getSetting(key)
  const receipt = prior ? JSON.parse(prior) as { decisionId: string; state: string } : { decisionId: randomUUID(), state: 'pending' }
  if (typeof receipt.decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(receipt.decisionId) || !['pending', 'funded'].includes(receipt.state)) throw new Error('The funding receipt needs review. No additional allowance was requested.')
  if (receipt.state === 'funded') return
  store.setSetting(key, JSON.stringify(receipt))
  try {
    const task = await cloud.continueTask(taskId, receipt.decisionId)
    if (task.id !== taskId || task.status !== 'open') throw new Error('This cloud task is no longer open. Review the saved work before continuing.')
    store.setSetting(key, JSON.stringify({ ...receipt, state: 'funded' }))
  } catch (error) {
    // Only this typed refusal proves nothing was debited. A later approval
    // after adding allowance may start a new decision; ambiguous retries cannot.
    if (error instanceof CloudError && error.code === 'continuation_unfunded') store.setSetting(key, '')
    throw error
  }
}
