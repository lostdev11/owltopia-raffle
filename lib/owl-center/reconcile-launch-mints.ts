import { Connection, PublicKey } from '@solana/web3.js'

import { parseCandyMachineMintFromTransaction } from '@/lib/owl-center/parse-candy-machine-mint-tx'
import { ensureSelloutMarketplacePrepIfNeeded } from '@/lib/owl-center/sellout-marketplace-prep'
import { syncLaunchSoldOutPhaseIfExhausted } from '@/lib/owl-center/sync-launch-sold-out'
import type { OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'
import { verifyGen2MintTransaction } from '@/lib/owl-center/verify-gen2-mint-tx'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { fetchParsedTransactionConfirmed } from '@/lib/gen2-presale/verify-payment'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { resolveOwlCenterMintVerifyRpcUrl } from '@/lib/solana/network'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export { syncLaunchSoldOutPhaseIfExhausted } from '@/lib/owl-center/sync-launch-sold-out'

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

const DIRECT_INSERT_RPC_ERRORS = new Set([
  'wallet_mint_limit',
  'mint_paused',
  'mint_closed',
  'phase_mismatch',
])

/** Record an on-chain public_simple mint. Wallet-limit / pause gates still apply to live confirms; orphans skip them. */
async function recordPublicSimpleOrphanMint(
  launch: OwlCenterLaunchPublic,
  cmId: string,
  network: 'mainnet' | 'devnet',
  txSignature: string,
  mint: { wallet: string; mintedNftMints: string[]; quantity: number }
): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.rpc('confirm_owl_center_gen2_mint', {
    p_launch_slug: launch.slug,
    p_wallet: mint.wallet,
    p_tx_signature: txSignature,
    p_quantity: mint.quantity,
    p_phase: 'PUBLIC',
    p_minted_nft_mints: mint.mintedNftMints,
    p_network: network,
    p_event_candy_machine_id: cmId,
  })
  const row = data as { ok?: boolean; error?: string } | null
  if (!error && row?.ok === true) return true

  const rpcErr = typeof row?.error === 'string' ? row.error : ''
  if (rpcErr === 'duplicate_tx') return false
  if (!DIRECT_INSERT_RPC_ERRORS.has(rpcErr)) {
    if (error) console.error('[reconcile-public-simple] confirm RPC', error.message)
    else if (rpcErr) console.error('[reconcile-public-simple] confirm rejected', rpcErr)
    return false
  }

  const { error: insertErr } = await db.from('owl_center_mint_events').insert({
    launch_id: launch.id,
    wallet_address: mint.wallet,
    quantity: mint.quantity,
    phase: 'PUBLIC',
    tx_signature: txSignature,
    minted_nft_mints: mint.mintedNftMints,
    network,
    candy_machine_id: cmId,
  })
  if (insertErr) {
    if (/duplicate|unique/i.test(insertErr.message)) return false
    console.error('[reconcile-public-simple] direct insert failed', insertErr.message)
    return false
  }

  const { data: launchRow } = await db
    .from('owl_center_launches')
    .select('minted_count, total_supply')
    .eq('id', launch.id)
    .maybeSingle()
  const current = Number((launchRow as { minted_count?: number } | null)?.minted_count ?? 0)
  const total = Number((launchRow as { total_supply?: number } | null)?.total_supply ?? 0)
  const next = Math.min(total || Number.MAX_SAFE_INTEGER, current + mint.quantity)
  await db
    .from('owl_center_launches')
    .update({ minted_count: next, updated_at: new Date().toISOString() })
    .eq('id', launch.id)

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

    const mintStandard = launch.mint_standard === 'core' ? 'core' : 'token_metadata'

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
        // Orphans already exist on-chain; record them even if they skipped the site fee path.
        requirePlatformMintFee: false,
        mintQuantity: mint.quantity,
        minMintedNfts: mint.quantity,
        mintStandard,
        coreAssetAddresses: mintStandard === 'core' ? mint.mintedNftMints : undefined,
      })
      if (!verified.ok) continue

      const wrote = await recordPublicSimpleOrphanMint(launch, cmId, network, entry.signature, mint)
      if (!wrote) continue

      recorded++
      knownSigs.add(entry.signature)
      launch = { ...launch, minted_count: launch.minted_count + mint.quantity }
    }
  }

  let sold_out_synced = false
  const onChainEmpty = supply.itemsLoaded > 0 && supply.remaining <= 0
  if (launch.minted_count >= launch.total_supply || onChainEmpty) {
    sold_out_synced = await syncLaunchSoldOutPhaseIfExhausted(launch.id, {
      force: onChainEmpty && launch.minted_count < launch.total_supply,
      reason: onChainEmpty
        ? `on-chain Candy Machine empty (DB ${launch.minted_count}/${launch.total_supply})`
        : undefined,
    })
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
    const onChainEmpty = supply.itemsLoaded > 0 && supply.remaining <= 0
    const sold_out_synced = await syncLaunchSoldOutPhaseIfExhausted(launch.id, {
      force: onChainEmpty && launch.minted_count < launch.total_supply,
      reason: onChainEmpty
        ? `on-chain Candy Machine empty (DB ${launch.minted_count}/${launch.total_supply})`
        : undefined,
    })
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
