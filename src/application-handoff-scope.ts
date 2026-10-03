import { handoffIsSource, handoffReadNavigationOnly } from './application-handoff-semantics.js'
import type { ApplicationHandoffTask } from './application-handoff.js'

/** Shared wording for the exact workflow the user is approving. */
export function handoffWorkflowScope(task: ApplicationHandoffTask): string {
  return [...new Set(task.stages.map(({ route }) => {
    const application = route.source === 'fresh' ? route.application : route.target.application
    if (handoffIsSource(route)) return `${handoffReadNavigationOnly(route) ? 'Read' : 'Research in'} ${application}${route.source === 'existing' && route.target.title ? ` · ${route.target.title}` : ''}`
    return route.source === 'fresh' ? `Create a new ${application} document` : `Edit ${application} · ${route.target.title || 'selected document'}`
  }))].join(' → ')
}

/** Consumer copy still distinguishes a new document from editing an existing one. */
export function handoffConversationCopy(task: ApplicationHandoffTask): { question: string; summary: string; approveLabel: string; declineLabel: string } {
  const destinations = task.stages.filter(({ route }) => route.role === 'destination' && route.authority === 'input')
  const apps = [...new Set(destinations.map(({ route }) => route.source === 'fresh' ? route.application : route.target.application))]
  const question = apps.length ? `Continue in ${apps.join(' and ')}?` : 'Read these windows?'
  const work = [...new Set(destinations.map(({ route }) => route.source === 'fresh'
    ? `create a new document in ${route.application}`
    : `edit “${route.target.title || 'the selected document'}” in ${route.target.application}`))]
  const reads = [...new Set(task.stages.filter(({ route }) => handoffIsSource(route)).map(({ route }) => route.source === 'fresh' ? route.application : route.target.application))]
  const summary = work.length
    ? `${reads.length ? `Use the information from ${reads.length === 1 ? 'this window' : reads.join(' and ')} to ` : ''}${work.join(' and ')}.`
    : `I’ll read ${reads.join(' and ') || 'the selected windows'} for this task.`
  const current = task.stages.slice(0, task.stageIndex + 1).reverse().find(stage => stage.target || stage.route.source === 'existing')
  const currentApp = current?.target?.application ?? (current?.route.source === 'existing' ? current.route.target.application : null)
  const stayApp = currentApp === 'Google Chrome' ? 'Chrome' : currentApp
  return { question, summary: summary.charAt(0).toUpperCase() + summary.slice(1),
    approveLabel: apps.length ? `Continue in ${apps.join(' and ')}` : 'Read these windows',
    declineLabel: stayApp ? `Stay in ${stayApp}` : 'Stay here' }
}
