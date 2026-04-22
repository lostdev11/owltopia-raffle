'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import {
  Loader2,
  Egg,
  LayoutDashboard,
  ArrowLeft,
  RefreshCw,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { estimateClaimableRewards } from '@/lib/staking/rewards'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import { PositionCard } from '@/components/nesting/PositionCard'
import { SectionHeader } from '@/components/council/SectionHeader'
import { EmptyState } from '@/components/council/EmptyState'
import { runNestingTxAction } from '@/lib/nesting/run-tx-action'
import { nestingTxPhaseLabel, type NestingTxPhase } from '@/lib/nesting/tx-states'
import { NestingActionStatusLine } from '@/components/nesting/NestingActionStatusLine'
import { NestingSecurityNotice } from '@/components/nesting/NestingSecurityNotice'
import { NESTING_SECURITY_ACK_STORAGE_KEY } from '@/lib/nesting/security-notice-content'
import { nestingMutedActionButtonClass } from '@/lib/nesting/ui-classes'
import { cn, isMobileDevice } from '@/lib/utils'

const MOBILE_401_RETRY_MS = 800

export function DashboardNestingClient() {
  const { publicKey, connected, signMessage } = useWallet()
  const { setVisible } = useWalletModal()
  const searchParams = useSearchParams()
  const preselectedPoolId = searchParams.get('pool')

  const [pools, setPools] = useState<StakingPoolRow[]>([])
  const [positions, setPositions] = useState<StakingPositionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [stakePoolId, setStakePoolId] = useState('')
  const [stakeAmount, setStakeAmount] = useState('')
  const [stakeAssetId, setStakeAssetId] = useState('')
  const [stakeTxPhase, setStakeTxPhase] = useState<NestingTxPhase>('idle')
  const [posPhases, setPosPhases] = useState<
    Record<string, { claim: NestingTxPhase; unstake: NestingTxPhase }>
  >({})
  const [securityAck, setSecurityAck] = useState(false)

  const setPosSubPhase = useCallback((id: string, key: 'claim' | 'unstake', phase: NestingTxPhase) => {
    setPosPhases((m) => {
      const cur = m[id] ?? {
        claim: 'idle' as NestingTxPhase,
        unstake: 'idle' as NestingTxPhase,
      }
      return { ...m, [id]: { ...cur, [key]: phase } }
    })
  }, [])

  const walletAddr = publicKey?.toBase58() ?? ''

  const loadPools = useCallback(async () => {
    try {
      const res = await fetch('/api/staking/pools', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return
      setPools(Array.isArray(json.pools) ? json.pools : [])
    } catch {
      /* ignore */
    }
  }, [])

  const loadPositions = useCallback(async () => {
    if (!connected || !publicKey) return
    const addr = publicKey.toBase58()
    const res = await fetch('/api/me/staking/positions', {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'X-Connected-Wallet': addr },
    })
    if (res.status === 401) {
      setNeedsSignIn(true)
      setPositions([])
      return false
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(typeof json?.error === 'string' ? json.error : 'Failed to load positions')
      return false
    }
    setNeedsSignIn(false)
    setPositions(Array.isArray(json.positions) ? json.positions : [])
    return true
  }, [connected, publicKey])

  const refreshAll = useCallback(async () => {
    if (!connected || !publicKey) {
      setLoading(false)
      setPositions([])
      setNeedsSignIn(false)
      return
    }
    setLoading(true)
    setError(null)
    await loadPools()
    const ok = await loadPositions()
    if (
      !ok &&
      typeof window !== 'undefined' &&
      isMobileDevice() &&
      document.visibilityState === 'visible'
    ) {
      await new Promise((r) => setTimeout(r, MOBILE_401_RETRY_MS))
      await loadPositions()
    }
    setLoading(false)
  }, [connected, publicKey, loadPools, loadPositions])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    try {
      setSecurityAck(sessionStorage.getItem(NESTING_SECURITY_ACK_STORAGE_KEY) === '1')
    } catch {
      setSecurityAck(false)
    }
  }, [])

  const setSecurityAckPersisted = useCallback((next: boolean) => {
    setSecurityAck(next)
    try {
      sessionStorage.setItem(NESTING_SECURITY_ACK_STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* private mode / storage full */
    }
  }, [])

  useEffect(() => {
    if (preselectedPoolId && pools.some((p) => p.id === preselectedPoolId)) {
      setStakePoolId(preselectedPoolId)
    }
  }, [preselectedPoolId, pools])

  const poolById = useMemo(() => {
    const m = new Map<string, StakingPoolRow>()
    for (const p of pools) m.set(p.id, p)
    return m
  }, [pools])

  const totals = useMemo(() => {
    let nested = 0
    let est = 0
    let claimed = 0
    const now = Date.now()
    for (const pos of positions) {
      nested += Number(pos.amount)
      claimed += Number(pos.claimed_rewards)
      if (pos.status === 'active') {
        est += estimateClaimableRewards({
          amount: Number(pos.amount),
          rewardRateSnapshot: Number(pos.reward_rate_snapshot),
          rewardRateUnitSnapshot: pos.reward_rate_unit_snapshot as RewardRateUnit,
          claimedRewards: Number(pos.claimed_rewards),
          stakedAtMs: new Date(pos.staked_at).getTime(),
          asOfMs: now,
        })
      }
    }
    const activeCount = positions.filter((p) => p.status === 'active').length
    return { nested, est, claimed, activeCount }
  }, [positions])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const addr = publicKey.toBase58()
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(addr)}`, {
        credentials: 'include',
      })
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Failed to get sign-in nonce')
      }
      const { message } = (await nonceRes.json()) as { message: string }
      const messageBytes = new TextEncoder().encode(message)
      const signature = await signMessage(messageBytes)
      const signatureBase64 =
        typeof signature === 'string'
          ? btoa(signature)
          : btoa(String.fromCharCode(...new Uint8Array(signature)))

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: addr,
          message,
          signature: signatureBase64,
        }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Sign-in verification failed')
      }

      await refreshAll()
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, signMessage, refreshAll])

  const handleStake = async () => {
    if (!publicKey) return
    setActionError(null)
    const pool_id = stakePoolId.trim()
    const amountNum = Number(stakeAmount)
    const body: Record<string, unknown> = { pool_id }
    const pool = pools.find((p) => p.id === pool_id)
    if (!pool) {
      setActionError('Select a pool.')
      return
    }
    if (pool.asset_type === 'token') {
      if (Number.isNaN(amountNum) || amountNum <= 0) {
        setActionError('Enter a positive amount.')
        return
      }
      body.amount = amountNum
    } else {
      body.amount = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 1
    }
    if (stakeAssetId.trim()) body.asset_identifier = stakeAssetId.trim()

    try {
      await runNestingTxAction({
        onPhase: setStakeTxPhase,
        async execute() {
          const res = await fetch('/api/me/staking/stake', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify(body),
          })
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          if (!res.ok) {
            const err =
              res.status === 501
                ? typeof json.error === 'string'
                  ? json.error
                  : 'This pool is not serviceable in mock mode. Switch the pool to mock or solana_ready, or add the on-chain program.'
                : typeof json.error === 'string'
                  ? json.error
                  : 'Stake failed'
            setActionError(err)
            throw new Error('stake')
          }
          return json
        },
        afterSuccess: async () => {
          setStakeAmount('')
          setStakeAssetId('')
          await loadPositions()
          await loadPools()
        },
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'stake') return
      setActionError(e instanceof Error ? e.message : 'Stake failed')
    }
  }

  const handleUnstake = async (positionId: string) => {
    if (!publicKey) return
    setActionError(null)
    try {
      await runNestingTxAction({
        onPhase: (p) => setPosSubPhase(positionId, 'unstake', p),
        async execute() {
          const res = await fetch('/api/me/staking/unstake', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify({ position_id: positionId }),
          })
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          if (!res.ok) {
            const err =
              res.status === 501
                ? typeof json.error === 'string'
                  ? json.error
                  : 'This pool is not serviceable in mock mode.'
                : typeof json.error === 'string'
                  ? json.error
                  : 'Unstake failed'
            setActionError(err)
            throw new Error('unstake')
          }
        },
        afterSuccess: async () => {
          await loadPositions()
        },
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'unstake') throw e
      setActionError(e instanceof Error ? e.message : 'Unstake failed')
    }
  }

  const handleClaim = async (positionId: string, amount: number) => {
    if (!publicKey) return
    setActionError(null)
    try {
      await runNestingTxAction({
        onPhase: (p) => setPosSubPhase(positionId, 'claim', p),
        async execute() {
          const res = await fetch('/api/me/staking/claim', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify({ position_id: positionId, amount }),
          })
          const json = (await res.json().catch(() => ({}))) as { error?: string; claimable?: number }
          if (!res.ok) {
            const err =
              res.status === 501
                ? typeof json.error === 'string'
                  ? json.error
                  : 'This pool is not serviceable in mock mode.'
                : typeof json.error === 'string'
                  ? json.error
                  : 'Claim failed'
            setActionError(err)
            throw new Error('claim')
          }
        },
        afterSuccess: async () => {
          await loadPositions()
        },
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'claim') throw e
      setActionError(e instanceof Error ? e.message : 'Claim failed')
    }
  }

  if (!connected) {
    return (
      <main className="relative mx-auto max-w-2xl px-4 py-10 safe-area-bottom">
        <div className="rounded-2xl border border-border/60 bg-card/80 p-6 space-y-4">
          <Egg className="h-10 w-10 text-theme-prime" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Owl Nesting</h1>
          <p className="text-muted-foreground">
            Connect your wallet to view pools and manage mock stakes (Supabase only).
          </p>
          <Button
            type="button"
            variant="outline"
            className={cn(nestingMutedActionButtonClass)}
            onClick={() => setVisible(true)}
          >
            Connect wallet
          </Button>
          <p className="text-xs text-muted-foreground">
            <Link href="/nesting" className="text-theme-prime underline-offset-4 hover:underline">
              Browse pools on the landing page
            </Link>
          </p>
        </div>
      </main>
    )
  }

  if (!publicKey) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-4xl flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </main>
    )
  }

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-4xl">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading nesting…
        </div>
      </main>
    )
  }

  if (needsSignIn) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" asChild className="min-h-[44px] -ml-2">
          <Link href="/dashboard" className="gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Owl Nesting</h1>
        <p className="text-muted-foreground">
          Sign in with your wallet to load stakes and submit actions (no transaction fee).
        </p>
        {signInError && <p className="text-destructive text-sm">{signInError}</p>}
        <Button onClick={() => void handleSignIn()} disabled={signingIn || !signMessage}>
          {signingIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Signing in…
            </>
          ) : (
            'Sign in with wallet'
          )}
        </Button>
      </main>
    )
  }

  if (error) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-2xl">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" className="mt-4 min-h-[44px]" onClick={() => void refreshAll()}>
          Retry
        </Button>
      </main>
    )
  }

  return (
    <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 pb-16 max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <Button variant="ghost" size="sm" asChild className="min-h-[44px] -ml-2 mb-2">
            <Link href="/dashboard" className="gap-2 text-muted-foreground">
              <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
              Dashboard
            </Link>
          </Button>
          <h1 className="text-2xl sm:text-3xl font-display tracking-wide text-theme-prime">Owl Nesting</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            <span className="font-mono text-xs sm:text-sm break-all">{walletAddr}</span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] touch-manipulation"
          onClick={() => void refreshAll()}
        >
          <RefreshCw className="h-4 w-4 sm:mr-2" aria-hidden />
          Refresh
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <NestingSecurityNotice acknowledged={securityAck} onAcknowledgedChange={setSecurityAckPersisted} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total nested (sum)', value: totals.nested.toLocaleString(undefined, { maximumFractionDigits: 6 }) },
          { label: 'Active positions', value: String(totals.activeCount) },
          { label: 'Est. claimable', value: totals.est.toFixed(6) },
          { label: 'Claimed (total)', value: totals.claimed.toFixed(6) },
        ].map(({ label, value }) => (
          <Card key={label} className="rounded-xl border-border/60 bg-card/90">
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-lg font-mono tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="New stake"
          description="Flow: prepare → submit → sync. For MVP, your position is a database record (not an on-chain transfer yet)."
        />
        <Card className="rounded-xl border-border/70 bg-card/90">
          <CardContent className="pt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stake-pool">Pool</Label>
                <select
                  id="stake-pool"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
                  value={stakePoolId}
                  onChange={(e) => setStakePoolId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {pools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.asset_type})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stake-amt">Amount</Label>
                <Input
                  id="stake-amt"
                  inputMode="decimal"
                  placeholder={pools.find((p) => p.id === stakePoolId)?.asset_type === 'nft' ? '1 (default for NFT)' : '0'}
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="font-mono min-h-[44px]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stake-asset">Asset identifier (optional)</Label>
              <Input
                id="stake-asset"
                placeholder="NFT mint or note — not verified on-chain in MVP"
                value={stakeAssetId}
                onChange={(e) => setStakeAssetId(e.target.value)}
                className="font-mono text-sm min-h-[44px]"
              />
            </div>
            <NestingActionStatusLine phase={stakeTxPhase} className="min-h-[1.25rem]" />
            <Button
              type="button"
              variant="outline"
              className={cn(nestingMutedActionButtonClass)}
              disabled={!securityAck || stakeTxPhase !== 'idle' || !stakePoolId}
              onClick={() => void handleStake()}
            >
              {stakeTxPhase !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {stakeTxPhase === 'idle' ? 'Stake (mock)' : nestingTxPhaseLabel(stakeTxPhase)}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Positions"
          description="Unstake after unlock; each action runs prepare → submit → sync. Totals are DB estimates until a program is linked."
        />
        {positions.length === 0 ? (
          <EmptyState title="No positions yet." body="Pick a pool above or visit the public pools list." />
        ) : (
          <ul className="grid gap-4">
            {positions.map((pos) => (
              <li key={pos.id}>
                <PositionCard
                  position={pos}
                  poolName={poolById.get(pos.pool_id)?.name ?? `Pool ${pos.pool_id.slice(0, 8)}…`}
                  onUnstake={handleUnstake}
                  onClaim={handleClaim}
                  claimPhase={posPhases[pos.id]?.claim ?? 'idle'}
                  unstakePhase={posPhases[pos.id]?.unstake ?? 'idle'}
                  actionsEnabled={securityAck}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground text-center">
        <Link href="/nesting" className="text-theme-prime underline-offset-4 hover:underline">
          Owl Nesting overview
        </Link>
      </p>
    </main>
  )
}
