/**
 * Helpers for buyer/admin ticket refunds from funds escrow.
 * Complimentary / free referral rows have amount_paid 0 — nothing to send on-chain.
 */

export function entryRefundGrossAmount(entry: {
  amount_paid?: number | string | null
}): number {
  const amount = Number(entry.amount_paid ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

/** True when escrow must transfer funds back to the buyer. */
export function entryHasOnChainRefundAmount(entry: {
  amount_paid?: number | string | null
  referral_complimentary?: boolean | null
}): boolean {
  if (entry.referral_complimentary === true) return false
  return entryRefundGrossAmount(entry) > 0
}

/** Synthetic signature when closing a zero-payment row (no Solana transfer). */
export function noPaymentRefundSignature(entryId: string): string {
  return `NO_PAYMENT:${entryId.trim()}`
}

export function formatRefundClaimAmount(
  amount: number | string | null | undefined,
  currency: string | null | undefined
): string {
  const cur = (currency || 'SOL').trim().toUpperCase() || 'SOL'
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n) || n <= 0) return `0 ${cur}`

  if (cur === 'USDC') {
    return `${n.toFixed(2)} ${cur}`
  }

  // Avoid "Claim 0.0000 SOL" for dust / sub-0.0001 ticket prices while keeping common prices readable.
  const decimals = n < 0.0001 ? 9 : n < 0.01 ? 6 : 4
  const fixed = n.toFixed(decimals).replace(/\.?0+$/, '')
  return `${fixed} ${cur}`
}

export function formatRefundClaimButtonLabel(
  entry: {
    amount_paid?: number | string | null
    currency?: string | null
    referral_complimentary?: boolean | null
  },
  fallbackCurrency?: string | null
): string {
  if (!entryHasOnChainRefundAmount(entry)) {
    return 'Close free ticket'
  }
  return `Claim ${formatRefundClaimAmount(entry.amount_paid, entry.currency ?? fallbackCurrency)}`
}
