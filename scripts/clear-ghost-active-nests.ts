/**
 * Admin recovery: close active nest rows with no mint in the ledger.
 * Usage: npx --yes tsx scripts/clear-ghost-active-nests.ts <wallet> [wallet2...]
 */
import { loadEnvConfig } from '@next/env'
import { clearGhostActiveNestsForWallet } from '@/lib/nesting/clear-ghost-active-nests'

loadEnvConfig(process.cwd())

const wallets = process.argv.slice(2).map((w) => w.trim()).filter(Boolean)
if (wallets.length === 0) {
  console.error('Usage: npx --yes tsx scripts/clear-ghost-active-nests.ts <wallet> ...')
  process.exit(1)
}

for (const wallet of wallets) {
  const result = await clearGhostActiveNestsForWallet(wallet)
  console.log(JSON.stringify(result, null, 2))
}
