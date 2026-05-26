'use client'

import { useCallback, useEffect, useState } from 'react'

import type { OwlCenterPresaleBalance } from '@/lib/owl-center-presale/types'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

async function fetchSiwsWallet(): Promise<string | null> {
  const res = await fetch('/api/auth/wallet-session', { credentials: 'include', cache: 'no-store' })
  if (!res.ok) return null
  const j = (await res.json().catch(() => ({}))) as { wallet?: unknown }
  return typeof j.wallet === 'string' && j.wallet.trim() ? j.wallet.trim() : null
}

export function useOwlCenterPresaleBalance(slug: string, wallet: string | null) {
  const [balance, setBalance] = useState<OwlCenterPresaleBalance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!slug || !wallet?.trim()) {
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
            ? 'Your signed-in wallet does not match this connected wallet — sign in again with this wallet.'
            : 'Sign in with this wallet to load your presale credits.'
        )
        return
      }

      const res = await fetch(
        `/api/owl-center/presale/${encodeURIComponent(slug)}/balance?wallet=${encodeURIComponent(walletNorm)}`,
        { credentials: 'include', cache: 'no-store' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Sign in with this wallet to load your presale credits.')
        }
        throw new Error((data as { error?: string }).error || 'Balance failed')
      }
      setBalance(data as OwlCenterPresaleBalance)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Balance error')
      setBalance(null)
    } finally {
      setLoading(false)
    }
  }, [slug, wallet])

  const applySnapshot = useCallback((next: OwlCenterPresaleBalance) => {
    setBalance(next)
    setError(null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { balance, error, loading, refresh, applySnapshot }
}
