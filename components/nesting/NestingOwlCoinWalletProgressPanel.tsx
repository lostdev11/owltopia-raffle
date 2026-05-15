'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { NestingOwlCoinWalletProgress } from '@/components/nesting/NestingOwlCoinWalletProgress'
import {
  buildOwlCoinWalletStakeStats,
  positionLockedPoolIdFromRows,
  resolveOwlCoinNftPoolId,
} from '@/lib/nesting/owl-coin-wallet-stake-stats'

type MintScanState = {
  status: 'idle' | 'loading' | 'done'
  mints: { mint: string }[]
  configured: boolean
}

type Props = {
  pools: { id: string; asset_type: string }[]
  /** When set (e.g. dashboard `?pool=`), prefer this NFT perch. */
  preferredPoolId?: string | null
  className?: string
}

/**
 * Fetches wallet nest rows + eligible Owltopia coins, then renders the per-wallet progress bar.
 */
export function NestingOwlCoinWalletProgressPanel({
  pools,
  preferredPoolId = null,
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
        positionLockedPoolId: lockedFromPositions,
      }),
    [pools, preferredPoolId, lockedFromPositions]
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
      const res = await fetch('/api/me/staking/positions', {
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
      const mints = rows
        .map((row: { mint?: unknown }) => ({
          mint: typeof row.mint === 'string' ? row.mint.trim() : '',
        }))
        .filter((row: { mint: string }) => row.mint.length > 0)
      setMintScan({ status: 'done', mints, configured: true })
    } catch {
      setMintScan({ status: 'done', mints: [], configured: true })
    }
  }, [connected, publicKey, needsSignIn, poolId])

  useEffect(() => {
    void loadPositions()
  }, [loadPositions])

  useEffect(() => {
    setMintScan({ status: 'idle', mints: [], configured: true })
  }, [poolId])

  useEffect(() => {
    if (!positionsLoaded || needsSignIn || !poolId) return
    if (mintScan.status !== 'idle') return
    void loadWalletMints()
  }, [positionsLoaded, needsSignIn, poolId, mintScan.status, loadWalletMints])

  const stats = useMemo(() => {
    if (!poolId) return null
    const scanDone = mintScan.status === 'done' && mintScan.configured
    return buildOwlCoinWalletStakeStats({
      poolId,
      positions,
      eligibleMintCount: scanDone ? mintScan.mints.length : null,
      scanLoading: mintScan.status === 'loading',
    })
  }, [poolId, positions, mintScan.status, mintScan.configured, mintScan.mints.length])

  if (!connected || !publicKey || !poolId || !stats) return null

  if (needsSignIn) {
    return (
      <div className={className}>
        <NestingOwlCoinWalletProgress
          nestedCount={stats.nestedCount}
          totalCount={null}
          loading={false}
        />
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Connect and{' '}
          <Link href="/dashboard/nesting" className="font-medium text-theme-prime underline-offset-4 hover:underline">
            sign in on My nest
          </Link>{' '}
          to scan Owltopia coins in your wallet.
        </p>
      </div>
    )
  }

  return (
    <NestingOwlCoinWalletProgress
      nestedCount={stats.nestedCount}
      totalCount={stats.totalCount}
      loading={stats.loading}
      className={className}
    />
  )
}
