'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

export type EscrowDepositProgressDialogProps = {
  open: boolean
  title: string
  description: string
}

/**
 * Non-dismissible progress dialog for escrow deposit + server verify (wallet signing can take a long time;
 * after signing, RPC/server steps need clear copy on mobile).
 */
export function EscrowDepositProgressDialog({
  open,
  title,
  description,
}: EscrowDepositProgressDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md touch-manipulation [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-left">{title}</DialogTitle>
          <DialogDescription className="sr-only">Deposit and verification in progress</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 text-left" role="status" aria-live="polite">
          <Loader2
            className="h-5 w-5 shrink-0 animate-spin text-foreground mt-0.5"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
