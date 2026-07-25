'use client'

import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  message: string
  hint?: string
  /**
   * `error` — red failure.
   * `info` — in-progress / “you can close” after wallet approve (before final confirm).
   * `success` — green success (default).
   */
  tone?: 'success' | 'error' | 'info'
  /** Primary button label — defaults by tone. */
  actionLabel?: string
}

/** Mobile-friendly result popup after nesting, OWL claim, or heal-on-load (success or failure). */
export function NestingClaimSuccessDialog({
  open,
  onOpenChange,
  title,
  message,
  hint,
  tone = 'success',
  actionLabel,
}: Props) {
  const isError = tone === 'error'
  const isInfo = tone === 'info'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isError
            ? 'max-w-sm border-destructive/45 sm:max-w-md'
            : isInfo
              ? 'max-w-sm border-primary/45 sm:max-w-md'
              : 'max-w-sm border-theme-prime/45 sm:max-w-md'
        }
      >
        <DialogHeader className="items-center text-center sm:text-center">
          <div
            className={
              isError
                ? 'mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 shadow-[0_0_24px_rgba(255,64,64,0.15)]'
                : isInfo
                  ? 'mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 shadow-[0_0_24px_rgba(0,255,136,0.12)]'
                  : 'mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-theme-prime/15 shadow-[0_0_24px_rgba(0,255,136,0.15)]'
            }
            aria-hidden
          >
            {isError ? (
              <XCircle className="h-8 w-8 text-destructive" />
            ) : isInfo ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="h-8 w-8 text-theme-prime" />
            )}
          </div>
          <DialogTitle className="text-xl">
            {title ?? (isError ? 'That did not finish' : isInfo ? 'Nesting finishing' : 'Claim successful')}
          </DialogTitle>
          <DialogDescription className="text-base text-foreground leading-relaxed pt-1">
            {message}
          </DialogDescription>
          {hint ? (
            <p className="text-sm text-muted-foreground leading-relaxed pt-1">{hint}</p>
          ) : null}
        </DialogHeader>
        <DialogFooter className="sm:justify-center pt-2">
          <Button
            type="button"
            className="min-h-[48px] w-full touch-manipulation text-base sm:min-w-[140px] sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            {actionLabel ?? (isInfo ? 'Got it' : 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
