import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  getAnyOpenStakingPositionByAssetIdentifier,
  patchStakingPosition,
} from '@/lib/db/staking-positions'
import { getCoinArtUpgradeRewardMultiplier } from '@/lib/coin-upgrade/config'
import { getCoinArtUpgradeByAssetId, patchCoinArtUpgradeRow, type CoinArtUpgradeRow } from '@/lib/db/coin-art-upgrades'

/**
 * Stake-time hook: upgraded coins snapshot `pool rate × multiplier` when a new
 * nest is opened. Any upgrade row counts — the holder has paid even if the
 * Core URI update is still retrying.
 */
export async function getCoinArtUpgradeRewardMultiplierForAsset(
  assetIdentifier: string | null | undefined
): Promise<number> {
  const assetId = assetIdentifier?.trim()
  if (!assetId) return 1
  try {
    const upgrade = await getCoinArtUpgradeByAssetId(assetId)
    return upgrade ? getCoinArtUpgradeRewardMultiplier() : 1
  } catch (e) {
    // Never block a stake on registry read problems; the repair cron re-applies boosts.
    console.error('[coin-upgrade] reward multiplier lookup failed:', e)
    return 1
  }
}

/**
 * Mid-nest boost for a coin upgraded while already nested.
 *
 * Accrual everywhere is `rate_snapshot × elapsed(staked_at → now) − claimed`, so a naive
 * snapshot bump would retroactively double past accrual. Instead we shift the accrual
 * anchor: `staked_at' = now − elapsed / multiplier` keeps accrued-to-date exactly equal
 * at the boost instant, then the position earns at the boosted rate from here on. Every
 * reader (claims, claim-all, UI cards, audits) stays correct with no math changes.
 * `unlock_at` is stored separately, so the 365-day lock end never moves; `created_at`
 * keeps the true nest-open time.
 */
export async function applyCoinArtUpgradeRewardBoost(upgrade: CoinArtUpgradeRow): Promise<CoinArtUpgradeRow> {
  if (upgrade.reward_boost_applied_at) return upgrade

  const multiplier = getCoinArtUpgradeRewardMultiplier()
  const nowIso = new Date().toISOString()

  if (multiplier <= 1) {
    return patchCoinArtUpgradeRow(upgrade.asset_id, { reward_boost_applied_at: nowIso })
  }

  const position = await getAnyOpenStakingPositionByAssetIdentifier(upgrade.asset_id)
  if (!position) {
    // Not nested right now — future stakes get the multiplier at insert time.
    return patchCoinArtUpgradeRow(upgrade.asset_id, { reward_boost_applied_at: nowIso })
  }

  const oldRate = Number(position.reward_rate_snapshot)
  if (!Number.isFinite(oldRate) || oldRate <= 0) {
    console.warn(
      `[coin-upgrade] position ${position.id} has non-positive rate snapshot; skipping mid-nest boost for ${upgrade.asset_id}.`
    )
    return patchCoinArtUpgradeRow(upgrade.asset_id, {
      reward_boost_applied_at: nowIso,
      reward_boost_position_id: position.id,
    })
  }

  const asOfMs = Date.now()
  const stakedAtMs = new Date(position.staked_at).getTime()
  const elapsedMs = Number.isFinite(stakedAtMs) ? Math.max(0, asOfMs - stakedAtMs) : 0
  const shiftedStakedAtIso = new Date(asOfMs - elapsedMs / multiplier).toISOString()
  const newRate = oldRate * multiplier

  await patchStakingPosition(position.id, {
    reward_rate_snapshot: newRate,
    staked_at: shiftedStakedAtIso,
  })

  // Audit trail: adjustments are informational (claims recompute from snapshots).
  const { error } = await getSupabaseAdmin().from('staking_reward_events').insert({
    position_id: position.id,
    wallet_address: position.wallet_address,
    event_type: 'adjustment',
    amount: 0,
    note: `coin_art_upgrade_boost: rate ${oldRate} -> ${newRate}, staked_at ${position.staked_at} -> ${shiftedStakedAtIso} (accrual-preserving shift)`,
  })
  if (error) {
    console.error('[coin-upgrade] failed to record boost adjustment event:', error.message)
  }

  return patchCoinArtUpgradeRow(upgrade.asset_id, {
    reward_boost_applied_at: nowIso,
    reward_boost_position_id: position.id,
  })
}
