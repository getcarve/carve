import type { LivePublicLookup } from '../../src/task-method'
import { ArrowUpRight, Globe2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { invoke } from './api'
import type { PublicLookupEvidence } from '../../src/public-web'

/** React escapes source text; no provider HTML or Markdown is executed. */
export function PublicLookupAnswer({ evidence, runId, showSources = false }: { evidence: PublicLookupEvidence; runId?: string | undefined; showSources?: boolean }) {
  const [failure, setFailure] = useState<string | null>(null)
  const openSource = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    if (!window.stewardDesktop) return
    event.preventDefault()
    if (!runId) { setFailure('The source run is unavailable.'); return }
    setFailure(null)
    void invoke({ kind: 'work.public_source.open', runId, url }).catch(error => setFailure(String(error)))
  }
  const content: ReactNode[] = []
  let cursor = 0
  for (const [index, citation] of evidence.citations.entries()) {
    content.push(evidence.answer.slice(cursor, citation.start))
    content.push(<a className="answer-citation" key={index} href={citation.url} target="_blank" rel="noopener noreferrer" title={citation.title} aria-label={`Source ${index + 1}: ${citation.title}`} onClick={event => openSource(event, citation.url)}>{index + 1}</a>)
    cursor = citation.end
  }
  content.push(evidence.answer.slice(cursor))
  const sources = evidence.citations.filter((citation, index, all) => all.findIndex(other => other.url === citation.url) === index)
  return <span className="public-answer"><span className="public-answer__text">{content}</span>{showSources ? <span className="answer-sources">
    <span className="answer-sources__label">Sources <span>{sources.length}</span></span>
    <span className="answer-sources__list">{sources.map(citation => <a className="answer-source" key={citation.url} href={citation.url} target="_blank" rel="noopener noreferrer" onClick={event => openSource(event, citation.url)}>
      <span className="answer-source__icon"><Globe2 size={18} /></span>
      <span className="answer-source__copy"><strong>{citation.title}</strong><span>{new URL(citation.url).hostname.replace(/^www\./u, '')}</span></span>
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>)}</span>
  </span> : null}{failure ? <span role="alert">{failure}</span> : null}</span>
}

/** What was checked, in the person's terms (source-support.ts). */
export function supportNote(evidence: PublicLookupEvidence): string {
  if (evidence.verification === 'source_supported') return 'Each fact was found on the cited page.'
  if (evidence.verification === 'source_revised') return 'The cited page did not support the first answer; this is what it does show.'
  if (evidence.verification === 'source_unconfirmed') return 'Carve could not check this against the cited page.'
  return 'Source citations checked; facts are not independently verified.'
}

export function PublicLookupReceipts({ lookups = [], runId }: { lookups?: LivePublicLookup[] | undefined; runId?: string | undefined }) {
  if (!lookups.length) return null
  return <details><summary>Public lookups ({lookups.length})</summary>{lookups.map(lookup => <div key={lookup.id}>
    <p><strong>{lookup.query}</strong></p>
    {lookup.evidence ? <><PublicLookupAnswer runId={runId} evidence={lookup.evidence} /><small> Retrieved {new Date(lookup.evidence.retrievedAt).toLocaleString()}. {supportNote(lookup.evidence)}</small></>
      : <p>{lookup.status === 'started' ? 'Lookup attempted; no result was recorded.' : lookup.failure ?? 'No answer returned.'}</p>}
  </div>)}</details>
}
