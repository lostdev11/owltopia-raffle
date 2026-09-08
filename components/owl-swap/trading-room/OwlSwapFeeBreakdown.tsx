'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatOwlSwapFeeSol, getOwlSwapFeeSol } from '@/lib/owl-swap/fee'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  feeSolLabel: string | null
  feeAvailable: boolean
  discountPercent?: number
  roleName?: string | null
  payerNote?: string
}

export function OwlSwapFeeBreakdown({
  open,
  onOpenChange,
  feeSolLabel,
  feeAvailable,
  discountPercent = 0,
  roleName = null,
  payerNote = 'The taker pays the Owl fee on accept. Network / ATA rent is separate.',
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-zinc-950 text-zinc-50">
        <DialogHeader>
          <DialogTitle>OwlSwap fees</DialogTitle>
          <DialogDescription className="text-zinc-400">{payerNote}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {feeAvailable && feeSolLabel ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                <span className="text-zinc-400">Owl fee</span>
                <span className="font-mono text-theme-prime">{feeSolLabel}</span>
              </div>
              {discountPercent > 0 ? (
                <p className="text-xs text-emerald-200/90">
                  Holder discount: {discountPercent}%
                  {roleName ? ` (${roleName})` : ''}
                </p>
              ) : (
                <p className="text-xs text-zinc-500">No holder discount applied.</p>
              )}
            </>
          ) : (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
              Fee unavailable — connect a wallet and wait for the quote before signing. We never
              show 0 as a fallback.
            </p>
          )}
          <p className="text-xs text-zinc-500">
            Base list price is typically ~{formatOwlSwapFeeSol(getOwlSwapFeeSol())} before discounts.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
