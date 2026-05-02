'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Gen2PresaleBalance } from '@/lib/gen2-presale/types'

export function useGen2PresaleBalance(wallet: string | null) {
  const [balance, setBalance] = useState<Gen2PresaleBalance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!wallet?.trim()) {
      setBalance(null)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/gen2-presale/balance?wallet=${encodeURIComponent(wallet)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Balance failed')
      }
      setBalance(data as Gen2PresaleBalance)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Balance error')
      setBalance(null)
    } finally {
      setLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { balance, error, loading, refresh }
}
