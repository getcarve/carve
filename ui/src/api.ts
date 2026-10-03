import type { DesktopStatus, CarveCommand, CarveState } from './model'
import { webDesktopStatus } from './model'
import { commandErrorMessage } from './command-error'

export async function invoke<T>(command: CarveCommand): Promise<T> {
  if (window.stewardDesktop) {
    try {
      return await window.stewardDesktop.invoke<T>(command)
    } catch (error) {
      const message = commandErrorMessage(error)
      if (error instanceof Error && error.message === message) throw error
      throw new Error(message)
    }
  }
  return webInvoke<T>(command)
}

export function getState(): Promise<CarveState> {
  return invoke<CarveState>({ kind: 'state.get' })
}

export async function getDesktopStatus(): Promise<DesktopStatus> {
  return window.stewardDesktop
    ? invoke<DesktopStatus>({ kind: 'desktop.status' })
    : webDesktopStatus
}

async function webInvoke<T>(command: CarveCommand): Promise<T> {
  switch (command.kind) {
    case 'voice.settings.get':
    case 'voice.settings.set':
    case 'voice.preview':
    case 'voice.preview.stop':
    case 'voice.preview.playback': throw new Error('Voice settings require the Carve desktop app')
    case 'legal.status': return request<T>('/api/legal/status')
    case 'legal.accept': return request<T>('/api/legal/accept', 'POST', { version: command.version })
    case 'legal.acknowledge': return request<T>('/api/legal/acknowledge', 'POST', { version: command.version })
    case 'state.get': return request<T>('/api/state')
    case 'data.export': return request<T>('/api/export', 'POST', { passphrase: command.passphrase })
    case 'data.purge': return request<T>('/api/purge', 'POST', { confirm: command.confirmation })
    case 'system.global_stop': return request<T>('/api/global-stop', 'POST')
    case 'desktop.practice.prepare': throw new Error('Open practice from the Carve desktop app')
    case 'desktop.status': return webDesktopStatus as T
    case 'desktop.open_system_settings': throw new Error('Open System Settings from the Carve desktop app')
    case 'work.public_source.open': throw new Error('Open this source using its link in the browser')
    case 'computer.status':
    case 'computer.request_screen_recording_permission':
    case 'computer.request_accessibility_permission':
    case 'computer.targets.list':
    case 'computer.applications.list':
    case 'computer.surface_preferences.get':
    case 'computer.surface_preferences.set':
    case 'computer.surface_preferences.clear':
    case 'computer.route.infer':
    case 'computer.route.preview':
    case 'computer.surface.open':
    case 'computer.surface.close_fresh':
    case 'computer.targets.recommend':
    case 'computer.route.start':
    case 'computer.session.start':
    case 'computer.session.plan.visibility':
    case 'computer.session.plan.approve':
    case 'computer.session.targets.add':
    case 'computer.session.plan.revise':
    case 'computer.session.follow_up':
    case 'computer.guide.ask':
    case 'computer.guide.authority':
    case 'computer.assistance.approvals':
    case 'computer.assistance.mode':
    case 'computer.assistance.open':
    case 'computer.assistance.ask':
    case 'computer.assistance.accept':
    case 'computer.assistance.drawing.start':
    case 'computer.assistance.drawing':
    case 'computer.assistance.clear':
    case 'computer.assistance.refresh':
    case 'computer.assistance.delegate':
    case 'computer.attachments.list':
    case 'computer.attachments.focus':
    case 'computer.attachments.retire':
    case 'computer.universal.budget':
    case 'computer.universal.steer':
    case 'computer.universal.retry':
    case 'computer.session.guidance':
    case 'computer.handoff.decide':
    case 'computer.handoff.destinations':
    case 'computer.handoff.destination':
    case 'computer.session.context_transfer':
    case 'computer.catalog_consent':
    case 'computer.visuals_consent':
    case 'computer.execution_mode.set':
    case 'computer.action_engine.set':
    case 'computer.model_profile.set':
    case 'computer.service_tier.set':
    case 'computer.session.propose':
    case 'computer.session.frame':
    case 'computer.session.action':
      throw new Error('Live computer use requires the Carve desktop app on macOS')
    case 'evaluation.live_mac.preflight':
    case 'evaluation.live_mac.propose':
    case 'evaluation.live_mac.authorize_and_run':
    case 'evaluation.live_mac.stop':
      throw new Error('Live-Mac canaries require the Carve desktop app on macOS')
    case 'recall.query': return request<T>('/api/recall', 'POST', {
      question: command.question,
      ...(command.infer === undefined ? {} : { infer: command.infer }),
      ...(command.providerId === undefined ? {} : { providerId: command.providerId }),
      ...(command.depth === undefined ? {} : { depth: command.depth }),
      ...(command.withImages === undefined ? {} : { withImages: command.withImages }),
      ...(command.scope === undefined ? {} : { scope: command.scope }),
      ...(command.conversationId === undefined ? {} : { conversationId: command.conversationId }),
      ...(command.save === undefined ? {} : { save: command.save }),
      ...(command.replaceLast === undefined ? {} : { replaceLast: command.replaceLast }),
    })
    case 'dictation.sharing.get': return request<T>('/api/dictation/sharing')
    case 'dictation.sharing.set': return request<T>('/api/dictation/sharing', 'POST', { enabled: command.enabled, remember: command.remember })
    case 'dictation.transcribe': return request<T>('/api/dictation', 'POST', { audioBase64: command.audioBase64, mimeType: command.mimeType })
    case 'dictation.stream.begin': return request<T>('/api/dictation/stream', 'POST', { op: 'begin', mimeType: command.mimeType })
    case 'dictation.stream.push': return request<T>('/api/dictation/stream', 'POST', { op: 'push', sessionId: command.sessionId, audioBase64: command.audioBase64 })
    case 'dictation.stream.end': return request<T>('/api/dictation/stream', 'POST', { op: 'end', sessionId: command.sessionId })
    case 'recall.conversations.list': return request<T>('/api/recall/conversations')
    case 'recall.conversation.get': return request<T>(`/api/recall/conversations/${encodeURIComponent(command.conversationId)}`)
    case 'recall.conversation.rename': return request<T>(`/api/recall/conversations/${encodeURIComponent(command.conversationId)}`, 'PATCH', { title: command.title })
    case 'recall.conversation.delete': return request<T>(`/api/recall/conversations/${encodeURIComponent(command.conversationId)}`, 'DELETE')
    case 'recall.answer_policy': return request<T>(`/api/recall/answer-policy${command.providerId ? `?providerId=${encodeURIComponent(command.providerId)}` : ''}`)
    case 'recall.answer_consent': return request<T>('/api/recall/answer-consent', 'POST', { providerId: command.providerId })
    case 'recall.scope_count': return request<T>('/api/recall/scope-count', 'POST', { fromIso: command.fromIso, toIso: command.toIso, sessionIds: command.sessionIds ?? [] })
    case 'recall.enrich_text': return request<T>('/api/recall/enrich', 'POST', {
      ...(command.momentIds === undefined ? {} : { momentIds: command.momentIds }),
      ...(command.scope === undefined ? {} : { scope: command.scope }),
    })
    case 'recall.unread_captures': return request<T>('/api/recall/unread-captures', 'POST', { fromIso: command.fromIso, toIso: command.toIso, sessionIds: command.sessionIds ?? [] })
    case 'recall.skip_captures': return request<T>('/api/recall/skip-captures', 'POST', { momentIds: command.momentIds })
    case 'recall.clear_skips': return request<T>('/api/recall/clear-skips', 'POST')
    case 'receipt.list': return request<T>('/api/receipts')
    case 'receipt.get': return request<T>(`/api/receipts/${encodeURIComponent(command.runId)}`)
    case 'receipt.export_image': throw new Error('Receipt images are saved by the Carve desktop app')
    case 'autonomy.ledger': return request<T>('/api/autonomy')
    case 'autonomy.recommend': return request<T>('/api/autonomy/recommend', 'POST', { goal: command.goal })
    case 'autonomy.decide': return request<T>('/api/autonomy/decide', 'POST', { workflowKey: command.workflowKey, decision: command.decision })
    case 'cloud.status': return request<T>('/api/cloud/status')
    case 'cloud.refresh': return request<T>('/api/cloud/refresh', 'POST')
    case 'cloud.signin.status': return request<T>('/api/cloud/signin/status', 'POST', { ticket: command.ticket })
    case 'cloud.browser.start': return request<T>('/api/cloud/browser/start', 'POST', { email: command.email, termsVersion: command.termsVersion })
    case 'cloud.browser.finish': return request<T>('/api/cloud/browser/finish', 'POST', { id: command.id, termsVersion: command.termsVersion })
    case 'cloud.browser.cancel': return request<T>('/api/cloud/browser/cancel', 'POST', { id: command.id })
    case 'cloud.signin.start': return request<T>('/api/cloud/signin/start', 'POST', { email: command.email })
    case 'cloud.signin.verify': return request<T>('/api/cloud/signin/verify', 'POST', { challengeId: command.challengeId, code: command.code, termsVersion: command.termsVersion })
    case 'cloud.signout_all': return request<T>('/api/cloud/signout-all', 'POST')
    case 'cloud.signout': return request<T>('/api/cloud/signout', 'POST')
    case 'cloud.checkout': return request<T>('/api/cloud/checkout', 'POST', command.pack ? { pack: command.pack } : { plan: command.plan, interval: command.interval })
    case 'cloud.portal': return request<T>('/api/cloud/portal', 'POST')
    case 'cloud.delete_account': return request<T>('/api/cloud/delete-account', 'POST', { confirmation: command.confirmation })
    case 'provider.models': return request<T>(`/api/providers/${encodeURIComponent(command.providerId)}/models`)
    case 'provider.set_model': return request<T>(`/api/providers/${encodeURIComponent(command.providerId)}/model`, 'POST', { model: command.model })
    case 'model.rate.get': return request<T>(`/api/models/rate?providerId=${encodeURIComponent(command.providerId)}&model=${encodeURIComponent(command.model)}`)
    case 'model.rate.set': return request<T>('/api/models/rate', 'POST', { providerId: command.providerId, model: command.model, inputPerMillion: command.inputPerMillion, outputPerMillion: command.outputPerMillion })
    case 'cost.debug.get': return request<T>('/api/cost/debug')
    case 'cost.debug.set': return request<T>('/api/cost/debug', 'POST', { enabled: command.enabled })
    case 'cost.observation': return request<T>(`/api/cost/observation?intervalSeconds=${command.intervalSeconds}&readsText=${command.readsText === true}`)
    case 'embedding.policy': return request<T>('/api/embedding/policy')
    case 'embedding.set_mode': return request<T>('/api/embedding/mode', 'POST', { mode: command.mode })
    case 'embedding.consent': return request<T>('/api/embedding/consent', 'POST', { providerId: command.providerId })
    case 'recall.image_consent': return request<T>('/api/recall/image-consent', 'POST', { providerId: command.providerId })
    case 'cost.induction': return request<T>(`/api/cost/induction?sessionId=${encodeURIComponent(command.sessionId)}&providerId=${encodeURIComponent(command.providerId)}`)
    case 'model.spend': return request<T>(`/api/models/spend${command.sinceIso ? `?since=${encodeURIComponent(command.sinceIso)}` : ''}`)
    case 'recall.unread_count': return request<T>('/api/recall/unread-count')
    case 'ambient.set_enabled': return request<T>('/api/ambient/enabled', 'POST', { enabled: command.enabled })
    case 'ambient.set_text': return request<T>('/api/ambient/text', 'POST', { enabled: command.enabled })
    case 'ambient.candidate.dismiss': return request<T>(`/api/ambient/candidates/${encodeURIComponent(command.candidateId)}/dismiss`, 'POST')
    case 'native.capture.status': return request<T>('/api/native-capture/status')
    case 'native.capture.request_permission': return request<T>('/api/native-capture/request-permission', 'POST')
    case 'observation.screenshot': return request<T>(`/api/observations/${encodeURIComponent(command.observationId)}/screenshot`)
    case 'observation.review': return request<T>(`/api/observations/${encodeURIComponent(command.observationId)}/reviews`, 'POST', command.review)
    case 'observation.delete': return request<T>(`/api/observations/${encodeURIComponent(command.observationId)}`, 'DELETE', { confirmation: command.confirmation })
    case 'ai.induction.disclosure': return request<T>('/api/ai-induction/disclosure', 'POST', { sessionId: command.sessionId, providerId: command.providerId })
    case 'ai.induction.analyze': return request<T>('/api/ai-induction/analyze', 'POST', { sessionId: command.sessionId, providerId: command.providerId, manifestHash: command.manifestHash, ...(command.confirmation === undefined ? {} : { confirmation: command.confirmation }) })
    case 'ai.draft.correct': return request<T>(`/api/ai-drafts/${encodeURIComponent(command.draftId)}/corrections`, 'POST', command.correction)
    case 'ai.draft.decide': return request<T>(`/api/ai-drafts/${encodeURIComponent(command.draftId)}/${command.decision}`, 'POST')
    case 'session.start': return request<T>('/api/sessions', 'POST', {
      name: command.name,
      fixtureId: command.fixtureId,
      capturePolicy: command.capturePolicy,
    })
    case 'session.action': return request<T>(`/api/sessions/${encodeURIComponent(command.sessionId)}/${command.action}`, 'POST')
    case 'procedure.correct': return request<T>(`/api/procedures/${encodeURIComponent(command.procedureId)}/corrections`, 'POST', command.correction)
    case 'work.prepare': return request<T>('/api/work/prepare', 'POST', {
      goal: command.goal,
      autonomy: command.autonomy,
      ...(command.intent === undefined ? {} : { intent: command.intent }),
      ...(command.supervision === undefined ? {} : { supervision: command.supervision }),
      ...(command.providerId === undefined ? {} : { providerId: command.providerId }),
      ...(command.parameterValues === undefined ? {} : { parameterValues: command.parameterValues }),
      ...(command.selection === undefined ? {} : { selection: command.selection }),
      ...(command.memory === undefined ? {} : { memory: command.memory }),
      ...(command.followUpRunId === undefined ? {} : { followUpRunId: command.followUpRunId }),
      ...(command.budget === undefined ? {} : { budget: command.budget }),
      ...(command.freshSession === undefined ? {} : { freshSession: command.freshSession }),
    })
    case 'plan.create': return request<T>('/api/plans', 'POST', {
      goal: command.goal,
      autonomy: command.autonomy,
      ...(command.intent === undefined ? {} : { intent: command.intent }),
      ...(command.supervision === undefined ? {} : { supervision: command.supervision }),
      ...(command.providerId === undefined ? {} : { providerId: command.providerId }),
      ...(command.parameterValues === undefined ? {} : { parameterValues: command.parameterValues }),
    })
    case 'run.action': return request<T>(`/api/runs/${encodeURIComponent(command.runId)}/${command.action}`, 'POST')
    case 'recovery.action': return request<T>(`/api/runs/${encodeURIComponent(command.runId)}/recovery/${command.action}`, 'POST', command.providerId === undefined ? {} : { providerId: command.providerId })
    case 'approval.action': return request<T>(`/api/approvals/${encodeURIComponent(command.approvalId)}/${command.action}`, 'POST')
    case 'checkpoint.action': return request<T>(`/api/checkpoints/${encodeURIComponent(command.checkpointId)}/${command.action}`, 'POST')
    case 'supervision.change': return request<T>(`/api/runs/${encodeURIComponent(command.runId)}/supervision`, 'POST', { preset: command.preset })
    case 'provider.action': return request<T>(`/api/providers/${encodeURIComponent(command.providerId)}/${command.action}`, 'POST')
    case 'browser.sandbox.reset': return request<T>('/api/browser-sandbox/reset', 'POST', { priority: command.priority, ...(command.application === undefined ? {} : { application: command.application }), ...(command.layout === undefined ? {} : { layout: command.layout }) })
    case 'browser.sandbox.open_external': throw new Error('Open the scenario as a separate window from the Carve desktop app')
    case 'computer.lab.run': return request<T>('/api/computer-lab/run', 'POST', command)
    case 'computer.lab.run_suite': return request<T>('/api/computer-lab/run-suite', 'POST', command.architectureId === undefined ? {} : { architectureId: command.architectureId })
    case 'computer.lab.clear': return request<T>('/api/computer-lab/results', 'DELETE')
    case 'evaluation.campaign.preview': return request<T>('/api/evaluations/preview', 'POST', { suite: command.suite })
    case 'evaluation.campaign.run': return request<T>('/api/evaluations/run', 'POST', { suite: command.suite, manifestHash: command.manifestHash })
  }
}

let webSession: Promise<void> | null = null

async function ensureWebSession(): Promise<void> {
  if (!webSession) {
    webSession = fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: { 'x-carve-bootstrap': '1' },
      referrerPolicy: 'same-origin',
    }).then(async (response) => {
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
    }).catch((error: unknown) => {
      webSession = null
      throw error
    })
  }
  return webSession
}

async function request<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  await ensureWebSession()
  const send = () => fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-carve-csrf': '1' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  let response = await send()
  // A server restart rotates the process capability. Establish exactly one
  // fresh session instead of leaving an already-open UI permanently broken.
  if (response.status === 401) {
    webSession = null
    await ensureWebSession()
    response = await send()
  }
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
  return result
}
