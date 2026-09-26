'use client'

import { useCallback, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  AdminPacksInventoryForm,
  type AdminPackProductShelf,
  type AdminPacksInventoryItem,
} from '@/components/admin/AdminPacksInventoryForm'
import { AdminPacksInventoryList } from '@/components/admin/AdminPacksInventoryList'
import { AdminPacksVaultFundingForm } from '@/components/admin/AdminPacksVaultFundingForm'
import { packPauseReasonLabel } from '@/lib/packs/admin-copy'
import { packAdminShelfBadgeLabel } from '@/lib/packs/admin-inventory-shelf'
import { PACKS_PRODUCT_SLUG_MAIN, PACKS_PRODUCT_SLUG_OWL } from '@/lib/packs/product-pools'
import { formatJackpotPoolSol } from '@/lib/packs/jackpot'
import { OWL_TICKER } from '@/lib/council/owl-ticker'

export type AdminPackProductShelfWithJackpot = AdminPackProductShelf & {
  jackpotPoolSol?: number
}

function shelfShortLabel(slug: string): string {
  return packAdminShelfBadgeLabel(slug)
}

export function AdminPacksDepositsSection({
  vaultAddress,
  vaultSolBalance,
  vaultOwlBalance,
  inventory,
  products,
  owlSolPrice,
  onRefresh,
}: {
  vaultAddress: string | null
  vaultSolBalance: number | null
  vaultOwlBalance: number | null
  inventory: AdminPacksInventoryItem[]
  products: AdminPackProductShelfWithJackpot[]
  owlSolPrice: number | null
  onRefresh: () => Promise<void>
}) {
  const defaultProductId = useMemo(() => {
    const owl = products.find((p) => p.slug === PACKS_PRODUCT_SLUG_OWL)
    const main = products.find((p) => p.slug === PACKS_PRODUCT_SLUG_MAIN)
    return owl?.id ?? main?.id ?? products[0]?.id ?? ''
  }, [products])

  const [shelfProductId, setShelfProductId] = useState('')
  const [clearPauseBusyId, setClearPauseBusyId] = useState<string | null>(null)
  const [clearPauseError, setClearPauseError] = useState<string | null>(null)

  const clearShelfPause = useCallback(
    async (productId: string) => {
      setClearPauseError(null)
      setClearPauseBusyId(productId)
      try {
        const res = await fetch('/api/admin/packs', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: productId, clear_shelf_pause: true }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof json.error === 'string' ? json.error : 'Could not clear shelf pause')
        }
        await onRefresh()
      } catch (e) {
        setClearPauseError(e instanceof Error ? e.message : 'Could not clear shelf pause')
      } finally {
        setClearPauseBusyId(null)
      }
    },
    [onRefresh]
  )

  const activeProductId = shelfProductId || defaultProductId
  const activeProduct = products.find((p) => p.id === activeProductId)
  const activeSlug = activeProduct?.slug ?? PACKS_PRODUCT_SLUG_MAIN
  const shelfLabel = shelfShortLabel(activeSlug)
  const jackpotPoolSol = activeProduct?.jackpotPoolSol ?? 0
  const shelfNfts = activeProduct?.availableNfts ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-medium">Deposits</h2>
        <p className="text-xs text-muted-foreground">
          Pick one prize shelf, then fund that shelf with SOL, {OWL_TICKER}, and/or NFTs. On-chain
          tokens land in the shared packs vault; SOL top-ups also credit that shelf&apos;s jackpot
          pool in the ledger.
        </p>
      </div>

      {products.length > 0 ? (
        <div>
          <Label htmlFor="packs-unified-deposit-shelf">Prize shelf (product pool)</Label>
          <select
            id="packs-unified-deposit-shelf"
            className="mt-1 flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm"
            value={activeProductId}
            onChange={(e) => setShelfProductId(e.target.value)}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {shelfShortLabel(p.slug)} — {p.name} ({p.availableNfts} NFT
                {p.availableNfts === 1 ? '' : 's'}
                {p.jackpotPoolSol != null
                  ? ` · jackpot ${formatJackpotPoolSol(p.jackpotPoolSol)} SOL`
                  : ''}
                )
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Same category odds % on both shelves. Stock cheaper NFTs on the $OWL shelf so whale{' '}
            {OWL_TICKER} opens do not drain the main 0.1 SOL vault.
          </p>
        </div>
      ) : null}

      {products.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Shelf pause status</p>
          {products.map((p) => {
            const paused = p.shelfPaused === true
            const reasonLabel = packPauseReasonLabel(p.shelfPauseReason)
            const minNeed = p.minNftCount ?? 1
            return (
              <div
                key={p.id}
                className={`rounded-md border p-3 text-sm ${paused ? 'border-amber-500/40 bg-amber-500/5' : 'bg-muted/20'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {shelfShortLabel(p.slug)}{' '}
                      <span className="font-normal text-muted-foreground">
                        — {paused ? 'Paused' : 'Open for opens'}
                      </span>
                    </p>
                    {paused && reasonLabel ? (
                      <p className="mt-1 text-xs text-muted-foreground">{reasonLabel}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.availableNfts} prize NFT{p.availableNfts === 1 ? '' : 's'} available
                      {minNeed > 1 ? ` (min ${minNeed})` : ''}
                    </p>
                  </div>
                  {paused ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-[44px] shrink-0 touch-manipulation"
                      disabled={
                        clearPauseBusyId !== null || p.availableNfts < minNeed
                      }
                      onClick={() => void clearShelfPause(p.id)}
                    >
                      {clearPauseBusyId === p.id ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                          Clearing…
                        </>
                      ) : (
                        'Clear shelf pause'
                      )}
                    </Button>
                  ) : null}
                </div>
                {paused && p.availableNfts < minNeed ? (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                    Deposit more NFTs on this shelf before clearing pause (need at least {minNeed}).
                  </p>
                ) : null}
              </div>
            )
          })}
          {clearPauseError ? (
            <p className="text-xs text-destructive" role="alert">
              {clearPauseError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">{shelfLabel}</p>
        <p className="mt-1">
          Jackpot pool (ledger): {formatJackpotPoolSol(jackpotPoolSol)} SOL · Prize NFTs on shelf:{' '}
          {shelfNfts}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Shared vault SOL: {vaultSolBalance != null ? vaultSolBalance.toFixed(4) : '—'} · Shared
          vault {OWL_TICKER}:{' '}
          {vaultOwlBalance != null
            ? vaultOwlBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : '—'}
        </p>
      </div>

      <AdminPacksVaultFundingForm
        embedded
        vaultAddress={vaultAddress}
        vaultSolBalance={vaultSolBalance}
        vaultOwlBalance={vaultOwlBalance}
        productId={activeProductId}
        productSlug={activeSlug}
        shelfLabel={shelfLabel}
        jackpotPoolSol={jackpotPoolSol}
        onDeposited={onRefresh}
      />

      <hr className="border-border/60" />

      <AdminPacksInventoryForm
        embedded
        vaultAddress={vaultAddress}
        inventory={inventory}
        products={products}
        owlSolPrice={owlSolPrice}
        shelfProductId={activeProductId}
        hideShelfSelector
        onRegistered={onRefresh}
      />

      <details className="group rounded-md border">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium touch-manipulation [&::-webkit-details-marker]:hidden">
          NFTs already on {shelfLabel}
          <span className="font-normal text-muted-foreground">({shelfNfts} available)</span>
        </summary>
        <div className="border-t px-3 pb-3 pt-1">
          <AdminPacksInventoryList
            key={activeProductId}
            inventory={inventory}
            products={products}
            readOnly
            lockShelfFilter={activeSlug === PACKS_PRODUCT_SLUG_OWL ? 'owl' : 'paid'}
          />
        </div>
      </details>
    </div>
  )
}
