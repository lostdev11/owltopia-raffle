'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'

import { nestingClientApiUrl } from '@/lib/nesting/fetch-json'
import {
  NESTING_SECURITY_ACK_STORAGE_KEY,
  readNestingSecurityAckWallet,
  writeNestingSecurityAckWallet,
} from '@/lib/nesting/security-notice-content'
import { verifyNestingSecurityAckClient } from '@/lib/nesting/verify-security-ack-client'
import { verifyNestingSecurityAckMemoClient } from '@/lib/nesting/verify-security-ack-memo-client'
import {
  buildSignInMemoTransaction,
  serializeSignedSignInTransaction,
} from '@/lib/auth-tx-sign-in'
import {
  formatSignMessageError,
  isLikelyHardwareWalletSignMessageFailure,
  isSignMessageUserRejection,
} from '@/lib/solana/sign-message-error'
import { signMessageSignatureToBase64 } from '@/lib/solana/sign-message-signature'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

const ACK_SIGN_TIMEOUT_MS = 180_000

type AckChallenge = {
  message: string
  blockhash?: string | null
}

export type SignNestingSecurityAckOptions = {
  /** Force memo-tx path (Ledger / hardware when Sign Message fails). */
  preferTx?: boolean
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
  ])
}

export function useNestingSecurityAck(publicKey: PublicKey | null) {
  const { connection } = useConnection()
  const { signMessage, signTransaction, wallet } = useWallet()
  const [acknowledged, setAcknowledged] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const walletAddr = publicKey?.toBase58() ?? null
  const canSignTransaction = typeof signTransaction === 'function'
  const canSignMessage = typeof signMessage === 'function'

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

  const fetchChallenge = useCallback(async (addr: string): Promise<AckChallenge> => {
    const challengeRes = await fetch(
      nestingClientApiUrl(`/api/nesting/security-ack/challenge?wallet=${encodeURIComponent(addr)}`),
      { credentials: 'include', cache: 'no-store' }
    )
    const challenge = (await challengeRes.json().catch(() => ({}))) as {
      error?: string
      message?: string
      blockhash?: string | null
    }
    if (!challengeRes.ok) {
      throw new Error(challenge.error || `Could not load safeguards message (${challengeRes.status})`)
    }
    if (!challenge.message) {
      throw new Error('Invalid acknowledgment challenge')
    }
    return { message: challenge.message, blockhash: challenge.blockhash }
  }, [])

  const resolveBlockhash = useCallback(
    async (challengeBlockhash?: string | null): Promise<string> => {
      try {
        const latest = await connection.getLatestBlockhash('confirmed')
        if (latest.blockhash?.trim()) return latest.blockhash.trim()
      } catch {
        /* fall through */
      }
      const fromChallenge = challengeBlockhash?.trim() || ''
      if (fromChallenge) return fromChallenge
      throw new Error(
        'Could not prepare a Ledger safeguards transaction (missing blockhash). Check RPC, then try again.'
      )
    },
    [connection]
  )

  const completeViaMemoTransaction = useCallback(
    async (params: {
      addr: string
      publicKey: PublicKey
      message: string
      blockhash?: string | null
      signTransaction: (transaction: Transaction) => Promise<Transaction | VersionedTransaction>
      walletName?: string | null
    }): Promise<void> => {
      const blockhash = await resolveBlockhash(params.blockhash)
      const tx = buildSignInMemoTransaction({
        wallet: params.addr,
        message: params.message,
        blockhash,
      })

      let signed: Transaction | VersionedTransaction
      try {
        signed = await withTimeout(
          params.signTransaction(tx),
          ACK_SIGN_TIMEOUT_MS,
          'Timed out waiting for Ledger to approve the safeguards transaction. Unlock the device, open the Solana app (close Ledger Live), then try again.'
        )
      } catch (e) {
        if (isSignMessageUserRejection(e)) {
          throw new Error('Signature cancelled in wallet.')
        }
        const hay = `${e instanceof Error ? e.message : String(e)}`.toLowerCase()
        if (
          hay.includes('lighthouse') ||
          hay.includes('l2texmfkdjp') ||
          hay.includes('unexpected instruction') ||
          hay.includes('assertaccountinfo')
        ) {
          throw new Error(
            'Phantom/Solflare added a Lighthouse security instruction that Ledger cannot clear-sign for safeguards. ' +
              'Enable Blind signing in the Ledger Solana app, unlock the device, close Ledger Live, prefer USB, then try “Sign safeguards with Ledger” again. ' +
              'If it still fails, sign safeguards from a hot wallet — wallet + Ledger limitation, not an Owltopia fee.'
          )
        }
        throw new Error(
          formatSignMessageError(e, { walletName: params.walletName, context: 'safeguards' }) +
            ' If Sign Message never appears on Ledger, use “Sign safeguards with Ledger” — approve the memo tx on the device (it is not broadcast; no fee is charged by Owltopia).'
        )
      }

      let signedTransactionBase64: string
      try {
        signedTransactionBase64 = serializeSignedSignInTransaction(signed)
      } catch (e) {
        throw new Error(
          `Could not read the signed Ledger transaction (${e instanceof Error ? e.message : 'serialize failed'}). Try Phantom or Solflare on desktop USB, then tap Sign safeguards with Ledger again.`
        )
      }

      const localVerify = verifyNestingSecurityAckMemoClient(
        params.publicKey,
        params.message,
        signedTransactionBase64
      )
      if (!localVerify.valid) {
        throw new Error(localVerify.error || 'Wallet transaction signature did not verify')
      }

      // Best-effort server verify (UI gate uses client verify; server may be unavailable on older deploys).
      void fetch(nestingClientApiUrl('/api/nesting/security-ack/verify-tx'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: params.addr,
          message: params.message,
          signedTransaction: signedTransactionBase64,
        }),
      }).catch(() => undefined)

      persistAck(true)
    },
    [persistAck, resolveBlockhash]
  )

  const signAcknowledgment = useCallback(
    async (opts?: SignNestingSecurityAckOptions): Promise<boolean> => {
      if (!publicKey || (!canSignMessage && !canSignTransaction)) {
        setError('Connect a wallet that supports message or transaction signing.')
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
        const challenge = await fetchChallenge(addr)
        const walletName = wallet?.adapter?.name
        const preferTx = opts?.preferTx === true

        if (preferTx) {
          if (!canSignTransaction || !signTransaction) {
            throw new Error(
              'This wallet cannot sign transactions for Ledger safeguards. Try Phantom/Solflare desktop with USB, or a hot wallet.'
            )
          }
          await completeViaMemoTransaction({
            addr,
            publicKey,
            message: challenge.message,
            blockhash: challenge.blockhash,
            signTransaction,
            walletName,
          })
          return true
        }

        if (!canSignMessage && canSignTransaction && signTransaction) {
          await completeViaMemoTransaction({
            addr,
            publicKey,
            message: challenge.message,
            blockhash: challenge.blockhash,
            signTransaction,
            walletName,
          })
          return true
        }

        if (!canSignMessage || !signMessage) {
          throw new Error('Your wallet does not support message signing.')
        }

        const messageBytes = new TextEncoder().encode(challenge.message)
        try {
          const signature = await withTimeout(
            signMessage(messageBytes),
            ACK_SIGN_TIMEOUT_MS,
            'Timed out waiting for a safeguards signature. Approve Sign Message on your Ledger if prompted, or use “Sign safeguards with Ledger” below.'
          )

          const localVerify = verifyNestingSecurityAckClient(publicKey, challenge.message, signature)
          if (!localVerify.valid) {
            throw new Error(localVerify.error || 'Wallet signature did not verify')
          }

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
          if (isSignMessageUserRejection(e)) {
            throw new Error(formatSignMessageError(e, { walletName, context: 'safeguards' }))
          }

          // Auto-fallback for Ledger / Phantom "Unexpected error" / Sign message rejected.
          if (canSignTransaction && signTransaction && isLikelyHardwareWalletSignMessageFailure(e)) {
            try {
              await completeViaMemoTransaction({
                addr,
                publicKey,
                message: challenge.message,
                blockhash: challenge.blockhash,
                signTransaction,
                walletName,
              })
              return true
            } catch (txErr) {
              throw new Error(
                (txErr instanceof Error ? txErr.message : 'Ledger transaction safeguards failed') +
                  ' Tip: unlock Ledger, open Solana app, close Ledger Live, use USB on desktop if Bluetooth fails.'
              )
            }
          }

          throw new Error(formatSignMessageError(e, { walletName, context: 'safeguards' }))
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Signing failed')
        return false
      } finally {
        setSigning(false)
      }
    },
    [
      publicKey,
      canSignMessage,
      canSignTransaction,
      signMessage,
      signTransaction,
      wallet?.adapter?.name,
      fetchChallenge,
      completeViaMemoTransaction,
      persistAck,
    ]
  )

  return {
    acknowledged,
    signing,
    error,
    signAcknowledgment,
    canSignTransaction,
    clearError: () => setError(null),
  }
}
