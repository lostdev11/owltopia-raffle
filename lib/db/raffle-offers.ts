import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { Raffle, RaffleOffer, RaffleOfferStatus } from '@/lib/types'
import { refundOfferBidFromFundsEscrow } from '@/lib/raffles/funds-escrow'

export const RAFFLE_OFFER_WINDOW_HOURS = 24
export const RAFFLE_OFFER_TREASURY_FEE_BPS = 50 // 0.5%

function asIso(date: Date): string {
  return date.toISOString()
}

function roundOfferAmount(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}

export function getRaffleOfferWindowEndsAt(raffle: Raffle): Date | null {
  const winnerSelectedAt = (raffle.winner_selected_at ?? '').trim()
  const base = winnerSelectedAt || raffle.end_time
  const baseDate = new Date(base)
  if (Number.isNaN(baseDate.getTime())) return null
  return new Date(baseDate.getTime() + RAFFLE_OFFER_WINDOW_HOURS * 60 * 60 * 1000)
}

export function isRaffleOfferWindowOpen(raffle: Raffle, now = new Date()): boolean {
  if (!(raffle.winner_wallet ?? '').trim()) return false
  // Once the NFT/prize is no longer in escrow (winner claimed or creator return), new offers are invalid.
  if ((raffle.nft_transfer_transaction ?? '').trim() || raffle.prize_returned_at) return false
  const endsAt = getRaffleOfferWindowEndsAt(raffle)
  if (!endsAt) return false
  return now.getTime() <= endsAt.getTime()
}

export async function listRaffleOffers(raffleId: string): Promise<RaffleOffer[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('raffle_offers')
    .select('*')
    .eq('raffle_id', raffleId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load offers: ${error.message}`)
  }
  return (data ?? []) as RaffleOffer[]
}

export async function expirePendingOffers(raffleId: string, now: Date): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('raffle_offers')
    .update({ status: 'expired', updated_at: asIso(now) })
    .eq('raffle_id', raffleId)
    .eq('status', 'pending')
    .lte('expires_at', asIso(now))

  if (error) {
    throw new Error(`Failed to expire offers: ${error.message}`)
  }
}

export async function createOrReplacePendingOffer(input: {
  raffleId: string
  buyerWallet: string
  amount: number
  currency: Raffle['currency']
  expiresAt: Date
}): Promise<RaffleOffer> {
  const nowIso = asIso(new Date())

  const closeExisting = await getSupabaseAdmin()
    .from('raffle_offers')
    .update({ status: 'cancelled', updated_at: nowIso })
    .eq('raffle_id', input.raffleId)
    .eq('buyer_wallet', input.buyerWallet)
    .eq('status', 'pending')
  if (closeExisting.error) {
    throw new Error(`Failed to replace existing offer: ${closeExisting.error.message}`)
  }

  const { data, error } = await getSupabaseAdmin()
    .from('raffle_offers')
    .insert({
      raffle_id: input.raffleId,
      buyer_wallet: input.buyerWallet,
      amount: input.amount,
      currency: input.currency,
      treasury_fee_bps: RAFFLE_OFFER_TREASURY_FEE_BPS,
      status: 'pending',
      funded_at: nowIso,
      expires_at: asIso(input.expiresAt),
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create offer: ${error?.message ?? 'unknown error'}`)
  }
  return data as RaffleOffer
}

export type OfferRefundCandidate = {
  offerId: string
  raffleId: string
  raffleSlug: string
  raffleTitle: string
  amount: number
  currency: Raffle['currency']
  status: RaffleOfferStatus
  createdAt: string
  expiresAt: string
  fundedAt: string
}

export async function listOfferRefundCandidatesByWallet(
  walletAddress: string
): Promise<OfferRefundCandidate[]> {
  const wallet = walletAddress.trim()
  if (!wallet) return []
  const nowIso = asIso(new Date())

  // Keep refund eligibility accurate even if raffle-offers endpoints were not visited.
  const expireStalePending = await getSupabaseAdmin()
    .from('raffle_offers')
    .update({ status: 'expired', updated_at: nowIso })
    .eq('buyer_wallet', wallet)
    .eq('status', 'pending')
    .lte('expires_at', nowIso)
  if (expireStalePending.error) {
    throw new Error(`Failed to expire wallet offers: ${expireStalePending.error.message}`)
  }

  const { data, error } = await getSupabaseAdmin()
    .from('raffle_offers')
    .select(
      'id,raffle_id,amount,currency,status,created_at,expires_at,funded_at,refunded_at,raffles:raffle_id(id,slug,title)'
    )
    .eq('buyer_wallet', wallet)
    .in('status', ['declined', 'cancelled', 'expired'])
    .is('refunded_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load offer refund candidates: ${error.message}`)
  }

  return (data ?? [])
    .map((row: any) => {
      const raffle = row.raffles
      if (!raffle?.id || !raffle?.slug || !raffle?.title) return null
      return {
        offerId: String(row.id),
        raffleId: String(raffle.id),
        raffleSlug: String(raffle.slug),
        raffleTitle: String(raffle.title),
        amount: Number(row.amount ?? 0),
        currency: String(row.currency ?? 'SOL').toUpperCase() as Raffle['currency'],
        status: String(row.status ?? 'declined') as RaffleOfferStatus,
        createdAt: String(row.created_at),
        expiresAt: String(row.expires_at),
        fundedAt: String(row.funded_at ?? row.created_at),
      } satisfies OfferRefundCandidate
    })
    .filter((x): x is OfferRefundCandidate => !!x)
}

export async function claimOfferRefund(input: {
  offerId: string
  walletAddress: string
  refundTxSignature?: string | null
}): Promise<void> {
  const id = input.offerId.trim()
  const wallet = input.walletAddress.trim()
  if (!id || !wallet) throw new Error('Invalid offer refund request')

  const client = getSupabaseAdmin()
  const { data, error } = await client
    .from('raffle_offers')
    .select('id,buyer_wallet,amount,currency,status,refunded_at')
    .eq('id', id)
    .single()

  if (error || !data) {
    throw new Error('Offer not found')
  }
  if (String(data.buyer_wallet ?? '').trim() !== wallet) {
    throw new Error('Only the offer buyer can claim this refund')
  }
  if (data.refunded_at) {
    throw new Error('Offer bid was already refunded')
  }
  const status = String(data.status ?? '')
  if (!['declined', 'cancelled', 'expired'].includes(status)) {
    throw new Error('Offer is not eligible for refund yet')
  }

  const providedTxSig = (input.refundTxSignature ?? '').trim()
  let txSig = providedTxSig || null
  if (!txSig) {
    const payout = await refundOfferBidFromFundsEscrow({
      buyer_wallet: String(data.buyer_wallet ?? '').trim(),
      amount: Number(data.amount ?? 0),
      currency: String(data.currency ?? 'SOL').toUpperCase() as Raffle['currency'],
    })
    if (!payout.ok) {
      throw new Error(payout.error || 'Failed to refund offer bid from funds escrow')
    }
    if (!payout.signature) {
      throw new Error('Failed to refund offer bid from funds escrow')
    }
    txSig = payout.signature
  }

  const nowIso = asIso(new Date())
  const update = await client
    .from('raffle_offers')
    .update({
      refunded_at: nowIso,
      refund_tx_signature: txSig,
      updated_at: nowIso,
    })
    .eq('id', id)
    .is('refunded_at', null)

  if (update.error) {
    throw new Error(`Failed to mark offer refund: ${update.error.message}`)
  }
}

export async function acceptRaffleOffer(input: {
  raffleId: string
  offerId: string
  winnerWallet: string
  now?: Date
}): Promise<RaffleOffer> {
  const now = input.now ?? new Date()
  const nowIso = asIso(now)
  const client = getSupabaseAdmin()

  const { data: offerRow, error: loadError } = await client
    .from('raffle_offers')
    .select('*')
    .eq('id', input.offerId)
    .eq('raffle_id', input.raffleId)
    .single()
  if (loadError || !offerRow) {
    throw new Error('Offer not found')
  }

  const offer = offerRow as RaffleOffer
  if (offer.status !== 'pending') {
    throw new Error('Offer is no longer pending')
  }
  if (new Date(offer.expires_at).getTime() < now.getTime()) {
    throw new Error('Offer has expired')
  }
  const treasuryFeeBps =
    Number.isFinite(offer.treasury_fee_bps) && offer.treasury_fee_bps >= 0
      ? offer.treasury_fee_bps
      : RAFFLE_OFFER_TREASURY_FEE_BPS
  const treasuryFeeAmount = roundOfferAmount((offer.amount * treasuryFeeBps) / 10_000)
  const winnerNetAmount = roundOfferAmount(offer.amount - treasuryFeeAmount)

  const { data, error } = await client
    .from('raffle_offers')
    .update({
      status: 'accepted' as RaffleOfferStatus,
      accepted_at: nowIso,
      accepted_by_wallet: input.winnerWallet,
      treasury_fee_bps: treasuryFeeBps,
      treasury_fee_amount: treasuryFeeAmount,
      winner_net_amount: winnerNetAmount,
      updated_at: nowIso,
    })
    .eq('id', input.offerId)
    .eq('raffle_id', input.raffleId)
    .eq('status', 'pending')
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(`Failed to accept offer: ${error?.message ?? 'unknown error'}`)
  }

  const decline = await client
    .from('raffle_offers')
    .update({ status: 'declined', updated_at: nowIso })
    .eq('raffle_id', input.raffleId)
    .neq('id', input.offerId)
    .eq('status', 'pending')
  if (decline.error) {
    throw new Error(`Offer accepted but failed to close other offers: ${decline.error.message}`)
  }

  return data as RaffleOffer
}
