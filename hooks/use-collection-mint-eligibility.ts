'use client'

import { useCallback, useEffect, useState } from 'react'

import type { SimpleMintEligibilityResponse } from '@/lib/owl-center/types'

export function useCollectionMintEligibility(slug: string, wallet: string | null, connected: boolean) {
  const [elig, setElig] = useState<SimpleMintEligibilityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true)
    setError(null)
    try {
      const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''
      const res = await fetch(`/api/owl-center/collections/${encodeURIComponent(slug)}/eligibility${qs}`, {
        cache: 'no-store',
      })
      const j = (await res.json()) as { eligibility?: SimpleMintEligibilityResponse; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setElig(j.eligibility ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [slug, wallet])

  useEffect(() => {
    if (!connected && !wallet) {
      setElig(null)
      setError(null)
      void refresh()
      return
    }
    void refresh()
  }, [connected, wallet, refresh])

  /**
   * Optimistically debit allocation after an on-chain mint confirms so the Mint button disables
   * immediately. Without this, a second tap during the server eligibility refresh window can hit
   * Candy Guard AllowedMintLimitReached + botTax (platform fee charged, no NFT) — Breppe ticket.
   */
  const applyMinted = useCallback((quantity: number) => {
    const debit = Math.max(0, Math.floor(quantity))
    if (debit <= 0) return
    setElig((prev) => {
      if (!prev) return prev
      const nextMax = Math.max(0, prev.max_mintable - debit)
      const nextMinted = prev.wallet_minted + debit
      return {
        ...prev,
        max_mintable: nextMax,
        wallet_minted: nextMinted,
        is_eligible: prev.is_eligible && nextMax > 0,
        reason:
          nextMax > 0
            ? prev.reason
            : `Wallet limit reached (${prev.wallet_mint_limit} per wallet)`,
      }
    })
  }, [])

  return { elig, loading, error, refresh, applyMinted }
}
