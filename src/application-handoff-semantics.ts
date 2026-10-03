import type { LiveComputerRouteStartEntry } from './desktop-contract.js'

/** Purpose and authority are independent: research may require browser input. */
export function handoffIsSource(route: LiveComputerRouteStartEntry): boolean {
  return route.role === 'research' || route.role === 'reference' || route.authority === 'observe'
}

/** Preserve the existing reference-stage restriction without restricting research. */
export function handoffReadNavigationOnly(route: LiveComputerRouteStartEntry): boolean {
  return route.role === 'reference' || route.authority === 'observe'
}
