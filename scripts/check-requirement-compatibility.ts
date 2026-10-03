import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { statFile } from '@electron/asar'
import { assertRequirementCheckpointCompatible } from '../src/requirement-compatibility.js'

export function assertRequirementStoreCompatible(appPath: string, databasePath: string): void {
  if (!existsSync(databasePath)) return
  let supportsV2 = false
  try { supportsV2 = Boolean(statFile(join(appPath, 'Contents/Resources/app.asar'), 'dist/src/task-requirements.js')) } catch { /* pre-v2 build */ }
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const columns = db.prepare('PRAGMA table_info(work_runs)').all() as Array<{ name: string }>
    if (!columns.some(c => c.name === 'live_checkpoint_json')) return
    for (const row of db.prepare('SELECT live_checkpoint_json FROM work_runs WHERE live_checkpoint_json IS NOT NULL').all() as Array<{ live_checkpoint_json: string }>) {
      assertRequirementCheckpointCompatible(JSON.parse(row.live_checkpoint_json), supportsV2 ? [2] : [])
    }
  } finally { db.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = process.argv.find(a => a.startsWith('--app='))?.slice(6)
  const database = process.argv.find(a => a.startsWith('--database='))?.slice(11)
  if (!app || !database) throw new Error('Provide --app=<candidate Carve.app> and --database=<steward.sqlite> before install or rollback')
  assertRequirementStoreCompatible(resolve(app), resolve(database))
  console.log('The candidate can read this store’s requirement versions.')
}
