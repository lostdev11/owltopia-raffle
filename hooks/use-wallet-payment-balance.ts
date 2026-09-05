'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token'
import { lamportsToSolDisplay } from '@/lib/gen2-presale/format-sol'
import { getTokenInfo, type RaffleCurrency } from '@/lib/tokens'

const POLL_MS = 15_000

function isTokenAccountNotFound(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const name = (e as { name?: string }).name ?? ''
  const msg = e instanceof Error ? e.message : String(e)
  return (
    name === 'TokenAccountNotFoundError' ||
    name.includes('TokenAccountNotFound') ||
    msg.includes('TokenAccountNotFoundError') ||
    msg.includes('could not find account')
  )
}

function formatPaymentBalance(currency: RaffleCurrency, amount: number): string {
  if (currency === 'SOL') {
    return lamportsToSolDisplay(BigInt(Math.round(amount * LAMPORTS_PER_SOL)), 4)
  }
  const decimals = Math.min(getTokenInfo(currency).decimals, 6)
  return amount.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  })
}

export type WalletPaymentBalance = {
  /** Human-readable balance amount, or null when unknown / RPC failed. */
  amount: number | null
  /** Formatted display string (e.g. "1.2345") or "—" when unavailable. */
  display: string
  loading: boolean
  refresh: () => void
}

/**
 * Live wallet balance for a raffle payment currency (native SOL or SPL).
 * Polls while `enabled`; never throws — failed RPC yields null amount / "—".
 */
export function useWalletPaymentBalance(
  currency: RaffleCurrency | string,
  enabled: boolean
): WalletPaymentBalance {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const [amount, setAmount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)

  const code = (String(currency || 'SOL').toUpperCase() || 'SOL') as RaffleCurrency

  const refresh = useCallback(async () => {
    if (!enabled || !publicKey) {
      setAmount(null)
      setLoading(false)
      return
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      let next: number | null = null

      if (code === 'SOL') {
        const lamports = await connection.getBalance(publicKey, 'confirmed')
        next = lamports / LAMPORTS_PER_SOL
      } else {
        const info = getTokenInfo(code)
        if (!info.mintAddress) {
          next = null
        } else {
          const mintPk = new PublicKey(info.mintAddress)
          const ata = await getAssociatedTokenAddress(mintPk, publicKey)
          try {
            const acct = await getAccount(connection, ata, 'confirmed')
            next = Number(acct.amount) / Math.pow(10, info.decimals)
          } catch (e) {
            next = isTokenAccountNotFound(e) ? 0 : null
          }
        }
      }

      if (requestId === requestIdRef.current) {
        setAmount(next)
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setAmount(null)
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [code, connection, enabled, publicKey])

  useEffect(() => {
    if (!enabled || !publicKey) {
      requestIdRef.current += 1
      setAmount(null)
      setLoading(false)
      return
    }

    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => {
      requestIdRef.current += 1
      window.clearInterval(id)
    }
  }, [enabled, publicKey, refresh])

  const display = amount == null ? '—' : formatPaymentBalance(code, amount)

  return { amount, display, loading, refresh }
}
