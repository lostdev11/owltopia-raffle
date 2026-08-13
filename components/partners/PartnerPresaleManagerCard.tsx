'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2, Gift, Rocket } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  OWL_CENTER_PRESALE_DEFAULT_PRICE_USDC,
  OWL_CENTER_PRESALE_DEFAULT_SUPPLY,
  OWL_CENTER_PRESALE_GIFT_ABSOLUTE_CAP,
  OWL_CENTER_PRESALE_LIMITS,
  OWL_CENTER_PRESALE_PRESETS,
  owlCenterPresalePlatformFeeUsdcPerSpot,
} from '@/lib/owl-center-presale/constants'
import type { OwlCenterPresaleTenantAdmin } from '@/lib/owl-center-presale/types'
import { cn } from '@/lib/utils'

type TenantRow = OwlCenterPresaleTenantAdmin & {
  sold?: number
  remaining?: number
  presale_url?: string
}

type Props = {
  className?: string
  /** Soft surface class from partner dashboard */
  cardClassName?: string
}

function PresetRow(props: {
  label: string
  presets: readonly number[]
  value: number
  onChange: (n: number) => void
  prefix?: string
  suffix?: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{props.label}</p>
      <div className="flex flex-wrap gap-2">
        {props.presets.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => props.onChange(n)}
            className={cn(
              'min-h-[40px] rounded-lg border px-3 py-1.5 text-sm touch-manipulation',
              props.value === n
                ? 'border-primary bg-primary/15 text-foreground'
                : 'border-border text-muted-foreground hover:border-primary/40'
            )}
          >
            {props.prefix}
            {n}
            {props.suffix}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PartnerPresaleManagerCard({ className, cardClassName }: Props) {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [headline, setHeadline] = useState('')
  const [partnerWallet, setPartnerWallet] = useState('')
  const [price, setPrice] = useState(OWL_CENTER_PRESALE_DEFAULT_PRICE_USDC)
  const [supply, setSupply] = useState(OWL_CENTER_PRESALE_DEFAULT_SUPPLY)
  const [maxPurchase, setMaxPurchase] = useState(5)
  const [maxWallet, setMaxWallet] = useState(20)

  const [giftTenantId, setGiftTenantId] = useState<string | null>(null)
  const [giftWallets, setGiftWallets] = useState('')
  const [giftQty, setGiftQty] = useState(1)

  const feeUsdc = owlCenterPresalePlatformFeeUsdcPerSpot()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/partners/owl-center-presale', { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as { tenants?: TenantRow[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'Failed to load')
      setTenants(j.tenants ?? [])
    } catch (e) {
      setTenants([])
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createCampaign() {
    setBusy(true)
    setMsg(null)
    setError(null)
    try {
      const res = await fetch('/api/partners/owl-center-presale', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          display_name: displayName,
          headline: headline || null,
          partner_wallet: partnerWallet || undefined,
          unit_price_usdc: price,
          presale_supply: supply,
          max_spots_per_purchase: maxPurchase,
          max_credits_per_wallet: maxWallet,
        }),
      })
      const j = (await res.json()) as { error?: string; message?: string }
      if (!res.ok) throw new Error(j.error || 'Create failed')
      setMsg(j.message || 'Submitted for approval')
      setSlug('')
      setDisplayName('')
      setHeadline('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function setLive(id: string, is_live: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/partners/owl-center-presale/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_live }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Update failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function giftCredits() {
    if (!giftTenantId) return
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const wallets = giftWallets
        .split(/[\s,;\n]+/)
        .map((w) => w.trim())
        .filter(Boolean)
      const res = await fetch(`/api/partners/owl-center-presale/${giftTenantId}/gift`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets, quantity: giftQty }),
      })
      const j = (await res.json()) as { error?: string; gifted?: number; failed?: number }
      if (!res.ok) throw new Error(j.error || 'Gift failed')
      setMsg(`Gifted ${j.gifted ?? 0} wallet(s)${j.failed ? ` · ${j.failed} failed` : ''}`)
      setGiftWallets('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gift failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cn(cardClassName, 'mb-6', className)}>
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Rocket className="h-5 w-5 text-emerald-500" aria-hidden />
          Partner presale
        </CardTitle>
        <CardDescription>
          Self-serve campaign → Owltopia admin approval → go live. Buyers pay your spot price to your wallet + $
          {feeUsdc} platform fee per spot to Owltopia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 p-5 sm:p-6">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
          </p>
        ) : null}

        {tenants.length > 0 ? (
          <ul className="space-y-3">
            {tenants.map((t) => (
              <li key={t.id} className="rounded-xl border border-border/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{t.display_name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      /{t.slug} · {t.approval_status}
                      {t.is_live ? ' · live' : ''} · ${t.unit_price_usdc} · {t.sold ?? 0}/
                      {t.presale_supply} sold
                    </p>
                    {t.rejection_reason ? (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t.rejection_reason}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {t.approval_status === 'approved' && t.is_enabled ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-[40px] touch-manipulation"
                          disabled={busy}
                          onClick={() => void setLive(t.id, !t.is_live)}
                        >
                          {t.is_live ? 'Pause' : 'Go live'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-[40px] touch-manipulation"
                          onClick={() => setGiftTenantId(giftTenantId === t.id ? null : t.id)}
                        >
                          <Gift className="mr-1 h-3.5 w-3.5" />
                          Airdrop
                        </Button>
                        {t.is_live || t.is_enabled ? (
                          <Button asChild size="sm" variant="ghost" className="min-h-[40px]">
                            <Link href={t.presale_url ?? `/owl-center/${t.slug}/presale`} target="_blank">
                              Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Awaiting admin approval</span>
                    )}
                  </div>
                </div>
                {giftTenantId === t.id ? (
                  <div className="mt-4 space-y-2 border-t border-border/50 pt-4">
                    <label className="block text-xs font-medium text-muted-foreground">
                      Wallets (one per line or comma-separated)
                      <textarea
                        className="mt-1 min-h-[88px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={giftWallets}
                        onChange={(e) => setGiftWallets(e.target.value)}
                        placeholder="Wallet addresses…"
                      />
                    </label>
                    <label className="block text-xs font-medium text-muted-foreground">
                      Credits each
                      <input
                        type="number"
                        min={1}
                        max={OWL_CENTER_PRESALE_GIFT_ABSOLUTE_CAP}
                        className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={giftQty}
                        onChange={(e) => setGiftQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      />
                    </label>
                    <Button
                      type="button"
                      className="min-h-[44px] touch-manipulation"
                      disabled={busy || !giftWallets.trim()}
                      onClick={() => void giftCredits()}
                    >
                      Gift credits
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="space-y-4 rounded-xl border border-dashed border-border/70 p-4">
          <p className="font-medium text-foreground">Create new campaign</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted-foreground sm:col-span-2">
              Display name
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Baza Genesis"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Slug
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="baza-genesis"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Receive wallet (spot proceeds)
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                value={partnerWallet}
                onChange={(e) => setPartnerWallet(e.target.value.trim())}
                placeholder="Defaults to your signed-in wallet"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground sm:col-span-2">
              Headline (optional)
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="1 spot = 1 mint credit"
              />
            </label>
          </div>

          <PresetRow
            label="Spot price (USDC)"
            presets={OWL_CENTER_PRESALE_PRESETS.priceUsdc}
            value={price}
            prefix="$"
            onChange={setPrice}
          />
          <label className="block text-xs text-muted-foreground">
            Custom price (${OWL_CENTER_PRESALE_LIMITS.priceUsdc.min}–{OWL_CENTER_PRESALE_LIMITS.priceUsdc.max})
            <input
              type="number"
              min={OWL_CENTER_PRESALE_LIMITS.priceUsdc.min}
              max={OWL_CENTER_PRESALE_LIMITS.priceUsdc.max}
              className="mt-1 w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={price}
              onChange={(e) => setPrice(parseInt(e.target.value, 10) || price)}
            />
          </label>

          <PresetRow
            label="Presale supply"
            presets={OWL_CENTER_PRESALE_PRESETS.supply}
            value={supply}
            onChange={setSupply}
          />
          <label className="block text-xs text-muted-foreground">
            Custom supply ({OWL_CENTER_PRESALE_LIMITS.supply.min}–{OWL_CENTER_PRESALE_LIMITS.supply.max})
            <input
              type="number"
              min={OWL_CENTER_PRESALE_LIMITS.supply.min}
              max={OWL_CENTER_PRESALE_LIMITS.supply.max}
              className="mt-1 w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={supply}
              onChange={(e) => setSupply(parseInt(e.target.value, 10) || supply)}
            />
          </label>

          <PresetRow
            label="Max spots per purchase"
            presets={OWL_CENTER_PRESALE_PRESETS.maxSpotsPerPurchase}
            value={maxPurchase}
            onChange={setMaxPurchase}
          />
          <PresetRow
            label="Max credits per wallet"
            presets={OWL_CENTER_PRESALE_PRESETS.maxCreditsPerWallet}
            value={maxWallet}
            onChange={setMaxWallet}
          />

          <p className="text-xs text-muted-foreground">
            Buyers also pay ${feeUsdc} Owltopia fee per spot (SOL). You keep the spot proceeds.
          </p>

          <Button
            type="button"
            className="min-h-[44px] w-full touch-manipulation sm:w-auto"
            disabled={busy || !displayName.trim() || !slug.trim()}
            onClick={() => void createCampaign()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit for approval
          </Button>
        </div>

        {msg ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</p> : null}
        {error ? (
          <p className="text-sm text-red-500" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
