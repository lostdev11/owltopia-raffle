import type { Gen2BalanceRow } from '@/lib/gen2-presale/db'

export type Gen2PresaleOverageAllocationLite = {
  allowed_mints: number
  used_mints: number
} | null

/** Wallet appears in presale data with at least one paid (confirmed) spot. */
export function isGen2PresalePaidParticipant(balance: Gen2BalanceRow | null): boolean {
  return (balance?.purchased_mints ?? 0) > 0
}

/** Wallet has presale credits (paid and/or gifted) on record. */
export function isGen2PresaleCreditHolder(balance: Gen2BalanceRow | null): boolean {
  if (!balance) return false
  return (balance.purchased_mints ?? 0) + (balance.gifted_mints ?? 0) > 0
}

/**
 * Gifted credits reserved for Presale+13 (matches overage list slot count).
 * Wallets not on the overage list use all gifted credits in the PRESALE phase.
 */
export function overageReservedGiftedMints(
  balance: Gen2BalanceRow | null,
  overage: Gen2PresaleOverageAllocationLite
): number {
  if (!balance || !overage || overage.allowed_mints <= 0) return 0
  return Math.min(
    Math.max(0, Math.floor(balance.gifted_mints)),
    Math.max(0, Math.floor(overage.allowed_mints))
  )
}

/**
 * Credits from paid presale spots still available to mint in the PRESALE phase.
 * Gifted credits are consumed first when `used_mints` increases (excluding overage-phase use).
 */
export function gen2PresalePurchasedCreditsAvailable(balance: Gen2BalanceRow | null): number {
  if (!balance) return 0
  const purchased = Math.max(0, Math.floor(balance.purchased_mints))
  const gifted = Math.max(0, Math.floor(balance.gifted_mints))
  const used = Math.max(0, Math.floor(balance.used_mints))
  return Math.max(0, purchased - Math.max(0, used - gifted))
}

/**
 * Paid + early gifted credits for the PRESALE phase (657 pool).
 * Post-sold-out gifts on the Presale+13 list are excluded here.
 */
export function gen2PresalePhaseCreditsAvailable(
  balance: Gen2BalanceRow | null,
  overage: Gen2PresaleOverageAllocationLite
): number {
  if (!balance) return 0
  const purchased = Math.max(0, Math.floor(balance.purchased_mints))
  const gifted = Math.max(0, Math.floor(balance.gifted_mints))
  const used = Math.max(0, Math.floor(balance.used_mints))
  const overageUsed = Math.max(0, Math.floor(overage?.used_mints ?? 0))
  const presalePhaseUsed = Math.max(0, used - overageUsed)
  const presaleGiftedPool = Math.max(0, gifted - overageReservedGiftedMints(balance, overage))
  return Math.max(0, purchased + presaleGiftedPool - presalePhaseUsed)
}

/**
 * Gifted credits for the Presale+13 phase only (must be on overage list).
 */
export function gen2PresaleOveragePhaseCreditsAvailable(
  balance: Gen2BalanceRow | null,
  overage: Gen2PresaleOverageAllocationLite
): number {
  if (!balance || !overage) return 0
  const reserved = overageReservedGiftedMints(balance, overage)
  const overageUsed = Math.max(0, Math.floor(overage.used_mints))
  return Math.max(0, reserved - overageUsed)
}

/** @deprecated Use phase-specific helpers; total remaining purchased + gifted. */
export function gen2PresaleTotalCreditsAvailable(balance: Gen2BalanceRow | null): number {
  if (!balance) return 0
  if (Number.isFinite(balance.available_mints)) {
    return Math.max(0, Math.floor(balance.available_mints))
  }
  const purchased = Math.max(0, Math.floor(balance.purchased_mints))
  const gifted = Math.max(0, Math.floor(balance.gifted_mints))
  const used = Math.max(0, Math.floor(balance.used_mints))
  return Math.max(0, purchased + gifted - used)
}
