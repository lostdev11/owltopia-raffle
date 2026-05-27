'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Gen2EligibilityResponse } from '@/lib/owl-center/types'

export function useGen2MintEligibility(wallet: string | null, connected: boolean) {
  const [elig, setElig] = useState<Gen2EligibilityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!connected || !wallet) {
      setElig(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/owl-center/gen2/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      })
      const j = (await res.json()) as Gen2EligibilityResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'eligibility_failed')
      setElig(j)
    } catch (e) {
      setElig(null)
      setError(e instanceof Error ? e.message : 'eligibility_failed')
    } finally {
      setLoading(false)
    }
  }, [connected, wallet])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { elig, loading, error, refresh }
}
