import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import {
  formatHashListText,
  suggestMagicEdenCollectionUrl,
  suggestTensorCollectionUrl,
} from '@/lib/owl-center/marketplace-urls'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import {
  isLaunchSoldOutPhase,
  isLaunchSupplyExhausted,
} from '@/lib/owl-center/launch-marketplace-eligibility'
import {
  getMarketplaceReadinessByLaunchId,
  syncLaunchMarketplaceFieldsFromRow,
  upsertMarketplaceReadinessForLaunch,
} from '@/lib/db/owl-center-marketplace'
import { getLaunchCollectionMint, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type SelloutMarketplacePrepResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  mint_count?: number
  magic_eden_url?: string | null
  tensor_url?: string | null
  hash_list_download_path?: string
}

/**
 * On sell-out: generate hash list, suggest ME/Tensor URLs, mark READY_FOR_INDEXING.
 * Magic Eden / Tensor still require creator-hub hash list submit (no public auto-upload API).
 */
/** Run sell-out prep when supply is exhausted but hash list / ME URLs are not stored yet. */
export async function ensureSelloutMarketplacePrepIfNeeded(
  launch: OwlCenterLaunchPublic
): Promise<SelloutMarketplacePrepResult> {
  if (launch.mint_mode !== 'public_simple') {
    return { ok: false, skipped: true, reason: 'not_public_simple' }
  }

  const supplyExhausted = isLaunchSupplyExhausted(launch)
  const soldOutPhase = isLaunchSoldOutPhase(launch)

  if (!supplyExhausted && !soldOutPhase) {
    return { ok: false, skipped: true, reason: 'not_sold_out' }
  }

  return runSelloutMarketplacePrep(launch)
}

export async function runSelloutMarketplacePrep(
  launch: OwlCenterLaunchPublic
): Promise<SelloutMarketplacePrepResult> {
  if (launch.mint_mode !== 'public_simple') {
    return { ok: false, skipped: true, reason: 'not_public_simple' }
  }

  if (!isLaunchSoldOutPhase(launch)) {
    if (!isLaunchSupplyExhausted(launch)) {
      return { ok: false, skipped: true, reason: 'not_sold_out' }
    }
  }

  const existing = await getMarketplaceReadinessByLaunchId(launch.id)
  if (existing?.sellout_prepared_at && existing.hash_list_text?.trim()) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_prepared',
      mint_count: existing.hash_list_text.split('\n').filter(Boolean).length,
      magic_eden_url: existing.magic_eden_url,
      tensor_url: existing.tensor_url,
      hash_list_download_path: `/api/owl-center/collections/${launch.slug}/hash-list`,
    }
  }

  const mints = await collectMintedNftMintsForLaunch(launch.id)
  const hashListText = formatHashListText(mints)
  const network = resolveLaunchMintNetwork(launch)
  const collectionMint =
    getLaunchCollectionMint(launch, network) || launch.collection_mint?.trim() || ''
  const meUrl = collectionMint ? suggestMagicEdenCollectionUrl(collectionMint, network) : null
  const tensorUrl = collectionMint ? suggestTensorCollectionUrl(collectionMint) : null

  const row = await upsertMarketplaceReadinessForLaunch(launch.id, {
    collection_mint: collectionMint || null,
    candy_machine_id: launch.candy_machine_id,
    hash_list_text: hashListText || null,
    hash_list_url: `/api/owl-center/collections/${launch.slug}/hash-list`,
    magic_eden_url: meUrl,
    tensor_url: tensorUrl,
    metadata_status: 'READY_FOR_INDEXING',
    magic_eden_status: 'READY_FOR_INDEXING',
    tensor_status: 'READY_FOR_INDEXING',
    sellout_prepared_at: new Date().toISOString(),
    notes: [
      `Sell-out prep ${new Date().toISOString()}`,
      `${mints.length} mint(s) in hash list.`,
      'Submit hash list at Magic Eden creator hub, then mark LISTED in admin.',
    ].join(' '),
  })

  if (!row) {
    return { ok: false, reason: 'marketplace_upsert_failed' }
  }

  await syncLaunchMarketplaceFieldsFromRow(launch.id, row)

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launch.id,
    message: `SELL_OUT marketplace prep · ${mints.length} mint(s) · hash list ready · ME=${meUrl ?? '—'}`,
    event_type: 'system',
  })

  return {
    ok: true,
    mint_count: mints.length,
    magic_eden_url: meUrl,
    tensor_url: tensorUrl,
    hash_list_download_path: `/api/owl-center/collections/${launch.slug}/hash-list`,
  }
}
