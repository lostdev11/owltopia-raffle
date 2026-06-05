'use client'

import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Gift } from 'lucide-react'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FreeEntryUnlockedDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" aria-hidden />
            Free entry unlocked
          </DialogTitle>
          <DialogDescription className="text-left pt-1">
            You&apos;ve earned 1 free ticket entry. Redeem it on any live SOL or USDC raffle from your
            dashboard.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button asChild className="min-h-[44px] w-full touch-manipulation">
            <Link href="/dashboard">Redeem now</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-[44px] w-full touch-manipulation"
            onClick={() => onOpenChange(false)}
          >
            Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
