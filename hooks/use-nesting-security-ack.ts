'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'

import { nestingClientApiUrl } from '@/lib/nesting/fetch-json'
import {
  NESTING_SECURITY_ACK_STORAGE_KEY,
  readNestingSecurityAckWallet,
  writeNestingSecurityAckWallet,
} from '@/lib/nesting/security-notice-content'
import { verifyNestingSecurityAckClient } from '@/lib/nesting/verify-security-ack-client'
import { signMessageSignatureToBase64 } from '@/lib/solana/sign-message-signature'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export function useNestingSecurityAck(publicKey: PublicKey | null) {
  const { signMessage } = useWallet()
  const [acknowledged, setAcknowledged] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const walletAddr = publicKey?.toBase58() ?? null

  const syncFromStorage = useCallback(() => {
    if (!walletAddr) {
      setAcknowledged(false)
      return
    }
    const stored = readNestingSecurityAckWallet()
    setAcknowledged(!!stored && walletsEqualSolana(stored, walletAddr))
  }, [walletAddr])

  useEffect(() => {
    syncFromStorage()
  }, [syncFromStorage])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncFromStorage()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [syncFromStorage])

  const persistAck = useCallback(
    (next: boolean) => {
      if (next && walletAddr) {
        writeNestingSecurityAckWallet(walletAddr)
        setAcknowledged(true)
      } else {
        try {
          sessionStorage.removeItem(NESTING_SECURITY_ACK_STORAGE_KEY)
        } catch {
          /* private mode */
        }
        setAcknowledged(false)
      }
    },
    [walletAddr]
  )

  const signAcknowledgment = useCallback(async (): Promise<boolean> => {
    if (!publicKey || !signMessage) {
      setError('Connect a wallet that supports message signing.')
      return false
    }
    const addr = normalizeSolanaWalletAddress(publicKey.toBase58())
    if (!addr) {
      setError('Invalid connected wallet.')
      return false
    }
    setError(null)
    setSigning(true)
    try {
      const challengeRes = await fetch(
        nestingClientApiUrl(`/api/nesting/security-ack/challenge?wallet=${encodeURIComponent(addr)}`),
        { credentials: 'include', cache: 'no-store' }
      )
      const challenge = (await challengeRes.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!challengeRes.ok) {
        throw new Error(challenge.error || `Could not load safeguards message (${challengeRes.status})`)
      }
      if (!challenge.message) {
        throw new Error('Invalid acknowledgment challenge')
      }

      const messageBytes = new TextEncoder().encode(challenge.message)
      const signature = await signMessage(messageBytes)

      const localVerify = verifyNestingSecurityAckClient(publicKey, challenge.message, signature)
      if (!localVerify.valid) {
        throw new Error(localVerify.error || 'Wallet signature did not verify')
      }

      // Best-effort server verify (UI gate uses client verify; server may be unavailable on older deploys).
      const signatureBase64 = signMessageSignatureToBase64(signature)
      void fetch(nestingClientApiUrl('/api/nesting/security-ack/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: addr,
          message: challenge.message,
          signature: signatureBase64,
        }),
      }).catch(() => undefined)

      persistAck(true)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing failed')
      return false
    } finally {
      setSigning(false)
    }
  }, [publicKey, signMessage, persistAck])

  return {
    acknowledged,
    signing,
    error,
    signAcknowledgment,
    clearError: () => setError(null),
  }
}
