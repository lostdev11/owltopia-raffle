import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  listStakingPositionsByWallet,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { clearOrphanedActiveNftNestsForWallet } from '@/lib/nesting/clear-orphaned-active-nests'
import { clearOrphanedPendingNftNestsForWallet } from '@/lib/nesting/clear-orphaned-pending-nests'
import { clearCrossWalletStaleNestsForWallet } from '@/lib/nesting/clear-cross-wallet-stale-nests'
import { positionRequiresOnChainNftFreezeLock } from '@/lib/nesting/nft-nest-onchain-lock'
import { readNestLockEligibilityForPool } from '@/lib/nesting/nft-lock-service'
import {
  isNftNestPositionCountedAsNested,
  isPendingNftNestBeforeFreezeConfirmed,
} from '@/lib/nesting/position-lifecycle'
import {
  NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS,
  NESTING_DIAGNOSTIC_MAX_WALLET_MINT_CROSS_CHECKS,
} from '@/lib/nesting/rpc-policy'
import {
  listSupportNestMintAddressesInWallet,
  loadSupportNestPools,
  supportNestFamilyForPoolSlug,
  supportNestFamilyLabel,
  type SupportNestFamilyKey,
} from '@/lib/nesting/support-nest-pools'
import { OWL_NEST_365_SLUG } from '@/lib/nesting/owl-nest-365-stats'

const LOCK_SAMPLE_MAX = 8
const LOCK_RPC_CONCURRENCY = 4
const OPEN_ROWS_IN_CHUNK = 80

export type DiagnoseNestingWalletOptions = {
  /** Cap per-active-nest MPL Core / SPL lock reads (default NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS). */
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
  | 'ghost_active_nest'

export type NestingWalletIssue = {
  kind: NestingWalletIssueKind
  severity: 'high' | 'medium' | 'low'
  message: string
  asset_identifier?: string
  position_id?: string
  other_wallet?: string
  suggested_action: string
}

export type NestingWalletFamilyStats = {
  family: SupportNestFamilyKey
  label: string
  wallet_mint_count: number
  active: number
  pending: number
}

export type NestingWalletAssetNestStatus = 'nested' | 'not_nested' | 'opening' | 'cross_wallet'

export type NestingWalletNestAsset = {
  mint: string
  family: SupportNestFamilyKey
  nest_status: NestingWalletAssetNestStatus
  position_id?: string
  pool_slug?: string
  wallet_status?: 'active' | 'pending' | null
  cross_wallet?: { wallet: string; position_id: string; status: string } | null
}

export type NestingWalletDiagnostics = {
  wallet: string
  helius_configured: boolean
  /** @deprecated Prefer pool_slugs — kept for older admin UI. Primary coin perch when present. */
  pool_slug: string
  /** All NFT nest perches scanned (coins + Gen 1 + Gen 2). */
  pool_slugs: string[]
  wallet_nest_mint_count: number
  nest_families: NestingWalletFamilyStats[]
  /** Per-mint inventory: nested vs not nested (DB join; no per-mint lock RPC). */
  wallet_nest_assets: NestingWalletNestAsset[]
  positions_under_wallet: {
    active: number
    pending: number
    unstaked: number
    ghost_active: number
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

async function listOpenRowsForMints(mints: string[]) {
  if (mints.length === 0) return []
  const db = getSupabaseAdmin()
  const out: Array<{
    id: string
    wallet_address: string
    asset_identifier: string | null
    status: string
    pool_id: string
    external_reference: string | null
  }> = []
  for (let i = 0; i < mints.length; i += OPEN_ROWS_IN_CHUNK) {
    const chunk = mints.slice(i, i + OPEN_ROWS_IN_CHUNK)
    const { data, error } = await db
      .from('staking_positions')
      .select('id, wallet_address, asset_identifier, status, pool_id, external_reference')
      .in('asset_identifier', chunk)
      .in('status', ['active', 'pending'])
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      out.push(row as (typeof out)[number])
    }
  }
  return out
}

function emptyFamilyStats(
  mintCounts: Record<SupportNestFamilyKey, number>
): NestingWalletFamilyStats[] {
  const keys: SupportNestFamilyKey[] = ['owl-nest-coins', 'gen1-owl', 'gen2-owl']
  return keys.map((family) => ({
    family,
    label: supportNestFamilyLabel(family),
    wallet_mint_count: mintCounts[family] ?? 0,
    active: 0,
    pending: 0,
  }))
}

function buildFamilyStats(
  positions: StakingPositionRow[],
  poolById: Map<string, StakingPoolRow>,
  mintCounts: Record<SupportNestFamilyKey, number>
): NestingWalletFamilyStats[] {
  const stats = new Map<SupportNestFamilyKey, NestingWalletFamilyStats>()
  for (const row of emptyFamilyStats(mintCounts)) {
    stats.set(row.family, row)
  }

  for (const position of positions) {
    if (position.status !== 'active' && position.status !== 'pending') continue
    const pool = poolById.get(position.pool_id)
    const family = supportNestFamilyForPoolSlug(pool?.slug)
    if (!family) continue
    const row = stats.get(family)!
    if (position.status === 'active') row.active += 1
    else row.pending += 1
  }

  return [...stats.values()]
}

function buildWalletNestAssets(params: {
  mintAssets: Array<{ mint: string; family: SupportNestFamilyKey }>
  holder: string
  openRows: Awaited<ReturnType<typeof listOpenRowsForMints>>
  poolById: Map<string, StakingPoolRow>
}): NestingWalletNestAsset[] {
  const openByMint = new Map<string, (typeof params.openRows)[number]>()
  for (const row of params.openRows) {
    const mint = String(row.asset_identifier ?? '').trim()
    if (!mint || openByMint.has(mint)) continue
    openByMint.set(mint, row)
  }

  const assets: NestingWalletNestAsset[] = []
  for (const { mint, family } of params.mintAssets) {
    const open = openByMint.get(mint)
    if (!open) {
      assets.push({ mint, family, nest_status: 'not_nested', wallet_status: null, cross_wallet: null })
      continue
    }
    const prior = String(open.wallet_address ?? '').trim()
    const pool = params.poolById.get(open.pool_id)
    const status = open.status === 'active' || open.status === 'pending' ? open.status : null
    if (prior && prior !== params.holder) {
      assets.push({
        mint,
        family,
        nest_status: 'cross_wallet',
        position_id: String(open.id),
        pool_slug: pool?.slug,
        wallet_status: status,
        cross_wallet: {
          wallet: prior,
          position_id: String(open.id),
          status: String(open.status),
        },
      })
      continue
    }
    const refPos = {
      status: open.status as StakingPositionRow['status'],
      external_reference: open.external_reference,
    }
    const nest_status: NestingWalletAssetNestStatus = isNftNestPositionCountedAsNested(refPos)
      ? 'nested'
      : isPendingNftNestBeforeFreezeConfirmed(refPos)
        ? 'opening'
        : 'nested'
    assets.push({
      mint,
      family,
      nest_status,
      position_id: String(open.id),
      pool_slug: pool?.slug,
      wallet_status: status,
      cross_wallet: null,
    })
  }

  assets.sort((a, b) => {
    const order = { not_nested: 0, opening: 1, cross_wallet: 2, nested: 3 }
    const d = order[a.nest_status] - order[b.nest_status]
    if (d !== 0) return d
    return a.mint.localeCompare(b.mint)
  })
  return assets
}

export async function diagnoseNestingWallet(
  wallet: string,
  options: DiagnoseNestingWalletOptions = {}
): Promise<NestingWalletDiagnostics> {
  const holder = wallet.trim()
  const issues: NestingWalletIssue[] = []
  const pools = await loadSupportNestPools()
  const poolById = new Map(pools.map((p) => [p.id, p]))
  const poolSlugs = pools.map((p) => p.slug)

  const positions = await listStakingPositionsByWallet(holder)
  // Also resolve pools for positions that may sit on a perch not in the support slug list
  // (legacy / partner) so lock checks still use the correct pool row.
  const missingPoolIds = [
    ...new Set(
      positions
        .map((p) => p.pool_id)
        .filter((id) => id && !poolById.has(id))
    ),
  ]
  if (missingPoolIds.length > 0) {
    const db = getSupabaseAdmin()
    const { data } = await db.from('staking_pools').select('*').in('id', missingPoolIds)
    for (const row of (data ?? []) as StakingPoolRow[]) {
      poolById.set(row.id, row)
    }
  }

  const byStatus = { active: 0, pending: 0, unstaked: 0, ghost_active: 0 }
  let ghostActive = 0
  for (const p of positions) {
    if (p.status === 'active') {
      byStatus.active += 1
      if (!p.asset_identifier?.trim()) {
        ghostActive += 1
        byStatus.ghost_active += 1
      }
    } else if (p.status === 'pending') byStatus.pending += 1
    else byStatus.unstaked += 1
  }

  if (ghostActive > 0) {
    issues.push({
      kind: 'ghost_active_nest',
      severity: 'medium',
      message: `${ghostActive} active nest row(s) have no mint in the ledger — they are skipped for Claim all until cleared.`,
      suggested_action:
        'Admin: Clear ghost actives only (one click). Does not close real nests or remove claimable OWL.',
    })
  }

  const heliusRpcUrl = getHeliusMainnetRpcUrl()
  let walletMints: string[] = []
  let mintAssets: Array<{ mint: string; family: SupportNestFamilyKey }> = []
  let mintCountsByFamily: Record<SupportNestFamilyKey, number> = {
    'owl-nest-coins': 0,
    'gen1-owl': 0,
    'gen2-owl': 0,
  }

  if (pools.length === 0) {
    issues.push({
      kind: 'orphaned_active',
      severity: 'high',
      message: 'No support nest pools found (owl-nest-365 / gen1-owl-* / gen2-owl-*).',
      suggested_action: 'Check staking_pools in Supabase and Gen 1 / Gen 2 migrations.',
    })
    return {
      wallet: holder,
      helius_configured: Boolean(heliusRpcUrl),
      pool_slug: OWL_NEST_365_SLUG,
      pool_slugs: [],
      wallet_nest_mint_count: 0,
      nest_families: emptyFamilyStats(mintCountsByFamily),
      wallet_nest_assets: [],
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
      message:
        'HELIUS_API_KEY missing — cannot compare wallet NFTs (coins / Gen 1 / Gen 2) to cross-wallet ledger rows.',
      suggested_action: 'Set Helius env or query Supabase manually by asset_identifier.',
    })
  } else {
    const scanned = await listSupportNestMintAddressesInWallet(holder)
    walletMints = scanned.mints
    mintAssets = scanned.mint_assets
    mintCountsByFamily = scanned.mint_counts_by_family
  }

  const nest_families = buildFamilyStats(positions, poolById, mintCountsByFamily)

  // Full wallet mint inventory join (DB only — no lock RPC).
  const allOpenRows = await listOpenRowsForMints(walletMints)
  // Ensure pool rows for open positions on other wallets / missing support list.
  const openPoolIds = [
    ...new Set(allOpenRows.map((r) => r.pool_id).filter((id) => id && !poolById.has(id))),
  ]
  if (openPoolIds.length > 0) {
    const db = getSupabaseAdmin()
    const { data } = await db.from('staking_pools').select('*').in('id', openPoolIds)
    for (const row of (data ?? []) as StakingPoolRow[]) {
      poolById.set(row.id, row)
    }
  }
  const wallet_nest_assets = buildWalletNestAssets({
    mintAssets,
    holder,
    openRows: allOpenRows,
    poolById,
  })

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
        const pool = poolById.get(position.pool_id)
        const family = supportNestFamilyForPoolSlug(pool?.slug)
        const label = family ? supportNestFamilyLabel(family) : 'NFT'
        issues.push({
          kind: 'orphaned_pending',
          severity: 'medium',
          message: `Pending ${label} nest never finished wallet freeze (${position.asset_identifier.slice(0, 8)}…).`,
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
  const activeLockPositions = positions.filter((p) => {
    const pool = poolById.get(p.pool_id)
    return pool != null && positionRequiresOnChainNftFreezeLock(p, pool)
  })
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
      const pool = poolById.get(position.pool_id)!
      const lockState = await readNestLockEligibilityForPool({
        pool,
        assetId,
        ownerWallet: holder,
        collectionMint: pool.collection_key,
      })
      return { position, assetId, pool, lockState }
    }
  )

  for (const { position, assetId, pool, lockState } of lockResults) {
    const family = supportNestFamilyForPoolSlug(pool.slug)
    const assetLabel = family ? supportNestFamilyLabel(family).replace(/s$/, '') : 'NFT'

    if (lockState?.ownerThawedEligible === true) {
      issues.push({
        kind: 'owner_thawed_active',
        severity: 'low',
        message: `Active nest with Owner-thawed ${assetLabel} (${assetId.slice(0, 8)}…) — claims may work; re-stake needs leave nest or ledger clear.`,
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
        suggested_action: 'No ledger fix needed for this NFT.',
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
      message: `Cross-wallet mint scan sampled ${mintsForCrossCheck.length} of ${walletMints.length} nest NFT(s) in wallet (coins + Gen 1 + Gen 2).`,
      suggested_action: 'Cross-wallet rows from Supabase are still listed when found.',
    })
  }

  const openByMint = allOpenRows.filter((open) =>
    mintsForCrossCheck.includes(String(open.asset_identifier ?? '').trim())
  )
  for (const open of openByMint) {
    const mint = String(open.asset_identifier ?? '').trim()
    const prior = String(open.wallet_address ?? '').trim()
    if (!mint || prior === holder) continue
    if (crossRows.some((r) => String(r.id) === String(open.id))) continue
    issues.push({
      kind: 'cross_wallet_blocker',
      severity: 'high',
      message: `Mint ${mint.slice(0, 8)}… blocked by open row on ${prior.slice(0, 8)}….`,
      asset_identifier: mint,
      position_id: String(open.id),
      other_wallet: prior,
      suggested_action: 'Heal: clear cross_wallet.',
    })
  }

  const lock_samples: NestingWalletDiagnostics['lock_samples'] = []
  if (!options.skipLockSamples) {
    const samplePositions = positions
      .filter((p) => p.status === 'active' && p.asset_identifier?.trim())
      .slice(0, LOCK_SAMPLE_MAX)
    for (const position of samplePositions) {
      const assetId = position.asset_identifier!.trim()
      const pool = poolById.get(position.pool_id)
      if (!pool) continue
      const lockState = await readNestLockEligibilityForPool({
        pool,
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
    pool_slug: poolSlugs.includes(OWL_NEST_365_SLUG) ? OWL_NEST_365_SLUG : poolSlugs[0] ?? OWL_NEST_365_SLUG,
    pool_slugs: poolSlugs,
    wallet_nest_mint_count: walletMints.length,
    nest_families,
    wallet_nest_assets,
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
