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
import { Trophy, ExternalLink } from 'lucide-react'
import type { PrizeType } from '@/lib/types'

interface WinnerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  winnerWallet: string
  prizeAmount: number | null
  prizeCurrency: string | null
  themeAccent: ThemeAccent
  nftTransferTransaction?: string | null
  prizeType?: PrizeType
  nftMintAddress?: string | null
  nftCollectionName?: string | null
}

export function WinnerModal({
  open,
  onOpenChange,
  winnerWallet,
  prizeAmount,
  prizeCurrency,
  themeAccent,
  nftTransferTransaction,
  prizeType,
  nftMintAddress,
  nftCollectionName,
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
          {prizeType === 'nft' ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">Prize</p>
              <p className="text-xl font-bold">
                NFT
              </p>
              {nftCollectionName && (
                <p className="text-sm text-muted-foreground">
                  {nftCollectionName}
                </p>
              )}
              {nftMintAddress && (
                <code className="block p-2 rounded-lg bg-muted font-mono text-xs break-all mt-2">
                  {nftMintAddress}
                </code>
              )}
            </div>
          ) : prizeAmount && prizeCurrency ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">Prize</p>
              <p className="text-2xl font-bold">
                {prizeAmount} {prizeCurrency}
              </p>
            </div>
          ) : null}
          {nftTransferTransaction && (
            <div className="text-center space-y-2 pt-2 border-t">
              <p className="text-sm text-muted-foreground">NFT Transfer Transaction</p>
              <div className="flex items-center justify-center gap-2">
                <code className="block p-2 rounded-lg bg-muted font-mono text-xs break-all flex-1">
                  {nftTransferTransaction}
                </code>
                <a
                  href={`https://solscan.io/tx/${nftTransferTransaction}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
                  title="View on Solscan"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Verified transfer transaction
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
