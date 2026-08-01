'use client'

import { CheckCircle2, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { OwlSendSolscanTxUrl } from '@/lib/owl-send/explorer'

export type OwlSendSuccessState = {
  title: string
  detail?: string
  signature: string
} | null

type Props = {
  success: OwlSendSuccessState
  onClose: () => void
}

/** Centered success popup after NFT/token send — Solscan link + Done. */
export function OwlSendSuccessDialog({ success, onClose }: Props) {
  const open = Boolean(success?.signature)
  const href = success?.signature ? OwlSendSolscanTxUrl(success.signature) : '#'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="border-emerald-500/30 bg-[#0c100e] sm:max-w-md">
        <DialogHeader className="space-y-3 text-left">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
            <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          </div>
          <DialogTitle className="text-xl text-emerald-100">
            {success?.title ?? 'Sent successfully'}
          </DialogTitle>
          {success?.detail ? (
            <DialogDescription className="text-sm text-muted-foreground">
              {success.detail}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Transfer confirmed on Solana.</DialogDescription>
          )}
        </DialogHeader>

        {success?.signature ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">Transaction</p>
            <p className="break-all font-mono text-[11px] text-emerald-100/80">{success.signature}</p>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-theme-prime underline-offset-2 hover:underline"
            >
              View on Solscan
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" className="w-full min-h-[48px] sm:w-auto" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
