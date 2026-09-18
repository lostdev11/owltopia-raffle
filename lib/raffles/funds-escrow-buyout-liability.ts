import { resolveBuyoutDepositSource } from '@/lib/buyout/deposit-source'
import type { RaffleBuyoutOffer } from '@/lib/types'

type BuyoutLiabilityRow = Pick<
  RaffleBuyoutOffer,
  'deposit_tx_signature' | 'bidder_wallet' | 'amount' | 'currency'
>

/**
 * Buyout offers whose deposit landed in the shared funds escrow (not legacy fee treasury).
 * Dedupes by deposit tx so liability load does not N× RPC the same signature.
 */
export async function filterBuyoutOffersInFundsEscrow<T extends BuyoutLiabilityRow>(
  offers: T[]
): Promise<T[]> {
  const bySig = new Map<string, T[]>()
  for (const offer of offers) {
    const sig = offer.deposit_tx_signature?.trim()
    if (!sig) continue
    const list = bySig.get(sig) ?? []
    list.push(offer)
    bySig.set(sig, list)
  }

  const sourceBySig = new Map<string, boolean>()
  await Promise.all(
    [...bySig.entries()].map(async ([sig, group]) => {
      const sample = group[0]
      const source = await resolveBuyoutDepositSource(sample)
      sourceBySig.set(sig, source === 'funds_escrow')
    })
  )

  return offers.filter((offer) => {
    const sig = offer.deposit_tx_signature?.trim()
    if (!sig) return false
    return sourceBySig.get(sig) === true
  })
}
