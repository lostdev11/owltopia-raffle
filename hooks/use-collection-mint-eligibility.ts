'use client'

import { useCallback, useEffect, useState } from 'react'

import type { SimpleMintEligibilityResponse } from '@/lib/owl-center/types'

export function useCollectionMintEligibility(slug: string, wallet: string | null, connected: boolean) {
  const [elig, setElig] = useState<SimpleMintEligibilityResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''
      const res = await fetch(`/api/owl-center/collections/${encodeURIComponent(slug)}/eligibility${qs}`, {
        cache: 'no-store',
      })
      const j = (await res.json()) as { eligibility?: SimpleMintEligibilityResponse; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setElig(j.eligibility ?? null)
    } catch {
      setElig(null)
    } finally {
      setLoading(false)
    }
  }, [slug, wallet])

  useEffect(() => {
    if (!connected && !wallet) {
      void refresh()
      return
    }
    void refresh()
  }, [connected, wallet, refresh])

  return { elig, loading, refresh }
}
