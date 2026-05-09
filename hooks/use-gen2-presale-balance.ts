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
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            'Sign in with Owltopia (Dashboard) to load your presale balance for this wallet.'
          )
        }
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

  /** Set balance from POST /confirm response so UI updates immediately after recording. */
  const applySnapshot = useCallback((next: Gen2PresaleBalance) => {
    setBalance(next)
    setError(null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { balance, error, loading, refresh, applySnapshot }
}
