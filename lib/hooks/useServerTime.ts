'use client'

import { useEffect, useState, useRef } from 'react'

export interface ServerTimeResult {
  /** Current time from server (or client fallback). Use for all raffle time logic. */
  serverNow: Date
  /** True after first successful /api/time response. Prefer for bucketing so wrong PC clock doesn't affect sections. */
  isSynced: boolean
}

/**
 * Returns the current time from the server (universal time) so raffle bucketing
 * and "Starts in X" / "Starts X ago" are not affected by incorrect PC clock.
 * Advances every second client-side; re-fetches every 60s to correct drift.
 */
export function useServerTime(): ServerTimeResult {
  const [serverNow, setServerNow] = useState<Date | null>(null)
  const [isSynced, setIsSynced] = useState(false)
  const offsetRef = useRef<number>(0) // client now - server now at sync time

  useEffect(() => {
    let intervalMs: ReturnType<typeof setInterval> | null = null
    let syncIntervalMs: ReturnType<typeof setInterval> | null = null

    const sync = () => {
      fetch('/api/time')
        .then((res) => res.ok ? res.json() : null)
        .then((data: { now?: string } | null) => {
          if (!data?.now) return
          const serverDate = new Date(data.now)
          if (isNaN(serverDate.getTime())) return
          offsetRef.current = Date.now() - serverDate.getTime()
          setServerNow(serverDate)
          setIsSynced(true)
        })
        .catch(() => {
          setServerNow((prev) => prev === null ? new Date() : prev)
        })
    }

    sync()

    intervalMs = setInterval(() => {
      setServerNow((prev) => (prev === null ? null : new Date(Date.now() - offsetRef.current)))
    }, 1000)

    syncIntervalMs = setInterval(sync, 60_000)

    return () => {
      if (intervalMs) clearInterval(intervalMs)
      if (syncIntervalMs) clearInterval(syncIntervalMs)
    }
  }, [])

  return {
    serverNow: serverNow ?? new Date(),
    isSynced,
  }
}
