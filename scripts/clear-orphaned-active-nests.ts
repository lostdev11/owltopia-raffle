/**
 * Admin recovery: close active nests with no on-chain freeze lock (DB/chart mismatch).
 * Usage: npx --yes tsx scripts/clear-orphaned-active-nests.ts <wallet> [wallet2...]
 */
import { loadEnvConfig } from '@next/env'
import { clearOrphanedActiveNftNestsForWallet } from '@/lib/nesting/clear-orphaned-active-nests'

loadEnvConfig(process.cwd())

const wallets = process.argv.slice(2)
if (wallets.length === 0) {
  console.error('Usage: npx --yes tsx scripts/clear-orphaned-active-nests.ts <wallet> ...')
  process.exit(1)
}

async function main() {
  for (const wallet of wallets) {
    const result = await clearOrphanedActiveNftNestsForWallet(wallet.trim())
    const cleared = result.results.filter((r) => r.cleared)
    const blocked = result.results.filter((r) => r.reason === 'still_frozen_on_chain')
    console.log(JSON.stringify({ wallet, cleared_count: result.cleared_count, cleared, blocked }, null, 2))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
