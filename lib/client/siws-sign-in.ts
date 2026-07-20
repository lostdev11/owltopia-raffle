'use client'

import { nestingClientApiUrl } from '@/lib/nesting/fetch-json'
import { formatSignMessageError } from '@/lib/solana/sign-message-error'
import { signMessageSignatureToBase64 } from '@/lib/solana/sign-message-signature'

/** Ledger Bluetooth / USB approvals can take longer than hot-wallet pops. */
export const SIWS_SIGN_TIMEOUT_MS = 180_000

export type SiwsSignMessageFn = (message: Uint8Array) => Promise<Uint8Array>

export type PerformSiwsSignInParams = {
  wallet: string
  signMessage: SiwsSignMessageFn
  /** Resolve API paths (default: nesting-safe absolute same-origin URLs). */
  apiUrl?: (path: string) => string
  timeoutMs?: number
  walletName?: string | null
}

/**
 * Shared SIWS flow: nonce → signMessage (with timeout) → /api/auth/verify.
 * Throws Error with Ledger-aware copy on failure.
 */
export async function performSiwsSignIn(params: PerformSiwsSignInParams): Promise<void> {
  const {
    wallet,
    signMessage,
    apiUrl = nestingClientApiUrl,
    timeoutMs = SIWS_SIGN_TIMEOUT_MS,
    walletName,
  } = params

  const walletAddr = wallet.trim()
  if (!walletAddr) {
    throw new Error('Connect a wallet first.')
  }

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

  const { message } = (await nonceRes.json()) as { message?: string }
  if (!message || typeof message !== 'string') {
    throw new Error('Invalid sign-in challenge from server')
  }

  const messageBytes = new TextEncoder().encode(message)

  let signature: Uint8Array
  try {
    signature = await Promise.race([
      signMessage(messageBytes),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Timed out waiting for a wallet signature. Open Phantom/Solflare, approve Sign Message on your Ledger if prompted, or reconnect Bluetooth/USB and try again.'
              )
            ),
          timeoutMs
        )
      ),
    ])
  } catch (e) {
    throw new Error(formatSignMessageError(e, { walletName, context: 'sign-in' }))
  }

  let signatureBase64: string
  try {
    signatureBase64 = signMessageSignatureToBase64(signature)
  } catch {
    throw new Error('Could not read wallet signature. Try again or reconnect your wallet.')
  }

  let verifyRes: Response
  try {
    verifyRes = await fetch(apiUrl('/api/auth/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        wallet: walletAddr,
        message,
        signature: signatureBase64,
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
