import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { RaffleBuyoutOffer, RaffleBuyoutOfferStatus } from '@/lib/types'
import { BUYOUT_OFFER_TTL_MS, BUYOUT_TREASURY_FEE_BPS } from '@/lib/buyout/constants'

function normalizeOffer(row: Record<string, unknown>): RaffleBuyoutOffer {
  return {
    id: String(row.id),
    raffle_id: String(row.raffle_id),
    bidder_wallet: String(row.bidder_wallet ?? ''),
    currency: (row.currency === 'USDC' ? 'USDC' : 'SOL') as 'SOL' | 'USDC',
    amount: Number(row.amount ?? 0),
    status: row.status as RaffleBuyoutOfferStatus,
    deposit_tx_signature: (row.deposit_tx_signature as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    activated_at: (row.activated_at as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    accepted_at: (row.accepted_at as string | null) ?? null,
    accepted_by_wallet: (row.accepted_by_wallet as string | null) ?? null,
    treasury_fee_bps: Number(row.treasury_fee_bps ?? BUYOUT_TREASURY_FEE_BPS),
    treasury_fee_amount:
      row.treasury_fee_amount != null ? Number(row.treasury_fee_amount) : null,
    winner_net_amount: row.winner_net_amount != null ? Number(row.winner_net_amount) : null,
    payout_tx_signature: (row.payout_tx_signature as string | null) ?? null,
    refund_tx_signature: (row.refund_tx_signature as string | null) ?? null,
    refunded_at: (row.refunded_at as string | null) ?? null,
  }
}

export async function listBuyoutOffersForRaffle(raffleId: string): Promise<RaffleBuyoutOffer[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('raffle_buyout_offers')
    .select('*')
    .eq('raffle_id', raffleId.trim())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listBuyoutOffersForRaffle:', error.message)
    return []
  }
  return (data || []).map((r) => normalizeOffer(r as Record<string, unknown>))
}

export type BuyoutOfferWithRaffleSlug = RaffleBuyoutOffer & { raffle_slug: string; raffle_title: string }

export async function listBuyoutOffersForBidder(wallet: string): Promise<BuyoutOfferWithRaffleSlug[]> {
  const w = wallet.trim()
  if (!w) return []

  const admin = getSupabaseAdmin()
  const { data: offers, error } = await admin
    .from('raffle_buyout_offers')
    .select('*')
    .eq('bidder_wallet', w)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listBuyoutOffersForBidder:', error.message)
    return []
  }

  const rows = offers || []
  if (rows.length === 0) return []

  const raffleIds = [...new Set(rows.map((r: { raffle_id: string }) => r.raffle_id))]
  const { data: raffles } = await admin.from('raffles').select('id,slug,title').in('id', raffleIds)
  const slugById = new Map<string, { slug: string; title: string }>()
  for (const r of raffles || []) {
    const row = r as { id: string; slug: string; title: string }
    slugById.set(row.id, { slug: row.slug, title: row.title })
  }

  return rows.map((raw: Record<string, unknown>) => {
    const meta = slugById.get(String(raw.raffle_id))
    return {
      ...normalizeOffer(raw),
      raffle_slug: meta?.slug ?? '',
      raffle_title: meta?.title ?? '',
    }
  })
}

export async function getBuyoutOfferById(id: string): Promise<RaffleBuyoutOffer | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('raffle_buyout_offers').select('*').eq('id', id.trim()).maybeSingle()

  if (error || !data) return null
  return normalizeOffer(data as Record<string, unknown>)
}

/** Expire active offers past TTL for any raffle this bidder touched (dashboard refresh). */
export async function expireStaleBuyoutOffersForBidderWallet(wallet: string): Promise<void> {
  const w = wallet.trim()
  if (!w) return

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('raffle_buyout_offers')
    .select('raffle_id')
    .eq('bidder_wallet', w)
    .eq('status', 'active')

  const ids = [...new Set((data ?? []).map((r: { raffle_id: string }) => r.raffle_id))]
  for (const id of ids) {
    await expireStaleBuyoutOffersForRaffle(id)
  }
}

/** Mark active offers past TTL as expired (best-effort). */
export async function expireStaleBuyoutOffersForRaffle(raffleId: string): Promise<void> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { error } = await admin
    .from('raffle_buyout_offers')
    .update({ status: 'expired' })
    .eq('raffle_id', raffleId.trim())
    .eq('status', 'active')
    .lt('expires_at', now)

  if (error) {
    console.warn('expireStaleBuyoutOffersForRaffle:', error.message)
  }
}

export async function insertPendingBuyoutOffer(params: {
  raffleId: string
  bidderWallet: string
  currency: 'SOL' | 'USDC'
  amount: number
}): Promise<RaffleBuyoutOffer | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('raffle_buyout_offers')
    .insert({
      raffle_id: params.raffleId.trim(),
      bidder_wallet: params.bidderWallet.trim(),
      currency: params.currency,
      amount: params.amount,
      status: 'pending_deposit',
      treasury_fee_bps: BUYOUT_TREASURY_FEE_BPS,
    })
    .select('*')
    .single()

  if (error || !data) {
    console.error('insertPendingBuyoutOffer:', error?.message)
    return null
  }
  return normalizeOffer(data as Record<string, unknown>)
}

export async function activateBuyoutOfferAfterDeposit(params: {
  offerId: string
  depositTxSignature: string
}): Promise<RaffleBuyoutOffer | null> {
  const activatedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + BUYOUT_OFFER_TTL_MS).toISOString()

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('raffle_buyout_offers')
    .update({
      status: 'active',
      deposit_tx_signature: params.depositTxSignature.trim(),
      activated_at: activatedAt,
      expires_at: expiresAt,
    })
    .eq('id', params.offerId.trim())
    .eq('status', 'pending_deposit')
    .select('*')
    .maybeSingle()

  if (error || !data) {
    console.error('activateBuyoutOfferAfterDeposit:', error?.message)
    return null
  }
  return normalizeOffer(data as Record<string, unknown>)
}

/** Winner accepts one offer: payout + close raffle buyout + supersede others. */
export async function finalizeBuyoutAcceptance(params: {
  offerId: string
  raffleId: string
  winnerWallet: string
  treasuryFeeAmount: number
  winnerNetAmount: number
  payoutTxSignature: string
}): Promise<boolean> {
  const admin = getSupabaseAdmin()

  const acceptedAt = new Date().toISOString()

  const { data: updated, error: upErr } = await admin
    .from('raffle_buyout_offers')
    .update({
      status: 'accepted',
      accepted_at: acceptedAt,
      accepted_by_wallet: params.winnerWallet.trim(),
      treasury_fee_amount: params.treasuryFeeAmount,
      winner_net_amount: params.winnerNetAmount,
      payout_tx_signature: params.payoutTxSignature.trim(),
    })
    .eq('id', params.offerId.trim())
    .eq('raffle_id', params.raffleId.trim())
    .eq('status', 'active')
    .select('id')
    .maybeSingle()

  if (upErr || !updated) {
    console.error('finalizeBuyoutAcceptance update offer:', upErr?.message)
    return false
  }

  const { error: rErr } = await admin
    .from('raffles')
    .update({ buyout_closed_at: acceptedAt, updated_at: acceptedAt })
    .eq('id', params.raffleId.trim())

  if (rErr) {
    console.error('finalizeBuyoutAcceptance update raffle:', rErr.message)
    return false
  }

  await admin
    .from('raffle_buyout_offers')
    .update({ status: 'superseded' })
    .eq('raffle_id', params.raffleId.trim())
    .neq('id', params.offerId.trim())
    .in('status', ['active', 'pending_deposit'])

  return true
}

export async function finalizeBuyoutRefund(params: {
  offerId: string
  refundTxSignature: string
}): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('raffle_buyout_offers')
    .update({
      status: 'refunded',
      refund_tx_signature: params.refundTxSignature.trim(),
      refunded_at: now,
    })
    .eq('id', params.offerId.trim())
    .in('status', ['expired', 'superseded'])
    .is('refunded_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('finalizeBuyoutRefund:', error.message)
    return false
  }
  return !!data
}

/** Allow refund retry when DB marked refunded but client lost sig — idempotent no-op if already refunded with same sig */
export async function getRefundEligibleOffer(offerId: string): Promise<RaffleBuyoutOffer | null> {
  const o = await getBuyoutOfferById(offerId)
  if (!o) return null
  if (o.status !== 'expired' && o.status !== 'superseded') return null
  if (o.refunded_at) return null
  return o
}
