import type { RecallScopeInput } from './desktop-contract.js'

export interface RecallConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  scope: RecallScopeInput | null
  messageCount: number
}

export interface RecallConversationMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** Stored derived result so a reopened chat can restore its evidence view. */
  result: Record<string, unknown> | null
}

export interface RecallConversation extends RecallConversationSummary {
  messages: RecallConversationMessage[]
}

export interface RecallConversationContextMessage {
  role: 'user' | 'assistant'
  content: string
}

/** A useful local title without spending a model call or disclosing the prompt. */
export function recallConversationTitle(question: string): string {
  const compact = question.trim().replace(/\s+/gu, ' ')
  if (compact.length <= 64) return compact
  return `${compact.slice(0, 61).trimEnd()}…`
}

/**
 * Only clearly dependent follow-ups borrow search terms from the previous user
 * turn. New topics stay new topics, while “tell me more” and pronoun-only turns
 * do not collapse into empty retrievals.
 */
export function contextualRecallQuestion(question: string, history: RecallConversationMessage[]): string {
  const current = question.trim()
  const dependent = /^(and\b|also\b|what about\b|how about\b|tell me more\b|why\b|when\b|where\b|how many\b|how much\b|how often\b)|\b(it|that|those|them|they|this|these|the other one|same one)\b/iu.test(current)
  if (!dependent) return current
  const previous = [...history].reverse().find((message) => message.role === 'user')?.content.trim()
  return previous ? `${current}\nPrevious question in this conversation: ${previous}` : current
}

export function recallConversationContext(history: RecallConversationMessage[], limit = 12): RecallConversationContextMessage[] {
  return history.slice(-limit).map(({ role, content }) => ({ role, content }))
}
