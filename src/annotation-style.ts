import type { GuideAnnotation } from './guide-annotations.js'

export const annotationColors = ['auto', 'purple', 'blue', 'green', 'orange', 'pink', 'yellow'] as const
export const annotationLines = ['auto', 'solid', 'dashed', 'dotted'] as const
export const annotationFills = ['auto', 'none', 'tint', 'dots', 'hatch', 'waves'] as const
export interface AnnotationStyle {
  color: typeof annotationColors[number]
  line: typeof annotationLines[number]
  fill: typeof annotationFills[number]
  curve: 'angular' | 'rounded'
}
export const annotationStyleSchema = {
  type: 'object', additionalProperties: false, required: ['color', 'line', 'fill', 'curve'],
  properties: { color: { type: 'string', enum: annotationColors }, line: { type: 'string', enum: annotationLines }, fill: { type: 'string', enum: annotationFills }, curve: { type: 'string', enum: ['angular', 'rounded'] } },
} as const
export function annotationStyle(value: unknown): AnnotationStyle {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    color: annotationColors.includes(v.color as AnnotationStyle['color']) ? v.color as AnnotationStyle['color'] : 'auto',
    line: annotationLines.includes(v.line as AnnotationStyle['line']) ? v.line as AnnotationStyle['line'] : 'auto',
    fill: annotationFills.includes(v.fill as AnnotationStyle['fill']) ? v.fill as AnnotationStyle['fill'] : 'auto',
    curve: v.curve === 'rounded' ? 'rounded' : 'angular',
  }
}
export const annotationPalette = {
  purple: { light: '#7025bb', dark: '#d9b8ff' },
  blue: { light: '#155baa', dark: '#8dc5ff' },
  green: { light: '#126b49', dark: '#80e0b3' },
  orange: { light: '#994409', dark: '#ffc18a' },
  pink: { light: '#a02266', dark: '#ffacd7' },
  yellow: { light: '#806000', dark: '#ffe085' },
} as const
export type AnnotationColor = keyof typeof annotationPalette
export interface AnnotationRenderStyle { color: AnnotationColor; accent: string; line: 'solid' | 'dashed' | 'dotted'; fill: Exclude<AnnotationStyle['fill'], 'auto'>; curve: 'angular' | 'rounded' }

/** Stable categorical assignment; preferences are inference outputs, never domain regexes. */
export function styleAnnotations(marks: GuideAnnotation[], previous: GuideAnnotation[] = []): GuideAnnotation[] {
  const groups = new Map<string, AnnotationColor>()
  for (const mark of previous) if (mark.renderStyle) groups.set(mark.group || mark.id, mark.renderStyle.color)
  // Explicit choices take precedence over previous group defaults.
  for (const mark of marks) if (mark.style?.color && mark.style.color !== 'auto') groups.set(mark.group || mark.id, mark.style.color)
  const colors = Object.keys(annotationPalette) as AnnotationColor[]
  for (const mark of marks) {
    const key = mark.group || mark.id
    if (!groups.has(key)) groups.set(key, colors.find(c => ![...groups.values()].includes(c)) ?? colors[groups.size % colors.length]!)
  }
  return marks.map(mark => {
    const style = annotationStyle(mark.style), color = style.color === 'auto' ? groups.get(mark.group || mark.id)! : style.color
    const tone = mark.tone === 'dark' ? 'dark' : 'light'
    return { ...mark, style, renderStyle: { color, accent: annotationPalette[color][tone],
      line: style.line === 'auto' ? mark.purpose === 'propose' ? 'dashed' : 'solid' : style.line,
      fill: style.fill === 'auto' ? mark.shape === 'region' ? 'tint' : 'none' : style.fill,
      curve: mark.purpose === 'propose' && mark.shape === 'region' ? style.curve : 'angular' } }
  })
}
