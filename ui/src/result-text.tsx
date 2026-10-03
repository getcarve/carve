import { parseResultBlocks } from '../../src/result-blocks'
import { Fragment } from 'react'
import { resultLinks, resultLinkLabel } from '../../src/result-links'

/** Text-only formatting with explicit HTTP(S) links; no generated HTML. */
function InlineResultText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s]+\)|https?:\/\/[^\s<>]+|\*\*[^*\n]+\*\*)/gu)
  return <>{parts.map((part, index) => {
    const url = resultLinks(part)[0]
    if (url) {
      const label = part.match(/^\[([^\]]+)\]/u)?.[1]
      return <a key={index} href={url} target="_blank" rel="noreferrer" title={url}>{label && !/^https?:\/\//iu.test(label) ? label : resultLinkLabel(url)}</a>
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    return <Fragment key={index}>{part}</Fragment>
  })}</>
}

export function ResultText({ text }: { text: string }) {
  return <>{parseResultBlocks(text).map((block, index) => block.kind === 'text'
    ? <div key={index} style={{ whiteSpace: 'pre-wrap' }}><InlineResultText text={block.text} /></div>
    : <div key={index} className="result-table-scroll" tabIndex={0} role="region" aria-label="Result table">
      <table><thead><tr>{block.headers.map((cell, column) => <th key={column} scope="col" style={{ textAlign: block.align[column] }}><InlineResultText text={cell} /></th>)}</tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} style={{ textAlign: block.align[column] }}><InlineResultText text={cell} /></td>)}</tr>)}</tbody></table>
    </div>)}</>
}
