'use client'

import { useCallback, useEffect, useState } from 'react'
import { LiveActivityPopups } from '@/components/LiveActivityPopups'
import type { Raffle } from '@/lib/types'

const REFETCH_INTERVAL_MS = 90_000 // 90s so new/updated raffles get into the map
const RETRY_DELAY_MS = 2000
const MAX_RETRIES = 3

/**
 * Renders live activity popups for every raffle site-wide.
 * Fetches all raffles (with retry + periodic refetch) so popups show the correct raffle title for any entry event.
 */
export function GlobalLiveActivity() {
  const [raffles, setRaffles] = useState<Raffle[]>([])

  const fetchRaffles = useCallback(async () => {
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch('/api/raffles', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(data)) {
          return data as Raffle[]
        }
        lastErr = data?.error ?? res.statusText
      } catch (e) {
        lastErr = e
      }
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      }
    }
    return []
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const list = await fetchRaffles()
      if (!cancelled) setRaffles(list)
    }

    run()
    const interval = setInterval(() => {
      if (cancelled) return
      run()
    }, REFETCH_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [fetchRaffles])

  return <LiveActivityPopups raffles={raffles} />
}
