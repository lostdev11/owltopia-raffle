'use client'

import { CheckCircle2 } from 'lucide-react'
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
  message: string
  hint?: string
}

/** Mobile-friendly success popup after OWL claim (single nest or claim all). */
export function NestingClaimSuccessDialog({ open, onOpenChange, message, hint }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-theme-prime/45 sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          <div
            className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-theme-prime/15 shadow-[0_0_24px_rgba(0,255,136,0.15)]"
            aria-hidden
          >
            <CheckCircle2 className="h-8 w-8 text-theme-prime" />
          </div>
          <DialogTitle className="text-xl">Claim successful</DialogTitle>
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
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
