'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Entry, Raffle } from '@/lib/types'
import { LIVE_ACTIVITY_POLL_FALLBACK_MS } from '@/lib/dev-budget'

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

function eventKeyFromRow(e: {
  id: string
  verified_at: string | null
  created_at: string
}): string {
  return `${e.id}-${e.verified_at ?? e.created_at}`
}

export function LiveActivityPopups({ raffles }: LiveActivityPopupsProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [extraRaffles, setExtraRaffles] = useState<Map<string, Raffle>>(new Map())
  const [walletDisplayNames, setWalletDisplayNames] = useState<Record<string, string>>({})
  const [isMuted, setIsMuted] = useState(false)
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null)
  const fetchingIds = useRef<Set<string>>(new Set())
  const fetchingWallets = useRef<Set<string>>(new Set())
  const seenEventKeysRef = useRef<Set<string>>(new Set())
  const pollBaselineReadyRef = useRef(false)
  const realtimeSubscribedRef = useRef(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const realtimeFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setPortalEl(typeof document !== 'undefined' ? document.body : null)
  }, [])

  useEffect(() => {
    try {
      setIsMuted(window.localStorage.getItem('owl:live-activity-muted') === '1')
    } catch {
      setIsMuted(false)
    }

    const onMutedPrefChange = () => {
      try {
        setIsMuted(window.localStorage.getItem('owl:live-activity-muted') === '1')
      } catch {
        setIsMuted(false)
      }
    }
    window.addEventListener('owl:live-activity-muted-change', onMutedPrefChange)
    return () => window.removeEventListener('owl:live-activity-muted-change', onMutedPrefChange)
  }, [])

  const pushActivityEvent = useCallback((row: Entry) => {
    if (row.status !== 'confirmed') return
    const key = eventKeyFromRow({
      id: row.id,
      verified_at: row.verified_at ?? null,
      created_at: row.created_at,
    })
    if (seenEventKeysRef.current.has(key)) return
    seenEventKeysRef.current.add(key)

    const newId = key
    const newEvent: ActivityEvent = {
      id: newId,
      raffleId: row.raffle_id,
      walletAddress: row.wallet_address,
      ticketQuantity: row.ticket_quantity,
      currency: row.currency,
      createdAt: row.verified_at ?? row.created_at,
    }
    setEvents((prev) => {
      if (prev.some((e) => e.id === newId)) return prev
      return [newEvent, ...prev].slice(0, 5)
    })
  }, [])

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

  // Fetch wallet display names in small batches for newly seen wallets.
  useEffect(() => {
    const missingWallets = Array.from(
      new Set(
        events
          .map((e) => e.walletAddress?.trim())
          .filter((w): w is string => Boolean(w))
          .filter((w) => !walletDisplayNames[w] && !fetchingWallets.current.has(w))
      )
    )

    if (missingWallets.length === 0) return

    missingWallets.forEach((w) => fetchingWallets.current.add(w))
    const query = encodeURIComponent(missingWallets.join(','))
    fetch(`/api/profiles?wallets=${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((map: Record<string, string> | null) => {
        if (!map || typeof map !== 'object') return
        setWalletDisplayNames((prev) => ({ ...prev, ...map }))
      })
      .catch(() => {})
      .finally(() => {
        missingWallets.forEach((w) => fetchingWallets.current.delete(w))
      })
  }, [events, walletDisplayNames])

  // Polling fallback when Realtime WebSocket does not connect (common on some desktop networks / extensions)
  const runPoll = useCallback(async () => {
    if (isMuted) return
    try {
      const res = await fetch('/api/public/live-activity', { cache: 'no-store' })
      const data = await res.json().catch(() => ({} as { entries?: unknown }))
      const rows = Array.isArray(data.entries) ? data.entries : []
      if (!pollBaselineReadyRef.current) {
        for (const r of rows) {
          const row = r as { id: string; verified_at?: string | null; created_at?: string }
          if (row?.id) {
            seenEventKeysRef.current.add(
              eventKeyFromRow({
                id: row.id,
                verified_at: row.verified_at ?? null,
                created_at: row.created_at ?? '',
              })
            )
          }
        }
        pollBaselineReadyRef.current = true
        return
      }
      for (const r of rows) {
        const row = r as {
          id: string
          raffle_id: string
          wallet_address: string
          ticket_quantity: number
          currency: Entry['currency']
          verified_at: string | null
          created_at: string
          status: string
        }
        if (!row?.id || row.status !== 'confirmed') continue
        pushActivityEvent(row as unknown as Entry)
      }
    } catch {
      // ignore
    }
  }, [isMuted, pushActivityEvent])

  // Realtime subscription + 2.5s timeout → start HTTP polling (same pattern as useRealtimeEntries)
  useEffect(() => {
    if (isMuted) {
      if (realtimeFallbackTimeoutRef.current) {
        clearTimeout(realtimeFallbackTimeoutRef.current)
        realtimeFallbackTimeoutRef.current = null
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      return
    }

    // No Supabase client (local dev) — still show activity via public poll API
    if (!isSupabaseConfigured()) {
      pollBaselineReadyRef.current = false
      void runPoll()
      pollIntervalRef.current = setInterval(() => {
        void runPoll()
      }, LIVE_ACTIVITY_POLL_FALLBACK_MS)
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }
    }

    realtimeSubscribedRef.current = false
    pollBaselineReadyRef.current = false
    if (realtimeFallbackTimeoutRef.current) {
      clearTimeout(realtimeFallbackTimeoutRef.current)
      realtimeFallbackTimeoutRef.current = null
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    const startPollFallback = () => {
      if (pollIntervalRef.current) return
      void runPoll()
      pollIntervalRef.current = setInterval(() => {
        void runPoll()
      }, LIVE_ACTIVITY_POLL_FALLBACK_MS)
    }

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
          const oldStatus = (payload as unknown as { old?: { status?: string } | null })
            .old?.status

          if (!newRow) return

          const becameConfirmed =
            newRow.status === 'confirmed' && oldStatus !== 'confirmed'

          if (!becameConfirmed) return

          pushActivityEvent(newRow)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          realtimeSubscribedRef.current = true
          if (realtimeFallbackTimeoutRef.current) {
            clearTimeout(realtimeFallbackTimeoutRef.current)
            realtimeFallbackTimeoutRef.current = null
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          startPollFallback()
        }
      })

    realtimeFallbackTimeoutRef.current = setTimeout(() => {
      if (!realtimeSubscribedRef.current) {
        supabase.removeChannel(channel)
        startPollFallback()
      }
    }, 2_500)

    return () => {
      if (realtimeFallbackTimeoutRef.current) {
        clearTimeout(realtimeFallbackTimeoutRef.current)
        realtimeFallbackTimeoutRef.current = null
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      supabase.removeChannel(channel)
    }
  }, [isMuted, pushActivityEvent, runPoll])

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

  const handleToggleMuted = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem('owl:live-activity-muted', next ? '1' : '0')
        window.dispatchEvent(new Event('owl:live-activity-muted-change'))
      } catch {
        /* storage blocked */
      }
      return next
    })
    if (!isMuted) {
      setEvents([])
    }
  }, [isMuted])

  const overlay = (() => {
    if (isMuted) {
      return (
        <div className="pointer-events-none fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[100] w-full max-w-[calc(100vw-1rem)] -translate-x-1/2 px-2 sm:top-4 sm:max-w-[calc(100vw-1.5rem)] sm:px-3">
          <div className="pointer-events-auto ml-auto flex w-fit max-w-full items-center gap-2 rounded-md border border-border/60 bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
            <span>Live activity muted</span>
            <button
              type="button"
              onClick={handleToggleMuted}
              className="rounded px-1.5 py-0.5 font-medium text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 touch-manipulation"
            >
              Unmute
            </button>
          </div>
        </div>
      )
    }

    if (!events.length) return null

    return (
      <div className="pointer-events-none fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[100] flex w-full max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col items-center gap-1.5 px-2 sm:top-4 sm:max-w-[calc(100vw-1.5rem)] sm:gap-2 sm:px-3">
        <div className="flex w-full max-w-xs items-center justify-between">
          <p className="text-left text-[11px] font-medium uppercase tracking-wider text-emerald-400/80">
            Live activity
          </p>
          <button
            type="button"
            onClick={handleToggleMuted}
            className="pointer-events-auto rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/90 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 touch-manipulation"
            aria-label="Mute live activity popups"
          >
            Mute
          </button>
        </div>
        {events.slice(0, 3).map((event) => {
          const raffle = raffleById.get(event.raffleId)
          const title = raffle?.title ?? 'a raffle'
          const walletAddress = event.walletAddress?.trim() ?? ''
          const walletLabel = walletDisplayNames[walletAddress] || formatWallet(walletAddress)
          const plural = event.ticketQuantity === 1 ? 'ticket' : 'tickets'
          const showCurrency = event.currency && String(event.currency).toLowerCase() !== 'sol'

          return (
            <div
              key={event.id}
              className="pointer-events-auto w-full max-w-[20rem] rounded-lg border border-emerald-500/25 bg-background/95 px-2.5 py-2 shadow-sm backdrop-blur-sm animate-in fade-in-0 zoom-in-98 slide-in-from-top-1 duration-200 sm:max-w-xs sm:px-3 sm:py-2.5"
            >
              <p className="text-[13px] text-foreground leading-snug sm:text-sm">
                <span className="font-semibold text-emerald-400">{walletLabel}</span> bought{' '}
                <span className="font-medium">
                  {event.ticketQuantity} {plural}
                </span>{' '}
                for <span className="font-medium">{title}</span>
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
  })()

  if (!portalEl || !overlay) return null

  return createPortal(overlay, portalEl)
}
