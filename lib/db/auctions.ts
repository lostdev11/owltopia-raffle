import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type {
  AuctionBidCurrency,
  AuctionBidStatus,
  AuctionFeeTierReason,
  AuctionPrizeType,
  AuctionStatus,
  NftAuction,
  NftAuctionBid,
} from '@/lib/auctions/types'
import { AUCTION_MAX_LIVE_PER_CREATOR } from '@/lib/auctions/constants'

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normalizeAuction(row: Record<string, unknown>): NftAuction {
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    description: row.description != null ? String(row.description) : null,
    image_url: row.image_url != null ? String(row.image_url) : null,
    creator_wallet: String(row.creator_wallet ?? ''),
    status: row.status as AuctionStatus,
    prize_type: row.prize_type as AuctionPrizeType,
    nft_mint_address: row.nft_mint_address != null ? String(row.nft_mint_address) : null,
    nft_token_id: row.nft_token_id != null ? String(row.nft_token_id) : null,
    prize_standard: row.prize_standard != null ? String(row.prize_standard) : null,
    prize_amount: numOrNull(row.prize_amount),
    bid_currency: (row.bid_currency === 'USDC' ? 'USDC' : 'SOL') as AuctionBidCurrency,
    start_price: Number(row.start_price ?? 0),
    reserve_price: numOrNull(row.reserve_price),
    reserve_hidden: row.reserve_hidden !== false,
    starts_at: String(row.starts_at ?? ''),
    ends_at: String(row.ends_at ?? ''),
    original_ends_at: String(row.original_ends_at ?? row.ends_at ?? ''),
    soft_close_extensions: Number(row.soft_close_extensions ?? 0),
    current_bid_amount: numOrNull(row.current_bid_amount),
    current_bid_id: row.current_bid_id != null ? String(row.current_bid_id) : null,
    bid_count: Number(row.bid_count ?? 0),
    fee_bps_applied: Number(row.fee_bps_applied ?? 0),
    fee_tier_reason: row.fee_tier_reason as AuctionFeeTierReason,
    platform_fee_amount: numOrNull(row.platform_fee_amount),
    creator_payout_amount: numOrNull(row.creator_payout_amount),
    winner_wallet: row.winner_wallet != null ? String(row.winner_wallet) : null,
    winning_bid_id: row.winning_bid_id != null ? String(row.winning_bid_id) : null,
    prize_escrow_address_snapshot:
      row.prize_escrow_address_snapshot != null ? String(row.prize_escrow_address_snapshot) : null,
    funds_escrow_address_snapshot:
      row.funds_escrow_address_snapshot != null ? String(row.funds_escrow_address_snapshot) : null,
    prize_deposited_at: row.prize_deposited_at != null ? String(row.prize_deposited_at) : null,
    prize_deposit_tx: row.prize_deposit_tx != null ? String(row.prize_deposit_tx) : null,
    prize_claimed_at: row.prize_claimed_at != null ? String(row.prize_claimed_at) : null,
    prize_claim_tx: row.prize_claim_tx != null ? String(row.prize_claim_tx) : null,
    prize_claim_locked_at: row.prize_claim_locked_at != null ? String(row.prize_claim_locked_at) : null,
    prize_claim_locked_wallet:
      row.prize_claim_locked_wallet != null ? String(row.prize_claim_locked_wallet) : null,
    creator_claimed_at: row.creator_claimed_at != null ? String(row.creator_claimed_at) : null,
    creator_claim_tx: row.creator_claim_tx != null ? String(row.creator_claim_tx) : null,
    creator_claim_locked_at:
      row.creator_claim_locked_at != null ? String(row.creator_claim_locked_at) : null,
    ended_at: row.ended_at != null ? String(row.ended_at) : null,
    cancelled_at: row.cancelled_at != null ? String(row.cancelled_at) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

function normalizeBid(row: Record<string, unknown>): NftAuctionBid {
  return {
    id: String(row.id),
    auction_id: String(row.auction_id),
    bidder_wallet: String(row.bidder_wallet ?? ''),
    currency: (row.currency === 'USDC' ? 'USDC' : 'SOL') as AuctionBidCurrency,
    amount: Number(row.amount ?? 0),
    status: row.status as AuctionBidStatus,
    deposit_tx_signature: row.deposit_tx_signature != null ? String(row.deposit_tx_signature) : null,
    created_at: String(row.created_at ?? ''),
    activated_at: row.activated_at != null ? String(row.activated_at) : null,
    outbid_at: row.outbid_at != null ? String(row.outbid_at) : null,
    refund_tx_signature: row.refund_tx_signature != null ? String(row.refund_tx_signature) : null,
    refunded_at: row.refunded_at != null ? String(row.refunded_at) : null,
  }
}

export async function getAuctionById(id: string): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('nft_auctions').select('*').eq('id', id.trim()).maybeSingle()
  if (error || !data) return null
  return normalizeAuction(data as Record<string, unknown>)
}

export async function getAuctionBySlug(slug: string): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('nft_auctions')
    .select('*')
    .eq('slug', slug.trim())
    .maybeSingle()
  if (error || !data) return null
  return normalizeAuction(data as Record<string, unknown>)
}

export async function getAuctionByIdOrSlug(idOrSlug: string): Promise<NftAuction | null> {
  const key = idOrSlug.trim()
  if (!key) return null
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
  if (uuidLike) {
    const byId = await getAuctionById(key)
    if (byId) return byId
  }
  return getAuctionBySlug(key)
}

export async function listAuctionsForPartners(options?: {
  status?: AuctionStatus | AuctionStatus[]
  limit?: number
}): Promise<NftAuction[]> {
  const admin = getSupabaseAdmin()
  let q = admin.from('nft_auctions').select('*').order('ends_at', { ascending: true })
  if (options?.status) {
    if (Array.isArray(options.status)) q = q.in('status', options.status)
    else q = q.eq('status', options.status)
  }
  q = q.limit(Math.min(100, Math.max(1, options?.limit ?? 50)))
  const { data, error } = await q
  if (error) {
    console.error('listAuctionsForPartners:', error.message)
    return []
  }
  return (data || []).map((r) => normalizeAuction(r as Record<string, unknown>))
}

export async function countLiveAuctionsForCreator(wallet: string): Promise<number> {
  const admin = getSupabaseAdmin()
  const { count, error } = await admin
    .from('nft_auctions')
    .select('id', { count: 'exact', head: true })
    .eq('creator_wallet', wallet.trim())
    .eq('status', 'live')
  if (error) {
    console.error('countLiveAuctionsForCreator:', error.message)
    return AUCTION_MAX_LIVE_PER_CREATOR
  }
  return count ?? 0
}

export async function insertAuction(params: {
  slug: string
  title: string
  description?: string | null
  image_url?: string | null
  creator_wallet: string
  prize_type: AuctionPrizeType
  nft_mint_address?: string | null
  nft_token_id?: string | null
  prize_standard?: string | null
  prize_amount?: number | null
  bid_currency: AuctionBidCurrency
  start_price: number
  reserve_price?: number | null
  reserve_hidden?: boolean
  starts_at: string
  ends_at: string
  fee_bps_applied: number
  fee_tier_reason: AuctionFeeTierReason
  prize_escrow_address_snapshot?: string | null
  funds_escrow_address_snapshot?: string | null
}): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('nft_auctions')
    .insert({
      slug: params.slug,
      title: params.title.trim(),
      description: params.description?.trim() || null,
      image_url: params.image_url?.trim() || null,
      creator_wallet: params.creator_wallet.trim(),
      status: 'draft',
      prize_type: params.prize_type,
      nft_mint_address: params.nft_mint_address?.trim() || null,
      nft_token_id: params.nft_token_id?.trim() || null,
      prize_standard: params.prize_standard?.trim() || null,
      prize_amount: params.prize_amount ?? null,
      bid_currency: params.bid_currency,
      start_price: params.start_price,
      reserve_price: params.reserve_price ?? null,
      reserve_hidden: params.reserve_hidden !== false,
      starts_at: params.starts_at,
      ends_at: params.ends_at,
      original_ends_at: params.ends_at,
      fee_bps_applied: params.fee_bps_applied,
      fee_tier_reason: params.fee_tier_reason,
      prize_escrow_address_snapshot: params.prize_escrow_address_snapshot ?? null,
      funds_escrow_address_snapshot: params.funds_escrow_address_snapshot ?? null,
    })
    .select('*')
    .single()

  if (error || !data) {
    console.error('insertAuction:', error?.message)
    return null
  }
  return normalizeAuction(data as Record<string, unknown>)
}

export async function markAuctionPrizeDeposited(params: {
  auctionId: string
  depositTx?: string | null
}): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auctions')
    .update({
      prize_deposited_at: now,
      prize_deposit_tx: params.depositTx?.trim() || null,
      status: 'live',
      updated_at: now,
    })
    .eq('id', params.auctionId.trim())
    .eq('status', 'draft')
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('markAuctionPrizeDeposited:', error?.message)
    return null
  }
  return normalizeAuction(data as Record<string, unknown>)
}

export async function listBidsForAuction(auctionId: string): Promise<NftAuctionBid[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('nft_auction_bids')
    .select('*')
    .eq('auction_id', auctionId.trim())
    .order('created_at', { ascending: false })
  if (error) {
    console.error('listBidsForAuction:', error.message)
    return []
  }
  return (data || []).map((r) => normalizeBid(r as Record<string, unknown>))
}

export async function getBidById(id: string): Promise<NftAuctionBid | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('nft_auction_bids').select('*').eq('id', id.trim()).maybeSingle()
  if (error || !data) return null
  return normalizeBid(data as Record<string, unknown>)
}

export async function insertPendingAuctionBid(params: {
  auctionId: string
  bidderWallet: string
  currency: AuctionBidCurrency
  amount: number
}): Promise<NftAuctionBid | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('nft_auction_bids')
    .insert({
      auction_id: params.auctionId.trim(),
      bidder_wallet: params.bidderWallet.trim(),
      currency: params.currency,
      amount: params.amount,
      status: 'pending_deposit',
    })
    .select('*')
    .single()
  if (error || !data) {
    console.error('insertPendingAuctionBid:', error?.message)
    return null
  }
  return normalizeBid(data as Record<string, unknown>)
}

export async function activateAuctionBidAfterDeposit(params: {
  bidId: string
  depositTxSignature: string
  auctionId: string
  amount: number
  previousBidId: string | null
  softCloseEndsAt?: string | null
  softCloseExtensions?: number | null
}): Promise<{ bid: NftAuctionBid; previousBidId: string | null } | null> {
  const admin = getSupabaseAdmin()
  const activatedAt = new Date().toISOString()

  const { data: bid, error: bidErr } = await admin
    .from('nft_auction_bids')
    .update({
      status: 'active',
      deposit_tx_signature: params.depositTxSignature.trim(),
      activated_at: activatedAt,
    })
    .eq('id', params.bidId.trim())
    .eq('status', 'pending_deposit')
    .select('*')
    .maybeSingle()

  if (bidErr || !bid) {
    console.error('activateAuctionBidAfterDeposit bid:', bidErr?.message)
    return null
  }

  if (params.previousBidId) {
    await admin
      .from('nft_auction_bids')
      .update({ status: 'outbid', outbid_at: activatedAt })
      .eq('id', params.previousBidId)
      .eq('status', 'active')
  }

  const auctionPatch: Record<string, unknown> = {
    current_bid_id: params.bidId.trim(),
    current_bid_amount: params.amount,
    bid_count: undefined,
    updated_at: activatedAt,
  }

  // Increment bid_count via read-modify; keep simple for v1.
  const current = await getAuctionById(params.auctionId)
  const nextCount = (current?.bid_count ?? 0) + 1
  auctionPatch.bid_count = nextCount
  if (params.softCloseEndsAt) {
    auctionPatch.ends_at = params.softCloseEndsAt
  }
  if (params.softCloseExtensions != null) {
    auctionPatch.soft_close_extensions = params.softCloseExtensions
  }

  const { error: aucErr } = await admin
    .from('nft_auctions')
    .update(auctionPatch)
    .eq('id', params.auctionId.trim())
    .eq('status', 'live')

  if (aucErr) {
    console.error('activateAuctionBidAfterDeposit auction:', aucErr.message)
  }

  return { bid: normalizeBid(bid as Record<string, unknown>), previousBidId: params.previousBidId }
}

export async function finalizeBidRefund(params: {
  bidId: string
  refundTxSignature: string
}): Promise<NftAuctionBid | null> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auction_bids')
    .update({
      status: 'refunded',
      refund_tx_signature: params.refundTxSignature.trim(),
      refunded_at: now,
    })
    .eq('id', params.bidId.trim())
    .in('status', ['outbid', 'expired', 'active'])
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('finalizeBidRefund:', error?.message)
    return null
  }
  return normalizeBid(data as Record<string, unknown>)
}

export async function listAuctionsPastEndNeedingClose(limit = 25): Promise<NftAuction[]> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auctions')
    .select('*')
    .eq('status', 'live')
    .lt('ends_at', now)
    .order('ends_at', { ascending: true })
    .limit(limit)
  if (error) {
    console.error('listAuctionsPastEndNeedingClose:', error.message)
    return []
  }
  return (data || []).map((r) => normalizeAuction(r as Record<string, unknown>))
}

export async function markAuctionSuccessfulPendingClaims(params: {
  auctionId: string
  winnerWallet: string
  winningBidId: string
  platformFeeAmount: number
  creatorPayoutAmount: number
}): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auctions')
    .update({
      status: 'successful_pending_claims',
      winner_wallet: params.winnerWallet.trim(),
      winning_bid_id: params.winningBidId.trim(),
      platform_fee_amount: params.platformFeeAmount,
      creator_payout_amount: params.creatorPayoutAmount,
      ended_at: now,
      updated_at: now,
    })
    .eq('id', params.auctionId.trim())
    .eq('status', 'live')
    .select('*')
    .maybeSingle()

  if (error || !data) {
    console.error('markAuctionSuccessfulPendingClaims:', error?.message)
    return null
  }

  await admin
    .from('nft_auction_bids')
    .update({ status: 'won' })
    .eq('id', params.winningBidId.trim())
    .eq('status', 'active')

  return normalizeAuction(data as Record<string, unknown>)
}

export async function markAuctionFailedReserve(auctionId: string): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auctions')
    .update({
      status: 'failed_reserve',
      ended_at: now,
      updated_at: now,
    })
    .eq('id', auctionId.trim())
    .eq('status', 'live')
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('markAuctionFailedReserve:', error?.message)
    return null
  }

  // High bid becomes refundable (treat as outbid/expired path).
  const auction = normalizeAuction(data as Record<string, unknown>)
  if (auction.current_bid_id) {
    await admin
      .from('nft_auction_bids')
      .update({ status: 'expired', outbid_at: now })
      .eq('id', auction.current_bid_id)
      .eq('status', 'active')
  }
  return auction
}

export async function markAuctionPrizeClaimed(params: {
  auctionId: string
  claimTx: string
}): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auctions')
    .update({
      prize_claimed_at: now,
      prize_claim_tx: params.claimTx.trim(),
      prize_claim_locked_at: null,
      prize_claim_locked_wallet: null,
      updated_at: now,
    })
    .eq('id', params.auctionId.trim())
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('markAuctionPrizeClaimed:', error?.message)
    return null
  }
  return normalizeAuction(data as Record<string, unknown>)
}

export async function markAuctionCreatorProceedsClaimed(params: {
  auctionId: string
  claimTx: string
}): Promise<NftAuction | null> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auctions')
    .update({
      creator_claimed_at: now,
      creator_claim_tx: params.claimTx.trim(),
      creator_claim_locked_at: null,
      updated_at: now,
    })
    .eq('id', params.auctionId.trim())
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('markAuctionCreatorProceedsClaimed:', error?.message)
    return null
  }
  return normalizeAuction(data as Record<string, unknown>)
}

export async function maybeCompleteAuction(auctionId: string): Promise<void> {
  const auction = await getAuctionById(auctionId)
  if (!auction || auction.status !== 'successful_pending_claims') return
  if (!auction.prize_claimed_at || !auction.creator_claimed_at) return
  const admin = getSupabaseAdmin()
  await admin
    .from('nft_auctions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', auctionId)
    .eq('status', 'successful_pending_claims')
}

export async function listRefundableBidsForWallet(wallet: string): Promise<
  Array<NftAuctionBid & { auction_slug: string; auction_title: string }>
> {
  const w = wallet.trim()
  if (!w) return []
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('nft_auction_bids')
    .select('*')
    .eq('bidder_wallet', w)
    .in('status', ['outbid', 'expired'])
    .order('created_at', { ascending: false })
  if (error || !data?.length) return []

  const auctionIds = [...new Set(data.map((r: { auction_id: string }) => r.auction_id))]
  const { data: auctions } = await admin.from('nft_auctions').select('id,slug,title').in('id', auctionIds)
  const meta = new Map<string, { slug: string; title: string }>()
  for (const a of auctions || []) {
    const row = a as { id: string; slug: string; title: string }
    meta.set(row.id, { slug: row.slug, title: row.title })
  }
  return data.map((raw: Record<string, unknown>) => {
    const m = meta.get(String(raw.auction_id))
    return {
      ...normalizeBid(raw),
      auction_slug: m?.slug ?? '',
      auction_title: m?.title ?? '',
    }
  })
}

export async function cancelDraftAuction(auctionId: string, creatorWallet: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('nft_auctions')
    .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
    .eq('id', auctionId.trim())
    .eq('creator_wallet', creatorWallet.trim())
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  return !error && !!data
}
