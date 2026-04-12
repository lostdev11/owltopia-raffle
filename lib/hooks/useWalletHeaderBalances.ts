'use client'

import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { getPublicUsdcMintAddress } from '@/lib/solana/public-cluster-mints'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

export interface WalletHeaderBalancesState {
  sol: number | null
  usdc: number | null
  owl: number | null
  loading: boolean
  error: boolean
  refresh: () => void
}

function sumParsedUiByMint(rows: Awaited<ReturnType<Connection['getParsedTokenAccountsByOwner']>>['value'], mintStr: string): number {
  let sum = 0
  for (const { account } of rows) {
    const info = account.data?.parsed?.info as Record<string, unknown> | undefined
    if (!info || (info.mint as string) !== mintStr) continue
    const tokenAmount = info.tokenAmount as { uiAmount?: number | null } | undefined
    const n = tokenAmount?.uiAmount
    if (typeof n === 'number' && Number.isFinite(n)) sum += n
  }
  return sum
}

async function fetchSplUiTotal(connection: Connection, owner: PublicKey, mintStr: string): Promise<number> {
  const mint = new PublicKey(mintStr)
  const res = await connection.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed')
  return sumParsedUiByMint(res.value, mintStr)
}

export function useWalletHeaderBalances(): WalletHeaderBalancesState {
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const [sol, setSol] = useState<number | null>(null)
  const [usdc, setUsdc] = useState<number | null>(null)
  const [owl, setOwl] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    if (!publicKey || !connected) {
      setSol(null)
      setUsdc(null)
      setOwl(null)
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    try {
      const lamports = await connection.getBalance(publicKey, 'confirmed')
      setSol(lamports / LAMPORTS_PER_SOL)

      const usdcMint = getPublicUsdcMintAddress()
      const usdcTotal = await fetchSplUiTotal(connection, publicKey, usdcMint)
      setUsdc(usdcTotal)

      if (isOwlEnabled()) {
        const owlMint = getTokenInfo('OWL').mintAddress
        if (owlMint) {
          const owlTotal = await fetchSplUiTotal(connection, publicKey, owlMint)
          setOwl(owlTotal)
        } else {
          setOwl(null)
        }
      } else {
        setOwl(null)
      }
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useWalletHeaderBalances]', e)
      }
      setError(true)
      setSol(null)
      setUsdc(null)
      setOwl(null)
    } finally {
      setLoading(false)
    }
  }, [connection, publicKey, connected])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    const id = window.setInterval(() => {
      void refresh()
    }, 45_000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.clearInterval(id)
    }
  }, [refresh])

  return { sol, usdc, owl, loading, error, refresh }
}
