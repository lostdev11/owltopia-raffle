#!/usr/bin/env node
/**
 * Flip OwlSend public on Vercel (production + preview by default).
 *
 * Requires Runtime Secrets / env:
 *   VERCEL_TOKEN
 *   VERCEL_ORG_ID + VERCEL_PROJECT_ID  (from `.vercel/project.json` after `vercel link`)
 *
 * Usage:
 *   npm run vercel:owl-send:go-live
 *   npm run vercel:owl-send:go-live -- --check-only
 *   npm run vercel:owl-send:go-live -- --no-redeploy
 *   OWL_SEND_GO_LIVE_ENVS=production npm run vercel:owl-send:go-live
 *
 * After NEXT_PUBLIC_* changes, a Production redeploy is required for the nav + client gate.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const vercelBin = join(ROOT, 'node_modules', '.bin', 'vercel')
const checkOnly = process.argv.includes('--check-only')
const noRedeploy = process.argv.includes('--no-redeploy')
const envs = (process.env.OWL_SEND_GO_LIVE_ENVS || 'production,preview')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** Vars that open OwlSend to everyone (build-time for NEXT_PUBLIC_*). */
const PUBLIC_FLAGS = [
  { key: 'OWL_SEND_PUBLIC', value: 'true' },
  { key: 'NEXT_PUBLIC_OWL_SEND_PUBLIC', value: 'true' },
]

/** Required for fee txs — must already be present on Production. */
const REQUIRED_PRESENT = [
  'NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET',
  // Server may use either; at least one treasury name should exist.
]

const OPTIONAL_PRESENT = [
  'OWL_PLATFORM_FEE_TREASURY_WALLET',
  'OWL_SEND_FEE_SOL',
  'NEXT_PUBLIC_OWL_SEND_FEE_SOL',
]

function fail(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

function ensureVercelAuth() {
  if (!existsSync(vercelBin)) {
    fail('Vercel CLI not installed. Run: npm install')
  }
  if (!process.env.VERCEL_TOKEN?.trim()) {
    fail(
      [
        'VERCEL_TOKEN is not set — cannot update Vercel env vars from this agent.',
        '',
        'Add a Runtime Secret:',
        '  1. https://cursor.com/dashboard/cloud-agents → your environment → Secrets',
        '  2. Name: VERCEL_TOKEN',
        '  3. Value: https://vercel.com/account/tokens',
        '  4. Also set VERCEL_ORG_ID + VERCEL_PROJECT_ID from `.vercel/project.json` after local `vercel link`',
        '  5. Restart the cloud agent, then re-run: npm run vercel:owl-send:go-live',
        '',
        'Or set in the Vercel Dashboard (Production + Preview):',
        '  OWL_SEND_PUBLIC=true',
        '  NEXT_PUBLIC_OWL_SEND_PUBLIC=true',
        'Then Redeploy Production so NEXT_PUBLIC_* is baked into the client bundle.',
      ].join('\n')
    )
  }
}

function ensureProjectLink() {
  const projectJson = join(ROOT, '.vercel', 'project.json')
  if (existsSync(projectJson)) return

  const org = process.env.VERCEL_ORG_ID?.trim()
  const project = process.env.VERCEL_PROJECT_ID?.trim()
  if (!org || !project) {
    fail(
      [
        'Project not linked (.vercel/project.json missing).',
        'Set VERCEL_ORG_ID and VERCEL_PROJECT_ID secrets, or run `vercel link` locally and commit is not required — secrets are enough.',
      ].join('\n')
    )
  }
  mkdirSync(join(ROOT, '.vercel'), { recursive: true })
  writeFileSync(
    projectJson,
    JSON.stringify({ orgId: org, projectId: project }, null, 2) + '\n',
    'utf8'
  )
  console.log('Wrote .vercel/project.json from VERCEL_ORG_ID / VERCEL_PROJECT_ID')
}

function runVercel(args, opts = {}) {
  const result = spawnSync(vercelBin, [...args, '--non-interactive', '--yes'], {
    encoding: 'utf8',
    env: process.env,
    ...opts,
  })
  return result
}

function listEnvJson() {
  const result = runVercel(['env', 'ls', '--format', 'json'])
  if (result.status !== 0) {
    fail(
      `vercel env ls failed:\n${result.stderr || result.stdout || 'unknown error'}`
    )
  }
  const raw = (result.stdout || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : parsed.envs || parsed.environmentVariables || []
  } catch {
    // Older CLI may print a table; fall back to line parse of `vercel env ls`
    const table = runVercel(['env', 'ls'])
    const text = `${table.stdout || ''}\n${table.stderr || ''}`
    const rows = []
    for (const line of text.split('\n')) {
      const m = line.match(/^(\S+)\s+/)
      if (m && !m[1].startsWith('─') && m[1] !== 'name' && m[1] !== 'Name') {
        rows.push({ key: m[1], target: [] })
      }
    }
    return rows
  }
}

function envTargets(entry) {
  const t = entry.target || entry.targets || entry.environments || []
  if (Array.isArray(t)) return t.map(String)
  if (typeof t === 'string') return [t]
  return []
}

function findEnv(entries, key) {
  return entries.filter((e) => (e.key || e.name) === key)
}

function printInventory(entries) {
  const keys = [
    ...PUBLIC_FLAGS.map((f) => f.key),
    ...REQUIRED_PRESENT,
    ...OPTIONAL_PRESENT,
  ]
  console.log('\nOwlSend-related Vercel env inventory:')
  for (const key of keys) {
    const hits = findEnv(entries, key)
    if (!hits.length) {
      console.log(`  ✗ ${key} — missing`)
      continue
    }
    for (const h of hits) {
      const targets = envTargets(h).join(',') || '(unknown target)'
      const valueHint =
        typeof h.value === 'string'
          ? h.value
          : h.encrypted || h.type === 'secret'
            ? '(encrypted)'
            : '(set)'
      console.log(`  • ${key} → ${targets} = ${valueHint}`)
    }
  }
}

function upsertFlag(key, value, environment) {
  console.log(`Setting ${key}=${value} on ${environment}…`)
  const result = runVercel([
    'env',
    'add',
    key,
    environment,
    '--force',
    '--no-sensitive',
    '--value',
    value,
  ])
  if (result.status !== 0) {
    // Fallback: stdin value (some CLI builds)
    const viaStdin = spawnSync(
      vercelBin,
      ['env', 'add', key, environment, '--force', '--no-sensitive', '--non-interactive', '--yes'],
      {
        encoding: 'utf8',
        env: process.env,
        input: `${value}\n`,
      }
    )
    if (viaStdin.status !== 0) {
      fail(
        `Failed to set ${key} on ${environment}:\n${result.stderr || result.stdout}\n${viaStdin.stderr || viaStdin.stdout}`
      )
    }
  }
  console.log(`  ✓ ${key} → ${environment}`)
}

function assertTreasury(entries) {
  const client = findEnv(entries, 'NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET')
  const server = findEnv(entries, 'OWL_PLATFORM_FEE_TREASURY_WALLET')
  if (!client.length && !server.length) {
    fail(
      [
        'Missing platform fee treasury wallet on Vercel.',
        'OwlSend fees require NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET (and preferably OWL_PLATFORM_FEE_TREASURY_WALLET).',
        'Set the same address used for Owl Center / nesting platform fees before going public.',
      ].join('\n')
    )
  }
  if (!client.length) {
    console.warn(
      '⚠ NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET missing — client fee txs will fail. Set it to the same treasury address.'
    )
  }
}

function redeployProduction() {
  console.log('\nRedeploying Production so NEXT_PUBLIC_OWL_SEND_PUBLIC is baked in…')
  // Prefer latest production deployment URL if known; otherwise deploy --prod.
  const ls = runVercel(['ls', '--prod', '--format', 'json'])
  let url = null
  if (ls.status === 0 && ls.stdout?.trim()) {
    try {
      const data = JSON.parse(ls.stdout)
      const list = Array.isArray(data) ? data : data.deployments || []
      url = list[0]?.url ? `https://${list[0].url.replace(/^https?:\/\//, '')}` : null
    } catch {
      /* ignore */
    }
  }

  let result
  if (url) {
    console.log(`Redeploying from ${url}`)
    result = runVercel(['redeploy', url, '--target', 'production'])
  } else {
    console.log('No prior prod URL found — running vercel deploy --prod')
    result = runVercel(['deploy', '--prod'])
  }

  if (result.status !== 0) {
    fail(
      [
        'Env vars were set, but redeploy failed:',
        result.stderr || result.stdout || 'unknown error',
        '',
        'Trigger a Production Redeploy from the Vercel dashboard, then run:',
        '  npm run check:owl-send-live',
      ].join('\n')
    )
  }
  console.log(result.stdout || 'Redeploy started.')
}

async function main() {
  ensureVercelAuth()
  ensureProjectLink()

  const who = runVercel(['whoami'])
  if (who.status !== 0) {
    fail(`vercel whoami failed:\n${who.stderr || who.stdout}`)
  }
  console.log('Vercel CLI authenticated:', (who.stdout || '').trim())

  const entries = listEnvJson()
  printInventory(entries)
  assertTreasury(entries)

  if (checkOnly) {
    console.log('\n--check-only: not modifying env vars.')
    process.exit(0)
  }

  for (const environment of envs) {
    for (const { key, value } of PUBLIC_FLAGS) {
      upsertFlag(key, value, environment)
    }
  }

  // Refresh inventory
  printInventory(listEnvJson())

  if (!noRedeploy && envs.includes('production')) {
    redeployProduction()
  } else if (noRedeploy) {
    console.log('\nSkipped redeploy (--no-redeploy). Trigger Production Redeploy for NEXT_PUBLIC_* to take effect.')
  }

  // Persist a tiny local marker for agents (gitignored via .vercel/)
  try {
    const marker = join(ROOT, '.vercel', 'owl-send-go-live.json')
    writeFileSync(
      marker,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          envs,
          flags: Object.fromEntries(PUBLIC_FLAGS.map((f) => [f.key, f.value])),
        },
        null,
        2
      ) + '\n'
    )
  } catch {
    /* ignore */
  }

  console.log('\nDone. Verify with: npm run check:owl-send-live')
  console.log('Announcement copy: docs/OWLSEND_DEV_ANNOUNCEMENT.md')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
