/**
 * Read-only diagnostic: for a given wallet, print exactly which Gen2 phase the site eligibility
 * resolves to (the same logic the minter uses), plus why — Gen1 holder? presale? WL? — and
 * whether the Gen1 airdrop concurrent window is still open.
 *
 *   npx --yes tsx --env-file=.env.local scripts/inspect-gen2-wallet-phase.ts <wallet>
 */
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { buildGen2Eligibility } from '@/lib/owl-center/gen2-eligibility'
import { resolveGen1SnapshotForMint } from '@/lib/owl-center/gen2-mint-delegation'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { isGen2PresaleCreditHolder } from '@/lib/gen2-presale/presale-participation'
import { isGen1AirdropWindowOpen } from '@/lib/owl-center/phase-schedule'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function main() {
  const wallet = process.argv[2]?.trim()
  if (!wallet) throw new Error('Usage: inspect-gen2-wallet-phase.ts <wallet>')

  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) throw new Error('gen2 launch not found')

  console.log(`wallet ${wallet}`)
  console.log(`launch.active_phase = ${launch.active_phase}  is_paused=${launch.is_paused}`)
  console.log(`gen1 airdrop window open right now? ${isGen1AirdropWindowOpen(launch, Date.now())}`)
  console.log('')

  const gen1 = await resolveGen1SnapshotForMint(wallet)
  console.log('=== gen1 snapshot ===')
  console.log(`  is_holder=${gen1.is_holder} gen1_nft_count=${gen1.gen1_nft_count} collection_configured=${gen1.collection_configured}`)
  console.log(`  delegated_from=${gen1.delegated_from ?? '-'} delegated_away_to=${gen1.delegated_away_to ?? '-'}`)

  const bal = await getBalanceByWallet(wallet)
  console.log('\n=== presale balance ===')
  console.log(`  credit_holder=${bal ? isGen2PresaleCreditHolder(bal) : false} available_mints=${bal?.available_mints ?? '-'}`)

  const { data: wlRow } = await getSupabaseAdmin()
    .from('owl_center_wl_allocations')
    .select('allowed_mints, used_mints, community')
    .eq('wallet', wallet)
    .maybeSingle()
  console.log('\n=== whitelist row ===')
  console.log(`  ${wlRow ? JSON.stringify(wlRow) : 'not on WL'}`)

  const elig = await buildGen2Eligibility(wallet)
  console.log('\n=== RESOLVED eligibility (no phase override — same as minter) ===')
  console.log(`  active_phase = ${elig?.active_phase}`)
  console.log(`  is_eligible  = ${elig?.is_eligible}`)
  console.log(`  max_mintable = ${elig?.max_mintable}`)
  console.log(`  reason       = ${elig?.reason ?? '-'}`)
  console.log(`  unit_lamports_estimate = ${elig?.unit_lamports_estimate ?? 'null (FREE phase)'}`)
  console.log(`  price_usdc   = ${elig?.price_usdc ?? '-'}`)

  const pub = await buildGen2Eligibility(wallet, 'PUBLIC')
  console.log('\n=== forced PUBLIC eligibility ===')
  console.log(`  is_eligible=${pub?.is_eligible} max=${pub?.max_mintable} reason=${pub?.reason ?? '-'} unit_lamports=${pub?.unit_lamports_estimate ?? '-'}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('inspect failed:', e)
    process.exit(1)
  })
