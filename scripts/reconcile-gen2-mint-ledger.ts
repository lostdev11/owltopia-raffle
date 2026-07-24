/**
 * One-shot: backfill Gen2 mint events when CM redeemed > DB minted_count.
 *   npx --yes tsx --env-file=.env.local scripts/reconcile-gen2-mint-ledger.ts
 */
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { reconcileGen2LaunchMintsFromChain } from '@/lib/owl-center/reconcile-gen2-wallet-mints'
import { reconcileLaunchMintedCount } from '@/lib/owl-center/reconcile-gen2-minted-count'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'

async function main() {
  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) throw new Error('gen2 launch not found')
  console.log('before', {
    minted_count: launch.minted_count,
    total_supply: launch.total_supply,
    phase: launch.active_phase,
  })
  const cmId = launch.candy_machine_id || process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || ''
  const supply = await fetchCandyMachineOnChainSupply(cmId, 'mainnet')
  console.log('onchain', supply)
  const result = await reconcileGen2LaunchMintsFromChain(launch, { maxSignatures: 1000 })
  console.log('reconcile recorded', result)
  const count = await reconcileLaunchMintedCount(launch.id, 'mainnet')
  console.log('minted_count from ledger', count)
  const after = await getOwlCenterLaunchBySlugAdmin('gen2')
  console.log('after', {
    minted_count: after?.minted_count,
    total_supply: after?.total_supply,
    phase: after?.active_phase,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
