'use client'

import { useEffect, useState } from 'react'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { cn } from '@/lib/utils'

export type StakedNftNestGalleryItem = {
  position: StakingPositionRow
  poolName: string
  walletHint?: { name?: string | null; image?: string | null } | null
}

type Props = {
  items: StakedNftNestGalleryItem[]
  className?: string
}

function nestGalleryAnchorId(positionId: string) {
  return `nest-position-${positionId}`
}

export function scrollToNestPosition(positionId: string) {
  const el = document.getElementById(nestGalleryAnchorId(positionId))
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function StakedNftGalleryTile({
  position,
  poolName,
  walletHint,
}: StakedNftNestGalleryItem) {
  const mint = position.asset_identifier!.trim()
  const [dasNftName, setDasNftName] = useState<string | null>(null)

  useEffect(() => {
    setDasNftName(null)
  }, [mint])

  const caption = (dasNftName ?? walletHint?.name ?? '').trim() || poolName
  const ariaLabel =
    position.status === 'pending'
      ? `Opening nest for ${caption}`
      : `View nest details for ${caption}`

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => scrollToNestPosition(position.id)}
        className={cn(
          'group flex w-full flex-col gap-2 rounded-xl border border-transparent bg-background/40 p-2 text-left transition-colors',
          'min-h-[44px] touch-manipulation hover:border-border/80 hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
        )}
        aria-label={ariaLabel}
      >
        <NestingStakedAssetThumb
          mint={mint}
          hintImageUrl={walletHint?.image}
          hintName={walletHint?.name ?? null}
          onResolvedMintMeta={(meta) => {
            if (meta.name?.trim()) setDasNftName(meta.name.trim())
          }}
          size="lg"
          className="mx-auto w-full max-w-[11rem] shadow-sm group-hover:shadow-md transition-shadow"
        />
        <span className="line-clamp-2 text-center text-[11px] font-medium leading-snug text-foreground sm:text-xs">
          {caption}
        </span>
        {caption.trim() !== poolName.trim() ? (
          <span className="line-clamp-1 text-center text-[10px] text-muted-foreground">{poolName}</span>
        ) : null}
        {position.status === 'pending' ? (
          <span className="text-center text-[10px] font-medium uppercase tracking-wide text-amber-500/90">
            Opening…
          </span>
        ) : null}
      </button>
    </li>
  )
}

/** Grid of staked NFT artwork; tapping a tile scrolls to the full position card. */
export function StakedNftNestGallery({ items, className }: Props) {
  if (items.length === 0) return null

  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-muted/20 p-3 sm:p-4 touch-manipulation',
        className
      )}
    >
      <div className="mb-3 px-0.5">
        <h3 className="text-sm font-semibold text-foreground">Staked NFT gallery</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          Tap an owl to jump to rewards and leaving that nest.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" role="list">
        {items.map((item) => (
          <StakedNftGalleryTile key={item.position.id} {...item} />
        ))}
      </ul>
    </div>
  )
}

export { nestGalleryAnchorId }
