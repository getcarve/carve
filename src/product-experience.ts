/** The desktop release has one focused experience. The workbench retains
 * development and existing experimental workflows without migrating data. */
import type { LiveComputerAction } from './types.js'

export type ProductExperience = 'copilot' | 'workbench'
export type ProductPageId = 'overview' | 'learn' | 'recall' | 'review' | 'procedures' | 'work' | 'history' | 'lab' | 'audit' | 'settings'

const copilotPages: readonly ProductPageId[] = ['overview', 'work', 'history', 'settings']

/** Sidebar visibility and navigation share the release boundary. */
export function isPageAvailable(product: { experience?: ProductExperience }, page: ProductPageId): boolean {
  return !isCopilot(product) || copilotPages.includes(page)
}

export function resolveProductPage(product: { experience?: ProductExperience }, page: ProductPageId): ProductPageId {
  return isPageAvailable(product, page) ? page : 'overview'
}

export function productExperience(value: string | undefined): ProductExperience {
  return value === 'workbench' ? 'workbench' : 'copilot'
}

export function isCopilot(product: { experience?: ProductExperience }): boolean {
  return product.experience !== 'workbench'
}

/** Additional release boundary on top of the controller's ordinary grounding
 * and effect checks. It never grants authority to an otherwise rejected step. */
export function assertCopilotAction(action: Pick<LiveComputerAction, 'risk' | 'kind'>): void {
  if (action.risk === 'sensitive' || action.risk === 'irreversible') {
    throw new Error('This step needs your direct control. Complete the sensitive or irreversible action yourself, then ask Carve for the next step.')
  }
  if (action.kind === 'request_window' || action.kind === 'switch_window') {
    throw new Error('This task is limited to one window. Finish it before starting work in another window.')
  }
}
