import type { CheckpointDecision } from '../../src/types'
import { Button } from './components'
import { personStepCheckpointCopy, personStepMainWindowEnabled } from '../../src/live-computer-supervision'

/** A sign-in or human check is the person's step: nothing of Carve's is being approved, so the card says what to do in
 * the window and offers Continue, never "Approve & continue" or "These actions have not run". On 30 September (A-V2) a
 * sign-in pause reached while the capsule was minimized showed here as an ordinary approval. */
function PersonStepCheckpoint({ checkpoint, busy, decide }: { checkpoint: CheckpointDecision; busy: boolean; decide: (action: 'approve' | 'decline') => void }) {
  const copy = personStepCheckpointCopy(checkpoint)!
  return <section className="assistance-plan assistance-checkpoint" aria-label={copy.kind === 'sign_in' ? 'Sign in to continue' : 'Confirm you’re human'}>
    <span className="assistance-plan__eyebrow">Paused · Waiting for you</span>
    <h3>{copy.title}</h3>
    <p className="approval-plan-scope">{checkpoint.preview.where}</p>
    <p>{copy.scope}</p>
    <div className="assistance-plan__actions"><Button variant="secondary" disabled={busy} onClick={() => decide('decline')}>{copy.declineLabel}</Button><Button disabled={busy} onClick={() => decide('approve')}>{copy.approveLabel}</Button></div>
  </section>
}

export function ApprovalCheckpoint({ checkpoint, busy, decide }: { checkpoint: CheckpointDecision; busy: boolean; decide: (action: 'approve' | 'decline') => void }) {
  if (personStepMainWindowEnabled() && personStepCheckpointCopy(checkpoint)) return <PersonStepCheckpoint checkpoint={checkpoint} busy={busy} decide={decide} />
  const expired = checkpoint.expiresAt !== null && Date.parse(checkpoint.expiresAt) <= Date.now()
  return <section className="assistance-plan assistance-checkpoint" aria-label="Review next change">
    <span className="assistance-plan__eyebrow">Paused · Waiting for you</span>
    <h3>{checkpoint.preview.what.split('\n')[0]}</h3>
    {checkpoint.preview.what.includes('\n') ? <p className="approval-action-description">{checkpoint.preview.what.split('\n').slice(1).join('\n')}</p> : null}
    <p className="approval-plan-scope">{checkpoint.preview.where}</p>
    <p>{checkpoint.preview.whyNow} These actions have not run.</p>
    <details className="approval-plan-editor"><summary>Review details</summary><dl className="approval-checkpoint-details"><dt>Information involved</dt><dd>{checkpoint.preview.data}</dd><dt>After approval</dt><dd>{checkpoint.preview.verification}</dd></dl></details>
    {expired ? <p role="status">This approval expired. Stop the task and try again.</p> : null}
    <div className="assistance-plan__actions"><Button variant="secondary" disabled={busy} onClick={() => decide('decline')}>Stop task</Button><Button disabled={busy || expired} onClick={() => decide('approve')}>Approve &amp; continue</Button></div>
  </section>
}
