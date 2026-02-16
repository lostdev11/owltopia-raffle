'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Entry, ThemeAccent } from '@/lib/types'
import { getThemeAccentBorderStyle, getThemeAccentClasses } from '@/lib/theme-accent'
import { useMemo } from 'react'
import { ExternalLink } from 'lucide-react'

interface ParticipantsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: Entry[]
  themeAccent: ThemeAccent
}

export function ParticipantsModal({
  open,
  onOpenChange,
  entries,
  themeAccent,
}: ParticipantsModalProps) {
  // Group entries by wallet and count tickets (only confirmed)
  // Also collect transaction signatures for each wallet
  const participants = useMemo(() => {
    const confirmedEntries = entries.filter(e => e.status === 'confirmed')
    const walletMap = new Map<string, { tickets: number; transactions: string[] }>()

    confirmedEntries.forEach(entry => {
      const current = walletMap.get(entry.wallet_address) || { tickets: 0, transactions: [] }
      walletMap.set(entry.wallet_address, {
        tickets: current.tickets + entry.ticket_quantity,
        transactions: entry.transaction_signature 
          ? [...current.transactions, entry.transaction_signature]
          : current.transactions
      })
    })

    return Array.from(walletMap.entries())
      .map(([wallet, data]) => ({ wallet, tickets: data.tickets, transactions: data.transactions }))
      .sort((a, b) => b.tickets - a.tickets)
  }, [entries])
  
  // Solana explorer URL helper
  const getSolanaExplorerUrl = (signature: string) => {
    return `https://solscan.io/tx/${signature}`
  }

  const borderStyle = getThemeAccentBorderStyle(themeAccent)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={getThemeAccentClasses(themeAccent, 'max-w-2xl sm:max-w-2xl')}
        style={borderStyle}
      >
        <DialogHeader className="pr-8 sm:pr-0">
          <DialogTitle>Participants ({participants.length})</DialogTitle>
          <DialogDescription className="break-words">
            Wallet addresses and ticket counts (confirmed entries only)
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto space-y-2 -mx-1 px-1">
          {participants.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No confirmed participants yet
            </p>
          ) : (
            participants.map((participant, index) => (
              <div
                key={participant.wallet}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                  <span className="text-muted-foreground flex-shrink-0">#{index + 1}</span>
                  <code className="text-xs sm:text-sm font-mono truncate flex-1 min-w-0">{participant.wallet}</code>
                  {participant.transactions.length > 0 && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {participant.transactions.map((tx, txIndex) => (
                        <a
                          key={`${participant.wallet}-${txIndex}-${tx}`}
                          href={getSolanaExplorerUrl(tx)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80 transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
                          title={`View transaction ${txIndex + 1} on Solscan`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="font-semibold text-sm sm:text-base sm:ml-2 flex-shrink-0">{participant.tickets} ticket(s)</div>
              </div>
            ))
          )}
        </div>
        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground text-center break-words px-2">
            💡 Don't see your entry? Try refreshing the page to see the latest updates.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
