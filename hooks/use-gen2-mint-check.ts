'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Gen2MintCheckResponse } from '@/lib/owl-center/types'

export function useGen2MintCheck(wallet: string | null, refreshKey = 0) {
  const [check, setCheck] = useState<Gen2MintCheckResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/owl-center/gen2/mint-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      })
      const j = (await res.json()) as Gen2MintCheckResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'mint_check_failed')
      setCheck(j)
    } catch (e) {
      setCheck(null)
      setError(e instanceof Error ? e.message : 'mint_check_failed')
    } finally {
      setLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  return { check, loading, error, refresh }
}
