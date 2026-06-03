import { getStakingPoolBySlug } from '@/lib/db/staking-pools'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  getActivePositionByAssetIdentifier,
  listStakingPositionsByWallet,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import { fetchWalletNftsInCollectionDas } from '@/lib/helius/fetch-wallet-nfts-in-collection'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { clearOrphanedActiveNftNestsForWallet } from '@/lib/nesting/clear-orphaned-active-nests'
import { clearOrphanedPendingNftNestsForWallet } from '@/lib/nesting/clear-orphaned-pending-nests'
import { clearCrossWalletStaleNestsForWallet } from '@/lib/nesting/clear-cross-wallet-stale-nests'
import {
  readOwlClaimNftNestLockEligibility,
} from '@/lib/nesting/nft-freeze'
import { positionRequiresOnChainNftFreezeLock } from '@/lib/nesting/nft-nest-onchain-lock'
import { resolveWalletOwlNestCollectionCandidates } from '@/lib/nesting/owl-nest-collection'
import { isPendingNftNestBeforeFreezeConfirmed } from '@/lib/nesting/position-lifecycle'
import { NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS, NESTING_DIAGNOSTIC_MAX_WALLET_MINT_CROSS_CHECKS } from '@/lib/nesting/rpc-policy'

const LOCK_SAMPLE_MAX = 8
const LOCK_RPC_CONCURRENCY = 4

export type DiagnoseNestingWalletOptions = {
  /** Cap per-active-nest MPL Core lock reads (default NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS). */
  maxActiveLockChecks?: number
  /** Skip redundant lock_samples RPC block (support playbook). */
  skipLockSamples?: boolean
  /** Cap per-mint DB cross-checks when wallet holds many NFTs. */
  maxWalletMintCrossChecks?: number
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export type NestingWalletIssueKind =
  | 'cross_wallet_blocker'
  | 'orphaned_active'
  | 'orphaned_pending'
  | 'owner_thawed_active'
  | 'ledger_active_onchain_locked'

export type NestingWalletIssue = {
  kind: NestingWalletIssueKind
  severity: 'high' | 'medium' | 'low'
  message: string
  asset_identifier?: string
  position_id?: string
  other_wallet?: string
  suggested_action: string
}

export type NestingWalletDiagnostics = {
  wallet: string
  helius_configured: boolean
  pool_slug: string
  wallet_nest_mint_count: number
  positions_under_wallet: {
    active: number
    pending: number
    unstaked: number
  }
  issues: NestingWalletIssue[]
  cross_wallet_rows: Array<{
    position_id: string
    prior_wallet: string
    asset_identifier: string
    status: string
  }>
  lock_samples: Array<{
    asset_identifier: string
    locked: boolean | null
    owner_thawed_eligible: boolean | null
  }>
}

async function listCrossWalletOpenRows(holderWallet: string, mints: string[]) {
  if (mints.length === 0) return []
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('id, wallet_address, asset_identifier, status')
    .in('asset_identifier', mints)
    .in('status', ['active', 'pending'])
    .neq('wallet_address', holderWallet.trim())

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function diagnoseNestingWallet(
  wallet: string,
  options: DiagnoseNestingWalletOptions = {}
): Promise<NestingWalletDiagnostics> {
  const holder = wallet.trim()
  const pool = await getStakingPoolBySlug('owl-nest-365')
  const issues: NestingWalletIssue[] = []

  const positions = await listStakingPositionsByWallet(holder)
  const byStatus = { active: 0, pending: 0, unstaked: 0 }
  let ghostActive = 0
  for (const p of positions) {
    if (p.status === 'active') {
      byStatus.active += 1
      if (!p.asset_identifier?.trim()) ghostActive += 1
    } else if (p.status === 'pending') byStatus.pending += 1
    else byStatus.unstaked += 1
  }

  if (ghostActive > 0) {
    issues.push({
      kind: 'ghost_active_nest',
      severity: 'medium',
      message: `${ghostActive} active nest row(s) have no mint in the ledger — they are skipped for Claim all until cleared.`,
      suggested_action: 'Run wallet heal (orphaned active only) or clear ghost rows in admin; do not use catch-up for unpaid OWL.',
    })
  }

  const heliusRpcUrl = getHeliusMainnetRpcUrl()
  let walletMints: string[] = []

  if (!pool || pool.asset_type !== 'nft') {
    issues.push({
      kind: 'orphaned_active',
      severity: 'high',
      message: 'Owl Nest 365 pool not found or not configured as NFT perch.',
      suggested_action: 'Check staking_pools in Supabase.',
    })
    return {
      wallet: holder,
      helius_configured: Boolean(heliusRpcUrl),
      pool_slug: 'owl-nest-365',
      wallet_nest_mint_count: 0,
      positions_under_wallet: byStatus,
      issues,
      cross_wallet_rows: [],
      lock_samples: [],
    }
  }

  if (!heliusRpcUrl) {
    issues.push({
      kind: 'orphaned_active',
      severity: 'medium',
      message: 'HELIUS_API_KEY missing — cannot compare wallet NFTs to cross-wallet ledger rows.',
      suggested_action: 'Set Helius env or query Supabase manually by asset_identifier.',
    })
  } else {
    const candidates = resolveWalletOwlNestCollectionCandidates(pool)
    const itemsByMint = new Map<string, true>()
    for (const candidate of candidates) {
      const batch = await fetchWalletNftsInCollectionDas(heliusRpcUrl, holder, candidate)
      for (const item of batch) {
        const id = item.id?.trim()
        if (id && item.burnt !== true) itemsByMint.set(id, true)
      }
    }
    walletMints = [...itemsByMint.keys()]
  }

  const crossRows = await listCrossWalletOpenRows(holder, walletMints)
  for (const row of crossRows) {
    const asset = String(row.asset_identifier ?? '').trim()
    const prior = String(row.wallet_address ?? '').trim()
    issues.push({
      kind: 'cross_wallet_blocker',
      severity: 'high',
      message: `NFT ${asset.slice(0, 8)}… is in this wallet but an open nest exists under ${prior.slice(0, 8)}….`,
      asset_identifier: asset,
      position_id: String(row.id),
      other_wallet: prior,
      suggested_action: 'Run heal with cross_wallet (clears stale rows on the prior wallet).',
    })
  }

  for (const position of positions) {
    if (position.status === 'pending' && isPendingNftNestBeforeFreezeConfirmed(position)) {
      const ref = (position.external_reference ?? '').trim()
      if (ref === 'awaiting_nft_freeze' && position.asset_identifier?.trim()) {
        issues.push({
          kind: 'orphaned_pending',
          severity: 'medium',
          message: `Pending nest never finished wallet freeze (${position.asset_identifier.slice(0, 8)}…).`,
          asset_identifier: position.asset_identifier,
          position_id: position.id,
          suggested_action: 'Heal: clear orphaned pending.',
        })
      }
    }
  }

  const lockCheckCap = Math.max(
    1,
    Math.min(
      options.maxActiveLockChecks ?? NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS,
      NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS
    )
  )
  const activeLockPositions = positions.filter(
    (p) => p.status === 'active' && positionRequiresOnChainNftFreezeLock(p, pool)
  )
  const positionsForLockRpc = activeLockPositions.slice(0, lockCheckCap)
  const lockChecksSkipped = Math.max(0, activeLockPositions.length - positionsForLockRpc.length)

  if (lockChecksSkipped > 0) {
    issues.push({
      kind: 'ledger_active_onchain_locked',
      severity: 'low',
      message: `On-chain lock scan sampled ${positionsForLockRpc.length} of ${activeLockPositions.length} active nest(s) to stay within RPC limits.`,
      suggested_action:
        'Use claim ledger audit for payout drift; re-run diagnostics on a single mint if one nest looks wrong.',
    })
  }

  const lockResults = await mapWithConcurrency(
    positionsForLockRpc,
    LOCK_RPC_CONCURRENCY,
    async (position) => {
      const assetId = position.asset_identifier!.trim()
      const lockState = await readOwlClaimNftNestLockEligibility({
        assetId,
        ownerWallet: holder,
        collectionMint: pool.collection_key,
      })
      return { position, assetId, lockState }
    }
  )

  for (const { position, assetId, lockState } of lockResults) {
    if (lockState?.ownerThawedEligible === true) {
      issues.push({
        kind: 'owner_thawed_active',
        severity: 'low',
        message: `Active nest with Owner-thawed coin (${assetId.slice(0, 8)}…) — claims may work; re-stake needs leave nest or ledger clear.`,
        asset_identifier: assetId,
        position_id: position.id,
        suggested_action: 'User can claim OWL, or heal active orphan if they need to re-open nest.',
      })
    } else if (!lockState?.locked) {
      issues.push({
        kind: 'orphaned_active',
        severity: 'high',
        message: `Active nest with no on-chain lock (${assetId.slice(0, 8)}…).`,
        asset_identifier: assetId,
        position_id: position.id,
        suggested_action: 'Heal: clear orphaned active.',
      })
    } else {
      issues.push({
        kind: 'ledger_active_onchain_locked',
        severity: 'low',
        message: `Nest OK on-chain (${assetId.slice(0, 8)}…).`,
        asset_identifier: assetId,
        position_id: position.id,
        suggested_action: 'No ledger fix needed for this coin.',
      })
    }
  }

  const mintCrossCap = Math.max(
    1,
    Math.min(
      options.maxWalletMintCrossChecks ?? NESTING_DIAGNOSTIC_MAX_WALLET_MINT_CROSS_CHECKS,
      NESTING_DIAGNOSTIC_MAX_WALLET_MINT_CROSS_CHECKS
    )
  )
  const mintsForCrossCheck = walletMints.slice(0, mintCrossCap)
  if (walletMints.length > mintsForCrossCheck.length) {
    issues.push({
      kind: 'ledger_active_onchain_locked',
      severity: 'low',
      message: `Cross-wallet mint scan sampled ${mintsForCrossCheck.length} of ${walletMints.length} Owl Nest coin(s) in wallet.`,
      suggested_action: 'Cross-wallet rows from Supabase are still listed when found.',
    })
  }

  for (const mint of mintsForCrossCheck) {
    const open = await getActivePositionByAssetIdentifier(pool.id, mint)
    if (
      open &&
      open.wallet_address.trim() !== holder &&
      !crossRows.some((r) => String(r.id) === open.id)
    ) {
      issues.push({
        kind: 'cross_wallet_blocker',
        severity: 'high',
        message: `Mint ${mint.slice(0, 8)}… blocked by open row on ${open.wallet_address.slice(0, 8)}….`,
        asset_identifier: mint,
        position_id: open.id,
        other_wallet: open.wallet_address,
        suggested_action: 'Heal: clear cross_wallet.',
      })
    }
  }

  const lock_samples: NestingWalletDiagnostics['lock_samples'] = []
  if (!options.skipLockSamples) {
    const sampleMints = walletMints.slice(0, LOCK_SAMPLE_MAX)
    for (const assetId of sampleMints) {
      const lockState = await readOwlClaimNftNestLockEligibility({
        assetId,
        ownerWallet: holder,
        collectionMint: pool.collection_key,
      })
      lock_samples.push({
        asset_identifier: assetId,
        locked: lockState?.locked ?? null,
        owner_thawed_eligible: lockState?.ownerThawedEligible ?? null,
      })
    }
  }

  return {
    wallet: holder,
    helius_configured: Boolean(heliusRpcUrl),
    pool_slug: pool.slug,
    wallet_nest_mint_count: walletMints.length,
    positions_under_wallet: byStatus,
    issues,
    cross_wallet_rows: crossRows.map((r) => ({
      position_id: String(r.id),
      prior_wallet: String(r.wallet_address),
      asset_identifier: String(r.asset_identifier ?? ''),
      status: String(r.status),
    })),
    lock_samples,
  }
}

export type HealHolderWalletNestsOptions = {
  clear_pending?: boolean
  clear_active?: boolean
  clear_cross_wallet?: boolean
}

export type HealHolderWalletNestsResult = {
  wallet: string
  cleared_pending_count: number
  cleared_active_count: number
  cleared_cross_wallet_count: number
  diagnostics_after?: NestingWalletDiagnostics
}

export async function healHolderWalletNests(
  wallet: string,
  options: HealHolderWalletNestsOptions = {}
): Promise<HealHolderWalletNestsResult> {
  const holder = wallet.trim()
  const clearPending = options.clear_pending !== false
  const clearActive = options.clear_active !== false
  const clearCross = options.clear_cross_wallet !== false

  let clearedPending = 0
  let clearedActive = 0
  let clearedCross = 0

  if (clearPending) {
    const r = await clearOrphanedPendingNftNestsForWallet(holder)
    clearedPending = r.cleared_count
  }
  if (clearActive) {
    const r = await clearOrphanedActiveNftNestsForWallet(holder)
    clearedActive = r.cleared_count
  }
  if (clearCross) {
    const r = await clearCrossWalletStaleNestsForWallet(holder)
    clearedCross = r.cleared_count
  }

  return {
    wallet: holder,
    cleared_pending_count: clearedPending,
    cleared_active_count: clearedActive,
    cleared_cross_wallet_count: clearedCross,
  }
}
