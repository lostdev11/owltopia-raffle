'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bird, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { PartnerNestApplicationRow } from '@/lib/db/partner-nest-applications'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { PartnerNestRewardDepositPanel } from '@/components/partners/PartnerNestRewardDepositPanel'

const CARD_SURFACE = 'rounded-2xl border border-border/60 bg-card shadow-sm'

type Props = {
  className?: string
}

export function PartnerNestingRequestCard({ className }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [applications, setApplications] = useState<PartnerNestApplicationRow[]>([])
  const [pools, setPools] = useState<StakingPoolRow[]>([])
  const [listError, setListError] = useState<string | null>(null)

  const [collectionKey, setCollectionKey] = useState('')
  const [poolName, setPoolName] = useState('')
  const [usePartnerToken, setUsePartnerToken] = useState(false)
  const [rewardSymbol, setRewardSymbol] = useState('')
  const [rewardMint, setRewardMint] = useState('')
  const [rewardDecimals, setRewardDecimals] = useState('9')
  const [rewardRate, setRewardRate] = useState('1')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  const fetchApps = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const res = await fetch('/api/partners/nest-applications', {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setListError(typeof json?.error === 'string' ? json.error : 'Could not load Nesting requests')
        return
      }
      setApplications(Array.isArray(json.applications) ? json.applications : [])
      setPools(Array.isArray(json.pools) ? json.pools : [])
    } catch {
      setListError('Could not load Nesting requests')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchApps()
  }, [fetchApps])

  const submit = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveOk(null)
    try {
      const res = await fetch('/api/partners/nest-applications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection_key: collectionKey,
          pool_name: poolName.trim() || undefined,
          reward_mode_requested: usePartnerToken ? 'partner_token' : 'platform_owl',
          reward_token_symbol: usePartnerToken ? rewardSymbol : undefined,
          reward_mint: usePartnerToken ? rewardMint : undefined,
          reward_decimals: usePartnerToken ? Number(rewardDecimals) : undefined,
          reward_rate: Number(rewardRate) || 1,
          notes: notes.trim() || undefined,
          locked: true,
          max_lock_days: 90,
          min_lock_days: 30,
          nft_lock_standard: 'auto',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Submit failed')
        return
      }
      setSaveOk(
        usePartnerToken
          ? 'Request submitted. Owltopia will review your collection and partner reward token.'
          : 'Request submitted. Owltopia will review your collection (OWL rewards).'
      )
      setCollectionKey('')
      setPoolName('')
      setRewardMint('')
      setRewardSymbol('')
      setNotes('')
      setOpen(false)
      await fetchApps()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={`${CARD_SURFACE} mb-6 overflow-hidden border-emerald-500/25 ${className ?? ''}`}>
      <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
              <Bird className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-foreground">Partner Nesting</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Request a stake perch for your NFT collection. Optionally propose your own SPL reward token for
                holders — Owltopia admins accept or reject each request.
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="min-h-[44px] w-full shrink-0 touch-manipulation sm:w-auto"
            onClick={() => {
              setOpen((v) => !v)
              setSaveError(null)
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            {open ? 'Close form' : 'Request nest'}
          </Button>
        </div>

        {open ? (
          <div className="space-y-4 rounded-xl border border-border/60 bg-muted/15 p-4">
            <div className="space-y-2">
              <Label htmlFor="pnr-coll">Collection address</Label>
              <Input
                id="pnr-coll"
                className="min-h-[44px] font-mono text-xs"
                spellCheck={false}
                placeholder="Solana collection mint"
                value={collectionKey}
                onChange={(e) => setCollectionKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pnr-name">Pool name (optional)</Label>
              <Input
                id="pnr-name"
                className="min-h-[44px]"
                placeholder="e.g. Misfits Nest"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border/50 bg-background/70 px-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">Reward holders with our token</p>
                <p className="text-xs text-muted-foreground">
                  Off = OWL from Owltopia. On = submit your SPL mint for admin review (claims go live after funding).
                </p>
              </div>
              <Switch
                id="pnr-partner-token"
                ariaLabel="Use partner reward token"
                checked={usePartnerToken}
                onCheckedChange={setUsePartnerToken}
              />
            </div>

            {usePartnerToken ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pnr-sym">Token symbol</Label>
                  <Input
                    id="pnr-sym"
                    className="min-h-[44px]"
                    placeholder="e.g. MISFIT"
                    value={rewardSymbol}
                    onChange={(e) => setRewardSymbol(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pnr-dec">Decimals</Label>
                  <Input
                    id="pnr-dec"
                    className="min-h-[44px]"
                    inputMode="numeric"
                    value={rewardDecimals}
                    onChange={(e) => setRewardDecimals(e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="pnr-mint">Reward token mint</Label>
                  <Input
                    id="pnr-mint"
                    className="min-h-[44px] font-mono text-xs"
                    spellCheck={false}
                    placeholder="SPL mint address"
                    value={rewardMint}
                    onChange={(e) => setRewardMint(e.target.value)}
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="pnr-rate">Daily reward per NFT</Label>
              <Input
                id="pnr-rate"
                className="min-h-[44px]"
                inputMode="decimal"
                value={rewardRate}
                onChange={(e) => setRewardRate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Suggested 1 / day. Final rate is confirmed when an admin approves.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pnr-notes">Notes (optional)</Label>
              <Input
                id="pnr-notes"
                className="min-h-[44px]"
                placeholder="Freeze standard, collection links, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

            <Button
              type="button"
              className="min-h-[44px] bg-emerald-600 hover:bg-emerald-700 touch-manipulation"
              disabled={saving || !collectionKey.trim() || (usePartnerToken && (!rewardMint.trim() || !rewardSymbol.trim()))}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Submit for review
            </Button>
          </div>
        ) : null}

        {saveOk ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{saveOk}</p> : null}
        {listError ? <p className="text-sm text-destructive">{listError}</p> : null}

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your requests</p>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Nesting requests yet.</p>
          ) : (
            <ul className="divide-y divide-border/50 rounded-xl border border-border/50">
              {applications.map((app) => {
                const pool =
                  app.approved_pool_id != null
                    ? pools.find((p) => p.id === app.approved_pool_id) ?? null
                    : null
                const showFund =
                  app.status === 'active' &&
                  app.approved_reward_mode === 'partner_token' &&
                  pool?.reward_mint &&
                  pool.reward_token

                return (
                <li key={app.id} className="space-y-1 px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{app.pool_name || 'Nest request'}</span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs capitalize">{app.status}</span>
                  </div>
                  <p className="break-all font-mono text-xs text-muted-foreground">{app.collection_key}</p>
                  <p className="text-xs text-muted-foreground">
                    Rewards:{' '}
                    {app.reward_mode_requested === 'partner_token'
                      ? `${app.reward_token_symbol || 'TOKEN'} (${app.reward_mint?.slice(0, 8)}…)`
                      : 'OWL (platform)'}
                    {app.approved_reward_mode
                      ? ` · approved as ${app.approved_reward_mode === 'partner_token' ? 'partner token' : 'OWL'}`
                      : ''}
                  </p>
                  {app.status === 'closed' && app.rejection_reason ? (
                    <p className="text-xs text-destructive">{app.rejection_reason}</p>
                  ) : null}
                  {app.status === 'active' ? (
                    <Link
                      href="/nesting"
                      className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Open Nesting
                    </Link>
                  ) : null}
                  {showFund && pool?.reward_mint && pool.reward_token ? (
                    <PartnerNestRewardDepositPanel
                      poolId={pool.id}
                      rewardToken={pool.reward_token}
                      rewardMint={pool.reward_mint}
                    />
                  ) : null}
                </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
