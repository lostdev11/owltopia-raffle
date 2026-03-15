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

  // Only show activity as it happens in real time (no initial batch — each new purchase appears one by one)
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

          const newId = `${newRow.id}-${newRow.verified_at ?? newRow.created_at}`
          const newEvent: ActivityEvent = {
            id: newId,
            raffleId: newRow.raffle_id,
            walletAddress: newRow.wallet_address,
            ticketQuantity: newRow.ticket_quantity,
            currency: newRow.currency,
            createdAt: newRow.verified_at ?? newRow.created_at,
          }

          setEvents((prev) => {
            if (prev.some((e) => e.id === newId)) return prev
            const next: ActivityEvent[] = [newEvent, ...prev]
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
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 flex w-full max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-col items-center gap-2 px-3">
      <p className="w-full max-w-xs text-left text-[11px] font-medium uppercase tracking-wider text-emerald-400/80">
        Live activity
      </p>
      {events.map((event) => {
        const raffle = raffleById.get(event.raffleId)
        const title = raffle?.title ?? 'a raffle'
        const walletLabel = formatWallet(event.walletAddress)
        const plural = event.ticketQuantity === 1 ? 'ticket' : 'tickets'
        const showCurrency = event.currency && String(event.currency).toLowerCase() !== 'sol'

        return (
          <div
            key={event.id}
            className="pointer-events-auto w-full max-w-xs rounded-lg border border-emerald-500/25 bg-background/95 px-3 py-2.5 shadow-sm backdrop-blur-sm animate-in fade-in-0 zoom-in-98 slide-in-from-top-1 duration-200"
          >
            <p className="text-sm text-foreground leading-snug">
              <span className="font-semibold text-emerald-400">{walletLabel}</span>
              {' '}bought{' '}
              <span className="font-medium">
                {event.ticketQuantity} {plural}
              </span>
              {' '}for{' '}
              <span className="font-medium">{title}</span>
              {showCurrency && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  · {String(event.currency).toUpperCase()}
                </span>
              )}
            </p>
          </div>
        )
      })}
    </div>
  )
}

