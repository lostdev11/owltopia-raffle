/**
 * Support: diagnose / heal Owl Nest ledger for a holder wallet.
 * Usage:
 *   npx --yes tsx scripts/nesting-wallet-diagnostics.ts <wallet>
 *   npx --yes tsx scripts/nesting-wallet-diagnostics.ts <wallet> --heal
 */
import { loadEnvConfig } from '@next/env'
import {
  diagnoseNestingWallet,
  healHolderWalletNests,
} from '@/lib/nesting/admin-wallet-diagnostics'

loadEnvConfig(process.cwd())

const wallet = process.argv[2]?.trim()
const heal = process.argv.includes('--heal')

if (!wallet) {
  console.error('Usage: npx --yes tsx scripts/nesting-wallet-diagnostics.ts <wallet> [--heal]')
  process.exit(1)
}

async function main() {
  const report = await diagnoseNestingWallet(wallet)
  console.log(JSON.stringify(report, null, 2))
  if (heal) {
    const result = await healHolderWalletNests(wallet, {
      clear_pending: true,
      clear_active: true,
      clear_cross_wallet: true,
    })
    console.log('\nheal_result', JSON.stringify(result, null, 2))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
