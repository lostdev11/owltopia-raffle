/**
 * Cover a legacy fee-treasury buyout refund from FUNDS_ESCROW (platform pays).
 * Original bid stays in RAFFLE_RECIPIENT_WALLET.
 *
 * Usage:
 *   npm run cover:legacy-buyout-from-escrow -- <offerId>
 */
async function main() {
  const offerId = process.argv[2]?.trim()
  if (!offerId) {
    console.error('Usage: npm run cover:legacy-buyout-from-escrow -- <offerId>')
    process.exit(1)
  }

  const { getBuyoutOfferById, finalizeBuyoutRefund } = await import('../lib/db/buyout-offers.ts')
  const { resolveBuyoutDepositSource } = await import('../lib/buyout/deposit-source.ts')
  const { refundBuyoutOfferFromFundsEscrow } = await import('../lib/raffles/funds-escrow.ts')

  const offer = await getBuyoutOfferById(offerId)
  if (!offer) {
    console.error('Offer not found:', offerId)
    process.exit(1)
  }
  if (offer.refunded_at) {
    console.log('Already refunded:', offer.refund_tx_signature ?? '(no sig on file)')
    process.exit(0)
  }
  if (offer.status !== 'expired' && offer.status !== 'superseded') {
    console.error('Offer not eligible for refund (must be expired or superseded)')
    process.exit(1)
  }

  const source = await resolveBuyoutDepositSource(offer)
  if (source !== 'treasury') {
    console.error('Deposit source is not fee treasury:', source ?? 'unknown')
    process.exit(1)
  }

  console.log(
    `Covering ${offer.amount} ${offer.currency} to ${offer.bidder_wallet} from funds escrow (offer ${offer.id})…`,
  )
  const payout = await refundBuyoutOfferFromFundsEscrow(offer)
  if (!payout.ok) {
    console.error('error' in payout ? payout.error : 'Escrow cover refund failed')
    process.exit(1)
  }
  if (!payout.signature) {
    console.error('Escrow cover refund failed (no signature)')
    process.exit(1)
  }

  const saved = await finalizeBuyoutRefund({
    offerId: offer.id,
    refundTxSignature: payout.signature,
  })
  if (!saved) {
    console.error('Refund sent but DB update failed. Tx:', payout.signature)
    process.exit(1)
  }

  console.log('OK', payout.signature)
  console.log('https://solscan.io/tx/' + payout.signature)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
