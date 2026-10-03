import { validateReleaseRequirements } from './release-requirements.js'
import { assertRequirementStoreCompatible } from './check-requirement-compatibility.js'
import { hardenMacRelease } from './mac-release-security.js'
import { macPackageIgnore } from './mac-package-contents.js'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { statFile } from '@electron/asar'
import { packager } from '@electron/packager'

if (process.platform !== 'darwin') throw new Error('Carve.app can be packaged only on macOS')

const projectRoot = process.cwd()
// Rehearsals never overwrite the regular package, launch it, contact Apple's
// timestamp/notary services, or produce artifacts that look ready to publish.
const rehearsal = process.argv.includes('--rehearsal')
const qualification = process.argv.includes('--qualification')
const prepareOnly = process.argv.includes('--prepare-only')
const signPrepared = process.argv.includes('--sign-prepared')
if (qualification && process.argv.includes('--launch')) throw new Error('Qualification must be launched separately with an isolated user profile')
if (rehearsal && process.argv.includes('--launch')) throw new Error('A release rehearsal must not launch against the current user profile')
const packageVersion = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')).version as string
const releaseRoot = rehearsal ? mkdtempSync(join(tmpdir(), 'carve-package-rehearsal-')) : resolve(projectRoot, qualification ? `release/qualification-${packageVersion}` : 'release')
const bundleIdentifier = 'app.carve.desktop'
const liveComputerBundleIdentifier = `${bundleIdentifier}.live-computer`
const buildNumber = process.env.STEWARD_BUILD_NUMBER ?? '1'
const targetArch = process.arch === 'arm64' ? 'arm64' : 'x64'
// Distribution signing is opt-in through the environment so a development
// machine without a Developer ID keeps producing ad-hoc builds.
//   STEWARD_SIGNING_IDENTITY   "Developer ID Application: <Team Name> (<TEAMID>)"
//   STEWARD_NOTARY_PROFILE     keychain profile from `xcrun notarytool store-credentials`
//   STEWARD_RELEASES_BASE_URL  where the zip/dmg will be hosted (for the update feed)
const signingIdentity = process.env.STEWARD_SIGNING_IDENTITY?.trim() || null
const notaryProfile = rehearsal ? null : process.env.STEWARD_NOTARY_PROFILE?.trim() || null
const releasesBaseUrl = (process.env.STEWARD_RELEASES_BASE_URL?.trim() || '').replace(/\/+$/u, '')
//   STEWARD_RELEASE_CLOUD_URL  Carve Cloud origin built into the app (required for --release)
const releaseCloudUrl = (process.env.STEWARD_RELEASE_CLOUD_URL?.trim() || '').replace(/\/+$/u, '')
validateReleaseRequirements({ release: process.argv.includes('--release'), rehearsal, qualification, identity: signingIdentity, notaryProfile, baseUrl: releasesBaseUrl, cloudUrl: releaseCloudUrl })
const distribution = signingIdentity !== null
if (rehearsal && !distribution) throw new Error('A release rehearsal requires STEWARD_SIGNING_IDENTITY')
const entitlementsRoot = resolve(projectRoot, 'desktop/entitlements')
const appEntitlements = join(entitlementsRoot, 'steward.plist')
const electronHelperEntitlements = join(entitlementsRoot, 'electron-helper.plist')
const nativeHelperEntitlements = join(entitlementsRoot, 'native-helper.plist')
// Local ad-hoc signatures normally use a build-specific cdhash as their
// designated requirement. TCC then treats every rebuild as a different app,
// even though System Settings keeps displaying the same name. Give each
// user-facing app a stable local requirement during development. Production
// packaging must replace these with Developer ID requirements that include
// Carve's team anchor.
const localRequirement = (identifier: string) => `=designated => identifier "${identifier}"`
const helperResource = resolve(projectRoot, 'dist/native')
if (!existsSync(join(helperResource, 'carve-keychain-helper'))) throw new Error('Keychain helper missing; run the native helper build before packaging')
const liveComputerInfoPlist = resolve(projectRoot, 'native/macos/CarveLiveComputer-Info.plist')
const electronVersion = JSON.parse(readFileSync(resolve(projectRoot, 'node_modules/electron/package.json'), 'utf8')).version as string
const electronArchive = `electron-v${electronVersion}-darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}.zip`
const cachedElectronArchive = findFile(join(homedir(), 'Library', 'Caches', 'electron'), electronArchive)

// Finish extraction and fuse writes in a separate process before codesign.
// On this macOS build, signing Electron Framework in the packaging process
// repeatedly fails internally, while signing the same bytes after exit succeeds.
if (distribution && !rehearsal && !prepareOnly && !signPrepared) {
  run(process.execPath, ['--import', 'tsx', process.argv[1]!, ...process.argv.slice(2).filter(arg => arg !== '--launch'), '--prepare-only'])
  for (let attempt = 0; attempt < 3; attempt++) {
    const signed = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1]!, ...process.argv.slice(2), '--sign-prepared'], { stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    if (signed.stderr) process.stderr.write(signed.stderr)
    if (signed.status === 0) process.exit(0)
    if (signed.error) throw signed.error
    if (!signed.stderr?.includes('internal error in Code Signing subsystem') || attempt === 2) throw new Error('Distribution signing/notarization failed')
    console.warn('Resuming verified signatures after the macOS Code Signing process exited.')
  }
  process.exit(1)
}
if (signPrepared && (rehearsal || !distribution)) throw new Error('Prepared signing requires a distribution build')
const [applicationPath] = signPrepared ? [join(releaseRoot, `Carve-darwin-${targetArch}`)] : await packager({
  dir: projectRoot,
  name: 'Carve',
  icon: resolve(projectRoot, 'brand/carve/Carve.icns'),
  executableName: 'Carve',
  out: releaseRoot,
  overwrite: true,
  platform: 'darwin',
  arch: process.arch === 'arm64' ? 'arm64' : 'x64',
  electronVersion,
  ...(cachedElectronArchive ? { electronZipDir: dirname(cachedElectronArchive) } : {}),
  appBundleId: bundleIdentifier,
  helperBundleId: `${bundleIdentifier}.electron-helper`,
  appCategoryType: 'public.app-category.productivity',
  appVersion: packageVersion,
  buildVersion: buildNumber,
  asar: true,
  asarIntegrityDigest: true,
  prune: true,
  extraResource: [helperResource],
  protocols: [{ name: 'Carve', schemes: ['carve'] }],
  extendInfo: {
    CFBundleDisplayName: 'Carve',
    CFBundleName: 'Carve',
    LSMinimumSystemVersion: '14.0',
    NSHumanReadableCopyright: distribution ? `© ${new Date().getUTCFullYear()} ${process.env.STEWARD_COPYRIGHT_HOLDER ?? 'Carvify, Inc.'}` : 'Carve local development build',
    NSScreenCaptureUsageDescription: 'Carve captures user-approved screen images to learn bounded workflows.',
    NSAccessibilityUsageDescription: 'Carve sends only your separately approved live actions to the one selected window.',
    NSMicrophoneUsageDescription: 'Carve records dictation only while the mic control is active, to transcribe your request.',
  },
  // Anchored at the project root. Unanchored patterns also match the compiled
  // output — `/src` would strip `dist/src`, `/ui` would strip `dist/ui` — and
  // the packaged app would start without its control plane or renderer.
  ignore: macPackageIgnore,
  sanitizePackageJson: [(manifest) => ({
    name: manifest.name,
    productName: 'Carve',
    version: manifest.version,
    main: manifest.main,
    type: manifest.type,
    dependencies: manifest.dependencies,
  })],
})

if (!applicationPath) throw new Error('Electron Packager did not return a Carve.app path')

const appPath = join(applicationPath, 'Carve.app')
const helperPath = join(appPath, 'Contents', 'Resources', 'native', 'steward-capture-helper')
const authenticationHelperPath = join(appPath, 'Contents', 'Resources', 'native', 'steward-authentication-helper')
const packagedComputerHelperPath = join(appPath, 'Contents', 'Resources', 'native', 'steward-computer-helper')
// macOS grants Accessibility and Screen Recording to the process that uses
// them. Put the live controller in a nested app, with a clear display name,
// so the user can approve *Carve Live Computer* explicitly in System
// Settings. A raw executable in Resources cannot reliably receive that grant.
const computerHelperAppPath = join(appPath, 'Contents', 'Helpers', 'Carve Live Computer.app')
const computerHelperContentsPath = join(computerHelperAppPath, 'Contents')
const computerHelperPath = join(computerHelperContentsPath, 'MacOS', 'Carve Live Computer')
accessSync(helperPath, constants.X_OK)
accessSync(authenticationHelperPath, constants.X_OK)
accessSync(join(appPath, 'Contents', 'Resources', 'native', 'carve-keychain-helper'), constants.X_OK)
if (!signPrepared) accessSync(packagedComputerHelperPath, constants.X_OK)
accessSync(liveComputerInfoPlist, constants.R_OK)
mkdirSync(dirname(computerHelperPath), { recursive: true, mode: 0o755 })
if (!signPrepared) renameSync(packagedComputerHelperPath, computerHelperPath)
copyFileSync(liveComputerInfoPlist, join(computerHelperContentsPath, 'Info.plist'))
accessSync(computerHelperPath, constants.X_OK)
// A fresh install has no .env: the managed service and update feed come from this file (src/cloud/release-config.ts).
if (releaseCloudUrl) writeFileSync(join(appPath, 'Contents', 'Resources', 'carve-release.json'), JSON.stringify({ managedCloud: true, cloudUrl: releaseCloudUrl }) + '\n')

// The renderer and control plane are reached only at runtime, so an ignore
// pattern that drops them produces a bundle that packages and signs cleanly
// and then dies on launch. Fail the build here instead.
const archivePath = join(appPath, 'Contents', 'Resources', 'app.asar')
for (const entry of [
  'dist/desktop/main.js',
  'dist/desktop/preload.cjs',
  'dist/desktop/observer-hud.html',
  'dist/desktop/observer-hud-preload.cjs',
  'dist/desktop/live-computer-overlay.html',
  'dist/desktop/live-computer-overlay-preload.cjs',
  'dist/src/app.js',
  'dist/gateway/src/provider-cost.js',
  'dist/ui/index.html',
]) {
  try {
    statFile(archivePath, entry)
  } catch {
    throw new Error(`Packaged app.asar is missing ${entry}; check the ignore patterns`)
  }
}

if (distribution) {
  if (!signPrepared) await hardenMacRelease(appPath)
  if (prepareOnly) { console.log(`Prepared for signing: ${appPath}`); process.exit(0) }
  const preparedVersion = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' })
  const preparedBuild = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' })
  if (preparedVersion.stdout.trim() !== packageVersion || preparedBuild.stdout.trim() !== buildNumber) throw new Error('Prepared application does not match the requested version/build')
  signForDistribution()
} else {
  // A local ad-hoc signature has no Team ID. Enabling hardened-runtime library
  // validation here makes dyld reject Electron Framework for a Team ID mismatch.
  run('codesign', ['--force', '--deep', '--sign', '-', appPath])
  // Sign nested code first, then reseal the parent. This preserves the helper's
  // independent TCC identity while making both entries stable across rebuilds.
  run('codesign', ['--force', '--sign', '-', '--identifier', liveComputerBundleIdentifier, '--requirements', localRequirement(liveComputerBundleIdentifier), computerHelperAppPath])
  run('codesign', ['--force', '--sign', '-', '--identifier', bundleIdentifier, '--requirements', localRequirement(bundleIdentifier), appPath])
}
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])

const plistPath = join(appPath, 'Contents', 'Info.plist')
const plist = readFileSync(plistPath, 'utf8')
if (!plist.includes(bundleIdentifier) || !plist.includes('Carve')) throw new Error('Packaged app metadata is missing the Carve identity')

console.log(`Packaged Carve.app: ${appPath}`)
console.log(`Bundle identifier: ${bundleIdentifier}`)
if (rehearsal) {
  console.log(`Signature: ${signingIdentity} (local rehearsal only; no secure timestamp or notarization; do not distribute)`)
} else if (distribution) {
  const artifacts = produceDistributionArtifacts()
  console.log(`Signature: ${signingIdentity} (hardened runtime${notaryProfile ? ', notarized and stapled' : ', NOT notarized: set STEWARD_NOTARY_PROFILE'})`)
  for (const artifact of artifacts) console.log(`Artifact: ${artifact}`)
  if (qualification) console.log('Installation qualification only: backend, legal release approval and updater qualification remain separate; do not publish to testers.')
} else {
  console.log('Signature: ad-hoc local development signature (not notarized for distribution)')
}

if (process.argv.includes('--launch')) {
  assertRequirementStoreCompatible(appPath, join(homedir(), 'Library/Application Support/Carve/data/steward.sqlite'))
  run('open', [appPath])
}

/**
 * Developer ID signing, inside out. Every nested Mach-O gets the hardened
 * runtime and a secure timestamp; Electron's helpers get the JIT entitlements
 * they need; the Swift helpers get none; the main app is sealed last. Signing
 * with `--deep` is deliberately avoided: it applies the outer entitlements to
 * every nested binary and hides ordering mistakes until Gatekeeper finds them.
 */
function signForDistribution(): void {
  const identity = signingIdentity as string
  const base = ['--force', '--sign', identity, '--options', 'runtime', rehearsal ? '--timestamp=none' : '--timestamp']
  const contents = join(appPath, 'Contents')
  const nativeDir = join(contents, 'Resources', 'native')
  for (const name of readdirSync(nativeDir)) {
    const path = join(nativeDir, name)
    if (statSync(path).isFile()) run('codesign', [...base, ...(name === 'carve-keychain-helper' ? ['--identifier', 'app.carve.desktop.keychain-helper'] : []), '--entitlements', nativeHelperEntitlements, path])
  }
  run('codesign', [...base, '--identifier', liveComputerBundleIdentifier, '--entitlements', nativeHelperEntitlements, computerHelperAppPath])
  // Frameworks: sign nested libraries and executables deepest-first, then each framework bundle.
  const frameworksDir = join(contents, 'Frameworks')
  const nested = collectSignables(frameworksDir).sort((left, right) => depth(right) - depth(left))
  for (const path of nested) {
    const isHelperApp = path.endsWith('.app')
    run('codesign', [...base, ...(isHelperApp ? ['--entitlements', electronHelperEntitlements] : []), path])
  }
  run('codesign', [...base, '--identifier', bundleIdentifier, '--entitlements', appEntitlements, appPath])
}

/** Mach-O files, dylibs, .node addons, frameworks, and helper apps under a directory (bundles as units). */
function collectSignables(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.app') || entry.name.endsWith('.framework') || entry.name.endsWith('.xpc')) {
          // Sign what is inside a bundle before the bundle itself.
          walk(path)
          found.push(path)
          continue
        }
        walk(path)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.endsWith('.dylib') || entry.name.endsWith('.node') || (isMachO(path) && !insideBundleMainExecutable(path))) found.push(path)
    }
  }
  walk(root)
  return found
}

function insideBundleMainExecutable(path: string): boolean {
  // A bundle's main executable is signed as part of the bundle, not on its own.
  const parts = path.split('/')
  const macosIndex = parts.lastIndexOf('MacOS')
  return macosIndex > 0 && (parts[macosIndex - 2]?.endsWith('.app') ?? false)
}

function isMachO(path: string): boolean {
  try {
    const fd = readFileSync(path).subarray(0, 4)
    const magic = fd.readUInt32BE(0)
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)
  } catch {
    return false
  }
}

function depth(path: string): number {
  return path.split('/').length
}

/** Zip (for Squirrel updates) and DMG (for first install), notarized and stapled when a notary profile is configured. */
function produceDistributionArtifacts(): string[] {
  const artifactsDir = join(releaseRoot, 'artifacts')
  rmSync(artifactsDir, { recursive: true, force: true })
  mkdirSync(artifactsDir, { recursive: true })
  const zipName = `Carve-${packageVersion}-${targetArch}.zip`
  const dmgName = `Carve-${packageVersion}-${targetArch}.dmg`
  const zipPath = join(artifactsDir, zipName)
  const dmgPath = join(artifactsDir, dmgName)

  if (notaryProfile && spawnSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'ignore' }).status !== 0) {
    // Notarize the app once via a zip, staple the ticket into the bundle, then
    // build the distributable zip and dmg from the stapled app.
    const notarizeZip = join(artifactsDir, 'notarize-upload.zip')
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, notarizeZip])
    run('xcrun', ['notarytool', 'submit', notarizeZip, '--keychain-profile', notaryProfile, '--wait'])
    run('xcrun', ['stapler', 'staple', appPath])
    run('xcrun', ['stapler', 'validate', appPath])
    rmSync(notarizeZip, { force: true })
  }
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])

  const staging = join(artifactsDir, 'dmg-root')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  run('ditto', [appPath, join(staging, 'Carve.app')])
  symlinkSync('/Applications', join(staging, 'Applications'))
  run('hdiutil', ['create', '-volname', 'Carve', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmgPath])
  rmSync(staging, { recursive: true, force: true })
  run('codesign', ['--force', '--sign', signingIdentity as string, '--timestamp', dmgPath])
  if (notaryProfile) {
    run('xcrun', ['notarytool', 'submit', dmgPath, '--keychain-profile', notaryProfile, '--wait'])
    run('xcrun', ['stapler', 'staple', dmgPath])
    run('xcrun', ['stapler', 'validate', dmgPath])
    run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmgPath])
    run('spctl', ['--assess', '--type', 'exec', '--verbose=2', appPath])
  }

  const sums = [zipPath, dmgPath].map((path) => `${sha256File(path)}  ${path.split('/').pop()}`).join('\n') + '\n'
  writeFileSync(join(artifactsDir, 'SHA256SUMS'), sums)
  if (qualification) {
    const manifest = join(artifactsDir, 'qualification.json')
    writeFileSync(manifest, JSON.stringify({
      purpose: 'installation-qualification-only',
      version: packageVersion,
      buildNumber,
      architecture: targetArch,
      minimumMacOS: '14.0',
      cloudConfigured: Boolean(releaseCloudUrl),
      notarized: true,
      readyForBetaDistribution: false,
      remaining: ['Legal release approval and contact metadata', 'Managed backend and download hosting', 'Clean-install account, permission and task checks', 'Signed update and recovery qualification'],
    }, null, 2) + '\n')
    return [zipPath, dmgPath, join(artifactsDir, 'SHA256SUMS'), manifest]
  }
  // Squirrel.Mac static-file feed consumed by Electron's autoUpdater (serverType: 'json'),
  // the same shape the gateway serves (gateway/src/server.ts squirrelFileFeed).
  const updateTo = {
    version: packageVersion,
    name: packageVersion,
    notes: process.env.STEWARD_RELEASE_NOTES ?? `Carve ${packageVersion}`,
    pub_date: new Date().toISOString(),
    url: `${releasesBaseUrl || 'https://RELEASES_BASE_URL_NOT_SET'}/${zipName}`,
  }
  const feed = { currentRelease: packageVersion, releases: [{ version: packageVersion, updateTo }] }
  writeFileSync(join(artifactsDir, `latest-${targetArch}.json`), JSON.stringify(feed, null, 2) + '\n')
  const dmgSha = sha256File(dmgPath)
  writeFileSync(join(artifactsDir, 'release.env'), [
    `RELEASE_VERSION=${packageVersion}`,
    `RELEASE_DATE=${updateTo.pub_date}`,
    `RELEASE_DMG_URL=${releasesBaseUrl || ''}/${dmgName}`,
    `RELEASE_DMG_SHA256=${dmgSha}`,
    `RELEASE_ZIP_${targetArch.toUpperCase()}_URL=${releasesBaseUrl || ''}/${zipName}`,
    '',
  ].join('\n'))
  return [zipPath, dmgPath, join(artifactsDir, 'SHA256SUMS'), join(artifactsDir, `latest-${targetArch}.json`), join(artifactsDir, 'release.env')]
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(command: string, args: string[]): void {
  if (signPrepared && command === 'codesign' && args.includes('--sign')) {
    const team = signingIdentity?.match(/\(([A-Z0-9]{10})\)$/u)?.[1]
    const path = args.at(-1)!
    // Resume only seals already verified as ours. A modified resource or a
    // vendor signature fails this check and is signed normally below.
    if (team) {
      const existing = spawnSync('codesign', ['--verify', '--strict', '-R', `=anchor apple generic and certificate leaf[subject.OU] = "${team}"`, path], { stdio: 'ignore' })
      const details = spawnSync('codesign', ['-d', '--verbose=4', path], { encoding: 'utf8' })
      if (existing.status === 0 && details.stderr.includes('runtime') && details.stderr.includes('Timestamp=')) return
    }
  }
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

function findFile(root: string, filename: string): string | null {
  if (!existsSync(root)) return null
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === filename) return path
    if (entry.isDirectory()) {
      const nested = findFile(path, filename)
      if (nested) return nested
    }
  }
  return null
}
