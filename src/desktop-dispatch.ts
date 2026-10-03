import { isUniversalLiveComputerEngine, liveComputerActionEngines } from './live-computer-engines.js'
import { assistanceRequestMaxLength } from './assistance-request.js'
import { isVoiceId } from './voice-settings.js'
import { acceptLegal, acknowledgeDisclosures, firstRunStatus, legalStatus } from './legal-consent.js'
import { parseDrawingEdit } from './annotation-scene.js'
import type { CarveApp } from './app.js'
import type { CarveCommand } from './desktop-contract.js'
import { normalizeCaptureTiming } from './capture-timing.js'
import type { AiDraftCorrection, AutonomyLevel, CapturePolicy, LiveComputerTarget, ObservationReviewInput, SupervisionPolicyV2 } from './types.js'
import { validateSupervisionPolicy } from './supervision-policy.js'
import type { ProcedureCorrection } from './workflows.js'
import { liveMacRegressionGateCaseIds } from './evaluation/live-mac-canary.js'
import { maximumRetryNoteCharacters } from './computer-use/universal-termination.js'

const autonomyLevels = new Set<AutonomyLevel>([
  'observe_only', 'preview', 'approve_each', 'approve_plan', 'approve_group', 'timed_approval', 'constrained_autonomous',
])

export async function dispatchCarveCommand(app: CarveApp, input: unknown): Promise<unknown> {
  const command = validateCarveCommand(input)
  switch (command.kind) {
    case 'legal.status': return firstRunStatus(app.database, app.cloud.configured)
    case 'legal.acknowledge': {
      const acknowledgment = acknowledgeDisclosures(app.database, command.version)
      app.audit.append('legal.disclosures_acknowledged', 'user', null, { ...acknowledgment })
      return acknowledgment
    }
    case 'legal.accept': {
      const receipt = acceptLegal(app.database, command.version)
      app.audit.append('legal.accepted', 'user', null, { ...receipt })
      return receipt
    }
    case 'state.get': return app.state()
    case 'data.export': return app.createEncryptedExport(command.passphrase)
    case 'data.purge': {
      if (command.confirmation !== 'DELETE ALL STEWARD DATA') throw new Error('Exact deletion confirmation phrase required')
      await app.purgeData()
      return { deleted: true }
    }
    case 'system.global_stop': {
      app.globalStop()
      return { stopped: true }
    }
    case 'voice.settings.get':
    case 'voice.settings.set':
    case 'voice.preview':
    case 'voice.preview.stop':
    case 'voice.preview.playback': throw new Error('Voice settings require the Carve desktop app')
    case 'desktop.practice.prepare': throw new Error('Open practice from the Carve desktop app')
    case 'desktop.status': throw new Error('Desktop status is provided by the desktop shell')
    case 'desktop.open_system_settings': throw new Error('System Settings can be opened only by the desktop shell')
    case 'native.capture.status': return app.refreshNativeCaptureStatus()
    case 'native.capture.request_permission': return app.requestNativeScreenPermission()
    case 'computer.status': return app.refreshLiveComputerStatus()
    case 'computer.request_screen_recording_permission': return app.requestLiveComputerScreenRecordingPermission()
    case 'computer.request_accessibility_permission': return app.requestLiveComputerAccessibilityPermission()
    case 'computer.targets.list': return { targets: await app.listLiveComputerTargets(command.quiet ?? false) }
    case 'computer.applications.list': return { applications: await app.listLiveComputerApplications(command.quiet ?? false) }
    case 'computer.surface_preferences.get': return app.surfaceApplicationPreferenceState()
    case 'computer.surface_preferences.set': return app.setSurfaceApplicationPreference(command)
    case 'computer.surface_preferences.clear': return app.clearSurfaceApplicationPreference(command.capability)
    case 'computer.route.infer': return app.inferLiveComputerRouteIntent(command.runId, command.providerId)
    case 'computer.route.preview': return app.recordSuggestedLiveComputerRoute(command.runId, command.route)
    case 'computer.surface.open': return { target: await app.openFreshLiveComputerWindow(command.bundleIdentifier, command.url ?? null, command.runId ?? null) }
    case 'computer.surface.close_fresh': return { closed: await app.closeFreshLiveComputerWindows(command.runId ?? null) }
    case 'computer.targets.recommend': return app.recommendLiveComputerTargets(command.goal, command.providerId)
    case 'computer.handoff.destinations': return app.applicationHandoffDestinations()
    case 'computer.handoff.destination': return app.changeApplicationHandoffDestination(command.taskId, command.revision, command.bundleIdentifier, command.windowId, command.target)
    case 'computer.handoff.decide': return app.applicationHandoff.decide(command.taskId, command.revision, command.action)
    case 'computer.route.start': return app.startLiveComputerRoute(command)
    case 'computer.session.start': return isUniversalLiveComputerEngine(app.liveComputerActionEngine())
      ? app.startUniversalComputerSession(command)
      : app.startLiveComputerSession(command)
    case 'computer.session.plan.visibility': return app.recordPlanVisibility(command.sessionId, command.planHash, command.visible)
    case 'computer.session.plan.approve': return app.approveLiveComputerPlan(command.planHash, 'main_app')
    case 'computer.session.targets.add': return app.addLiveComputerSessionTarget(command.entry)
    case 'computer.session.plan.revise': return app.reviseLiveComputerPlan(command.feedback)
    case 'computer.session.follow_up': return app.submitComputerCompletionRequest(command.goal)
    case 'computer.guide.ask': return app.askGuide(command.question, command.target)
    case 'computer.guide.authority': return app.guideAuthority()
    case 'computer.assistance.approvals': return app.assistance.selectApprovalPreset(command.preset, command)
    case 'computer.assistance.mode': return app.assistance.select(command.mode, command)
    case 'computer.assistance.open': return app.attachSurface(command.target, null, command.mode === 'guide' ? 'guide' : 'work').conversation.open(command.target, command.mode)
    case 'computer.assistance.ask': return app.assistance.submit(command.question)
    case 'computer.assistance.accept': return app.assistance.acceptFollowUp(command)
    case 'computer.assistance.drawing.start': return app.assistance.startDrawing()
    case 'computer.assistance.drawing': return app.assistance.editDrawing(command.edit)
    case 'computer.assistance.clear': return app.assistance.invalidatePointer()
    case 'computer.assistance.refresh': return app.assistance.refreshGuide()
    case 'computer.assistance.delegate': return app.assistance.delegate(command.goal, command.scope)
    case 'computer.attachments.list': return { attachments: app.attachments.summaries(), parkedSessions: app.parkedLiveSessionSummaries() }
    case 'computer.attachments.focus': { const attachment = app.focusAttachment(command.id); if (!attachment) throw new Error('That conversation is no longer attached'); return { attachment: app.attachments.summaries().find((entry) => entry.id === attachment.id) ?? null } }
    case 'computer.attachments.retire': return { retired: app.retireAttachment(command.id) }
    case 'computer.universal.budget': return app.approveUniversalComputerBudget(command.checkpointId, 'main_app')
    case 'computer.universal.steer': return app.steerUniversalComputerSession(command.text, command.source)
    case 'computer.universal.retry': return app.retryUniversalComputerSession(command.sessionId, { ...(command.preset ? { preset: command.preset } : {}), ...(command.note ? { note: command.note } : {}) })
    case 'computer.session.guidance': return app.provideLiveComputerGuidance({ questionId: command.questionId ?? null, optionId: command.optionId ?? null, directive: command.directive ?? null })
    case 'computer.session.context_transfer': return app.decideLiveComputerContextTransfer(command.transferId, command.action)
    case 'computer.visuals_consent': return app.setLiveComputerVisualsConsent(command.providerId, command.remember)
    case 'computer.catalog_consent': return app.setCatalogSharingConsent(command.providerId, command.remember, command.runId)
    case 'computer.execution_mode.set': return { mode: app.setLiveComputerExecutionMode(command.mode) }
    case 'computer.action_engine.set': return { engine: app.setLiveComputerActionEngine(command.engine) }
    case 'computer.model_profile.set': return { profile: app.setLiveComputerModelProfile(command.profile) }
    case 'computer.service_tier.set': return app.setLiveComputerServiceTier(command.tier)
    case 'dictation.sharing.get': return app.dictationSharing()
    case 'dictation.sharing.set': return app.setDictationSharing(command.enabled, command.remember)
    case 'dictation.transcribe': return app.transcribeDictation(command.audioBase64, command.mimeType)
    case 'dictation.stream.begin': return app.beginDictationStream(command.mimeType)
    case 'dictation.stream.push': return app.pushDictationStream(command.sessionId, command.audioBase64)
    case 'dictation.stream.end': return app.endDictationStream(command.sessionId)
    case 'computer.session.propose': return app.proposeLiveComputerAction()
    case 'computer.session.frame': return app.readLiveComputerFrame()
    case 'computer.session.action': {
      if (command.action === 'approve') return app.executeLiveComputerAction()
      const universal = app.universalComputerSession()
      if (command.action === 'pause') return universal && ['starting', 'running', 'pausing', 'paused', 'awaiting_steering_review', 'replanning'].includes(universal.status)
        ? app.pauseUniversalComputerSession('text')
        : app.pauseLiveComputerSession('user_pause', 'main_app')
      if (command.action === 'resume') return universal && ['pausing', 'paused', 'awaiting_steering_review'].includes(universal.status)
        ? app.resumeUniversalComputerSession()
        : app.resumeLiveComputerSession()
      return app.stopLiveComputerSession()
    }
    case 'observation.screenshot': return app.readObservationScreenshot(command.observationId)
    case 'observation.review': return app.saveObservationReview(command.observationId, command.review)
    case 'observation.delete': return app.deleteObservationPermanently(command.observationId)
    case 'ai.induction.disclosure': return app.aiInductionDisclosure(command.sessionId, command.providerId)
    case 'ai.induction.analyze': return app.analyzeReviewedSession(command.sessionId, command.providerId, command.manifestHash, command.confirmation)
    case 'ai.draft.correct': return app.correctAiDraft(command.draftId, command.correction)
    case 'ai.draft.decide': return app.decideAiDraft(command.draftId, command.decision)
    case 'recall.query': return app.recall(command.question, {
      ...(command.scope === undefined ? {} : { scope: command.scope }),
      ...(command.conversationId === undefined ? {} : { conversationId: command.conversationId }),
      ...(command.save === undefined ? {} : { save: command.save }),
      ...(command.replaceLast === undefined ? {} : { replaceLast: command.replaceLast }),
      ...(command.infer
        ? { infer: {
            required: true,
            ...(command.providerId === undefined ? {} : { providerId: command.providerId }),
            ...(command.depth === undefined ? {} : { depth: command.depth }),
            ...(command.withImages === undefined ? {} : { withImages: command.withImages }),
          } }
        : {}),
    })
    case 'recall.conversations.list': return { conversations: app.listRecallConversations() }
    case 'recall.conversation.get': return app.getRecallConversation(command.conversationId)
    case 'recall.conversation.rename': return app.renameRecallConversation(command.conversationId, command.title)
    case 'recall.conversation.delete': return app.deleteRecallConversation(command.conversationId)
    case 'recall.scope_count': return app.recallScopeCount(command.fromIso, command.toIso, command.sessionIds)
    case 'recall.answer_policy': return app.recallAnswerPolicy(command.providerId)
    case 'recall.answer_consent': return app.setRecallAnswerConsent(command.providerId)
    case 'recall.enrich_text': return app.enrichRecallText({
      ...(command.momentIds === undefined ? {} : { momentIds: command.momentIds }),
      ...(command.scope === undefined ? {} : { scope: command.scope }),
    })
    case 'recall.unread_captures': return { captures: app.recallUnreadCaptures(command.fromIso, command.toIso, command.sessionIds) }
    case 'recall.skip_captures': return app.skipRecallCaptures(command.momentIds)
    case 'recall.clear_skips': return app.clearRecallSkips()
    case 'receipt.list': return { receipts: app.receipts() }
    case 'receipt.get': return app.receipt(command.runId)
    case 'receipt.export_image': throw new Error('Receipt images are saved by the Carve desktop app')
    case 'autonomy.ledger': return { workflows: app.autonomyLedger() }
    case 'autonomy.recommend': return app.recommendedSupervision(command.goal)
    case 'autonomy.decide': return { workflows: app.autonomyDecide(command.workflowKey, command.decision) }
    case 'cloud.status': return app.cloudStatus()
    case 'cloud.refresh': return app.cloudRefresh()
    case 'cloud.signin.status': return app.cloudSignInVerificationStatus(command.ticket)
    case 'cloud.browser.start': {
      if (legalStatus(app.database).receipt?.version !== command.termsVersion) throw new Error('Review and accept the terms before signing in.')
      return app.cloud.browserSignInStart(command.email, command.termsVersion)
    }
    case 'cloud.browser.finish': {
      if (legalStatus(app.database).receipt?.version !== command.termsVersion) throw new Error('Review and accept the terms before signing in.')
      const result = await app.cloud.browserSignInFinish(command.id, command.termsVersion)
      if (!result.pending) app.audit.append('cloud.signed_in', 'user', null, { termsVersion: command.termsVersion, method: 'verified_browser', accountId: result.status?.entitlement?.account?.id ?? null })
      return result
    }
    case 'cloud.browser.cancel': return app.cloud.browserSignInCancel(command.id)
    case 'cloud.signin.start': return app.cloudSignInStart(command.email)
    case 'cloud.signin.verify': return app.cloudSignInVerify(command.challengeId, command.code, command.termsVersion)
    case 'cloud.signout_all': return app.cloudSignOutAll()
    case 'cloud.signout': return app.cloudSignOut()
    case 'cloud.checkout': return app.cloudCheckoutUrl({
      ...(command.plan === undefined ? {} : { plan: command.plan }),
      ...(command.interval === undefined ? {} : { interval: command.interval }),
      ...(command.pack === undefined ? {} : { pack: command.pack }),
    }).then((url) => ({ url }))
    case 'cloud.portal': return app.cloudPortalUrl().then((url) => ({ url }))
    case 'cloud.delete_account': return app.cloudDeleteAccount(command.confirmation)
    case 'provider.models': return app.providers.listModels(command.providerId).then((models) => ({ models }))
    case 'provider.set_model': return app.providers.setModel(command.providerId, command.model)
    case 'model.rate.get': return { rate: app.modelRate(command.providerId, command.model) }
    case 'model.rate.set': {
      const rate = command.inputPerMillion === null || command.outputPerMillion === null
        ? null
        : { inputPerMillion: command.inputPerMillion, outputPerMillion: command.outputPerMillion }
      app.setModelRate(command.providerId, command.model, rate)
      return { rate }
    }
    case 'model.spend': return app.modelSpend(command.sinceIso)
    case 'cost.debug.get': return { enabled: app.costDebugEnabled() }
    case 'cost.debug.set': return { enabled: app.setCostDebug(command.enabled) }
    case 'cost.observation': return app.observationCostEstimate(command.intervalSeconds, command.readsText === true)
    case 'cost.induction': return app.aiInductionCostEstimate(command.sessionId, command.providerId)
    case 'embedding.policy': return app.embeddingPolicy()
    case 'embedding.set_mode': { app.setEmbeddingMode(command.mode); return app.embeddingPolicy() }
    case 'embedding.consent': { app.setEmbeddingConsent(command.providerId); return app.embeddingPolicy() }
    case 'recall.image_consent': return { providerId: app.setImageConsent(command.providerId) }
    case 'recall.unread_count': return { unread: app.recallUnreadCount() }
    case 'ambient.set_enabled': return app.setAmbientEnabled(command.enabled)
    case 'ambient.set_text': return app.setAmbientTextEnabled(command.enabled)
    case 'ambient.candidate.dismiss': return app.dismissWorkflowCandidate(command.candidateId)
    case 'session.start': return app.startSession(command.name, command.fixtureId, command.capturePolicy)
    case 'session.action': {
      if (command.action === 'capture') return app.captureNext(command.sessionId)
      if (command.action === 'pause') return app.pauseSession(command.sessionId)
      if (command.action === 'resume') return app.resumeSession(command.sessionId)
      return app.stopSessionAndName(command.sessionId)
    }
    case 'procedure.correct': return app.correctProcedure(command.procedureId, command.correction)
    case 'work.public_source.open': return { url: app.publicSourceUrl(command.runId, command.url) }
    case 'work.prepare': return app.prepareWork(command.goal, command.autonomy, command.providerId, command.parameterValues, command.selection, command.memory, command.followUpRunId, command.budget, command.freshSession, command.intent, command.supervision, true, undefined, command.routeSourceTarget)
    case 'plan.create': return app.createPlan(command.goal, command.autonomy, command.providerId, command.parameterValues, command.intent, command.supervision)
    case 'run.action': {
      if (command.action === 'start') {
        const run = app.database.getRun(command.runId)
        if (run?.plan.contract?.allowedTools.includes('computer.live')) {
          throw new Error('This selected-window plan starts from the Live computer panel; it never runs as a generic background task')
        }
        void app.executeRun(command.runId).catch((error: unknown) => {
          app.audit.append('agent.run_crashed', 'system', command.runId, { error: String(error) })
        })
        return { runId: command.runId, started: true }
      }
      return app.executor.stop(command.runId)
    }
    case 'recovery.action': return command.action === 'create'
      ? app.createRecoveryPlan(command.runId, command.providerId)
      : app.dismissRecovery(command.runId)
    case 'approval.action': return command.action === 'approve'
      ? app.executor.approve(command.approvalId)
      : app.executor.cancelApproval(command.approvalId)
    case 'checkpoint.action': {
      const checkpoint = app.database.getCheckpointDecision(command.checkpointId)
      if (checkpoint?.subject === 'data_transfer') {
        return app.decideLiveComputerContextTransfer(checkpoint.subjectId, command.action)
      }
      return command.action === 'approve'
        ? app.executor.approveCheckpoint(command.checkpointId)
        : app.executor.declineCheckpoint(command.checkpointId)
    }
    case 'supervision.change': return app.amendRunSupervision(command.runId, command.preset)
    case 'provider.action': {
      if (command.action === 'health') return app.providers.get(command.providerId).health()
      const selected = app.providers.select(command.providerId)
      app.audit.append('model.provider_selected', 'user', command.providerId, {
        kind: selected.kind,
        model: selected.model,
        privacyNote: selected.privacyNote,
      })
      return selected
    }
    case 'browser.sandbox.reset': return app.resetBrowserSandbox(command.priority, command.application, command.layout)
    case 'browser.sandbox.open_external': return { url: app.browserSandbox.summary().url }
    case 'computer.lab.run': return app.runComputerUseSimulation(command.scenarioId, command.architectureId, command.variation)
    case 'computer.lab.run_suite': return app.runComputerUseSimulationSuite(command.architectureId)
    case 'computer.lab.clear': {
      app.clearComputerUseSimulations()
      return { cleared: true }
    }
    case 'evaluation.campaign.preview': return app.previewEvaluationCampaign(command.suite)
    case 'evaluation.campaign.run': return app.runEvaluationCampaign(command.suite, command.manifestHash)
    case 'evaluation.live_mac.preflight':
    case 'evaluation.live_mac.propose':
    case 'evaluation.live_mac.authorize_and_run':
    case 'evaluation.live_mac.stop': throw new Error('Live-Mac canaries are provided only by the desktop shell')
  }
}

export function validateCarveCommand(value: unknown): CarveCommand {
  const command = record(value, 'Desktop command')
  const kind = string(command.kind, 'command kind')
  if (kind === 'voice.settings.get' || kind === 'voice.preview.stop') return { kind }
  if (kind === 'voice.settings.set') {
    if (command.enabled !== undefined && typeof command.enabled !== 'boolean') throw new Error('Invalid spoken replies preference')
    if (command.voiceId !== undefined && !isVoiceId(command.voiceId)) throw new Error('Unknown voice')
    return { kind, ...(typeof command.enabled === 'boolean' ? { enabled: command.enabled } : {}), ...(isVoiceId(command.voiceId) ? { voiceId: command.voiceId } : {}) }
  }
  if (kind === 'voice.preview') {
    if (!isVoiceId(command.voiceId)) throw new Error('Unknown voice')
    return { kind, voiceId: command.voiceId }
  }
  if (kind === 'voice.preview.playback') {
    if (typeof command.id !== 'number' || !Number.isSafeInteger(command.id) || command.id < 1) throw new Error('Invalid playback ID')
    return { kind, id: command.id, state: oneOf(command.state, ['started', 'ended', 'error'] as const, 'playback state') }
  }
  if (kind === 'legal.status') return { kind }
  if (kind === 'legal.accept') return { kind, version: string(command.version, 'legal version') }
  if (kind === 'legal.acknowledge') return { kind, version: string(command.version, 'legal version') }
  if (kind === 'state.get' || kind === 'system.global_stop' || kind === 'desktop.status' || kind === 'desktop.practice.prepare' || kind === 'native.capture.status' || kind === 'native.capture.request_permission' || kind === 'computer.status' || kind === 'computer.request_screen_recording_permission' || kind === 'computer.request_accessibility_permission' || kind === 'computer.surface_preferences.get' || kind === 'computer.session.propose' || kind === 'computer.session.frame' || kind === 'computer.lab.clear' || kind === 'browser.sandbox.open_external') return { kind }
  if (kind === 'computer.targets.list') return { kind, ...(typeof command.quiet === 'boolean' ? { quiet: command.quiet } : {}) }
  if (kind === 'computer.applications.list') return { kind, ...(typeof command.quiet === 'boolean' ? { quiet: command.quiet } : {}) }
  if (kind === 'computer.surface_preferences.set') {
    const capability = oneOf(command.capability, ['web_browser', 'text_document', 'spreadsheet', 'presentation', 'file_manager', 'calculator', 'document_viewer', 'general_application'] as const, 'application preference capability')
    const mode = oneOf(command.mode, ['automatic', 'specific_application', 'ask_each_time'] as const, 'application preference mode')
    const bundleIdentifier = command.bundleIdentifier === null ? null : string(command.bundleIdentifier, 'preferred application bundle identifier').trim()
    if (bundleIdentifier && (bundleIdentifier.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9.-]+$/u.test(bundleIdentifier))) throw new Error('Preferred application bundle identifier is invalid')
    if (mode === 'specific_application' ? !bundleIdentifier : bundleIdentifier !== null) throw new Error('Application preference and selected application do not match')
    const source = command.source === undefined ? undefined : oneOf(command.source, ['settings', 'confirmed_override'] as const, 'application preference source')
    return { kind, capability, mode, bundleIdentifier, ...(source ? { source } : {}) }
  }
  if (kind === 'computer.surface_preferences.clear') return { kind, capability: oneOf(command.capability, ['web_browser', 'text_document', 'spreadsheet', 'presentation', 'file_manager', 'calculator', 'document_viewer', 'general_application'] as const, 'application preference capability') }
  if (kind === 'computer.route.infer') return { kind, runId: string(command.runId, 'run id'), providerId: string(command.providerId, 'provider id') }
  if (kind === 'computer.route.preview') {
    if (!Array.isArray(command.route)) throw new Error('Suggested window route must be an array')
    if (command.route.length > 4) throw new Error('Suggested window route may contain at most four windows')
    return {
      kind,
      runId: string(command.runId, 'run id'),
      route: command.route.map((value) => liveComputerRouteAuditEntry(value)),
    }
  }
  if (kind === 'computer.surface.open') {
    const bundleIdentifier = string(command.bundleIdentifier, 'application')
    if (bundleIdentifier.length > 240) throw new Error('Application identifier is invalid')
    const url = command.url === undefined || command.url === null ? null : string(command.url, 'address')
    if (url !== null && (url.length > 2_000 || !/^https:\/\/[^\s/?#]+/u.test(url))) throw new Error('A fresh browser window needs one complete https:// address')
    const runId = command.runId === undefined || command.runId === null ? null : string(command.runId, 'run id')
    return { kind, bundleIdentifier, url, runId }
  }
  if (kind === 'computer.surface.close_fresh') {
    const runId = command.runId === undefined || command.runId === null ? null : string(command.runId, 'run id')
    return { kind, runId }
  }
  if (kind === 'computer.handoff.destinations') return { kind }
  if (kind === 'computer.handoff.destination') {
    if (command.windowId !== undefined && (!Number.isSafeInteger(command.windowId) || Number(command.windowId) < 1)) throw new Error('Invalid destination window')
    const selected = command.target === undefined ? undefined : liveComputerTarget(command.target)
    if (command.windowId !== undefined && (!selected || selected.windowId !== command.windowId || selected.bundleIdentifier !== command.bundleIdentifier) || selected && command.windowId === undefined) throw new Error('The selected window changed. Open the destination picker again.')
    return { kind, taskId: string(command.taskId, 'task id'), revision: string(command.revision, 'revision'), bundleIdentifier: string(command.bundleIdentifier, 'application'), ...(selected ? { windowId: selected.windowId, target: selected } : {}) }
  }
  if (kind === 'computer.handoff.decide') return { kind, taskId: string(command.taskId, 'task id'), revision: string(command.revision, 'handoff revision'), action: oneOf(command.action, ['approve', 'decline', 'cancel'] as const, 'handoff action') }
  if (kind === 'computer.route.start') {
    if (!Array.isArray(command.route)) throw new Error('Work-surface route must be an array')
    if (command.route.length < 1 || command.route.length > 4) throw new Error('A work-surface route needs one to four windows')
    const route = command.route.map((value) => liveComputerRouteStartEntry(value))
    if (route[0]?.authority !== 'input') throw new Error('The first work surface must allow control')
    const verifierProviderId = command.verifierProviderId == null ? null : string(command.verifierProviderId, 'verifier provider id')
    const idempotencyKey = string(command.idempotencyKey, 'route start idempotency key').trim()
    if (idempotencyKey.length > 200 || !/^[A-Za-z0-9._:-]+$/u.test(idempotencyKey)) throw new Error('Route start idempotency key is invalid')
    return {
      kind,
      runId: string(command.runId, 'run id'),
      providerId: string(command.providerId, 'provider id'),
      ...(verifierProviderId ? { verifierProviderId } : {}),
      route,
      remoteVisualsAllowed: boolean(command.remoteVisualsAllowed, 'remote visuals allowed'),
      idempotencyKey,
    }
  }
  if (kind === 'data.export') return { kind, passphrase: string(command.passphrase, 'export passphrase') }
  if (kind === 'desktop.open_system_settings') return { kind, pane: oneOf(command.pane, ['screen_recording', 'accessibility'] as const, 'desktop settings pane') }
  if (kind === 'computer.session.start') {
    const verifierProviderId = command.verifierProviderId == null ? null : string(command.verifierProviderId, 'verifier provider id')
    const targetRole = command.targetRole === undefined
      ? undefined
      : oneOf(command.targetRole, ['workspace', 'research', 'destination', 'reference'] as const, 'primary window role')
    const targetPurpose = optionalString(command.targetPurpose, 'primary window purpose')?.trim()
    if (targetPurpose && targetPurpose.length > 120) throw new Error('Primary window purpose is too long')
    if (command.additionalTargets !== undefined && !Array.isArray(command.additionalTargets)) throw new Error('Additional live computer targets must be an array')
    const additionalTargets = (command.additionalTargets ?? []).map((value) => liveComputerSessionTarget(value))
    if (additionalTargets.length > 3) throw new Error('A live session may authorize at most four windows')
    return {
      kind,
      runId: string(command.runId, 'run id'),
      providerId: string(command.providerId, 'provider id'),
      ...(verifierProviderId ? { verifierProviderId } : {}),
      target: liveComputerTarget(command.target),
      ...(targetRole ? { targetRole } : {}),
      ...(targetPurpose ? { targetPurpose } : {}),
      ...(additionalTargets.length ? { additionalTargets } : {}),
      remoteVisualsAllowed: boolean(command.remoteVisualsAllowed, 'remote visuals allowed'),
    }
  }
  if (kind === 'computer.targets.recommend') return { kind, goal: string(command.goal, 'goal'), providerId: string(command.providerId, 'provider id') }
  if (kind === 'computer.session.plan.visibility') return { kind, sessionId: string(command.sessionId, 'session id'), planHash: string(command.planHash, 'plan hash'), visible: boolean(command.visible, 'visible') }
  if (kind === 'computer.session.plan.approve') return { kind, planHash: string(command.planHash, 'live mission plan hash') }
  if (kind === 'computer.session.targets.add') return { kind, entry: liveComputerSessionTarget(command.entry) }
  if (kind === 'computer.visuals_consent' || kind === 'computer.catalog_consent') {
    if (command.providerId !== null && typeof command.providerId !== 'string') throw new Error('Visuals consent needs a provider id or null')
    if (command.remember !== undefined && typeof command.remember !== 'boolean') throw new Error('Remember must be a boolean')
    return { kind, providerId: command.providerId === null ? null : string(command.providerId, 'provider id'), remember: command.remember === true, ...(kind === 'computer.catalog_consent' && command.runId !== undefined ? { runId: string(command.runId, 'run id') } : {}) }
  }
  if (kind === 'computer.execution_mode.set') {
    return { kind, mode: oneOf(command.mode, ['legacy', 'capability_vm_v1'] as const, 'live computer execution mode') }
  }
  if (kind === 'computer.action_engine.set') {
    return { kind, engine: oneOf(command.engine, liveComputerActionEngines, 'live computer action engine') }
  }
  if (kind === 'computer.model_profile.set') {
    return { kind, profile: oneOf(command.profile, ['adaptive_5_6', 'astra'] as const, 'live computer model profile') }
  }
  if (kind === 'computer.service_tier.set') {
    return { kind, tier: oneOf(command.tier, ['default', 'fast'] as const, 'processing tier') }
  }
  if (kind === 'computer.session.guidance') {
    const questionId = string(command.questionId, 'current question id')
    if (!questionId || questionId.length > 100) throw new Error('A current question id is required')
    const optionId = command.optionId == null ? null : string(command.optionId, 'guidance option id')
    const directive = command.directive == null ? null : string(command.directive, 'guidance directive')
    if (optionId && optionId.length > 40) throw new Error('Guidance option id is invalid')
    if (directive && directive.length > 4000) throw new Error('Describe the direction in a sentence or two')
    if (!optionId && !directive?.trim()) throw new Error('Choose an option or describe how Carve should proceed')
    return { kind, questionId, optionId, directive }
  }
  if (kind === 'computer.session.context_transfer') {
    const transferId = string(command.transferId, 'context transfer id')
    if (transferId.length > 100) throw new Error('Context transfer id is invalid')
    return { kind, transferId, action: oneOf(command.action, ['approve', 'decline'] as const, 'context transfer action') }
  }
  if (kind === 'computer.session.plan.revise') {
    const feedback = string(command.feedback, 'plan revision feedback')
    if (feedback.length > 1_000) throw new Error('Describe the plan change in a sentence or two')
    return { kind, feedback }
  }
  if (kind === 'computer.session.follow_up') {
    const goal = string(command.goal, 'follow-up goal')
    if (goal.length > assistanceRequestMaxLength) throw new Error('Describe the follow-up in a sentence or two')
    return { kind, goal }
  }
  if (kind === 'computer.guide.ask') {
    const question = string(command.question, 'Guide question').trim()
    if (!question || question.length > assistanceRequestMaxLength) throw new Error('Ask Guide a question of 4,000 characters or fewer')
    return { kind, question, target: liveComputerTarget(command.target) }
  }
  if (kind === 'computer.guide.authority') return { kind }
  if (kind === 'computer.assistance.open') return { kind, target: liveComputerTarget(command.target), mode: oneOf(command.mode, ['guide', 'do'] as const, 'Assistance mode') }
  if (kind === 'computer.assistance.mode' || kind === 'computer.assistance.approvals') {
    const conversationId = string(command.conversationId, 'Conversation id')
    const commandId = string(command.commandId, 'Command id')
    if (conversationId.length > 200 || commandId.length > 200 || !Number.isSafeInteger(command.revision) || Number(command.revision) < 0) throw new Error('Invalid conversation revision')
    if (kind === 'computer.assistance.approvals') return { kind, preset: oneOf(command.preset, ['fast', 'smart_checkpoints', 'step_by_step'] as const, 'Approval mode'), conversationId, commandId, revision: Number(command.revision) }
    return { kind, mode: oneOf(command.mode, ['guide', 'do'] as const, 'Assistance mode'), conversationId, commandId, revision: Number(command.revision) }
  }
  if (kind === 'computer.assistance.drawing.start') return { kind }
  if (kind === 'computer.assistance.drawing') {
    const edit = parseDrawingEdit(command.edit)
    if (!edit) throw new Error('Invalid drawing edit.')
    return { kind, edit }
  }
  if (kind === 'computer.assistance.refresh' || kind === 'computer.assistance.clear') return { kind }
  if (kind === 'computer.assistance.accept') {
    const conversationId = string(command.conversationId, 'Conversation id')
    const turnId = string(command.turnId, 'Turn id')
    const candidateId = string(command.candidateId, 'Action id')
    const commandId = string(command.commandId, 'Command id')
    if ([conversationId, turnId, candidateId, commandId].some(value => !value || value.length > 200)) throw new Error('Invalid follow-up identity')
    return { kind, conversationId, turnId, candidateId, commandId }
  }
  if (kind === 'computer.assistance.ask') {
    const question = string(command.question, 'Question')
    if (question.length > assistanceRequestMaxLength) throw new Error('Ask a question of 4,000 characters or fewer')
    return { kind, question }
  }
  if (kind === 'computer.attachments.list') return { kind }
  if (kind === 'computer.attachments.focus' || kind === 'computer.attachments.retire') {
    const id = string(command.id, 'Attachment id')
    if (!id || id.length > 200) throw new Error('Invalid attachment id')
    return { kind, id }
  }
  if (kind === 'computer.assistance.delegate') {
    const goal = command.goal === undefined ? undefined : string(command.goal, 'Task').trim()
    if (goal !== undefined && (!goal || goal.length > assistanceRequestMaxLength)) throw new Error('Describe the task in 4,000 characters or fewer')
    return { kind, scope: oneOf(command.scope, ['task', 'step'] as const, 'Delegation scope'), ...(goal === undefined ? {} : { goal }) }
  }
  if (kind === 'computer.universal.budget') {
    const checkpointId = string(command.checkpointId, 'Universal budget checkpoint id')
    if (checkpointId.length > 100) throw new Error('Universal budget checkpoint id is invalid')
    return { kind, action: oneOf(command.action, ['grant'] as const, 'Universal budget action'), checkpointId }
  }
  if (kind === 'computer.universal.steer') {
    const text = string(command.text, 'Universal course correction').trim()
    if (!text || text.length > assistanceRequestMaxLength) throw new Error('Describe the course correction in 4,000 characters or fewer')
    return { kind, text, source: oneOf(command.source, ['text', 'voice'] as const, 'Universal steering source') }
  }
  if (kind === 'computer.universal.retry') {
    const sessionId = string(command.sessionId, 'Universal session id')
    if (sessionId.length > 100) throw new Error('Universal session id is invalid')
    // Continue with a note: the person's own guidance for the next attempt (universal-termination.ts).
    const note = command.note === undefined || command.note === null ? '' : string(command.note, 'Continue note').trim()
    if (note.length > maximumRetryNoteCharacters) throw new Error(`Keep the note to ${maximumRetryNoteCharacters.toLocaleString('en-US')} characters or fewer`)
    const withNote = note ? { note } : {}
    if (command.preset === undefined || command.preset === null) return { kind, sessionId, ...withNote }
    return { kind, sessionId, preset: oneOf(command.preset, ['autopilot'] as const, 'retry preset'), ...withNote }
  }
  if (kind === 'dictation.sharing.get') return { kind }
  if (kind === 'dictation.sharing.set') {
    if (typeof command.enabled !== 'boolean' || (command.remember !== undefined && typeof command.remember !== 'boolean')) throw new Error('Invalid dictation sharing choice')
    return { kind, enabled: command.enabled, remember: command.remember === true }
  }
  if (kind === 'dictation.transcribe') {
    const audioBase64 = string(command.audioBase64, 'dictation audio')
    if (audioBase64.length > 12 * 1024 * 1024) throw new Error('Dictation audio exceeds the transcription size limit')
    return { kind, audioBase64, mimeType: string(command.mimeType, 'dictation audio format') }
  }
  if (kind === 'dictation.stream.begin') return { kind, mimeType: string(command.mimeType, 'dictation audio format') }
  if (kind === 'dictation.stream.push') {
    const audioBase64 = string(command.audioBase64, 'dictation audio chunk')
    if (audioBase64.length > 1_000_000) throw new Error('Dictation audio chunk exceeds the streaming size limit')
    return { kind, sessionId: string(command.sessionId, 'dictation session id'), audioBase64 }
  }
  if (kind === 'dictation.stream.end') return { kind, sessionId: string(command.sessionId, 'dictation session id') }
  if (kind === 'computer.session.action') return { kind, action: oneOf(command.action, ['approve', 'pause', 'resume', 'stop'] as const, 'live computer action') }
  if (kind === 'observation.screenshot') return { kind, observationId: string(command.observationId, 'observation id') }
  if (kind === 'observation.review') return { kind, observationId: string(command.observationId, 'observation id'), review: observationReview(command.review) }
  if (kind === 'observation.delete') {
    if (command.confirmation !== 'DELETE OBSERVATION') throw new Error('Exact observation deletion confirmation required')
    return { kind, observationId: string(command.observationId, 'observation id'), confirmation: 'DELETE OBSERVATION' }
  }
  if (kind === 'ai.induction.disclosure') return { kind, sessionId: string(command.sessionId, 'session id'), providerId: string(command.providerId, 'provider id') }
  if (kind === 'ai.induction.analyze') {
    const confirmation = optionalString(command.confirmation, 'confirmation')
    return {
      kind,
      sessionId: string(command.sessionId, 'session id'),
      providerId: string(command.providerId, 'provider id'),
      manifestHash: string(command.manifestHash, 'manifest hash'),
      ...(confirmation === undefined ? {} : { confirmation }),
    }
  }
  if (kind === 'ai.draft.correct') return { kind, draftId: string(command.draftId, 'draft id'), correction: aiDraftCorrection(command.correction) }
  if (kind === 'ai.draft.decide') return { kind, draftId: string(command.draftId, 'draft id'), decision: oneOf(command.decision, ['accept', 'reject'] as const, 'draft decision') }
  if (kind === 'data.purge') return { kind, confirmation: string(command.confirmation, 'confirmation') }
  if (kind === 'recall.query') {
    const providerId = optionalString(command.providerId, 'provider id')
    const conversationId = optionalString(command.conversationId, 'conversation id')
    return {
      kind,
      question: string(command.question, 'question'),
      ...(command.infer === undefined ? {} : { infer: boolean(command.infer, 'infer') }),
      ...(providerId === undefined ? {} : { providerId }),
      ...(command.depth === undefined ? {} : { depth: oneOf(command.depth, ['brief', 'normal', 'thorough'] as const, 'depth') }),
      ...(command.withImages === undefined ? {} : { withImages: boolean(command.withImages, 'with images') }),
      ...(command.scope === undefined ? {} : { scope: recallScope(command.scope) }),
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(command.save === undefined ? {} : { save: boolean(command.save, 'save conversation turn') }),
      ...(command.replaceLast === undefined ? {} : { replaceLast: boolean(command.replaceLast, 'replace last conversation reply') }),
    }
  }
  if (kind === 'recall.conversations.list') return { kind }
  if (kind === 'recall.conversation.get' || kind === 'recall.conversation.delete') {
    return { kind, conversationId: string(command.conversationId, 'conversation id') }
  }
  if (kind === 'recall.conversation.rename') {
    return { kind, conversationId: string(command.conversationId, 'conversation id'), title: string(command.title, 'conversation title') }
  }
  if (kind === 'recall.scope_count') {
    const bounds = recallScope(command)
    return { kind, fromIso: bounds.fromIso, toIso: bounds.toIso, sessionIds: bounds.sessionIds }
  }
  if (kind === 'recall.answer_consent') {
    if (command.providerId !== null && typeof command.providerId !== 'string') throw new Error('provider id must be a string or null')
    return { kind, providerId: command.providerId === null ? null : string(command.providerId, 'provider id') }
  }
  if (kind === 'recall.answer_policy') {
    const providerId = optionalString(command.providerId, 'provider id')
    return { kind, ...(providerId === undefined ? {} : { providerId }) }
  }
  if (kind === 'recall.enrich_text') {
    return {
      kind,
      ...(command.momentIds === undefined ? {} : { momentIds: stringArray(command.momentIds, 'moment ids') }),
      ...(command.scope === undefined ? {} : { scope: recallScope(command.scope) }),
    }
  }
  if (kind === 'recall.unread_captures') {
    const bounds = recallScope(command)
    return { kind, fromIso: bounds.fromIso, toIso: bounds.toIso, sessionIds: bounds.sessionIds }
  }
  if (kind === 'recall.skip_captures') return { kind, momentIds: stringArray(command.momentIds, 'moment ids') }
  if (kind === 'recall.clear_skips') return { kind }
  if (kind === 'receipt.list' || kind === 'autonomy.ledger') return { kind }
  if (kind === 'receipt.get' || kind === 'receipt.export_image') return { kind, runId: string(command.runId, 'run id') }
  if (kind === 'autonomy.recommend') return { kind, goal: string(command.goal, 'goal') }
  if (kind === 'autonomy.decide') return { kind, workflowKey: string(command.workflowKey, 'workflow key'), decision: oneOf(command.decision, ['accept', 'decline'] as const, 'decision') }
  if (kind === 'cloud.status' || kind === 'cloud.refresh' || kind === 'cloud.signout' || kind === 'cloud.signout_all' || kind === 'cloud.portal') return { kind }
  if (kind === 'cloud.signin.status') return { kind, ticket: string(command.ticket, 'verification ticket') }
  if (kind === 'cloud.browser.start') return { kind, email: string(command.email, 'email'), termsVersion: string(command.termsVersion, 'terms version') }
  if (kind === 'cloud.browser.finish') return { kind, id: string(command.id, 'request'), termsVersion: string(command.termsVersion, 'terms version') }
  if (kind === 'cloud.browser.cancel') return { kind, id: string(command.id, 'request') }
  if (kind === 'cloud.signin.start') return { kind, email: string(command.email, 'email') }
  if (kind === 'cloud.signin.verify') return { kind, challengeId: string(command.challengeId, 'challenge id'), code: string(command.code, 'code'), ...(command.termsVersion === undefined ? {} : { termsVersion: string(command.termsVersion, 'terms version') }) }
  if (kind === 'cloud.checkout') {
    if (command.pack !== undefined) return { kind, pack: oneOf(command.pack, ['tasks_20', 'tasks_100'] as const, 'task pack') }
    return {
      kind,
      plan: oneOf(command.plan, ['pro', 'max', 'own_key'] as const, 'plan'),
      interval: oneOf(command.interval, ['month', 'year', 'lifetime'] as const, 'billing interval'),
    }
  }
  if (kind === 'cloud.delete_account') return { kind, confirmation: string(command.confirmation, 'confirmation') }
  if (kind === 'provider.models') return { kind, providerId: string(command.providerId, 'provider id') }
  if (kind === 'provider.set_model') return { kind, providerId: string(command.providerId, 'provider id'), model: string(command.model, 'model') }
  if (kind === 'model.rate.get') return { kind, providerId: string(command.providerId, 'provider id'), model: string(command.model, 'model') }
  if (kind === 'model.rate.set') {
    const rate = (value: unknown, label: string): number | null => {
      if (value === null || value === undefined || value === '') return null
      const parsed = number(value, label)
      if (parsed < 0) throw new Error(`${label} cannot be negative`)
      return parsed
    }
    return {
      kind,
      providerId: string(command.providerId, 'provider id'),
      model: string(command.model, 'model'),
      inputPerMillion: rate(command.inputPerMillion, 'input rate'),
      outputPerMillion: rate(command.outputPerMillion, 'output rate'),
    }
  }
  if (kind === 'cost.debug.get') return { kind }
  if (kind === 'cost.debug.set') return { kind, enabled: boolean(command.enabled, 'enabled') }
  if (kind === 'cost.observation') return { kind, intervalSeconds: number(command.intervalSeconds, 'interval'), ...(command.readsText === undefined ? {} : { readsText: boolean(command.readsText, 'reads text') }) }
  if (kind === 'recall.image_consent') {
    if (command.providerId !== null && typeof command.providerId !== 'string') throw new Error('provider id must be a string or null')
    return { kind, providerId: command.providerId === null ? null : string(command.providerId, 'provider id') }
  }
  if (kind === 'embedding.policy') return { kind }
  if (kind === 'embedding.set_mode') return { kind, mode: oneOf(command.mode, ['off', 'local', 'hosted'] as const, 'embedding mode') }
  if (kind === 'embedding.consent') {
    if (command.providerId !== null && typeof command.providerId !== 'string') throw new Error('provider id must be a string or null')
    return { kind, providerId: command.providerId === null ? null : string(command.providerId, 'provider id') }
  }
  if (kind === 'cost.induction') return { kind, sessionId: string(command.sessionId, 'session id'), providerId: string(command.providerId, 'provider id') }
  if (kind === 'model.spend') return { kind, sinceIso: command.sinceIso === null || command.sinceIso === undefined ? null : string(command.sinceIso, 'since') }
  if (kind === 'recall.unread_count') return { kind }
  if (kind === 'ambient.set_enabled' || kind === 'ambient.set_text') {
    if (typeof command.enabled !== 'boolean') throw new Error('Ambient enabled must be a boolean')
    return { kind, enabled: command.enabled }
  }
  if (kind === 'ambient.candidate.dismiss') return { kind, candidateId: string(command.candidateId, 'candidate id') }
  if (kind === 'session.start') {
    return {
      kind,
      name: string(command.name, 'session name'),
      fixtureId: string(command.fixtureId, 'fixture id'),
      capturePolicy: capturePolicy(command.capturePolicy),
    }
  }
  if (kind === 'session.action') {
    const action = oneOf(command.action, ['capture', 'pause', 'resume', 'stop'] as const, 'session action')
    return { kind, sessionId: string(command.sessionId, 'session id'), action }
  }
  if (kind === 'procedure.correct') {
    return {
      kind,
      procedureId: string(command.procedureId, 'procedure id'),
      correction: correction(command.correction),
    }
  }
  if (kind === 'work.public_source.open') return { kind, runId: string(command.runId, 'run id'), url: string(command.url, 'source URL') }
  if (kind === 'work.prepare' || kind === 'plan.create') {
    const autonomy = string(command.autonomy, 'autonomy') as AutonomyLevel
    if (!autonomyLevels.has(autonomy)) throw new Error('Autonomy level is missing or unknown')
    const providerId = optionalString(command.providerId, 'provider id')
    const parameterValues = command.parameterValues === undefined ? undefined : stringMap(command.parameterValues, 'workflow inputs')
    const selection = kind === 'work.prepare' && command.selection !== undefined
      ? { interpretationId: string(record(command.selection, 'context selection').interpretationId, 'interpretation id') }
      : undefined
    const memory = kind === 'work.prepare' && command.memory !== undefined
      ? parseWorkMemoryScope(command.memory)
      : undefined
    const followUpRunId = kind === 'work.prepare' ? optionalString(command.followUpRunId, 'follow-up run id') : undefined
    const budget = kind === 'work.prepare' && command.budget !== undefined
      ? oneOf(command.budget, ['quick', 'balanced', 'thorough'] as const, 'work budget')
      : undefined
    const routeSourceTarget = kind === 'work.prepare' && command.routeSourceTarget !== undefined ? liveComputerTarget(command.routeSourceTarget) : undefined
    const freshSession = kind === 'work.prepare' && command.freshSession !== undefined
      ? boolean(command.freshSession, 'fresh session')
      : undefined
    const intent = command.intent === undefined ? undefined : oneOf(command.intent, ['context_only', 'plan_only', 'execute'] as const, 'work intent')
    const supervision = command.supervision === undefined ? undefined : parseSupervisionPolicy(command.supervision)
    if ((intent === undefined) !== (supervision === undefined)) throw new Error('Work intent and supervision policy must be provided together')
    return {
      kind,
      goal: string(command.goal, 'goal'),
      autonomy,
      ...(intent === undefined ? {} : { intent }),
      ...(supervision === undefined ? {} : { supervision }),
      ...(providerId === undefined ? {} : { providerId }),
      ...(parameterValues === undefined ? {} : { parameterValues }),
      ...(selection === undefined ? {} : { selection }),
      ...(memory === undefined ? {} : { memory }),
      ...(followUpRunId === undefined ? {} : { followUpRunId }),
      ...(budget === undefined ? {} : { budget }),
      ...(freshSession === undefined ? {} : { freshSession }),
      ...(routeSourceTarget === undefined ? {} : { routeSourceTarget }),
    }
  }
  if (kind === 'run.action') {
    return {
      kind,
      runId: string(command.runId, 'run id'),
      action: oneOf(command.action, ['start', 'stop'] as const, 'run action'),
    }
  }
  if (kind === 'recovery.action') {
    const providerId = optionalString(command.providerId, 'provider id')
    return {
      kind,
      runId: string(command.runId, 'run id'),
      action: oneOf(command.action, ['create', 'dismiss'] as const, 'recovery action'),
      ...(providerId === undefined ? {} : { providerId }),
    }
  }
  if (kind === 'approval.action') {
    return {
      kind,
      approvalId: string(command.approvalId, 'approval id'),
      action: oneOf(command.action, ['approve', 'cancel'] as const, 'approval action'),
    }
  }
  if (kind === 'checkpoint.action') {
    return {
      kind,
      checkpointId: string(command.checkpointId, 'checkpoint id'),
      action: oneOf(command.action, ['approve', 'decline'] as const, 'checkpoint action'),
    }
  }
  if (kind === 'supervision.change') {
    return {
      kind,
      runId: string(command.runId, 'run id'),
      preset: oneOf(command.preset, ['fast', 'smart_checkpoints', 'step_by_step', 'autopilot'] as const, 'supervision preset'),
    }
  }
  if (kind === 'provider.action') {
    return {
      kind,
      providerId: string(command.providerId, 'provider id'),
      action: oneOf(command.action, ['select', 'health'] as const, 'provider action'),
    }
  }
  if (kind === 'browser.sandbox.reset') {
    const application = command.application === undefined ? undefined : oneOf(command.application, ['triage', 'handoff', 'document', 'insurance', 'research', 'data', 'hr', 'logistics', 'legal', 'inventory', 'quality'] as const, 'browser sandbox application')
    const layout = command.layout === undefined ? undefined : oneOf(command.layout, ['baseline', 'changed', 'ambiguous'] as const, 'browser sandbox layout')
    return { kind, priority: oneOf(command.priority, ['urgent', 'standard'] as const, 'browser sandbox priority'), ...(application === undefined ? {} : { application }), ...(layout === undefined ? {} : { layout }) }
  }
  if (kind === 'computer.lab.run') {
    return {
      kind,
      scenarioId: oneOf(command.scenarioId, ['document_end', 'insurance_claim', 'web_research', 'data_reconciliation', 'hr_onboarding', 'logistics_exception', 'contract_intake', 'inventory_variance', 'quality_hold', 'support_triage', 'customer_handoff'] as const, 'computer-use scenario'),
      architectureId: oneOf(command.architectureId, ['reactive_pixel', 'stateful_visual', 'hybrid_grounded', 'hierarchical_governed'] as const, 'computer-use architecture'),
      variation: oneOf(command.variation, ['baseline', 'changed', 'ambiguous'] as const, 'computer-use variation'),
    }
  }
  if (kind === 'computer.lab.run_suite') {
    const architectureId = command.architectureId === undefined ? undefined : oneOf(command.architectureId, ['reactive_pixel', 'stateful_visual', 'hybrid_grounded', 'hierarchical_governed'] as const, 'computer-use architecture')
    return { kind, ...(architectureId === undefined ? {} : { architectureId }) }
  }
  if (kind === 'evaluation.campaign.preview') {
    return { kind, suite: oneOf(command.suite, ['dictation', 'computer'] as const, 'evaluation suite') }
  }
  if (kind === 'evaluation.campaign.run') {
    const manifestHash = string(command.manifestHash, 'evaluation manifest hash')
    if (!/^[a-f0-9]{64}$/.test(manifestHash)) throw new Error('evaluation manifest hash must be a lowercase SHA-256 digest')
    return { kind, suite: oneOf(command.suite, ['dictation', 'computer'] as const, 'evaluation suite'), manifestHash }
  }
  if (kind === 'evaluation.live_mac.preflight' || kind === 'evaluation.live_mac.propose') {
    const planHash = string(command.planHash, 'live-Mac plan hash')
    if (!/^[a-f0-9]{64}$/u.test(planHash)) throw new Error('live-Mac plan hash must be a lowercase SHA-256 digest')
    const caseIds = stringArray(command.caseIds, 'live-Mac case ids')
    const indexes = caseIds.map((caseId) => liveMacRegressionGateCaseIds.indexOf(caseId as typeof liveMacRegressionGateCaseIds[number]))
    if (caseIds.length === 0 || new Set(caseIds).size !== caseIds.length || indexes.some((index) => index < 0)
      || indexes.some((index, position) => position > 0 && index <= indexes[position - 1]!)) {
      throw new Error(`desktop live-Mac execution supports only ordered selections from ${liveMacRegressionGateCaseIds.join(', ')}`)
    }
    const providerId = string(command.providerId, 'live-Mac provider id').trim()
    if (providerId.length > 160 || !/^[A-Za-z0-9._:-]+$/u.test(providerId)) throw new Error('live-Mac provider id is invalid')
    return { kind, planHash, caseIds, providerId }
  }
  if (kind === 'evaluation.live_mac.authorize_and_run') {
    const runHash = string(command.runHash, 'live-Mac run hash')
    if (!/^[a-f0-9]{64}$/u.test(runHash)) throw new Error('live-Mac run hash must be a lowercase SHA-256 digest')
    const confirmation = string(command.confirmation, 'live-Mac authorization')
    if (confirmation.length > 100) throw new Error('live-Mac authorization is invalid')
    return { kind, runHash, confirmation }
  }
  if (kind === 'evaluation.live_mac.stop') return { kind }
  throw new Error(`Unsupported desktop command: ${kind}`)
}

function capturePolicy(value: unknown): Partial<CapturePolicy> {
  const source = record(value ?? {}, 'capture policy')
  const result: Partial<CapturePolicy> = {}
  for (const key of ['screenshots', 'activeWindow', 'accessibilityTree', 'inputMetadata'] as const) {
    if (source[key] !== undefined) result[key] = boolean(source[key], key)
  }
  if (source.screenText !== undefined) result.screenText = boolean(source.screenText, 'screen text')
  if (source.captureTiming !== undefined) result.captureTiming = normalizeCaptureTiming(source.captureTiming)
  if (source.captureIntervalSeconds !== undefined) result.captureIntervalSeconds = number(source.captureIntervalSeconds, 'capture interval seconds')
  for (const key of ['excludedApplications', 'excludedWindows', 'excludedDomains'] as const) {
    if (source[key] !== undefined) result[key] = stringArray(source[key], key)
  }
  if (source.excludedRegions !== undefined) {
    if (!Array.isArray(source.excludedRegions)) throw new Error('excludedRegions must be an array')
    result.excludedRegions = source.excludedRegions.map((item) => {
      const region = record(item, 'excluded region')
      return {
        x: number(region.x, 'region x'),
        y: number(region.y, 'region y'),
        width: number(region.width, 'region width'),
        height: number(region.height, 'region height'),
      }
    })
  }
  if (source.retentionDays !== undefined) result.retentionDays = number(source.retentionDays, 'retention days')
  return result
}

/** A renderer must never be able to smuggle an arbitrary screen rectangle or
 * application identity across IPC. The native helper independently resolves
 * this target again, but rejecting malformed input here keeps the command
 * boundary explicit and auditable. */
function liveComputerTarget(value: unknown): LiveComputerTarget {
  const source = record(value, 'live computer target')
  const windowId = number(source.windowId, 'live computer window id')
  if (!Number.isSafeInteger(windowId) || windowId < 1) throw new Error('live computer window id must be a positive integer')
  const application = string(source.application, 'live computer application').trim()
  const bundleIdentifier = string(source.bundleIdentifier, 'live computer bundle identifier').trim()
  const title = string(source.title, 'live computer title').trim()
  if (application.length > 240 || title.length > 240) throw new Error('live computer target text is too long')
  if (!/^[A-Za-z0-9.-]+$/u.test(bundleIdentifier) || bundleIdentifier.length > 255) throw new Error('live computer bundle identifier is invalid')
  const boundsSource = record(source.bounds, 'live computer bounds')
  const x = number(boundsSource.x, 'live computer bounds x')
  const y = number(boundsSource.y, 'live computer bounds y')
  const width = number(boundsSource.width, 'live computer bounds width')
  const height = number(boundsSource.height, 'live computer bounds height')
  if (![x, y, width, height].every((candidate) => Math.abs(candidate) <= 100_000) || width < 1 || height < 1 || width > 32_768 || height > 32_768) {
    throw new Error('live computer bounds are outside the supported range')
  }
  return { windowId, application, bundleIdentifier, title, bounds: { x, y, width, height } }
}

function liveComputerSessionTarget(value: unknown) {
  const source = record(value, 'additional live computer target')
  const role = source.role === undefined
    ? undefined
    : oneOf(source.role, ['workspace', 'research', 'destination', 'reference'] as const, 'window role')
  const purpose = optionalString(source.purpose, 'window purpose')?.trim()
  if (purpose && purpose.length > 120) throw new Error('Window purpose is too long')
  const origin = source.source === undefined || source.source === null
    ? undefined
    : oneOf(source.source, ['existing', 'fresh', 'ask'] as const, 'window source')
  return {
    target: liveComputerTarget(source.target),
    authority: oneOf(source.authority, ['observe', 'input'] as const, 'window authority'),
    ...(role ? { role } : {}),
    ...(purpose ? { purpose } : {}),
    ...(origin ? { source: origin } : {}),
  }
}

function liveComputerRouteAuditEntry(value: unknown) {
  const source = record(value, 'suggested live computer route entry')
  const windowId = number(source.windowId, 'suggested live computer window id')
  if (!Number.isSafeInteger(windowId) || windowId < 1) throw new Error('suggested live computer window id must be a positive integer')
  const application = string(source.application, 'suggested live computer application').trim()
  const bundleIdentifier = string(source.bundleIdentifier, 'suggested live computer bundle identifier').trim()
  if (application.length > 240) throw new Error('suggested live computer application is too long')
  if (!/^[A-Za-z0-9.-]+$/u.test(bundleIdentifier) || bundleIdentifier.length > 255) throw new Error('suggested live computer bundle identifier is invalid')
  const origin = source.source === undefined || source.source === null
    ? undefined
    : oneOf(source.source, ['existing', 'fresh', 'ask'] as const, 'suggested window source')
  return {
    windowId,
    application,
    bundleIdentifier,
    authority: oneOf(source.authority, ['observe', 'input'] as const, 'suggested window authority'),
    role: oneOf(source.role, ['workspace', 'research', 'destination', 'reference'] as const, 'suggested window role'),
    ...(origin ? { source: origin } : {}),
  }
}

function liveComputerRouteStartEntry(value: unknown) {
  const source = record(value, 'work-surface route entry')
  const origin = oneOf(source.source, ['existing', 'fresh'] as const, 'work-surface source')
  const authority = oneOf(source.authority, ['observe', 'input'] as const, 'work-surface authority')
  const role = oneOf(source.role, ['workspace', 'research', 'destination', 'reference'] as const, 'work-surface role')
  const requirementId = optionalString(source.requirementId, 'route requirement identity')?.trim()
  if (requirementId && requirementId.length > 500) throw new Error('Route requirement identity is too long')
  const requirementIds = source.requirementIds === undefined || source.requirementIds === null
    ? []
    : Array.isArray(source.requirementIds)
      ? source.requirementIds.map((value) => string(value, 'route requirement identity').trim())
      : (() => { throw new Error('Route requirement identities must be a list') })()
  if (requirementIds.length > 24 || requirementIds.some((id) => !id || id.length > 500) || new Set(requirementIds).size !== requirementIds.length) {
    throw new Error('Route requirement identities are invalid')
  }
  if (requirementId && requirementIds.length) throw new Error('Use one route requirement identity format')
  const identity = requirementIds.length ? { requirementIds } : requirementId ? { requirementId } : {}
  const purpose = string(source.purpose, 'work-surface purpose').trim()
  if (purpose.length > 120) throw new Error('Work-surface purpose is too long')
  if (origin === 'existing') return { ...identity, source: origin, target: liveComputerTarget(source.target), authority, role, purpose }
  const application = string(source.application, 'fresh application').trim()
  const bundleIdentifier = string(source.bundleIdentifier, 'fresh application identifier').trim()
  if (!application || application.length > 240) throw new Error('Fresh application is invalid')
  if (!/^[A-Za-z0-9.-]+$/u.test(bundleIdentifier) || bundleIdentifier.length > 255) throw new Error('Fresh application identifier is invalid')
  const url = source.url === undefined || source.url === null ? null : string(source.url, 'fresh window address')
  if (url !== null && (url.length > 2_000 || !/^https:\/\/[^\s/?#]+/u.test(url))) throw new Error('A fresh browser window needs one complete https:// address')
  return { ...identity, source: origin, application, bundleIdentifier, url, authority, role, purpose }
}

function correction(value: unknown): ProcedureCorrection {
  const source = record(value, 'procedure correction')
  const operation = string(source.operation, 'correction operation')
  if (operation === 'rename') return { operation, name: string(source.name, 'procedure name') }
  if (operation === 'update_step') {
    const name = optionalString(source.name, 'step name')
    const description = optionalString(source.description, 'step description')
    return {
      operation,
      stepId: string(source.stepId, 'step id'),
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
    }
  }
  if (operation === 'delete_step') return { operation, stepId: string(source.stepId, 'step id') }
  if (operation === 'split_step') {
    return {
      operation,
      stepId: string(source.stepId, 'step id'),
      firstName: string(source.firstName, 'first step name'),
      secondName: string(source.secondName, 'second step name'),
    }
  }
  if (operation === 'merge_steps') {
    return {
      operation,
      firstStepId: string(source.firstStepId, 'first step id'),
      secondStepId: string(source.secondStepId, 'second step id'),
      name: string(source.name, 'merged step name'),
    }
  }
  throw new Error(`Unsupported correction operation: ${operation}`)
}

function observationReview(value: unknown): ObservationReviewInput {
  const source = record(value, 'observation review')
  const cropValue = source.crop
  let crop: ObservationReviewInput['crop']
  if (cropValue === null) crop = null
  else if (cropValue !== undefined) crop = region(cropValue, 'review crop')
  if (source.masks !== undefined && !Array.isArray(source.masks)) throw new Error('Review masks must be an array')
  const masks = source.masks === undefined ? undefined : source.masks.map((item) => region(item, 'review mask'))
  return {
    disposition: oneOf(source.disposition, ['approved', 'excluded'] as const, 'review disposition'),
    annotationKind: oneOf(source.annotationKind, ['state', 'input', 'decision', 'outcome', 'interruption', 'irrelevant'] as const, 'review annotation'),
    taskBoundary: oneOf(source.taskBoundary, ['none', 'start', 'end', 'start_end'] as const, 'task boundary'),
    label: typeof source.label === 'string' ? source.label : '',
    notes: typeof source.notes === 'string' ? source.notes : '',
    visualDescription: typeof source.visualDescription === 'string' ? source.visualDescription : '',
    ...(crop === undefined ? {} : { crop }),
    ...(masks === undefined ? {} : { masks }),
    ...(source.createSanitizedCopy === undefined ? {} : { createSanitizedCopy: boolean(source.createSanitizedCopy, 'create sanitized copy') }),
    ...(source.discardSourceScreenshot === undefined ? {} : { discardSourceScreenshot: boolean(source.discardSourceScreenshot, 'discard source screenshot') }),
  }
}

function aiDraftCorrection(value: unknown): AiDraftCorrection {
  const source = record(value, 'AI draft correction')
  const operation = string(source.operation, 'AI draft correction operation')
  if (operation === 'rename') {
    const goal = optionalString(source.goal, 'AI draft goal')
    const summary = optionalString(source.summary, 'AI draft summary')
    return { operation, ...(goal === undefined ? {} : { goal }), ...(summary === undefined ? {} : { summary }) }
  }
  if (operation === 'update_step') {
    const name = optionalString(source.name, 'AI draft step name')
    const description = optionalString(source.description, 'AI draft step description')
    return { operation, stepId: string(source.stepId, 'AI draft step id'), ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) }
  }
  throw new Error(`Unsupported AI draft correction operation: ${operation}`)
}

function region(value: unknown, label: string) {
  const source = record(value, label)
  return { x: number(source.x, `${label} x`), y: number(source.y, `${label} y`), width: number(source.width, `${label} width`), height: number(source.height, `${label} height`) }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array`)
  return value as string[]
}

function stringMap(value: unknown, label: string): Record<string, string> {
  const source = record(value, label)
  if (Object.values(source).some((item) => typeof item !== 'string')) throw new Error(`${label} must contain only string values`)
  return source as Record<string, string>
}

function oneOf<const T extends readonly string[]>(value: unknown, options: T, label: string): T[number] {
  const candidate = string(value, label)
  if (!options.includes(candidate)) throw new Error(`${label} is unknown`)
  return candidate as T[number]
}

export function parseSupervisionPolicy(value: unknown): SupervisionPolicyV2 {
  const source = record(value, 'supervision policy')
  const countdown = source.eligibleCountdownMs === null
    ? null
    : number(source.eligibleCountdownMs, 'eligible countdown')
  const policy: SupervisionPolicyV2 = {
    version: number(source.version, 'supervision policy version') as 2,
    preset: oneOf(source.preset, ['fast', 'smart_checkpoints', 'step_by_step', 'autopilot', 'custom'] as const, 'supervision preset'),
    planReview: oneOf(source.planReview, ['when_effects_require_it', 'always'] as const, 'plan review boundary'),
    phaseBoundary: oneOf(source.phaseBoundary, ['protected_only', 'consequential_phases', 'none'] as const, 'phase boundary'),
    stateChangeBoundary: oneOf(source.stateChangeBoundary, ['covered_by_plan', 'each_state_change'] as const, 'state-change boundary'),
    physicalInputBoundary: oneOf(source.physicalInputBoundary, ['policy_decides', 'each_input'] as const, 'physical-input boundary'),
    eligibleCountdownMs: countdown,
    deviationBoundary: oneOf(source.deviationBoundary, ['fresh_plan'] as const, 'deviation boundary'),
    unknownEffectBoundary: oneOf(source.unknownEffectBoundary, ['resolve_or_handoff'] as const, 'unknown-effect boundary'),
    protectedEffectBoundary: oneOf(source.protectedEffectBoundary, ['immediate_or_handoff'] as const, 'protected-effect boundary'),
  }
  validateSupervisionPolicy(policy)
  return policy
}

/**
 * A selected scope must arrive with at least one session id: accepting an
 * empty selection would leave the interface believing memory is restricted
 * while the backend has nothing concrete to restrict to. Exported so the web
 * server's `/api/work/prepare` route applies the exact same rule.
 */
export function parseWorkMemoryScope(value: unknown): { mode: 'auto' | 'all' | 'selected' | 'none'; sessionIds: string[] } {
  const source = record(value, 'memory scope')
  const mode = oneOf(source.mode, ['auto', 'all', 'selected', 'none'] as const, 'memory scope mode')
  const sessionIds = source.sessionIds === undefined ? [] : stringArray(source.sessionIds, 'memory scope sessions')
  if (mode === 'selected' && sessionIds.length === 0) throw new Error('A selected memory scope needs at least one session')
  return { mode, sessionIds: mode === 'selected' ? sessionIds : [] }
}

/**
 * Validates a time window arriving from the interface. Bounds must be real
 * instants and must not be inverted: a range that ends before it starts would
 * silently return nothing, which reads as "you did nothing that day".
 */
function recallScope(value: unknown): { fromIso: string | null; toIso: string | null; label: string | null; sessionIds: string[] } {
  const source = record(value, 'scope')
  const instant = (raw: unknown, label: string): string | null => {
    if (raw === null || raw === undefined) return null
    const parsed = Date.parse(string(raw, label))
    if (Number.isNaN(parsed)) throw new Error(`${label} must be an ISO timestamp`)
    return new Date(parsed).toISOString()
  }
  const fromIso = instant(source.fromIso, 'scope start')
  const toIso = instant(source.toIso, 'scope end')
  if (fromIso && toIso && Date.parse(fromIso) >= Date.parse(toIso)) throw new Error('The scope must start before it ends')
  const sessionIds = source.sessionIds === undefined
    ? []
    : [...new Set(stringArray(source.sessionIds, 'session ids').map((id) => string(id, 'session id')))]
  if (sessionIds.length > 50) throw new Error('Recall can search at most 50 sessions at once')
  return { fromIso, toIso, label: source.label === null || source.label === undefined ? null : string(source.label, 'scope label'), sessionIds }
}
