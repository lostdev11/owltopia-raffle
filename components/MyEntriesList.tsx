'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { EntryWithRaffle } from '@/lib/db/entries'
import { format } from 'date-fns'
import { ExternalLink, Ticket, Calendar } from 'lucide-react'

const SOLANA_EXPLORER_TX = 'https://explorer.solana.com/tx'

interface MyEntriesListProps {
  walletAddress: string
}

export function MyEntriesList({ walletAddress }: MyEntriesListProps) {
  const [items, setItems] = useState<EntryWithRaffle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!walletAddress) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/entries/my?wallet=${encodeURIComponent(walletAddress)}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 400 ? 'Wallet required' : 'Failed to load entries')
        return res.json()
      })
      .then((data: EntryWithRaffle[]) => {
        setItems(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load your entries')
        setItems([])
      })
      .finally(() => setLoading(false))
  }, [walletAddress])

  if (loading) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Loading your entries…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
        {error}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-8 text-center text-muted-foreground">
        <p className="text-lg">You haven’t entered any raffles yet.</p>
        <p className="mt-2 text-sm">Purchase tickets on a raffle to see them here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {items.map(({ entry, raffle }) => (
        <Card key={entry.id} className="overflow-hidden border-green-500/20 bg-card/80">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/raffles/${raffle.slug}`}
                className="font-semibold text-primary hover:underline"
              >
                {raffle.title}
              </Link>
              <Badge
                variant={
                  entry.status === 'confirmed'
                    ? 'default'
                    : entry.status === 'rejected'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {entry.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {format(new Date(entry.created_at), 'MMM d, yyyy · h:mm a')}
              </span>
              <span className="flex items-center gap-1.5">
                <Ticket className="h-4 w-4" />
                {entry.ticket_quantity} ticket{entry.ticket_quantity !== 1 ? 's' : ''}
              </span>
              <span>
                {entry.amount_paid} {entry.currency}
              </span>
            </div>
            {entry.transaction_signature && (
              <a
                href={`${SOLANA_EXPLORER_TX}/${entry.transaction_signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                View on blockchain
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
