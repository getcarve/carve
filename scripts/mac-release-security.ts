import { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options, FuseState } from '@electron/fuses'

/** Apply before code signing. The Keychain helper trusts the signed Carve main
 * process; that process must not expose a general-purpose Node execution path. */
export async function hardenMacRelease(appPath: string): Promise<void> {
  const required = {
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  }
  await flipFuses(appPath, { version: FuseVersion.V1, ...required })
  const wire = await getCurrentFuseWire(appPath)
  for (const [key, enabled] of Object.entries(required)) {
    if (wire[Number(key) as FuseV1Options] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE)) {
      throw new Error('Release packaging failed to enforce the Electron credential boundary')
    }
  }
}
