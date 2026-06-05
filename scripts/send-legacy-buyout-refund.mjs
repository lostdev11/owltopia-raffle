/**
 * Send + record a legacy fee-treasury buyout refund (requires RAFFLE_RECIPIENT_SECRET_KEY).
 *
 * Usage:
 *   npm run send:legacy-buyout-refund -- <offerId>
 */
async function main() {
  const offerId = process.argv[2]?.trim()
  if (!offerId) {
    console.error('Usage: node --env-file=.env.local scripts/send-legacy-buyout-refund.mjs <offerId>')
    process.exit(1)
  }

  const { getTreasurySigningKeypair } = await import('../lib/solana/treasury-signing.ts')
  if (!getTreasurySigningKeypair()) {
    console.error(
      'Treasury signing is not configured. Send the refund from RAFFLE_RECIPIENT_WALLET in Phantom, then record in Owl Vision admin (Legacy buyout refund).',
    )
    process.exit(1)
  }

  const { getBuyoutOfferById, finalizeBuyoutRefund } = await import('../lib/db/buyout-offers.ts')
  const { resolveBuyoutDepositSource } = await import('../lib/buyout/deposit-source.ts')
  const { refundBuyoutToBidder } = await import('../lib/buyout/settlement.ts')

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
    `Refunding ${offer.amount} ${offer.currency} to ${offer.bidder_wallet} (offer ${offer.id})…`,
  )
  const payout = await refundBuyoutToBidder(offer)
  if (!payout.ok) {
    console.error(payout.error)
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
