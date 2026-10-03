import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The packaged app's Carve Cloud origin, written into Resources at packaging time (STEWARD_RELEASE_CLOUD_URL).
 * A fresh install has no .env, so without this the app has no managed service and no update feed. An explicit
 * CARVE_CLOUD_URL (a developer .env) still wins. */
export const RELEASE_CONFIG_FILE = 'carve-release.json'

export function applyReleaseCloudUrl(resourcesPath: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const path = join(resourcesPath, RELEASE_CONFIG_FILE)
  if (!existsSync(path)) return null
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as { cloudUrl?: unknown; managedCloud?: boolean }
    const cloudUrl = config.cloudUrl
    const managed = config.managedCloud === true && env.CARVE_LOCAL_BUILD !== '1'
    if (env.CARVE_CLOUD_URL?.trim() && !managed) return null
    if (typeof cloudUrl !== 'string' || !cloudUrl.startsWith('https://')) return null
    env.CARVE_CLOUD_URL = cloudUrl
    if (managed) env.CARVE_MANAGED_CLOUD = 'true'
    return cloudUrl
  } catch {
    return null
  }
}
