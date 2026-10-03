/** Do not release a held action until the approval UI has relinquished input
 * and the exact target window has acknowledged focus. A failed handoff keeps
 * the decision pending, so no permission is consumed and no action is sent. */
export async function handOffApprovedAction<T>(steps: {
  release: () => void | Promise<void>
  focus: () => void | Promise<void>
  approve: () => T | Promise<T>
}): Promise<T> {
  await steps.release()
  await steps.focus()
  return steps.approve()
}
