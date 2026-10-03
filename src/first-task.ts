import type { LiveComputerTarget } from './types.js'

export const practiceUrl = 'https://www.getcarve.app/first-task'
export const practicePrompt = 'Turn the notes in this page’s editable box into a three-item checklist. Keep each owner and deadline. Change only the box.'
export const practiceTitle = 'Carve practice notes'

/** The page marker identifies a candidate, never authorizes a task. The user
 * still reviews the selected window and sends the prepared request. */
export function practiceTarget(targets: LiveComputerTarget[], marker: string): LiveComputerTarget | null {
  if (!/^[a-f0-9]{12}$/u.test(marker)) return null
  const title = `${practiceTitle} · ${marker}`
  const browsers = new Set(['com.apple.Safari', 'com.google.Chrome', 'com.google.Chrome.beta', 'com.microsoft.edgemac', 'com.brave.Browser', 'org.mozilla.firefox', 'company.thebrowser.Browser', 'com.vivaldi.Vivaldi'])
  const matches = targets.filter(target => browsers.has(target.bundleIdentifier)
    && (target.title === title || target.title.startsWith(`${title} - `) || target.title.startsWith(`${title} — `)))
  return matches.length === 1 ? matches[0]! : null
}
