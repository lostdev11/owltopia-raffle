'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { TradingRoomAsset } from '@/lib/owl-swap/trading-room-ui-state'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assets: TradingRoomAsset[]
  initialIndex?: number
  accent?: 'offer' | 'receive'
}

function shorten(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

export function OwlSwapNftInspectDialog({
  open,
  onOpenChange,
  assets,
  initialIndex = 0,
  accent = 'offer',
}: Props) {
  const [index, setIndex] = useState(initialIndex)

  useEffect(() => {
    if (open) setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, assets.length - 1)))
  }, [open, initialIndex, assets.length])

  const asset = assets[index]
  const accentClass = accent === 'offer' ? 'text-theme-prime' : 'text-violet-300'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-zinc-950 text-zinc-50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={cn('font-display tracking-wide', accentClass)}>
            Inspect NFT
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Display metadata is untrusted — ownership is verified on deposit / settle.
          </DialogDescription>
        </DialogHeader>
        {asset ? (
          <div className="space-y-4">
            <div className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/60">
              {asset.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.imageUrl}
                  alt={asset.name || 'NFT'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  No artwork
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-lg font-medium text-white">{asset.name || 'Untitled'}</p>
              <p className="text-sm text-zinc-400">{asset.collection || 'Unknown collection'}</p>
              <p className="font-mono text-xs text-zinc-500">{shorten(asset.mint)}</p>
            </div>
            {assets.length > 1 ? (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] touch-manipulation"
                  disabled={index <= 0}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="text-xs text-zinc-400">
                  {index + 1} / {assets.length}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] touch-manipulation"
                  disabled={index >= assets.length - 1}
                  onClick={() => setIndex((i) => Math.min(assets.length - 1, i + 1))}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
            <a
              href={`https://solscan.io/token/${asset.mint}`}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'inline-flex min-h-[44px] items-center gap-2 text-sm touch-manipulation underline-offset-4 hover:underline',
                accentClass
              )}
            >
              View on Solscan <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No assets to inspect.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
