'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Gen2EligibilityResponse, OwlCenterPhase } from '@/lib/owl-center/types'

/**
 * @param selectedPhase When multiple phases are live concurrently, the phase the user chose to
 * mint in. Eligibility is then computed for that exact phase. Omit for the primary active phase.
 */
export function useGen2MintEligibility(
  wallet: string | null,
  connected: boolean,
  selectedPhase?: OwlCenterPhase | null
) {
  const [elig, setElig] = useState<Gen2EligibilityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (opts?: { background?: boolean }) => {
    if (!connected || !wallet) {
      setElig(null)
      setError(null)
      return
    }
    if (!opts?.background) setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/owl-center/gen2/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, phase: selectedPhase ?? undefined }),
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
  }, [connected, wallet, selectedPhase])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Optimistically debit the wallet's allocation right after an on-chain mint confirms, so the
   * Mint button disables immediately instead of staying enabled on stale data while the server
   * eligibility refresh is in flight. Once a wallet has consumed its allocation it cannot mint
   * again until the next phase it is eligible for opens (the server refresh then confirms this).
   */
  const applyMinted = useCallback((quantity: number) => {
    const debit = Math.max(0, Math.floor(quantity))
    if (debit <= 0) return
    setElig((prev) => {
      if (!prev) return prev
      const nextMax = Math.max(0, prev.max_mintable - debit)
      return {
        ...prev,
        max_mintable: nextMax,
        is_eligible: prev.is_eligible && nextMax > 0,
        reason: nextMax > 0 ? prev.reason : 'allocation_minted',
      }
    })
  }, [])

  return { elig, loading, error, refresh, applyMinted }
}
