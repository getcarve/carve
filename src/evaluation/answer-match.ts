function normalizeAnswerText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    // Presentation punctuation between words is not semantic evidence. Keep
    // punctuation embedded in numeric identities (5-2, INV-103) intact while
    // accepting harmless renderings such as "Delivered — Tuesday".
    .replace(/(?<=\p{L})[\p{Pd}:;,|/]+(?=\p{L})/gu, ' ')
    .replace(/\s+[\p{Pd}:;,|/]+\s+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value)
}

function containsPhraseAtBoundaries(answer: string, phrase: string): boolean {
  let start = answer.indexOf(phrase)
  while (start !== -1) {
    const end = start + phrase.length
    const startsCleanly = !isWordCharacter(phrase[0]) || !isWordCharacter(answer[start - 1])
    const endsCleanly = !isWordCharacter(phrase.at(-1)) || !isWordCharacter(answer[end])
    if (startsCleanly && endsCleanly) return true
    start = answer.indexOf(phrase, start + 1)
  }
  return false
}

/** Deterministic fixture grading stays strict while allowing explicitly
 * reviewed phrasings of the same fact. This avoids a model grader and prevents
 * an open-ended semantic matcher from converting wrong answers into passes. */
export function answerContainsExpectedPhrase(answer: string, acceptedPhrases: readonly string[]): boolean {
  if (acceptedPhrases.length === 0) throw new Error('At least one accepted answer phrase is required')
  const normalizedAnswer = normalizeAnswerText(answer)
  const normalizedPhrases = acceptedPhrases.map((phrase) => normalizeAnswerText(phrase))
  if (normalizedPhrases.some((phrase) => !phrase)) throw new Error('Accepted answer phrases must not be empty')
  return normalizedPhrases.some((phrase) => containsPhraseAtBoundaries(normalizedAnswer, phrase))
}
