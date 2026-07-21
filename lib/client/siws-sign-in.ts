'use client'

import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import { nestingClientApiUrl } from '@/lib/nesting/fetch-json'
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

/** Ledger Bluetooth / USB approvals can take longer than hot-wallet pops. */
export const SIWS_SIGN_TIMEOUT_MS = 180_000

export type SiwsSignMessageFn = (message: Uint8Array) => Promise<Uint8Array>
export type SiwsSignTransactionFn = (
  transaction: Transaction
) => Promise<Transaction | VersionedTransaction>

export type PerformSiwsSignInParams = {
  wallet: string
  signMessage?: SiwsSignMessageFn | null
  /** Required for Ledger memo-tx fallback (transaction is signed, not sent). */
  signTransaction?: SiwsSignTransactionFn | null
  /** Optional client RPC blockhash if nonce response lacks one. */
  getBlockhash?: () => Promise<string>
  /** Force memo-tx path (Ledger button). */
  preferTx?: boolean
  /** Resolve API paths (default: nesting-safe absolute same-origin URLs). */
  apiUrl?: (path: string) => string
  timeoutMs?: number
  walletName?: string | null
}

type NonceChallenge = {
  message: string
  blockhash?: string | null
}

async function fetchNonceChallenge(
  walletAddr: string,
  apiUrl: (path: string) => string
): Promise<NonceChallenge> {
  let nonceRes: Response
  try {
    nonceRes = await fetch(apiUrl(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`), {
      credentials: 'include',
      cache: 'no-store',
    })
  } catch {
    throw new Error('Could not reach Owltopia for a sign-in nonce. Check your connection and try again.')
  }

  if (!nonceRes.ok) {
    const data = await nonceRes.json().catch(() => ({}))
    throw new Error((data as { error?: string })?.error || 'Failed to get sign-in nonce')
  }

  const data = (await nonceRes.json()) as {
    message?: string
    blockhash?: string | null
  }
  if (!data.message || typeof data.message !== 'string') {
    throw new Error('Invalid sign-in challenge from server')
  }
  return { message: data.message, blockhash: data.blockhash }
}

async function verifyWithMessageSignature(params: {
  walletAddr: string
  message: string
  signatureBase64: string
  apiUrl: (path: string) => string
}): Promise<void> {
  let verifyRes: Response
  try {
    verifyRes = await fetch(params.apiUrl('/api/auth/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        wallet: params.walletAddr,
        message: params.message,
        signature: params.signatureBase64,
      }),
    })
  } catch {
    throw new Error('Signed successfully, but could not reach Owltopia to finish sign-in. Refresh and try again.')
  }

  if (!verifyRes.ok) {
    const data = await verifyRes.json().catch(() => ({}))
    throw new Error((data as { error?: string })?.error || 'Sign-in verification failed')
  }
}

async function verifyWithSignedMemoTx(params: {
  walletAddr: string
  message: string
  signedTransactionBase64: string
  apiUrl: (path: string) => string
}): Promise<void> {
  let verifyRes: Response
  try {
    verifyRes = await fetch(params.apiUrl('/api/auth/verify-tx'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        wallet: params.walletAddr,
        message: params.message,
        signedTransaction: params.signedTransactionBase64,
      }),
    })
  } catch {
    throw new Error(
      'Signed successfully, but could not reach Owltopia to finish Ledger sign-in. Refresh and try again.'
    )
  }

  if (!verifyRes.ok) {
    const data = await verifyRes.json().catch(() => ({}))
    throw new Error((data as { error?: string })?.error || 'Ledger transaction sign-in verification failed')
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
  ])
}

async function signInViaMemoTransaction(params: {
  walletAddr: string
  message: string
  blockhash: string | null | undefined
  signTransaction: SiwsSignTransactionFn
  getBlockhash?: () => Promise<string>
  apiUrl: (path: string) => string
  timeoutMs: number
  walletName?: string | null
}): Promise<void> {
  let blockhash = ''
  if (params.getBlockhash) {
    try {
      blockhash = (await params.getBlockhash()).trim()
    } catch {
      /* fall through to challenge blockhash */
    }
  }
  if (!blockhash) {
    blockhash = params.blockhash?.trim() || ''
  }
  if (!blockhash) {
    throw new Error(
      'Could not prepare a Ledger sign-in transaction (missing blockhash). Check RPC, then try again.'
    )
  }

  const tx = buildSignInMemoTransaction({
    wallet: params.walletAddr,
    message: params.message,
    blockhash,
  })

  let signed: Transaction | VersionedTransaction
  try {
    signed = await withTimeout(
      params.signTransaction(tx),
      params.timeoutMs,
      'Timed out waiting for Ledger to approve the sign-in transaction. Unlock the device, open the Solana app (close Ledger Live), then try again.'
    )
  } catch (e) {
    if (isSignMessageUserRejection(e)) {
      throw new Error('Sign-in cancelled in wallet.')
    }
    throw new Error(
      formatSignMessageError(e, { walletName: params.walletName, context: 'sign-in' }) +
        ' If Sign Message never appears on Ledger, use “Sign with Ledger transaction” — approve the memo tx on the device (it is not broadcast; no fee is charged by Owltopia).'
    )
  }

  let signedTransactionBase64: string
  try {
    signedTransactionBase64 = serializeSignedSignInTransaction(signed)
  } catch (e) {
    throw new Error(
      `Could not read the signed Ledger transaction (${e instanceof Error ? e.message : 'serialize failed'}). Try Phantom or Solflare on desktop USB, then tap Sign with Ledger transaction again.`
    )
  }
  await verifyWithSignedMemoTx({
    walletAddr: params.walletAddr,
    message: params.message,
    signedTransactionBase64,
    apiUrl: params.apiUrl,
  })
}

/**
 * Shared SIWS flow: nonce → signMessage (with timeout) → /api/auth/verify.
 * On Ledger / hardware failures (or preferTx), falls back to a signed memo transaction
 * verified by /api/auth/verify-tx (not broadcast).
 */
export async function performSiwsSignIn(params: PerformSiwsSignInParams): Promise<void> {
  const {
    wallet,
    signMessage,
    signTransaction,
    getBlockhash,
    preferTx = false,
    apiUrl = nestingClientApiUrl,
    timeoutMs = SIWS_SIGN_TIMEOUT_MS,
    walletName,
  } = params

  const walletAddr = wallet.trim()
  if (!walletAddr) {
    throw new Error('Connect a wallet first.')
  }

  const challenge = await fetchNonceChallenge(walletAddr, apiUrl)

  const canTx = typeof signTransaction === 'function'
  const canMessage = typeof signMessage === 'function'

  if (preferTx) {
    if (!canTx) {
      throw new Error(
        'This wallet cannot sign transactions for Ledger sign-in. Try Phantom/Solflare desktop with USB, or a hot wallet.'
      )
    }
    await signInViaMemoTransaction({
      walletAddr,
      message: challenge.message,
      blockhash: challenge.blockhash,
      signTransaction,
      getBlockhash,
      apiUrl,
      timeoutMs,
      walletName,
    })
    return
  }

  if (!canMessage && canTx) {
    await signInViaMemoTransaction({
      walletAddr,
      message: challenge.message,
      blockhash: challenge.blockhash,
      signTransaction,
      getBlockhash,
      apiUrl,
      timeoutMs,
      walletName,
    })
    return
  }

  if (!canMessage) {
    throw new Error('Your wallet does not support message signing.')
  }

  const messageBytes = new TextEncoder().encode(challenge.message)

  try {
    const signature = await withTimeout(
      signMessage!(messageBytes),
      timeoutMs,
      'Timed out waiting for a wallet signature. Open Phantom/Solflare, approve Sign Message on your Ledger if prompted, or use “Sign with Ledger transaction” below.'
    )
    const signatureBase64 = signMessageSignatureToBase64(signature)
    await verifyWithMessageSignature({
      walletAddr,
      message: challenge.message,
      signatureBase64,
      apiUrl,
    })
    return
  } catch (e) {
    if (isSignMessageUserRejection(e)) {
      throw new Error(formatSignMessageError(e, { walletName, context: 'sign-in' }))
    }

    // Auto-fallback for Ledger / Phantom "Unexpected error" / no device prompt.
    if (canTx && isLikelyHardwareWalletSignMessageFailure(e)) {
      try {
        await signInViaMemoTransaction({
          walletAddr,
          message: challenge.message,
          blockhash: challenge.blockhash,
          signTransaction: signTransaction!,
          getBlockhash,
          apiUrl,
          timeoutMs,
          walletName,
        })
        return
      } catch (txErr) {
        throw new Error(
          (txErr instanceof Error ? txErr.message : 'Ledger transaction sign-in failed') +
            ' Tip: unlock Ledger, open Solana app, close Ledger Live, use USB on desktop if Bluetooth fails.'
        )
      }
    }

    throw new Error(formatSignMessageError(e, { walletName, context: 'sign-in' }))
  }
}
