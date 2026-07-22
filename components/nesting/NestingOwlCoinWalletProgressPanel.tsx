'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import {
  NestingOwlCoinWalletProgress,
  type NestingNotNestedAsset,
} from '@/components/nesting/NestingOwlCoinWalletProgress'
import {
  buildOwlCoinWalletStakeStats,
  poolIdsForNftWalletProgressStats,
  positionLockedPoolIdFromRows,
  resolveOwlCoinNftPoolId,
} from '@/lib/nesting/owl-coin-wallet-stake-stats'
import { nestingNftAssetLabels } from '@/lib/nesting/gen1-staking-pools'
import { findStakingPoolByIdOrSlug } from '@/lib/nesting/format'
import type { WalletNestMintNestStatus } from '@/lib/nesting/nft-stake-eligibility'

type MintScanRow = {
  mint: string
  name: string | null
  image: string | null
  nest_status: WalletNestMintNestStatus
}

type MintScanState = {
  status: 'idle' | 'loading' | 'done'
  mints: MintScanRow[]
  configured: boolean
}

type Props = {
  pools: { id: string; slug: string; asset_type: string }[]
  /** When set (e.g. dashboard `?pool=`), prefer this NFT perch. */
  preferredPoolId?: string | null
  /** When set (e.g. dashboard `?group=gen1-owl`), prefer this Gen 1 / Gen 2 group. */
  preferredGroupKey?: string | null
  /** Bumps when parent nest rows change so this panel stays in sync without a full page reload. */
  positionsVersion?: string | null
  /** Dashboard: open the owl picker / expand open-nest form instead of linking away. */
  onNestThese?: () => void
  className?: string
}

/**
 * Fetches wallet nest rows + eligible Owltopia coins, then renders the per-wallet progress bar.
 */
export function NestingOwlCoinWalletProgressPanel({
  pools,
  preferredPoolId = null,
  preferredGroupKey = null,
  positionsVersion = null,
  onNestThese,
  className,
}: Props) {
  const { connected, publicKey } = useWallet()
  const [positions, setPositions] = useState<StakingPositionRow[]>([])
  const [positionsLoaded, setPositionsLoaded] = useState(false)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [mintScan, setMintScan] = useState<MintScanState>({
    status: 'idle',
    mints: [],
    configured: true,
  })

  const lockedFromPositions = useMemo(
    () => positionLockedPoolIdFromRows(positions),
    [positions]
  )

  const poolId = useMemo(
    () =>
      resolveOwlCoinNftPoolId(pools, {
        preferredPoolId,
        preferredGroupKey,
        positionLockedPoolId: lockedFromPositions,
      }),
    [pools, preferredPoolId, preferredGroupKey, lockedFromPositions]
  )

  const activePool = useMemo(
    () => (poolId ? findStakingPoolByIdOrSlug(pools, poolId) : null),
    [pools, poolId]
  )

  const assetLabels = useMemo(() => nestingNftAssetLabels(activePool), [activePool])

  const statsPoolIds = useMemo(
    () => (poolId ? poolIdsForNftWalletProgressStats(pools, poolId) : []),
    [pools, poolId]
  )

  const loadPositions = useCallback(async () => {
    if (!connected || !publicKey) {
      setPositions([])
      setPositionsLoaded(false)
      setNeedsSignIn(false)
      return
    }
    const addr = publicKey.toBase58()
    setPositionsLoaded(false)
    try {
      const res = await fetch('/api/me/staking/positions?heal=0', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Connected-Wallet': addr },
      })
      if (res.status === 401) {
        setNeedsSignIn(true)
        setPositions([])
        setPositionsLoaded(true)
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPositions([])
        setNeedsSignIn(false)
        setPositionsLoaded(true)
        return
      }
      setNeedsSignIn(false)
      setPositions(Array.isArray(json.positions) ? json.positions : [])
      setPositionsLoaded(true)
    } catch {
      setPositions([])
      setNeedsSignIn(false)
      setPositionsLoaded(true)
    }
  }, [connected, publicKey])

  const loadWalletMints = useCallback(async () => {
    if (!connected || !publicKey || needsSignIn || !poolId) return
    const addr = publicKey.toBase58()
    setMintScan({ status: 'loading', mints: [], configured: true })
    try {
      const res = await fetch(
        `/api/me/nesting/wallet-owl-nest-nfts?pool_id=${encodeURIComponent(poolId)}`,
        {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'X-Connected-Wallet': addr },
        }
      )
      const raw = await res.json().catch(() => ({}))
      if (!res.ok || raw?.configured === false) {
        setMintScan({ status: 'done', mints: [], configured: raw?.configured !== false })
        return
      }
      const rows = Array.isArray(raw?.mints) ? raw.mints : []
      const mints: MintScanRow[] = rows
        .map((row: {
          mint?: unknown
          name?: unknown
          image?: unknown
          nest_status?: unknown
        }) => {
          const mint = typeof row.mint === 'string' ? row.mint.trim() : ''
          const nest_status: WalletNestMintNestStatus =
            row.nest_status === 'nested' ||
            row.nest_status === 'opening' ||
            row.nest_status === 'blocked' ||
            row.nest_status === 'not_nested'
              ? row.nest_status
              : 'not_nested'
          return {
            mint,
            name: typeof row.name === 'string' ? row.name : null,
            image: typeof row.image === 'string' ? row.image : null,
            nest_status,
          }
        })
        .filter((row: MintScanRow) => row.mint.length > 0)
      setMintScan({ status: 'done', mints, configured: true })
    } catch {
      setMintScan({ status: 'done', mints: [], configured: true })
    }
  }, [connected, publicKey, needsSignIn, poolId])

  useEffect(() => {
    void loadPositions()
  }, [loadPositions])

  useEffect(() => {
    if (!positionsVersion) return
    void loadPositions()
    setMintScan({ status: 'idle', mints: [], configured: true })
  }, [positionsVersion, loadPositions])

  useEffect(() => {
    setMintScan({ status: 'idle', mints: [], configured: true })
  }, [poolId])

  useEffect(() => {
    if (!positionsLoaded || needsSignIn || !poolId) return
    if (mintScan.status !== 'idle') return
    void loadWalletMints()
  }, [positionsLoaded, needsSignIn, poolId, mintScan.status, loadWalletMints])

  const notNestedAssets = useMemo((): NestingNotNestedAsset[] => {
    if (mintScan.status !== 'done' || !mintScan.configured) return []
    return mintScan.mints
      .filter((m) => m.nest_status === 'not_nested')
      .map((m) => ({ mint: m.mint, name: m.name, image: m.image }))
  }, [mintScan.status, mintScan.configured, mintScan.mints])

  const stats = useMemo(() => {
    if (!poolId) return null
    const scanDone = mintScan.status === 'done' && mintScan.configured
    // eligible = wallet mints that are not already counted as nested (keeps total = nested + eligible)
    const eligibleMintCount = scanDone
      ? mintScan.mints.filter((m) => m.nest_status !== 'nested').length
      : null
    return buildOwlCoinWalletStakeStats({
      poolId,
      poolIds: statsPoolIds,
      positions,
      eligibleMintCount,
      scanLoading: mintScan.status === 'loading',
    })
  }, [poolId, statsPoolIds, positions, mintScan.status, mintScan.configured, mintScan.mints])

  if (!connected || !publicKey || !poolId || !stats) return null

  if (needsSignIn) {
    return (
      <div className={className}>
        <NestingOwlCoinWalletProgress
          nestedCount={stats.nestedCount}
          totalCount={null}
          assetLabels={assetLabels}
          loading={false}
        />
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Connect and{' '}
          <Link href="/dashboard/nesting" className="font-medium text-theme-prime underline-offset-4 hover:underline">
            sign in on My nest
          </Link>{' '}
          to scan {assetLabels.plural} in your wallet.
        </p>
      </div>
    )
  }

  return (
    <NestingOwlCoinWalletProgress
      nestedCount={stats.nestedCount}
      totalCount={stats.totalCount}
      assetLabels={assetLabels}
      notNestedAssets={notNestedAssets}
      onNestThese={onNestThese}
      loading={stats.loading}
      className={className}
    />
  )
}
