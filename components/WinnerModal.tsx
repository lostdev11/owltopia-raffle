'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ThemeAccent } from '@/lib/types'
import { getThemeAccentBorderStyle, getThemeAccentClasses } from '@/lib/theme-accent'
import { Trophy } from 'lucide-react'

interface WinnerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  winnerWallet: string
  prizeAmount: number | null
  prizeCurrency: string | null
  themeAccent: ThemeAccent
}

export function WinnerModal({
  open,
  onOpenChange,
  winnerWallet,
  prizeAmount,
  prizeCurrency,
  themeAccent,
}: WinnerModalProps) {
  const borderStyle = getThemeAccentBorderStyle(themeAccent)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={getThemeAccentClasses(themeAccent, 'max-w-md')}
        style={borderStyle}
      >
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <Trophy className="h-16 w-16 text-primary" />
          </div>
          <DialogTitle className="text-center text-2xl">Winner!</DialogTitle>
          <DialogDescription className="text-center">
            Congratulations to the raffle winner
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Winner Wallet</p>
            <code className="block p-3 rounded-lg bg-muted font-mono text-sm break-all">
              {winnerWallet}
            </code>
          </div>
          {prizeAmount && prizeCurrency && (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">Prize</p>
              <p className="text-2xl font-bold">
                {prizeAmount} {prizeCurrency}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            onClick={() => onOpenChange(false)}
            style={{
              backgroundColor: getThemeAccentBorderStyle(themeAccent).borderColor,
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
