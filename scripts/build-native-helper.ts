import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const outputDirectory = resolve(process.cwd(), 'dist/native')
const outputPath = resolve(outputDirectory, 'steward-capture-helper')
const sourcePath = resolve(process.cwd(), 'native/macos/CarveCaptureHelper.swift')
const keychainOutputPath = resolve(outputDirectory, 'carve-keychain-helper')
const keychainSourcePath = resolve(process.cwd(), 'native/macos/CarveKeychainHelper.swift')
const authenticationOutputPath = resolve(outputDirectory, 'steward-authentication-helper')
const authenticationSourcePath = resolve(process.cwd(), 'native/macos/CarveAuthenticationHelper.swift')
const computerOutputPath = resolve(outputDirectory, 'steward-computer-helper')
const computerSourcePath = resolve(process.cwd(), 'native/macos/CarveComputerHelper.swift')
const inputBridgeOutputPath = resolve(outputDirectory, 'steward-live-input-bridge.node')
const inputBridgeSourcePath = resolve(process.cwd(), 'native/macos/CarveLiveInputBridge.mm')

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })

if (process.platform !== 'darwin') {
  console.log('Native macOS capture helper skipped on this platform')
  process.exit(0)
}
if (!existsSync(sourcePath)) throw new Error(`Missing native helper source: ${sourcePath}`)
if (!existsSync(authenticationSourcePath)) throw new Error(`Missing authentication helper source: ${authenticationSourcePath}`)
if (!existsSync(computerSourcePath)) throw new Error(`Missing live computer helper source: ${computerSourcePath}`)
if (!existsSync(inputBridgeSourcePath)) throw new Error(`Missing live input bridge source: ${inputBridgeSourcePath}`)

compile(sourcePath, outputPath)
compile(authenticationSourcePath, authenticationOutputPath)
compile(keychainSourcePath, keychainOutputPath)
compile(computerSourcePath, computerOutputPath)
compileInputBridge(inputBridgeSourcePath, inputBridgeOutputPath)

const identity = process.env.STEWARD_CAPTURE_SIGN_IDENTITY?.trim() || '-'
sign(outputPath, 'dev.steward.capture-helper', identity)
sign(keychainOutputPath, 'app.carve.desktop.keychain-helper', identity)
sign(authenticationOutputPath, 'dev.steward.authentication-helper', identity)
sign(computerOutputPath, 'dev.steward.computer-helper', identity)
sign(inputBridgeOutputPath, 'dev.steward.live-input-bridge', identity)
console.log(`Built and signed observation-only macOS helper: ${outputPath}`)
console.log(`Built and signed macOS privacy authentication helper: ${authenticationOutputPath}`)
console.log(`Built and signed supervised macOS computer helper: ${computerOutputPath}`)
console.log(`Built and signed Electron-process macOS input bridge: ${inputBridgeOutputPath}`)

function compile(source: string, output: string): void {
  run('xcrun', [
    'swiftc',
    '-parse-as-library',
    ...(source === computerSourcePath ? ['-import-objc-header', resolve('native/macos/CarveControlSensitivity.h')] : []),
    '-O',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
    source,
    ...(source === computerSourcePath ? [resolve('native/macos/CarveFreshDocumentPolicy.swift')] : []),
    '-o',
    output,
  ])
  chmodSync(output, 0o700)
}

function compileInputBridge(source: string, output: string): void {
  const nodeHeaders = process.env.STEWARD_NODE_HEADERS?.trim() || '/opt/homebrew/include/node'
  if (!existsSync(resolve(nodeHeaders, 'node_api.h'))) throw new Error(`Node-API headers are unavailable at ${nodeHeaders}; set STEWARD_NODE_HEADERS to the directory containing node_api.h`)
  run('xcrun', [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-bundle',
    '-undefined', 'dynamic_lookup',
    '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
    '-I', nodeHeaders,
    source,
    '-framework', 'ApplicationServices',
    '-framework', 'AppKit',
    '-framework', 'Foundation',
    '-o', output,
  ])
  chmodSync(output, 0o700)
}

function sign(path: string, identifier: string, identity: string): void {
  run('codesign', [
    '--force',
    '--sign',
    identity,
    '--identifier',
    identifier,
    '--options',
    'runtime',
    path,
  ])
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}
