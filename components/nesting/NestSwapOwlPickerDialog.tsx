'use client'

import { useMemo, useState } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { shortenAddress } from '@/lib/nesting/format'
import type { WalletNestMintNestStatus } from '@/lib/nesting/nft-stake-eligibility'
import { cn } from '@/lib/utils'

export type NestSwapOwlPickerRow = {
  mint: string
  name: string | null
  image?: string | null
  checked: boolean
  disabled: boolean
  nestStatus?: WalletNestMintNestStatus
  statusLabel?: string | null
  statusTone?: 'warn' | 'muted'
}

type FilterChip = 'nestable' | 'opening' | 'nested' | 'blocked'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: NestSwapOwlPickerRow[]
  onToggle: (mint: string) => void
  onSelectAll: () => void
  selectAllDisabled: boolean
  onReload: () => void
  reloading: boolean
  selectedCount: number
  maxPerRun: number
  assetLabels: { singular: string; plural: string }
}

const FILTER_CHIPS: { id: FilterChip; label: string }[] = [
  { id: 'nestable', label: 'Nestable' },
  { id: 'opening', label: 'Opening' },
  { id: 'nested', label: 'Nested' },
  { id: 'blocked', label: 'Blocked' },
]

function rowMatchesFilter(row: NestSwapOwlPickerRow, filter: FilterChip): boolean {
  const status = row.nestStatus ?? (row.disabled ? 'nested' : 'not_nested')
  if (filter === 'nestable') return status === 'not_nested'
  return status === filter
}

/** Jupiter-token-list-style picker: choose which owls to nest, one row per NFT. */
export function NestSwapOwlPickerDialog({
  open,
  onOpenChange,
  rows,
  onToggle,
  onSelectAll,
  selectAllDisabled,
  onReload,
  reloading,
  selectedCount,
  maxPerRun,
  assetLabels,
}: Props) {
  const [filter, setFilter] = useState<FilterChip>('nestable')

  const capitalizedPlural =
    assetLabels.plural.charAt(0).toUpperCase() + assetLabels.plural.slice(1)

  const counts = useMemo(() => {
    const c: Record<FilterChip, number> = {
      nestable: 0,
      opening: 0,
      nested: 0,
      blocked: 0,
    }
    for (const row of rows) {
      const status = row.nestStatus ?? (row.disabled ? 'nested' : 'not_nested')
      if (status === 'not_nested') c.nestable++
      else if (status === 'opening') c.opening++
      else if (status === 'nested') c.nested++
      else if (status === 'blocked') c.blocked++
    }
    return c
  }, [rows])

  const visibleRows = useMemo(
    () => rows.filter((row) => rowMatchesFilter(row, filter)),
    [rows, filter]
  )

  const nestableCount = counts.nestable
  const needsBatching = nestableCount > maxPerRun
  const selectBatchLabel = needsBatching
    ? `Select ${maxPerRun}`
    : nestableCount === 1
      ? 'Select 1'
      : 'Select all'

  const hintText =
    selectedCount > 0
      ? needsBatching
        ? `${selectedCount} of ${nestableCount} selected · confirm this batch, then pick more`
        : `${selectedCount} selected · ready to confirm`
      : needsBatching
        ? `Wallet limit: nest up to ${maxPerRun} at a time (${nestableCount} nestable). Confirm each batch, then select again.`
        : `Tap ${assetLabels.plural} to select · up to ${maxPerRun} per confirm`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,40rem)] max-w-[min(94vw,26rem)] flex-col gap-0 overflow-hidden rounded-2xl border-emerald-500/20 bg-[#0c100e] p-0">
        {/* Keep Select all below/clear of DialogContent’s absolute 44px close hit target */}
        <DialogHeader className="shrink-0 border-b border-white/[0.06] p-4 pb-3 pr-12">
          <DialogTitle className="text-left text-base pr-2">
            Select {assetLabels.plural}
          </DialogTitle>
          <p className="pt-1 text-xs leading-snug text-muted-foreground">{hintText}</p>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[44px] touch-manipulation px-2.5 text-xs font-semibold text-theme-prime disabled:opacity-40"
              disabled={selectAllDisabled || filter !== 'nestable'}
              onClick={onSelectAll}
              aria-label={
                needsBatching
                  ? `Select first ${maxPerRun} nestable ${assetLabels.plural}`
                  : `Select all nestable ${assetLabels.plural}`
              }
            >
              {selectBatchLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[44px] min-w-[44px] touch-manipulation p-0 text-muted-foreground"
              aria-label={`Reload ${assetLabels.plural}`}
              disabled={reloading}
              onClick={onReload}
            >
              <RefreshCw className={cn('h-4 w-4', reloading && 'animate-spin')} aria-hidden />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2" role="tablist" aria-label="Filter by nest status">
            {FILTER_CHIPS.map((chip) => {
              const count = counts[chip.id]
              const active = filter === chip.id
              return (
                <button
                  key={chip.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    'min-h-[36px] touch-manipulation rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    active
                      ? 'bg-emerald-500/20 text-theme-prime ring-1 ring-emerald-500/40'
                      : 'bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]'
                  )}
                  onClick={() => setFilter(chip.id)}
                >
                  {chip.label}
                  <span className="ml-1 tabular-nums opacity-80">{count}</span>
                </button>
              )
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {reloading ? (
            <div className="flex min-h-[96px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading your {assetLabels.plural}…
            </div>
          ) : visibleRows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground leading-relaxed">
              {rows.length === 0
                ? `No ${assetLabels.plural} found in this wallet.`
                : `No ${filter === 'nestable' ? 'nestable' : filter} ${assetLabels.plural} here.`}
            </p>
          ) : (
            <ul className="space-y-1" role="list">
              {visibleRows.map((row) => (
                <li key={row.mint}>
                  <button
                    type="button"
                    disabled={row.disabled}
                    aria-pressed={row.checked}
                    onClick={() => onToggle(row.mint)}
                    className={cn(
                      'flex min-h-[56px] w-full touch-manipulation items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                      row.disabled
                        ? 'cursor-not-allowed opacity-55'
                        : row.checked
                          ? 'bg-emerald-500/12 ring-1 ring-emerald-500/40'
                          : 'hover:bg-white/[0.06] active:bg-white/[0.09]'
                    )}
                  >
                    <NestingStakedAssetThumb
                      mint={row.mint}
                      hintImageUrl={row.image ?? null}
                      name={row.name ?? null}
                      size="md"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {(row.name?.trim() && row.name.trim().slice(0, 88)) || assetLabels.singular}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {shortenAddress(row.mint, 6)}
                      </span>
                      {row.statusLabel ? (
                        <span
                          className={cn(
                            'mt-0.5 block truncate text-[11px] font-medium leading-snug',
                            row.statusTone === 'warn' ? 'text-amber-400/95' : 'text-muted-foreground'
                          )}
                        >
                          {row.statusLabel}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                        row.checked
                          ? 'border-emerald-400 bg-emerald-400 text-black'
                          : 'border-white/15 text-transparent'
                      )}
                      aria-hidden
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.06] p-3">
          <Button
            type="button"
            className="min-h-[48px] w-full touch-manipulation rounded-xl font-semibold"
            onClick={() => onOpenChange(false)}
          >
            {selectedCount > 0
              ? needsBatching
                ? `Done — nest these ${selectedCount}`
                : `Done — ${selectedCount} ${selectedCount === 1 ? assetLabels.singular : assetLabels.plural}`
              : 'Close'}
          </Button>
          <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
            {needsBatching
              ? selectedCount > 0
                ? `Confirm nest for this batch, then come back for the remaining ${Math.max(0, nestableCount - selectedCount)}.`
                : `Larger flocks nest in batches of ${maxPerRun} — wallet size limit.`
              : `${capitalizedPlural} already nested or frozen elsewhere can&apos;t be selected.`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
