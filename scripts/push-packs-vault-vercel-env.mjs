#!/usr/bin/env node
/**
 * Push PACKS_VAULT_SECRET_KEY to Vercel (Production, Preview, Development).
 * NEXT_PUBLIC_PACKS_VAULT_WALLET is public — add via dashboard or:
 *   echo owL2vVo8... | vercel env add NEXT_PUBLIC_PACKS_VAULT_WALLET production
 *
 * Prerequisite: .local/packs-vault-keypair.json (standard [64] format)
 * Usage: npm run packs:push-vault-vercel-env
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const KEYPAIR_JSON = join(ROOT, '.local', 'packs-vault-keypair.json')

if (!existsSync(KEYPAIR_JSON)) {
  console.error('Missing', KEYPAIR_JSON)
  process.exit(1)
}

const parsed = JSON.parse(readFileSync(KEYPAIR_JSON, 'utf8'))
const secretJson = Array.isArray(parsed)
  ? JSON.stringify(parsed)
  : JSON.stringify(parsed.secretKey)

if (!secretJson || secretJson.length < 10) {
  console.error('Invalid keypair file')
  process.exit(1)
}

const environments = ['production', 'preview', 'development']

for (const env of environments) {
  const result = spawnSync('vercel', ['env', 'add', 'PACKS_VAULT_SECRET_KEY', env, '--sensitive', '--force'], {
    input: secretJson,
    encoding: 'utf8',
    cwd: ROOT,
    shell: true,
  })
  if (result.status !== 0) {
    console.error(`Failed for ${env}:`, result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
  console.log(`PACKS_VAULT_SECRET_KEY → ${env}`)
}

console.log('Done. Redeploy production for NEXT_PUBLIC_* changes to apply.')
