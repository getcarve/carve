/** How much of the work between a submitted request and its first model
 * decision may overlap (24 September). Before this, method selection,
 * interpretation, three application-catalog reads and route inference ran
 * strictly one after another: 11 s median from submit to session start on
 * the installed app, of which about 9.6 s were three model calls.
 *
 * `fast` is the product default: each overlap below keeps its inputs exact,
 * decides nothing on its own, and degrades to the serial path when its
 * precondition fails. `baseline` restores the serial path for comparison.
 * Individual switches override the mode.
 */
export interface StartLatencyPolicy {
  mode: 'fast' | 'baseline'
  /** Interpret a fresh request while its method (web vs window) is chosen. Follow-ups stay serial. */
  parallelInterpretation: boolean
  /** Route inference started at submit: `off`; `exact` reuses it only for a byte-identical request;
   * `fresh` also reuses it for a fresh request whose goal is the submitted text, ignoring the
   * interpreter's paraphrase (a hint for resolving references to earlier turns, which a fresh
   * request does not have). */
  routeSpeculation: 'off' | 'exact' | 'fresh'
  /** How long one installed-application catalog read serves later reads (0 = every read goes to the helper). */
  catalogCacheMs: number
  /** Capture the selected window locally at submit so the compact engine's first stable-layout wait can
   * compare against it instead of waiting and capturing again. The capture is never sent to a provider. */
  stabilityBaseline: boolean
  /** Reasoning effort for route inference. Once the three pre-session calls overlap, the slowest
   * sets the pace, and route inference (after its catalog read) was the slowest. On 24 September
   * `none` agreed with `low` on the route's authority shape as often as `low` agreed with itself
   * (16/19 vs 17/19) and was about 0.6 s faster. Null keeps the overhead policy's effort. */
  routeEffort: 'none' | 'low' | null
  /** Method selection and interpretation keep their own effort unless set: neither is the slowest call
   * once they overlap, so `none` would buy no latency, and in the replay it leaned toward sending
   * requests that name this site to the web (66/70 vs 68/70 correct) and flipped one observe to clarify. */
  methodEffort: 'none' | 'low' | null
  interpretationEffort: 'none' | 'low' | null
}

const flag = (value: string | undefined): boolean | null => {
  const v = value?.trim().toLowerCase()
  return v === 'on' || v === '1' || v === 'true' ? true : v === 'off' || v === '0' || v === 'false' ? false : null
}

const effort = (value: string | undefined): 'none' | 'low' | null => {
  const v = value?.trim().toLowerCase()
  return v === 'none' || v === 'low' ? v : null
}

export function startLatencyPolicy(env: NodeJS.ProcessEnv = process.env): StartLatencyPolicy {
  const mode = env.STEWARD_START_LATENCY?.trim() === 'baseline' ? 'baseline' : 'fast'
  const fast = mode === 'fast'
  const speculation = env.STEWARD_ROUTE_SPECULATION?.trim().toLowerCase()
  const cache = Number.parseInt(env.STEWARD_APPLICATION_CATALOG_CACHE_MS ?? '', 10)
  return {
    mode,
    parallelInterpretation: flag(env.STEWARD_PARALLEL_INTERPRETATION) ?? fast,
    routeSpeculation: speculation === 'off' || speculation === 'exact' || speculation === 'fresh' ? speculation
      : speculation === 'on' ? 'exact' : fast ? 'fresh' : 'off',
    catalogCacheMs: Number.isFinite(cache) && cache >= 0 ? Math.min(cache, 300_000) : fast ? 30_000 : 0,
    stabilityBaseline: flag(env.STEWARD_STABILITY_BASELINE) ?? fast,
    routeEffort: effort(env.STEWARD_PRESESSION_EFFORT) ?? effort(env.STEWARD_ROUTE_EFFORT) ?? (fast ? 'none' : null),
    methodEffort: effort(env.STEWARD_PRESESSION_EFFORT) ?? null,
    interpretationEffort: effort(env.STEWARD_PRESESSION_EFFORT) ?? null,
  }
}
