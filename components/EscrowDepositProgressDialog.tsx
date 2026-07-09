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

export type EscrowDepositProgressStep = 'wallet' | 'chain' | 'verify' | 'sign_in'

export type EscrowDepositProgressDialogProps = {
  open: boolean
  title: string
  description: ReactNode
  /** Default: spinner + loading copy. Use `result` for in-app messages that replaced blocking alerts. */
  phase?: 'loading' | 'result'
  /** Escrow sub-step for loading phase (wallet approval, chain confirm, server verify). */
  step?: EscrowDepositProgressStep
  /** Shown during verify retries (e.g. attempt 3 of 14). */
  verifyAttempt?: { current: number; max: number }
  /** When set, shown as the primary action (e.g. navigate to raffle). Dialog stays until tapped. */
  primaryAction?: { label: string; onClick: () => void }
  /** Optional secondary action (e.g. wallet did not open → manual fallback). */
  secondaryAction?: { label: string; onClick: () => void }
  /** Cancel / dismiss during non-critical steps (wallet lookup, wallet approval). */
  onCancel?: () => void
}

function stepTitle(step: EscrowDepositProgressStep | undefined, fallbackTitle: string): string {
  if (!step) return fallbackTitle
  switch (step) {
    case 'wallet':
      return 'Approve in your wallet'
    case 'chain':
      return 'Confirming on the blockchain'
    case 'sign_in':
      return 'Sign in to finish'
    case 'verify':
      return 'Verifying prize in escrow'
    default:
      return fallbackTitle
  }
}

function stepDescription(
  step: EscrowDepositProgressStep | undefined,
  description: ReactNode,
  verifyAttempt?: { current: number; max: number }
): ReactNode {
  if (description) return description
  switch (step) {
    case 'wallet':
      return (
        <p>
          Your wallet should open for you to <strong>review and approve</strong> the transfer. If nothing
          appears, unlock your wallet app or tap &quot;Wallet didn&apos;t open&quot; below.
        </p>
      )
    case 'chain':
      return (
        <p>
          Waiting until the network confirms your signed transaction. Usually quick; on busy networks or
          mobile data it can take up to a couple of minutes — keep this page open.
        </p>
      )
    case 'sign_in':
      return (
        <p>
          Sign the message in your wallet so we can record that the prize is in escrow.
        </p>
      )
    case 'verify':
      return (
        <p>
          Checking that your prize reached platform escrow so the raffle can go live. We retry
          automatically
          {verifyAttempt && verifyAttempt.max > 0 ? ` (up to ${verifyAttempt.max} tries)` : ''}.
          {verifyAttempt && verifyAttempt.current > 0 ? (
            <span className="block mt-2 font-medium text-foreground">
              Attempt {verifyAttempt.current} of {verifyAttempt.max}
            </span>
          ) : null}
        </p>
      )
    default:
      return null
  }
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
  step,
  verifyAttempt,
  primaryAction,
  secondaryAction,
  onCancel,
}: EscrowDepositProgressDialogProps) {
  const isLoading = phase === 'loading'
  const displayTitle = isLoading && step ? stepTitle(step, title) : title
  const displayDescription = isLoading
    ? stepDescription(step, description, verifyAttempt) ?? description
    : description
  const canCancel = isLoading && onCancel && step !== 'chain' && step !== 'verify'

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md touch-manipulation [&>button]:hidden"
        onPointerDownOutside={(e) => {
          if (!primaryAction && !canCancel) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (!primaryAction && !canCancel) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-left">{displayTitle}</DialogTitle>
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
              {displayDescription}
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
          {secondaryAction ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full touch-manipulation"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] w-full touch-manipulation text-muted-foreground"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
