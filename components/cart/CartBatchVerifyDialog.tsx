'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, Loader2, Ticket } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'

export type CartBatchReceiptLine = {
  raffleId: string
  title: string
  slug: string
  quantity: number
  image_url?: string | null
  image_fallback_url?: string | null
}

export type CartBatchReceiptPhase = 'verifying' | 'success' | 'pending_async' | 'failed'

export type CartBatchReceiptState = {
  lines: CartBatchReceiptLine[]
  phase: CartBatchReceiptPhase
}

type CartBatchVerifyDialogProps = {
  open: boolean
  receipt: CartBatchReceiptState | null
  onOpenChange: (open: boolean) => void
}

function ReceiptLineThumbnail({
  imageUrl,
  imageFallbackUrl,
}: {
  imageUrl: string | null | undefined
  imageFallbackUrl: string | null | undefined
}) {
  const primary = getRaffleDisplayImageUrl(imageUrl)
  const fallback = getRaffleDisplayImageUrl(imageFallbackUrl)
  const [phase, setPhase] = useState<'primary' | 'fallback' | 'dead'>(() =>
    primary ? 'primary' : fallback ? 'fallback' : 'dead'
  )

  useEffect(() => {
    setPhase(primary ? 'primary' : fallback ? 'fallback' : 'dead')
  }, [primary, fallback])

  const src = phase === 'primary' ? primary : phase === 'fallback' ? fallback : null

  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => {
            setPhase(p => {
              if (p === 'primary' && fallback) return 'fallback'
              return 'dead'
            })
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground" aria-hidden>
          <Ticket className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}

const STAGGER_MS = 95
const SUCCESS_HOLD_MS = 2200

export function CartBatchVerifyDialog({ open, receipt, onOpenChange }: CartBatchVerifyDialogProps) {
  const lines = receipt?.lines ?? []
  const phase = receipt?.phase ?? 'verifying'
  const totalTickets = lines.reduce((s, l) => s + Math.max(0, Math.floor(l.quantity)), 0)
  const [revealedCount, setRevealedCount] = useState(0)

  useEffect(() => {
    if (!open || !receipt || receipt.phase !== 'success' || receipt.lines.length === 0) {
      setRevealedCount(0)
      return
    }
    setRevealedCount(0)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setRevealedCount(Math.min(i, receipt.lines.length))
      if (i >= receipt.lines.length) clearInterval(id)
    }, STAGGER_MS)
    return () => clearInterval(id)
  }, [open, receipt])

  useEffect(() => {
    if (!open || phase !== 'success' || lines.length === 0) return
    if (revealedCount < lines.length) return
    const t = window.setTimeout(() => onOpenChange(false), SUCCESS_HOLD_MS)
    return () => clearTimeout(t)
  }, [open, phase, lines.length, revealedCount, onOpenChange])

  const title =
    phase === 'verifying'
      ? 'Confirming your tickets'
      : phase === 'success'
        ? 'Tickets purchased successfully'
        : phase === 'pending_async'
          ? 'Almost there'
          : 'Could not confirm yet'

  const description =
    phase === 'verifying'
      ? 'Your payment went through. Verifying each raffle on our servers…'
      : phase === 'success'
        ? totalTickets > 0
          ? `${totalTickets === 1 ? '1 ticket is' : `${totalTickets} tickets are`} confirmed across ${lines.length === 1 ? 'this raffle' : `these ${lines.length} raffles`}. Counts on each raffle page update below.`
          : 'Your purchase is confirmed. Counts on each raffle page will update.'
        : phase === 'pending_async'
          ? 'Your payment is on-chain. Confirmation can take a little longer — counts update automatically when ready.'
          : 'Your cart was restored. Check the message on the cart or refresh the page. If payment went through, tickets may still appear shortly.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(85dvh,520px)] flex flex-col gap-0 p-0 sm:max-w-md touch-manipulation"
        onPointerDownOutside={phase === 'verifying' ? e => e.preventDefault() : undefined}
        onEscapeKeyDown={phase === 'verifying' ? e => e.preventDefault() : undefined}
        aria-busy={phase === 'verifying'}
      >
        <DialogHeader className="p-4 sm:p-5 pb-2 shrink-0 border-b border-border text-left space-y-1.5">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-snug">{description}</DialogDescription>
          {phase === 'success' && totalTickets > 0 ? (
            <p
              className="rounded-md border border-green-500/35 bg-green-500/10 px-3 py-2 text-sm font-medium text-green-700 dark:text-green-400"
              role="status"
            >
              You&apos;re in — your ticket totals on each raffle now include this purchase.
            </p>
          ) : null}
        </DialogHeader>

        <ul
          className="overflow-y-auto min-h-0 flex-1 px-4 sm:px-5 py-3 space-y-2"
          role="list"
          aria-label="Raffles in this checkout"
        >
          {lines.map((line, rowIndex) => {
            const showCheck = phase === 'success' && revealedCount > rowIndex
            const showSpinner = phase === 'verifying' || (phase === 'success' && !showCheck)

            return (
              <li
                key={line.raffleId}
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2.5 pr-3"
              >
                <ReceiptLineThumbnail imageUrl={line.image_url} imageFallbackUrl={line.image_fallback_url} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/raffles/${encodeURIComponent(line.slug)}`}
                    className="font-medium text-sm hover:underline break-words line-clamp-2"
                    onClick={e => {
                      if (phase === 'verifying') e.preventDefault()
                    }}
                  >
                    {line.title}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {line.quantity === 1 ? '1 ticket' : `${line.quantity} tickets`}
                  </p>
                </div>
                <div className="shrink-0 w-9 h-9 flex items-center justify-center" aria-hidden>
                  {phase === 'failed' ? (
                    <AlertCircle className="h-6 w-6 text-destructive" />
                  ) : phase === 'pending_async' ? (
                    <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                  ) : showCheck ? (
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  ) : showSpinner ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>

        {phase !== 'verifying' ? (
          <DialogFooter className="p-4 sm:p-5 pt-2 shrink-0 border-t border-border flex-col sm:flex-row gap-2">
            {phase === 'success' ? (
              <p className="text-xs text-muted-foreground w-full text-center sm:text-left mr-auto">
                Closing automatically…
              </p>
            ) : null}
            <Button
              type="button"
              variant={phase === 'success' ? 'outline' : 'default'}
              className="w-full sm:w-auto min-h-[44px]"
              onClick={() => onOpenChange(false)}
            >
              {phase === 'success' ? 'Close now' : 'Got it'}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
