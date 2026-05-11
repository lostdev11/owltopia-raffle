'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Gen2PresaleBalance } from '@/lib/gen2-presale/types'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

async function fetchSiwsWallet(): Promise<string | null> {
  const res = await fetch('/api/auth/wallet-session', { credentials: 'include', cache: 'no-store' })
  if (!res.ok) return null
  const j = (await res.json().catch(() => ({}))) as { wallet?: unknown }
  return typeof j.wallet === 'string' && j.wallet.trim() ? j.wallet.trim() : null
}

export function useGen2PresaleBalance(wallet: string | null) {
  const [balance, setBalance] = useState<Gen2PresaleBalance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!wallet?.trim()) {
      setBalance(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const siwsWallet = await fetchSiwsWallet()
      const siwsNorm = siwsWallet ? normalizeSolanaWalletAddress(siwsWallet) : null
      const walletNorm = normalizeSolanaWalletAddress(wallet)
      if (!walletNorm) {
        setBalance(null)
        setError(null)
        return
      }
      if (!siwsNorm || !walletsEqualSolana(siwsNorm, walletNorm)) {
        setBalance(null)
        setError(
          siwsNorm
            ? 'Your Owltopia sign-in wallet does not match this connected wallet — sign in again with Owltopia for this address.'
            : 'Sign in with Owltopia (Dashboard) to load your presale balance for this wallet.'
        )
        return
      }

      const res = await fetch(`/api/gen2-presale/balance?wallet=${encodeURIComponent(walletNorm)}`, {
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
