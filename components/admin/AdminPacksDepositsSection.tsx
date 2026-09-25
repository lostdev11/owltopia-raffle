'use client'

import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  AdminPacksInventoryForm,
  type AdminPackProductShelf,
  type AdminPacksInventoryItem,
} from '@/components/admin/AdminPacksInventoryForm'
import { AdminPacksVaultFundingForm } from '@/components/admin/AdminPacksVaultFundingForm'
import {
  PACKS_PRODUCT_SLUG_MAIN,
  PACKS_PRODUCT_SLUG_OWL,
} from '@/lib/packs/product-pools'
import { formatJackpotPoolSol } from '@/lib/packs/jackpot'
import { OWL_TICKER } from '@/lib/council/owl-ticker'

export type AdminPackProductShelfWithJackpot = AdminPackProductShelf & {
  jackpotPoolSol?: number
}

function shelfShortLabel(slug: string): string {
  return slug === PACKS_PRODUCT_SLUG_OWL ? '$OWL pack shelf' : '0.1 SOL pack shelf'
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
    </div>
  )
}
