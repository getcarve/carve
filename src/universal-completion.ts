import { liveComputerGoalClauses, taskTerms } from './live-computer-planning.js'
import type { UniversalComputerSession } from './types.js'

/** Turns model-authored completion copy into calm, readable UI text. Results
 * are always rendered as text (never HTML); this additionally removes common
 * Markdown furniture and shortens bare URLs so the result does not look like
 * a debug payload. Main-window surfaces can preserve intentional line breaks,
 * while the compact capsule requests a single flowing paragraph. */
export function cleanCompletionResultText(
  terminal: string,
  maximumCharacters: number | null = 600,
  preserveLineBreaks = false,
  preserveInlineMarkdown = false,
): string | null {
  if (!terminal.trim()) return null
  const compactUrl = (raw: string) => {
    const trailing = raw.match(/[.,;:!?]+$/u)?.[0] ?? ''
    const candidate = trailing ? raw.slice(0, -trailing.length) : raw
    try {
      const parsed = new URL(candidate)
      const path = parsed.pathname === '/' ? '' : decodeURI(parsed.pathname)
      return `${parsed.hostname.replace(/^www\./u, '')}${path}${trailing}`
    } catch {
      return raw
    }
  }
  const withoutImages = terminal.trim().replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
  const linked = (preserveInlineMarkdown
    ? withoutImages
    : withoutImages.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/giu, '$1'))
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s*[-+*]\s+/gmu, '• ')
    .replace(/https?:\/\/[^\s]+/giu, raw => preserveInlineMarkdown ? raw : compactUrl(raw))
  const inline = preserveInlineMarkdown
    ? linked
      .replace(/__([^_\n]+)__/gu, '**$1**')
      .replace(/_([^_\n]+)_/gu, '*$1*')
      .replace(/`([^`\n]+)`/gu, '$1')
      .replace(/~~([^~\n]+)~~/gu, '$1')
    : linked
      .replace(/__([^_]+)__/gu, '$1')
      .replace(/_([^_\n]+)_/gu, '$1')
      .replace(/[*`~]/gu, '')
  const plain = inline
    .replace(/[ \t]+$/gmu, '')
    .replace(preserveLineBreaks ? /\n{3,}/gu : /[ \t]*\n[ \t]*/gu, preserveLineBreaks ? '\n\n' : ' ')
    .replace(preserveLineBreaks ? /[ \t]{2,}/gu : /\s{2,}/gu, ' ')
    .trim()
  if (!plain) return null
  if (maximumCharacters === null || plain.length <= maximumCharacters) return plain
  return `${plain.slice(0, maximumCharacters).replace(/\s+\S*$/u, '')}…`
}

export function universalComputerCompletionResult(
  session: UniversalComputerSession,
  maximumCharacters: number | null = 600,
  preserveLineBreaks = false,
  preserveInlineMarkdown = false,
): string | null {
  if (session.status !== 'completed' || !session.terminalText) return null
  return cleanCompletionResultText(session.completionAnswer?.answer ?? session.terminalText, maximumCharacters, preserveLineBreaks, preserveInlineMarkdown)
}

/** A small, deterministic copy choice—not a semantic claim. Question-shaped
 * and information-seeking goals say “Answer ready”; everything else says
 * “Done,” while both display the same model-reported terminal result. */
export function universalComputerCompletionKind(goal: string): 'answer' | 'action' {
  const normalized = goal.trim().toLocaleLowerCase()
  if (/\?\s*$/u.test(normalized)) return 'answer'
  if (/^(?:what|who|when|where|why|how|which|find|look up|research|summarize|list|tell me|show me|give me|check whether|check if)\b/u.test(normalized)) return 'answer'
  return 'action'
}

/**
 * Whether a Universal session's model-reported completion actually covers
 * every clause of the approved request. Universal mode has no per-objective
 * verifier, so completion was the provider's word alone: on 2026-09-03 a
 * two-application request ended "Done" with the terminal text itself
 * admitting that the second application was never touched. The assessment
 * is deterministic and reads only the request and the report; it never
 * widens authority, and an unmet clause becomes a named handoff.
 */
export interface UniversalClauseAssessment {
  id: string
  text: string
  status: 'reported' | 'unmet' | 'unknown'
  evidence: string | null
}

export interface UniversalCompletionAssessment {
  clauses: UniversalClauseAssessment[]
  unmet: string[]
  complete: boolean
}

const inabilityPattern = /\b(?:could\s*n[o']t|cannot|can\s*not|unable\s+to|was\s+not\s+able|not\s+able\s+to|did\s+not|didn['’]t|wasn['’]t\s+able|is\s+restricted\s+to|restricted\s+to|not\s+possible|no\s+access|(?:has|have|had)\s+not\s+been\s+(?:opened|saved|created|written|sent|completed)|(?:is|was|were|are)\s+not\s+(?:opened|saved|created|written|sent|completed))\b/iu

const genericTerms = new Set(['then', 'into', 'that', 'this', 'with', 'from', 'open', 'new', 'fresh', 'window', 'look', 'tell', 'first', 'source', 'article', 'page', 'document', 'it'])

function discriminativeTerms(text: string): string[] {
  return taskTerms(text).filter((term) => term.length > 3 && !genericTerms.has(term))
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/u).map((entry) => entry.trim()).filter(Boolean)
}

/** The admission itself, without its explanation: "I could not edit TextEdit
 * because this session is restricted to the Chrome window" names TextEdit as
 * undone, not Chrome. */
function admissionPart(sentence: string): string {
  return sentence.split(/\b(?:because|since|as\s+(?:this|the|it)|due\s+to|so\s+that)\b/iu)[0] ?? sentence
}

export function assessUniversalCompletion(goal: string, terminalText: string | null): UniversalCompletionAssessment {
  const report = (terminalText ?? '').trim()
  const admissions = sentences(report).filter((sentence) => inabilityPattern.test(sentence)).map(admissionPart)
  const reportTerms = new Set(discriminativeTerms(report))
  const clauses = liveComputerGoalClauses(goal).map((clause): UniversalClauseAssessment => {
    const terms = discriminativeTerms(clause.text)
    if (terms.length === 0) return { id: clause.id, text: clause.text, status: 'unknown', evidence: null }
    const admitted = admissions.find((admission) => {
      const admissionTerms = new Set(discriminativeTerms(admission))
      return terms.some((term) => admissionTerms.has(term))
    })
    if (admitted) return { id: clause.id, text: clause.text, status: 'unmet', evidence: admitted.trim().slice(0, 240) }
    const overlap = terms.filter((term) => reportTerms.has(term)).length / terms.length
    return { id: clause.id, text: clause.text, status: overlap >= 0.34 ? 'reported' : 'unknown', evidence: null }
  })
  const unmet = clauses.filter((clause) => clause.status === 'unmet').map((clause) => clause.text)
  return { clauses, unmet, complete: unmet.length === 0 }
}
