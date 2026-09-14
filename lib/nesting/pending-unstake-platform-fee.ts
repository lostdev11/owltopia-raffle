/**
 * Client-persisted unstake / early-unstake platform fee (SOL) so a failed nest close
 * (thaw, API error) can retry without charging the user again.
 */

export const PENDING_UNSTAKE_FEE_STORAGE_KEY = 'owl_pending_unstake_platform_fee_v1'

/** Keep unpaid fee signatures recoverable for 48h. */
export const PENDING_UNSTAKE_FEE_TTL_MS = 48 * 60 * 60 * 1000

export type PendingUnstakePlatformFee = {
  wallet: string
  signature: string
  /** Nest position this fee was paid for. */
  positionId: string
  /** 'unstake' | 'early_unstake' — must match server action on retry. */
  action: 'unstake' | 'early_unstake'
  units: number
  savedAtMs: number
}

export function parsePendingUnstakePlatformFee(raw: unknown): PendingUnstakePlatformFee | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const wallet = typeof o.wallet === 'string' ? o.wallet.trim() : ''
  const signature = typeof o.signature === 'string' ? o.signature.trim() : ''
  const positionId = typeof o.positionId === 'string' ? o.positionId.trim() : ''
  const action = o.action === 'early_unstake' || o.action === 'unstake' ? o.action : null
  const units = Number(o.units)
  const savedAtMs =
    typeof o.savedAtMs === 'number' && Number.isFinite(o.savedAtMs) ? o.savedAtMs : Date.now()
  if (!wallet || !signature || !positionId || !action) return null
  if (!Number.isFinite(units) || units < 1) return null
  return { wallet, signature, positionId, action, units: Math.floor(units), savedAtMs }
}

export function isPendingUnstakePlatformFeeFresh(
  fee: PendingUnstakePlatformFee,
  nowMs = Date.now(),
  ttlMs = PENDING_UNSTAKE_FEE_TTL_MS
): boolean {
  return nowMs - fee.savedAtMs <= ttlMs
}

export function pendingUnstakePlatformFeeMatches(params: {
  fee: PendingUnstakePlatformFee
  wallet: string
  positionId: string
  action: 'unstake' | 'early_unstake'
  nowMs?: number
}): boolean {
  const { fee, wallet, positionId, action, nowMs = Date.now() } = params
  if (fee.wallet !== wallet.trim()) return false
  if (fee.positionId !== positionId.trim()) return false
  if (fee.action !== action) return false
  return isPendingUnstakePlatformFeeFresh(fee, nowMs)
}

export function unstakeRetryWithoutRepayMessage(isEarly: boolean): string {
  return isEarly
    ? 'Your early-leave fee was paid, but the nest did not close yet. Tap Early leave again — you should not be charged again.'
    : 'Your leave-nest fee was paid, but the nest did not close yet. Tap Leave nest again — you should not be charged again.'
}

export function readPendingUnstakePlatformFee(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null
): PendingUnstakePlatformFee | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_UNSTAKE_FEE_STORAGE_KEY)
    if (!raw) return null
    return parsePendingUnstakePlatformFee(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writePendingUnstakePlatformFee(
  fee: PendingUnstakePlatformFee,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null
): void {
  if (!storage) return
  try {
    storage.setItem(PENDING_UNSTAKE_FEE_STORAGE_KEY, JSON.stringify(fee))
  } catch {
    // ignore quota / private mode
  }
}

export function clearPendingUnstakePlatformFee(
  storage: Pick<Storage, 'removeItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null
): void {
  if (!storage) return
  try {
    storage.removeItem(PENDING_UNSTAKE_FEE_STORAGE_KEY)
  } catch {
    // ignore
  }
}
