export type ResultBlock = { kind: 'text'; text: string } | { kind: 'table'; headers: string[]; rows: string[][]; align: Array<'left' | 'center' | 'right'> }

/** Recognize tables only with a matching delimiter row. Ordinary pipes remain prose. */
export function parseResultBlocks(value: string): ResultBlock[] {
  const lines = value.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: ResultBlock[] = []
  let prose: string[] = []
  let fence = ''
  const flush = () => { if (prose.length) blocks.push({ kind: 'text', text: prose.join('\n') }); prose = [] }
  const cells = (line: string): string[] => {
    const text = line.trim().replace(/^\|/u, '').replace(/(?<!\\)\|$/u, '')
    const result: string[] = []
    let cell = '', code = false
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!
      if (char === '\\' && text[i + 1] === '|') { cell += '|'; i++; continue }
      if (char === '`') code = !code
      if (char === '|' && !code) { result.push(cell.trim()); cell = '' } else cell += char
    }
    result.push(cell.trim())
    return result
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const marker = line.trim().match(/^(`{3,}|~{3,})/u)?.[1]
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; prose.push(line); continue }
    const headers = cells(line)
    const separator = cells(lines[i + 1] ?? '')
    if (!fence && line.includes('|') && headers.length === separator.length && separator.every(cell => /^:?-{3,}:?$/u.test(cell))) {
      flush()
      const rows: string[][] = []
      i++
      while (i + 1 < lines.length && lines[i + 1]!.trim() && lines[i + 1]!.includes('|')) {
        const row = cells(lines[i + 1]!)
        if (row.length !== headers.length) break
        rows.push(row); i++
      }
      blocks.push({ kind: 'table', headers, rows, align: separator.map(cell => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : 'left') })
    } else prose.push(line)
  }
  flush()
  return blocks
}
