#!/usr/bin/env node
/**
 * Verify Vercel CLI auth in Cloud Agents / CI.
 * Requires VERCEL_TOKEN in the environment (Cursor: Cloud Agents → Secrets → Runtime Secret).
 *
 * Usage:
 *   npm run vercel:check
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const vercelBin = join(process.cwd(), 'node_modules', '.bin', 'vercel')
if (!existsSync(vercelBin)) {
  console.error('Vercel CLI not installed. Run: npm install')
  process.exit(1)
}

const hasToken = Boolean(process.env.VERCEL_TOKEN?.trim())

if (!hasToken) {
  console.error('Vercel CLI is installed but not authenticated.')
  console.error('')
  console.error('Add a Runtime Secret in Cursor Cloud Agents:')
  console.error('  1. https://cursor.com/dashboard/cloud-agents → your environment → Secrets')
  console.error('  2. Name: VERCEL_TOKEN')
  console.error('  3. Value: token from https://vercel.com/account/tokens')
  console.error('  4. Restart / update the cloud environment, then re-run this agent.')
  console.error('')
  console.error('Optional (skip `vercel link` in CI):')
  console.error('  VERCEL_ORG_ID, VERCEL_PROJECT_ID from .vercel/project.json after local link')
  process.exit(1)
}

const whoami = spawnSync(vercelBin, ['whoami', '--non-interactive'], {
  encoding: 'utf8',
  env: process.env,
})

if (whoami.status !== 0) {
  console.error('VERCEL_TOKEN is set but `vercel whoami` failed:')
  console.error(whoami.stderr || whoami.stdout || 'unknown error')
  process.exit(whoami.status || 1)
}

const identity = (whoami.stdout || '').trim()
console.log('Vercel CLI authenticated:', identity || '(ok)')

if (process.env.VERCEL_ORG_ID && process.env.VERCEL_PROJECT_ID) {
  console.log('VERCEL_ORG_ID and VERCEL_PROJECT_ID are set (linkless deploy/pull ready).')
} else {
  console.log('Tip: set VERCEL_ORG_ID + VERCEL_PROJECT_ID secrets to avoid interactive `vercel link`.')
}

process.exit(0)
