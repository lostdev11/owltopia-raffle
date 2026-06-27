import { Connection, PublicKey } from '@solana/web3.js'

import { parseCandyMachineMintFromTransaction } from '@/lib/owl-center/parse-candy-machine-mint-tx'
import { ensureSelloutMarketplacePrepIfNeeded } from '@/lib/owl-center/sellout-marketplace-prep'
import type { OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'
import { verifyGen2MintTransaction } from '@/lib/owl-center/verify-gen2-mint-tx'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { shouldRequireOwlCenterPlatformMintFeeServer } from '@/lib/owl-center/platform-mint-fee'
import { fetchParsedTransactionConfirmed } from '@/lib/gen2-presale/verify-payment'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { resolveOwlCenterMintVerifyRpcUrl } from '@/lib/solana/network'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const MINTABLE_PHASES = new Set<OwlCenterPhase>([
  'AIRDROP',
  'PRESALE',
  'PRESALE_OVERAGE',
  'WHITELIST',
  'PUBLIC',
])

export type ReconcileLaunchMintsResult = {
  recorded: number
  sold_out_synced: boolean
  sellout_prep: boolean
}

/** Mark launch sold out when DB supply is exhausted (e.g. after orphan backfill). */
export async function syncLaunchSoldOutPhaseIfExhausted(launchId: string): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launches')
    .select('id,minted_count,total_supply,active_phase,status')
    .eq('id', launchId)
    .maybeSingle()
  if (error || !data) return false

  const row = data as {
    minted_count: number
    total_supply: number
    active_phase: string
    status: string
  }
  if (row.minted_count < row.total_supply) return false
  if (row.active_phase === 'TRADING_ACTIVE') return false
  if (row.active_phase === 'SOLD_OUT' && row.status === 'SOLD_OUT') return false

  const { error: updErr } = await db
    .from('owl_center_launches')
    .update({
      active_phase: 'SOLD_OUT',
      status: 'SOLD_OUT',
      updated_at: new Date().toISOString(),
    })
    .eq('id', launchId)

  if (updErr) return false

  await db.from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `SELL_OUT supply exhausted (${row.minted_count}/${row.total_supply}) — phase synced`,
    event_type: 'system',
  })

  return true
}

/**
 * When on-chain CM redeems exceed DB minted_count, scan CM signatures and record verified orphans.
 * Keeps supply counters aligned so the last mint properly sells out the collection.
 */
export async function reconcileOrphanCandyMachineMints(
  launch: OwlCenterLaunchPublic,
  opts?: { maxSignatures?: number }
): Promise<ReconcileLaunchMintsResult> {
  const empty: ReconcileLaunchMintsResult = { recorded: 0, sold_out_synced: false, sellout_prep: false }
  if (launch.mint_mode !== 'public_simple') return empty

  const network = resolveLaunchMintNetwork(launch)
  const cmId = getLaunchCandyMachineId(launch, network)
  if (!cmId) return empty

  const supply = await fetchCandyMachineOnChainSupply(cmId, network)
  if (!supply.ok) return empty

  const db = getSupabaseAdmin()
  let recorded = 0

  if (supply.itemsRedeemed > launch.minted_count && MINTABLE_PHASES.has(launch.active_phase)) {
    // Paginate past PostgREST's 1000-row default cap; otherwise once a launch has >1000 mint
    // events the dedupe set is incomplete and already-recorded signatures get re-recorded,
    // inflating minted_count.
    const knownSigs = new Set<string>()
    {
      const pageSize = 1000
      let from = 0
      for (;;) {
        const { data: existing } = await db
          .from('owl_center_mint_events')
          .select('tx_signature')
          .eq('launch_id', launch.id)
          .eq('network', network)
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1)
        const batch = existing ?? []
        for (const r of batch) knownSigs.add(String((r as { tx_signature: string }).tx_signature))
        if (batch.length < pageSize) break
        from += pageSize
      }
    }
    const connection = new Connection(resolveOwlCenterMintVerifyRpcUrl(network), 'confirmed')
    const sigs = await connection.getSignaturesForAddress(new PublicKey(cmId), {
      limit: Math.min(500, Math.max(50, opts?.maxSignatures ?? 200)),
    })

    const requirePlatformFee = shouldRequireOwlCenterPlatformMintFeeServer()
    const phase = launch.active_phase

    for (const entry of [...sigs].reverse()) {
      if (supply.itemsRedeemed <= launch.minted_count + recorded) break
      if (entry.err || knownSigs.has(entry.signature)) continue

      const parsed = await fetchParsedTransactionConfirmed(connection, entry.signature)
      if (!parsed) continue

      const mint = parseCandyMachineMintFromTransaction(parsed, cmId)
      if (!mint) continue

      const verified = await verifyGen2MintTransaction({
        txSignature: entry.signature,
        wallet: mint.wallet,
        candyMachineId: cmId,
        network,
        requirePlatformMintFee: requirePlatformFee,
      })
      if (!verified.ok) continue

      const { data, error } = await db.rpc('confirm_owl_center_gen2_mint', {
        p_launch_slug: launch.slug,
        p_wallet: mint.wallet,
        p_tx_signature: entry.signature,
        p_quantity: mint.quantity,
        p_phase: phase,
        p_minted_nft_mints: mint.mintedNftMints,
        p_network: network,
        p_event_candy_machine_id: cmId,
      })

      const row = data as { ok?: boolean; error?: string; duplicate_tx?: boolean } | null
      if (error || !row?.ok) continue

      recorded++
      knownSigs.add(entry.signature)
      launch = { ...launch, minted_count: launch.minted_count + mint.quantity }
    }
  }

  let sold_out_synced = false
  if (launch.minted_count >= launch.total_supply || supply.remaining <= 0) {
    sold_out_synced = await syncLaunchSoldOutPhaseIfExhausted(launch.id)
  }

  let sellout_prep = false
  if (sold_out_synced || launch.minted_count >= launch.total_supply) {
    const fresh = await getOwlCenterLaunchBySlugAdmin(launch.slug)
    if (fresh) {
      const prep = await ensureSelloutMarketplacePrepIfNeeded(fresh)
      sellout_prep = prep.ok === true
    }
  }

  return { recorded, sold_out_synced, sellout_prep }
}

/** Reconcile when chain supply is ahead of DB (public_simple launches only). */
export async function maybeReconcileLaunchMintsFromChain(
  launch: OwlCenterLaunchPublic
): Promise<ReconcileLaunchMintsResult> {
  if (launch.mint_mode !== 'public_simple') {
    return { recorded: 0, sold_out_synced: false, sellout_prep: false }
  }

  const network = resolveLaunchMintNetwork(launch)
  const cmId = getLaunchCandyMachineId(launch, network)
  if (!cmId) return { recorded: 0, sold_out_synced: false, sellout_prep: false }

  const supply = await fetchCandyMachineOnChainSupply(cmId, network)
  if (!supply.ok) return { recorded: 0, sold_out_synced: false, sellout_prep: false }

  if (supply.itemsRedeemed <= launch.minted_count) {
    const sold_out_synced = await syncLaunchSoldOutPhaseIfExhausted(launch.id)
    let sellout_prep = false
    const fresh = await getOwlCenterLaunchBySlugAdmin(launch.slug)
    if (fresh) {
      const prep = await ensureSelloutMarketplacePrepIfNeeded(fresh)
      sellout_prep = prep.ok === true
    }
    return { recorded: 0, sold_out_synced, sellout_prep }
  }

  return reconcileOrphanCandyMachineMints(launch)
}
