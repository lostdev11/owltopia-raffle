/**
 * Save escrow deposit signature then verify with client retries (RPC lag / 429).
 */

import {
  verifyPrizeDepositWithRetries,
  type FrozenEscrowDiagnostics,
  VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS,
  VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS,
} from '@/lib/raffles/verify-prize-deposit-client'

export type RegisterAndVerifyPrizeDepositResult = {
  ok: boolean
  registered: boolean
  verified: boolean
  pendingReason?: string
  error?: string
  status?: number
  frozenEscrowDiagnostics?: FrozenEscrowDiagnostics
}

type RegisterResponse = {
  error?: string
  verified?: boolean
  pendingReason?: string
  frozenEscrowDiagnostics?: FrozenEscrowDiagnostics
}

/**
 * POST register-deposit-tx to persist the signature, then retry verify-prize-deposit
 * when the first server verify is still pending (RPC/indexing lag).
 */
export async function registerDepositTxAndVerifyWithRetries(
  raffleId: string,
  depositTx: string,
  options: {
    onVerifyAttempt?: (current: number, max: number) => void
    maxAttempts?: number
    retryDelayMs?: number
  } = {}
): Promise<RegisterAndVerifyPrizeDepositResult> {
  const trimmed = depositTx.trim()
  if (!trimmed) {
    return { ok: false, registered: false, verified: false, error: 'deposit_tx is required' }
  }

  let regRes: Response
  try {
    regRes = await fetch(`/api/raffles/${raffleId}/register-deposit-tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ deposit_tx: trimmed }),
    })
  } catch {
    return {
      ok: false,
      registered: false,
      verified: false,
      error: 'Network error while saving your deposit',
    }
  }

  const regData = (await regRes.json().catch(() => ({}))) as RegisterResponse

  if (!regRes.ok) {
    const errMsg =
      typeof regData.error === 'string' && regData.error.trim()
        ? regData.error.trim()
        : 'Could not save your deposit signature'
    return {
      ok: false,
      registered: false,
      verified: false,
      error: errMsg,
      status: regRes.status,
      ...(regData.frozenEscrowDiagnostics
        ? { frozenEscrowDiagnostics: regData.frozenEscrowDiagnostics }
        : {}),
    }
  }

  if (regData.verified === true) {
    return { ok: true, registered: true, verified: true }
  }

  const verifyResult = await verifyPrizeDepositWithRetries(raffleId, {
    depositTx: trimmed,
    onAttempt: options.onVerifyAttempt,
    maxAttempts: options.maxAttempts ?? VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS,
  })

  if (verifyResult.ok) {
    return { ok: true, registered: true, verified: true }
  }

  const pendingReason =
    typeof regData.pendingReason === 'string' && regData.pendingReason.trim()
      ? regData.pendingReason.trim()
      : undefined

  return {
    ok: true,
    registered: true,
    verified: false,
    pendingReason: pendingReason || verifyResult.error,
    error: verifyResult.error,
    status: verifyResult.status,
    ...(verifyResult.frozenEscrowDiagnostics
      ? { frozenEscrowDiagnostics: verifyResult.frozenEscrowDiagnostics }
      : {}),
  }
}
