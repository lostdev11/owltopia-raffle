import { resolveBuyoutDepositSource } from '@/lib/buyout/deposit-source'
import type { RaffleBuyoutOffer } from '@/lib/types'

export type BuyoutRefundDepositSource = 'funds_escrow' | 'treasury' | 'unknown' | null

function isRefundEligible(
  offer: Pick<RaffleBuyoutOffer, 'status' | 'deposit_tx_signature' | 'refunded_at'>,
): boolean {
  return (
    (offer.status === 'expired' || offer.status === 'superseded') &&
    !!offer.deposit_tx_signature?.trim() &&
    !offer.refunded_at
  )
}

/** Attach on-chain deposit wallet for refund-eligible buyout rows (dashboard UX). */
export async function enrichBuyoutOffersRefundDepositSource<T extends RaffleBuyoutOffer>(
  offers: T[],
): Promise<Array<T & { refundDepositSource: BuyoutRefundDepositSource }>> {
  return Promise.all(
    offers.map(async (offer) => {
      if (!isRefundEligible(offer)) {
        return { ...offer, refundDepositSource: null }
      }
      const source = await resolveBuyoutDepositSource(offer)
      return {
        ...offer,
        refundDepositSource: source ?? 'unknown',
      }
    }),
  )
}
