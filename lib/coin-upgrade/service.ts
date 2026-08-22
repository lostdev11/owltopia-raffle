import { StakingUserError } from '@/lib/nesting/errors'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { dasAssetBelongsToCollection } from '@/lib/helius/das-asset-collection'
import {
  CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS,
  LEGACY_OWL_NEST_COLLECTION_ADDRESS,
  resolveWalletOwlNestCollectionAddress,
} from '@/lib/nesting/owl-nest-collection'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import {
  getCoinArtUpgradeFeeSol,
  isCoinArtUpgradeEnabled,
  MAX_COIN_ART_UPGRADES_PER_REQUEST,
} from '@/lib/coin-upgrade/config'
import { verifyCoinArtUpgradeFeeTransaction } from '@/lib/coin-upgrade/verify-payment'
import { updateCoinAssetUriOnChain } from '@/lib/coin-upgrade/core-update'
import { applyCoinArtUpgradeRewardBoost } from '@/lib/coin-upgrade/reward-boost'
import {
  appendCoinArtUpgradePaymentAssetIds,
  getCoinArtUpgradePaymentBySignature,
  insertCoinArtUpgradePayment,
  insertCoinArtUpgradeRow,
  listCoinArtUpgradeCatalogEntries,
  listCoinArtUpgradesByAssetIds,
  listCoinArtUpgradesNeedingRepair,
  patchCoinArtUpgradeRow,
  countCoinArtUpgradeCatalogEntries,
  type CoinArtUpgradeRow,
} from '@/lib/db/coin-art-upgrades'

export function coinUpgradeCollectionCandidates(): string[] {
  const out: string[] = []
  const add = (addr: string | null | undefined) => {
    const t = addr?.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  add(resolveWalletOwlNestCollectionAddress())
  add(CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS)
  add(LEGACY_OWL_NEST_COLLECTION_ADDRESS)
  return out
}

type HeliusAssetResult = {
  id?: string
  ownership?: { owner?: string }
  grouping?: Array<{ group_key?: string; group_value?: string }>
}

/**
 * Holder must own the coin and it must be an Owltopia coin. Nested coins pass —
 * the FreezeDelegate lock is non-custodial, so DAS ownership stays with the holder.
 */
async function assertCoinOwnedByWallet(assetId: string, ownerWallet: string): Promise<void> {
  const heliusUrl = getHeliusMainnetRpcUrl()
  if (!heliusUrl) {
    throw new StakingUserError('HELIUS_API_KEY is required for coin art upgrade checks.', 503)
  }

  const res = await fetch(heliusUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'coin-art-upgrade-ownership',
      method: 'getAsset',
      params: { id: assetId },
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new StakingUserError(`Unable to verify coin ownership (Helius status ${res.status}).`, 502)
  }

  const json = (await res.json().catch(() => null)) as
    | { result?: HeliusAssetResult; error?: { message?: string } }
    | null
  if (!json || json.error || !json.result) {
    throw new StakingUserError(
      `Unable to read coin ownership${json?.error?.message ? `: ${json.error.message}` : ''}.`,
      502
    )
  }

  const owner = json.result.ownership?.owner?.trim() || ''
  if (!owner || owner !== ownerWallet.trim()) {
    throw new StakingUserError('That coin is not in your connected wallet.', 400)
  }

  const inCollection = coinUpgradeCollectionCandidates().some((key) =>
    dasAssetBelongsToCollection(json.result, key)
  )
  if (!inCollection) {
    throw new StakingUserError('That NFT is not an Owltopia coin.', 400)
  }
}

/**
 * Core URI update + reward boost for a paid upgrade row. Payment is already
 * recorded, so failures here are always recoverable (repair cron / retry).
 */
export async function processCoinArtUpgradeRow(row: CoinArtUpgradeRow): Promise<CoinArtUpgradeRow> {
  let current = row
  if (current.status !== 'updated') {
    try {
      const res = await updateCoinAssetUriOnChain({ assetId: current.asset_id, newUri: current.new_uri })
      current = await patchCoinArtUpgradeRow(current.asset_id, {
        status: 'updated',
        previous_uri: current.previous_uri ?? (res.previousUri || null),
        update_tx_signature: res.signature ?? current.update_tx_signature,
        upgraded_at: current.upgraded_at ?? new Date().toISOString(),
        last_error: null,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Coin art update failed.'
      await patchCoinArtUpgradeRow(current.asset_id, { status: 'failed', last_error: message }).catch(() => {})
      throw e
    }
  }
  return applyCoinArtUpgradeRewardBoost(current)
}

export type CoinArtUpgradeExecutionResult = {
  upgraded: CoinArtUpgradeRow[]
  /** Paid but the on-chain update failed — the repair cron completes these automatically. */
  pending: Array<{ asset_id: string; error: string }>
}

export async function executeCoinArtUpgrade(params: {
  wallet: string
  rawAssetIds: unknown
  paymentSignature: unknown
}): Promise<CoinArtUpgradeExecutionResult> {
  if (!isCoinArtUpgradeEnabled()) {
    throw new StakingUserError('Coin art upgrades are not open yet.', 403)
  }

  const catalogSize = await countCoinArtUpgradeCatalogEntries()
  if (catalogSize < 1) {
    throw new StakingUserError(
      'New coin art is still being prepared. Upgrades open once the catalog is live.',
      403
    )
  }

  const wallet = params.wallet.trim()
  const assetIds = Array.isArray(params.rawAssetIds)
    ? [...new Set(params.rawAssetIds.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))]
    : []
  if (assetIds.length === 0) {
    throw new StakingUserError('Pick at least one coin to upgrade.', 400)
  }
  if (assetIds.length > MAX_COIN_ART_UPGRADES_PER_REQUEST) {
    throw new StakingUserError(
      `Upgrade at most ${MAX_COIN_ART_UPGRADES_PER_REQUEST} coins per request.`,
      400
    )
  }

  const [catalogEntries, existingRows] = await Promise.all([
    listCoinArtUpgradeCatalogEntries(assetIds),
    listCoinArtUpgradesByAssetIds(assetIds),
  ])

  const catalogByAsset = new Map(catalogEntries.map((e) => [e.asset_id, e]))
  const missingArt = assetIds.filter((id) => !catalogByAsset.has(id))
  if (missingArt.length > 0) {
    throw new StakingUserError(
      'New art is not available for some of those coins yet. Try again after the art drop.',
      400,
      { asset_ids: missingArt }
    )
  }

  const existingByAsset = new Map(existingRows.map((r) => [r.asset_id, r]))
  for (const row of existingRows) {
    if (row.wallet_address.trim() !== wallet) {
      throw new StakingUserError(
        'One of those coins was already upgraded from a different wallet.',
        400,
        { asset_id: row.asset_id }
      )
    }
  }

  const needPayment = assetIds.filter((id) => !existingByAsset.has(id))

  // New upgrades require current ownership; retries of already-paid rows always
  // complete regardless (the art follows the coin).
  for (const assetId of needPayment) {
    await assertCoinOwnedByWallet(assetId, wallet)
  }

  if (needPayment.length > 0) {
    const treasury = getPlatformFeeTreasuryWalletAddress()
    if (!treasury) {
      throw new StakingUserError('Platform fee treasury is not configured.', 503)
    }

    const signature = typeof params.paymentSignature === 'string' ? params.paymentSignature.trim() : ''
    if (!signature) {
      throw new StakingUserError(
        `Upgrade fee required: ${getCoinArtUpgradeFeeSol()} SOL per coin. Approve the fee in your wallet and try again.`,
        400
      )
    }

    const existingPayment = await getCoinArtUpgradePaymentBySignature(signature)
    if (existingPayment) {
      if (existingPayment.wallet_address !== wallet) {
        throw new StakingUserError('That upgrade fee transaction belongs to a different wallet.', 400)
      }
      const linked = new Set(existingPayment.asset_ids)
      const toLink = needPayment.filter((id) => !linked.has(id))
      if (linked.size + toLink.length > existingPayment.units) {
        throw new StakingUserError(
          `This fee payment covers ${existingPayment.units} coin(s) and ${linked.size} are already linked. Send a new fee transaction.`,
          400
        )
      }
      if (toLink.length > 0) {
        await appendCoinArtUpgradePaymentAssetIds(signature, toLink)
      }
    } else {
      const verified = await verifyCoinArtUpgradeFeeTransaction({
        signature,
        fromWallet: wallet,
        treasuryWallet: treasury,
        minUnits: needPayment.length,
      })
      if (!verified.ok) {
        throw new StakingUserError(verified.error, 400)
      }
      await insertCoinArtUpgradePayment({
        tx_signature: signature,
        wallet_address: wallet,
        units: verified.units,
        lamports: verified.lamports,
        asset_ids: needPayment,
      })
    }

    // Payment is recorded — from here on every failure is repairable, never re-charged.
    for (const assetId of needPayment) {
      const catalog = catalogByAsset.get(assetId)!
      const inserted = await insertCoinArtUpgradeRow({
        asset_id: assetId,
        wallet_address: wallet,
        payment_tx_signature: signature,
        new_uri: catalog.new_uri,
      })
      existingByAsset.set(assetId, inserted)
    }
  }

  const upgraded: CoinArtUpgradeRow[] = []
  const pending: Array<{ asset_id: string; error: string }> = []
  for (const assetId of assetIds) {
    const row = existingByAsset.get(assetId)
    if (!row) continue
    try {
      upgraded.push(await processCoinArtUpgradeRow(row))
    } catch (e) {
      pending.push({
        asset_id: assetId,
        error: e instanceof Error ? e.message : 'Coin art update failed.',
      })
    }
  }

  return { upgraded, pending }
}

export type CoinArtUpgradeRepairSummary = {
  scanned: number
  updated: number
  boosted: number
  failed: Array<{ asset_id: string; error: string }>
}

/** Cron sweep: finish paid-but-not-updated rows and unapplied reward boosts. */
export async function repairCoinArtUpgrades(limit = 10): Promise<CoinArtUpgradeRepairSummary> {
  const rows = await listCoinArtUpgradesNeedingRepair(limit)
  const summary: CoinArtUpgradeRepairSummary = { scanned: rows.length, updated: 0, boosted: 0, failed: [] }

  for (const row of rows) {
    const wasUpdated = row.status === 'updated'
    const hadBoost = Boolean(row.reward_boost_applied_at)
    try {
      const result = await processCoinArtUpgradeRow(row)
      if (!wasUpdated && result.status === 'updated') summary.updated += 1
      if (!hadBoost && result.reward_boost_applied_at) summary.boosted += 1
    } catch (e) {
      summary.failed.push({
        asset_id: row.asset_id,
        error: e instanceof Error ? e.message : 'repair failed',
      })
    }
  }

  return summary
}
