/**
 * What happened when captures were read, phrased once so every surface that
 * offers the action reports the same thing.
 *
 * The first version folded two facts into one clause and produced "Nothing new
 * to read, 4 held no text" — which reads as a contradiction, and never answers
 * the only question the reader has: is anything findable now that was not
 * findable before. Settings had a second copy that was worse, claiming every
 * capture had already been read immediately after reading four of them.
 */
export interface ReadOutcome {
  enriched: number
  empty: number
  redactions: string[]
}

export function readOutcomeMessage(outcome: ReadOutcome): { message: string; tone: 'positive' | 'neutral' } {
  const hidden = outcome.redactions.length > 0
    ? ` Text that looked like ${[...new Set(outcome.redactions)].join(' and ')} was hidden before storing.`
    : ''

  if (outcome.enriched > 0) {
    const blanks = outcome.empty > 0
      ? ` ${outcome.empty} ${outcome.empty === 1 ? 'was blank' : 'were blank'} and had nothing to read.`
      : ''
    return {
      message: `${outcome.enriched} capture${outcome.enriched === 1 ? '' : 's'} can now be searched by what was on the screen.${blanks}${hidden}`,
      tone: 'positive',
    }
  }

  // Work happened and nothing was gained. Saying why is the whole message.
  if (outcome.empty > 0) {
    return {
      message: outcome.empty === 1
        ? 'That capture was blank, so nothing new became searchable. It will not be offered again.'
        : `All ${outcome.empty} captures were blank, so nothing new became searchable. They will not be offered again.`,
      tone: 'neutral',
    }
  }

  return { message: 'Every capture had already been read.', tone: 'neutral' }
}
