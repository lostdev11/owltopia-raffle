/**
 * Server-safe tx confirmation with an explicit wall-clock timeout.
 *
 * `connection.confirmTransaction(signature, commitment)` (legacy signature-only
 * form) can hang indefinitely when the RPC websocket drops — that left pack
 * opens stuck on "Resolving prize…" after payment. Always prefer the blockhash
 * strategy and race it against a timeout.
 */
import type { Connection } from '@solana/web3.js'

export const DEFAULT_TX_CONFIRM_TIMEOUT_MS = 45_000

export function isTxConfirmTimeoutError(error: string | null | undefined): boolean {
  const msg = (error ?? '').trim()
  if (!msg) return false
  return /tx confirm timed out/i.test(msg) || /confirm timed out after/i.test(msg)
}

export async function confirmTxWithTimeout(
  connection: Connection,
  params: {
    signature: string
    blockhash: string
    lastValidBlockHeight: number
    commitment?: 'processed' | 'confirmed' | 'finalized'
    timeoutMs?: number
  }
): Promise<void> {
  const timeoutMs =
    typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
      ? Math.floor(params.timeoutMs)
      : DEFAULT_TX_CONFIRM_TIMEOUT_MS
  const commitment = params.commitment ?? 'confirmed'
  const signature = params.signature

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      connection.confirmTransaction(
        {
          signature,
          blockhash: params.blockhash,
          lastValidBlockHeight: params.lastValidBlockHeight,
        },
        commitment
      ),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `tx confirm timed out after ${timeoutMs}ms (${signature.slice(0, 8)}…)`
            )
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
