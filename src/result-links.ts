/** URLs explicitly present in a result, never arbitrary renderer-supplied destinations. */
export function resultLinks(answer: string): string[] {
  const urls = [...answer.matchAll(/https?:\/\/[^\s<>"\]]+/giu)].map(match => {
    let value = match[0].replace(/[.,;:!?]+$/u, '')
    while (value.endsWith(')') && value.split(')').length > value.split('(').length) value = value.slice(0, -1)
    try {
      const url = new URL(value)
      return !url.username && !url.password && ['http:', 'https:'].includes(url.protocol) ? url.href : null
    } catch { return null }
  }).filter((url): url is string => Boolean(url))
  return [...new Set(urls)]
}

export function resultLinkLabel(url: string): string {
  const parsed = new URL(url)
  if (parsed.hostname === 'docs.google.com') {
    if (parsed.pathname.startsWith('/spreadsheets/')) return 'Open Google Sheet'
    if (parsed.pathname.startsWith('/document/')) return 'Open Google Doc'
    if (parsed.pathname.startsWith('/presentation/')) return 'Open Google Slides'
  }
  return parsed.hostname.replace(/^www\./u, '')
}
