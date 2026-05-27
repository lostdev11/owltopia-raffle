import type { Gen2BalanceRow } from '@/lib/gen2-presale/db'

/** Wallet appears in presale data with at least one paid (confirmed) spot. */
export function isGen2PresalePaidParticipant(balance: Gen2BalanceRow | null): boolean {
  return (balance?.purchased_mints ?? 0) > 0
}

/**
 * Credits from paid presale spots still available to mint.
 * Gifted credits are consumed first when `used_mints` increases.
 */
export function gen2PresalePurchasedCreditsAvailable(balance: Gen2BalanceRow | null): number {
  if (!balance) return 0
  const purchased = Math.max(0, Math.floor(balance.purchased_mints))
  const gifted = Math.max(0, Math.floor(balance.gifted_mints))
  const used = Math.max(0, Math.floor(balance.used_mints))
  return Math.max(0, purchased - Math.max(0, used - gifted))
}
