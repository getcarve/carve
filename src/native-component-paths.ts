/** Development overrides for the native components the desktop shell loads or
 * spawns. The live input bridge is `require`d into the main process; the
 * helpers run as Carve's children and so act under its Screen Recording,
 * Accessibility and Touch ID identity. A packaged app therefore never honours
 * them: whoever controls its launch environment would otherwise run their own
 * code with Carve's credentials and macOS permissions. */
export const NATIVE_COMPONENT_OVERRIDES = {
  captureHelper: 'STEWARD_CAPTURE_HELPER',
  authenticationHelper: 'STEWARD_AUTHENTICATION_HELPER',
  computerHelper: 'STEWARD_COMPUTER_HELPER',
  liveInputBridge: 'STEWARD_LIVE_INPUT_BRIDGE',
} as const

export type NativeComponent = keyof typeof NATIVE_COMPONENT_OVERRIDES

export interface NativeComponentPath {
  path: string
  /** Set when an override was present and refused because the app is packaged. */
  ignoredOverride?: string
}

export function nativeComponentPath(component: NativeComponent, options: {
  packaged: boolean
  packagedPath: string
  developmentPath: string
  env?: NodeJS.ProcessEnv
}): NativeComponentPath {
  const variable = NATIVE_COMPONENT_OVERRIDES[component]
  const override = (options.env ?? process.env)[variable]?.trim()
  if (options.packaged) return override ? { path: options.packagedPath, ignoredOverride: variable } : { path: options.packagedPath }
  return { path: override || options.developmentPath }
}
