import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'
import type { RaffleBuyoutOffer } from '@/lib/types'

type BuyoutLiabilityRow = Pick<
  RaffleBuyoutOffer,
  'deposit_tx_signature' | 'bidder_wallet' | 'amount' | 'currency'
>

type VerifyBuyoutDeposit = typeof verifyBuyoutDepositTx

/**
 * Whether this buyout bid deposit still binds SOL/USDC in the shared funds escrow wallet.
 * Treasury-first: legacy bids to RAFFLE_RECIPIENT must not inflate funds-escrow liability
 * (resolveBuyoutDepositSource checks escrow first, which can mis-classify when wallets differ).
 */
export async function buyoutDepositBindsFundsEscrowLiability(
  offer: BuyoutLiabilityRow,
  verify: VerifyBuyoutDeposit = verifyBuyoutDepositTx
): Promise<boolean> {
  const sig = offer.deposit_tx_signature?.trim()
  if (!sig) return false

  const base = {
    transactionSignature: sig,
    bidderWallet: offer.bidder_wallet,
    expectedAmount: offer.amount,
    currency: offer.currency as 'SOL' | 'USDC',
    allowOlderThanHour: true,
  }

  try {
    const treasury = getRaffleTreasuryWalletAddress()
    if (treasury) {
      const treasuryHit = await verify({ ...base, depositWallet: treasury })
      if (treasuryHit.valid) return false
    }

    const escrow = getFundsEscrowPublicKey()
    if (!escrow) return false

    const escrowHit = await verify({ ...base, depositWallet: escrow })
    return escrowHit.valid
  } catch {
    // RPC / parse failure — do not block claims on unknown buyout classification.
    return false
  }
}

/**
 * Buyout offers whose deposit landed in the shared funds escrow (not legacy fee treasury).
 * Dedupes by deposit tx so liability load does not N× RPC the same signature.
 */
export async function filterBuyoutOffersInFundsEscrow<T extends BuyoutLiabilityRow>(
  offers: T[],
  verify: VerifyBuyoutDeposit = verifyBuyoutDepositTx
): Promise<T[]> {
  const bySig = new Map<string, T[]>()
  for (const offer of offers) {
    const sig = offer.deposit_tx_signature?.trim()
    if (!sig) continue
    const list = bySig.get(sig) ?? []
    list.push(offer)
    bySig.set(sig, list)
  }

  const bindsBySig = new Map<string, boolean>()
  const entries = [...bySig.entries()]
  const concurrency = 12
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async ([sig, group]) => {
        const binds = await buyoutDepositBindsFundsEscrowLiability(group[0], verify)
        bindsBySig.set(sig, binds)
      })
    )
  }

  return offers.filter((offer) => {
    const sig = offer.deposit_tx_signature?.trim()
    if (!sig) return false
    return bindsBySig.get(sig) === true
  })
}
