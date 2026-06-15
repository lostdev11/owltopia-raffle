#!/usr/bin/env node
/**
 * One-shot Sugar deploy for Owl Center public_simple collections:
 * validate → deploy → guard add → guard show → sync IDs to Owl Center
 *
 * Usage:
 *   npm run sugar:deploy -- collections/papers
 *   npm run sugar:deploy -- papers
 *
 * Requires: Sugar CLI on PATH, .env.local with NEXT_PUBLIC_SOLANA_RPC_URL + IRYS_PRIVATE_KEY
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function parseCollectionDir(argv) {
  const arg = argv.find((a) => !a.startsWith('-'))
  if (!arg) {
    throw new Error('Pass a collection folder, e.g. npm run sugar:deploy -- collections/papers')
  }
  const dir = path.isAbsolute(arg) ? arg : path.join(ROOT, arg.replace(/^collections[/\\]/, 'collections/'))
  const normalized = dir.includes(`${path.sep}collections${path.sep}`)
    ? dir
    : path.join(ROOT, 'collections', path.basename(dir))
  return normalized
}

function run(label, cmd, args, opts = {}) {
  console.log(`\n→ ${label}`)
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd, shell: process.platform === 'win32' })
  if (res.status !== 0) {
    throw new Error(`${label} failed (exit ${res.status ?? 1})`)
  }
}

function main() {
  const collectionDir = parseCollectionDir(process.argv.slice(2))
  const rel = path.relative(ROOT, collectionDir).replace(/\\/g, '/')

  console.log(`Owl Center Sugar deploy: ${rel}`)

  run('Configure Solana CLI (mainnet RPC + deployer keypair)', 'node', [
    '--env-file=.env.local',
    'scripts/configure-solana-mainnet-from-env.mjs',
  ], { cwd: ROOT })

  run('sugar validate', 'sugar', ['validate'], { cwd: collectionDir })
  run('sugar deploy', 'sugar', ['deploy'], { cwd: collectionDir })
  run('sugar guard add', 'sugar', ['guard', 'add'], { cwd: collectionDir })
  run('sugar guard show', 'sugar', ['guard', 'show'], { cwd: collectionDir })

  console.log('\n→ Sync IDs to Owl Center (Supabase)')
  run('sugar:sync-ids', 'node', ['--env-file=.env.local', 'scripts/sugar-sync-ids-to-owl-center.mjs', rel], {
    cwd: ROOT,
  })

  console.log('\nDone. Collection IDs synced — check admin Go Live panel or open the public mint page.')
}

main()
