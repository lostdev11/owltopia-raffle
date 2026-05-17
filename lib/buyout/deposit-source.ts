import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'
import type { RaffleBuyoutOffer } from '@/lib/types'

export type BuyoutDepositSource = 'funds_escrow' | 'treasury'

/**
 * Where the bid landed on-chain (funds escrow for new bids; legacy bids may have used treasury).
 */
export async function resolveBuyoutDepositSource(
  offer: Pick<RaffleBuyoutOffer, 'deposit_tx_signature' | 'bidder_wallet' | 'amount' | 'currency'>,
): Promise<BuyoutDepositSource | null> {
  const sig = offer.deposit_tx_signature?.trim()
  if (!sig) return null

  const base = {
    transactionSignature: sig,
    bidderWallet: offer.bidder_wallet,
    expectedAmount: offer.amount,
    currency: offer.currency as 'SOL' | 'USDC',
    allowOlderThanHour: true,
  }

  const escrow = getFundsEscrowPublicKey()
  if (escrow) {
    const v = await verifyBuyoutDepositTx({ ...base, depositWallet: escrow })
    if (v.valid) return 'funds_escrow'
  }

  const treasury = getRaffleTreasuryWalletAddress()
  if (treasury) {
    const v = await verifyBuyoutDepositTx({ ...base, depositWallet: treasury })
    if (v.valid) return 'treasury'
  }

  return null
}
