import { loadEnvConfig } from '@next/env'
import { healOrphanedOnChainFrozenNestsForWallet } from '@/lib/nesting/heal-orphaned-onchain-frozen'

loadEnvConfig(process.cwd())

const wallet = process.argv[2]?.trim()
if (!wallet) {
  console.error('Usage: npx --yes tsx scripts/heal-orphaned-onchain-frozen.ts <wallet>')
  process.exit(1)
}

healOrphanedOnChainFrozenNestsForWallet(wallet)
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
