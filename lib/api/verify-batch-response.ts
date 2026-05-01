/**
 * Client-safe labels for /api/entries/verify-batch responses (no internal details).
 */
export type VerifyBatchErrorCode =
  | 'rate_limited'
  | 'invalid_request'
  | 'entries_not_found'
  | 'chain_verify_failed'
  | 'confirm_failed'
  | 'server_error'
  | 'admin_only'

export type VerifyBatchPendingBody = {
  success: true
  pending: true
  code: 'chain_indexing'
}

function readVerifyBatchCode(body: unknown): VerifyBatchErrorCode | undefined {
  if (!body || typeof body !== 'object') return undefined
  const c = (body as { code?: unknown }).code
  if (c === 'rate_limited') return 'rate_limited'
  if (c === 'invalid_request') return 'invalid_request'
  if (c === 'entries_not_found') return 'entries_not_found'
  if (c === 'chain_verify_failed') return 'chain_verify_failed'
  if (c === 'confirm_failed') return 'confirm_failed'
  if (c === 'server_error') return 'server_error'
  if (c === 'admin_only') return 'admin_only'
  return undefined
}

/**
 * Map HTTP status + optional JSON `code` to a single cart/checkout string (mobile-friendly).
 */
export function verifyBatchFailureUserMessage(status: number, code?: VerifyBatchErrorCode): string {
  if (status === 429 || code === 'rate_limited') {
    return 'Too many confirmation checks right now. Wait about a minute, then refresh — your payment may already be confirming and tickets can appear shortly.'
  }
  if (code === 'chain_verify_failed') {
    return 'This payment could not be matched to your cart (wrong amount, wallet, or recipients). Do not pay again. Copy the transaction signature from your wallet activity if you need help — refresh first to see if tickets already updated.'
  }
  if (code === 'confirm_failed') {
    return 'Payment looked valid, but seats could not be locked (sold out, timing, or a brief server glitch). Refresh — tickets often show up — or wait a minute before retrying.'
  }
  if (code === 'entries_not_found') {
    return 'Those pending tickets were not found. Refresh and open the raffle again; your cart may need to be rebuilt.'
  }
  if (code === 'invalid_request') {
    return 'Checkout data was not accepted. Refresh the page and try again.'
  }
  if (code === 'admin_only') {
    return 'Multi-raffle cart checkout is paused for maintenance. Pay one raffle at a time, or try again later.'
  }
  if (status === 503 && code === 'server_error') {
    return 'Confirmation could not reach the database (upgrade or permissions). Wait a minute, refresh, and retry — your payment usually still applies once the site is updated.'
  }
  if (status >= 500 || code === 'server_error') {
    return 'Confirmation is delayed on our side. Wait a minute and refresh — your payment usually still counts — then check your entries.'
  }
  return 'Payment may have succeeded, but confirmation did not finish. Refresh in a moment; if tickets stay pending, use the transaction signature from your wallet when asking for help.'
}

export async function parseVerifyBatchFailure(res: Response): Promise<{ status: number; code?: VerifyBatchErrorCode }> {
  const status = res.status
  try {
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return { status }
    const body: unknown = await res.json()
    const code = readVerifyBatchCode(body)
    return code ? { status, code } : { status }
  } catch {
    return { status }
  }
}
