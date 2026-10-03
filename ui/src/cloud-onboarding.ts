import type { SignInStart } from '../../src/cloud/client.js'

export interface BrowserVerification {
  url: string
  expiresAt: string
  email: string
}

/** Poll only status; request one email after verified. Cancellation prevents a
 * late status response from sending mail after this screen has been dismissed. */
export async function completeBrowserVerification(input: BrowserVerification, options: {
  signal: AbortSignal
  status: (ticket: string) => Promise<{ verified: boolean }>
  start: (email: string) => Promise<SignInStart>
  now?: () => number
  wait?: () => Promise<void>
}): Promise<{ challengeId: string; expiresAt: string }> {
  const now = options.now ?? Date.now
  const expiresAt = Date.parse(input.expiresAt)
  const ticket = new URL(input.url).searchParams.get('ticket')
  if (!ticket || !Number.isFinite(expiresAt)) throw new Error('Start the browser check again.')
  const check = () => {
    options.signal.throwIfAborted()
    if (now() >= expiresAt) throw new Error('The browser check expired. Please try again.')
  }
  const wait = options.wait ?? (() => new Promise<void>((resolve, reject) => {
    const done = () => { options.signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, 2000)
    const abort = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); reject(options.signal.reason) }
    options.signal.addEventListener('abort', abort, { once: true })
    if (options.signal.aborted) abort()
  }))
  let failures = 0
  while (true) {
    check()
    let verified = false
    try { verified = (await options.status(ticket)).verified; failures = 0 }
    catch {
      options.signal.throwIfAborted()
      if (++failures >= 3) throw new Error('Could not check verification. Check your connection and try again.')
    }
    check()
    if (verified) {
      // Do not retry an email request automatically: a lost response could
      // mean the email was already sent.
      const result = await options.start(input.email)
      options.signal.throwIfAborted()
      if (!result.challengeId) throw new Error('The browser check needs to be restarted. Please try again.')
      return { challengeId: result.challengeId, expiresAt: result.expiresAt }
    }
    await wait()
  }
}
