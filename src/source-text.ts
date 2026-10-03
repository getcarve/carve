/** Readable text from a public HTML page, for checking a claim against it.
 *
 * Tables keep their column headers on every cell ("Last updated: Aug 08,
 * 2023"): on 27 September a web answer read the Node.js release table's "Last
 * updated" column as the end-of-life date. A row read without its headers
 * cannot show that difference to anyone checking the claim. */

const dropped = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'canvas', 'select', 'button'])
const blocks = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'pre', 'blockquote', 'figure', 'figcaption', 'form', 'fieldset', 'details', 'summary', 'caption'])

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', euro: '€', pound: '£', yen: '¥', cent: '¢' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return named[entity.toLowerCase()] ?? whole
  })
}

const inline = (text: string) => decodeEntities(text).replace(/\s+/gu, ' ').trim()

interface TableState { rows: string[][]; header: string[] | null; row: string[] | null; cell: string | null; cellIsHeader: boolean; rowAllHeaders: boolean; inHead: boolean }

function tableLines(table: TableState): string[] {
  const lines: string[] = []
  const header = table.header
  for (const row of table.rows) {
    const cells = row.map(cell => cell.trim())
    if (!cells.some(Boolean)) continue
    if (header && header.length === cells.length && cells !== header) {
      lines.push(cells.map((cell, index) => header![index] ? `${header![index]}: ${cell || '-'}` : cell).filter(Boolean).join(' | '))
    } else lines.push(cells.join(' | '))
  }
  return lines
}

/** Plain text, one block per line. Never executes or follows anything in the page. */
export function htmlToText(html: string, maxCharacters = 400_000): string {
  const source = html.length > 3_000_000 ? html.slice(0, 3_000_000) : html
  const out: string[] = []
  let line = ''
  const flush = () => { const value = inline(line); if (value) out.push(value); line = '' }
  const tables: TableState[] = []
  let skip: string | null = null
  let skipDepth = 0
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/?([a-z][a-z0-9-]*)\b[^>]*>|[^<]+|</giu
  let match: RegExpExecArray | null
  let title = ''
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(source)
  if (titleMatch) title = inline(titleMatch[1]!)
  while ((match = token.exec(source))) {
    const raw = match[0]
    const name = match[1]?.toLowerCase()
    if (skip) {
      if (name === skip) skipDepth += raw.startsWith('</') ? -1 : raw.endsWith('/>') ? 0 : 1
      if (skipDepth <= 0) skip = null
      continue
    }
    if (!name) {
      if (raw.startsWith('<!')) continue
      const table = tables.at(-1)
      if (table?.cell !== null && table?.cell !== undefined) table.cell += raw
      else line += raw
      continue
    }
    const closing = raw.startsWith('</')
    if (!closing && dropped.has(name) && !raw.endsWith('/>')) { skip = name; skipDepth = 1; continue }
    const table = tables.at(-1)
    if (name === 'table') {
      if (!closing) { flush(); tables.push({ rows: [], header: null, row: null, cell: null, cellIsHeader: false, rowAllHeaders: false, inHead: false }) }
      else if (table) {
        tables.pop()
        const lines = tableLines(table)
        const parent = tables.at(-1)
        if (parent?.cell !== null && parent?.cell !== undefined) parent.cell += ' ' + lines.join('; ') + ' '
        else { flush(); out.push(...lines) }
      }
      continue
    }
    if (table) {
      if (name === 'thead') { table.inHead = !closing; continue }
      if (name === 'tr') {
        if (table.cell !== null && table.row) { table.row.push(inline(table.cell)); table.cell = null }
        if (table.row) {
          if (!table.header && (table.inHead || table.rowAllHeaders) && table.row.length > 1) table.header = table.row
          else table.rows.push(table.row)
        }
        table.row = closing ? null : []
        table.rowAllHeaders = true
        continue
      }
      if (name === 'td' || name === 'th') {
        if (!table.row) { table.row = []; table.rowAllHeaders = true }
        if (table.cell !== null) { table.row.push(inline(table.cell)); table.cell = null }
        if (!closing) { table.cell = ''; table.cellIsHeader = name === 'th'; if (name === 'td') table.rowAllHeaders = false }
        continue
      }
      if (table.cell !== null) { if (blocks.has(name)) table.cell += ' '; continue }
      if (name === 'tbody' || name === 'tfoot') {
        if (table.cell !== null && table.row) { table.row.push(inline(table.cell)); table.cell = null }
        if (table.row) { if (!table.header && (table.inHead || table.rowAllHeaders) && table.row.length > 1) table.header = table.row; else table.rows.push(table.row); table.row = null }
        continue
      }
    }
    if (blocks.has(name) || name === 'td' || name === 'th' || name === 'tr') flush()
  }
  while (tables.length) { const table = tables.pop()!; if (table.cell !== null && table.row) table.row.push(inline(table.cell)); if (table.row) table.rows.push(table.row); flush(); out.push(...tableLines(table)) }
  flush()
  const text = (title && !out[0]?.includes(title) ? [title, ...out] : out).join('\n')
  return text.length > maxCharacters ? text.slice(0, maxCharacters) : text
}
