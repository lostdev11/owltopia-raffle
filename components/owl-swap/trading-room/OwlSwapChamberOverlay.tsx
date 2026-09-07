'use client'

import { ExternalLink } from 'lucide-react'
import type { TradingRoomAsset } from '@/lib/owl-swap/trading-room-ui-state'
import { formatNftCountBadge } from '@/lib/owl-swap/trading-room-ui-state'
import { cn } from '@/lib/utils'

type Props = {
  side: 'offer' | 'receive'
  label: string
  assets: TradingRoomAsset[]
  solLamports?: number
  emptyCopy: string
  primaryActionLabel?: string
  onPrimaryAction?: () => void
  onInspect?: () => void
  loading?: boolean
  className?: string
}

function shorten(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

export function OwlSwapChamberOverlay({
  side,
  label,
  assets,
  solLamports = 0,
  emptyCopy,
  primaryActionLabel,
  onPrimaryAction,
  onInspect,
  loading = false,
  className,
}: Props) {
  const featured = assets[0]
  const isOffer = side === 'offer'
  const accent = isOffer ? 'text-theme-prime' : 'text-violet-300'
  const ring = isOffer
    ? 'border-theme-prime/50 shadow-[0_0_32px_rgba(0,255,136,0.22)]'
    : 'border-violet-400/40 shadow-[0_0_32px_rgba(167,139,250,0.2)]'
  const solSol = solLamports > 0 ? solLamports / 1_000_000_000 : 0

  return (
    <section
      className={cn('relative flex min-w-0 flex-col gap-3', className)}
      aria-label={label}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('text-xs font-semibold uppercase tracking-[0.22em]', accent)}>
          {label}
        </h3>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
            isOffer
              ? 'border-theme-prime/40 bg-theme-prime/10 text-theme-prime'
              : 'border-violet-400/40 bg-violet-500/10 text-violet-200'
          )}
        >
          {formatNftCountBadge(assets.length)}
        </span>
      </div>

      <div
        className={cn(
          'relative flex aspect-[4/5] max-h-[340px] flex-col overflow-hidden rounded-[1.75rem] border bg-gradient-to-b from-zinc-900/90 to-black/95 p-3 sm:aspect-square sm:max-h-[380px]',
          ring
        )}
      >
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading…
          </div>
        ) : featured ? (
          <>
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-black/50">
              {featured.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={featured.imageUrl}
                  alt={featured.name || 'NFT'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(0,255,136,0.12),transparent_60%)] text-sm text-zinc-500">
                  No artwork
                </div>
              )}
            </div>
            <div className="mt-3 space-y-1">
              <p className="truncate text-sm font-medium text-white">
                {featured.name || shorten(featured.mint)}
              </p>
              <p className="truncate text-xs text-zinc-400">
                {featured.collection || 'Collection unknown'}
              </p>
              {solSol > 0 ? (
                <p className="text-xs text-theme-prime/90">+ {solSol.toFixed(4)} SOL</p>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {primaryActionLabel && onPrimaryAction ? (
                <button
                  type="button"
                  onClick={onPrimaryAction}
                  className={cn(
                    'min-h-[44px] touch-manipulation text-sm font-medium underline-offset-4 hover:underline',
                    accent
                  )}
                >
                  {primaryActionLabel}
                </button>
              ) : null}
              {onInspect ? (
                <button
                  type="button"
                  onClick={onInspect}
                  className={cn(
                    'inline-flex min-h-[44px] items-center gap-1 touch-manipulation text-sm underline-offset-4 hover:underline',
                    isOffer ? 'text-zinc-300' : accent
                  )}
                >
                  Inspect NFT <ExternalLink className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <div
              className={cn(
                'flex h-24 w-24 items-center justify-center rounded-full border border-dashed',
                isOffer ? 'border-theme-prime/40 text-theme-prime/70' : 'border-violet-400/40 text-violet-300/70'
              )}
            >
              <span className="text-2xl opacity-60">◇</span>
            </div>
            <p className="text-sm text-zinc-400">{emptyCopy}</p>
            {primaryActionLabel && onPrimaryAction ? (
              <button
                type="button"
                onClick={onPrimaryAction}
                className={cn(
                  'min-h-[44px] touch-manipulation text-sm font-semibold underline-offset-4 hover:underline',
                  accent
                )}
              >
                {primaryActionLabel}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {assets.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Selected NFTs">
          {assets.map((a, i) => (
            <li
              key={a.mint}
              className={cn(
                'h-14 w-14 shrink-0 overflow-hidden rounded-lg border',
                i === 0
                  ? isOffer
                    ? 'border-theme-prime/60'
                    : 'border-violet-400/60'
                  : 'border-white/10'
              )}
            >
              {a.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-white/5" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
