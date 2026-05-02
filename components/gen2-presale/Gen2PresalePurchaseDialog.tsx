'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type Gen2PresalePurchaseReceiptPhase = 'recording' | 'success' | 'failed'

export type Gen2PresalePurchaseReceiptLine = { id: string; label: string }

export type Gen2PresalePurchaseReceiptState = {
  phase: Gen2PresalePurchaseReceiptPhase
  quantity: number
  lines: Gen2PresalePurchaseReceiptLine[]
  txSignature?: string
  explorerUrl?: string | null
  errorMessage?: string | null
  /** Payment was already confirmed server-side (idempotent retry). */
  duplicate?: boolean
}

type Props = {
  open: boolean
  receipt: Gen2PresalePurchaseReceiptState | null
  onOpenChange: (open: boolean) => void
}

const STAGGER_MS = 95
const SUCCESS_HOLD_MS = 2200

export function buildSpotLines(quantity: number): Gen2PresalePurchaseReceiptLine[] {
  const q = Math.max(1, Math.floor(quantity))
  const maxRows = 12
  if (q <= maxRows) {
    return Array.from({ length: q }, (_, i) => ({
      id: `spot-${i}`,
      label: q === 1 ? 'Gen2 presale spot' : `Presale spot ${i + 1}`,
    }))
  }
  const head = maxRows - 1
  const lines: Gen2PresalePurchaseReceiptLine[] = Array.from({ length: head }, (_, i) => ({
    id: `spot-${i}`,
    label: `Presale spot ${i + 1}`,
  }))
  lines.push({
    id: 'spot-more',
    label: `+ ${q - head} more spot${q - head === 1 ? '' : 's'}`,
  })
  return lines
}

export function Gen2PresalePurchaseDialog({ open, receipt, onOpenChange }: Props) {
  const phase = receipt?.phase ?? 'recording'
  const lines = receipt?.lines ?? []
  const totalSpots = receipt?.quantity ?? 0
  const [revealedCount, setRevealedCount] = useState(0)

  const title =
    phase === 'recording'
      ? 'Confirming your presale'
      : phase === 'success'
        ? 'Presale spots confirmed'
        : 'Could not save yet'

  const description = useMemo(() => {
    if (phase === 'recording') {
      return 'Your payment is on-chain. Recording your spots in Owltopia…'
    }
    if (phase === 'success') {
      if (receipt?.duplicate) {
        return 'This payment was already recorded — your Gen2 balance already includes these spots.'
      }
      const n = totalSpots
      return n === 1
        ? '1 Gen2 presale spot is saved to your wallet balance below.'
        : `${n} Gen2 presale spots are saved to your wallet balance below.`
    }
    return (
      receipt?.errorMessage ??
      'Something went wrong while saving. Check the message on the page or refresh. If payment went through, support can reconcile using your transaction signature.'
    )
  }, [phase, receipt?.duplicate, receipt?.errorMessage, totalSpots])

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
    return () => window.clearTimeout(t)
  }, [open, phase, lines.length, revealedCount, onOpenChange])

  const blockDismiss = phase === 'recording'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(85dvh,520px)] flex flex-col gap-0 p-0 sm:max-w-md touch-manipulation border-[#1F6F54] bg-[#10161C] text-[#EAFBF4]"
        onPointerDownOutside={blockDismiss ? e => e.preventDefault() : undefined}
        onEscapeKeyDown={blockDismiss ? e => e.preventDefault() : undefined}
        aria-busy={blockDismiss}
      >
        <DialogHeader className="shrink-0 space-y-1.5 border-b border-[#1F6F54] p-4 pb-2 text-left sm:p-5">
          <DialogTitle className="text-lg text-[#EAFBF4]">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-snug text-[#A9CBB9]">{description}</DialogDescription>
          {phase === 'success' && totalSpots > 0 ? (
            <p
              className="rounded-md border border-[#00E58B]/35 bg-[#00E58B]/10 px-3 py-2 text-sm font-medium text-[#00FF9C]"
              role="status"
            >
              {receipt?.duplicate
                ? 'Your wallet balance already reflected this payment — nothing else to do.'
                : "You're in — your Gen2 balance on this page updates with this purchase."}
            </p>
          ) : null}
        </DialogHeader>

        <ul
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 sm:px-5"
          role="list"
          aria-label="Presale spots in this purchase"
        >
          {lines.map((line, rowIndex) => {
            const showCheck = phase === 'success' && revealedCount > rowIndex
            const showSpinner = phase === 'recording' || (phase === 'success' && !showCheck)

            return (
              <li
                key={line.id}
                className="flex items-center gap-3 rounded-lg border border-[#1F6F54] bg-[#151D24]/90 p-2.5 pr-3"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#00E58B]/25 bg-[#10161C] text-[#00FF9C]">
                  <Sparkles className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#EAFBF4] break-words">{line.label}</p>
                  <p className="mt-0.5 text-xs text-[#A9CBB9]">Owltopia Gen2 presale</p>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden>
                  {phase === 'failed' ? (
                    <AlertCircle className="h-6 w-6 text-red-400" />
                  ) : showCheck ? (
                    <CheckCircle2 className="h-6 w-6 text-[#00FF9C]" />
                  ) : showSpinner ? (
                    <Loader2 className="h-6 w-6 animate-spin text-[#A9CBB9]" />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>

        {phase !== 'recording' ? (
          <DialogFooter className="shrink-0 flex-col gap-2 border-t border-[#1F6F54] p-4 pt-2 sm:flex-row sm:p-5">
            {phase === 'success' && (receipt?.explorerUrl || receipt?.txSignature) ? (
              <p className="w-full text-center text-xs text-[#A9CBB9] sm:text-left">
                {receipt.explorerUrl ? (
                  <Link
                    href={receipt.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#00FF9C] underline underline-offset-2"
                  >
                    View transaction
                  </Link>
                ) : (
                  <span className="font-mono text-[10px] text-[#EAFBF4]">{receipt.txSignature}</span>
                )}
              </p>
            ) : null}
            {phase === 'success' ? (
              <p className="mr-auto w-full text-center text-xs text-[#A9CBB9] sm:text-left">Closing automatically…</p>
            ) : null}
            <Button
              type="button"
              variant={phase === 'success' ? 'outline' : 'default'}
              className="h-11 min-h-[44px] w-full border-[#1F6F54] bg-[#151D24] text-[#EAFBF4] hover:bg-[#1a2630] sm:w-auto"
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
