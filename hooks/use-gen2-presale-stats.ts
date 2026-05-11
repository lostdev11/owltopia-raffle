'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'

const STATS_FETCH_ATTEMPTS = 3

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function useGen2PresaleStats(pollMs = 45_000) {
  const [stats, setStats] = useState<Gen2PresaleStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      let lastMessage = 'Failed to load stats'
      for (let attempt = 0; attempt < STATS_FETCH_ATTEMPTS; attempt++) {
        const res = await fetch('/api/gen2-presale/stats', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setStats(data as Gen2PresaleStats)
          setError(null)
          return
        }
        const body = data as { error?: string; detail?: string }
        lastMessage = [body.error, body.detail].filter(Boolean).join(': ') || lastMessage
        if (attempt < STATS_FETCH_ATTEMPTS - 1) {
          await sleep(400 * (attempt + 1))
        }
      }
      throw new Error(lastMessage)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stats error')
    } finally {
      setLoading(false)
    }
  }, [])

  /** Merge server values right after a confirmed purchase (before the next poll/refetch). */
  const applyStatsPatch = useCallback((patch: Partial<Gen2PresaleStats>) => {
    setStats((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  useEffect(() => {
    void refresh()
    if (pollMs <= 0) return
    const id = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(id)
  }, [pollMs, refresh])

  return { stats, error, loading, refresh, applyStatsPatch }
}
