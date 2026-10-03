import { isCopilot } from '../../src/product-experience'
import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Check, Copy, Download, ShieldCheck, X } from 'lucide-react'
import { invoke } from './api'
import { Button, Card, EmptyState, PageIntro, SectionHeading } from './components'
import type { ViewProps } from './views'
import type { Receipt, ReceiptLine } from '../../src/receipt'
import type { WorkflowAutonomy } from '../../src/autonomy'
import { receiptText } from '../../src/receipt'

const MARKS: Record<ReceiptLine['kind'], string> = { started: '▸', action: '•', verified: '✓', observed: '◇', not_accepted: '✗', checkpoint: '■', approval: '■', refused: '⛔', handoff: '■', budget: '⏸', cloud: '☁', finished: '▪', note: '–' }

function statusLabel(status: Receipt['status']): string {
  return status === 'completed' ? 'Completed' : status === 'blocked' ? 'Needs you' : status === 'cancelled' ? 'Stopped' : status === 'failed' ? 'Did not finish' : status
}

function modeLabel(mode: Receipt['mode']): string {
  return mode === 'universal' ? 'Universal' : mode === 'assured' ? 'Assured' : mode === 'review' ? 'Plan only' : 'Connected'
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(date, today)) return 'Today'
  if (same(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function seconds(ms: number | null): string | null {
  if (ms === null) return null
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

/** History: every finished run as a receipt, and the workflows that have earned a lighter pace. */
export function HistoryView({ state, desktop, notify }: ViewProps) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [workflows, setWorkflows] = useState<WorkflowAutonomy[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [list, ledger] = await Promise.all([
        invoke<{ receipts: Receipt[] }>({ kind: 'receipt.list' }),
        isCopilot(state.product) ? Promise.resolve({ workflows: [] }) : invoke<{ workflows: WorkflowAutonomy[] }>({ kind: 'autonomy.ledger' }),
      ])
      setReceipts(list.receipts)
      setWorkflows(ledger.workflows)
      setSelectedId((current) => current ?? list.receipts[0]?.runId ?? null)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    }
  }

  const terminalCount = state.runs.filter((run) => ['completed', 'blocked', 'cancelled', 'failed'].includes(run.status)).length
  useEffect(() => { void load() }, [terminalCount])

  const selected = useMemo(() => receipts.find((receipt) => receipt.runId === selectedId) ?? null, [receipts, selectedId])
  const proposals = workflows.filter((workflow) => workflow.proposal)
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Receipt[] }> = []
    for (const receipt of receipts) {
      const label = dayLabel(receipt.endedAt ?? receipt.startedAt)
      const group = out.at(-1)
      if (group && group.label === label) group.items.push(receipt)
      else out.push({ label, items: [receipt] })
    }
    return out
  }, [receipts])

  const decide = async (workflowKey: string, decision: 'accept' | 'decline') => {
    setBusy(true)
    try {
      const result = await invoke<{ workflows: WorkflowAutonomy[] }>({ kind: 'autonomy.decide', workflowKey, decision })
      setWorkflows(result.workflows)
      notify(decision === 'accept' ? 'Carve will use the lighter pace for this workflow next time. You can change it on any request.' : 'Kept the current pace. Carve will ask again after more verified runs.', decision === 'accept' ? 'positive' : 'neutral')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const copyReceipt = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(receiptText(selected))
      notify('Task summary copied.', 'positive')
    } catch {
      notify('Could not access the clipboard.', 'danger')
    }
  }

  const saveImage = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await invoke<{ saved: string | null }>({ kind: 'receipt.export_image', runId: selected.runId })
      notify(result.saved ? `Saved ${result.saved}` : 'Save cancelled.', result.saved ? 'positive' : 'neutral')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const tiles = selected ? [
    { label: 'Actions', value: selected.totals.actions },
    selected.mode === 'assured'
      ? { label: 'Verified', value: selected.totals.verifications }
      : { label: 'Screen checks', value: selected.totals.observedChanges },
    { label: 'Unconfirmed changes', value: selected.totals.notAccepted },
    { label: 'Your decisions', value: selected.totals.checkpoints + selected.totals.approvals },
    { label: 'Not allowed', value: selected.totals.refusals },
    ...(selected.cloud ? [{ label: 'Task units', value: selected.cloud.units }] : []),
  ] : []

  return (
    <div className="page page--history">
      <PageIntro label="Recent tasks" title="Your task history" description="Find your past tasks, their results, and the steps Carve took. Open a task to see what worked and what still needs attention." />

      {proposals.length > 0 ? (
        <Card className="autonomy-proposals" elevated>
          <SectionHeading eyebrow="Fewer interruptions" title={proposals.length === 1 ? 'Carve has earned a lighter pace for one workflow' : `Carve has earned a lighter pace for ${proposals.length} workflows`} description="These suggestions are based on tasks Carve completed successfully. You choose whether to let it check in less often." />
          {proposals.map((workflow) => (
            <div className="autonomy-proposal" key={workflow.key}>
              <div>
                <strong>{workflow.label}</strong>
                <p>{workflow.proposal?.reason}</p>
                <small>{workflow.verifiedCompletions} verified · {workflow.interrupted} interrupted · streak {workflow.recentStreak}</small>
              </div>
              <div className="autonomy-proposal__actions">
                <Button size="small" disabled={busy} onClick={() => void decide(workflow.key, 'accept')}><Check size={14} /> Use {workflow.proposal?.preset === 'fast' ? 'fast' : 'smart checkpoints'}</Button>
                <Button size="small" variant="secondary" disabled={busy} onClick={() => void decide(workflow.key, 'decline')}><X size={14} /> Keep asking</Button>
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      {receipts.length === 0 ? (
        <EmptyState icon={<BadgeCheck size={22} />} title="No past tasks yet" description="Ask Carve to do something from Home. The result and task history will appear here." />
      ) : (
        <div className="hist">
          <nav className="hist__index" aria-label="Past tasks">
            {groups.map((group) => (
              <section key={group.label} className="hist__group">
                <h3>{group.label}<span>{group.items.length}</span></h3>
                {group.items.map((receipt) => (
                  <button type="button" key={receipt.runId} className={`hist__item hist__item--${receipt.status} ${receipt.runId === selectedId ? 'is-selected' : ''}`} onClick={() => setSelectedId(receipt.runId)}>
                    <span className="hist__dot" aria-hidden="true" />
                    <span className="hist__title">{receipt.goal}</span>
                    <time>{new Date(receipt.endedAt ?? receipt.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                    <span className="hist__meta">{statusLabel(receipt.status)} · {isCopilot(state.product) ? 'Task' : modeLabel(receipt.mode)}{receipt.durationMs !== null ? ` · ${seconds(receipt.durationMs)}` : ''}</span>
                  </button>
                ))}
              </section>
            ))}
          </nav>

          {selected ? (
            <article className={`rcpt rcpt--${selected.status}`} aria-label={`Receipt for ${selected.goal}`}>
              <header className="rcpt__head">
                <div className="rcpt__stamp">
                  <span className="rcpt__eyebrow">Task summary</span>
                  <span className="rcpt__serial">№ {selected.runId.slice(-6).toUpperCase()}</span>
                  <span className="rcpt__date">{new Date(selected.endedAt ?? selected.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
                <div className="rcpt__tools">
                  <Button size="small" variant="secondary" onClick={() => void copyReceipt()}><Copy size={14} /> Copy</Button>
                  {desktop.desktop ? <Button size="small" variant="secondary" disabled={busy} onClick={() => void saveImage()}><Download size={14} /> Save image</Button> : null}
                </div>
              </header>
              <h2 className="rcpt__goal">{selected.goal}</h2>
              <div className="rcpt__chips">
                <span className={`rcpt__status rcpt__status--${selected.status}`}>{statusLabel(selected.status)}</span>
                <span>{isCopilot(state.product) ? 'Task' : modeLabel(selected.mode)}{selected.mode === 'assured' ? ' · results checked independently' : selected.mode === 'universal' ? ' · completion reported by the AI' : ''}</span>
                {selected.durationMs !== null ? <span>{seconds(selected.durationMs)}</span> : null}
                {selected.supervision ? <span><ShieldCheck size={12} /> {selected.supervision.replace(/_/gu, ' ')}</span> : null}
              </div>

              <div className="rcpt__tiles">
                {tiles.map((tile) => <div key={tile.label} className={`rcpt__tile ${tile.value === 0 ? 'is-zero' : ''}`}><strong>{tile.value}</strong><span>{tile.label}</span></div>)}
              </div>

              <ol className="rcpt__timeline">
                {selected.lines.length === 0 ? <li className="rcpt__line rcpt__line--note"><time /><span className="rcpt__mark">–</span><div><div>No step-level events were recorded for this run.</div><small>Runs started before this version only recorded start and finish.</small></div></li> : null}
                {selected.lines.map((line, index) => (
                  <li className={`rcpt__line rcpt__line--${line.kind}`} key={`${line.at}-${index}`}>
                    <time>{line.at ? new Date(line.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</time>
                    <span className="rcpt__mark" aria-hidden="true">{MARKS[line.kind]}</span>
                    <div><div>{line.text}</div>{line.detail ? <small>{line.detail}</small> : null}</div>
                  </li>
                ))}
              </ol>

              {selected.result ? <div className="rcpt__result"><span>Result</span><p>{selected.result}</p></div> : null}
              <footer className="rcpt__foot">Every line comes from Carve's tamper-evident audit log on this Mac.</footer>
            </article>
          ) : null}
        </div>
      )}

      {workflows.length > 0 ? (
        <Card>
          <SectionHeading eyebrow="Workflows" title="What Carve has proven, per workflow" description="Runs are grouped by what you asked for. The pace shown is what you accepted; Carve proposes a lighter one only after a streak of verified runs." />
          <table className="autonomy-table">
            <thead><tr><th>Workflow</th><th>Runs</th><th>Verified</th><th>Interrupted</th><th>Streak</th><th>Pace</th></tr></thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.key}>
                  <td>{workflow.label}</td>
                  <td>{workflow.runs}</td>
                  <td>{workflow.verifiedCompletions}</td>
                  <td>{workflow.interrupted}</td>
                  <td>{workflow.recentStreak}</td>
                  <td>{workflow.acceptedPreset ? workflow.acceptedPreset.replace(/_/gu, ' ') : 'default'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  )
}
