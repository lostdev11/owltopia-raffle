import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  getActivePositionByAssetIdentifier,
  markPositionUnstaked,
} from '@/lib/db/staking-positions'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { listSupportNestMintAddressesInWallet } from '@/lib/nesting/support-nest-pools'

const CROSS_WALLET_CLEARED_REF = 'support_prior_wallet_holder_cleared'

export type ClearCrossWalletStaleNestResult = {
  positionId: string
  asset_identifier: string | null
  prior_wallet: string
  cleared: boolean
}

/**
 * Closes open nest rows on *other* wallets when the NFT is currently owned by `holderWallet`
 * (common after wallet migration / transfer without unstaking).
 */
export async function clearCrossWalletStaleNestsForHolder(
  holderWallet: string,
  assetMints: string[]
): Promise<{ results: ClearCrossWalletStaleNestResult[]; cleared_count: number }> {
  const wallet = holderWallet.trim()
  const mints = [...new Set(assetMints.map((m) => m.trim()).filter(Boolean))]
  if (!wallet || mints.length === 0) {
    return { results: [], cleared_count: 0 }
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('*')
    .in('asset_identifier', mints)
    .in('status', ['active', 'pending'])
    .neq('wallet_address', wallet)

  if (error) throw new Error(error.message)

  const results: ClearCrossWalletStaleNestResult[] = []
  let clearedCount = 0

  for (const row of (data ?? []) as StakingPositionRow[]) {
    const priorWallet = row.wallet_address.trim()
    const base = {
      positionId: row.id,
      asset_identifier: row.asset_identifier,
      prior_wallet: priorWallet,
      cleared: false as const,
    }

    await markPositionUnstaked(row.id, priorWallet, {
      sync_status: 'confirmed',
      last_synced_at: new Date().toISOString(),
      last_transaction_error: null,
      external_reference: CROSS_WALLET_CLEARED_REF,
    })
    results.push({ ...base, cleared: true })
    clearedCount += 1
  }

  return { results, cleared_count: clearedCount }
}

/**
 * Nest NFT mints currently held by `wallet` across Owltopia coins + Gen 1 + Gen 2
 * (Helius DAS; empty when indexer unavailable).
 */
export async function listOwlNestMintAddressesInWallet(wallet: string): Promise<string[]> {
  const scanned = await listSupportNestMintAddressesInWallet(wallet)
  return scanned.mints
}

export type ClearCrossWalletStaleNestsForWalletResult = {
  results: ClearCrossWalletStaleNestResult[]
  cleared_count: number
  skipped_reason?: 'helius_unconfigured' | 'pool_not_found' | 'no_mints_in_wallet'
}

/**
 * Wallet heal pass: close open nest rows on other addresses when this wallet currently holds the NFT
 * (secondary sale / wallet migration without unstaking).
 */
export async function clearCrossWalletStaleNestsForWallet(
  wallet: string
): Promise<ClearCrossWalletStaleNestsForWalletResult> {
  const holder = wallet.trim()
  if (!holder) {
    return { results: [], cleared_count: 0, skipped_reason: 'no_mints_in_wallet' }
  }

  if (!getHeliusMainnetRpcUrl()) {
    return { results: [], cleared_count: 0, skipped_reason: 'helius_unconfigured' }
  }

  const scanned = await listSupportNestMintAddressesInWallet(holder)
  if (scanned.skipped_reason === 'no_pools') {
    return { results: [], cleared_count: 0, skipped_reason: 'pool_not_found' }
  }
  if (scanned.mints.length === 0) {
    return { results: [], cleared_count: 0, skipped_reason: 'no_mints_in_wallet' }
  }

  return clearCrossWalletStaleNestsForHolder(holder, scanned.mints)
}

async function readAssetOwnerFromHelius(heliusUrl: string, assetId: string): Promise<string | null> {
  const res = await fetch(heliusUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'nesting-cross-wallet-owner',
      method: 'getAsset',
      params: { id: assetId.trim() },
    }),
    cache: 'no-store',
  })
  if (!res.ok) return null

  const json = (await res.json().catch(() => null)) as
    | { result?: { ownership?: { owner?: string } }; error?: unknown }
    | null
  if (!json?.result) return null
  const owner = json.result.ownership?.owner?.trim()
  return owner || null
}

export type TryClearCrossWalletBlockerResult = {
  cleared: boolean
  prior_wallet?: string
}

/**
 * Stake-time safety net: if another wallet's open row blocks this mint, clear it when Helius confirms
 * the current session wallet owns the NFT.
 */
export async function tryClearCrossWalletBlockerForMint(params: {
  holderWallet: string
  poolId: string
  assetMint: string
}): Promise<TryClearCrossWalletBlockerResult> {
  const holder = params.holderWallet.trim()
  const mint = params.assetMint.trim()
  if (!holder || !mint) return { cleared: false }

  const existing = await getActivePositionByAssetIdentifier(params.poolId, mint)
  if (!existing) return { cleared: false }

  const priorWallet = existing.wallet_address.trim()
  if (priorWallet === holder) return { cleared: false }

  const heliusUrl = getHeliusMainnetRpcUrl()
  if (!heliusUrl) return { cleared: false }

  const owner = await readAssetOwnerFromHelius(heliusUrl, mint)
  if (!owner || owner !== holder) return { cleared: false }

  await markPositionUnstaked(existing.id, priorWallet, {
    sync_status: 'confirmed',
    last_synced_at: new Date().toISOString(),
    last_transaction_error: null,
    external_reference: CROSS_WALLET_CLEARED_REF,
  })
  return { cleared: true, prior_wallet: priorWallet }
}
