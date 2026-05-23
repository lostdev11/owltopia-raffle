'use client'

import { useCallback, useEffect, useState } from 'react'

import type { OwlCenterPresaleStats } from '@/lib/owl-center-presale/types'

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function useOwlCenterPresaleStats(slug: string, pollMs = 45_000) {
  const [stats, setStats] = useState<OwlCenterPresaleStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!slug) return
    try {
      let lastMessage = 'Failed to load stats'
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`/api/owl-center/presale/${encodeURIComponent(slug)}/stats`, {
          cache: 'no-store',
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setStats(data as OwlCenterPresaleStats)
          setError(null)
          return
        }
        lastMessage = (data as { error?: string }).error || lastMessage
        if (attempt < 2) await sleep(400 * (attempt + 1))
      }
      throw new Error(lastMessage)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stats error')
    } finally {
      setLoading(false)
    }
  }, [slug])

  const applyStatsPatch = useCallback((patch: Partial<OwlCenterPresaleStats>) => {
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
