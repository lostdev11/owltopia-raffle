'use client'

import { useCallback, useMemo, useState } from 'react'
import { Download, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionHeader } from '@/components/council/SectionHeader'
import type { GenOwlNestRosterPayload } from '@/lib/db/gen-owl-nest-roster'
import {
  NEST_ROSTER_GROUP_KEYS,
  nestRosterGroupLabel,
  type NestRosterGroupKey,
} from '@/lib/nesting/nest-roster-groups'

function tierShortLabel(poolSlug: string, lockDays: number): string {
  if (lockDays > 0) return `${lockDays}d`
  return poolSlug
}

export function AdminGenOwlNestRosterSection() {
  const [group, setGroup] = useState<NestRosterGroupKey>('gen1-owl')
  const [roster, setRoster] = useState<GenOwlNestRosterPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [walletFilter, setWalletFilter] = useState('')

  const loadRoster = useCallback(async (nextGroup: NestRosterGroupKey) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/staking/nest-roster?group=${encodeURIComponent(nextGroup)}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Failed to load nest roster')
        return
      }
      setRoster(json as GenOwlNestRosterPayload)
    } catch {
      setError('Failed to load nest roster — check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  const selectGroup = useCallback(
    (next: NestRosterGroupKey) => {
      setGroup(next)
      void loadRoster(next)
    },
    [loadRoster]
  )

  const tierSlugs = useMemo(() => (roster ? roster.tiers.map((t) => t.pool_slug) : []), [roster])

  const filteredWallets = useMemo(() => {
    if (!roster) return []
    const q = walletFilter.trim().toLowerCase()
    if (!q) return roster.wallets
    return roster.wallets.filter(
      (w) =>
        w.wallet_address.toLowerCase().includes(q) ||
        (w.referral_code ?? '').toLowerCase().includes(q)
    )
  }, [roster, walletFilter])

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Who nested — nest roster by collection"
        description="Every wallet with an open Owltopia coin, Gen 1, or Gen 2 nest, split by lock tier. Includes each nester's referral code and how many confirmed ticket purchases their code has referred, so you can cross-check the referral program. Export CSV for the full per-NFT list."
      />
      <Card className="rounded-xl border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 shrink-0" aria-hidden />
            Nest roster
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {NEST_ROSTER_GROUP_KEYS.map((g) => (
              <Button
                key={g}
                type="button"
                variant={group === g && roster ? 'default' : 'outline'}
                className="min-h-[44px] touch-manipulation"
                disabled={loading}
                onClick={() => selectGroup(g)}
              >
                {loading && group === g ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
                {nestRosterGroupLabel(g)}
              </Button>
            ))}
            {roster ? (
              <Button type="button" variant="outline" size="sm" className="min-h-[44px] touch-manipulation" asChild>
                <a
                  href={`/api/admin/staking/nest-roster?group=${encodeURIComponent(roster.group)}&format=csv`}
                  download
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                  Export CSV (per NFT)
                </a>
              </Button>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {!roster && !loading && !error ? (
            <p className="text-sm text-muted-foreground">
              Pick Owltopia coin NFTs, Gen 1, or Gen 2 to load every open nest by lock tier.
            </p>
          ) : null}

          {roster ? (
            <>
              <p className="text-xs text-muted-foreground">
                {nestRosterGroupLabel(roster.group)} · generated{' '}
                {new Date(roster.generated_at).toLocaleString()}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {roster.tiers.map((tier) => (
                  <div
                    key={tier.pool_slug}
                    className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3"
                  >
                    <p className="text-xs text-muted-foreground">
                      {tier.lock_period_days} day lock · <span className="font-mono">{tier.pool_slug}</span>
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {tier.nest_count} nest{tier.nest_count === 1 ? '' : 's'}
                      <span className="text-sm font-normal text-muted-foreground">
                        {' '}
                        · {tier.wallet_count} wallet{tier.wallet_count === 1 ? '' : 's'}
                      </span>
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label htmlFor="roster-filter">Filter by wallet or referral code</Label>
                <Input
                  id="roster-filter"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste a wallet address or code"
                  value={walletFilter}
                  onChange={(e) => setWalletFilter(e.target.value)}
                  className="font-mono text-xs min-h-[44px] touch-manipulation max-w-md"
                />
              </div>

              {filteredWallets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {roster.wallets.length === 0
                    ? 'No open nests yet for this group.'
                    : 'No wallets match this filter.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="pb-2 pr-3">Wallet</th>
                        {roster.tiers.map((tier) => (
                          <th key={tier.pool_slug} className="pb-2 pr-3 tabular-nums">
                            {tierShortLabel(tier.pool_slug, tier.lock_period_days)}
                          </th>
                        ))}
                        <th className="pb-2 pr-3 tabular-nums">Total</th>
                        <th className="pb-2 pr-3">First nested</th>
                        <th className="pb-2 pr-3">Next unlock</th>
                        <th className="pb-2 pr-3">Referral code</th>
                        <th className="pb-2 tabular-nums">Referred buys</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWallets.slice(0, 200).map((w) => (
                        <tr key={w.wallet_address} className="border-b border-border/40 last:border-0 align-top">
                          <td className="py-2 pr-3 font-mono text-xs break-all">{w.wallet_address}</td>
                          {tierSlugs.map((slug) => (
                            <td key={slug} className="py-2 pr-3 tabular-nums">
                              {w.nests_by_tier[slug] ?? 0}
                            </td>
                          ))}
                          <td className="py-2 pr-3 tabular-nums font-medium">{w.total_nests}</td>
                          <td className="py-2 pr-3 text-xs whitespace-nowrap">
                            {w.first_staked_at ? new Date(w.first_staked_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-2 pr-3 text-xs whitespace-nowrap">
                            {w.next_unlock_at ? new Date(w.next_unlock_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">{w.referral_code ?? '—'}</td>
                          <td className="py-2 tabular-nums">{w.referred_purchases}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredWallets.length > 200 ? (
                    <p className="text-xs text-muted-foreground mt-2">
                      Showing first 200 of {filteredWallets.length} wallets — use the filter or CSV export for the
                      rest.
                    </p>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}
