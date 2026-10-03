/** Spell out the registered keys so shortcuts do not depend on symbol literacy. */
export function shortcutLabel(chord: string): string {
  return chord.replaceAll('⌥', 'Option + ').replaceAll('⌘', 'Command + ').replaceAll('⌃', 'Control + ').replaceAll('⇧', 'Shift + ')
}
