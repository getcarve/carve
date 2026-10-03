/**
 * What the final check needs from the actor's instructions.
 *
 * The verifier's request carried the actor's whole rulebook as `controllerInstructions` (6.3k characters on average of
 * keyboard-shortcut, coordinate and navigation rules, about 1.6k input tokens on a Sol call at $2 per million) followed
 * by the controller's runtime status. The verifier has its own system prompt and never acts, so only the status
 * (execution receipt, inputs completed, last batch outcome) can inform its judgment. It is measured on the recorded
 * final checks in scripts/lab/replay-verifier.ts (27 checks: input -5%, three verdicts differed from low-effort full text, in both directions, all on class-B checks - within the noise of the medium/medium replay). Too small a gain to adopt: `STEWARD_VERIFIER_LEAN=on` opts in.
 */
export const verifierLeanEnabled = (env: NodeJS.ProcessEnv = process.env) => env.STEWARD_VERIFIER_LEAN?.trim().toLowerCase() === 'on'

const statusMarker = 'Current controller status (authoritative runtime data'

/** The controller's runtime status, without the actor's rules before it; unrecognised text is returned unchanged. */
export function leanControllerInstructions(instructions: string): string {
  const at = instructions.indexOf(statusMarker)
  return at > 0 ? instructions.slice(at) : instructions
}

/** The same trim applied to a recorded verifier request body (for replay). */
export function trimVerifierPrompt(prompt: string): string {
  const body = JSON.parse(prompt) as Record<string, unknown>
  if (typeof body.controllerInstructions === 'string') body.controllerInstructions = leanControllerInstructions(body.controllerInstructions)
  return JSON.stringify(body)
}
