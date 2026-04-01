/**
 * Client-side: POST verify-prize-deposit with retries so RPC/indexing lag on mobile
 * does not strand users after a successful on-chain transfer.
 */

export const VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS = 14
export const VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS = 1000

export type VerifyPrizeDepositClientResult =
  | { ok: true }
  | { ok: false; error: string; status?: number }

/**
 * Retries on transient outcomes (400, 5xx, network). Stops immediately on 401/403/404.
 */
export async function verifyPrizeDepositWithRetries(
  raffleId: string,
  options: { depositTx?: string | null; signal?: AbortSignal } = {}
): Promise<VerifyPrizeDepositClientResult> {
  const depositTx = options.depositTx?.trim() || null
  const body = depositTx ? JSON.stringify({ deposit_tx: depositTx }) : undefined
  const headers: HeadersInit | undefined = body ? { 'Content-Type': 'application/json' } : undefined

  let lastError = 'Verification failed'
  let lastStatus: number | undefined

  for (let attempt = 0; attempt < VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS; attempt++) {
    if (options.signal?.aborted) {
      return { ok: false, error: 'Aborted' }
    }

    let res: Response
    try {
      res = await fetch(`/api/raffles/${raffleId}/verify-prize-deposit`, {
        method: 'POST',
        headers,
        body,
        credentials: 'include',
        signal: options.signal,
      })
    } catch {
      lastError = 'Network error while verifying deposit'
      lastStatus = undefined
      if (attempt < VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS))
      }
      continue
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.ok) {
      return { ok: true }
    }

    lastStatus = res.status
    lastError = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : 'Verification failed'

    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return { ok: false, error: lastError, status: res.status }
    }

    if (attempt < VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS))
    }
  }

  return { ok: false, error: lastError, status: lastStatus }
}
