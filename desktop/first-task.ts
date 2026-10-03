import { randomBytes } from 'node:crypto'
import { practiceTarget, practiceUrl } from '../src/first-task.js'
import type { LiveComputerTarget } from '../src/types.js'

export async function preparePracticeWindow(deps: {
  open: (url: string) => Promise<unknown>
  targets: () => Promise<LiveComputerTarget[]>
  wait: () => Promise<unknown>
  current: () => boolean
}): Promise<{ target: LiveComputerTarget | null }> {
  const marker = randomBytes(6).toString('hex')
  if (!deps.current()) throw new Error('Practice setup was canceled.')
  await deps.open(`${practiceUrl}#practice=${marker}`)
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!deps.current()) throw new Error('Practice setup was canceled.')
    const target = practiceTarget(await deps.targets(), marker)
    if (!deps.current()) throw new Error('Practice setup was canceled.')
    if (target) return { target }
    await deps.wait()
  }
  if (!deps.current()) throw new Error('Practice setup was canceled.')
  return { target: null }
}
