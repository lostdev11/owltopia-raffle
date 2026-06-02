import type { RaffleMilestone } from '@/lib/types'

export type MilestoneDepositCurrency = 'SOL' | 'USDC'

/** Crypto milestones that still need a funds-escrow deposit at create time. */
export function pendingCryptoMilestonesForCreate(
  milestones: RaffleMilestone[] | undefined | null
): RaffleMilestone[] {
  if (!milestones?.length) return []
  return milestones.filter(
    (m) =>
      m.prize_type === 'crypto' &&
      !m.deposit_verified_at &&
      (m.prize_currency === 'SOL' || m.prize_currency === 'USDC') &&
      Number(m.prize_amount ?? 0) > 0
  )
}

export function sumMilestoneDepositsByCurrency(
  milestones: RaffleMilestone[]
): Partial<Record<MilestoneDepositCurrency, number>> {
  const out: Partial<Record<MilestoneDepositCurrency, number>> = {}
  for (const m of milestones) {
    const cur = m.prize_currency
    if (cur !== 'SOL' && cur !== 'USDC') continue
    const amt = Number(m.prize_amount ?? 0)
    if (!Number.isFinite(amt) || amt <= 0) continue
    out[cur] = (out[cur] ?? 0) + amt
  }
  return out
}
