'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Entry, Raffle } from '@/lib/types'

interface LiveActivityPopupsProps {
  raffles: Raffle[]
}

interface ActivityEvent {
  id: string
  raffleId: string
  walletAddress: string
  ticketQuantity: number
  currency: Entry['currency']
  createdAt: string
}

function formatWallet(address: string): string {
  if (!address) return 'Someone'
  if (address.length <= 8) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export function LiveActivityPopups({ raffles }: LiveActivityPopupsProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [extraRaffles, setExtraRaffles] = useState<Map<string, Raffle>>(new Map())
  const fetchingIds = useRef<Set<string>>(new Set())

  const raffleById = useMemo(() => {
    const map = new Map<string, Raffle>()
    for (const r of raffles) {
      if (r?.id && !map.has(r.id)) {
        map.set(r.id, r)
      }
    }
    extraRaffles.forEach((r, id) => {
      if (r?.id && !map.has(id)) map.set(id, r)
    })
    return map
  }, [raffles, extraRaffles])

  const fetchRaffle = useCallback((raffleId: string) => {
    fetch(`/api/raffles/${raffleId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((r: Raffle | null) => {
        if (r?.id) {
          setExtraRaffles((prev) => {
            const next = new Map(prev)
            next.set(r.id, r)
            return next
          })
        }
      })
      .catch(() => {})
  }, [])

  // When we have an event for a raffle not in the map, fetch that raffle so we can show its title
  useEffect(() => {
    events.forEach((e) => {
      const rid = e.raffleId
      if (!raffleById.has(rid) && !fetchingIds.current.has(rid)) {
        fetchingIds.current.add(rid)
        fetchRaffle(rid)
      }
    })
  }, [events, raffleById, fetchRaffle])

  useEffect(() => {
    if (!isSupabaseConfigured()) return

    const channel = supabase
      .channel('entries:global-activity')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'entries',
        },
        (payload) => {
          const newRow = payload.new as Entry | null
          const oldRow = (payload as any).old as Entry | null

          if (!newRow) return

          // Only react when an entry transitions to confirmed
          const becameConfirmed =
            newRow.status === 'confirmed' &&
            (!oldRow || oldRow.status !== 'confirmed')

          if (!becameConfirmed) return

          setEvents((prev) => {
            const next: ActivityEvent[] = [
              {
                id: `${newRow.id}-${newRow.verified_at ?? newRow.created_at}`,
                raffleId: newRow.raffle_id,
                walletAddress: newRow.wallet_address,
                ticketQuantity: newRow.ticket_quantity,
                currency: newRow.currency,
                createdAt: newRow.verified_at ?? newRow.created_at,
              },
              ...prev,
            ]
            // Keep only a small history so UI stays lightweight
            return next.slice(0, 5)
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!events.length) return

    const timeouts: Array<ReturnType<typeof setTimeout>> = []

    // Auto-dismiss each event after a few seconds
    events.forEach((event) => {
      const timeoutId = setTimeout(() => {
        setEvents((prev) => prev.filter((e) => e.id !== event.id))
      }, 7000)
      timeouts.push(timeoutId)
    })

    return () => {
      timeouts.forEach((id) => clearTimeout(id))
    }
  }, [events])

  if (!events.length) return null

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 flex w-full max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-col items-center space-y-2 px-3">
      {events.map((event) => {
        const raffle = raffleById.get(event.raffleId)
        const title = raffle?.title ?? 'a raffle'
        const walletLabel = formatWallet(event.walletAddress)
        const plural = event.ticketQuantity === 1 ? 'ticket' : 'tickets'

        return (
          <div
            key={event.id}
            className="pointer-events-auto w-full max-w-xs rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 via-background/95 to-background/95 px-4 py-3 shadow-lg shadow-emerald-500/40 backdrop-blur-sm animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300/90">
              Live activity
            </p>
            <p className="mt-1 text-sm text-emerald-50">
              <span className="font-semibold">{walletLabel}</span> just bought{' '}
              <span className="font-semibold">
                {event.ticketQuantity} {plural}
              </span>{' '}
              for <span className="font-semibold">{title}</span>.
            </p>
            <p className="mt-1 text-[11px] text-emerald-200/80">
              Currency: {event.currency}
            </p>
          </div>
        )
      })}
    </div>
  )
}

