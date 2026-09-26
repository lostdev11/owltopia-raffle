'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  packAdminInventoryMatchesShelfFilter,
  packAdminInventoryShelfSummary,
  packAdminInventoryStatusLabel,
  packAdminShelfBadgeClassName,
  packAdminShelfBadgeLabel,
  packAdminShelfSlugForInventoryRow,
  type PackAdminInventoryShelfFilter,
  type PackAdminProductRef,
} from '@/lib/packs/admin-inventory-shelf'
import { packNftBandLabel } from '@/lib/packs/ev-simulator'
import { packInventoryPrizeStandardLabel } from '@/lib/packs/types'

export type AdminPacksInventoryListItem = {
  id: string
  product_id?: string
  mint_address: string
  name: string | null
  image_url?: string | null
  fair_value_sol: number
  prize_standard?: string | null
  odds_tier?: string | null
  status: string
}

function shortenMint(mint: string): string {
  const t = mint.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

function ShelfCountsLine({
  label,
  counts,
}: {
  label: string
  counts: { available: number; outOfPool: number; total: number }
}) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground/90">{label}</span>
      {' · '}
      {counts.available} available
      {counts.outOfPool > 0 ? ` · ${counts.outOfPool} won / reserved / removed` : ''}
      {counts.total === 0 ? ' · empty' : ''}
    </p>
  )
}

function InventoryRow({
  item,
  productSlug,
  readOnly,
  busy,
  onRemove,
  onSetOddsTier,
}: {
  item: AdminPacksInventoryListItem
  productSlug: string
  readOnly?: boolean
  busy?: boolean
  onRemove?: (id: string) => void
  onSetOddsTier?: (id: string, odds_tier: 'standard' | 'premium_1pct') => void
}) {
  const band = packNftBandLabel(Number(item.fair_value_sol), productSlug)
  const shelfLabel = packAdminShelfBadgeLabel(productSlug)
  const badgeClass = packAdminShelfBadgeClassName(productSlug)

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 gap-3">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
            NFT
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{item.name || 'NFT'}</p>
            <span
              className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}
            >
              {shelfLabel}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground" title={item.mint_address}>
            {shortenMint(item.mint_address)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Floor {Number(item.fair_value_sol).toFixed(4)} SOL
            {band ? ` · ${band} band` : ''}
            {' · '}
            {packInventoryPrizeStandardLabel(item.prize_standard)}
            {item.odds_tier === 'premium_1pct' ? ' · 1% tier' : ''}
          </p>
          <p className="text-xs text-muted-foreground">{packAdminInventoryStatusLabel(item.status)}</p>
        </div>
      </div>
      {!readOnly && item.status === 'available' && (onRemove || onSetOddsTier) ? (
        <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
          {onSetOddsTier ? (
            <Button
              size="sm"
              variant={item.odds_tier === 'premium_1pct' ? 'default' : 'outline'}
              className="min-h-[44px] touch-manipulation"
              disabled={busy}
              onClick={() =>
                void onSetOddsTier(
                  item.id,
                  item.odds_tier === 'premium_1pct' ? 'standard' : 'premium_1pct'
                )
              }
            >
              {item.odds_tier === 'premium_1pct' ? '1% on' : '1% off'}
            </Button>
          ) : null}
          {onRemove ? (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[44px] touch-manipulation"
              disabled={busy}
              onClick={() => void onRemove(item.id)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function FilteredInventoryList(props: {
  filter: PackAdminInventoryShelfFilter
  inventory: AdminPacksInventoryListItem[]
  products: PackAdminProductRef[]
  readOnly?: boolean
  busy?: boolean
  onRemove?: (id: string) => void
  onSetOddsTier?: (id: string, odds_tier: 'standard' | 'premium_1pct') => void
}) {
  const rows = useMemo(
    () =>
      props.inventory.filter((row) =>
        packAdminInventoryMatchesShelfFilter(row, props.products, props.filter)
      ),
    [props.filter, props.inventory, props.products]
  )

  if (rows.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">No NFTs on this shelf.</p>
  }

  return (
    <ul className="divide-y">
      {rows.map((item) => {
        const slug = packAdminShelfSlugForInventoryRow(item, props.products)
        return (
          <InventoryRow
            key={item.id}
            item={item}
            productSlug={slug}
            readOnly={props.readOnly}
            busy={props.busy}
            onRemove={props.onRemove}
            onSetOddsTier={props.onSetOddsTier}
          />
        )
      })}
    </ul>
  )
}

export function AdminPacksInventoryList({
  inventory,
  products,
  readOnly = false,
  busy = false,
  onRemove,
  onSetOddsTier,
  defaultFilter = 'all',
  /** When set, hide tabs and always show this shelf (e.g. unified Deposits panel). */
  lockShelfFilter,
}: {
  inventory: AdminPacksInventoryListItem[]
  products: PackAdminProductRef[]
  readOnly?: boolean
  busy?: boolean
  onRemove?: (id: string) => void
  onSetOddsTier?: (id: string, odds_tier: 'standard' | 'premium_1pct') => void
  defaultFilter?: PackAdminInventoryShelfFilter
  lockShelfFilter?: PackAdminInventoryShelfFilter
}) {
  const [filter, setFilter] = useState<PackAdminInventoryShelfFilter>(
    lockShelfFilter ?? defaultFilter
  )
  const activeFilter = lockShelfFilter ?? filter
  const summary = useMemo(
    () => packAdminInventoryShelfSummary(inventory, products),
    [inventory, products]
  )

  const lockedCounts =
    lockShelfFilter === 'owl'
      ? summary.owl
      : lockShelfFilter === 'paid'
        ? summary.paid
        : null

  return (
    <div className="space-y-3">
      {!lockShelfFilter ? (
        <p className="text-xs text-muted-foreground">
          Each row shows which prize shelf the NFT is registered to (
          <span className="font-medium">$OWL shelf</span> ={' '}
          <span className="font-mono text-[10px]">owl-pack-owl-v1</span>,{' '}
          <span className="font-medium">Paid 0.1 SOL shelf</span> ={' '}
          <span className="font-mono text-[10px]">owl-pack-v1</span>).
          {!readOnly ? ' Remove only unlists the row — it does not send the NFT back from the vault.' : null}
        </p>
      ) : null}

      {lockShelfFilter && lockedCounts ? (
        <ShelfCountsLine
          label={packAdminShelfBadgeLabel(
            lockShelfFilter === 'owl' ? 'owl-pack-owl-v1' : 'owl-pack-v1'
          )}
          counts={lockedCounts}
        />
      ) : (
        <div className="space-y-1 rounded-md border bg-muted/20 p-3">
          <ShelfCountsLine label="All shelves" counts={summary.all} />
          <ShelfCountsLine label="$OWL shelf" counts={summary.owl} />
          <ShelfCountsLine label="Paid 0.1 SOL shelf" counts={summary.paid} />
        </div>
      )}

      {lockShelfFilter ? (
        <FilteredInventoryList
          filter={lockShelfFilter}
          inventory={inventory}
          products={products}
          readOnly={readOnly}
          busy={busy}
          onRemove={onRemove}
          onSetOddsTier={onSetOddsTier}
        />
      ) : (
        <Tabs
          value={activeFilter}
          onValueChange={(v) => setFilter(v as PackAdminInventoryShelfFilter)}
        >
          <TabsList className="h-auto w-full flex-wrap gap-1 p-1">
            <TabsTrigger value="all" className="min-h-[44px] flex-1 touch-manipulation sm:flex-none">
              All ({summary.all.total})
            </TabsTrigger>
            <TabsTrigger value="owl" className="min-h-[44px] flex-1 touch-manipulation sm:flex-none">
              $OWL ({summary.owl.available} avail)
            </TabsTrigger>
            <TabsTrigger value="paid" className="min-h-[44px] flex-1 touch-manipulation sm:flex-none">
              Paid ({summary.paid.available} avail)
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-3">
            <FilteredInventoryList
              filter="all"
              inventory={inventory}
              products={products}
              readOnly={readOnly}
              busy={busy}
              onRemove={onRemove}
              onSetOddsTier={onSetOddsTier}
            />
          </TabsContent>
          <TabsContent value="owl" className="mt-3">
            <FilteredInventoryList
              filter="owl"
              inventory={inventory}
              products={products}
              readOnly={readOnly}
              busy={busy}
              onRemove={onRemove}
              onSetOddsTier={onSetOddsTier}
            />
          </TabsContent>
          <TabsContent value="paid" className="mt-3">
            <FilteredInventoryList
              filter="paid"
              inventory={inventory}
              products={products}
              readOnly={readOnly}
              busy={busy}
              onRemove={onRemove}
              onSetOddsTier={onSetOddsTier}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
