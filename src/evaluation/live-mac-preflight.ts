import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { LiveComputerStatus } from '../live-computer.js'
import { sha256, stableJson } from '../util.js'
import type { LiveMacFixtureReceipt } from './live-mac-fixtures.js'
import {
  inspectLiveMacCanaryPlan,
  liveMacCanaryPlanHash,
  type LiveMacCanaryCase,
  type LiveMacCanaryPlan,
} from './live-mac-canary.js'

export interface LiveMacApplicationProbe {
  application: string
  bundleIdentifier: string
  available: boolean
  path: string | null
}

export type LiveMacPreflightFindingKind = 'block' | 'desktop_check'

export interface LiveMacPreflightFinding {
  kind: LiveMacPreflightFindingKind
  code: string
  message: string
  caseId: string | null
}

export interface LiveMacCanaryPreflightReport {
  schemaVersion: 1
  planHash: string
  checkedAt: string
  platform: NodeJS.Platform
  caseIds: string[]
  status: 'ready' | 'requires_desktop_check' | 'blocked'
  findings: LiveMacPreflightFinding[]
  applications: LiveMacApplicationProbe[]
  fixtureReceiptHash: string | null
  desktopBridge: {
    checked: boolean
    available: boolean | null
    screenRecording: LiveComputerStatus['screenRecording'] | null
    accessibility: LiveComputerStatus['accessibility'] | null
    computerControl: boolean | null
    globalStopReady: boolean | null
  }
  executionEnabled: false
}

export interface LiveMacCanaryPreflightOptions {
  caseIds?: string[]
  platform?: NodeJS.Platform
  applicationProbes?: LiveMacApplicationProbe[]
  desktopStatus?: LiveComputerStatus | null
  globalStopReady?: boolean | null
  /** Exact workspace-relative paths intentionally changed by earlier cases
   * in the same serial run. They remain bounded by the plan's writable set. */
  mutablePaths?: string[]
  checkedAt?: string
}

const applicationDefinitions: Record<string, { bundleIdentifier: string; paths: string[] }> = {
  Finder: { bundleIdentifier: 'com.apple.finder', paths: ['/System/Library/CoreServices/Finder.app'] },
  TextEdit: { bundleIdentifier: 'com.apple.TextEdit', paths: ['/System/Applications/TextEdit.app', '/Applications/TextEdit.app'] },
  Calculator: { bundleIdentifier: 'com.apple.calculator', paths: ['/System/Applications/Calculator.app', '/Applications/Calculator.app'] },
  Preview: { bundleIdentifier: 'com.apple.Preview', paths: ['/System/Applications/Preview.app', '/Applications/Preview.app'] },
  Numbers: { bundleIdentifier: 'com.apple.iWork.Numbers', paths: ['/Applications/Numbers.app'] },
  Safari: { bundleIdentifier: 'com.apple.Safari', paths: ['/Applications/Safari.app', '/System/Applications/Safari.app'] },
  'Google Chrome': { bundleIdentifier: 'com.google.Chrome', paths: ['/Applications/Google Chrome.app'] },
  'Microsoft Edge': { bundleIdentifier: 'com.microsoft.edgemac', paths: ['/Applications/Microsoft Edge.app'] },
  Firefox: { bundleIdentifier: 'org.mozilla.firefox', paths: ['/Applications/Firefox.app'] },
}

function selectedCases(plan: LiveMacCanaryPlan, requested: string[] | undefined): { cases: LiveMacCanaryCase[]; findings: LiveMacPreflightFinding[] } {
  const caseIds = requested ?? plan.runOrder
  const findings: LiveMacPreflightFinding[] = []
  if (caseIds.length === 0 || new Set(caseIds).size !== caseIds.length) {
    findings.push({ kind: 'block', code: 'preflight.case_selection', message: 'The preflight case selection must be non-empty and contain no duplicates.', caseId: null })
    return { cases: [], findings }
  }
  const byId = new Map(plan.cases.map((entry) => [entry.scenario.id, entry]))
  const cases: LiveMacCanaryCase[] = []
  let lastIndex = -1
  for (const caseId of caseIds) {
    const entry = byId.get(caseId)
    const orderIndex = plan.runOrder.indexOf(caseId)
    if (!entry || orderIndex < 0) {
      findings.push({ kind: 'block', code: 'preflight.case_selection', message: `${caseId} is not part of the exact canary plan.`, caseId })
      continue
    }
    if (orderIndex <= lastIndex) {
      findings.push({ kind: 'block', code: 'preflight.case_order', message: 'Selected cases must preserve the approved serial run order.', caseId })
    }
    lastIndex = orderIndex
    cases.push(entry)
  }
  return { cases, findings }
}

export function probeLiveMacApplications(applications: string[]): LiveMacApplicationProbe[] {
  return [...new Set(applications)].sort().map((application) => {
    const definition = applicationDefinitions[application]
    const path = definition?.paths.find((candidate) => existsSync(candidate)) ?? null
    return {
      application,
      bundleIdentifier: definition?.bundleIdentifier ?? '',
      available: path !== null,
      path,
    }
  })
}

function contained(workspaceRoot: string, relativePath: string): string | null {
  const target = resolve(workspaceRoot, relativePath)
  return target.startsWith(`${workspaceRoot}${sep}`) ? target : null
}

function readFixtureReceipt(plan: LiveMacCanaryPlan, findings: LiveMacPreflightFinding[]): { receipt: LiveMacFixtureReceipt | null; hash: string | null } {
  const receiptPath = resolve(plan.workspaceRoot, '.carve-fixtures.json')
  if (!existsSync(receiptPath)) {
    findings.push({ kind: 'block', code: 'preflight.workspace_unprepared', message: 'The exact generated fixture workspace has not been prepared.', caseId: null })
    return { receipt: null, hash: null }
  }
  try {
    const bytes = readFileSync(receiptPath)
    const receipt = JSON.parse(bytes.toString('utf8')) as LiveMacFixtureReceipt
    if (receipt.schemaVersion !== 1 || receipt.planHash !== liveMacCanaryPlanHash(plan) || resolve(receipt.workspaceRoot) !== plan.workspaceRoot) {
      findings.push({ kind: 'block', code: 'preflight.fixture_receipt', message: 'The fixture receipt is not bound to this exact plan and workspace.', caseId: null })
      return { receipt: null, hash: sha256(bytes) }
    }
    return { receipt, hash: sha256(bytes) }
  } catch {
    findings.push({ kind: 'block', code: 'preflight.fixture_receipt', message: 'The fixture receipt is unreadable or invalid.', caseId: null })
    return { receipt: null, hash: null }
  }
}

function inspectFixtureFiles(plan: LiveMacCanaryPlan, receipt: LiveMacFixtureReceipt, mutablePaths: Set<string>, findings: LiveMacPreflightFinding[]): void {
  const expected = [...new Set(plan.cases.flatMap((entry) => entry.fixturePaths))].sort()
  const received = receipt.files.map((file) => file.path).sort()
  if (stableJson(expected) !== stableJson(received)) {
    findings.push({ kind: 'block', code: 'preflight.fixture_set', message: 'The fixture receipt does not contain the exact generated fixture set.', caseId: null })
    return
  }
  for (const file of receipt.files) {
    if (mutablePaths.has(file.path)) continue
    const path = contained(plan.workspaceRoot, file.path)
    if (!path || !existsSync(path) || !statSync(path).isFile()) {
      findings.push({ kind: 'block', code: 'preflight.fixture_missing', message: `Generated fixture ${file.path} is missing.`, caseId: null })
      continue
    }
    const bytes = readFileSync(path)
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      findings.push({ kind: 'block', code: 'preflight.fixture_changed', message: `Generated fixture ${file.path} changed after preparation.`, caseId: null })
    }
  }
}

function inspectOutputCollisions(plan: LiveMacCanaryPlan, cases: LiveMacCanaryCase[], findings: LiveMacPreflightFinding[]): void {
  for (const entry of cases) {
    const fixturePaths = new Set(entry.fixturePaths)
    for (const relativePath of entry.writablePaths) {
      if (fixturePaths.has(relativePath)) continue
      const path = contained(plan.workspaceRoot, relativePath)
      if (!path) continue
      if (existsSync(path)) findings.push({
        kind: 'block',
        code: 'preflight.output_exists',
        message: `${relativePath} already exists; a live canary may never overwrite an earlier result.`,
        caseId: entry.scenario.id,
      })
    }
  }
}

/** Performs read-only readiness checks. It never launches an application,
 * requests a permission, starts a server, captures a frame, or sends input. */
export function inspectLiveMacCanaryPreflight(plan: LiveMacCanaryPlan, options: LiveMacCanaryPreflightOptions = {}): LiveMacCanaryPreflightReport {
  const planHash = liveMacCanaryPlanHash(plan)
  const findings: LiveMacPreflightFinding[] = inspectLiveMacCanaryPlan(plan).map((finding) => ({
    kind: 'block', code: finding.code, message: finding.message, caseId: null,
  }))
  const selection = selectedCases(plan, options.caseIds)
  findings.push(...selection.findings)
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') findings.push({ kind: 'block', code: 'preflight.platform', message: 'Live-Mac canaries require macOS.', caseId: null })

  const receipt = readFixtureReceipt(plan, findings)
  const planWritablePaths = new Set(plan.cases.flatMap((entry) => entry.writablePaths))
  const mutablePaths = new Set<string>()
  for (const path of options.mutablePaths ?? []) {
    if (!planWritablePaths.has(path)) findings.push({ kind: 'block', code: 'preflight.mutable_path', message: `${path} is not an approved writable path.`, caseId: null })
    else mutablePaths.add(path)
  }
  if (receipt.receipt) inspectFixtureFiles(plan, receipt.receipt, mutablePaths, findings)
  inspectOutputCollisions(plan, selection.cases, findings)

  const requiredApplications = [...new Set(selection.cases.flatMap((entry) => entry.applications))]
  const applications = options.applicationProbes ?? probeLiveMacApplications(requiredApplications)
  for (const application of requiredApplications) {
    const probe = applications.find((candidate) => candidate.application === application)
    const expectedBundle = applicationDefinitions[application]?.bundleIdentifier
    if (!probe?.available || !expectedBundle || probe.bundleIdentifier !== expectedBundle) findings.push({
      kind: 'block', code: 'preflight.application', message: `${application} is not available with a known bundle identity.`, caseId: null,
    })
  }

  const desktopStatus = options.desktopStatus ?? null
  const globalStopReady = options.globalStopReady ?? null
  if (!desktopStatus) {
    findings.push({ kind: 'desktop_check', code: 'preflight.desktop_bridge', message: 'The Carve desktop process must confirm its selected-window bridge and permissions immediately before execution.', caseId: null })
  } else {
    if (!desktopStatus.available || desktopStatus.platform !== 'darwin') findings.push({ kind: 'block', code: 'preflight.desktop_bridge', message: desktopStatus.reason ?? 'The selected-window bridge is unavailable.', caseId: null })
    if (desktopStatus.screenRecording !== 'granted') findings.push({ kind: 'block', code: 'preflight.screen_recording', message: 'Screen Recording permission is not granted.', caseId: null })
    if (desktopStatus.accessibility !== 'granted' || !desktopStatus.computerControl) findings.push({ kind: 'block', code: 'preflight.accessibility', message: 'Accessibility computer control is not granted.', caseId: null })
    const requiredActions: LiveComputerStatus['supportedActions'] = ['move', 'click', 'drag', 'element_action', 'scroll', 'type', 'keypress']
    if (requiredActions.some((action) => !desktopStatus.supportedActions.includes(action))) findings.push({ kind: 'block', code: 'preflight.actions', message: 'The selected-window bridge does not expose the complete bounded action vocabulary.', caseId: null })
    if (globalStopReady !== true) findings.push({ kind: 'block', code: 'preflight.global_stop', message: 'The global stop control is not confirmed ready.', caseId: null })
  }

  const status = findings.some((finding) => finding.kind === 'block')
    ? 'blocked'
    : findings.some((finding) => finding.kind === 'desktop_check') ? 'requires_desktop_check' : 'ready'
  return {
    schemaVersion: 1,
    planHash,
    checkedAt: options.checkedAt ?? new Date().toISOString(),
    platform,
    caseIds: selection.cases.map((entry) => entry.scenario.id),
    status,
    findings,
    applications,
    fixtureReceiptHash: receipt.hash,
    desktopBridge: {
      checked: desktopStatus !== null,
      available: desktopStatus?.available ?? null,
      screenRecording: desktopStatus?.screenRecording ?? null,
      accessibility: desktopStatus?.accessibility ?? null,
      computerControl: desktopStatus?.computerControl ?? null,
      globalStopReady,
    },
    executionEnabled: false,
  }
}
