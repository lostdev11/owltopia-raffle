'use client'

import { useCallback, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import { performSiwsSignIn } from '@/lib/client/siws-sign-in'

/**
 * Sign-In with Solana (nonce → signMessage → /api/auth/verify) + router.refresh().
 * Ledger / hardware wallets auto-fall back to a signed memo transaction (not broadcast).
 */
export function useSiwsSignIn() {
  const router = useRouter()
  const { connection } = useConnection()
  const { publicKey, signMessage, signTransaction, wallet } = useWallet()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = useCallback(
    async (opts?: { onSuccess?: () => void | Promise<void>; preferTx?: boolean }): Promise<boolean> => {
      if (!publicKey) {
        setError('Connect a wallet first.')
        return false
      }
      if (!signMessage && !signTransaction) {
        setError('Your wallet does not support signing.')
        return false
      }
      setError(null)
      setSigningIn(true)
      try {
        await performSiwsSignIn({
          wallet: publicKey.toBase58(),
          signMessage,
          signTransaction,
          preferTx: opts?.preferTx,
          walletName: wallet?.adapter?.name,
          getBlockhash: async () => {
            const latest = await connection.getLatestBlockhash('confirmed')
            return latest.blockhash
          },
        })
        await opts?.onSuccess?.()
        router.refresh()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed')
        return false
      } finally {
        setSigningIn(false)
      }
    },
    [publicKey, signMessage, signTransaction, wallet?.adapter?.name, connection, router]
  )

  return { signIn, signingIn, error, canSignTransaction: Boolean(signTransaction) }
}
