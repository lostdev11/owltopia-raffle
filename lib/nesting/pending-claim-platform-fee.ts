/**
 * Client-persisted claim platform fee (SOL) so a failed OWL / rev-share payout can retry
 * without charging the user again. Survives mobile wallet redirects via localStorage.
 */

export const PENDING_CLAIM_FEE_STORAGE_KEY = 'owl_pending_claim_platform_fee_v2'
/** Legacy sessionStorage key from Claim-all fee reuse (migrate on read). */
export const PENDING_CLAIM_FEE_LEGACY_SESSION_KEY = 'owl_pending_claim_platform_fee_v1'

/** Separate key so OWL claim fees and rev-share claim fees do not overwrite each other. */
export const PENDING_REV_SHARE_CLAIM_FEE_STORAGE_KEY = 'owl_pending_rev_share_claim_platform_fee_v1'

/** Keep unpaid fee signatures recoverable for 48h (matches server recovery window). */
export const PENDING_CLAIM_FEE_TTL_MS = 48 * 60 * 60 * 1000

export type PendingClaimPlatformFee = {
  wallet: string
  signature: string
  units: number
  savedAtMs: number
}

export function parsePendingClaimPlatformFee(raw: unknown): PendingClaimPlatformFee | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const wallet = typeof o.wallet === 'string' ? o.wallet.trim() : ''
  const signature = typeof o.signature === 'string' ? o.signature.trim() : ''
  const units = Number(o.units)
  const savedAtMs =
    typeof o.savedAtMs === 'number' && Number.isFinite(o.savedAtMs)
      ? o.savedAtMs
      : typeof o.savedAt === 'number' && Number.isFinite(o.savedAt)
        ? o.savedAt
        : Date.now()
  if (!wallet || !signature || !Number.isFinite(units) || units < 1) return null
  return { wallet, signature, units: Math.floor(units), savedAtMs }
}

export function isPendingClaimPlatformFeeFresh(
  fee: PendingClaimPlatformFee,
  nowMs = Date.now(),
  ttlMs = PENDING_CLAIM_FEE_TTL_MS
): boolean {
  return nowMs - fee.savedAtMs <= ttlMs
}

export function pendingClaimPlatformFeeCovers(
  fee: PendingClaimPlatformFee,
  wallet: string,
  unitsNeeded: number,
  nowMs = Date.now()
): boolean {
  if (fee.wallet !== wallet.trim()) return false
  if (!Number.isFinite(unitsNeeded) || unitsNeeded < 1) return false
  if (fee.units < Math.floor(unitsNeeded)) return false
  return isPendingClaimPlatformFeeFresh(fee, nowMs)
}

export function claimRetryWithoutRepayMessage(units: number): string {
  const n = Math.max(1, Math.floor(units))
  return `Your ${n === 1 ? 'platform fee was' : `${n} nest platform fees were`} paid, but OWL was not sent yet. Tap Claim again — you should not be charged again.`
}

export function revShareClaimRetryWithoutRepayMessage(units: number): string {
  const n = Math.max(1, Math.floor(units))
  return `Your ${n === 1 ? 'platform fee was' : `${n} nest platform fees were`} paid, but rev share was not sent yet. Tap Claim again — you should not be charged again.`
}

export function readPendingRevShareClaimPlatformFee(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null
): PendingClaimPlatformFee | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_REV_SHARE_CLAIM_FEE_STORAGE_KEY)
    if (!raw) return null
    return parsePendingClaimPlatformFee(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writePendingRevShareClaimPlatformFee(
  fee: PendingClaimPlatformFee,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null
): void {
  if (!storage) return
  try {
    storage.setItem(PENDING_REV_SHARE_CLAIM_FEE_STORAGE_KEY, JSON.stringify(fee))
  } catch {
    // ignore quota / private mode
  }
}

export function clearPendingRevShareClaimPlatformFee(
  storage: Pick<Storage, 'removeItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null
): void {
  if (!storage) return
  try {
    storage.removeItem(PENDING_REV_SHARE_CLAIM_FEE_STORAGE_KEY)
  } catch {
    // ignore
  }
}
