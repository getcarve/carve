import { liveComputerPlanningTimeouts } from './policy.js'
import type { ModelProvider, ModelRequest } from './providers/types.js'
import type { LiveComputerModelProfile } from './types.js'
import { overheadPolicyFor, overheadPolicyMode } from './computer-use/verification-policy.js'

export type LiveComputerModelJob =
  | 'conversation.interpret'
  | 'computer.route_intent'
  | 'computer.target_recommendation'
  | 'computer.live.strategy'
  | 'computer.live.strategy_arbiter'
  | 'computer.live.objective_replan'
  | 'computer.live.decision_critic'
  | 'computer.live.action_scope'
  | 'computer.live.executive'
  | 'computer.live.goal_plan'
  | 'computer.live.plan_revision'
  | 'computer.live.plan'
  | 'computer.live.input_acceptance'
  | 'computer.live.verify'
  | 'computer.live.requirements'
  | 'computer.live.completion_review'

export type LiveComputerModelRoute = Pick<ModelRequest, 'model' | 'reasoningEffort' | 'promptCache' | 'serviceTier'>

export interface LiveComputerActionRouteContext {
  recoveryActive: boolean
  repairingRejectedProposal: boolean
  semanticGroundingExpected: boolean
  semanticCandidateCount: number
  /** Writes and consequential outcomes stay on the deliberate model. */
  writeRisk?: boolean
  /** The experimental executor needs deliberate image-level localization even
   * when AX claims that another editable control exists. */
  visualGroundingRequired?: boolean
}

const strategicJobs = new Set<LiveComputerModelJob>([
  'computer.route_intent',
  'computer.target_recommendation',
  'computer.live.strategy',
  'computer.live.strategy_arbiter',
  'computer.live.objective_replan',
  'computer.live.decision_critic',
  'computer.live.executive',
  'computer.live.goal_plan',
  'computer.live.plan_revision',
])

// Keep routine planning cheap, but spend more reasoning only when new
// evidence says the ordinary route is no longer trustworthy.
const recoveryJobs = new Set<LiveComputerModelJob>([
  'computer.live.strategy_arbiter',
  'computer.live.objective_replan',
  'computer.live.decision_critic',
  'computer.live.executive',
  'computer.live.plan_revision',
])

const openAIComputerProviderIds = new Set(['openai-hosted', 'carve-cloud', 'azure-openai'])
export const defaultLiveComputerModelProfile: LiveComputerModelProfile = 'adaptive_5_6'
export const astraComputerModel = 'gpt-6-astra'
/** Built-in models and effort policy for the adaptive profile. Routine work is
 * deliberately cheap and fast; recovery, writes, and completion judgments
 * retain a medium deliberation budget. */
export const defaultStrategyModel = 'gpt-6-sol'
export const defaultExecutionModel = 'gpt-6-luna'
export const defaultCompletionModel = 'gpt-6-sol'
export const defaultStrategyEffort = 'low'
export const defaultExecutionEffort = 'low'
export const defaultRecoveryEffort = 'medium'
/** Low since 29 September: on 53 recorded final checks (7 correct drafts, 20 real catches, 6 honest partials, 20 accepts) low
 * effort matched or beat medium on every class (catches kept 14/20 vs 12/20, wrong rejections 0/7 both, accepts flipped 1/20 both)
 * while the check took 4.2 s instead of 6.9 s (p90 5.7 vs 11.2 s) and 202 instead of 345 output tokens. `STEWARD_OPENAI_COMPLETION_EFFORT=medium` restores it. */
export const defaultCompletionEffort = 'low'
/** The requirements job was not measured; it keeps medium. */
const requirementsEffort = 'medium'

export function parseLiveComputerModelProfile(value: unknown): LiveComputerModelProfile {
  return value === 'astra' ? 'astra' : defaultLiveComputerModelProfile
}

/** What Carve Cloud may publish in the entitlement so the model can change after launch without an app update. */
export interface CloudModelPolicy {
  profile?: unknown
  strategyModel?: unknown
  executionModel?: unknown
}

export interface LiveComputerModelPolicy {
  profile: LiveComputerModelProfile
  strategyModel: string
  executionModel: string
  /** Where the profile came from, for audit and Settings. */
  source: 'environment' | 'cloud' | 'setting' | 'default'
}

const modelIdPattern = /^[a-z0-9][a-z0-9._:/-]{1,80}$/iu

function cloudModel(value: unknown): string | null {
  return typeof value === 'string' && modelIdPattern.test(value.trim()) ? value.trim() : null
}

/**
 * One precedence order for the whole app. A local .env override is a developer
 * escape hatch; Carve Cloud's policy is the post-launch control; the local
 * Settings choice only applies in the workbench, where the person can see it;
 * otherwise the built-in default.
 */
export function resolveLiveComputerModelPolicy(input: {
  environment: NodeJS.ProcessEnv
  cloudPolicy?: CloudModelPolicy | null
  localSetting?: string | null
  localSettingApplies: boolean
}): LiveComputerModelPolicy {
  const env = input.environment
  const envProfile = env.STEWARD_LIVE_COMPUTER_MODEL_PROFILE?.trim()
  const cloudProfile = input.cloudPolicy?.profile
  let profile: LiveComputerModelProfile
  let source: LiveComputerModelPolicy['source']
  if (envProfile === 'astra' || envProfile === 'adaptive_5_6') { profile = envProfile; source = 'environment' }
  else if (cloudProfile === 'astra' || cloudProfile === 'adaptive_5_6') { profile = cloudProfile; source = 'cloud' }
  else if (input.localSettingApplies && input.localSetting === 'astra') { profile = 'astra'; source = 'setting' }
  else { profile = defaultLiveComputerModelProfile; source = 'default' }
  const strategyModel = env.STEWARD_OPENAI_STRATEGY_MODEL?.trim() || cloudModel(input.cloudPolicy?.strategyModel) || defaultStrategyModel
  const executionModel = env.STEWARD_OPENAI_EXECUTION_MODEL?.trim() || cloudModel(input.cloudPolicy?.executionModel) || defaultExecutionModel
  return { profile, strategyModel, executionModel, source }
}

export type LiveComputerServiceTier = 'default' | 'fast'
export interface LiveComputerServiceTierPolicy { tier: LiveComputerServiceTier; source: 'environment' | 'setting' | 'default' }

/** The processing tier for direct OpenAI requests: the environment wins, then the local setting, else the provider default. */
export function resolveLiveComputerServiceTier(input: { environment: NodeJS.ProcessEnv; localSetting: string | null; localSettingApplies: boolean }): LiveComputerServiceTierPolicy {
  const configured = input.environment.STEWARD_OPENAI_SERVICE_TIER?.trim()
  if (configured === 'fast' || configured === 'default') return { tier: configured, source: 'environment' }
  if (input.localSettingApplies && input.localSetting === 'fast') return { tier: 'fast', source: 'setting' }
  return { tier: 'default', source: 'default' }
}

/** The routing functions read models from the environment; this applies a resolved policy to it. */
export function policyEnvironment(policy: LiveComputerModelPolicy, environment: NodeJS.ProcessEnv = process.env, serviceTier?: LiveComputerServiceTierPolicy): NodeJS.ProcessEnv {
  return { ...environment, STEWARD_OPENAI_STRATEGY_MODEL: policy.strategyModel, STEWARD_OPENAI_EXECUTION_MODEL: policy.executionModel,
    ...(serviceTier?.source === 'setting' ? { STEWARD_OPENAI_SERVICE_TIER: serviceTier.tier } : {}) }
}

/**
 * Routes only the OpenAI hosted adapter. Other providers retain their selected
 * model and native behavior. Sol handles decisions whose mistakes propagate
 * across later steps; Luna handles the frequent grounded action/verification
 * loop. Both remain configurable without changing code.
 */
export function liveComputerModelRoute(
  provider: ModelProvider,
  job: LiveComputerModelJob,
  environment: NodeJS.ProcessEnv = process.env,
  profile: LiveComputerModelProfile = defaultLiveComputerModelProfile,
): LiveComputerModelRoute {
  if (provider.summary.id === openRouterProviderId) return openRouterRoute(provider, deliberateOpenRouterJob(job), environment)
  if (!openAIComputerProviderIds.has(provider.summary.id)) return {}
  if (profile === 'astra') {
    return { model: astraComputerModel, reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_ASTRA_EFFORT, astraComputerModel), ...requestOptions(environment, provider.summary.id) }
  }
  // Final judgments are sparse but determine whether incorrect work is
  // reported as complete. Keep their route independent of frequent actions.
  if (job === 'computer.live.requirements' || job === 'computer.live.completion_review') {
    const model = configuredModel(environment.STEWARD_OPENAI_COMPLETION_MODEL, defaultCompletionModel)
    return { model, reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_COMPLETION_EFFORT ?? (job === 'computer.live.requirements' ? requirementsEffort : defaultCompletionEffort), model), ...requestOptions(environment, provider.summary.id) }
  }
  if (job === 'conversation.interpret') {
    const model = configuredModel(environment.STEWARD_OPENAI_INTERPRET_MODEL, configuredModel(environment.STEWARD_OPENAI_EXECUTION_MODEL, defaultExecutionModel))
    return { model, reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_INTERPRET_EFFORT ?? defaultExecutionEffort, model), ...requestOptions(environment, provider.summary.id) }
  }
  // Surface routing decides an app the person has usually already chosen by
  // selecting a window; its reasoning budget is a fixed per-task overhead.
  if (job === 'computer.route_intent') {
    const model = configuredModel(environment.STEWARD_OPENAI_EXECUTION_MODEL, defaultExecutionModel)
    const effort = environment.STEWARD_OPENAI_ROUTE_INTENT_EFFORT ?? overheadPolicyFor(overheadPolicyMode(environment)).routeIntentEffort
    return { model, reasoningEffort: configuredEffort(effort, model), ...requestOptions(environment, provider.summary.id) }
  }
  // Scope review is a bounded classification over an exact action payload,
  // not strategy generation. Keep it on the fast execution route; protected
  // effects still fail closed in the controller and final verification stays
  // on the deliberate model.
  if (job === 'computer.live.action_scope') {
    const model = configuredModel(environment.STEWARD_OPENAI_ACTION_SCOPE_MODEL, configuredModel(environment.STEWARD_OPENAI_EXECUTION_MODEL, defaultExecutionModel))
    return { model, reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_ACTION_SCOPE_EFFORT ?? environment.STEWARD_OPENAI_EXECUTION_EFFORT ?? defaultExecutionEffort, model), ...requestOptions(environment, provider.summary.id) }
  }
  if (strategicJobs.has(job)) {
    const model = configuredModel(environment.STEWARD_OPENAI_STRATEGY_MODEL, defaultStrategyModel)
    return {
      model,
      reasoningEffort: configuredEffort(recoveryJobs.has(job)
        ? (environment.STEWARD_OPENAI_RECOVERY_EFFORT ?? defaultRecoveryEffort)
        : (environment.STEWARD_OPENAI_STRATEGY_EFFORT ?? defaultStrategyEffort), model),
      ...requestOptions(environment, provider.summary.id),
    }
  }
  return {
    model: configuredModel(environment.STEWARD_OPENAI_EXECUTION_MODEL, defaultExecutionModel),
    reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_EXECUTION_EFFORT ?? defaultExecutionEffort, configuredModel(environment.STEWARD_OPENAI_EXECUTION_MODEL, defaultExecutionModel)),
    ...requestOptions(environment, provider.summary.id),
  }
}

export function liveComputerRequestedModel(
  provider: ModelProvider,
  job: LiveComputerModelJob,
  environment: NodeJS.ProcessEnv = process.env,
  profile: LiveComputerModelProfile = defaultLiveComputerModelProfile,
): string {
  return liveComputerModelRoute(provider, job, environment, profile).model ?? provider.summary.model
}

/**
 * Bounded inference cascade for the goal-plan stage. A transport failure or
 * deadline on one model is evidence about that route, not evidence that
 * inference as a whole is unavailable. Keep the provider fixed so privacy,
 * credentials, and billing authority do not change; change only to one known
 * structured-output sibling model. The controller validates either model's
 * graph identically, and the mechanical compiler remains the final fallback.
 *
 * The list is de-duplicated because deployments may configure the strategic
 * and execution aliases to the same model. It is deliberately capped at two
 * routes, matching the previous two-call ceiling rather than silently adding
 * spend.
 */
export function liveComputerGoalPlanModelRoutes(
  provider: ModelProvider,
  environment: NodeJS.ProcessEnv = process.env,
  profile: LiveComputerModelProfile = defaultLiveComputerModelProfile,
): LiveComputerModelRoute[] {
  const primary = liveComputerModelRoute(provider, 'computer.live.goal_plan', environment, profile)
  if (!openAIComputerProviderIds.has(provider.summary.id)) return [primary]
  const strategic = configuredModel(environment.STEWARD_OPENAI_STRATEGY_MODEL, defaultStrategyModel)
  const execution = configuredModel(environment.STEWARD_OPENAI_EXECUTION_MODEL, defaultExecutionModel)
  const candidates = profile === 'astra'
    ? [astraComputerModel, strategic, execution]
    : [strategic, execution]
  const models = [...new Set(candidates)].slice(0, 2)
  return models.map((model) => ({ model, reasoningEffort: configuredEffort(model === astraComputerModel ? environment.STEWARD_OPENAI_ASTRA_EFFORT : (environment.STEWARD_OPENAI_STRATEGY_EFFORT ?? defaultStrategyEffort), model), ...requestOptions(environment, provider.summary.id) }))
}

/** The longest Carve waits for one call of this job before abandoning it. */
export function liveComputerPlanningTimeoutMs(job: LiveComputerModelJob): number {
  if (job === 'conversation.interpret') return 30_000
  return liveComputerPlanningTimeouts[job]
}

/**
 * Goal-plan inference gets more of the budget for a request with more
 * coordinated parts, because those are exactly the requests the mechanical
 * compiler refuses to plan on its own: a flat 12 s deadline on a four-part
 * request timed out and could not start at all (2026-09-03). Two parts keep
 * the base deadline; every further part adds half of it, capped at double.
 */
export function liveComputerGoalPlanTimeoutMs(clauseCount: number): number {
  const base = liveComputerPlanningTimeouts['computer.live.goal_plan']
  const extra = Math.max(0, Math.floor(clauseCount) - 2) * Math.round(base / 2)
  return Math.min(base * 2, base + extra)
}

/** Clear, grounded actions stay on the fast execution model. Ambiguous UI, a
 * query with no captured input affordance, or an already-rejected proposal is
 * an executive decision, so it receives the strategic model and higher
 * reasoning effort. This is evidence-triggered; ordinary clicks do not pay
 * the latency/cost on every frame. */
export function liveComputerActionModelRoute(
  provider: ModelProvider,
  context: LiveComputerActionRouteContext,
  environment: NodeJS.ProcessEnv = process.env,
  profile: LiveComputerModelProfile = defaultLiveComputerModelProfile,
): LiveComputerModelRoute {
  if (provider.summary.id === openRouterProviderId) {
    return openRouterRoute(provider, Boolean(context.writeRisk || context.recoveryActive || context.repairingRejectedProposal || context.visualGroundingRequired
      || context.semanticCandidateCount > 1 || (context.semanticGroundingExpected && context.semanticCandidateCount === 0)), environment)
  }
  if (!openAIComputerProviderIds.has(provider.summary.id)) return {}
  if (profile === 'astra') {
    return { model: astraComputerModel, reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_ASTRA_EFFORT, astraComputerModel), ...requestOptions(environment, provider.summary.id) }
  }
  if (context.writeRisk) {
    const model = configuredModel(environment.STEWARD_OPENAI_STRATEGY_MODEL, defaultStrategyModel)
    return {
      model,
      reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_WRITE_EFFORT ?? environment.STEWARD_OPENAI_RECOVERY_EFFORT ?? defaultRecoveryEffort, model),
      ...requestOptions(environment, provider.summary.id),
    }
  }
  if (context.recoveryActive
    || context.repairingRejectedProposal
    || context.visualGroundingRequired
    || context.semanticCandidateCount > 1
    || context.semanticGroundingExpected && context.semanticCandidateCount === 0) {
    // Medium, not high: a recovery proposal at high effort took 48 s live on
    // 2026-09-03 while the same model at medium answered the same shape of
    // question in 5–6 s, and the A/B campaigns showed no correctness gain.
    return {
      model: configuredModel(environment.STEWARD_OPENAI_STRATEGY_MODEL, defaultStrategyModel),
      reasoningEffort: configuredEffort(environment.STEWARD_OPENAI_RECOVERY_EFFORT ?? defaultRecoveryEffort, configuredModel(environment.STEWARD_OPENAI_STRATEGY_MODEL, defaultStrategyModel)),
      ...requestOptions(environment, provider.summary.id),
    }
  }
  return liveComputerModelRoute(provider, 'computer.live.plan', environment, profile)
}

const openRouterProviderId = 'openrouter'

/** Judgments that decide what a task does and whether it is finished. */
function deliberateOpenRouterJob(job: LiveComputerModelJob): boolean {
  return job === 'computer.live.requirements' || job === 'computer.live.completion_review'
    || (strategicJobs.has(job) && job !== 'computer.route_intent')
}

/** OpenRouter names its own models, so the OpenAI role settings do not apply: deliberate calls run on the model
 * the person chose and frequent execution calls on its fast model. A wrapper that hides `fastModel` degrades to
 * one model for everything. */
function openRouterRoute(provider: ModelProvider, deliberate: boolean, environment: NodeJS.ProcessEnv): LiveComputerModelRoute {
  const fast = (provider as { fastModel?: unknown }).fastModel
  const effort = environment.STEWARD_OPENROUTER_REASONING_EFFORT?.trim().toLowerCase()
  return {
    model: deliberate || typeof fast !== 'string' || !fast ? provider.summary.model : fast,
    // Sent by default because the tuned behaviour assumes low effort; `off` omits it for models without reasoning.
    ...(effort === 'off' ? {} : { reasoningEffort: effort === 'none' || effort === 'medium' || effort === 'high' ? effort : 'low' as const }),
  }
}

function configuredModel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function configuredEffort(value: string | undefined, model: string): NonNullable<ModelRequest['reasoningEffort']> {
  if (value === 'none' && model === astraComputerModel) return 'low'
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
}

function requestOptions(environment: NodeJS.ProcessEnv, providerId: string): Pick<ModelRequest, 'promptCache' | 'serviceTier'> {
  // Cloud metering has its own supported pricing policy; experiments are direct-only.
  if (providerId !== 'openai-hosted') return {}
  return {
    ...(environment.STEWARD_OPENAI_EXPLICIT_CACHE === '1' ? { promptCache: 'explicit' as const } : {}),
    ...(environment.STEWARD_OPENAI_SERVICE_TIER === 'fast' || environment.STEWARD_OPENAI_SERVICE_TIER === 'default' ? { serviceTier: environment.STEWARD_OPENAI_SERVICE_TIER } : {}),
  }
}
