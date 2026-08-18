/**
 * Backfill public_simple mint events when on-chain CM redeemed > DB minted_count.
 *
 *   npx --yes tsx --env-file=.env.local scripts/reconcile-public-simple-mint-ledger.ts <slug>
 *
 * Breppe OG:
 *   npx --yes tsx --env-file=.env.local scripts/reconcile-public-simple-mint-ledger.ts sub-55d9e2aeb5ac452eb6a378897987633e
 */
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { reconcileOrphanCandyMachineMints } from '@/lib/owl-center/reconcile-launch-mints'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function main() {
  const slug = process.argv[2]?.trim()
  if (!slug) {
    console.error('Usage: tsx --env-file=.env.local scripts/reconcile-public-simple-mint-ledger.ts <slug>')
    process.exit(1)
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launches')
    .select('id, slug, name, mint_mode')
    .eq('slug', slug)
    .maybeSingle()
  if (error) {
    throw new Error(`owl_center_launches lookup failed: ${error.code} ${error.message}`)
  }
  if (!data) throw new Error(`launch not found: ${slug}`)

  const launch = await getOwlCenterLaunchBySlugAdmin(slug)
  if (!launch) throw new Error(`launch map failed: ${slug}`)
  if (launch.mint_mode !== 'public_simple') {
    throw new Error(`${slug} is mint_mode=${launch.mint_mode}, not public_simple`)
  }

  const network = resolveLaunchMintNetwork(launch)
  const cmId = getLaunchCandyMachineId(launch, network)
  const supply = await fetchCandyMachineOnChainSupply(cmId, network)

  console.log('before', {
    slug,
    name: launch.name,
    mint_standard: launch.mint_standard,
    minted_count: launch.minted_count,
    total_supply: launch.total_supply,
    phase: launch.active_phase,
    network,
    cmId,
  })
  console.log('onchain', supply)

  const result = await reconcileOrphanCandyMachineMints(launch, { maxSignatures: 500 })
  console.log('reconcile', result)

  const { count } = await db
    .from('owl_center_mint_events')
    .select('id', { count: 'exact', head: true })
    .eq('launch_id', launch.id)
    .eq('network', network)

  const after = await getOwlCenterLaunchBySlugAdmin(slug)
  console.log('after', {
    minted_count: after?.minted_count,
    mint_events: count ?? 0,
    phase: after?.active_phase,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
