import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

// A packaged development app launches with /Applications as its home rather
// than the repository, so it cannot see the checkout's .env. Copy only model
// connection settings into Carve's private per-user configuration. Runtime
// paths, ports, provider selection, and unrelated secrets are deliberately not
// migrated.
const allowed = new Set([
  'OPENAI_API_KEY',
  'DEEPGRAM_API_KEY',
  'STEWARD_OPENAI_MODEL',
  'STEWARD_OPENAI_EMBEDDING_MODEL',
  'AWS_BEARER_TOKEN_BEDROCK',
  'STEWARD_BEDROCK_REGION',
  'STEWARD_BEDROCK_MODEL',
  'STEWARD_BEDROCK_THINKING',
  'STEWARD_BEDROCK_COMPUTER_TOOL',
  'STEWARD_BEDROCK_COMPUTER_BETA',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'STEWARD_AZURE_OPENAI_DEPLOYMENT',
  'STEWARD_AZURE_OPENAI_DEPLOYMENT_MAP',
  'STEWARD_AZURE_OPENAI_DEPLOYMENTS',
  'STEWARD_AZURE_OPENAI_MODEL',
  'STEWARD_LOCAL_BASE_URL',
  'STEWARD_LOCAL_MODEL',
  'STEWARD_LOCAL_CAPABILITIES',
  'STEWARD_LOCAL_EMBEDDING_MODEL',
])

const sourcePath = resolve(process.cwd(), '.env')
const destinationPath = resolve(homedir(), 'Library/Application Support/Carve/.env')
if (!existsSync(sourcePath)) throw new Error(`Source configuration is missing: ${sourcePath}`)

const source = parse(readFileSync(sourcePath, 'utf8'))
const existing = existsSync(destinationPath) ? parse(readFileSync(destinationPath, 'utf8')) : new Map<string, string>()
let migrated = 0
for (const key of allowed) {
  const value = source.get(key)
  if (!value) continue
  existing.set(key, value)
  migrated += 1
}
if (!existing.get('OPENAI_API_KEY') && !existing.get('AWS_BEARER_TOKEN_BEDROCK') && !existing.get('AZURE_OPENAI_API_KEY') && !existing.get('STEWARD_LOCAL_BASE_URL')) {
  throw new Error('No configured hosted or local model connection was found')
}

mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 })
const temporaryPath = `${destinationPath}.tmp-${process.pid}`
const serialized = [...existing.entries()]
  .filter(([key]) => allowed.has(key))
  .map(([key, value]) => `${key}=${quote(value)}`)
  .join('\n') + '\n'
writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
chmodSync(temporaryPath, 0o600)
renameSync(temporaryPath, destinationPath)
console.log(`Migrated ${migrated} model connection setting${migrated === 1 ? '' : 's'} to Carve's private user configuration`)

function parse(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/u)
    if (!match?.[1] || match[2] === undefined || match[2] === '') continue
    values.set(match[1], match[2].replace(/^(['"])(.*)\1$/u, '$2'))
  }
  return values
}

function quote(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/u.test(value) ? value : JSON.stringify(value)
}
