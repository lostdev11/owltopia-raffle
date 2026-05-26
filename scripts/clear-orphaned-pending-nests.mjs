/**
 * Admin recovery: close orphaned pending nests (awaiting_nft_freeze, never frozen on-chain).
 * Usage: node --env-file=.env.local scripts/clear-orphaned-pending-nests.mjs <wallet> [wallet2...]
 */
import { loadEnvConfig } from '@next/env'
import { createRequire } from 'module'

loadEnvConfig(process.cwd())

const wallets = process.argv.slice(2)
if (wallets.length === 0) {
  console.error('Usage: node --env-file=.env.local scripts/clear-orphaned-pending-nests.mjs <wallet> ...')
  process.exit(1)
}

// Dynamic import compiled TS via tsx register is heavy; use npx tsx wrapper instead.
console.error('Run: npx --yes tsx scripts/clear-orphaned-pending-nests.ts', wallets.join(' '))
process.exit(1)
