/** Read-only: print the Owl Center platform mint-fee config (treasury + ~$1 SOL quote). */
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import {
  isOwlCenterPlatformMintFeeEnabled,
  owlCenterPlatformMintFeeUsd,
  owlCenterPlatformMintFeeLamports,
} from '@/lib/owl-center/platform-mint-fee'

async function main() {
  const treasury = getOwlCenterPlatformTreasuryWallet()
  const usd = owlCenterPlatformMintFeeUsd()
  const enabled = isOwlCenterPlatformMintFeeEnabled()
  const quote = await owlCenterPlatformMintFeeLamports()
  console.log('platform mint fee config')
  console.log(`  enabled          = ${enabled}`)
  console.log(`  fee usd          = $${usd}`)
  console.log(`  treasury wallet  = ${treasury ?? 'NOT SET'}`)
  if (quote) {
    console.log(`  live SOL fee     = ${quote.lamports} lamports = ${(Number(quote.lamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL @ $${quote.solUsdPrice.toFixed(2)}/SOL`)
  } else {
    console.log('  live SOL fee     = (quote unavailable)')
  }
  console.log('')
  console.log('  tx account 7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY received ~0.014 SOL in both the')
  console.log('  successful + bot-tax txs — matches this treasury? ->', treasury === '7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('failed:', e)
    process.exit(1)
  })
