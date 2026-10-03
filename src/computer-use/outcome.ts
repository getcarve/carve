/** Final-answer metadata, not an action language or independent verifier. */
export const computerOutcomeInstruction = 'When finished using the computer tool, return ONLY a JSON object with status ("completed", "partial", or "blocked"), message (your full user-facing answer), remaining (an array of unmet requirements; empty for completed), and title (a heading for the result card: at most six words and 40 characters, sentence case, naming what was done or found, for example "Track 1 down 3 dB" or "Gold’s atomic number: 79"; no trailing period, never a restatement of the request). Completed means you observed evidence that all requested outcomes were achieved. Use partial or blocked when you could not finish. This is your report, not independent verification. Do not put this metadata in documents or fields you edit.'

/**
 * The subject the person asked about is the subject you answer about.
 *
 * In one run, sent to a Wikipedia address carrying "Wikipedia does not have an
 * article with this exact name" and asked for a founding year, Carve answered
 * three times out of three about a different real subject — The Canary, then
 * Radio Carve, then Cave and Canary Guitars, the last from a guitar retailer's
 * own site. Every fact in all three answers was true. None of them said the
 * requested subject did not exist, and each printed a source address different
 * from the one it was given without remarking on it.
 *
 * Accuracy checking cannot catch this, because the facts are accurate. Only the
 * relevance is wrong, so the rule has to be stated to the actor directly.
 */
export const subjectFidelityInstruction = 'Answer about the subject the person asked about, never a similar one. If the page you were given does not contain that subject — it is missing, empty, renamed, or says no such article exists — report that plainly as your answer. Do not substitute a different subject whose name merely resembles it, and do not quietly answer from a different page or site instead. Leaving the given page is fine when the task needs it, but if your answer comes from anywhere other than the resource the request named, say so in your message and name where it came from. A true fact about the wrong subject is a wrong answer.'

export function readComputerOutcome(text: string | null): {
  status: 'completed' | 'partial' | 'blocked' | 'unclassified'
  message: string
  remaining: string[]
  /** The model's heading for the result card, when it gave one. Display only; never authority. */
  title?: string
} {
  // The report is accepted only as the exact three-field object, plus one
  // optional title. Some models wrap it in a fenced block or restate the
  // answer in prose first; the candidates are the whole text, the last fenced
  // block, and the last top-level object, each held to the same shape.
  for (const candidate of reportCandidates(text ?? '')) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const v = value as Record<string, unknown>
        const keys = Object.keys(v)
        const titled = keys.length === 4 && 'title' in v && typeof v.title === 'string'
        if ((keys.length === 3 || titled) && ['completed', 'partial', 'blocked'].includes(String(v.status))
          && typeof v.message === 'string' && v.message.trim().length > 0 && v.message.length <= 100_000
          && Array.isArray(v.remaining) && v.remaining.length <= 100
          && v.remaining.every((item: unknown) => typeof item === 'string' && item.trim().length > 0 && item.length <= 10_000)
          && (v.status !== 'completed' || v.remaining.length === 0)) {
          const title = titled ? reportTitle(v.title as string) : null
          // A report whose message is itself a whole report (a verifier's
          // edit that restated the envelope) reads as its inner message; a
          // limited inner report is never upgraded by a completed outer one.
          const inner = v.message.trimStart().startsWith('{') ? readComputerOutcome(v.message) : null
          if (inner && inner.status !== 'unclassified') {
            const limited = v.status === 'completed' && inner.status !== 'completed'
            return { status: limited ? inner.status : v.status as 'completed' | 'partial' | 'blocked', message: inner.message,
              remaining: limited ? inner.remaining : v.remaining as string[], ...(title ? { title } : inner.title ? { title: inner.title } : {}) }
          }
          return { status: v.status as 'completed' | 'partial' | 'blocked', message: v.message, remaining: v.remaining, ...(title ? { title } : {}) }
        }
      }
    } catch { /* Preserve the answer without inventing a success claim. */ }
  }
  return { status: 'unclassified', message: text?.trim() || 'The model returned no final answer.', remaining: [] }
}

/** One line, bounded, no trailing punctuation; empty when the model left it empty. */
function reportTitle(value: string): string | null {
  const title = value.replace(/[\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[.!?:;,]+$/u, '').slice(0, 80)
  return title.length > 0 ? title : null
}

function reportCandidates(text: string): string[] {
  const candidates = [text.trim()]
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gu)]
  const lastFenced = fenced.at(-1)?.[1]?.trim()
  if (lastFenced) candidates.push(lastFenced)
  const lastObject = lastTopLevelObject(text)
  if (lastObject) candidates.push(lastObject)
  return candidates
}

/** The last balanced `{…}` in the text, string-aware so braces inside quoted values do not split it. */
function lastTopLevelObject(text: string): string | null {
  let end = text.lastIndexOf('}')
  while (end >= 0) {
    let depth = 0
    let inString = false
    for (let index = end; index >= 0; index--) {
      const character = text[index]
      if (inString) {
        if (character === '"' && text[index - 1] !== '\\') inString = false
        continue
      }
      if (character === '"') inString = true
      else if (character === '}') depth++
      else if (character === '{' && --depth === 0) return text.slice(index, end + 1)
    }
    end = text.lastIndexOf('}', end - 1)
  }
  return null
}
