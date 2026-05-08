'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'

export function useGen2PresaleStats(pollMs = 45_000) {
  const [stats, setStats] = useState<Gen2PresaleStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/gen2-presale/stats', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to load stats')
      }
      setStats(data as Gen2PresaleStats)
      setError(null)
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
