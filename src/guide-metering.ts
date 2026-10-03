import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

const questions = new AsyncLocalStorage<string>()
export const guideQuestionId = (): string | undefined => questions.getStore()
/** Retries, interpretation, answer and review share the user's allowance unit. */
export function withGuideQuestion<T>(action: () => T): T {
  return questions.getStore() ? action() : questions.run(randomUUID(), action)
}
