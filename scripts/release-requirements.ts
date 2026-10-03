/** Development and rehearsal builds remain explicit. Publishing requires all
 * distribution credentials and public artifact URLs before packaging begins. */
export function validateReleaseRequirements(input: {
  release: boolean
  rehearsal: boolean
  /** Notarized installation candidate, without published URLs or an update feed. */
  qualification?: boolean
  identity: string | null
  notaryProfile: string | null
  baseUrl: string
  /** Carve Cloud origin built into the app (STEWARD_RELEASE_CLOUD_URL). Required for a release. */
  cloudUrl?: string
}): void {
  if (input.qualification && (input.release || input.rehearsal)) throw new Error('Qualification, release and rehearsal modes cannot be combined')
  if (input.qualification && !input.identity) throw new Error('Qualification requires STEWARD_SIGNING_IDENTITY')
  if (input.release && input.rehearsal) throw new Error('Release and rehearsal modes cannot be combined')
  if (input.release && !input.identity) throw new Error('A release requires STEWARD_SIGNING_IDENTITY')
  if (input.identity && !input.rehearsal) {
    if (!input.notaryProfile) throw new Error('Distribution packaging requires STEWARD_NOTARY_PROFILE; use --rehearsal for a local signing test')
    if (!input.qualification) {
      let url: URL
      try {
        url = new URL(input.baseUrl)
      } catch {
        throw new Error('Distribution packaging requires STEWARD_RELEASES_BASE_URL')
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        throw new Error('Release artifacts require a public HTTPS base URL')
    }
  }
  if (input.release) {
    let cloud: URL
    try { cloud = new URL(input.cloudUrl ?? '') } catch { throw new Error('A release requires STEWARD_RELEASE_CLOUD_URL (the Carve Cloud origin a fresh install uses)') }
    if (cloud.protocol !== 'https:' || cloud.username || cloud.password || cloud.pathname !== '/' || cloud.search || cloud.hash || ['localhost', '127.0.0.1', '[::1]'].includes(cloud.hostname))
      throw new Error('STEWARD_RELEASE_CLOUD_URL must be a public HTTPS origin')
  }
}
