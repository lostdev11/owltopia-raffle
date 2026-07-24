import type { SendTransactionOptions } from '@solana/wallet-adapter-base'
import type { Connection, Transaction, TransactionSignature, VersionedTransaction } from '@solana/web3.js'
import { isSolanaRpcRateLimitError } from '@/lib/solana-rpc-rate-limit'
import { isMobileDevice } from '@/lib/utils'

export type SendTransactionFn = (
  transaction: Transaction | VersionedTransaction,
  connection: Connection,
  options?: SendTransactionOptions
) => Promise<TransactionSignature>

export type SendTransactionWithTimeoutOptions = SendTransactionOptions & {
  /** Default: 60s mobile, 90s desktop */
  timeoutMs?: number
}

function mapWalletSendError(err: unknown, isMobile: boolean): Error {
  const we = err as { message?: string; code?: number; name?: string }
  const errorMessage = we?.message || String(err) || 'Unknown error'
  const errorCode = we?.code

  if (we?.name === 'AbortError' || errorMessage.includes('abort')) {
    return new Error(
      isMobile
        ? 'Wallet approval timed out. Open your wallet app, approve the transfer, or reconnect and try again.'
        : 'Wallet approval timed out. Check your wallet extension for a pending request, or reconnect and try again.'
    )
  }

  const isUserRejection =
    errorCode === 4001 ||
    errorMessage.includes('User rejected') ||
    errorMessage.includes('rejected the request') ||
    errorMessage.includes('rejected')
  if (isUserRejection) {
    return new Error('Transaction was cancelled. Tap transfer again when you are ready.')
  }

  if (isSolanaRpcRateLimitError(err)) {
    return new Error(
      'Solana network is busy right now. Try Wi‑Fi, wait a moment, then try again.'
    )
  }

  if (errorMessage.includes('insufficient funds') || errorMessage.includes('Insufficient')) {
    return new Error(
      'Insufficient funds in your wallet. Ensure you have enough SOL for network fees.'
    )
  }

  if (isMobile && (errorMessage.includes('timeout') || errorMessage.includes('Timeout'))) {
    return new Error(
      'Wallet approval timed out on mobile. Open your wallet app, approve the transfer, or use the manual deposit fallback on this page.'
    )
  }

  if (errorMessage.includes('WalletSignTransactionError') || errorMessage.includes('wallet')) {
    return new Error(
      'Your wallet could not sign this transaction. Refresh the page, reconnect your wallet, and try again.'
    )
  }

  return err instanceof Error ? err : new Error(errorMessage)
}

/**
 * Wraps wallet `sendTransaction` with a timeout so escrow flows cannot spin forever
 * when the wallet popup never appears (common on mobile).
 */
export async function sendTransactionWithTimeout(
  sendTransaction: SendTransactionFn,
  transaction: Transaction | VersionedTransaction,
  connection: Connection,
  options?: SendTransactionWithTimeoutOptions
): Promise<TransactionSignature> {
  const isMobile = isMobileDevice()
  const timeoutMs = options?.timeoutMs ?? (isMobile ? 60_000 : 90_000)
  const { timeoutMs: _omit, ...sendOptions } = options ?? {}

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      sendTransaction(transaction, connection, sendOptions),
      new Promise<TransactionSignature>((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error('Wallet approval timed out')
          err.name = 'AbortError'
          reject(err)
        }, timeoutMs)
      }),
    ])
  } catch (err) {
    throw mapWalletSendError(err, isMobile)
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
