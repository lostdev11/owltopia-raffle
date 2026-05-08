'use client'

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertCircle, Loader2 } from 'lucide-react'

export type EscrowDepositProgressDialogProps = {
  open: boolean
  title: string
  description: ReactNode
  /** Default: spinner + loading copy. Use `result` for in-app messages that replaced blocking alerts. */
  phase?: 'loading' | 'result'
  /** When set, shown as the primary action (e.g. navigate to raffle). Dialog stays until tapped. */
  primaryAction?: { label: string; onClick: () => void }
}

/**
 * Non-dismissible progress dialog for escrow deposit + server verify (wallet signing can take a long time;
 * after signing, RPC/server steps need clear copy on mobile).
 */
export function EscrowDepositProgressDialog({
  open,
  title,
  description,
  phase = 'loading',
  primaryAction,
}: EscrowDepositProgressDialogProps) {
  const isLoading = phase === 'loading'

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md touch-manipulation [&>button]:hidden"
        onPointerDownOutside={(e) => {
          if (!primaryAction) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (!primaryAction) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-left">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {isLoading ? 'Deposit and verification in progress' : 'Deposit or verification needs attention'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-left">
          <div className="flex gap-3" role="status" aria-live="polite">
            {isLoading ? (
              <Loader2
                className="h-5 w-5 shrink-0 animate-spin text-foreground mt-0.5"
                aria-hidden
              />
            ) : (
              <AlertCircle
                className="h-5 w-5 shrink-0 text-amber-500 mt-0.5"
                aria-hidden
              />
            )}
            <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {description}
            </div>
          </div>
          {primaryAction ? (
            <Button
              type="button"
              className="min-h-[44px] w-full touch-manipulation"
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
