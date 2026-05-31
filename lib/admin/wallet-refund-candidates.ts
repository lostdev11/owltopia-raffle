import { getEntriesByWallet, type EntryWithRaffle } from '@/lib/db/entries'
import { getRaffleById } from '@/lib/db/raffles'
import {
  expireStaleBuyoutOffersForBidderWallet,
  listBuyoutOffersForBidder,
  type BuyoutOfferWithRaffleSlug,
} from '@/lib/db/buyout-offers'
import { resolveBuyoutDepositSource } from '@/lib/buyout/deposit-source'
import { raffleAllowsAdminFundsEscrowRefund } from '@/lib/raffles/ticket-escrow-policy'

export type WalletTicketEscrowRefundCandidate = {
  kind: 'ticket'
  entryId: string
  raffleId: string
  raffleSlug: string
  raffleTitle: string
  amount: number
  currency: string
  raffleStatus: string
}

export type WalletBuyoutRefundCandidate = {
  kind: 'buyout'
  offerId: string
  raffleId: string
  raffleSlug: string
  raffleTitle: string
  amount: number
  currency: string
  offerStatus: string
  depositSource: 'funds_escrow' | 'treasury' | 'unknown'
}

export type WalletRefundCandidates = {
  wallet: string
  ticketEscrow: WalletTicketEscrowRefundCandidate[]
  buyoutEscrow: WalletBuyoutRefundCandidate[]
  buyoutTreasury: WalletBuyoutRefundCandidate[]
}

function toTicketCandidate(row: EntryWithRaffle): WalletTicketEscrowRefundCandidate {
  return {
    kind: 'ticket',
    entryId: row.entry.id,
    raffleId: row.raffle.id,
    raffleSlug: row.raffle.slug,
    raffleTitle: row.raffle.title,
    amount: Number(row.entry.amount_paid ?? 0),
    currency: String(row.entry.currency ?? 'SOL').toUpperCase(),
    raffleStatus: String(row.raffle.status ?? ''),
  }
}

function toBuyoutCandidate(
  offer: BuyoutOfferWithRaffleSlug,
  depositSource: WalletBuyoutRefundCandidate['depositSource'],
): WalletBuyoutRefundCandidate {
  return {
    kind: 'buyout',
    offerId: offer.id,
    raffleId: offer.raffle_id,
    raffleSlug: offer.raffle_slug,
    raffleTitle: offer.raffle_title,
    amount: offer.amount,
    currency: offer.currency,
    offerStatus: offer.status,
    depositSource,
  }
}

/**
 * Full-admin lookup: pending refunds for a wallet, split by funds escrow vs fee treasury (legacy buyout).
 */
export async function getWalletRefundCandidates(walletAddress: string): Promise<WalletRefundCandidates> {
  const wallet = walletAddress.trim()

  await expireStaleBuyoutOffersForBidderWallet(wallet)

  const entriesWithRaffles = await getEntriesByWallet(wallet)
  const raffleById = new Map<string, Awaited<ReturnType<typeof getRaffleById>>>()
  const ticketEscrow: WalletTicketEscrowRefundCandidate[] = []

  for (const row of entriesWithRaffles) {
    if (row.entry.status !== 'confirmed' || row.entry.refunded_at) continue
    let raffle = raffleById.get(row.raffle.id)
    if (raffle === undefined) {
      raffle = await getRaffleById(row.raffle.id)
      raffleById.set(row.raffle.id, raffle)
    }
    if (raffle && raffleAllowsAdminFundsEscrowRefund(raffle)) {
      ticketEscrow.push(toTicketCandidate(row))
    }
  }

  const buyoutOffers = await listBuyoutOffersForBidder(wallet)
  const buyoutEligible = buyoutOffers.filter(
    (o) =>
      (o.status === 'expired' || o.status === 'superseded') &&
      !!o.deposit_tx_signature?.trim() &&
      !o.refunded_at,
  )

  const buyoutEscrow: WalletBuyoutRefundCandidate[] = []
  const buyoutTreasury: WalletBuyoutRefundCandidate[] = []

  for (const offer of buyoutEligible) {
    const source = await resolveBuyoutDepositSource(offer)
    if (source === 'funds_escrow') {
      buyoutEscrow.push(toBuyoutCandidate(offer, 'funds_escrow'))
    } else if (source === 'treasury') {
      buyoutTreasury.push(toBuyoutCandidate(offer, 'treasury'))
    } else {
      buyoutEscrow.push(toBuyoutCandidate(offer, 'unknown'))
    }
  }

  return {
    wallet,
    ticketEscrow,
    buyoutEscrow: buyoutEscrow.filter((o) => o.depositSource === 'funds_escrow'),
    buyoutTreasury,
  }
}
