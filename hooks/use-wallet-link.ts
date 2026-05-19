'use client'

import { useCallback, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export function useWalletLink() {
  const { publicKey, signMessage } = useWallet()
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkConnectedWallet = useCallback(
    async (primaryWallet: string): Promise<boolean> => {
      if (!publicKey || !signMessage) {
        setError('Connect the wallet you want to link and ensure it supports message signing.')
        return false
      }

      const linkedAddr = publicKey.toBase58()
      const linkedNorm = normalizeSolanaWalletAddress(linkedAddr)
      const primaryNorm = normalizeSolanaWalletAddress(primaryWallet)
      if (!linkedNorm || !primaryNorm) {
        setError('Invalid wallet address')
        return false
      }
      if (walletsEqualSolana(linkedNorm, primaryNorm)) {
        setError('Switch to a different wallet than your primary, then link.')
        return false
      }

      setError(null)
      setLinking(true)
      try {
        const challengeRes = await fetch(
          `/api/me/wallet-links/challenge?linked_wallet=${encodeURIComponent(linkedNorm)}`,
          { credentials: 'include', cache: 'no-store' }
        )
        const challenge = (await challengeRes.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        if (!challengeRes.ok) {
          throw new Error(challenge.error || 'Could not start wallet link')
        }
        if (!challenge.message) {
          throw new Error('Invalid link challenge')
        }

        const messageBytes = new TextEncoder().encode(challenge.message)
        const signature = await signMessage(messageBytes)
        const signatureBase64 =
          typeof signature === 'string'
            ? btoa(signature)
            : btoa(String.fromCharCode(...new Uint8Array(signature)))

        const res = await fetch('/api/me/wallet-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            linked_wallet: linkedNorm,
            message: challenge.message,
            signature: signatureBase64,
          }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          throw new Error(data.error || 'Link failed')
        }
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Link failed')
        return false
      } finally {
        setLinking(false)
      }
    },
    [publicKey, signMessage]
  )

  return { linkConnectedWallet, linking, error, clearError: () => setError(null) }
}
