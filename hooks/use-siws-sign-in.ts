'use client'

import { useCallback, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import { performSiwsSignIn } from '@/lib/client/siws-sign-in'

/**
 * Sign-In with Solana (nonce → signMessage → /api/auth/verify) + router.refresh().
 * Used by council VotePanel and CouncilOwlEscrowPanel so escrow can run on /council without a proposal card.
 */
export function useSiwsSignIn() {
  const router = useRouter()
  const { publicKey, signMessage, wallet } = useWallet()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = useCallback(async (opts?: { onSuccess?: () => void | Promise<void> }): Promise<boolean> => {
    if (!publicKey || !signMessage) {
      setError('Your wallet does not support message signing.')
      return false
    }
    setError(null)
    setSigningIn(true)
    try {
      await performSiwsSignIn({
        wallet: publicKey.toBase58(),
        signMessage,
        walletName: wallet?.adapter?.name,
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
  }, [publicKey, signMessage, wallet?.adapter?.name, router])

  return { signIn, signingIn, error }
}
