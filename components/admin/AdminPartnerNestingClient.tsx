'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Bird, HeartHandshake, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import type { PartnerCommunityCreatorRow } from '@/lib/db/partner-community-creators-admin'
import type { NftLockStandard, StakingPoolRow } from '@/lib/db/staking-pools'
import { StakingPoolCard } from '@/components/nesting/StakingPoolCard'

type PartnerNestRow = PartnerCommunityCreatorRow & {
  profile_display_name: string | null
  suggested_partner_slug: string
  suggested_pool_name: string
}

export function AdminPartnerNestingClient() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true

  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loadingAdmin, setLoadingAdmin] = useState(() => !cachedTrue)
  const [partners, setPartners] = useState<PartnerNestRow[]>([])
  const [pools, setPools] = useState<StakingPoolRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [creatorWallet, setCreatorWallet] = useState('')
  const [collectionKey, setCollectionKey] = useState('')
  const [poolName, setPoolName] = useState('')
  const [partnerSlug, setPartnerSlug] = useState('')
  const [locked, setLocked] = useState(false)
  const [maxLockDays, setMaxLockDays] = useState('90')
  const [minLockDays, setMinLockDays] = useState('30')
  const [lockStandard, setLockStandard] = useState<NftLockStandard>('database_only')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)
  const [nextSteps, setNextSteps] = useState<string[]>([])

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoadingAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoadingAdmin(false)
      return
    }
    setLoadingAdmin(true)
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoadingAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const fetchData = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    try {
      const res = await fetch('/api/admin/partners/nesting', { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setListError(typeof json?.error === 'string' ? json.error : 'Failed to load partner nesting data')
        return
      }
      setPartners(Array.isArray(json.partners) ? json.partners : [])
      setPools(Array.isArray(json.pools) ? json.pools : [])
    } catch {
      setListError('Failed to load partner nesting data')
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchData()
  }, [isAdmin, fetchData])

  const activePartners = useMemo(() => partners.filter((p) => p.is_active), [partners])

  const selectedPartner = useMemo(
    () => activePartners.find((p) => p.creator_wallet === creatorWallet) ?? null,
    [activePartners, creatorWallet]
  )

  useEffect(() => {
    if (!selectedPartner) return
    setPartnerSlug((prev) => prev || selectedPartner.suggested_partner_slug)
    setPoolName((prev) => prev || selectedPartner.suggested_pool_name)
  }, [selectedPartner])

  const createPartnerPool = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveOk(null)
    setNextSteps([])
    try {
      const res = await fetch('/api/admin/partners/nesting', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_wallet: creatorWallet,
          collection_key: collectionKey,
          pool_name: poolName.trim() || undefined,
          partner_slug: partnerSlug.trim() || undefined,
          locked: lockStandard === 'database_only' ? false : locked,
          max_lock_days: lockStandard === 'database_only' || !locked ? 0 : Number(maxLockDays),
          min_lock_days: lockStandard === 'database_only' || !locked ? 0 : Number(minLockDays),
          nft_lock_standard: lockStandard,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Create failed')
        return
      }
      const name = typeof json?.pool?.name === 'string' ? json.pool.name : 'Partner nest'
      setSaveOk(
        lockStandard === 'database_only'
          ? `Created “${name}”. Soft nest — holders keep transferable NFTs; rewards require ownership.`
          : `Created “${name}”. Holders can stake once freeze-readiness checks out.`
      )
      setNextSteps(Array.isArray(json?.next_steps) ? json.next_steps : [])
      setCollectionKey('')
      await fetchData()
    } finally {
      setSaving(false)
    }
  }

  if (!connected) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 text-center">
        <p className="text-muted-foreground mb-6">Connect a full-admin wallet to manage partner nesting.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (loadingAdmin || isAdmin === null) {
    return (
      <div className="container mx-auto py-12 px-4 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 text-center">
        <p className="text-muted-foreground mb-6">Full Owl Vision access is required.</p>
        <Button asChild variant="outline" className="min-h-[44px] touch-manipulation">
          <Link href="/admin">Back to Owl Vision</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4 space-y-8">
      <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px]">
        <Link href="/admin/partners">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Partners hub
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 flex items-center gap-2">
          <Bird className="h-7 w-7 shrink-0 text-emerald-500" aria-hidden />
          Partner Nesting
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Add a partner&apos;s NFT <strong className="text-foreground">collection address</strong> to open a stake
          perch on Owl Nesting. Partners must already be on the{' '}
          <Link href="/admin/partners/creators" className="text-primary underline-offset-4 hover:underline">
            partner creators
          </Link>{' '}
          allowlist (2% raffle fee tier). Self-serve requests land in{' '}
          <Link href="/admin/partners/nest-applications" className="text-primary underline-offset-4 hover:underline">
            Partner Nesting requests
          </Link>
          . For first-party Owltopia perches use{' '}
          <Link href="/admin/nesting" className="text-primary underline-offset-4 hover:underline">
            Owl Nesting
          </Link>
          .
        </p>
      </div>

      <Card className="rounded-xl border-emerald-500/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-5 w-5" aria-hidden />
            Add partner collection
          </CardTitle>
          <CardDescription>
            Creates an active NFT nest pool at 1 OWL/day per NFT, tagged with the partner slug so holders can stake
            that collection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {activePartners.length === 0 && !loadingList ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              No active partner creators yet.{' '}
              <Link href="/admin/partners/creators" className="underline underline-offset-4">
                Allowlist a partner wallet
              </Link>{' '}
              first.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pn-partner">Partner</Label>
              <select
                id="pn-partner"
                value={creatorWallet}
                onChange={(e) => {
                  setCreatorWallet(e.target.value)
                  setPoolName('')
                  setPartnerSlug('')
                  setSaveOk(null)
                  setSaveError(null)
                }}
                className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm touch-manipulation"
              >
                <option value="">Select partner…</option>
                {activePartners.map((p) => {
                  const label =
                    p.display_label?.trim() ||
                    p.profile_display_name?.trim() ||
                    `${p.creator_wallet.slice(0, 4)}…${p.creator_wallet.slice(-4)}`
                  return (
                    <option key={p.creator_wallet} value={p.creator_wallet}>
                      {label} · {p.partner_tier}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pn-coll">Collection address</Label>
              <Input
                id="pn-coll"
                autoComplete="off"
                spellCheck={false}
                placeholder="Solana collection mint / Core collection"
                value={collectionKey}
                onChange={(e) => setCollectionKey(e.target.value)}
                className="font-mono text-xs min-h-[44px] touch-manipulation"
              />
              <p className="text-xs text-muted-foreground">
                Holders&apos; wallets are scanned for NFTs in this collection when they open Nesting.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pn-name">Pool name</Label>
              <Input
                id="pn-name"
                autoComplete="off"
                placeholder="e.g. Misfits Nest"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                className="min-h-[44px] touch-manipulation"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pn-slug">Partner slug</Label>
              <Input
                id="pn-slug"
                autoComplete="off"
                placeholder="e.g. misfits"
                value={partnerSlug}
                onChange={(e) => setPartnerSlug(e.target.value)}
                className="min-h-[44px] touch-manipulation"
              />
              <p className="text-xs text-muted-foreground">Shown on nest cards for partner-branded perches.</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium">Locked staking</p>
              <p className="text-xs text-muted-foreground">
                On = unstaking waits for max lock days (freeze perches). Off = no lock period. Soft nests
                (database_only) always use no lock.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 min-h-[44px] shrink-0">
              <Switch
                id="pn-locked"
                ariaLabel="Locked staking"
                checked={locked && lockStandard !== 'database_only'}
                disabled={lockStandard === 'database_only'}
                onCheckedChange={(v) => {
                  setLocked(v)
                  if (v && lockStandard === 'database_only') setLockStandard('auto')
                }}
              />
              <Label htmlFor="pn-locked" className="text-sm cursor-pointer">
                {locked && lockStandard !== 'database_only' ? 'Lock enabled' : 'No lock'}
              </Label>
            </div>
          </div>

          {locked && lockStandard !== 'database_only' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pn-max-lock">Maximum lock (days)</Label>
                <Input
                  id="pn-max-lock"
                  inputMode="numeric"
                  value={maxLockDays}
                  onChange={(e) => setMaxLockDays(e.target.value)}
                  className="min-h-[44px] touch-manipulation"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pn-min-lock">Minimum commitment (days)</Label>
                <Input
                  id="pn-min-lock"
                  inputMode="numeric"
                  value={minLockDays}
                  onChange={(e) => setMinLockDays(e.target.value)}
                  className="min-h-[44px] touch-manipulation"
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="pn-lock-standard">NFT lock standard</Label>
            <select
              id="pn-lock-standard"
              value={lockStandard}
              onChange={(e) => {
                const next = e.target.value as NftLockStandard
                setLockStandard(next)
                if (next === 'database_only') setLocked(false)
              }}
              className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm touch-manipulation"
            >
              <option value="database_only">Soft nest (no freeze — transferable)</option>
              <option value="auto">Auto-detect freeze (Helius)</option>
              <option value="mpl_core_freeze_delegate">Metaplex Core freeze</option>
              <option value="spl_token_account_freeze">SPL token account freeze</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Soft nest is the default for partners: NFTs stay transferable; claim/stake require ownership. Freeze
              standards lock the NFT on-chain while nested.
            </p>
          </div>

          {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
          {saveOk ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{saveOk}</p> : null}
          {nextSteps.length > 0 ? (
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              {nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          ) : null}

          <Button
            type="button"
            className="min-h-[44px] bg-emerald-600 hover:bg-emerald-700 touch-manipulation"
            disabled={saving || !creatorWallet || !collectionKey.trim()}
            onClick={() => void createPartnerPool()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
            Create partner nest pool
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <HeartHandshake className="h-5 w-5 text-muted-foreground" aria-hidden />
            Partner perches
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation"
            disabled={loadingList}
            onClick={() => void fetchData()}
          >
            {loadingList ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
            Refresh
          </Button>
        </div>
        {listError ? <p className="text-sm text-destructive">{listError}</p> : null}
        {loadingList && pools.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading pools" />
          </div>
        ) : pools.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No partner-tagged nest pools yet. Add a collection address above to create the first one.
          </p>
        ) : (
          <div className="space-y-3">
            {pools.map((pool) => (
              <StakingPoolCard key={pool.id} pool={pool} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
