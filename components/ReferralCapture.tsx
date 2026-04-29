'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { normalizeReferralCodeInput } from '@/lib/referrals/code-format'

/**
 * Persists `?ref=` via httpOnly cookie (GET /api/referrals/capture) so checkout attribution cannot be overridden from page JS.
 */
export function ReferralCapture() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const raw = searchParams.get('ref')
    const code = normalizeReferralCodeInput(raw ?? '')
    if (!code) return
    void fetch(`/api/referrals/capture?ref=${encodeURIComponent(code)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
  }, [searchParams])

  return null
}
