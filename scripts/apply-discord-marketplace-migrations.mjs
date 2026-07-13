#!/usr/bin/env node
/**
 * Apply Discord marketplace SQL (migrations 191–194) to Supabase Postgres.
 *
 * Requires one of these in .env.local (or env):
 *   DATABASE_URL
 *   SUPABASE_DB_URL
 *   DIRECT_URL
 *
 * Usage: npm run db:apply-discord-marketplace
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SQL_FILE = join(ROOT, 'supabase/migrations/apply_discord_marketplace_migrations.sql')
const ENV_LOCAL = join(ROOT, '.env.local')

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function getDatabaseUrl() {
  const fromEnv =
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim()
  if (fromEnv) return fromEnv

  const local = parseEnvFile(ENV_LOCAL)
  return (
    local.DATABASE_URL?.trim() ||
    local.SUPABASE_DB_URL?.trim() ||
    local.DIRECT_URL?.trim() ||
    ''
  )
}

const dbUrl = getDatabaseUrl()
if (!dbUrl) {
  console.error('Missing DATABASE_URL (or SUPABASE_DB_URL / DIRECT_URL) in .env.local')
  console.error('')
  console.error('Get it from Supabase Dashboard → Project Settings → Database → Connection string (URI).')
  console.error('Use the direct connection (port 5432) or session pooler.')
  console.error('')
  console.error('Or paste supabase/migrations/apply_discord_marketplace_migrations.sql into SQL Editor.')
  process.exit(1)
}

if (!existsSync(SQL_FILE)) {
  console.error('SQL file not found:', SQL_FILE)
  process.exit(1)
}

const sql = readFileSync(SQL_FILE, 'utf8')

let result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', SQL_FILE], {
  stdio: 'inherit',
  encoding: 'utf8',
})

if (result.error?.code === 'ENOENT') {
  result = spawnSync(
    'npx',
    ['supabase', 'db', 'execute', '--db-url', dbUrl, '--file', SQL_FILE],
    { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' }
  )
}

if (result.status !== 0) {
  console.error('')
  console.error('Apply failed. Fallback: Supabase Dashboard → SQL Editor → paste:')
  console.error('  supabase/migrations/apply_discord_marketplace_migrations.sql')
  process.exit(result.status ?? 1)
}

console.log('')
console.log('Discord marketplace migrations applied successfully.')
console.log('Verify with:')
console.log(
  "  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'discord_marketplace%' ORDER BY 1;"
)
