/**
 * Split at purchase: compute creator vs treasury amounts for a ticket payment.
 * Platform fee is deducted from every ticket sale: 3% for Owltopia Holders, 6% for non-holders.
 * Fee tier is based on the raffle creator's wallet (holder check at purchase time).
 */
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'

export interface PaymentSplit {
  toCreator: number
  toTreasury: number
  feeBps: number
}

/**
 * Compute how to split a total payment between creator and treasury.
 * Uses same rounding as settlement: platform fee = floor(amount * feeBps / 10000), creator = total - fee.
 */
export async function getPaymentSplit(
  totalAmount: number,
  creatorWallet: string
): Promise<PaymentSplit> {
  const { feeBps } = await getCreatorFeeTier(creatorWallet.trim() || '', { skipCache: true })
  const safeTotal = Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : 0
  const scaledTotal = Math.round(safeTotal * 1_000_000_000)
  const scaledFee = Math.floor((scaledTotal * feeBps) / 10_000)
  const scaledCreator = scaledTotal - scaledFee
  return {
    toCreator: scaledCreator / 1_000_000_000,
    toTreasury: scaledFee / 1_000_000_000,
    feeBps,
  }
}
