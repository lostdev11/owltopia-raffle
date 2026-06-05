'use client'

import { ExternalLink, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RaffleWinnerPngButton } from '@/components/RaffleWinnerPngButton'

export type ClaimSuccessOverlayProps = {
  open: boolean
  heading?: string
  message: string
  /** When omitted or empty, the Solscan link is hidden. */
  transactionSignature?: string | null
  solscanUrl: (signature: string) => string
  winnerPng?: {
    title: string
    slug: string
    winnerWallet: string
    imageUrl?: string | null
  }
  onClose: () => void
}

export function ClaimSuccessOverlay({
  open,
  heading = 'Prize claimed!',
  message,
  transactionSignature,
  solscanUrl,
  winnerPng,
  onClose,
}: ClaimSuccessOverlayProps) {
  if (!open) return null

  const tx = transactionSignature?.trim() ?? ''

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/90 backdrop-blur-sm p-4 safe-area-bottom"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="claim-success-overlay-title"
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg space-y-4 text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        >
          <Trophy className="h-8 w-8" />
        </div>
        <h2 id="claim-success-overlay-title" className="text-lg font-semibold text-foreground">
          {heading}
        </h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        {tx ? (
          <Button type="button" variant="secondary" className="w-full min-h-[44px] touch-manipulation" asChild>
            <a href={solscanUrl(tx)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              View transaction on Solscan
            </a>
          </Button>
        ) : null}
        {winnerPng ? (
          <RaffleWinnerPngButton
            title={winnerPng.title}
            slug={winnerPng.slug}
            imageUrl={winnerPng.imageUrl}
            winnerWallet={winnerPng.winnerWallet}
            buttonLabel="Download winner PNG"
            fullWidth
          />
        ) : null}
        <Button type="button" className="w-full min-h-[44px] touch-manipulation" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}
